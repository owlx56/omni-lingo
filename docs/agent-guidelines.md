# Agent Guidelines

这份文档保存 Omni Lingo 的长期工程规则。根目录 `AGENTS.md` 只保留短入口和硬约束。

## 核心决策

### 热路径保持 Vanilla

热路径是每秒可能触发很多次的代码：

- `mousemove` / `mouseover`
- `MutationObserver` 回调
- 全文翻译 DOM 遍历
- 悬停识别、dwell timer、词边界计算

这些路径必须使用 vanilla TypeScript 和直接 DOM API。不要引入 Solid signals、store 或 `createEffect`。

交互路径不同：Rich 卡片、悬浮球、设置面板、options 页、viewer 页和 PDF / 文件翻译 UI 可以使用 Solid，并挂在 closed Shadow DOM 下；扩展页面自身如 options / popup / viewer 不需要 Shadow DOM。

### Minimal 和 Rich 是两种交互模型

Minimal 翻译是 vanilla DOM，只展示译文。Rich 翻译是 Solid UI，包含发音、例句、按钮和更多控制。两者可以共享定位、边界检测、dwell、dismiss 逻辑，但不要共享渲染内部实现。

### Rust/WASM 门槛

默认使用 TypeScript。只有满足下面至少一项时才考虑 WASM：

- JS 生态没有可靠方案，例如 MOBI 解析；
- 数据规模让 TS 明显吃力，例如术语超过约 1000 条；
- 成熟 Rust crate 有明显优势，例如 StarDict/MDX + FST 词典。

不要用 WASM 做文本分段、语言检测、SRT/VTT 解析。

### 文本分段

使用 `Intl.Segmenter`。缩写、URL、代码片段等保护规则用小段 TypeScript 补丁处理。

### 悬停下划线

使用 CSS Custom Highlight API：

```ts
CSS.highlights.set("omni-lingo-hover", new Highlight(range));
```

不要用 `<mark>` 或 wrapper `<span>` 做悬停下划线。包宿主 DOM 会破坏选区、事件委托和宿主框架的 DOM diff。Firefox 可降级到 overlay。

### 消息通道

background / content / options / popup 的消息全部走 `src/lib/messaging/`。业务代码不要直接调用 raw `browser.runtime.sendMessage`。

### Options / Popup UI

options 和 popup 使用 Solid，但通用控件必须优先复用 `src/lib/ui/controls.tsx` 和 `src/lib/ui/controls.css`。不要在 entrypoint 内各自复制 Select、Switch、Segment、Row 等样式。

options / popup 的入口文件只保留状态、消息调用和保存逻辑。页面专属的组件组合放在同目录小模块：

- options：`options-components.tsx` 放 sidebar / swatch / stepper，`options-model.ts` 放 tab 和 select/segment 静态配置；
- popup：`popup-components.tsx` 放 provider mark / switch row / AI config card，`popup-options.ts` 和 `popup-language-options.ts` 放语言选项和 command source 转换。

options、popup、viewer 共用的图标必须放在 `src/lib/ui/icons.tsx`。新增按钮图标、侧栏图标、主题图标、reader 图标时，先扩展这里，再从 entrypoint 引用；不要在 options / popup / Foliate JSX 里临时塞一份 inline SVG。当前图标风格以 Lucide / Claude 式细线、圆角、`currentColor` 为基准。

下拉菜单遵守当前 Claude/Gemini 风格约定：

- 触发按钮扁平、无边框；
- popover 自己承担淡边框、柔和阴影、圆角和 `overflow-y-auto`；
- 选中项右侧显示 check；
- 选项行要有足够上下留白和 line-height，不能裁掉下伸字母；
- 选项很多时必须保留细滚动条。

### UI i18n

options / popup / EPUB viewer / PDF viewer 的界面文案都走 `src/lib/i18n/catalog.ts`，不要在组件或静态 viewer 里硬编码可见字符串。新增文案时：

1. 在 `src/lib/i18n/catalog.ts` 增加英文 key 和需要的语言覆盖；
2. 在组件里通过 `t("namespace.key")` 读取；
3. 如果是 PDF 静态 viewer 文案，使用 `pdfViewer.*` key；
4. 跑 `bun run i18n:generate` 生成 `locales/*.ts` 和 `src/assets/pdf-viewer/locales.generated.mjs`；
5. 跑 `bun test src/lib/i18n/index.test.js` 检查语言结构和 viewer 文案覆盖。

`src/lib/i18n/messages.ts`、`src/lib/i18n/locales/*.ts`、`src/lib/i18n/locales/index.ts` 和 `src/assets/pdf-viewer/locales.generated.mjs` 都是从 catalog 派生的类型 / 兼容 / 静态资源产物，不要手改。

语言列表只在 `src/lib/languages.ts` 维护。语言下拉选项显示 `UI_LANG_LABELS`，必须用每种语言自己的文字，不要翻译成当前 UI 语言。

### PDF / EPUB Reader

文档阅读器边界见 `docs/document-viewer.md`。简要规则：

- PDF reader 使用 `@omni-lingo/pdfjs-dist` 私有 Git 依赖提供官方 GitHub release `pdfjs-*-dist.zip` 的展开内容；当前锁定 `git@github.com:owlx56/pdfjs-dist.git#v5.7.284`，依赖根目录是包壳，官方 release dist 在 `dist/build/`、`dist/web/`、`dist/LICENSE`。不要手改已安装依赖或 `.output/`。
- PDF 内置 viewer 必须保持官方 PDF.js `viewer.html` / `viewer.js` / `viewer.css` 的布局和 textLayer 环境，避免自定义 `PDFViewer` 外壳导致双击选词边界和 hover 精度偏移。
- PDF hover 默认直接复用 `src/features/hover/` 的通用逻辑。遇到 PDF hover 精度问题，先检查是否仍在顶层官方 viewer 里运行，再检查 reader UI 边界和 textLayer 命中；不要先验地恢复 PDF-specific hover 分支。
- EPUB 主路径现已切到 Readest fork `foliate-js`，reader shell 公开为 `/foliate/web/viewer.html`，实现放在 `src/entrypoints/foliate/App.tsx`，内容桥接在 `src/entrypoints/foliate/bridge.ts`；hover 编排优先复用 `src/features/hover/`，bridge 只保留文档生命周期绑定和坐标转换。连续滚动依赖 fork 的 scrolled renderer，不在 Omni Lingo 外层手写章节拼接。
- Foliate runtime 从 `node_modules/foliate-js` 复制到扩展 public assets，并由 `scripts/foliate-runtime-patches.ts` 做构建期 patch。改 paginator / iframe sandbox / runtime asset 行为时改 patch 管线和测试，不要手改 `node_modules/` 或 `.output/`。
- Foliate reader 的阅读外观设置只包含字号、行距、首行缩进、Use Book Layout。默认字号按 Readest 16px；Use Book Layout 保留书籍段落版式，只锁行距和首行缩进，不锁字号；不提供 reader 字体选择。
- Foliate 内容样式集中在 `src/entrypoints/foliate/reader-content-style.ts`。这里负责 `renderer.setStyles()`、已加载 iframe CSS 同步、书内 CSS/HTML transform、去掉本地字体 URL、把硬编码字号转成可随 reader 字号缩放的单位，以及给 paginator 提供主题背景变量。主题 / 字号 / 行距 / 首行缩进修改应在已打开 reader tab 内即时生效。
- Foliate reader 的 sidebar、hover chrome、页边翻页、滚轮翻页、overlay scrollbar、footnote popup 都有本地 helper 和测试；改对应行为时优先补 / 更新 `src/entrypoints/foliate/*test.js`，不要把新逻辑堆回 `App.tsx`。
- Foliate App 只负责编排 reader 状态和 `foliate-view` 生命周期。TOC normalize / hydration 在 `reader-toc.tsx`，reader 外观弹窗在 `reader-appearance-panel.tsx`，书籍详情 section 在 `reader-book-details.tsx`；新增同类 UI/纯逻辑时继续放到 `reader-*` 模块。
- `/viewer.html` 只作为兼容路由和 HTML shell 探测入口；不要把 EPUB UI 或 PDF 自定义 viewer 重新塞回这里。
- reader 内 selection 行为必须复用 `src/features/selection/`。未来改 selection 功能时，普通网页、PDF reader、EPUB reader 应尽量同时生效。
- reader UI 控件必须标记或继承 `data-omni-lingo-reader-ui` 边界，hover / selection 不应命中工具栏、侧栏、菜单、对话框。
- 打开文件链接嗅探同时涉及 content script 点击拦截和 background DNR / webRequest 主框架嗅探。修其中一个前先确认另一个是否也需要同步。

### 存储

遵守当前存储边界：

| 数据                         | 存储                           |
| ---------------------------- | ------------------------------ |
| 跨设备配置                   | `storage.sync`                 |
| 本机配置                     | `storage.local`                |
| 翻译缓存                     | 内存 LRU + IndexedDB           |
| reader 临时文档              | viewer 页面 IndexedDB `omni-lingo-docs` |
| 生词本、术语、长期文件结果   | 通过 background 访问 IndexedDB |

background 是 MV3 service worker，随时可能被杀。持久状态必须可恢复。

## 浏览器拓展陷阱

- background 没有 `window`、DOM、`localStorage`。
- content script 运行在 isolated world，不能直接读页面全局变量。
- 注入 UI 放在 closed Shadow DOM 下；需要的 CSS / 字体要显式注入。
- 跨域请求走 background。
- 流式引擎调用要处理 tab 关闭、用户滚走、网络中断。

## TypeScript 和文件

- 项目启用 `strict` 和 `noUncheckedIndexedAccess`。
- 导出 API 显式写返回类型。
- 不用 `any`；不确定类型用 `unknown` + 类型守卫。
- 优先用字面量联合类型或 `as const` object，不用 `enum`。
- 入口和纯逻辑用 `*.ts`；有 JSX 才用 `*.tsx`。
- 一个文件一个主职责。
- 注释解释“不明显的原因”，不要复述代码。

## 冗余和生成产物

删除代码前必须同时满足这些条件：

- 无引用，且不是 WXT / browser extension 入口约定；
- 不承担旧 URL、旧 storage、旧消息协议或跨浏览器兼容职责；
- 没有测试、构建脚本或静态 public asset 复制流程依赖；
- 不是 i18n / PDF viewer / Foliate runtime 的生成产物。

不确定的兼容分支不要删，改为补一行保留原因或同步到文档。确认重复的基础能力优先抽到现有共享模块：`src/lib/number.ts`、`src/lib/guards.ts`、`src/lib/idb.ts`、`src/lib/dom-attrs.ts`、`src/lib/ui/controls.tsx`、`src/lib/ui/icons.tsx`。只有存在两个以上真实消费者，或重复逻辑已经影响一致性，才新增共享 helper；不要为了“以后可能用”预留导出。

这些文件/目录不要手改：`node_modules/`、`.output/`、`src/lib/i18n/locales/*.ts`、`src/lib/i18n/locales/index.ts`、`src/lib/i18n/messages.ts`、`src/assets/pdf-viewer/locales.generated.mjs`、PDF.js / Foliate 构建复制后的 public assets。需要改变生成产物时，改源文件或脚本再运行对应生成命令。

## 依赖

加依赖前先问。优先用浏览器原生 API 和标准库。Solid 只放在 UI 区域，不混 React。

## 目录边界

| 目录            | 负责                         | 不负责                    |
| --------------- | ---------------------------- | ------------------------- |
| `src/features/` | 业务行为                     | UI 挂载 / Shadow DOM 容器 |
| `src/ui/`       | Solid 组件和 Shadow DOM 挂载 | 业务规则                  |
| `src/engines/`  | 引擎请求和响应归一化         | 缓存 / 去重               |
| `src/lib/`      | 基础设施                     | 产品功能策略              |

## 协作

- 单次改动聚焦一个目标。
- 编辑前读附近代码。
- 先匹配现有风格，再考虑抽象。
- 不要顺手重命名、重排格式或抽取无关代码。
- 做 review 时先列具体风险和文件行号。
- 维护者要求回退某个决策时，按要求改。

