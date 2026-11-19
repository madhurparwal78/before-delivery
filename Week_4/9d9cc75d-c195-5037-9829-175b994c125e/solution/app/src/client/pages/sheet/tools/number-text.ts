/** The number a spinbutton holds, or its raw text when it is not one, so the server answers with its own message. */
export function numberOrText(text: string): number | string {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) ? value : text;
}
