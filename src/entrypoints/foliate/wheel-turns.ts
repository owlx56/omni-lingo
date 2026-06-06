export type WheelTurnDirection = "left" | "right";

export type WheelTurnSample = {
  ctrlKey?: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  metaKey?: boolean;
  timeStamp: number;
};

export type WheelTurnDetectorOptions = {
  idleResetMs?: number;
  lineHeight?: number;
  pageHeight?: number;
  threshold?: number;
};

export type WheelTurnNavigatorOptions = {
  canNavigate?: () => boolean;
  isActive?: () => boolean;
  navigate: (direction: WheelTurnDirection) => Promise<void> | void;
  wait?: () => Promise<void>;
};

export type WheelTurnHandleOptions = {
  isPagesMode: boolean;
  isReaderUi?: boolean;
  isReady: boolean;
};

const DEFAULT_THRESHOLD = 30;
const DEFAULT_IDLE_RESET_MS = 120;
const DEFAULT_LINE_HEIGHT = 40;
const DEFAULT_PAGE_HEIGHT = 800;

export function createWheelTurnDetector(
  options: WheelTurnDetectorOptions = {},
): {
  feed: (sample: WheelTurnSample) => WheelTurnDirection | null;
  reset: () => void;
} {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const idleResetMs = options.idleResetMs ?? DEFAULT_IDLE_RESET_MS;
  const lineHeight = options.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const pageHeight = options.pageHeight ?? DEFAULT_PAGE_HEIGHT;
  let accumX = 0;
  let accumY = 0;
  let lastTime = -Infinity;
  let flipped = false;

  const normalize = (delta: number, mode: number): number => {
    if (mode === 1) return delta * lineHeight;
    if (mode === 2) return delta * pageHeight;
    return delta;
  };

  const reset = (): void => {
    accumX = 0;
    accumY = 0;
    lastTime = -Infinity;
    flipped = false;
  };

  const feed = (sample: WheelTurnSample): WheelTurnDirection | null => {
    if (sample.ctrlKey || sample.metaKey) {
      reset();
      return null;
    }

    if (sample.timeStamp - lastTime > idleResetMs) {
      accumX = 0;
      accumY = 0;
      flipped = false;
    }
    lastTime = sample.timeStamp;

    if (flipped) return null;

    accumX += normalize(sample.deltaX, sample.deltaMode);
    accumY += normalize(sample.deltaY, sample.deltaMode);

    if (Math.abs(accumX) < threshold && Math.abs(accumY) < threshold) {
      return null;
    }

    const direction = dominantDirection(accumX, accumY);
    flipped = true;
    accumX = 0;
    accumY = 0;
    return direction;
  };

  return { feed, reset };
}

export function createQueuedWheelTurnNavigator(
  options: WheelTurnNavigatorOptions,
): {
  clear: () => void;
  enqueue: (direction: WheelTurnDirection) => void;
  isDraining: () => boolean;
  pending: () => number;
  whenIdle: () => Promise<void>;
} {
  const wait = options.wait ?? defaultWait;
  let queue: WheelTurnDirection[] = [];
  let draining = false;
  let token = 0;
  let idleResolvers: Array<() => void> = [];

  const notifyIdle = (): void => {
    if (draining || queue.length > 0) return;
    const resolvers = idleResolvers;
    idleResolvers = [];
    for (const resolve of resolvers) resolve();
  };

  const clear = (): void => {
    queue = [];
    token += 1;
    notifyIdle();
  };

  const drain = async (expectedToken: number): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0 && expectedToken === token) {
        if (options.isActive && !options.isActive()) {
          clear();
          break;
        }
        if (options.canNavigate && !options.canNavigate()) {
          await wait();
          continue;
        }
        const direction = queue.shift();
        if (direction) await options.navigate(direction);
      }
    } finally {
      draining = false;
      if (queue.length > 0) {
        void drain(token);
      } else {
        notifyIdle();
      }
    }
  };

  const enqueue = (direction: WheelTurnDirection): void => {
    queue.push(direction);
    void drain(token);
  };

  const whenIdle = (): Promise<void> => {
    if (!draining && queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      idleResolvers.push(resolve);
    });
  };

  return {
    clear,
    enqueue,
    isDraining: () => draining,
    pending: () => queue.length,
    whenIdle,
  };
}

export function shouldHandleWheelTurn(
  sample: WheelTurnSample,
  options: WheelTurnHandleOptions,
): boolean {
  if (!options.isReady || !options.isPagesMode || options.isReaderUi) return false;
  if (sample.ctrlKey || sample.metaKey) return false;
  return sample.deltaX !== 0 || sample.deltaY !== 0;
}

function dominantDirection(deltaX: number, deltaY: number): WheelTurnDirection {
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return deltaX > 0 ? "right" : "left";
  }
  return deltaY > 0 ? "right" : "left";
}

function defaultWait(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 16);
  });
}
