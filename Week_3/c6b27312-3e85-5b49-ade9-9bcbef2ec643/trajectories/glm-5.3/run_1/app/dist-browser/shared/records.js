export const CATEGORIES = [
    { slug: "hardware", name: "Hardware" },
    { slug: "organisers", name: "Organisers" },
    { slug: "brackets", name: "Brackets" },
    { slug: "plumbing", name: "Plumbing" },
    { slug: "enclosure-parts", name: "Enclosure parts" },
    { slug: "jigs", name: "Jigs" },
];
export const PROCESSES = [
    { id: "fdm-04", label: "FDM print, 0.4 mm nozzle", envelope: [220, 220, 250], wallBlocking: 1.2, wallAdvisory: 2.0, depthRatio: null, setup: 2, ratePerCm3: 0.06, leadTime: "2\u20134 working days" },
    { id: "mill-3", label: "Three-axis mill", envelope: [300, 200, 100], wallBlocking: 1.2, wallAdvisory: 1.5, depthRatio: 6, setup: 40, ratePerCm3: 0.45, leadTime: "5\u201310 working days" },
    { id: "laser-sheet", label: "Laser-cut sheet", envelope: [600, 400, 6], wallBlocking: 1.5, wallAdvisory: 3.0, depthRatio: null, setup: 8, ratePerCm3: 0.30, leadTime: "3\u20136 working days" },
];
export const SEED_PART_CATEGORY = {
    "twin-hole-plate": "hardware",
    "peg-rail": "organisers",
    "shelf-bracket": "brackets",
    "cable-comb": "organisers",
    "hinge-leaf": "hardware",
    "spacer-ring": "hardware",
    "label-holder": "organisers",
    "pipe-saddle": "plumbing",
    "fan-grille-plate": "enclosure-parts",
    "hose-clip": "plumbing",
    "jig-fence-block": "jigs",
    "pegboard-hook-plate": "hardware",
};
export const SEED_SOURCES = {};
export function seedSource(slug) {
    return SEED_SOURCES[slug];
}
