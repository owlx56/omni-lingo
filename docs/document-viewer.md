# Document Viewer

OneLingo 的文档阅读器覆盖 PDF / EPUB、本地文件 / URL、文件链接嗅探，以及 reader 内 hover / selection 翻译。这里记录当前边界，避免以后把 PDF.js、EPUB 和普通网页翻译路径改散。

## 文件入口

| 文件 | 职责 |
| --- | --- |
| `src/entrypoints/viewer/App.tsx` | `/viewer.html` 兼容路由壳；只负责本地 `onelingo-key`、远程 URL、旧 sniff 链接的格式解析和转跳 |
| `src/entrypoints/pdf-viewer.ts` | 输出 `/pdf-viewer.js` 的薄入口；实际代码在 `src/entrypoints/pdf/bridge.ts` |
| `src/entrypoints/pdf/bridge.ts` | PDF.js reader 内 hover、selection 状态桥接、主题同步和 reader UI 标记 |
| `src/entrypoints/epub-viewer.ts` | 输出 `/epub-viewer.js` 的薄入口；挂载 Foliate Solid viewer |
| `src/entrypoints/foliate/App.tsx` | Foliate reader UI；接收 `onelingo-key`、`file`、`onelingo-sniff=1` 并驱动 `foliate-view` |
| `src/entrypoints/foliate/bridge.ts` | Foliate 内容文档内 hover / selection 桥接；绑定 `foliate-view` 的 load / relocate 生命周期 |
| `@onelingo/pdfjs-dist` | 私有 Git 依赖仓库 `owlx56/pdfjs-dist`；根目录是 package shell，官方 `pdfjs-*-dist.zip` 展开内容放在 `dist/` |
| `package.json` / `bun.lock` | OneLingo 只在这里锁定 `@onelingo/pdfjs-dist` 的具体 Git tag；当前为 `git@github.com:owlx56/pdfjs-dist.git#v5.7.284` |
| `src/assets/epub-viewer/` | OneLingo EPUB 静态 shell，构建时复制到 `/epub/web/` |
| `src/assets/pdf-viewer/locales.generated.mjs` | 由 `scripts/generate-i18n.ts` 生成的 PDF reader 静态语言包 |
| `src/features/document-sniffer.ts` | content script 层的页面内 PDF / EPUB 链接点击拦截 |
| `src/entrypoints/background.ts` | 地址栏 / 主框架文件导航嗅探、右键菜单、保留原页面、独立窗口逻辑 |
| `src/lib/document-store.ts` | reader 页面 IndexedDB 文档暂存，避免把大文件塞进 URL |

`src/features/document-viewer/` 仍保留早期解析型 reader 的类型和 EPUB 解析 helper。当前 PDF 不在这里解析，PDF 由打包的 PDF.js viewer 处理；当前 EPUB / MOBI / AZW3 / FB2 主路径由 Foliate reader 在 `src/entrypoints/foliate/App.tsx` 渲染。

## 打开流程

PDF 最终必须进入顶层 `/pdf/web/viewer.html`，EPUB 最终进入 `/epub/web/viewer.html`。`/viewer.html` 只保留为兼容路由和 HTML shell 探测入口，不再承载 EPUB UI：

```text
options / context menu / sniffer
  -> PDF URL: /pdf/web/viewer.html?file=...
  -> local PDF: storeDocument() IndexedDB
  -> /pdf/web/viewer.html?onelingo-key=...
  -> PDF DNR sniff: /pdf/web/viewer.html?onelingo-sniff=1
  -> EPUB / MOBI / AZW3 / FB2 URL: /epub/web/viewer.html?file=...
  -> local EPUB: storeDocument() IndexedDB
  -> /epub/web/viewer.html?onelingo-key=...
  -> Foliate DNR sniff: /epub/web/viewer.html?onelingo-sniff=1
  -> unknown URL / HTML shell: /viewer.html?url=...&format=auto
  -> discovered PDF: /pdf/web/viewer.html?file=...
  -> discovered EPUB: /epub/web/viewer.html?file=...
```

本地 PDF 从 options 进入时先 `storeDocument()`，然后由顶层 PDF.js viewer 内的 `pdf/bridge.ts` 用 `onelingo-key` 读取 IndexedDB 并调用 `PDFViewerApplication.open({ data })`。远程 PDF URL 直接作为官方 viewer 的 `file` 参数打开，和 Saladict 一样。远程 EPUB / MOBI / AZW3 / FB2 URL 进入 `/epub/web/viewer.html?file=...` 后由 Foliate viewer 拉取并渲染；本地同样用 `onelingo-key` 打开。远程 URL 如果不能从扩展入口判断格式，会先进入 `/viewer.html` 做 HTML shell 发现；发现 PDF 后立即重定向到顶层官方 viewer，发现 Foliate 书籍后重定向到 Foliate viewer 的 `file` 入口。`fetchResolvableResource()` 会尝试从 iframe / embed / object / anchor / script 中发现嵌套的 PDF / Foliate 链接，最多递归 `MAX_URL_RESOLVE_DEPTH`。

## PDF.js 资产

PDF reader 使用 `@onelingo/pdfjs-dist` 私有 Git 依赖提供 GitHub release `pdfjs-*-dist.zip` 的展开内容，并加载官方 PDF.js `viewer.html` / `viewer.js|mjs` / `viewer.css` shell。当前依赖锁定在 `git@github.com:owlx56/pdfjs-dist.git#v5.7.284`，PDF.js 版本为 `5.7.284`；不要再用自定义 `PDFViewer` 外壳替代官方 viewer，也不要把官方 viewer 放进 OneLingo iframe，否则 Chrome / Less / Saladict 一致的双击选词边界会重新偏移。

OneLingo 不再下载或解压 PDF.js release zip。私有 `owlx56/pdfjs-dist` 仓库负责用脚本/CI 同步 Mozilla release zip；OneLingo 只在 `package.json` / `bun.lock` 中锁定该 Git 依赖的具体 tag。升级 PDF.js 时，先更新自建仓库，再更新 OneLingo 依赖引用并运行 `bun install`。

`wxt.config.ts` 的 `build:publicAssets` 会复制：

- `@onelingo/pdfjs-dist/dist/build/` 下的 PDF.js runtime、worker、sandbox
- `@onelingo/pdfjs-dist/dist/web/viewer.html`
- `@onelingo/pdfjs-dist/dist/web/viewer.js|mjs`
- `@onelingo/pdfjs-dist/dist/web/viewer.css`
- `@onelingo/pdfjs-dist/dist/web/locale/`
- `@onelingo/pdfjs-dist/dist/web/cmaps/`、`standard_fonts/`、`wasm/`、`iccs/`、`images/`
- `src/assets/fonts/inter/`

旧版 PDF.js 使用 `@onelingo/pdfjs-dist/dist/web/locale/**/viewer.properties` 时，`wxt.config.ts` 会以 `en-US/viewer.properties` 为基线，对缺失 key 做构建期补齐：先尝试使用官方别名 key（例如 `bookmark1.*` 复用 `bookmark.*`，`save.*` 复用 `download.*`），再回退到英文值。新版 PDF.js 使用 Fluent `viewer.ftl` / `locale.json` 时直接复制官方 locale 目录。

`prepare:publicPaths` 会把 `pdf/web/viewer.html` 和 `epub/web/viewer.html` 加入 public path。`wxt.config.ts` 会通过 Node 模块解析定位已安装的 `@onelingo/pdfjs-dist`，只接受包壳里的 `dist/build/pdf.mjs` / `dist/build/pdf.js` 布局，并用 `dist/PDFJS_RELEASE.json` 和 `pdfjs-release.lock.json` 做一致性校验。`wxt.config.ts` 会在复制时注入 `/pdf-viewer.js`、清空默认 PDF、跳过 `validateFileURL(file)`，并保留 `willReadFrequently` canvas readback 补丁。

## Reader 翻译

普通网页、PDF reader、EPUB reader 要尽量共享行为：

- selection UI 走 `src/features/selection/`，不要在 reader 里复制一套“译”按钮逻辑。
- PDF reader 通过 `src/entrypoints/pdf/bridge.ts` 调用 `initHover()` 和 `initSelection()`，并实现 `readPageFeatureStatus` / `updatePageFeaturePrefs`。
- PDF hover 与普通网页共用 `src/features/hover/`。在顶层官方 PDF.js viewer 下，这套通用 hover 已验证可与 Less Translate 保持同等精度；不要为了 PDF 单独恢复 token split、overlay underline 或改写 textLayer DOM。PDF.js 的双击选词和浏览器原生选区依赖原始 textLayer 结构，所以仍然不要包 `all: unset` wrapper / token span。
- Foliate reader 因内容在 `foliate-view` 载入的 iframe 文档中，需要 `src/entrypoints/foliate/bridge.ts` 在文档生命周期里转接 hover / selection。当前 hover 已复用 `src/features/hover/` 的共享 controller；bridge 只保留 `load` / `relocate` 绑定和文档级样式同步。
- reader UI 元素要标记 `data-onelingo-reader-ui`，hover / selection 命中测试必须避开工具栏、侧栏、弹层和菜单。

修改 selection 行为时，先改 `src/features/selection/` 的共享路径，再检查普通网页、PDF reader、EPUB reader 三处是否同样生效。

## 文件链接嗅探

文件链接嗅探有两层，缺一层都会出现行为差异：

- content script：`src/features/document-sniffer.ts` 拦截普通网页中的 `<a href="...pdf|epub">` 点击。仅在不保留原页面且不独立窗口时，PDF 直接跳到 `/pdf/web/viewer.html?file=...`，EPUB 直接跳到 `/epub/web/viewer.html?file=...`，未知格式才跳到 `/viewer.html?url=...`。
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
- PDF 官方 viewer 通过 URL hash 的 `locale` 初始化语言；`src/lib/document-viewer-urls.ts` 负责把 OneLingo `uiLang` 映射到 PDF.js locale。已打开 PDF tab 会继续同步 `lang` / `dir`，但官方 viewer 文案不会热切换，刷新后生效。

新增 reader 文案时只改 `catalog.ts`，然后运行：

```powershell
bun run i18n:generate
bun test .\src\lib\i18n\index.test.js
```

不要手动编辑生成的 locale 文件。

## 主题和字体

options、popup、EPUB reader、PDF reader 使用打包的 Inter 字体。字体源在 `src/assets/fonts/inter/`，PDF reader 通过 `wxt.config.ts` 复制到 `pdf/web/fonts/inter`。

主题同步路径：

- `/viewer.html` 路由壳通过 `useSettings()` / `initTheme()` 更新。
- 顶层 PDF viewer 内部由 `/pdf-viewer.js` 调用 `initTheme()` 并监听主题变化。
- EPUB viewer 自身由 `/epub-viewer.js` 初始化主题；EPUB 内容文档通过 `syncRenditionDocumentPrefs()` 和 `rendition.hooks.content` 注入 `onelingo-epub-theme`。

修主题 bug 时要检查已打开的 PDF / EPUB tab，无需刷新 tab 就应该响应主语言和主题切换。

## 验证建议

改 reader 或 sniffer 后至少考虑：

- options 本地选择一个小 PDF；
- options URL 输入直接 PDF，例如 `https://arxiv.org/pdf/...`；
- URL 输入 HTML shell，例如 `https://lesstranslate.com/pdf.html`；
- 页面内点击 PDF / EPUB 链接；
- 地址栏输入 PDF URL，分别测试只嗅探、保留原页面、独立窗口；
- PDF reader 内 hover / selection；
- Foliate reader 内 hover / selection；
- 已打开 reader tab 时切换主题和主语言。

常规命令：

```powershell
bun run i18n:generate
bun test .\src\lib\i18n\index.test.js
bun run compile
bun run build
```
