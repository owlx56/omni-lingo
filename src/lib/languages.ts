export const UI_LANGS = [
  "en",
  "zh-Hans",
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
] as const;

export type UiLang = (typeof UI_LANGS)[number];

export const TARGET_LANGS = UI_LANGS;

export type TargetLang = UiLang;

export const UI_LANG_LABELS: Record<UiLang, string> = {
  en: "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  ar: "العربية",
  tr: "Türk",
  ru: "русский",
  vi: "Việt",
  th: "ไทย",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  "pt-BR": "Português(BR)",
  hi: "हिन्दी",
  it: "Italiano",
  id: "Bahasa Indonesia",
  fa: "فارسی",
};

export function isUiLang(value: unknown): value is UiLang {
  return typeof value === "string" && UI_LANGS.includes(value as UiLang);
}

export function isTargetLang(value: unknown): value is TargetLang {
  return isUiLang(value);
}
