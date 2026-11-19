export type CaseSpec = { slug: string; title: string; kind: "leather" | "fabric" | "frame-only"; figure: string; chair: "bentwood" | "tubular" | "swivel" | "folding" | "cantilever" | "slat" | "lounge" };

export const cases: CaseSpec[] = [
  { slug: "bentwood-armchair", title: "Bentwood armchair", kind: "leather", figure: "38.75 sq ft", chair: "bentwood" },
  { slug: "tubular-lounge", title: "Tubular lounge", kind: "leather", figure: "47.20 sq ft", chair: "tubular" },
  { slug: "swivel-desk-chair", title: "Swivel desk chair", kind: "leather", figure: "31.40 sq ft", chair: "swivel" },
  { slug: "folding-deck-chair", title: "Folding deck chair", kind: "fabric", figure: "8.25 m", chair: "folding" },
  { slug: "cantilever-side-chair", title: "Cantilever side chair", kind: "fabric", figure: "6.50 m", chair: "cantilever" },
  { slug: "slat-bench", title: "Slat bench", kind: "frame-only", figure: "0.00 sq ft", chair: "slat" },
];

export const caseSections: { heading: string; hash: string }[] = [
  { heading: "01 As it came", hash: "#as-it-came" },
  { heading: "02 What we found", hash: "#what-we-found" },
  { heading: "03 The cover", hash: "#the-cover" },
  { heading: "04 The frame", hash: "#the-frame" },
  { heading: "05 Keeping it well", hash: "#keeping-it-well" },
  { heading: "06 Files", hash: "#files" },
];

export const dossierSections: { heading: string; hash: string }[] = [
  { heading: "01 The piece", hash: "#the-piece" },
  { heading: "02 Condition", hash: "#condition" },
  { heading: "03 Materials", hash: "#materials" },
  { heading: "04 Photographs", hash: "#photographs" },
  { heading: "05 Care card", hash: "#care-card" },
  { heading: "06 History", hash: "#history" },
];

export const caseBody: Record<string, string[]> = {
  "as-it-came": [
    "The chair arrived with its old cover split along the front seam and a repair patch lifting at the left arm.",
    "Every part was photographed before anything was touched, and the frame was checked for movement.",
  ],
  "what-we-found": [
    "A tear along the front seam, a stain under the left arm and one loose joint were recorded as condition pins.",
    "The condition map was signed and shared with the client before any work began.",
  ],
  "the-cover": [
    "The new cover was cut from a single dye lot and laid out on the hide with the desk's pattern pieces.",
    "The grain ran one way for every piece that asked for it, and the used-leather figure was kept exact.",
  ],
  "the-frame": [
    "The frame was reglued at the loose joint and clamped for a full cure of 48 hours.",
    "No cover work went onto the bench before the glue had cured by the bench day's start.",
  ],
  "keeping-it-well": [
    "Keep the piece out of direct sun and away from radiators.",
    "Dust it with a soft dry cloth, and ask the conservator before using any cleaner.",
  ],
  files: [
    "The conservation dossier holds the piece, its stamp, signed condition pins, the materials with their dye lot and the photographs.",
    "A signed copy is kept for the client and for the record.",
  ],
};
