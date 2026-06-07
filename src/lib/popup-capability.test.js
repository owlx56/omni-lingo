import { describe, expect, test } from "bun:test";

import {
  classifyPopupCapability,
  popupPathForCapability,
  popupShowsFeatureControls,
  popupShowsPageControls,
} from "./popup-capability.ts";

const OWN_BASE = "chrome-extension://onelingo-id/";

describe("popup capability classification", () => {
  test("uses the full web popup on ordinary web and file pages", () => {
    expect(classifyPopupCapability("https://example.com/page", OWN_BASE)).toBe(
      "web",
    );
    expect(classifyPopupCapability("http://localhost:3000", OWN_BASE)).toBe(
      "web",
    );
    expect(classifyPopupCapability("file:///C:/Books/book.html", OWN_BASE)).toBe(
      "web",
    );
  });

  test("classifies supported OneLingo extension pages by popup content", () => {
    expect(
      classifyPopupCapability(
        "chrome-extension://onelingo-id/options.html",
        OWN_BASE,
      ),
    ).toBe("options");
    expect(
      classifyPopupCapability(
        "chrome-extension://onelingo-id/pdf/web/viewer.html?file=test.pdf",
        OWN_BASE,
      ),
    ).toBe("reader");
    expect(
      classifyPopupCapability(
        "chrome-extension://onelingo-id/foliate/web/viewer.html?file=test.epub",
        OWN_BASE,
      ),
    ).toBe("reader");
    expect(
      classifyPopupCapability(
        "chrome-extension://onelingo-id/viewer.html?url=https%3A%2F%2Fa.test%2Fa.pdf",
        OWN_BASE,
      ),
    ).toBe("reader");
  });

  test("falls back to the native unsupported popup on protected pages", () => {
    for (const url of [
      undefined,
      "",
      "chrome://extensions",
      "edge://settings",
      "about:addons",
      "view-source:https://example.com",
      "chrome-extension://other-extension/options.html",
      "moz-extension://other-extension/options.html",
      "https://chromewebstore.google.com/detail/test",
      "https://addons.mozilla.org/firefox/addon/test",
    ]) {
      expect(classifyPopupCapability(url, OWN_BASE)).toBe("unsupported");
    }
  });

  test("always uses the native toolbar popup shell", () => {
    expect(popupPathForCapability("web")).toBe("popup.html");
    expect(popupPathForCapability("reader")).toBe("popup.html");
    expect(popupPathForCapability("options")).toBe("popup.html");
    expect(popupPathForCapability("unsupported")).toBe("popup.html");
  });

  test("shows concrete controls only where they can affect the current page", () => {
    expect(popupShowsPageControls("web")).toBe(true);
    expect(popupShowsPageControls("reader")).toBe(false);
    expect(popupShowsPageControls("options")).toBe(false);
    expect(popupShowsPageControls("unsupported")).toBe(false);

    expect(popupShowsFeatureControls("web")).toBe(true);
    expect(popupShowsFeatureControls("reader")).toBe(true);
    expect(popupShowsFeatureControls("options")).toBe(false);
    expect(popupShowsFeatureControls("unsupported")).toBe(false);
  });
});
