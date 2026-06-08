import type { UiLang } from "@/lib/languages";
import type { PageTranslateStatus } from "@/lib/messaging";
import type { FullPageEngineId, FullPageMode } from "@/lib/storage/settings";
import type { PageSourceLang } from "./popup-language-options";

export type PopupPagePrefs = {
  engine: FullPageEngineId;
  mode: FullPageMode;
  source: PageSourceLang;
  target: UiLang;
};

export type PopupPagePrefsView = PopupPagePrefs & {
  hasPagePrefs: boolean;
};

export function createPopupPagePrefSync(): {
  capture: () => number;
  markLocalChange: () => number;
  canApplyRemote: (snapshot: number) => boolean;
} {
  let version = 0;
  return {
    capture: () => version,
    markLocalChange: () => {
      version += 1;
      return version;
    },
    canApplyRemote: (snapshot: number) => snapshot === version,
  };
}

export function pagePrefsFromLocalSaveAck(
  next: PopupPagePrefs,
  _ack: Pick<
    PageTranslateStatus,
    "engine" | "hasPagePrefs" | "mode" | "source" | "target"
  > | null | undefined,
): PopupPagePrefsView {
  return {
    ...next,
    hasPagePrefs: true,
  };
}
