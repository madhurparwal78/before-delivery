import { gateMessages } from './messages';
import { parsePage, type ParsedPage } from './markdown';
import type { Redirect } from './redirects';

/** The publish gate: every problem that blocks a publish, in the published order (DP-18). */

export type GateCode =
  | 'broken_anchor'
  | 'broken_link'
  | 'duplicate_slug'
  | 'invalid_component'
  | 'invalid_image'
  | 'unknown_component';

export interface GateError {
  file: string;
  line: number;
  code: GateCode;
  message: string;
}

interface SortableError extends GateError {
  column: number;
}

export interface GatePage {
  id: string;
  path: string;
  title: string;
  source: string;
}

export interface GateInput {
  pages: readonly GatePage[];
  redirects: readonly Redirect[];
  siteSlug: string;
  assetIds: ReadonlySet<string>;
}

export const pageFile = (path: string): string => `pages/${path}.md`;

const EXTERNAL = /^(https?:|mailto:)/;

export function runGate(input: GateInput): GateError[] {
  const parsed = new Map<string, ParsedPage>();
  for (const page of input.pages) parsed.set(page.id, parsePage(page.source));

  const anchorsByPath = new Map<string, Set<string>>();
  const livePaths = new Set<string>();
  for (const page of input.pages) {
    const withSlash = `/${page.path}`;
    livePaths.add(withSlash);
    if (!anchorsByPath.has(withSlash)) {
      const anchors = new Set<string>();
      for (const heading of (parsed.get(page.id) as ParsedPage).headings) {
        if (heading.anchor !== null) anchors.add(heading.anchor);
      }
      anchorsByPath.set(withSlash, anchors);
    }
  }

  const redirectTo = new Map(input.redirects.map((redirect) => [redirect.from, redirect.to]));
  const errors: SortableError[] = [];

  for (const page of input.pages) {
    const file = pageFile(page.path);
    const document = parsed.get(page.id) as ParsedPage;
    const ownPath = `/${page.path}`;

    for (const problem of document.problems) {
      errors.push({
        file,
        line: problem.line,
        code: problem.code,
        message: problem.message,
        column: problem.column,
      });
    }

    for (const link of document.links) {
      const target = link.target;
      if (EXTERNAL.test(target)) continue;
      const add = (code: GateCode, message: string): void => {
        errors.push({ file, line: link.line, code, message, column: link.column });
      };
      if (target.startsWith('#')) {
        const anchor = target.slice(1);
        const own = anchorsByPath.get(ownPath);
        if (own !== undefined && !own.has(anchor)) {
          add('broken_anchor', gateMessages.brokenAnchor(ownPath, anchor));
        }
        continue;
      }
      if (!target.startsWith('/')) continue;
      const [path, ...rest] = target.split('#');
      const anchor = rest.join('#');
      const live = livePaths.has(path);
      const hop = redirectTo.get(path);
      if (!live && hop === undefined) {
        add('broken_link', gateMessages.brokenLink(path));
        continue;
      }
      if (anchor === '') continue;
      const resolved = live ? path : (hop as string);
      const anchors = anchorsByPath.get(resolved);
      if (anchors === undefined || !anchors.has(anchor)) {
        add('broken_anchor', gateMessages.brokenAnchor(path, anchor));
      }
    }

    for (const image of document.images) {
      const prefix = `/assets/${input.siteSlug}/`;
      const imageId = image.src.startsWith(prefix) ? image.src.slice(prefix.length) : null;
      if (imageId === null || !input.assetIds.has(imageId)) {
        errors.push({
          file,
          line: image.line,
          code: 'invalid_image',
          message: gateMessages.invalidImage,
          column: image.column,
        });
      }
    }
  }

  for (const page of input.pages) {
    const other = input.pages.find((candidate) => candidate.path === page.path && candidate.id !== page.id);
    if (other === undefined) continue;
    errors.push({
      file: pageFile(page.path),
      line: 1,
      code: 'duplicate_slug',
      message: gateMessages.duplicateSlug(`/${page.path}`, other.title),
      column: 0,
    });
  }

  errors.sort(
    (a, b) =>
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
      a.column - b.column,
  );
  return errors.map(({ file, line, code, message }) => ({ file, line, code, message }));
}
