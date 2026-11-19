import type { FocusEventHandler, MouseEvent, ReactNode, Ref } from "react";
import type { ChapterSummary } from "../../shared/api.ts";
import { QuenbyMark } from "../ui/Glyphs.tsx";
import { navigate } from "../lib/router.tsx";
import { TileGlyph } from "./glyphs.tsx";
import type { TileId } from "./layout.ts";

interface TileSpec {
  id: TileId;
  label: string;
  to: string;
  tone: string;
  slug?: string;
}

/** Reading and Tab order of the tiles everywhere. */
export const TILES: readonly TileSpec[] = [
  { id: "logo", label: "Logo", to: "/chapters/logo", tone: "lagoon", slug: "logo" },
  { id: "voice", label: "Voice", to: "/chapters/voice", tone: "moss", slug: "voice" },
  { id: "colour", label: "Colour", to: "/chapters/colour", tone: "saffron", slug: "colour" },
  { id: "typography", label: "Typography", to: "/chapters/typography", tone: "ember", slug: "typography" },
  { id: "iconography", label: "Iconography", to: "/chapters/iconography", tone: "meadow", slug: "iconography" },
  { id: "motion", label: "Motion", to: "/chapters/motion", tone: "iris", slug: "motion" },
  { id: "library", label: "Library", to: "/library", tone: "clay" },
  { id: "rules", label: "Rule index", to: "/rules", tone: "orchid" },
];

export interface ChapterData {
  chapters: ChapterSummary[];
  liveRuleCount: number;
}

function lineOf(spec: TileSpec, data: ChapterData | null): string {
  if (spec.id === "library") return "Assets and grants";
  if (!data) return "";
  if (spec.id === "rules") return `${data.liveRuleCount} rules`;
  const chapter = data.chapters.find((c) => c.slug === spec.slug);
  return chapter ? `v${chapter.version} · ${chapter.ruleCount} rules` : "";
}

interface TileProps {
  spec: TileSpec;
  data: ChapterData | null;
  innerRef?: Ref<HTMLAnchorElement>;
  onFocus?: FocusEventHandler<HTMLAnchorElement>;
}

/** One chapter tile: label top-left, the tile line under it (painted from data-note, described by the hidden span, so the link's visible text is its name), one oversized glyph below. */
export function Tile({ spec, data, innerRef, onFocus }: TileProps): ReactNode {
  const labelId = `slab-${spec.id}-label`;
  const lineId = `slab-${spec.id}-line`;
  return (
    <a
      href={spec.to}
      className={`tile slab-${spec.id} field-${spec.tone}`}
      aria-labelledby={labelId}
      aria-describedby={lineId}
      ref={innerRef}
      onFocus={onFocus}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(spec.to);
      }}
    >
      <span className="slab-head" data-note={lineOf(spec, data)}>
        <span className="slab-label" id={labelId}>
          {spec.label}
        </span>
        <span hidden id={lineId}>
          {lineOf(spec, data)}
        </span>
      </span>
      <TileGlyph id={spec.id} />
    </a>
  );
}

/** The Quenby mark tile of the finished mosaic (Harbour 700 with the white mark). */
export function MarkTile(): ReactNode {
  return (
    <div className="tile slab-mark">
      <QuenbyMark size={46} />
    </div>
  );
}
