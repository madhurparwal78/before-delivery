export const PUBLIC_COPY = {
  notFound: "This dossier isn't available.",
  endedLink: 'This preview link has ended.',
  storageUnavailable: 'This dossier is temporarily unavailable.',
  noSearchResults: (query: string): string => `No published notes match ${query}.`,
  draftBanner: (when: string): string => `Draft preview · expires ${when}`,
  publishedFooter: (when: string, noteCount: number): string =>
    `Published ${when} · ${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`,
  draftFooter: (noteCount: number): string => `Draft · ${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`,
} as const;
