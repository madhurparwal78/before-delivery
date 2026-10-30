import { useEffect, useState } from "react";
import { api, type ShareLink } from "../api";
import { Dialog } from "../ui/Dialog";
import { Alert, describeFailure, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";

const SHARE_COPY: Record<string, string> = {
  certificate_not_sealed: "This certificate can be shared once its PDF is sealed.",
};

const absolute = (link: ShareLink): string => `${location.origin}${link.url}`;

/** Share with a verifier: shows the active verification link, creating one on opening when there is none. */
export function ShareDialog({ certificateId, onClosed }: { certificateId: string; onClosed: () => void }) {
  const { announce } = useFeedback();
  const [link, setLink] = useState<ShareLink | null>(null);
  const [pending, setPending] = useState<"create" | "revoke" | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const base = `/api/certificates/${certificateId}/share-links`;

  const create = async () => {
    setPending("create");
    setAlert(null);
    try {
      const body = await api<{ link: ShareLink }>("POST", base);
      setLink(body.link);
      announce("Verification link ready. Anyone with this link can see this one certificate.");
    } catch (error) {
      setAlert(describeFailure(error, SHARE_COPY).alert);
    } finally {
      setPending(null);
    }
  };

  useEffect(() => {
    api<{ links: ShareLink[] }>("GET", base).then(
      (body) => {
        const active = body.links.find((l) => l.state === "active");
        if (active) setLink(active);
        else void create();
      },
      (error: unknown) => setAlert(describeFailure(error, SHARE_COPY).alert),
    );
  }, []);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(absolute(link));
      announce("Link copied.");
    } catch {
      setAlert("Your browser blocked copying. Select the link and copy it yourself.");
    }
  };

  const revoke = async () => {
    if (!link) return;
    setPending("revoke");
    try {
      await api("DELETE", `${base}/${link.id}`);
      setLink(null);
      announce("Link revoked. It no longer opens the certificate.");
    } catch (error) {
      setAlert(describeFailure(error, SHARE_COPY).alert);
    } finally {
      setPending(null);
    }
  };

  return (
    <Dialog title="Share with a verifier" onClosed={onClosed}>
      {(close) => (
        <>
          <p className="muted">A licensing board or employer can open this link without signing in. It shows only this certificate, and you can revoke it at any time.</p>
          {alert && <Alert>{alert}</Alert>}
          <div className="field">
            <label htmlFor="verification-link">Verification link</label>
            <input id="verification-link" type="text" readOnly value={link ? absolute(link) : pending === "create" ? "" : "No active link"} onFocus={(e) => e.target.select()} />
            {link && <p className="hint">Stops working at {new Date(link.expires_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.</p>}
          </div>
          <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
            <button type="button" className="btn" onClick={copy} disabled={!link}>
              <Icon name="copy" />
              Copy link
            </button>
            <button type="button" className={`btn secondary${pending === "create" ? " busy" : ""}`} onClick={create} disabled={pending !== null}>
              <Icon name="link" />
              {pending === "create" ? "Creating a link…" : "Create new link"}
            </button>
            <button type="button" className={`btn secondary${pending === "revoke" ? " busy" : ""}`} onClick={revoke} disabled={!link || pending !== null}>
              Revoke link
            </button>
            <button type="button" className="btn quiet" onClick={() => close()}>
              Close
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
