import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, get, post } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { useEvent, useStore } from "../lib/store";
import type { Review, ReviewLine, ReviewSummary } from "../lib/types";
import { Dialog } from "../ui/Dialog";
import { useOnce } from "../ui/Field";
import { vendorText } from "./Slip";

const STATUS_WORDS = { open: "Open", overdue: "Overdue", signed_off: "Signed off" } as const;

export function Reviews() {
  useTitle("Access reviews");
  const { me, say, warn, bumpAudit, streamTick } = useStore();
  const isOffice = me?.role === "office_manager";
  const isPartner = me?.role === "managing_partner";
  const [list, setList] = useState<ReviewSummary[] | null>(null);
  const [current, setCurrent] = useState<Review | null>(null);
  const [past, setPast] = useState<ReviewSummary[]>([]);
  const [pastOpen, setPastOpen] = useState<Review | null>(null);
  const [removing, setRemoving] = useState<ReviewLine | null>(null);
  const [signing, setSigning] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const focusNext = useRef<{ after: string | null } | null>(null);
  const currentRef = useRef<Review | null>(null);
  currentRef.current = current;
  const { run } = useOnce();

  const loadAll = useCallback(async (): Promise<Review | null> => {
    const body = await get<{ reviews: ReviewSummary[] }>("/api/reviews");
    const top = body.reviews[0];
    const full = top ? await get<Review>(`/api/reviews/${top.id}`) : null;
    setList(body.reviews);
    setPast(body.reviews.slice(1));
    setCurrent(full);
    return full;
  }, []);

  useEffect(() => { void loadAll().catch(() => undefined); }, [loadAll, streamTick]);

  const nextUndecided = (review: Review, after: string | null): ReviewLine | null => {
    const lines = review.lines;
    const start = after ? lines.findIndex((l) => l.id === after) : -1;
    for (let step = 1; step <= lines.length; step += 1) {
      const line = lines[(start + step + lines.length) % lines.length];
      if (line && line.decision === "undecided") return line;
    }
    return null;
  };

  useLayoutEffect(() => {
    const want = focusNext.current;
    if (!want || !current) return;
    focusNext.current = null;
    const line = nextUndecided(current, want.after);
    if (line) document.querySelector<HTMLElement>(`[data-keep="${line.id}"]`)?.focus();
    else headingRef.current?.focus();
  });

  useEvent("review-changed", () => {
    const before = currentRef.current;
    const active = document.activeElement;
    const focusedLine = active instanceof HTMLElement ? (active.closest("[data-line]") as HTMLElement | null)?.dataset.line ?? null : null;
    void loadAll().then((after) => {
      if (!after || !before) return;
      if (focusedLine) {
        const line = after.lines.find((l) => l.id === focusedLine);
        if (line && line.decision !== "undecided") focusNext.current = { after: line.id };
      }
      setRemoving((r) => (r && after.lines.find((l) => l.id === r.id)?.decision !== "undecided" ? null : r));
      if (focusedLine) setCurrent({ ...after });
    }).catch(() => undefined);
  });
  useEvent("review-opened", () => { void loadAll().catch(() => undefined); });

  const decide = async (line: ReviewLine, decision: "keep" | "remove") => {
    if (!current) return;
    await run(async () => {
      try {
        await post(`/api/reviews/${current.id}/lines/${line.id}`, { decision });
        focusNext.current = { after: line.id };
        const after = await loadAll();
        if (after) say(`${line.person_name} ${decision === "keep" ? "kept on" : "removed from"} ${line.vault_name}. ${after.decided} of ${after.total} lines decided.`);
        bumpAudit();
      } catch (error) {
        if (error instanceof ApiError) {
          warn(error.message);
          void loadAll().catch(() => undefined);
        }
      }
    });
  };

  const signOff = async () => {
    if (!current || signing) return;
    setSigning(true);
    try {
      await post(`/api/reviews/${current.id}/sign-off`, {});
      await loadAll();
      say("Review signed off.");
      bumpAudit();
      statusRef.current?.focus();
    } catch (error) {
      if (error instanceof ApiError) warn(error.message);
    } finally { setSigning(false); }
  };

  const openPast = async (summary: ReviewSummary) => {
    setPastOpen(await get<Review>(`/api/reviews/${summary.id}`));
  };

  const onPastKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % past.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + past.length) % past.length;
    else return;
    event.preventDefault();
    document.getElementById(`past-${past[next]?.id}`)?.focus();
  };

  return (
    <div className="folder-page">
      <h1 className="page-title">Access reviews</h1>
      {current ? (
        <section className="folder band-0" aria-label={`${current.quarter} access review`}>
          <h2 tabIndex={-1} ref={headingRef}>{current.quarter} access review</h2>
          <p className="review-status" tabIndex={-1} ref={statusRef}>{STATUS_WORDS[current.status]}</p>
          <p role="status" aria-label="Review progress" className="progress fig">{current.decided} of {current.total} lines decided</p>
          {isPartner ? (
            <button type="button" className="btn btn-solid btn-cut sign-off" aria-disabled={signing || undefined} onClick={() => void signOff()}>{signing ? "Signing off" : "Sign off review"}</button>
          ) : null}
          <ul className="review-lines">
            {current.lines.map((line) => <LineSlip key={line.id} line={line} isOffice={isOffice} onKeep={() => void decide(line, "keep")} onRemove={() => setRemoving(line)} />)}
          </ul>
        </section>
      ) : list ? <p className="muted">No review is open yet.</p> : null}

      {past.length > 0 ? (
        <section className="folder band-1 past">
          <h2>Past reviews</h2>
          <div role="tablist" aria-label="Past reviews" className="past-tabs">
            {past.map((p, index) => (
              <button key={p.id} id={`past-${p.id}`} type="button" role="tab" className="folder-tab small-tab" aria-selected={pastOpen?.id === p.id} tabIndex={pastOpen?.id === p.id || (!pastOpen && index === 0) ? 0 : -1}
                onClick={() => void openPast(p)} onKeyDown={(e) => onPastKey(e, index)}>{p.quarter}</button>
            ))}
          </div>
          {pastOpen ? (
            <div role="tabpanel" aria-label={`${pastOpen.quarter} access review`} className="past-panel">
              <p className="review-status">{STATUS_WORDS[pastOpen.status]}</p>
              <p className="progress fig">{pastOpen.decided} of {pastOpen.total} lines decided</p>
              <ul className="review-lines">
                {pastOpen.lines.map((line) => <LineSlip key={line.id} line={line} isOffice={false} onKeep={() => undefined} onRemove={() => undefined} />)}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {removing && current ? (
        <Dialog label={`Remove ${removing.person_name} from ${removing.vault_name}`} onClose={() => { setRemoving(null); }} returnFocus={() => document.querySelector<HTMLElement>(`[data-remove="${removing.id}"]`)}>
          <p>Their access to {removing.vault_name} ends now.</p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-solid btn-cut" onClick={() => { const target = removing; setRemoving(null); void decide(target, "remove"); }}>Remove access</button>
            <button type="button" className="btn btn-quiet" onClick={() => setRemoving(null)}>Cancel</button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function LineSlip({ line, isOffice, onKeep, onRemove }: { line: ReviewLine; isOffice: boolean; onKeep: () => void; onRemove: () => void }) {
  return (
    <li className="slip review-slip" data-line={line.id}>
      <div className="rl-who">
        <strong>{line.person_name}</strong>
        <span>{line.vault_name}{line.vault_formerly ? ` (formerly ${line.vault_formerly})` : ""}</span>
      </div>
      <div className="rl-vendors">{line.vendors.length === 0 ? "No logins filed" : line.vendors.map((v) => vendorText(v)).join(", ")}</div>
      <div className="rl-action">
        {line.decision === "undecided" ? (
          isOffice ? (
            <>
              <button type="button" className="btn btn-solid" aria-label={`Keep ${line.person_name} on ${line.vault_name}`} data-keep={line.id} onClick={onKeep}>Keep</button>
              <button type="button" className="btn btn-quiet" aria-label={`Remove ${line.person_name} from ${line.vault_name}`} data-remove={line.id} onClick={onRemove}>Remove</button>
            </>
          ) : <span>Undecided</span>
        ) : (
          <span className="decision">{line.decision === "kept" ? "Kept" : "Removed"}{line.decided_via === "scope_change" ? " by scope change" : ""}</span>
        )}
      </div>
    </li>
  );
}
