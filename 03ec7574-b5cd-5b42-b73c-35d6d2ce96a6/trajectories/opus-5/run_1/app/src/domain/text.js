const CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F]/;

const FULL_FOLD = [
  [/\u00DF/g, 'ss'],
  [/\u1E9E/g, 'ss'],
  [/\uFB00/g, 'ff'],
  [/\uFB01/g, 'fi'],
  [/\uFB02/g, 'fl'],
  [/\uFB03/g, 'ffi'],
  [/\uFB04/g, 'ffl'],
  [/\uFB05/g, 'st'],
  [/\uFB06/g, 'st'],
  [/\u0149/g, '\u02BCn'],
  [/\u01F0/g, 'j\u030C'],
  [/\u0390/g, '\u03B9\u0308\u0301'],
  [/\u03B0/g, '\u03C5\u0308\u0301'],
  [/\u03C2/g, '\u03C3'],
  [/\u1E96/g, 'h\u0331'],
  [/\u1E97/g, 't\u0308'],
  [/\u1E98/g, 'w\u030A'],
  [/\u1E99/g, 'y\u030A'],
  [/\u1E9A/g, 'a\u02BE'],
  [/\u0587/g, '\u0565\u0582'],
  [/\uFB13/g, '\u0574\u0576'],
  [/\uFB14/g, '\u0574\u0565'],
  [/\uFB15/g, '\u0574\u056B'],
  [/\uFB16/g, '\u057E\u0576'],
  [/\uFB17/g, '\u0574\u056D']
];

export const TEXT_LIMITS = {
  walletName: [1, 60],
  policyName: [1, 80],
  ruleName: [1, 80],
  aggregationName: [1, 80],
  quorumName: [1, 80],
  memberName: [1, 80],
  apiKeyName: [1, 60],
  memo: [0, 140],
  rejectReason: [1, 280],
  depositReference: [1, 64],
  contactFullName: [2, 80],
  contactCompany: [2, 120],
  contactMessage: [10, 2000]
};

export function normaliseText(value) {
  return value.normalize('NFC');
}

export function codePointLength(value) {
  return [...value].length;
}

export function hasControlCharacters(value) {
  return CONTROL_PATTERN.test(value);
}

/** Unicode default case folding, enough for the expansions that differ from toLowerCase. */
export function foldCase(value) {
  let folded = value.normalize('NFC');
  for (const [pattern, replacement] of FULL_FOLD) folded = folded.replace(pattern, replacement);
  return folded.toLowerCase().normalize('NFC');
}

/**
 * Normalises, optionally trims, and measures a text field.
 * Returns `{ ok: true, value }` or `{ ok: false, reason }` with `reason` one of
 * `type`, `control`, `length`.
 */
export function checkText(raw, limitName, { trim = false } = {}) {
  if (typeof raw !== 'string') return { ok: false, reason: 'type' };
  let value = normaliseText(raw);
  if (trim) value = value.trim();
  if (hasControlCharacters(value)) return { ok: false, reason: 'control' };
  const [min, max] = TEXT_LIMITS[limitName];
  const length = codePointLength(value);
  if (length < min || length > max) return { ok: false, reason: 'length' };
  return { ok: true, value };
}
