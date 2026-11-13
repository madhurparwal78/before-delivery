const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' })

export function characterCount(text: string): number {
  let count = 0
  for (const _ of graphemes.segment(text)) count += 1
  return count
}

export function hasControlCharacter(text: string): boolean {
  return /\p{Cc}/u.test(text)
}

/** The file-name slug of a title: lower case, runs of other characters become one hyphen, trimmed hyphens. */
export const slug = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
