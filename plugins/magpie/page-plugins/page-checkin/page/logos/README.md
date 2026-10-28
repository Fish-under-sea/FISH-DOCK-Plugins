# 厂商标志素材

页面按 `logos/<provider id>.svg`、`.png`、`.webp` 的顺序取标（先 svg，找不到再 png，再 webp）。文件存在就显示，都不存在时自动退回按 id 取色的首字母块，所以补素材不需要改代码。

## 需要哪些

按 `checkin:state` 里实际出现的 provider id 命名。当前已随包：

```
workbuddy.svg        minimax-code.svg     trae-cn.png
codearts.svg         raccoon.png          autoclaw.svg
autoclaw-cn.svg      qoder.png            qoder-cn.png
```

设备上多出其它 provider（kiro、cline、joycode、mimo、zcode、zen-free 等）时，按它的 id 加一份同名文件即可。

## 格式要求

- svg 纯矢量：带 `viewBox`（缺 viewBox 的会按固有尺寸裁切，只露一角），不要内嵌 `<image href="http">`，不要 `@import url(...)`。页面 CSP 只允许本目录资源，外链一律加载失败。
- 位图用 png/webp，方形、透明或纯色底皆可，建议 ≥ 64×64。
- 文件名只用小写字母、数字和连字符，与 provider id 完全一致（大小写敏感）。

## 版权

这里的文件都是各厂商的商标，只用于在用户自己机器上标识"这是哪一家"。素材分别取自：magpie 自带的厂商图标库（workbuddy / minimax / qoder 等）、各社区插件包自带的 `icon`（codearts / raccoon）、以及厂商官网公开的品牌资源（trae.ai、qoder.com、z.ai）。拿不到官方矢量图时宁可留空用色块，不要自绘近似标识。