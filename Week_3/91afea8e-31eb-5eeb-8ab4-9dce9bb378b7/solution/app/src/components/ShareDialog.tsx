import { useState, type FormEvent, type ReactNode } from "react";
import { del, failureMessage, post } from "../lib/api";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface ShareLink {
  token: string;
  url: string;
  display_name: string;
}

interface ShareDialogProps {
  kind: "wishlist" | "cart";
  onClose: () => void;
}

/** Create, copy, replace or turn off the one live share link of a wishlist or a cart. */
export function ShareDialog({ kind, onClose }: ShareDialogProps): ReactNode {
  const [name, setName] = useState("");
  const [link, setLink] = useState<ShareLink | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<"create" | "renew" | "off" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kindOfBusy: "create" | "renew" | "off", work: () => Promise<void>): Promise<void> => {
    setBusy(kindOfBusy);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setBusy(null);
    }
  };

  const create = (event: FormEvent): void => {
    event.preventDefault();
    void run("create", async () => {
      setLink(await post<ShareLink>(`/api/${kind}/share`, { display_name: name }));
      setStatus("Link ready.");
    });
  };

  const renew = (): void =>
    void run("renew", async () => {
      setLink(await post<ShareLink>(`/api/${kind}/share/regenerate`, { display_name: link?.display_name ?? name }));
      setStatus("New link ready. The old one no longer works.");
    });

  const turnOff = (): void =>
    void run("off", async () => {
      await del(`/api/${kind}/share`);
      setLink(null);
      setStatus("Link turned off.");
    });

  const address = link ? `${window.location.origin}${link.url}` : "";
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(address);
      setStatus("Link copied.");
    } catch {
      setStatus("Select the link and copy it.");
    }
  };

  return (
    <Dialog title={`Share ${kind}`} onClose={onClose}>
      <form onSubmit={create} noValidate className="stack">
        <div className="field">
          <label htmlFor="share-name">Name to show</label>
          <input id="share-name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} aria-describedby="share-error" />
        </div>
        {error && (
          <p id="share-error" className="field-error" role="alert">
            {error}
          </p>
        )}
        {link && (
          <div className="field">
            <label htmlFor="share-link">Share link</label>
            <input id="share-link" readOnly value={address} onFocus={(event) => event.currentTarget.select()} />
          </div>
        )}
        <p className="status" role="status">
          {status}
        </p>
        <div className="dialog__actions">
          {!link && (
            <Button type="submit" variant="primary" busy={busy === "create"}>
              Create link
            </Button>
          )}
          {link && (
            <>
              <Button variant="primary" onClick={() => void copy()}>
                Copy link
              </Button>
              <Button onClick={renew} busy={busy === "renew"}>
                Make a new link
              </Button>
              <Button onClick={turnOff} busy={busy === "off"}>
                Turn off link
              </Button>
            </>
          )}
          <Button onClick={onClose}>Close</Button>
        </div>
      </form>
    </Dialog>
  );
}
