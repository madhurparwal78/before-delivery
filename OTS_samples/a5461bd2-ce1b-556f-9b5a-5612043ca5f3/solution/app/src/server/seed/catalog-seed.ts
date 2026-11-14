import type { DesignDecision, Industry, PriceItem, ProcessStep, Question, Studio } from "../../shared/types";

export const INDUSTRY_SEED: Industry[] = [
  { id: "finance", name: "Finance and professional services" },
  { id: "food", name: "Food, coffee and hospitality" },
  { id: "architecture", name: "Architecture and real estate" },
  { id: "technology", name: "Technology and software" },
  { id: "lifestyle", name: "Lifestyle and personal care" },
  { id: "film", name: "Film and creative production" },
  { id: "consumer", name: "Consumer products" },
  { id: "experimental", name: "Experimental" },
];

interface ServiceSeed {
  id: string;
  name: string;
  purpose: string;
  deliverables: string[];
  steps: ProcessStep[];
}

export const SERVICE_SEED: ServiceSeed[] = [
  {
    id: "brand-identity",
    name: "Brand identity",
    purpose: "A brand identity gives your business one recognisable look and voice, from the logo to the way you write an invoice.",
    deliverables: ["Logo and wordmark", "Colour palette and type pairing", "Brand guidelines book", "Stationery templates"],
    steps: [
      { name: "Discovery", text: "We talk with the founders and a few customers to learn what the business stands for." },
      { name: "Strategy", text: "We agree on positioning and a short list of words the brand must feel like." },
      { name: "Design", text: "We present two routes, then develop the chosen one into a full system." },
      { name: "Guidelines", text: "We hand over files and a guidelines book so anyone can use the brand well." },
    ],
  },
  {
    id: "framer-websites",
    name: "Framer websites",
    purpose: "A Framer website is fast to launch and easy for you to edit, with designed pages rather than a template.",
    deliverables: ["Site map and page wireframes", "Designed pages for phone and desktop", "Built Framer site with editable content", "Launch and handover session"],
    steps: [
      { name: "Map", text: "We list every page and what each must help a visitor do." },
      { name: "Design", text: "We design the pages for phone and desktop in your brand." },
      { name: "Build", text: "We build the site in Framer and connect your domain." },
      { name: "Launch", text: "We launch, then walk you through editing your own pages." },
    ],
  },
  {
    id: "shopify-stores",
    name: "Shopify stores",
    purpose: "A Shopify store designed around how your customers actually choose and buy your products.",
    deliverables: ["Store structure and product page design", "Theme setup or custom theme", "Payment, shipping and tax settings", "Training for your team"],
    steps: [
      { name: "Audit", text: "We review your products, prices and how orders reach you today." },
      { name: "Structure", text: "We plan collections, filters and product pages." },
      { name: "Build", text: "We design and build the store and load your first products." },
      { name: "Train", text: "We train your team to add products and handle orders." },
    ],
  },
  {
    id: "packaging",
    name: "Packaging",
    purpose: "Packaging that stands out on a shelf, explains the product and prints well at your printer.",
    deliverables: ["Pack structure and dieline", "Front, back and side artwork", "Print-ready files", "Printer proof check"],
    steps: [
      { name: "Shelf study", text: "We look at where your product sits and what surrounds it." },
      { name: "Concepts", text: "We present three concepts on mock-up packs." },
      { name: "Artwork", text: "We complete the artwork for every face and every variant." },
      { name: "Print check", text: "We check the printer's proof before the run." },
    ],
  },
  {
    id: "business-applications",
    name: "Business applications",
    purpose: "Clear, usable screens for the software your team or customers use every day.",
    deliverables: ["User flows and wireframes", "Interface design for phone and desktop", "Component library", "Developer handover"],
    steps: [
      { name: "Research", text: "We watch how people do the task today." },
      { name: "Flows", text: "We map every path through the application." },
      { name: "Interface", text: "We design the screens and their states." },
      { name: "Handover", text: "We hand over the design system and answer your developers' questions." },
    ],
  },
  {
    id: "social-content",
    name: "Social and content",
    purpose: "Templates and monthly content that keep your social channels consistent without a full-time designer.",
    deliverables: ["Template kit for posts and stories", "Monthly content calendar", "Designed posts each month", "Usage guide"],
    steps: [
      { name: "Audit", text: "We review your channels and what your audience responds to." },
      { name: "Kit", text: "We design templates your team can fill." },
      { name: "Calendar", text: "We plan each month's posts with you." },
      { name: "Produce", text: "We design the month's posts and send them ready to publish." },
    ],
  },
];

interface ProjectSeed {
  slug: string;
  name: string;
  industry: string;
  services: string[];
  ground: string;
  ink: string;
  accent: string;
  face: string;
  brief: string;
  strategy: string;
  identity: string;
  digital: string;
  implementation: string;
  captions: [string, string, string, string];
  deliverables?: string[];
}

export const PROJECT_SEED: ProjectSeed[] = [
  {
    slug: "ledgerwick", name: "Ledgerwick Advisory", industry: "finance", services: ["brand-identity", "framer-websites"],
    ground: "0F1B2D", ink: "F2E9D8", accent: "C49A5A", face: "Libre Caslon Display",
    brief: "Give a forty-year-old advisory firm a brand that feels steady and current, and a website that explains its services in plain language.",
    strategy: "We positioned the firm as the calm keeper of a family's numbers, not a large consultancy, and wrote every message around steadiness.",
    identity: "A wordmark in a classical display face sits on hairline rules taken from ledger paper, with brass kept for signatures and calls to act.",
    digital: "The website uses the same ruled grid, with one service per page and a short answer at the top of each.",
    implementation: "We built the six-page site in Framer and handed over templates for letters and reports in the firm's office software.",
    captions: ["Wordmark on ruled ledger paper", "Letterhead and report cover", "Services page on the Framer website", "Brass accent on a signature line"],
  },
  {
    slug: "monsoon-crate", name: "Monsoon Crate Coffee", industry: "food", services: ["brand-identity", "packaging", "shopify-stores"],
    ground: "1E2B22", ink: "F4E6D0", accent: "D08A3E", face: "Fraunces",
    brief: "Launch a coffee brand that carries the monsoon, with packs for six coffees and an online store.",
    strategy: "We built the story around the season that shapes each harvest and let each estate speak for its own coffees.",
    identity: "A rain-streak pattern changes density with roast level, under a soft serif wordmark and an amber accent.",
    digital: "The store groups coffees by estate and puts roast date and grind options on every product page.",
    implementation: "We set up the Shopify store with a subscription page and supplied print-ready files for all six packs.",
    captions: ["Six packs in the rain-streak pattern", "Estate label with altitude and roast date", "Shopify product page for a dark roast", "Delivery crate with stamped logo"],
  },
  {
    slug: "basalt-beam", name: "Basalt & Beam", industry: "architecture", services: ["brand-identity", "framer-websites"],
    ground: "2A2A2C", ink: "EDEBE6", accent: "E3B23C", face: "Archivo",
    brief: "Give a two-partner practice an identity as honest as its materials and a portfolio that shows drawings first.",
    strategy: "We framed the practice around thinking in plan and section, so every surface leads with a drawing.",
    identity: "The mark is cut from a construction grid and paired with a compact grotesque and one ochre line.",
    digital: "Each portfolio page opens on a plan, then sections, then photographs, with the ochre line marking where you are.",
    implementation: "We built the portfolio in Framer with a project template the partners update themselves.",
    captions: ["Mark drawn on the construction grid", "Drawing-sheet title block", "Portfolio page opening on a plan", "Site signage in laterite and brass"],
  },
  {
    slug: "quillstack", name: "Quillstack", industry: "technology", services: ["business-applications", "framer-websites"],
    ground: "120F2A", ink: "E7E4FF", accent: "8C7CFF", face: "JetBrains Mono",
    brief: "Name the product's voice, map how field notes become reports and launch a site that explains it in four screens.",
    strategy: "We positioned Quillstack as the exact, quiet tool that saves a field team's Friday afternoon.",
    identity: "A monospaced wordmark and a violet signal colour give the brand the order of a clean log file.",
    digital: "We designed the note, review and report flows for phone and desktop, with violet kept for live data.",
    implementation: "We handed over the application design system and built the four-screen marketing site in Framer.",
    captions: ["Monospaced wordmark and signal colour", "Field note screen on a phone", "Weekly report on desktop", "Framer marketing site hero"],
  },
  {
    slug: "neem-nectar", name: "Neem & Nectar", industry: "lifestyle", services: ["packaging", "shopify-stores", "social-content"],
    ground: "F3EEDC", ink: "1F3A26", accent: "C98A1B", face: "DM Serif Display",
    brief: "Design a range of eight skincare packs, a Shopify store and a social kit the founder can run alone.",
    strategy: "We built the brand around ingredients you can name, shown plainly and in the same order everywhere.",
    identity: "Botanical line drawings, a warm display serif and a cream ground make the range feel kept rather than thrown away.",
    digital: "Each product page in the store leads with its ingredients and how to use it, before the price.",
    implementation: "We set up the Shopify store and delivered six editable post layouts with the illustration library.",
    captions: ["Eight packs on a cream ground", "Neem leaf line drawing", "Ingredient-first product page", "Weekly post from the social kit"],
  },
  {
    slug: "reelhouse", name: "Reelhouse Pictures", industry: "film", services: ["brand-identity", "social-content"],
    ground: "0B0B0B", ink: "F5D9A8", accent: "E4572E", face: "Bebas Neue",
    brief: "Create a brand that holds its own on a festival poster and a phone screen, plus a system for release content.",
    strategy: "We treated every touchpoint as a title card: one bold line, one date, one call to watch.",
    identity: "A tall condensed wordmark on black with a projector-lamp red reserved for releases.",
    digital: "The content system resizes stills into posters, stories and banners from one frame grid.",
    implementation: "We delivered poster and social templates and end cards for trailers in two languages.",
    captions: ["Title card in condensed type", "Festival poster template", "Release story on a phone", "Trailer end card"],
  },
  {
    slug: "tiffin-theory", name: "Tiffin Theory", industry: "consumer", services: ["packaging", "shopify-stores"],
    ground: "E9EDEF", ink: "1A1F24", accent: "E0A100", face: "Rubik",
    brief: "Make steel lunch boxes stand out on a shelf of plain steel and explain their tiers at a glance.",
    strategy: "We sold the boxes on clarity: how many tiers, how much food and whether it leaks, in that order.",
    identity: "Sleeves show each tier as a stacked band in yellow and grey, set in a rounded grotesque.",
    digital: "The store's size table compares capacity, tiers and weight side by side before checkout.",
    implementation: "We supplied sleeve and carton artwork for four sizes and set up the Shopify store.",
    captions: ["Four sleeves with tier bands", "Shipping carton", "Size comparison table", "Stacked boxes on a shelf"],
  },
  {
    slug: "static-bloom", name: "Static Bloom", industry: "experimental", services: ["brand-identity", "social-content"],
    ground: "2B0F2A", ink: "FFE3F1", accent: "FF4FA3", face: "Syne",
    brief: "Give an experimental collective a brand that can change each season without losing itself.",
    strategy: "We made change the constant: one family of marks, a new bloom for every event.",
    identity: "A flower mark generated from interference patterns, a wide display face and neon pink on plum.",
    digital: "The content kit remixes the mark for each event in posts, stories and stage visuals.",
    implementation: "We delivered the mark generator, poster templates and a set of stage visual loops.",
    captions: ["A season of generated blooms", "Event poster in pink on plum", "Event story sequence", "Stage visual still"],
  },
  {
    slug: "copperline", name: "Copperline Tax Partners", industry: "finance", services: ["business-applications"],
    ground: "1C2321", ink: "EFE7D7", accent: "B87333", face: "Libre Caslon Display",
    brief: "Design a client portal where small businesses upload invoices and see where their tax return stands.",
    strategy: "We built the portal around one question clients always ask: what do you still need from me?",
    identity: "We worked within the firm's existing copper wordmark and added a clear status palette for the portal.",
    digital: "The portal shows each return as a short checklist with the missing documents at the top.",
    implementation: "We delivered the portal flows, interface design and a component library for the firm's developers.",
    captions: ["Return checklist on desktop", "Invoice upload on a phone", "Status colours", "Portal component sheet"],
    deliverables: ["Portal flows and wireframes", "Portal interface design", "Component library"],
  },
  {
    slug: "saltpan-kitchen", name: "Saltpan Kitchen", industry: "food", services: ["social-content", "brand-identity"],
    ground: "F1ECE2", ink: "23303A", accent: "2F7F8F", face: "DM Serif Display",
    brief: "Refresh a coastal seafood kitchen's identity and give it a weekly content rhythm.",
    strategy: "We built the brand on the tide: what came in today is what is on the menu.",
    identity: "A salt-crystal mark, a sea-blue accent and a warm serif for menus and signs.",
    digital: "A weekly post series shows the day's catch, the dish and the boat it came from.",
    implementation: "We delivered the identity files, menu templates and twelve weeks of post layouts.",
    captions: ["Salt-crystal mark", "Menu board", "Day's catch post", "Takeaway bag"],
    deliverables: ["Logo and mark", "Menu templates", "Social and content series"],
  },
  {
    slug: "courtyard-homes", name: "Courtyard Homes", industry: "architecture", services: ["framer-websites"],
    ground: "E8E1D5", ink: "2B2622", accent: "9A5B34", face: "Archivo",
    brief: "Build a website for a builder of courtyard homes that lets buyers walk a plan before visiting.",
    strategy: "We led with the courtyard, the one room every buyer remembers, on every page.",
    identity: "We kept the builder's existing logo and set the site in a compact grotesque with a terracotta accent.",
    digital: "Each home page pairs a large plan with photographs placed by room.",
    implementation: "We built the Framer site with a template the sales team uses for each new home.",
    captions: ["Home page with courtyard photograph", "Plan with rooms marked", "Home listing on a phone", "Enquiry section"],
    deliverables: ["Framer website, five pages", "Home listing template"],
  },
  {
    slug: "relaywise", name: "Relaywise", industry: "technology", services: ["brand-identity", "business-applications"],
    ground: "0E1A1F", ink: "E2F1F0", accent: "3FD0B6", face: "Rubik",
    brief: "Name and brand a delivery-routing start-up and design the dispatcher's main screens.",
    strategy: "We positioned Relaywise as the calm voice in a busy dispatch room.",
    identity: "A relay-baton mark, a rounded grotesque and a teal signal for routes on time.",
    digital: "The dispatcher's screen shows every route as one line, teal when on time and amber when late.",
    implementation: "We delivered the identity, the dispatcher interface design and a component library.",
    captions: ["Relay-baton mark", "Dispatcher route board", "Driver view on a phone", "Brand colour sheet"],
    deliverables: ["Logo and wordmark", "Brand guidelines", "Dispatcher interface design"],
  },
];

interface WorldSeed {
  slug: string;
  summary: string;
  overview: string;
  decisions: DesignDecision[];
  deliverables: string[];
}

export const WORLD_SEED: WorldSeed[] = [
  {
    slug: "ledgerwick",
    summary: "A quiet, ledger-ruled identity for a Kochi advisory firm that wanted to feel steady rather than corporate.",
    overview: "Ledgerwick Advisory helps family businesses in Kerala with accounts, tax and succession planning. The partners wanted clients to feel the calm of a well-kept ledger the moment they opened a letter or the website. We built the identity on fine ruled lines, a warm brass accent and a classical display face, then carried it into a calm Framer website with plain-language service pages.",
    decisions: [
      { title: "Ruled lines as structure", text: "Every layout sits on a grid of hairline rules borrowed from account books, so letters, reports and web pages share one quiet rhythm." },
      { title: "Brass, used sparingly", text: "The brass accent marks only the one thing a reader must act on, such as a signature line or a booking link." },
      { title: "A classical voice", text: "Libre Caslon Display gives headings the weight of an old institution while the body text stays plain and easy to read." },
    ],
    deliverables: ["Logo and wordmark", "Stationery and report templates", "Brand guidelines book", "Framer website, six pages"],
  },
  {
    slug: "monsoon-crate",
    summary: "A rain-washed identity, packaging range and Shopify store for a small-batch coffee roaster in the Western Ghats.",
    overview: "Monsoon Crate roasts beans from three estates near Chikmagalur and ships them in small crates across India. The founder wanted the brand to carry the smell of wet earth and the season that shapes the harvest. We drew a rain-streak pattern for the packs, set the labels in a soft serif and built a Shopify store where each estate has its own page.",
    decisions: [
      { title: "Rain as a pattern", text: "A pattern of slanted streaks changes density with the roast: light roasts get a drizzle, dark roasts a downpour." },
      { title: "Labels that read like field notes", text: "Each pack lists estate, altitude and roast date in a small typed block, the way a buyer would note a sample." },
      { title: "One store, three estates", text: "The Shopify store groups coffees by estate so a returning buyer finds their usual bag in two taps." },
    ],
    deliverables: ["Logo and wordmark", "Packaging range of six packs", "Shopify store with subscription page", "Brand guidelines book"],
  },
  {
    slug: "basalt-beam",
    summary: "A sturdy, grid-built identity and portfolio website for a two-partner architecture practice.",
    overview: "Basalt & Beam is a two-partner practice that designs homes and small public buildings in laterite and timber. They wanted a brand as honest as their materials and a website that lets drawings speak first. We built the identity from a construction grid, a single ochre accent and a compact grotesque, and designed a Framer portfolio where every project opens on its plan.",
    decisions: [
      { title: "The grid is the logo", text: "The mark is cut from the same grid that structures every sheet, so the logo and the drawings belong to one system." },
      { title: "Drawings before photographs", text: "Each project page opens on its plan or section, with photographs following, because clients hire the practice for its thinking." },
      { title: "One ochre line", text: "A single ochre line marks the current project and section, like a highlighter on a drawing set." },
    ],
    deliverables: ["Logo and mark", "Drawing-sheet and presentation templates", "Framer portfolio website", "Signage guidelines"],
  },
  {
    slug: "quillstack",
    summary: "A precise, code-born identity and product design for a start-up that turns field notes into reports.",
    overview: "Quillstack builds a mobile and web application that lets field teams write short notes and turns them into weekly reports. The founders wanted a brand that felt exact without feeling cold. We built the identity around a monospaced face and a violet signal colour, designed the application's core flows and launched a Framer marketing site that explains the product in four screens.",
    decisions: [
      { title: "Monospace as voice", text: "JetBrains Mono sets headings and numbers so the brand reads like a well-formatted log." },
      { title: "A violet signal", text: "Violet appears only on live, changing data, so users learn that colour means something is happening." },
      { title: "Flows before screens", text: "We mapped every path from first note to finished report before drawing a single screen." },
    ],
    deliverables: ["Logo and wordmark", "Application flows and wireframes", "Application interface design", "Framer marketing website"],
  },
  {
    slug: "neem-nectar",
    summary: "A botanical packaging range, Shopify store and social kit for a small-batch skincare label.",
    overview: "Neem & Nectar makes soaps, balms and oils from neem, honey and coconut in small batches. The founder wanted packs that look kept rather than thrown away. We drew a set of botanical line illustrations, chose a warm display serif and a cream ground, built a Shopify store with clear ingredient pages and made a template kit for weekly posts.",
    decisions: [
      { title: "Ingredients on the front", text: "Every pack names its three main ingredients on the front face, in the same order as the label." },
      { title: "Line drawings, not photographs", text: "Hand-drawn leaves and flowers keep the range consistent even when products change." },
      { title: "A kit the founder can run", text: "The social kit gives the founder six layouts to fill without a designer." },
    ],
    deliverables: ["Packaging range of eight products", "Shopify store", "Social template kit", "Illustration library"],
  },
  {
    slug: "reelhouse",
    summary: "A bold, poster-loud identity and content system for an independent film production house.",
    overview: "Reelhouse Pictures produces documentaries and short films in Malayalam and English. The producers wanted a brand that could sit on a festival poster and a phone screen with equal force. We set the name in a tall condensed face, paired black with a projector-lamp red and built a content system for trailers, stills and release announcements.",
    decisions: [
      { title: "Title-card typography", text: "Bebas Neue sets every title like an opening card, tall and tightly spaced." },
      { title: "Red means release", text: "The red accent is kept for release dates and calls to watch, so it always signals news." },
      { title: "A frame for every format", text: "One frame system adapts each still to posters, stories and wide banners without recropping by hand." },
    ],
    deliverables: ["Logo and title card", "Poster templates", "Social and content system", "Trailer end-card designs"],
  },
  {
    slug: "tiffin-theory",
    summary: "A bright, stackable packaging system and Shopify store for a brand of steel lunch boxes.",
    overview: "Tiffin Theory makes stackable steel lunch boxes with leak-proof lids. The founders wanted the boxes to stand out on a shelf of plain steel and to explain their tiers at a glance. We designed sleeves that show each tier as a coloured band, set them in a friendly rounded grotesque and built a Shopify store where buyers compare sizes side by side.",
    decisions: [
      { title: "Tiers as bands", text: "Each sleeve shows the box's tiers as stacked yellow and grey bands, so size is clear from across the aisle." },
      { title: "Rounded and friendly", text: "Rubik's soft corners echo the rounded steel of the boxes." },
      { title: "Compare, then buy", text: "The store's size table lets buyers compare capacity, tiers and weight before choosing." },
    ],
    deliverables: ["Packaging sleeves for four sizes", "Shipping carton design", "Shopify store", "Product photography direction"],
  },
  {
    slug: "static-bloom",
    summary: "A loud, glitch-flower identity for an experimental music and visual arts collective.",
    overview: "Static Bloom is a collective that runs late-night sound and light events in Kochi. They asked for a brand that could change every season without losing itself. We built a flower mark from interference patterns, chose a wide display face and a neon pink, and made a content kit that remixes the mark for each event.",
    decisions: [
      { title: "A mark that mutates", text: "The flower mark is generated from a pattern seed, so each event gets its own bloom from the same family." },
      { title: "Pink on plum", text: "Neon pink on deep plum gives the collective one colour pair people remember after dark." },
      { title: "Wide type, short words", text: "Syne's wide letterforms work best on short event names, so the copy stays to a few words." },
    ],
    deliverables: ["Generative logo system", "Event poster templates", "Social and content kit", "Stage visual loops"],
  },
];

export const PRICE_SEED: PriceItem[] = [
  { id: "logo-wordmark", category: "brand-identity", name: "Logo and wordmark", type: "fixed", price_text: "₹45,000", delivery: "2 to 3 weeks", revisions: "3 revision rounds", inclusions: ["Two initial logo routes", "Final logo in colour and one-colour versions", "Files for print and screen"] },
  { id: "identity-system", category: "brand-identity", name: "Brand identity system", type: "custom", price_text: "From ₹1,80,000", delivery: "6 to 8 weeks", revisions: "3 revision rounds", inclusions: ["Logo, colour and type system", "Brand guidelines book", "Stationery and social templates"] },
  { id: "brand-guidelines", category: "brand-identity", name: "Brand guidelines book", type: "fixed", price_text: "₹60,000", delivery: "2 weeks", revisions: "2 revision rounds", inclusions: ["Up to 40 pages of guidance", "Logo, colour and type rules", "Editable source file"] },
  { id: "framer-landing", category: "framer-websites", name: "Framer landing page", type: "fixed", price_text: "₹55,000", delivery: "2 weeks", revisions: "2 revision rounds", inclusions: ["One designed page for phone and desktop", "Built in Framer with editable text", "Contact form and domain setup"] },
  { id: "framer-site", category: "framer-websites", name: "Framer website, up to 8 pages", type: "fixed", price_text: "₹1,40,000", delivery: "4 to 5 weeks", revisions: "2 revision rounds", inclusions: ["Up to 8 designed pages", "Built in Framer with editable content", "One editing training session"] },
  { id: "shopify-theme", category: "shopify-stores", name: "Shopify theme setup", type: "fixed", price_text: "₹85,000", delivery: "3 weeks", revisions: "2 revision rounds", inclusions: ["Theme chosen and styled to your brand", "Up to 30 products loaded", "Payment and shipping settings"] },
  { id: "shopify-custom", category: "shopify-stores", name: "Custom Shopify store", type: "custom", price_text: "From ₹2,50,000", delivery: "8 to 10 weeks", revisions: "3 revision rounds", inclusions: ["Custom theme designed for your products", "Collections and filters planned with you", "Team training and 30 days of support"] },
  { id: "pack-single", category: "packaging", name: "Single pack design", type: "fixed", price_text: "₹38,000", delivery: "2 to 3 weeks", revisions: "3 revision rounds", inclusions: ["One pack structure and dieline", "Artwork for every face", "Print-ready files"] },
  { id: "pack-range", category: "packaging", name: "Packaging range", type: "custom", price_text: "From ₹1,20,000", delivery: "5 to 7 weeks", revisions: "3 revision rounds", inclusions: ["Shared system for every pack in the range", "Artwork for each variant", "Printer proof checks"] },
  { id: "app-flows", category: "business-applications", name: "App flows and wireframes", type: "fixed", price_text: "₹70,000", delivery: "3 weeks", revisions: "2 revision rounds", inclusions: ["Up to 12 user flows", "Wireframes for phone and desktop", "A clickable prototype"] },
  { id: "app-design", category: "business-applications", name: "Business application design", type: "custom", price_text: "From ₹3,00,000", delivery: "10 to 12 weeks", revisions: "3 revision rounds", inclusions: ["Interface design for every screen and state", "Component library", "Developer handover sessions"] },
  { id: "social-kit", category: "social-content", name: "Social template kit", type: "fixed", price_text: "₹28,000", delivery: "1 to 2 weeks", revisions: "2 revision rounds", inclusions: ["12 post and story templates", "Editable files for your team", "Usage guide"] },
  { id: "content-month", category: "social-content", name: "Monthly content design", type: "fixed", price_text: "₹42,000 a month", delivery: "Every month", revisions: "1 revision round", inclusions: ["Up to 16 designed posts", "Monthly content calendar", "One planning call"] },
  { id: "campaign-content", category: "social-content", name: "Campaign content", type: "custom", price_text: "From ₹90,000", delivery: "3 to 4 weeks", revisions: "2 revision rounds", inclusions: ["Campaign concept and key visual", "Posts, stories and banners", "Formats for every channel you use"] },
];

export const QUESTION_SEED: Question[] = [
  { id: "services", question: "Which services does the studio offer?", answer: ["We offer six services: brand identity, Framer websites, Shopify stores, packaging, business applications, and social and content. Many projects combine two or three of them."] },
  { id: "timelines", question: "How long does a project take?", answer: ["Most projects take between two and twelve weeks. Each item on the price list shows its delivery estimate, from one to two weeks for a social template kit to ten to twelve weeks for a business application."] },
  { id: "pricing", question: "How are prices set?", answer: ["Fixed-price items have one published price. Larger or less predictable work is a custom quote, starting from the price shown, and we confirm it after a 30-minute call.", "All prices on this site are illustrative."] },
  { id: "revisions", question: "How many revision rounds are included?", answer: ["Each item on the price list states its revision rounds, usually two or three. A round is one set of combined feedback from you, which we then apply in full."] },
  { id: "framer", question: "Why do you build websites in Framer?", answer: ["Framer lets us design and build in one place, launch quickly and hand you a site you can edit yourself without code."] },
  { id: "shopify", question: "Do you build Shopify stores from scratch?", answer: ["Yes. We set up and style an existing theme for smaller stores, or design a custom store when your products need it."] },
  { id: "ownership", question: "Who owns the final files?", answer: ["Once the final payment is made, you own the final files and the right to use them. We keep the right to show the work in our portfolio."] },
  { id: "collaboration", question: "How do we work together?", answer: ["We work in short rounds with one call a week and a shared folder for files. You always talk to one of the two founders."] },
];

export const STUDIO_SEED: Studio = {
  principles: [
    { name: "Proportion", text: "We measure before we decorate. Good proportion is the reason a page feels calm before anyone reads it." },
    { name: "Patience", text: "We take six projects a season so each one gets time to settle. The second idea is usually better than the first." },
    { name: "Craft", text: "We check the printer's proof, the phone screen and the invoice template with the same care as the logo." },
    { name: "Distinction", text: "Every brand we make should look like its business and no one else's, which is why our eight worlds look nothing alike." },
  ],
  people: [
    { name: "Meera Varghese", role: "Co-founder, creative director", line: "Leads identity and art direction, and still draws every first sketch by hand." },
    { name: "Arjun Pillai", role: "Co-founder, digital lead", line: "Leads websites, stores and applications, from first flow to launch." },
    { name: "Tara Menon", role: "Packaging and print designer", line: "Takes packs from concept to the printer's proof." },
    { name: "Kabir Rao", role: "Content and motion designer", line: "Designs monthly content and the motion in our brand worlds." },
  ],
  stages: [
    { name: "Listen", text: "A first call and a short questionnaire about your business." },
    { name: "Map", text: "We agree on scope, price, timeline and revision rounds in writing." },
    { name: "Make", text: "We design in short rounds and share progress every week." },
    { name: "Refine", text: "We apply your feedback in the agreed revision rounds." },
    { name: "Hand over", text: "You receive every final file and a walkthrough of how to use them." },
  ],
};
