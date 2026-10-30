// Body validation helpers shared by every route: unknown-key detection over
// the whole body and pinned-order field checks.

export function findUnknownKey(defined, value, prefix = '') {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const p = `${prefix}${i}`;
      const inner = findUnknownKey(defined, value[i], `${p}.`);
      if (inner) return inner;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (!defined.includes(k)) return path;
    }
    for (const k of defined) {
      if (Object.hasOwn(value, k)) {
        const inner = findUnknownKey(defined, value[k], `${prefix ? `${prefix}.` : ''}${k}`);
        if (inner) return inner;
      }
    }
  }
  return null;
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function missingKeys(body, order) {
  for (const k of order) {
    if (!Object.hasOwn(body, k)) return k;
  }
  return null;
}
