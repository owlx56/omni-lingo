import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import ePub from "epubjs";
import type { Book, Rendition } from "epubjs";
import { IconPages, IconScroll, IconSidebar } from "@/lib/ui/icons";
import { loadDocument } from "@/lib/document-store";
import { fetchDocumentFromUrl } from "@/lib/document-resolver";
import {
  epubViewerUrlForFile,
  pdfViewerUrlForFile,
  pdfViewerUrlForStoredKey,
  type DocumentFormat,
  type ViewerFormat,
} from "@/lib/document-viewer-urls";
import { useT } from "@/lib/i18n";
import type { UiLang } from "@/lib/languages";
import { sendMessage } from "@/lib/messaging";
import { useSettings, watchSettings } from "@/lib/storage/settings";
import {
  applyThemeToDocument,
  getEffectiveTheme,
  watchEffectiveTheme,
  type EffectiveTheme,
} from "@/lib/theme";
import { initEpubBridge } from "./bridge";

type ViewState = "loading" | "ready" | "error";
type EpubViewMode = "pages" | "scroll";
type TocItem = {
  href: string;
  label: string;
  subitems: TocItem[];
};

function App(): JSX.Element {
  const t = useT();
  const settings = useSettings();
  const [state, setState] = createSignal<ViewState>("loading");
  const [error, setError] = createSignal("");
  const [docTitle, setDocTitle] = createSignal("");
  const [docFormat, setDocFormat] = createSignal<DocumentFormat>("epub");
  const [currentLocation, setCurrentLocation] = createSignal("");
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<EpubViewMode>("pages");
  const [toc, setToc] = createSignal<TocItem[]>([]);
  const [activeHref, setActiveHref] = createSignal("");

  let bookRef: Book | undefined;
  let renditionRef: Rendition | undefined;
  let stopThemeSync: (() => void) | undefined;
  let stopBridge: (() => void) | undefined;
  let currentLocationCfi = "";
  let pageBackStack: string[] = [];
  let pageForwardStack: string[] = [];
  let navigationInFlight = false;
  const readerUiAttrs = { "data-onelingo-reader-ui": "" };

  createEffect(() => {
    const lang = settings().uiLang;
    applyLanguageToDocument(document, lang);
    document.title = docTitle() || t("viewer.title");
  });

  onMount(() => {
    void init();
  });

  onCleanup(() => {
    stopBridge?.();
    stopThemeSync?.();
    renditionRef?.destroy();
    bookRef?.destroy();
  });

  const init = async (): Promise<void> => {
    const params = new URLSearchParams(location.search);
    const key = params.get("onelingo-key");
    const file = params.get("file");

    if (key) {
      await loadFromStore(key);
    } else if (file) {
      const format = (params.get("format") ?? "auto") as ViewerFormat;
      await loadFromUrl(file, format);
    } else if (
      params.get("onelingo-sniff") === "1" ||
      params.get("sniff") === "1"
    ) {
      const pending = await sendMessage("consumeSniffedDocument", {});
      if (pending?.action === "open" && pending.url) {
        await loadFromUrl(pending.url, "auto");
      } else if (pending?.action === "bypass" && pending.url) {
        location.replace(pending.url);
      } else if (pending?.action === "handled") {
        setError(t("viewer.error.openedInReader"));
        setState("error");
      } else {
        setError(t("viewer.error.noSniffedDocument"));
        setState("error");
      }
    } else {
      setError(t("viewer.error.noDocument"));
      setState("error");
    }
  };

  const loadFromStore = async (key: string): Promise<void> => {
    try {
      const doc = await loadDocument(key);
      if (!doc) {
        setError(t("viewer.error.notFound"));
        setState("error");
        return;
      }
      setDocTitle(doc.name.replace(/\.(pdf|epub)$/i, "") || "Document");
      setDocFormat(doc.format);
      if (doc.format === "pdf") {
        location.replace(pdfViewerUrlForStoredKey(key, settings().uiLang));
      } else {
        await renderEpub(doc.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const loadFromUrl = async (
    url: string,
    formatHint: ViewerFormat,
  ): Promise<void> => {
    try {
      const doc = await fetchDocumentFromUrl(url, formatHint);
      setDocFormat(doc.format);
      setDocTitle(doc.name.replace(/\.(pdf|epub)$/i, "") || "Document");
      if (doc.format === "pdf") {
        location.replace(pdfViewerUrlForFile(doc.url, settings().uiLang));
        return;
      }
      const viewerUrl = epubViewerUrlForFile(doc.url);
      history.replaceState(null, "", viewerUrl);
      await renderEpub(doc.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const renderEpub = async (data: ArrayBuffer): Promise<void> => {
    resetReaderState();

    const book = ePub(data);
    bookRef = book;
    await book.ready;

    const metadata = await book.loaded.metadata;
    if (metadata.title) setDocTitle(metadata.title);

    setDocFormat("epub");
    setState("ready");
    await nextFrame();

    const el = document.getElementById("epub-render");
    if (!el) {
      setError(t("viewer.error.missingElement"));
      setState("error");
      return;
    }

    const navigation = await book.loaded.navigation;
    setToc(normalizeToc(navigation?.toc ?? []));

    const mode = viewMode();
    const rendition = createRendition(book, el, mode);
    renditionRef = rendition;

    stopBridge?.();
    stopBridge = initEpubBridge(rendition);

    stopThemeSync?.();
    stopThemeSync = syncRenditionDocumentPrefs(rendition, settings().uiLang);

    rendition.on("relocated", (loc: { start: { label: string; href: string; cfi: string } }) => {
      currentLocationCfi = loc.start.cfi;
      setCurrentLocation(loc.start.label);
      syncActiveToc(loc.start.href);
    });

    rendition.on("rendered", (_section: unknown, view: unknown) => {
      if (view && typeof view === "object") {
        const contents = view as { section?: { href?: string } };
        const href = contents.section?.href ?? "";
        if (href) {
          syncActiveToc(href);
        }
      }
    });

    await restoreLocation(rendition, currentLocationCfi || undefined);
  };

  const resetReaderState = (): void => {
    stopBridge?.();
    stopBridge = undefined;
    stopThemeSync?.();
    stopThemeSync = undefined;
    renditionRef?.destroy();
    renditionRef = undefined;
    resetPageNavigation();
    setToc([]);
    setActiveHref("");
    setCurrentLocation("");
    currentLocationCfi = "";
  };

  const createRendition = (
    book: Book,
    el: HTMLElement,
    mode: EpubViewMode,
  ): Rendition => {
    const rendition = book.renderTo(el, {
      width: "100%",
      height: "100%",
      spread: "none",
      manager: mode === "scroll" ? "continuous" : "default",
      flow: mode === "scroll" ? "scrolled-doc" : "paginated",
    });
    return rendition;
  };

  const rebuildRendition = async (mode: EpubViewMode): Promise<void> => {
    if (!bookRef) return;
    const el = document.getElementById("epub-render");
    if (!el) return;

    const cfi = currentLocationCfi || undefined;
    stopBridge?.();
    stopBridge = undefined;
    stopThemeSync?.();
    stopThemeSync = undefined;
    renditionRef?.destroy();
    renditionRef = createRendition(bookRef, el, mode);
    setViewMode(mode);
    setSidebarOpen(false);

    stopBridge = initEpubBridge(renditionRef);
    stopThemeSync = syncRenditionDocumentPrefs(renditionRef, settings().uiLang);
    resetPageNavigation();
    await restoreLocation(renditionRef, cfi);
  };

  const restoreLocation = async (
    rendition: Rendition,
    cfi?: string,
  ): Promise<void> => {
    if (cfi) {
      await rendition.display(cfi);
      return;
    }
    await rendition.display();
  };

  const syncActiveToc = (href: string): void => {
    if (!href) return;
    const normalized = href.split("#", 1)[0] ?? href;
    setActiveHref(normalized);
  };

  const resetPageNavigation = (): void => {
    pageBackStack = [];
    pageForwardStack = [];
  };

  const pushUnique = (stack: string[], cfi: string): void => {
    if (!cfi) return;
    if (stack[stack.length - 1] === cfi) return;
    stack.push(cfi);
  };

  const toggleSidebar = (): void => {
    setSidebarOpen((value) => !value);
  };

  const goPrev = async (): Promise<void> => {
    if (!renditionRef || navigationInFlight) return;
    navigationInFlight = true;
    try {
      const current = currentLocationCfi;
      if (current) pushUnique(pageForwardStack, current);
      const target = pageBackStack.pop();
      if (target) {
        await renditionRef.display(target);
        return;
      }
      await renditionRef.prev();
    } finally {
      navigationInFlight = false;
    }
  };

  const goNext = async (): Promise<void> => {
    if (!renditionRef || navigationInFlight) return;
    navigationInFlight = true;
    try {
      const current = currentLocationCfi;
      if (current) pushUnique(pageBackStack, current);
      const target = pageForwardStack.pop();
      if (target) {
        await renditionRef.display(target);
        return;
      }
      await renditionRef.next();
    } finally {
      navigationInFlight = false;
    }
  };

  const selectTocItem = async (href: string): Promise<void> => {
    if (!renditionRef || !href || navigationInFlight) return;
    navigationInFlight = true;
    try {
      resetPageNavigation();
      setSidebarOpen(false);
      await renditionRef.display(href);
    } finally {
      navigationInFlight = false;
    }
  };

  const isActiveToc = (href: string): boolean => {
    const normalized = href.split("#", 1)[0] ?? href;
    return activeHref() === normalized;
  };

  return (
    <main class="viewer-root" {...readerUiAttrs}>
      <Show when={state() === "error"}>
        <div class="viewer-error" {...readerUiAttrs}>
          <p>{error()}</p>
        </div>
      </Show>

      <Show when={state() === "loading"}>
        <div class="viewer-loading" {...readerUiAttrs}>
          {t("viewer.status.loading")}
        </div>
      </Show>

      <Show when={state() === "ready" && docFormat() === "epub"}>
        <header class="epub-toolbar" {...readerUiAttrs}>
          <button
            aria-label={sidebarOpen() ? t("viewer.sidebar.close") : t("viewer.sidebar.open")}
            class="epub-nav-button"
            onClick={toggleSidebar}
            type="button"
          >
            <IconSidebar size={16} />
          </button>
          <button class="epub-nav-button" onClick={goPrev} type="button">
            ‹
          </button>
          <span class="epub-toolbar-title">{docTitle()}</span>
          <span class="epub-toolbar-location">{currentLocation()}</span>
          <div class="epub-mode-switch" role="group" aria-label={t("viewer.sections")}>
            <button
              classList={{ "epub-mode-button": true, "is-active": viewMode() === "pages" }}
              onClick={() => void rebuildRendition("pages")}
              type="button"
            >
              <IconPages size={14} />
              <span>{t("viewer.mode.pages")}</span>
            </button>
            <button
              classList={{ "epub-mode-button": true, "is-active": viewMode() === "scroll" }}
              onClick={() => void rebuildRendition("scroll")}
              type="button"
            >
              <IconScroll size={14} />
              <span>{t("viewer.mode.scroll")}</span>
            </button>
          </div>
          <button class="epub-nav-button" onClick={goNext} type="button">
            ›
          </button>
        </header>

        <div classList={{ "epub-shell": true, "sidebar-open": sidebarOpen() }}>
          <aside class="epub-sidebar" {...readerUiAttrs}>
            <div class="epub-sidebar-head">{t("viewer.sidebar.title")}</div>
            <div class="epub-sidebar-body">
              <Show
                when={toc().length > 0}
                fallback={<div class="epub-sidebar-empty">{t("viewer.sidebar.empty")}</div>}
              >
                <nav class="epub-toc">
                  <For each={toc()}>
                    {(item) => (
                      <TocNode
                        item={item}
                        onSelect={selectTocItem}
                        isActive={isActiveToc}
                      />
                    )}
                  </For>
                </nav>
              </Show>
            </div>
          </aside>

          <button
            aria-hidden="true"
            class="epub-sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
            tabIndex={-1}
            type="button"
          />

          <div class="epub-render-area" id="epub-render" />
        </div>
      </Show>

      <Show when={state() === "ready" && docFormat() !== "epub"}>
        <div class="viewer-loading" {...readerUiAttrs}>
          {t("viewer.status.ready")}
        </div>
      </Show>
    </main>
  );
}

function TocNode(props: {
  item: TocItem;
  isActive: (href: string) => boolean;
  onSelect: (href: string) => Promise<void>;
}): JSX.Element {
  return (
    <div classList={{ "epub-toc-item": true, active: props.isActive(props.item.href) }}>
      <button
        class="epub-toc-link"
        onClick={() => void props.onSelect(props.item.href)}
        type="button"
      >
        {props.item.label}
      </button>
      <Show when={props.item.subitems.length > 0}>
        <div class="epub-toc-children">
          <For each={props.item.subitems}>
            {(child) => (
              <TocNode
                item={child}
                onSelect={props.onSelect}
                isActive={props.isActive}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function normalizeToc(items: unknown[]): TocItem[] {
  return items
    .map((item) => normalizeTocItem(item))
    .filter((item): item is TocItem => Boolean(item));
}

function normalizeTocItem(value: unknown): TocItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as {
    href?: unknown;
    label?: unknown;
    subitems?: unknown;
  };
  const href = typeof item.href === "string" ? item.href : "";
  const label = typeof item.label === "string" ? item.label : href;
  const subitems = Array.isArray(item.subitems) ? normalizeToc(item.subitems) : [];
  if (!href && !label) return null;
  return { href, label, subitems };
}

function syncRenditionDocumentPrefs(
  rendition: Rendition,
  initialUiLang: UiLang,
): () => void {
  let currentTheme = getEffectiveTheme();
  let currentUiLang: UiLang = initialUiLang;

  rendition.hooks.content.register((contents: { document: Document }) => {
    applyEpubDocumentPrefs(contents.document, currentTheme, currentUiLang);
  });

  const syncContents = (): void => {
    for (const contents of getRenditionContents(rendition)) {
      applyEpubDocumentPrefs(contents.document, currentTheme, currentUiLang);
    }
  };
  const stopThemeWatch = watchEffectiveTheme((theme) => {
    currentTheme = theme;
    syncContents();
  });
  const stopSettingsWatch = watchSettings((settings) => {
    currentUiLang = settings.uiLang;
    syncContents();
  });
  syncContents();

  return () => {
    stopThemeWatch();
    stopSettingsWatch();
  };
}

type EpubContentDocument = { document: Document };

function applyEpubDocumentPrefs(
  doc: Document,
  theme: EffectiveTheme,
  uiLang: UiLang,
): void {
  applyThemeToDocument(doc, theme);
  applyLanguageToDocument(doc, uiLang);

  const style = doc.getElementById("onelingo-epub-theme") ?? doc.createElement("style");
  style.id = "onelingo-epub-theme";
  style.textContent = epubThemeCss(theme);
  if (!style.parentNode) (doc.head ?? doc.documentElement).appendChild(style);
}

function epubThemeCss(theme: EffectiveTheme): string {
  const isDark = theme === "dark";
  const bg = isDark ? "#1f1f1e" : "#ffffff";
  const text = isDark ? "#ebe8df" : "#1f1e1d";
  const selection = isDark
    ? "rgba(91, 141, 214, 0.42)"
    : "rgba(44, 117, 224, 0.28)";
  const link = isDark ? "#8ab4f8" : "#1f5fbf";
  return [
    `html,body{background:${bg}!important;color:${text}!important;color-scheme:${theme}!important;}`,
    `::selection{background:${selection}!important;}`,
    `a,a:visited{color:${link}!important;}`,
  ].join("\n");
}

function applyLanguageToDocument(targetDocument: Document, uiLang: UiLang): void {
  targetDocument.documentElement.lang = htmlLang(uiLang);
  targetDocument.documentElement.dir = uiLang === "ar" || uiLang === "fa" ? "rtl" : "ltr";
}

function htmlLang(uiLang: UiLang): string {
  if (uiLang === "zh-Hans") return "zh-Hans";
  if (uiLang === "zh-Hant") return "zh-Hant";
  return uiLang;
}

function getRenditionContents(rendition: Rendition): EpubContentDocument[] {
  const contents = (rendition as { getContents: () => unknown }).getContents();
  const items = Array.isArray(contents) ? contents : contents ? [contents] : [];
  return items.filter(hasDocument);
}

function hasDocument(value: unknown): value is EpubContentDocument {
  const doc = (value as { document?: unknown } | null)?.document;
  return (
    typeof doc === "object" &&
    doc !== null &&
    (doc as { nodeType?: unknown }).nodeType === Node.DOCUMENT_NODE
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export default App;
