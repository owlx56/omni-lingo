import { describe, expect, it } from "bun:test";
import {
  computeExpandedTocKeys,
  hydrateTocLocations,
  normalizeToc,
} from "./reader-toc";

describe("reader toc helpers", () => {
  it("normalizes nested toc items and drops unusable entries", () => {
    expect(
      normalizeToc([
        {
          id: "vol-1",
          href: "vol-1.xhtml",
          label: "Volume 1",
          subitems: [{ href: "chapter-1.xhtml", label: "Chapter 1" }, null],
        },
        {},
      ]),
    ).toEqual([
      {
        id: "vol-1",
        href: "vol-1.xhtml",
        label: "Volume 1",
        index: undefined,
        location: undefined,
        subitems: [
          {
            id: undefined,
            href: "chapter-1.xhtml",
            label: "Chapter 1",
            index: undefined,
            location: undefined,
            subitems: [],
          },
        ],
      },
    ]);
  });

  it("expands the path to the active nested href", () => {
    const toc = normalizeToc([
      {
        id: "vol-1",
        href: "vol-1.xhtml",
        label: "Volume 1",
        subitems: [{ id: "c1", href: "chapter-1.xhtml", label: "Chapter 1" }],
      },
    ]);

    expect([...computeExpandedTocKeys(toc, "chapter-1.xhtml")]).toEqual([
      "vol-1",
      "vol-1/c1",
    ]);
  });

  it("hydrates parent locations from the first child location", async () => {
    const toc = normalizeToc([
      {
        id: "vol-1",
        href: "",
        label: "Volume 1",
        subitems: [{ href: "chapter-1.xhtml", label: "Chapter 1" }],
      },
    ]);
    const book = {
      sections: [{ id: "chapter-1.xhtml", size: 3000 }],
      splitTOCHref: (href) => [href],
    };

    await hydrateTocLocations(book, toc);

    expect(toc[0]?.location?.current).toBe(0);
    expect(toc[0]?.subitems[0]?.location?.next).toBe(2);
  });
});
