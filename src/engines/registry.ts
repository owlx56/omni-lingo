import type { Engine } from "./types";
import { google } from "./google";
import { google2 } from "./google2";
import { microsoft } from "./microsoft";

const ENGINES: Record<string, Engine> = {
  [google.id]: google,
  [google2.id]: google2,
  [microsoft.id]: microsoft,
};

export function getEngine(id: string): Engine {
  const e = ENGINES[id];
  if (!e) throw new Error(`unknown engine: ${id}`);
  return e;
}

export const DEFAULT_ENGINE_ID = google.id;
