import {
  getSettings,
  watchSettings,
  type ThemePreference,
} from "@/lib/storage/settings";

export type EffectiveTheme = "light" | "dark";
type ThemeListener = (theme: EffectiveTheme) => void;

const DARK_QUERY = "(prefers-color-scheme: dark)";

let currentPreference: ThemePreference = "system";
let currentEffective: EffectiveTheme | null = null;
const listeners = new Set<ThemeListener>();

export function initTheme(): void {
  applyEffective(resolveEffective(currentPreference));

  const mq = window.matchMedia(DARK_QUERY);
  const onSystemChange = (): void => {
    if (currentPreference === "system") {
      applyEffective(resolveEffective(currentPreference));
    }
  };
  mq.addEventListener("change", onSystemChange);

  void getSettings()
    .then((s) => {
      currentPreference = s.theme;
      applyEffective(resolveEffective(currentPreference));
    })
    .catch((err: unknown) => {
      console.warn("[Omni Lingo] failed to read theme settings:", err);
    });
  try {
    watchSettings((s) => {
      currentPreference = s.theme;
      applyEffective(resolveEffective(currentPreference));
    });
  } catch (err) {
    console.warn("[Omni Lingo] failed to watch theme settings:", err);
  }
}

function resolveEffective(pref: ThemePreference): EffectiveTheme {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function applyEffective(theme: EffectiveTheme): void {
  currentEffective = theme;
  applyThemeToDocument(document, theme);
  for (const listener of listeners) listener(theme);
}

export function getEffectiveTheme(): EffectiveTheme {
  return currentEffective ?? resolveEffective(currentPreference);
}

export function watchEffectiveTheme(listener: ThemeListener): () => void {
  listeners.add(listener);
  listener(getEffectiveTheme());
  return () => {
    listeners.delete(listener);
  };
}

export function applyThemeToDocument(
  targetDocument: Document,
  theme: EffectiveTheme,
): void {
  targetDocument.documentElement.setAttribute("data-theme", theme);
  targetDocument.documentElement.style.colorScheme = theme;
  if (targetDocument.body) targetDocument.body.style.colorScheme = theme;
}
