export function patchFoliatePaginatorScript(contents: string): string {
  let next = contents;

  const spreadAlignmentNeedle =
    "            const expandedSize = pageCount * columnSize\n" +
    "            this.#element.style.padding = '0'\n" +
    "            this.#iframe.style[side] = `${expandedSize}px`\n" +
    "            this.#element.style[side] = `${expandedSize}px`\n" +
    "            this.#iframe.style[otherSide] = '100%'\n" +
    "            this.#element.style[otherSide] = '100%'";
  const spreadAlignmentReplacement =
    "            const expandedSize = pageCount * columnSize\n" +
    "            const spreadSize = this.#columnCount > 1 ? this.#size : columnSize\n" +
    "            const alignedSize = spreadSize > 0 ? Math.ceil(expandedSize / spreadSize) * spreadSize : expandedSize\n" +
    "            this.#element.style.padding = '0'\n" +
    "            this.#iframe.style[side] = `${alignedSize}px`\n" +
    "            this.#element.style[side] = `${alignedSize}px`\n" +
    "            this.#iframe.style[otherSide] = '100%'\n" +
    "            this.#element.style[otherSide] = '100%'";
  if (
    next.includes(spreadAlignmentNeedle) &&
    !next.includes(
      "const spreadSize = this.#columnCount > 1 ? this.#size : columnSize",
    )
  ) {
    next = next.replace(spreadAlignmentNeedle, spreadAlignmentReplacement);
    next = next.replace(
      "                this.#overlayer.element.style[side] = `${expandedSize}px`",
      "                this.#overlayer.element.style[side] = `${alignedSize}px`",
    );
  }

  const goToNeedle =
    "    async #goTo({ index, anchor, select}) {\n" +
    "        if (index === this.#index) await this.#display({ index, anchor, select })\n";
  if (next.includes(goToNeedle)) {
    next = next.replace(
      goToNeedle,
      "    async #goTo({ index, anchor, select}) {\n" +
        "        if (index == null || !this.sections[index]) return\n" +
        "        if (index === this.#index) await this.#display({ index, anchor, select })\n",
    );
  }

  const publicGoToNeedle =
    "    async goTo(target) {\n" +
    "        if (this.#locked) return\n" +
    "        const resolved = await target\n" +
    "        if (this.#canGoToIndex(resolved.index)) return this.#goTo(resolved)\n" +
    "    }";
  if (next.includes(publicGoToNeedle)) {
    next = next.replace(
      publicGoToNeedle,
      "    async goTo(target) {\n" +
        "        if (this.#locked) return\n" +
        "        const resolved = await target\n" +
        "        if (!resolved || !this.#canGoToIndex(resolved.index)) return\n" +
        "        return this.#goTo(resolved)\n" +
        "    }",
    );
  }

  const turnPageNeedle =
    "    async #turnPage(dir, distance) {\n" +
    "        if (this.#locked) return\n" +
    "        this.#locked = true\n" +
    "        const prev = dir === -1\n" +
    "        const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))\n" +
    "        if (shouldGo) await this.#goTo({\n" +
    "            index: this.#adjacentIndex(dir),\n" +
    "            anchor: prev ? () => 1 : () => 0,\n" +
    "        })\n" +
    "        if (shouldGo || !this.hasAttribute('animated')) await wait(100)\n" +
    "        this.#locked = false\n" +
    "    }";
  if (next.includes(turnPageNeedle)) {
    next = next.replace(
      turnPageNeedle,
      "    async #turnPage(dir, distance) {\n" +
        "        if (this.#locked) return\n" +
        "        this.#locked = true\n" +
        "        try {\n" +
        "            const prev = dir === -1\n" +
        "            const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))\n" +
        "            if (shouldGo) {\n" +
        "                const index = this.#adjacentIndex(dir)\n" +
        "                if (index == null) return\n" +
        "                await this.#goTo({\n" +
        "                    index,\n" +
        "                    anchor: prev ? () => 1 : () => 0,\n" +
        "                })\n" +
        "            }\n" +
        "            if (shouldGo || !this.hasAttribute('animated')) await wait(100)\n" +
        "        } finally {\n" +
        "            this.#locked = false\n" +
        "        }\n" +
        "    }",
    );
  }

  return next;
}

export function patchFoliateFixedLayoutScript(contents: string): string {
  return contents.replaceAll(
    "import 'construct-style-sheets-polyfill'",
    "import './vendor/construct-style-sheets-polyfill.js'",
  );
}

export function patchFoliatePdfScript(contents: string): string {
  let next = contents;
  next = next.replace(
    "const pdfjsPath = path => `/vendor/pdfjs/${path}`",
    "const pdfjsPath = path => new URL(`vendor/pdfjs/${path}`, import.meta.url).toString()",
  );
  next = next.replaceAll("pdf.worker.min.mjs", "pdf.worker.mjs");
  next = next.replaceAll("@pdfjs/pdf.min.mjs", "./vendor/pdfjs/pdf.mjs");
  return next;
}
