import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { browser } from "wxt/browser";
import {
  inferDocumentKind,
  inferDocumentKindFromName,
  parseReaderDocument,
  sourceFromFile,
  sourceFromUrl,
  type DocumentKind,
  type DocumentSource,
  type ReaderDocument,
  type ViewerFormat,
} from "@/features/document-viewer";
import { useT, type TFn } from "@/lib/i18n";
import { FullRow, Row, Segment, type SegmentOption } from "@/lib/ui/controls";
import { IconExternalLink, IconLogo } from "@/lib/ui/icons";

type LoadState = "idle" | "loading" | "ready" | "error";

const ACCEPTED_FILES = ".pdf,.epub,application/pdf,application/epub+zip";
const READER_UI_ATTR = "data-onelingo-reader-ui";

function formatOptions(t: TFn): SegmentOption<ViewerFormat>[] {
  return [
    { value: "auto", label: t("viewer.format.auto") },
    { value: "pdf", label: t("viewer.format.pdf") },
    { value: "epub", label: t("viewer.format.epub") },
  ];
}

function App(): JSX.Element {
  const t = useT();
  const [format, setFormat] = createSignal<ViewerFormat>("auto");
  const [url, setUrl] = createSignal("");
  const [state, setState] = createSignal<LoadState>("idle");
  const [doc, setDoc] = createSignal<ReaderDocument | null>(null);
  const [error, setError] = createSignal("");
  const pdfDoc = createMemo(() => {
    const loaded = doc();
    return loaded?.kind === "pdf" && loaded.viewerUrl ? loaded : null;
  });
  let fileInput: HTMLInputElement | undefined;
  let dropDepth = 0;

  const cleanupCurrentDocument = (): void => {
    doc()?.cleanup?.();
    setDoc(null);
  };

  onCleanup(cleanupCurrentDocument);

  createEffect(() => {
    document.documentElement.dataset.viewerMode = pdfDoc() ? "pdf" : "reader";
  });

  onCleanup(() => {
    document.documentElement.removeAttribute("data-viewer-mode");
  });

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const incomingUrl = params.get("url");
    const incomingFormat = params.get("format");
    if (
      incomingFormat === "pdf" ||
      incomingFormat === "epub" ||
      incomingFormat === "auto"
    ) {
      setFormat(incomingFormat);
    }
    if (incomingUrl) {
      setUrl(incomingUrl);
      void loadUrl(incomingUrl);
    }
  });

  const loadSource = async (source: DocumentSource): Promise<void> => {
    cleanupCurrentDocument();
    setError("");
    setState("loading");
    try {
      const kind = inferDocumentKind(source, format());
      if (kind === "pdf") {
        setDoc(createPdfDocumentFromBytes(source));
        setState("ready");
        return;
      }
      const next = await parseReaderDocument(source, format());
      setDoc(next);
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const loadUrl = async (rawUrl = url()): Promise<void> => {
    const nextUrl = rawUrl.trim();
    if (!nextUrl) return;
    setUrl(nextUrl);
    cleanupCurrentDocument();
    setState("loading");
    setError("");
    try {
      const kind = inferDocumentKindFromName(nextUrl, undefined, format());
      if (kind === "pdf") {
        location.replace(pdfViewerUrl(nextUrl));
        return;
      }
      await loadSource(await sourceFromUrl(nextUrl));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const loadFile = async (file: File): Promise<void> => {
    setUrl("");
    cleanupCurrentDocument();
    setError("");
    setState("loading");
    const kind = inferDocumentKindFromName(file.name, file.type, format());
    if (kind === "pdf") {
      setDoc(createPdfDocumentFromFile(file));
      setState("ready");
      return;
    }
    await loadSource(await sourceFromFile(file));
  };

  const openOptions = (): void => {
    void browser.runtime.openOptionsPage().catch((err: unknown) => {
      console.warn("[OneLingo] failed to open options:", err);
    });
  };

  const onDrop: JSX.EventHandlerUnion<HTMLElement, DragEvent> = (event) => {
    event.preventDefault();
    dropDepth = 0;
    event.currentTarget.classList.remove("dragging");
    const file = event.dataTransfer?.files.item(0);
    if (file) void loadFile(file);
  };

  const renderStatus = (): JSX.Element => {
    if (state() === "loading") return <span>{t("viewer.status.loading")}</span>;
    if (state() === "error") {
      return <span class="status-error">{t("viewer.status.error", { msg: error() })}</span>;
    }
    if (doc()) return <span>{t("viewer.status.ready")}</span>;
    return <span>{t("viewer.status.idle")}</span>;
  };

  return (
    <main
      class="viewer-page"
      onDragEnter={(event) => {
        event.preventDefault();
        dropDepth++;
        event.currentTarget.classList.add("dragging");
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dropDepth = Math.max(0, dropDepth - 1);
        if (dropDepth === 0) event.currentTarget.classList.remove("dragging");
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <Show when={pdfDoc()} fallback={renderReaderShell()}>
        {(loaded) => (
          <section class="pdf-reader-stage" aria-label={loaded().title}>
            <iframe
              class="pdf-reader-frame"
              src={loaded().viewerUrl ?? ""}
              title={loaded().title}
            />
          </section>
        )}
      </Show>
    </main>
  );

  function renderReaderShell(): JSX.Element {
    return (
      <>
        <header class="viewer-header" {...{ [READER_UI_ATTR]: "" }}>
          <div class="viewer-title-block">
            <span aria-hidden="true" class="avatar">
              <IconLogo size={22} />
            </span>
            <div>
              <h1>{t("viewer.title")}</h1>
              <span class="scope">{t("viewer.scope")}</span>
            </div>
          </div>
          <button class="plain-icon-button" onClick={openOptions} type="button">
            <IconExternalLink size={15} />
            <span>{t("viewer.openOptions")}</span>
          </button>
        </header>

        <div class="viewer-shell">
          <aside class="viewer-sidebar" {...{ [READER_UI_ATTR]: "" }}>
            <section class="section">
              <h2>{t("viewer.section.open")}</h2>
              <FullRow>
                <div class="url-control">
                  <input
                    aria-label={t("viewer.openUrl")}
                    class="url-input"
                    onInput={(event) => setUrl(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void loadUrl();
                    }}
                    placeholder={t("viewer.urlPlaceholder")}
                    spellcheck={false}
                    type="url"
                    value={url()}
                  />
                  <button
                    class="primary-button"
                    disabled={state() === "loading"}
                    onClick={() => void loadUrl()}
                    type="button"
                  >
                    {t("viewer.openButton")}
                  </button>
                </div>
              </FullRow>
              <Row label={t("viewer.localFile")}>
                <button
                  class="secondary-button"
                  disabled={state() === "loading"}
                  onClick={() => fileInput?.click()}
                  type="button"
                >
                  {t("viewer.chooseFile")}
                </button>
                <input
                  accept={ACCEPTED_FILES}
                  class="visually-hidden"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.item(0);
                    if (file) void loadFile(file);
                    event.currentTarget.value = "";
                  }}
                  ref={fileInput}
                  type="file"
                />
              </Row>
              <Row label={t("viewer.format")}>
                <Segment
                  label={t("viewer.format")}
                  onChange={setFormat}
                  options={formatOptions(t)}
                  value={format()}
                />
              </Row>
            </section>

            <section class="section">
              <h2>{t("viewer.section.document")}</h2>
              <Row label={t("viewer.status")}>{renderStatus()}</Row>
              <Show when={doc()}>
                {(loaded) => (
                  <>
                    <Row label={t("viewer.documentTitle")}>
                      <span class="row-static">{loaded().title}</span>
                    </Row>
                    <Row label={t("viewer.source")}>
                      <span class="row-static">{loaded().sourceName}</span>
                    </Row>
                    <Row label={t("viewer.sections")}>
                      <span class="row-static">{loaded().sections.length}</span>
                    </Row>
                  </>
                )}
              </Show>
            </section>
          </aside>

          <section class="reader-panel">
            <Show
              when={doc()}
              fallback={
                <div class="reader-empty" {...{ [READER_UI_ATTR]: "" }}>
                  <h2>{t("viewer.emptyTitle")}</h2>
                  <p>{t("viewer.emptyNote")}</p>
                </div>
              }
            >
              {(loaded) => (
                <article class="reader-flow" aria-label={loaded().title}>
                  <header class="document-heading">
                    <span class="document-kind">
                      {loaded().kind.toUpperCase()}
                    </span>
                    <h2>{loaded().title}</h2>
                    <Show when={loaded().warnings.length > 0}>
                      <p>{loaded().warnings.join(" ")}</p>
                    </Show>
                  </header>
                  <For each={loaded().sections}>
                    {(section) => (
                      <section class="reader-section" id={section.id}>
                        <Show when={section.title}>
                          <h3>{section.title}</h3>
                        </Show>
                        <div innerHTML={section.html} />
                      </section>
                    )}
                  </For>
                </article>
              )}
            </Show>
          </section>
        </div>
      </>
    );
  }
}

export default App;

function createPdfDocumentFromFile(file: File): ReaderDocument {
  const objectUrl = URL.createObjectURL(file);
  return createPdfDocument({
    cleanup: () => URL.revokeObjectURL(objectUrl),
    sourceName: file.name,
    title: titleFromSource(file.name),
    viewerFileUrl: objectUrl,
  });
}

function createPdfDocumentFromBytes(source: DocumentSource): ReaderDocument {
  const objectUrl = URL.createObjectURL(
    new Blob([source.bytes], { type: source.mimeType ?? "application/pdf" }),
  );
  return createPdfDocument({
    cleanup: () => URL.revokeObjectURL(objectUrl),
    sourceName: source.name,
    title: titleFromSource(source.name),
    viewerFileUrl: objectUrl,
  });
}

function createPdfDocument(input: {
  cleanup: (() => void) | undefined;
  sourceName: string;
  title: string;
  viewerFileUrl: string;
}): ReaderDocument {
  const viewerUrl = pdfViewerUrl(input.viewerFileUrl);
  return {
    cleanup: input.cleanup,
    kind: "pdf",
    sections: [],
    sourceName: input.sourceName,
    title: input.title,
    viewerUrl,
    warnings: [],
  };
}

function pdfViewerUrl(fileUrl: string): string {
  return `${browser.runtime.getURL("/pdf/web/viewer.html")}?file=${encodeURIComponent(fileUrl)}`;
}

function titleFromSource(source: string): string {
  const clean = source.split(/[?#]/)[0] ?? source;
  const last = clean.split(/[\\/]/).filter(Boolean).pop() ?? clean;
  return decodeURIComponent(last).replace(/\.(pdf|epub)$/i, "") || "Document";
}
