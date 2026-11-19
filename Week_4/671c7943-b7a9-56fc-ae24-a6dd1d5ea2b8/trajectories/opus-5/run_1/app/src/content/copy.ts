import type { CategoryId } from '../shared/types.js';

export interface SectionCopy {
  id: 'intro' | 'about' | 'services' | 'work' | 'philosophy' | 'contact';
  heading: string;
  navName: string;
}

export const SECTIONS: readonly SectionCopy[] = [
  { id: 'intro', heading: 'Clear brands. Considered websites. Products people keep.', navName: 'Intro' },
  { id: 'about', heading: 'About Maren', navName: 'About' },
  { id: 'services', heading: 'Services', navName: 'Services' },
  { id: 'work', heading: 'Selected work', navName: 'Work' },
  { id: 'philosophy', heading: 'How I work', navName: 'Philosophy' },
  { id: 'contact', heading: 'Start a project', navName: 'Contact' },
];

export const NAV_SECTIONS = SECTIONS.filter((section) => section.id !== 'intro');

export const INTRO = {
  lines: ['Clear brands.', 'Considered websites.', 'Products people keep.'],
  line: 'Maren Sollis is an independent designer working across brand identity, website design and digital product design.',
  links: [
    { name: 'Start a project', target: 'contact' },
    { name: 'See selected work', target: 'work' },
  ],
} as const;

export const ABOUT = {
  paragraphs: [
    'I am Maren Sollis, an independent designer. For twelve years I have helped companies find a clear voice and give it a form, from the first mark to the last screen.',
    'I work alone on purpose: the person you brief is the person who designs, and I take on four engagements a year.',
  ],
  portraitName: 'Portrait of Maren Sollis, drawn',
  backgroundHeading: 'Background',
  background: [
    '2014 to 2017 · Designer, Hallam Pike Studio, Bristol',
    '2017 to 2021 · Senior brand designer, Northgate Type Office, Rotterdam',
    '2021 to now · Independent, Sollis Studio, London',
  ],
  statisticsLabel: 'Statistics',
} as const;

export interface ServiceCopy {
  id: CategoryId;
  name: string;
  summary: string;
  capabilities: string[];
  deliverables: string[];
  weeks: string;
}

export const SERVICES: readonly ServiceCopy[] = [
  {
    id: 'brand-identity',
    name: 'Brand Identity',
    summary: 'Names, marks and systems that let a company sound and look like itself everywhere.',
    capabilities: [
      'Brand strategy workshops',
      'Naming and verbal identity',
      'Logo and wordmark design',
      'Typography and colour systems',
      'Brand guidelines',
    ],
    deliverables: [
      'Logo suite in SVG and PNG',
      'Colour and type specification',
      'Brand guidelines PDF, 40 to 60 pages',
      'Stationery and social templates',
    ],
    weeks: '6 to 10 weeks',
  },
  {
    id: 'website-design',
    name: 'Website Design',
    summary:
      "Editorial, fast websites that carry a brand's voice and are easy for your team to keep up to date.",
    capabilities: [
      'Site architecture and content design',
      'Art direction and page design',
      'Motion and interaction design',
      'Accessibility review to WCAG 2.2 AA',
      'Design system for the build team',
    ],
    deliverables: [
      'Sitemap and page templates',
      'Desktop, tablet and phone designs',
      'Interactive prototype',
      'Component library with usage notes',
    ],
    weeks: '8 to 12 weeks',
  },
  {
    id: 'digital-product-design',
    name: 'Digital Product Design',
    summary:
      'Clear, testable product interfaces, from first flows to a design system your team can grow.',
    capabilities: [
      'Product discovery and research',
      'User flows and information architecture',
      'Interface design',
      'Usability testing',
      'Design systems',
    ],
    deliverables: [
      'Research summary',
      'User flows and wireframes',
      'High-fidelity screens',
      'Clickable prototype',
      'Design system library',
    ],
    weeks: '10 to 16 weeks',
  },
];

export const SERVICES_INTRO = 'Three services, one designer from the first workshop to the handover.';

export const serviceName = (id: CategoryId): string =>
  SERVICES.find((service) => service.id === id)!.name;

export const PRINCIPLES = [
  {
    heading: 'Say one thing well.',
    text: 'Every identity, page and screen makes one clear promise before it makes a second.',
  },
  {
    heading: 'Design the system, not the sample.',
    text: 'A logo, a homepage or a screen is the first use of a system your team will keep using.',
  },
  {
    heading: 'Leave it documented.',
    text: 'Every project ends with guidelines the next designer can follow without calling me.',
  },
] as const;

export const PROCESS_STEPS = [
  {
    name: 'Discover',
    weeks: 'Weeks 1 to 2',
    text: 'Interviews, an audit of what exists and a written brief we both sign.',
  },
  {
    name: 'Define',
    weeks: 'Weeks 3 to 4',
    text: 'Positioning, principles and the measures we will judge the work by.',
  },
  {
    name: 'Design',
    weeks: 'Weeks 5 to 9',
    text: 'Two directions, one chosen, then refined in weekly reviews.',
  },
  {
    name: 'Deliver',
    weeks: 'Weeks 10 to 12',
    text: 'Final files, guidelines and a handover session with your team.',
  },
] as const;

export const CONTACT = {
  line: 'Tell me about the work. I reply to every enquiry within two working days.',
  phone: '+44 20 7946 0321',
  phoneHref: 'tel:+442079460321',
  studio: 'London, working worldwide',
} as const;

export const FOOTER = {
  texts: ['Sollis Studio', 'Maren Sollis and every client named on this site are fictional.'],
  copyright: '© 2026 Sollis Studio. All rights reserved.',
  social: [
    { name: 'Instagram', href: 'https://instagram.example/sollis.studio' },
    { name: 'LinkedIn', href: 'https://linkedin.example/in/maren-sollis' },
    { name: 'Behance', href: 'https://behance.example/sollis' },
  ],
} as const;

export const PRIVACY = {
  heading: 'Privacy',
  paragraphs: [
    'This site keeps the enquiries you send: your name, email, project type, budget range and description.',
    'Enquiries are used only to reply to you and are deleted after 24 months.',
    'The site sets no cookies and uses no analytics.',
  ],
  backLink: 'Back to Sollis Studio',
} as const;

export const NOT_FOUND = {
  project: { heading: 'This project does not exist.', linkName: 'All work', href: '/#work' },
  page: { heading: 'This page does not exist.', linkName: 'Back to Sollis Studio', href: '/' },
} as const;

export const BRIEF_UNAVAILABLE = {
  heading: 'Your brief PDF is not available right now.',
  line: (reference: string): string =>
    `Your enquiry ${reference} is saved. Try the download again in a few minutes.`,
} as const;

export const CASE_STUDY_SECTIONS = [
  { id: 'overview', heading: 'Overview' },
  { id: 'objectives', heading: 'Objectives' },
  { id: 'visual-system', heading: 'Visual system' },
  { id: 'showcase', heading: 'Showcase' },
  { id: 'process', heading: 'Process' },
  { id: 'results', heading: 'Results' },
] as const;
