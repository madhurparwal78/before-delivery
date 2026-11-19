import type { ReactNode } from "react";
import type { Badge as BadgeWord } from "../../shared/domain.ts";
import { Glyph, type GlyphName } from "./Glyphs.tsx";

const BADGES: Record<BadgeWord, { tone: string; glyph: GlyphName }> = {
  Available: { tone: "meadow", glyph: "check" },
  "Request required": { tone: "saffron", glyph: "key" },
  Restricted: { tone: "ember", glyph: "bar" },
  Retired: { tone: "stone", glyph: "clock" },
};

/** An availability badge: a field-colour chip with its word and a glyph, never colour alone. */
export function Badge({ word }: { word: BadgeWord }): ReactNode {
  const { tone, glyph } = BADGES[word];
  return (
    <span className={`badge field-${tone}`}>
      <Glyph name={glyph} size={16} />
      {word}
    </span>
  );
}

/** A neutral state chip (request state, grant status) with its word. */
export function Chip({ children, tone = "stone" }: { children: ReactNode; tone?: "stone" | "meadow" | "saffron" | "ember" | "lagoon" }): ReactNode {
  return <span className={`badge field-${tone}`}>{children}</span>;
}
