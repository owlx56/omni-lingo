import type { Engine, TranslateRequest, TranslateResponse } from "./types";

const AUTH_URL = "https://edge.microsoft.com/translate/auth";
const ENDPOINT = "https://api-edge.cognitive.microsofttranslator.com/translate";

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export const microsoft: Engine = {
  id: "microsoft",

  async translate(req: TranslateRequest): Promise<TranslateResponse> {
    let token = await getAuthToken(false);
    let data = await callTranslate(req, token);

    if (!data && !tokenCache) {
      token = await getAuthToken(true);
      data = await callTranslate(req, token);
    }
    if (!data) throw new Error("microsoft: empty response");

    const first = Array.isArray(data) ? data[0] : null;
    if (!first || typeof first !== "object") throw new Error("microsoft: bad shape");

    const translations = (first as { translations?: unknown }).translations;
    const translated = Array.isArray(translations) ? translations[0] : null;
    const text = translated && typeof translated === "object"
      ? String((translated as { text?: unknown }).text ?? "")
      : "";
    if (!text) throw new Error("microsoft: empty translation");

    const detectedLang =
      typeof (first as { detectedLanguage?: { language?: unknown } }).detectedLanguage?.language ===
      "string"
        ? (first as { detectedLanguage: { language: string } }).detectedLanguage.language
        : undefined;

    return {
      text,
      detectedSource: detectedLang,
      engine: "microsoft",
    };
  },
};

async function callTranslate(req: TranslateRequest, token: string): Promise<unknown | null> {
  const from = req.source ? `from=${encodeURIComponent(req.source)}&` : "";
  const url =
    `${ENDPOINT}?${from}` +
    `to=${encodeURIComponent(req.target)}` +
    "&api-version=3.0&includeSentenceLength=true&textType=plain";

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify([{ Text: req.text }]),
  });
  if (resp.status === 401) {
    tokenCache = null;
    return null;
  }
  if (!resp.ok) throw new Error(`microsoft http ${resp.status}`);
  return resp.json();
}

async function getAuthToken(force: boolean): Promise<string> {
  const now = Date.now();
  if (!force && tokenCache && now < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const resp = await fetch(AUTH_URL);
  if (!resp.ok) throw new Error(`microsoft auth http ${resp.status}`);
  const token = (await resp.text()).trim();
  if (!token) throw new Error("microsoft auth empty");

  const expiresAt = parseJwtExpiryMs(token) ?? now + 8 * 60 * 1000;
  tokenCache = { token, expiresAt };
  return token;
}

function parseJwtExpiryMs(token: string): number | null {
  const parts = token.split(".");
  const payload = parts[1];
  if (!payload) return null;

  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
    const json = atob(base64 + pad);
    const obj = JSON.parse(json) as { exp?: unknown };
    if (typeof obj.exp !== "number") return null;
    return obj.exp * 1000 - 30_000;
  } catch {
    return null;
  }
}
