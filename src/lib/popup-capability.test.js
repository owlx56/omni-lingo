import { describe, expect, test } from "bun:test";

import {
  classifyPopupCapability,
  popupCanToggleClickToShowOriginal,
  popupCanToggleFeatureControls,
  popupCanTranslatePage,
  popupLoadsPageFeatureStatus,
  popupPathForCapability,
  popupShowsFeatureControls,
  popupShowsPageControls,
} from "./popup-capability.ts";

const OWN_BASE = "chrome-extension://omni-lingo-id/";

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

  test("classifies supported Omni Lingo extension pages by popup content", () => {
    expect(
      classifyPopupCapability(
        "chrome-extension://omni-lingo-id/options.html",
        OWN_BASE,
      ),
    ).toBe("options");
    expect(
      classifyPopupCapability(
        "chrome-extension://omni-lingo-id/pdf/web/viewer.html?file=test.pdf",
        OWN_BASE,
      ),
    ).toBe("reader");
    expect(
      classifyPopupCapability(
        "chrome-extension://omni-lingo-id/foliate/web/viewer.html?file=test.epub",
        OWN_BASE,
      ),
    ).toBe("reader");
    expect(
      classifyPopupCapability(
        "chrome-extension://omni-lingo-id/viewer.html?url=https%3A%2F%2Fa.test%2Fa.pdf",
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

  test("renders the same toolbar popup controls for every page type", () => {
    expect(popupShowsPageControls("web")).toBe(true);
    expect(popupShowsPageControls("reader")).toBe(true);
    expect(popupShowsPageControls("options")).toBe(true);
    expect(popupShowsPageControls("unsupported")).toBe(true);

    expect(popupShowsFeatureControls("web")).toBe(true);
    expect(popupShowsFeatureControls("reader")).toBe(true);
    expect(popupShowsFeatureControls("options")).toBe(true);
    expect(popupShowsFeatureControls("unsupported")).toBe(true);
  });

  test("enables only actions that can affect the current page", () => {
    expect(popupCanTranslatePage("web")).toBe(true);
    expect(popupCanTranslatePage("reader")).toBe(false);
    expect(popupCanTranslatePage("options")).toBe(false);
    expect(popupCanTranslatePage("unsupported")).toBe(false);

    expect(popupCanToggleClickToShowOriginal("web")).toBe(true);
    expect(popupCanToggleClickToShowOriginal("reader")).toBe(false);
    expect(popupCanToggleClickToShowOriginal("options")).toBe(false);
    expect(popupCanToggleClickToShowOriginal("unsupported")).toBe(false);

    expect(popupCanToggleFeatureControls("web")).toBe(true);
    expect(popupCanToggleFeatureControls("reader")).toBe(true);
    expect(popupCanToggleFeatureControls("options")).toBe(false);
    expect(popupCanToggleFeatureControls("unsupported")).toBe(false);
  });

  test("loads page feature status only for pages with live feature controls", () => {
    expect(popupLoadsPageFeatureStatus("web")).toBe(true);
    expect(popupLoadsPageFeatureStatus("reader")).toBe(true);
    expect(popupLoadsPageFeatureStatus("options")).toBe(false);
    expect(popupLoadsPageFeatureStatus("unsupported")).toBe(false);
  });
});
