import type { Content, Project, Statistic } from "./model.js";

export const INTRO_LINES = ["Clear brands.", "Considered websites.", "Products people keep."] as const;

export const INTRO_TEXT =
  "Maren Sollis is an independent designer working across brand identity, website design and digital product design.";

export const ABOUT = {
  heading: "About Maren",
  paragraphs: [
    "I am Maren Sollis, an independent designer. For twelve years I have helped companies find a clear voice and give it a form, from the first mark to the last screen.",
    "I work alone on purpose: the person you brief is the person who designs, and I take on four engagements a year.",
  ],
  background: [
    "2014 to 2017 · Designer, Hallam Pike Studio, Bristol",
    "2017 to 2021 · Senior brand designer, Northgate Type Office, Rotterdam",
    "2021 to now · Independent, Sollis Studio, London",
  ],
} as const;

export const SERVICES_INTRO = "Three services, one designer from the first workshop to the handover.";
export const WORK_HEADING = "Selected work";
export const PHILOSOPHY_HEADING = "How I work";
export const CONTACT_HEADING = "Start a project";
export const CONTACT_INTRO = "Tell me about the work. I reply to every enquiry within two working days.";
export const STUDIO_ADDRESS = "London, working worldwide";
export const STUDIO_PHONE = "+44 20 7946 0321";
export const STUDIO_PHONE_HREF = "tel:+442079460321";
export const STUDIO_EMAIL = "studio@sollis.example";

export const PRINCIPLES = [
  {
    heading: "Say one thing well.",
    text: "Every identity, page and screen makes one clear promise before it makes a second.",
  },
  {
    heading: "Design the system, not the sample.",
    text: "A logo, a homepage or a screen is the first use of a system your team will keep using.",
  },
  {
    heading: "Leave it documented.",
    text: "Every project ends with guidelines the next designer can follow without calling me.",
  },
] as const;

export const PROCESS_STEPS = [
  { name: "Discover", weeks: "Weeks 1 to 2", text: "Interviews, an audit of what exists and a written brief we both sign." },
  { name: "Define", weeks: "Weeks 3 to 4", text: "Positioning, principles and the measures we will judge the work by." },
  { name: "Design", weeks: "Weeks 5 to 9", text: "Two directions, one chosen, then refined in weekly reviews." },
  { name: "Deliver", weeks: "Weeks 10 to 12", text: "Final files, guidelines and a handover session with your team." },
] as const;

export const SERVICES = [
  {
    id: "brand-identity",
    name: "Brand Identity",
    summary: "Names, marks and systems that let a company sound and look like itself everywhere.",
    capabilities: [
      "Brand strategy workshops",
      "Naming and verbal identity",
      "Logo and wordmark design",
      "Typography and colour systems",
      "Brand guidelines",
    ],
    deliverables: [
      "Logo suite in SVG and PNG",
      "Colour and type specification",
      "Brand guidelines PDF, 40 to 60 pages",
      "Stationery and social templates",
    ],
    engagement: "6 to 10 weeks",
  },
  {
    id: "website-design",
    name: "Website Design",
    summary: "Editorial, fast websites that carry a brand's voice and are easy for your team to keep up to date.",
    capabilities: [
      "Site architecture and content design",
      "Art direction and page design",
      "Motion and interaction design",
      "Accessibility review to WCAG 2.2 AA",
      "Design system for the build team",
    ],
    deliverables: [
      "Sitemap and page templates",
      "Desktop, tablet and phone designs",
      "Interactive prototype",
      "Component library with usage notes",
    ],
    engagement: "8 to 12 weeks",
  },
  {
    id: "digital-product-design",
    name: "Digital Product Design",
    summary: "Clear, testable product interfaces, from first flows to a design system your team can grow.",
    capabilities: [
      "Product discovery and research",
      "User flows and information architecture",
      "Interface design",
      "Usability testing",
      "Design systems",
    ],
    deliverables: [
      "Research summary",
      "User flows and wireframes",
      "High-fidelity screens",
      "Clickable prototype",
      "Design system library",
    ],
    engagement: "10 to 16 weeks",
  },
] as const;

export const FOOTER = {
  name: "Sollis Studio",
  fiction: "Maren Sollis and every client named on this site are fictional.",
  copyright: "© 2026 Sollis Studio. All rights reserved.",
} as const;

export const PRIVACY = {
  paragraphs: [
    "This site keeps the enquiries you send: your name, email, project type, budget range and description.",
    "Enquiries are used only to reply to you and are deleted after 24 months.",
    "The site sets no cookies and uses no analytics.",
  ],
  backLink: "Back to Sollis Studio",
} as const;

export const NOT_FOUND = {
  project: { heading: "This project does not exist.", link: "All work" },
  page: { heading: "This page does not exist.", link: "Back to Sollis Studio" },
} as const;

export const BRIEF_UNAVAILABLE = {
  heading: "Your brief PDF is not available right now.",
  line: (reference: string): string => `Your enquiry ${reference} is saved. Try the download again in a few minutes.`,
} as const;

const seedProjects: Project[] = [
  {
    slug: "harbour-loom",
    title: "Harbour Loom",
    client: "Harbour Loom Textiles",
    category: "brand-identity",
    year: 2025,
    hue: 205,
    motif: "arcs",
    role: "Creative direction and identity design",
    duration: "9 weeks",
    standfirst: "A heritage weaving mill renamed and re-marked for its first range sold straight to customers.",
    overview:
      "The mill had sold cloth to other brands for ninety years under a family name nobody outside the trade knew. We chose a new name, drew a mark from the path of the loom's shuttle and built a system for labels, swing tags and the shop.",
    objectives: [
      "Give the mill a name customers can say and remember.",
      "Make the mark work stitched, printed and on screen.",
      "Hand over a system the in-house team can run alone.",
    ],
    palette: [
      { name: "Harbour blue", hex: "#1F3A5F" },
      { name: "Undyed wool", hex: "#E9E2D0" },
      { name: "Signal coral", hex: "#D9583B" },
    ],
    screens: [{ caption: "Swing tag and woven label" }, { caption: "Shop front and window lettering" }, { caption: "Online shop header" }],
    process: [2, 2, 3, 2],
    results: [
      { value: "+64%", label: "return visits to the shop in the first six months" },
      { value: "11", label: "stockists added in the first year" },
      { value: "1", label: "system used across tags, signs and web" },
    ],
  },
  {
    slug: "northlight-gallery",
    title: "Northlight Gallery",
    client: "Northlight Gallery",
    category: "website-design",
    year: 2025,
    hue: 265,
    motif: "grid",
    role: "Website design and art direction",
    duration: "12 weeks",
    standfirst: "An exhibition-first website where every show gets its own page rhythm.",
    overview:
      "The gallery's old site listed shows like products. The new site gives each exhibition a long page whose type, colour and image rhythm follow the work, while visiting hours and tickets stay in the same place on every page.",
    objectives: [
      "Let each exhibition look like itself.",
      "Keep visiting information one tap away on every page.",
      "Let the curators build a show page without a developer.",
    ],
    palette: [
      { name: "Gallery night", hex: "#1C1A2E" },
      { name: "Wall white", hex: "#F5F3EE" },
      { name: "Northlight violet", hex: "#6B5BD6" },
    ],
    screens: [{ caption: "Exhibition page opening" }, { caption: "Visit and tickets panel" }, { caption: "Archive of past shows" }],
    process: [2, 2, 6, 2],
    results: [
      { value: "+41%", label: "time spent on exhibition pages" },
      { value: "2 hours", label: "for a curator to build a show page" },
      { value: "0", label: "accessibility errors on the templates at launch" },
    ],
  },
  {
    slug: "ledgerline",
    title: "Ledgerline",
    client: "Ledgerline Ltd",
    category: "digital-product-design",
    year: 2025,
    hue: 170,
    motif: "grid",
    role: "Product design lead",
    duration: "14 weeks",
    standfirst: "A calmer invoicing app for freelancers, redesigned around the first five minutes.",
    overview:
      "Most new users left before sending their first invoice. We rebuilt sign-up around one task, sending an invoice, moved every other setting to after it, then built a design system so the team could ship the rest.",
    objectives: [
      "Get a new user to their first sent invoice in five minutes.",
      "Cut support questions about setup.",
      "Give the team a design system they can extend.",
    ],
    palette: [
      { name: "Ledger teal", hex: "#1F6F6B" },
      { name: "Cloud", hex: "#F4F6F5" },
      { name: "Amber", hex: "#E0A43A" },
    ],
    screens: [{ caption: "First invoice flow" }, { caption: "Invoice list with paid and overdue states" }, { caption: "Design system components" }],
    process: [3, 2, 7, 2],
    results: [
      { value: "5 min", label: "median time to the first sent invoice" },
      { value: "-35%", label: "setup questions to support" },
      { value: "120", label: "components in the design system" },
    ],
  },
  {
    slug: "quarry-press",
    title: "Quarry Press",
    client: "Quarry Press",
    category: "brand-identity",
    year: 2024,
    hue: 28,
    motif: "grid",
    role: "Identity design and typography",
    duration: "7 weeks",
    standfirst: "An identity system for a small publisher of field guides, built from one condensed serif.",
    overview:
      "Quarry Press publishes twelve field guides a year and every cover looked different. One condensed serif, a strict cover grid and a colour per subject now make the shelf read as one list.",
    objectives: [
      "Make every guide recognisable from across a shop.",
      "Let the designer set a new cover in a day.",
      "Keep the cost of colour printing flat.",
    ],
    palette: [
      { name: "Slate", hex: "#2E3338" },
      { name: "Limestone", hex: "#EDE8DC" },
      { name: "Ochre", hex: "#C8902E" },
    ],
    screens: [{ caption: "Cover grid for the field guides" }, { caption: "Spine system on the shelf" }, { caption: "Catalogue spread" }],
    process: [1, 2, 3, 1],
    results: [
      { value: "12", label: "covers set in the new system in its first year" },
      { value: "1 day", label: "to set a new cover, down from a week" },
      { value: "+22%", label: "bookshop orders for the spring list" },
    ],
  },
  {
    slug: "fieldwork-journal",
    title: "Fieldwork Journal",
    client: "Fieldwork Institute",
    category: "website-design",
    year: 2024,
    hue: 50,
    motif: "arcs",
    role: "Website design and content design",
    duration: "10 weeks",
    standfirst: "A long-read site for a research institute, set for comfortable reading on any screen.",
    overview:
      "The institute's reports lived in PDFs few people opened. Fieldwork Journal turns each report into a readable web essay with footnotes beside the text, figures that resize cleanly and a download for the full report.",
    objectives: [
      "Get the reports read, not just downloaded.",
      "Make footnotes and figures work on a phone.",
      "Publish a new essay from the institute's own editor.",
    ],
    palette: [
      { name: "Ink", hex: "#22201C" },
      { name: "Paper", hex: "#F6F1E7" },
      { name: "Field yellow", hex: "#D8A520" },
    ],
    screens: [{ caption: "Essay opening with standfirst" }, { caption: "Footnotes beside the text" }, { caption: "Figure on a phone" }],
    process: [2, 1, 5, 2],
    results: [
      { value: "3x", label: "average reading time per essay" },
      { value: "58%", label: "of readers on phones finishing an essay" },
      { value: "24", label: "essays published in the first year" },
    ],
  },
  {
    slug: "pathway-transit",
    title: "Pathway",
    client: "Pathway Transit Authority",
    category: "digital-product-design",
    year: 2024,
    hue: 220,
    motif: "arcs",
    role: "Product design and usability testing",
    duration: "16 weeks",
    standfirst: "A journey planner that puts the next departure and step-free routes first.",
    overview:
      "Riders asked one question, when does the next one leave, and the old app answered it three screens deep. Pathway opens on the nearest stops with live departures and offers step-free routes from the first screen.",
    objectives: [
      "Show the next departure on the first screen.",
      "Make step-free routes a first-class choice.",
      "Pass usability tests with riders who use screen readers.",
    ],
    palette: [
      { name: "Route blue", hex: "#1D4E89" },
      { name: "Platform grey", hex: "#E6E8EB" },
      { name: "Signal yellow", hex: "#F2C230" },
    ],
    screens: [{ caption: "Nearest stops with live departures" }, { caption: "Step-free route options" }, { caption: "Trip in progress" }],
    process: [4, 2, 8, 2],
    results: [
      { value: "1", label: "screen to the next departure, down from 3" },
      { value: "92%", label: "task success in tests with screen reader users" },
      { value: "+30%", label: "weekly riders using the app" },
    ],
  },
  {
    slug: "tidewater-co-op",
    title: "Tidewater Co-op",
    client: "Tidewater Grocery Co-operative",
    category: "brand-identity",
    year: 2023,
    hue: 140,
    motif: "stack",
    role: "Identity and signage design",
    duration: "10 weeks",
    standfirst: "A friendlier mark and signage family for a member-owned grocer with eleven stores.",
    overview:
      "Members said the old signs felt like a discount warehouse. A rounded wordmark, drawn produce icons and a signage kit that store staff can print themselves changed the feel of all eleven stores in one spring.",
    objectives: [
      "Make the co-op feel owned by its members, not a chain.",
      "Give staff signs they can print and change in store.",
      "Keep every sign readable from the end of an aisle.",
    ],
    palette: [
      { name: "Kelp green", hex: "#2F6B4F" },
      { name: "Oat", hex: "#F2EAD8" },
      { name: "Tomato", hex: "#C8402F" },
    ],
    screens: [{ caption: "Store front at dusk" }, { caption: "Aisle signs and shelf labels" }, { caption: "Member card" }],
    process: [2, 2, 4, 2],
    results: [
      { value: "11", label: "stores re-signed in one spring" },
      { value: "+18%", label: "new members in the first year" },
      { value: "40", label: "sign templates staff print themselves" },
    ],
  },
  {
    slug: "ostler-hotels",
    title: "Ostler Hotels",
    client: "Ostler Hotel Group",
    category: "website-design",
    year: 2022,
    hue: 350,
    motif: "stack",
    role: "Website design and design system",
    duration: "11 weeks",
    standfirst: "A booking-led website for four small hotels that each keep their own character.",
    overview:
      "Four hotels shared one template and looked identical. A shared design system with a palette and picture style per hotel lets each one look like itself, while booking works the same way everywhere.",
    objectives: [
      "Give each hotel its own look inside one system.",
      "Make booking two steps from any page.",
      "Cut the cost of adding a fifth hotel.",
    ],
    palette: [
      { name: "Claret", hex: "#7A1F2B" },
      { name: "Linen", hex: "#F3ECE2" },
      { name: "Brass", hex: "#B08A3E" },
    ],
    screens: [{ caption: "Hotel home page" }, { caption: "Room chooser" }, { caption: "Booking summary on a phone" }],
    process: [2, 2, 5, 2],
    results: [
      { value: "+27%", label: "direct bookings in the first year" },
      { value: "2", label: "steps from any page to a booking" },
      { value: "3 weeks", label: "to add a hotel to the system" },
    ],
  },
  {
    slug: "tally-kitchen",
    title: "Tally",
    client: "Tally Kitchen Systems",
    category: "digital-product-design",
    year: 2023,
    hue: 15,
    motif: "stack",
    role: "Product and interface design",
    duration: "12 weeks",
    standfirst: "An order screen for busy kitchens, readable at arm's length and usable with wet hands.",
    overview:
      "Cooks read orders from two metres away while plating. Tally uses large type, colour plus shape for each course and wide touch zones, so an order can be cleared with a knuckle.",
    objectives: [
      "Make every order readable from two metres.",
      "Never rely on colour alone for course or status.",
      "Let a cook clear an order without precise taps.",
    ],
    palette: [
      { name: "Char", hex: "#1E1B18" },
      { name: "Steel", hex: "#DADDE0" },
      { name: "Flame", hex: "#E2572B" },
    ],
    screens: [{ caption: "Order rail at service" }, { caption: "Course markers in colour and shape" }, { caption: "Clear and recall" }],
    process: [3, 2, 5, 2],
    results: [
      { value: "2 m", label: "reading distance for every order" },
      { value: "-48%", label: "missed course changes" },
      { value: "64 px", label: "minimum touch zone" },
    ],
  },
];

const seedStats: Statistic[] = [
  {
    id: "years",
    value: 12,
    label: "years of practice",
    note: "In practice since 2014: seven years in studios, five independent.",
    parts: [
      { label: "In studios", value: 7 },
      { label: "Independent", value: 5 },
    ],
  },
  {
    id: "projects",
    value: 140,
    label: "projects delivered",
    note: "Across the three services since 2014.",
    parts: [
      { label: "Brand Identity", value: 58 },
      { label: "Website Design", value: 47 },
      { label: "Digital Product Design", value: 35 },
    ],
  },
  {
    id: "identities",
    value: 38,
    label: "brand identities launched",
    note: "Identities now in use, by company size.",
    parts: [
      { label: "Over 250 people", value: 21 },
      { label: "250 people or fewer", value: 17 },
    ],
  },
  {
    id: "awards",
    value: 9,
    label: "design awards",
    note: "Juried awards, by discipline.",
    parts: [
      { label: "Type", value: 4 },
      { label: "Web", value: 3 },
      { label: "Product", value: 2 },
    ],
  },
];

export const SEED_CONTENT: Content = { projects: seedProjects, stats: seedStats };
