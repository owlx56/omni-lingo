import { onMessage, sendMessage, type PageTranslateCommand } from "@/lib/messaging";

const BLOCK_RE = /^(block|flex|grid|list-item|table(?!-cell\b|-row\b)|table-cell|table-row)$/;
const MIN_TEXT_CHARS = 8;
const MAX_CONCURRENCY = 12;

const originalTexts = new WeakMap<HTMLElement, string>();
const appliedKeys = new WeakMap<HTMLElement, string>();

let runSeq = 0;

export function initFullPage(): void {
  onMessage("runPageTranslate", (input) => {
    const blocks = collectBlocks();
    const seq = ++runSeq;
    void translateBlocks(blocks, input, seq).catch((error) => {
      console.warn("[OneLingo] immersive translate crashed:", error);
    });
    return { accepted: true, blocks: blocks.length };
  });
}

async function translateBlocks(
  blocks: HTMLElement[],
  input: PageTranslateCommand,
  seq: number,
): Promise<void> {
  const appliedKey = `${input.engine}|${input.target}`;
  let cursor = 0;
  const workers = Math.min(MAX_CONCURRENCY, blocks.length);

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        if (seq !== runSeq) return;
        const block = blocks[cursor++];
        if (!block) return;
        if (!block.isConnected) continue;

        const original = getOriginalText(block);
        if (!original || appliedKeys.get(block) === appliedKey) continue;

        try {
          const res = await sendMessage("translate", {
            text: original,
            target: input.target,
            engine: input.engine,
          });
          if (seq !== runSeq) return;
          if (!block.isConnected) continue;
          block.textContent = res.text;
          appliedKeys.set(block, appliedKey);
        } catch (error) {
          console.warn("[OneLingo] immersive translate failed:", error);
        }
      }
    }),
  );
}

function collectBlocks(): HTMLElement[] {
  const root = document.body;
  if (!root) return [];

  const blocks: HTMLElement[] = [];
  for (const el of root.querySelectorAll("*")) {
    if (!(el instanceof HTMLElement)) continue;
    if (isOurUi(el)) continue;
    if (!isVisible(el)) continue;
    if (!BLOCK_RE.test(window.getComputedStyle(el).display)) continue;
    const text = getOriginalText(el);
    if (text.length < MIN_TEXT_CHARS) continue;
    if (hasBlockChild(el)) continue;
    blocks.push(el);
  }
  return blocks;
}

function hasBlockChild(el: HTMLElement): boolean {
  for (const child of el.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (isOurUi(child)) continue;
    if (!isVisible(child)) continue;
    if (!BLOCK_RE.test(window.getComputedStyle(child).display)) continue;
    if (getOriginalText(child).length >= MIN_TEXT_CHARS) return true;
  }
  return false;
}

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (style.opacity === "0") return false;
  if (el.offsetParent !== null) return true;
  return (
    style.position === "fixed" ||
    style.position === "sticky" ||
    style.position === "absolute"
  );
}

function getOriginalText(el: HTMLElement): string {
  const cached = originalTexts.get(el);
  if (cached !== undefined) return cached;

  // 某些元素（尤其 SVG）没有可靠 innerText，回退到 textContent 避免 trim 崩溃。
  const rawText =
    typeof (el as { innerText?: unknown }).innerText === "string"
      ? (el as { innerText: string }).innerText
      : (el.textContent ?? "");
  const text = rawText.trim();
  if (text) originalTexts.set(el, text);
  return text;
}

function isOurUi(el: Element): boolean {
  return !!el.closest("[data-onelingo-tooltip],[data-onelingo-host]");
}
