export type Role = 'contributor' | 'picture_editor' | 'licensing_manager' | 'desk_editor' | 'treasurer';

export interface Section {
  name: string;
  path: string;
}

export const SECTIONS_BY_ROLE: Record<Role, Section[]> = {
  contributor: [
    { name: 'Contact sheet', path: '/sheet' },
    { name: 'Studio', path: '/studio' },
    { name: 'Royalties', path: '/royalties' },
  ],
  picture_editor: [
    { name: 'Contact sheet', path: '/sheet' },
    { name: 'Shortlist', path: '/shortlist' },
    { name: 'Licences', path: '/licences' },
    { name: 'Following', path: '/following' },
  ],
  licensing_manager: [
    { name: 'Licences', path: '/licences' },
    { name: 'Usage', path: '/usage' },
  ],
  desk_editor: [
    { name: 'Contact sheet', path: '/sheet' },
    { name: 'Review queue', path: '/review-queue' },
    { name: 'All essays', path: '/all-essays' },
  ],
  treasurer: [
    { name: 'Rates', path: '/rates' },
    { name: 'Statements', path: '/statements' },
  ],
};

export const APP_PATHS: string[] = [
  '/',
  ...new Set(Object.values(SECTIONS_BY_ROLE).flatMap((sections) => sections.map((s) => s.path))),
];
