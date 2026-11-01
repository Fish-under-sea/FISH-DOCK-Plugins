// 插件仓统一错误码表：code → 固定中文文案（含用户下一步）。
// 只做「码 → 文案」这一件事，页面与后端都按 code 查表；原始 message、系统地址、凭据一律不透出。
// 原生码（EADDRINUSE/EACCES/EPERM/EBUSY）单独成条，不与上位码合并，便于日志里保留系统原始语义。
// 页面侧的 plugins/clash/page.js 有一份同源表（浏览器里不能 import），改文案必须两处同步，
// page.test.mjs 会逐码比对两份表，靠测试挡住漂移。
export const errorMessages = Object.freeze({
 // ── Magpie 服务侧 ──
 PORT_IN_USE: '端口已被占用，请停止冲突服务或更换本机端口后重试',
 PORT_BIND_DENIED: '端口绑定被系统拒绝：请避开系统保留端口段（或改用 1024 以上的其他端口）后重试',
 FILE_BUSY: '文件被其他进程占用：请关闭正在使用该文件的程序或暂停杀毒扫描后重试',
 PERMISSION_DENIED: '权限不足：请把插件装到当前用户可写的目录，或调整该目录的访问控制后重试',
 RUNTIME_COPY_FAILED: '运行副本复制失败：请检查插件资料目录的可用空间与文件占用后重试，旧副本仍保留',
 GATEWAY_ERROR: '服务网关启动异常：请打开插件日志查看原始错误码，确认端口与运行副本状态后重试',
 EXECUTABLE_MISSING: '服务文件不存在，请重新安装插件或选择有效的服务文件',
 EXECUTABLE_INVALID: '服务路径不是普通文件，请重新选择',
 DATA_UNWRITABLE: '插件数据目录不可写，请检查数据根目录及访问权限',
 DATA_MIGRATION_FAILED: '准备 Magpie 资料目录失败，原资料已保留；请检查目录权限和可用空间后重试',
 RUNTIME_PREPARE_FAILED: '准备 Magpie 运行副本失败，请检查插件资料目录的可用空间、权限或文件占用后重试；旧版本文件已保留',
 RUNTIME_INTEGRITY: 'Magpie 运行副本校验失败，已停止启动并保留资料；请重新安装插件，若仍提示此错误请检查对应副本文件',
 SETTINGS_INVALID: 'Magpie 设置文件已损坏（原文件已保留），请检查插件资料下 credentials/magpie-runtime/data/settings.json，修复配置后重新启动',
 SPAWN_FAILED: '无法启动服务，请检查运行时依赖、文件权限和系统兼容性',
 EARLY_EXIT: '服务在就绪前退出，请检查依赖和独立测试日志后重试',
 READY_TIMEOUT: '等待服务就绪超时，请检查依赖或端口后重试',
 INVALID_READY_URL: '服务就绪地址无效，请检查适配包与服务版本是否匹配',
 STOP_FAILED: '服务退出尚未完成，请重试停止',
 // ── Clash 内核 / 控制器 / 系统代理 / 订阅 ──
 KERNEL_ATTACH_FAILED: '无法接管残留内核：请先停止内核（或结束残留的 mihomo 进程）后重新启动',
 KERNEL_STOP_UNCONFIRMED: '内核是否已退出未能确认：请两秒后刷新；仍显示运行中就在任务管理器结束 mihomo 进程',
 PROXY_RESTORE_RECORD_INVALID: '系统代理恢复记录无效：请在设置里手动关闭系统代理，再重新打开内核',
 PROXY_REGISTRY_READ_FAILED: '无法读取系统代理设置：请检查当前用户对 Internet 设置的读取权限，或先手动关闭系统代理再重试',
 PROXY_REGISTRY_WRITE_FAILED: '无法写入系统代理设置：请检查注册表写入权限与安全软件拦截后重试',
 CONTROLLER_UNREACHABLE: '内核控制器无响应：请确认内核进程仍在运行、控制器端口未被占用，然后重试',
 CONTROLLER_TIMEOUT: '内核控制器响应超时：请稍后重试；连续超时请重启内核',
 SUBSCRIPTION_CORRUPT: '订阅配置损坏：请从备份恢复或重新添加订阅地址后再更新',
 // ── 原生系统码：保留原始语义，便于对日志 ──
 EADDRINUSE: '端口已被本机其他程序占用（EADDRINUSE）：请关闭占用该端口的程序，或改用其他端口后重试',
 EACCES: '没有访问权限（EACCES）：请确认目标目录归当前用户所有，或以管理员权限重新安装插件',
 EPERM: '系统拒绝该操作（EPERM）：请检查安全软件或系统策略是否拦截，再重试',
 EBUSY: '文件被占用或资源忙（EBUSY）：请关闭占用该文件的程序后重试',
 // ── 插件协议层：d.sdk/host 侧产生，透传到页面（t12 打通后真的会到页面）──
 // 这几条不是插件业务码，画面上的下一步也按用户能做的事写，不写协议黑话。
 COMMAND_FAILED: '这次操作插件没能完成：请重试；仍失败请打开插件日志查看原因',
 NOT_ACTIVE: '插件尚未启用：回到插件页启用后重试',
 UNKNOWN_METHOD: '宿主与插件版本不匹配（页面要的方法插件没有）：请更新插件到 2.1.2 后重试',
 CAPABILITY_REQUIRED: '宿主与插件版本不匹配（插件没声明所需能力）：请更新插件到 2.1.2 后重试',
 BAD_HANDSHAKE: '插件没能与 Dock 完成握手：请重新安装该插件；仍失败请打开插件日志',
 HANDSHAKE_REQUIRED: '插件会话尚未就绪：请关闭并重新打开插件页面后重试',
 OPERATION_ERROR: '插件操作未完成：请刷新后重试；仍失败请打开插件日志查看原因',
 // ── 兜底：只有一个，其余命中不到码的场景全部落到这里 ──
 UNKNOWN_ERROR: '未识别错误，请重试；若反复出现，请打开插件日志查看原始错误码'
});
// 无效码（unknown / 空 / 非字符串）统一折算成 UNKNOWN_ERROR，保证 {code, message} 永远是合法对。
export function errorCode(code) {
 return Object.hasOwn(errorMessages, code) ? code : 'UNKNOWN_ERROR';
}
export function errorMessage(code) {
 return errorMessages[errorCode(code)];
}
export function serviceError(code) {
 const error = new Error(errorMessage(code));
 error.code = errorCode(code);
 return error;
}
// 统一错误对象：{code, message}。日志用它，页面也只认这两项。
export function publicError(error) {
 const code = errorCode(error?.code);
 return {code, message: errorMessages[code]};
}
// 兼容出口：网关状态里的 error 是给人读的一行文本，仍返回字符串。
export function publicServiceError(error) {
 return publicError(error).message;
}