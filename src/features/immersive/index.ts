import { onMessage, sendMessage, type PageTranslateCommand, type PageTranslateStatus } from "@/lib/messaging";

const BLOCK_RE = /^(block|flex|grid|list-item|table(?!-cell\b|-row\b)|table-cell|table-row)$/;
const MIN_TEXT_CHARS = 8;
const MAX_CONCURRENCY = 12;
const TRANSLATION_ATTR = "data-onelingo-immersive";

const originalTexts = new WeakMap<HTMLElement, string>();
const appliedKeys = new WeakMap<HTMLElement, string>();
const appliedModes = new WeakMap<HTMLElement, PageTranslateMode>();
const translationNodes = new WeakMap<HTMLElement, HTMLElement>();
const translatedBlocks = new Set<HTMLElement>();

let runSeq = 0;
let lastCommandId = 0;
let translating = false;

type PageTranslateMode = NonNullable<PageTranslateCommand["mode"]>;

export function initFullPage(): void {
  onMessage("runPageTranslate", (input) => {
    if (isStaleCommand(input.commandId)) {
      return { accepted: false, blocks: translatedBlocks.size, active: getStatus().active };
    }
    applyCommandId(input.commandId);

    const blocks = collectBlocks();
    const seq = ++runSeq;
    void translateBlocks(blocks, input, seq).catch((error) => {
      console.warn("[OneLingo] immersive translate crashed:", error);
    });
    return { accepted: true, blocks: blocks.length, active: blocks.length > 0 };
  });

  onMessage("runPageRestore", (input) => {
    if (isStaleCommand(input.commandId)) return getStatus();
    applyCommandId(input.commandId);
    restoreOriginals();
    return getStatus();
  });

  onMessage("readPageTranslateStatus", () => {
    return getStatus();
  });
}

function isStaleCommand(commandId: number | undefined): boolean {
  return commandId !== undefined && commandId < lastCommandId;
}

function applyCommandId(commandId: number | undefined): void {
  if (commandId !== undefined && commandId > lastCommandId) {
    lastCommandId = commandId;
  }
}

async function translateBlocks(
  blocks: HTMLElement[],
  input: PageTranslateCommand,
  seq: number,
): Promise<void> {
  const mode = input.mode ?? "replace";
  const appliedKey = `${input.engine}|${input.target}|${mode}`;
  let cursor = 0;
  const workers = Math.min(MAX_CONCURRENCY, blocks.length);
  translating = workers > 0;

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
          applyTranslation(block, original, res.text, mode);
          appliedKeys.set(block, appliedKey);
          appliedModes.set(block, mode);
          translatedBlocks.add(block);
        } catch (error) {
          console.warn("[OneLingo] immersive translate failed:", error);
        }
      }
    }),
  );

  if (seq === runSeq) translating = false;
}

function restoreOriginals(): void {
  runSeq++;
  translating = false;
  for (const block of translatedBlocks) {
    const original = originalTexts.get(block);
    const mode = appliedModes.get(block);
    removeTranslationNode(block);
    if (!block.isConnected || original === undefined) continue;
    if (mode === "replace") block.textContent = original;
    appliedKeys.delete(block);
    appliedModes.delete(block);
  }
  translatedBlocks.clear();
}

function applyTranslation(
  block: HTMLElement,
  original: string,
  translated: string,
  mode: PageTranslateMode,
): void {
  removeTranslationNode(block);

  if (mode === "replace") {
    // 有意用 textContent 替换：简单可靠，代价是销毁内联子元素（链接、加粗等）。
    // restoreOriginals 只能还原纯文本，无法恢复 HTML 结构，属于已知 tradeoff。
    block.textContent = translated;
    return;
  }

  if (appliedModes.get(block) === "replace") {
    block.textContent = original;
  }

  const node = document.createElement("span");
  node.setAttribute(TRANSLATION_ATTR, "true");
  node.textContent = translated;
  node.style.display = "block";
  node.style.marginTop = "0.35em";
  node.style.color = "#2f6f4e";
  node.style.fontSize = "0.95em";
  node.style.lineHeight = "1.55";
  block.appendChild(node);
  translationNodes.set(block, node);
}

function removeTranslationNode(block: HTMLElement): void {
  const node = translationNodes.get(block);
  if (node?.isConnected) node.remove();
  translationNodes.delete(block);
}

function getStatus(): PageTranslateStatus {
  return {
    active: translatedBlocks.size > 0,
    translating,
    blocks: translatedBlocks.size,
  };
}

// querySelectorAll 排除已知不含正文的元素，减少 getComputedStyle 调用次数
const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "HEAD", "META", "LINK",
  "SVG", "MATH", "IMG", "VIDEO", "AUDIO", "CANVAS", "IFRAME",
  "INPUT", "TEXTAREA", "SELECT", "BUTTON",
]);

function collectBlocks(): HTMLElement[] {
  const root = document.body;
  if (!root) return [];

  const blocks: HTMLElement[] = [];
  for (const el of root.querySelectorAll("*")) {
    if (!(el instanceof HTMLElement)) continue;
    if (SKIP_TAGS.has(el.tagName)) continue;
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
  return !!el.closest(
    `[data-onelingo-tooltip],[data-onelingo-host],[${TRANSLATION_ATTR}]`,
  );
}
