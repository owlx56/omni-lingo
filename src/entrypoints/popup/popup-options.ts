import type { UiLang } from "@/lib/languages";
import { UI_LANG_LABELS, UI_LANGS } from "@/lib/languages";
import type { SelectOption } from "@/lib/ui/controls";
import {
  pageSourceToCommandSource,
  type PageSourceLang,
} from "./popup-language-options";

export type PageTargetLang = UiLang;
export type AiStyleId = "default";

export function pageTargetOptions(): SelectOption<PageTargetLang>[] {
  return UI_LANGS.map((value) => ({
    value,
    label: UI_LANG_LABELS[value],
  }));
}

export function commandSourceField(source: PageSourceLang): {
  source?: UiLang;
} {
  const commandSource = pageSourceToCommandSource(source);
  return commandSource ? { source: commandSource } : {};
}
