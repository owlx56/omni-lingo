import type { JSX } from "solid-js";
import { UI_LANG_LABELS, UI_LANGS } from "@/lib/languages";
import type {
  FullPageEngineId,
  FullPageMode,
  HoverGranularity,
  TargetLang,
  ThemePreference,
  TranslationColor,
  TranslationFontFamily,
  TranslationUnderlineStyle,
  UiLang,
} from "@/lib/storage/settings";
import type { MessageKey, TFn } from "@/lib/i18n";
import {
  IconFile,
  IconHover,
  IconImmersive,
  IconInfo,
  IconMoon,
  IconSelection,
  IconSettings,
  IconSun,
  IconSystem,
} from "@/lib/ui/icons";
import type {
  IconSegmentOption,
  SegmentOption,
  SelectOption,
} from "@/lib/ui/controls";
import type { TabId } from "@/lib/options-tabs";

export type OptionIcon = (props: { size?: number }) => JSX.Element;

export const VERSION = "0.0.0";
export const HOVER_FONT_SIZE_STEP = 0.5;
export const FOLIATE_READER_FONT_SIZE_STEP = 1;
export const FOLIATE_READER_LINE_HEIGHT_STEP = 0.1;

export const TABS: {
  id: TabId;
  labelKey: MessageKey;
  icon: OptionIcon;
}[] = [
  { id: "account", labelKey: "sidebar.account", icon: IconSettings },
  { id: "hover", labelKey: "sidebar.hover", icon: IconHover },
  { id: "selection", labelKey: "sidebar.selection", icon: IconSelection },
  { id: "immersive", labelKey: "sidebar.immersive", icon: IconImmersive },
  { id: "fileplus", labelKey: "sidebar.fileplus", icon: IconFile },
  { id: "about", labelKey: "sidebar.about", icon: IconInfo },
];

export const HOVER_ENGINES: { value: string; label: string }[] = [
  { value: "google", label: "Google" },
  { value: "google2", label: "Google 2" },
  { value: "microsoft", label: "Microsoft" },
];

export const FULL_PAGE_ENGINES: {
  value: FullPageEngineId;
  label: string;
}[] = [
  { value: "google2", label: "Google 2" },
  { value: "microsoft", label: "Microsoft" },
];

const GRANULARITIES: { value: HoverGranularity; labelKey: MessageKey }[] = [
  { value: "word", labelKey: "granularity.word" },
  { value: "sentence", labelKey: "granularity.sentence" },
  { value: "paragraph", labelKey: "granularity.paragraph" },
];

const MODES: { value: FullPageMode; labelKey: MessageKey }[] = [
  { value: "replace", labelKey: "mode.replace" },
  { value: "bilingual", labelKey: "mode.bilingual" },
];

const FONT_FAMILIES: {
  value: TranslationFontFamily;
  labelKey: MessageKey;
}[] = [
  { value: "inherit", labelKey: "font.inherit" },
  { value: "serif", labelKey: "font.serif" },
  { value: "sans", labelKey: "font.sans" },
  { value: "mono", labelKey: "font.mono" },
];

const UNDERLINE_STYLES: {
  value: TranslationUnderlineStyle;
  labelKey: MessageKey;
}[] = [
  { value: "none", labelKey: "underline.none" },
  { value: "solid", labelKey: "underline.solid" },
  { value: "dotted", labelKey: "underline.dotted" },
  { value: "wavy", labelKey: "underline.wavy" },
];

export const COLOR_PRESETS: {
  value: TranslationColor;
  labelKey: MessageKey;
  swatch: string;
}[] = [
  { value: "inherit", labelKey: "color.inherit", swatch: "transparent" },
  { value: "yellow", labelKey: "color.yellow", swatch: "rgb(251, 188, 4)" },
  { value: "green", labelKey: "color.green", swatch: "rgb(19, 129, 37)" },
  { value: "teal", labelKey: "color.teal", swatch: "rgb(25, 174, 160)" },
  { value: "blue", labelKey: "color.blue", swatch: "rgb(26, 115, 232)" },
  { value: "indigo", labelKey: "color.indigo", swatch: "rgb(91, 96, 232)" },
  { value: "orange", labelKey: "color.orange", swatch: "rgb(245, 124, 0)" },
  { value: "purple", labelKey: "color.purple", swatch: "rgb(142, 68, 173)" },
  { value: "pink", labelKey: "color.pink", swatch: "rgb(236, 64, 122)" },
  { value: "red", labelKey: "color.red", swatch: "rgb(234, 51, 59)" },
  { value: "gray", labelKey: "color.gray", swatch: "rgb(147, 147, 147)" },
];

export function uiLangSelectOptions(): SelectOption<UiLang>[] {
  return UI_LANGS.map((value) => ({
    value,
    label: UI_LANG_LABELS[value],
  }));
}

export function targetLangSelectOptions(): SelectOption<TargetLang>[] {
  return UI_LANGS.map((value) => ({
    value,
    label: UI_LANG_LABELS[value],
  }));
}

export function granularitySelectOptions(
  t: TFn,
): SelectOption<HoverGranularity>[] {
  return GRANULARITIES.map((item) => ({
    value: item.value,
    label: t(item.labelKey),
  }));
}

export function modeSegmentOptions(t: TFn): SegmentOption<FullPageMode>[] {
  return MODES.map((item) => ({ value: item.value, label: t(item.labelKey) }));
}

export function fontSelectOptions(
  t: TFn,
): SelectOption<TranslationFontFamily>[] {
  return FONT_FAMILIES.map((item) => ({
    value: item.value,
    label: t(item.labelKey),
  }));
}

export function underlineSelectOptions(
  t: TFn,
): SelectOption<TranslationUnderlineStyle>[] {
  return UNDERLINE_STYLES.map((item) => ({
    value: item.value,
    label: t(item.labelKey),
  }));
}

export function appearanceOptions(t: TFn): IconSegmentOption<ThemePreference>[] {
  return [
    { value: "system", label: t("appearance.system"), icon: IconSystem },
    { value: "light", label: t("appearance.light"), icon: IconSun },
    { value: "dark", label: t("appearance.dark"), icon: IconMoon },
  ];
}
