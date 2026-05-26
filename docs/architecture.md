# Architecture

这份文档描述当前代码布局。边界变化时同步更新这里。

## 技术栈

- WXT：拓展构建和 manifest 生成。
- Bun：包管理和脚本执行。
- TypeScript：功能和基础设施代码。
- Solid：只用于交互 UI。
- Vanilla TypeScript：用于热路径和宿主页面 DOM 操作。
- pdfjs-dist：PDF 渲染和 PDF.js viewer 基础能力，构建时复制到扩展 public assets。
- epubjs：EPUB 渲染。

## 顶层流向

```text
src/entrypoints/
  background.ts  -> 消息处理、引擎调用、缓存访问
  content.ts     -> content script bootstrap
  pdf-bridge.ts  -> PDF.js reader 内 hover / selection / theme 桥接
  popup/         -> popup UI
  options/       -> options UI
  viewer/        -> PDF / EPUB 阅读器壳和 EPUB bridge

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
  document-store.ts -> viewer 页面 IndexedDB 文档暂存
  languages.ts   -> UI 语言 / 目标语言常量和类型
  translation-style.ts -> 全文译文样式解析和默认值

src/engines/     -> 翻译引擎适配
src/ui/          -> Solid UI 和 Shadow DOM 挂载辅助
src/assets/
  fonts/inter/   -> options / popup / viewer 使用的打包 Inter 字体
  pdf-viewer/    -> OneLingo PDF.js 静态 viewer shell、样式和生成 locale
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
- `/viewer.html` reader 壳；
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

## PDF / EPUB Reader

阅读器详细边界见 [document-viewer.md](document-viewer.md)。当前实现分为两层：

- `/viewer.html`：Solid reader 壳，处理本地文件 key、远程 URL、sniffer 消费、主题 / 语言同步、PDF iframe 或 EPUB rendition 分发。
- `/pdf/web/viewer.html`：构建时公开的 PDF.js reader。HTML / JS / CSS 在 `src/assets/pdf-viewer/`，PDF.js runtime 来自 `pdfjs-dist`。

PDF 打开路径：

```text
/viewer.html?key=... or ?url=...
  -> ArrayBuffer / IndexedDB
  -> Blob URL
  -> iframe /pdf/web/viewer.html?file=blob:
  -> src/entrypoints/pdf-bridge.ts 在 PDF frame 内初始化 hover / selection
```

EPUB 打开路径：

```text
/viewer.html?key=... or ?url=...
  -> ArrayBuffer / IndexedDB
  -> epubjs renderTo(#epub-render)
  -> epub-bridge.ts 绑定 EPUB iframe 内容文档
```

文件链接嗅探：

- `src/features/document-sniffer.ts`：普通网页内点击 PDF / EPUB 链接时的 content script 拦截。
- `src/entrypoints/background.ts`：地址栏和主框架导航，使用 DNR / webRequest，根据 URL 扩展名或 response content-type 跳转到 reader。
- `documentLinkSniffKeepOriginal` 会打开 reader 新 tab，并给原 tab 临时安装 allow rule 放行原 PDF 页面。
- `documentLinkSniffStandalone` 才使用 popup window；普通保留原页面必须是新 tab。

构建资产由 `wxt.config.ts` 的 `build:publicAssets` 复制。不要编辑 `.output/`，不要把 `node_modules/pdfjs-dist` 的完整产物复制进源码。

## 全文翻译 Immersive

`src/features/immersive/` 按职责拆分：

| 文件           | 负责                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| `index.ts`     | 会话状态、命令处理、observer 创建、rescan 队列、翻译 batching、wrapper 状态、恢复流程 |
| `scan.ts`      | DOM 发现、`ScanContext`、忽略判断、block / visibility 分类、扫描期规则样式            |
| `markup.ts`    | 序列化、占位符、rich HTML 恢复、译文 markup 插入                                      |
| `rules.ts`     | 默认 / 站点规则、规则匹配、规则解析                                                   |
| `selectors.ts` | 安全 selector helper                                                                  |
| `dom-attrs.ts` | 共享 `data-onelingo-*` wrapper 属性名                                                 |

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
