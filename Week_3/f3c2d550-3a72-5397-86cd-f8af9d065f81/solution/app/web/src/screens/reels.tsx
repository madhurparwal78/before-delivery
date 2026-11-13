import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Reel, ReelSummary } from "../../../shared/api";
import { api, ApiError } from "../api";
import { FieldError } from "../controls";
import { COPY, useDeck } from "../deck";
import { Dialog } from "../dialog";
import { useField } from "../field";
import { useDocumentTitle, useRefetch } from "../hooks";

export function ReelsScreen() {
  useDocumentTitle("Reels");
  const field = useField();
  const { say } = useDeck();
  const [reels, setReels] = useState<ReelSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const sending = useRef(false);

  useEffect(() => {
    field.show(null);
    return () => field.show(null);
  }, [field]);

  const refresh = () => api<{ reels: ReelSummary[] }>("GET", "/reels").then((listing) => setReels(listing.reels));
  useRefetch({ load: () => api<{ reels: ReelSummary[] }>("GET", "/reels"), onData: (listing) => setReels(listing.reels) }, "reels");

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setError(undefined);
    try {
      await api<Reel>("POST", "/reels", { json: { name } });
      setCreating(false);
      setName("");
      say(COPY.reelCreated);
      await refresh();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 422) {
        setError(failure.fields.name);
        say(COPY.checkFields);
      } else {
        say(COPY.generic);
      }
    } finally {
      sending.current = false;
    }
  };

  return (
    <>
      <h1>Reels</h1>
      <button type="button" className="btn primary" onClick={() => setCreating(true)}>
        New reel
      </button>
      {reels && (
        <ul className="row-list">
          {reels.map((reel) => (
            <li key={reel.id} className="row">
              <Link to={`/reels/${reel.id}`}>
                <span className="row-name">{reel.name}</span>
                <span className="row-meta">
                  <span className="size-line">{reel.stop_count === 1 ? "1 stop" : `${reel.stop_count} stops`}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={creating} label="New reel" onClose={() => setCreating(false)}>
        <form noValidate onSubmit={create}>
          <p className="dialog-title">New reel</p>
          <div className="field-row">
            <label htmlFor="reel-name">Reel name</label>
            <input
              id="reel-name"
              type="text"
              value={name}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "reel-name-error" : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            <FieldError id="reel-name" error={error} />
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Create reel
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
