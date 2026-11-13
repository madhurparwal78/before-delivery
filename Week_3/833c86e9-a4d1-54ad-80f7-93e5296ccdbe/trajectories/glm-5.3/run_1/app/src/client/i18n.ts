import { MESSAGES, type Lang, type MsgKey, LOCALES, CURRENCY_WORDS, HOME_LAYERS, counted, type CountNoun } from "../domain/messages.js";
import { makeFormatters, type Formatters } from "../domain/format.js";
import { DECIMALS, type CurrencyCode } from "../domain/money.js";

/** Client state shared by every page. */
export type State = {
  lang: Lang;
  cur: CurrencyCode;
  user: { username: string; role: "guest" | "manager" | "operator"; manages: string[] } | null;
  tier: string;
  completedStays: number;
  perks: string[];
  serverNow: number;
  serverNowAt: number;
};

export const state: State = {
  lang: "en",
  cur: "EUR",
  user: null,
  tier: "Wren",
  completedStays: 0,
  perks: [],
  serverNow: Date.now(),
  serverNowAt: Date.now()
};

export function serverNow(): Date {
  return new Date(state.serverNow + (Date.now() - state.serverNowAt));
}

export function fmt(): Formatters {
  return makeFormatters(state.lang);
}

/** Render a published message with its placeholders. */
export function t(key: MsgKey, params: Record<string, unknown> = {}): string {
  const f = fmt();
  let s = MESSAGES[state.lang][key];
  const rep = (ph: string, v: string) => { s = s.split("{" + ph + "}").join(v); };
  if (typeof params.count_noun === "string") rep("count:" + params.count_noun, counted(state.lang, params.count_noun as CountNoun, Number(params.n ?? 0)));
  for (const [k, v] of Object.entries(params)) {
    if (k === "count_noun" || k === "n" && params.count_noun) continue;
    if (k === "fmt") continue;
    if (v === undefined || v === null) continue;
    if (k === "amount" || k === "old" || k === "new") {
      if (typeof v === "number" && params.currency) rep(k, f.amount(v, params.currency as CurrencyCode));
      else if (typeof v === "string") rep(k, v);
      continue;
    }
    rep(k, String(v));
  }
  if (params.currency) rep("currency words", CURRENCY_WORDS[state.lang][String(params.currency)]);
  return s;
}

/** A money span with its data attributes. */
export function moneyEl(minor: number, cur: CurrencyCode): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "money";
  el.dataset.minor = String(minor);
  el.dataset.currency = cur;
  el.textContent = fmt().amount(minor, cur);
  return el;
}

export function moneyText(minor: number, cur: CurrencyCode): string {
  return fmt().amount(minor, cur);
}

export { LOCALES, HOME_LAYERS, DECIMALS };
export type { Lang, MsgKey, CurrencyCode };
