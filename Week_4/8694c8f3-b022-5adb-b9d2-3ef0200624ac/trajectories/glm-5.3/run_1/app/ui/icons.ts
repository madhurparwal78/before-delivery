// Lucide-derived line icons, drawn inline so no request leaves the origin.
export const icons = {
  layers: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 4.75 7.83 3.5a1 1 0 0 1 0 1.8l-7.83 3.5a2 2 0 0 1-1.66 0l-7.83-3.5a1 1 0 0 1 0-1.8l7.83-3.5a2 2 0 0 1 1.66 0Z"/><path d="m3.5 12.5 8.33 3.72a2 2 0 0 0 1.66 0l8.33-3.72"/></svg>',
  assets: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  shaders: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 7l10 4 10-4-10-4Z"/><path d="M2 17l10 4 10-4"/><path d="M2 12l10 4 10-4"/></svg>',
  graph: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="3"/><circle cx="19" cy="18" r="3"/><path d="M8 6h13v9"/></svg>',
  scripts: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>',
  shows: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
  activity: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>',
  lock: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
};

export function icon (name: keyof typeof icons): string {
  return icons[name];
}

// The booth dialog emblem: concentric hexagons in lavender-grey.
export const emblem = '<svg class="emblem" width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="#a9a3b8" stroke-width="1.5"><path d="M28 6 48 17.5v21L28 50 8 38.5v-21z"/><path d="M28 15 40 22v12l-12 7-12-7V22z" stroke-width="1"/></svg>';
