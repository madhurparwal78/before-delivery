import { useCallback, useEffect, useState } from "react";
import type { Guest } from "../shared/api";
import { get, post, refusalText } from "./api";
import { Layer } from "./dialogs";
import { useBusy, useSequence } from "./hooks";
import { useLive } from "./live";
import { LiveLine, TopBar } from "./Shell";
import { useSession } from "./session";
import { EmptySheet } from "./ui";

const FIELDS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "company", label: "Company" },
  { key: "address", label: "Address" },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];

const optionText = (guest: Guest): string => (guest.email ? `${guest.name} ${guest.email}` : guest.name);

export function Guests() {
  const [search, setSearch] = useState("");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [everyone, setEveryone] = useState<Guest[]>([]);
  const [merging, setMerging] = useState(false);
  const sequence = useSequence();

  const load = useCallback(async (term: string) => {
    const id = sequence.next();
    const [shown, all] = await Promise.all([get<{ guests: Guest[] }>(`/api/guests?search=${encodeURIComponent(term)}`), get<{ guests: Guest[] }>("/api/guests")]);
    if (!sequence.isNewest(id)) return;
    if (shown.ok) setGuests(shown.data.guests);
    if (all.ok) setEveryone(all.data.guests);
  }, [sequence]);

  useEffect(() => void load(search), [load, search]);
  useLive(() => void load(search));

  return (
    <>
      <TopBar />
      <main className="page two-column">
        <LiveLine withClose={false} />
        <div className="column-left sheet">
          <h1>Guests</h1>
          <label>
            Search guests
            <input type="search" role="searchbox" aria-label="Search guests" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <button type="button" className="primary" onClick={() => setMerging(true)}>Merge guests</button>
        </div>
        <div className="column-right">
          <div className="table-frame" tabIndex={0} role="group" aria-label="Guests, scrollable">
            <table aria-label="Guests" className="ledger">
              <thead>
                <tr>{FIELDS.map((field) => <th key={field.key} scope="col">{field.label}</th>)}</tr>
              </thead>
              <tbody>
                {guests.map((guest) => (
                  <tr key={guest.id}>{FIELDS.map((field) => <td key={field.key}>{guest[field.key]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {guests.length === 0 ? <EmptySheet>No guests match.</EmptySheet> : null}
        </div>
      </main>
      <MergeDialog open={merging} guests={everyone} onClose={() => setMerging(false)} onMerged={() => void load(search)} />
    </>
  );
}

function MergeDialog({ open, guests, onClose, onMerged }: { open: boolean; guests: Guest[]; onClose: () => void; onMerged: () => void }) {
  const { setNotice } = useSession();
  const [survivorId, setSurvivorId] = useState("");
  const [mergedId, setMergedId] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [choices, setChoices] = useState<Partial<Record<FieldKey, "survivor" | "merged">>>({});
  const [message, setMessage] = useState("");
  const [busy, guard] = useBusy();

  useEffect(() => {
    if (open) {
      setSurvivorId("");
      setMergedId("");
      setReviewed(false);
      setChoices({});
      setMessage("");
    }
  }, [open]);

  const survivor = guests.find((guest) => guest.id === survivorId);
  const merged = guests.find((guest) => guest.id === mergedId);
  const differing = survivor && merged ? FIELDS.filter((field) => survivor[field.key] !== "" && merged[field.key] !== "" && survivor[field.key] !== merged[field.key]) : [];

  const confirm = (): void =>
    void guard(async () => {
      setNotice("Merging guests…");
      const picked = Object.fromEntries(differing.filter((field) => choices[field.key] === "merged").map((field) => [field.key, "merged"]));
      const answer = await post<{ staysMoved: number }>("/api/guests/merge", { survivorId, mergedId, choices: picked });
      if (!answer.ok) {
        setNotice(refusalText(answer));
        setMessage(refusalText(answer));
        return;
      }
      setNotice(`Guests merged. ${answer.data.staysMoved} stays moved.`);
      onMerged();
      onClose();
    });

  return (
    <Layer name="Merge guests" open={open} onClose={onClose} className="dialog">
      <h2>Merge guests</h2>
      <label>
        Surviving guest
        <select value={survivorId} onChange={(event) => { setSurvivorId(event.target.value); setReviewed(false); }}>
          <option value="">Choose</option>
          {guests.map((guest) => <option key={guest.id} value={guest.id}>{optionText(guest)}</option>)}
        </select>
      </label>
      <label>
        Merged guest
        <select value={mergedId} onChange={(event) => { setMergedId(event.target.value); setReviewed(false); }}>
          <option value="">Choose</option>
          {guests.map((guest) => <option key={guest.id} value={guest.id}>{optionText(guest)}</option>)}
        </select>
      </label>
      {message ? <p className="field-error">{message}</p> : null}
      <button type="button" className="review" onClick={() => setReviewed(Boolean(survivor && merged && survivor.id !== merged.id))}>Review merge</button>
      {reviewed && survivor && merged ? (
        <>
          <table aria-label="Merge conflicts" className="ledger conflicts">
            <thead>
              <tr><th scope="col">Field</th><th scope="col">Surviving guest</th><th scope="col">Merged guest</th></tr>
            </thead>
            <tbody>
              {differing.length === 0 ? <tr><td colSpan={3}>No conflicting fields.</td></tr> : null}
              {differing.map((field) => {
                const current = choices[field.key] ?? "survivor";
                return (
                  <tr key={field.key}>
                    <th scope="row">{field.label}</th>
                    <td colSpan={2} className="conflict-cell">
                      <div role="radiogroup" aria-label={field.label} className="radio-row">
                        {(["survivor", "merged"] as const).map((side) => {
                          const value = (side === "survivor" ? survivor : merged)[field.key];
                          return (
                            <label key={side} className="radio">
                              <input
                                type="radio"
                                name={`merge-${field.key}`}
                                aria-label={`Keep ${value}`}
                                checked={current === side}
                                onChange={() => setChoices((previous) => ({ ...previous, [field.key]: side }))}
                              />
                              <span>{value}</span>
                            </label>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}
      <div className="button-row">
        {reviewed && survivor && merged ? <button type="button" className="primary" aria-busy={busy} onClick={confirm}>Confirm merge</button> : null}
        <button type="button" className="quiet" onClick={onClose}>Close</button>
      </div>
    </Layer>
  );
}
