/** Controls the page moves focus to by name, found by a data attribute so the lookup works after any re-render. */
export const JOIN_CODE_KEY = "join-code";
export const ASSISTANT_EMAIL_KEY = "assistant-email";
export const watchKey = (studentId: string) => `watch:${studentId}`;
export const renameKey = (studentId: string) => `rename:${studentId}`;
export const removeKey = (studentId: string) => `remove:${studentId}`;

export function controlProps(key: string): { "data-control": string } {
  return { "data-control": key };
}

export function findControl(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-control="${CSS.escape(key)}"]`);
}
