import type { Position } from "../../shared/api.ts";
import { POSITION_WORD } from "../format.ts";

export interface Badge {
  text: string;
  tone: "up" | "down" | "dim";
}

export interface ShirtData {
  id: string;
  name: string;
  club: string;
  position: Position;
  points: number;
  figure: string;
  captain: boolean;
  vice: boolean;
  out?: boolean;
  incoming?: string | null;
  dimmed?: boolean;
}

function shirtLabel(shirt: Pick<ShirtData, "name" | "position" | "points" | "captain" | "vice">): string {
  const armband = shirt.captain ? ", captain" : shirt.vice ? ", vice-captain" : "";
  return `${shirt.name}, ${POSITION_WORD[shirt.position]}, ${shirt.points} points${armband}`;
}

const shortName = (name: string) => name.split(" ").slice(-1)[0] ?? name;

// A shirt drawn from simple shapes: turf body, chalk trim, the club code; short name and a mono figure below.
export function Kit({ club }: { club: string | null }) {
  return (
    <svg class="kit" viewBox="0 0 44 40" aria-hidden="true">
      <path class="kit-body" d="M15 2 9 4 2 10.5l4.5 6 4-2.2V38h23V14.3l4 2.2 4.5-6L35 4l-6-2c-1.4 2.6-3.9 4-7 4s-5.6-1.4-7-4Z" />
      <path d="M15 2c1.4 2.6 3.9 4 7 4s5.6-1.4 7-4" fill="none" stroke="var(--chalk)" stroke-width="1.5" />
      {club && (
        <text class="kit-code" x="22" y="26" text-anchor="middle">
          {club}
        </text>
      )}
    </svg>
  );
}

export function Shirt(props: {
  shirt: ShirtData;
  list: boolean;
  pressed: boolean | null;
  pending: boolean;
  badge: Badge | null;
  tabIndex: number;
  onActivate: () => void;
}) {
  const { shirt, list } = props;
  const classes = [list ? "list-row" : "shirt", shirt.out ? "is-out" : "", shirt.dimmed ? "on-bench-dim" : ""].join(" ");
  const badge = props.badge && <span aria-hidden="true" class={`delta-badge${props.badge.tone === "down" ? " negative" : props.badge.tone === "dim" ? " dim" : ""}`}>{props.badge.text}</span>;
  const armband = shirt.captain ? (
    <span class="armband" aria-hidden="true">
      C
    </span>
  ) : shirt.vice ? (
    <span class="armband vice" aria-hidden="true">
      V
    </span>
  ) : null;
  // The card holds the drawing and the figures; the shirt button over it carries only the accessible name, so the
  // visible text sits beside the button, never inside it (WCAG 2.5.3 label in name).
  return (
    <div class={classes}>
      <button
        type="button"
        class="shirt-hit"
        data-nav={shirt.id}
        data-player-id={shirt.id}
        data-points={String(shirt.points)}
        aria-label={shirtLabel(shirt)}
        aria-pressed={props.pressed === null ? undefined : props.pressed ? "true" : "false"}
        aria-disabled={props.pending ? "true" : undefined}
        tabIndex={props.tabIndex}
        onClick={props.onActivate}
      />
      {list ? (
        <>
          <span class="pos" aria-hidden="true">
            {shirt.position}
          </span>
          <span aria-hidden="true">
            {shirt.name}
            <span class="hint" aria-hidden="true">
              {" "}
              {shirt.club}
              {shirt.incoming && ` → ${shirt.incoming}`}
            </span>
          </span>
          <span aria-hidden="true">
            {shirt.out && <span class="tag-out">Out</span>} {armband} {badge}
          </span>
          <span class="mono" aria-hidden="true">
            {shirt.figure}
          </span>
        </>
      ) : (
        <>
          <Kit club={shirt.club} />
          {armband}
          {shirt.out && (
            <span class="tag-out" aria-hidden="true">
              Out
            </span>
          )}
          {badge}
          <span class="name" aria-hidden="true">{shortName(shirt.name)}</span>
          <span class="figure" aria-hidden="true">
            {shirt.figure}
          </span>
          {shirt.incoming && (
            <span class="incoming" aria-hidden="true">
              {shortName(shirt.incoming)}
            </span>
          )}
        </>
      )}
      {props.pending && (
        <span class="pending" aria-hidden="true">
          Saving…
        </span>
      )}
    </div>
  );
}
