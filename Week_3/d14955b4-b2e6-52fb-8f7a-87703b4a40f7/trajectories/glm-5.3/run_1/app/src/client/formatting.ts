// The one display-formatting allowlist. Everything renders through here.

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'emphasis'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

function allowedHref(target: string): string | null {
  const trimmed = target.replace(/^[\s\u0000-\u001F]+/, '');
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith('http:') || lowered.startsWith('https:') || lowered.startsWith('mailto:')) return trimmed;
  return null;
}

function bareAddressEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length) {
    const code = text.charCodeAt(end);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 60 || code === 62 || code === 34 || code === 39 || code === 41 || code === 93) break;
    end += 1;
  }
  while (end > start) {
    const tail = text[end - 1];
    if (tail === '.' || tail === ',' || tail === ';' || tail === ':' || tail === '!' || tail === '?') end -= 1;
    else break;
  }
  return end;
}

export function parseDisplay(text: string): Segment[] {
  const segments: Segment[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer !== '') {
      segments.push({ kind: 'text', text: buffer });
      buffer = '';
    }
  };
  let i = 0;
  while (i < text.length) {
    const character = text[i];
    if ((character === '*' || character === '_') && (text[i + 1] ?? '') !== character) {
      const closing = text.indexOf(character, i + 1);
      if (closing !== -1 && closing > i + 1) {
        flush();
        segments.push({ kind: 'emphasis', text: text.slice(i + 1, closing) });
        i = closing + 1;
        continue;
      }
    }
    if (character === '`') {
      const closing = text.indexOf('`', i + 1);
      if (closing !== -1) {
        flush();
        segments.push({ kind: 'code', text: text.slice(i + 1, closing) });
        i = closing + 1;
        continue;
      }
    }
    if (character === '[') {
      const close = text.indexOf(']', i + 1);
      if (close !== -1 && text[close + 1] === '(') {
        let depth = 0;
        let end = close + 1;
        for (let j = close + 1; j < text.length; j += 1) {
          if (text[j] === '(') depth += 1;
          else if (text[j] === ')') {
            depth -= 1;
            if (depth === 0) {
              end = j;
              break;
            }
          }
        }
        if (end > close + 1) {
          const target = text.slice(close + 2, end);
          const href = allowedHref(target);
          flush();
          if (href) {
            segments.push({ kind: 'link', text: text.slice(i + 1, close), href });
          } else {
            segments.push({ kind: 'text', text: text.slice(i + 1, close) });
          }
          i = end + 1;
          continue;
        }
      }
    }
    const lowered = text.slice(i).toLowerCase();
    if (lowered.startsWith('http://') || lowered.startsWith('https://')) {
      const end = bareAddressEnd(text, i);
      if (end > i) {
        flush();
        segments.push({ kind: 'link', text: text.slice(i, end), href: text.slice(i, end) });
        i = end;
        continue;
      }
    }
    buffer += character;
    i += 1;
  }
  flush();
  return segments;
}

export function renderFormatted(text: string): HTMLElement {
  const container = document.createElement('span');
  for (const segment of parseDisplay(text)) {
    if (segment.kind === 'text') container.append(document.createTextNode(segment.text));
    else if (segment.kind === 'emphasis') {
      const element = document.createElement('em');
      element.textContent = segment.text;
      container.append(element);
    } else if (segment.kind === 'code') {
      const element = document.createElement('code');
      element.textContent = segment.text;
      container.append(element);
    } else {
      const element = document.createElement('a');
      element.href = segment.href;
      element.textContent = segment.text;
      element.target = '_blank';
      element.rel = 'noreferrer noopener';
      container.append(element);
    }
  }
  return container;
}
