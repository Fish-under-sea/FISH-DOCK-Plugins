# 厂商标志素材

页面按 `logos/<provider id>.svg` 取标。文件存在就显示，不存在自动退回按 id 取色的首字母块，所以补素材不需要改代码。

## 需要哪些

按 `checkin:state` 里实际出现的 provider id 命名。当前这台机器上出现过：

```
minimax-code.svg      trae-cn.svg        codearts.svg
raccoon.svg           autoclaw.svg       autoclaw-cn.svg
qoder.svg             qoder-cn.svg       workbuddy.svg
kiro.svg              cline.svg          joycode.svg
mimo.svg              zcode.svg          zen-free.svg
```

设备上多出其它 provider 时，按它的 id 加一份同名文件即可。

## 格式要求

- 纯矢量：`<svg viewBox="0 0 24 24">`，不要内嵌 `<image href="http">`，不要 `@import url(...)`。页面 CSP 只允许本目录资源，外链一律加载失败。
- 视觉尺寸按 22×22 绘制留边，深色主题下会加 8% 亮度补偿，纯黑标请自带一层浅色底或改用反白版本。
- 文件名只用小写字母、数字和连字符，与 provider id 完全一致（大小写敏感）。

## 版权

这里的文件都是各厂商的商标，只用于在用户自己机器上标识"这是哪一家"，不随包分发到商店页面之外。加入前请确认素材来自厂商公开发布的品牌资源，不要使用来路不明或改色改形的版本；拿不到官方矢量图时宁可留空用色块，也不要自绘近似标识。