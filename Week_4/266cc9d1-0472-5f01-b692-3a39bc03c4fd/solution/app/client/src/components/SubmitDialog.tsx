// Submit findings set: one Idempotency-Key per opening, so a double press or a retry after a lost
// answer is one submit; the button stays disabled while its request is pending.
import { useRef, useState } from "react";
import { api, ApiFailure, newIdempotencyKey, type FindingsSet, type ReviewLink } from "../api";
import { counted } from "../../../shared/text";
import { Dialog } from "./Dialog";

export interface SubmitResult {
  set: FindingsSet;
  review_link: ReviewLink;
  email: "sent" | "queued";
}

interface SubmitDialogProps {
  set: FindingsSet;
  findingCount: number;
  violationCount: number;
  foresterEmail: string;
  opener: HTMLElement | null;
  onPending: () => void;
  onSubmitted: (result: SubmitResult) => void;
  onRefused: (failure: ApiFailure) => void;
  onClosed: () => void;
}

export function SubmitDialog(props: SubmitDialogProps) {
  const { set, findingCount, violationCount, foresterEmail, opener } = props;
  const key = useRef(newIdempotencyKey());
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [lost, setLost] = useState(false);

  const confirmSubmit = async (close: () => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setLost(false);
    props.onPending();
    try {
      const result = await api<SubmitResult>("POST", `/api/findings-sets/${set.id}/submit`, { body: {}, idempotencyKey: key.current });
      props.onSubmitted(result);
      close();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 0) setLost(true);
      else {
        props.onRefused(error);
        close();
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <Dialog title="Submit findings set" opener={opener} onClosed={props.onClosed}>
      {(close) => (
        <>
          <p>
            {counted(findingCount, "finding")}, {counted(violationCount, "violation")} will be frozen and sent to {foresterEmail}.
          </p>
          {lost && <p className="field-error">The request did not reach Spanwise. Press Confirm submit to try again.</p>}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={close}>
              Cancel
            </button>
            <button type="button" className="button primary" aria-disabled={pending} onClick={() => void confirmSubmit(close)}>
              {pending ? "Submitting..." : "Confirm submit"}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
