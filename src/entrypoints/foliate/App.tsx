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
  IconPin,
  IconPinFilled,
  IconScroll,
  IconSidebar,
} from "@/lib/ui/icons";
import { initFoliateBridge } from "./bridge";
import type {
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

const SIDEBAR_MIN = 0.05;
const SIDEBAR_MAX = 0.45;
const SIDEBAR_DEFAULT_DESKTOP = 0.24;
const SIDEBAR_DEFAULT_MOBILE = 0.25;
const MOBILE_BREAKPOINT = 720;

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
  const [activeHref, setActiveHref] = createSignal("");
  const [isDesktop, setIsDesktop] = createSignal(isWideViewport());
  const [isDragging, setIsDragging] = createSignal(false);

  let renderHost: HTMLDivElement | undefined;
  let view: FoliateViewElement | undefined;
  let stopBridge: (() => void) | undefined;
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

    const bookTitle = formatLanguageMap(el.book?.metadata?.title);
    if (bookTitle) setDocTitle(bookTitle);
    setToc(normalizeToc(el.book?.toc ?? []));
    setState("ready");
    syncReaderLayout(sidebarVisible() && isDockedSidebar() ? sidebarWidth() : null, viewMode());

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
    setSidebarVisible(false);
    setIsDragging(false);
    navigationLocked = false;
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
    await setSettings({
      foliateSidebarPinned: nextPinned,
      foliateSidebarWidth: sidebarWidth(),
    });
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
              <div class="foliate-sidebar-title">{t("viewer.sidebar.title")}</div>
              <button
                aria-label={sidebarPinned() ? t("viewer.sidebar.unpin") : t("viewer.sidebar.pin")}
                class="foliate-icon-button"
                classList={{ "is-active": sidebarPinned() }}
                disabled={state() !== "ready" || !isDesktop()}
                onClick={() => void togglePinSidebar()}
                type="button"
              >
                {sidebarPinned() ? <IconPinFilled size={16} /> : <IconPin size={16} />}
              </button>
            </div>
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
