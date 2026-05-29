# OneLingo Agent Guide

OneLingo（一译）是跨 Chrome / Firefox / Safari 的浏览器翻译拓展。

这个文件只做短入口，长期规则和架构说明放在 `docs/`。

## 必读

- [docs/agent-guidelines.md](docs/agent-guidelines.md)：工程规则、浏览器拓展陷阱、协作约定。
- [docs/architecture.md](docs/architecture.md)：当前代码布局和模块所有权。
- [docs/document-viewer.md](docs/document-viewer.md)：PDF / EPUB 阅读器、文件链接嗅探、PDF.js 资产和 reader i18n。
- [docs/immersive-debugging.md](docs/immersive-debugging.md)：全文翻译 bug 的分层定位和修复优先级。
- [README.md](README.md)：产品概览和开发启动方式。

## 硬约束

- 热路径必须是 vanilla TypeScript + 直接 DOM API。不要把 Solid signals、store、effect 放进 mouse、selection、observer、全文 DOM 遍历路径。
- Solid 只用于用户主动触发的 UI，并挂在 closed Shadow DOM 下。
- 拓展消息必须走 `src/lib/messaging/`。业务代码不要直接调用 `browser.runtime.sendMessage`。
- 加新依赖前先问。优先用浏览器原生 API。
- 默认不用 WASM。门槛见 [docs/agent-guidelines.md](docs/agent-guidelines.md#rustwasm-门槛)。
- 悬停下划线不要包宿主 DOM。使用 CSS Custom Highlight API 和文档里的降级方案。
- 不要回退无关的用户改动。

## 当前架构速记

- 用户主动触发的 UI 在 `src/entrypoints/options/`、`src/entrypoints/popup/`、`src/entrypoints/viewer/` 和 `src/ui/`，可以使用 Solid。
- 共享设置在 `src/lib/storage/settings.ts`，语言常量和类型在 `src/lib/languages.ts`。
- `uiLang` 是 options / popup 的界面语言；hover / selection / immersive 目标语言默认与它一致，用户修改某个功能目标语言后该功能独立保存。
- UI 文案源在 `src/lib/i18n/catalog.ts`，options / popup / EPUB / PDF reader 都从这里派生；`messages.ts`、`locales/*.ts` 和 `src/assets/pdf-viewer/locales.generated.mjs` 是类型/兼容/静态 viewer 产物。
- 通用控件放在 `src/lib/ui/controls.tsx` 和 `src/lib/ui/controls.css`；改 options / popup 下拉菜单、开关、色板时优先复用这里。
- PDF reader 使用 GitHub release 的 `pdfjs-*-dist.zip` 作为唯一 PDF.js 上游来源；通过 `bun run pdfjs:update -- --version <version>` 重建 `src/assets/pdf-viewer/upstream/`，构建时由 `wxt.config.ts` 复制并注入 OneLingo bridge。不要手改 upstream 或 `.output/`。
- PDF hover 直接复用 `src/features/hover/` 的通用逻辑；不要再维护一套 PDF-specific hover hit test / token split / overlay underline。
- EPUB reader 在 `src/entrypoints/viewer/` 使用 `epubjs` 渲染，`epub-bridge.ts` 负责把 hover / selection 行为接进 EPUB iframe。
- 文件链接嗅探分两层：`src/features/document-sniffer.ts` 处理页面内普通链接点击；`src/entrypoints/background.ts` 用 DNR / webRequest 处理地址栏和主框架 PDF / EPUB 导航。
- 全文翻译在 `src/features/immersive/`。
- `index.ts` 负责会话编排和翻译执行。
- `scan.ts` 负责 DOM 发现和扫描期分类。
- `markup.ts` 负责序列化、占位符恢复、译文 markup 回填。
- `rules.ts` 负责站点规则和规则解析。
- 共享 wrapper 属性名放在 `dom-attrs.ts`。

改 options / popup / viewer 或 i18n 文案时，只维护 `src/lib/i18n/catalog.ts`，然后运行 `bun run i18n:generate`；不要手改生成的 `locales/*.ts` 或 `src/assets/pdf-viewer/locales.generated.mjs`。
改 PDF / EPUB reader、文件嗅探或 PDF.js 资产复制前先读 [docs/document-viewer.md](docs/document-viewer.md)。
改全文翻译前先读 [docs/architecture.md#全文翻译-immersive](docs/architecture.md#全文翻译-immersive)。
修全文翻译 bug 前先读 [docs/immersive-debugging.md](docs/immersive-debugging.md)。

## 常用命令

默认走 package scripts：

```powershell
bun run compile
bun run build
```

当前有一条轻量 i18n 回归测试：

```powershell
bun test .\src\lib\i18n\index.test.js
```

i18n 生成：

```powershell
bun run i18n:generate
```

如果 Windows shim 解析失败，直接用 Bun 调本地工具：

```powershell
& 'C:\Users\owlx\scoop\shims\bun.exe' .\node_modules\typescript\bin\tsc --noEmit
& 'C:\Users\owlx\scoop\shims\bun.exe' .\node_modules\wxt\bin\wxt.mjs build
& 'C:\Users\owlx\scoop\shims\bun.exe' test .\src\lib\i18n\index.test.js
& 'C:\Users\owlx\scoop\shims\bun.exe' .\scripts\generate-i18n.ts
```
