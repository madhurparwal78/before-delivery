/**
 * The one mention-token rule. A token is an `@` that is not preceded by a
 * letter or digit, then the longest run of letters, digits, dots, dashes and
 * underscores, with trailing dots and dashes dropped.
 */
export function mentionHandles(text: string): string[] {
  const handles: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '@') continue;
    const previous = text[index - 1];
    if (previous !== undefined && /[A-Za-z0-9]/.test(previous)) continue;
    let end = index + 1;
    while (end < text.length && /[A-Za-z0-9._-]/.test(text[end] as string)) end += 1;
    let run = text.slice(index + 1, end);
    run = run.replace(/[.-]+$/, '');
    if (run.length === 0) continue;
    const lowered = run.toLowerCase();
    if (!handles.includes(lowered)) handles.push(lowered);
  }
  return handles;
}
