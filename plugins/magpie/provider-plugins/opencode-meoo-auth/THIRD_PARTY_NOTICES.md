# 第三方声明（THIRD_PARTY_NOTICES）

本包包含或衍生自下列第三方代码，均按其原始 MIT 许可证分发：

## 1. dsh-meoo-connect

- 来源：https://github.com/2239058652/dsh-meoo-connect
- 上游基线：sangonomiya249/dsh-meoo `cf77e92`（独立维护衍生版）
- 许可证：MIT（原始版权归 sangonomiya249 及 dsh-meoo-connect 作者所有）
- 使用方式：`index.mjs` 中的 Meoo OAuth(PKCE) 流程、控制面
  （身份/项目/云服务 AK）、网关模型目录解析、兜底模型清单、CLI 请求头
  等逻辑由该项目的 `index.js` 移植而来，并适配 Magpie/OpenCode 的
  provider 插件契约（auth.loader / provider.models / methods）。

## 2. magpie-community/plugins 的 opencode2.mjs 适配层

- 来源：https://github.com/magpie-community/plugins
  （`opencode-raccoon-auth` 包内同名字节）
- 许可证：MIT
- 使用方式：`opencode2.mjs` 为 OpenCode 2.x 适配层，按该仓库声明
  「每个包携带同一份字节」的约定整份复制，未做修改。该文件原样声明：
  它把 1.x 插件（auth.methods / config / provider.models / auth.loader）
  适配成 OpenCode 2.x 的 {id, setup(ctx)} 形态。

MIT 许可证全文见本包 LICENSE 与上述两个上游仓库。
