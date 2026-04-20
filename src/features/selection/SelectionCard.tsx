// 划词翻译卡片 Solid 组件。
// 只负责 UI；定位 + 可见性由 vanilla 编排器控制容器 div。

import { Show, For } from "solid-js";
import { render } from "solid-js/web";
import { sendMessage } from "@/lib/messaging";
import {
  selText,
  selTarget,
  selResult,
  selEngine,
  setSelResult,
  setSelEngine,
  SEL_ENGINES,
  type SelEngine,
} from "./card-store";

function SelectionCard() {
  async function switchEngine(eng: SelEngine) {
    if (eng === selEngine()) return;
    setSelEngine(eng);
    setSelResult(null);
    try {
      const res = await sendMessage("translate", {
        text: selText(),
        target: selTarget(),
        engine: eng,
      });
      // 期间用户可能已经切了别的引擎，只写当前的
      if (selEngine() === eng) setSelResult(res.text);
    } catch {
      if (selEngine() === eng) setSelResult("翻译失败");
    }
  }

  return (
    <>
      {/* 译文区 */}
      <div
        style={{
          "min-height": "1.5em",
          "margin-bottom": "8px",
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

      {/* 引擎切换栏 */}
      <div
        style={{
          display: "flex",
          gap: "4px",
          "border-top": "1px solid #f0f0f0",
          "padding-top": "6px",
        }}
      >
        <For each={SEL_ENGINES}>
          {(eng) => (
            <button
              style={{
                all: "unset",
                padding: "2px 8px",
                "border-radius": "3px",
                font: "11px system-ui,sans-serif",
                cursor: "pointer",
                background: selEngine() === eng ? "#2a6df4" : "#f0f0f0",
                color: selEngine() === eng ? "#fff" : "#555",
              }}
              onClick={() => void switchEngine(eng)}
            >
              {eng}
            </button>
          )}
        </For>
      </div>
    </>
  );
}

/** 将 SelectionCard 挂入容器元素（只调一次）。 */
export function mountCard(container: HTMLElement): void {
  render(() => <SelectionCard />, container);
}
