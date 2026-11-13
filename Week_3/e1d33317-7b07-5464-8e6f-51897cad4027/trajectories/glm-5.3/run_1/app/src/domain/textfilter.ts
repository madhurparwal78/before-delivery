import { TEXT_PLAIN_MAX, perceivedLength } from './values.js';

/**
 * The one place that decides which markup survives in expression text and lyrics.
 * Only <i>, <b> and <br> survive, with every attribute removed. Any other tag is
 * removed but its text is kept, except <script> and <style> which go with their
 * contents. Remaining <, > and & are stored escaped. Unclosed <i>/<b> are closed.
 */
export function filterExpressionText(input: string): string {
  let text = stripScriptAndStyle(input);
  text = dropDisallowedTags(text);
  text = closeOpenTags(text);
  return escapeLoose(text);
}

function stripScriptAndStyle(input: string): string {
  return input.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[\s\S]*?<\/style\s*>/gi, '');
}

function dropDisallowedTags(input: string): string {
  // scan tags; keep only i, b, br (closing i and b also kept)
  let out = '';
  let i = 0;
  while (i < input.length) {
    const open = input.indexOf('<', i);
    if (open === -1) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, open);
    const close = findTagEnd(input, open);
    if (close === -1) {
      // not a tag; keep the loose < later by escaping
      out += input.slice(open, open + 1);
      i = open + 1;
      continue;
    }
    const tag = input.slice(open, close + 1);
    const name = tagName(tag);
    if (name === 'i' || name === 'b' || name === 'br') {
      out += `<${name}>`;
    }
    i = close + 1;
  }
  return out;
}

function findTagEnd(input: string, open: number): number {
  let i = open + 1;
  let quote: string | null = null;
  while (i < input.length) {
    const c = input[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
    i++;
  }
  return -1;
}

function tagName(tag: string): string {
  const m = /^<\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(tag);
  return m ? m[1].toLowerCase() : '';
}

function closeOpenTags(input: string): string {
  let italics = 0;
  let bolds = 0;
  for (const m of input.matchAll(/<(\/?)(i|b)>/g)) {
    if (m[2] === 'i') italics += m[1] ? -1 : 1;
    else bolds += m[1] ? -1 : 1;
  }
  let out = input;
  for (let k = 0; k < Math.max(0, italics); k++) out += '</i>';
  for (let k = 0; k < Math.max(0, bolds); k++) out += '</b>';
  return out;
}

function escapeLoose(input: string): string {
  // escape only <, > and & that are not part of the kept tags
  let out = '';
  let i = 0;
  while (i < input.length) {
    const rest = input.slice(i);
    const nextTag = /^<(\/?)(i|b|br)>/.exec(rest);
    if (nextTag) {
      out += nextTag[0];
      i += nextTag[0].length;
      continue;
    }
    const c = rest[0];
    if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else if (c === '&') out += '&amp;';
    else out += c;
    i++;
  }
  return out;
}

/** The plain text after removing the kept tags, for the 200-character limit. */
export function plainTextOf(filtered: string): string {
  return filtered.replace(/<\/?(i|b|br)>/g, '');
}

export function textWithinLimit(filtered: string): boolean {
  return perceivedLength(plainTextOf(filtered)) <= TEXT_PLAIN_MAX;
}
