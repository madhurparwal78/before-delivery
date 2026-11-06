// Small shared controls: the Team selector, error alerts and screen headers.

import type { ComponentChildren } from "preact";
import { useSession, isOrgRole } from "./session";

/** `combobox "Team"` for org roles; members always work in their own team. */
export function TeamPicker({ id }: { id: string }) {
  const session = useSession();
  if (!isOrgRole(session.me)) return null;
  return (
    <div class="field field--inline">
      <label for={id}>Team</label>
      <select id={id} value={session.teamId} onChange={(e) => session.setTeamId(e.currentTarget.value)}>
        {session.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
  );
}

/** An error the user must see: graphite text beside a vermilion rule. Rendered only when present. */
export function Alert({ text }: { text: string | null }) {
  if (!text) return null;
  return <p class="alert" role="alert">{text}</p>;
}

export function ScreenHead({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <header class="screen__head">
      <h1 class="screen__title">{title}</h1>
      {children && <div class="screen__tools">{children}</div>}
    </header>
  );
}

/** Prose with every figure in it set in tabular mono, so numbers keep one face wherever they appear. */
export function Figures({ text }: { text: string }) {
  return <>{text.split(/(\d[\d,.]*\d|\d)/).map((part, i) => i % 2 ? <span key={i} class="num">{part}</span> : part)}</>;
}

export function StateWord({ word, tone }: { word: string; tone?: "alert" | "quiet" }) {
  return <span class={`badge${tone ? ` badge--${tone}` : ""}`}>{word}</span>;
}
