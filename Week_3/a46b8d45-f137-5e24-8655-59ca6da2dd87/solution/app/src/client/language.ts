import { ownerText, type OwnerTextKey } from "../shared/copy";
import type { Lang } from "../shared/types";
import { createStore, useStore } from "./store";

function stored(): Lang {
  const match = /(?:^|;\s*)lang=(en-GB|pl-PL)/.exec(document.cookie);
  return match?.[1] === "pl-PL" ? "pl-PL" : "en-GB";
}

const language = createStore<Lang>(stored());
document.documentElement.lang = language.get();

export function setLanguage(next: Lang): void {
  document.cookie = `lang=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  document.documentElement.lang = next;
  language.set(next);
}

/** The owner's chosen language; operator screens ignore it and stay English. */
export const useLanguage = (): Lang => useStore(language);

export const useOwnerText = (): { lang: Lang; t: (key: OwnerTextKey) => string } => {
  const lang = useLanguage();
  return { lang, t: (key) => ownerText(key, lang) };
};

export function setOperatorLanguage(): void {
  document.documentElement.lang = "en-GB";
}
