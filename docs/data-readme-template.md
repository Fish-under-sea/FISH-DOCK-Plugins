# 数据目录 README 发行模板

状态：v3 规格配套模板，尚未接入安装器。实现时由宿主从已校验发行清单渲染，禁止将未替换的模板变量当成已安装版本说明。

## 1. 生成位置与时机

下载资源通过校验、安装提交时生成目录及说明。更新提交时使用该次发行版本刷新；更新失败恢复旧版说明。单纯下载失败不改活动目录。

```text
.fish-dock/
├── README.md
├── host/
│   ├── README.md
│   ├── credentials/README.md
│   ├── roster/README.md
│   ├── keys/README.md
│   ├── config/README.md
│   ├── exports/README.md
│   ├── backups/README.md
│   └── tmp/README.md
├── .fishplugin-ourfreemodel/
│   ├── README.md
│   ├── credentials/README.md
│   ├── roster/README.md
│   ├── keys/README.md
│   ├── config/README.md
│   ├── exports/README.md
│   ├── backups/README.md
│   └── tmp/README.md
└── .plugin.<publisher>.<name>/
    └── 同样的分类与说明
```

仅为实际安装的插件创建数据目录。未安装的飞书、Clash、Magpie 和 OFM 不创建凭据占位目录，不自动填充或复制任何真实密钥。四个官方目录的映射见 [开发者 README](developers/README.md)。

## 2. 数据根 README 模板

下列模板中的双花括号字段由安装器替换，值只能来自已校验清单和宿主版本信息，不从凭据文件读取。

```markdown
# FISH Dock 数据目录

Dock 版本：{{dockVersion}}
目录规范版本：{{storageSchemaVersion}}
说明生成器版本：{{generatorVersion}}

本目录保存本机 Dock 与已安装插件的持久化身份、凭据、花名册、密钥和配置。默认根为系统当前用户目录下的 .fish-dock；显式启动设置优先于 FISH_DOCK_HOME，其次使用系统默认。所有插件沿用同一宿主解析结果。

host 保存 Dock 自有数据。官方插件目录使用 .fishplugin- 前缀，第三方插件目录使用 .plugin.<publisher>.<name>。插件数据互不自动转移。

切换数据根请使用 Dock 数据位置功能，由宿主停用服务、备份、复制并校验后切换。导入导出使用相对路径重新定位，不依赖原机器用户名或盘符。

README 由版本管理自动刷新。个人补充请另存 USER-NOTES.md；说明中不要填写真实密钥或完整账号凭据。
```

## 3. 插件目录 README 模板

```markdown
# {{pluginDisplayName}} 数据目录

插件 ID：{{pluginId}}
插件版本：{{pluginVersion}}
Dock 版本：{{dockVersion}}
数据 schema：{{dataSchemaVersion}}
存储目录键：{{storageDirectoryKey}}

本目录由 Dock 在统一 .fish-dock 根目录下分配。使用宿主提供的路径，不自行拼接绝对路径。

credentials：原始凭据与刷新令牌。
roster：账号花名册和账号关联信息。
keys：API、网关及签名密钥。
config：插件配置键和值。
exports：用户生成的导出包。
backups：迁移或恢复前的对应版本备份。
tmp：安装、导入和导出的受控暂存。

导出时可分别选择凭据、花名册、密钥与配置。默认导出到 exports；选择另存为后才复制到所选位置。归档记录插件身份、数据版本、目录键、相对路径及文件摘要。

导入由宿主校验归档身份和数据格式，在当前数据根内暂存并提交；失败保留原数据。停止插件不删除数据。OFM 与 Magpie 各自恢复自己的归档。

本说明随插件版本更新。个人说明请保存在 USER-NOTES.md；不要把真实凭据写入说明文件。
```

## 4. 分类目录 README 模板

为每一分类生成独立说明，`categoryDescription` 与 `operationNotes` 使用下表固定文字，不插入目录实际文件内容。

```markdown
# {{pluginDisplayName}} · {{categoryName}}

所属 ID：{{ownerId}}
所属版本：{{ownerVersion}}
Dock 版本：{{dockVersion}}
数据 schema：{{dataSchemaVersion}}
目录分类：{{categoryName}}

{{categoryDescription}}

{{operationNotes}}

当前目录由统一存储上下文定位。复制恢复与导入导出通过 Dock 执行；说明不记录机器绝对路径或真实密钥。本说明随所属版本更新。
```

| 分类 | `categoryDescription` | `operationNotes` |
| --- | --- | --- |
| `credentials` | 保存原始凭据与刷新令牌，按原有加密格式处理。 | 使用插件账号导入、刷新和导出入口；不要手工修改正在使用的凭据。 |
| `roster` | 保存账号花名册与账号关联信息。 | 单独导出花名册不会自动附带凭据；恢复时校验账号引用。 |
| `keys` | 保存 API、网关及签名密钥。 | 在密钥管理中选择导出或轮换，日志和说明不展示密钥实值。 |
| `config` | 保存配置键、配置值及其格式版本。 | 密钥类配置归 keys 或 credentials，配置文件使用关联引用。 |
| `exports` | 保存用户按类别选择生成的归档。 | 归档按插件身份与相对路径恢复；保留现有加密导出保护。 |
| `backups` | 保存变更前的数据和版本备份。 | 恢复前停用对应服务并检查 schema，其他插件数据保持独立。 |
| `tmp` | 保存根目录内受控暂存。 | 活跃操作期间不要修改；操作成功或回滚后只清理该次自有暂存。 |

`host/` 采用同一模板，`ownerId` 使用宿主身份，`ownerVersion` 使用真实 Dock 版本。所有变量必填；缺失版本或残留模板变量时安装失败，先保留旧版，修复发行元数据后重试。

## 5. 生成验收

- 新安装时检查根目录、插件目录及每个分类目录的说明与实际发行版本一致。
- 更新成功后说明随版本刷新；模拟 README 写入失败时安装回滚，旧数据和旧说明保留。
- 更换用户目录、盘符、工作目录、数据根，以及含中文与空格的路径时仍使用统一根解析。
- 扫描生成文件，确认不存在未替换变量、真实令牌、密钥或源机器绝对路径。
- 导出再在另一个根导入，检查插件归属、类别、摘要、说明版本与恢复结果。
