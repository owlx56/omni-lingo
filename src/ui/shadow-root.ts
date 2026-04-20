// 单例 closed Shadow DOM 容器。
//
// 所有注入宿主页面的 UI（划词 logo、卡片、悬浮球、设置侧栏）都挂在
// 这一个 host 下面，共享一个 shadow root。CSS 双向隔离。
//
// host 挂 documentElement 而非 body：少数 SPA 会替换 body 节点，
// documentElement 更稳。
//
// closed 模式：宿主页面 JS 拿不到 shadowRoot。调试时用 DevTools
// 的 "user-agent shadow trees" 选项或直接选 host 元素查看 #shadow-root (closed)。

const HOST_ATTR = "data-onelingo-host";

let host: HTMLDivElement | null = null;
let root: ShadowRoot | null = null;

export function getShadowRoot(): ShadowRoot {
  if (root) return root;
  host = document.createElement("div");
  host.setAttribute(HOST_ATTR, "");
  // 自身 0x0、position:fixed，不参与布局也不挡事件；
  // z-index 拉满确保 shadow 内 position:fixed 的子元素能压在宿主之上
  host.style.cssText = "position:fixed;top:0;left:0;z-index:2147483647";
  document.documentElement.appendChild(host);
  root = host.attachShadow({ mode: "closed" });
  return root;
}

// 给 light DOM 侧的事件判断使用：闭合 shadow 内的 mouse / click 事件
// 在外层捕获时，e.target 会被 retarget 到 host 元素本身。
export function getHost(): HTMLElement | null {
  return host;
}
