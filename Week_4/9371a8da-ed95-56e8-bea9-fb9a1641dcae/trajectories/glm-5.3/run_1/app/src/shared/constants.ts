import type { Role } from './types.js';

export const ROLE_WORDS: Record<Role, string> = {
  owner: 'owner',
  editor: 'editor',
  reviewer: 'reviewer',
  viewer: 'viewer',
};

export const TEXT_EXTENSIONS = ['.tex', '.bib', '.sty', '.cls', '.bst', '.txt'];

export const CITE_COMMANDS = [
  'cite', 'citep', 'citet', 'citealp', 'citeauthor', 'citeyear',
  'parencite', 'textcite', 'autocite', 'footcite', 'nocite',
];
