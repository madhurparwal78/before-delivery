import { cutCodePoints, codePoints, relativeTime } from '../../shared/format';
import { parseSegments } from '../../shared/richtext';
import { h } from '../dom';
import { cfg, nowIso } from '../state';

export type Mention = { handle: string; member_id: string; name: string };

/** Text renders as plain text with line breaks and only the published links. */
function renderInto(host: HTMLElement, text: string, mentions: Mention[]): void {
  for (const segment of parseSegments(text)) {
    if (segment.kind === 'text') {
      host.append(document.createTextNode(segment.value));
      continue;
    }
    if (segment.kind === 'mention') {
      const found = mentions.find((mention) => mention.handle === segment.handle);
      if (!found) {
        host.append(document.createTextNode(segment.raw));
        continue;
      }
      host.append(
        h('a', { href: `/in/${found.handle}`, 'data-mention-id': found.member_id, class: 'link' }, [
          found.name,
        ]),
      );
      continue;
    }
    if (segment.kind === 'hashtag') {
      host.append(
        h('a', { href: `/hashtag/${segment.tag.toLowerCase()}`, class: 'link' }, [segment.raw]),
      );
      continue;
    }
    host.append(
      h('a', { href: segment.href, rel: 'noreferrer noopener', class: 'link' }, [segment.raw]),
    );
  }
}

export function richText(text: string, mentions: Mention[] = []): HTMLElement {
  const host = h('div', { class: 'body-text' });
  renderInto(host, text, mentions);
  return host;
}

/** Text longer than the see-more limit is cut there, with a see more button. */
export function richTextWithSeeMore(text: string, mentions: Mention[] = []): HTMLElement {
  const limit = cfg().see_more_chars;
  const host = h('div', { class: 'body-text' });
  if (codePoints(text) <= limit) {
    renderInto(host, text, mentions);
    return host;
  }
  const draw = (expanded: boolean): void => {
    host.replaceChildren();
    if (expanded) {
      renderInto(host, text, mentions);
      return;
    }
    renderInto(host, cutCodePoints(text, limit), mentions);
    host.append(document.createTextNode('…'));
    host.append(
      h('button', { type: 'button', class: 'text-button', click: () => draw(true) }, ['see more']),
    );
  };
  draw(false);
  return host;
}

const timeNodes = new Set<HTMLElement>();

function label(iso: string, edited: boolean): string {
  const base = relativeTime(iso, nowIso(), cfg().time_zone);
  return edited ? `${base} • Edited` : base;
}

export function timeElement(iso: string, edited = false): HTMLElement {
  const node = h('time', { datetime: iso, 'data-relative-time': iso });
  if (edited) node.setAttribute('data-edited', 'true');
  node.textContent = label(iso, edited);
  timeNodes.add(node);
  return node;
}

/** Every shown time follows the ladder on the business clock, live. */
export function refreshTimes(): void {
  for (const node of [...timeNodes]) {
    if (!document.contains(node)) {
      timeNodes.delete(node);
      continue;
    }
    const iso = node.getAttribute('data-relative-time') ?? '';
    node.textContent = label(iso, node.getAttribute('data-edited') === 'true');
  }
}
