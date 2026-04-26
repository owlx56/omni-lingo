export function matchesSelectorSafe(el: Element, selector: string): boolean {
  const s = selector.trim();
  if (!s) return false;
  try { return el.matches(s); } catch { return false; }
}

export function closestSelectorSafe(el: Element, selector: string): Element | null {
  const s = selector.trim();
  if (!s) return null;
  try { return el.closest(s); } catch { return null; }
}

export function querySelectorAllSafe(root: ParentNode, selector: string): Element[] {
  const s = selector.trim();
  if (!s) return [];
  try { return Array.from(root.querySelectorAll(s)); } catch { return []; }
}
