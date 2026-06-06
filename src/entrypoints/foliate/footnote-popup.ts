import type { EffectiveTheme } from "@/lib/theme";
import { createFoliateContentCss } from "./reader-content-style";
import type { FoliateReaderStyleSettings } from "./reader-settings";
import type { FoliateViewRenderer } from "./types";

export type FootnotePopupDirection = "up" | "down" | "left" | "right";

export type FootnotePopupPosition = {
  dir: FootnotePopupDirection;
  point: {
    x: number;
    y: number;
  };
};

export type FootnotePopupSize = {
  height: number;
  width: number;
};

export const FOLIATE_FOOTNOTE_POPUP_DEFAULT_WIDTH = 360;
export const FOLIATE_FOOTNOTE_POPUP_DEFAULT_HEIGHT = 88;
export const FOLIATE_FOOTNOTE_POPUP_PADDING = 12;
export const FOLIATE_FOOTNOTE_POPUP_MIN_WIDTH = 220;
export const FOLIATE_FOOTNOTE_POPUP_MIN_HEIGHT = 56;

const EPUB_NS = "http://www.idpf.org/2007/ops";
const NUMERIC_MARKER_RE = /^.{0,2}\d+[\])\.]?$/;
const NAV_LIST_SIBLING_THRESHOLD = 2;
const MAX_ANCESTOR_DEPTH = 3;

const EXPLICIT_FOOTNOTE_CLASSES = [
  "duokan-footnote",
  "footnote",
  "footnote-link",
  "js_readerFooterNote",
  "qqreader-footnote",
  "zhangyue-footnote",
];

const REF_TYPES = ["biblioref", "glossref", "noteref"];
const REF_ROLES = ["doc-biblioref", "doc-glossref", "doc-noteref"];

export function shouldCheckAsFootnote(anchor: HTMLAnchorElement): boolean {
  if (hasAnyToken(getEpubType(anchor), REF_TYPES)) return true;
  if (hasAnyToken(anchor.getAttribute("role"), REF_ROLES)) return true;
  if (EXPLICIT_FOOTNOTE_CLASSES.some((className) => anchor.classList.contains(className))) {
    return true;
  }
  if (!isNumericMarkerText(anchor.textContent)) return false;
  if (isDenseNumericNavigation(anchor)) return false;
  return true;
}

export function shouldPromoteFootnoteDetection(
  anchor: HTMLAnchorElement,
  href: string,
): boolean {
  if (!shouldCheckAsFootnote(anchor)) return false;
  if (hasAnyToken(getEpubType(anchor), REF_TYPES)) return true;
  if (hasAnyToken(anchor.getAttribute("role"), REF_ROLES)) return true;
  if (EXPLICIT_FOOTNOTE_CLASSES.some((className) => anchor.classList.contains(className))) {
    return true;
  }
  return href.includes("#") && isNumericMarkerText(anchor.textContent);
}

export function getFootnoteAnchorPosition(
  target: Element,
  bounds: DOMRect,
  padding: number,
): FootnotePopupPosition {
  const rects = Array.from(target.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  const rect = toParentViewportRect(
    rects[0] ?? target.getBoundingClientRect(),
    target.ownerDocument,
  );
  const above = rect.top - bounds.top;
  const below = bounds.bottom - rect.bottom;
  const dir: FootnotePopupDirection = above >= below ? "up" : "down";
  const y = dir === "up" ? rect.top - bounds.top - padding : rect.bottom - bounds.top + padding;

  return {
    dir,
    point: constrainPoint(
      {
        x: (rect.left + rect.right) / 2 - bounds.left,
        y,
      },
      bounds,
      padding,
    ),
  };
}

export function clampFootnotePopupPosition(
  position: FootnotePopupPosition,
  size: FootnotePopupSize,
  bounds: DOMRect,
  padding: number,
): FootnotePopupPosition {
  const x = clamp(position.point.x, padding, Math.max(padding, bounds.width - padding - size.width));
  const y = clamp(position.point.y, padding, Math.max(padding, bounds.height - padding - size.height));
  return {
    dir: position.dir,
    point: { x, y },
  };
}

export function getFootnotePopupPosition(
  anchorPosition: FootnotePopupPosition,
  size: FootnotePopupSize,
  bounds: DOMRect,
  padding: number,
): FootnotePopupPosition {
  const centeredX = anchorPosition.point.x - size.width / 2;
  const top =
    anchorPosition.dir === "up"
      ? anchorPosition.point.y - size.height
      : anchorPosition.dir === "down"
        ? anchorPosition.point.y
        : anchorPosition.point.y - size.height / 2;
  return clampFootnotePopupPosition(
    {
      dir: anchorPosition.dir,
      point: {
        x:
          anchorPosition.dir === "left"
            ? anchorPosition.point.x - size.width
            : anchorPosition.dir === "right"
              ? anchorPosition.point.x
              : centeredX,
        y: top,
      },
    },
    size,
    bounds,
    padding,
  );
}

export function getFootnotePopupSize(
  bounds: DOMRect,
  padding = FOLIATE_FOOTNOTE_POPUP_PADDING,
  contentHeight?: number,
): FootnotePopupSize {
  const availableWidth = Math.max(
    FOLIATE_FOOTNOTE_POPUP_MIN_WIDTH,
    bounds.width - padding * 2,
  );
  const availableHeight = Math.max(
    FOLIATE_FOOTNOTE_POPUP_MIN_HEIGHT,
    bounds.height - padding * 2,
  );
  const preferredHeight =
    typeof contentHeight === "number" && Number.isFinite(contentHeight) && contentHeight > 0
      ? contentHeight
      : FOLIATE_FOOTNOTE_POPUP_DEFAULT_HEIGHT;
  return {
    height: Math.round(
      clamp(
        preferredHeight,
        typeof contentHeight === "number" ? 1 : FOLIATE_FOOTNOTE_POPUP_MIN_HEIGHT,
        availableHeight,
      ),
    ),
    width: Math.round(
      clamp(
        FOLIATE_FOOTNOTE_POPUP_DEFAULT_WIDTH,
        FOLIATE_FOOTNOTE_POPUP_MIN_WIDTH,
        availableWidth,
      ),
    ),
  };
}

export function configureFootnotePopupRenderer(
  renderer: Pick<FoliateViewRenderer, "setAttribute" | "setStyles"> | null | undefined,
  styles: string,
): void {
  if (!renderer) return;
  renderer.setAttribute("flow", "scrolled");
  renderer.setAttribute("no-preload", "");
  renderer.setAttribute("no-background", "");
  renderer.setAttribute("margin", "0px");
  renderer.setAttribute("margin-top", "0px");
  renderer.setAttribute("margin-right", "0px");
  renderer.setAttribute("margin-bottom", "0px");
  renderer.setAttribute("margin-left", "0px");
  renderer.setAttribute("gap", "0%");
  renderer.setStyles?.(styles);
}

export function createFoliateFootnoteContentCss(
  theme: EffectiveTheme,
  settings?: Partial<FoliateReaderStyleSettings> | null,
): string {
  return [
    createFoliateContentCss(theme, settings),
    [
      ".duokan-footnote-content,.duokan-footnote-item{display:block!important;}",
      "html{margin:0!important;padding:0!important;min-height:0!important;height:auto!important;}",
      "body{margin:0!important;padding:12px!important;min-height:0!important;height:auto!important;overflow-wrap:break-word;}",
      "body>:first-child{margin-top:0!important;}",
      "body>:last-child{margin-bottom:0!important;}",
      "a:any-link{text-decoration:none;padding:unset;margin:unset;}",
      "ol{margin:0;padding:0;}",
      "p,li,blockquote,dd{margin:unset!important;text-indent:unset!important;}",
      "div{margin:unset!important;padding:unset!important;}",
      "dt{font-weight:700;line-height:1.6;}",
      [
        ".epubtype-footnote,",
        "aside[epub|type~=\"endnote\"],",
        "aside[epub|type~=\"footnote\"],",
        "aside[epub|type~=\"note\"],",
        "aside[epub|type~=\"rearnote\"]{display:block!important;}",
      ].join(""),
    ].join("\n"),
  ].join("\n");
}

export function isFoliateReaderUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    ? Boolean(
        target.closest(
          [
            "[data-onelingo-reader-ui]",
            ".foliate-reader-topbar",
            ".foliate-reader-bottombar",
            ".foliate-reader-bottom-hover-zone",
            ".foliate-sidebar",
            ".foliate-sidebar-backdrop",
            ".foliate-details-backdrop",
            ".foliate-details-modal",
            ".foliate-footnote-backdrop",
            ".foliate-footnote-popup",
          ].join(", "),
        ),
      )
    : false;
}

function getEpubType(element: Element): string {
  return (
    element.getAttributeNS?.(EPUB_NS, "type") ??
    element.getAttribute("epub:type") ??
    ""
  );
}

function hasAnyToken(value: string | null | undefined, tokens: string[]): boolean {
  if (!value) return false;
  const parts = new Set(value.split(/\s+/).filter(Boolean));
  return tokens.some((token) => parts.has(token));
}

function isNumericMarkerText(text: string | null | undefined): boolean {
  return text != null && NUMERIC_MARKER_RE.test(text.trim());
}

function isDenseNumericNavigation(anchor: HTMLAnchorElement): boolean {
  let container: Element | null = anchor.parentElement;
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && container; depth += 1) {
    if (countNumericSiblingLinks(container, anchor) >= NAV_LIST_SIBLING_THRESHOLD) {
      return true;
    }
    container = container.parentElement;
  }
  return false;
}

function countNumericSiblingLinks(container: Element, anchor: HTMLAnchorElement): number {
  let count = 0;
  for (const link of Array.from(container.querySelectorAll("a"))) {
    if (link === anchor) continue;
    if (isNumericMarkerText(link.textContent)) {
      count += 1;
      if (count >= NAV_LIST_SIBLING_THRESHOLD) return count;
    }
  }
  return count;
}

function isSuper(element: Element | null): boolean {
  if (!element) return false;
  if (element.matches("sup")) return true;
  const verticalAlign =
    element instanceof HTMLElement ? element.style.verticalAlign : "";
  return (
    verticalAlign === "super" ||
    verticalAlign === "top" ||
    verticalAlign === "text-top" ||
    /^\d/.test(verticalAlign)
  );
}

function constrainPoint(
  point: FootnotePopupPosition["point"],
  bounds: DOMRect,
  padding: number,
): FootnotePopupPosition["point"] {
  return {
    x: clamp(point.x, padding, Math.max(padding, bounds.width - padding)),
    y: clamp(point.y, padding, Math.max(padding, bounds.height - padding)),
  };
}

function toParentViewportRect(rect: DOMRect, ownerDocument?: Document): DOMRect {
  const frame = ownerDocument?.defaultView?.frameElement;
  if (!(frame instanceof Element)) return rect;
  const frameRect = frame.getBoundingClientRect();
  return new DOMRect(
    rect.left + frameRect.left,
    rect.top + frameRect.top,
    rect.width,
    rect.height,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
