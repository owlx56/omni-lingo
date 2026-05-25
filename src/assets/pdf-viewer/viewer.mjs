import {
  AnnotationEditorType,
  getDocument,
  GlobalWorkerOptions,
} from "../build/pdf.mjs";
import {
  EventBus,
  FindState,
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
const DEFAULT_UI_LANG = "zh";
const SETTINGS_STORAGE_KEY = "sync:settings";

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
const EDITOR_MODES = {
  freeText: AnnotationEditorType.FREETEXT,
  highlight: AnnotationEditorType.HIGHLIGHT,
  ink: AnnotationEditorType.INK,
  stamp: AnnotationEditorType.STAMP,
};
const RTL_LANGS = new Set(["ar", "fa"]);
const SUPPORTED_UI_LANGS = new Set([
  "en",
  "zh",
  "zh-Hant",
  "ja",
  "ko",
  "ar",
  "tr",
  "ru",
  "vi",
  "th",
  "de",
  "es",
  "fr",
  "pt-BR",
  "hi",
  "it",
  "id",
  "fa",
]);
const UI_LOCALES = {
  en: {
    addImage: "Add or edit images",
    annotationUnavailable: "Annotation editing is not available for this document.",
    attachment: "Attachment",
    attachments: "Attachments",
    close: "Close",
    closeFindbar: "Close find bar",
    currentPage: "Current page",
    documentProperties: "Document properties...",
    draw: "Draw",
    evenSpreads: "Book view",
    fileName: "File name",
    find: "Find",
    findInDocument: "Find in document",
    findNext: "Find next",
    findPrevious: "Find previous",
    firstPage: "Go to first page",
    handTool: "Hand tool",
    highlight: "Highlight",
    highlightAll: "Highlight all",
    horizontalScrolling: "Horizontal scrolling",
    keywords: "Keywords",
    lastPage: "Go to last page",
    loadingError: "An error occurred while loading the PDF.",
    managePages: "Manage pages",
    matchCase: "Match case",
    matchDiacritics: "Match diacritics",
    missingFile: "No PDF file was specified.",
    modificationDate: "Modification date",
    nextPage: "Next page",
    noAttachments: "No attachments available.",
    noOutline: "No outline available.",
    noPreview: "Preview unavailable",
    noSpreads: "Single page view",
    oddSpreads: "Two page view",
    openFile: "Open file",
    outline: "Outline",
    page: "Page",
    pageCount: "Page count",
    pageScrolling: "Page scrolling",
    pageTitle: "Page {page}",
    pages: "Pages",
    pdfProducer: "PDF producer",
    pdfVersion: "PDF version",
    presentationMode: "Presentation mode",
    previousPage: "Previous page",
    print: "Print",
    rotateCcw: "Rotate counterclockwise",
    rotateCw: "Rotate clockwise",
    save: "Save",
    scaleAuto: "Automatic zoom",
    scalePageFit: "Page fit",
    scalePageWidth: "Page width",
    searching: "Searching...",
    searchNotFound: "Phrase not found",
    subject: "Subject",
    text: "Text",
    textSelectTool: "Text selection tool",
    title: "Title",
    tools: "Tools",
    unableAttachments: "Unable to load attachments.",
    unableOutline: "Unable to load outline.",
    untitled: "Untitled",
    verticalScrolling: "Vertical scrolling",
    wholeWords: "Whole words",
    wrappedBottom: "Reached end, continued from top",
    wrappedScrolling: "Wrapped scrolling",
    wrappedTop: "Reached top, continued from bottom",
    zoom: "Zoom",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    author: "Author",
    creationDate: "Creation date",
    creator: "Creator",
  },
  zh: {
    addImage: "添加或编辑图像",
    annotationUnavailable: "此文档无法使用批注编辑。",
    attachment: "附件",
    attachments: "附件",
    author: "作者",
    close: "关闭",
    closeFindbar: "关闭查找栏",
    creationDate: "创建日期",
    creator: "创建工具",
    currentPage: "当前页面",
    documentProperties: "文档属性...",
    draw: "绘图",
    evenSpreads: "书籍视图",
    fileName: "文件名",
    find: "查找",
    findInDocument: "在文档中查找",
    findNext: "查找下一个",
    findPrevious: "查找上一个",
    firstPage: "转到第一页",
    handTool: "手形工具",
    highlight: "高亮",
    highlightAll: "全部高亮",
    horizontalScrolling: "水平滚动",
    keywords: "关键词",
    lastPage: "转到最后一页",
    loadingError: "加载 PDF 时出错。",
    managePages: "管理页面",
    matchCase: "区分大小写",
    matchDiacritics: "匹配变音符号",
    missingFile: "没有指定 PDF 文件。",
    modificationDate: "修改日期",
    nextPage: "下一页",
    noAttachments: "没有可用附件。",
    noOutline: "没有可用大纲。",
    noPreview: "预览不可用",
    noSpreads: "单页视图",
    oddSpreads: "双页视图",
    openFile: "打开文件",
    outline: "大纲",
    page: "页码",
    pageCount: "页数",
    pageScrolling: "页面滚动",
    pageTitle: "第 {page} 页",
    pages: "页面",
    pdfProducer: "PDF 生成器",
    pdfVersion: "PDF 版本",
    presentationMode: "演示模式",
    previousPage: "上一页",
    print: "打印",
    rotateCcw: "逆时针旋转",
    rotateCw: "顺时针旋转",
    save: "保存",
    scaleAuto: "自动缩放",
    scalePageFit: "适合页面",
    scalePageWidth: "页宽",
    searching: "正在搜索...",
    searchNotFound: "找不到短语",
    subject: "主题",
    text: "文本",
    textSelectTool: "文本选择工具",
    title: "标题",
    tools: "工具",
    unableAttachments: "无法加载附件。",
    unableOutline: "无法加载大纲。",
    untitled: "无标题",
    verticalScrolling: "垂直滚动",
    wholeWords: "全字匹配",
    wrappedBottom: "已到达文档末尾，从开头继续",
    wrappedScrolling: "平铺滚动",
    wrappedTop: "已到达文档开头，从末尾继续",
    zoom: "缩放",
    zoomIn: "放大",
    zoomOut: "缩小",
  },
};
UI_LOCALES["zh-Hant"] = {
  ...UI_LOCALES.zh,
  addImage: "新增或編輯影像",
  attachment: "附件",
  attachments: "附件",
  close: "關閉",
  closeFindbar: "關閉搜尋列",
  currentPage: "目前頁面",
  documentProperties: "文件內容...",
  draw: "繪圖",
  fileName: "檔案名稱",
  find: "搜尋",
  findInDocument: "在文件中搜尋",
  findNext: "搜尋下一個",
  findPrevious: "搜尋上一個",
  firstPage: "前往第一頁",
  handTool: "手形工具",
  lastPage: "前往最後一頁",
  managePages: "管理頁面",
  nextPage: "下一頁",
  noSpreads: "單頁檢視",
  openFile: "開啟檔案",
  page: "頁碼",
  pageTitle: "第 {page} 頁",
  previousPage: "上一頁",
  save: "儲存",
  scaleAuto: "自動縮放",
  scalePageFit: "符合頁面",
  scalePageWidth: "頁寬",
  textSelectTool: "文字選取工具",
  tools: "工具",
  zoomIn: "放大",
  zoomOut: "縮小",
};
const PDFJS_L10N = {
  en: {
    "pdfjs-editor-highlight-editor": { "aria-label": "Highlight editor" },
    "pdfjs-editor-ink-editor": { "aria-label": "Drawing editor" },
    "pdfjs-editor-stamp-editor": { "aria-label": "Image editor" },
    "pdfjs-free-text2": {
      "aria-label": "Text editor",
      "default-content": "Start typing...",
    },
    "pdfjs-page-landmark": { "aria-label": "Page {page}" },
  },
  zh: {
    "pdfjs-editor-highlight-editor": { "aria-label": "高亮编辑器" },
    "pdfjs-editor-ink-editor": { "aria-label": "绘图编辑器" },
    "pdfjs-editor-stamp-editor": { "aria-label": "图像编辑器" },
    "pdfjs-free-text2": {
      "aria-label": "文本编辑器",
      "default-content": "开始输入...",
    },
    "pdfjs-page-landmark": { "aria-label": "第 {page} 页" },
  },
};
PDFJS_L10N["zh-Hant"] = {
  "pdfjs-editor-highlight-editor": { "aria-label": "高亮編輯器" },
  "pdfjs-editor-ink-editor": { "aria-label": "繪圖編輯器" },
  "pdfjs-editor-stamp-editor": { "aria-label": "影像編輯器" },
  "pdfjs-free-text2": {
    "aria-label": "文字編輯器",
    "default-content": "開始輸入...",
  },
  "pdfjs-page-landmark": { "aria-label": "第 {page} 頁" },
};

class OneLingoPdfL10n {
  constructor(lang) {
    this.lang = normalizeUiLang(lang);
  }

  setLanguage(lang) {
    this.lang = normalizeUiLang(lang);
  }

  getLanguage() {
    return this.lang === "zh" ? "zh-cn" : this.lang.toLowerCase();
  }

  getDirection() {
    return RTL_LANGS.has(this.lang) ? "rtl" : "ltr";
  }

  async get(ids, args = null, fallback = "") {
    if (Array.isArray(ids)) {
      return ids.map(({ id, args: itemArgs }) => this.lookup(id, itemArgs));
    }
    return this.lookup(ids, args, fallback);
  }

  async translate(element) {
    await this.translateOnce(element);
  }

  async translateOnce(element) {
    for (const node of element.querySelectorAll?.("[data-l10n-id]") ?? []) {
      const id = node.getAttribute("data-l10n-id");
      const args = parseL10nArgs(node.getAttribute("data-l10n-args"));
      const message = this.lookupMessage(id, args);
      if (typeof message === "string") {
        node.textContent = message;
      } else if (message) {
        for (const [attr, value] of Object.entries(message)) {
          node.setAttribute(attr, value);
        }
      }
    }
  }

  pause() {}
  resume() {}
  async destroy() {}

  lookup(id, args = null, fallback = "") {
    const message = this.lookupMessage(id, args);
    if (typeof message === "string") return message;
    if (message?.value) return message.value;
    if (message?.["aria-label"]) return message["aria-label"];
    return fallback || id;
  }

  lookupMessage(id, args = null) {
    const messages = PDFJS_L10N[this.lang] ?? PDFJS_L10N.en;
    const message = messages[id] ?? PDFJS_L10N.en[id];
    if (!message) return null;
    if (typeof message === "string") return format(message, args);
    return Object.fromEntries(
      Object.entries(message).map(([key, value]) => [key, format(value, args)]),
    );
  }
}

function parseL10nArgs(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const elements = {
  attachmentsView: mustGetElement("attachmentsView"),
  currentPage: mustGetElement("currentPage"),
  cursorHandTool: mustGetElement("cursorHandTool"),
  cursorSelectTool: mustGetElement("cursorSelectTool"),
  downloadButton: mustGetElement("download"),
  editorFreeText: mustGetElement("editorFreeText"),
  editorHighlight: mustGetElement("editorHighlight"),
  editorInk: mustGetElement("editorInk"),
  editorStamp: mustGetElement("editorStamp"),
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
  presentationMode: mustGetElement("presentationMode"),
  previousButton: mustGetElement("previous"),
  printButton: mustGetElement("print"),
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

const l10n = new OneLingoPdfL10n(DEFAULT_UI_LANG);
const eventBus = new EventBus();
const linkService = new PDFLinkService({
  eventBus,
  externalLinkTarget: LinkTarget.BLANK,
});
const findController = new PDFFindController({ eventBus, linkService });
const pdfViewer = new PDFViewer({
  annotationEditorMode: AnnotationEditorType.NONE,
  container: elements.viewerContainer,
  enableHighlightFloatingButton: true,
  enableUpdatedAddImage: true,
  eventBus,
  findController,
  imageResourcesPath: ASSET_PATHS.imageResourcesPath,
  linkService,
  l10n,
  viewer: elements.viewer,
});
const pdfHistory = new PDFHistory({ eventBus, linkService });

let currentUiLang = DEFAULT_UI_LANG;
let pdfDocument = null;
let loadingTask = null;
let currentFileUrl = null;
let currentObjectUrl = null;
let thumbnailObserver = null;
let activeSidebarView = "thumbnails";
let cursorTool = "select";
let handToolState = null;

linkService.setViewer(pdfViewer);
linkService.setHistory(pdfHistory);

applyLocale(DEFAULT_UI_LANG);
void loadUiLanguage();
watchUiLanguage();
wireToolbar();
wireFindbar();
wireSidebar();
wireSecondaryToolbar();
wireEvents();
void loadInitialDocument();

async function loadInitialDocument() {
  const file = new URLSearchParams(location.search).get("file");
  if (!file) {
    showError(t("missingFile"));
    return;
  }
  await loadPdf(file);
}

function wireToolbar() {
  elements.sidebarToggle.addEventListener("click", () => {
    if (elements.sidebarContainer.hidden) {
      openSidebar();
    } else {
      closeSidebar();
    }
  });
  elements.findToggle.addEventListener("click", () => {
    if (elements.findbar.hidden) {
      openFindbar();
    } else {
      closeFindbar();
    }
  });
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
  elements.printButton.addEventListener("click", printDocument);
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
  for (const button of [
    elements.editorHighlight,
    elements.editorFreeText,
    elements.editorInk,
    elements.editorStamp,
  ]) {
    button.addEventListener("click", () => {
      setAnnotationEditorMode(button.dataset.editorMode);
    });
  }
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openFindbar();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
      event.preventDefault();
      printDocument();
      return;
    }
    if (event.key === "Escape") {
      closeSecondaryToolbar();
      if (pdfViewer.annotationEditorMode !== AnnotationEditorType.DISABLE) {
        setAnnotationEditorMode("none");
      }
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
  elements.presentationMode.addEventListener("click", () => {
    closeSecondaryToolbar();
    void enterPresentationMode();
  });
  elements.currentPage.addEventListener("click", () => {
    closeSecondaryToolbar();
    void copyCurrentPageUrl();
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
  for (const button of document.querySelectorAll("[data-cursor-tool]")) {
    button.addEventListener("click", () => {
      setCursorTool(button.dataset.cursorTool);
      updateSecondaryToolbarState();
      closeSecondaryToolbar();
    });
  }
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
    updateAnnotationEditorState();
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
  eventBus.on("annotationeditormodechanged", ({ mode }) => {
    updateAnnotationEditorState(mode);
  });
  eventBus.on("printingallowed", ({ isAllowed }) => {
    elements.printButton.disabled = !isAllowed;
  });
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
  setAnnotationEditorMode("none");
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
    showError(error instanceof Error ? error.message : t("loadingError"));
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
      elements.findMsg.textContent = t("searching");
      break;
    case FindState.NOT_FOUND:
      elements.findMsg.textContent = t("searchNotFound");
      break;
    case FindState.WRAPPED:
      elements.findMsg.textContent = previous
        ? t("wrappedTop")
        : t("wrappedBottom");
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
    item.title = format(t("pageTitle"), { page: pageNumber });
    const slot = document.createElement("span");
    slot.className = "thumbnailCanvasSlot";
    const label = document.createElement("span");
    label.className = "thumbnailLabel";
    label.textContent = format(t("pageTitle"), { page: pageNumber });
    item.append(slot, label);
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
    const slot = item.querySelector(".thumbnailCanvasSlot");
    slot?.classList.add("thumbnailError");
    if (slot) slot.dataset.error = t("noPreview");
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
      renderEmptySidebar(elements.outlineView, "noOutline");
      return;
    }
    elements.outlineView.append(renderOutlineItems(outline));
  } catch (error) {
    console.warn("[OneLingo] failed to read PDF outline:", error);
    renderEmptySidebar(elements.outlineView, "unableOutline");
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
    button.textContent = item.title || t("untitled");
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
      renderEmptySidebar(elements.attachmentsView, "noAttachments");
      return;
    }
    for (const [, attachment] of entries) {
      const button = document.createElement("button");
      button.className = "attachmentItem";
      button.type = "button";
      button.textContent = attachment.filename || t("attachment");
      button.title = attachment.description || attachment.filename || t("attachment");
      button.addEventListener("click", () => downloadBytes(
        attachment.content,
        attachment.filename || "attachment",
        attachment.contentType || "application/octet-stream",
      ));
      elements.attachmentsView.append(button);
    }
  } catch (error) {
    console.warn("[OneLingo] failed to read PDF attachments:", error);
    renderEmptySidebar(elements.attachmentsView, "unableAttachments");
  }
}

function renderEmptySidebar(container, messageKey) {
  const empty = document.createElement("p");
  empty.className = "sidebarEmpty";
  empty.dataset.l10nKey = messageKey;
  empty.textContent = t(messageKey);
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

function setAnnotationEditorMode(kind) {
  const mode = kind === "none" ? AnnotationEditorType.NONE : EDITOR_MODES[kind];
  if (mode === undefined) return;
  if (pdfViewer.annotationEditorMode === AnnotationEditorType.DISABLE) {
    if (mode !== AnnotationEditorType.NONE) showError(t("annotationUnavailable"));
    updateAnnotationEditorState(AnnotationEditorType.DISABLE);
    return;
  }
  const nextMode = pdfViewer.annotationEditorMode === mode ? AnnotationEditorType.NONE : mode;
  try {
    pdfViewer.annotationEditorMode = { mode: nextMode };
    updateAnnotationEditorState(nextMode);
  } catch (error) {
    console.warn("[OneLingo] failed to switch PDF annotation mode:", error);
    if (mode !== AnnotationEditorType.NONE) showError(t("annotationUnavailable"));
  }
}

function updateAnnotationEditorState(mode = pdfViewer.annotationEditorMode) {
  const disabled = mode === AnnotationEditorType.DISABLE;
  for (const button of [
    elements.editorHighlight,
    elements.editorFreeText,
    elements.editorInk,
    elements.editorStamp,
  ]) {
    const activeMode = EDITOR_MODES[button.dataset.editorMode];
    const pressed = !disabled && activeMode === mode;
    button.disabled = disabled;
    button.classList.toggle("toggled", pressed);
    button.setAttribute("aria-pressed", String(pressed));
  }
}

function setCursorTool(tool) {
  cursorTool = tool === "hand" ? "hand" : "select";
  document.documentElement.classList.toggle("handTool", cursorTool === "hand");
  if (cursorTool === "hand") {
    enableHandTool();
  } else {
    disableHandTool();
  }
}

function enableHandTool() {
  if (handToolState) return;
  handToolState = {
    active: false,
    lastX: 0,
    lastY: 0,
    pointerId: null,
  };
  elements.viewerContainer.addEventListener("pointerdown", onHandToolPointerDown);
  elements.viewerContainer.addEventListener("pointermove", onHandToolPointerMove);
  elements.viewerContainer.addEventListener("pointerup", onHandToolPointerUp);
  elements.viewerContainer.addEventListener("pointercancel", onHandToolPointerUp);
}

function disableHandTool() {
  if (!handToolState) return;
  elements.viewerContainer.removeEventListener("pointerdown", onHandToolPointerDown);
  elements.viewerContainer.removeEventListener("pointermove", onHandToolPointerMove);
  elements.viewerContainer.removeEventListener("pointerup", onHandToolPointerUp);
  elements.viewerContainer.removeEventListener("pointercancel", onHandToolPointerUp);
  elements.viewerContainer.classList.remove("handToolActive");
  handToolState = null;
}

function onHandToolPointerDown(event) {
  if (!handToolState || event.button !== 0) return;
  if (event.target instanceof Element && event.target.closest("[data-onelingo-reader-ui]")) {
    return;
  }
  const selectedText = getSelection()?.toString();
  if (selectedText) return;
  event.preventDefault();
  handToolState.active = true;
  handToolState.pointerId = event.pointerId;
  handToolState.lastX = event.clientX;
  handToolState.lastY = event.clientY;
  elements.viewerContainer.classList.add("handToolActive");
  elements.viewerContainer.setPointerCapture?.(event.pointerId);
}

function onHandToolPointerMove(event) {
  if (!handToolState?.active || handToolState.pointerId !== event.pointerId) return;
  event.preventDefault();
  const dx = event.clientX - handToolState.lastX;
  const dy = event.clientY - handToolState.lastY;
  handToolState.lastX = event.clientX;
  handToolState.lastY = event.clientY;
  elements.viewerContainer.scrollLeft -= dx;
  elements.viewerContainer.scrollTop -= dy;
}

function onHandToolPointerUp(event) {
  if (!handToolState || handToolState.pointerId !== event.pointerId) return;
  handToolState.active = false;
  handToolState.pointerId = null;
  elements.viewerContainer.classList.remove("handToolActive");
  elements.viewerContainer.releasePointerCapture?.(event.pointerId);
}

function updateSecondaryToolbarState() {
  for (const button of document.querySelectorAll("[data-cursor-tool]")) {
    const checked = button.dataset.cursorTool === cursorTool;
    button.setAttribute("aria-checked", String(checked));
    button.classList.toggle("checked", checked);
  }
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
    [t("fileName"), nameFromUrl(currentFileUrl || "")],
    [t("title"), info.Title],
    [t("author"), info.Author],
    [t("subject"), info.Subject],
    [t("keywords"), info.Keywords],
    [t("creator"), info.Creator],
    [t("pdfProducer"), info.Producer],
    [t("pdfVersion"), info.PDFFormatVersion],
    [t("pageCount"), String(pdfDocument.numPages || "")],
    [t("creationDate"), formatPdfDate(info.CreationDate)],
    [t("modificationDate"), formatPdfDate(info.ModDate)],
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

async function enterPresentationMode() {
  const target = elements.viewerContainer;
  if (!document.fullscreenElement && target.requestFullscreen) {
    await target.requestFullscreen().catch((error) => {
      console.warn("[OneLingo] failed to enter PDF presentation mode:", error);
    });
  }
}

async function copyCurrentPageUrl() {
  const url = new URL(location.href);
  url.hash = `page=${pdfViewer.currentPageNumber || 1}`;
  history.replaceState(null, "", url);
  await navigator.clipboard?.writeText(url.href).catch(() => {});
}

function printDocument() {
  if (!pdfDocument || elements.printButton.disabled) return;
  window.print();
}

async function downloadCurrentFile() {
  if (!currentFileUrl && !pdfDocument) return;
  let url = currentFileUrl;
  let revoke = false;
  if (pdfDocument?.annotationStorage?.size > 0) {
    try {
      const data = await pdfDocument.saveDocument();
      url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      revoke = true;
    } catch (error) {
      console.warn("[OneLingo] failed to save annotated PDF, downloading original:", error);
    }
  }
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  link.download = nameFromUrl(currentFileUrl || url);
  link.rel = "noopener";
  link.click();
  if (revoke) setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  window.clearTimeout(showError.timeoutId);
  showError.timeoutId = window.setTimeout(hideError, 5000);
}
showError.timeoutId = 0;

function hideError() {
  window.clearTimeout(showError.timeoutId);
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

async function loadUiLanguage() {
  const lang = await readStoredUiLang();
  applyLocale(lang);
}

function watchUiLanguage() {
  getExtensionStorage()?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName && areaName !== "sync") return;
    const next = changes[SETTINGS_STORAGE_KEY]?.newValue?.uiLang;
    if (isSupportedUiLang(next)) applyLocale(next);
  });
}

async function readStoredUiLang() {
  const syncStorage = getExtensionStorage()?.sync;
  if (!syncStorage?.get) return normalizeUiLang(navigator.language);
  try {
    const result = await storageGet(syncStorage, SETTINGS_STORAGE_KEY);
    return normalizeUiLang(result?.[SETTINGS_STORAGE_KEY]?.uiLang);
  } catch (error) {
    console.warn("[OneLingo] failed to read PDF viewer language:", error);
    return normalizeUiLang(navigator.language);
  }
}

function getExtensionStorage() {
  return globalThis.browser?.storage ?? globalThis.chrome?.storage ?? null;
}

function storageGet(area, key) {
  if (globalThis.browser?.storage) {
    return area.get(key);
  }
  return new Promise((resolve, reject) => {
    area.get(key, (value) => {
      const runtimeError = globalThis.chrome?.runtime?.lastError;
      if (runtimeError) reject(new Error(runtimeError.message));
      else resolve(value);
    });
  });
}

function normalizeUiLang(value) {
  if (isSupportedUiLang(value)) return value;
  if (typeof value !== "string") return DEFAULT_UI_LANG;
  const normalized = value.toLowerCase();
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk")) {
    return "zh-Hant";
  }
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("pt-br")) return "pt-BR";
  const base = normalized.split("-")[0];
  return isSupportedUiLang(base) ? base : DEFAULT_UI_LANG;
}

function isSupportedUiLang(value) {
  return typeof value === "string" && SUPPORTED_UI_LANGS.has(value);
}

function applyLocale(lang) {
  currentUiLang = normalizeUiLang(lang);
  l10n.setLanguage(currentUiLang);
  const htmlLang = currentUiLang === "zh" ? "zh-CN" : currentUiLang;
  document.documentElement.lang = htmlLang;
  document.documentElement.dir = RTL_LANGS.has(currentUiLang) ? "rtl" : "ltr";
  for (const element of document.querySelectorAll("[data-l10n-text]")) {
    element.textContent = t(element.dataset.l10nText);
  }
  for (const element of document.querySelectorAll("[data-l10n-title]")) {
    element.title = t(element.dataset.l10nTitle);
  }
  for (const element of document.querySelectorAll("[data-l10n-aria-label]")) {
    element.setAttribute("aria-label", t(element.dataset.l10nAriaLabel));
  }
  for (const element of document.querySelectorAll("[data-l10n-placeholder]")) {
    element.setAttribute("placeholder", t(element.dataset.l10nPlaceholder));
  }
  updateGeneratedLocaleText();
}

function updateGeneratedLocaleText() {
  for (const item of elements.thumbnailView.querySelectorAll(".thumbnailItem")) {
    const pageNumber = Number.parseInt(item.dataset.pageNumber || "0", 10);
    if (!pageNumber) continue;
    const label = format(t("pageTitle"), { page: pageNumber });
    item.title = label;
    item.querySelector(".thumbnailLabel").textContent = label;
  }
  for (const empty of document.querySelectorAll(".sidebarEmpty")) {
    const key = empty.dataset.l10nKey;
    if (key) empty.textContent = t(key);
  }
}

function t(key) {
  return UI_LOCALES[currentUiLang]?.[key] ?? UI_LOCALES.en[key] ?? key;
}

function format(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) =>
    values?.[key] === undefined ? `{${key}}` : String(values[key]),
  );
}

function mustGetElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing PDF viewer element: ${id}`);
  return element;
}
