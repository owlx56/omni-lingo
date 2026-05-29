# Agent Guidelines

这份文档保存 OneLingo 的长期工程规则。根目录 `AGENTS.md` 只保留短入口和硬约束。

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
CSS.highlights.set("onelingo-hover", new Highlight(range));
```

不要用 `<mark>` 或 wrapper `<span>` 做悬停下划线。包宿主 DOM 会破坏选区、事件委托和宿主框架的 DOM diff。Firefox 可降级到 overlay。

### 消息通道

background / content / options / popup 的消息全部走 `src/lib/messaging/`。业务代码不要直接调用 raw `browser.runtime.sendMessage`。

### Options / Popup UI

options 和 popup 使用 Solid，但通用控件必须优先复用 `src/lib/ui/controls.tsx` 和 `src/lib/ui/controls.css`。不要在 entrypoint 内各自复制 Select、Switch、Segment、Row 等样式。

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

- PDF reader 使用 GitHub release 的 `pdfjs-*-dist.zip` 作为唯一 PDF.js 上游来源；通过 `bun run pdfjs:update -- --version <version>` 重建 `src/assets/pdf-viewer/upstream/`，构建时由 `wxt.config.ts` 复制并注入 OneLingo bridge。不要手改 upstream 或 `.output/`。
- PDF 内置 viewer 必须保持官方 PDF.js `viewer.html` / `viewer.js` / `viewer.css` 的布局和 textLayer 环境，避免自定义 `PDFViewer` 外壳导致双击选词边界和 hover 精度偏移。
- PDF hover 默认直接复用 `src/features/hover/` 的通用逻辑。遇到 PDF hover 精度问题，先检查是否仍在顶层官方 viewer 里运行，再检查 reader UI 边界和 textLayer 命中；不要先验地恢复 PDF-specific hover 分支。
- EPUB 主路径使用 `epubjs`，reader shell 公开为 `/epub/web/viewer.html`，实现放在 `src/entrypoints/epub/App.tsx`，iframe 内容桥接在 `src/entrypoints/epub/bridge.ts`；hover 编排优先复用 `src/features/hover/`，bridge 只保留 iframe 文档绑定和坐标转换。
- `/viewer.html` 只作为兼容路由和 HTML shell 探测入口；不要把 EPUB UI 或 PDF 自定义 viewer 重新塞回这里。
- reader 内 selection 行为必须复用 `src/features/selection/`。未来改 selection 功能时，普通网页、PDF reader、EPUB reader 应尽量同时生效。
- reader UI 控件必须标记或继承 `data-onelingo-reader-ui` 边界，hover / selection 不应命中工具栏、侧栏、菜单、对话框。
- 打开文件链接嗅探同时涉及 content script 点击拦截和 background DNR / webRequest 主框架嗅探。修其中一个前先确认另一个是否也需要同步。

### 存储

遵守当前存储边界：

| 数据                         | 存储                           |
| ---------------------------- | ------------------------------ |
| 跨设备配置                   | `storage.sync`                 |
| 本机配置                     | `storage.local`                |
| 翻译缓存                     | 内存 LRU + IndexedDB           |
| reader 临时文档              | viewer 页面 IndexedDB `onelingo-docs` |
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
