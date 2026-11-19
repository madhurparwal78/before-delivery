// Domain rule: export file naming. Single source of truth.
export function exportFileName(projectName: string, format: 'stl' | 'obj' | 'svg'): string {
  const stem = projectName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 60)
    .replaceAll(/-+$/g, '');
  const base = stem.length === 0 ? 'design' : stem;
  return `${base}.${format}`;
}

export function isValidExportFileName(fileName: string, format: 'stl' | 'obj' | 'svg'): boolean {
  const m = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(stl|obj|svg)$/.exec(fileName);
  if (!m) return false;
  if (m[2] !== format) return false;
  return m[1].length >= 1 && m[1].length <= 60;
}
