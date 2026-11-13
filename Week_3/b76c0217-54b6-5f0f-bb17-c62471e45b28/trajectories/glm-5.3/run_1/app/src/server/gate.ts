import { parsePage } from '../shared/markdown';
import type { ParsedIssue } from '../shared/markdown';

export type GateErrorCode =
  | 'broken_link' | 'broken_anchor' | 'unknown_component' | 'invalid_component'
  | 'invalid_image' | 'duplicate_slug';

export type GateError = { file: string; line: number; code: GateErrorCode; message: string };

export type PageRecordForGate = { id: string; path: string; title: string; source: string; removed: boolean };

export function gateErrorsForPage(
  page: PageRecordForGate,
  livePaths: Set<string>,
  redirects: Map<string, string>,
  anchorsByPath: Map<string, Set<string>>,
  validImageUrls: Set<string>,
  duplicatePaths: Set<string>,
): GateError[] {
  const errors: GateError[] = [];
  const file = `pages/${page.path}.md`;
  if (duplicatePaths.has(page.path)) {
    errors.push({ file, line: 1, code: 'duplicate_slug', message: `Duplicate path /${page.path}: also used by ${page.title}.` });
  }
  if (page.removed) return errors;

  const parsed = parsePage(page.source);
  for (const issue of parsed.issues) {
    if (issue.code === 'unknown_component') {
      errors.push({ file, line: issue.line, code: 'unknown_component', message: `Unknown component ${issue.name}.` });
    } else {
      errors.push({ file, line: issue.line, code: 'invalid_component', message: issue.message });
    }
  }
  for (const link of parsed.links) {
    if (link.path === null) {
      const anchors = anchorsByPath.get(page.path);
      if (link.anchor && anchors && !anchors.has(link.anchor)) {
        errors.push({
          file, line: link.line, code: 'broken_anchor',
          message: `Broken link to /${page.path}#${link.anchor}: no heading with that anchor.`,
        });
      }
      continue;
    }
    if (link.path === '' || !validPath(link.path)) continue;
    const resolved = resolvePath(link.path, livePaths, redirects);
    if (resolved === null) {
      errors.push({ file, line: link.line, code: 'broken_link', message: `Broken link to /${link.path}: no page at that path.` });
      continue;
    }
    if (link.anchor) {
      const anchors = anchorsByPath.get(resolved);
      if (!anchors || !anchors.has(link.anchor)) {
        errors.push({
          file, line: link.line, code: 'broken_anchor',
          message: `Broken link to /${link.path}#${link.anchor}: no heading with that anchor.`,
        });
      }
    }
  }
  for (const card of parsed.cards) {
    if (card.path === null) continue;
    const resolved = resolvePath(card.path, livePaths, redirects);
    if (resolved === null) {
      errors.push({ file, line: card.line, code: 'broken_link', message: `Broken link to /${card.path}: no page at that path.` });
      continue;
    }
    if (card.anchor) {
      const anchors = anchorsByPath.get(resolved);
      if (!anchors || !anchors.has(card.anchor)) {
        errors.push({ file, line: card.line, code: 'broken_anchor', message: `Broken link to /${card.path}#${card.anchor}: no heading with that anchor.` });
      }
    }
  }
  for (const image of parsed.images) {
    if (!validImageUrls.has(image.url)) {
      errors.push({ file, line: image.line, code: 'invalid_image', message: 'Images must be uploaded to this site.' });
    }
  }
  return errors;
}

export function resolvePath(path: string, livePaths: Set<string>, redirects: Map<string, string>): string | null {
  let p = path;
  for (let i = 0; i < 10; i++) {
    if (livePaths.has(p)) return p;
    const r = redirects.get(p);
    if (!r) return null;
    p = r;
  }
  return null;
}

function validPath(p: string): boolean {
  const segments = p.split('/');
  return segments.length >= 1 && segments.length <= 5 && segments.every((s) => /^[A-Za-z0-9_-]{1,60}$/.test(s));
}

export function sortGateErrors(errors: GateError[]): GateError[] {
  return [...errors].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return 0;
  });
}
