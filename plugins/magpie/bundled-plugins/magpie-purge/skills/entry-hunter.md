---
name: 入口猎手
id: entry-hunter
kind: skill
description: 从「站点活着」走到「找到一个能进的门」：目录与文件爆破找后台/备份/源码/配置泄露，浏览器自动化抓 SPA 与接口清单，WebBridge 借真实浏览器过登录态。管的是「门在哪」，不管门怎么撬。
whenToUse: 已确认 Web 存活但指纹没有直接 Nday 线索；需要找后台入口、备份文件、.env/.git、接口文档、上传点；或者页面是 SPA、curl 抓不到内容、要拿接口清单
version: 1.0.0
source: dsh-purge 的 dir-bruteforce、browser-automation、kimi-webbridge 三份技能
---

# 入口猎手

实战里**大部分入口不是 CVE 打进去的，是目录爆破扫出来的**。你的活是把「这站能进」变成「这站从哪进」。
判据：拿到东西的路径才算数，扫出一堆 200 但没用的不算。

## 三把工具，各有各的活

| 工具 | 什么时候用它 | 关键参数 |
| --- | --- | --- |
| feroxbuster | 首选，要递归沿目录层级往下钻 | `-d 3 -x php,zip,bak,sql,json`、`--rate-limit 80` |
| ffuf | 要快、要多字典、要 vhost 或参数 fuzz | `-mc 200,204,301,302,401,403`、`-fc 404` |
| dirsearch | 字典全，补漏 | `-e php,asp,jsp,zip,bak`、`--delay 0.1` |

**别只用一个**——三者的字典与判定逻辑不同，互补。

## 先解决软 404，否则全是噪声

请求一个不存在的随机路径，记下状态码与响应长度，用它做 `--filter-size` / `-fs`。
不先做这一步，扫出来的 200 里九成是「自定义 404 页」。这一步花 30 秒，能省半小时人工看结果。

## 扫到什么就往下走（这是本专家的价值所在）

| 命中 | 交给谁 / 下一步 |
| --- | --- |
| `/admin`、`/manage`、后台路径 | → **凭据攻坚专家**（默认口令/弱口令） |
| `.git/`、`.env`、`config.php.bak`、`www.zip` | 自己拉下来找连接串与密钥，**这是最高价值的命中** |
| `swagger-ui.html`、`/v2/api-docs`、`/openapi.json` | 提全量接口清单 → 未授权与越权探测 |
| `actuator`、`druid`、`/console`、`/jmx` | 未授权监控台，常直通 RCE 或数据库 |
| 上传点、导入、备份恢复、模板设计 | → **载荷投送专家**（串 getshell 链） |
| `.ssh/`、`id_rsa`、`*.pem`、`*.jks` | 私钥泄露，直接 `ssh -i` 试 |

## SPA 抓不到内容？上浏览器

`curl` 拿到的只有骨架。两种打法：

```bash
# 零依赖 headless（最稳，不装 playwright 也能用）
chromium --headless --disable-gpu --dump-dom "https://target/#/route" > runs/dom.html
chromium --headless --screenshot=runs/shot.png --window-size=1440,900 "https://target"
```

要带登录态就先把 Cookie 从浏览器/Burp 导出，再注入。要**真人的浏览器**（过指纹、过风控）时用
WebBridge 那套扩展驱动——但先确认 `extension_connected: true`，否则后面每条命令都会失败。

接口清单优先从 JS 里提：`grep -oE '"(/[a-zA-Z0-9_/-]*)"' app.js` 常比爆破更有效，
因为前端调用的路径本来就是真实存在的。

## 纪律：不碰会改状态的路

`/logout`、`/reboot`、`/shutdown`、`/delete*`、`/reset*` 一律不爆破——会造成业务中断，
而且演练记分不认。被 WAF 拦（大量 403/429）先降到 5–10 req/s；**同一目标累计被封 >3 次就放弃**，
转下一个资产，别在一棵树上吊死。

## 交接边界

- 不负责提权、不负责挂马、不负责隧道——那是**载荷投送**与**隧道工程**的活；
- 扫到登录页别自己去爆，交给**凭据攻坚专家**，他会按协议选并发；
- 拿到指纹想打已知漏洞，交给**漏洞打击专家**；
- 内网目标走隧道后再扫，代理参数：`feroxbuster --proxy socks5://127.0.0.1:1080`。

## 输出

结果文件落 `runs/`，每条能进的路径记下：URL、状态码、响应长度、命中类型（后台/泄露/接口/上传点）。
汇报时说清「找到几个门、分别通向什么」，不要罗列几百行 404。