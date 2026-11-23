// FISH Dock · Clash TUN 服务宿主
// 以 LocalSystem 身份持有 mihomo 内核，让普通权限的 Dock 也能开启 TUN。
//
// 权限模型（与 clash-verge 的 Service Mode 同构）：
//   service.ini —— 安装时由管理员写入：kernel（托管复制到 ProgramData 的只读内核）、
//                  kernelSha256 与 home 的固定绝对路径，普通用户只读。
//   job.ini     —— 运行期由普通用户写入：config 路径与 enabled 开关。
// 服务只按 service.ini 的 kernel 启动，job.ini 无法指定任意可执行文件，
// 因此提权面收敛为「用固定 mihomo 加载用户自己的配置」，与直接以管理员运行内核等价。
using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32;

public sealed class FishClashTunService : ServiceBase
{
    private const string ServiceId = "FishClashTun";
    private const double HostGoneGraceSeconds = 15.0;
    private const double PowerResumeGraceSeconds = 25.0;
    private Process child;
    private Timer watchdog;
    private string baseDir;
    private string jobPath;
    private string serviceIniPath;
    private string logPath;
    private string kernelLogPath;
    private string kernel;
    private string home;
    private FileSystemWatcher jobWatcher;
    private string lastJob = "";
    private long lastHostGoneAt = -1;
    private DateTime hostMissingSinceUtc = DateTime.MinValue;
    private DateTime lastTickUtc = DateTime.UtcNow;
    private DateTime graceUntilUtc = DateTime.MinValue;
    private int restarts;
    private DateTime lastStart = DateTime.MinValue;
    // C7：宿主已经没了。只在当前 host.json 对应的进程连续退出超过宽限期时抑制旧任务；一旦新宿主上线，立刻恢复。
    private bool hostGone;
    private bool missingKernelLogged;
    private readonly object gate = new object();
    private readonly object logLock = new object();
    private readonly object kernelLogLock = new object();
    private static readonly Regex SecretPattern = new Regex("(secret|token|password)\\s*[:=]\\s*[^\\s,&\"']+", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private enum JobReadState
    {
        Enabled,
        Disabled,
        Transient
    }

    public FishClashTunService()
    {
        ServiceName = ServiceId;
        CanStop = true;
        CanShutdown = true;
        CanHandlePowerEvent = true;
        AutoLog = false;
    }

    protected override bool OnPowerEvent(PowerBroadcastStatus powerStatus)
    {
        if (powerStatus == PowerBroadcastStatus.Suspend ||
            powerStatus == PowerBroadcastStatus.ResumeSuspend ||
            powerStatus == PowerBroadcastStatus.ResumeAutomatic ||
            powerStatus == PowerBroadcastStatus.ResumeCritical)
        {
            graceUntilUtc = DateTime.UtcNow.AddSeconds(PowerResumeGraceSeconds);
            hostMissingSinceUtc = DateTime.MinValue;
            Log("power event (" + powerStatus + "): extending host grace");
        }
        return true;
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
        else
        {
            kernelLogPath = Path.Combine(home, "tmp", "mihomo.log");
            Log("kernel=" + kernel + " home=" + home);
        }
        lastTickUtc = DateTime.UtcNow;
        Apply(false);
        try
        {
            jobWatcher = new FileSystemWatcher(baseDir, "job.ini");
            jobWatcher.NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.CreationTime | NotifyFilters.Size;
            jobWatcher.Changed += (_, __) => Tick(false);
            jobWatcher.Created += (_, __) => Tick(false);
            jobWatcher.Renamed += (_, __) => Tick(false);
            jobWatcher.EnableRaisingEvents = true;
        }
        catch (Exception error) { Log("job watcher disabled: " + error.Message); }
        watchdog = new Timer(_ => Tick(true), null, 1500, 1500);
    }

    protected override void OnStop()
    {
        Log("service stopping");
        if (jobWatcher != null) { jobWatcher.Dispose(); jobWatcher = null; }
        if (watchdog != null) { watchdog.Dispose(); watchdog = null; }
        KillChild();
    }

    protected override void OnShutdown() { OnStop(); }

    private static string ReadAllTextShared(string path, int retries = 4)
    {
        for (var i = 0; i <= retries; i++)
        {
            try
            {
                if (!File.Exists(path)) return null;
                using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var reader = new StreamReader(stream))
                {
                    var text = reader.ReadToEnd();
                    if (!string.IsNullOrEmpty(text.Trim()) || i == retries) return text;
                }
            }
            catch (IOException)
            {
                if (i == retries) throw;
            }
            Thread.Sleep(25);
        }
        return null;
    }

    private bool LoadServiceIni()
    {
        try
        {
            var text = ReadAllTextShared(serviceIniPath);
            if (string.IsNullOrEmpty(text)) return false;
            foreach (var raw in text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var line = raw.Trim().TrimStart('\uFEFF');
                if (line.Length == 0 || line.StartsWith("#")) continue;
                var at = line.IndexOf('=');
                if (at <= 0) continue;
                var key = line.Substring(0, at).Trim().TrimStart('\uFEFF');
                var value = line.Substring(at + 1).Trim().Trim('"');
                if (key == "kernel") kernel = value;
                else if (key == "home") home = value;
            }
        }
        catch (Exception error) { Log("service.ini read failed: " + error.Message); return false; }
        return !string.IsNullOrEmpty(kernel) && !string.IsNullOrEmpty(home);
    }

    // 只接受 home 目录下的 mihomo-runtime.json，拒绝越界路径。
    // 空内容或并发写锁返回 Transient，Tick 保持现状，防止非原子覆写窗口误杀正在运行的内核。
    private JobReadState ReadJob(out string config, out bool enabled)
    {
        config = null; enabled = false;
        try
        {
            if (!File.Exists(jobPath)) return JobReadState.Disabled;
            var text = ReadAllTextShared(jobPath);
            if (text == null || string.IsNullOrEmpty(text.Trim())) return JobReadState.Transient;
            foreach (var raw in text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var line = raw.Trim().TrimStart('\uFEFF');
                if (line.Length == 0 || line.StartsWith("#")) continue;
                var at = line.IndexOf('=');
                if (at <= 0) continue;
                var key = line.Substring(0, at).Trim().TrimStart('\uFEFF');
                var value = line.Substring(at + 1).Trim().Trim('"');
                if (key == "config") config = value;
                else if (key == "enabled") enabled = value == "1" || value.Equals("true", StringComparison.OrdinalIgnoreCase);
            }
        }
        catch (IOException error) { Log("job.ini busy: " + error.Message); return JobReadState.Transient; }
        catch (Exception error) { Log("job.ini read failed: " + error.Message); return JobReadState.Disabled; }
        if (!enabled || string.IsNullOrEmpty(config)) return JobReadState.Disabled;
        var full = Path.GetFullPath(config);
        var root = Path.GetFullPath(home) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) { Log("rejected config outside home: " + full); return JobReadState.Disabled; }
        if (!string.Equals(Path.GetFileName(full), "mihomo-runtime.json", StringComparison.OrdinalIgnoreCase)) { Log("rejected unexpected config name: " + full); return JobReadState.Disabled; }
        config = full;
        return JobReadState.Enabled;
    }

    private readonly object tickLock = new object();

    private void Tick(bool checkHostHealth)
    {
        if (!Monitor.TryEnter(tickLock)) return;
        try
        {
            var now = DateTime.UtcNow;
            // 检测休眠/唤醒导致的时钟跳变，避免合盖唤醒瞬间误判宿主消失。
            if (checkHostHealth)
            {
                if ((now - lastTickUtc).TotalSeconds > 10.0)
                {
                    graceUntilUtc = now.AddSeconds(PowerResumeGraceSeconds);
                    hostMissingSinceUtc = DateTime.MinValue;
                    Log("clock jump detected; extending host grace");
                }
                lastTickUtc = now;
            }

            long leaseAt = 0;
            bool gone = !string.IsNullOrEmpty(home) && HostIsGone(out leaseAt);
            if (hostGone)
            {
                // 只要看到新的存活宿主更新了租约，或者 lease 被清掉，就解除旧挂起，允许重新接管。
                if (!gone && leaseAt != lastHostGoneAt)
                {
                    hostGone = false;
                    hostMissingSinceUtc = DateTime.MinValue;
                    lastHostGoneAt = -1;
                    Log("host resumed: tun service ready");
                }
                else
                {
                    return;
                }
            }
            if (checkHostHealth)
            {
                if (gone && now >= graceUntilUtc)
                {
                    if (hostMissingSinceUtc == DateTime.MinValue)
                    {
                        hostMissingSinceUtc = now;
                        return;
                    }
                    // 按真实流逝时间（≥15s）连续失联且二次复查仍失联才撤 TUN，
                    // 避免 FileSystemWatcher 突发事件或插件 Worker 重载瞬断误杀内核。
                    if ((now - hostMissingSinceUtc).TotalSeconds < HostGoneGraceSeconds || !HostIsGone(out leaseAt)) return;
                    hostGone = true;
                    hostMissingSinceUtc = DateTime.MinValue;
                    lastHostGoneAt = leaseAt;
                    Log("host is gone: taking the tun down");
                    KillChild();
                    try { File.WriteAllText(jobPath, "enabled=0" + Environment.NewLine); lastJob = "0|"; }
                    catch (Exception error) { Log("job.ini reset failed: " + error.Message); }
                    return;
                }
                else
                {
                    hostMissingSinceUtc = DateTime.MinValue;
                }
            }

            string config; bool enabled;
            var readState = ReadJob(out config, out enabled);
            if (readState == JobReadState.Transient) return;
            var job = readState == JobReadState.Enabled ? "1|" + config : "0|";
            if (job != lastJob)
            {
                lastJob = job;
                Log("job changed: " + job);
                Apply(true, readState, config, enabled);
                return;
            }
            if (!checkHostHealth) return;
            bool dead;
            lock (gate) { dead = child == null || child.HasExited; if (!dead) return; }
            if (readState != JobReadState.Enabled) return;
            if ((DateTime.UtcNow - lastStart).TotalSeconds < 15) restarts++; else restarts = 0;
            if (restarts > 5) { Log("kernel exited repeatedly; watchdog paused"); return; }
            Log("kernel exited; restarting");
            Launch(config);
        }
        catch (Exception error) { Log("watchdog error: " + error.Message); }
        finally { Monitor.Exit(tickLock); }
    }

    // C7：宿主租约（插件在 TUN 接管期间写的 <home>/host.json）。没有租约就不据此
    // 动手——老调用方、还没接管的机器都不该被这个判据误伤。
    private bool HostIsGone(out long at)
    {
        at = 0;
        try
        {
            var lease = Path.Combine(home, "host.json");
            if (!File.Exists(lease)) return false;
            var text = ReadAllTextShared(lease);
            if (string.IsNullOrEmpty(text)) return false;
            var pidMatch = Regex.Match(text, "\"pid\"\\s*:\\s*([0-9]+)");
            if (!pidMatch.Success) return false;
            int pid;
            if (!int.TryParse(pidMatch.Groups[1].Value, out pid) || pid <= 0) return false;
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
                        if (probe.StartTime.ToUniversalTime() > recorded.AddSeconds(30)) return true;
                    }
                    return false;
                }
            }
            catch (ArgumentException) { return true; }          // 没有这个 pid
            catch (InvalidOperationException) { return true; }   // 刚好在这一刻退出
        }
        catch { return false; }
    }

    private void Apply(bool fromTick)
    {
        string config; bool enabled;
        var state = ReadJob(out config, out enabled);
        if (state == JobReadState.Transient && fromTick) return;
        lastJob = state == JobReadState.Enabled ? "1|" + config : "0|";
        Apply(fromTick, state, config, enabled);
    }

    private void Apply(bool fromTick, JobReadState state, string config, bool enabled)
    {
        KillChild();
        if (state != JobReadState.Enabled || !enabled) { Log("tun idle"); return; }
        if (string.IsNullOrEmpty(kernel) || !File.Exists(kernel))
        {
            if (!missingKernelLogged) { Log("kernel not found: " + kernel); missingKernelLogged = true; }
            return;
        }
        missingKernelLogged = false;
        if (!File.Exists(config)) { Log("config not found: " + config); return; }
        Launch(config);
    }

    private void Launch(string config)
    {
        var psi = new ProcessStartInfo(kernel, "-d \"" + home + "\" -f \"" + config + "\"");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.WorkingDirectory = baseDir;
        psi.EnvironmentVariables["TMP"] = baseDir;
        psi.EnvironmentVariables["TEMP"] = baseDir;
        if (!string.IsNullOrEmpty(home)) psi.EnvironmentVariables["SAFE_PATHS"] = Path.Combine(home, "credentials");
        try
        {
            lock (gate)
            {
                var proc = new Process();
                proc.StartInfo = psi;
                proc.OutputDataReceived += (_, e) => { if (!string.IsNullOrEmpty(e.Data)) LogKernel(e.Data); };
                proc.ErrorDataReceived += (_, e) => { if (!string.IsNullOrEmpty(e.Data)) LogKernel(e.Data); };
                if (!proc.Start()) { Log("kernel start returned false"); return; }
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                child = proc;
                lastStart = DateTime.UtcNow;
                restarts = 0;
                Log("kernel started pid=" + proc.Id + " config=" + config);
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
                // 先尝试温和结束让 mihomo 主动释放 Wintun 虚拟网卡与路由表，超时再强杀。
                try
                {
                    var gentle = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + victim.Id + " /T") { UseShellExecute = false, CreateNoWindow = true });
                    if (gentle != null) gentle.WaitForExit(1200);
                    victim.WaitForExit(1200);
                }
                catch { }
                if (!victim.HasExited)
                {
                    var killer = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + victim.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true });
                    if (killer != null) killer.WaitForExit(5000);
                }
                Log("kernel stopped pid=" + victim.Id);
            }
        }
        catch (Exception error) { Log("kernel kill failed: " + error.Message); }
        finally
        {
            try { victim.Dispose(); } catch { }
        }
    }

    private void LogKernel(string line)
    {
        lock (kernelLogLock)
        {
            try
            {
                if (string.IsNullOrEmpty(kernelLogPath)) return;
                var dir = Path.GetDirectoryName(kernelLogPath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                var safe = SecretPattern.Replace(line, "$1=<redacted>");
                if (File.Exists(kernelLogPath) && new FileInfo(kernelLogPath).Length > 512 * 1024) File.WriteAllText(kernelLogPath, "");
                File.AppendAllText(kernelLogPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + safe + Environment.NewLine);
            }
            catch { }
        }
    }

    private void Log(string message)
    {
        lock (logLock)
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
    }

    public static void Main()
    {
        ServiceBase.Run(new FishClashTunService());
    }
}
