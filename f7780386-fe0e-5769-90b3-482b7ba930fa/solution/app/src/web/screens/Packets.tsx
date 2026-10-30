// Packets (operator): issue a compliance packet link for a date range, copy, revoke or regenerate it.

import { useState } from "preact/hooks";
import type { Packet } from "../../shared/api.js";
import { isoInstant, wallInstant } from "../../shared/zone.js";
import type { Session } from "../App.js";
import { get, post } from "../api.js";
import { announce, complain, perform } from "../feedback.js";
import { kitchenStamp } from "../format.js";
import { CopyIcon } from "../icons.js";
import { minutesOf } from "../board/model.js";
import { Cell, EmptyRow, ScreenHead, useData } from "./shared.js";

const STATUS_WORDS: Record<Packet["status"], string> = { active: "Active", revoked: "Revoked", expired: "Expired" };

const CREATE_REFUSALS: Record<string, string> = {
  before_from: "The end date must be on or after the start date.",
  range_too_long: "A packet covers at most 31 days.",
  not_in_future: "The link must expire after now.",
  too_far: "Links can expire at most 30 days from now.",
  invalid: "Fill in the dates and the expiry time.",
};

export function PacketsScreen({ session }: { session: Session }) {
  const zone = session.kitchen.time_zone;
  const packets = useData(() => get<{ packets: Packet[] }>("/api/packets"), []);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  /** "2026-11-02T14:30" typed in kitchen time, as an instant with the kitchen's offset. */
  const expiryInstant = (): string => {
    const [day, time] = expires.split("T");
    return day && time ? isoInstant(wallInstant(day, minutesOf(time), zone), zone) : "";
  };

  const create = async (event: Event) => {
    event.preventDefault();
    setBusy("create");
    await perform(
      "Creating packet…",
      () => post<{ packet: Packet }>("/api/packets", { from, to, expires_at: expiryInstant() }),
      ({ packet }) => `Packet link created. It expires ${kitchenStamp(packet.expires_at, zone)}.`,
      (failure) => {
        if (failure.body.error === "storage_unavailable") return { text: "File storage is unreachable. Nothing was saved; try again shortly." };
        const code = Object.values(failure.body.errors ?? {})[0];
        return code && CREATE_REFUSALS[code] ? { text: CREATE_REFUSALS[code] } : null;
      },
    );
    setBusy(null);
    await packets.reload();
  };

  const act = async (packet: Packet, action: "revoke" | "regenerate") => {
    setBusy(`${action}:${packet.id}`);
    await perform(
      action === "revoke" ? "Revoking link…" : "Regenerating link…",
      () => post<{ packet: Packet }>(`/api/packets/${packet.id}/${action}`),
      () => (action === "revoke" ? "Packet link revoked." : "New packet link created. The old link no longer works."),
      (failure) => {
        if (failure.body.error === "invalid_transition") return { text: action === "revoke" ? "This link was already revoked." : "A revoked link can't be regenerated." };
        if (failure.body.error === "storage_unavailable") return { text: "File storage is unreachable. Nothing was saved; try again shortly." };
        if (failure.body.errors?.expires_at) return { text: "This link has expired. Create a new packet with a future expiry." };
        return null;
      },
    );
    setBusy(null);
    await packets.reload();
  };

  const copy = async (packet: Packet) => {
    if (!packet.url) return;
    try {
      await navigator.clipboard.writeText(new URL(packet.url, window.location.origin).toString());
      announce("Link copied.");
    } catch {
      complain("The link could not be copied. Select it in the table instead.");
    }
  };

  const rows = packets.data?.packets ?? [];
  return (
    <section class="screen">
      <ScreenHead title="Packets">
        <p class="screen-head__note">Read-only compliance packets for a health inspector. No sign-in is needed to open a link.</p>
      </ScreenHead>
      <form class="panel form-grid" aria-label="New packet" onSubmit={create} noValidate>
        <label class="field">
          <span class="field__label">From</span>
          <input type="date" value={from} onInput={(e) => setFrom(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span class="field__label">To</span>
          <input type="date" value={to} onInput={(e) => setTo(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span class="field__label">Link expires at</span>
          <input type="datetime-local" value={expires} onInput={(e) => setExpires(e.currentTarget.value)} />
        </label>
        <p class="field__hint">Times are kitchen time ({zone})</p>
        <div class="form-grid__actions">
          <button type="submit" class="button button--primary" disabled={busy !== null} aria-busy={busy === "create" ? "true" : "false"}>
            Create packet link
          </button>
        </div>
      </form>
      <table class="table">
        <caption>Packet links</caption>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Expires</th>
            <th scope="col">Status</th>
            <th scope="col">Link</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {!packets.data && <EmptyRow columns={6}>Loading…</EmptyRow>}
          {packets.data && rows.length === 0 && <EmptyRow columns={6}>No packet links yet.</EmptyRow>}
          {rows.map((p) => (
            <tr key={p.id}>
              <Cell label="From">
                {p.from}
              </Cell>
              <Cell label="To">
                {p.to}
              </Cell>
              <Cell label="Expires">
                {kitchenStamp(p.expires_at, zone)}
              </Cell>
              <Cell label="Status">
                <span class={`status-word status-word--${p.status}`}>{STATUS_WORDS[p.status]}</span>
              </Cell>
              <Cell label="Link">{p.url ? <code class="code code--wrap">{p.url}</code> : "—"}</Cell>
              <Cell label="Actions">
                <div class="row-actions">
                  <button type="button" class="button" disabled={!p.url} onClick={() => void copy(p)}>
                    <CopyIcon />
                    <span>Copy link</span>
                  </button>
                  <button type="button" class="button" disabled={busy !== null || p.status === "revoked"} aria-busy={busy === `revoke:${p.id}` ? "true" : "false"} onClick={() => void act(p, "revoke")}>
                    Revoke link
                  </button>
                  <button type="button" class="button" disabled={busy !== null || p.status === "revoked"} aria-busy={busy === `regenerate:${p.id}` ? "true" : "false"} onClick={() => void act(p, "regenerate")}>
                    Regenerate link
                  </button>
                </div>
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
