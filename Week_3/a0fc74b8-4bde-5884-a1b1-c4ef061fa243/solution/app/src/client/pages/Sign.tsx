import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GENERIC_FAILURE, PAGES_UNAVAILABLE } from "../../shared/copy";
import { REASON_LIMIT, SIGNATURE_PAD_ASPECT, TEXT_LIMIT, codePoints, truncateCodePoints } from "../../shared/limits";
import type { LinkState, SignFieldJson, SignLinkJson, Stroke } from "../../shared/types";
import { type Adoption, Adopt } from "../components/Adopt";
import { Dialog } from "../components/Dialog";
import { PageSheet } from "../components/PageSheet";
import { Status } from "../components/Regions";
import { ApiFailure, api, failureCopy } from "../lib/api";
import { drive, stop } from "../lib/drive";
import { initialsOf } from "../lib/format";
import { LiveProvider, useLiveEvents } from "../lib/live";
import { usePdf } from "../lib/pdf";
import { prefersReducedMotion } from "../lib/useMedia";

const TRAVEL_MS = 380;

// Orders link reads and field writes on this page, so a read that began before a save finished never undoes it.
let sequence = 0;
const nextSequence = () => ++sequence;
const TRAVEL_EASING = "cubic-bezier(0.2, 0.7, 0.2, 1)";

export function Sign({ token }: { token: string }) {
  return (
    <LiveProvider source={`/api/sign/${token}/live`}>
      <SignLink token={token} />
    </LiveProvider>
  );
}

function headingOf(link: SignLinkJson): string {
  switch (link.state) {
    case "your_turn":
      return link.title;
    case "signed_waiting":
    case "sealing":
      return `You signed ${link.title}`;
    case "completed":
      return `${link.title} is complete`;
    case "declined":
      return link.recipient.status === "declined" ? "You declined this document" : "This document was declined";
    case "voided":
      return "This document was voided";
    case "expired":
      return "This link has expired";
  }
}

function bodyOf(link: SignLinkJson): string {
  switch (link.state) {
    case "signed_waiting":
      return link.current ? `Waiting for ${link.current.name} (signer ${link.current.order} of ${link.signerCount}).` : "";
    case "sealing":
      return "Your signature is recorded. The completed PDF will be emailed once it is sealed.";
    case "completed":
      return "Everyone has signed.";
    case "declined":
      return `${link.declinedBy ?? ""} declined to sign. No further signatures are needed.`;
    case "voided":
      return `${link.senderName} voided it: ${link.voidReason ?? ""}`;
    case "expired":
      return `Ask ${link.senderName} to send a new link.`;
    case "your_turn":
      return "";
  }
}

function SignLink({ token }: { token: string }) {
  const [link, setLink] = useState<SignLinkJson | null>(null);
  const [readStarted, setReadStarted] = useState(0);
  const applied = useRef(0);
  const [unknown, setUnknown] = useState(false);
  const [statusText, setStatusText] = useState("");
  const state = useRef<LinkState | null>(null);

  const reload = useCallback(async () => {
    const started = nextSequence();
    try {
      const fresh = await api.get<SignLinkJson>(`/api/sign/${token}`);
      if (started < applied.current) return;
      applied.current = started;
      setReadStarted(started);
      if (state.current !== null && state.current !== fresh.state) setStatusText(headingOf(fresh));
      state.current = fresh.state;
      setLink(fresh);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) setUnknown(true);
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useLiveEvents((event) => {
    if (event.type === "resync" || event.type === "document") void reload();
  });

  useEffect(() => {
    document.title = link ? headingOf(link) : "Undersign";
  }, [link]);

  if (unknown) {
    return (
      <main className="notice-page">
        <h1>This link is not valid</h1>
        <p>Check that you copied the whole link.</p>
      </main>
    );
  }
  if (!link) return <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>;
  return (
    <>
      <Status label="Document status" className="sr-only">
        {statusText}
      </Status>
      {link.state === "your_turn" ? (
        <Signing link={link} readStarted={readStarted} token={token} reload={reload} />
      ) : (
        <main className="notice-page">
          <h1>{headingOf(link)}</h1>
          <p>{bodyOf(link)}</p>
          {link.state === "completed" ? (
            <p>
              <a className="textlink" href={`/sign/${token}/completed.pdf`} download>
                Download completed PDF
              </a>
            </p>
          ) : null}
        </main>
      )}
    </>
  );
}

const reading = (a: SignFieldJson, b: SignFieldJson) => a.page - b.page || a.y - b.y || a.x - b.x;

interface SigningProps {
  link: SignLinkJson;
  readStarted: number;
  token: string;
  reload: () => Promise<void>;
}

function Signing({ link, readStarted, token, reload }: SigningProps) {
  const pdf = usePdf(`/api/sign/${token}/original.pdf`);
  const [fields, setFields] = useState<SignFieldJson[]>(link.fields);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [adopting, setAdopting] = useState<SignFieldJson | null>(null);
  const [declining, setDeclining] = useState(false);
  const [progress, setProgress] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const adopted = useRef<Partial<Record<"signature" | "initials", Adoption>>>({});
  const written = useRef(new Map<string, number>());
  const latest = useRef({ fields, drafts });
  latest.current = { fields, drafts };

  const ordered = useMemo(() => [...fields].sort(reading), [fields]);
  const walk = useMemo(() => ordered.filter((f) => f.required && f.kind !== "date"), [ordered]);
  const done = (f: SignFieldJson) => f.value !== null && (f.kind !== "text" || f.value.trim().length > 0);
  const incomplete = walk.filter((f) => !done(f));
  const left = incomplete.length;
  const [current, setCurrent] = useState<string>(() => incomplete[0]?.id ?? "finish");

  const container = useRef<HTMLDivElement>(null);
  const finishButton = useRef<HTMLButtonElement>(null);
  const finishHost = useRef<HTMLSpanElement>(null);
  const aperture = useRef<HTMLDivElement | null>(null);
  const animateNext = useRef(false);
  const scrollNext = useRef(true);
  const placed = useRef(false);
  const traveling = useRef<Animation | null>(null);
  const leftRef = useRef({ value: left, previous: left });
  if (leftRef.current.value !== left) leftRef.current = { value: left, previous: leftRef.current.value };

  useEffect(() => {
    setFields((previous) =>
      link.fields.map((server) => {
        const local = previous.find((f) => f.id === server.id);
        const newer = (written.current.get(server.id) ?? 0) > readStarted;
        return local && (newer || drafts[server.id] !== undefined) ? { ...server, value: local.value } : server;
      }),
    );
  }, [link]);

  const announceFor = (field: SignFieldJson) => {
    const index = walk.findIndex((f) => f.id === field.id);
    setProgress(index >= 0 ? `Field ${index + 1} of ${walk.length}: ${field.label}, page ${field.page}` : `Optional field: ${field.label}, page ${field.page}`);
  };

  const boxIn = (el: Element) => {
    const host = container.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { left: r.left - (host?.left ?? 0), top: r.top - (host?.top ?? 0), width: r.width, height: r.height };
  };

  const place = (animate: boolean) => {
    const frame = aperture.current;
    const target = current === "finish" ? finishButton.current : document.getElementById(`field-${current}`);
    if (!frame || !target || current === "finish") return;
    const before = frame.getBoundingClientRect();
    const host = container.current?.getBoundingClientRect();
    const to = boxIn(target);
    const px = (n: number) => `${n}px`;
    const from = host ? { left: before.left - host.left, top: before.top - host.top, width: before.width, height: before.height } : to;
    frame.style.left = px(to.left);
    frame.style.top = px(to.top);
    frame.style.width = px(to.width);
    frame.style.height = px(to.height);
    if (!animate && traveling.current) return;
    if (traveling.current) {
      stop(traveling.current);
      traveling.current = null;
    }
    if (animate && placed.current && !prefersReducedMotion()) {
      const travel = frame.animate(
        [
          { left: px(from.left), top: px(from.top), width: px(from.width), height: px(from.height) },
          { left: px(to.left), top: px(to.top), width: px(to.width), height: px(to.height) },
        ],
        { duration: TRAVEL_MS, easing: TRAVEL_EASING },
      );
      traveling.current = travel;
      drive(travel, () => {
        travel.finish();
        if (traveling.current === travel) traveling.current = null;
      });
    }
    placed.current = true;
  };

  useLayoutEffect(() => {
    const animate = animateNext.current;
    const scroll = scrollNext.current;
    animateNext.current = true;
    scrollNext.current = false;
    if (current === "finish") {
      finishButton.current?.focus({ preventScroll: true });
      placed.current = false;
      return;
    }
    const el = document.getElementById(`field-${current}`);
    const field = fields.find((f) => f.id === current);
    if (!el || !field) return;
    place(animate);
    if (scroll) {
      const rect = el.getBoundingClientRect();
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - window.innerHeight * 0.35), behavior: animate && !prefersReducedMotion() ? "smooth" : "instant" });
    }
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    announceFor(field);
  }, [current]);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const observer = new ResizeObserver(() => place(false));
    observer.observe(host);
    return () => observer.disconnect();
  }, [current]);

  const patchField = (id: string, update: Partial<SignFieldJson>) => setFields((previous) => previous.map((f) => (f.id === id ? { ...f, ...update } : f)));

  const put = async (field: SignFieldJson, body: unknown) => {
    written.current.set(field.id, Number.POSITIVE_INFINITY);
    try {
      const saved = await api.put<SignFieldJson>(`/api/sign/${token}/fields/${field.id}`, body);
      written.current.set(field.id, nextSequence());
      patchField(field.id, { value: saved.value, strokes: saved.strokes });
    } catch (error) {
      written.current.delete(field.id);
      if (error instanceof ApiFailure && error.status === 409) await reload();
      else setProblem(failureCopy(error, GENERIC_FAILURE));
    }
  };

  const commitText = (field: SignFieldJson): SignFieldJson => {
    const draft = latest.current.drafts[field.id];
    if (draft === undefined || draft === (field.value ?? "")) return field;
    const next = { ...field, value: draft === "" ? null : draft };
    patchField(field.id, { value: next.value });
    latest.current = { ...latest.current, fields: latest.current.fields.map((f) => (f.id === field.id ? next : f)) };
    void put(field, { value: draft });
    return next;
  };

  const flushAll = () => {
    let fresh = latest.current.fields;
    for (const f of latest.current.fields) if (f.kind === "text") fresh = fresh.map((x) => (x.id === f.id ? commitText(x) : x));
    return fresh;
  };

  const incompleteOf = (list: SignFieldJson[]) => list.filter((f) => f.required && f.kind !== "date" && !(f.value !== null && (f.kind !== "text" || f.value.trim().length > 0))).sort(reading);

  const step = (direction: 1 | -1) => {
    const fresh = flushAll();
    const open = incompleteOf(fresh);
    const here = fresh.find((f) => f.id === current);
    if (open.length === 0) return setCurrent("finish");
    const after = (f: SignFieldJson) => (here ? reading(f, here) : direction);
    const ahead = direction === 1 ? open.find((f) => after(f) > 0) : [...open].reverse().find((f) => after(f) < 0);
    const target = ahead ?? (direction === 1 ? open[0] : open[open.length - 1]);
    if (target) {
      if (target.id === current) announceFor(target);
      scrollNext.current = true;
      setCurrent(target.id);
    }
  };

  const finish = async () => {
    const fresh = flushAll();
    const open = incompleteOf(fresh);
    setProblem("");
    if (open.length > 0) {
      setProblem(`Complete ${open.length} required fields first.`);
      const first = open[0];
      if (first) {
        scrollNext.current = true;
        setCurrent(first.id);
      }
      return;
    }
    setBusy(true);
    setProgress("Signing...");
    try {
      await api.post(`/api/sign/${token}/finish`);
      await reload();
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiFailure && error.body.error === "incomplete_fields") setProblem(`Complete ${String(error.body["remaining"])} required fields first.`);
      else if (error instanceof ApiFailure && error.status === 409) await reload();
      else setProblem(GENERIC_FAILURE);
    }
  };

  const apply = async (field: SignFieldJson, adoption: Adoption) => {
    const kind = field.kind === "initials" ? "initials" : "signature";
    adopted.current[kind] = adoption;
    await put(field, adoption);
  };

  const activate = (field: SignFieldJson) => {
    const kind = field.kind === "initials" ? "initials" : "signature";
    const known = adopted.current[kind];
    if (field.value === null && known) void apply(field, known);
    else setAdopting(field);
  };

  const onSignKey = (field: SignFieldJson, event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" && field.value !== null) {
      event.preventDefault();
      step(1);
    } else if (event.key === "Tab" && !event.shiftKey && field.value !== null && incompleteOf(latest.current.fields).filter((f) => f.id !== field.id).length > 0) {
      event.preventDefault();
      step(1);
    }
  };

  const onTextKey = (field: SignFieldJson, event: KeyboardEvent<HTMLInputElement>) => {
    const draft = latest.current.drafts[field.id] ?? field.value ?? "";
    const filled = draft.trim().length > 0;
    if (event.key === "Enter") {
      event.preventDefault();
      if (filled) step(1);
    } else if (event.key === "Tab" && !event.shiftKey && filled) {
      const others = incompleteOf(latest.current.fields).filter((f) => f.id !== field.id);
      if (others.length > 0) {
        event.preventDefault();
        step(1);
      }
    }
  };

  const pages = Array.from({ length: link.pageCount }, (_, i) => i + 1);
  const frame = (
    <div id="aperture" ref={aperture} className="aperture" aria-hidden="true">
      <div className="dim" />
    </div>
  );

  return (
    <>
      <header className="sign-head">
        <h1>{link.title}</h1>
        <p className="left-count">
          <span key={left} className="count-num" data-previous={leftRef.current.previous !== left ? leftRef.current.previous : undefined}>
            {left}
          </span>{" "}
          left
        </p>
        <div className="sign-controls">
          <button type="button" className="btn" onClick={() => step(-1)}>
            Previous
          </button>
          <button type="button" className="btn" onClick={() => step(1)}>
            Next
          </button>
          <span ref={finishHost} className="finish-host">
            <button ref={finishButton} type="button" className="btn seal" disabled={busy} aria-busy={busy} onClick={() => void finish()} onFocus={() => setCurrent("finish")}>
              Finish and sign
            </button>
            {current === "finish" ? frame : null}
          </span>
          <button type="button" className="btn" onClick={() => setDeclining(true)}>
            Decline
          </button>
        </div>
        {problem ? (
          <p role="alert" className="error">
            {problem}
          </p>
        ) : null}
      </header>
      <Status label="Signing progress" className="sr-only">
        {progress}
      </Status>
      {pdf.status === "unavailable" ? (
        <section className="banner-block">
          <h2>{PAGES_UNAVAILABLE.heading}</h2>
          <p>{PAGES_UNAVAILABLE.body}</p>
        </section>
      ) : null}
      <div ref={container} className="sign-pages stack-pages">
        {pages.map((n) => (
          <PageSheet key={n} number={n} count={link.pageCount} size={link.pageSizes[n - 1] ?? { w: 612, h: 792 }} pdf={pdf}>
            {link.otherFields
              .filter((o) => o.page === n)
              .map((o, i) => (
                <div key={i} className="field-wrap other" aria-hidden="true" style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%` }} />
              ))}
            {fields
              .filter((f) => f.page === n)
              .map((f) => (
                <div key={f.id} className="field-wrap sign-wrap" style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}>
                  {f.kind === "text" ? (
                    <>
                      <input
                        id={`field-${f.id}`}
                        type="text"
                        className="field text-entry"
                        aria-label={f.label}
                        placeholder={f.label}
                        value={drafts[f.id] ?? f.value ?? ""}
                        onFocus={() => {
                          setFocused(f.id);
                          if (current !== f.id) setCurrent(f.id);
                        }}
                        onBlur={() => {
                          setFocused(null);
                          commitText(latest.current.fields.find((x) => x.id === f.id) ?? f);
                        }}
                        onChange={(e) => setDrafts({ ...latest.current.drafts, [f.id]: truncateCodePoints(e.target.value, TEXT_LIMIT) })}
                        onKeyDown={(e) => onTextKey(f, e)}
                      />
                      {focused === f.id ? <span className="counter mono">{`${codePoints(drafts[f.id] ?? f.value ?? "")} of ${TEXT_LIMIT} characters`}</span> : null}
                    </>
                  ) : f.kind === "date" ? (
                    <input id={`field-${f.id}`} type="text" readOnly aria-readonly="true" tabIndex={-1} className="field date-entry" aria-label={f.label} value="Filled when you sign" />
                  ) : (
                    <button
                      id={`field-${f.id}`}
                      type="button"
                      className={`field sign-entry${f.value !== null ? " filled" : ""}`}
                      aria-label={f.label}
                      onFocus={() => current !== f.id && setCurrent(f.id)}
                      onClick={() => activate(f)}
                      onKeyDown={(e) => onSignKey(f, e)}
                    >
                      {f.value === null ? f.label : <Written field={f} />}
                    </button>
                  )}
                </div>
              ))}
          </PageSheet>
        ))}
        {current !== "finish" ? frame : null}
      </div>
      {adopting ? (
        <Adopt
          kind={adopting.kind === "initials" ? "initials" : "signature"}
          name={link.recipient.name}
          initials={initialsOf(link.recipient.name)}
          close={() => setAdopting(null)}
          adopt={(adoption) => {
            const field = adopting;
            setAdopting(null);
            void apply(field, adoption);
          }}
        />
      ) : null}
      {declining ? <DeclineDialog token={token} close={() => setDeclining(false)} done={reload} setProgress={setProgress} /> : null}
    </>
  );
}

function Written({ field }: { field: SignFieldJson }) {
  if (field.value === "drawn" && field.strokes) {
    return (
      <svg className="ink-strokes" viewBox={`0 0 ${SIGNATURE_PAD_ASPECT} 1`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        {field.strokes.map((stroke: Stroke, i) => (
          <polyline key={i} points={stroke.map(([x, y]) => `${x * SIGNATURE_PAD_ASPECT},${y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="0.03" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    );
  }
  return <span className={`written ${field.kind}`}>{(field.value ?? "").replace(/^typed:/, "")}</span>;
}

function DeclineDialog({ token, close, done, setProgress }: { token: string; close: () => void; done: () => Promise<void>; setProgress: (t: string) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const submit = async () => {
    setBusy(true);
    setError("");
    setProgress("Declining...");
    try {
      await api.post(`/api/sign/${token}/decline`, { reason });
      close();
      await done();
    } catch (failure) {
      setError(failure instanceof ApiFailure && failure.body.fields?.["reason"] ? (failure.body.fields["reason"] ?? GENERIC_FAILURE) : GENERIC_FAILURE);
      setBusy(false);
      box.current?.focus();
    }
  };
  return (
    <Dialog label="Decline to sign" onClose={close}>
      <h2>Decline to sign</h2>
      <label className="field-label">
        Reason
        <textarea ref={box} rows={4} value={reason} data-autofocus onChange={(e) => setReason(truncateCodePoints(e.target.value, REASON_LIMIT))} />
      </label>
      <p className="counter mono">{`${codePoints(reason)} of ${REASON_LIMIT} characters`}</p>
      {error ? <p role="alert" className="error">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => void submit()}>
          Decline
        </button>
      </div>
    </Dialog>
  );
}
