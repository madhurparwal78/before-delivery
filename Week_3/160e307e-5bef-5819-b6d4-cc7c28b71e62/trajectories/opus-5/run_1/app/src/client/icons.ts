import circleAlert from 'lucide-static/icons/circle-alert.svg';
import copy from 'lucide-static/icons/copy.svg';
import check from 'lucide-static/icons/check.svg';
import target from 'lucide-static/icons/target.svg';
import trophy from 'lucide-static/icons/trophy.svg';
import store from 'lucide-static/icons/store.svg';
import user from 'lucide-static/icons/user.svg';
import { fromHtml } from './dom.js';

const SOURCES: Record<string, string> = {
  'circle-alert': circleAlert,
  copy,
  check,
  target,
  trophy,
  store,
  user,
};

/** Lucide line icons, drawn inline from the open-licensed package. */
export function icon(name: keyof typeof SOURCES & string): Element {
  const node = fromHtml(SOURCES[name].replace(/>\s+</g, '><').trim());
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  node.setAttribute('width', '20');
  node.setAttribute('height', '20');
  return node;
}
