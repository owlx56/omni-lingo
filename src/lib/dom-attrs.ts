export const OMNI_LINGO_HOST_ATTR = "data-omni-lingo-host";
export const READER_UI_ATTR = "data-omni-lingo-reader-ui";
export const TOOLTIP_ATTR = "data-omni-lingo-tooltip";

export function attrSelector(...attrs: string[]): string {
  return attrs.map((attr) => `[${attr}]`).join(",");
}

export const OMNI_LINGO_UI_BOUNDARY_SELECTOR = attrSelector(
  OMNI_LINGO_HOST_ATTR,
  READER_UI_ATTR,
  TOOLTIP_ATTR,
);
