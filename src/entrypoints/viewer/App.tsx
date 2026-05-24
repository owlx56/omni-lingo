import {
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { browser } from "wxt/browser";
import ePub from "epubjs";
import type { Book, Rendition } from "epubjs";
import { loadDocument, storeDocument } from "@/lib/document-store";
import { useT } from "@/lib/i18n";
import { initEpubBridge } from "./epub-bridge";

type DocFormat = "pdf" | "epub";
type ViewState = "loading" | "ready" | "error";

function App(): JSX.Element {
  const t = useT();
  const [state, setState] = createSignal<ViewState>("loading");
  const [error, setError] = createSignal("");
  const [docTitle, setDocTitle] = createSignal("");
  const [docFormat, setDocFormat] = createSignal<DocFormat>("epub");
  const [currentLocation, setCurrentLocation] = createSignal("");

  let bookRef: Book | undefined;
  let renditionRef: Rendition | undefined;

  const pdfViewerUrl = (fileUrl: string): string =>
    `${browser.runtime.getURL("/pdf/web/viewer.html")}?file=${encodeURIComponent(fileUrl)}`;

  onMount(() => {
    void init();
  });

  onCleanup(() => {
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
      const format = (params.get("format") ?? "auto") as DocFormat | "auto";
      await loadFromUrl(url, format);
    } else {
      setError("No document specified.");
      setState("error");
    }
  };

  const loadFromStore = async (key: string): Promise<void> => {
    try {
      const doc = await loadDocument(key);
      if (!doc) {
        setError("Document not found in storage. It may have been cleared.");
        setState("error");
        return;
      }
      setDocTitle(doc.name.replace(/\.(pdf|epub)$/i, "") || "Document");
      setDocFormat(doc.format);
      if (doc.format === "pdf") {
        renderPdf(doc.data);
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
    formatHint: DocFormat | "auto",
  ): Promise<void> => {
    try {
      const format =
        formatHint !== "auto"
          ? formatHint
          : inferFormat(url);
      setDocFormat(format);
      setDocTitle(
        decodeURIComponent(
          url
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.(pdf|epub)$/i, "") ?? "Document",
        ),
      );

      if (format === "pdf") {
        location.replace(pdfViewerUrl(url));
        return;
      }

      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.arrayBuffer();
      const key = await storeDocument(data, "epub", docTitle());
      const viewerUrl = browser.runtime.getURL(
        `/viewer.html?key=${encodeURIComponent(key)}`,
      );
      history.replaceState(null, "", viewerUrl);
      await renderEpub(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const renderPdf = (data: ArrayBuffer): void => {
    const blob = new Blob([data], { type: "application/pdf" });
    const objectUrl = URL.createObjectURL(blob);
    setState("ready");
    requestAnimationFrame(() => {
      const iframe = document.getElementById(
        "pdf-frame",
      ) as HTMLIFrameElement | null;
      if (iframe) iframe.src = pdfViewerUrl(objectUrl);
    });
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
      setError("Viewer element not found.");
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

      <Show when={state() === "ready" && docFormat() === "pdf"}>
        <iframe
          class="viewer-pdf-frame"
          id="pdf-frame"
          title={docTitle()}
        />
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

function inferFormat(url: string): DocFormat {
  const lower = url.split(/[?#]/)[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".pdf")) return "pdf";
  return "epub";
}

export default App;
