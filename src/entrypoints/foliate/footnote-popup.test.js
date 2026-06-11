import { describe, expect, test } from "bun:test";

import {
  FOLIATE_FOOTNOTE_POPUP_DEFAULT_HEIGHT,
  FOLIATE_FOOTNOTE_POPUP_DEFAULT_WIDTH,
  clampFootnotePopupPosition,
  configureFootnotePopupRenderer,
  createFoliateFootnoteContentCss,
  getFootnoteAnchorPosition,
  getFootnotePopupSize,
  getFootnotePopupPosition,
  isFoliateReaderUiTarget,
  shouldPromoteFootnoteDetection,
  shouldCheckAsFootnote,
} from "./footnote-popup.ts";

class FakeDOMRect {
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.left = x;
    this.top = y;
    this.right = x + width;
    this.bottom = y + height;
  }
}

class FakeElement {
  constructor({
    classes = [],
    epubType = "",
    parent = null,
    role = "",
    tag = "a",
    text = "",
  } = {}) {
    this.children = [];
    this.parentElement = parent;
    this.style = { verticalAlign: "" };
    this.tag = tag;
    this.textContent = text;
    this._classes = new Set(classes);
    this._epubType = epubType;
    this._role = role;
    this._rects = [new FakeDOMRect()];
    this.classList = {
      contains: (className) => this._classes.has(className),
    };
    if (parent) parent.children.push(this);
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (selector.includes(".foliate-footnote-popup") && current._classes.has("foliate-footnote-popup")) {
        return current;
      }
      if (
        selector.includes("[data-omni-lingo-reader-ui]") &&
        current._readerUi
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  getAttribute(name) {
    if (name === "role") return this._role;
    if (name === "epub:type") return this._epubType;
    return null;
  }

  getAttributeNS(_namespace, name) {
    return name === "type" ? this._epubType : null;
  }

  getBoundingClientRect() {
    return this._rects[0] ?? new FakeDOMRect();
  }

  getClientRects() {
    return this._rects;
  }

  matches(selector) {
    return selector === "sup" ? this.tag === "sup" : false;
  }

  querySelectorAll(selector) {
    if (selector !== "a") return [];
    const links = [];
    const visit = (node) => {
      if (node.tag === "a") links.push(node);
      for (const child of node.children) visit(child);
    };
    visit(this);
    return links;
  }
}

globalThis.DOMRect = FakeDOMRect;
globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeElement;

function anchor(options) {
  return new FakeElement({ tag: "a", ...options });
}

function setRects(element, rects) {
  element.getClientRects = () => rects;
  element.getBoundingClientRect = () => rects[0] ?? new FakeDOMRect();
}

describe("shouldCheckAsFootnote", () => {
  test("recognizes explicit EPUB and ARIA note references", () => {
    const epubAnchor = anchor({ epubType: "noteref", text: "1" });
    const roleAnchor = anchor({ role: "doc-noteref", text: "2" });

    expect(shouldCheckAsFootnote(epubAnchor)).toBe(true);
    expect(shouldCheckAsFootnote(roleAnchor)).toBe(true);
  });

  test("recognizes superscript numeric note markers", () => {
    const sup = new FakeElement({ tag: "sup" });
    const supAnchor = anchor({ parent: sup, text: "1" });
    const classAnchor = anchor({ classes: ["footnote-link"], text: "[2]" });
    const plainNumericAnchor = anchor({ text: "3" });

    expect(shouldCheckAsFootnote(supAnchor)).toBe(true);
    expect(shouldCheckAsFootnote(classAnchor)).toBe(true);
    expect(shouldCheckAsFootnote(plainNumericAnchor)).toBe(true);
  });

  test("does not treat normal chapter links as footnotes", () => {
    const chapterAnchor = anchor({ text: "Chapter 7" });

    expect(shouldCheckAsFootnote(chapterAnchor)).toBe(false);
  });

  test("does not treat dense numeric navigation lists as footnotes", () => {
    const nav = new FakeElement({ tag: "nav" });
    const first = anchor({ parent: nav, text: "1" });
    anchor({ parent: nav, text: "2" });
    anchor({ parent: nav, text: "3" });
    anchor({ parent: nav, text: "4" });

    expect(shouldCheckAsFootnote(first)).toBe(false);
  });
});

describe("shouldPromoteFootnoteDetection", () => {
  test("promotes short numeric links with fragment targets", () => {
    expect(shouldPromoteFootnoteDetection(anchor({ text: "3" }), "notes.xhtml#fn3")).toBe(true);
  });

  test("does not promote plain numeric chapter links without a fragment", () => {
    expect(shouldPromoteFootnoteDetection(anchor({ text: "1" }), "chapter01.xhtml")).toBe(false);
  });
});

describe("footnote popup positioning", () => {
  test("uses Readest compact default size when the reader area has room", () => {
    expect(getFootnotePopupSize(new FakeDOMRect(0, 0, 900, 600))).toEqual({
      height: FOLIATE_FOOTNOTE_POPUP_DEFAULT_HEIGHT,
      scrollable: false,
      width: FOLIATE_FOOTNOTE_POPUP_DEFAULT_WIDTH,
    });
  });

  test("shrinks to the rendered footnote content height", () => {
    expect(getFootnotePopupSize(new FakeDOMRect(0, 0, 900, 600), 12, 48)).toEqual({
      height: 48,
      scrollable: false,
      width: FOLIATE_FOOTNOTE_POPUP_DEFAULT_WIDTH,
    });
  });

  test("caps tall rendered footnotes and marks them scrollable", () => {
    expect(getFootnotePopupSize(new FakeDOMRect(0, 0, 900, 600), 12, 520)).toEqual({
      height: 270,
      scrollable: true,
      width: FOLIATE_FOOTNOTE_POPUP_DEFAULT_WIDTH,
    });
  });

  test("anchors to the clicked note marker", () => {
    const noteAnchor = anchor({ text: "1" });
    setRects(noteAnchor, [new FakeDOMRect(220, 120, 20, 14)]);

    expect(
      getFootnoteAnchorPosition(noteAnchor, new FakeDOMRect(100, 80, 500, 400), 12),
    ).toEqual({
      dir: "down",
      point: { x: 130, y: 66 },
    });
  });

  test("clamps popup coordinates inside the reader area", () => {
    expect(
      clampFootnotePopupPosition(
        { dir: "up", point: { x: 8, y: 10 } },
        { width: 240, height: 120 },
        new FakeDOMRect(0, 0, 300, 200),
        12,
      ),
    ).toEqual({
      dir: "up",
      point: { x: 12, y: 12 },
    });
  });

  test("converts anchor point to a clamped popup top-left position", () => {
    expect(
      getFootnotePopupPosition(
        { dir: "down", point: { x: 130, y: 66 } },
        { width: 240, height: 120 },
        new FakeDOMRect(0, 0, 500, 400),
        12,
      ),
    ).toEqual({
      dir: "down",
      point: { x: 12, y: 66 },
    });
  });
});

describe("footnote reader UI boundary", () => {
  test("marks footnote popup chrome as reader UI", () => {
    const popup = new FakeElement({ classes: ["foliate-footnote-popup"], tag: "div" });
    const button = new FakeElement({ parent: popup, tag: "button" });
    const target = new FakeElement({ parent: button, tag: "span", text: "x" });

    expect(isFoliateReaderUiTarget(target)).toBe(true);
  });
});

describe("configureFootnotePopupRenderer", () => {
  test("clears Foliate scrolled renderer margin that creates popup whitespace", () => {
    const attributes = new Map();
    let appliedStyles = "";
    const renderer = {
      setAttribute(name, value) {
        attributes.set(name, value);
      },
      setStyles(styles) {
        appliedStyles = styles;
      },
    };

    configureFootnotePopupRenderer(renderer, "body{margin:0}");

    expect(attributes.get("flow")).toBe("scrolled");
    expect(attributes.get("margin")).toBe("0px");
    expect(attributes.get("margin-top")).toBe("0px");
    expect(attributes.get("gap")).toBe("0%");
    expect(appliedStyles).toBe("body{margin:0}");
  });
});

describe("createFoliateFootnoteContentCss", () => {
  test("shows hidden footnote blocks in popup content", () => {
    const css = createFoliateFootnoteContentCss("light");

    expect(css).toContain("aside[epub|type~=\"footnote\"]");
    expect(css).toContain("display:block!important");
    expect(css).toContain("body{");
  });

  test("removes reader-page whitespace from popup content", () => {
    const css = createFoliateFootnoteContentCss("light");

    expect(css).toContain("html{margin:0!important;padding:0!important;min-height:0!important;height:auto!important;}");
    expect(css).toContain("body{margin:0!important;padding:12px!important;min-height:0!important;height:auto!important;overflow-wrap:break-word;}");
    expect(css).toContain("body>:first-child{margin-top:0!important;}");
    expect(css).toContain("body>:last-child{margin-bottom:0!important;}");
  });

  test("hides iframe scrollbars until the popup enters scrollable mode", () => {
    const css = createFoliateFootnoteContentCss("light");

    expect(css).toContain("html,body{-ms-overflow-style:none;scrollbar-width:none;}");
    expect(css).toContain("::-webkit-scrollbar{display:none;width:0;height:0;}");
    expect(css).not.toContain("scrollbar-width:thin");
  });

  test("uses dropdown-style iframe scrollbars for tall scrollable notes", () => {
    const css = createFoliateFootnoteContentCss("dark", null, true);

    expect(css).toContain("html,body{scrollbar-color:rgba(255,255,255,.36) transparent;scrollbar-width:thin;}");
    expect(css).toContain("::-webkit-scrollbar{width:8px;height:8px;}");
    expect(css).toContain("::-webkit-scrollbar-thumb{min-height:36px;border:2px solid transparent;border-radius:999px;");
  });
});
