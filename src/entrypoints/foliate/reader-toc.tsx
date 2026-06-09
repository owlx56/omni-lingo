import { For, Show, type JSX } from "solid-js";
import type { FoliateBookLike, FoliateTocItem } from "./types";

const FOLIATE_SIZE_PER_LOC = 1500;

type TocLocation = NonNullable<FoliateTocItem["location"]>;
type TocLocationContext = {
  book: FoliateBookLike;
  sectionIndexById: Map<unknown, number>;
  sectionIndexByStringId: Map<string, number>;
  sectionLocations: TocLocation[];
};

export function TocNode(props: {
  item: FoliateTocItem;
  index: number;
  isActive: (href: string) => boolean;
  isExpanded: (key: string) => boolean;
  onSelect: (href: string) => Promise<void>;
  onToggleExpanded: (key: string) => void;
  parentKey?: string;
}): JSX.Element {
  const hasChildren = () => props.item.subitems.length > 0;
  const pageLabel = tocPageLabel(props.item);
  const nodeKey = tocNodeKey(props.item, props.index, props.parentKey);
  const expanded = () => props.isExpanded(nodeKey);
  return (
    <div
      classList={{
        "foliate-toc-item": true,
        active: props.isActive(props.item.href),
        "is-branch": hasChildren(),
      }}
      data-key={nodeKey}
    >
      <div class="foliate-toc-row">
        <Show
          when={hasChildren()}
          fallback={<span class="foliate-toc-expander-spacer" />}
        >
          <button
            aria-expanded={expanded() ? "true" : "false"}
            aria-label={expanded() ? "Collapse section" : "Expand section"}
            class="foliate-toc-expander"
            classList={{ "is-expanded": expanded() }}
            onClick={() => props.onToggleExpanded(nodeKey)}
            type="button"
          >
            <svg viewBox="0 0 8 10" width="8" height="10" aria-hidden="true">
              <polygon points="0 0, 8 5, 0 10" />
            </svg>
          </button>
        </Show>
        <button
          class="foliate-toc-link"
          onClick={() => void props.onSelect(props.item.href)}
          type="button"
        >
          <span class="foliate-toc-label">{props.item.label}</span>
          <Show when={pageLabel}>
            <span class="foliate-toc-page">{pageLabel}</span>
          </Show>
        </button>
      </div>
      <Show when={hasChildren() && expanded()}>
        <div class="foliate-toc-children">
          <For each={props.item.subitems}>
            {(child, index) => (
              <TocNode
                item={child}
                index={index()}
                isActive={props.isActive}
                isExpanded={props.isExpanded}
                onSelect={props.onSelect}
                onToggleExpanded={props.onToggleExpanded}
                parentKey={nodeKey}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function normalizeToc(items: unknown[]): FoliateTocItem[] {
  return items
    .map((item) => normalizeTocItem(item))
    .filter((item): item is FoliateTocItem => Boolean(item));
}

function normalizeTocItem(value: unknown): FoliateTocItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as {
    id?: unknown;
    href?: unknown;
    label?: unknown;
    index?: unknown;
    location?: unknown;
    subitems?: unknown;
  };
  const id =
    typeof item.id === "string" || typeof item.id === "number"
      ? item.id
      : undefined;
  const href = typeof item.href === "string" ? item.href : "";
  const label = typeof item.label === "string" ? item.label : href;
  const index = typeof item.index === "number" ? item.index : undefined;
  const location =
    item.location && typeof item.location === "object"
      ? {
          current:
            typeof (item.location as { current?: unknown }).current === "number"
              ? ((item.location as { current?: unknown }).current as number)
              : undefined,
          next:
            typeof (item.location as { next?: unknown }).next === "number"
              ? ((item.location as { next?: unknown }).next as number)
              : undefined,
          total:
            typeof (item.location as { total?: unknown }).total === "number"
              ? ((item.location as { total?: unknown }).total as number)
              : undefined,
        }
      : undefined;
  const subitems = Array.isArray(item.subitems) ? normalizeToc(item.subitems) : [];
  if (!href && !label) return null;
  return { id, href, label, index, location, subitems };
}

export async function hydrateTocLocations(
  book: FoliateBookLike | undefined,
  items: FoliateTocItem[],
): Promise<FoliateTocItem[]> {
  if (!book || items.length === 0) return items;

  const context = createTocLocationContext(book);
  if (!context) return inheritTocLocations(items);

  await hydrateTocItemLocations(items, context);
  return inheritTocLocations(items);
}

function createTocLocationContext(book: FoliateBookLike): TocLocationContext | null {
  if (!Array.isArray(book.sections) || book.sections.length === 0) return null;

  const sizes = book.sections.map((section) =>
    section.linear !== "no" && typeof section.size === "number" && section.size > 0
      ? section.size
      : 0,
  );
  const totalSize = sizes.reduce((sum, size) => sum + size, 0);
  const total = Math.max(1, Math.ceil(totalSize / FOLIATE_SIZE_PER_LOC));
  let cumulative = 0;
  const sectionLocations = sizes.map((size) => {
    const location = {
      current: Math.floor(cumulative / FOLIATE_SIZE_PER_LOC),
      next: Math.floor((cumulative + size) / FOLIATE_SIZE_PER_LOC),
      total,
    };
    cumulative += size;
    return location;
  });

  const sectionIndexById = new Map<unknown, number>();
  const sectionIndexByStringId = new Map<string, number>();
  book.sections.forEach((section, index) => {
    sectionIndexById.set(index, index);
    sectionIndexByStringId.set(String(index), index);
    if (section.id !== undefined) {
      sectionIndexById.set(section.id, index);
      sectionIndexByStringId.set(String(section.id), index);
    }
  });

  return { book, sectionIndexById, sectionIndexByStringId, sectionLocations };
}

async function hydrateTocItemLocations(
  items: FoliateTocItem[],
  context: TocLocationContext,
): Promise<void> {
  for (const item of items) {
    if (!hasTocLocation(item)) {
      item.location = await resolveTocLocation(item, context);
    }
    if (item.subitems.length > 0) {
      await hydrateTocItemLocations(item.subitems, context);
    }
  }
}

async function resolveTocLocation(
  item: FoliateTocItem,
  context: TocLocationContext,
): Promise<TocLocation | undefined> {
  if (item.href) {
    const splitIndex = await resolveTocSectionIndexFromSplit(item.href, context);
    const splitLocation = locationForSectionIndex(splitIndex, context);
    if (splitLocation) return splitLocation;

    const hrefIndex = await resolveTocSectionIndexFromHref(item.href, context);
    const hrefLocation = locationForSectionIndex(hrefIndex, context);
    if (hrefLocation) return hrefLocation;
  }

  if (typeof item.index === "number") return locationForSectionIndex(item.index, context);
  return undefined;
}

async function resolveTocSectionIndexFromSplit(
  href: string,
  context: TocLocationContext,
): Promise<number | undefined> {
  if (!context.book.splitTOCHref) return undefined;
  try {
    const parts = await Promise.resolve(context.book.splitTOCHref(href));
    const id = Array.isArray(parts) ? parts[0] : undefined;
    return sectionIndexFromId(id, context);
  } catch {
    return undefined;
  }
}

async function resolveTocSectionIndexFromHref(
  href: string,
  context: TocLocationContext,
): Promise<number | undefined> {
  if (!context.book.resolveHref) return undefined;
  try {
    const resolved = await Promise.resolve(context.book.resolveHref(href));
    return typeof resolved?.index === "number" ? resolved.index : undefined;
  } catch {
    return undefined;
  }
}

function sectionIndexFromId(
  id: unknown,
  context: TocLocationContext,
): number | undefined {
  if (id === undefined || id === null) return undefined;
  const exact = context.sectionIndexById.get(id);
  if (exact !== undefined) return exact;
  return context.sectionIndexByStringId.get(String(id));
}

function locationForSectionIndex(
  index: number | undefined,
  context: TocLocationContext,
): TocLocation | undefined {
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return undefined;
  }
  return context.sectionLocations[index];
}

function inheritTocLocations(items: FoliateTocItem[]): FoliateTocItem[] {
  for (const item of items) {
    if (item.subitems.length > 0) {
      inheritTocLocations(item.subitems);
      if (!hasTocLocation(item)) {
        item.location = firstChildLocation(item.subitems);
      }
    }
  }
  return items;
}

function firstChildLocation(items: FoliateTocItem[]): TocLocation | undefined {
  for (const item of items) {
    if (hasTocLocation(item)) return item.location;
    const nested = firstChildLocation(item.subitems);
    if (nested) return nested;
  }
  return undefined;
}

function hasTocLocation(item: FoliateTocItem): boolean {
  return typeof item.location?.current === "number";
}

function tocPageLabel(item: FoliateTocItem): string {
  if (typeof item.location?.current === "number") return String(item.location.current + 1);
  if (typeof item.index === "number") return String(item.index + 1);
  return "";
}

function tocNodeKey(item: FoliateTocItem, index: number, parentKey?: string): string {
  const base = String(item.id ?? item.href ?? item.label ?? index);
  return parentKey ? `${parentKey}/${base}` : base;
}

export function computeExpandedTocKeys(
  items: FoliateTocItem[],
  activeHrefValue: string,
): Set<string> {
  const path = activeHrefValue ? findTocPath(items, activeHrefValue) : [];
  if (path.length > 0) return new Set(path);
  const first = items[0];
  if (items.length === 1 && first?.subitems?.length) {
    return new Set([tocNodeKey(first, 0)]);
  }
  return new Set();
}

function findTocPath(
  items: FoliateTocItem[],
  href: string,
  parentKey?: string,
): string[] {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    const key = tocNodeKey(item, index, parentKey);
    if (item.href === href) return [key];
    const childPath = findTocPath(item.subitems, href, key);
    if (childPath.length > 0) return [key, ...childPath];
  }
  return [];
}
