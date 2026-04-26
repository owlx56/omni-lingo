# OneLingo Agent Guide

OneLingo（一译）是跨 Chrome / Firefox / Safari 的浏览器翻译拓展。

这个文件只做短入口，长期规则和架构说明放在 `docs/`。

## 必读

- [docs/agent-guidelines.md](docs/agent-guidelines.md)：工程规则、浏览器拓展陷阱、协作约定。
- [docs/architecture.md](docs/architecture.md)：当前代码布局和模块所有权。
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

- 全文翻译在 `src/features/immersive/`。
- `index.ts` 负责会话编排和翻译执行。
- `scan.ts` 负责 DOM 发现和扫描期分类。
- `markup.ts` 负责序列化、占位符恢复、译文 markup 回填。
- `rules.ts` 负责站点规则和规则解析。
- 共享 wrapper 属性名放在 `dom-attrs.ts`。

改全文翻译前先读 [docs/architecture.md#全文翻译-immersive](docs/architecture.md#全文翻译-immersive)。
修全文翻译 bug 前先读 [docs/immersive-debugging.md](docs/immersive-debugging.md)。

## 常用命令

默认走 package scripts：

```powershell
bun run compile
bun run build
```

如果 Windows shim 解析失败，直接用 Bun 调本地工具：

```powershell
& 'C:\Users\owlx\scoop\shims\bun.exe' .\node_modules\typescript\bin\tsc --noEmit
& 'C:\Users\owlx\scoop\shims\bun.exe' .\node_modules\wxt\bin\wxt.mjs build
```
