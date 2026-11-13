import { el } from '../dom';
import { navigate } from '../router';
import { Page } from '../shell';

export function notFoundPage(): Page {
  const element = el('section', { class: 'page not-found' }, [
    el('h1', { class: 'page-title', text: 'Not on this rack' }),
    el('p', { text: 'Check the link, or go back to the rack.' }),
    el('a', {
      text: 'Back to the rack',
      attrs: { href: '/' },
      on: {
        click: (event) => {
          event.preventDefault();
          navigate('/');
        }
      }
    })
  ]);
  return { element, banners: [] };
}
