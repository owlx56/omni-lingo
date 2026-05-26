# OneLingo（一译）

OneLingo 是一个浏览器翻译拓展，目标是提供悬停翻译、划词翻译和全文沉浸式翻译体验。当前代码基于 WXT + TypeScript + Solid，面向 Chrome MV3 开发，保留跨 Firefox / Safari 的架构空间。

## 当前状态

已落地的主要模块：

- 悬停翻译：`src/features/hover/`
- 划词翻译：`src/features/selection/`
- 全文翻译：`src/features/immersive/`
- popup / options UI：`src/entrypoints/popup/`、`src/entrypoints/options/`
- PDF / EPUB 阅读器：`src/entrypoints/viewer/`、`src/features/document-viewer/`
- 翻译引擎：Google、Google2、Microsoft
- 类型安全消息通道：`src/lib/messaging/`
- 翻译缓存：内存 LRU + IndexedDB
- 设置与语言：`src/lib/storage/settings.ts`、`src/lib/languages.ts`
- options / popup 界面 i18n：18 种语言，文案按语言拆在 `src/lib/i18n/locales/`

还未落地的能力不要提前创建目录，文件翻译、字幕翻译、独立站点 adapter 等功能等到实现时再长出来。

## 快速开始

前置：

- Bun
- Chrome 或 Chromium 系浏览器

安装依赖：

```bash
bun install
```

启动开发构建：

```bash
bun run dev
```

WXT 在本项目中不会自动启动浏览器。手动加载拓展：

1. 打开 `chrome://extensions`
2. 开启 Developer mode
3. Load unpacked
4. 选择 `.output/chrome-mv3-dev`

改动大多数 content / popup / options 代码后，WXT 会自动重建。改 manifest、`wxt.config.ts` 或新增 entrypoint 后，在拓展页点刷新。

## 常用命令

```bash
bun run dev              # Chrome MV3 开发构建
bun run dev:firefox      # Firefox 开发构建
bun run compile          # TypeScript 检查
bun test src/lib/i18n/index.test.js  # i18n 轻量回归测试
bun run build            # Chrome MV3 生产构建
bun run build:firefox    # Firefox 构建
bun run zip              # Chrome 打包
```

Windows 上如果 package-script shim 解析失败，可以直接通过 Bun 调本地工具：

```powershell
& 'C:\Users\owlx\scoop\shims\bun.exe' .\node_modules\typescript\bin\tsc --noEmit
& 'C:\Users\owlx\scoop\shims\bun.exe' test .\src\lib\i18n\index.test.js
& 'C:\Users\owlx\scoop\shims\bun.exe' .\node_modules\wxt\bin\wxt.mjs build
```

## 项目结构

```text
src/
  entrypoints/
    background.ts       # background service worker
    content.ts          # content script bootstrap
    popup/              # popup UI
    options/            # options UI
    viewer/             # PDF / EPUB 阅读器页面

  features/
    hover/              # 悬停识别、分词、Highlight API 下划线
    selection/          # 划词交互和翻译卡片触发
    immersive/          # 全文翻译
    document-viewer/    # 文档加载、EPUB 解析、PDF 文本面提取

  engines/              # 翻译引擎适配
  lib/
    messaging/          # 类型安全消息通道
    storage/            # 设置和规则存储
    cache/              # 翻译缓存
    i18n/               # options / popup UI 多语言文案
      locales/          # 18 种语言，每种语言一个文件
    languages.ts        # UI 语言 / 目标语言常量和类型
    translation-style.ts # 全文译文样式解析
    ui/                 # 共享 Solid 控件和图标
  ui/                   # Shadow DOM 挂载辅助和交互 UI 基础设施

docs/
  architecture.md       # 当前架构和模块边界
  immersive-debugging.md # 全文翻译 bug 定位流程
  agent-guidelines.md   # AI agent 协作规则
```

更完整的模块边界见 [docs/architecture.md](docs/architecture.md)。

## 设置和多语言

设置统一走 `src/lib/storage/settings.ts`。`uiLang` 是 options / popup 的界面语言；hover / selection / immersive 的目标语言默认与它一致，用户修改某个功能目标语言后该功能独立保存。

语言列表集中在 `src/lib/languages.ts`，当前支持：

```text
English, 简体中文, 繁體中文, 日本語, 한국어, العربية, Türk, русский, Việt, ไทย,
Deutsch, Español, Français, Português(BR), हिन्दी, Italiano, Bahasa Indonesia, فارسی
```

i18n 文案源集中在 `src/lib/i18n/catalog.ts`；`src/lib/i18n/locales/*.ts`、`src/lib/i18n/locales/index.ts` 和 `src/assets/pdf-viewer/locales.generated.mjs` 都由脚本生成。新增 options / popup / viewer 文案时，只改 `catalog.ts`，再运行 `bun run i18n:generate`。

共享 UI 控件在 `src/lib/ui/controls.tsx` 和 `src/lib/ui/controls.css`。options / popup 的 Select、Segment、Switch、Row、色板等优先从这里改，避免两个入口样式漂移。

## 全文翻译模块

`src/features/immersive/` 当前按职责拆分：

| 文件           | 职责                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| `index.ts`     | 会话状态、命令处理、observer 创建、rescan 队列、翻译 batching、wrapper 状态、恢复流程 |
| `scan.ts`      | DOM 发现、`ScanContext`、忽略判断、block / visibility 分类、扫描期规则样式            |
| `markup.ts`    | 序列化、占位符、rich HTML 恢复、译文 markup 插入                                      |
| `rules.ts`     | 默认 / 站点规则、规则匹配、规则解析                                                   |
| `selectors.ts` | 安全 selector helper                                                                  |
| `dom-attrs.ts` | 共享 `data-onelingo-*` wrapper 属性名                                                 |

改这个模块前建议先读 [docs/architecture.md#全文翻译-immersive](docs/architecture.md#全文翻译-immersive)。
修全文翻译 bug 时先按 [docs/immersive-debugging.md](docs/immersive-debugging.md) 分层定位。

## 开发原则

- 热路径用 vanilla TypeScript 和直接 DOM API，不接入 Solid 响应式系统。
- Solid 只用于 popup、options、Rich 卡片等用户主动触发的 UI。
- content / background / popup / options 通信统一走 `src/lib/messaging/`。
- 悬停下划线用 CSS Custom Highlight API，不包宿主 DOM。
- 默认不用 WASM；只有 JS 生态不可靠或数据规模明确需要时再考虑。
- 加依赖前先讨论，优先用浏览器原生 API。

更多细节见 [AGENTS.md](AGENTS.md) 和 [docs/agent-guidelines.md](docs/agent-guidelines.md)。

## 调试提示

- content script 加载后，页面 DevTools console 会看到 `[OneLingo] content loaded: ...`。
- background 启动后，拓展 Service worker console 会看到 `[OneLingo] background ready`。
- popup 的全文翻译命令通过 background 转发到当前活动 tab。
- 全文翻译站点差异优先在 `src/features/immersive/rules.ts` 里用 selector / rule flag 表达。

## 贡献节奏

保持单次改动聚焦。先让每一步可运行、可检查，再扩展功能面。不要提前创建未来目录，也不要在一个 PR 里同时做功能、重构和风格整理。
