// FISH Dock · Clash TUN 服务宿主
// 以 LocalSystem 身份持有 mihomo 内核，让普通权限的 Dock 也能开启 TUN。
//
// 权限模型（与 clash-verge 的 Service Mode 同构）：
//   service.ini —— 安装时由管理员写入：kernel 与 home 的**固定**绝对路径，用户只读。
//   job.ini     —— 运行期由普通用户写入：config 路径与 enabled 开关。
// 服务只按 service.ini 的 kernel 启动，job.ini 无法指定任意可执行文件，
// 因此提权面收敛为「用固定 mihomo 加载用户自己的配置」，与直接以管理员运行内核等价。
using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Threading;

public sealed class FishClashTunService : ServiceBase
{
    private const string ServiceId = "FishClashTun";
    private Process child;
    private Timer watchdog;
    private string baseDir;
    private string jobPath;
    private string serviceIniPath;
    private string logPath;
    private string kernel;
    private string home;
    private string lastJob = "";
    private int restarts;
    private DateTime lastStart = DateTime.MinValue;
    private readonly object gate = new object();

    public FishClashTunService()
    {
        ServiceName = ServiceId;
        CanStop = true;
        CanShutdown = true;
        AutoLog = false;
    }

    protected override void OnStart(string[] args)
    {
        baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "FishDock", "clash-tun");
        jobPath = Path.Combine(baseDir, "job.ini");
        serviceIniPath = Path.Combine(baseDir, "service.ini");
        logPath = Path.Combine(baseDir, "service.log");
        Directory.CreateDirectory(baseDir);
        Log("service starting");
        if (!LoadServiceIni()) { Log("service.ini missing or invalid; service idle"); }
        else { Log("kernel=" + kernel + " home=" + home); }
        Apply();
        watchdog = new Timer(_ => Tick(), null, 1500, 1500);
    }

    protected override void OnStop()
    {
        Log("service stopping");
        if (watchdog != null) { watchdog.Dispose(); watchdog = null; }
        KillChild();
    }

    protected override void OnShutdown() { OnStop(); }

    private bool LoadServiceIni()
    {
        try
        {
            if (!File.Exists(serviceIniPath)) return false;
            foreach (var raw in File.ReadAllLines(serviceIniPath))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                var at = line.IndexOf('=');
                if (at <= 0) continue;
                var key = line.Substring(0, at).Trim();
                var value = line.Substring(at + 1).Trim().Trim('"');
                if (key == "kernel") kernel = value;
                else if (key == "home") home = value;
            }
        }
        catch (Exception error) { Log("service.ini read failed: " + error.Message); return false; }
        return !string.IsNullOrEmpty(kernel) && !string.IsNullOrEmpty(home);
    }

    // 只接受 home 目录下的 mihomo-runtime.json，拒绝越界路径。
    private bool ReadJob(out string config, out bool enabled)
    {
        config = null; enabled = false;
        try
        {
            if (!File.Exists(jobPath)) return false;
            foreach (var raw in File.ReadAllLines(jobPath))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                var at = line.IndexOf('=');
                if (at <= 0) continue;
                var key = line.Substring(0, at).Trim();
                var value = line.Substring(at + 1).Trim().Trim('"');
                if (key == "config") config = value;
                else if (key == "enabled") enabled = value == "1" || value.Equals("true", StringComparison.OrdinalIgnoreCase);
            }
        }
        catch (Exception error) { Log("job.ini read failed: " + error.Message); return false; }
        if (string.IsNullOrEmpty(config)) return false;
        var full = Path.GetFullPath(config);
        var root = Path.GetFullPath(home) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) { Log("rejected config outside home: " + full); return false; }
        if (!string.Equals(Path.GetFileName(full), "mihomo-runtime.json", StringComparison.OrdinalIgnoreCase)) { Log("rejected unexpected config name: " + full); return false; }
        config = full;
        return true;
    }

    private void Tick()
    {
        try
        {
            string config; bool enabled;
            var ok = ReadJob(out config, out enabled);
            var job = ok ? (enabled ? "1|" + config : "0|") : "missing";
            if (job != lastJob)
            {
                lastJob = job;
                Log("job changed: " + job);
                Apply();
                return;
            }
            bool dead;
            lock (gate) { dead = child == null || child.HasExited; if (!dead) return; }
            if (!ok || !enabled) return;
            if ((DateTime.UtcNow - lastStart).TotalSeconds < 15) restarts++; else restarts = 0;
            if (restarts > 5) { Log("kernel exited repeatedly; watchdog paused"); return; }
            Log("kernel exited; restarting");
            Launch(config);
        }
        catch (Exception error) { Log("watchdog error: " + error.Message); }
    }

    private void Apply()
    {
        string config; bool enabled;
        var ok = ReadJob(out config, out enabled);
        KillChild();
        if (!ok || !enabled) { Log("tun idle"); return; }
        if (string.IsNullOrEmpty(kernel) || !File.Exists(kernel)) { Log("kernel not found: " + kernel); return; }
        if (!File.Exists(config)) { Log("config not found: " + config); return; }
        Launch(config);
    }

    private void Launch(string config)
    {
        var psi = new ProcessStartInfo(kernel, "-d \"" + home + "\" -f \"" + config + "\"");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.WorkingDirectory = baseDir;
        psi.EnvironmentVariables["TMP"] = baseDir;
        psi.EnvironmentVariables["TEMP"] = baseDir;
        try
        {
            lock (gate)
            {
                child = Process.Start(psi);
                lastStart = DateTime.UtcNow;
                restarts = 0;
                Log("kernel started pid=" + (child == null ? "?" : child.Id.ToString()) + " config=" + config);
            }
        }
        catch (Exception error) { Log("kernel start failed: " + error.Message); }
    }

    private void KillChild()
    {
        Process victim;
        lock (gate) { victim = child; child = null; }
        if (victim == null) return;
        try
        {
            if (!victim.HasExited)
            {
                var killer = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + victim.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true });
                if (killer != null) killer.WaitForExit(5000);
                Log("kernel stopped pid=" + victim.Id);
            }
        }
        catch (Exception error) { Log("kernel kill failed: " + error.Message); }
    }

    private void Log(string message)
    {
        try
        {
            if (logPath == null) return;
            var line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine;
            if (File.Exists(logPath) && new FileInfo(logPath).Length > 512 * 1024) File.WriteAllText(logPath, "");
            File.AppendAllText(logPath, line);
        }
        catch { }
    }

    public static void Main()
    {
        ServiceBase.Run(new FishClashTunService());
    }
}
