import {
  createEffect,
  createSignal,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { loadDocument, storeDocument } from "@/lib/document-store";
import { fetchDocumentFromUrl } from "@/lib/document-resolver";
import {
  epubViewerUrlForStoredKey,
  pdfViewerUrlForFile,
  pdfViewerUrlForStoredKey,
  type ViewerFormat,
} from "@/lib/document-viewer-urls";
import { useT } from "@/lib/i18n";
import type { UiLang } from "@/lib/languages";
import { sendMessage } from "@/lib/messaging";
import { useSettings } from "@/lib/storage/settings";

type ViewState = "loading" | "error";

function App(): JSX.Element {
  const t = useT();
  const settings = useSettings();
  const [state, setState] = createSignal<ViewState>("loading");
  const [error, setError] = createSignal("");

  createEffect(() => {
    const lang = settings().uiLang;
    applyLanguageToDocument(document, lang);
    document.title = t("viewer.title");
  });

  onMount(() => {
    void init();
  });

  const init = async (): Promise<void> => {
    const params = new URLSearchParams(location.search);
    const key = params.get("key");
    const url = params.get("url");

    if (key) {
      await redirectStoredDocument(key);
      return;
    }
    if (url) {
      const format = (params.get("format") ?? "auto") as ViewerFormat;
      await resolveAndRedirectUrl(url, format);
      return;
    }
    if (params.get("sniff") === "1") {
      const pending = await sendMessage("consumeSniffedDocument", {});
      if (pending?.action === "open" && pending.url) {
        await resolveAndRedirectUrl(pending.url, "auto");
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

  const redirectStoredDocument = async (key: string): Promise<void> => {
    try {
      const doc = await loadDocument(key);
      if (!doc) {
        setError(t("viewer.error.notFound"));
        setState("error");
        return;
      }
      location.replace(
        doc.format === "pdf"
          ? pdfViewerUrlForStoredKey(key, settings().uiLang)
          : epubViewerUrlForStoredKey(key),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const resolveAndRedirectUrl = async (
    url: string,
    formatHint: ViewerFormat,
  ): Promise<void> => {
    try {
      const doc = await fetchDocumentFromUrl(url, formatHint);
      if (doc.format === "pdf") {
        location.replace(pdfViewerUrlForFile(doc.url, settings().uiLang));
        return;
      }
      const key = await storeDocument(doc.data, doc.format, doc.name);
      location.replace(epubViewerUrlForStoredKey(key));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  return (
    <main class="viewer-root">
      <Show when={state() === "loading"}>
        <div class="viewer-loading">{t("viewer.status.loading")}</div>
      </Show>
      <Show when={state() === "error"}>
        <div class="viewer-error">
          <p>{error()}</p>
        </div>
      </Show>
    </main>
  );
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

export default App;
