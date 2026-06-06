import { describe, expect, test } from "bun:test";

import {
  getReaderChromeLayout,
  getReaderChromeState,
} from "./reader-chrome.ts";

describe("getReaderChromeState", () => {
  test("shows the chapter title only when the top hover chrome is not active", () => {
    expect(getReaderChromeState(null)).toEqual({
      showBookTitle: false,
      showChapterTitle: true,
      showModeSwitch: false,
      showSectionNavigation: false,
    });

    expect(getReaderChromeState("bottom")).toEqual({
      showBookTitle: false,
      showChapterTitle: true,
      showModeSwitch: false,
      showSectionNavigation: true,
    });
  });

  test("shows the book title and mode switch only in the top hover chrome", () => {
    expect(getReaderChromeState("top")).toEqual({
      showBookTitle: true,
      showChapterTitle: false,
      showModeSwitch: true,
      showSectionNavigation: false,
    });
  });
});

describe("getReaderChromeLayout", () => {
  test("reserves top and bottom chrome space for the render surface", () => {
    expect(getReaderChromeLayout("pages")).toEqual({
      reserveChromeSpace: true,
    });

    expect(getReaderChromeLayout("scroll")).toEqual({
      reserveChromeSpace: true,
    });
  });
});
