import { useEffect, useRef, useState } from "react";
import { ApiError, postJson, useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { ReviewDialog, useCommand } from "../review.js";

/**
 * The Slate rule wipe: the second photograph is revealed from the coin's left
 * edge up to the divider. Below 50 percent the first tab is current; at 50 and
 * above the second is. The divider position is kept per specimen and comparison.
 */
export function WipeComparison({
  first,
  firstAlt,
  second,
  secondAlt,
  storageKey,
  secondUrl,
  firstUrl,
  caption,
}: {
  first: string;
  firstAlt: string;
  second: string;
  secondAlt: string;
  storageKey: string;
  firstUrl: string;
  secondUrl: string;
  caption?: string;
}): React.ReactElement {
  const [divider, setDivider] = useState<number>(() => {
    const saved = window.localStorage.getItem(`flan:wipe:${storageKey}`);
    return saved !== null ? Number(saved) : 0;
  });
  const [tab, setTab] = useState<"first" | "second">("first");
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.localStorage.setItem(`flan:wipe:${storageKey}`, String(divider));
  }, [divider, storageKey]);

  useEffect(() => {
    setTab(divider < 50 ? "first" : "second");
  }, [divider]);

  const onDividerKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const target = event.target as HTMLInputElement;
    const current = Number(target.value);
    if (event.key === "PageUp") {
      event.preventDefault();
      setDivider(Math.min(100, current + 10));
    } else if (event.key === "PageDown") {
      event.preventDefault();
      setDivider(Math.max(0, current - 10));
    } else if (event.key === "Home") {
      setDivider(0);
    } else if (event.key === "End") {
      setDivider(100);
    } else {
      setDivider(current);
    }
  };

  const dragDivider = (clientX: number) => {
    const box = viewerRef.current?.getBoundingClientRect();
    if (!box) return;
    const pct = ((clientX - box.left) / box.width) * 100;
    setDivider(Math.max(0, Math.min(100, pct)));
  };

  return (
    <div>
      <div className="comparison-tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === "first"}>{first}</button>
        <button className="tab" role="tab" aria-selected={tab === "second"}>{second}</button>
      </div>
      <div className="viewer" style={{ minHeight: 300 }} ref={viewerRef}>
        <img className="viewer-image" src={firstUrl} alt={firstAlt} />
        <div className="viewer-clip" style={{ clipPath: `inset(0 ${100 - divider}% 0 0)` }}>
          <img className="viewer-image" src={secondUrl} alt={secondAlt} />
          {caption && (
            <span style={{ position: "absolute", left: `${divider}%`, bottom: 8, background: "#fff", padding: "2px 6px", fontSize: 12, transition: "opacity var(--flan-motion)", opacity: divider > 20 ? 1 : 0 }}>
              {caption}
            </span>
          )}
        </div>
        <div
          className="wipe-divider"
          style={{ left: `${divider}%` }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragDivider(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) dragDivider(e.clientX);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor={`wipe-${storageKey}`}>{second} divider:</label>
        <input
          id={`wipe-${storageKey}`}
          type="range"
          min={0}
          max={100}
          step={1}
          value={divider}
          onChange={(e) => setDivider(Number(e.target.value))}
          onKeyDown={onDividerKey}
          aria-valuetext={`${second} ${divider} percent`}
        />
      </div>
    </div>
  );
}

export function ReconciliationWorkspace(): React.ReactElement {
  const desk = useDesk();
  const runCommand = useCommand();
  const state = desk.state;
  const specimens = state ? Object.entries(state.specimens).filter(([, s]) => s.owner === "dealer") : [];
  const [selected, setSelected] = useState<string>(specimens[0]?.[0] ?? "");
  const [correction, setCorrection] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [retryDisabled, setRetryDisabled] = useState(false);
  const namespace = desk.session?.namespace ?? "hollowmint";

  const specimen = state?.specimens[selected];
  const photo = specimen?.photos.find((p) => p.label === "obverse");

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      desk.announce(feedback("F_CATALOG_RETRYING"));
      setCountdown(null);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown, desk]);

  const attemptReconcile = async (commandId: string) => {
    desk.clearError();
    desk.setPending(feedback("F_PENDING"));
    try {
      await postJson(`/api/desks/${namespace}/specimens/${selected}/reconcile`, {
        command_id: commandId,
        expected_version: specimen?.version,
        correction,
      });
      desk.setPending(null);
      desk.announce(feedback("F_CATALOG_OK"));
      await desk.refresh();
      return;
    } catch (err) {
      desk.setPending(null);
      if (err instanceof ApiError) {
        const retryAfter = err.failure.body.retry_after_seconds;
        if (retryAfter !== undefined) {
          desk.reportError(feedback("F_CATALOG_RATE"));
          setCountdown(retryAfter);
          setRetryDisabled(true);
          setTimeout(() => setRetryDisabled(false), retryAfter * 1000);
          return;
        }
        desk.reportError(err.failure.body.message);
        return;
      }
      desk.reportError(feedback("F_SERVICE"));
    }
  };

  return (
    <div aria-label="Catalog reconciliation workspace" className="workspace-two-col">
      <div className="panel" aria-label="Stock grid">
        <h3>Stock</h3>
        {specimens.map(([key, s]) => (
          <button key={key} className="specimen-chip" aria-label={`Specimen ${key}`} onClick={() => setSelected(key)}>
            <span className="coin-disc">{s.attribution.mintmark || "?"}</span>
            <span>
              <span className="chip-label">{s.display_label}</span>
              <span className="chip-sub">{s.attribution.register === "stored" ? "stored" : "pending"}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="workspace-panes">
        <div className="panel">
          {photo && specimen && (
            <WipeComparison
              first="Register"
              firstAlt={`${specimen.display_label} register`}
              second="Obverse"
              secondAlt={`${specimen.display_label} obverse`}
              storageKey={`${namespace}:${selected}:reconciliation`}
              firstUrl={`/api/desks/${namespace}/register/${specimen.attribution.reference}`}
              secondUrl={`/api/desks/${namespace}/photos/${photo.id}`}
            />
          )}
        </div>
        <div className="panel">
          <div className="fact-box" aria-label="Obverse facts">
            <h3>Obverse facts</h3>
            <p>{specimen?.display_label ?? "—"}</p>
          </div>
          <div className="fact-box" aria-label="Reverse facts">
            <h3>Reverse facts</h3>
            <p>{specimen ? `Mintmark ${specimen.attribution.mintmark || "?"}` : "—"}</p>
          </div>
          <div className="field">
            <label htmlFor="attribution-correction">Attribution correction:</label>
            <input
              id="attribution-correction"
              type="text"
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
            />
          </div>
          <div className="inline-note">
            {countdown !== null ? feedback("F_CATALOG_COUNTDOWN", { seconds: countdown }) : "Catalog record pending."}
            {" "}
            <button
              className="action-link"
              aria-label="Retry catalog"
              disabled={retryDisabled || countdown !== null}
              onClick={() => void attemptReconcile(`reconcile-${Date.now()}`)}
            >
              Retry catalog
            </button>
          </div>
          <button className="btn btn-primary" aria-label="Review reconciliation" onClick={() => setReviewOpen(true)}>
            Review reconciliation
          </button>
        </div>
      </div>
      {reviewOpen && specimen && (
        <ReviewDialog
          title="Save reconciliation"
          summary={`Save ${specimen.display_label} with correction ${correction}.`}
          onConfirm={() => {
            setReviewOpen(false);
            void attemptReconcile(`reconcile-${Date.now()}`);
          }}
          onCancel={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}
