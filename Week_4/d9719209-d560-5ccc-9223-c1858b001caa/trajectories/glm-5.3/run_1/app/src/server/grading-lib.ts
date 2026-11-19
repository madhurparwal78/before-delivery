/* Grading helpers: the same hot-rank formula and markdown renderer used by
   the app, re-exported for the grading routes. */
import { hotRank } from './domain.js';
import { renderMarkdown } from './markdown.js';

export { hotRank, renderMarkdown as renderMarkdownSafe };
