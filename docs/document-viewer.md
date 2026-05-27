# Document Viewer

OneLingo 的文档阅读器覆盖 PDF / EPUB、本地文件 / URL、文件链接嗅探，以及 reader 内 hover / selection 翻译。这里记录当前边界，避免以后把 PDF.js、EPUB 和普通网页翻译路径改散。

## 文件入口

| 文件 | 职责 |
| --- | --- |
| `src/entrypoints/viewer/App.tsx` | `/viewer.html` 的 Solid 壳；接收 `key`、`url`、`sniff=1`；拉取远程文档、存储文档、分发到 PDF iframe 或 EPUB rendition |
| `src/entrypoints/viewer/epub-bridge.ts` | EPUB iframe 内 hover / selection 桥接；直接绑定 EPUB 内容文档 |
| `src/entrypoints/pdf-bridge.ts` | PDF.js reader 内 hover、selection 状态桥接、主题同步和 reader UI 标记 |
| `src/assets/pdf-viewer/viewer.html` | OneLingo 风格的 PDF.js 静态 reader shell |
| `src/assets/pdf-viewer/viewer.mjs` | PDF.js viewer orchestration、工具栏、查找、缩放、缩略图、i18n、保存 / 打印 |
| `src/assets/pdf-viewer/onelingo-viewer.css` | PDF reader 的 OneLingo / options 风格覆盖 |
| `src/assets/pdf-viewer/locales.generated.mjs` | 由 `scripts/generate-i18n.ts` 生成的 PDF reader 静态语言包 |
| `src/features/document-sniffer.ts` | content script 层的页面内 PDF / EPUB 链接点击拦截 |
| `src/entrypoints/background.ts` | 地址栏 / 主框架文件导航嗅探、右键菜单、保留原页面、独立窗口逻辑 |
| `src/lib/document-store.ts` | reader 页面 IndexedDB 文档暂存，避免把大文件塞进 URL |

`src/features/document-viewer/` 仍保留早期解析型 reader 的类型和 EPUB 解析 helper。当前 PDF 不在这里解析，PDF 由打包的 PDF.js viewer 处理；当前 EPUB 主路径由 `epubjs` 在 `src/entrypoints/viewer/App.tsx` 渲染。

## 打开流程

本地文件 / URL 最终都会进入 `/viewer.html`：

```text
options / context menu / sniffer
  -> /viewer.html?url=...&format=auto
  -> fetchDocumentFromUrl()
  -> HTML shell 嵌套文档发现
  -> inferFetchedFormat()
  -> storeDocument() IndexedDB
  -> history.replaceState(/viewer.html?key=...)
  -> PDF: iframe 到 /pdf/web/viewer.html?file=blob:
  -> EPUB: epubjs renderTo(#epub-render)
```

本地文件从 options 进入时先 `storeDocument()`，然后用 `key` 打开 reader。远程 URL 会在 viewer 页内 fetch；如果 URL 返回 HTML，`fetchResolvableResource()` 会尝试从 iframe / embed / object / anchor / script 中发现嵌套的 PDF / EPUB 链接，最多递归 `MAX_URL_RESOLVE_DEPTH`。

## PDF.js 资产

PDF reader 使用 `pdfjs-dist` npm 依赖，不再把完整 `public/pdf` vendor 进仓库。当前固定在 `3.3.122`，和 Less Translate 的 PDF viewer 版本一致；这个版本的 textLayer 几何更接近 Less 的 hover 命中行为。

`wxt.config.ts` 的 `build:publicAssets` 会复制：

- `node_modules/pdfjs-dist/build/pdf.js`
- `pdf.worker.js`
- `pdf.sandbox.js`
- `web/pdf_viewer.js`
- `web/pdf_viewer.css`
- `cmaps/`、`image_decoders/`、`standard_fonts/`、`web/images/`
- `src/assets/fonts/inter/`
- `src/assets/pdf-viewer/` 下的 OneLingo viewer 文件

`prepare:publicPaths` 会把 `pdf/web/viewer.html` 加入 public path。改 PDF.js 版本时更新 `package.json` 的 `pdfjs-dist`，然后跑 build；不要手改 `.output/` 或复制 node_modules 产物进源码目录。PDF.js `3.3.122` 的 viewer 是 UMD 脚本，所以 `viewer.html` 先加载 `../build/pdf.js` 和 `pdf_viewer.js`，`viewer.mjs` 再从 `globalThis.pdfjsLib` / `globalThis.pdfjsViewer` 读取 API。

## Reader 翻译

普通网页、PDF reader、EPUB reader 要尽量共享行为：

- selection UI 走 `src/features/selection/`，不要在 reader 里复制一套“译”按钮逻辑。
- PDF reader 通过 `src/entrypoints/pdf-bridge.ts` 调用 `initSelection()`，并实现 `readPageFeatureStatus` / `updatePageFeaturePrefs`。
- PDF hover 只在 PDF.js `textLayer` 内按 Less Translate 的方式拆 token：原始 text span 内包一层 `all: unset` wrapper，再把 `text.split(/(\s|\.|\,|\:|\!|\?|\"|\||\'|。|，|？|》|《)/g).filter(Boolean)` 的片段放进 `all: unset` token span；可翻译 token 直接绑定 `mouseenter` / `mousemove` / `mouseout` / `mouseleave` / `mouseover`，并用全局 `mousemove` + `elementFromPoint()` 复核当前鼠标点下的 token。命中使用当前 token 的 `getBoundingClientRect()`，下划线优先使用和普通网页 hover 相同的 CSS Custom Highlight `text-decoration`；只有不支持 Custom Highlight 时才用 fixed overlay 兜底。空白 delimiter token 不绑定事件，鼠标落在空格上应自然清除 hover。不要回到 caret / 坐标比例估算。
- EPUB reader 因内容在 epubjs iframe 中，需要 `src/entrypoints/viewer/epub-bridge.ts` 在 iframe 文档里转接 hover / selection 命中、坐标和高亮。
- reader UI 元素要标记 `data-onelingo-reader-ui`，hover / selection 命中测试必须避开工具栏、侧栏、弹层和菜单。

修改 selection 行为时，先改 `src/features/selection/` 的共享路径，再检查普通网页、PDF reader、EPUB reader 三处是否同样生效。

## 文件链接嗅探

文件链接嗅探有两层，缺一层都会出现行为差异：

- content script：`src/features/document-sniffer.ts` 拦截普通网页中的 `<a href="...pdf|epub">` 点击。仅在不保留原页面且不独立窗口时直接把当前页面跳到 `/viewer.html?url=...`。
- background：`src/entrypoints/background.ts` 用 DNR / webRequest 处理地址栏输入、主框架跳转、content-type 是 PDF / EPUB 但 URL 不带扩展名的情况，以及 `file://` 导航。

相关设置在 `src/lib/storage/settings.ts`：

- `documentLinkSniffEnabled`
- `documentLinkSniffKeepOriginal`
- `documentLinkSniffStandalone`

保留原页面时，background 会打开新 tab 的 reader，并为原 tab 安装临时 DNR allow rule 再放行原 URL。独立窗口用 `browser.windows.create({ type: "popup" })`；只有启用独立窗口设置时才使用。

`file://` 嗅探依赖浏览器扩展管理页面的“允许访问文件 URL”。没有权限时不能自动接管本地文件导航。

## I18n

options、popup、EPUB reader、PDF reader 的文案源都在 `src/lib/i18n/catalog.ts`。

- EPUB / Solid reader UI 通过 `useT()` 读取 `viewer.*` key。
- PDF 静态 reader 使用 `pdfViewer.*` key。
- `scripts/generate-i18n.ts` 生成 `src/lib/i18n/locales/*.ts` 和 `src/assets/pdf-viewer/locales.generated.mjs`。
- `viewer.mjs` 读取 `sync:settings.uiLang`，并监听 storage change；切换主语言时已打开 PDF tab 应更新 `lang`、`dir` 和可见 UI 文案。

新增 reader 文案时只改 `catalog.ts`，然后运行：

```powershell
bun run i18n:generate
bun test .\src\lib\i18n\index.test.js
```

不要手动编辑生成的 locale 文件。

## 主题和字体

options、popup、EPUB reader、PDF reader 使用打包的 Inter 字体。字体源在 `src/assets/fonts/inter/`，PDF reader 通过 `wxt.config.ts` 复制到 `pdf/web/fonts/inter`。

主题同步路径：

- `/viewer.html` 自身通过 `useSettings()` / `watchEffectiveTheme()` 更新。
- PDF iframe 由 `syncPdfFrameTheme()` 把 `lang` / `dir` / theme 写入同源 iframe document。
- PDF frame 内部 `pdf-bridge.ts` 也会 `initTheme()` 并监听主题变化。
- EPUB 内容文档通过 `syncRenditionDocumentPrefs()` 和 `rendition.hooks.content` 注入 `onelingo-epub-theme`。

修主题 bug 时要检查已打开的 PDF / EPUB tab，无需刷新 tab 就应该响应主语言和主题切换。

## 验证建议

改 reader 或 sniffer 后至少考虑：

- options 本地选择一个小 PDF；
- options URL 输入直接 PDF，例如 `https://arxiv.org/pdf/...`；
- URL 输入 HTML shell，例如 `https://lesstranslate.com/pdf.html`；
- 页面内点击 PDF / EPUB 链接；
- 地址栏输入 PDF URL，分别测试只嗅探、保留原页面、独立窗口；
- PDF reader 内 hover / selection；
- EPUB reader 内 hover / selection；
- 已打开 reader tab 时切换主题和主语言。

常规命令：

```powershell
bun run i18n:generate
bun test .\src\lib\i18n\index.test.js
bun run compile
bun run build
```
