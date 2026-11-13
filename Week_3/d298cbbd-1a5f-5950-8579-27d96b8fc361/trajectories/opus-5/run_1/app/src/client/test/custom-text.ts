const REMEMBERED_KEY = 'strikeproof.customText';

/** The one custom text rule: runs of whitespace collapse to one space, and the text is trimmed. */
export function collapseCustom(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function customCharacters(text: string): number {
  return [...text].length;
}

export function customWords(text: string): string[] {
  return text === '' ? [] : text.split(' ');
}

export function rememberedCustomText(): string {
  try {
    return window.localStorage.getItem(REMEMBERED_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberCustomText(text: string): void {
  try {
    window.localStorage.setItem(REMEMBERED_KEY, text);
  } catch {
    /* storage is unavailable; the dialog still works for this visit */
  }
}
