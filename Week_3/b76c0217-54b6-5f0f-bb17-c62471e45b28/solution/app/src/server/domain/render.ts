// The page tree as HTML. Only the markdown above and the six components render; anything else was kept as text
// by the parser and is escaped here. Used by preview, shared preview and the published snapshot alike.

import { copy } from '../../shared/copy';
import { icon, type IconName } from '../../shared/icons';
import {
  assetIdOf,
  classifyHref,
  documentText,
  parseMarkdown,
  type Block,
  type HeadingInfo,
  type Inline,
} from './markdown';
import { defaultCode, type Operation } from './openapi';

interface RenderContext {
  siteSlug: string;
  versionSlug: string;
  /** Set on reference pages: the operation whose Try it panel closes the page. */
  operation: Operation | null;
}

interface Rendered {
  html: string;
  text: string;
  headings: HeadingInfo[];
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const CALLOUTS: Record<string, { label: string; icon: IconName }> = {
  note: { label: 'Note', icon: 'info' },
  tip: { label: 'Tip', icon: 'lightbulb' },
  warning: { label: 'Warning', icon: 'triangleAlert' },
  danger: { label: 'Danger', icon: 'octagonAlert' },
};

class Renderer {
  private counter = 0;

  constructor(private readonly context: RenderContext) {}

  private next(): number {
    this.counter += 1;
    return this.counter;
  }

  inline(nodes: Inline[]): string {
    return nodes.map((node) => this.inlineNode(node)).join('');
  }

  private inlineNode(node: Inline): string {
    switch (node.type) {
      case 'text':
        return escapeHtml(node.value);
      case 'code':
        return `<code>${escapeHtml(node.value)}</code>`;
      case 'em':
        return `<em>${this.inline(node.children)}</em>`;
      case 'strong':
        return `<strong>${this.inline(node.children)}</strong>`;
      case 'image':
        return assetIdOf(this.context.siteSlug, node.src) !== null
          ? `<img src="${escapeHtml(node.src)}" alt="${escapeHtml(node.alt)}" loading="lazy">`
          : escapeHtml(node.alt);
      case 'link':
        return this.link(node.href, this.inline(node.children));
    }
  }

  private link(href: string, label: string): string {
    const target = classifyHref(href);
    switch (target.kind) {
      case 'internal':
        return `<a href="${this.internalHref(target.path, target.anchor)}">${label}</a>`;
      case 'anchor':
        return `<a href="#${escapeHtml(target.anchor)}">${label}</a>`;
      case 'external':
        return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${label}</a>`;
      case 'none':
        return label;
    }
  }

  internalHref(path: string, anchor: string | null): string {
    const { siteSlug, versionSlug } = this.context;
    return `/docs/${siteSlug}/${versionSlug}${escapeHtml(path)}${anchor === null ? '' : `#${escapeHtml(anchor)}`}`;
  }

  blocks(blocks: Block[]): string {
    return blocks.map((block) => this.block(block)).join('\n');
  }

  private block(block: Block): string {
    switch (block.type) {
      case 'heading':
        return this.heading(block);
      case 'paragraph':
        return `<p>${this.inline(block.children).trim()}</p>`;
      case 'list':
        return this.list(block);
      case 'quote':
        return `<blockquote>${this.blocks(block.children)}</blockquote>`;
      case 'code':
        return `<pre tabindex="0"><code${block.lang === '' ? '' : ` class="language-${escapeHtml(block.lang)}"`}>${escapeHtml(block.value)}</code></pre>`;
      case 'rule':
        return '<hr>';
      case 'table':
        return this.table(block);
      case 'unknown':
        return `<p>${escapeHtml(block.raw)}</p>`;
      case 'component':
        return this.component(block);
    }
  }

  private heading(block: Extract<Block, { type: 'heading' }>): string {
    const content = this.inline(block.children);
    if (block.anchor === null) {
      return `<h${block.level}>${content}</h${block.level}>`;
    }
    return (
      `<div class="heading"><h${block.level} id="${escapeHtml(block.anchor)}">${content}</h${block.level}>` +
      `<a class="heading-anchor" href="#${escapeHtml(block.anchor)}" aria-label="Link to ${escapeHtml(block.text)}">${icon('link', 16)}</a></div>`
    );
  }

  private list(block: Extract<Block, { type: 'list' }>): string {
    const tag = block.ordered ? 'ol' : 'ul';
    const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : '';
    const items = block.items.map((item) => {
      const [only] = item;
      const body = item.length === 1 && only?.type === 'paragraph' ? this.inline(only.children).trim() : this.blocks(item);
      return `<li>${body}</li>`;
    });
    return `<${tag}${start}>${items.join('')}</${tag}>`;
  }

  private table(block: Extract<Block, { type: 'table' }>): string {
    const head = block.head.map((cell) => `<th scope="col">${this.inline(cell)}</th>`).join('');
    const rows = block.rows.map((row) => `<tr>${row.map((cell) => `<td>${this.inline(cell)}</td>`).join('')}</tr>`).join('');
    return `<div class="table-scroll" tabindex="0" role="region" aria-label="Table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  private component(block: Extract<Block, { type: 'component' }>): string {
    const attr = (name: string): string => block.attrs[name]?.value ?? '';
    const parts = (name: string): Extract<Block, { type: 'component' }>[] =>
      block.children.filter((child): child is Extract<Block, { type: 'component' }> => child.type === 'component' && child.name === name);
    switch (block.name) {
      case 'Callout': {
        const kind = CALLOUTS[attr('type')] ?? CALLOUTS.note;
        return (
          `<aside class="callout callout-${escapeHtml(attr('type') in CALLOUTS ? attr('type') : 'note')}" data-component="callout" role="note" aria-label="${kind?.label}">` +
          `<p class="callout-label">${icon(kind?.icon ?? 'info', 16)}<span>${kind?.label}</span></p>` +
          `<div class="callout-body">${this.blocks(block.children)}</div></aside>`
        );
      }
      case 'Tabs':
        return this.tabs(
          'tabs',
          'Tabs',
          parts('Tab').map((tab) => ({ title: tab.attrs.title?.value ?? '', body: this.blocks(tab.children) })),
        );
      case 'CodeGroup':
        return this.tabs(
          'code-group',
          'Code examples',
          block.children
            .filter((child): child is Extract<Block, { type: 'code' }> => child.type === 'code' && child.title !== '')
            .map((code) => ({
              title: code.title,
              body: `<div class="code-panel"><button type="button" class="copy" data-copy>${icon('copy', 14)}<span>Copy</span></button>${this.block(code)}</div>`,
            })),
        );
      case 'Steps': {
        const steps = parts('Step').map(
          (step, index) =>
            `<li><h3 class="step-title">${escapeHtml(copy.stepHeading(index + 1, step.attrs.title?.value ?? ''))}</h3><div class="step-body">${this.blocks(step.children)}</div></li>`,
        );
        return `<ol class="steps" data-component="steps">${steps.join('')}</ol>`;
      }
      case 'Accordion': {
        const id = this.next();
        return (
          `<div class="accordion" data-component="accordion"><button type="button" class="accordion-button" id="acc-b${id}" aria-expanded="false" aria-controls="acc-r${id}">` +
          `<span>${escapeHtml(attr('title'))}</span>${icon('chevronDown', 18)}</button>` +
          `<div class="accordion-region" id="acc-r${id}" role="region" aria-labelledby="acc-b${id}" data-motion="closed" hidden>${this.blocks(block.children)}</div></div>`
        );
      }
      case 'Cards': {
        const cards = parts('Card').map((card) => {
          const title = card.attrs.title?.value ?? '';
          const body = documentTextOf(card.children);
          return `<li class="card">${this.link(card.attrs.href?.value ?? '', `<span class="card-title">${escapeHtml(title)}</span>`)}${body === '' ? '' : `<p class="card-text">${escapeHtml(body)}</p>`}${icon('arrowRight', 16)}</li>`;
        });
        return `<ul class="cards" data-component="cards">${cards.join('')}</ul>`;
      }
      case 'Tab':
      case 'Step':
      case 'Card':
        return `<div class="stray-part">${this.blocks(block.children)}</div>`;
    }
  }

  private tabs(name: string, label: string, items: { title: string; body: string }[]): string {
    const id = this.next();
    const buttons = items
      .map(
        (item, index) =>
          `<button type="button" role="tab" id="c${id}-t${index}" aria-selected="${index === 0}" aria-controls="c${id}-p${index}" tabindex="${index === 0 ? 0 : -1}" data-title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</button>`,
      )
      .join('');
    const panels = items
      .map(
        (item, index) =>
          `<div role="tabpanel" id="c${id}-p${index}" aria-labelledby="c${id}-t${index}"${index === 0 ? '' : ' hidden'}>${item.body}</div>`,
      )
      .join('');
    return `<div class="tabs" data-component="${name}"><div role="tablist" aria-label="${label}" class="tablist">${buttons}</div>${panels}</div>`;
  }

  tryIt(operation: Operation): string {
    const fields = operation.parameters
      .map((p, index) => {
        const id = `ti-p${index}`;
        return (
          `<div class="field"><label for="${id}">${escapeHtml(p.name)}</label>` +
          `<span class="field-meta mono">${p.in}${p.required ? ', required' : ''}</span>` +
          `<input id="${id}" type="text" autocomplete="off" spellcheck="false" data-param="${escapeHtml(p.name)}"${p.required ? ' data-required="true"' : ''}>` +
          `<p class="field-error" id="${id}-error" hidden></p></div>`
        );
      })
      .join('');
    const body = operation.hasRequestBody
      ? `<div class="field field-wide"><label for="ti-body">Request body</label>` +
        `<textarea id="ti-body" rows="6" spellcheck="false" data-body>${escapeHtml(operation.requestExample === undefined ? '' : JSON.stringify(operation.requestExample, null, 2))}</textarea>` +
        `<p class="field-error" id="ti-body-error" hidden></p></div>`
      : '';
    const chosen = defaultCode(operation);
    const options = operation.responses
      .map((r) => `<option value="${r.code}"${r.code === chosen ? ' selected' : ''}>${escapeHtml(`${r.code} ${r.description}`.trim())}</option>`)
      .join('');
    return (
      `<div class="tryit" role="region" aria-label="Try it"><form novalidate>${fields}${body}` +
      `<div class="field"><label for="ti-code">Response code</label><select id="ti-code">${options}</select></div>` +
      `<button type="submit" class="button primary">Send request</button></form>` +
      `<div class="tryit-result" hidden><p class="status-line mono" data-status></p><pre tabindex="0"><code data-response></code></pre></div></div>`
    );
  }
}

const documentTextOf = (blocks: Block[]): string => documentText(blocks).replace(/\s+/g, ' ').trim();

export function renderPage(source: string, context: RenderContext): Rendered {
  const document = parseMarkdown(source);
  const renderer = new Renderer(context);
  const html = renderer.blocks(document.blocks) + (context.operation ? renderer.tryIt(context.operation) : '');
  return { html, text: documentText(document.blocks), headings: document.headings };
}
