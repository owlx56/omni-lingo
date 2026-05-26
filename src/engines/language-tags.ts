export function googleLanguageTag(lang: string): string {
  if (lang === "zh-Hans") return "zh-CN";
  if (lang === "zh-Hant") return "zh-TW";
  return lang;
}

export function microsoftLanguageTag(lang: string): string {
  if (lang === "zh-Hans") return "zh-Hans";
  if (lang === "zh-Hant") return "zh-Hant";
  return lang;
}
