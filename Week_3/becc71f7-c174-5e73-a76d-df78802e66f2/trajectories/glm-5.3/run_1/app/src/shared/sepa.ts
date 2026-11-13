// SEPA name rule (DP-30): one place for creditor names in the bank transfer file.

const REPLACEMENTS: Record<string, string> = {
  'Ł': 'L', 'ł': 'l',
  'Ø': 'O', 'ø': 'o',
  'Æ': 'AE', 'æ': 'ae',
  'ẞ': 'SS', 'ß': 'ss',
  'Œ': 'OE', 'œ': 'oe',
  'Đ': 'D', 'đ': 'd',
  'Þ': 'TH', 'þ': 'th',
};

const ALLOWED = /[a-zA-Z0-9/\-?:().,'+ ]/;

export function sepaName(name: string): string {
  // 1. Character replacements
  let s = '';
  for (const ch of name) {
    s += REPLACEMENTS[ch] ?? ch;
  }
  // 2. NFKD and strip combining marks
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  // 3. Everything outside the allowed set becomes a space
  s = [...s].map((ch) => (ALLOWED.test(ch) ? ch : ' ')).join('');
  // 4. Collapse spaces, trim, cap at 70
  return s.replace(/ {2,}/g, ' ').trim().slice(0, 70);
}
