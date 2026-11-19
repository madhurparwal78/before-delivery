export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function attr(s: string | number | null | undefined): string {
  return escapeHtml(s === null || s === undefined ? "" : String(s));
}

export const PALETTE = {
  plum: "#2e0f3f",
  plumDeep: "#3d1252",
  cyan: "#b7f7fd",
  cyanBright: "#49e0f2",
  white: "#ffffff",
  ink: "#1a1a1a",
  grey: "#9c9c9c",
};

export function cssVariables(): string {
  return `:root{--plum:#2e0f3f;--plum-deep:#3d1252;--cyan:#b7f7fd;--cyan-bright:#49e0f2;--white:#fff;--ink:#1a1a1a;--grey:#9c9c9c;--dur-1:160ms;--dur-2:320ms;--dur-3:640ms}`;
}

export const APP_CSS = "/assets/app.css";
export const APP_JS = "/assets/client.js";
