// OneLingo i18n 入口。
//
// 用法：
//   const t = useT();
//   <h1>{t("settings.title")}</h1>
//   <p>{t("popup.status.error", { msg: err })}</p>
//
// 因为 useSettings() 是 Solid signal，渲染处调 t(key) 会被自动追踪；
// uiLang 切换时所有用 t() 的位置都会重渲染。

import { useSettings, type UiLang } from "@/lib/storage/settings";
import { format, MESSAGES, type MessageKey } from "./messages";

export type { MessageKey } from "./messages";

export type TFn = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;

export function useT(): TFn {
  const settings = useSettings();
  return (key, params) => {
    const lang = settings().uiLang;
    return translate(lang, key, params);
  };
}

/** 非组件场景使用：传入显式 uiLang。 */
export function translate(
  lang: UiLang,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const tpl = MESSAGES[lang]?.[key] ?? MESSAGES.en[key] ?? key;
  return format(tpl, params);
}
