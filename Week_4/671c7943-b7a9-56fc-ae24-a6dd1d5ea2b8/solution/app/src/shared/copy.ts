import type { BudgetId, CategoryId, ProjectTypeId } from "./types.js";

export const SITE_NAME = "Sollis Studio";

const TITLE_SEPARATOR = " | ";
const withSite = (title: string): string => `${title}${TITLE_SEPARATOR}${SITE_NAME}`;

export const TITLES = {
  home: `${SITE_NAME}${TITLE_SEPARATOR}Independent designer`,
  privacy: withSite("Privacy"),
  notFound: withSite("Not found"),
  briefUnavailable: withSite("Brief unavailable"),
  case: withSite,
} as const;

export const SECTIONS = ["intro", "about", "services", "work", "philosophy", "contact"] as const;

export const NAV_SECTIONS = ["about", "services", "work", "philosophy", "contact"] as const;
export const NAV_LABELS: Record<(typeof NAV_SECTIONS)[number], string> = {
  about: "About",
  services: "Services",
  work: "Work",
  philosophy: "Philosophy",
  contact: "Contact",
};

export const INTRO = {
  lines: ["Clear brands.", "Considered websites.", "Products people keep."],
  text: "Maren Sollis is an independent designer working across brand identity, website design and digital product design.",
  start: "Start a project",
  work: "See selected work",
};

export const ABOUT = {
  heading: "About Maren",
  paragraphs: [
    "I am Maren Sollis, an independent designer. For twelve years I have helped companies find a clear voice and give it a form, from the first mark to the last screen.",
    "I work alone on purpose: the person you brief is the person who designs, and I take on four engagements a year.",
  ],
  backgroundHeading: "Background",
  background: [
    "2014 to 2017 · Designer, Hallam Pike Studio, Bristol",
    "2017 to 2021 · Senior brand designer, Northgate Type Office, Rotterdam",
    "2021 to now · Independent, Sollis Studio, London",
  ],
  portrait: "Portrait of Maren Sollis, drawn",
};

export const SERVICES_COPY = {
  heading: "Services",
  line: "Three services, one designer from the first workshop to the handover.",
};

interface Service {
  id: CategoryId;
  name: string;
  summary: string;
  capabilities: string[];
  deliverables: string[];
  weeks: string;
}

export const SERVICES: readonly Service[] = [
  {
    id: "brand-identity",
    name: "Brand Identity",
    summary: "Names, marks and systems that let a company sound and look like itself everywhere.",
    capabilities: ["Brand strategy workshops", "Naming and verbal identity", "Logo and wordmark design", "Typography and colour systems", "Brand guidelines"],
    deliverables: ["Logo suite in SVG and PNG", "Colour and type specification", "Brand guidelines PDF, 40 to 60 pages", "Stationery and social templates"],
    weeks: "6 to 10 weeks",
  },
  {
    id: "website-design",
    name: "Website Design",
    summary: "Editorial, fast websites that carry a brand's voice and are easy for your team to keep up to date.",
    capabilities: ["Site architecture and content design", "Art direction and page design", "Motion and interaction design", "Accessibility review to WCAG 2.2 AA", "Design system for the build team"],
    deliverables: ["Sitemap and page templates", "Desktop, tablet and phone designs", "Interactive prototype", "Component library with usage notes"],
    weeks: "8 to 12 weeks",
  },
  {
    id: "digital-product-design",
    name: "Digital Product Design",
    summary: "Clear, testable product interfaces, from first flows to a design system your team can grow.",
    capabilities: ["Product discovery and research", "User flows and information architecture", "Interface design", "Usability testing", "Design systems"],
    deliverables: ["Research summary", "User flows and wireframes", "High-fidelity screens", "Clickable prototype", "Design system library"],
    weeks: "10 to 16 weeks",
  },
];

export const CATEGORY_IDS: readonly CategoryId[] = SERVICES.map((service) => service.id);

export const WORK_COPY = { heading: "Selected work", caption: "View case study" };

export const PHASES = ["Discover", "Define", "Design", "Deliver"] as const;
type Phase = (typeof PHASES)[number];

const PHASE_COPY: Record<Phase, { weeks: string; text: string }> = {
  Discover: { weeks: "Weeks 1 to 2", text: "Interviews, an audit of what exists and a written brief we both sign." },
  Define: { weeks: "Weeks 3 to 4", text: "Positioning, principles and the measures we will judge the work by." },
  Design: { weeks: "Weeks 5 to 9", text: "Two directions, one chosen, then refined in weekly reviews." },
  Deliver: { weeks: "Weeks 10 to 12", text: "Final files, guidelines and a handover session with your team." },
};

export const PHILOSOPHY = {
  heading: "How I work",
  principlesHeading: "Principles",
  principles: [
    { title: "Say one thing well.", text: "Every identity, page and screen makes one clear promise before it makes a second." },
    { title: "Design the system, not the sample.", text: "A logo, a homepage or a screen is the first use of a system your team will keep using." },
    { title: "Leave it documented.", text: "Every project ends with guidelines the next designer can follow without calling me." },
  ],
  processHeading: "Process",
  steps: PHASES.map((name) => ({ name, ...PHASE_COPY[name] })),
};

export const CONTACT_COPY = {
  heading: "Start a project",
  line: "Tell me about the work. I reply to every enquiry within two working days.",
  phone: "+44 20 7946 0321",
  phoneHref: "tel:+442079460321",
  studio: "London, working worldwide",
};

export const FOOTER_COPY = {
  name: SITE_NAME,
  fiction: "Maren Sollis and every client named on this site are fictional.",
  copyright: `© 2026 ${SITE_NAME}. All rights reserved.`,
  social: [
    { name: "Instagram", href: "https://instagram.example/sollis.studio" },
    { name: "LinkedIn", href: "https://linkedin.example/in/maren-sollis" },
    { name: "Behance", href: "https://behance.example/sollis" },
  ],
};

export const BACK_TO_SITE = `Back to ${SITE_NAME}`;

export const PRIVACY_COPY = {
  heading: "Privacy",
  paragraphs: [
    "This site keeps the enquiries you send: your name, email, project type, budget range and description.",
    "Enquiries are used only to reply to you and are deleted after 24 months.",
    "The site sets no cookies and uses no analytics.",
  ],
};

export const NOT_FOUND_COPY = {
  project: { heading: "This project does not exist.", link: "All work", href: "/#work" },
  page: { heading: "This page does not exist.", link: BACK_TO_SITE, href: "/" },
};

export const CATEGORY_NAMES = Object.fromEntries(SERVICES.map((service) => [service.id, service.name])) as Record<CategoryId, string>;

export const PROJECT_TYPES: readonly { id: ProjectTypeId; name: string }[] = [
  ...SERVICES.map((service) => ({ id: service.id, name: service.name })),
  { id: "not-sure", name: "Not sure yet" },
];

export const PROJECT_TYPE_NAMES = Object.fromEntries(PROJECT_TYPES.map((type) => [type.id, type.name])) as Record<ProjectTypeId, string>;

export const BUDGETS: readonly { id: BudgetId; name: string }[] = [
  { id: "under-10k", name: "Under €10,000" },
  { id: "10k-25k", name: "€10,000 to €25,000" },
  { id: "25k-50k", name: "€25,000 to €50,000" },
  { id: "over-50k", name: "Over €50,000" },
];

export const BUDGET_NAMES = Object.fromEntries(BUDGETS.map((budget) => [budget.id, budget.name])) as Record<BudgetId, string>;

const FIELD_LABELS = {
  reference: "Reference",
  name: "Name",
  email: "Email",
  projectType: "Project type",
  budget: "Budget range",
  description: "Project description",
} as const;

export const FORM_COPY = {
  label: "Project enquiry",
  name: FIELD_LABELS.name,
  email: FIELD_LABELS.email,
  type: FIELD_LABELS.projectType,
  budget: FIELD_LABELS.budget,
  budgetPlaceholder: "Choose a budget range",
  description: FIELD_LABELS.description,
  send: "Send enquiry",
  errorHeading: "There is a problem with your enquiry",
  thanksHeading: (first: string): string => `Thank you, ${first}.`,
  thanksLine: (reference: string): string => `Your enquiry ${reference} is with Maren. She will reply within two working days.`,
  listLabel: "Your enquiry",
  listTerms: FIELD_LABELS,
  download: "Download your brief (PDF)",
  another: "Send another enquiry",
  delayAlert: (reference: string): string =>
    `Your enquiry ${reference} is saved, but we could not send the confirmation email. Maren will still reply within two working days.`,
  notSaved: (studioEmail: string): string => `We could not send your enquiry. Please try again, or email ${studioEmail}.`,
  counter: (count: string): string => `${count} of 2,000 characters`,
};

export const STATUS = {
  sending: "Sending your enquiry.",
  sent: (reference: string): string => `Enquiry ${reference} sent.`,
  saved: (reference: string): string => `Enquiry ${reference} saved.`,
};

export const MAIL_COPY = {
  fieldLabels: FIELD_LABELS,
  descriptionLabel: `${FIELD_LABELS.description}:`,
  studioSubject: (reference: string, typeName: string, budgetName: string): string => `New enquiry ${reference} · ${typeName} · ${budgetName}`,
  acknowledgementSubject: (reference: string): string => `Your enquiry ${reference} to ${SITE_NAME}`,
  acknowledgementGreeting: (first: string): string => `Hello ${first},`,
  acknowledgement: "Thank you for your enquiry. Maren will reply within two working days.",
};

export const BRIEF_COPY = {
  unavailableHeading: "Your brief PDF is not available right now.",
  unavailableLine: (reference: string): string => `Your enquiry ${reference} is saved. Try the download again in a few minutes.`,
  title: (reference: string): string => `Project brief ${reference}`,
};

export function filterAnnouncement(categoryName: string | null, count: number): string {
  if (categoryName === null) return `Showing ${count} projects.`;
  if (count === 0) return `No projects in ${categoryName} yet.`;
  return count === 1 ? `Showing 1 project in ${categoryName}.` : `Showing ${count} projects in ${categoryName}.`;
}

export function showcaseAnnouncement(screen: number, total: number, caption: string): string {
  return `Screen ${screen} of ${total}: ${caption}.`;
}
