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
using System.Text.RegularExpressions;
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
    // C7：宿主已经没了。一旦认定，本次服务生命周期内不再拉起内核。
    private bool hostGone;
    // 已经决定退休（插件包没了）：不再拉起内核，也不再重复撤自己。
    private bool retiring;
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
            // C7：宿主不在了就自己撤——TUN 服务是 SYSTEM 托管、独立于宿主的 Job，
            // 宿主崩溃后内核还会一直把整机流量劫走。这里停内核 + 把 job.ini 置 0，
            // 等于让虚拟网卡随内核一起消失，用户下一次开 Dock 再重新接管。
            if (retiring) return;
            // 插件包被卸载或换了版本：service.ini 里登记的内核已经不在了，这套服务再留着
            // 只会每次开机刷一条「内核找不到」。空闲（没在用）就整体退休，连目录一起清掉。
            if (ShouldRetire()) { Retire(); return; }
            if (hostGone) return;
            if (!string.IsNullOrEmpty(home) && HostIsGone())
            {
                hostGone = true;
                Log("host is gone: taking the tun down");
                KillChild();
                try { File.WriteAllText(jobPath, "enabled=0" + Environment.NewLine); lastJob = "0|"; }
                catch (Exception error) { Log("job.ini reset failed: " + error.Message); }
                return;
            }
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

    // 插件包没了、内核文件也就不在：service.ini 是安装时写死的绝对路径，升级换目录、
    // 或者用户卸载插件，都会让这个路径失效。只有「内核确实不在了」且「进程也没在跑」
    // 才退休——删除运行中的 exe 不会结束进程，正在接管流量的内核还在跑时撤服务等于断网。
    private bool ShouldRetire()
    {
        if (string.IsNullOrEmpty(kernel)) return false;
        if (File.Exists(kernel)) return false;
        // 判活只看进程句柄，不读 job.ini：插件写 job.ini 不是原子的，恰好读到写了一半
        // 的窗口会把 enabled=1 读成「没在用」，把服务从正在启动的内核脚下删掉。
        lock (gate) { if (child != null && !child.HasExited) return false; }
        // 没有活内核，登记的 exe 也没了：这套服务不可能再工作。job.ini 写着 enabled=1
        // 也一样（升级换目录后旧路径失效的现场），退休并置 0，别让开机后每 1.5 秒
        // 刷一条「内核找不到」。
        return true;
    }

    // 退休 = 停内核 + 撤服务 + 删目录。目录里有本服务自己的 exe，服务进程活着时删不掉，
    // 所以交给一个延迟几秒的 cmd：等 SCM 把本进程停掉、文件句柄释放之后再删。
    private void Retire()
    {
        retiring = true;
        Log("kernel package is gone; retiring the tun service");
        KillChild();
        try { File.WriteAllText(jobPath, "enabled=0" + Environment.NewLine); lastJob = "0|"; }
        catch (Exception error) { Log("job.ini reset failed: " + error.Message); }
        try
        {
            var psi = new ProcessStartInfo("cmd.exe", "/c ping -n 4 127.0.0.1 >nul & rd /s /q \"" + baseDir + "\"")
            { UseShellExecute = false, CreateNoWindow = true };
            Process.Start(psi);
        }
        catch (Exception error) { Log("cleanup spawn failed: " + error.Message); }
        try
        {
            var psi = new ProcessStartInfo("sc.exe", "delete " + ServiceId) { UseShellExecute = false, CreateNoWindow = true };
            var remover = Process.Start(psi);
            if (remover != null) remover.WaitForExit(5000);
            Log("service delete requested");
        }
        catch (Exception error) { Log("service delete failed: " + error.Message); }
        try { Stop(); }
        catch (Exception error) { Log("service stop failed: " + error.Message); }
    }

    // C7：宿主租约（插件在 TUN 接管期间写的 <home>/host.json）。没有租约就不据此
    // 动手——老调用方、还没接管的机器都不该被这个判据误伤。
    private bool HostIsGone()
    {
        try
        {
            var lease = Path.Combine(home, "host.json");
            if (!File.Exists(lease)) return false;
            var text = File.ReadAllText(lease);
            var pidMatch = Regex.Match(text, "\"pid\"\\s*:\\s*([0-9]+)");
            if (!pidMatch.Success) return false;
            int pid;
            if (!int.TryParse(pidMatch.Groups[1].Value, out pid) || pid <= 0) return false;
            long at = 0;
            var atMatch = Regex.Match(text, "\"at\"\\s*:\\s*([0-9]+)");
            if (atMatch.Success) long.TryParse(atMatch.Groups[1].Value, out at);
            try
            {
                using (var probe = Process.GetProcessById(pid))
                {
                    if (probe.HasExited) return true;
                    // pid 被系统复用：租约写下之后才启动的进程，不是当初那个宿主。
                    if (at > 0)
                    {
                        var recorded = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(at);
                        if (probe.StartTime.ToUniversalTime() > recorded.AddSeconds(5)) return true;
                    }
                    return false;
                }
            }
            catch (ArgumentException) { return true; }          // 没有这个 pid
            catch (InvalidOperationException) { return true; }   // 刚好在这一刻退出
        }
        catch { return false; }
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
