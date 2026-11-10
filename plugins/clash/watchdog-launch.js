// Watchdog launcher (Windows Script Host, JScript), started by the scheduled task
// through wscript.exe; it then starts the real watchdog.mjs with SW_HIDE.
//
// Why this layer exists: when Task Scheduler starts a console-subsystem program in
// an interactive session (LogonType=InteractiveToken), Windows creates a visible
// console window, and Node's windowsHide cannot reach a process started by the Task
// Scheduler service. The node.exe bundled with Dock is a CONSOLE image, so putting it
// straight into the task action left a black window on the desktop (issue #50).
// wscript.exe is a GUI-subsystem program and opens no console of its own, and the
// second argument of WScript.Shell.Run is SW_HIDE, so node's window is hidden from
// creation.
//
// Keep this file pure ASCII: Windows Script Host reads .js as ANSI unless the file
// carries a BOM, and a UTF-8 comment can then swallow the following line.
//
// Arguments come from watchdog-task.mjs (paths may contain spaces; the caller quotes):
//   0 node.exe   1 watchdog.mjs   2 working directory   3 parent pid
//   4 lease path 5 kernel pid     6 mixed port          7 task name (deleted on exit)
//
// The launcher waits for node (Run's third argument is true) so that the scheduled
// task stays in the Running state for as long as the watchdog lives. That is what
// keeps `-MultipleInstances IgnoreNew` meaningful: a launcher that returned at once
// would let the 5-minute repetition start a second, third, ... watchdog every time.
var a = WScript.Arguments;
if (a.length < 3) WScript.Quit(2);
var node = a(0), script = a(1), cwd = a(2), lease = a.length > 4 ? a(4) : '';

// A failed start has no stdout to read: append to <lease>.log, the same file
// watchdog.mjs writes its own failures to.
function logFailure(text) {
  if (!lease) return;
  try {
    var file = new ActiveXObject('Scripting.FileSystemObject').OpenTextFile(lease + '.log', 8, true);
    file.WriteLine((new Date()).toString() + ' WATCHDOG_LAUNCH_FAILED ' + text);
    file.Close();
  } catch (ignored) {}
}

try {
  var sh = new ActiveXObject('WScript.Shell');
  sh.CurrentDirectory = cwd;
  var cmd = '"' + node + '" "' + script + '"';
  for (var i = 3; i < a.length; i++) cmd += ' "' + a(i) + '"';
  // 0 = SW_HIDE; true = wait for node, keeping the task in the Running state.
  sh.Run(cmd, 0, true);
} catch (error) {
  logFailure(String((error && error.message) || error));
  WScript.Quit(1);
}
