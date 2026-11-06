// 演示快照（没就绪的那种）：只有素材、没人设、模式也没选。
// 用来复看「导入了一个 zip，为什么不会注入」这一屏。
//   node preview/serve.mjs --demo=blocked
window.PURGE_CATALOG = {
  version: 9,
  generatedAt: 1794564000000,
  sources: [
    { path: 'D:/Fish-code/DSH/purge', ok: true, count: 1, error: '' },
    { path: 'C:/Users/you/.agent-purge', ok: false, count: 0, error: '目录不存在或没有权限' },
    { path: 'C:/Users/you/.magpie/purge', ok: false, count: 0, error: '目录不存在或没有权限' },
  ],
  entries: [
    {
      id: '5556',
      name: '5556',
      kind: 'session-archive',
      status: 'ok',
      reason: '',
      source: { root: 'D:/Fish-code/DSH/purge', rel: 'Anima loli tag.zip' },
      size: 177986,
      digest: '948c5f9615e0',
      importedAt: 1794564000000,
      version: 1,
      meta: { format: 'dsh-session-archive', version: 1, sessions: 1, turns: 12, cwd: '/root/comfy ui' },
      chars: 0,
      injectable: false,
    },
  ],
  rejected: [],
  options: { mode: '', persona: '', enabled: {}, agents: [] },
  imports: [],
  purge: { bound: false, mode: '', persona: '', disabled: [], error: '' },
  plan: {
    mode: 'off',
    modeFrom: 'default',
    personaId: '',
    personaName: '',
    personaFrom: '',
    skills: [],
    blocked: '还没选模式：模式是 off，请求原样放行。选一个模式（比如 replace）就开始注入',
    blockedCode: 'no-mode',
    ready: false,
  },
  last: null,
}
