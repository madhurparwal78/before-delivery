// Label formatting: only <b>, <i>, <br> act, under the stack rule. One implementation.

export interface LabelSegment {
  text: string;
  bold: boolean;
  italic: boolean;
  br: boolean;
}

type Kind = 'b' | 'i';

interface Token {
  token: string;
  acting: boolean;
  kind?: Kind;
  closing?: boolean;
  br?: boolean;
}

function tokenize(label: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const acting = (t: string) =>
    t === '<b>' ? { kind: 'b' as Kind, closing: false } :
    t === '</b>' ? { kind: 'b' as Kind, closing: true } :
    t === '<i>' ? { kind: 'i' as Kind, closing: false } :
    t === '</i>' ? { kind: 'i' as Kind, closing: true } :
    t === '<br>' ? { br: true } : null;
  while (i < label.length) {
    const lt = label.indexOf('<', i);
    if (lt === -1) {
      out.push({ token: label.slice(i), acting: false });
      break;
    }
    if (lt > i) out.push({ token: label.slice(i, lt), acting: false });
    const gt = label.indexOf('>', lt + 1);
    const token = gt === -1 ? label.slice(lt) : label.slice(lt, gt + 1);
    const a = acting(token);
    if (a) out.push({ token, acting: true, ...a });
    else out.push({ token, acting: false });
    i = gt === -1 ? label.length : gt + 1;
  }
  return out;
}

// Apply the stack rule once. Each token is either acting or literal; literal
// tokens are kept in place so renderers can show them as inert text.
interface RuleToken {
  literal: string | null;
  acting: Token | null;
}

function applyStackRule(label: string): RuleToken[] {
  const tokens = tokenize(label);
  const stack: { kind: Kind; index: number }[] = [];
  const out: RuleToken[] = [];
  tokens.forEach((tok, index) => {
    if (!tok.acting) {
      out.push({ literal: tok.token, acting: null });
      return;
    }
    if (tok.br) {
      out.push({ literal: null, acting: tok });
      return;
    }
    const kind = tok.kind as Kind;
    const top = stack[stack.length - 1];
    if (!tok.closing) {
      stack.push({ kind, index });
      out.push({ literal: null, acting: tok });
    } else if (top && top.kind === kind) {
      stack.pop();
      out.push({ literal: null, acting: tok });
    } else {
      // A closing tag with no matching opener is literal.
      out.push({ literal: tok.token, acting: null });
    }
  });
  // Openers still on the stack become literal.
  for (const item of stack) {
    const rule = out[item.index];
    if (rule.acting) {
      rule.literal = rule.acting.token;
      rule.acting = null;
    }
  }
  return out;
}

// Segments to render: acting tags toggle formatting or break lines; literal
// text shows as-is. Formatting toggles apply from the following segment on.
export function formatLabel(label: string): LabelSegment[] {
  const segments: LabelSegment[] = [];
  let bold = false;
  let italic = false;
  const openB: number[] = [];
  const openI: number[] = [];
  const emit = (text: string, br: boolean) => {
    if (text === '' && !br) return;
    segments.push({ text, bold, italic, br });
  };
  for (const rt of applyStackRule(label)) {
    if (rt.literal !== null) {
      emit(rt.literal, false);
      continue;
    }
    const a = rt.acting;
    if (!a) continue;
    if (a.br) { emit('', true); continue; }
    if (a.kind === 'b') {
      if (a.closing) { openB.pop(); bold = openB.length > 0; }
      else { openB.push(1); bold = true; }
    } else {
      if (a.closing) { openI.pop(); italic = openI.length > 0; }
      else { openI.push(1); italic = true; }
    }
  }
  return segments;
}

// The plain label: acting tags removed, acting <br> replaced by a space.
export function plainLabel(label: string): string {
  let out = '';
  for (const seg of formatLabel(label)) {
    if (seg.br) out += ' ';
    else out += seg.text;
  }
  return out;
}
