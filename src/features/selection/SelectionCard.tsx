// 划词翻译卡片 Solid 组件。
// 只负责 UI；定位 + 可见性由 vanilla 编排器控制容器 div。

import { Show } from "solid-js";
import { render } from "solid-js/web";
import { selResult } from "./card-store";

function SelectionCard() {
  return (
    <div
      style={{
        "min-height": "1.5em",
        "white-space": "pre-wrap",
        "word-break": "break-word",
      }}
    >
      <Show
        when={selResult() !== null}
        fallback={<span style={{ color: "#999" }}>翻译中…</span>}
      >
        {selResult()}
      </Show>
    </div>
  );
}

/** 将 SelectionCard 挂入容器元素（只调一次）。 */
export function mountCard(container: HTMLElement): void {
  render(() => <SelectionCard />, container);
}
