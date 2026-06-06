import { sendMessage } from "@/lib/messaging";
import {
  normalizeFoliateReaderSettings,
  type FoliateReaderStyleSettings,
} from "@/lib/foliate-reader-settings";

export type FoliateReaderAppearanceMessageInput = {
  settings: FoliateReaderStyleSettings;
};

type FoliateReaderAppearanceBroadcastMessage = {
  input: FoliateReaderAppearanceMessageInput;
  type: "applyFoliateReaderAppearance";
};

type FoliateReaderAppearanceSender = (
  type: "applyFoliateReaderAppearance",
  input: FoliateReaderAppearanceMessageInput,
) => Promise<{ applied: boolean } | undefined>;

type FoliateReaderAppearanceBroadcastChannel = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  close(): void;
  postMessage(message: FoliateReaderAppearanceBroadcastMessage): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
};

const FOLIATE_READER_APPEARANCE_CHANNEL =
  "onelingo:foliate-reader-appearance";

export function createFoliateReaderAppearanceMessageInput(
  settings: FoliateReaderStyleSettings,
): FoliateReaderAppearanceMessageInput {
  return {
    settings: normalizeFoliateReaderSettings({
      foliateReaderFontSize: settings.fontSize,
      foliateReaderLineHeight: settings.lineHeight,
      foliateReaderTextIndent: settings.textIndent,
      foliateReaderUseBookLayout: settings.useBookLayout,
    }),
  };
}

export async function broadcastFoliateReaderAppearance(
  settings: FoliateReaderStyleSettings,
  sender: FoliateReaderAppearanceSender = sendMessage,
  createChannel: () => FoliateReaderAppearanceBroadcastChannel | null =
    createFoliateReaderAppearanceBroadcastChannel,
): Promise<void> {
  const input = createFoliateReaderAppearanceMessageInput(settings);
  postFoliateReaderAppearanceBroadcastInput(input, createChannel);
  try {
    await sender("applyFoliateReaderAppearance", input);
  } catch (err) {
    if (isMissingFoliateReaderReceiverError(err)) return;
    throw err;
  }
}

export function postFoliateReaderAppearanceBroadcast(
  settings: FoliateReaderStyleSettings,
  createChannel: () => FoliateReaderAppearanceBroadcastChannel | null =
    createFoliateReaderAppearanceBroadcastChannel,
): void {
  postFoliateReaderAppearanceBroadcastInput(
    createFoliateReaderAppearanceMessageInput(settings),
    createChannel,
  );
}

export function listenFoliateReaderAppearanceBroadcast(
  onSettings: (settings: FoliateReaderStyleSettings) => void,
  createChannel: () => FoliateReaderAppearanceBroadcastChannel | null =
    createFoliateReaderAppearanceBroadcastChannel,
): () => void {
  const channel = createChannel();
  if (!channel) return () => {};
  const listener = (event: MessageEvent<unknown>): void => {
    const message = parseFoliateReaderAppearanceBroadcastMessage(event.data);
    if (!message) return;
    onSettings(message.input.settings);
  };
  channel.addEventListener("message", listener);
  return () => {
    channel.removeEventListener("message", listener);
    channel.close();
  };
}

export function isMissingFoliateReaderReceiverError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes("Receiving end does not exist") ||
    err.message.includes("Could not establish connection")
  );
}

function postFoliateReaderAppearanceBroadcastInput(
  input: FoliateReaderAppearanceMessageInput,
  createChannel: () => FoliateReaderAppearanceBroadcastChannel | null,
): void {
  const channel = createChannel();
  if (!channel) return;
  try {
    channel.postMessage({
      type: "applyFoliateReaderAppearance",
      input,
    });
  } finally {
    channel.close();
  }
}

function createFoliateReaderAppearanceBroadcastChannel():
  | FoliateReaderAppearanceBroadcastChannel
  | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(FOLIATE_READER_APPEARANCE_CHANNEL);
}

function parseFoliateReaderAppearanceBroadcastMessage(
  raw: unknown,
): FoliateReaderAppearanceBroadcastMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const message = raw as {
    input?: { settings?: FoliateReaderStyleSettings };
    type?: unknown;
  };
  if (message.type !== "applyFoliateReaderAppearance") return null;
  const settings = message.input?.settings;
  if (!settings) return null;
  return {
    type: "applyFoliateReaderAppearance",
    input: createFoliateReaderAppearanceMessageInput(settings),
  };
}
