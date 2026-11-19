import { h } from './dom.js';

const FRAME_STYLES = `
html { height: 100%; margin: 0; overflow: hidden; }
body { height: 100%; margin: 0; background: #faf7f1; color: #16181c;
  font: 400 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
.layout { min-height: 100%; box-sizing: border-box; }
.layout > * { outline: 1px solid #2f5d8f; padding: 4px 6px; box-sizing: border-box;
  background: rgba(47, 93, 143, 0.08); }
`;

/** The live preview: the single place a resolved column width is read from. */
export class PreviewPane {
  readonly frame: HTMLIFrameElement;

  constructor() {
    this.frame = h('iframe', { title: 'Layout preview', class: 'preview-frame' }) as HTMLIFrameElement;
  }

  update(css: string, html: string, width: number): void {
    this.frame.style.width = `${width}px`;
    const document_ = this.frame.contentDocument;
    if (!document_) return;
    document_.open();
    document_.write(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${FRAME_STYLES}</style><style>${css}</style></head><body>${html}</body></html>`,
    );
    document_.close();
  }

  /** The computed column widths of the preview at the current preview width. */
  resolvedColumns(): number[] {
    const window_ = this.frame.contentWindow;
    const container = this.frame.contentDocument?.querySelector('.layout');
    if (!window_ || !container) return [];
    const value = window_.getComputedStyle(container).gridTemplateColumns;
    return value
      .split(' ')
      .map((part) => Number.parseFloat(part))
      .filter((number) => Number.isFinite(number));
  }
}

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}
