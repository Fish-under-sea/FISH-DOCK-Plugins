# README 头部排版维护

头部沿用原有像素字体、双层边框、深浅色主题与四卡布局。修改文案和标签时编辑 [header.html](header.html)，保留 CSS 样式；不要用普通表格或不同宽高比的徽章替换其中一张卡片。

GitHub 会过滤 README 内的自定义 CSS 和字体，因此 README 通过 `<picture>` 展示本地 HTML/CSS 排版的浏览器截图。图片里的吉祥物沿用已有素材，不使用模型重绘。可编辑源稿、字体及渲染工具都保存在本仓。

在仓库根目录运行：

```powershell
node tools/render-readme.mjs
```

脚本使用独立临时资料目录启动 Microsoft Edge，不操作日用浏览器。`EDGE_BINARY` 可指定现有 Edge 路径。输出为 `config-hero-zh-{light,dark}.png` 和四组 `config-stat-*-zh-{light,dark}.png`，同时记录 [header-metadata.json](header-metadata.json)。

- 头图：1448 × 575。
- 四张卡片：统一 357 × 189，README 中均为 `width="23%"`。
- 主版本卡表示最新补丁，说明行必须写清各插件实际版本，避免暗示四包统一版本。
- 标签按实际情况填写，适配层 MIT 与随包第三方运行时许可分别说明，不能用 `MIT CODE` 概括整包。
- 像素字体 Jersey 20 遵循 [SIL OFL](OFL-Jersey20.txt)。现有吉祥物沿用原素材来源，字体许可不代表图片许可。

渲染会检查字体加载、图片加载、标题宽度、卡片内容边界和浏览器脚本异常。渲染后仍需实际查看深浅色成品；仅修改文字时不重排配色、布局或删除标签。
