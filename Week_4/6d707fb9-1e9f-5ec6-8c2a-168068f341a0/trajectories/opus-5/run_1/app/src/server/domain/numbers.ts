import { Decimal } from './decimal';

export type Language = 'en' | 'fr' | 'tr' | 'ar';

const LANGUAGES: Language[] = ['en', 'fr', 'tr', 'ar'];

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as string[]).includes(value);
}

const ARABIC_DIGITS = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';

const FORMS: Record<Language, RegExp[]> = {
  // digits, optional `,` every three digits, `.` for decimals
  en: [/^(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/],
  // digits, an optional plain, no-break or narrow no-break space every three digits, `,` for decimals
  fr: [/^(\d+|\d{1,3}([ \u00a0\u202f]\d{3})+)(,\d+)?$/],
  // digits, optional `.` every three digits, `,` for decimals
  tr: [/^(\d+|\d{1,3}(\.\d{3})+)(,\d+)?$/],
  // Arabic-Indic digits with `٬` grouping and `٫` decimals, or plain digits with `.` and no grouping
  ar: [
    new RegExp(
      `^([${ARABIC_DIGITS}]+|[${ARABIC_DIGITS}]{1,3}(\u066c[${ARABIC_DIGITS}]{3})+)(\u066b[${ARABIC_DIGITS}]+)?$`,
    ),
    /^\d+(\.\d+)?$/,
  ],
};

function toPlainDigits(text: string): string {
  return [...text]
    .map((c) => {
      const arabic = ARABIC_DIGITS.indexOf(c);
      return arabic === -1 ? c : String(arabic);
    })
    .join('');
}

/**
 * A number typed the local way, as the exact value it means, or null when the
 * language's form refuses it.
 */
export function readLocalNumber(text: string, language: Language): Decimal | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const forms = FORMS[language];
  if (!forms.some((form) => form.test(trimmed))) return null;
  let plain = toPlainDigits(trimmed);
  if (language === 'en') plain = plain.replace(/,/g, '');
  if (language === 'fr') plain = plain.replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
  if (language === 'tr') plain = plain.replace(/\./g, '').replace(',', '.');
  if (language === 'ar') plain = plain.replace(/\u066c/g, '').replace('\u066b', '.');
  const value = new Decimal(plain);
  return value.isFinite() ? value : null;
}

const MJ_PER_UNIT: Record<string, string> = {
  kWh: '3.6',
  MJ: '1',
  m3: '37.8',
};

export type EnergyUnit = 'kWh' | 'MJ' | 'm3';

export function isEnergyUnit(value: unknown): value is EnergyUnit {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MJ_PER_UNIT, value);
}

/** A supplier's energy answer kept in exact megajoules. */
export function toMegajoules(value: Decimal, unit: EnergyUnit): Decimal {
  return value.times(new Decimal(MJ_PER_UNIT[unit] as string));
}
