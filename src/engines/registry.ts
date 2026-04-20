import type { Engine } from "./types";
import { google } from "./google";
import { microsoft } from "./microsoft";

const ENGINES: Record<string, Engine> = {
  [google.id]: google,
  [microsoft.id]: microsoft,
};

export function getEngine(id: string): Engine {
  const e = ENGINES[id];
  if (!e) throw new Error(`unknown engine: ${id}`);
  return e;
}

export const DEFAULT_ENGINE_ID = google.id;
