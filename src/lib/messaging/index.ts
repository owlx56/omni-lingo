// 类型安全的消息通道：业务代码只和 ProtocolMap 打交道，
// 不直接碰 browser.runtime.sendMessage。

import type {
  TranslateFormat,
  TranslateRequest,
  TranslateResponse,
} from "@/engines/types";
import type { FoliateReaderStyleSettings } from "@/lib/foliate-reader-settings";
import type { FullPageEngineId } from "@/lib/storage/settings";
import { browser, type Browser } from "wxt/browser";

export interface PageTranslateCommand {
  target: string;
  engine: FullPageEngineId;
  source?: string;
  mode?: "replace" | "bilingual";
  commandId?: number;
}

export interface PageTranslatePrefs {
  target?: string;
  engine?: FullPageEngineId;
  source?: string | null;
  mode?: "replace" | "bilingual";
}

export interface PageFeaturePrefs {
  fullPageClickToShowOriginal?: boolean;
  hoverEnabled?: boolean;
  selectionEnabled?: boolean;
}

export interface PageControlCommand {
  commandId?: number;
}

export interface PageTranslateAck {
  accepted: boolean;
  blocks: number;
  active: boolean;
  hasPagePrefs: boolean;
  translating?: boolean;
  mode?: "replace" | "bilingual";
  engine?: FullPageEngineId;
  source?: string;
  target?: string;
}

export interface PageTranslateStatus {
  active: boolean;
  translating: boolean;
  blocks: number;
  hasPagePrefs: boolean;
  mode?: "replace" | "bilingual";
  engine?: FullPageEngineId;
  source?: string;
  target?: string;
}

export interface PageFeatureStatus {
  fullPageClickToShowOriginal: boolean;
  hoverEnabled: boolean;
  selectionEnabled: boolean;
  hasFullPageClickToShowOriginalPref: boolean;
  hasHoverEnabledPref: boolean;
  hasSelectionEnabledPref: boolean;
}

export interface OpenDocumentLinkInput {
  keepOriginal?: boolean;
  standalone?: boolean;
  sourceTabId?: number;
  url: string;
}

export interface SniffedDocumentOpen {
  action: "open" | "bypass" | "handled";
  url?: string;
}

export interface FoliateReaderAppearanceInput {
  settings: FoliateReaderStyleSettings;
}

export interface ProtocolMap {
  ping: { input: { text: string }; output: { echo: string; at: number } };
  translate: {
    input: TranslateRequest & { engine?: string };
    output: TranslateResponse;
  };
  peekTranslateMemoryCache: {
    input: TranslateRequest & { engine?: string };
    output: TranslateResponse | null;
  };
  translatePage: {
    input: PageTranslateCommand;
    output: PageTranslateAck;
  };
  restorePage: {
    input: PageControlCommand;
    output: PageTranslateStatus;
  };
  getPageTranslateStatus: {
    input: Record<string, never>;
    output: PageTranslateStatus;
  };
  setPageTranslatePrefs: {
    input: PageTranslatePrefs;
    output: PageTranslateStatus;
  };
  getPageFeatureStatus: {
    input: Record<string, never>;
    output: PageFeatureStatus;
  };
  setPageFeaturePrefs: {
    input: PageFeaturePrefs;
    output: PageFeatureStatus;
  };
  runPageTranslate: {
    input: PageTranslateCommand;
    output: PageTranslateAck;
  };
  runPageRestore: {
    input: PageControlCommand;
    output: PageTranslateStatus;
  };
  readPageTranslateStatus: {
    input: Record<string, never>;
    output: PageTranslateStatus;
  };
  updatePageTranslatePrefs: {
    input: PageTranslatePrefs;
    output: PageTranslateStatus;
  };
  readPageFeatureStatus: {
    input: Record<string, never>;
    output: PageFeatureStatus;
  };
  updatePageFeaturePrefs: {
    input: PageFeaturePrefs;
    output: PageFeatureStatus;
  };
  openDocumentLink: {
    input: OpenDocumentLinkInput;
    output: { opened: boolean };
  };
  consumeSniffedDocument: {
    input: Record<string, never>;
    output: SniffedDocumentOpen | null;
  };
  applyFoliateReaderAppearance: {
    input: FoliateReaderAppearanceInput;
    output: { applied: boolean };
  };
  translateBatch: {
    input: {
      texts: string[];
      target: string;
      engine?: string;
      source?: string;
      format?: TranslateFormat;
    };
    output: string[];
  };
}

type Envelope<K extends keyof ProtocolMap = keyof ProtocolMap> = {
  __onelingo: true;
  type: K;
  input: ProtocolMap[K]["input"];
};

type Handler<K extends keyof ProtocolMap> = (
  input: ProtocolMap[K]["input"],
  sender: Browser.runtime.MessageSender,
) => ProtocolMap[K]["output"] | Promise<ProtocolMap[K]["output"]>;

function isEnvelope(raw: unknown): raw is Envelope {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { __onelingo?: unknown }).__onelingo === true
  );
}

export async function sendMessage<K extends keyof ProtocolMap>(
  type: K,
  input: ProtocolMap[K]["input"],
): Promise<ProtocolMap[K]["output"]> {
  const env = makeEnvelope(type, input);
  const send = () => {
    const runtime = browser.runtime;
    if (!runtime?.sendMessage) {
      throw new Error("Extension context invalidated");
    }
    return runtime.sendMessage(env) as Promise<ProtocolMap[K]["output"]>;
  };
  try {
    return await send();
  } catch (err) {
    // MV3 Service Worker 被 Chrome 杀掉时抛此错；
    // 再次 sendMessage 会自动唤醒 SW，等 150ms 让它重启后重试一次。
    if (
      err instanceof Error &&
      err.message.includes("message channel closed")
    ) {
      await new Promise<void>((r) => setTimeout(r, 150));
      return await send();
    }
    throw err;
  }
}

export async function sendTabMessage<K extends keyof ProtocolMap>(
  tabId: number,
  type: K,
  input: ProtocolMap[K]["input"],
): Promise<ProtocolMap[K]["output"]> {
  if (!browser.tabs?.sendMessage) {
    throw new Error("Extension context invalidated");
  }
  return browser.tabs.sendMessage(tabId, makeEnvelope(type, input)) as Promise<
    ProtocolMap[K]["output"]
  >;
}

export function onMessage<K extends keyof ProtocolMap>(
  type: K,
  handler: Handler<K>,
): () => void {
  if (!browser.runtime?.onMessage) {
    return () => {};
  }
  const listener = (
    raw: unknown,
    sender: Browser.runtime.MessageSender,
  ): Promise<unknown> | undefined => {
    if (!isEnvelope(raw) || raw.type !== type) return undefined;
    return Promise.resolve(handler(raw.input as ProtocolMap[K]["input"], sender));
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}

function makeEnvelope<K extends keyof ProtocolMap>(
  type: K,
  input: ProtocolMap[K]["input"],
): Envelope<K> {
  return { __onelingo: true, type, input };
}
