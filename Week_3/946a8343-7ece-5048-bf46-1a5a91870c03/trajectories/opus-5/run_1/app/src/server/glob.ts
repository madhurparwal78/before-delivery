const escaped = /[.+^${}()|[\]\\]/g;

export function globToRegExp(pattern: string): RegExp {
  let body = pattern;
  const anchored = body.startsWith('/');
  if (anchored) body = body.slice(1);
  let suffix = '';
  if (body.endsWith('/')) {
    body = body.slice(0, -1);
    suffix = '/.*';
  }
  let out = '';
  let index = 0;
  while (index < body.length) {
    if (body.startsWith('**/', index)) {
      out += '(?:.*/)?';
      index += 3;
      continue;
    }
    if (body.startsWith('**', index)) {
      out += '.*';
      index += 2;
      continue;
    }
    const char = body[index];
    if (char === '*') {
      out += '[^/]*';
      index += 1;
      continue;
    }
    out += char.replace(escaped, (match) => `\\${match}`);
    index += 1;
  }
  const prefix = anchored ? '^' : '^(?:.*/)?';
  return new RegExp(`${prefix}${out}${suffix}$`);
}

export function globMatch(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(path);
}

export function branchPatternMatch(pattern: string, name: string): boolean {
  if (pattern === name) return true;
  if (!pattern.includes('*')) return false;
  const body = pattern
    .split('*')
    .map((part) => part.replace(escaped, (match) => `\\${match}`))
    .join('.*');
  return new RegExp(`^${body}$`).test(name);
}
