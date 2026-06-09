import { describe, expect, test } from "bun:test";

import { resolvePdfTextLayerTextUnit } from "./pdf-text-layer.ts";

function rect(left, top, width, height) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function item(text, left, top, width = 160, height = 12) {
  return { text, rect: rect(left, top, width, height) };
}

describe("resolvePdfTextLayerTextUnit", () => {
  test("keeps a sentence intact when PDF text layer splits it at a line end", () => {
    const sentSeg = new Intl.Segmenter("en", { granularity: "sentence" });
    const items = [
      item("This sentence starts near", 20, 20),
      item("the margin and continues", 20, 36),
      item("after the line break. Next sentence.", 20, 52, 220),
    ];

    const hit = resolvePdfTextLayerTextUnit({
      granularity: "sentence",
      items,
      currentIndex: 1,
      currentOffset: "the margin".length,
      sentenceSegmenter: sentSeg,
    });

    expect(hit?.text).toBe(
      "This sentence starts near the margin and continues after the line break.",
    );
    expect(hit?.startItemIndex).toBe(0);
    expect(hit?.endItemIndex).toBe(2);
  });

  test("keeps paragraph hover inside the current PDF text block", () => {
    const sentSeg = new Intl.Segmenter("en", { granularity: "sentence" });
    const items = [
      item("First paragraph starts here", 20, 20),
      item("and continues on another PDF line.", 20, 36, 230),
      item("Second paragraph starts after a larger gap.", 20, 74, 260),
    ];

    const hit = resolvePdfTextLayerTextUnit({
      granularity: "paragraph",
      items,
      currentIndex: 1,
      currentOffset: 8,
      sentenceSegmenter: sentSeg,
    });

    expect(hit?.text).toBe(
      "First paragraph starts here and continues on another PDF line.",
    );
    expect(hit?.startItemIndex).toBe(0);
    expect(hit?.endItemIndex).toBe(1);
  });
});
