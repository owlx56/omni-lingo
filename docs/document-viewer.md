# Document Viewer

Omni Lingo 的文档阅读器覆盖 PDF / EPUB、本地文件 / URL、文件链接嗅探，以及 reader 内 hover / selection 翻译。这里记录当前边界，避免以后把 PDF.js、EPUB 和普通网页翻译路径改散。

## 文件入口

| 文件 | 职责 |
| --- | --- |
| `src/entrypoints/viewer/App.tsx` | `/viewer.html` 路由壳；只负责本地 `omni-lingo-key`、远程 URL、sniff 链接的格式解析和转跳 |
| `src/entrypoints/pdf-viewer.ts` | 输出 `/pdf-viewer.js` 的薄入口；实际代码在 `src/entrypoints/pdf/bridge.ts` |
| `src/entrypoints/pdf/bridge.ts` | PDF.js reader 内 hover、selection 状态桥接、主题同步和 reader UI 标记 |
| `src/entrypoints/foliate-viewer.ts` | 输出 `/foliate-viewer.js` 的薄入口；挂载 Foliate Solid viewer |
| `src/entrypoints/foliate/App.tsx` | Foliate reader UI；接收 `omni-lingo-key`、`file`、`omni-lingo-sniff=1` 并驱动 `foliate-view` |
| `src/entrypoints/foliate/bridge.ts` | Foliate 内容文档内 hover / selection 桥接；绑定 `foliate-view` 的 load / relocate 生命周期 |
| `src/entrypoints/foliate/reader-content-style.ts` | Foliate 内容 CSS 注入、书内 CSS/HTML transform、Readest 默认字号和主题变量 |
| `src/entrypoints/foliate/reader-toc.tsx` | TOC normalize、起始页码 hydration、展开路径和递归节点 |
| `src/entrypoints/foliate/reader-appearance-panel.tsx` | viewer 顶栏 reader 外观弹窗 |
| `src/entrypoints/foliate/reader-book-details.tsx` | 书籍详情 modal 内折叠 section UI |
| `src/entrypoints/foliate/reader-*.ts` | Foliate sidebar / chrome / layout / page-turn / scrollbar / settings 等 reader-local helper |
| `src/entrypoints/foliate/footnote-popup.ts` | Readest 式脚注 / 尾注弹窗 |
| `src/lib/foliate-reader-settings.ts` | EPUB reader 外观设置的默认值、范围、锁定和存储转换 |
| `@omni-lingo/pdfjs-dist` | 私有 Git 依赖仓库 `owlx56/pdfjs-dist`；根目录是 package shell，官方 `pdfjs-*-dist.zip` 展开内容放在 `dist/` |
| `package.json` / `bun.lock` | Omni Lingo 只在这里锁定 `@omni-lingo/pdfjs-dist` 的具体 Git tag；当前为 `git@github.com:owlx56/pdfjs-dist.git#v5.7.284` |
| `src/assets/foliate-viewer/` | Omni Lingo EPUB 静态 shell，构建时复制到 `/foliate/web/` |
| `src/assets/pdf-viewer/locales.generated.mjs` | 由 `scripts/generate-i18n.ts` 生成的 PDF reader 静态语言包 |
| `src/features/document-sniffer.ts` | content script 层的页面内 PDF / EPUB 链接点击拦截 |
| `src/entrypoints/background.ts` | 地址栏 / 主框架文件导航嗅探、右键菜单、保留原页面、独立窗口逻辑 |
| `src/lib/document-store.ts` | reader 页面 IndexedDB 文档暂存，避免把大文件塞进 URL |

`src/features/document-viewer/` 仍保留早期解析型 reader 的类型和 EPUB 解析 helper。当前 PDF 不在这里解析，PDF 由打包的 PDF.js viewer 处理；当前 EPUB / MOBI / AZW3 / FB2 主路径由 Readest fork `foliate-js` 和 Foliate reader 在 `src/entrypoints/foliate/App.tsx` 渲染。

## 打开流程

PDF 最终必须进入顶层 `/pdf/web/viewer.html`，EPUB 最终进入 `/foliate/web/viewer.html`。`/viewer.html` 只保留为路由和 HTML shell 探测入口，不再承载 EPUB UI：

```text
options / context menu / sniffer
  -> PDF URL: /pdf/web/viewer.html?file=...
  -> local PDF: storeDocument() IndexedDB
  -> /pdf/web/viewer.html?omni-lingo-key=...
  -> PDF DNR sniff: /pdf/web/viewer.html?omni-lingo-sniff=1
  -> EPUB / MOBI / AZW3 / FB2 URL: /foliate/web/viewer.html?file=...
  -> local EPUB: storeDocument() IndexedDB
  -> /foliate/web/viewer.html?omni-lingo-key=...
  -> Foliate DNR sniff: /foliate/web/viewer.html?omni-lingo-sniff=1
  -> unknown URL / HTML shell: /viewer.html?url=...&format=auto
  -> discovered PDF: /pdf/web/viewer.html?file=...
  -> discovered EPUB: /foliate/web/viewer.html?file=...
```

本地 PDF 从 options 进入时先 `storeDocument()`，然后由顶层 PDF.js viewer 内的 `pdf/bridge.ts` 用 `omni-lingo-key` 读取 IndexedDB 并调用 `PDFViewerApplication.open({ data })`。远程 PDF URL 直接作为官方 viewer 的 `file` 参数打开，和 Saladict 一样。远程 EPUB / MOBI / AZW3 / FB2 URL 进入 `/foliate/web/viewer.html?file=...` 后由 Foliate viewer 拉取并渲染；本地同样用 `omni-lingo-key` 打开。远程 URL 如果不能从扩展入口判断格式，会先进入 `/viewer.html` 做 HTML shell 发现；发现 PDF 后立即重定向到顶层官方 viewer，发现 Foliate 书籍后重定向到 Foliate viewer 的 `file` 入口。`fetchResolvableResource()` 会尝试从 iframe / embed / object / anchor / script 中发现嵌套的 PDF / Foliate 链接，最多递归 `MAX_URL_RESOLVE_DEPTH`。

Omni Lingo 只生成并读取 `omni-lingo-key` / `omni-lingo-sniff` 和 `omni-lingo-docs`。

## PDF.js 资产

PDF reader 使用 `@omni-lingo/pdfjs-dist` 私有 Git 依赖提供 GitHub release `pdfjs-*-dist.zip` 的展开内容，并加载官方 PDF.js `viewer.html` / `viewer.js|mjs` / `viewer.css` shell。当前依赖锁定在 `git@github.com:owlx56/pdfjs-dist.git#v5.7.284`，PDF.js 版本为 `5.7.284`；不要再用自定义 `PDFViewer` 外壳替代官方 viewer，也不要把官方 viewer 放进 Omni Lingo iframe，否则 Chrome / Less / Saladict 一致的双击选词边界会重新偏移。

Omni Lingo 不再下载或解压 PDF.js release zip。私有 `owlx56/pdfjs-dist` 仓库负责用脚本/CI 同步 Mozilla release zip；Omni Lingo 只在 `package.json` / `bun.lock` 中锁定该 Git 依赖的具体 tag。升级 PDF.js 时，先更新自建仓库，再更新 Omni Lingo 依赖引用并运行 `bun install`。

`wxt.config.ts` 的 `build:publicAssets` 会复制：

- `@omni-lingo/pdfjs-dist/dist/build/` 下的 PDF.js runtime、worker、sandbox
- `@omni-lingo/pdfjs-dist/dist/web/viewer.html`
- `@omni-lingo/pdfjs-dist/dist/web/viewer.js|mjs`
- `@omni-lingo/pdfjs-dist/dist/web/viewer.css`
- `@omni-lingo/pdfjs-dist/dist/web/locale/`
- `@omni-lingo/pdfjs-dist/dist/web/cmaps/`、`standard_fonts/`、`wasm/`、`iccs/`、`images/`
- `src/assets/fonts/inter/`

旧版 PDF.js 使用 `@omni-lingo/pdfjs-dist/dist/web/locale/**/viewer.properties` 时，`wxt.config.ts` 会以 `en-US/viewer.properties` 为基线，对缺失 key 做构建期补齐：先尝试使用官方别名 key（例如 `bookmark1.*` 复用 `bookmark.*`，`save.*` 复用 `download.*`），再回退到英文值。新版 PDF.js 使用 Fluent `viewer.ftl` / `locale.json` 时直接复制官方 locale 目录。

`prepare:publicPaths` 会把 `pdf/web/viewer.html`、`foliate/web/viewer.html` 和 `foliate/web/foliate-js/view.js` 加入 public path。`wxt.config.ts` 会通过 Node 模块解析定位已安装的 `@omni-lingo/pdfjs-dist`，只接受包壳里的 `dist/build/pdf.mjs` / `dist/build/pdf.js` 布局，并用 `dist/PDFJS_RELEASE.json` 和 `pdfjs-release.lock.json` 做一致性校验。`wxt.config.ts` 会在复制时注入 `/pdf-viewer.js`、清空默认 PDF、跳过 `validateFileURL(file)`，并保留 `willReadFrequently` canvas readback 补丁。

## Foliate / EPUB reader

EPUB / MOBI / AZW3 / FB2 reader 使用 Readest fork `foliate-js`，依赖锁定在 `github:readest/foliate-js#1fc763b8e6afe10971043a6818dcb9e2d8c54f4a`。不要把 `foliate-js` 改回上游，也不要在 Omni Lingo 外层手写章节拼接；跨章节滚动依赖 fork 的连续 `flow="scrolled"` renderer。

`wxt.config.ts` 会复制 `node_modules/foliate-js` 运行时文件到 `/foliate/web/foliate-js/`，并通过 `scripts/foliate-runtime-patches.ts` 做构建期 patch，包括 iframe sandbox 兼容、Readest fork paginator 兼容和 pages 双页章节首页对齐等。改 Foliate runtime 行为时，改 patch 管线和 `scripts/foliate-runtime-patches.test.js`，不要改 `node_modules/foliate-js` 或 `.output/`。

当前 Foliate reader UI 行为：

- sidebar 支持 overlay / pinned(docked) 两种状态。桌面 pinned 时侧栏成为布局左列，正文和 hover chrome 在右列；sidebar 宽度可拖拽并持久化，visible 不持久化。窄屏保持 overlay 抽屉，不提供横向拖拽。
- sidebar 顶部保留 toggle 和 pin/unpin；下面显示书籍封面、标题、作者和详情按钮。无封面时不显示封面区域；详情 modal 只读展示 Metadata / Series / Description。
- TOC 支持卷折叠和起始页码，normalize / 页码 hydration / 展开路径在 `reader-toc.tsx`。overlay 模式下导航可自动收起；pinned 模式保持打开。
- 固定顶栏已改成 Readest 式正文 hover chrome：常态顶部显示当前章节名、底部空白；鼠标进入顶部区域时显示书名和 pages / scroll 模式切换、reader 外观按钮；鼠标进入底部区域时显示上一章节 / 下一章节按钮。
- pages 模式左右空白区有 hover 翻页按钮；滚轮翻页只在 pages 模式启用，`scroll` 模式交给 Foliate 原生连续滚动。
- scroll 模式隐藏 Foliate 原生滚动条，并使用 reader-local overlay scrollbar。滚动后只显示滑块，滑块可见时 hover 右侧展开完整滚动条和上下按钮；pages 模式不启用 overlay scrollbar。
- 顶栏 reader 外观弹窗 UI 在 `reader-appearance-panel.tsx`，书籍详情 modal 的折叠 section UI 在 `reader-book-details.tsx`；不要把新的纯展示 JSX 堆回 App。
- 脚注 / 尾注点击由 `foliate-js/footnotes.js` 的 `FootnoteHandler` 和本地启发式接管，优先在当前位置弹出只读 popup，识别失败才回退到原链接跳转。

Foliate reader 外观设置只包含：

- 字号：默认 16px，范围和规范化在 `src/lib/foliate-reader-settings.ts`；
- 行距：默认 1.4；
- 首行缩进：开启时使用 2em；
- Use Book Layout：保留书内段落版式，只锁行距和首行缩进，字号仍可调整。

不提供 reader 字体选择，也不要恢复已移除的 `foliateReaderFontFamily`。Options 的 File Plus 和 Foliate viewer 顶栏设置共用同一组存储字段。Foliate viewer 内修改设置时需要通过 `reader-content-style.ts` 的 `renderer.setStyles()` 和已加载文档 CSS 注入即时生效，不应要求刷新 tab。

`reader-content-style.ts` 负责：

- 生成当前主题和外观设置对应的 reader CSS；
- 给 Foliate paginator 提供 `--theme-bg-color`、`--theme-fg-color` 和 `--override-color:true`，避免主题切换后 pages gutter 继续使用旧章节背景缓存；
- 在 `book.transformTarget` 上预处理书内 CSS / HTML，移除 `res:///` / `file:///` 本地字体，转换硬编码字号，替换 viewport units，撤销 `user-select:none`；
- 限制 pages 模式封面 / 全页图片高度，避免和 reader chrome 重叠；
- 已打开内容 iframe 通过 `applyFoliateContentCss()` 同步样式，新加载章节通过 `bridge.ts` load / relocate 继续绑定。

Reader UI 控件、sidebar、详情 modal、脚注 popup、overlay scrollbar 等都必须标记或继承 `data-omni-lingo-reader-ui` 边界。hover、selection、滚轮翻页和正文点击取消选中都要避开这些 UI 区域。

## Reader 翻译

普通网页、PDF reader、EPUB reader 要尽量共享行为：

- selection UI 走 `src/features/selection/`，不要在 reader 里复制一套“译”按钮逻辑。
- PDF reader 通过 `src/entrypoints/pdf/bridge.ts` 调用 `initHover()` 和 `initSelection()`，并实现 `readPageFeatureStatus` / `updatePageFeaturePrefs`。
- PDF hover 与普通网页共用 `src/features/hover/`。在顶层官方 PDF.js viewer 下，这套通用 hover 已验证可与 Less Translate 保持同等精度；不要为了 PDF 单独恢复 token split、overlay underline 或改写 textLayer DOM。PDF.js 的双击选词和浏览器原生选区依赖原始 textLayer 结构，所以仍然不要包 `all: unset` wrapper / token span。
- Foliate reader 因内容在 `foliate-view` 载入的 iframe 文档中，需要 `src/entrypoints/foliate/bridge.ts` 在文档生命周期里转接 hover / selection。当前 hover 已复用 `src/features/hover/` 的共享 controller；bridge 只保留 `load` / `relocate` 绑定和文档级样式同步。
- reader UI 元素要标记 `data-omni-lingo-reader-ui`，hover / selection 命中测试必须避开工具栏、侧栏、弹层和菜单。

修改 selection 行为时，先改 `src/features/selection/` 的共享路径，再检查普通网页、PDF reader、EPUB reader 三处是否同样生效。

## 文件链接嗅探

文件链接嗅探有两层，缺一层都会出现行为差异：

- content script：`src/features/document-sniffer.ts` 拦截普通网页中的 `<a href="...pdf|epub">` 点击。仅在不保留原页面且不独立窗口时，PDF 直接跳到 `/pdf/web/viewer.html?file=...`，EPUB 直接跳到 `/foliate/web/viewer.html?file=...`，未知格式才跳到 `/viewer.html?url=...`。
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
- PDF 官方 viewer 通过 URL hash 的 `locale` 初始化语言；`src/lib/document-viewer-urls.ts` 负责把 Omni Lingo `uiLang` 映射到 PDF.js locale。已打开 PDF tab 会继续同步 `lang` / `dir`，但官方 viewer 文案不会热切换，刷新后生效。

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
- EPUB viewer 自身由 `/foliate-viewer.js` 初始化主题；EPUB 内容文档通过 `src/entrypoints/foliate/bridge.ts` 监听主题 / 设置变化，并用 `reader-content-style.ts` 注入 `omni-lingo-foliate-theme`。

修主题 bug 时要检查已打开的 PDF / EPUB tab，无需刷新 tab 就应该响应主语言和主题切换。Foliate pages 模式还有 paginator `#background` 段；如果正文和 UI 已变色但左右 gutter 没变，优先检查 `foliate-view.renderer.shadowRoot.querySelector("#background")` 的子节点背景，以及内容 CSS 是否仍包含 `--override-color:true`。

## 验证建议

改 reader 或 sniffer 后至少考虑：

- options 本地选择一个小 PDF；
- options URL 输入直接 PDF，例如 `https://arxiv.org/pdf/...`；
- URL 输入 HTML shell，例如 `https://lesstranslate.com/pdf.html`；
- 页面内点击 PDF / EPUB 链接；
- 地址栏输入 PDF URL，分别测试只嗅探、保留原页面、独立窗口；
- PDF reader 内 hover / selection；
- Foliate reader 内 hover / selection；
- Foliate pages / scroll 模式切换、滚轮翻页、左右页边翻页、overlay scrollbar；
- Foliate sidebar overlay / pinned / 拖宽、TOC 折叠页码、书籍详情 modal；
- Foliate 脚注 / 尾注 popup；
- Foliate reader 外观设置：字号、行距、首行缩进、Use Book Layout，在已打开 tab 内即时生效；
- 已打开 reader tab 时切换主题和主语言。

常规命令：

```powershell
bun run i18n:generate
bun test .\src\lib\i18n\index.test.js
bun test .\src\entrypoints\foliate\reader-content-style.test.js
bun test .\src\entrypoints\foliate\reader-settings.test.js
bun test .\src\entrypoints\foliate\wheel-turns.test.js
bun test .\src\entrypoints\foliate\footnote-popup.test.js
bun test .\src\entrypoints\foliate\reader-scrollbar.test.js
bun run compile
bun run build
```

