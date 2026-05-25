import { getDocument, GlobalWorkerOptions } from "../build/pdf.mjs";
import {
  EventBus,
  FindState,
  GenericL10n,
  LinkTarget,
  PDFFindController,
  PDFHistory,
  PDFLinkService,
  PDFViewer,
  ScrollMode,
  SpreadMode,
} from "./pdf_viewer.mjs";

const ASSET_PATHS = {
  cMapUrl: "../web/cmaps/",
  iccUrl: "../web/iccs/",
  imageResourcesPath: "./images/",
  standardFontDataUrl: "../web/standard_fonts/",
  wasmUrl: "../web/wasm/",
  workerSrc: "../build/pdf.worker.mjs",
};

const SCALE_STEP = 1.1;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const THUMBNAIL_WIDTH = 96;

const SCROLL_MODES = {
  horizontal: ScrollMode.HORIZONTAL,
  page: ScrollMode.PAGE,
  vertical: ScrollMode.VERTICAL,
  wrapped: ScrollMode.WRAPPED,
};
const SPREAD_MODES = {
  even: SpreadMode.EVEN,
  none: SpreadMode.NONE,
  odd: SpreadMode.ODD,
};

const elements = {
  attachmentsView: mustGetElement("attachmentsView"),
  downloadButton: mustGetElement("download"),
  errorMessage: mustGetElement("errorMessage"),
  errorWrapper: mustGetElement("errorWrapper"),
  fileInput: mustGetElement("fileInput"),
  findClose: mustGetElement("findClose"),
  findHighlightAll: mustGetElement("findHighlightAll"),
  findInput: mustGetElement("findInput"),
  findMatchCase: mustGetElement("findMatchCase"),
  findMatchDiacritics: mustGetElement("findMatchDiacritics"),
  findEntireWord: mustGetElement("findEntireWord"),
  findMsg: mustGetElement("findMsg"),
  findNext: mustGetElement("findNext"),
  findPrevious: mustGetElement("findPrevious"),
  findResultsCount: mustGetElement("findResultsCount"),
  findToggle: mustGetElement("findToggle"),
  findbar: mustGetElement("findbar"),
  firstPage: mustGetElement("firstPage"),
  lastPage: mustGetElement("lastPage"),
  loadingBar: mustGetElement("loadingBar"),
  loadingBarProgress: mustGetElement("loadingBarProgress"),
  nextButton: mustGetElement("next"),
  numPages: mustGetElement("numPages"),
  openFileButton: mustGetElement("openFile"),
  outlineView: mustGetElement("outlineView"),
  pageNumber: mustGetElement("pageNumber"),
  previousButton: mustGetElement("previous"),
  propertiesDialog: mustGetElement("propertiesDialog"),
  propertiesList: mustGetElement("propertiesList"),
  rotateCcw: mustGetElement("rotateCcw"),
  rotateCw: mustGetElement("rotateCw"),
  scaleSelect: mustGetElement("scaleSelect"),
  secondaryDownload: mustGetElement("secondaryDownload"),
  secondaryOpenFile: mustGetElement("secondaryOpenFile"),
  secondaryToolbar: mustGetElement("secondaryToolbar"),
  secondaryToolbarToggle: mustGetElement("secondaryToolbarToggle"),
  sidebarContainer: mustGetElement("sidebarContainer"),
  sidebarToggle: mustGetElement("sidebarToggle"),
  thumbnailView: mustGetElement("thumbnailView"),
  viewer: mustGetElement("viewer"),
  viewerContainer: mustGetElement("viewerContainer"),
  zoomInButton: mustGetElement("zoomIn"),
  zoomOutButton: mustGetElement("zoomOut"),
};

GlobalWorkerOptions.workerSrc = ASSET_PATHS.workerSrc;

const eventBus = new EventBus();
const linkService = new PDFLinkService({
  eventBus,
  externalLinkTarget: LinkTarget.BLANK,
});
const findController = new PDFFindController({ eventBus, linkService });
const pdfViewer = new PDFViewer({
  container: elements.viewerContainer,
  eventBus,
  findController,
  imageResourcesPath: ASSET_PATHS.imageResourcesPath,
  linkService,
  l10n: new GenericL10n(navigator.language || "en-US"),
  viewer: elements.viewer,
});
const pdfHistory = new PDFHistory({ eventBus, linkService });

let pdfDocument = null;
let loadingTask = null;
let currentFileUrl = null;
let currentObjectUrl = null;
let thumbnailObserver = null;
let activeSidebarView = "thumbnails";

linkService.setViewer(pdfViewer);
linkService.setHistory(pdfHistory);

wireToolbar();
wireFindbar();
wireSidebar();
wireSecondaryToolbar();
wireEvents();
void loadInitialDocument();

async function loadInitialDocument() {
  const file = new URLSearchParams(location.search).get("file");
  if (!file) {
    showError("No PDF file was specified.");
    return;
  }
  await loadPdf(file);
}

function wireToolbar() {
  elements.previousButton.addEventListener("click", () => {
    pdfViewer.previousPage();
  });
  elements.nextButton.addEventListener("click", () => {
    pdfViewer.nextPage();
  });
  elements.pageNumber.addEventListener("change", () => {
    const page = Number.parseInt(elements.pageNumber.value, 10);
    if (Number.isFinite(page)) {
      pdfViewer.currentPageNumber = Math.min(Math.max(1, page), pdfViewer.pagesCount);
    }
    updatePageControls();
  });
  elements.scaleSelect.addEventListener("change", () => {
    pdfViewer.currentScaleValue = elements.scaleSelect.value;
  });
  elements.zoomOutButton.addEventListener("click", () => {
    pdfViewer.currentScale = clamp(pdfViewer.currentScale / SCALE_STEP);
  });
  elements.zoomInButton.addEventListener("click", () => {
    pdfViewer.currentScale = clamp(pdfViewer.currentScale * SCALE_STEP);
  });
  elements.downloadButton.addEventListener("click", () => downloadCurrentFile());
  elements.openFileButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", () => {
    const file = elements.fileInput.files?.[0];
    if (!file) return;
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(file);
    currentFileUrl = currentObjectUrl;
    history.replaceState(null, "", `?file=${encodeURIComponent(currentObjectUrl)}`);
    void loadPdf(currentObjectUrl);
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openFindbar();
      return;
    }
    if (event.key === "Escape") {
      closeSecondaryToolbar();
      if (!elements.findbar.hidden) {
        closeFindbar();
        return;
      }
      if (!elements.sidebarContainer.hidden && window.matchMedia("(max-width: 720px)").matches) {
        closeSidebar();
      }
    }
  });
  document.addEventListener("click", (event) => {
    if (
      !elements.secondaryToolbar.hidden &&
      event.target instanceof Element &&
      !event.target.closest("#secondaryToolbar") &&
      !event.target.closest("#secondaryToolbarToggle")
    ) {
      closeSecondaryToolbar();
    }
  });
}

function wireFindbar() {
  elements.findToggle.addEventListener("click", () => {
    if (elements.findbar.hidden) {
      openFindbar();
    } else {
      closeFindbar();
    }
  });
  elements.findClose.addEventListener("click", closeFindbar);
  elements.findInput.addEventListener("input", () => dispatchFind(""));
  elements.findInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      dispatchFind("again", event.shiftKey);
    }
  });
  elements.findPrevious.addEventListener("click", () => dispatchFind("again", true));
  elements.findNext.addEventListener("click", () => dispatchFind("again", false));
  for (const checkbox of [
    elements.findHighlightAll,
    elements.findMatchCase,
    elements.findEntireWord,
    elements.findMatchDiacritics,
  ]) {
    checkbox.addEventListener("change", () => {
      const type =
        checkbox === elements.findHighlightAll
          ? "highlightallchange"
          : checkbox === elements.findMatchCase
            ? "casesensitivitychange"
            : checkbox === elements.findEntireWord
              ? "entirewordchange"
              : "diacriticmatchingchange";
      dispatchFind(type);
    });
  }
}

function wireSidebar() {
  elements.sidebarToggle.addEventListener("click", () => {
    if (elements.sidebarContainer.hidden) {
      openSidebar();
    } else {
      closeSidebar();
    }
  });
  for (const tab of document.querySelectorAll("[data-sidebar-view]")) {
    tab.addEventListener("click", () => {
      setSidebarView(tab.dataset.sidebarView);
      openSidebar();
    });
  }
}

function wireSecondaryToolbar() {
  elements.secondaryToolbarToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    if (elements.secondaryToolbar.hidden) {
      openSecondaryToolbar();
    } else {
      closeSecondaryToolbar();
    }
  });
  elements.firstPage.addEventListener("click", () => {
    pdfViewer.currentPageNumber = 1;
    closeSecondaryToolbar();
  });
  elements.lastPage.addEventListener("click", () => {
    pdfViewer.currentPageNumber = pdfViewer.pagesCount || 1;
    closeSecondaryToolbar();
  });
  elements.rotateCw.addEventListener("click", () => {
    pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360;
  });
  elements.rotateCcw.addEventListener("click", () => {
    pdfViewer.pagesRotation = (pdfViewer.pagesRotation - 90 + 360) % 360;
  });
  elements.secondaryDownload.addEventListener("click", () => {
    downloadCurrentFile();
    closeSecondaryToolbar();
  });
  elements.secondaryOpenFile.addEventListener("click", () => {
    elements.fileInput.click();
    closeSecondaryToolbar();
  });
  document.getElementById("documentProperties")?.addEventListener("click", () => {
    closeSecondaryToolbar();
    void showDocumentProperties();
  });
  for (const button of document.querySelectorAll("[data-scroll-mode]")) {
    button.addEventListener("click", () => {
      const mode = SCROLL_MODES[button.dataset.scrollMode];
      if (mode !== undefined) {
        pdfViewer.scrollMode = mode;
        updateSecondaryToolbarState();
      }
    });
  }
  for (const button of document.querySelectorAll("[data-spread-mode]")) {
    button.addEventListener("click", () => {
      const mode = SPREAD_MODES[button.dataset.spreadMode];
      if (mode !== undefined) {
        pdfViewer.spreadMode = mode;
        updateSecondaryToolbarState();
      }
    });
  }
}

function wireEvents() {
  eventBus.on("pagesinit", () => {
    elements.numPages.textContent = `/ ${pdfViewer.pagesCount}`;
    pdfViewer.currentScaleValue = "auto";
    updatePageControls();
    updateSecondaryToolbarState();
    hideLoading();
    elements.viewerContainer.focus();
  });
  eventBus.on("pagesloaded", () => {
    void buildSidebar();
  });
  eventBus.on("pagechanging", ({ pageNumber }) => {
    elements.pageNumber.value = String(pageNumber);
    updatePageControls();
    updateActiveThumbnail(pageNumber);
  });
  eventBus.on("scalechanging", () => {
    syncScaleSelect();
  });
  eventBus.on("rotationchanging", () => {
    resetThumbnails();
    void buildThumbnails();
  });
  eventBus.on("scrollmodechanged", updateSecondaryToolbarState);
  eventBus.on("spreadmodechanged", updateSecondaryToolbarState);
  eventBus.on("updatefindmatchescount", ({ matchesCount }) => {
    updateFindMatchesCount(matchesCount);
  });
  eventBus.on("updatefindcontrolstate", ({ state, previous, matchesCount }) => {
    updateFindStatus(state, previous);
    updateFindMatchesCount(matchesCount);
  });
}

async function loadPdf(fileUrl) {
  hideError();
  showLoading(0);
  closeSecondaryToolbar();
  currentFileUrl = fileUrl;
  document.title = `${nameFromUrl(fileUrl)} - OneLingo`;

  if (loadingTask) {
    await loadingTask.destroy().catch(() => {});
    loadingTask = null;
  }
  if (pdfDocument) {
    pdfViewer.setDocument(null);
    linkService.setDocument(null);
    findController.setDocument(null);
    pdfDocument = null;
  }
  clearSidebar();
  resetFindbar();

  loadingTask = getDocument({
    cMapPacked: true,
    cMapUrl: ASSET_PATHS.cMapUrl,
    enableXfa: true,
    iccUrl: ASSET_PATHS.iccUrl,
    standardFontDataUrl: ASSET_PATHS.standardFontDataUrl,
    url: fileUrl,
    wasmUrl: ASSET_PATHS.wasmUrl,
  });
  loadingTask.onProgress = ({ loaded, total }) => {
    if (total > 0) showLoading((loaded / total) * 100);
  };

  try {
    pdfDocument = await loadingTask.promise;
    const baseUrl = document.baseURI;
    linkService.setDocument(pdfDocument, baseUrl);
    findController.setDocument(pdfDocument);
    pdfViewer.setDocument(pdfDocument);
    pdfHistory.initialize({
      fingerprint: pdfDocument.fingerprints?.[0] ?? String(Date.now()),
      resetHistory: true,
    });
  } catch (error) {
    hideLoading();
    showError(error instanceof Error ? error.message : String(error));
  }
}

function updatePageControls() {
  const page = pdfViewer.currentPageNumber || 1;
  const total = pdfViewer.pagesCount || 0;
  elements.pageNumber.value = String(page);
  elements.pageNumber.max = String(Math.max(1, total));
  elements.previousButton.disabled = page <= 1;
  elements.nextButton.disabled = total === 0 || page >= total;
}

function syncScaleSelect() {
  const normalized = pdfViewer.currentScaleValue;
  const existing = [...elements.scaleSelect.options].some(
    (option) => option.value === normalized,
  );
  if (existing) {
    elements.scaleSelect.value = normalized;
    return;
  }
  const percent = `${Math.round(pdfViewer.currentScale * 100)}%`;
  let custom = elements.scaleSelect.querySelector("option[data-custom-scale]");
  if (!custom) {
    custom = document.createElement("option");
    custom.dataset.customScale = "";
    elements.scaleSelect.append(custom);
  }
  custom.value = normalized;
  custom.textContent = percent;
  elements.scaleSelect.value = normalized;
}

function openFindbar() {
  elements.findbar.hidden = false;
  elements.findToggle.setAttribute("aria-expanded", "true");
  elements.findInput.focus();
  elements.findInput.select();
}

function closeFindbar() {
  elements.findbar.hidden = true;
  elements.findToggle.setAttribute("aria-expanded", "false");
  eventBus.dispatch("findbarclose", { source: window });
  elements.viewerContainer.focus();
}

function dispatchFind(type, findPrevious = false) {
  const query = elements.findInput.value;
  eventBus.dispatch("find", {
    source: window,
    type,
    query,
    caseSensitive: elements.findMatchCase.checked,
    entireWord: elements.findEntireWord.checked,
    highlightAll: elements.findHighlightAll.checked,
    findPrevious,
    matchDiacritics: elements.findMatchDiacritics.checked,
  });
}

function resetFindbar() {
  elements.findInput.value = "";
  elements.findMsg.textContent = "";
  elements.findResultsCount.textContent = "";
}

function updateFindStatus(state, previous) {
  switch (state) {
    case FindState.PENDING:
      elements.findMsg.textContent = "Searching…";
      break;
    case FindState.NOT_FOUND:
      elements.findMsg.textContent = "Phrase not found";
      break;
    case FindState.WRAPPED:
      elements.findMsg.textContent = previous
        ? "Reached top, continued from bottom"
        : "Reached end, continued from top";
      break;
    default:
      elements.findMsg.textContent = "";
      break;
  }
}

function updateFindMatchesCount(matchesCount = {}) {
  const current = matchesCount.current ?? 0;
  const total = matchesCount.total ?? 0;
  elements.findResultsCount.textContent = total > 0 ? `${current} / ${total}` : "";
}

function openSidebar() {
  elements.sidebarContainer.hidden = false;
  elements.sidebarToggle.setAttribute("aria-expanded", "true");
  document.documentElement.classList.add("sidebarOpen");
  renderVisibleThumbnails();
  pdfViewer.update();
}

function closeSidebar() {
  elements.sidebarContainer.hidden = true;
  elements.sidebarToggle.setAttribute("aria-expanded", "false");
  document.documentElement.classList.remove("sidebarOpen");
  pdfViewer.update();
}

function setSidebarView(view) {
  activeSidebarView = view || "thumbnails";
  for (const tab of document.querySelectorAll("[data-sidebar-view]")) {
    const selected = tab.dataset.sidebarView === activeSidebarView;
    tab.classList.toggle("selected", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
  elements.thumbnailView.hidden = activeSidebarView !== "thumbnails";
  elements.outlineView.hidden = activeSidebarView !== "outline";
  elements.attachmentsView.hidden = activeSidebarView !== "attachments";
}

async function buildSidebar() {
  await Promise.all([buildThumbnails(), buildOutline(), buildAttachments()]);
  updateActiveThumbnail(pdfViewer.currentPageNumber || 1);
}

function clearSidebar() {
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  for (const view of [
    elements.thumbnailView,
    elements.outlineView,
    elements.attachmentsView,
  ]) {
    view.textContent = "";
  }
}

function resetThumbnails() {
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  elements.thumbnailView.textContent = "";
}

async function buildThumbnails() {
  if (!pdfDocument) return;
  resetThumbnails();
  thumbnailObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        thumbnailObserver?.unobserve(entry.target);
        void renderThumbnail(entry.target);
      }
    },
    { root: elements.sidebarContainer, rootMargin: "160px 0px" },
  );

  const fragment = document.createDocumentFragment();
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
    const item = document.createElement("button");
    item.className = "thumbnailItem";
    item.type = "button";
    item.dataset.pageNumber = String(pageNumber);
    item.title = `Page ${pageNumber}`;
    item.innerHTML = `
      <span class="thumbnailCanvasSlot"></span>
      <span class="thumbnailLabel">Page ${pageNumber}</span>
    `;
    item.addEventListener("click", () => {
      pdfViewer.currentPageNumber = pageNumber;
    });
    fragment.append(item);
    thumbnailObserver.observe(item);
  }
  elements.thumbnailView.append(fragment);
  renderVisibleThumbnails();
}

async function renderThumbnail(item) {
  if (!pdfDocument || item.dataset.rendered === "true") return;
  item.dataset.rendered = "true";
  const pageNumber = Number.parseInt(item.dataset.pageNumber || "0", 10);
  if (!pageNumber) return;
  try {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1, rotation: pdfViewer.pagesRotation });
    const scale = THUMBNAIL_WIDTH / viewport.width;
    const scaledViewport = page.getViewport({
      scale,
      rotation: pdfViewer.pagesRotation,
    });
    const canvas = document.createElement("canvas");
    const outputScale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(scaledViewport.width * outputScale);
    canvas.height = Math.floor(scaledViewport.height * outputScale);
    canvas.style.width = `${Math.floor(scaledViewport.width)}px`;
    canvas.style.height = `${Math.floor(scaledViewport.height)}px`;
    const context = canvas.getContext("2d");
    context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
    await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
    item.querySelector(".thumbnailCanvasSlot")?.replaceChildren(canvas);
  } catch (error) {
    console.warn("[OneLingo] failed to render PDF thumbnail:", error);
    item.querySelector(".thumbnailCanvasSlot")?.classList.add("thumbnailError");
  }
}

function updateActiveThumbnail(pageNumber) {
  for (const item of elements.thumbnailView.querySelectorAll(".thumbnailItem")) {
    const selected = item.dataset.pageNumber === String(pageNumber);
    item.classList.toggle("selected", selected);
    item.setAttribute("aria-current", selected ? "page" : "false");
  }
}

function renderVisibleThumbnails() {
  if (!pdfDocument || elements.sidebarContainer.hidden) return;
  const rootRect = elements.sidebarContainer.getBoundingClientRect();
  for (const item of elements.thumbnailView.querySelectorAll(".thumbnailItem")) {
    if (item.dataset.rendered === "true") continue;
    const rect = item.getBoundingClientRect();
    if (rect.bottom >= rootRect.top - 160 && rect.top <= rootRect.bottom + 160) {
      thumbnailObserver?.unobserve(item);
      void renderThumbnail(item);
    }
  }
}

async function buildOutline() {
  if (!pdfDocument) return;
  elements.outlineView.textContent = "";
  try {
    const outline = await pdfDocument.getOutline();
    if (!outline?.length) {
      renderEmptySidebar(elements.outlineView, "No outline available.");
      return;
    }
    elements.outlineView.append(renderOutlineItems(outline));
  } catch (error) {
    console.warn("[OneLingo] failed to read PDF outline:", error);
    renderEmptySidebar(elements.outlineView, "Unable to load outline.");
  }
}

function renderOutlineItems(items) {
  const list = document.createElement("ul");
  list.className = "outlineList";
  for (const item of items) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.className = "outlineItem";
    button.type = "button";
    button.textContent = item.title || "Untitled";
    button.addEventListener("click", () => {
      if (item.url) {
        window.open(item.url, "_blank", "noopener");
      } else if (item.dest) {
        void linkService.goToDestination(item.dest);
      }
    });
    li.append(button);
    if (item.items?.length) li.append(renderOutlineItems(item.items));
    list.append(li);
  }
  return list;
}

async function buildAttachments() {
  if (!pdfDocument) return;
  elements.attachmentsView.textContent = "";
  try {
    const attachments = await pdfDocument.getAttachments();
    const entries = Object.entries(attachments || {});
    if (entries.length === 0) {
      renderEmptySidebar(elements.attachmentsView, "No attachments available.");
      return;
    }
    for (const [, attachment] of entries) {
      const button = document.createElement("button");
      button.className = "attachmentItem";
      button.type = "button";
      button.textContent = attachment.filename || "Attachment";
      button.title = attachment.description || attachment.filename || "Attachment";
      button.addEventListener("click", () => downloadBytes(
        attachment.content,
        attachment.filename || "attachment",
        attachment.contentType || "application/octet-stream",
      ));
      elements.attachmentsView.append(button);
    }
  } catch (error) {
    console.warn("[OneLingo] failed to read PDF attachments:", error);
    renderEmptySidebar(elements.attachmentsView, "Unable to load attachments.");
  }
}

function renderEmptySidebar(container, message) {
  const empty = document.createElement("p");
  empty.className = "sidebarEmpty";
  empty.textContent = message;
  container.replaceChildren(empty);
}

function openSecondaryToolbar() {
  elements.secondaryToolbar.hidden = false;
  elements.secondaryToolbarToggle.setAttribute("aria-expanded", "true");
  updateSecondaryToolbarState();
}

function closeSecondaryToolbar() {
  elements.secondaryToolbar.hidden = true;
  elements.secondaryToolbarToggle.setAttribute("aria-expanded", "false");
}

function updateSecondaryToolbarState() {
  for (const button of document.querySelectorAll("[data-scroll-mode]")) {
    const checked = SCROLL_MODES[button.dataset.scrollMode] === pdfViewer.scrollMode;
    button.setAttribute("aria-checked", String(checked));
    button.classList.toggle("checked", checked);
  }
  for (const button of document.querySelectorAll("[data-spread-mode]")) {
    const checked = SPREAD_MODES[button.dataset.spreadMode] === pdfViewer.spreadMode;
    button.setAttribute("aria-checked", String(checked));
    button.classList.toggle("checked", checked);
  }
}

async function showDocumentProperties() {
  if (!pdfDocument) return;
  const metadata = await pdfDocument.getMetadata().catch(() => null);
  const info = metadata?.info || {};
  const rows = [
    ["File name", nameFromUrl(currentFileUrl || "")],
    ["Title", info.Title],
    ["Author", info.Author],
    ["Subject", info.Subject],
    ["Keywords", info.Keywords],
    ["Creator", info.Creator],
    ["Producer", info.Producer],
    ["PDF version", info.PDFFormatVersion],
    ["Page count", String(pdfDocument.numPages || "")],
    ["Creation date", formatPdfDate(info.CreationDate)],
    ["Modification date", formatPdfDate(info.ModDate)],
  ].filter(([, value]) => value);

  const fragment = document.createDocumentFragment();
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    fragment.append(dt, dd);
  }
  elements.propertiesList.replaceChildren(fragment);
  elements.propertiesDialog.showModal();
}

function downloadCurrentFile() {
  if (!currentFileUrl) return;
  const link = document.createElement("a");
  link.href = currentFileUrl;
  link.download = nameFromUrl(currentFileUrl);
  link.rel = "noopener";
  link.click();
}

function downloadBytes(bytes, filename, contentType) {
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showLoading(percent) {
  elements.loadingBar.hidden = false;
  elements.loadingBarProgress.style.width = `${Math.max(3, Math.min(100, percent))}%`;
}

function hideLoading() {
  elements.loadingBar.hidden = true;
  elements.loadingBarProgress.style.width = "0";
}

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorWrapper.hidden = false;
}

function hideError() {
  elements.errorWrapper.hidden = true;
  elements.errorMessage.textContent = "";
}

function clamp(scale) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function nameFromUrl(url) {
  if (url.startsWith("blob:")) return "document.pdf";
  try {
    const name = new URL(url, location.href).pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : "document.pdf";
  } catch {
    return "document.pdf";
  }
}

function formatPdfDate(value) {
  if (!value || typeof value !== "string") return "";
  const match = value.match(
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/,
  );
  if (!match) return value;
  const [, year, month = "01", day = "01", hour = "00", minute = "00", second = "00"] =
    match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function mustGetElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing PDF viewer element: ${id}`);
  return element;
}
