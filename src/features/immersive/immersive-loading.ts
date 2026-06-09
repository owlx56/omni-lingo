import { INNER_ATTR, WRAPPER_ATTR } from "./dom-attrs";

const LOADING_STYLE_ID = "onelingo-immersive-loading-style";
const LOADING_BASE_VAR = "--onelingo-loading-base";
const LOADING_FLOW_VAR = "--onelingo-loading-flow";

export type LoadingCssVars = { base: string; flow: string };

export function appendLoadingLines(
  container: HTMLElement,
  original: string,
  inline: boolean,
): void {
  const lineCount = getLoadingLineCount(original);
  const seed = getLoadingAnimationSeed(original);
  const specs = createLoadingLineSpecs(original, inline, lineCount, seed);
  for (const spec of specs) {
    const line = document.createElement("span");
    line.className = "onelingo-immersive-loading-line";
    line.style.width = spec.width;
    line.style.animationDelay = `${spec.animationDelay}s`;
    line.style.animationDuration = `${spec.animationDuration}s`;
    container.appendChild(line);
  }
  const palette = getLoadingPalette();
  container.style.setProperty(LOADING_BASE_VAR, palette.base);
  container.style.setProperty(LOADING_FLOW_VAR, palette.flow);
}

export function readLoadingCssVars(inner: HTMLElement): LoadingCssVars | null {
  if (inner.getAttribute("aria-busy") !== "true") return null;
  const palette = getLoadingPalette();
  return {
    base: inner.style.getPropertyValue(LOADING_BASE_VAR) || palette.base,
    flow: inner.style.getPropertyValue(LOADING_FLOW_VAR) || palette.flow,
  };
}

export function restoreLoadingCssVars(
  inner: HTMLElement,
  vars: LoadingCssVars,
): void {
  inner.style.setProperty(LOADING_BASE_VAR, vars.base);
  inner.style.setProperty(LOADING_FLOW_VAR, vars.flow);
}

export function ensureLoadingStyles(): void {
  if (document.getElementById(LOADING_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = LOADING_STYLE_ID;
  style.textContent = `
[${WRAPPER_ATTR}] [${INNER_ATTR}][aria-busy="true"] {
  contain: content;
  pointer-events: none;
  user-select: none;
}
[${WRAPPER_ATTR}]::before,
[${WRAPPER_ATTR}]::after {
  content: none !important;
}
[${WRAPPER_ATTR}] [${INNER_ATTR}][aria-busy="true"] .onelingo-immersive-loading-line {
  display: block;
  height: 0.92em;
  min-height: 0.72rem;
  margin: 0.38em 0;
  background-color: var(--onelingo-loading-base);
  background-image: linear-gradient(
    90deg,
    var(--onelingo-loading-base) 0%,
    var(--onelingo-loading-base) 34%,
    var(--onelingo-loading-flow) 49%,
    var(--onelingo-loading-base) 64%,
    var(--onelingo-loading-base) 100%
  );
  background-position: 120% 0;
  background-size: 260% 100%;
  animation: onelingo-loading-flow 2s linear infinite;
}
@keyframes onelingo-loading-flow { to { background-position: -120% 0; } }
@media (prefers-reduced-motion: reduce) {
  [${WRAPPER_ATTR}] [${INNER_ATTR}] .onelingo-immersive-loading-line {
    animation: none;
    background-position: 50% 0;
  }
}`;
  (document.head ?? document.documentElement).appendChild(style);
}

export function getLoadingLineCount(text: string): number {
  const len = text.replace(/\s+/g, " ").trim().length;
  if (len < 32) return 1;
  if (len < 110) return 2;
  if (len < 220) return 3;
  return 4;
}

export function createLoadingLineSpecs(
  text: string,
  inline: boolean,
  lineCount = inline ? 1 : getLoadingLineCount(text),
  seed = getLoadingAnimationSeed(text),
): Array<{ width: string; animationDelay: string; animationDuration: string }> {
  const count = inline ? 1 : lineCount;
  return Array.from({ length: count }, (_, index) => ({
    width: inline
      ? getInlineLoadingWidth(text)
      : getBlockLoadingWidth(text, index, count),
    animationDelay: getLoadingAnimationDelay(seed, index),
    animationDuration: getLoadingAnimationDuration(seed, index),
  }));
}

function getBlockLoadingWidth(
  text: string,
  index: number,
  total: number,
): string {
  if (total === 1) return `${Math.min(Math.max(text.length * 1.7, 18), 72)}%`;
  if (index === total - 1)
    return `${Math.min(Math.max(38 + (text.length % 28), 34), 72)}%`;
  return index % 2 === 0 ? "100%" : "94%";
}

function getInlineLoadingWidth(text: string): string {
  return `${Math.min(Math.max(text.length * 0.58, 2.4), 12)}em`;
}

function getLoadingAnimationSeed(text: string): number {
  let hash = 0;
  const sample = text.slice(0, 96);
  for (let i = 0; i < sample.length; i++) {
    hash = (hash * 33 + sample.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getLoadingAnimationDelay(seed: number, index: number): string {
  return (-0.12 - ((seed + index * 17) % 9) * 0.11 - index * 0.09).toFixed(2);
}

function getLoadingAnimationDuration(seed: number, index: number): string {
  return (1.6 + ((seed + index * 13) % 5) * 0.12).toFixed(2);
}

function getLoadingPalette(): LoadingCssVars {
  const bg =
    getSurfaceColor(document.body) ?? getSurfaceColor(document.documentElement);
  if (bg) {
    const luminance = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
    if (luminance < 0.45) {
      return { base: "rgba(255,255,255,0.09)", flow: "rgba(255,255,255,0.18)" };
    }
  }
  return { base: "rgba(0,0,0,0.055)", flow: "rgba(0,0,0,0.11)" };
}

function getSurfaceColor(
  el: HTMLElement | null,
): [number, number, number] | null {
  if (!el) return null;
  const match = window
    .getComputedStyle(el)
    .backgroundColor.match(
      /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([0-9.]+))?\)/,
    );
  if (!match) return null;
  const alpha = match[4] ? parseFloat(match[4]) : 1;
  if (alpha === 0) return null;
  return [parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!)];
}
