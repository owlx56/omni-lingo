import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { loadDocument } from "@/lib/document-store";
import { fetchDocumentFromUrl } from "@/lib/document-resolver";
import {
  foliateViewerUrlForFile,
  foliateViewerUrlForStoredKey,
  pdfViewerUrlForFile,
  pdfViewerUrlForStoredKey,
  type ViewerFormat,
} from "@/lib/document-viewer-urls";
import { useT } from "@/lib/i18n";
import type { UiLang } from "@/lib/languages";
import { sendMessage } from "@/lib/messaging";
import {
  getStoredSettings,
  setSettings,
  useSettings,
} from "@/lib/storage/settings";
import {
  IconPages,
  IconInfo,
  IconClose,
  IconChevron,
  IconPin,
  IconPinFilled,
  IconScroll,
  IconSidebar,
} from "@/lib/ui/icons";
import { initFoliateBridge } from "./bridge";
import type {
  FoliateBookLike,
  FoliateBookMetadata,
  FoliateSeriesValue,
  FoliateRelocateDetail,
  FoliateTocItem,
  FoliateViewElement,
} from "./types";

type ViewState = "loading" | "ready" | "error";
type ViewMode = "pages" | "scroll";
type ReaderSource = {
  data: ArrayBuffer;
  format: ViewerFormat;
  name: string;
  url?: string;
};

type SidebarBookState = {
  author: string;
  coverUrl: string;
  metadata: FoliateBookMetadata | null;
  subtitle: string;
  title: string;
};

type MetadataSection = {
  key: string;
  label: string;
  value: string;
};

type SeriesItem = {
  key: string;
  label: string;
  position: string;
};

type DetailsSectionKind = "fields" | "series" | "description";

type DetailsSectionProps = {
  emptyLabel: string;
  items: MetadataSection[] | SeriesItem[] | string[];
  kind: DetailsSectionKind;
  label: string;
};

type TocLocation = NonNullable<FoliateTocItem["location"]>;
type TocLocationContext = {
  book: FoliateBookLike;
  sectionIndexById: Map<unknown, number>;
  sectionIndexByStringId: Map<string, number>;
  sectionLocations: TocLocation[];
};

const SIDEBAR_MIN = 0.05;
const SIDEBAR_MAX = 0.45;
const SIDEBAR_DEFAULT_DESKTOP = 0.28;
const SIDEBAR_DEFAULT_MOBILE = 0.25;
const MOBILE_BREAKPOINT = 720;
const FOLIATE_SIZE_PER_LOC = 1500;

function App(): JSX.Element {
  const t = useT();
  const settings = useSettings();
  const [state, setState] = createSignal<ViewState>("loading");
  const [error, setError] = createSignal("");
  const [docTitle, setDocTitle] = createSignal("");
  const [locationLabel, setLocationLabel] = createSignal("");
  const [sidebarVisible, setSidebarVisible] = createSignal(false);
  const [sidebarPinned, setSidebarPinned] = createSignal(false);
  const [sidebarWidth, setSidebarWidth] = createSignal(
    toPercent(SIDEBAR_DEFAULT_DESKTOP),
  );
  const [viewMode, setViewMode] = createSignal<ViewMode>("pages");
  const [toc, setToc] = createSignal<FoliateTocItem[]>([]);
  const [tocExpandedKeys, setTocExpandedKeys] = createSignal<Set<string>>(new Set<string>());
  const [activeHref, setActiveHref] = createSignal("");
  const [isDesktop, setIsDesktop] = createSignal(isWideViewport());
  const [isDragging, setIsDragging] = createSignal(false);
  const [bookState, setBookState] = createSignal<SidebarBookState | null>(null);
  const [detailsOpen, setDetailsOpen] = createSignal(false);

  let renderHost: HTMLDivElement | undefined;
  let view: FoliateViewElement | undefined;
  let stopBridge: (() => void) | undefined;
  let coverObjectUrl: string | undefined;
  let bookStateToken = 0;
  let navigationLocked = false;
  let resizeCleanup: (() => void) | undefined;
  let dragCleanup: (() => void) | undefined;
  let shellRef: HTMLDivElement | undefined;

  createEffect(() => {
    const lang = settings().uiLang;
    applyLanguageToDocument(document, lang);
    document.title = docTitle() || t("viewer.title");
  });

  createEffect(() => {
    const width = sidebarVisible() && isDockedSidebar() ? sidebarWidth() : null;
    syncReaderLayout(width, viewMode());
  });

  createEffect(() => {
    setTocExpandedKeys(() => computeExpandedTocKeys(toc(), activeHref()));
  });

  onMount(() => {
    const updateViewport = (): void => {
      setIsDesktop(isWideViewport());
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    resizeCleanup = () => {
      window.removeEventListener("resize", updateViewport);
    };
    void init();
  });

  onCleanup(() => {
    resizeCleanup?.();
    dragCleanup?.();
    revokeCoverObjectUrl();
    stopBridge?.();
    stopBridge = undefined;
    view?.remove();
    view = undefined;
    renderHost?.replaceChildren();
    renderHost = undefined;
  });

  const init = async (): Promise<void> => {
    const params = new URLSearchParams(location.search);
    const key = params.get("onelingo-key");
    const file = params.get("file") ?? params.get("url");
    const sniff = params.get("onelingo-sniff") === "1" || params.get("sniff") === "1";

    if (key) {
      await openStoredDocument(key);
      return;
    }
    if (file) {
      const format = (params.get("format") ?? "auto") as ViewerFormat;
      await openUrlDocument(file, format);
      return;
    }
    if (sniff) {
      const pending = await sendMessage("consumeSniffedDocument", {});
      if (pending?.action === "open" && pending.url) {
        await openUrlDocument(pending.url, "auto");
      } else if (pending?.action === "bypass" && pending.url) {
        location.replace(pending.url);
      } else if (pending?.action === "handled") {
        setError(t("viewer.error.openedInReader"));
        setState("error");
      } else {
        setError(t("viewer.error.noSniffedDocument"));
        setState("error");
      }
      return;
    }

    setError(t("viewer.error.noDocument"));
    setState("error");
  };

  const openStoredDocument = async (key: string): Promise<void> => {
    try {
      const doc = await loadDocument(key);
      if (!doc) {
        setError(t("viewer.error.notFound"));
        setState("error");
        return;
      }

      if (doc.format === "pdf") {
        location.replace(pdfViewerUrlForStoredKey(key, settings().uiLang));
        return;
      }

      await openReader({
        data: doc.data,
        format: doc.format,
        name: doc.name,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const openUrlDocument = async (
    url: string,
    formatHint: ViewerFormat,
  ): Promise<void> => {
    try {
      const doc = await fetchDocumentFromUrl(url, formatHint);
      if (doc.format === "pdf") {
        location.replace(pdfViewerUrlForFile(doc.url, settings().uiLang));
        return;
      }

      await openReader({
        data: doc.data,
        format: doc.format,
        name: doc.name,
        url: doc.url,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const openReader = async (source: ReaderSource): Promise<void> => {
    resetReaderState();
    await loadSidebarPrefs();
    setDocTitle(stripDocumentName(source.name));
    setState("loading");

    await customElements.whenDefined("foliate-view");
    const el = ensureViewElement();
    const file = createReaderFile(source);
    await el.open(file);
    el.renderer?.setAttribute("flow", viewFlow(viewMode()));
    stopBridge = initFoliateBridge(el, {
      onLocationChange,
    });

    void loadBookState(el.book);

    const bookTitle = formatLanguageMap(el.book?.metadata?.title);
    if (bookTitle) setDocTitle(bookTitle);
    const tocItems = normalizeToc(el.book?.toc ?? []);
    setToc(await hydrateTocLocations(el.book, tocItems));
    setState("ready");
    syncReaderLayout(
      sidebarVisible() && isDockedSidebar() ? sidebarWidth() : null,
      viewMode(),
    );

    await nextFrame();
    await el.goToTextStart?.().catch(async () => {
      await el.next();
    });
  };

  const resetReaderState = (): void => {
    bookStateToken += 1;
    stopBridge?.();
    stopBridge = undefined;
    revokeCoverObjectUrl();
    view?.remove();
    view = undefined;
    renderHost?.replaceChildren();
    setToc([]);
    setTocExpandedKeys(new Set<string>());
    setActiveHref("");
    setLocationLabel("");
    setBookState(null);
    setDetailsOpen(false);
    setSidebarVisible(false);
    setIsDragging(false);
    navigationLocked = false;
  };

  const loadBookState = async (book?: FoliateBookLike): Promise<void> => {
    revokeCoverObjectUrl();
    const token = ++bookStateToken;
    if (!book) {
      setBookState(null);
      return;
    }

    const uiLang = settings().uiLang;
    const metadata = book.metadata ?? null;
    const title =
      formatLanguageMap(metadata?.title, uiLang) || docTitle() || t("viewer.metadata.untitled");
    const subtitle = formatLanguageMap(metadata?.subtitle, uiLang);
    const author = formatContributor(metadata?.author, uiLang) || t("viewer.metadata.unknown");
    setBookState({
      title,
      subtitle,
      author,
      metadata,
      coverUrl: "",
    });

    try {
      const cover = await Promise.resolve(book.getCover?.());
      if (token !== bookStateToken) return;
      if (!cover) return;
      const nextCoverUrl = URL.createObjectURL(cover);
      if (token !== bookStateToken) {
        URL.revokeObjectURL(nextCoverUrl);
        return;
      }
      coverObjectUrl = nextCoverUrl;
      setBookState((current) =>
        current
          ? {
              ...current,
              coverUrl: nextCoverUrl,
            }
          : current,
      );
    } catch (err) {
      console.warn("[OneLingo] failed to load foliate cover:", err);
    }
  };

  const revokeCoverObjectUrl = (): void => {
    if (!coverObjectUrl) return;
    URL.revokeObjectURL(coverObjectUrl);
    coverObjectUrl = undefined;
  };

  const loadSidebarPrefs = async (): Promise<void> => {
    let raw: Awaited<ReturnType<typeof getStoredSettings>> = null;
    try {
      raw = await getStoredSettings();
    } catch (err) {
      console.warn("[OneLingo] failed to read foliate sidebar prefs:", err);
    }
    const desktop = isWideViewport();
    const storedPinned = raw?.foliateSidebarPinned;
    const storedWidth = raw?.foliateSidebarWidth;
    const nextPinned = desktop
      ? (typeof storedPinned === "boolean" ? storedPinned : true)
      : false;
    const nextWidth = normalizeSidebarWidth(
      storedWidth,
      desktop ? SIDEBAR_DEFAULT_DESKTOP : SIDEBAR_DEFAULT_MOBILE,
    );
    setIsDesktop(desktop);
    setSidebarPinned(nextPinned);
    setSidebarVisible(nextPinned);
    setSidebarWidth(nextWidth);
  };

  const isDockedSidebar = (): boolean => isDesktop() && sidebarPinned();

  const ensureViewElement = (): FoliateViewElement => {
    if (view) return view;
    if (!renderHost) throw new Error(t("viewer.error.missingElement"));

    const el = document.createElement("foliate-view") as FoliateViewElement;
    el.style.display = "block";
    el.style.width = "100%";
    el.style.height = "100%";
    renderHost.replaceChildren(el);
    view = el;
    return el;
  };

  const onLocationChange = (detail: FoliateRelocateDetail): void => {
    if (detail.tocItem?.href) {
      setActiveHref(detail.tocItem.href);
    }
    setLocationLabel(detail.pageItem?.label ?? detail.tocItem?.label ?? "");
  };

  const toggleSidebar = (): void => {
    setSidebarVisible((value) => !value);
  };

  const togglePinSidebar = async (): Promise<void> => {
    if (!isDesktop()) return;
    const nextPinned = !sidebarPinned();
    setSidebarPinned(nextPinned);
    setSidebarVisible(nextPinned);
    syncReaderLayout(nextPinned ? sidebarWidth() : null, viewMode());
    await setSettings({
      foliateSidebarPinned: nextPinned,
      foliateSidebarWidth: sidebarWidth(),
    });
  };

  const openDetails = (): void => {
    setDetailsOpen(true);
  };

  const closeDetails = (): void => {
    setDetailsOpen(false);
  };

  const setMode = (nextMode: ViewMode): void => {
    setViewMode(nextMode);
    view?.renderer?.setAttribute("flow", viewFlow(nextMode));
    syncReaderLayout(sidebarVisible() && isDockedSidebar() ? sidebarWidth() : null, nextMode);
  };

  const goLeft = async (): Promise<void> => {
    if (!view || navigationLocked) return;
    navigationLocked = true;
    try {
      await view.goLeft();
      if (!isDockedSidebar() && sidebarVisible()) {
        setSidebarVisible(false);
      }
    } finally {
      navigationLocked = false;
    }
  };

  const goRight = async (): Promise<void> => {
    if (!view || navigationLocked) return;
    navigationLocked = true;
    try {
      await view.goRight();
      if (!isDockedSidebar() && sidebarVisible()) {
        setSidebarVisible(false);
      }
    } finally {
      navigationLocked = false;
    }
  };

  const goToToc = async (href: string): Promise<void> => {
    if (!view || navigationLocked || !href) return;
    navigationLocked = true;
    try {
      await view.goTo(href);
      if (!isDockedSidebar() && sidebarVisible()) {
        setSidebarVisible(false);
      }
    } finally {
      navigationLocked = false;
    }
  };

  const startResize = (event: PointerEvent): void => {
    if (!isDockedSidebar() || !sidebarVisible()) return;
    const frameWidth =
      shellRef?.getBoundingClientRect().width ??
      window.innerWidth ??
      1;
    const startX = event.clientX;
    const startWidth = parseWidthFraction(sidebarWidth());
    let nextWidth = sidebarWidth();
    const pointerId = event.pointerId;

    const move = (moveEvent: PointerEvent): void => {
      const delta = moveEvent.clientX - startX;
      const fraction = clamp(startWidth + delta / frameWidth, SIDEBAR_MIN, SIDEBAR_MAX);
      nextWidth = toPercent(fraction);
      setSidebarWidth(nextWidth);
      syncReaderLayout(nextWidth, viewMode());
    };

    const stop = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      setIsDragging(false);
      dragCleanup = undefined;
      void setSettings({ foliateSidebarWidth: nextWidth });
    };

    setIsDragging(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    dragCleanup = stop;
    const target = event.currentTarget;
    if (target instanceof HTMLElement) {
      target.setPointerCapture(pointerId);
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const closeSidebar = (): void => {
    setSidebarVisible(false);
  };

  const isActiveToc = (href: string): boolean => activeHref() === href;
  const isTocExpanded = (key: string): boolean => tocExpandedKeys().has(key);
  const toggleTocExpanded = (key: string): void => {
    setTocExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <main class="viewer-root" data-onelingo-reader-ui="">
      <div
        classList={{
          "foliate-viewer-frame": true,
          "is-dragging": isDragging(),
        }}
        ref={(el) => {
          shellRef = el;
        }}
      >
        <Show when={sidebarVisible()}>
          <aside
            classList={{
              "foliate-sidebar": true,
              "is-pinned": isDockedSidebar(),
              "is-overlay": !isDockedSidebar(),
              "is-dragging": isDragging(),
            }}
            style={{
              width: isDockedSidebar() ? sidebarWidth() : "",
              "flex-basis": isDockedSidebar() ? sidebarWidth() : "",
            }}
          >
            <div class="foliate-sidebar-head">
              <button
                aria-label={sidebarVisible() ? t("viewer.sidebar.close") : t("viewer.sidebar.open")}
                class="foliate-icon-button"
                disabled={state() !== "ready"}
                onClick={toggleSidebar}
                type="button"
              >
                <IconSidebar size={16} />
              </button>
              <button
                aria-label={sidebarPinned() ? t("viewer.sidebar.unpin") : t("viewer.sidebar.pin")}
                class="foliate-icon-button foliate-sidebar-pin-button"
                classList={{ "is-active": sidebarPinned() }}
                disabled={state() !== "ready" || !isDesktop()}
                onClick={() => void togglePinSidebar()}
                type="button"
              >
                {sidebarPinned() ? <IconPinFilled size={16} /> : <IconPin size={16} />}
              </button>
            </div>
            <Show when={bookState()}>
              {(book) => (
                <div class="foliate-book-card">
                  <div class="foliate-book-cover">
                    <Show
                      when={book().coverUrl}
                      fallback={<div class="foliate-book-cover-fallback" />}
                    >
                      <img alt={book().title} src={book().coverUrl} />
                    </Show>
                  </div>
                  <div class="foliate-book-meta">
                    <div class="foliate-book-title">{book().title}</div>
                    <div class="foliate-book-author">{book().author}</div>
                  </div>
                  <button
                    aria-label={t("viewer.metadata.details")}
                    class="foliate-icon-button foliate-book-info"
                    disabled={state() !== "ready"}
                    onClick={openDetails}
                    type="button"
                  >
                    <IconInfo size={16} />
                  </button>
                </div>
              )}
            </Show>
            <div class="foliate-sidebar-body">
              <Show
                when={toc().length > 0}
                fallback={<div class="foliate-sidebar-empty">{t("viewer.sidebar.empty")}</div>}
              >
                <nav class="foliate-toc">
                  <For each={toc()}>
                    {(item, index) => (
                      <TocNode
                        item={item}
                        index={index()}
                        isActive={isActiveToc}
                        isExpanded={isTocExpanded}
                        onSelect={goToToc}
                        onToggleExpanded={toggleTocExpanded}
                      />
                    )}
                  </For>
                </nav>
              </Show>
            </div>
            <Show when={isDockedSidebar() && isDesktop()}>
              <button
                aria-label={t("viewer.sidebar.resize")}
                class="foliate-sidebar-resize"
                onPointerDown={startResize}
                tabIndex={0}
                type="button"
              />
            </Show>
          </aside>
        </Show>

        <div class="foliate-main">
          <header class="foliate-toolbar">
            <Show when={!sidebarVisible()}>
              <button
                aria-label={t("viewer.sidebar.open")}
                class="foliate-nav-button"
                disabled={state() !== "ready"}
                onClick={toggleSidebar}
                type="button"
              >
                <IconSidebar size={16} />
              </button>
            </Show>
            <button
              class="foliate-nav-button"
              disabled={state() !== "ready"}
              onClick={() => void goLeft()}
              type="button"
            >
              ‹
            </button>
            <div class="foliate-toolbar-title">{docTitle()}</div>
            <div class="foliate-toolbar-location">{locationLabel()}</div>
            <div class="foliate-mode-switch" role="group" aria-label={t("viewer.mode.pages")}>
              <button
                aria-label={t("viewer.mode.pages")}
                classList={{ "foliate-mode-button": true, "is-active": viewMode() === "pages" }}
                disabled={state() !== "ready"}
                onClick={() => setMode("pages")}
                title={t("viewer.mode.pages")}
                type="button"
              >
                <IconPages size={15} />
              </button>
              <button
                aria-label={t("viewer.mode.scroll")}
                classList={{ "foliate-mode-button": true, "is-active": viewMode() === "scroll" }}
                disabled={state() !== "ready"}
                onClick={() => setMode("scroll")}
                title={t("viewer.mode.scroll")}
                type="button"
              >
                <IconScroll size={15} />
              </button>
            </div>
            <button
              class="foliate-nav-button"
              disabled={state() !== "ready"}
              onClick={() => void goRight()}
              type="button"
            >
              ›
            </button>
          </header>

          <div class="foliate-content">
            <div
              class="foliate-render-area"
              id="foliate-render"
              ref={(el) => {
                renderHost = el;
              }}
            />

            <Show when={sidebarVisible() && !isDockedSidebar()}>
              <button
                aria-hidden="true"
                class="foliate-sidebar-backdrop"
                onClick={closeSidebar}
                tabIndex={-1}
                type="button"
              />
            </Show>

            <Show when={detailsOpen()}>
              <div class="foliate-details-backdrop" onClick={closeDetails} />
              <section
                aria-label={t("viewer.metadata.details")}
                class="foliate-details-modal"
                role="dialog"
                tabIndex={-1}
              >
                <button
                  aria-label={t("viewer.close")}
                  class="foliate-details-close"
                  onClick={closeDetails}
                  type="button"
                >
                  <IconClose size={16} />
                </button>
                <Show when={bookState()} fallback={<div class="foliate-details-empty" />}>
                  {(book) => (
                    <>
                      <div class="foliate-details-hero">
                        <div class="foliate-details-cover">
                          <Show
                            when={book().coverUrl}
                            fallback={<div class="foliate-book-cover-fallback" />}
                          >
                            <img alt={book().title} src={book().coverUrl} />
                          </Show>
                        </div>
                        <div class="foliate-details-identity">
                          <h2>{book().title}</h2>
                          <p>{book().author}</p>
                          <Show when={book().subtitle}>
                            <span>{book().subtitle}</span>
                          </Show>
                        </div>
                      </div>
                      <div class="foliate-details-sections">
                        <DetailsSection
                          kind="fields"
                          label={t("viewer.metadata.metadata")}
                          emptyLabel={t("viewer.metadata.unknown")}
                          items={buildMetadataSections(book().metadata, t, settings().uiLang)}
                        />
                        <DetailsSection
                          kind="series"
                          label={t("viewer.metadata.series")}
                          emptyLabel={t("viewer.metadata.unknown")}
                          items={buildSeriesSections(book().metadata, t, settings().uiLang)}
                        />
                        <DetailsSection
                          kind="description"
                          label={t("viewer.metadata.description")}
                          emptyLabel={t("viewer.metadata.noDescription")}
                          items={buildDescriptionSections(book().metadata, settings().uiLang)}
                        />
                      </div>
                    </>
                  )}
                </Show>
              </section>
            </Show>

            <Show when={state() === "loading"}>
              <div class="viewer-loading">{t("viewer.status.loading")}</div>
            </Show>

            <Show when={state() === "error"}>
              <div class="viewer-error">
                <p>{error()}</p>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </main>
  );
}

function TocNode(props: {
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
        <Show when={hasChildren()} fallback={<span class="foliate-toc-expander-spacer" />}>
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

function normalizeToc(items: unknown[]): FoliateTocItem[] {
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
    typeof item.id === "string" || typeof item.id === "number" ? item.id : undefined;
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

async function hydrateTocLocations(
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

function computeExpandedTocKeys(items: FoliateTocItem[], activeHrefValue: string): Set<string> {
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

function DetailsSection({
  kind,
  label,
  emptyLabel,
  items,
}: DetailsSectionProps): JSX.Element {
  const [open, setOpen] = createSignal(true);

  return (
    <section class={`foliate-details-section is-${kind}`}>
      <button
        class="foliate-details-section-head"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span>{label}</span>
        <IconChevron size={14} />
      </button>
      <Show when={open()}>
        <div class="foliate-details-section-body">
          <Show
            when={items.length > 0}
            fallback={<p class="foliate-details-empty-text">{emptyLabel}</p>}
          >
            {kind === "description" ? (
              <For each={items as string[]}>
                {(item) => <p class="foliate-details-description">{item}</p>}
              </For>
            ) : kind === "series" ? (
              <div class="foliate-details-series-list">
                <For each={items as SeriesItem[]}>
                  {(item) => (
                    <div class="foliate-details-series-item">
                      <strong>{item.label}</strong>
                      <span>{item.position}</span>
                    </div>
                  )}
                </For>
              </div>
            ) : (
              <dl class="foliate-details-field-list">
                <For each={items as MetadataSection[]}>
                  {(item) => (
                    <>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </>
                  )}
                </For>
              </dl>
            )}
          </Show>
        </div>
      </Show>
    </section>
  );
}

function buildMetadataSections(
  metadata: FoliateBookMetadata | null,
  t: (key: Parameters<ReturnType<typeof useT>>[0]) => string,
  uiLang: UiLang,
): MetadataSection[] {
  if (!metadata) return [];
  const fields: Array<[string, string]> = [
    ["publisher", formatContributor(metadata.publisher, uiLang)],
    ["published", formatDateValue(metadata.published, uiLang)],
    ["modified", formatDateValue(metadata.modified, uiLang)],
    ["language", formatLanguageValue(metadata.language, uiLang)],
    ["subject", formatContributor(metadata.subject, uiLang)],
    ["identifier", formatIdentifier(metadata.identifier)],
    ["rights", formatTextValue(metadata.rights, uiLang)],
  ];

  return fields
    .map(([key, value]) => ({
      key,
      label: t(`viewer.metadata.${key}` as Parameters<typeof t>[0]),
      value: value || t("viewer.metadata.unknown"),
    }))
    .filter((item) => item.value !== "");
}

function buildSeriesSections(
  metadata: FoliateBookMetadata | null,
  t: (key: Parameters<ReturnType<typeof useT>>[0]) => string,
  uiLang: UiLang,
): SeriesItem[] {
  const series = normalizeSeries(metadata?.belongsTo?.series, uiLang);
  return series.map((item, index) => ({
    key: `${item.label}-${item.position}-${index}`,
    label: item.label || t("viewer.metadata.unknown"),
    position: item.position || t("viewer.metadata.unknown"),
  }));
}

function buildDescriptionSections(
  metadata: FoliateBookMetadata | null,
  uiLang: UiLang,
): string[] {
  const description = normalizeDescription(metadata?.description, uiLang);
  if (!description) return [];
  return description.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
}

function normalizeSeries(
  value?: FoliateSeriesValue | FoliateSeriesValue[] | null,
  uiLang?: UiLang,
): SeriesItem[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .map((item) => {
      return {
        label: formatLanguageMap(item.name, uiLang),
        position: formatPosition(item.position),
      };
    })
    .filter((item): item is SeriesItem => Boolean(item));
}

function formatContributor(value: FoliateBookMetadata["author"], uiLang?: UiLang): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const locale = getDisplayLocale(uiLang);
    const items = value
      .map((item) => formatContributor(item as FoliateBookMetadata["author"], uiLang))
      .filter(Boolean);
    return items.length > 0
      ? new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items)
      : "";
  }
  return formatLanguageMap(value.name ?? value, uiLang);
}

function formatLanguageValue(value: FoliateBookMetadata["language"], uiLang: UiLang): string {
  if (!value) return "";
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  const locale = uiLang === "zh-Hans" ? "zh-Hans" : uiLang;
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(raw) ?? raw;
  } catch {
    return raw;
  }
}

function formatDateValue(value: string | Date | undefined, uiLang?: UiLang): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(getDisplayLocale(uiLang), {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function formatPosition(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function formatIdentifier(value: string | string[] | undefined): string {
  if (!value) return "";
  return Array.isArray(value) ? value.filter(Boolean).join(", ") : value;
}

function formatTextValue(
  value: string | Record<string, string> | undefined,
  uiLang?: UiLang,
): string {
  if (!value) return "";
  return typeof value === "string" ? stripHtml(value) : formatLanguageMap(value, uiLang);
}

function normalizeDescription(
  value: FoliateBookMetadata["description"],
  uiLang?: UiLang,
): string {
  if (!value) return "";
  return typeof value === "string" ? stripHtml(value) : formatLanguageMap(value, uiLang);
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createReaderFile(source: ReaderSource): File {
  return new File([source.data.slice(0)], source.name || `document.${source.format}`, {
    type: mimeFromName(source.name, source.format),
  });
}

function mimeFromName(name: string, format: ViewerFormat): string {
  const lower = name.toLowerCase();
  if (format === "pdf" || lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".fb2")) return "application/x-fictionbook+xml";
  if (lower.endsWith(".fbz") || lower.endsWith(".fb2.zip")) {
    return "application/x-zip-compressed-fb2";
  }
  if (lower.endsWith(".mobi")) return "application/x-mobipocket-ebook";
  if (lower.endsWith(".azw3") || lower.endsWith(".kf8")) {
    return "application/vnd.amazon.ebook";
  }
  return "application/octet-stream";
}

function stripDocumentName(name: string): string {
  return name.replace(/\.(pdf|epub|mobi|azw3|kf8|fb2|fb2\.zip|fbz)$/i, "") || name;
}

function formatLanguageMap(
  value: string | Record<string, string> | undefined,
  preferredLang?: UiLang,
): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (preferredLang) {
    const preferredKeys = [
      preferredLang,
      preferredLang.split("-")[0] ?? "",
      preferredLang === "zh-Hans" || preferredLang === "zh-Hant" ? "zh" : "",
    ].filter(Boolean);
    for (const key of preferredKeys) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
  }
  const keys = Object.keys(value);
  return keys.length > 0 ? value[keys[0]!] ?? "" : "";
}

function getDisplayLocale(uiLang?: UiLang): string {
  if (!uiLang) return "en";
  if (uiLang === "zh-Hans") return "zh-Hans";
  if (uiLang === "zh-Hant") return "zh-Hant";
  return uiLang;
}

function applyLanguageToDocument(targetDocument: Document, uiLang: UiLang): void {
  targetDocument.documentElement.lang ||= htmlLang(uiLang);
  if (!targetDocument.documentElement.dir && (uiLang === "ar" || uiLang === "fa")) {
    targetDocument.documentElement.dir = "rtl";
  }
}

function htmlLang(uiLang: UiLang): string {
  if (uiLang === "zh-Hans") return "zh-Hans";
  if (uiLang === "zh-Hant") return "zh-Hant";
  return uiLang;
}

function viewFlow(mode: ViewMode): "paginated" | "scrolled" {
  return mode === "scroll" ? "scrolled" : "paginated";
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function isWideViewport(): boolean {
  return window.innerWidth >= MOBILE_BREAKPOINT;
}

function toPercent(fraction: number): string {
  return `${Math.round(fraction * 10000) / 100}%`;
}

function normalizeSidebarWidth(value: unknown, fallback: number): string {
  if (typeof value !== "string") return toPercent(fallback);
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?%$/.test(trimmed)) return toPercent(fallback);
  const fraction = Number.parseFloat(trimmed) / 100;
  if (!Number.isFinite(fraction)) return toPercent(fallback);
  return toPercent(clamp(fraction, SIDEBAR_MIN, SIDEBAR_MAX));
}

function parseWidthFraction(value: string): number {
  const fraction = Number.parseFloat(value);
  return Number.isFinite(fraction) ? fraction / 100 : SIDEBAR_DEFAULT_DESKTOP;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function syncReaderLayout(width: string | null, mode: ViewMode): void {
  const el = document.querySelector("foliate-view") as FoliateViewElement | null;
  const renderer = el?.renderer;
  if (!renderer) return;
  renderer.setAttribute("gap", mode === "scroll" ? "3%" : "4%");
  renderer.setAttribute("max-column-count", mode === "scroll" ? "1" : "2");
  if (mode === "pages") {
    const sidebarFraction = width ? parseWidthFraction(width) : 0;
    const viewport = Math.max(320, window.innerWidth);
    const available = Math.max(360, Math.round(viewport * (1 - sidebarFraction)));
    const maxInline = clamp(available * 0.62, 440, 760);
    renderer.setAttribute("max-inline-size", `${Math.round(maxInline)}px`);
  } else {
    renderer.removeAttribute("max-inline-size");
  }
}

export default App;
