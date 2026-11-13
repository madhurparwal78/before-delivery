import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { api, type QueueItem } from "../api";
import { useRoute } from "../router";
import { act, clock, sessionStore, useStore } from "../store";
import { Button, Dialog, EmptyState, Field, Skeleton, StatusWord, useHeadingFocus } from "../ui";

function CorrectDialog({ item, onClose, onSaved }: { item: QueueItem; onClose: () => void; onSaved: (value: string) => void }) {
  const [value, setValue] = useState(item.value ?? "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const out = await act("Saving correction.", () => api("POST", `/api/segments/${item.segment_id}/correct`, { value, comment: comment || undefined }), "Correction saved and approved.");
    setBusy(false);
    if (out.ok) { onSaved(value); onClose(); }
  };
  return (
    <Dialog title="Correct segment" onClose={onClose} returnTo={() => document.getElementById(`correct-${item.segment_id}`)}>
      <form onSubmit={submit} className="stack">
        <Field label="Corrected translation">{(p) => <textarea {...p} rows={4} value={value} onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)} />}</Field>
        <Field label="Comment">{(p) => <textarea {...p} rows={2} value={comment} onInput={(e) => setComment((e.target as HTMLTextAreaElement).value)} />}</Field>
        <div className="dialog-actions"><Button type="submit" busy={busy} disabled={value.trim() === ""}>Save correction</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}

export function Review() {
  useHeadingFocus("Review queue");
  const user = useStore(sessionStore);
  const route = useRoute();
  const lang = route.query.get("lang") ?? "";
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [done, setDone] = useState<Record<string, string | null>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<QueueItem | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;

  const refresh = async () => {
    try {
      const r = await api<{ segments: QueueItem[] }>("GET", `/api/review-queue${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`);
      setItems(r.segments);
      setDone({});
      setCurrent((c) => (c && r.segments.some((s) => s.segment_id === c) ? c : r.segments[0]?.segment_id ?? null));
    } catch { /* the next refresh tries again */ }
  };
  useLayoutEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [lang]);

  const move = (step: number) => {
    if (!items?.length) return;
    const at = Math.max(0, items.findIndex((s) => s.segment_id === currentRef.current));
    const next = items[Math.min(items.length - 1, Math.max(0, at + step))];
    setCurrent(next.segment_id);
    document.getElementById(`approve-${next.segment_id}`)?.focus();
  };
  const approve = async (item: QueueItem) => {
    if (item.removed || item.segment_id in done) return;
    const out = await act("Approving.", () => api("POST", `/api/segments/${item.segment_id}/approve`, {}), "Approved.", { branch: item.branch });
    if (out.ok) setDone((d) => ({ ...d, [item.segment_id]: item.value }));
  };
  const open = (item: QueueItem | undefined) => { if (item && !item.removed && !(item.segment_id in done)) setCorrecting(item); };
  const focused = items?.find((s) => s.segment_id === current);

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.ctrlKey || e.metaKey || e.altKey || t.closest("input, textarea, select, [contenteditable='true']")) return;
    const key = e.key.toLowerCase();
    if (key === "j") { e.preventDefault(); move(1); }
    else if (key === "k") { e.preventDefault(); move(-1); }
    else if (key === "a") { e.preventDefault(); if (focused) void approve(focused); }
    else if (key === "c") { e.preventDefault(); open(focused); }
  };

  const owner = user?.role === "owner";
  return (
    <>
      <div className="title-row">
        <h1 className="display page-title">Review queue</h1>
        {items && items.length > 0 && <Button variant="outline" onClick={() => void refresh()}>Refresh queue</Button>}
      </div>
      <p className="muted shortcuts">Shortcuts: J next, K previous, A approve, C correct.</p>
      <section className="review-queue" aria-label="Review queue" onKeyDown={onKeyDown}>
        {items === null && <div className="card"><Skeleton lines={5} /></div>}
        {items?.length === 0 && (
          <div className="card">
            <EmptyState
              heading="Nothing to review right now"
              text={owner ? "Segments that score below a project's MQM threshold land here." : "When the engineer assigns segments to you, they'll show up here."}
            >
              <Button variant="outline" onClick={() => void refresh()}>Refresh queue</Button>
            </EmptyState>
          </div>
        )}
        {items?.map((s) => {
          const settled = s.segment_id in done;
          return (
            <article key={s.segment_id} className="card review-card" aria-label={`${s.key} (${s.language})`} aria-current={s.segment_id === current ? "true" : undefined}>
              <header className="review-head">
                <h2 className="h5">{s.key}</h2>
                <span className="muted">{s.project} · {s.branch} · {s.language}</span>
              </header>
              <p className="source-text">{s.removed ? `This key was removed on ${s.branch}.` : s.source}</p>
              <p className="translation-text">{settled ? done[s.segment_id] : s.value}</p>
              <div className="review-meta">
                <span className="mqm-line small">MQM <span className="num">{s.score ?? "–"}</span></span>
                <StatusWord state={settled ? "approved" : s.status} />
                {s.expires_at && <span className="muted">Expires {clock(s.expires_at)}</span>}
              </div>
              {s.issues.length > 0 && <ul className="plain-list">{s.issues.map((i, n) => <li key={n}><strong>{i.category}</strong> · {i.severity} <span className="muted">{i.note}</span></li>)}</ul>}
              <div className="action-row">
                <Button id={`approve-${s.segment_id}`} disabled={s.removed} aria-disabled={settled || undefined} className={settled ? "is-settled" : undefined} onClick={() => void approve(s)} onFocus={() => setCurrent(s.segment_id)}>Approve</Button>
                <Button id={`correct-${s.segment_id}`} variant="outline" disabled={s.removed} aria-disabled={settled || undefined} className={settled ? "is-settled" : undefined} onClick={() => open(s)} onFocus={() => setCurrent(s.segment_id)}>Correct</Button>
              </div>
            </article>
          );
        })}
      </section>
      {correcting && (
        <CorrectDialog
          item={correcting}
          onClose={() => setCorrecting(null)}
          onSaved={(value) => setDone((d) => ({ ...d, [correcting.segment_id]: value }))}
        />
      )}
    </>
  );
}
