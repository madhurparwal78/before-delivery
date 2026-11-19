import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { request, sessionEnded, type Fee, type Photo } from "../api";
import { PhotoComparison } from "../components/PhotoComparison";
import { ActionButton, Dialog, FormProblems, Num, PegStrip, Status, usePoll, WithNumerals, type Problem } from "../components/ui";
import { dollars, libraryStamp } from "../format";
import { takeDraft } from "../session";
import type { Me } from "../shell";
import { FEE_WORD } from "./Account";
import { NotFound } from "./NotFound";
import { PaneAnnouncements } from "./Pegboard";
import { useAnnouncer } from "./useAnnouncer";

type Pending = "pay" | "send" | "approve" | "decline" | null;

export function FeePage({ me, id }: { me: Me; id: number }) {
  const [fee, setFee] = useState<Fee | null | "missing">(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pending, setPending] = useState<Pending>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonProblems, setReasonProblems] = useState<Problem[]>([]);
  const news = useAnnouncer(me);
  const summary = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lines = useRef<HTMLTableElement>(null);
  const payButton = useRef<HTMLButtonElement>(null);
  const askButton = useRef<HTMLButtonElement>(null);
  const reasonBox = useRef<HTMLTextAreaElement>(null);
  const focusAfter = useRef<"heading" | "lines" | "pay" | "ask" | "summary" | "reason" | null>(null);
  const lastStatus = useRef<Fee["status"] | null>(null);
  const waivedAnnounced = useRef(false);
  const owner = me.user.role === "member";
  const coordinator = me.user.role === "coordinator";

  useLayoutEffect(() => {
    const target = {
      heading: heading.current,
      lines: lines.current,
      pay: payButton.current,
      ask: askButton.current,
      summary: summary.current,
      reason: reasonBox.current,
    }[focusAfter.current ?? "heading"];
    if (focusAfter.current) target?.focus();
    focusAfter.current = null;
  });

  const apply = (next: Fee) => {
    const before = lastStatus.current;
    lastStatus.current = next.status;
    if (owner && before === "raised" && next.status === "waived-by-coordinator" && !waivedAnnounced.current) {
      waivedAnnounced.current = true;
      news.announce(`Fee ${next.id} was waived.`);
    }
    const focused = document.activeElement;
    const removing = next.status !== "raised";
    if (removing && (focused === payButton.current || focused === askButton.current) && focused !== null) focusAfter.current = "heading";
    else if (next.waiver?.status === "requested" && focused === askButton.current && focused !== null) focusAfter.current = "heading";
    setFee(next);
  };

  const read = useCallback(async () => {
    const answer = await request<{ fee: Fee; photos: Photo[] }>("GET", `/api/fees/${id}`);
    if (answer.status === 404) setFee("missing");
    if (answer.status !== 200) return;
    apply(answer.body.fee);
    setPhotos(answer.body.photos);
  }, [id]);

  useEffect(() => {
    void read().then(() => {
      const draft = takeDraft(window.location.pathname, me.user.id);
      if (draft?.reason !== undefined) {
        setReason(draft.reason);
        setDialogOpen(true);
      }
    });
  }, []);
  usePoll(read, 10_000, fee !== "missing");

  if (fee === "missing") return <NotFound />;

  const act = async (kind: Exclude<Pending, null>, path: string, body?: unknown) => {
    setPending(kind);
    const answer = await request<{ fee: Fee }>("POST", path, body);
    setPending(null);
    if (sessionEnded(answer)) {
      const kept = kind === "send" ? reason : undefined;
      setDialogOpen(false);
      news.sessionEnded({ fields: {}, ...(kept !== undefined ? { reason: kept } : {}) });
      return null;
    }
    return answer;
  };

  const pay = async () => {
    if (fee === null) return;
    const answer = await act("pay", `/api/fees/${id}/pay`);
    if (!answer) return;
    if (answer.status === 200) {
      lastStatus.current = answer.body.fee.status;
      setFee(answer.body.fee);
      news.announce("Fee settled.");
      focusAfter.current = "lines";
    } else news.announce(answer.error);
  };

  const sendWaiver = async () => {
    const answer = await act("send", `/api/fees/${id}/waiver-request`, { reason });
    if (!answer) return;
    if (answer.status === 201) {
      setFee(answer.body.fee);
      setDialogOpen(false);
      setReasonProblems([]);
      news.announce("Waiver requested. The coordinator will decide.");
      focusAfter.current = "pay";
    } else if (answer.status === 422) {
      setReasonProblems([{ field: "reason", label: "Reason", message: answer.fields.reason ?? answer.error, target: "waiver-reason" }]);
      focusAfter.current = "summary";
    } else {
      news.announce(answer.error);
      focusAfter.current = "reason";
    }
  };

  const decide = async (decision: "approve" | "decline") => {
    const answer = await act(decision, `/api/fees/${id}/waiver-decision`, { decision });
    if (!answer) return;
    if (answer.status === 200) {
      lastStatus.current = answer.body.fee.status;
      setFee(answer.body.fee);
      news.announce(decision === "approve" ? "Fee waived." : "Waiver declined.");
      focusAfter.current = "lines";
    } else news.announce(answer.error);
  };

  const raised = fee !== null && fee.status === "raised";
  const waiverRequested = fee !== null && fee.waiver?.status === "requested";

  return (
    <div class="page record-page">
      <PegStrip />
      <PaneAnnouncements news={news} summary={summary} showProblems={!dialogOpen} />
      {fee === null ? (
        <p class="loading-line">Loading the fee…</p>
      ) : (
        <>
          <div class="title-row">
            <h1 tabIndex={-1} ref={heading}>
              Fee {fee.id}
            </h1>
            <Status word={FEE_WORD[fee.status]} />
          </div>
          <p class="lede">
            For loan{" "}
            <a href={`/loans/${fee.loan_id}`}>
              <Num>{fee.loan_ref}</Num>
            </a>
            . Recorded in Kill Bill as one invoice.
          </p>
          <table class="ledger" aria-label="Fee lines" tabIndex={-1} ref={lines}>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col" class="amount">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {fee.lines.map((line, index) => (
                <tr key={index}>
                  <td>
                    <WithNumerals text={line.description} />
                  </td>
                  <td class="amount">
                    <Num>${dollars(line.amount_cents)}</Num>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td class="amount">
                  <Num>${dollars(fee.total_cents)}</Num>
                </td>
              </tr>
            </tfoot>
          </table>
          <p class="waiver-state">
            {fee.waiver === null ? (
              "No waiver requested."
            ) : (
              <>
                Waiver {fee.waiver.status}, requested <Num>{libraryStamp(fee.waiver.requested_at)}</Num>
                {fee.waiver.decided_at && (
                  <>
                    , decided <Num>{libraryStamp(fee.waiver.decided_at)}</Num>
                  </>
                )}
                .
              </>
            )}
          </p>
          {fee.waiver && <blockquote class="waiver-reason">{fee.waiver.reason}</blockquote>}
          <div class="actions">
            {owner && raised && (
              <ActionButton
                label={`Pay $${dollars(fee.total_cents)}`}
                pendingLabel="Paying..."
                pending={pending === "pay"}
                primary
                buttonRef={payButton}
                onAct={() => void pay()}
              />
            )}
            {owner && raised && !waiverRequested && (
              <button type="button" class="btn" ref={askButton} onClick={() => setDialogOpen(true)}>
                Request a waiver
              </button>
            )}
            {coordinator && raised && waiverRequested && (
              <>
                <ActionButton label="Approve waiver" pendingLabel="Saving..." pending={pending === "approve"} primary onAct={() => void decide("approve")} />
                <ActionButton label="Decline waiver" pendingLabel="Saving..." pending={pending === "decline"} onAct={() => void decide("decline")} />
              </>
            )}
          </div>
          <h2>Condition photos</h2>
          <PhotoComparison photos={photos} />
        </>
      )}
      {dialogOpen && (
        <Dialog
          label="Request a waiver"
          initial={reasonBox}
          onEscape={() => {
            setDialogOpen(false);
            focusAfter.current = "ask";
          }}
        >
          <h2 class="dialog-title">Request a waiver</h2>
          <FormProblems problems={reasonProblems} summaryRef={summary} />
          <label class="field">
            <span class="field-label">Reason</span>
            <textarea id="waiver-reason" ref={reasonBox} rows={4} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
          </label>
          {reasonProblems[0] && <p class="field-message">{reasonProblems[0].message}</p>}
          <div class="dialog-actions">
            <ActionButton label="Send request" pendingLabel="Sending..." pending={pending === "send"} primary onAct={() => void sendWaiver()} />
          </div>
        </Dialog>
      )}
    </div>
  );
}
