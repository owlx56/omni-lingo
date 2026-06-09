import { isElement } from "@/lib/guards";
import { clamp } from "@/lib/number";

export type OverlayScrollbarMode = "pages" | "scroll";
export type OverlayScrollbarVisualState = "hidden" | "visible" | "expanded";

export type OverlayScrollbarSnapshot = {
  canScroll: boolean;
  state: OverlayScrollbarVisualState;
  thumbHeight: number;
  thumbTop: number;
};

export type OverlayScrollbarThumb = {
  canScroll: boolean;
  height: number;
  top: number;
};

export type OverlayScrollbarController = {
  collapse(): void;
  destroy(): void;
  expand(): void;
  hide(): void;
  refresh(): void;
  scrollByPageAt(pointerY: number, trackTop: number): void;
  scrollByStep(direction: "down" | "up"): void;
  scrollByWheel(input: OverlayScrollbarWheelInput): boolean;
  setContainer(container: OverlayScrollContainer | null): void;
  show(): void;
  startThumbDrag(pointerY: number): OverlayScrollbarDrag;
};

export type OverlayScrollbarDrag = {
  move(pointerY: number): void;
  stop(): void;
};

export type OverlayScrollContainer = {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  clientHeight: number;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  scrollHeight: number;
  scrollTop: number;
};

export type OverlayScrollbarWheelInput = {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
};

type TimerId = unknown;

type OverlayScrollbarControllerOptions = {
  clearTimeout?: (id: TimerId) => void;
  getTrackHeight: () => number;
  hideDelayMs?: number;
  isActive?: () => boolean;
  onChange?: (snapshot: OverlayScrollbarSnapshot) => void;
  setTimeout?: (callback: () => void, delay: number) => TimerId;
  stepSize?: number;
};

type OverlayThumbInput = {
  clientHeight: number;
  minThumbSize?: number;
  scrollHeight: number;
  scrollTop: number;
  trackHeight: number;
};

type OverlayStateInput = {
  canScroll: boolean;
  isReady: boolean;
  mode: OverlayScrollbarMode;
  requested: OverlayScrollbarVisualState;
  wasVisible?: boolean;
};

const DEFAULT_HIDE_DELAY_MS = 1000;
const DEFAULT_MIN_THUMB_SIZE = 28;
const DEFAULT_STEP_SIZE = 72;
const WHEEL_LINE_SIZE = 16;
const FOLIATE_SCROLLBAR_STYLE_ID = "onelingo-overlay-scrollbar-native-style";

export const HIDDEN_OVERLAY_SCROLLBAR: OverlayScrollbarSnapshot = {
  canScroll: false,
  state: "hidden",
  thumbHeight: 0,
  thumbTop: 0,
};

export function computeOverlayThumb(input: OverlayThumbInput): OverlayScrollbarThumb {
  const trackHeight = Math.max(0, input.trackHeight);
  const clientHeight = Math.max(0, input.clientHeight);
  const scrollHeight = Math.max(0, input.scrollHeight);
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  if (trackHeight <= 0 || clientHeight <= 0 || maxScroll <= 0) {
    return { canScroll: false, height: 0, top: 0 };
  }

  const minThumbSize = Math.max(1, input.minThumbSize ?? DEFAULT_MIN_THUMB_SIZE);
  const height = clamp((clientHeight / scrollHeight) * trackHeight, minThumbSize, trackHeight);
  const maxThumbTop = Math.max(0, trackHeight - height);
  const scrollTop = clamp(input.scrollTop, 0, maxScroll);
  const top = maxThumbTop === 0 ? 0 : (scrollTop / maxScroll) * maxThumbTop;
  return {
    canScroll: true,
    height,
    top,
  };
}

export function getOverlayScrollbarState(input: OverlayStateInput): OverlayScrollbarVisualState {
  if (!input.isReady || input.mode !== "scroll" || !input.canScroll) return "hidden";
  if (input.requested === "expanded" && input.wasVisible === false) return "hidden";
  return input.requested;
}

export function createOverlayScrollbarController(
  options: OverlayScrollbarControllerOptions,
): OverlayScrollbarController {
  const clearTimer =
    options.clearTimeout ?? ((id: TimerId) => globalThis.clearTimeout(id as never));
  const setTimer =
    options.setTimeout ??
    ((callback: () => void, delay: number): TimerId => globalThis.setTimeout(callback, delay));
  const hideDelayMs = options.hideDelayMs ?? DEFAULT_HIDE_DELAY_MS;
  const isActive = options.isActive ?? (() => true);
  const stepSize = options.stepSize ?? DEFAULT_STEP_SIZE;

  let container: OverlayScrollContainer | null = null;
  let hideTimer: TimerId | undefined;
  let isHoveringHitZone = false;
  let requestedState: OverlayScrollbarVisualState = "hidden";
  let resizeObserver: ResizeObserver | undefined;

  const clearHideTimer = (): void => {
    if (hideTimer === undefined) return;
    clearTimer(hideTimer);
    hideTimer = undefined;
  };

  const scheduleHide = (): void => {
    clearHideTimer();
    hideTimer = setTimer(() => {
      hideTimer = undefined;
      requestedState = "hidden";
      emit();
    }, hideDelayMs);
  };

  const snapshot = (): OverlayScrollbarSnapshot => {
    if (!container || !isActive()) return HIDDEN_OVERLAY_SCROLLBAR;
    const thumb = computeOverlayThumb({
      clientHeight: container.clientHeight,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
      trackHeight: options.getTrackHeight(),
    });
    const state = getOverlayScrollbarState({
      canScroll: thumb.canScroll,
      isReady: true,
      mode: "scroll",
      requested: requestedState,
      wasVisible: requestedState !== "hidden",
    });
    return {
      canScroll: thumb.canScroll,
      state,
      thumbHeight: thumb.height,
      thumbTop: thumb.top,
    };
  };

  const emit = (): void => {
    options.onChange?.(snapshot());
  };

  const show = (): void => {
    if (!container || !isActive()) {
      requestedState = "hidden";
      isHoveringHitZone = false;
      clearHideTimer();
      emit();
      return;
    }
    requestedState = isHoveringHitZone ? "expanded" : "visible";
    if (requestedState === "expanded") {
      clearHideTimer();
      emit();
      return;
    }
    emit();
    scheduleHide();
  };

  const onScroll = (): void => {
    show();
  };

  const onInput = (): void => {
    if (container && isActive()) show();
  };

  const detach = (): void => {
    if (!container) return;
    container.removeEventListener("scroll", onScroll);
    container.removeEventListener("wheel", onInput);
    container.removeEventListener("touchmove", onInput);
    container.removeEventListener("keydown", onInput);
    resizeObserver?.disconnect();
    resizeObserver = undefined;
  };

  const attach = (nextContainer: OverlayScrollContainer): void => {
    nextContainer.addEventListener("scroll", onScroll, { passive: true });
    nextContainer.addEventListener("wheel", onInput, { passive: true });
    nextContainer.addEventListener("touchmove", onInput, { passive: true });
    nextContainer.addEventListener("keydown", onInput, { passive: true });
    if (typeof ResizeObserver !== "undefined" && isElement(nextContainer)) {
      resizeObserver = new ResizeObserver(() => emit());
      resizeObserver.observe(nextContainer);
    }
  };

  const setContainer = (nextContainer: OverlayScrollContainer | null): void => {
    if (container === nextContainer) {
      emit();
      return;
    }
    detach();
    container = nextContainer;
    isHoveringHitZone = false;
    requestedState = "hidden";
    clearHideTimer();
    if (container) attach(container);
    emit();
  };

  const setScrollTop = (nextScrollTop: number): void => {
    if (!container) return;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = clamp(nextScrollTop, 0, maxScroll);
    show();
  };

  return {
    collapse() {
      isHoveringHitZone = false;
      if (requestedState !== "expanded") return;
      requestedState = "visible";
      emit();
      scheduleHide();
    },
    destroy() {
      detach();
      container = null;
      isHoveringHitZone = false;
      requestedState = "hidden";
      clearHideTimer();
      emit();
    },
    expand() {
      isHoveringHitZone = true;
      if (!container || !isActive() || requestedState === "hidden") {
        emit();
        return;
      }
      requestedState = "expanded";
      clearHideTimer();
      emit();
    },
    hide() {
      isHoveringHitZone = false;
      requestedState = "hidden";
      clearHideTimer();
      emit();
    },
    refresh() {
      emit();
    },
    scrollByPageAt(pointerY: number, trackTop: number) {
      if (!container) return;
      const thumb = computeOverlayThumb({
        clientHeight: container.clientHeight,
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
        trackHeight: options.getTrackHeight(),
      });
      const localY = pointerY - trackTop;
      if (localY < thumb.top) {
        setScrollTop(container.scrollTop - container.clientHeight);
      } else if (localY > thumb.top + thumb.height) {
        setScrollTop(container.scrollTop + container.clientHeight);
      } else {
        show();
      }
    },
    scrollByStep(direction: "down" | "up") {
      if (!container) return;
      setScrollTop(container.scrollTop + (direction === "down" ? stepSize : -stepSize));
    },
    scrollByWheel(input: OverlayScrollbarWheelInput): boolean {
      if (!container || !isActive()) return false;
      const delta = normalizeWheelDelta(input, container.clientHeight);
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      if (delta === 0 || maxScroll <= 0) return false;
      setScrollTop(container.scrollTop + delta);
      return true;
    },
    setContainer,
    show,
    startThumbDrag(pointerY: number): OverlayScrollbarDrag {
      const dragContainer = container;
      if (!dragContainer) return noopDrag();
      const thumb = computeOverlayThumb({
        clientHeight: dragContainer.clientHeight,
        scrollHeight: dragContainer.scrollHeight,
        scrollTop: dragContainer.scrollTop,
        trackHeight: options.getTrackHeight(),
      });
      const maxScroll = Math.max(0, dragContainer.scrollHeight - dragContainer.clientHeight);
      const maxThumbTop = Math.max(0, options.getTrackHeight() - thumb.height);
      const startScrollTop = dragContainer.scrollTop;
      requestedState = "expanded";
      clearHideTimer();
      emit();
      return {
        move(nextPointerY: number) {
          if (maxThumbTop <= 0) return;
          const delta = nextPointerY - pointerY;
          dragContainer.scrollTop = clamp(
            startScrollTop + (delta / maxThumbTop) * maxScroll,
            0,
            maxScroll,
          );
          requestedState = "expanded";
          emit();
        },
        stop() {
          requestedState = "visible";
          emit();
          scheduleHide();
        },
      };
    },
  };
}

export function getFoliateScrollContainer(target: {
  renderer?: { shadowRoot?: ShadowRoot | null } | null;
}): HTMLElement | null {
  const container = target.renderer?.shadowRoot?.getElementById("container");
  return container instanceof HTMLElement ? container : null;
}

export function installOverlayScrollbarNativeStyle(target: {
  renderer?: { shadowRoot?: ShadowRoot | null } | null;
}): void {
  const root = target.renderer?.shadowRoot;
  if (!root || root.getElementById(FOLIATE_SCROLLBAR_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = FOLIATE_SCROLLBAR_STYLE_ID;
  style.textContent = `
#container {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

#container::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
`;
  root.appendChild(style);
}

function normalizeWheelDelta(input: OverlayScrollbarWheelInput, viewportSize: number): number {
  const rawDelta =
    Math.abs(input.deltaY) >= Math.abs(input.deltaX) ? input.deltaY : input.deltaX;
  if (!Number.isFinite(rawDelta) || rawDelta === 0) return 0;
  if (input.deltaMode === 1) return rawDelta * WHEEL_LINE_SIZE;
  if (input.deltaMode === 2) return rawDelta * Math.max(1, viewportSize);
  return rawDelta;
}

function noopDrag(): OverlayScrollbarDrag {
  return {
    move() {},
    stop() {},
  };
}
