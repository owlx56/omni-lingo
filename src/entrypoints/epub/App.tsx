import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import ePub from "epubjs";
import type { Book, Rendition } from "epubjs";
import { loadDocument, storeDocument } from "@/lib/document-store";
import { fetchDocumentFromUrl } from "@/lib/document-resolver";
import {
  epubViewerUrlForStoredKey,
  pdfViewerUrlForFile,
  pdfViewerUrlForStoredKey,
  type DocumentFormat,
  type ViewerFormat,
} from "@/lib/document-viewer-urls";
import { useT } from "@/lib/i18n";
import type { UiLang } from "@/lib/languages";
import { sendMessage } from "@/lib/messaging";
import {
  useSettings,
  watchSettings,
} from "@/lib/storage/settings";
import {
  applyThemeToDocument,
  getEffectiveTheme,
  watchEffectiveTheme,
  type EffectiveTheme,
} from "@/lib/theme";
import { initEpubBridge } from "./bridge";

type ViewState = "loading" | "ready" | "error";

function App(): JSX.Element {
  const t = useT();
  const settings = useSettings();
  const [state, setState] = createSignal<ViewState>("loading");
  const [error, setError] = createSignal("");
  const [docTitle, setDocTitle] = createSignal("");
  const [docFormat, setDocFormat] = createSignal<DocumentFormat>("epub");
  const [currentLocation, setCurrentLocation] = createSignal("");

  let bookRef: Book | undefined;
  let renditionRef: Rendition | undefined;
  let stopThemeSync: (() => void) | undefined;

  createEffect(() => {
    const lang = settings().uiLang;
    applyLanguageToDocument(document, lang);
    document.title = docTitle() || t("viewer.title");
  });

  onMount(() => {
    void init();
  });

  onCleanup(() => {
    stopThemeSync?.();
    renditionRef?.destroy();
    bookRef?.destroy();
  });

  const init = async (): Promise<void> => {
    const params = new URLSearchParams(location.search);
    const key = params.get("key");
    const url = params.get("url");

    if (key) {
      await loadFromStore(key);
    } else if (url) {
      const format = (params.get("format") ?? "auto") as ViewerFormat;
      await loadFromUrl(url, format);
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
      const key = await storeDocument(doc.data, doc.format, doc.name);
      const viewerUrl = epubViewerUrlForStoredKey(key);
      history.replaceState(null, "", viewerUrl);
      await renderEpub(doc.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const renderEpub = async (data: ArrayBuffer): Promise<void> => {
    const book = ePub(data);
    bookRef = book;
    await book.ready;

    const metadata = await book.loaded.metadata;
    if (metadata.title) setDocTitle(metadata.title);

    setDocFormat("epub");
    setState("ready");
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const el = document.getElementById("epub-render");
    if (!el) {
      setError(t("viewer.error.missingElement"));
      setState("error");
      return;
    }

    const rendition = book.renderTo(el, {
      width: "100%",
      height: "100%",
      spread: "none",
      flow: "paginated",
    });
    renditionRef = rendition;

    initEpubBridge(rendition);
    stopThemeSync?.();
    stopThemeSync = syncRenditionDocumentPrefs(rendition, settings().uiLang);

    rendition.on("relocated", (loc: { start: { label: string } }) => {
      setCurrentLocation(loc.start.label);
    });

    await rendition.display();
  };

  const goPrev = (): void => {
    renditionRef?.prev();
  };

  const goNext = (): void => {
    renditionRef?.next();
  };

  return (
    <main class="viewer-root">
      <Show when={state() === "error"}>
        <div class="viewer-error">
          <p>{error()}</p>
        </div>
      </Show>

      <Show when={state() === "loading"}>
        <div class="viewer-loading">{t("viewer.status.loading")}</div>
      </Show>

      <Show when={state() === "ready" && docFormat() === "epub"}>
        <header class="epub-toolbar">
          <button class="epub-nav-button" onClick={goPrev} type="button">
            ‹
          </button>
          <span class="epub-toolbar-title">{docTitle()}</span>
          <span class="epub-toolbar-location">{currentLocation()}</span>
          <button class="epub-nav-button" onClick={goNext} type="button">
            ›
          </button>
        </header>
        <div class="epub-render-area" id="epub-render" />
      </Show>
    </main>
  );
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

export default App;
