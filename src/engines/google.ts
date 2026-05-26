import type { Engine, TranslateRequest, TranslateResponse } from "./types";
import { googleLanguageTag } from "./language-tags";

// 免费未公开接口。返回形如：
// [[["你好","hello",null,null,10]], null, "en", ...]
// 句子被拆成多段，每段的 [0] 是译文。
const ENDPOINT = "https://translate.googleapis.com/translate_a/single";

export const google: Engine = {
  id: "google",

  async translate(req: TranslateRequest): Promise<TranslateResponse> {
    const url =
      `${ENDPOINT}?client=gtx&dt=t` +
      `&sl=${encodeURIComponent(req.source ? googleLanguageTag(req.source) : "auto")}` +
      `&tl=${encodeURIComponent(googleLanguageTag(req.target))}` +
      `&q=${encodeURIComponent(req.text)}`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`google http ${resp.status}`);
    const data: unknown = await resp.json();

    const segments = (data as [unknown[], ...unknown[]])[0];
    if (!Array.isArray(segments)) throw new Error("google: bad shape");

    const text = segments
      .map((seg) => (Array.isArray(seg) ? String(seg[0] ?? "") : ""))
      .join("");
    const detectedSource = (data as unknown[])[2];

    return {
      text,
      detectedSource:
        typeof detectedSource === "string" ? detectedSource : undefined,
      engine: "google",
    };
  },
};
