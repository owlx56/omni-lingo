import { describe, expect, test } from "bun:test";

import {
  PDFJS_VERBOSITY_ERRORS,
  setPdfJsVerbosityToErrors,
} from "./pdfjs-options.ts";

describe("setPdfJsVerbosityToErrors", () => {
  test("sets the PDF.js viewer verbosity to errors only", () => {
    const calls = [];
    const options = {
      set(name, value) {
        calls.push([name, value, this === options]);
      },
    };

    expect(
      setPdfJsVerbosityToErrors({ PDFViewerApplicationOptions: options }),
    ).toBe(true);

    expect(calls).toEqual([["verbosity", PDFJS_VERBOSITY_ERRORS, true]]);
  });

  test("is a no-op before PDF.js exposes viewer options", () => {
    expect(setPdfJsVerbosityToErrors({})).toBe(false);
  });
});
