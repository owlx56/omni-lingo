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
