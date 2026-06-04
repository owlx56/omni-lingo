import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { FootnoteHandler } from "foliate-js/footnotes.js";
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
import { getEffectiveTheme } from "@/lib/theme";
import {
  IconArrowLeftDouble,
  IconArrowRightDouble,
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
import {
  getReaderChromeLayout,
  getReaderChromeState,
  type ReaderChromeZone,
} from "./reader-chrome";
import {
  HIDDEN_OVERLAY_SCROLLBAR,
  createOverlayScrollbarController,
  getFoliateScrollContainer,
  installOverlayScrollbarNativeStyle,
  type OverlayScrollbarDrag,
  type OverlayScrollbarSnapshot,
} from "./reader-scrollbar";
import {
  FOLIATE_FOOTNOTE_POPUP_PADDING,
  configureFootnotePopupRenderer,
  createFoliateFootnoteContentCss,
  getFootnoteAnchorPosition,
  getFootnotePopupSize,
  getFootnotePopupPosition,
  shouldPromoteFootnoteDetection,
  shouldCheckAsFootnote,
  type FootnotePopupPosition,
  type FootnotePopupSize,
} from "./footnote-popup";
import type {
  FoliateBookLike,
  FoliateBookMetadata,
  FoliateLinkDetail,
  FoliateLinkEvent,
  FoliateSeriesValue,
  FoliateRelocateDetail,
  FoliateTocItem,
  FoliateViewElement,
} from "./types";
import {
  createQueuedWheelTurnNavigator,
  createWheelTurnDetector,
  shouldHandleWheelTurn,
  type WheelTurnDirection,
} from "./wheel-turns";

type ViewState = "loading" | "ready" | "error";
type ViewMode = "pages" | "scroll";
type SectionTurnDirection = "previous" | "next";
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

type FootnotePopupState = {
  position: FootnotePopupPosition;
  size: FootnotePopupSize;
};

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
  const [readerChromeZone, setReaderChromeZone] = createSignal<ReaderChromeZone>(null);
  const [footnotePopup, setFootnotePopup] = createSignal<FootnotePopupState | null>(null);
  const [footnoteCanGoBack, setFootnoteCanGoBack] = createSignal(false);
  const [scrollbarSnapshot, setScrollbarSnapshot] =
    createSignal<OverlayScrollbarSnapshot>(HIDDEN_OVERLAY_SCROLLBAR);

  let renderHost: HTMLDivElement | undefined;
  let view: FoliateViewElement | undefined;
  let stopBridge: (() => void) | undefined;
  let stopFootnoteMainLink: (() => void) | undefined;
  let stopFootnoteHandler: (() => void) | undefined;
  let coverObjectUrl: string | undefined;
  let bookStateToken = 0;
  let navigationLocked = false;
  let resizeCleanup: (() => void) | undefined;
  let dragCleanup: (() => void) | undefined;
  let contentWheelCleanup: (() => void) | undefined;
  let contentRef: HTMLDivElement | undefined;
  let footnoteContentRef: HTMLDivElement | undefined;
  let footnoteView: FoliateViewElement | undefined;
  let footnoteAnchorPosition: FootnotePopupPosition | null = null;
  let footnoteHistory: FoliateLinkDetail[] = [];
  let footnoteHistoryIndex = -1;
  let shellRef: HTMLDivElement | undefined;
  let scrollbarTrackRef: HTMLDivElement | undefined;
  let scrollbarDrag: OverlayScrollbarDrag | undefined;
  const footnoteHandler = new FootnoteHandler();
  const wheelDocCleanups = new Map<Document, () => void>();
  const wheelTurnDetector = createWheelTurnDetector();
  const wheelTurnNavigator = createQueuedWheelTurnNavigator({
    canNavigate: () => !navigationLocked,
    isActive: () => state() === "ready" && viewMode() === "pages",
    navigate: (direction) => performPageTurn(direction),
  });
  const overlayScrollbarController = createOverlayScrollbarController({
    getTrackHeight: () => scrollbarTrackRef?.getBoundingClientRect().height ?? 0,
    isActive: () => state() === "ready" && viewMode() === "scroll",
    onChange: (snapshot) => setScrollbarSnapshot(snapshot),
  });

  createEffect(() => {
    const lang = settings().uiLang;
    applyLanguageToDocument(document, lang);
    document.title = docTitle() || t("viewer.title");
  });

  createEffect(() => {
    const width = sidebarVisible() && isDockedSidebar() ? sidebarWidth() : null;
    syncReaderLayout(width, viewMode());
    syncOverlayScrollbarContainer();
  });

  createEffect(() => {
    setTocExpandedKeys(() => computeExpandedTocKeys(toc(), activeHref()));
  });

  onMount(() => {
    const updateViewport = (): void => {
      setIsDesktop(isWideViewport());
      closeFootnotePopup();
    };
    const onWindowKeydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeFootnotePopup();
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("keydown", onWindowKeydown);
    stopFootnoteHandler = bindFootnoteHandler();
    if (contentRef) {
      contentWheelCleanup = bindWheelTarget(contentRef);
    }
    resizeCleanup = () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("keydown", onWindowKeydown);
    };
    void init();
  });

  onCleanup(() => {
    clearWheelTurns();
    clearWheelContentDocuments();
    overlayScrollbarController.destroy();
    contentWheelCleanup?.();
    contentWheelCleanup = undefined;
    resizeCleanup?.();
    dragCleanup?.();
    closeFootnotePopup();
    stopFootnoteMainLink?.();
    stopFootnoteMainLink = undefined;
    stopFootnoteHandler?.();
    stopFootnoteHandler = undefined;
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
    stopFootnoteMainLink?.();
    stopFootnoteMainLink = bindFootnoteMainLink(el);
    const file = createReaderFile(source);
    await el.open(file);
    syncViewMode(el, viewMode());
    syncOverlayScrollbarContainer();
    stopBridge = initFoliateBridge(el, {
      onContentLoad: onFoliateContentLoad,
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
    syncOverlayScrollbarContainer();

    await nextFrame();
    await el.goToTextStart?.().catch(async () => {
      await el.next();
    });
  };

  const resetReaderState = (): void => {
    clearWheelTurns();
    clearWheelContentDocuments();
    overlayScrollbarController.setContainer(null);
    closeFootnotePopup();
    stopFootnoteMainLink?.();
    stopFootnoteMainLink = undefined;
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
    el.dataset.viewMode = viewMode();
    renderHost.replaceChildren(el);
    view = el;
    return el;
  };

  const bindFootnoteMainLink = (targetView: FoliateViewElement): (() => void) => {
    const listener = (event: Event): void => {
      void handleMainFootnoteLink(event as FoliateLinkEvent);
    };
    targetView.addEventListener("link", listener);
    return () => {
      targetView.removeEventListener("link", listener);
    };
  };

  const bindFootnoteHandler = (): (() => void) => {
    const handleBeforeRender = (event: Event): void => {
      const popupView = (event as CustomEvent<{ view: FoliateViewElement }>).detail.view;
      mountFootnoteView(popupView);
    };
    const handleRender = (): void => {
      showFootnoteView();
    };
    footnoteHandler.addEventListener("before-render", handleBeforeRender);
    footnoteHandler.addEventListener("render", handleRender);
    return () => {
      footnoteHandler.removeEventListener("before-render", handleBeforeRender);
      footnoteHandler.removeEventListener("render", handleRender);
    };
  };

  const handleMainFootnoteLink = async (event: FoliateLinkEvent): Promise<void> => {
    if (!view?.book || !contentRef) return;
    const detail = event.detail;
    if (!isFoliateLinkDetail(detail) || !shouldCheckAsFootnote(detail.a)) return;
    footnoteAnchorPosition = getFootnoteAnchorPosition(
      detail.a,
      contentRef.getBoundingClientRect(),
      FOLIATE_FOOTNOTE_POPUP_PADDING,
    );
    const result = handleFootnoteEvent(view.book, event);
    if (!event.defaultPrevented) {
      footnoteAnchorPosition = null;
      return;
    }
    showFootnoteShell();
    footnoteHistory = [cloneFootnoteLinkDetail(detail)];
    footnoteHistoryIndex = 0;
    setFootnoteCanGoBack(false);
    try {
      await Promise.resolve(result);
    } catch (err) {
      console.warn("[OneLingo] failed to render foliate footnote popup:", err);
      closeFootnotePopup();
      await view.goTo(detail.href);
    }
  };

  const handlePopupFootnoteLink = async (event: FoliateLinkEvent): Promise<void> => {
    const detail = event.detail;
    event.preventDefault();
    if (!view?.book || !isFoliateLinkDetail(detail)) return;
    const syntheticEvent = new CustomEvent<FoliateLinkDetail>("link", {
      cancelable: true,
      detail: cloneFootnoteLinkDetail(detail),
    });
    const result = handleFootnoteEvent(view.book, syntheticEvent);
    if (!syntheticEvent.defaultPrevented) {
      closeFootnotePopup();
      await view.goTo(detail.href);
      return;
    }
    showFootnoteShell();
    const nextHistory = [
      ...footnoteHistory.slice(0, footnoteHistoryIndex + 1),
      cloneFootnoteLinkDetail(detail),
    ];
    footnoteHistory = nextHistory;
    footnoteHistoryIndex = nextHistory.length - 1;
    setFootnoteCanGoBack(footnoteHistoryIndex > 0);
    try {
      await Promise.resolve(result);
    } catch (err) {
      console.warn("[OneLingo] failed to follow foliate footnote link:", err);
      closeFootnotePopup();
      await view.goTo(detail.href);
    }
  };

  const handleFootnoteBack = async (): Promise<void> => {
    if (!view?.book || footnoteHistoryIndex <= 0) return;
    const nextIndex = footnoteHistoryIndex - 1;
    const detail = footnoteHistory[nextIndex];
    if (!detail) return;
    footnoteHistoryIndex = nextIndex;
    setFootnoteCanGoBack(nextIndex > 0);
    const syntheticEvent = new CustomEvent<FoliateLinkDetail>("link", {
      cancelable: true,
      detail: cloneFootnoteLinkDetail(detail),
    });
    showFootnoteShell();
    try {
      await Promise.resolve(handleFootnoteEvent(view.book, syntheticEvent));
    } catch (err) {
      console.warn("[OneLingo] failed to go back in foliate footnote popup:", err);
    }
  };

  const handleFootnoteEvent = (
    book: FoliateBookLike,
    event: FoliateLinkEvent,
  ): Promise<void> | void => {
    const { a, href } = event.detail;
    event.detail.check = shouldCheckAsFootnote(a);
    if (!event.detail.check) return undefined;
    const restoreRole = shouldPromoteFootnoteDetection(a, href)
      ? promoteAnchorForFootnoteDetection(a)
      : undefined;
    try {
      return footnoteHandler.handle(book, event);
    } finally {
      restoreRole?.();
    }
  };

  const mountFootnoteView = (popupView: FoliateViewElement): void => {
    removeFootnoteView();
    footnoteView = popupView;
    popupView.setAttribute("data-onelingo-reader-ui", "");
    popupView.style.display = "block";
    popupView.style.width = "100%";
    popupView.style.height = "100%";
    popupView.addEventListener("link", onPopupFootnoteLink);
    popupView.addEventListener("relocate", onFootnoteRelocate);
    configureFootnotePopupRenderer(
      popupView.renderer,
      createFoliateFootnoteContentCss(getEffectiveTheme()),
    );
    footnoteContentRef?.replaceChildren(popupView);
  };

  const onPopupFootnoteLink = (event: Event): void => {
    void handlePopupFootnoteLink(event as FoliateLinkEvent);
  };

  const onFootnoteRelocate = (): void => {
    if (footnoteView) showFootnoteView();
  };

  const showFootnoteView = (): void => {
    if (!contentRef) return;
    const bounds = contentRef.getBoundingClientRect();
    const size = getFootnotePopupSize(
      bounds,
      FOLIATE_FOOTNOTE_POPUP_PADDING,
      footnoteView?.renderer?.viewSize,
    );
    const anchorPosition =
      footnoteAnchorPosition ??
      ({
        dir: "down",
        point: {
          x: bounds.width / 2,
          y: bounds.height / 2,
        },
      } satisfies FootnotePopupPosition);
    const position = getFootnotePopupPosition(
      anchorPosition,
      size,
      bounds,
      FOLIATE_FOOTNOTE_POPUP_PADDING,
    );
    setFootnotePopup({ position, size });
  };

  const showFootnoteShell = (): void => {
    if (!contentRef) return;
    const bounds = contentRef.getBoundingClientRect();
    const size = getFootnotePopupSize(bounds);
    const anchorPosition =
      footnoteAnchorPosition ??
      ({
        dir: "down",
        point: {
          x: bounds.width / 2,
          y: bounds.height / 2,
        },
      } satisfies FootnotePopupPosition);
    setFootnotePopup({
      position: getFootnotePopupPosition(
        anchorPosition,
        size,
        bounds,
        FOLIATE_FOOTNOTE_POPUP_PADDING,
      ),
      size,
    });
  };

  const closeFootnotePopup = (): void => {
    removeFootnoteView();
    footnoteAnchorPosition = null;
    footnoteHistory = [];
    footnoteHistoryIndex = -1;
    setFootnoteCanGoBack(false);
    setFootnotePopup(null);
  };

  const removeFootnoteView = (): void => {
    if (!footnoteView) return;
    footnoteView.removeEventListener("link", onPopupFootnoteLink);
    footnoteView.removeEventListener("relocate", onFootnoteRelocate);
    footnoteView.close?.();
    footnoteView.remove();
    footnoteView = undefined;
    footnoteContentRef?.replaceChildren();
  };

  const onLocationChange = (detail: FoliateRelocateDetail): void => {
    if (footnotePopup() && isReaderMovementRelocate(detail.reason)) {
      closeFootnotePopup();
    }
    if (detail.reason === "scroll") overlayScrollbarController.refresh();
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

  const readerChapterLabel = (): string => locationLabel() || docTitle();

  const readerBookTitle = (): string => docTitle() || t("viewer.title");

  const readerChromeState = () => getReaderChromeState(readerChromeZone());

  const readerChromeLayout = () => getReaderChromeLayout(viewMode());

  const showReaderChrome = (zone: Exclude<ReaderChromeZone, null>): void => {
    if (state() !== "ready") return;
    setReaderChromeZone(zone);
  };

  const resetReaderChrome = (): void => {
    if (readerChromeZone() !== null) {
      setReaderChromeZone(null);
    }
  };

  const hideReaderChrome = (zone: Exclude<ReaderChromeZone, null>): void => {
    setReaderChromeZone((current) => (current === zone ? null : current));
  };

  const setMode = (nextMode: ViewMode): void => {
    if (nextMode !== "pages") clearWheelTurns();
    closeFootnotePopup();
    setViewMode(nextMode);
    if (view) syncViewMode(view, nextMode);
    syncReaderLayout(sidebarVisible() && isDockedSidebar() ? sidebarWidth() : null, nextMode);
    syncOverlayScrollbarContainer(nextMode);
  };

  const performPageTurn = async (direction: WheelTurnDirection): Promise<void> => {
    if (!view || navigationLocked) return;
    closeFootnotePopup();
    navigationLocked = true;
    try {
      if (direction === "left") {
        await view.goLeft();
      } else {
        await view.goRight();
      }
      if (!isDockedSidebar() && sidebarVisible()) {
        setSidebarVisible(false);
      }
    } finally {
      navigationLocked = false;
    }
  };

  const goLeft = async (): Promise<void> => {
    await performPageTurn("left");
  };

  const goRight = async (): Promise<void> => {
    await performPageTurn("right");
  };

  const performSectionTurn = async (direction: SectionTurnDirection): Promise<void> => {
    if (!view || navigationLocked) return;
    const renderer = view.renderer;
    const action = direction === "previous" ? renderer?.prevSection : renderer?.nextSection;
    if (!renderer || !action) return;
    clearWheelTurns();
    closeFootnotePopup();
    navigationLocked = true;
    try {
      await action.call(renderer);
      if (!isDockedSidebar() && sidebarVisible()) {
        setSidebarVisible(false);
      }
    } finally {
      navigationLocked = false;
    }
  };

  const goPreviousSection = async (): Promise<void> => {
    await performSectionTurn("previous");
  };

  const goNextSection = async (): Promise<void> => {
    await performSectionTurn("next");
  };

  const goToToc = async (href: string): Promise<void> => {
    if (!view || navigationLocked || !href) return;
    clearWheelTurns();
    closeFootnotePopup();
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

  const clearWheelTurns = (): void => {
    wheelTurnDetector.reset();
    wheelTurnNavigator.clear();
  };

  const bindWheelTarget = (target: Document | HTMLElement): (() => void) => {
    const listener = (event: WheelEvent): void => {
      handleWheelTurn(event);
    };
    target.addEventListener("wheel", listener as EventListener, {
      capture: true,
      passive: false,
    });
    return () => {
      target.removeEventListener("wheel", listener as EventListener, {
        capture: true,
      });
    };
  };

  const onFoliateContentLoad = (doc: Document): void => {
    bindWheelContentDocument(doc);
    syncOverlayScrollbarContainer();
    overlayScrollbarController.refresh();
  };

  const bindWheelContentDocument = (doc: Document): void => {
    if (wheelDocCleanups.has(doc)) return;
    const cleanupWheel = bindWheelTarget(doc);
    const cleanupChrome = bindReaderChromeContentDocument(doc);
    wheelDocCleanups.set(doc, () => {
      cleanupWheel();
      cleanupChrome();
    });
  };

  const clearWheelContentDocuments = (): void => {
    for (const cleanup of wheelDocCleanups.values()) cleanup();
    wheelDocCleanups.clear();
  };

  const syncOverlayScrollbarContainer = (mode = viewMode()): void => {
    if (!view || mode !== "scroll") {
      overlayScrollbarController.setContainer(null);
      return;
    }
    installOverlayScrollbarNativeStyle(view);
    overlayScrollbarController.setContainer(getFoliateScrollContainer(view));
  };

  const bindReaderChromeContentDocument = (doc: Document): (() => void) => {
    const listener = (): void => {
      resetReaderChrome();
    };
    doc.addEventListener("mousemove", listener, {
      capture: true,
      passive: true,
    });
    return () => {
      doc.removeEventListener("mousemove", listener, {
        capture: true,
      });
    };
  };

  const handleWheelTurn = (event: WheelEvent): void => {
    const active = shouldHandleWheelTurn(event, {
      isPagesMode: viewMode() === "pages",
      isReady: state() === "ready",
      isReaderUi: isReaderControlWheelEvent(event),
    });
    if (!active) {
      if (event.ctrlKey || event.metaKey || viewMode() !== "pages") {
        clearWheelTurns();
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const direction = wheelTurnDetector.feed({
      ctrlKey: event.ctrlKey,
      deltaMode: event.deltaMode,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      metaKey: event.metaKey,
      timeStamp: event.timeStamp,
    });
    if (!direction) return;
    wheelTurnNavigator.enqueue(direction);
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
                <div
                  class="foliate-book-card"
                  classList={{ "has-cover": Boolean(book().coverUrl) }}
                >
                  <Show when={book().coverUrl}>
                    {(coverUrl) => (
                      <div class="foliate-book-cover">
                        <img alt={book().title} src={coverUrl()} />
                      </div>
                    )}
                  </Show>
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
          <div
            classList={{
              "foliate-content": true,
              "has-scroll-chrome-space": readerChromeLayout().reserveChromeSpace,
            }}
            onMouseMove={(event) => {
              const target = event.target;
              if (!(target instanceof Element)) return;
              if (
                target.closest(
                  [
                    ".foliate-reader-topbar",
                    ".foliate-reader-bottom-hover-zone",
                    ".foliate-page-turn-zone",
                  ].join(", "),
                )
              ) {
                return;
              }
              resetReaderChrome();
            }}
            ref={(el) => {
              contentRef = el;
            }}
          >
            <div
              class="foliate-render-area"
              id="foliate-render"
              ref={(el) => {
                renderHost = el;
              }}
            />
            <Show when={state() === "ready" && viewMode() === "scroll"}>
              <div
                aria-hidden="true"
                classList={{
                  "foliate-scrollbar": true,
                  "is-expanded": scrollbarSnapshot().state === "expanded",
                  "is-visible":
                    scrollbarSnapshot().state === "visible" ||
                    scrollbarSnapshot().state === "expanded",
                }}
                data-onelingo-reader-ui=""
                onMouseEnter={() => overlayScrollbarController.expand()}
                onMouseLeave={() => overlayScrollbarController.collapse()}
                onWheel={(event) => {
                  const handled = overlayScrollbarController.scrollByWheel({
                    deltaMode: event.deltaMode,
                    deltaX: event.deltaX,
                    deltaY: event.deltaY,
                  });
                  if (!handled) return;
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <button
                  class="foliate-scrollbar-button is-up"
                  onClick={() => overlayScrollbarController.scrollByStep("up")}
                  tabIndex={-1}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    class="foliate-scrollbar-button-triangle"
                  />
                </button>
                <div
                  class="foliate-scrollbar-track"
                  onClick={(event) => {
                    if (event.target !== event.currentTarget) return;
                    overlayScrollbarController.scrollByPageAt(
                      event.clientY,
                      event.currentTarget.getBoundingClientRect().top,
                    );
                  }}
                  ref={(el) => {
                    scrollbarTrackRef = el;
                    overlayScrollbarController.refresh();
                  }}
                >
                  <button
                    class="foliate-scrollbar-thumb"
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => {
                      scrollbarDrag?.stop();
                      scrollbarDrag = overlayScrollbarController.startThumbDrag(event.clientY);
                      const pointerId = event.pointerId;
                      const target = event.currentTarget;
                      target.setPointerCapture(pointerId);
                      const onMove = (moveEvent: PointerEvent): void => {
                        scrollbarDrag?.move(moveEvent.clientY);
                      };
                      const onStop = (): void => {
                        target.removeEventListener("pointermove", onMove);
                        target.removeEventListener("pointerup", onStop);
                        target.removeEventListener("pointercancel", onStop);
                        scrollbarDrag?.stop();
                        scrollbarDrag = undefined;
                      };
                      target.addEventListener("pointermove", onMove);
                      target.addEventListener("pointerup", onStop);
                      target.addEventListener("pointercancel", onStop);
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    style={{
                      height: `${scrollbarSnapshot().thumbHeight}px`,
                      transform: `translateY(${scrollbarSnapshot().thumbTop}px)`,
                    }}
                    tabIndex={-1}
                    type="button"
                  />
                </div>
                <button
                  class="foliate-scrollbar-button is-down"
                  onClick={() => overlayScrollbarController.scrollByStep("down")}
                  tabIndex={-1}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    class="foliate-scrollbar-button-triangle"
                  />
                </button>
              </div>
            </Show>
            <Show when={state() === "ready"}>
              <header
                classList={{
                  "foliate-reader-topbar": true,
                  "is-expanded": readerChromeState().showModeSwitch,
                }}
                onMouseEnter={() => showReaderChrome("top")}
                onMouseLeave={() => hideReaderChrome("top")}
              >
                <div class="foliate-reader-topbar-start">
                  <Show when={!sidebarVisible()}>
                    <button
                      aria-label={t("viewer.sidebar.open")}
                      class="foliate-nav-button foliate-reader-sidebar-toggle"
                      disabled={state() !== "ready"}
                      onClick={toggleSidebar}
                      type="button"
                    >
                      <IconSidebar size={16} />
                    </button>
                  </Show>
                  <div
                    classList={{
                      "foliate-reader-section-info": true,
                      "is-hidden": !readerChromeState().showChapterTitle,
                    }}
                    title={readerChapterLabel()}
                  >
                    {readerChapterLabel()}
                  </div>
                </div>
                <div class="foliate-reader-book-title" title={readerBookTitle()}>
                  {readerBookTitle()}
                </div>
                <div class="foliate-reader-topbar-end">
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
                </div>
              </header>
              <div
                class="foliate-reader-bottom-hover-zone"
                onMouseEnter={() => showReaderChrome("bottom")}
                onMouseLeave={() => hideReaderChrome("bottom")}
              >
                <nav
                  aria-label={t("viewer.sectionNavigation")}
                  classList={{
                    "foliate-reader-bottombar": true,
                    "is-visible": readerChromeState().showSectionNavigation,
                  }}
                >
                  <button
                    aria-label={t("viewer.previousSection")}
                    class="foliate-section-button"
                    disabled={state() !== "ready"}
                    onClick={(event) => {
                      event.currentTarget.blur();
                      void goPreviousSection();
                    }}
                    title={t("viewer.previousSection")}
                    type="button"
                  >
                    <IconArrowLeftDouble size={24} />
                  </button>
                  <button
                    aria-label={t("viewer.nextSection")}
                    class="foliate-section-button"
                    disabled={state() !== "ready"}
                    onClick={(event) => {
                      event.currentTarget.blur();
                      void goNextSection();
                    }}
                    title={t("viewer.nextSection")}
                    type="button"
                  >
                    <IconArrowRightDouble size={24} />
                  </button>
                </nav>
              </div>
            </Show>
            <Show when={state() === "ready" && viewMode() === "pages"}>
              <div class="foliate-page-turn-zone is-left">
                <button
                  aria-label={t("pdfViewer.previousPage")}
                  class="foliate-page-turn-button"
                  onClick={(event) => {
                    event.currentTarget.blur();
                    void goLeft();
                  }}
                  type="button"
                >
                  <IconChevron size={24} />
                </button>
              </div>
              <div class="foliate-page-turn-zone is-right">
                <button
                  aria-label={t("pdfViewer.nextPage")}
                  class="foliate-page-turn-button"
                  onClick={(event) => {
                    event.currentTarget.blur();
                    void goRight();
                  }}
                  type="button"
                >
                  <IconChevron size={24} />
                </button>
              </div>
            </Show>

            <Show when={sidebarVisible() && !isDockedSidebar()}>
              <button
                aria-hidden="true"
                class="foliate-sidebar-backdrop"
                onClick={closeSidebar}
                tabIndex={-1}
                type="button"
              />
            </Show>

            <Show when={footnotePopup()}>
              {(popup) => (
                <>
                  <button
                    aria-hidden="true"
                    class="foliate-footnote-backdrop"
                    data-onelingo-reader-ui=""
                    onClick={closeFootnotePopup}
                    tabIndex={-1}
                    type="button"
                  />
                  <section
                    aria-label="Footnote"
                    classList={{
                      "foliate-footnote-popup": true,
                      "is-down": popup().position.dir === "down",
                      "is-up": popup().position.dir === "up",
                    }}
                    data-onelingo-reader-ui=""
                    role="dialog"
                    style={{
                      height: `${popup().size.height}px`,
                      left: `${popup().position.point.x}px`,
                      top: `${popup().position.point.y}px`,
                      width: `${popup().size.width}px`,
                    }}
                    tabIndex={-1}
                  >
                    <Show when={footnoteCanGoBack()}>
                      <button
                        aria-label="Back"
                        class="foliate-footnote-back"
                        onClick={() => void handleFootnoteBack()}
                        type="button"
                      >
                        <IconChevron size={16} />
                      </button>
                    </Show>
                    <div
                      class="foliate-footnote-content"
                      ref={(el) => {
                        footnoteContentRef = el;
                        if (footnoteView) el.replaceChildren(footnoteView);
                      }}
                    />
                  </section>
                </>
              )}
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
                      <div
                        class="foliate-details-hero"
                        classList={{ "has-cover": Boolean(book().coverUrl) }}
                      >
                        <Show when={book().coverUrl}>
                          {(coverUrl) => (
                            <div class="foliate-details-cover">
                              <img alt={book().title} src={coverUrl()} />
                            </div>
                          )}
                        </Show>
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

function syncViewMode(targetView: FoliateViewElement, mode: ViewMode): void {
  targetView.dataset.viewMode = mode;
  targetView.renderer?.setAttribute("flow", viewFlow(mode));
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
    const maxInline = clamp(available * 0.55, 420, 680);
    renderer.setAttribute("max-inline-size", `${Math.round(maxInline)}px`);
  } else {
    renderer.removeAttribute("max-inline-size");
  }
}

function isFoliateLinkDetail(value: unknown): value is FoliateLinkDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<FoliateLinkDetail>;
  return isAnchorElement(detail.a) && typeof detail.href === "string";
}

function isAnchorElement(value: unknown): value is HTMLAnchorElement {
  if (!value || typeof value !== "object" || !("tagName" in value)) return false;
  const tagName = (value as { tagName?: unknown }).tagName;
  return typeof tagName === "string" && tagName.toLowerCase() === "a";
}

function cloneFootnoteLinkDetail(detail: FoliateLinkDetail): FoliateLinkDetail {
  return {
    a: detail.a,
    check: detail.check,
    follow: detail.follow,
    href: detail.href,
  };
}

function promoteAnchorForFootnoteDetection(anchor: HTMLAnchorElement): () => void {
  const previousVerticalAlign = anchor.style.verticalAlign;
  anchor.style.verticalAlign = "super";
  return () => {
    anchor.style.verticalAlign = previousVerticalAlign;
  };
}

function isReaderMovementRelocate(reason: string | undefined): boolean {
  return reason === "page" || reason === "snap" || reason === "scroll";
}

function isReaderControlWheelEvent(event: WheelEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      [
        ".foliate-reader-topbar",
        ".foliate-reader-bottombar",
        ".foliate-reader-bottom-hover-zone",
        ".foliate-sidebar",
        ".foliate-sidebar-backdrop",
        ".foliate-details-backdrop",
        ".foliate-details-modal",
        ".foliate-footnote-backdrop",
        ".foliate-footnote-popup",
      ].join(", "),
    ),
  );
}

export default App;
