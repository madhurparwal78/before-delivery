// Catalog reconciliation: wipe between the register's reference image and the obverse photograph,
// type the catalogue reference and save only after the register has answered.

import { useEffect, useRef, useState } from "react";
import { catalogCountdown, F, textLong } from "../../shared/feedback";
import { characters } from "../../shared/textRules";
import { draftKey, type CorrectionDraft } from "../../shared/drafts";
import { jsonCommand } from "../commands";
import { limits } from "../config";
import { type CommandRequest, useDesk } from "../desk";
import { useDraft } from "../drafts";
import { EmptyFacts, FactBoxes, label, useSelectedSpecimen, Workspace } from "../parts";
import { Review } from "../Review";
import { CoinImage, Wipe } from "../viewers";

interface Pending {
  request: CommandRequest;
  copy: string;
  countdown: number | null;
}

export function Reconcile() {
  const { ns, send, announce } = useDesk();
  const [key, specimen] = useSelectedSpecimen();
  const [draft, setDraft] = useDraft<CorrectionDraft>(draftKey(ns, "reconciliation", key ?? "none"), { correction: "" });
  const [divider, setDivider] = useDraft<number>(draftKey(ns, "divider", `reconciliation:${key ?? "none"}`), 50);
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const sendRef = useRef<(request: CommandRequest) => Promise<void>>(async () => undefined);

  const attempt = async (request: CommandRequest) => {
    setBusy(true);
    const outcome = await send(request);
    setBusy(false);
    if (outcome.ok) {
      setPending(null);
      return;
    }
    const error = outcome.error;
    if (error && error.error.startsWith("catalog_")) {
      setPending({ request, copy: error.message, countdown: error.error === "catalog_busy" ? (error.retry_after_seconds ?? 1) : null });
    }
  };
  sendRef.current = attempt;

  const counting = pending?.countdown ?? null;
  useEffect(() => {
    if (counting === null) return;
    if (counting <= 0) {
      announce(F.CATALOG_RETRYING);
      const request = pending!.request;
      setPending((p) => (p ? { ...p, countdown: null } : p));
      void sendRef.current(request);
      return;
    }
    const id = setTimeout(() => setPending((p) => (p && p.countdown !== null ? { ...p, countdown: p.countdown - 1 } : p)), 1000);
    return () => clearTimeout(id);
  }, [counting, announce, pending]);

  if (!key || !specimen) {
    return (
      <Workspace name="Catalog reconciliation workspace" heading="Catalog reconciliation" list="stock" className="ws-reconcile">
        <EmptyFacts heading="Catalog reconciliation:" steps={["No specimen is on the desk yet.", "Take one in at Intake first."]} />
      </Workspace>
    );
  }

  const obverse = specimen.photos.filter((p) => p.label === "obverse").at(-1);
  const reference = specimen.attribution.reference ?? (draft.correction || null);
  const tooLong = characters(draft.correction) > limits.FLAN_CORRECTION_MAX_CHARS;
  const noteText = pending
    ? pending.countdown !== null
      ? catalogCountdown(pending.countdown)
      : pending.copy
    : specimen.attribution.register === "stored"
      ? `Register record ${specimen.attribution.reference} revision ${specimen.attribution.revision} is stored.`
      : F.CATALOG_PENDING;

  return (
    <Workspace name="Catalog reconciliation workspace" heading={`Catalog reconciliation · ${label(key)}`} list="stock" className="ws-reconcile">
      <div className="area-viewer viewer">
        <Wipe
          tabs={["Register", "Obverse"]}
          sliderLabel="Reference divider"
          value={divider}
          onChange={setDivider}
          first={reference ? <CoinImage photo={{ id: `register:${reference}` }} alt={`${label(key)} register`} /> : <div className="frame-empty">{F.CATALOG_PENDING}</div>}
          second={obverse && <CoinImage photo={obverse} alt={`${label(key)} obverse`} />}
        />
      </div>
      <div className="area-correction field">
        <label htmlFor="attribution-correction">Attribution correction:</label>
        <input
          id="attribution-correction"
          aria-label="Attribution correction"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={draft.correction}
          aria-invalid={tooLong}
          aria-describedby={tooLong ? "correction-error" : undefined}
          onChange={(e) => setDraft({ correction: e.target.value })}
        />
        {tooLong && (
          <p id="correction-error" className="field-error">
            {textLong(limits.FLAN_CORRECTION_MAX_CHARS)}
          </p>
        )}
      </div>
      <div className="area-note note catalogue-note">
        {(pending || specimen.attribution.register === "pending") && (
          <button type="button" className="action-link" disabled={!pending || busy || pending.countdown !== null} onClick={() => pending && void attempt(pending.request)}>
            Retry catalog
          </button>
        )}
        <p className="figures">{noteText}</p>
      </div>
      <div className="area-facts">
        <FactBoxes specimenKey={key} specimen={specimen} />
      </div>
      <div className="area-review actions">
        <button type="button" className="button primary" onClick={() => setReviewing(true)}>
          Review reconciliation
        </button>
      </div>
      {reviewing && (
        <Review
          label="Save reconciliation"
          onClose={() => setReviewing(false)}
          onConfirm={async () => {
            await attempt(jsonCommand("reconcile", "POST", `/specimens/${encodeURIComponent(key)}/reconcile`, { expected_version: specimen.version, correction: draft.correction }));
            return "close";
          }}
          summary={
            <p>
              Reconciles <strong>{label(key)}</strong> against catalog reference <strong>{draft.correction || "none typed"}</strong>. It saves only after the register answers and its record is stored.
            </p>
          }
        />
      )}
    </Workspace>
  );
}
