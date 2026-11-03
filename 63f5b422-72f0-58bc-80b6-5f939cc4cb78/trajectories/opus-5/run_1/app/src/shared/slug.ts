export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function uniqueSlug(name: string, taken: readonly string[]): string {
  const base = slugify(name) || 'untitled';
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}
