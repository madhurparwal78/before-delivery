/** Seed data of the portfolio. Every person, business, client, review, figure and milestone is invented and illustrative. */

export type DisciplineValue = "web" | "motion" | "cloud" | "data" | "design" | "ai";

interface Discipline {
  readonly value: DisciplineValue;
  readonly name: string;
}

/** Canonical order of the disciplines: filter buttons, address values and card listings all follow it. */
export const DISCIPLINES: readonly Discipline[] = [
  { value: "web", name: "Web" },
  { value: "motion", name: "Motion" },
  { value: "cloud", name: "Cloud" },
  { value: "data", name: "Data" },
  { value: "design", name: "Design" },
  { value: "ai", name: "AI" },
];

export const ROLES: readonly string[] = [
  "full-stack developer",
  "motion engineer",
  "Firebase app builder",
  "creative designer",
  "presentation designer",
  "prompt engineer",
];

export const ROLES_SUMMARY =
  "I work as a full-stack developer, motion engineer, Firebase app builder, creative designer, presentation designer and prompt engineer.";

export const WORKING_PRINCIPLES: readonly string[] = [
  "Ship the boring parts well.",
  "Motion explains, never decorates.",
  "Every screen works without a mouse.",
  "Measure before you polish.",
];

export const AREAS_OF_EXPERTISE: readonly string[] = [
  "Full-stack web development",
  "Motion and interaction",
  "Firebase and cloud apps",
  "Creative and presentation design",
  "AI-assisted workflows",
];

export interface Milestone {
  readonly year: string;
  readonly title: string;
  readonly detail: string;
}

export const MILESTONES: readonly Milestone[] = [
  { year: "2017", title: "First freelance website", detail: "Built a booking site for a local bakery and learned that the boring parts decide whether a site gets used." },
  { year: "2019", title: "Front-end lead at a product studio", detail: "Led the front end for a team of four and set up the studio's first accessibility checks." },
  { year: "2021", title: "Went independent", detail: "Started Quillfern Works to take on motion and full-stack builds directly for agencies and founders." },
  { year: "2023", title: "First real-time cloud app in production", detail: "Shipped a real-time volunteer roster that coordinators now run every weekend." },
  { year: "2025", title: "AI-assisted tools for design teams", detail: "Began building AI-assisted tools that help design teams repeat and share their best work." },
];

type CounterKey = "years" | "led" | "projects" | "technologies" | "awards" | "satisfaction";

export interface Counter {
  readonly key: CounterKey;
  readonly label: string;
  readonly target: number;
  readonly suffix: string;
}

export const ABOUT_COUNTERS: readonly Counter[] = [
  { key: "years", label: "Years building for the web", target: 9, suffix: "" },
  { key: "led", label: "Projects led end to end", target: 31, suffix: "" },
];

export const NUMBERS_COUNTERS: readonly Counter[] = [
  { key: "projects", label: "Projects delivered", target: 48, suffix: "" },
  { key: "technologies", label: "Technologies in use", target: 26, suffix: "" },
  { key: "awards", label: "Awards and mentions", target: 7, suffix: "" },
  { key: "satisfaction", label: "Client satisfaction", target: 98, suffix: "%" },
];

export interface Callout {
  readonly label: string;
  readonly firstFrame: number;
  readonly lastFrame: number;
  /** left, top, width, height in percent of the frame box */
  readonly region: readonly [number, number, number, number];
}

type CalloutTriple = readonly [Callout, Callout, Callout];

export interface Project {
  readonly slug: string;
  readonly title: string;
  readonly kind: string;
  readonly client: string;
  readonly year: string;
  readonly role: string;
  readonly disciplines: readonly DisciplineValue[];
  readonly stack: readonly string[];
  readonly callouts: CalloutTriple;
  readonly overview: string;
  readonly challenge: string;
  readonly solution: string;
  readonly decisions: string;
}

export const PROJECTS: readonly Project[] = [
  {
    slug: "hollis-atelier",
    title: "Hollis Atelier",
    kind: "Architecture and creative portfolio website",
    client: "Hollis Atelier",
    year: "2025",
    role: "Design and build",
    disciplines: ["web", "design"],
    stack: ["Next.js", "TypeScript", "Accessible HTML and CSS", "Figma", "Brand assets"],
    callouts: [
      { label: "Plan-to-photo wipe", firstFrame: 1, lastFrame: 3, region: [8, 12, 46, 60] },
      { label: "Project index rail", firstFrame: 3, lastFrame: 4, region: [70, 10, 22, 80] },
      { label: "Material swatch reveal", firstFrame: 4, lastFrame: 6, region: [12, 70, 60, 20] },
    ],
    overview: "Hollis Atelier is a small architecture practice that wanted its portfolio to feel like walking through a set of drawings. I designed and built the site end to end.",
    challenge: "Hundreds of plans and photographs, no way to show how a drawing became a building, and an old site that could not be used without a mouse.",
    solution: "Each project wipes from plan to finished photograph as the reader moves through it, with a project index rail always in reach and every control usable by keyboard.",
    decisions: "The wipe follows the reader's scroll instead of a timer, so nobody waits for it. With reduced motion, the plan and the photograph sit side by side.",
  },
  {
    slug: "foundry-loop",
    title: "Foundry Loop",
    kind: "Animated studio website",
    client: "Foundry Loop",
    year: "2024",
    role: "Motion and front-end build",
    disciplines: ["web", "motion"],
    stack: ["TypeScript", "GSAP", "SVG animation", "Web Animations API", "Figma"],
    callouts: [
      { label: "Reel scrubber", firstFrame: 1, lastFrame: 2, region: [10, 70, 80, 18] },
      { label: "Letterform morph", firstFrame: 2, lastFrame: 5, region: [15, 15, 55, 45] },
      { label: "Team grid hover", firstFrame: 5, lastFrame: 6, region: [60, 40, 32, 44] },
    ],
    overview: "Foundry Loop is a motion studio that subcontracted me to build its site around its reel. I owned the motion system and the front-end build, and the studio's designers owned the art direction.",
    challenge: "A single reel hid which shots were whose, and the logo's letterforms had to move without becoming unreadable.",
    solution: "A scrubbable reel stops on any shot and shows its credits, the letterforms morph between weights, and the team grid reveals each person's role on hover and on focus.",
    decisions: "Every animation has a reduced-motion version that shows its end state at once, and the scrubber works with the arrow keys.",
  },
  {
    slug: "tallyhouse",
    title: "Tallyhouse",
    kind: "Full-stack web application",
    client: "Tallyhouse Collective",
    year: "2024",
    role: "Full-stack build",
    disciplines: ["web", "data"],
    stack: ["React", "Node.js", "PostgreSQL", "REST and GraphQL APIs", "TypeScript"],
    callouts: [
      { label: "Booking calendar", firstFrame: 1, lastFrame: 2, region: [6, 14, 52, 58] },
      { label: "Invoice builder", firstFrame: 3, lastFrame: 4, region: [62, 14, 32, 58] },
      { label: "Usage chart", firstFrame: 5, lastFrame: 6, region: [6, 76, 88, 18] },
    ],
    overview: "Tallyhouse Collective runs shared workshops and needed one place to book rooms, bill members and see usage. I built the application from the data model up.",
    challenge: "Bookings, invoices and usage lived in three spreadsheets that disagreed every month.",
    solution: "A booking calendar, an invoice builder and a usage chart share one data model, so a confirmed booking becomes a line on the next invoice.",
    decisions: "Invoices are built from confirmed bookings only, and the calendar reads as a table to screen readers.",
  },
  {
    slug: "pulse-roster",
    title: "Pulse Roster",
    kind: "Firebase-powered application",
    client: "Pulse Volunteers",
    year: "2023",
    role: "App and cloud build",
    disciplines: ["web", "cloud"],
    stack: ["React", "Firebase Authentication", "Cloud Firestore", "Cloud Functions", "Hosting and CI"],
    callouts: [
      { label: "Live shift board", firstFrame: 1, lastFrame: 3, region: [8, 10, 84, 50] },
      { label: "Sign-in screen", firstFrame: 3, lastFrame: 4, region: [30, 20, 40, 60] },
      { label: "Swap request flow", firstFrame: 4, lastFrame: 6, region: [10, 64, 80, 28] },
    ],
    overview: "Pulse Volunteers coordinates shifts for community events. I built a real-time roster that volunteers open on their phones.",
    challenge: "Shift changes went out by group message and arrived after the shift had started.",
    solution: "A live shift board updates the moment someone signs up or swaps, behind a simple sign-in screen, and a swap request flow trades shifts with one tap each.",
    decisions: "The board keeps working on a weak connection and catches up when it returns, and every status is written in words as well as colour.",
  },
  {
    slug: "tidegauge",
    title: "Tidegauge",
    kind: "Interactive dashboard",
    client: "Tidegauge Analytics",
    year: "2025",
    role: "Dashboard design and build",
    disciplines: ["motion", "data"],
    stack: ["TypeScript", "React", "Framer Motion", "Node.js", "MongoDB"],
    callouts: [
      { label: "Streaming tide chart", firstFrame: 1, lastFrame: 4, region: [6, 18, 62, 56] },
      { label: "Station picker", firstFrame: 4, lastFrame: 5, region: [72, 18, 22, 56] },
      { label: "Alert timeline", firstFrame: 5, lastFrame: 6, region: [6, 80, 88, 14] },
    ],
    overview: "Tidegauge Analytics sells tide and water-level data to harbour operators. I designed and built the dashboard they watch through a shift.",
    challenge: "Readings arrive every few seconds from dozens of stations, and the old charts redrew so often that operators lost their place.",
    solution: "A streaming tide chart adds new readings without redrawing the view, a station picker keeps chosen stations in reach, and an alert timeline sits under the chart.",
    decisions: "Only new readings animate, never the axes, and operators can pause the stream to read a moment.",
  },
  {
    slug: "promptloom",
    title: "Promptloom",
    kind: "AI-assisted creative tool",
    client: "Promptloom Labs",
    year: "2026",
    role: "Product design and AI build",
    disciplines: ["design", "ai"],
    stack: ["Prompt design", "Workflow automation", "Custom AI tools", "Canva", "Presentation design"],
    callouts: [
      { label: "Prompt recipe editor", firstFrame: 1, lastFrame: 2, region: [6, 12, 40, 70] },
      { label: "Moodboard canvas", firstFrame: 2, lastFrame: 5, region: [50, 12, 44, 70] },
      { label: "Export to slides", firstFrame: 5, lastFrame: 6, region: [6, 86, 88, 10] },
    ],
    overview: "Promptloom Labs builds tools for design teams that use AI every day. I designed the product and built its prompt and export features.",
    challenge: "Designers kept prompts in scattered notes and could not repeat a result they liked.",
    solution: "A prompt recipe editor saves reusable recipes, a moodboard canvas gathers the results, and one export turns a board into slides.",
    decisions: "Every generated image keeps the recipe that made it, and the editor is fully usable by keyboard.",
  },
];

export const FRAMES_PER_PROJECT = 6;

export interface Service {
  readonly value: Exclude<DisciplineValue, "data">;
  readonly name: string;
  readonly description: string;
  readonly deliverables: readonly string[];
  readonly technology: readonly string[];
}

export const SERVICES: readonly Service[] = [
  {
    value: "web",
    name: "Web Development",
    description: "Websites and web applications, from the first wireframe to the production deploy.",
    deliverables: ["Marketing and product websites", "Full-stack web applications", "APIs and integrations", "Responsive front ends"],
    technology: ["React", "Next.js", "MERN stack", "REST and GraphQL APIs"],
  },
  {
    value: "motion",
    name: "Motion & Interaction",
    description: "Motion that explains a product, with a reduced-motion version of every moment.",
    deliverables: ["Scroll-driven storytelling", "Micro-interactions", "Animated brand systems", "Reduced-motion versions"],
    technology: ["GSAP", "Framer Motion", "Web Animations API", "SVG animation"],
  },
  {
    value: "cloud",
    name: "App & Cloud Solutions",
    description: "Firebase and cloud apps with sign-in, real-time data and functions.",
    deliverables: ["Firebase apps", "Sign-in and accounts", "Real-time data", "Cloud functions"],
    technology: ["Firebase Authentication", "Cloud Firestore", "Cloud Functions", "Hosting and CI"],
  },
  {
    value: "design",
    name: "Creative Design",
    description: "Decks, brand assets and campaign visuals a whole team can reuse.",
    deliverables: ["Presentation decks", "Brand assets", "Social and campaign visuals", "Visual storytelling"],
    technology: ["Canva", "Figma", "Presentation design", "Brand guidelines"],
  },
  {
    value: "ai",
    name: "AI & Prompt Engineering",
    description: "Prompt systems and small AI tools that fit the way your team already works.",
    deliverables: ["Prompt design", "Workflow automation", "Custom AI tools", "Team training"],
    technology: ["Prompt libraries", "Workflow automation", "Custom AI tools", "Model evaluation"],
  },
];

interface SkillCard {
  readonly technology: string;
  readonly level: number;
}

interface SkillGroup {
  readonly name: string;
  readonly cards: readonly SkillCard[];
}

export const SKILL_GROUPS: readonly SkillGroup[] = [
  { name: "Frontend", cards: [{ technology: "React", level: 92 }, { technology: "Next.js", level: 88 }, { technology: "TypeScript", level: 90 }, { technology: "Accessible HTML and CSS", level: 94 }] },
  { name: "Backend", cards: [{ technology: "Node.js", level: 86 }, { technology: "REST and GraphQL APIs", level: 82 }, { technology: "PostgreSQL", level: 74 }, { technology: "MongoDB", level: 70 }] },
  { name: "Animation", cards: [{ technology: "GSAP", level: 90 }, { technology: "Framer Motion", level: 84 }, { technology: "Web Animations API", level: 80 }, { technology: "SVG animation", level: 86 }] },
  { name: "Cloud", cards: [{ technology: "Firebase Authentication", level: 85 }, { technology: "Cloud Firestore", level: 83 }, { technology: "Cloud Functions", level: 78 }, { technology: "Hosting and CI", level: 72 }] },
  { name: "Design", cards: [{ technology: "Canva", level: 88 }, { technology: "Figma", level: 84 }, { technology: "Presentation design", level: 90 }, { technology: "Brand assets", level: 80 }] },
  { name: "AI", cards: [{ technology: "Prompt design", level: 87 }, { technology: "Workflow automation", level: 81 }, { technology: "Custom AI tools", level: 76 }, { technology: "Model evaluation", level: 70 }] },
];

export interface Review {
  readonly quote: string;
  readonly name: string;
  readonly role: string;
  readonly company: string;
}

export const REVIEWS: readonly Review[] = [
  { quote: "Ottoline rebuilt our booking flow in six weeks, and every screen worked by keyboard on day one.", name: "Priya Nandakumar", role: "Head of Product", company: "Fernway Health" },
  { quote: "We subcontracted the motion on three launches. Each shipped with a reduced-motion version we never had to ask for.", name: "Tomas Reyes", role: "Creative Director", company: "Studio Kettle" },
  { quote: "The Firebase app went live before our pilot, and the real-time rota has not dropped a shift since.", name: "Amara Osei", role: "Founder", company: "Loomlight" },
  { quote: "Clear estimates, clean pull requests and a dashboard our operations team actually opens every morning.", name: "Jonah Feld", role: "Engineering Manager", company: "Parcelgrid" },
  { quote: "Ottoline turned our pitch deck and brand assets into one system the whole team can reuse.", name: "Elif Durmaz", role: "Brand Lead", company: "Northcap Coffee" },
];

type SectionId = "intro" | "about" | "work" | "services" | "skills" | "reviews" | "numbers" | "contact";

export const NAV_SECTIONS: readonly { readonly id: SectionId; readonly label: string }[] = [
  { id: "about", label: "About" },
  { id: "work", label: "Work" },
  { id: "services", label: "Services" },
  { id: "skills", label: "Skills" },
  { id: "reviews", label: "Reviews" },
  { id: "contact", label: "Contact" },
];

export const CASE_STUDY_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "challenge", label: "The challenge" },
  { id: "solution", label: "The solution" },
  { id: "decisions", label: "Design decisions" },
  { id: "stack", label: "Technology stack" },
] as const;

export const STUDIO_EMAIL = "hello@ottolinerask.example";

export const SOCIAL_LINKS = [
  { name: "GitHub", href: "https://github.example/ottolinerask" },
  { name: "LinkedIn", href: "https://linkedin.example/in/ottolinerask" },
  { name: "Dribbble", href: "https://dribbble.example/ottolinerask" },
] as const;

export const SERVICE_PARAM = "service";

export function serviceByValue(value: string | null): Service | undefined {
  return SERVICES.find((service) => service.value === value);
}

export function projectBySlug(slug: string): Project | undefined {
  return PROJECTS.find((project) => project.slug === slug);
}

/** The project a page's own markup names; a slug outside the seed data cannot appear there. */
export function knownProject(slug: string): Project {
  const project = projectBySlug(slug);
  if (project === undefined) throw new Error(`Unknown project: ${slug}`);
  return project;
}

export function disciplineName(value: DisciplineValue): string {
  return DISCIPLINES.find((discipline) => discipline.value === value)?.name ?? value;
}
