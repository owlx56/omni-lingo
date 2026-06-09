import { describe, expect, test } from "bun:test";

import {
  READEST_DEFAULT_LINE_HEIGHT,
  READEST_DEFAULT_FONT_SIZE,
  READEST_DEFAULT_TEXT_INDENT,
  FOLIATE_CONTENT_STYLE_ID,
  applyFoliateContentCss,
  applyFoliateReaderStyleSettings,
  applyFoliateViewContentCss,
  bindFoliateContentTransforms,
  createFoliateContentCss,
  createFoliateContentCssFromSource,
  transformFoliateContentHtml,
  transformFoliateContentCss,
} from "./reader-content-style.ts";

describe("createFoliateContentCss", () => {
  test("uses OneLingo's default reader font size", () => {
    const css = createFoliateContentCss("light");

    expect(READEST_DEFAULT_FONT_SIZE).toBe(16);
    expect(css).toContain("font-size:17px!important");
    expect(css).toContain("--font-size:17px");
  });

  test("keeps the EPUB font family by not injecting a reader font family", () => {
    const css = createFoliateContentCss("light", {
      fontSize: 18,
      lineHeight: 1.6,
      textIndent: true,
      useBookLayout: false,
    });

    expect(css).toContain("font-size:18px!important");
    expect(css).not.toContain("font-family:");
  });

  test("defines Readest-compatible font variables for transformed book CSS", () => {
    const css = createFoliateContentCss("light", {
      fontSize: 19,
      lineHeight: 1.6,
      textIndent: false,
      useBookLayout: false,
    });

    expect(css).toContain("--font-size:19px");
    expect(css).toContain("--serif:serif");
    expect(css).toContain("--sans-serif:sans-serif");
    expect(css).toContain("--monospace:monospace");
    expect(css).toContain("--theme-fg-color:#1f1e1d");
  });

  test("uses the viewer shell background for light reader content", () => {
    const css = createFoliateContentCss("light");

    expect(css).toContain("--theme-bg-color:#f8f8f6");
    expect(css).toContain("background:#f8f8f6!important");
    expect(css).not.toContain("background:#ffffff!important");
  });

  test("marks theme colors as overrides for Foliate paginator backgrounds", () => {
    const css = createFoliateContentCss("light");

    expect(css).toContain("--override-color:true");
  });

  test("adds Readest-compatible legacy font-size overrides", () => {
    const css = createFoliateContentCss("light", {
      fontSize: 18,
      lineHeight: 1.6,
      textIndent: false,
      useBookLayout: false,
    });

    expect(css).toContain('font[size="3"]{font-size:18px;}');
    expect(css).toContain('[style*="font-size: 16px"],[style*="font-size:16px"]{font-size:1rem!important;}');
  });

  test("applies paragraph layout when book layout is disabled", () => {
    const css = createFoliateContentCss("light", {
      fontSize: 18,
      lineHeight: 1.6,
      textIndent: true,
      useBookLayout: false,
    });

    expect(READEST_DEFAULT_LINE_HEIGHT).toBe(1.4);
    expect(READEST_DEFAULT_TEXT_INDENT).toBe(0);
    expect(css).toContain("line-height:1.6!important");
    expect(css).toContain("text-indent:2em!important");
  });

  test("Use Book Layout skips paragraph layout but keeps font size control", () => {
    const css = createFoliateContentCss("light", {
      fontSize: 20,
      lineHeight: 1.8,
      textIndent: true,
      useBookLayout: true,
    });

    expect(css).toContain("font-size:20px!important");
    expect(css).not.toContain("line-height:1.8!important");
    expect(css).not.toContain("text-indent:2em!important");
  });

  test("keeps full-page images inside Foliate's available reading height", () => {
    const css = createFoliateContentCss("light");

    expect(css).toContain("max-height:calc(var(--available-height) * 1px)!important");
    expect(css).toContain("object-fit:contain!important");
    expect(css).toContain("break-inside:avoid!important");
  });

  test("updates the shared reader content style element", () => {
    let existing = null;
    const created = {
      id: "",
      parentNode: null,
      textContent: "",
    };
    const head = {
      appendChild(node) {
        node.parentNode = head;
        existing = node;
      },
    };
    const doc = {
      createElement: () => created,
      documentElement: head,
      getElementById: (id) => (id === FOLIATE_CONTENT_STYLE_ID ? existing : null),
      head,
    };

    applyFoliateContentCss(doc, "body{font-size:18px}");
    applyFoliateContentCss(doc, "body{font-size:20px}");

    expect(existing).toBe(created);
    expect(created.id).toBe(FOLIATE_CONTENT_STYLE_ID);
    expect(created.textContent).toBe("body{font-size:20px}");
  });

  test("syncs reader CSS through Foliate renderer and loaded documents", () => {
    const docs = [makeDocumentDouble(), makeDocumentDouble()];
    let rendererCss = "";
    const view = {
      renderer: {
        setStyles(css) {
          rendererCss = css;
        },
      },
      getContents() {
        return docs.map((doc) => ({ doc }));
      },
    };

    applyFoliateViewContentCss(view, "html{font-size:20px!important}");

    expect(rendererCss).toBe("html{font-size:20px!important}");
    for (const doc of docs) {
      expect(doc.created.id).toBe(FOLIATE_CONTENT_STYLE_ID);
      expect(doc.created.textContent).toBe("html{font-size:20px!important}");
    }
  });

  test("syncs loaded documents exposed directly by the Foliate renderer", () => {
    const docs = [makeDocumentDouble()];
    const view = {
      renderer: {
        getContents() {
          return docs.map((doc) => ({ doc }));
        },
        setStyles() {},
      },
    };

    applyFoliateViewContentCss(view, "html{font-size:21px!important}");

    expect(docs[0].created.textContent).toBe("html{font-size:21px!important}");
  });

  test("does not directly re-render Foliate after live style updates", () => {
    let renderCount = 0;
    const view = {
      renderer: {
        render() {
          renderCount += 1;
        },
        setStyles() {},
      },
      getContents() {
        return [];
      },
    };

    applyFoliateViewContentCss(view, "html{font-size:22px!important}");

    expect(renderCount).toBe(0);
  });

  test("can request a Foliate relayout for live font-size updates", () => {
    let renderCount = 0;
    const view = {
      renderer: {
        render() {
          renderCount += 1;
        },
        setStyles() {},
      },
      getContents() {
        return [];
      },
    };

    applyFoliateViewContentCss(
      view,
      "html{font-size:22px!important}",
      { relayout: true },
    );

    expect(renderCount).toBe(1);
  });

  test("updates loaded documents before requesting a Foliate relayout", () => {
    const events = [];
    const docs = [makeDocumentDouble(events)];
    const view = {
      renderer: {
        render() {
          events.push("render");
        },
        setStyles() {
          events.push("setStyles");
        },
      },
      getContents() {
        return docs.map((doc) => ({ doc }));
      },
    };

    applyFoliateViewContentCss(
      view,
      "html{font-size:24px!important}",
      { relayout: true },
    );

    expect(events).toEqual(["setStyles", "document", "render"]);
    expect(docs[0].created.textContent).toBe("html{font-size:24px!important}");
  });

  test("writes reader settings to Foliate even when the caller has the same previous settings", () => {
    const docs = [makeDocumentDouble()];
    const calls = [];
    const view = {
      renderer: {
        render() {
          calls.push("render");
        },
        setStyles(css) {
          calls.push(css);
        },
      },
      getContents() {
        return docs.map((doc) => ({ doc }));
      },
    };
    const settings = {
      fontSize: 18,
      lineHeight: 1.6,
      textIndent: true,
      useBookLayout: false,
    };

    applyFoliateReaderStyleSettings(view, "light", settings, {
      previous: settings,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("font-size:18px!important");
    expect(calls[0]).toContain("line-height:1.6!important");
    expect(docs[0].created.textContent).toContain("text-indent:2em!important");
  });

  test("uses the current reader settings instead of stale bridge prefs", () => {
    const staleSettings = {
      fontSize: 16,
      lineHeight: 1.4,
      textIndent: false,
      useBookLayout: false,
    };
    const currentSettings = {
      fontSize: 23,
      lineHeight: 1.9,
      textIndent: true,
      useBookLayout: false,
    };

    const css = createFoliateContentCssFromSource({
      getReaderSettings: () => currentSettings,
      readerSettings: staleSettings,
      theme: "light",
    });

    expect(css).toContain("font-size:23px!important");
    expect(css).toContain("line-height:1.9!important");
    expect(css).toContain("text-indent:2em!important");
    expect(css).not.toContain("font-size:16px!important");
  });

  test("uses the current reader accessor before stale bridge watcher settings", () => {
    const currentAccessorSettings = {
      fontSize: 24,
      lineHeight: 1.7,
      textIndent: true,
      useBookLayout: false,
    };
    const staleWatcherSettings = {
      fontSize: 16,
      lineHeight: 1.4,
      textIndent: false,
      useBookLayout: false,
    };

    const css = createFoliateContentCssFromSource({
      getReaderSettings: () => currentAccessorSettings,
      readerSettings: staleWatcherSettings,
      readerSettingsOverride: staleWatcherSettings,
      theme: "light",
    });

    expect(css).toContain("font-size:24px!important");
    expect(css).toContain("line-height:1.7!important");
    expect(css).toContain("text-indent:2em!important");
    expect(css).not.toContain("font-size:16px!important");
  });
});

describe("transformFoliateContentCss", () => {
  test("removes external local font-face rules before Foliate creates blob URLs", () => {
    const css = [
      "@font-face{font-family:KT;src:url(res:///fonts/ktpy.ttf),url('file:///mnt/us/fonts/ktpy.ttf');}",
      "body{font-family:KT,serif;}",
    ].join("\n");

    const transformed = transformFoliateContentCss(css, {
      height: 800,
      vertical: false,
      width: 1000,
    });

    expect(transformed).not.toContain("@font-face");
    expect(transformed).not.toContain("res:///");
    expect(transformed).not.toContain("file:///");
    expect(transformed).toContain("var(--serif, serif)");
  });

  test("converts absolute book font sizes to rem so live reader font size updates take effect", () => {
    const transformed = transformFoliateContentCss(
      ".normal{font-size:16px}.small{font-size:12pt}.named{font-size:medium}",
      {
        height: 800,
        vertical: false,
        width: 1000,
      },
    );

    expect(transformed).toContain("font-size:max(1rem,var(--min-font-size,8px))");
    expect(transformed).toContain("font-size:max(1rem,var(--min-font-size,8px))");
    expect(transformed).not.toContain("font-size:16px");
    expect(transformed).not.toContain("font-size:12pt");
    expect(transformed).not.toContain("font-size:medium");
  });

  test("replaces viewport units and user-select none like Readest", () => {
    const transformed = transformFoliateContentCss(
      ".page{width:50vw;height:25vh;user-select:none;-webkit-user-select:none}",
      {
        height: 800,
        vertical: false,
        width: 1000,
      },
    );

    expect(transformed).toContain("width:500px");
    expect(transformed).toContain("height:200px");
    expect(transformed).toContain("user-select:unset");
    expect(transformed).toContain("-webkit-user-select:unset");
  });
});

describe("transformFoliateContentHtml", () => {
  test("transforms style elements and inline style attributes in HTML content", () => {
    const transformed = transformFoliateContentHtml(
      [
        "<html><head>",
        "<style>@font-face{font-family:KT;src:url(res:///fonts/ktpy.ttf)}.text{font-size:16px}</style>",
        "</head><body><p style=\"font-size: 12pt; user-select: none\">Text</p></body></html>",
      ].join(""),
      {
        height: 800,
        vertical: false,
        width: 1000,
      },
    );

    expect(transformed).not.toContain("@font-face");
    expect(transformed).not.toContain("res:///");
    expect(transformed).toContain("font-size:max(1rem,var(--min-font-size,8px))");
    expect(transformed).toContain("user-select:unset");
  });
});

describe("bindFoliateContentTransforms", () => {
  test("chains Foliate data event CSS transforms through detail.data", async () => {
    const target = new EventTarget();
    const stop = bindFoliateContentTransforms(target, () => ({
      height: 800,
      vertical: false,
      width: 1000,
    }));
    const detail = {
      data: "@font-face{font-family:KT;src:url(res:///fonts/ktpy.ttf)}.text{font-size:16px}",
      name: "chapter.css",
      type: "text/css",
    };

    target.dispatchEvent(new CustomEvent("data", { detail }));
    const transformed = await detail.data;
    stop();

    expect(transformed).not.toContain("@font-face");
    expect(transformed).toContain("font-size:max(1rem,var(--min-font-size,8px))");
  });

  test("leaves non-text resources untouched", async () => {
    const target = new EventTarget();
    const stop = bindFoliateContentTransforms(target, () => ({
      height: 800,
      vertical: false,
      width: 1000,
    }));
    const blob = new Blob(["abc"], { type: "image/png" });
    const detail = {
      data: blob,
      name: "cover.png",
      type: "image/png",
    };

    target.dispatchEvent(new CustomEvent("data", { detail }));
    stop();

    expect(await detail.data).toBe(blob);
  });
});

function makeDocumentDouble(events) {
  let existing = null;
  const created = {
    id: "",
    parentNode: null,
    textContent: "",
  };
  const head = {
    appendChild(node) {
      events?.push("document");
      node.parentNode = head;
      existing = node;
    },
  };
  return {
    created,
    createElement: () => created,
    documentElement: head,
    getElementById: (id) => (id === FOLIATE_CONTENT_STYLE_ID ? existing : null),
    head,
  };
}
