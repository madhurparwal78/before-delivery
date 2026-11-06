import { useEffect, useState } from "react";
import { showConfirmation } from "../store/announcer.ts";
import { session } from "../store/workspace.ts";
import { Dialog } from "./common.tsx";

type Link = { token: string; url: string; expiresAt: string };
type Stage = "loading" | "signed-out" | "not-on-account" | "ready";
type Pending = "create" | "renew" | null;

export function ShareDialog({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const signedIn = session() !== null;
  const [stage, setStage] = useState<Stage>(signedIn ? "loading" : "signed-out");
  const [link, setLink] = useState<Link | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const path = `/api/documents/${encodeURIComponent(documentId)}/share`;

  useEffect(() => {
    if (!signedIn) return;
    fetch(path)
      .then(async (answer) => {
        if (!answer.ok) return setStage("not-on-account");
        const body = (await answer.json()) as { share: Link | null };
        setLink(body.share);
        setStage("ready");
      })
      .catch(() => setStage("not-on-account"));
  }, [path, signedIn]);

  const create = async (kind: "create" | "renew"): Promise<void> => {
    setPending(kind);
    const answer = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    setPending(null);
    if (!answer?.ok) return;
    setLink((await answer.json()) as Link);
    showConfirmation(kind === "create" ? "Link created." : "New link created. The old link no longer works.");
  };
  const revoke = async (): Promise<void> => {
    const answer = await fetch(path, { method: "DELETE" }).catch(() => null);
    if (!answer?.ok) return;
    setLink(null);
    showConfirmation("Link revoked.");
  };
  const copy = async (): Promise<void> => {
    if (!link) return;
    await navigator.clipboard.writeText(link.url);
    showConfirmation("Link copied.");
  };

  return (
    <Dialog name="Share" onClose={onClose}>
      {stage === "signed-out" && <p>Sign in to share this document.</p>}
      {stage === "not-on-account" && <p>Sync this document before sharing it.</p>}
      {stage === "ready" && !link && (
        <button type="button" className="button" disabled={pending !== null} aria-busy={pending === "create"} onClick={() => void create("create")}>
          {pending === "create" ? "Creating link..." : "Create link"}
        </button>
      )}
      {stage === "ready" && link && (
        <>
          <label className="field"><span>Share link</span><input readOnly value={link.url} /></label>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => void copy()}>Copy link</button>
            <button type="button" className="button" disabled={pending !== null} aria-busy={pending === "renew"} onClick={() => void create("renew")}>
              {pending === "renew" ? "Creating link..." : "New link"}
            </button>
            <button type="button" className="button" onClick={() => void revoke()}>Revoke link</button>
          </div>
        </>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
