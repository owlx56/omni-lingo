# OneLingo（一译）

一个跨平台、高性能的浏览器翻译拓展，支持 Chrome / Firefox / Safari。

## 功能一览

### 翻译交互

- **悬停翻译**：自动识别光标位置的词 / 句 / 段，灰色下划线标记后轻量 tooltip 弹出译文
- **划词翻译**：用户手动选中的文本，不显示下划线，选区附近弹出 Saladict 风格的悬浮 logo，移入后展开完整卡片
- **Minimal / Rich 两档卡片**：极简 tooltip（仅译文）/ 完整卡片（释义、发音、例句、生词本、引擎切换）；默认档位可配置
- **沉浸翻译**：全页翻译，支持译文替换 / 双语对照两种渲染模式
- **双语字幕**：YouTube / Netflix / HBO Max / Disney+ / edX / Coursera / Bilibili

### 数据与工具

- 生词本（词 / 句）
- 术语库导入与自动应用
- 翻译缓存（双层：内存 LRU + IndexedDB）
- 网页翻译结果导出

### 文件与 PDF

- 自建 PDF 阅读器（拦截 `.pdf` 请求，基于 pdf.js）
- 文件翻译：PDF / TXT / EPUB / MOBI，AI 判别小说 vs 论文以选择切分和 prompt 策略

### 可配置

- 翻译引擎：免费（Google / Microsoft / 硅基流动 / 本地词典）+ 付费（DeepL / 各家 LLM）
- 站点适配：GitHub、Reddit 等特定优化；通用站点走默认策略
- 悬浮球、主题、AI 翻译风格、源/目标语言、快捷键、右键菜单、站点黑白名单、译文样式

## 架构

### 技术栈

| 层           | 选型                                          | 理由                                            |
| ------------ | --------------------------------------------- | ----------------------------------------------- |
| 拓展框架     | **WXT**                                       | 跨浏览器、HMR、自动生成 manifest                |
| 包管理       | **Bun**                                       | 快                                              |
| UI 语言      | **TypeScript + HTML + CSS**                   | 默认选择                                        |
| UI 框架      | **Solid**（仅限 Shadow DOM UI 和 options 页） | signals-native、运行时极小、无 VDOM 开销        |
| 性能敏感代码 | **Vanilla TS**（无框架）                      | 热路径零抽象                                    |
| 可选 WASM    | **Rust**（v2+）                               | 仅用于 MOBI 解析、大规模术语匹配、本地 FST 词典 |

### 职责分层

```
热路径（vanilla TS，绝不介入框架响应式系统）
  ├── mousemove / mouseover 追踪
  ├── caretPositionFromPoint + Intl.Segmenter 词边界
  ├── dwell timer（200-400ms 防抖）
  ├── MutationObserver 回调
  └── 沉浸翻译的 DOM 遍历与改写

交互路径（Solid on Shadow DOM，用户触发后才渲染）
  ├── 悬浮球与展开动画
  ├── Rich 翻译卡片（释义、按钮、表单）
  ├── 设置侧栏 / options 页
  └── PDF 阅读器、文件翻译页

协调层（background service worker）
  ├── 消息路由
  ├── 引擎调用与限流
  ├── 缓存读写
  └── 鉴权与订阅状态
```

**关键原则**：热路径用 vanilla 保证零开销；Rich 卡片等复杂 UI 用 Solid 管状态。两层通过 signal 或薄 event API 解耦。

### 样式与注入隔离

所有注入宿主页面的 UI（悬浮球、tooltip、卡片、侧栏）挂在 `closed` 模式的 **Shadow DOM**，CSS 双向隔离。

悬停识别的下划线使用 **CSS Custom Highlight API**（`CSS.highlights`），不包 `<span>`、不改宿主 DOM 结构。Chrome 105+ / Safari 17.2+ 原生支持，Firefox 降级到 SVG overlay。

### 文本分段

使用浏览器原生 **`Intl.Segmenter`**（底层 ICU，支持 CJK dictionary-based 分词），TS 侧做缩写 / URL / 代码保护的薄层补丁。不走 WASM——跨边界成本对悬停这种高频场景不划算。

### 存储策略

| 类型                       | 存储位置             | 用途                                  |
| -------------------------- | -------------------- | ------------------------------------- |
| 跨设备设置                 | `storage.sync`       | 语言、引擎、显示模式                  |
| 本机设置                   | `storage.local`      | 缓存开关、快捷键                      |
| 翻译缓存                   | 内存 LRU + IndexedDB | key = hash(text + src + tgt + engine) |
| 生词本 / 术语库 / PDF 结果 | IndexedDB            | 通过 background 串行访问              |

background 的内存状态随 service worker 生命周期丢失，所有持久数据必须落盘。

### 引擎抽象

```ts
interface Engine {
  id: string;
  capabilities: {
    stream?: boolean;
    batch?: boolean;
    glossary?: boolean;
    contextWindow?: number;
  };
  translate(req): Promise<Response>;
  stream?(req): AsyncIterable<Chunk>;
  translateBatch?(reqs): Promise<Response[]>;
}
```

调用方按 `capabilities` 降级。沉浸翻译优先走 `translateBatch`，AI 引擎优先走 `stream`，DeepL 有词汇表能力。

### 站点适配器

```ts
interface SiteAdapter {
  match(url: string): boolean;
  extract?(root: Element): Paragraph[];
  skipSelectors?: string[];
  renderer?: Renderer;
  subtitle?: SubtitleAdapter;
  mount?(ctx): () => void;
}
```

URL 匹配链式 fallback 到默认。视频站点通过 `subtitle` 字段插拔字幕内核。

## 目录结构

```
onelingo/
├── crates/                     # Rust workspace（v2+ 才填充）
│   └── onelingo-wasm/          # 唯一 wasm-bindgen 出口
├── src/
│   ├── entrypoints/
│   │   ├── background.ts
│   │   ├── content.ts
│   │   ├── popup/
│   │   ├── options/
│   │   ├── pdf-viewer/
│   │   └── file-translate/
│   ├── features/               # 业务逻辑，无 UI 容器
│   │   ├── hover/              # vanilla：悬停识别、underline
│   │   ├── selection/          # vanilla：划词监听、logo 触发
│   │   ├── immersive/          # vanilla：DOM 遍历、段落切分、渲染
│   │   ├── vocabulary/
│   │   ├── terminology/
│   │   ├── subtitle/
│   │   └── pdf/
│   ├── engines/                # 翻译引擎适配
│   │   ├── types.ts
│   │   ├── registry.ts
│   │   ├── google.ts
│   │   ├── deepl.ts
│   │   ├── llm/
│   │   └── local.ts
│   ├── site-adapters/
│   │   ├── base.ts
│   │   ├── github.ts
│   │   ├── youtube.ts
│   │   └── index.ts
│   ├── lib/
│   │   ├── messaging/          # 类型安全的消息通道
│   │   ├── storage/            # settings / cache / vocab / terms
│   │   ├── cache/              # LRU + IndexedDB
│   │   ├── wasm/               # WASM 加载器（v2+）
│   │   └── i18n/
│   ├── ui/                     # Solid，挂 Shadow DOM
│   │   ├── shadow-root.ts
│   │   ├── floating-ball/
│   │   ├── translate-popup/    # Minimal 渲染器 vanilla，Rich 渲染器 Solid
│   │   └── settings-panel/
│   └── types/
├── locales/
├── public/
├── wxt.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

> **注意**：空目录不预先创建。上表是最终形态，实际按功能演进逐步长出。

## 开发

### 前置

- Bun（最新稳定版）
- Chrome（或 Firefox）
- 可选：Rust toolchain（v2+ 做 WASM 模块时）

### 启动

```bash
bun install
bun run dev              # 启动构建 + HMR server，不自动开浏览器
```

然后在日常 Chrome 手动加载一次：

1. `chrome://extensions` → 开启 **Developer mode**
2. **Load unpacked** → 选择 `.output/chrome-mv3-dev`
3. 访问任意网页，DevTools Console 应看到 `[OneLingo] content loaded: ...`
4. 拓展页 OneLingo 卡片点 **Service worker** → Console 应看到 `[OneLingo] background ready`

之后代码改动自动 HMR，无需重新加载。改动 `wxt.config.ts` / manifest / 新增 entrypoint 时，在拓展页点 OneLingo 的刷新按钮。

### 为什么不让 WXT 自动启动浏览器

WXT 在 Windows 上通过 `web-ext` 启动 Chrome 偶发丢失 `--load-extension` 参数，导致启动的干净 profile 里拓展没装上。`wxt.config.ts` 里 `webExt: { disabled: true }` 关掉自动启动，改为手动 Load unpacked + HMR，开发体验不变。

### 构建

```bash
bun run build              # Chrome MV3
bun run build:firefox      # Firefox
bun run zip                # 打包上架
```

### 类型检查

```bash
bun run compile            # tsc --noEmit
```

## 开发节奏

项目采用**每次最小化实现一个功能**的节奏：

1. 骨架（已完成）：WXT + Solid + background/content 日志
2. 消息通道 + 设置存储最小原语
3. 第一个翻译引擎（Google）+ background RPC
4. 悬停翻译最小闭环（TS 占位分段 → `Intl.Segmenter`）
5. CSS Custom Highlight 下划线
6. Minimal 卡片渲染（vanilla）
7. 划词 + logo 触发
8. Rich 卡片（Solid）
9. 沉浸翻译核心
10. 生词本、术语库、字幕、PDF、文件翻译、站点适配……逐个加

每一步产物可运行、可 review，代码量控制在可逐行过目的规模。
