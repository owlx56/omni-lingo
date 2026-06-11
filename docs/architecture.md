# Architecture

这份文档描述当前代码布局。边界变化时同步更新这里。

## 技术栈

- WXT：拓展构建和 manifest 生成。
- Bun：包管理和脚本执行。
- TypeScript：功能和基础设施代码。
- Solid：只用于交互 UI。
- Vanilla TypeScript：用于热路径和宿主页面 DOM 操作。
- PDF.js release dist：PDF 渲染和官方 viewer 基础能力，由 `@omni-lingo/pdfjs-dist` 私有 Git 依赖提供。该自建仓库同步 Mozilla GitHub release 的 `pdfjs-*-dist.zip` 展开内容，Omni Lingo 通过 Bun/Git 依赖锁定到具体 tag，构建时复制到扩展 public assets。当前依赖是 `git@github.com:owlx56/pdfjs-dist.git#v5.7.284`，安装后包根目录是 package shell，官方 release dist 在 `dist/`。
- foliate-js：EPUB / MOBI / AZW3 / FB2 渲染，当前使用 Readest fork `github:readest/foliate-js#1fc763b8e6afe10971043a6818dcb9e2d8c54f4a`，以获得连续 scrolled renderer 和 Readest paginator 行为。

## 顶层流向

```text
src/entrypoints/
  background.ts  -> 消息处理、引擎调用、缓存访问
  content.ts     -> content script bootstrap
  pdf-viewer.ts  -> 输出 /pdf-viewer.js 的薄入口
  pdf/           -> PDF.js reader 内 hover / selection / theme 桥接
  foliate-viewer.ts -> 输出 /foliate-viewer.js 的薄入口
  foliate/       -> Foliate reader UI 和内容桥接
  popup/         -> popup UI
  options/       -> options UI
  viewer/        -> /viewer.html 兼容路由和 HTML shell 探测

src/features/
  hover/         -> 悬停识别、Highlight API 下划线、Minimal tooltip 流程
  selection/     -> 划词交互和卡片触发
  immersive/     -> 全文翻译
  document-sniffer.ts -> 页面内 PDF / EPUB 链接点击嗅探
  document-viewer/ -> 早期解析型 reader 的文档类型、source 推断和 EPUB 解析 helper

src/lib/
  messaging/     -> 类型安全的 background/content/options 消息
  storage/       -> 设置和持久化辅助
  cache/         -> 翻译缓存基础设施
  i18n/          -> options / popup / EPUB / PDF viewer 多语言文案源与生成入口
  ui/            -> options / popup 共享控件原语
  number.ts      -> clamp / finite number helpers
  guards.ts      -> object / Element / closest target type guards
  idb.ts         -> IndexedDB request / transaction Promise wrappers
  dom-attrs.ts   -> 跨 hover / selection / reader 的 Omni Lingo UI 边界 attr
  foliate-reader-settings.ts -> EPUB reader 字号、行距、首行缩进、Use Book Layout 规范化和锁定规则
  document-store.ts -> viewer 页面 IndexedDB 文档暂存
  languages.ts   -> UI 语言 / 目标语言常量和类型
  translation-style.ts -> 全文译文样式解析和默认值

src/engines/     -> 翻译引擎适配
src/ui/          -> Solid UI 和 Shadow DOM 挂载辅助
src/assets/
  fonts/inter/   -> options / popup / viewer 使用的打包 Inter 字体
  pdf-viewer/    -> 生成的 PDF reader 静态语言包
  foliate-viewer/   -> EPUB viewer 静态 shell，构建时复制到 /foliate/web/
scripts/
  generate-i18n.ts -> 从 catalog 生成 locale wrapper 和 PDF viewer locale
```

## 运行时边界

热路径不进入框架响应式系统：

- 指针追踪；
- selection / hover 命中测试；
- `MutationObserver` 回调；
- 全文翻译 DOM 扫描；
- 译文 wrapper 插入和恢复。

交互 UI 可以使用 Solid：

- popup 和 options 页；
- `/viewer.html` reader 兼容路由壳；
- Rich 翻译卡片；
- 悬浮控制；
- 设置界面。

这个边界很重要：content script 的热路径运行在任意宿主页面里，不能引入响应式框架开销。

## 消息通道

所有拓展消息走 `src/lib/messaging/`。协议类型集中在那里，background、content、popup、options 在编译期对齐。

业务代码调用 `sendMessage` / `onMessage`，不要直接调用 runtime messaging。

reader 也遵守同一条消息边界。PDF reader 和 EPUB bridge 需要读写页面功能状态时，实现 / 调用 `readPageFeatureStatus`、`updatePageFeaturePrefs`；翻译请求仍走 `translate` / `translateBatch`。

## 设置、语言和 UI 文案

设置统一从 `src/lib/storage/settings.ts` 读写。`uiLang` 是 options / popup 的界面语言；hover、selection、immersive 的目标语言默认与它一致，用户修改某个功能目标语言后该功能独立保存。

语言列表集中在 `src/lib/languages.ts`：

- `UI_LANGS` 是 options / popup 支持的 18 种界面语言；
- `TARGET_LANGS` 与 `UI_LANGS` 相同，用于功能目标语言；
- `UI_LANG_LABELS` 必须使用每种语言自己的字符展示，例如 `English`、`简体中文`、`日本語`、`العربية`。

UI 文案在 `src/lib/i18n/`：

- `catalog.ts` 是唯一人工维护源，包含 key、英文基线和各语言覆盖；
- `messages.ts` 只导出类型和模板格式化 helper；
- `locales/*.ts` 和 `locales/index.ts` 是从 catalog 生成的兼容入口；
- `src/assets/pdf-viewer/locales.generated.mjs` 是从 catalog 生成的静态 PDF viewer 语言包；
- 非英文语言缺失 key 时在 catalog 导出阶段回退英文。

新增 options / popup / EPUB / PDF viewer 文案时，先改 `catalog.ts`，PDF 静态 reader 使用 `pdfViewer.*` key，然后运行 `bun run i18n:generate` 和 `bun test src/lib/i18n/index.test.js`。

`wxt.config.ts` 会 import `scripts/generate-i18n.ts`，构建前自动刷新生成产物；日常改文案仍应显式运行 `bun run i18n:generate`，让 diff 可见、测试可控。

## 共享设置 UI

options 和 popup 的通用控件放在 `src/lib/ui/controls.tsx`，样式放在 `src/lib/ui/controls.css`。当前包含 Row、FullRow、Switch、Select、Segment、IconSegment。

改下拉菜单、开关、色板、分段按钮时优先改共享控件，避免 options 和 popup 样式漂移。Select 的触发按钮保持无边框的扁平样式，下拉菜单负责边框、阴影、圆角和滚动条；选项文本需要足够 line-height，避免 `g`、`y`、`p` 等下伸字母被裁切。

共享图标放在 `src/lib/ui/icons.tsx`，options 侧栏、popup、主题 Sun/Moon/System、Foliate 顶栏 / 侧栏按钮都从这里引用。新增图标时优先保持 Lucide / Claude 式 `currentColor` 线性风格；不要在单个 entrypoint 内复制 SVG。

entrypoint-local UI 只保留当前页面专属组合，不复制基础控件：

- `src/entrypoints/options/options-components.tsx`：options sidebar、颜色 swatch 行、number stepper；
- `src/entrypoints/options/options-model.ts`：options tab、engine、select、segment 等静态配置；
- `src/entrypoints/popup/popup-components.tsx`：popup header action、switch row、provider mark、AI config card；
- `src/entrypoints/popup/popup-options.ts` / `popup-language-options.ts`：popup target/source 语言和 command source 转换。

## PDF / EPUB Reader

阅读器详细边界见 [document-viewer.md](document-viewer.md)。当前实现分为三个公开入口：

- `/viewer.html`：Solid 路由壳，处理本地 key、远程 URL 和 HTML shell 探测；最终转到 PDF 或 EPUB viewer。
- `/pdf/web/viewer.html`：构建时公开的顶层 PDF.js reader。HTML / JS / CSS / runtime 都来自已安装的 `@omni-lingo/pdfjs-dist` Git 依赖，也就是同一个 GitHub release dist。
- `/foliate/web/viewer.html`：构建时公开的 Omni Lingo Foliate reader shell。HTML / CSS 来自 `src/assets/foliate-viewer/`，运行时由 `/foliate-viewer.js` 挂载 `src/entrypoints/foliate/`。

PDF 打开路径：

```text
local key or direct URL
  -> /pdf/web/viewer.html?file=... or ?omni-lingo-key=...
  -> src/entrypoints/pdf/bridge.ts 在顶层 PDF.js viewer 内初始化 hover / selection
```

EPUB 打开路径：

```text
/foliate/web/viewer.html?omni-lingo-key=... or ?file=...
  -> ArrayBuffer / IndexedDB
  -> foliate-view open(file)
  -> src/entrypoints/foliate/bridge.ts 绑定内容文档
```

Foliate reader 当前由一个 Solid shell 和多个 reader-local helper 组成：

| 文件 | 负责 |
| --- | --- |
| `src/entrypoints/foliate/App.tsx` | reader shell、文件打开、sidebar / chrome / settings UI 编排 |
| `src/entrypoints/foliate/bridge.ts` | `foliate-view` load / relocate 生命周期、hover / selection 文档绑定、主题和 reader CSS 同步 |
| `src/entrypoints/foliate/reader-content-style.ts` | `renderer.setStyles()`、已加载 iframe CSS 注入、书内 CSS/HTML transform、主题背景变量 |
| `src/entrypoints/foliate/reader-settings.ts` | 从 `src/lib/foliate-reader-settings.ts` 复用 reader 外观设置规范 |
| `src/entrypoints/foliate/reader-chrome.ts` | Readest 式顶部 / 底部 hover chrome 状态 |
| `src/entrypoints/foliate/reader-layout.ts` | pages / scroll 模式下 renderer 纵向留白和 chrome 空间 |
| `src/entrypoints/foliate/reader-toc.tsx` | TOC normalize、起始页码 hydration、展开路径和递归节点 |
| `src/entrypoints/foliate/reader-appearance-panel.tsx` | viewer 顶栏 reader 外观弹窗 |
| `src/entrypoints/foliate/reader-book-details.tsx` | 书籍详情 modal 内的折叠 metadata/series/description section |
| `src/entrypoints/foliate/reader-page-turn.ts` | pages 模式左右页边 hover 翻页区域 |
| `src/entrypoints/foliate/wheel-turns.ts` | pages 模式滚轮翻页步进和导航队列 |
| `src/entrypoints/foliate/reader-scrollbar.ts` | scroll 模式自绘 overlay scrollbar 状态机 |
| `src/entrypoints/foliate/footnote-popup.ts` | Readest 式脚注 / 尾注弹窗和 footnote renderer 配置 |

Foliate runtime asset 由 `wxt.config.ts` 从 `node_modules/foliate-js` 复制到 `/foliate/web/foliate-js/`。涉及 paginator、iframe sandbox、连续滚动或 public asset 的改动，走 `scripts/foliate-runtime-patches.ts` 和 `scripts/foliate-runtime-patches.test.js`；不要直接编辑安装依赖或 `.output/`。

文件链接嗅探：

- `src/features/document-sniffer.ts`：普通网页内点击 PDF / EPUB 链接时的 content script 拦截。
- `src/entrypoints/background.ts`：地址栏和主框架导航，使用 DNR / webRequest，根据 URL 扩展名或 response content-type 跳转到 reader。
- `documentLinkSniffKeepOriginal` 会打开 reader 新 tab，并给原 tab 临时安装 allow rule 放行原 PDF 页面。
- `documentLinkSniffStandalone` 才使用 popup window；普通保留原页面必须是新 tab。

构建资产由 `wxt.config.ts` 的 `build:publicAssets` 复制。不要编辑 `.output/`，不要手改 `@omni-lingo/pdfjs-dist` 依赖包内容；缺失或需要升级 PDF.js assets 时，先更新自建 `@omni-lingo/pdfjs-dist` Git 仓库，再在 Omni Lingo 里更新依赖 tag 并运行 `bun install`。

## 全文翻译 Immersive

`src/features/immersive/` 按职责拆分：

| 文件           | 负责                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| `index.ts`     | 会话状态、命令处理、observer 创建、rescan 队列、翻译 batching、wrapper 状态、恢复流程 |
| `scan.ts`      | DOM 发现、`ScanContext`、忽略判断、block / visibility 分类、扫描期规则样式            |
| `markup.ts`    | 序列化、占位符、rich HTML 恢复、译文 markup 插入                                      |
| `rules.ts`     | 默认 / 站点规则、规则匹配、规则解析                                                   |
| `selectors.ts` | 安全 selector helper                                                                  |
| `dom-attrs.ts` | 共享 `data-omni-lingo-*` wrapper 属性名                                                 |
| `immersive-loading.ts` | loading skeleton 行数/宽度、CSS 变量保留和 style 注入                          |

### Immersive 流程

```text
popup/background command
  -> content immersive index.ts
  -> 解析 rule 并创建 observers
  -> scan.ts 发现候选 host nodes
  -> index.ts 对 child nodes 分组并批量翻译
  -> markup.ts 按引擎 format 序列化 nodes
  -> background translateBatch
  -> markup.ts 恢复占位符并插入 translation wrappers
```

### Immersive 不变量

- `scan.ts` 不读取 `currentRule`，也不读取 `index.ts` 的会话全局状态。
- `scan.ts` 通过 `ScanContext` 接收运行态。
- `collectNodeGroups`、`shouldBreakGroup`、`scheduleProcessNode` 留在 `index.ts`，因为它们属于翻译执行，不属于 DOM 发现。
- `markup.ts` 尽量保持纯转换 / 回填边界。
- loading skeleton 的 CSS 注入和纯宽度计算放在 `immersive-loading.ts`；不要把这类非会话状态辅助重新塞回 `index.ts`。
- 共享 wrapper 属性名放在 `dom-attrs.ts`，不要放在 scan 或 orchestration 文件里。

调试全文翻译 bug 时，先按 [immersive-debugging.md](immersive-debugging.md) 分层定位。优先修通用 DOM / 流水线问题，再考虑站点 rule，最后才写域名特例。

## 站点规则

全文翻译的站点行为配置在 `src/features/immersive/rules.ts`。优先用规则更新解决站点差异，只有 selector、style、rule flag 表达不了时才加代码分支。

## 存储

设置和持久领域数据走 `src/lib/storage/` 或 background 串行访问的 IndexedDB helper。翻译缓存按当前实现走内存 + IndexedDB。reader 临时文档走 `src/lib/document-store.ts` 的 viewer 页面 IndexedDB。不要依赖 background 内存跨 service worker 重启存活。

## 构建和验证

主要检查：

```powershell
bun run compile
bun run build
bun run i18n:generate
bun test .\src\lib\i18n\index.test.js
```

Windows 上如果 package-script shim 失败，直接通过 Bun 调本地工具：

```powershell
& 'C:\Users\owlx\scoop\shims\bun.exe' .\node_modules\typescript\bin\tsc --noEmit
& 'C:\Users\owlx\scoop\shims\bun.exe' .\node_modules\wxt\bin\wxt.mjs build
```

