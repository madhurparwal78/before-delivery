export {};

declare global {
  interface Window {
    __deskCurrentSlug: string | null;
    __deskCurrentLang: string | null;
  }
}
