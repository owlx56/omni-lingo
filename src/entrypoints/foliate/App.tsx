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
import { useSettings } from "@/lib/storage/settings";
import { IconPages, IconScroll, IconSidebar } from "@/lib/ui/icons";
import { initFoliateBridge } from "./bridge";
import type { FoliateRelocateDetail, FoliateTocItem, FoliateViewElement } from "./types";

type ViewState = "loading" | "ready" | "error";
type ViewMode = "pages" | "scroll";
type ReaderSource = {
  data: ArrayBuffer;
  format: ViewerFormat;
  name: string;
  url?: string;
};

function App(): JSX.Element {
  const t = useT();
  const settings = useSettings();
  const [state, setState] = createSignal<ViewState>("loading");
  const [error, setError] = createSignal("");
  const [docTitle, setDocTitle] = createSignal("");
  const [locationLabel, setLocationLabel] = createSignal("");
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<ViewMode>("pages");
  const [toc, setToc] = createSignal<FoliateTocItem[]>([]);
  const [activeHref, setActiveHref] = createSignal("");

  let renderHost: HTMLDivElement | undefined;
  let view: FoliateViewElement | undefined;
  let stopBridge: (() => void) | undefined;
  let navigationLocked = false;

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
    stopBridge = undefined;
    view?.remove();
    view = undefined;
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
    setDocTitle(stripDocumentName(source.name));
    setState("loading");

    await customElements.whenDefined("foliate-view");
    const el = ensureViewElement();
    const file = createReaderFile(source);
    await el.open(file);

    el.renderer?.setAttribute("flow", viewFlow(viewMode()));
    stopBridge = initFoliateBridge(el, {
      onLocationChange: onLocationChange,
    });

    const bookTitle = formatLanguageMap(el.book?.metadata?.title);
    if (bookTitle) setDocTitle(bookTitle);
    setToc(normalizeToc(el.book?.toc ?? []));
    setState("ready");

    await nextFrame();
    await el.goToTextStart?.().catch(async () => {
      await el.next();
    });
  };

  const resetReaderState = (): void => {
    stopBridge?.();
    stopBridge = undefined;
    view?.remove();
    view = undefined;
    renderHost?.replaceChildren();
    setToc([]);
    setActiveHref("");
    setLocationLabel("");
    setSidebarOpen(false);
  };

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
    setSidebarOpen((value) => !value);
  };

  const setMode = (nextMode: ViewMode): void => {
    setViewMode(nextMode);
    view?.renderer?.setAttribute("flow", viewFlow(nextMode));
  };

  const goLeft = async (): Promise<void> => {
    if (!view || navigationLocked) return;
    navigationLocked = true;
    try {
      await view.goLeft();
    } finally {
      navigationLocked = false;
    }
  };

  const goRight = async (): Promise<void> => {
    if (!view || navigationLocked) return;
    navigationLocked = true;
    try {
      await view.goRight();
    } finally {
      navigationLocked = false;
    }
  };

  const goToToc = async (href: string): Promise<void> => {
    if (!view || navigationLocked || !href) return;
    navigationLocked = true;
    try {
      setSidebarOpen(false);
      await view.goTo(href);
    } finally {
      navigationLocked = false;
    }
  };

  const isActiveToc = (href: string): boolean => activeHref() === href;

  return (
    <main class="viewer-root" data-onelingo-reader-ui="">
      <header class="foliate-toolbar">
        <button
          aria-label={sidebarOpen() ? t("viewer.sidebar.close") : t("viewer.sidebar.open")}
          class="foliate-nav-button"
          disabled={state() !== "ready"}
          onClick={toggleSidebar}
          type="button"
        >
          <IconSidebar size={16} />
        </button>
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
            classList={{ "foliate-mode-button": true, "is-active": viewMode() === "pages" }}
            disabled={state() !== "ready"}
            onClick={() => setMode("pages")}
            type="button"
          >
            <IconPages size={14} />
            <span>{t("viewer.mode.pages")}</span>
          </button>
          <button
            classList={{ "foliate-mode-button": true, "is-active": viewMode() === "scroll" }}
            disabled={state() !== "ready"}
            onClick={() => setMode("scroll")}
            type="button"
          >
            <IconScroll size={14} />
            <span>{t("viewer.mode.scroll")}</span>
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

      <div classList={{ "foliate-shell": true, "sidebar-open": sidebarOpen() }}>
        <aside class="foliate-sidebar">
          <div class="foliate-sidebar-head">{t("viewer.sidebar.title")}</div>
          <div class="foliate-sidebar-body">
            <Show
              when={toc().length > 0}
              fallback={<div class="foliate-sidebar-empty">{t("viewer.sidebar.empty")}</div>}
            >
              <nav class="foliate-toc">
                <For each={toc()}>
                  {(item) => (
                    <TocNode item={item} isActive={isActiveToc} onSelect={goToToc} />
                  )}
                </For>
              </nav>
            </Show>
          </div>
        </aside>

        <button
          aria-hidden="true"
          class="foliate-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          tabIndex={-1}
          type="button"
        />

        <div
          class="foliate-render-area"
          id="foliate-render"
          ref={(el) => {
            renderHost = el;
          }}
        />

        <Show when={state() === "loading"}>
          <div class="viewer-loading">{t("viewer.status.loading")}</div>
        </Show>

        <Show when={state() === "error"}>
          <div class="viewer-error">
            <p>{error()}</p>
          </div>
        </Show>
      </div>
    </main>
  );
}

function TocNode(props: {
  item: FoliateTocItem;
  isActive: (href: string) => boolean;
  onSelect: (href: string) => Promise<void>;
}): JSX.Element {
  return (
    <div
      classList={{ "foliate-toc-item": true, active: props.isActive(props.item.href) }}
    >
      <button
        class="foliate-toc-link"
        onClick={() => void props.onSelect(props.item.href)}
        type="button"
      >
        {props.item.label}
      </button>
      <Show when={props.item.subitems.length > 0}>
        <div class="foliate-toc-children">
          <For each={props.item.subitems}>
            {(child) => (
              <TocNode item={child} isActive={props.isActive} onSelect={props.onSelect} />
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

function formatLanguageMap(value: string | Record<string, string> | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const keys = Object.keys(value);
  return keys.length > 0 ? value[keys[0]!] ?? "" : "";
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

export default App;
