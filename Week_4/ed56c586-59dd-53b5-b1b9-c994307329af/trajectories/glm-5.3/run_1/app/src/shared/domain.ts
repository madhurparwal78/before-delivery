/**
 * Seed data and the domain rules of the site. Every rule named in the brief
 * that both the browser and the server need is decided here and nowhere else.
 */

export const SITE = {
  title: "Ottoline Rask | Developer and digital creator",
  owner: "Ottoline Rask",
  studio: "Quillfern Works",
  email: "hello@ottolinerask.example",
} as const;

export const HEADER_HEIGHT = 64;
export const JUMP_OFFSET = 80; // target heading top edge distance from viewport top

export const ROLES = [
  "full-stack developer",
  "motion engineer",
  "Firebase app builder",
  "creative designer",
  "presentation designer",
  "prompt engineer",
] as const;

export const ROLES_SUMMARY =
  "I work as a full-stack developer, motion engineer, Firebase app builder, creative designer, presentation designer and prompt engineer.";

export const ROLE_INTERVAL = 2500;
export const INTRO_DONE_MS = 1800;
export const CALLOUT_STEP_MS = 150;
export const COUNTER_DURATION = 1500;
export const MEDIA_RECHECK_MS = 5000;

export const WORKING_PRINCIPLES = [
  "Ship the boring parts well.",
  "Motion explains, never decorates.",
  "Every screen works without a mouse.",
  "Measure before you polish.",
] as const;

export const EXPERTISE = [
  "Full-stack web development",
  "Motion and interaction",
  "Firebase and cloud apps",
  "Creative and presentation design",
  "AI-assisted workflows",
] as const;

export type Milestone = { button: string; detail: string };
export const MILESTONES: Milestone[] = [
  {
    button: "2017: First freelance website",
    detail:
      "Built a booking site for a local bakery and learned that the boring parts decide whether a site gets used.",
  },
  {
    button: "2019: Front-end lead at a product studio",
    detail:
      "Led the front end for a team of four and set up the studio's first accessibility checks.",
  },
  {
    button: "2021: Went independent",
    detail:
      "Started Quillfern Works to take on motion and full-stack builds directly for agencies and founders.",
  },
  {
    button: "2023: First real-time cloud app in production",
    detail:
      "Shipped a real-time volunteer roster that coordinators now run every weekend.",
  },
  {
    button: "2025: AI-assisted tools for design teams",
    detail:
      "Began building AI-assisted tools that help design teams repeat and share their best work.",
  },
];

export const MILESTONE_LABEL = "Illustrative career timeline";

export type Figure = { key: string; label: string; target: number; suffix?: string };
export const ABOUT_FIGURES: Figure[] = [
  { key: "years", label: "Years building for the web", target: 9 },
  { key: "led", label: "Projects led end to end", target: 31 },
];
export const NUMBERS_FIGURES: Figure[] = [
  { key: "projects", label: "Projects delivered", target: 48 },
  { key: "technologies", label: "Technologies in use", target: 26 },
  { key: "awards", label: "Awards and mentions", target: 7 },
  { key: "satisfaction", label: "Client satisfaction", target: 98, suffix: "%" },
];
export const FIGURE_LABEL = "Illustrative figures";

/** counter figure at t ms of page time for a block started at t0 */
export function counterFigure(target: number, t: number): number {
  if (t >= COUNTER_DURATION) return target;
  return Math.floor((target * t) / COUNTER_DURATION);
}

export const SECTION_IDS = ["about", "work", "services", "skills", "reviews", "contact"] as const;
export const CASE_STUDY_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "challenge", label: "The challenge" },
  { id: "solution", label: "The solution" },
  { id: "decisions", label: "Design decisions" },
  { id: "stack", label: "Technology stack" },
] as const;

/** The 40% line rule, shared by the home page and the case studies. */
export function currentSection(
  ids: readonly string[],
  offsets: Map<string, number>,
  lineY: number
): string | null {
  let current: string | null = null;
  for (const id of ids) {
    const top = offsets.get(id);
    if (top !== undefined && top <= lineY) current = id;
  }
  return current;
}

export type Discipline = {
  name: string;
  value: string;
};
export const DISCIPLINES: Discipline[] = [
  { name: "Web", value: "web" },
  { name: "Motion", value: "motion" },
  { name: "Cloud", value: "cloud" },
  { name: "Data", value: "data" },
  { name: "Design", value: "design" },
  { name: "AI", value: "ai" },
];

export const DISCIPLINE_NAME = new Map(DISCIPLINES.map((d) => [d.value, d.name]));

/** canonical discipline values for a `category` parameter value */
export function parseCategory(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (!seen.has(value) && DISCIPLINE_NAME.has(value)) seen.add(value);
  }
  return DISCIPLINES.filter((d) => seen.has(d.value)).map((d) => d.value);
}

export function formatCategory(values: readonly string[]): string {
  return values.join(",");
}

/** does a project with these discipline values show for the pressed list? */
export function projectShows(projectValues: readonly string[], pressed: readonly string[]): boolean {
  if (pressed.length === 0) return true;
  return pressed.some((value) => projectValues.includes(value));
}

export type Callout = {
  label: string;
  from: number;
  to: number;
  region: { left: number; top: number; width: number; height: number };
};
export type Project = {
  slug: string;
  title: string;
  kind: string;
  client: string;
  year: number;
  role: string;
  disciplines: string[];
  stack: string[];
  callouts: Callout[];
  prose: { overview: string; challenge: string; solution: string; decisions: string };
};

function callout(
  label: string,
  from: number,
  to: number,
  left: number,
  top: number,
  width: number,
  height: number
): Callout {
  return { label, from, to, region: { left, top, width, height } };
}

export const PROJECTS: Project[] = [
  {
    slug: "hollis-atelier",
    title: "Hollis Atelier",
    kind: "Architecture and creative portfolio website",
    client: "Hollis Atelier",
    year: 2025,
    role: "Design and build",
    disciplines: ["web", "design"],
    stack: ["Next.js", "TypeScript", "Accessible HTML and CSS", "Figma", "Brand assets"],
    callouts: [
      callout("Plan-to-photo wipe", 1, 3, 8, 12, 46, 60),
      callout("Project index rail", 3, 4, 70, 10, 22, 80),
      callout("Material swatch reveal", 4, 6, 12, 70, 60, 20),
    ],
    prose: {
      overview:
        "Hollis Atelier is a small architecture practice that wanted its portfolio to feel like walking through a set of drawings. I designed and built the site end to end.",
      challenge:
        "Hundreds of plans and photographs, no way to show how a drawing became a building, and an old site that could not be used without a mouse.",
      solution:
        "Each project wipes from plan to finished photograph as the reader moves through it, with a project index rail always in reach and every control usable by keyboard.",
      decisions:
        "The wipe follows the reader's scroll instead of a timer, so nobody waits for it. With reduced motion, the plan and the photograph sit side by side.",
    },
  },
  {
    slug: "foundry-loop",
    title: "Foundry Loop",
    kind: "Animated studio website",
    client: "Foundry Loop",
    year: 2024,
    role: "Motion and front-end build",
    disciplines: ["web", "motion"],
    stack: ["TypeScript", "GSAP", "SVG animation", "Web Animations API", "Figma"],
    callouts: [
      callout("Reel scrubber", 1, 2, 10, 70, 80, 18),
      callout("Letterform morph", 2, 5, 15, 15, 55, 45),
      callout("Team grid hover", 5, 6, 60, 40, 32, 44),
    ],
    prose: {
      overview:
        "Foundry Loop is a motion studio that subcontracted me to build its site around its reel. I owned the motion system and the front-end build, and the studio's designers owned the art direction.",
      challenge:
        "A single reel hid which shots were whose, and the logo's letterforms had to move without becoming unreadable.",
      solution:
        "A scrubbable reel stops on any shot and shows its credits, the letterforms morph between weights, and the team grid reveals each person's role on hover and on focus.",
      decisions:
        "Every animation has a reduced-motion version that shows its end state at once, and the scrubber works with the arrow keys.",
    },
  },
  {
    slug: "tallyhouse",
    title: "Tallyhouse",
    kind: "Full-stack web application",
    client: "Tallyhouse Collective",
    year: 2024,
    role: "Full-stack build",
    disciplines: ["web", "data"],
    stack: ["React", "Node.js", "PostgreSQL", "REST and GraphQL APIs", "TypeScript"],
    callouts: [
      callout("Booking calendar", 1, 2, 6, 14, 52, 58),
      callout("Invoice builder", 3, 4, 62, 14, 32, 58),
      callout("Usage chart", 5, 6, 6, 76, 88, 18),
    ],
    prose: {
      overview:
        "Tallyhouse Collective runs shared workshops and needed one place to book rooms, bill members and see usage. I built the application from the data model up.",
      challenge: "Bookings, invoices and usage lived in three spreadsheets that disagreed every month.",
      solution:
        "A booking calendar, an invoice builder and a usage chart share one data model, so a confirmed booking becomes a line on the next invoice.",
      decisions:
        "Invoices are built from confirmed bookings only, and the calendar reads as a table to screen readers.",
    },
  },
  {
    slug: "pulse-roster",
    title: "Pulse Roster",
    kind: "Firebase-powered application",
    client: "Pulse Volunteers",
    year: 2023,
    role: "App and cloud build",
    disciplines: ["cloud", "web"],
    stack: ["React", "Firebase Authentication", "Cloud Firestore", "Cloud Functions", "Hosting and CI"],
    callouts: [
      callout("Live shift board", 1, 3, 8, 10, 84, 50),
      callout("Sign-in screen", 3, 4, 30, 20, 40, 60),
      callout("Swap request flow", 4, 6, 10, 64, 80, 28),
    ],
    prose: {
      overview:
        "Pulse Volunteers coordinates shifts for community events. I built a real-time roster that volunteers open on their phones.",
      challenge: "Shift changes went out by group message and arrived after the shift had started.",
      solution:
        "A live shift board updates the moment someone signs up or swaps, behind a simple sign-in screen, and a swap request flow trades shifts with one tap each.",
      decisions:
        "The board keeps working on a weak connection and catches up when it returns, and every status is written in words as well as colour.",
    },
  },
  {
    slug: "tidegauge",
    title: "Tidegauge",
    kind: "Interactive dashboard",
    client: "Tidegauge Analytics",
    year: 2025,
    role: "Dashboard design and build",
    disciplines: ["data", "motion"],
    stack: ["TypeScript", "React", "Framer Motion", "Node.js", "MongoDB"],
    callouts: [
      callout("Streaming tide chart", 1, 4, 6, 18, 62, 56),
      callout("Station picker", 4, 5, 72, 18, 22, 56),
      callout("Alert timeline", 5, 6, 6, 80, 88, 14),
    ],
    prose: {
      overview:
        "Tidegauge Analytics sells tide and water-level data to harbour operators. I designed and built the dashboard they watch through a shift.",
      challenge:
        "Readings arrive every few seconds from dozens of stations, and the old charts redrew so often that operators lost their place.",
      solution:
        "A streaming tide chart adds new readings without redrawing the view, a station picker keeps chosen stations in reach, and an alert timeline sits under the chart.",
      decisions:
        "Only new readings animate, never the axes, and operators can pause the stream to read a moment.",
    },
  },
  {
    slug: "promptloom",
    title: "Promptloom",
    kind: "AI-assisted creative tool",
    client: "Promptloom Labs",
    year: 2026,
    role: "Product design and AI build",
    disciplines: ["ai", "design"],
    stack: ["Prompt design", "Workflow automation", "Custom AI tools", "Canva", "Presentation design"],
    callouts: [
      callout("Prompt recipe editor", 1, 2, 6, 12, 40, 70),
      callout("Moodboard canvas", 2, 5, 50, 12, 44, 70),
      callout("Export to slides", 5, 6, 6, 86, 88, 10),
    ],
    prose: {
      overview:
        "Promptloom Labs builds tools for design teams that use AI every day. I designed the product and built its prompt and export features.",
      challenge: "Designers kept prompts in scattered notes and could not repeat a result they liked.",
      solution:
        "A prompt recipe editor saves reusable recipes, a moodboard canvas gathers the results, and one export turns a board into slides.",
      decisions:
        "Every generated image keeps the recipe that made it, and the editor is fully usable by keyboard.",
    },
  },
];

export const PROJECTS_BY_SLUG = new Map(PROJECTS.map((p) => [p.slug, p]));

export function projectDisciplineNames(disciplines: readonly string[]): string[] {
  return DISCIPLINES.filter((d) => disciplines.includes(d.value)).map((d) => d.name);
}

/**
 * The single neighbour rule: neighbours among the projects the address's
 * `category` list shows, in published order. Without a list, and when this
 * project is not in the list, the neighbours come from all six projects.
 */
export function neighbours(
  slug: string,
  category: readonly string[]
): { previous: Project | null; next: Project | null } {
  const pool = PROJECTS.filter((p) => projectShows(p.disciplines, category));
  const effective = pool.some((p) => p.slug === slug) || category.length === 0 ? pool : PROJECTS;
  const index = effective.findIndex((p) => p.slug === slug);
  if (index === -1) return { previous: null, next: null };
  return {
    previous: effective[index - 1] ?? null,
    next: effective[index + 1] ?? null,
  };
}

export type Service = {
  name: string;
  value: string;
  description: string;
  deliverables: string[];
  technology: string[];
};
export const SERVICES: Service[] = [
  {
    name: "Web Development",
    value: "web",
    description: "Websites and web applications, from the first wireframe to the production deploy.",
    deliverables: [
      "Marketing and product websites",
      "Full-stack web applications",
      "APIs and integrations",
      "Responsive front ends",
    ],
    technology: ["React", "Next.js", "MERN stack", "REST and GraphQL APIs"],
  },
  {
    name: "Motion & Interaction",
    value: "motion",
    description: "Motion that explains a product, with a reduced-motion version of every moment.",
    deliverables: [
      "Scroll-driven storytelling",
      "Micro-interactions",
      "Animated brand systems",
      "Reduced-motion versions",
    ],
    technology: ["GSAP", "Framer Motion", "Web Animations API", "SVG animation"],
  },
  {
    name: "App & Cloud Solutions",
    value: "cloud",
    description: "Firebase and cloud apps with sign-in, real-time data and functions.",
    deliverables: ["Firebase apps", "Sign-in and accounts", "Real-time data", "Cloud functions"],
    technology: [
      "Firebase Authentication",
      "Cloud Firestore",
      "Cloud Functions",
      "Hosting and CI",
    ],
  },
  {
    name: "Creative Design",
    value: "design",
    description: "Decks, brand assets and campaign visuals a whole team can reuse.",
    deliverables: [
      "Presentation decks",
      "Brand assets",
      "Social and campaign visuals",
      "Visual storytelling",
    ],
    technology: ["Canva", "Figma", "Presentation design", "Brand guidelines"],
  },
  {
    name: "AI & Prompt Engineering",
    value: "ai",
    description: "Prompt systems and small AI tools that fit the way your team already works.",
    deliverables: ["Prompt design", "Workflow automation", "Custom AI tools", "Team training"],
    technology: ["Prompt libraries", "Workflow automation", "Custom AI tools", "Model evaluation"],
  },
];

export const SERVICE_BY_VALUE = new Map(SERVICES.map((s) => [s.value, s]));

export type SkillGroup = { tab: string; cards: { technology: string; level: number }[] };
export const SKILL_GROUPS: SkillGroup[] = [
  {
    tab: "Frontend",
    cards: [
      { technology: "React", level: 92 },
      { technology: "Next.js", level: 88 },
      { technology: "TypeScript", level: 90 },
      { technology: "Accessible HTML and CSS", level: 94 },
    ],
  },
  {
    tab: "Backend",
    cards: [
      { technology: "Node.js", level: 86 },
      { technology: "REST and GraphQL APIs", level: 82 },
      { technology: "PostgreSQL", level: 74 },
      { technology: "MongoDB", level: 70 },
    ],
  },
  {
    tab: "Animation",
    cards: [
      { technology: "GSAP", level: 90 },
      { technology: "Framer Motion", level: 84 },
      { technology: "Web Animations API", level: 80 },
      { technology: "SVG animation", level: 86 },
    ],
  },
  {
    tab: "Cloud",
    cards: [
      { technology: "Firebase Authentication", level: 85 },
      { technology: "Cloud Firestore", level: 83 },
      { technology: "Cloud Functions", level: 78 },
      { technology: "Hosting and CI", level: 72 },
    ],
  },
  {
    tab: "Design",
    cards: [
      { technology: "Canva", level: 88 },
      { technology: "Figma", level: 84 },
      { technology: "Presentation design", level: 90 },
      { technology: "Brand assets", level: 80 },
    ],
  },
  {
    tab: "AI",
    cards: [
      { technology: "Prompt design", level: 87 },
      { technology: "Workflow automation", level: 81 },
      { technology: "Custom AI tools", level: 76 },
      { technology: "Model evaluation", level: 70 },
    ],
  },
];

export const SKILL_LABEL = "Illustrative fluency scores";

/** the single `Used in:` rule: case studies whose stack lists the technology, in project order */
export function usedIn(technology: string): Project[] {
  return PROJECTS.filter((p) => p.stack.includes(technology));
}

export const USED_IN_NONE = "Used in client work not shown here.";

export type Review = { quote: string; name: string; role: string; company: string };
export const REVIEWS: Review[] = [
  {
    quote: "Ottoline rebuilt our booking flow in six weeks, and every screen worked by keyboard on day one.",
    name: "Priya Nandakumar",
    role: "Head of Product",
    company: "Fernway Health",
  },
  {
    quote:
      "We subcontracted the motion on three launches. Each shipped with a reduced-motion version we never had to ask for.",
    name: "Tomas Reyes",
    role: "Creative Director",
    company: "Studio Kettle",
  },
  {
    quote: "The Firebase app went live before our pilot, and the real-time rota has not dropped a shift since.",
    name: "Amara Osei",
    role: "Founder",
    company: "Loomlight",
  },
  {
    quote:
      "Clear estimates, clean pull requests and a dashboard our operations team actually opens every morning.",
    name: "Jonah Feld",
    role: "Engineering Manager",
    company: "Parcelgrid",
  },
  {
    quote: "Ottoline turned our pitch deck and brand assets into one system the whole team can reuse.",
    name: "Elif Durmaz",
    role: "Brand Lead",
    company: "Northcap Coffee",
  },
];

export const REVIEW_NOTE =
  "Illustrative reviews: the clients, quotes and companies are fictional samples.";

export const BUDGETS = [
  { value: "under-5k", label: "Under $5,000" },
  { value: "5k-15k", label: "$5,000 to $15,000" },
  { value: "15k-40k", label: "$15,000 to $40,000" },
  { value: "over-40k", label: "Over $40,000" },
] as const;

export const BUDGET_LABEL = new Map<string, string>(BUDGETS.map((b) => [b.value, b.label]));

export const PROJECT_TYPE_OPTIONS: { value: string; label: string }[] = [
  ...SERVICES.map((s) => ({ value: s.value, label: s.name })),
  { value: "other", label: "Something else" },
];

export const PROJECT_TYPE_LABEL = new Map<string, string>(
  PROJECT_TYPE_OPTIONS.map((o) => [o.value, o.label])
);

export const FIELD_MESSAGES = {
  nameEmpty: "Enter your name.",
  nameLength: "Your name must be 2 to 80 characters.",
  emailEmpty: "Enter your email address.",
  emailShape: "Enter an email address like name@example.com.",
  projectType: "Choose a project type.",
  budget: "Choose a budget range.",
  messageEmpty: "Tell me about your project.",
  messageLength: "Your message must be 20 to 2,000 characters.",
} as const;

export type EnquiryField = "name" | "email" | "projectType" | "budget" | "message";
export const ENQUIRY_FIELDS: EnquiryField[] = ["name", "email", "projectType", "budget", "message"];
export type EnquiryValues = Record<EnquiryField, string>;

/** trim, then collapse every run of spaces, tabs and line breaks in the name to one space */
export function normaliseName(value: string): string {
  return value.trim().replace(/[\s\u00a0]+/g, " ");
}

/** the single enquiry field rule, applied in the browser and again on the server */
export function validateEnquiry(values: EnquiryValues): Partial<Record<EnquiryField, string>> {
  const errors: Partial<Record<EnquiryField, string>> = {};
  const name = normaliseName(values.name);
  if (name.length === 0) errors.name = FIELD_MESSAGES.nameEmpty;
  else if (name.length < 2 || name.length > 80) errors.name = FIELD_MESSAGES.nameLength;

  const email = values.email.trim();
  if (email.length === 0) errors.email = FIELD_MESSAGES.emailEmpty;
  else if (!isEmailShape(email)) errors.email = FIELD_MESSAGES.emailShape;

  if (!PROJECT_TYPE_LABEL.has(values.projectType)) errors.projectType = FIELD_MESSAGES.projectType;
  if (!BUDGET_LABEL.has(values.budget)) errors.budget = FIELD_MESSAGES.budget;

  const message = values.message.trim();
  if (message.length === 0) errors.message = FIELD_MESSAGES.messageEmpty;
  else if (message.length < 20 || message.length > 2000)
    errors.message = FIELD_MESSAGES.messageLength;
  return errors;
}

function isEmailShape(email: string): boolean {
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local.length === 0 || domain.length === 0) return false;
  if (/\s/.test(email)) return false;
  const dot = domain.indexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

export function formStatusText(errorCount: number): string {
  if (errorCount === 0) return "";
  return errorCount === 1 ? "Check the 1 highlighted field." : `Check the ${errorCount} highlighted fields.`;
}

export const ANNOUNCEMENTS = {
  filter: (n: number) => `Showing ${n} of 6 projects.`,
  review: (k: number, review: Review) => `Review ${k} of 5: ${review.name}, ${review.role}, ${review.company}.`,
  enquire: (serviceName: string) => `Project type set to ${serviceName}.`,
  pause: "Role rotation paused.",
  play: "Role rotation resumed.",
  callout: (n: number, label: string) => `Callout ${n} of 3: ${label}.`,
  calloutCleared: "Callout cleared.",
  retryOk: "The preview frame is back.",
  retryFail: "The preview frame is still unavailable.",
  mediaBack: "Project images are back.",
  mediaNotice: "Project images are unavailable right now. Every page still works.",
} as const;

export function filterResultsText(shown: number): string {
  return `Showing ${shown} of 6 projects.`;
}

export const FRAME_KEYS_PER_PROJECT = 6;

export function frameKey(slug: string, frame: number): string {
  return `work/${slug}/frame-${frame}`;
}

export function coverKey(slug: string): string {
  return `work/${slug}/cover`;
}

export const SOCIAL_LINKS = [
  { label: "Ottoline Rask on GitHub", href: "https://github.example/ottolinerask" },
  { label: "Ottoline Rask on LinkedIn", href: "https://linkedin.example/in/ottolinerask" },
  { label: "Ottoline Rask on Dribbble", href: "https://dribbble.example/ottolinerask" },
] as const;
