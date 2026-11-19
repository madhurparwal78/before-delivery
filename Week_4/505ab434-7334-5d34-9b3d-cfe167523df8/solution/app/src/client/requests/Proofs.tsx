import { useState, type ReactNode } from "react";
import type { RequestDetail } from "../../shared/api.ts";
import { api, messageOf, upload } from "../lib/api.ts";
import { Alert, Button, usePageStatus } from "../ui/index.ts";

interface ProofsProps {
  detail: RequestDetail;
  /** The signed-in principal's id and role decide who may upload or review. */
  isRequester: boolean;
  isReviewer: boolean;
  reload: () => Promise<unknown>;
}

type Busy = "upload" | "accept" | "reject" | null;

/** `region "Proofs"`: the requester uploads while the grant waits for a proof; reviewers accept or reject. */
export function Proofs({ detail, isRequester, isReviewer, reload }: ProofsProps): ReactNode {
  const say = usePageStatus();
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const grant = detail.grant;
  const pendingReview = detail.proofs.find((proof) => proof.status === "pending_review");
  const mayUpload = isRequester && grant?.status === "pending_proof" && !pendingReview;
  const mayReview = isReviewer && grant?.status === "pending_proof" && pendingReview !== undefined;
  if (!grant || (detail.proofs.length === 0 && !mayUpload)) return null;

  async function send(): Promise<void> {
    setBusy("upload");
    setError(null);
    try {
      await upload(`/api/grants/${grant!.id}/proofs`, file!);
      say("Proof uploaded. Waiting for review.");
      setFile(null);
      setInputKey((key) => key + 1);
      await reload();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(null);
    }
  }

  async function review(action: "accept" | "reject"): Promise<void> {
    setBusy(action);
    setError(null);
    try {
      await api("POST", `/api/proofs/${pendingReview!.id}/${action}`, action === "reject" ? { reason } : undefined);
      say(action === "accept" ? "Proof accepted." : "Proof rejected.");
      setReason("");
      await reload();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="cell cell-pad stack" aria-label="Proofs" data-frame>
      <span className="cell-label">Proofs</span>
      {detail.proofs.length > 0 ? (
        <ul className="plain-list">
          {detail.proofs.map((proof) => (
            <li key={proof.id}>
              <span>{`${proof.fileName} — ${proof.statusLabel}`}</span>
              {proof.reason ? <span className="muted">{` ${proof.reason}`}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {mayUpload ? (
        <div className="stack">
          <div className="field">
            <label htmlFor="proof-file">Proof file</label>
            <input key={inputKey} id="proof-file" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </div>
          <div>
            <Button primary pending={busy === "upload" && "upload"} disabled={file === null} onClick={() => void send()}>
              Upload proof
            </Button>
          </div>
        </div>
      ) : null}
      {mayReview ? (
        <div className="stack">
          <div className="field">
            <label htmlFor="proof-reason">Proof rejection reason</label>
            <input id="proof-reason" type="text" value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <div className="row">
            <Button primary pending={busy === "accept" && "save"} disabled={busy !== null} onClick={() => void review("accept")}>
              Accept proof
            </Button>
            <Button pending={busy === "reject" && "save"} disabled={busy !== null} onClick={() => void review("reject")}>
              Reject proof
            </Button>
          </div>
        </div>
      ) : null}
      <Alert message={error} />
    </section>
  );
}
