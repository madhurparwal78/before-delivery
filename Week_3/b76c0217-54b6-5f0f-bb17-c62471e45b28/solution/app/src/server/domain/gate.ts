// The publish gate: every broken link, broken anchor, unknown or invalid component, invalid image and duplicate
// path of a version, with its file, line, code and message, in the published order.

import { copy } from '../../shared/copy';
import type { GateError, RedirectJson } from '../../shared/types';
import {
  assetIdOf,
  imageNodes,
  linkTargets,
  parseMarkdown,
  walkBlocks,
  type Block,
  type Document,
} from './markdown';
import { resolvePath } from './redirects';

interface GatePage {
  id: string;
  path: string;
  title: string;
  source: string;
}

interface Problem extends GateError {
  offset: number;
}

type Component = Extract<Block, { type: 'component' }>;

const CALLOUT_TYPES = ['note', 'tip', 'warning', 'danger'];

const childrenNamed = (block: Component, name: string): Component[] =>
  block.children.filter((child): child is Component => child.type === 'component' && child.name === name);

/** The rule each component must keep; one message per broken rule, at the line of the tag that breaks it. */
function componentProblems(document: Document): { line: number; message: string; code: 'invalid_component' | 'unknown_component' }[] {
  const found: { line: number; message: string; code: 'invalid_component' | 'unknown_component' }[] = [];
  const invalid = (line: number, message: string): void => {
    found.push({ line, message, code: 'invalid_component' });
  };
  const duplicates = (items: { title: string; line: number }[], message: (title: string) => string): void => {
    const seen = new Set<string>();
    for (const item of items) {
      if (item.title !== '' && seen.has(item.title)) {
        invalid(item.line, message(item.title));
      }
      seen.add(item.title);
    }
  };
  walkBlocks(document.blocks, (block, parent) => {
    if (block.type === 'unknown') {
      found.push({ line: block.line, message: `Unknown component ${block.name}.`, code: 'unknown_component' });
      return;
    }
    if (block.type !== 'component') {
      return;
    }
    const title = block.attrs.title?.value ?? '';
    const inside = (name: string): boolean => parent?.type === 'component' && parent.name === name;
    if (!block.closed) {
      invalid(block.line, `${block.name} is missing its closing tag.`);
    }
    switch (block.name) {
      case 'Callout':
        if (!CALLOUT_TYPES.includes(block.attrs.type?.value ?? '')) {
          invalid(block.line, 'Callout needs type note, tip, warning or danger.');
        }
        break;
      case 'Tabs': {
        const tabs = childrenNamed(block, 'Tab');
        if (tabs.length < 2) {
          invalid(block.line, 'Tabs needs 2 or more Tab items.');
        }
        duplicates(
          tabs.map((tab) => ({ title: tab.attrs.title?.value ?? '', line: tab.line })),
          (t) => `Tab title "${t}" is used twice in these Tabs.`,
        );
        break;
      }
      case 'Tab':
        if (!inside('Tabs')) {
          invalid(block.line, 'Tab must be inside Tabs.');
        }
        if (title === '') {
          invalid(block.line, 'Tab needs a title.');
        }
        break;
      case 'CodeGroup': {
        const codes = block.children.filter((child): child is Extract<Block, { type: 'code' }> => child.type === 'code' && child.title !== '');
        if (codes.length < 2) {
          invalid(block.line, 'CodeGroup needs 2 or more titled code blocks.');
        }
        duplicates(
          codes.map((code) => ({ title: code.title, line: code.line })),
          (t) => `Code block title "${t}" is used twice in this CodeGroup.`,
        );
        break;
      }
      case 'Steps':
        if (childrenNamed(block, 'Step').length < 1) {
          invalid(block.line, 'Steps needs 1 or more Step items.');
        }
        break;
      case 'Step':
        if (!inside('Steps')) {
          invalid(block.line, 'Step must be inside Steps.');
        }
        if (title === '') {
          invalid(block.line, 'Step needs a title.');
        }
        break;
      case 'Accordion':
        if (title === '') {
          invalid(block.line, 'Accordion needs a title.');
        }
        break;
      case 'Cards':
        if (childrenNamed(block, 'Card').length < 1) {
          invalid(block.line, 'Cards needs 1 or more Card items.');
        }
        break;
      case 'Card':
        if (!inside('Cards')) {
          invalid(block.line, 'Card must be inside Cards.');
        }
        if (title === '' || (block.attrs.href?.value ?? '') === '') {
          invalid(block.line, 'Card needs a title and an href.');
        }
        break;
    }
  });
  return found;
}

interface GateInput {
  pages: GatePage[];
  redirects: RedirectJson[];
  siteSlug: string;
  imageIds: Set<string>;
}

export function runGate({ pages, redirects, siteSlug, imageIds }: GateInput): GateError[] {
  const parsed = pages.map((page) => ({ page, document: parseMarkdown(page.source) }));
  const byPath = new Map<string, (typeof parsed)[number]>();
  for (const entry of parsed) {
    if (!byPath.has(entry.page.path)) {
      byPath.set(entry.page.path, entry);
    }
  }
  const resolve = (path: string): (typeof parsed)[number] | undefined => {
    const resolution = resolvePath(redirects, (candidate) => byPath.has(candidate.slice(1)), path);
    return resolution.kind === 'missing' ? undefined : byPath.get((resolution.kind === 'redirect' ? resolution.to : path).slice(1));
  };

  const problems: Problem[] = [];
  for (const { page, document } of parsed) {
    const file = `pages/${page.path}.md`;
    const report = (line: number, offset: number, code: GateError['code'], message: string): void => {
      problems.push({ file, line, code, message, offset });
    };
    for (const link of linkTargets(document)) {
      if (link.kind === 'anchor') {
        if (!document.headings.some((h) => h.anchor === link.anchor)) {
          report(link.line, link.offset, 'broken_anchor', `Broken link to /${page.path}#${link.anchor}: no heading with that anchor.`);
        }
        continue;
      }
      const target = resolve(link.path);
      if (target === undefined) {
        report(link.line, link.offset, 'broken_link', `Broken link to ${link.path}: no page at that path.`);
      } else if (link.anchor !== null && !target.document.headings.some((h) => h.anchor === link.anchor)) {
        report(link.line, link.offset, 'broken_anchor', `Broken link to ${link.path}#${link.anchor}: no heading with that anchor.`);
      }
    }
    for (const found of componentProblems(document)) {
      report(found.line, 0, found.code, found.message);
    }
    for (const image of imageNodes(document)) {
      const id = assetIdOf(siteSlug, image.src);
      if (id === null || !imageIds.has(id)) {
        report(image.line, image.offset, 'invalid_image', 'Images must be uploaded to this site.');
      }
    }
    const other = pages.find((candidate) => candidate.id !== page.id && candidate.path === page.path);
    if (other !== undefined) {
      report(1, 0, 'duplicate_slug', copy.duplicateSlug(`/${page.path}`, other.title));
    }
  }
  return problems
    .sort((a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.code, b.code) || a.offset - b.offset)
    .map(({ offset: _offset, ...error }) => error);
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
