# 第三方组件

此仓的 Dock 插件适配代码沿用 MIT 许可；各上游组件保留自己的许可证，组合发行不更改原版权。

| 组件 | 固定版本／来源 | 许可与源码 |
| --- | --- | --- |
| Magpie | 0.1.1709；commit `47175a68fffe7a01c596f016c0d0da00545b10a4`；官方 `magpie-windows-amd64.exe` | [MIT 原文](licenses/Magpie.txt)；[对应源码](https://github.com/yetone/magpie/tree/47175a68fffe7a01c596f016c0d0da00545b10a4)；[官方发行](https://github.com/yetone/magpie-releases/releases/tag/v0.1.1709) |
| mihomo | v1.19.15；Windows amd64 compatible | [GPL-3.0 原文](licenses/mihomo.txt)；[对应源码和构建资料](https://github.com/MetaCubeX/mihomo/tree/v1.19.15) |
| OFM | 本轮 Dock 源码仓中的 `dsh-our-free-model` 及其 standalone 构建 | [原始项目](https://github.com/Ebony-Vinyl/dsh-our-free-model)；LICENSE、channel-pack NOTICE 和 third-party 清单随服务资源一起分发 |
| Dock Node／浏览器 SDK | FISH Dock 1.1.0；宿主 API 1 | [源码](https://github.com/Fish-under-sea/FISH-Dock/tree/v1.1.0/sdk)；MIT |

原生服务为上游未修改二进制。mihomo 发行 ZIP 的 SHA-256 为 `e9251191e459816c1aca55d495eabd50d525e83aff0cd445608d69da7e0f470c`。解压后的 mihomo 可执行文件为 `7f49fdbfc5c5a2a32807fadfeddbcefc61e439165495337a9b72ca090febaaf4`；Magpie 可执行文件为 `9c42c5759354188b001f7fda4ef626fb0ffff8c3f1d35bd7ac7c37851328f74c`。最终插件包另以商店索引和 SHA256SUMS 记录摘要。

Windhawk 由 Dock 安装包分发，不属于此仓业务插件。运行时不附带个人账号、Cookie、订阅或密钥。
