import type { EditorBoot } from '../../shared/types';
import { documentHtml, embed } from './document';

/** The page that carries the editor app: an empty root, the data it starts with, and its script. */
export function shellHtml(title: string, boot: EditorBoot): string {
  return documentHtml({
    title,
    bodyClass: 'app',
    body: `<div id="root"></div><script type="application/json" id="boot">${embed(boot)}</script>`,
    scripts: '<script src="/static/app.js" defer></script>',
  });
}
