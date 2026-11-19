// Disputes: pin the damage on the arrival photograph, open the transfer hold through
// "Hold ownership transfer", share and revoke a private evidence link, and resolve the hold.

import { useEffect, useRef, useState } from "react";
import { F, textLong } from "../../shared/feedback";
import { characters } from "../../shared/textRules";
import { draftKey, type MarkerDraft } from "../../shared/drafts";
import type { EvidenceLink } from "../../shared/types";
import { jsonCommand, newCommandId } from "../commands";
import { limits } from "../config";
import { useDesk } from "../desk";
import { useDraft } from "../drafts";
import { EmptyFacts, FactBoxes, label, useSelectedOffer, Workspace } from "../parts";
import { Review } from "../Review";
import { CoinImage, CoordinateFields, Marker, type Point, useBoxSize } from "../viewers";

type Dialog = "open" | "propose" | "approve" | "revoke" | null;

export function Disputes() {
  const { ns, state, session, send, announce, revoked } = useDesk();
  const [offerKey, offer] = useSelectedOffer(["disputed", "received", "dispatched"]);
  const party = session?.role === "counterpart" ? "counterpart" : "dealer";
  const disputes = Object.entries(state?.disputes ?? {}).filter(([, d]) => d.offer === offerKey);
  const [disputeKey, dispute] = disputes.find(([, d]) => d.open) ?? disputes.at(-1) ?? [null, undefined];
  const received = offer ? (party === "dealer" ? offer.counterpart_items : offer.dealer_items) : [];
  const subject = dispute?.specimen ?? received[0] ?? null;
  const [draft, setDraft] = useDraft<MarkerDraft>(draftKey(ns, "disputes", `${offerKey}/${subject}`), { note: "", x: 500, y: 500 });
  const [links, setLinks] = useDraft<EvidenceLink | null>(draftKey(ns, "links", disputeKey ?? "none"), null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [outcome, setOutcome] = useState<"transfer" | "return">("transfer");
  const [moved, setMoved] = useState<Point | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const size = useBoxSize(frame);
  const openDispute = dispute?.open ? dispute : undefined;
  const serverMarker = openDispute?.markers[0];
  const point: Point = openDispute && serverMarker ? (moved ?? serverMarker) : draft;

  // A moved marker on an open dispute is saved shortly after the last movement; the loser of two
  // screens moving one marker shows the server's position again.
  useEffect(() => {
    if (!moved || !openDispute || !serverMarker || !disputeKey) return;
    const id = setTimeout(() => {
      void send(jsonCommand("marker", "PUT", `/disputes/${disputeKey}/markers/${serverMarker.id}`, { expected_version: openDispute.version, x: moved.x, y: moved.y, text: serverMarker.text })).then(() => setMoved(null));
    }, 700);
    return () => clearTimeout(id);
  }, [moved, openDispute, serverMarker, disputeKey, send]);

  if (!state || !session) return null;
  if (!offerKey || !offer || !subject) {
    return (
      <Workspace name="Dispute evidence workspace" heading="Disputes" list="exchange" className="ws-disputes">
        <EmptyFacts heading="Disputes:" steps={["Nothing has arrived that could be disputed.", "Arrivals from a dispatched offer can be disputed here."]} />
      </Workspace>
    );
  }
  const specimen = state.specimens[subject];
  const arrival = specimen?.photos.filter((p) => p.label === "arrival").at(-1);
  const tooLong = characters(draft.note) > limits.FLAN_NOTE_MAX_CHARS;
  const canOpen = !openDispute && received.includes(subject) && (offer.status === "dispatched" || offer.status === "received");
  const proposal = openDispute?.resolution ?? null;

  const copyLink = async () => {
    const result = await send(jsonCommand("link", "POST", `/disputes/${disputeKey}/links`));
    if (!result.ok) return;
    const link = (result.body as { link: EvidenceLink }).link;
    setLinks(link);
    const copied = await navigator.clipboard.writeText(link.url).then(() => true, () => false);
    if (copied) announce(F.LINK_COPIED);
  };

  return (
    <Workspace name="Dispute evidence workspace" heading={`Disputes · ${offerKey}`} list="exchange" className="ws-disputes" facts={<FactBoxes specimenKey={subject} specimen={specimen} />}>
      <figure className="area-evidence viewer">
        <figcaption className="box-heading">{`${label(subject)} arrival evidence:`}</figcaption>
        <div ref={frame} className="photo-frame evidence-frame">
          {arrival && <CoinImage photo={arrival} alt={`${label(subject)} arrival`} />}
          {arrival && size.width > 0 && !revoked && (
            <Marker
              label="Damage marker"
              point={point}
              image={arrival}
              frame={size}
              onMove={(p) => (openDispute ? setMoved(p) : setDraft((d) => ({ ...d, ...p })))}
            />
          )}
        </div>
        <p className="caption-text">
          {openDispute ? `Dispute open. Ownership transfer is on hold.` : dispute ? "The dispute is resolved." : "No dispute is open on this offer."}
        </p>
      </figure>
      <div className="area-coords">
        {arrival && <CoordinateFields point={point} image={arrival} onSet={(p) => (openDispute ? setMoved(p) : setDraft((d) => ({ ...d, ...p })))} />}
      </div>
      <div className="area-note field">
        <label htmlFor="damage-note">Damage note:</label>
        <textarea id="damage-note" aria-label="Damage note" rows={3} value={draft.note} aria-invalid={tooLong} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
        {tooLong && <p className="field-error">{textLong(limits.FLAN_NOTE_MAX_CHARS)}</p>}
      </div>
      <div className="area-actions actions dispute-actions">
        {canOpen && (
          <button type="button" className="button primary" onClick={() => setDialog("open")}>
            Review dispute
          </button>
        )}
        {openDispute && (
          <button type="button" className="button quiet" onClick={() => setDialog("propose")}>
            Propose resolution
          </button>
        )}
        {openDispute && proposal && proposal.proposed_by !== party && (
          <button type="button" className="button primary" onClick={() => setDialog("approve")}>
            Approve resolution
          </button>
        )}
        {proposal && openDispute && (
          <p className="caption-text">{`Proposed by the ${proposal.proposed_by}: ${proposal.outcome === "transfer" ? "transfer as agreed" : "return both baskets"}.`}</p>
        )}
        {dispute && (
          <button type="button" className="button quiet" onClick={() => void copyLink()}>
            Copy private evidence link
          </button>
        )}
        {dispute && links && (
          <button type="button" className="button quiet" onClick={() => setDialog("revoke")}>
            Revoke evidence link
          </button>
        )}
        {links && <p className="caption-text figures">{`Link expires ${links.expires_at.slice(0, 16).replace("T", " ")} UTC.`}</p>}
      </div>
      {dialog === "open" && (
        <Review
          label="Hold ownership transfer"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await send(
              jsonCommand("dispute", "POST", `/offers/${offerKey}/disputes`, {
                expected_version: offer.version,
                specimen: subject,
                note: draft.note,
                markers: [{ x: draft.x, y: draft.y, text: draft.note || "Damage" }],
              }),
            );
            return "close";
          }}
          summary={
            <p>
              Opens a dispute on <strong>{label(subject)}</strong> with the damage marker at <span className="figures">({draft.x}, {draft.y})</span>. Ownership transfer is held on both
              screens until both parties approve a resolution.
            </p>
          }
        />
      )}
      {(dialog === "propose" || dialog === "approve") && openDispute && (
        <Review
          label="Resolve transfer hold"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            if (dialog === "approve") await send(jsonCommand("approve", "POST", `/disputes/${disputeKey}/approve-resolution`, { expected_version: openDispute.version }));
            else await send(jsonCommand("propose", "POST", `/disputes/${disputeKey}/resolution`, { expected_version: openDispute.version, outcome }));
            return "close";
          }}
          summary={<p>{dialog === "approve" ? "Approves the proposed resolution and releases the transfer hold." : "Proposes how to release the transfer hold. The other party approves it."}</p>}
        >
          <fieldset className="radios">
            <legend>Resolution:</legend>
            {(["transfer", "return"] as const).map((value) => (
              <label key={value} className="radio">
                <input
                  type="radio"
                  name="resolution"
                  value={value}
                  checked={(dialog === "approve" ? proposal?.outcome : outcome) === value}
                  disabled={dialog === "approve"}
                  onChange={() => setOutcome(value)}
                />
                {value === "transfer" ? "Transfer as agreed" : "Return both baskets"}
              </label>
            ))}
          </fieldset>
        </Review>
      )}
      {dialog === "revoke" && links && (
        <Review
          label="Revoke evidence access"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const result = await send({ kind: "revoke-link", method: "DELETE", path: `/disputes/${disputeKey}/links/${links.token}`, commandId: newCommandId() });
            if (result.ok) setLinks(null);
            return "close";
          }}
          summary={<p>Ends access through the private evidence link at once.</p>}
        />
      )}
    </Workspace>
  );
}
