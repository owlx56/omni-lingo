# OneLingo（一译）

一个跨平台、高性能的浏览器翻译拓展，支持 Chrome / Firefox / Safari。

## 核心决策（不要自作主张推翻）

### 1. 热路径绝不介入框架响应式系统

**热路径** = 每秒触发数十次以上的代码：

- `mousemove` / `mouseover` 处理
- `MutationObserver` 回调
- 沉浸翻译 DOM 遍历
- 悬停识别、dwell timer、词边界计算

这些必须是 **vanilla TS + 直接 DOM 操作**。不要引入 Solid signals、不要 `createEffect`、不要把状态放到响应式 store 里。

**交互路径** = 用户主动触发后才执行的代码：

- Rich 翻译卡片渲染
- 悬浮球、设置侧栏、options 页
- PDF 阅读器、文件翻译页

这些用 **Solid** 写。挂在 **closed Shadow DOM** 下，CSS 双向隔离。

两层通过极薄的 event / signal API 解耦。vanilla 层只发"显示卡片"命令，不关心 Solid 怎么渲染。

### 2. Minimal vs Rich 是两种独立的交互模型

不是同一 UI 的两套皮肤：

| 档      | 内容                   | 实现                    | 触发                                        |
| ------- | ---------------------- | ----------------------- | ------------------------------------------- |
| Minimal | 仅译文                 | vanilla TS，纯 DOM 拼接 | 悬停 200ms                                  |
| Rich    | 释义、发音、例句、按钮 | Solid                   | 悬停 Rich 档 / 划词移入 logo / Minimal 升级 |

两档**共享定位、边界检测、dwell、dismiss 逻辑**（在 `TooltipHost` 里），只换渲染层（`Renderer` 接口）。Solid 可动态 import，Minimal 用户不付其体积代价。

### 3. Rust/WASM 的门槛

**默认不用 WASM**。v1 全 TS。只有以下情况才加到 `onelingo-wasm` crate：

- JS 生态确实没有靠谱方案（MOBI 解析）
- 数据规模导致 TS 明显慢（术语 >1000 条才上 Aho-Corasick，否则 TS Trie 就够）
- 成熟 Rust crate 有显著优势（StarDict/MDX + FST 词典）

**不该用 WASM 的地方**：文本分段（用 `Intl.Segmenter`）、语言检测（用 `franc-min`）、字幕解析（SRT/VTT 是纯文本）。

### 4. 文本分段用 `Intl.Segmenter`

Chrome 87+ / Safari 14.1+ / Firefox 125+ 已支持，底层 ICU 同源于 Rust 的 `unicode-segmentation`，CJK dictionary-based 分词质量在线。零打包成本，零跨边界开销。

缩写（"Dr.", "U.S.A."）、URL、代码片段的保护规则用几十行 TS 补丁实现。不要动 WASM。

### 5. 下划线用 CSS Custom Highlight API

```ts
CSS.highlights.set("onelingo-hover", new Highlight(range));
```

不包 `<span>`、不改宿主 DOM。Chrome 105+ / Safari 17.2+ 原生；Firefox 降级到 SVG overlay。

**不要**用 `<mark>` 或 wrap `<span>` 实现下划线——会破坏宿主页面的选区、事件委托、DOM diff。

### 6. 消息通道类型安全

所有 background ↔ content ↔ options 的消息走 `src/lib/messaging/` 的统一定义，类型由 TS 推断。不要在业务代码里直接 `browser.runtime.sendMessage`。

### 7. 存储分层

| 类型                               | 写到哪                                  |
| ---------------------------------- | --------------------------------------- |
| 跨设备配置                         | `storage.sync`                          |
| 本机配置                           | `storage.local`                         |
| 翻译缓存                           | 内存 LRU（每个上下文一个）+ IndexedDB   |
| 领域数据（生词本、术语、PDF 结果） | IndexedDB，**通过 background 串行访问** |

background service worker 随时会被杀，内存状态不可靠。所有持久数据必须落盘。

## 陷阱清单

### MV3 生命周期

- background 是 service worker，**没有 window / DOM / localStorage**，别用
- 启动时状态为空，要从 `storage` / IndexedDB 恢复
- 长任务要考虑被中断，设计成可恢复

### Shadow DOM

- 挂 **closed** 模式，宿主页面 JS 拿不到我们的 UI
- 字体 / Tailwind 之类的全局资源要显式注入到 shadow root
- `document.querySelector` 进不去 shadow root，调试用 `$0.shadowRoot`

### Content script 上下文

- 运行在 "isolated world"：DOM 共享，JS 上下文隔离
- **拿不到页面的 `window.xxx` 全局变量**。需要时通过 `<script>` 注入 main world，用 `CustomEvent` 通信
- 跨域请求由 background 发起，content 走消息路由

### WASM 加载（v2+）

- Chrome MV3 禁止 `eval` 和 `new Function`，`wasm-pack --target web` 的产物要用 `fetch` + `WebAssembly.instantiateStreaming`，不能走内联字符串
- WASM 模块在每个 context（background、每个 tab 的 content、popup）各一份内存，占用会累积——别把大字典装到 content 里，让 background 持有、按需 RPC 查询

### 引擎调用

- 所有 API key 存 `storage.local`，不发到页面
- 流式响应要处理中途断开（用户滚走、tab 关闭）
- 限流在 background 统一做，各引擎 adapter 不自己搞

## 代码风格

### TypeScript

- `strict: true`，已开 `noUncheckedIndexedAccess`
- 导出 API 显式写返回类型，内部函数靠推断
- 不用 `enum`，用字面量联合类型或 `as const` object
- 不用 `any`。确实不知道类型用 `unknown` + 类型守卫

### 文件与命名

- 入口文件 `*.ts`（entrypoints、纯逻辑）
- 含 JSX `*.tsx`（仅 Solid 组件）
- 目录和文件 `kebab-case`，导出的类型 / 类 `PascalCase`，函数 / 变量 `camelCase`
- 一个文件一个主职责，相关的小工具可以共处

### 依赖

- 加新依赖前**先问**是否必要
- 优先用浏览器原生 API（Intl.Segmenter、CSS Highlight、IndexedDB 原生等）
- 工具库倾向 `radash` 或标准库，不默认上 `lodash`
- UI 库：Solid 生态内选，不混 React

### 注释

- 不写"这个函数做什么"的废话注释
- 写"为什么这么做"的决策注释，特别是绕开常规写法的地方
- TODO 标明上下文：`// TODO(hover): dwell 时间做成用户可配`

## 目录边界

| 放               | 不放                                                  |
| ---------------- | ----------------------------------------------------- |
| `features/`      | 业务逻辑（无 UI 容器、无 shadow root 装载）           |
| `ui/`            | Solid 组件 + shadow root 装载（无业务规则）           |
| `engines/`       | 引擎 API 调用、请求构造、响应归一化（无缓存、无去重） |
| `site-adapters/` | 站点特定逻辑（无通用功能）                            |
| `lib/`           | 基础设施（无业务概念）                                |

"业务逻辑依赖 UI 细节"或"UI 里写业务规则"是坏信号。

## 提交规则（拟）

- 单次改动聚焦一个功能点
- commit message 说清**为什么**，不只说**做了什么**
- 不要在未问的情况下改其他文件的风格、重命名、抽取公共函数

## 与维护者协作

- 做决策前有疑问先问，不要假设
- 给出 2-3 个方案比直接选一个更受欢迎，附上 trade-off
- 被要求回退某个决策时，不要辩护超过一轮，按指令改
- 对已确立的核心决策（本文档 "核心决策" 节），如果你有不同意见可以提出，但不要在实现里偷偷违反
