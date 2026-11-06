/**
 * The not-found page, which also answers an order or ride that is missing or
 * not the rider's.
 */

import { el } from '../dom.js';
import type { Page, PageFactory } from '../main.js';

export const NOT_FOUND_HEADING = "We couldn't find that page.";

export const notFoundPage: PageFactory = (): Page => ({
  mount(container) {
    container.append(
      el('section', { class: 'sheet' }, [el('h1', { class: 'heading-1' }, [NOT_FOUND_HEADING])]),
    );
  },
});
