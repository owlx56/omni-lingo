import type { Engine, TranslateRequest, TranslateResponse } from "./types";
import { googleLanguageTag } from "./language-tags";

const ENDPOINT = "https://translate.googleapis.com/translate_a/t";

export const google2: Engine = {
  id: "google2",

  async translate(req: TranslateRequest): Promise<TranslateResponse> {
    const [res] = await translateGoogle2Batch([req]);
    if (!res) throw new Error("google2: empty translation");
    return res;
  },

  async translateBatch(reqs: TranslateRequest[]): Promise<TranslateResponse[]> {
    return translateGoogle2Batch(reqs);
  },
};

async function translateGoogle2Batch(
  reqs: TranslateRequest[],
): Promise<TranslateResponse[]> {
  if (reqs.length === 0) return [];
  const first = reqs[0]!;
  const params = new URLSearchParams({
    client: "gtx",
    dt: "t",
    sl: first.source ? googleLanguageTag(first.source) : "auto",
    tl: googleLanguageTag(first.target),
    format: first.format ?? "text",
  });
  const body = new URLSearchParams();
  reqs.forEach((req) => body.append("q", req.text));

  const resp = await fetch(`${ENDPOINT}?${params.toString()}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) throw new Error(`google2 http ${resp.status}`);

  const data: unknown = await resp.json();
  const texts = parseGoogle2Texts(data);
  if (texts.length === 0) throw new Error("google2: empty translation");

  return reqs.map((req, index) => ({
    text: texts[index] ?? "",
    detectedSource: req.source,
    engine: "google2",
  }));
}

function parseGoogle2Texts(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    if (typeof item === "string") return item;
    if (Array.isArray(item)) return String(item[0] ?? "");
    return "";
  });
}
