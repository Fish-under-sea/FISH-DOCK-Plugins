# 第三方组件

此仓的 Dock 插件适配代码沿用 MIT 许可；各上游组件保留自己的许可证，组合发行不更改原版权。

| 组件 | 固定版本／来源 | 许可与源码 |
| --- | --- | --- |
| Magpie | 上游 `yetone/magpie` 基线 `v0.1.3596` + 本仓补丁 `fish.33` 源码自编译（随包 exe；补丁清单见 `plugins/magpie/tools/README.md`） | [MIT 原文](licenses/Magpie.txt)；[基线源码](https://github.com/yetone/magpie/tree/v0.1.3596) |
| mihomo | v1.19.15；Windows amd64 compatible | [GPL-3.0 原文](licenses/mihomo.txt)；[对应源码和构建资料](https://github.com/MetaCubeX/mihomo/tree/v1.19.15) |
| mihomo geo 数据 | GeoSite.dat / GeoIP.dat；取自 `MetaCubeX/meta-rules-dat` latest（geosite 由 v2fly 域名表汇总，geoip 由 GeoLite2 汇总） | [项目与许可说明](https://github.com/MetaCubeX/meta-rules-dat)；随 Clash 插件内置，用于国内直连与分类分流，运行时不联网下载 |
| OFM | 已退役（2026-10-25 暂停维护）：仅历史发行包 2.0.1 内随包 `dsh-our-free-model` standalone 构建，当前包不再携带 | [原始项目](https://github.com/Ebony-Vinyl/dsh-our-free-model)；历史 LICENSE 与 NOTICE 以该发行包为准 |
| Dock Node／浏览器 SDK | FISH Dock 1.1.0；宿主 API 1 | [源码](https://github.com/Fish-under-sea/FISH-Dock/tree/v1.1.0/sdk)；MIT |

mihomo 为上游未修改二进制，发行 ZIP 的 SHA-256 为 `e9251191e459816c1aca55d495eabd50d525e83aff0cd445608d69da7e0f470c`，解压后可执行文件为 `7f49fdbfc5c5a2a32807fadfeddbcefc61e439165495337a9b72ca090febaaf4`；Magpie 为源码自编译，逐版摘要以当次发行记录与商店索引为准。最终插件包另以商店索引和 SHA256SUMS 记录摘要。

Windhawk 由 Dock 安装包分发，不属于此仓业务插件。运行时不附带个人账号、Cookie、订阅或密钥。
