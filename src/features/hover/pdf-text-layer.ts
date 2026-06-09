import type { HoverGranularity } from "@/lib/storage/settings";

type RectLike = Pick<
  DOMRect,
  "left" | "top" | "right" | "bottom" | "width" | "height"
>;

export interface PdfTextLayerItem {
  text: string;
  rect: RectLike;
}

interface PdfTextLayerDomItem extends PdfTextLayerItem {
  node: Text;
}

interface PdfLineItem extends PdfTextLayerItem {
  index: number;
}

interface PdfLine {
  items: PdfLineItem[];
  rect: RectLike;
}

interface TextPiece {
  itemIndex: number;
  start: number;
  end: number;
  textLength: number;
}

export interface PdfTextLayerTextUnit {
  text: string;
  startItemIndex: number;
  startOffset: number;
  endItemIndex: number;
  endOffset: number;
  rect: RectLike;
}

export interface ResolvePdfTextLayerTextUnitInput {
  granularity: Extract<HoverGranularity, "sentence" | "paragraph">;
  items: readonly PdfTextLayerItem[];
  currentIndex: number;
  currentOffset: number;
  sentenceSegmenter: Intl.Segmenter;
}

interface CombinedText {
  text: string;
  pieces: TextPiece[];
}

const PDF_TEXT_LAYER_SELECTOR = ".textLayer";
const SHOW_TEXT = 4;
const ASCII_OR_LATIN_RE = /[\p{Script=Latin}\p{Number}]/u;
const CJK_RE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u;
const NO_SPACE_BEFORE_RE = /^[,.;:!?%)}\]，。！？；：、）】》」』]/u;
const NO_SPACE_AFTER_RE = /[(\[{（【《「『]$/u;

export function pdfTextLayerHit(
  doc: Document,
  textNode: Text,
  hitRect: DOMRect,
  wordStart: number,
  sentenceSegmenter: Intl.Segmenter,
  granularity: HoverGranularity,
): { text: string; rect: DOMRect; range: Range } | null {
  if (granularity !== "sentence" && granularity !== "paragraph") return null;

  const context = collectPdfTextLayerItems(doc, textNode);
  if (!context) return null;

  const unit = resolvePdfTextLayerTextUnit({
    granularity,
    items: context.items,
    currentIndex: context.currentIndex,
    currentOffset: wordStart,
    sentenceSegmenter,
  });
  if (!unit) return null;

  const startItem = context.items[unit.startItemIndex];
  const endItem = context.items[unit.endItemIndex];
  if (!startItem || !endItem) return null;

  const range = doc.createRange();
  range.setStart(startItem.node, clampOffset(unit.startOffset, startItem.text));
  range.setEnd(endItem.node, clampOffset(unit.endOffset, endItem.text));

  return {
    text: unit.text,
    rect: usableDomRect(range.getBoundingClientRect(), hitRect),
    range,
  };
}

export function resolvePdfTextLayerTextUnit(
  input: ResolvePdfTextLayerTextUnitInput,
): PdfTextLayerTextUnit | null {
  const { items, currentIndex } = input;
  if (!items[currentIndex]?.text.trim()) return null;

  const lines = buildPdfLines(items);
  const currentLineIndex = lines.findIndex((line) =>
    line.items.some((item) => item.index === currentIndex),
  );
  if (currentLineIndex === -1) return null;

  const [startLine, endLine] = expandParagraphLines(lines, currentLineIndex);
  const paragraphItems = lines
    .slice(startLine, endLine + 1)
    .flatMap((line) => line.items);
  if (!paragraphItems.length) return null;

  const combined = combineTextItems(paragraphItems);
  const currentPiece = combined.pieces.find(
    (piece) => piece.itemIndex === currentIndex,
  );
  if (!currentPiece) return null;

  const currentOffset = currentPiece.start + input.currentOffset;
  const paragraphStart = combined.pieces[0]?.start ?? 0;
  const paragraphEnd = combined.pieces.at(-1)?.end ?? 0;

  if (input.granularity === "paragraph") {
    return unitFromOffsets({
      combined,
      items,
      start: paragraphStart,
      end: paragraphEnd,
      rect: unionRects(paragraphItems.map((item) => item.rect)),
    });
  }

  for (const sentence of input.sentenceSegmenter.segment(combined.text)) {
    const start = sentence.index;
    const end = start + sentence.segment.length;
    if (currentOffset < start || currentOffset >= end) continue;
    return unitFromOffsets({
      combined,
      items,
      start,
      end,
      rect: unionRects(paragraphItems.map((item) => item.rect)),
    });
  }

  return null;
}

function collectPdfTextLayerItems(
  doc: Document,
  currentNode: Text,
): { items: PdfTextLayerDomItem[]; currentIndex: number } | null {
  const currentElement = currentNode.parentElement;
  const layer = currentElement?.closest?.(PDF_TEXT_LAYER_SELECTOR);
  if (!layer) return null;

  const items: PdfTextLayerDomItem[] = [];
  let currentIndex = -1;
  const walker = doc.createTreeWalker(layer, SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const textNode = node as Text;
    const text = textNode.nodeValue ?? "";
    if (!text.trim()) continue;
    const element = textNode.parentElement;
    if (!element) continue;
    const rect = firstUsableRect(element.getClientRects());
    if (!rect) continue;
    const index = items.length;
    if (textNode === currentNode) currentIndex = index;
    items.push({ text, rect, node: textNode });
  }

  if (currentIndex === -1) return null;
  return { items, currentIndex };
}

function buildPdfLines(items: readonly PdfTextLayerItem[]): PdfLine[] {
  const lines: PdfLine[] = [];

  items.forEach((item, index) => {
    if (!item.text.trim() || !isUsableRect(item.rect)) return;
    const lineItem = { ...item, index };
    const currentLine = lines.at(-1);
    if (currentLine && isSameLine(currentLine.rect, item.rect)) {
      currentLine.items.push(lineItem);
      currentLine.rect = unionRects([currentLine.rect, item.rect]);
      return;
    }
    lines.push({ items: [lineItem], rect: item.rect });
  });

  return lines;
}

function expandParagraphLines(
  lines: readonly PdfLine[],
  currentLineIndex: number,
): [number, number] {
  let start = currentLineIndex;
  let end = currentLineIndex;

  while (start > 0 && shouldMergeLines(lines[start - 1]!, lines[start]!)) {
    start--;
  }
  while (
    end + 1 < lines.length &&
    shouldMergeLines(lines[end]!, lines[end + 1]!)
  ) {
    end++;
  }

  return [start, end];
}

function combineTextItems(items: readonly PdfLineItem[]): CombinedText {
  let text = "";
  const pieces: TextPiece[] = [];
  let previous = "";

  for (const item of items) {
    const separator = text && shouldInsertSpace(previous, item.text) ? " " : "";
    text += separator;
    const start = text.length;
    text += item.text;
    pieces.push({
      itemIndex: item.index,
      start,
      end: text.length,
      textLength: item.text.length,
    });
    previous = item.text;
  }

  return { text, pieces };
}

function unitFromOffsets(input: {
  combined: CombinedText;
  items: readonly PdfTextLayerItem[];
  start: number;
  end: number;
  rect: RectLike;
}): PdfTextLayerTextUnit | null {
  const start = trimStartOffset(input.combined.text, input.start, input.end);
  const end = trimEndOffset(input.combined.text, start, input.end);
  if (start >= end) return null;

  const startLocation = locateStart(input.combined.pieces, start);
  const endLocation = locateEnd(input.combined.pieces, end);
  if (!startLocation || !endLocation) return null;

  return {
    text: normalizePdfText(input.combined.text.slice(start, end)),
    startItemIndex: startLocation.itemIndex,
    startOffset: startLocation.offset,
    endItemIndex: endLocation.itemIndex,
    endOffset: endLocation.offset,
    rect: input.rect,
  };
}

function locateStart(
  pieces: readonly TextPiece[],
  offset: number,
): { itemIndex: number; offset: number } | null {
  for (const piece of pieces) {
    if (offset < piece.start) return { itemIndex: piece.itemIndex, offset: 0 };
    if (offset < piece.end) {
      return {
        itemIndex: piece.itemIndex,
        offset: offset - piece.start,
      };
    }
  }
  const last = pieces.at(-1);
  return last ? { itemIndex: last.itemIndex, offset: last.textLength } : null;
}

function locateEnd(
  pieces: readonly TextPiece[],
  offset: number,
): { itemIndex: number; offset: number } | null {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i]!;
    if (offset > piece.end) {
      return { itemIndex: piece.itemIndex, offset: piece.textLength };
    }
    if (offset > piece.start) {
      return {
        itemIndex: piece.itemIndex,
        offset: offset - piece.start,
      };
    }
  }
  const first = pieces[0];
  return first ? { itemIndex: first.itemIndex, offset: 0 } : null;
}

function trimStartOffset(text: string, start: number, end: number): number {
  let offset = start;
  while (offset < end && /\s/u.test(text[offset] ?? "")) offset++;
  return offset;
}

function trimEndOffset(text: string, start: number, end: number): number {
  let offset = end;
  while (offset > start && /\s/u.test(text[offset - 1] ?? "")) offset--;
  return offset;
}

function normalizePdfText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function isSameLine(a: RectLike, b: RectLike): boolean {
  const tolerance = Math.max(2, Math.min(a.height, b.height) * 0.55);
  return Math.abs(centerY(a) - centerY(b)) <= tolerance;
}

function shouldMergeLines(previous: PdfLine, next: PdfLine): boolean {
  const height = Math.max(previous.rect.height, next.rect.height, 1);
  const verticalGap = next.rect.top - previous.rect.bottom;
  if (verticalGap < -height * 0.35) return false;
  return verticalGap <= height * 1.35;
}

function shouldInsertSpace(previous: string, next: string): boolean {
  const previousEnd = lastNonWhitespace(previous);
  const nextStart = firstNonWhitespace(next);
  if (!previousEnd || !nextStart) return false;
  if (NO_SPACE_BEFORE_RE.test(nextStart) || NO_SPACE_AFTER_RE.test(previousEnd)) {
    return false;
  }
  if (CJK_RE.test(previousEnd) && CJK_RE.test(nextStart)) return false;
  return ASCII_OR_LATIN_RE.test(previousEnd) || ASCII_OR_LATIN_RE.test(nextStart);
}

function firstNonWhitespace(text: string): string {
  return text.trimStart().slice(0, 1);
}

function lastNonWhitespace(text: string): string {
  return text.trimEnd().slice(-1);
}

function centerY(rect: RectLike): number {
  return rect.top + rect.height / 2;
}

function firstUsableRect(rects: DOMRectList): DOMRect | null {
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (rect && isUsableRect(rect)) return rect;
  }
  return null;
}

function isUsableRect(rect: RectLike | undefined): rect is RectLike {
  return Boolean(
    rect &&
      Number.isFinite(rect.left) &&
      Number.isFinite(rect.top) &&
      rect.width > 0 &&
      rect.height > 0,
  );
}

function unionRects(rects: readonly RectLike[]): RectLike {
  const usable = rects.filter(isUsableRect);
  const first = usable[0];
  if (!first) {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  let left = first.left;
  let top = first.top;
  let right = first.right;
  let bottom = first.bottom;
  for (const rect of usable.slice(1)) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function clampOffset(offset: number, text: string): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, offset), text.length);
}

function usableDomRect(rect: DOMRect, fallback: DOMRect): DOMRect {
  if (isUsableRect(rect)) return rect;
  return fallback;
}
