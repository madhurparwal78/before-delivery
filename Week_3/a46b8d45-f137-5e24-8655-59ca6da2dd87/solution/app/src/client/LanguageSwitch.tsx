import { ownerText } from "../shared/copy";
import type { Lang } from "../shared/types";
import { setLanguage, useLanguage } from "./language";

export function LanguageSwitch() {
  const lang = useLanguage();
  const choices: [Lang, "english" | "polish"][] = [["en-GB", "english"], ["pl-PL", "polish"]];
  return (
    <div class="lang-switch" role="radiogroup" aria-label={ownerText("languageGroup", lang)}>
      {choices.map(([value, key]) => (
        <label key={value}>
          <input type="radio" name="language" value={value} checked={lang === value} onChange={() => setLanguage(value)} />
          {ownerText(key, lang)}
        </label>
      ))}
    </div>
  );
}
