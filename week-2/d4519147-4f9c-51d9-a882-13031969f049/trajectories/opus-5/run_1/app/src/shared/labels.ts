/**
 * The stack rule for label formatting. Shape labels, connector labels and zone
 * notes are stored exactly as submitted; only the five exact lowercase tags
 * `<b>`, `</b>`, `<i>`, `</i>` and `<br>` can ever act as formatting, and only
 * when the stack rule matches them. Everything else is literal inert text.
 */

export type LabelRun = { kind: 'text'; text: string; bold: boolean; italic: boolean } | { kind: 'break' };

type Token =
  | { type: 'literal'; text: string }
  | { type: 'open'; tag: 'b' | 'i'; text: string; acts: boolean }
  | { type: 'close'; tag: 'b' | 'i'; text: string; acts: boolean }
  | { type: 'break' };

const TAGS: ReadonlyArray<{ source: string; token: () => Token }> = [
  { source: '<b>', token: () => ({ type: 'open', tag: 'b', text: '<b>', acts: false }) },
  { source: '</b>', token: () => ({ type: 'close', tag: 'b', text: '</b>', acts: false }) },
  { source: '<i>', token: () => ({ type: 'open', tag: 'i', text: '<i>', acts: false }) },
  { source: '</i>', token: () => ({ type: 'close', tag: 'i', text: '</i>', acts: false }) },
  { source: '<br>', token: () => ({ type: 'break' }) },
];

function tokenize(label: string): Token[] {
  const tokens: Token[] = [];
  let literal = '';
  let i = 0;
  while (i < label.length) {
    let matched: Token | null = null;
    if (label[i] === '<') {
      for (const tag of TAGS) {
        if (label.startsWith(tag.source, i)) {
          matched = tag.token();
          i += tag.source.length;
          break;
        }
      }
    }
    if (matched) {
      if (literal) {
        tokens.push({ type: 'literal', text: literal });
        literal = '';
      }
      tokens.push(matched);
    } else {
      literal += label[i];
      i += 1;
    }
  }
  if (literal) tokens.push({ type: 'literal', text: literal });
  return tokens;
}

function markActingTags(tokens: Token[]): void {
  const stack: Array<{ tag: 'b' | 'i'; index: number }> = [];
  tokens.forEach((token, index) => {
    if (token.type === 'open') {
      stack.push({ tag: token.tag, index });
    } else if (token.type === 'close') {
      const top = stack[stack.length - 1];
      if (top && top.tag === token.tag) {
        token.acts = true;
        const opener = tokens[top.index];
        if (opener && opener.type === 'open') opener.acts = true;
        stack.pop();
      }
    }
  });
}

/** The label split into formatting runs, ready to render as inert text nodes. */
export function labelRuns(label: string): LabelRun[] {
  const tokens = tokenize(label);
  markActingTags(tokens);
  const runs: LabelRun[] = [];
  let bold = 0;
  let italic = 0;
  const pushText = (text: string): void => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.kind === 'text' && last.bold === bold > 0 && last.italic === italic > 0) {
      last.text += text;
      return;
    }
    runs.push({ kind: 'text', text, bold: bold > 0, italic: italic > 0 });
  };
  for (const token of tokens) {
    switch (token.type) {
      case 'literal':
        pushText(token.text);
        break;
      case 'break':
        runs.push({ kind: 'break' });
        break;
      case 'open':
        if (token.acts) {
          if (token.tag === 'b') bold += 1;
          else italic += 1;
        } else {
          pushText(token.text);
        }
        break;
      case 'close':
        if (token.acts) {
          if (token.tag === 'b') bold -= 1;
          else italic -= 1;
        } else {
          pushText(token.text);
        }
        break;
    }
  }
  return runs;
}

/** The label with acting tags removed and acting line breaks replaced by a space. */
export function plainLabel(label: string): string {
  let out = '';
  for (const run of labelRuns(label)) {
    out += run.kind === 'break' ? ' ' : run.text;
  }
  return out;
}
