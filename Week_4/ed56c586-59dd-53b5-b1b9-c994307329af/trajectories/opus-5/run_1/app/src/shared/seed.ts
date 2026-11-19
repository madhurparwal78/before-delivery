/**
 * Every person, business, client, review, figure and milestone here is invented
 * and illustrative. Nothing on the site claims real clients, awards or experience.
 */

export type DisciplineId = 'web' | 'motion' | 'cloud' | 'data' | 'design' | 'ai';

export interface Discipline {
  readonly id: DisciplineId;
  readonly name: string;
}

/** Canonical discipline order. Address values and names both derive from it. */
export const DISCIPLINES: readonly Discipline[] = [
  { id: 'web', name: 'Web' },
  { id: 'motion', name: 'Motion' },
  { id: 'cloud', name: 'Cloud' },
  { id: 'data', name: 'Data' },
  { id: 'design', name: 'Design' },
  { id: 'ai', name: 'AI' },
];

export const ROLES: readonly string[] = [
  'full-stack developer',
  'motion engineer',
  'Firebase app builder',
  'creative designer',
  'presentation designer',
  'prompt engineer',
];

export const ROLES_SUMMARY =
  'I work as a full-stack developer, motion engineer, Firebase app builder, creative designer, presentation designer and prompt engineer.';

export const HERO = {
  greeting: "Hello, I'm Ottoline.",
  headline: 'I build websites that move with you.',
  paragraph:
    'Independent developer and digital creator. I design, animate and build full-stack products, from the first sketch to the cloud.',
} as const;

export const ABOUT = {
  introduction:
    "I'm Ottoline Rask, an independent developer and digital creator working as Quillfern Works. I take a build from the first sketch to the cloud, and I like being the person who knows how every moving part behaves.",
  philosophy:
    'I treat motion as explanation, not decoration, and I check every screen by keyboard, on a phone and with reduced motion before I call it done. Each case study here says which parts were mine.',
  principles: [
    'Ship the boring parts well.',
    'Motion explains, never decorates.',
    'Every screen works without a mouse.',
    'Measure before you polish.',
  ],
  expertise: [
    'Full-stack web development',
    'Motion and interaction',
    'Firebase and cloud apps',
    'Creative and presentation design',
    'AI-assisted workflows',
  ],
} as const;

export interface Milestone {
  readonly year: string;
  readonly title: string;
  readonly detail: string;
}

export const MILESTONES: readonly Milestone[] = [
  {
    year: '2017',
    title: 'First freelance website',
    detail:
      'Built a booking site for a local bakery and learned that the boring parts decide whether a site gets used.',
  },
  {
    year: '2019',
    title: 'Front-end lead at a product studio',
    detail:
      "Led the front end for a team of four and set up the studio's first accessibility checks.",
  },
  {
    year: '2021',
    title: 'Went independent',
    detail:
      'Started Quillfern Works to take on motion and full-stack builds directly for agencies and founders.',
  },
  {
    year: '2023',
    title: 'First real-time cloud app in production',
    detail:
      'Shipped a real-time volunteer roster that coordinators now run every weekend.',
  },
  {
    year: '2025',
    title: 'AI-assisted tools for design teams',
    detail:
      'Began building AI-assisted tools that help design teams repeat and share their best work.',
  },
];

export interface Figure {
  readonly key: string;
  readonly label: string;
  readonly target: number;
  readonly suffix: string;
}

export const ABOUT_FIGURES: readonly Figure[] = [
  { key: 'years', label: 'Years building for the web', target: 9, suffix: '' },
  { key: 'led', label: 'Projects led end to end', target: 31, suffix: '' },
];

export const NUMBERS_FIGURES: readonly Figure[] = [
  { key: 'projects', label: 'Projects delivered', target: 48, suffix: '' },
  { key: 'technologies', label: 'Technologies in use', target: 26, suffix: '' },
  { key: 'awards', label: 'Awards and mentions', target: 7, suffix: '' },
  { key: 'satisfaction', label: 'Client satisfaction', target: 98, suffix: '%' },
];

export interface CalloutRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Callout {
  readonly n: number;
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly region: CalloutRegion;
}

export interface Project {
  readonly slug: string;
  readonly title: string;
  readonly kind: string;
  readonly client: string;
  readonly year: number;
  readonly role: string;
  readonly disciplines: readonly DisciplineId[];
  readonly tint: string;
  readonly overview: string;
  readonly challenge: string;
  readonly solution: string;
  readonly decisions: string;
  readonly stack: readonly string[];
  readonly callouts: readonly Callout[];
}

const callout = (
  n: number,
  label: string,
  from: number,
  to: number,
  left: number,
  top: number,
  width: number,
  height: number,
): Callout => ({ n, label, from, to, region: { left, top, width, height } });

export const PROJECTS: readonly Project[] = [
  {
    slug: 'hollis-atelier',
    title: 'Hollis Atelier',
    kind: 'Architecture and creative portfolio website',
    client: 'Hollis Atelier',
    year: 2025,
    role: 'Design and build',
    disciplines: ['web', 'design'],
    tint: '#cfd8c4',
    overview:
      'Hollis Atelier is a small architecture practice that wanted its portfolio to feel like walking through a set of drawings. I designed and built the site end to end.',
    challenge:
      'Hundreds of plans and photographs, no way to show how a drawing became a building, and an old site that could not be used without a mouse.',
    solution:
      'Each project wipes from plan to finished photograph as the reader moves through it, with a project index rail always in reach and every control usable by keyboard.',
    decisions:
      "The wipe follows the reader's scroll instead of a timer, so nobody waits for it. With reduced motion, the plan and the photograph sit side by side.",
    stack: ['Next.js', 'TypeScript', 'Accessible HTML and CSS', 'Figma', 'Brand assets'],
    callouts: [
      callout(1, 'Plan-to-photo wipe', 1, 3, 8, 12, 46, 60),
      callout(2, 'Project index rail', 3, 4, 70, 10, 22, 80),
      callout(3, 'Material swatch reveal', 4, 6, 12, 70, 60, 20),
    ],
  },
  {
    slug: 'foundry-loop',
    title: 'Foundry Loop',
    kind: 'Animated studio website',
    client: 'Foundry Loop',
    year: 2024,
    role: 'Motion and front-end build',
    disciplines: ['web', 'motion'],
    tint: '#c6cedd',
    overview:
      "Foundry Loop is a motion studio that subcontracted me to build its site around its reel. I owned the motion system and the front-end build, and the studio's designers owned the art direction.",
    challenge:
      "A single reel hid which shots were whose, and the logo's letterforms had to move without becoming unreadable.",
    solution:
      "A scrubbable reel stops on any shot and shows its credits, the letterforms morph between weights, and the team grid reveals each person's role on hover and on focus.",
    decisions:
      'Every animation has a reduced-motion version that shows its end state at once, and the scrubber works with the arrow keys.',
    stack: ['TypeScript', 'GSAP', 'SVG animation', 'Web Animations API', 'Figma'],
    callouts: [
      callout(1, 'Reel scrubber', 1, 2, 10, 70, 80, 18),
      callout(2, 'Letterform morph', 2, 5, 15, 15, 55, 45),
      callout(3, 'Team grid hover', 5, 6, 60, 40, 32, 44),
    ],
  },
  {
    slug: 'tallyhouse',
    title: 'Tallyhouse',
    kind: 'Full-stack web application',
    client: 'Tallyhouse Collective',
    year: 2024,
    role: 'Full-stack build',
    disciplines: ['web', 'data'],
    tint: '#ddd3bf',
    overview:
      'Tallyhouse Collective runs shared workshops and needed one place to book rooms, bill members and see usage. I built the application from the data model up.',
    challenge:
      'Bookings, invoices and usage lived in three spreadsheets that disagreed every month.',
    solution:
      'A booking calendar, an invoice builder and a usage chart share one data model, so a confirmed booking becomes a line on the next invoice.',
    decisions:
      'Invoices are built from confirmed bookings only, and the calendar reads as a table to screen readers.',
    stack: ['React', 'Node.js', 'PostgreSQL', 'REST and GraphQL APIs', 'TypeScript'],
    callouts: [
      callout(1, 'Booking calendar', 1, 2, 6, 14, 52, 58),
      callout(2, 'Invoice builder', 3, 4, 62, 14, 32, 58),
      callout(3, 'Usage chart', 5, 6, 6, 76, 88, 18),
    ],
  },
  {
    slug: 'pulse-roster',
    title: 'Pulse Roster',
    kind: 'Firebase-powered application',
    client: 'Pulse Volunteers',
    year: 2023,
    role: 'App and cloud build',
    disciplines: ['web', 'cloud'],
    tint: '#c9d9d4',
    overview:
      'Pulse Volunteers coordinates shifts for community events. I built a real-time roster that volunteers open on their phones.',
    challenge:
      'Shift changes went out by group message and arrived after the shift had started.',
    solution:
      'A live shift board updates the moment someone signs up or swaps, behind a simple sign-in screen, and a swap request flow trades shifts with one tap each.',
    decisions:
      'The board keeps working on a weak connection and catches up when it returns, and every status is written in words as well as colour.',
    stack: [
      'React',
      'Firebase Authentication',
      'Cloud Firestore',
      'Cloud Functions',
      'Hosting and CI',
    ],
    callouts: [
      callout(1, 'Live shift board', 1, 3, 8, 10, 84, 50),
      callout(2, 'Sign-in screen', 3, 4, 30, 20, 40, 60),
      callout(3, 'Swap request flow', 4, 6, 10, 64, 80, 28),
    ],
  },
  {
    slug: 'tidegauge',
    title: 'Tidegauge',
    kind: 'Interactive dashboard',
    client: 'Tidegauge Analytics',
    year: 2025,
    role: 'Dashboard design and build',
    disciplines: ['motion', 'data'],
    tint: '#c4d2de',
    overview:
      'Tidegauge Analytics sells tide and water-level data to harbour operators. I designed and built the dashboard they watch through a shift.',
    challenge:
      'Readings arrive every few seconds from dozens of stations, and the old charts redrew so often that operators lost their place.',
    solution:
      'A streaming tide chart adds new readings without redrawing the view, a station picker keeps chosen stations in reach, and an alert timeline sits under the chart.',
    decisions:
      'Only new readings animate, never the axes, and operators can pause the stream to read a moment.',
    stack: ['TypeScript', 'React', 'Framer Motion', 'Node.js', 'MongoDB'],
    callouts: [
      callout(1, 'Streaming tide chart', 1, 4, 6, 18, 62, 56),
      callout(2, 'Station picker', 4, 5, 72, 18, 22, 56),
      callout(3, 'Alert timeline', 5, 6, 6, 80, 88, 14),
    ],
  },
  {
    slug: 'promptloom',
    title: 'Promptloom',
    kind: 'AI-assisted creative tool',
    client: 'Promptloom Labs',
    year: 2026,
    role: 'Product design and AI build',
    disciplines: ['design', 'ai'],
    tint: '#d8cedd',
    overview:
      'Promptloom Labs builds tools for design teams that use AI every day. I designed the product and built its prompt and export features.',
    challenge:
      'Designers kept prompts in scattered notes and could not repeat a result they liked.',
    solution:
      'A prompt recipe editor saves reusable recipes, a moodboard canvas gathers the results, and one export turns a board into slides.',
    decisions:
      'Every generated image keeps the recipe that made it, and the editor is fully usable by keyboard.',
    stack: [
      'Prompt design',
      'Workflow automation',
      'Custom AI tools',
      'Canva',
      'Presentation design',
    ],
    callouts: [
      callout(1, 'Prompt recipe editor', 1, 2, 6, 12, 40, 70),
      callout(2, 'Moodboard canvas', 2, 5, 50, 12, 44, 70),
      callout(3, 'Export to slides', 5, 6, 6, 86, 88, 10),
    ],
  },
];

export const FRAMES_PER_PROJECT = 6;

export interface CaseStudySection {
  readonly id: 'overview' | 'challenge' | 'solution' | 'decisions' | 'stack';
  readonly heading: string;
}

export const CASE_STUDY_SECTIONS: readonly CaseStudySection[] = [
  { id: 'overview', heading: 'Overview' },
  { id: 'challenge', heading: 'The challenge' },
  { id: 'solution', heading: 'The solution' },
  { id: 'decisions', heading: 'Design decisions' },
  { id: 'stack', heading: 'Technology stack' },
];

export type ServiceId = 'web' | 'motion' | 'cloud' | 'design' | 'ai';

export interface Service {
  readonly id: ServiceId;
  readonly name: string;
  readonly description: string;
  readonly deliverables: readonly string[];
  readonly technology: readonly string[];
}

export const SERVICES: readonly Service[] = [
  {
    id: 'web',
    name: 'Web Development',
    description:
      'Websites and web applications, from the first wireframe to the production deploy.',
    deliverables: [
      'Marketing and product websites',
      'Full-stack web applications',
      'APIs and integrations',
      'Responsive front ends',
    ],
    technology: ['React', 'Next.js', 'MERN stack', 'REST and GraphQL APIs'],
  },
  {
    id: 'motion',
    name: 'Motion & Interaction',
    description:
      'Motion that explains a product, with a reduced-motion version of every moment.',
    deliverables: [
      'Scroll-driven storytelling',
      'Micro-interactions',
      'Animated brand systems',
      'Reduced-motion versions',
    ],
    technology: ['GSAP', 'Framer Motion', 'Web Animations API', 'SVG animation'],
  },
  {
    id: 'cloud',
    name: 'App & Cloud Solutions',
    description: 'Firebase and cloud apps with sign-in, real-time data and functions.',
    deliverables: ['Firebase apps', 'Sign-in and accounts', 'Real-time data', 'Cloud functions'],
    technology: [
      'Firebase Authentication',
      'Cloud Firestore',
      'Cloud Functions',
      'Hosting and CI',
    ],
  },
  {
    id: 'design',
    name: 'Creative Design',
    description: 'Decks, brand assets and campaign visuals a whole team can reuse.',
    deliverables: [
      'Presentation decks',
      'Brand assets',
      'Social and campaign visuals',
      'Visual storytelling',
    ],
    technology: ['Canva', 'Figma', 'Presentation design', 'Brand guidelines'],
  },
  {
    id: 'ai',
    name: 'AI & Prompt Engineering',
    description:
      'Prompt systems and small AI tools that fit the way your team already works.',
    deliverables: [
      'Prompt design',
      'Workflow automation',
      'Custom AI tools',
      'Team training',
    ],
    technology: [
      'Prompt libraries',
      'Workflow automation',
      'Custom AI tools',
      'Model evaluation',
    ],
  },
];

export interface SkillCard {
  readonly technology: string;
  readonly level: number;
}

export interface SkillGroup {
  readonly id: string;
  readonly name: string;
  readonly cards: readonly SkillCard[];
}

export const SKILL_GROUPS: readonly SkillGroup[] = [
  {
    id: 'frontend',
    name: 'Frontend',
    cards: [
      { technology: 'React', level: 92 },
      { technology: 'Next.js', level: 88 },
      { technology: 'TypeScript', level: 90 },
      { technology: 'Accessible HTML and CSS', level: 94 },
    ],
  },
  {
    id: 'backend',
    name: 'Backend',
    cards: [
      { technology: 'Node.js', level: 86 },
      { technology: 'REST and GraphQL APIs', level: 82 },
      { technology: 'PostgreSQL', level: 74 },
      { technology: 'MongoDB', level: 70 },
    ],
  },
  {
    id: 'animation',
    name: 'Animation',
    cards: [
      { technology: 'GSAP', level: 90 },
      { technology: 'Framer Motion', level: 84 },
      { technology: 'Web Animations API', level: 80 },
      { technology: 'SVG animation', level: 86 },
    ],
  },
  {
    id: 'cloud',
    name: 'Cloud',
    cards: [
      { technology: 'Firebase Authentication', level: 85 },
      { technology: 'Cloud Firestore', level: 83 },
      { technology: 'Cloud Functions', level: 78 },
      { technology: 'Hosting and CI', level: 72 },
    ],
  },
  {
    id: 'design',
    name: 'Design',
    cards: [
      { technology: 'Canva', level: 88 },
      { technology: 'Figma', level: 84 },
      { technology: 'Presentation design', level: 90 },
      { technology: 'Brand assets', level: 80 },
    ],
  },
  {
    id: 'ai',
    name: 'AI',
    cards: [
      { technology: 'Prompt design', level: 87 },
      { technology: 'Workflow automation', level: 81 },
      { technology: 'Custom AI tools', level: 76 },
      { technology: 'Model evaluation', level: 70 },
    ],
  },
];

export interface Review {
  readonly quote: string;
  readonly name: string;
  readonly role: string;
  readonly company: string;
}

export const REVIEWS: readonly Review[] = [
  {
    quote:
      'Ottoline rebuilt our booking flow in six weeks, and every screen worked by keyboard on day one.',
    name: 'Priya Nandakumar',
    role: 'Head of Product',
    company: 'Fernway Health',
  },
  {
    quote:
      'We subcontracted the motion on three launches. Each shipped with a reduced-motion version we never had to ask for.',
    name: 'Tomas Reyes',
    role: 'Creative Director',
    company: 'Studio Kettle',
  },
  {
    quote:
      'The Firebase app went live before our pilot, and the real-time rota has not dropped a shift since.',
    name: 'Amara Osei',
    role: 'Founder',
    company: 'Loomlight',
  },
  {
    quote:
      'Clear estimates, clean pull requests and a dashboard our operations team actually opens every morning.',
    name: 'Jonah Feld',
    role: 'Engineering Manager',
    company: 'Parcelgrid',
  },
  {
    quote:
      'Ottoline turned our pitch deck and brand assets into one system the whole team can reuse.',
    name: 'Elif Durmaz',
    role: 'Brand Lead',
    company: 'Northcap Coffee',
  },
];

export const CONTACT = {
  email: 'hello@ottolinerask.example',
  github: 'https://github.example/ottolinerask',
  linkedin: 'https://linkedin.example/in/ottolinerask',
  dribbble: 'https://dribbble.example/ottolinerask',
  availability: 'Taking on new projects from January 2027.',
} as const;

export interface HomeSection {
  readonly id: string;
  readonly heading: string;
}

/** The home sections that can be jumped to from the header, menu and footer. */
export const NAV_SECTIONS: readonly HomeSection[] = [
  { id: 'about', heading: 'About' },
  { id: 'work', heading: 'Selected work' },
  { id: 'services', heading: 'Services' },
  { id: 'skills', heading: 'Skills and tools' },
  { id: 'reviews', heading: 'Client reviews' },
  { id: 'contact', heading: 'Start a project' },
];

export const NAV_LINK_LABELS: readonly string[] = [
  'About',
  'Work',
  'Services',
  'Skills',
  'Reviews',
  'Contact',
];

export const FICTION_NOTICE =
  'Ottoline Rask and Quillfern Works are fictional. Projects, clients, reviews, figures and the career timeline on this site are illustrative.';

export const REVIEWS_NOTICE =
  'Illustrative reviews: the clients, quotes and companies are fictional samples.';

export const disciplineName = (id: DisciplineId): string => {
  const found = DISCIPLINES.find((d) => d.id === id);
  if (!found) throw new Error(`Unknown discipline: ${id}`);
  return found.name;
};

export const projectBySlug = (slug: string): Project | undefined =>
  PROJECTS.find((p) => p.slug === slug);

export const serviceById = (id: string): Service | undefined =>
  SERVICES.find((s) => s.id === id);
