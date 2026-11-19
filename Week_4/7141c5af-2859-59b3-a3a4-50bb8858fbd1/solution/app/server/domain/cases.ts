export type CaseKind = "leather" | "fabric" | "frame-only";

interface CaseSection {
  heading: string;
  hash: string;
  text: readonly string[];
}

export interface FinishedCase {
  slug: string;
  title: string;
  kind: CaseKind;
  figure: string;
  figureLabel: string;
  summary: string;
  sections: readonly CaseSection[];
}

export const KIND_LABELS: Record<CaseKind, string> = { leather: "Leather", fabric: "Fabric", "frame-only": "Frame only" };

function sections(cameIn: readonly string[], found: readonly string[], cover: readonly string[], frame: readonly string[], keeping: readonly string[], files: readonly string[]): CaseSection[] {
  return [
    { heading: "01 As it came", hash: "as-it-came", text: cameIn },
    { heading: "02 What we found", hash: "what-we-found", text: found },
    { heading: "03 The cover", hash: "the-cover", text: cover },
    { heading: "04 The frame", hash: "the-frame", text: frame },
    { heading: "05 Keeping it well", hash: "keeping-it-well", text: keeping },
    { heading: "06 Files", hash: "files", text: files },
  ];
}

export const CASES: readonly FinishedCase[] = [
  {
    slug: "bentwood-armchair",
    title: "Bentwood armchair",
    kind: "leather",
    figure: "38.75 sq ft",
    figureLabel: "Hide laid",
    summary: "A steamed beech armchair with a split seat, re-covered from one dye lot.",
    sections: sections(
      ["The chair arrived by courier from a gallery in London, wrapped in moving blankets and missing two seat tacks. Its old cover had been patched at least twice, and the owner wanted to know how much of the first maker's work was still there.", "We stamped it in, photographed all four sides and drew the first condition pins before anything was lifted."],
      ["Under the patch the seat leather had split along the front seam. The back hoop was sound, the left arm joint had worked loose and one rear leg carried old woodworm, long since dead.", "Every mark went on the condition map with a note, so the owner could read the chair the way the bench reads it."],
      ["The new cover is a pull-up leather held as one dye lot, so the seat and the back cannot drift apart in the years ahead. The pattern pieces were laid around a flaw in the hide and the used figure went straight into the estimate.", "The grain runs front to back on the seat and top to bottom on the back, the way the first cover ran."],
      ["The loose arm was opened, cleaned of old animal glue and closed again with a reversible hide glue. It stayed in the clamps for the full cure before any cover work began.", "The rear leg was consolidated and left visible, because a repair that hides itself tells the next conservator nothing."],
      ["Keep the chair away from radiators and direct sun, and let the bentwood settle for a week in its new room before it takes daily use.", "Dust the leather with a soft dry cloth. Ask before using any cleaner."],
      ["The dossier for this chair holds the signed condition table, the materials with their dye lot, before and after photographs and a care card in the owner's language."],
    ),
  },
  {
    slug: "tubular-lounge",
    title: "Tubular lounge",
    kind: "leather",
    figure: "47.20 sq ft",
    figureLabel: "Hide laid",
    summary: "A chromed tube lounge chair whose slung leather had stretched past saving.",
    sections: sections(
      ["This lounge chair came from a hotel in Dubai, one of a pair that had stood in a bright lobby for most of its working life. The sling had stretched until the sitter touched the lower rail.", "The chrome was dull but whole, and the original makers' stitching pattern could still be read from the holes."],
      ["The sun had dried the leather through to the back, so it could not be fed back to life. The stitch holes along the top rail had torn into each other, and two of the rail clips had been replaced with the wrong size.", "The tube itself was true, with no dents in the long bends."],
      ["Two large panels had to come from one lot, which ruled out the first leather we looked at. The chosen lot held enough, and the pattern was laid so that the belly of the hide stayed out of the sling.", "The stitch spacing follows the old holes, counted one by one from the worn cover."],
      ["The chrome was cleaned with a fine polish and nothing stronger. Both wrong rail clips were replaced with clips turned to the first size, and each was marked on the inside so that it can be told from the original.", "The frame needed no glue, so the cover work could start straight away."],
      ["A leather sling keeps its shape when it rests between sittings. Turn the chair away from a window that takes the afternoon sun.", "Wipe the tube with a dry cloth, and keep polish off the leather."],
      ["The dossier holds the old stitch count, the condition table, the dye lot and the photographs from both ends of the job, with the care card in the client's language."],
    ),
  },
  {
    slug: "swivel-desk-chair",
    title: "Swivel desk chair",
    kind: "leather",
    figure: "31.40 sq ft",
    figureLabel: "Hide laid",
    summary: "A five-star swivel chair with a tired shell and a sound mechanism.",
    sections: sections(
      ["A collector in New York sent this desk chair to the bench after the seat foam gave way. It had been used every day for decades and still turned without a sound.", "The padded shell came away in two halves, which showed how the first upholsterer had built it."],
      ["The foam had turned to crumbs and stained the inside of the cover. The shell's plywood was sound apart from one small crack by the arm fixing, and the star base carried only light wear on its feet.", "A label under the seat gave the maker's name and a date, and it stayed where it was."],
      ["The cover is a semi-aniline leather chosen for daily use, cut in the first pattern. All of its hides came from a single lot, so the arms match the seat under a desk lamp.", "The seams were placed on the old lines and closed by hand where a machine would have marked the shell."],
      ["The crack was filled and left open to view from the underside. The swivel was cleaned, its grease renewed and its height stop set back to the first position.", "The star base was waxed, and the feet were left with the wear they had earned."],
      ["Let the seat settle for a month before judging it. New foam gives a little, then holds.", "Use a soft dry cloth on the leather, and keep the swivel away from solvent cleaners."],
      ["The dossier records the maker's label, the materials with their dye lot, the signed condition notes and the care card."],
    ),
  },
  {
    slug: "folding-deck-chair",
    title: "Folding deck chair",
    kind: "fabric",
    figure: "8.25 m",
    figureLabel: "Fabric laid",
    summary: "A folding teak deck chair given a new woven seat in quarter metres.",
    sections: sections(
      ["This folding chair came from a garden in Kyoto with its canvas in ribbons. The owner's family had carried it from house to house for three generations.", "It folded, but only with a push, and one of the hinge pins had been replaced with a bolt."],
      ["The wood was weathered silver and sound. The worst damage sat where the canvas had held the damp against the top rail, and a stain had reached into the end grain.", "The bolt had crushed the wood around its hole, so the hinge pulled to one side."],
      ["The new seat is a heavy wool cloth, measured to the quarter metre and cut with its selvedge along the load. It hangs from the same rail slots as the first canvas.", "Hems were doubled at both rails, where a sling always wears first."],
      ["The crushed hole was bushed with a turned plug, and a pin was made to match the three that survived. The silver colour of the wood was kept, because the owner asked for it and because it was honest.", "Each joint now folds with one hand."],
      ["Fold the chair and bring it in before the rain. Damp held against the rail did the first damage.", "Brush the cloth when dry, and store the chair flat."],
      ["The dossier sets out the new pin, the cloth with its lot, the photographs and a care card in Japanese."],
    ),
  },
  {
    slug: "cantilever-side-chair",
    title: "Cantilever side chair",
    kind: "fabric",
    figure: "6.50 m",
    figureLabel: "Fabric laid",
    summary: "A sprung steel side chair re-covered in a linen weave.",
    sections: sections(
      ["This side chair came with five others from a dining room in Turin. The owner wanted one chair finished first, so the rest could be judged against it.", "It still sprang under the sitter, though the back had taken on a slight lean."],
      ["The fabric had worn through on the front edge of the seat, and moths had been at the back panel. The steel carried surface rust under the seat where a glass had once been set down many times.", "The lean came from a fixing that had worked loose and not from the tube."],
      ["A linen weave replaced the worn cloth, cut by the quarter metre with its threads running square to the seat front. The seat panel was laced under the frame as the first one had been.", "Six chairs will need one lot, so that lot was held before the first was cut."],
      ["The rust was taken back by hand and sealed with wax. The back fixing was tightened and pinned, which brought the frame true without a bend.", "No heat went near the tube, because a sprung frame remembers it."],
      ["Keep the chair out of damp rooms and wipe the tube dry when it is wet.", "Vacuum the cloth gently through a soft brush head, and ask before using any cleaner."],
      ["The dossier holds the lacing drawing, the cloth with its lot, the signed notes and a care card in Italian."],
    ),
  },
  {
    slug: "slat-bench",
    title: "Slat bench",
    kind: "frame-only",
    figure: "0.00 sq ft",
    figureLabel: "Nothing to cover",
    summary: "A long bench of oak slats, repaired at the frame with no new cover at all.",
    sections: sections(
      ["This slat bench came from a school hall in Turin, where it had stood for sixty years under coats and children. There was never any cover on it, and there should not be one now.", "It rocked on an uneven floor, and three slats had sprung at one end."],
      ["Old screws had been driven through the slats to stop a creak, and each one had split the wood a little further. The cross rail had shrunk away from its joint at the left leg.", "The surface wear was even and handsome, and it stayed."],
      ["There is no cover on this bench and none was added, so no hide was laid and no dye lot was held. The figure beside the drawing is exactly zero.", "Frame-only work is estimated by the hour, and it shows nothing else."],
      ["The screws came out and the splits were closed with glue and small clamps. The sprung slats were refixed with their first pegs and the cross rail was given a thin oak shim, cut to the old line.", "The joint then cured its full time before the bench took any load."],
      ["Keep the bench away from underfloor heating outlets, which will open the joints again.", "Oil it lightly once a year, and only after asking which oil."],
      ["The dossier holds the joint drawing, the signed condition table and the before and after photographs."],
    ),
  },
];

export function findCase(slug: string): FinishedCase | null {
  return CASES.find((found) => found.slug === slug) ?? null;
}
