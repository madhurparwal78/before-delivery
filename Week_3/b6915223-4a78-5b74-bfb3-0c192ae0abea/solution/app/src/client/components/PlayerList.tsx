import { useEffect, useRef, useState } from "preact/hooks";
import type { CataloguePlayer } from "../../shared/api.ts";
import { millions, POSITION_WORD } from "../format.ts";
import { ClubBadge } from "./Icons.tsx";

// The Players listbox: one Tab stop; Up, Down, Home and End move the active option, Enter brings the
// player in, Escape returns to the pitch (brief: Interactions / Transfers).
const optionName = (player: CataloguePlayer) => `${player.name}, ${player.club}, ${POSITION_WORD[player.position]}, ${millions(player.price_tenths)}m`;

export function PlayerList(props: { players: CataloguePlayer[]; owned: Set<string>; onPick: (player: CataloguePlayer) => void; onEscape: () => void }) {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  const signature = props.players.map((player) => player.id).join(",");

  useEffect(() => {
    activeRef.current = 0;
    setActive(0);
  }, [signature]);

  const moveTo = (index: number) => {
    const clamped = Math.max(0, Math.min(props.players.length - 1, index));
    activeRef.current = clamped;
    setActive(clamped);
    list.current?.querySelector(`#option-${props.players[clamped]?.id ?? ""}`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => moveTo(activeRef.current + 1),
      ArrowUp: () => moveTo(activeRef.current - 1),
      Home: () => moveTo(0),
      End: () => moveTo(props.players.length - 1),
      Enter: () => {
        const player = props.players[activeRef.current];
        if (player) props.onPick(player);
      },
      Escape: props.onEscape,
    };
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  const current = props.players[active];
  return (
    <ul
      ref={list}
      class="player-list"
      role="listbox"
      aria-label="Players"
      tabIndex={0}
      aria-activedescendant={current ? `option-${current.id}` : undefined}
      onKeyDown={onKeyDown}
    >
      {props.players.map((player, index) => (
        <li
          key={player.id}
          id={`option-${player.id}`}
          role="option"
          class={`player-option${index === active ? " active" : ""}${props.owned.has(player.id) ? " is-owned" : ""}`}
          aria-selected={index === active ? "true" : "false"}
          aria-label={optionName(player)}
          onClick={() => {
            moveTo(index);
            props.onPick(player);
          }}
        >
          {/* the visible words are the option's name in its own order (WCAG 2.5.3); squad membership is a marker, not text */}
          <ClubBadge code="" />
          <span class="name">{player.name}</span>
          <span class="meta">
            , {player.club}, {POSITION_WORD[player.position]},
          </span>
          <span class="mono"> {millions(player.price_tenths)}m</span>
        </li>
      ))}
    </ul>
  );
}
