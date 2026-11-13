// Empty state start band: `// EYEBROW` mono eyebrow, headline at section-heading size, a dark 48 px square button and a small
// drawn staircase glyph.
//   <EmptyState eyebrow="MERGE REQUESTS" headline="No merge requests yet" action={{ label: "Open a merge request", href }} />
//   `eyebrow` is the words after `// `. `action` is a link ({ href }) or a button ({ onClick }). `level` is the headline's
//   heading level (default 2). `tone="dark"` draws the band on the surface step instead of the light band.
import { Button } from "./button.tsx";
import { LinkButton } from "./button.tsx";
import { Heading } from "./heading.tsx";
import { StaircaseGlyph } from "./icons.tsx";

interface EmptyAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export function EmptyState({ eyebrow, headline, action, level = 2, tone = "light" }: { eyebrow: string; headline: string; action?: EmptyAction; level?: 1 | 2 | 3; tone?: "light" | "dark" }) {
  return (
    <div class={`sp-empty sp-empty--${tone} ${tone === "light" ? "sp-light" : "sp-dark"}`}>
      <div class="sp-empty__text">
        <p class="sp-empty__eyebrow">{`// ${eyebrow}`}</p>
        <Heading level={level} class="sp-empty__headline">
          {headline}
        </Heading>
        {action ? (
          action.href !== undefined ? (
            <LinkButton href={action.href} class="sp-empty__action">
              {action.label}
            </LinkButton>
          ) : (
            <Button class="sp-empty__action" onClick={action.onClick}>
              {action.label}
            </Button>
          )
        ) : null}
      </div>
      <StaircaseGlyph size={64} />
    </div>
  );
}
