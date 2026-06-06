import { describe, expect, test } from "bun:test";

import {
  patchFoliateFixedLayoutScript,
  patchFoliatePdfScript,
  patchFoliatePaginatorScript,
} from "./foliate-runtime-patches.ts";

describe("patchFoliatePaginatorScript", () => {
  test("aligns Readest-style multi-view section widths to whole spreads", () => {
    const source = [
      "class View {",
      "    expand() {",
      "        if (this.#column) {",
      "            const columnSize = this.#size / this.#columnCount",
      "            const pageCount = Math.ceil(contentSize / columnSize)",
      "            this.#contentPages = pageCount",
      "            const expandedSize = pageCount * columnSize",
      "            this.#element.style.padding = '0'",
      "            this.#iframe.style[side] = `${expandedSize}px`",
      "            this.#element.style[side] = `${expandedSize}px`",
      "            this.#iframe.style[otherSide] = '100%'",
      "            this.#element.style[otherSide] = '100%'",
      "            documentElement.style[side] = `${columnSize}px`",
      "            if (this.#overlayer) {",
      "                this.#overlayer.element.style.margin = '0'",
      "                this.#overlayer.element.style.left = '0'",
      "                this.#overlayer.element.style.top = '0'",
      "                this.#overlayer.element.style[side] = `${expandedSize}px`",
      "                this.#overlayer.redraw()",
      "            }",
      "        }",
      "    }",
      "}",
      "",
    ].join("\n");

    const patched = patchFoliatePaginatorScript(source);

    expect(patched).toContain("this.#contentPages = pageCount");
    expect(patched).toContain(
      "const spreadSize = this.#columnCount > 1 ? this.#size : columnSize",
    );
    expect(patched).toContain(
      "const alignedSize = spreadSize > 0 ? Math.ceil(expandedSize / spreadSize) * spreadSize : expandedSize",
    );
    expect(patched).toContain("this.#iframe.style[side] = `${alignedSize}px`");
    expect(patched).toContain("this.#element.style[side] = `${alignedSize}px`");
    expect(patched).toContain(
      "this.#overlayer.element.style[side] = `${alignedSize}px`",
    );
  });

  test("patches legacy upstream paginator guards when present", () => {
    const source = [
      "class Paginator {",
      "    async #goTo({ index, anchor, select}) {",
      "        if (index === this.#index) await this.#display({ index, anchor, select })",
      "    }",
      "    async goTo(target) {",
      "        if (this.#locked) return",
      "        const resolved = await target",
      "        if (this.#canGoToIndex(resolved.index)) return this.#goTo(resolved)",
      "    }",
      "    async #turnPage(dir, distance) {",
      "        if (this.#locked) return",
      "        this.#locked = true",
      "        const prev = dir === -1",
      "        const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))",
      "        if (shouldGo) await this.#goTo({",
      "            index: this.#adjacentIndex(dir),",
      "            anchor: prev ? () => 1 : () => 0,",
      "        })",
      "        if (shouldGo || !this.hasAttribute('animated')) await wait(100)",
      "        this.#locked = false",
      "    }",
      "}",
      "",
    ].join("\n");

    const patched = patchFoliatePaginatorScript(source);

    expect(patched).toContain("if (index == null || !this.sections[index]) return");
    expect(patched).toContain("if (!resolved || !this.#canGoToIndex(resolved.index)) return");
    expect(patched).toContain("try {");
    expect(patched).toContain("} finally {");
  });
});

describe("patchFoliateFixedLayoutScript", () => {
  test("rewrites Readest constructible stylesheet polyfill to a copied relative asset", () => {
    const source = [
      "import 'construct-style-sheets-polyfill'",
      "",
      "export const captureScrollModeAnchor = () => null",
      "",
    ].join("\n");

    const patched = patchFoliateFixedLayoutScript(source);

    expect(patched).toContain("import './vendor/construct-style-sheets-polyfill.js'");
    expect(patched).not.toContain("import 'construct-style-sheets-polyfill'");
  });
});

describe("patchFoliatePdfScript", () => {
  test("rewrites Readest pdfjs aliases to static extension asset imports", () => {
    const source = [
      "const pdfjsPath = path => `/vendor/pdfjs/${path}`",
      "import '@pdfjs/pdf.min.mjs'",
      "const pdfjsLib = globalThis.pdfjsLib",
      "pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsPath('pdf.worker.min.mjs')",
      "",
    ].join("\n");

    const patched = patchFoliatePdfScript(source);

    expect(patched).toContain(
      "const pdfjsPath = path => new URL(`vendor/pdfjs/${path}`, import.meta.url).toString()",
    );
    expect(patched).toContain("import './vendor/pdfjs/pdf.mjs'");
    expect(patched).toContain("pdfjsPath('pdf.worker.mjs')");
    expect(patched).not.toContain("@pdfjs/pdf.min.mjs");
    expect(patched).not.toContain("pdf.worker.min.mjs");
  });
});
