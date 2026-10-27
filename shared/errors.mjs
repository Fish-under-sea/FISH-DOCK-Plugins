// Only adapter-owned codes cross into the page. Native output is never shown.
const messages = Object.freeze({
 PORT_IN_USE: '端口已被占用，请停止冲突服务或更换本机端口后重试',
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
});
export function serviceError(code) {
 const error = new Error(messages[code] || '服务操作失败，请检查配置后重试');
 error.code = code;
 return error;
}
export function publicServiceError(error) {
 return messages[error?.code] || '服务启动失败，请确认路径、端口与服务文件完整性';
}
