// OneLingo UI 多语言字典。
//
// 设计：单文件维护两套字典（zh / en），key 用 namespace.key 组织。
// 文案少（~80 条），不拆文件，便于一眼对照中英两版。
// useT() 在 index.ts 里基于 useSettings().uiLang 动态选择。

import type { UiLang } from "@/lib/storage/settings";

export type MessageKey =
  | "settings.title"
  | "settings.scope"
  | "sidebar.account"
  | "sidebar.hover"
  | "sidebar.selection"
  | "sidebar.immersive"
  | "sidebar.about"
  | "section.profile"
  | "profile.avatar"
  | "profile.displayName"
  | "profile.placeholder"
  | "profile.notice"
  | "section.preferences"
  | "preferences.uiLang"
  | "preferences.appearance"
  | "appearance.system"
  | "appearance.light"
  | "appearance.dark"
  | "section.about"
  | "section.featureSwitch"
  | "about.tagline"
  | "about.version"
  | "about.versionLabel"
  | "section.targetLang"
  | "section.engine"
  | "section.granularity"
  | "section.fontSize"
  | "section.displayMode"
  | "section.clickToShowOriginal"
  | "section.translationStyle"
  | "common.followUiLang"
  | "common.chinese"
  | "common.english"
  | "common.on"
  | "common.off"
  | "desc.uiLang"
  | "desc.appearance"
  | "desc.hoverEnabled"
  | "desc.hoverTargetLang"
  | "desc.hoverEngine"
  | "desc.granularity"
  | "desc.fontSize"
  | "desc.selectionEnabled"
  | "desc.selectionTargetLang"
  | "desc.selectionEngine"
  | "desc.immersiveTargetLang"
  | "desc.immersiveEngine"
  | "desc.displayMode"
  | "desc.clickToShowOriginal"
  | "desc.underline"
  | "desc.font"
  | "desc.color"
  | "featureSwitch.hover.on.note"
  | "featureSwitch.hover.off.note"
  | "featureSwitch.selection.on.note"
  | "featureSwitch.selection.off.note"
  | "granularity.word"
  | "granularity.word.note"
  | "granularity.sentence"
  | "granularity.sentence.note"
  | "granularity.paragraph"
  | "granularity.paragraph.note"
  | "mode.replace"
  | "mode.replace.note"
  | "mode.bilingual"
  | "mode.bilingual.note"
  | "clickToShow.on.note"
  | "clickToShow.off.note"
  | "engine.note.google"
  | "engine.note.google2"
  | "engine.note.microsoft"
  | "font.inherit"
  | "font.inherit.note"
  | "font.serif"
  | "font.serif.note"
  | "font.sans"
  | "font.sans.note"
  | "font.mono"
  | "font.mono.note"
  | "color.inherit"
  | "color.muted"
  | "color.blue"
  | "color.green"
  | "color.red"
  | "color.custom"
  | "color.custom.aria"
  | "underline.none"
  | "underline.none.note"
  | "underline.solid"
  | "underline.solid.note"
  | "underline.dotted"
  | "underline.dotted.note"
  | "underline.wavy"
  | "underline.wavy.note"
  | "style.label.underline"
  | "style.label.font"
  | "style.label.color"
  | "style.preview"
  | "slider.fontSize.aria"
  | "slider.fontSize.valuetext"
  | "selection.note"
  | "popup.label.engine"
  | "popup.label.lang"
  | "popup.label.mode"
  | "popup.modeToggle"
  | "popup.state.translatedDetail"
  | "popup.state.untranslatedDetail"
  | "popup.state.untranslated"
  | "popup.state.translated"
  | "popup.button.start"
  | "popup.button.restore"
  | "popup.button.restoring"
  | "popup.button.openOptions"
  | "popup.shortcut"
  | "popup.section.page"
  | "popup.section.features"
  | "popup.row.hoverEnabled"
  | "popup.row.selectionEnabled"
  | "popup.openSettings"
  | "popup.status.startedBlocks"
  | "popup.status.noBlocks"
  | "popup.status.started"
  | "popup.status.retranslated"
  | "popup.status.modeSwitching"
  | "popup.status.modeSwitched"
  | "popup.status.modeIdleNote"
  | "popup.status.engineSwitchPending"
  | "popup.status.engineSwitched"
  | "popup.status.restoring"
  | "popup.status.restored"
  | "popup.status.error";

type Dict = Record<MessageKey, string>;

const ZH: Dict = {
  "settings.title": "设置",
  "settings.scope": "本地扩展页面",
  "sidebar.account": "账户",
  "sidebar.hover": "Hover",
  "sidebar.selection": "Selection",
  "sidebar.immersive": "Immersive",
  "sidebar.about": "关于",
  "section.profile": "档案",
  "profile.avatar": "头像",
  "profile.displayName": "显示名",
  "profile.placeholder": "本地用户",
  "profile.notice": "未启用：OneLingo 是本地扩展，无需账户",
  "section.preferences": "偏好",
  "preferences.uiLang": "界面语言",
  "preferences.appearance": "外观",
  "appearance.system": "跟随系统",
  "appearance.light": "亮色",
  "appearance.dark": "暗色",
  "section.about": "关于",
  "section.featureSwitch": "功能开关",
  "about.tagline": "OneLingo 浏览器翻译扩展",
  "about.version": "版本 {version}",
  "about.versionLabel": "版本",
  "section.targetLang": "目标语言",
  "section.engine": "翻译引擎",
  "section.granularity": "悬停粒度",
  "section.fontSize": "悬停译文字号",
  "section.displayMode": "显示模式",
  "section.clickToShowOriginal": "点击译文显示原文",
  "section.translationStyle": "译文样式",
  "common.followUiLang": "跟随界面",
  "common.chinese": "中文",
  "common.english": "English",
  "common.on": "开启",
  "common.off": "关闭",
  "desc.uiLang": "设置页、弹出面板以及默认目标语言的语言",
  "desc.appearance": "跟随系统或手动选择亮/暗主题",
  "desc.hoverEnabled": "鼠标悬停时高亮并翻译词/句/段",
  "desc.hoverTargetLang": "悬停翻译的目标语言，跳过已是该语言的文本",
  "desc.hoverEngine": "悬停翻译使用的服务提供商",
  "desc.granularity": "鼠标位置取词、取句还是取整段",
  "desc.fontSize": "悬停译文气泡的文字大小",
  "desc.selectionEnabled": "划词后在选区旁边弹出译文气泡",
  "desc.selectionTargetLang": "划词翻译的目标语言，跳过已是该语言的选区",
  "desc.selectionEngine": "划词翻译使用的服务提供商",
  "desc.immersiveTargetLang": "全文翻译的目标语言",
  "desc.immersiveEngine": "全文翻译使用的服务提供商",
  "desc.displayMode": "译文是替换原文还是双语並列",
  "desc.clickToShowOriginal": "译文点击后临时显示原文",
  "desc.underline": "译文下方的装饰线",
  "desc.font": "译文的字体",
  "desc.color": "译文的颜色",
  "featureSwitch.hover.on.note": "鼠标悬停时自动翻译",
  "featureSwitch.hover.off.note": "停止悬停高亮和翻译请求",
  "featureSwitch.selection.on.note": "划词后显示翻译气泡",
  "featureSwitch.selection.off.note": "停止划词气泡和翻译请求",
  "granularity.word": "词",
  "granularity.word.note": "命中单词后翻译单词",
  "granularity.sentence": "句子",
  "granularity.sentence.note": "命中单词后翻译所在句子",
  "granularity.paragraph": "段落",
  "granularity.paragraph.note": "命中单词后翻译最近段落",
  "mode.replace": "译文",
  "mode.replace.note": "默认替换原文",
  "mode.bilingual": "双语",
  "mode.bilingual.note": "默认显示原文和译文",
  "clickToShow.on.note": "点击译文临时查看原文",
  "clickToShow.off.note": "点击译文不切换原文",
  "engine.note.google": "Google 网页翻译",
  "engine.note.google2": "translate_a/t HTML",
  "engine.note.microsoft": "Edge Translator API",
  "font.inherit": "默认",
  "font.inherit.note": "沿用网页或模式样式",
  "font.serif": "衬线",
  "font.serif.note": "Georgia / Times",
  "font.sans": "无衬线",
  "font.sans.note": "Segoe UI / system-ui",
  "font.mono": "等宽",
  "font.mono.note": "Consolas / monospace",
  "color.inherit": "默认",
  "color.muted": "灰色",
  "color.blue": "蓝色",
  "color.green": "绿色",
  "color.red": "红色",
  "color.custom": "自定义",
  "color.custom.aria": "自定义译文颜色",
  "underline.none": "无样式",
  "underline.none.note": "默认不添加下划线",
  "underline.solid": "实线",
  "underline.solid.note": "普通下划线",
  "underline.dotted": "点线",
  "underline.dotted.note": "点状下划线",
  "underline.wavy": "波浪线",
  "underline.wavy.note": "波浪下划线",
  "style.label.underline": "下划线",
  "style.label.font": "字体",
  "style.label.color": "颜色",
  "style.preview": "译文预览 Translation preview",
  "slider.fontSize.aria": "悬停译文字号",
  "slider.fontSize.valuetext": "{n} 像素",
  "selection.note": "划词后弹出气泡卡片显示译文",
  "popup.label.engine": "网页引擎",
  "popup.label.lang": "目标语言",
  "popup.label.mode": "显示模式",
  "popup.modeToggle": "{label}，点击切换",
  "popup.state.translatedDetail":
    "当前网页：已翻译（{engine} / {target} / {mode}）",
  "popup.state.untranslatedDetail":
    "当前网页：未翻译（待用 {engine} / {target} / {mode}）",
  "popup.state.untranslated": "当前网页未翻译",
  "popup.state.translated": "当前网页已翻译",
  "popup.button.start": "翻译此页面",
  "popup.button.restore": "显示原文",
  "popup.button.restoring": "显示原文中…",
  "popup.button.openOptions": "打开设置",
  "popup.shortcut": "Alt+Z",
  "popup.section.page": "当前页面",
  "popup.section.features": "其他功能",
  "popup.row.hoverEnabled": "悬停翻译",
  "popup.row.selectionEnabled": "划词翻译",
  "popup.openSettings": "设置",
  "popup.status.startedBlocks": "已开始沉浸翻译，共 {n} 个段落",
  "popup.status.noBlocks": "当前网页没有可翻译的段落",
  "popup.status.started": "已开始沉浸翻译",
  "popup.status.retranslated": "当前网页已重新翻译",
  "popup.status.modeSwitching": "正在切换显示模式…",
  "popup.status.modeSwitched": "已切换显示模式",
  "popup.status.modeIdleNote": "显示模式：{mode}，开始沉浸翻译后生效",
  "popup.status.engineSwitchPending": "正在切换到 {engine} 并重新翻译当前网页…",
  "popup.status.engineSwitched": "当前网页引擎：{engine}",
  "popup.status.restoring": "正在显示原文…",
  "popup.status.restored": "已显示原文",
  "popup.status.error": "错误：{msg}",
};

const EN: Dict = {
  "settings.title": "Settings",
  "settings.scope": "Local extension page",
  "sidebar.account": "Account",
  "sidebar.hover": "Hover",
  "sidebar.selection": "Selection",
  "sidebar.immersive": "Immersive",
  "sidebar.about": "About",
  "section.profile": "Profile",
  "profile.avatar": "Avatar",
  "profile.displayName": "Display name",
  "profile.placeholder": "Local user",
  "profile.notice":
    "Not active: OneLingo is a local extension and does not need an account",
  "section.preferences": "Preferences",
  "preferences.uiLang": "Interface language",
  "preferences.appearance": "Appearance",
  "appearance.system": "System",
  "appearance.light": "Light",
  "appearance.dark": "Dark",
  "section.about": "About",
  "section.featureSwitch": "Feature switch",
  "about.tagline": "OneLingo browser translation extension",
  "about.version": "Version {version}",
  "about.versionLabel": "Version",
  "section.targetLang": "Target language",
  "section.engine": "Translation engine",
  "section.granularity": "Hover granularity",
  "section.fontSize": "Tooltip font size",
  "section.displayMode": "Display mode",
  "section.clickToShowOriginal": "Click translation to show original",
  "section.translationStyle": "Translation style",
  "common.followUiLang": "Follow UI",
  "common.chinese": "Chinese",
  "common.english": "English",
  "common.on": "On",
  "common.off": "Off",
  "desc.uiLang": "Language for the settings page, popups, and default target language",
  "desc.appearance": "Follow the system or pick a light / dark theme",
  "desc.hoverEnabled": "Highlight and translate the word, sentence, or paragraph under the cursor",
  "desc.hoverTargetLang": "Target language for hover translation; text already in this language is skipped",
  "desc.hoverEngine": "Provider used for hover translation",
  "desc.granularity": "Whether the cursor picks a word, sentence, or paragraph",
  "desc.fontSize": "Font size of the hover translation tooltip",
  "desc.selectionEnabled": "Show a translation bubble next to the selection after selecting text",
  "desc.selectionTargetLang": "Target language for selection translation; selections already in this language are skipped",
  "desc.selectionEngine": "Provider used for selection translation",
  "desc.immersiveTargetLang": "Target language for full-page translation",
  "desc.immersiveEngine": "Provider used for full-page translation",
  "desc.displayMode": "Whether translation replaces the original or shows alongside it",
  "desc.clickToShowOriginal": "Click a translation to temporarily reveal the original text",
  "desc.underline": "Decoration drawn under translated text",
  "desc.font": "Font family of translated text",
  "desc.color": "Color of translated text",
  "featureSwitch.hover.on.note": "Translate automatically on hover",
  "featureSwitch.hover.off.note": "Stop hover highlights and translation requests",
  "featureSwitch.selection.on.note": "Show a translation bubble after selecting text",
  "featureSwitch.selection.off.note":
    "Stop selection bubbles and translation requests",
  "granularity.word": "Word",
  "granularity.word.note": "Translate the word under cursor",
  "granularity.sentence": "Sentence",
  "granularity.sentence.note": "Translate the sentence containing the word",
  "granularity.paragraph": "Paragraph",
  "granularity.paragraph.note": "Translate the nearest paragraph",
  "mode.replace": "Translation",
  "mode.replace.note": "Default replaces original",
  "mode.bilingual": "Bilingual",
  "mode.bilingual.note": "Show both original and translation",
  "clickToShow.on.note": "Click translation to peek the original",
  "clickToShow.off.note": "Clicking does not toggle original",
  "engine.note.google": "Google web translation",
  "engine.note.google2": "translate_a/t HTML",
  "engine.note.microsoft": "Edge Translator API",
  "font.inherit": "Default",
  "font.inherit.note": "Use page or mode style",
  "font.serif": "Serif",
  "font.serif.note": "Georgia / Times",
  "font.sans": "Sans-serif",
  "font.sans.note": "Segoe UI / system-ui",
  "font.mono": "Mono",
  "font.mono.note": "Consolas / monospace",
  "color.inherit": "Default",
  "color.muted": "Muted",
  "color.blue": "Blue",
  "color.green": "Green",
  "color.red": "Red",
  "color.custom": "Custom",
  "color.custom.aria": "Custom translation color",
  "underline.none": "None",
  "underline.none.note": "No underline",
  "underline.solid": "Solid",
  "underline.solid.note": "Plain underline",
  "underline.dotted": "Dotted",
  "underline.dotted.note": "Dotted underline",
  "underline.wavy": "Wavy",
  "underline.wavy.note": "Wavy underline",
  "style.label.underline": "Underline",
  "style.label.font": "Font",
  "style.label.color": "Color",
  "style.preview": "Translation preview 译文预览",
  "slider.fontSize.aria": "Tooltip font size",
  "slider.fontSize.valuetext": "{n} pixels",
  "selection.note": "Show translation card after selecting text",
  "popup.label.engine": "Page engine",
  "popup.label.lang": "Target language",
  "popup.label.mode": "Display mode",
  "popup.modeToggle": "{label}, click to toggle",
  "popup.state.translatedDetail":
    "Page: translated ({engine} / {target} / {mode})",
  "popup.state.untranslatedDetail":
    "Page: not translated (will use {engine} / {target} / {mode})",
  "popup.state.untranslated": "Page is not translated",
  "popup.state.translated": "Page is translated",
  "popup.button.start": "Translate this page",
  "popup.button.restore": "Show original",
  "popup.button.restoring": "Restoring…",
  "popup.button.openOptions": "Open settings",
  "popup.shortcut": "Alt+Z",
  "popup.section.page": "Current page",
  "popup.section.features": "Other features",
  "popup.row.hoverEnabled": "Hover translation",
  "popup.row.selectionEnabled": "Selection translation",
  "popup.openSettings": "Settings",
  "popup.status.startedBlocks": "Translation started, {n} blocks",
  "popup.status.noBlocks": "No translatable blocks on this page",
  "popup.status.started": "Translation started",
  "popup.status.retranslated": "Page retranslated",
  "popup.status.modeSwitching": "Switching display mode…",
  "popup.status.modeSwitched": "Display mode switched",
  "popup.status.modeIdleNote":
    "Display mode: {mode}, will apply after translation starts",
  "popup.status.engineSwitchPending":
    "Switching to {engine} and retranslating…",
  "popup.status.engineSwitched": "Current engine: {engine}",
  "popup.status.restoring": "Restoring original…",
  "popup.status.restored": "Original shown",
  "popup.status.error": "Error: {msg}",
};

export const MESSAGES: Record<UiLang, Dict> = { zh: ZH, en: EN };

/** 简易模板替换，{name} → params[name]。未匹配的占位符保留原样以便发现 bug。 */
export function format(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (raw, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : raw,
  );
}
