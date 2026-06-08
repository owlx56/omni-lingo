import { UI_LANG_LABELS, UI_LANGS, isUiLang, type UiLang } from "@/lib/languages";

export type PageSourceLang = "auto" | UiLang;

export type PopupLanguageOption<T extends string> = {
  value: T;
  label: string;
};

export function pageSourceOptions(
  autoLabel: string,
): PopupLanguageOption<PageSourceLang>[] {
  return [
    { value: "auto", label: autoLabel },
    ...UI_LANGS.map((value) => ({
      value,
      label: UI_LANG_LABELS[value],
    })),
  ];
}

export function pageSourceFromStatus(source: string | null | undefined): PageSourceLang {
  return isUiLang(source) ? source : "auto";
}

export function pageSourceToCommandSource(
  source: PageSourceLang,
): UiLang | undefined {
  return source === "auto" ? undefined : source;
}

export function pageSourceToPrefSource(source: PageSourceLang): UiLang | null {
  return source === "auto" ? null : source;
}
