// Options 页主题应用。
//
// 把 settings.theme（system/light/dark）与系统 prefers-color-scheme 合成
// effective theme，写到 <html data-theme="light|dark"> 上。CSS 用属性选择器
// 切两套 token，避免依赖 prefers-color-scheme 直接生效（用户选 light 时
// 系统是 dark 也得保持 light）。
//
// 设计上做成命令式订阅，不依赖 Solid scope，在 main.tsx render 之前就跑。

import {
  getSettings,
  watchSettings,
  type ThemePreference,
} from "@/lib/storage/settings";

type EffectiveTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

let currentPreference: ThemePreference = "system";

export function initTheme(): void {
  applyEffective(resolveEffective(currentPreference));

  const mq = window.matchMedia(DARK_QUERY);
  const onSystemChange = (): void => {
    if (currentPreference === "system") {
      applyEffective(resolveEffective(currentPreference));
    }
  };
  // addEventListener 在所有现代浏览器都可用，老 API addListener 已弃用
  mq.addEventListener("change", onSystemChange);

  void getSettings().then((s) => {
    currentPreference = s.theme;
    applyEffective(resolveEffective(currentPreference));
  });
  watchSettings((s) => {
    currentPreference = s.theme;
    applyEffective(resolveEffective(currentPreference));
  });
}

function resolveEffective(pref: ThemePreference): EffectiveTheme {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function applyEffective(theme: EffectiveTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
}
