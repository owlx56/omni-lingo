# Immersive Debugging

全文翻译 bug 先按层定位，再决定修哪里。不要一看到具体网址就先写域名特例。

## 修复优先级

1. 通用 DOM / 流水线问题
2. 站点 rule 调整
3. 域名特例代码

换句话说：先证明它不是通用问题，再考虑特例。

## 分层定位

| 层                    | 常见症状                                           | 优先检查                                                              |
| --------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| 扫描层 `scan.ts`      | 该翻译的节点没进队列，或扫到不该翻译的区域         | selector、ignore、block/inline 判断、visible 判断                     |
| 执行层 `index.ts`     | 原文译文交错、重复翻译、恢复失败、动态页面重扫异常 | `collectNodeGroups`、`translateNodeGroup`、wrapper 状态、rescan queue |
| 序列化层 `markup.ts`  | `<i12>` / `{1}` 乱码、链接丢失、HTML 被翻译成文本  | format、placeholder、preserve/restore、semantic label                 |
| 引擎层 `src/engines/` | 某个引擎独有乱码、HTML mode 不生效、批量返回错位   | request format、batch parse、text/html 参数                           |
| 规则层 `rules.ts`     | 某站点区域多翻/漏翻、rich HTML 开关不合适          | selector、rootsSelector、ignoreSelector、richHtmlSelector             |
| 样式层                | 译文挤压、横向过长、列表/表格排版坏掉              | rule styles、wrapper tag、host display                                |
| Loading 层 `immersive-loading.ts` | 骨架屏行数/宽度/颜色不自然，loading CSS 变量丢失 | line specs、palette、`aria-busy` CSS 变量保留                         |

## 判断是否是通用问题

先问这些问题：

- 这是 inline list、导航链、面包屑、表格、引用、脚注、代码块、动态加载这类通用 DOM 模式吗？
- 是否至少两个不同站点会出现类似症状？
- 是否换引擎后症状还存在？
- 是否单语和双语模式都受影响？
- 是否和 `text` / `html` 序列化格式有关？

如果答案偏“是”，优先修 `scan.ts` / `index.ts` / `markup.ts`。

## 什么时候改 rules.ts

适合用规则解决：

- 哪些节点该翻译：`selector`
- 从哪个 root 扫描：`rootsSelector`
- 哪些区域跳过：`ignoreSelector`
- 是否启用 rich HTML：`richHtmlSelector` / `richHtmlExcludeSelector`
- 特定站点需要样式补丁：`selectStyle` / `parentStyle` / `grandStyle` / `textExtStyle`

不适合用规则解决：

- placeholder 恢复失败
- inline 原文译文交错
- MutationObserver 重扫导致重复 wrapper
- 引擎 batch 返回解析错误
- 通用 DOM 类型的分组逻辑

## 什么时候写域名特例

只有通用层和规则层都表达不了时才写域名特例，例如：

- 站点把内容藏在特殊 shadow root 或虚拟列表里；
- 需要读站点私有 DOM 属性或播放器状态；
- selector 无法稳定表达目标区域；
- 需要和站点自己的 hydration / router 生命周期配合。

如果这类特例开始变多，再考虑新增 `src/site-adapters/`，不要提前创建。

## 最小回归集

改全文翻译后至少考虑这些页面类型：

- Wikipedia Main Page：复杂首页、inline language list、站点规则叠加。
- Wikipedia article with references：脚注、引用、rich HTML。
- AO3 work page：导航链、series inline metadata。
- Reddit post page：动态内容、标题、评论。
- Discourse / forum topic：虚拟 DOM 重建和本地 translation cache。

不一定每次都手工跑全量，但最终说明里要写清楚跑了哪些，没跑哪些。

## 提交前检查

```powershell
bun run compile
bun run build
```

Windows shim 有问题时：

```powershell
& 'C:\Users\owlx\scoop\shims\bun.exe' .\node_modules\typescript\bin\tsc --noEmit
& 'C:\Users\owlx\scoop\shims\bun.exe' .\node_modules\wxt\bin\wxt.mjs build
```
