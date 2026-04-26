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

交互路径不同：Rich 卡片、悬浮球、设置面板、options 页、PDF / 文件翻译 UI 可以使用 Solid，并挂在 closed Shadow DOM 下。

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

### 存储

遵守当前存储边界：

| 数据 | 存储 |
| --- | --- |
| 跨设备配置 | `storage.sync` |
| 本机配置 | `storage.local` |
| 翻译缓存 | 内存 LRU + IndexedDB |
| 生词本、术语、PDF / 文件结果 | 通过 background 访问 IndexedDB |

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

| 目录 | 负责 | 不负责 |
| --- | --- | --- |
| `src/features/` | 业务行为 | UI 挂载 / Shadow DOM 容器 |
| `src/ui/` | Solid 组件和 Shadow DOM 挂载 | 业务规则 |
| `src/engines/` | 引擎请求和响应归一化 | 缓存 / 去重 |
| `src/lib/` | 基础设施 | 产品功能策略 |

## 协作

- 单次改动聚焦一个目标。
- 编辑前读附近代码。
- 先匹配现有风格，再考虑抽象。
- 不要顺手重命名、重排格式或抽取无关代码。
- 做 review 时先列具体风险和文件行号。
- 维护者要求回退某个决策时，按要求改。
