import type { UiLang } from "@/lib/languages";
import { type Dict, type PartialDict } from "../messages";

import en from "./en";
import zh from "./zh";
import zhHant from "./zh-Hant";
import ja from "./ja";
import ko from "./ko";
import ar from "./ar";
import tr from "./tr";
import ru from "./ru";
import vi from "./vi";
import th from "./th";
import de from "./de";
import es from "./es";
import fr from "./fr";
import ptBR from "./pt-BR";
import hi from "./hi";
import it from "./it";
import id from "./id";
import fa from "./fa";

export const MESSAGES: Record<UiLang, Dict | PartialDict> = {
  en,
  zh,
  "zh-Hant": zhHant,
  ja,
  ko,
  ar,
  tr,
  ru,
  vi,
  th,
  de,
  es,
  fr,
  "pt-BR": ptBR,
  hi,
  it,
  id,
  fa,
};
