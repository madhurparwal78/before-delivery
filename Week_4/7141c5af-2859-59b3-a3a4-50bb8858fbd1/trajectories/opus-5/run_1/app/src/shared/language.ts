export type Language = 'en' | 'it' | 'ja' | 'ar';

export const LANGUAGES: readonly Language[] = ['en', 'it', 'ja', 'ar'];

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

export function directionOf(language: Language): 'ltr' | 'rtl' {
  return language === 'ar' ? 'rtl' : 'ltr';
}
