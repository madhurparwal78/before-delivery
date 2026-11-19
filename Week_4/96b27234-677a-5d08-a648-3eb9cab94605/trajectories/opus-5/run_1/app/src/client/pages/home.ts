import { el } from '../dom.js';
import { heading, navigate } from '../shell.js';
import type { PageContext } from '../main.js';

export async function renderHome(ctx: PageContext): Promise<void> {
  if (ctx.me !== null) {
    navigate('/sessions');
    return;
  }
  heading(ctx.main, 'Hearthtile');
  ctx.main.append(
    el('p', { text: 'Walk paper-cut rooms tile by tile, talk to the people beside you, and gather on time.' }),
    el('p', {}, [el('a', { href: '/signin', text: 'Sign in' }), el('span', { text: ' ' }), el('a', { href: '/signup', text: 'Sign up' })])
  );
}
