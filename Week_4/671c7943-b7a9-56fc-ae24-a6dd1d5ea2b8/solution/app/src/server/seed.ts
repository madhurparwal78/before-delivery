import type { CategoryId, Content, Motif, Project } from "../shared/types.js";

interface ProjectRow {
  slug: string;
  title: string;
  client: string;
  category: CategoryId;
  year: number;
  hue: number;
  motif: Motif;
  role: string;
  duration: string;
  process: [number, number, number, number];
  standfirst: string;
  overview: string;
  objectives: string[];
  palette: [string, string][];
  screens: string[];
  results: [string, string][];
}

function project(row: ProjectRow): Project {
  return {
    slug: row.slug,
    title: row.title,
    client: row.client,
    category: row.category,
    year: row.year,
    hue: row.hue,
    motif: row.motif,
    role: row.role,
    duration: row.duration,
    standfirst: row.standfirst,
    overview: row.overview,
    objectives: row.objectives,
    palette: row.palette.map(([name, hex]) => ({ name, hex: `#${hex}` })),
    screens: row.screens.map((caption) => ({ caption })),
    process: row.process,
    results: row.results.map(([value, label]) => ({ value, label })),
  };
}

export const STARTING_CONTENT: Content = {
  projects: [
    project({
      slug: "harbour-loom",
      title: "Harbour Loom",
      client: "Harbour Loom Textiles",
      category: "brand-identity",
      year: 2025,
      hue: 205,
      motif: "arcs",
      role: "Creative direction and identity design",
      duration: "9 weeks",
      process: [2, 2, 3, 2],
      standfirst: "A heritage weaving mill renamed and re-marked for its first range sold straight to customers.",
      overview:
        "The mill had sold cloth to other brands for ninety years under a family name nobody outside the trade knew. We chose a new name, drew a mark from the path of the loom's shuttle and built a system for labels, swing tags and the shop.",
      objectives: [
        "Give the mill a name customers can say and remember.",
        "Make the mark work stitched, printed and on screen.",
        "Hand over a system the in-house team can run alone.",
      ],
      palette: [["Harbour blue", "1F3A5F"], ["Undyed wool", "E9E2D0"], ["Signal coral", "D9583B"]],
      screens: ["Swing tag and woven label", "Shop front and window lettering", "Online shop header"],
      results: [
        ["+64%", "return visits to the shop in the first six months"],
        ["11", "stockists added in the first year"],
        ["1", "system used across tags, signs and web"],
      ],
    }),
    project({
      slug: "northlight-gallery",
      title: "Northlight Gallery",
      client: "Northlight Gallery",
      category: "website-design",
      year: 2025,
      hue: 265,
      motif: "grid",
      role: "Website design and art direction",
      duration: "12 weeks",
      process: [2, 2, 6, 2],
      standfirst: "An exhibition-first website where every show gets its own page rhythm.",
      overview:
        "The gallery's old site listed shows like products. The new site gives each exhibition a long page whose type, colour and image rhythm follow the work, while visiting hours and tickets stay in the same place on every page.",
      objectives: [
        "Let each exhibition look like itself.",
        "Keep visiting information one tap away on every page.",
        "Let the curators build a show page without a developer.",
      ],
      palette: [["Gallery night", "1C1A2E"], ["Wall white", "F5F3EE"], ["Northlight violet", "6B5BD6"]],
      screens: ["Exhibition page opening", "Visit and tickets panel", "Archive of past shows"],
      results: [
        ["+41%", "time spent on exhibition pages"],
        ["2 hours", "for a curator to build a show page"],
        ["0", "accessibility errors on the templates at launch"],
      ],
    }),
    project({
      slug: "ledgerline",
      title: "Ledgerline",
      client: "Ledgerline Ltd",
      category: "digital-product-design",
      year: 2025,
      hue: 170,
      motif: "grid",
      role: "Product design lead",
      duration: "14 weeks",
      process: [3, 2, 7, 2],
      standfirst: "A calmer invoicing app for freelancers, redesigned around the first five minutes.",
      overview:
        "Most new users left before sending their first invoice. We rebuilt sign-up around one task, sending an invoice, moved every other setting to after it, then built a design system so the team could ship the rest.",
      objectives: [
        "Get a new user to their first sent invoice in five minutes.",
        "Cut support questions about setup.",
        "Give the team a design system they can extend.",
      ],
      palette: [["Ledger teal", "1F6F6B"], ["Cloud", "F4F6F5"], ["Amber", "E0A43A"]],
      screens: ["First invoice flow", "Invoice list with paid and overdue states", "Design system components"],
      results: [
        ["5 min", "median time to the first sent invoice"],
        ["-35%", "setup questions to support"],
        ["120", "components in the design system"],
      ],
    }),
    project({
      slug: "quarry-press",
      title: "Quarry Press",
      client: "Quarry Press",
      category: "brand-identity",
      year: 2024,
      hue: 28,
      motif: "grid",
      role: "Identity design and typography",
      duration: "7 weeks",
      process: [1, 2, 3, 1],
      standfirst: "An identity system for a small publisher of field guides, built from one condensed serif.",
      overview:
        "Quarry Press publishes twelve field guides a year and every cover looked different. One condensed serif, a strict cover grid and a colour per subject now make the shelf read as one list.",
      objectives: [
        "Make every guide recognisable from across a shop.",
        "Let the designer set a new cover in a day.",
        "Keep the cost of colour printing flat.",
      ],
      palette: [["Slate", "2E3338"], ["Limestone", "EDE8DC"], ["Ochre", "C8902E"]],
      screens: ["Cover grid for the field guides", "Spine system on the shelf", "Catalogue spread"],
      results: [
        ["12", "covers set in the new system in its first year"],
        ["1 day", "to set a new cover, down from a week"],
        ["+22%", "bookshop orders for the spring list"],
      ],
    }),
    project({
      slug: "fieldwork-journal",
      title: "Fieldwork Journal",
      client: "Fieldwork Institute",
      category: "website-design",
      year: 2024,
      hue: 50,
      motif: "arcs",
      role: "Website design and content design",
      duration: "10 weeks",
      process: [2, 1, 5, 2],
      standfirst: "A long-read site for a research institute, set for comfortable reading on any screen.",
      overview:
        "The institute's reports lived in PDFs few people opened. Fieldwork Journal turns each report into a readable web essay with footnotes beside the text, figures that resize cleanly and a download for the full report.",
      objectives: [
        "Get the reports read, not just downloaded.",
        "Make footnotes and figures work on a phone.",
        "Publish a new essay from the institute's own editor.",
      ],
      palette: [["Ink", "22201C"], ["Paper", "F6F1E7"], ["Field yellow", "D8A520"]],
      screens: ["Essay opening with standfirst", "Footnotes beside the text", "Figure on a phone"],
      results: [
        ["3x", "average reading time per essay"],
        ["58%", "of readers on phones finishing an essay"],
        ["24", "essays published in the first year"],
      ],
    }),
    project({
      slug: "pathway-transit",
      title: "Pathway",
      client: "Pathway Transit Authority",
      category: "digital-product-design",
      year: 2024,
      hue: 220,
      motif: "arcs",
      role: "Product design and usability testing",
      duration: "16 weeks",
      process: [4, 2, 8, 2],
      standfirst: "A journey planner that puts the next departure and step-free routes first.",
      overview:
        "Riders asked one question, when does the next one leave, and the old app answered it three screens deep. Pathway opens on the nearest stops with live departures and offers step-free routes from the first screen.",
      objectives: [
        "Show the next departure on the first screen.",
        "Make step-free routes a first-class choice.",
        "Pass usability tests with riders who use screen readers.",
      ],
      palette: [["Route blue", "1D4E89"], ["Platform grey", "E6E8EB"], ["Signal yellow", "F2C230"]],
      screens: ["Nearest stops with live departures", "Step-free route options", "Trip in progress"],
      results: [
        ["1", "screen to the next departure, down from 3"],
        ["92%", "task success in tests with screen reader users"],
        ["+30%", "weekly riders using the app"],
      ],
    }),
    project({
      slug: "tidewater-co-op",
      title: "Tidewater Co-op",
      client: "Tidewater Grocery Co-operative",
      category: "brand-identity",
      year: 2023,
      hue: 140,
      motif: "stack",
      role: "Identity and signage design",
      duration: "10 weeks",
      process: [2, 2, 4, 2],
      standfirst: "A friendlier mark and signage family for a member-owned grocer with eleven stores.",
      overview:
        "Members said the old signs felt like a discount warehouse. A rounded wordmark, drawn produce icons and a signage kit that store staff can print themselves changed the feel of all eleven stores in one spring.",
      objectives: [
        "Make the co-op feel owned by its members, not a chain.",
        "Give staff signs they can print and change in store.",
        "Keep every sign readable from the end of an aisle.",
      ],
      palette: [["Kelp green", "2F6B4F"], ["Oat", "F2EAD8"], ["Tomato", "C8402F"]],
      screens: ["Store front at dusk", "Aisle signs and shelf labels", "Member card"],
      results: [
        ["11", "stores re-signed in one spring"],
        ["+18%", "new members in the first year"],
        ["40", "sign templates staff print themselves"],
      ],
    }),
    project({
      slug: "ostler-hotels",
      title: "Ostler Hotels",
      client: "Ostler Hotel Group",
      category: "website-design",
      year: 2022,
      hue: 350,
      motif: "stack",
      role: "Website design and design system",
      duration: "11 weeks",
      process: [2, 2, 5, 2],
      standfirst: "A booking-led website for four small hotels that each keep their own character.",
      overview:
        "Four hotels shared one template and looked identical. A shared design system with a palette and picture style per hotel lets each one look like itself, while booking works the same way everywhere.",
      objectives: [
        "Give each hotel its own look inside one system.",
        "Make booking two steps from any page.",
        "Cut the cost of adding a fifth hotel.",
      ],
      palette: [["Claret", "7A1F2B"], ["Linen", "F3ECE2"], ["Brass", "B08A3E"]],
      screens: ["Hotel home page", "Room chooser", "Booking summary on a phone"],
      results: [
        ["+27%", "direct bookings in the first year"],
        ["2", "steps from any page to a booking"],
        ["3 weeks", "to add a hotel to the system"],
      ],
    }),
    project({
      slug: "tally-kitchen",
      title: "Tally",
      client: "Tally Kitchen Systems",
      category: "digital-product-design",
      year: 2023,
      hue: 15,
      motif: "stack",
      role: "Product and interface design",
      duration: "12 weeks",
      process: [3, 2, 5, 2],
      standfirst: "An order screen for busy kitchens, readable at arm's length and usable with wet hands.",
      overview:
        "Cooks read orders from two metres away while plating. Tally uses large type, colour plus shape for each course and wide touch zones, so an order can be cleared with a knuckle.",
      objectives: [
        "Make every order readable from two metres.",
        "Never rely on colour alone for course or status.",
        "Let a cook clear an order without precise taps.",
      ],
      palette: [["Char", "1E1B18"], ["Steel", "DADDE0"], ["Flame", "E2572B"]],
      screens: ["Order rail at service", "Course markers in colour and shape", "Clear and recall"],
      results: [
        ["2 m", "reading distance for every order"],
        ["-48%", "missed course changes"],
        ["64 px", "minimum touch zone"],
      ],
    }),
  ],
  stats: [
    {
      id: "years",
      value: 12,
      label: "years of practice",
      note: "In practice since 2014: seven years in studios, five independent.",
      parts: [{ label: "In studios", value: 7 }, { label: "Independent", value: 5 }],
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
      parts: [{ label: "Over 250 people", value: 21 }, { label: "250 people or fewer", value: 17 }],
    },
    {
      id: "awards",
      value: 9,
      label: "design awards",
      note: "Juried awards, by discipline.",
      parts: [{ label: "Type", value: 4 }, { label: "Web", value: 3 }, { label: "Product", value: 2 }],
    },
  ],
};
