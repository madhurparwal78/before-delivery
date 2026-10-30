import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Certificate, type Enrolment } from "../api";
import { monDYyyy, quarterSteps, quarterText } from "../format";
import { Seal, wedgeSweep } from "../seal/Seal";
import { prefersReducedMotion } from "../ui/Dialog";
import { Alert, useFeedback } from "../ui/feedback";
import { Icon, StatusGlyph } from "../ui/icons";
import { Link, PageHeading } from "../ui/router";
import { useLoad } from "../ui/useLoad";
import { sealStateOf } from "./CoursePage";
import { pressKey } from "./Evaluation";
import { ShareDialog } from "./ShareDialog";

// Seal press timing (brief: Motion and effects): flight + sweep a little under half a second, the next chip
// leaves a sixteenth of a second later, the numeral counts for just under a second, the ring text fades in.
const STAGGER = 62.5;
const FLIGHT = 300;
const SWEEP = 140;
const COUNT = 900;
const RING_FADE = 250;
const POLL = 5000;

interface Screen {
  enrolment: Enrolment;
  certificate: Certificate | null;
}

export function Completion({ enrolmentId }: { enrolmentId: string }) {
  const { announce } = useFeedback();
  const [plays] = useState(() => {
    const play = sessionStorage.getItem(pressKey(enrolmentId)) === "1";
    sessionStorage.removeItem(pressKey(enrolmentId));
    return play && !prefersReducedMotion();
  });
  const [pressing, setPressing] = useState(plays);
  const [pressStarted, setPressStarted] = useState(false);
  const page = useLoad<Screen>(async () => {
    const { enrolment } = await api<{ enrolment: Enrolment }>("GET", `/api/enrolments/${encodeURIComponent(enrolmentId)}`);
    const certificate = enrolment.certificate_id
      ? (await api<{ certificate: Certificate }>("GET", `/api/certificates/${enrolment.certificate_id}`)).certificate
      : null;
    return { enrolment, certificate };
  });
  const [unlanded, setUnlanded] = useState<ReadonlySet<string>>(new Set());
  const [sweeping, setSweeping] = useState<ReadonlySet<string>>(new Set());
  const [pressNumeral, setPressNumeral] = useState<string | null>(plays ? "0.00" : null);
  const [ringFade, setRingFade] = useState(false);
  const [sharing, setSharing] = useState(false);
  const timers = useRef<number[]>([]);
  const flights = useRef<Animation[]>([]);
  const wedges = useRef(new Map<string, SVGCircleElement>());
  const listRef = useRef<HTMLUListElement>(null);
  const sealRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const focusAfterPress = useRef(false);
  const lastState = useRef<string | null>(null);

  const data = page.data;
  const certificate = data?.certificate ?? null;

  const finish = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    flights.current.forEach((a) => a.cancel());
    flights.current = [];
    setUnlanded(new Set());
    setSweeping(new Set());
    setPressNumeral(null);
    focusAfterPress.current = true;
    setPressing(false);
  }, []);

  // The press itself, once the certificate is known: chips fly in list order, wedges sweep, the numeral counts.
  useEffect(() => {
    if (!pressing || pressStarted || !data?.certificate) return;
    setPressStarted(true);
    const cert = data.certificate;
    const later = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, ms));
    const verified = data.enrolment.modules.filter((m) => m.status === "verified");
    setUnlanded(new Set(verified.map((m) => m.id)));
    setPressNumeral("0.00");
    verified.forEach((m, index) => {
      const depart = index * STAGGER;
      later(depart, () => {
        const chip = listRef.current?.querySelector<HTMLElement>(`[data-chip-for="${m.id}"] .chip`);
        const seal = sealRef.current?.getBoundingClientRect();
        if (!chip || !seal) return;
        const from = chip.getBoundingClientRect();
        const clone = document.createElement("span");
        clone.className = "flying-chip";
        clone.style.left = `${from.left}px`;
        clone.style.top = `${from.top}px`;
        document.body.appendChild(clone);
        const dx = seal.left + seal.width / 2 - (from.left + from.width / 2);
        const dy = seal.top + seal.height / 2 - (from.top + from.height / 2);
        const flight = clone.animate(
          [
            { transform: "translate(0, 0) scale(1)", opacity: 1 },
            { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 24}px) scale(1.15)`, opacity: 1, offset: 0.45 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0 },
          ],
          { duration: FLIGHT, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
        flights.current.push(flight);
        const remove = () => clone.remove();
        flight.finished.then(remove, remove);
      });
      later(depart + FLIGHT, () => {
        const sweep = wedgeSweep(m.minutes, data.enrolment.total_minutes);
        const animation = wedges.current.get(m.id)?.animate([{ strokeDasharray: "0 360" }, { strokeDasharray: `${sweep} 360` }], {
          duration: SWEEP,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
        const settle = () => setSweeping((prev) => new Set([...prev].filter((id) => id !== m.id)));
        if (animation) {
          flights.current.push(animation);
          setSweeping((prev) => new Set([...prev, m.id]));
          animation.finished.then(settle, settle);
        }
        setUnlanded((prev) => new Set([...prev].filter((id) => id !== m.id)));
      });
    });
    const landed = verified.length === 0 ? 0 : (verified.length - 1) * STAGGER + FLIGHT + SWEEP;
    const steps = quarterSteps(cert.contact_hours);
    for (let step = 1; step <= steps; step += 1) {
      later(landed + (step * COUNT) / steps, () => setPressNumeral(step === steps ? cert.contact_hours : quarterText(step)));
    }
    later(landed + COUNT, () => setRingFade(cert.state !== "sealing"));
    later(landed + COUNT + RING_FADE, finish);
  }, [pressing, pressStarted, data, finish]);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  // While the certificate is sealing, re-read it every five seconds.
  useEffect(() => {
    if (certificate?.state !== "sealing") return;
    const id = window.setTimeout(() => void page.reload(), POLL);
    return () => window.clearTimeout(id);
  }, [certificate, page]);

  // A certificate that becomes sealed while the screen is open closes its gap and fades its ring text in.
  useEffect(() => {
    if (!certificate) return;
    if (lastState.current === "sealing" && certificate.state === "sealed" && !prefersReducedMotion()) setRingFade(true);
    lastState.current = certificate.state;
  }, [certificate]);

  useEffect(() => {
    if (!focusAfterPress.current || pressing || !data) return;
    focusAfterPress.current = false;
    (shareRef.current && !shareRef.current.disabled ? shareRef.current : downloadRef.current)?.focus();
  });

  if (!data) return page.failure ? <Alert>{page.failure}</Alert> : <p aria-busy="true" className="muted">Loading your seal…</p>;
  const { enrolment } = data;
  const state = sealStateOf(certificate);
  const sealed = state === "sealed";
  const statusText = pressing
    ? ""
    : state === "sealed" && certificate
      ? `Certificate sealed: ${certificate.contact_hours} contact hours, serial ${certificate.serial}`
      : state === "pending"
        ? "Certificate PDF pending"
        : state === "revoked"
          ? "Certificate revoked"
          : "";
  // Until the press starts, every verified wedge waits for its chip.
  const hidden = pressing && !pressStarted ? new Set(enrolment.modules.filter((m) => m.status === "verified").map((m) => m.id)) : unlanded;
  const showRing = certificate !== null && certificate.issued_on !== null && state !== "pending" && !(pressing && !ringFade);

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">{enrolment.course_title}</p>
        <PageHeading>Your contact-hour seal</PageHeading>
        {pressing && (
          <div>
            <button type="button" className="btn secondary" onClick={finish}>
              Show result now
            </button>
          </div>
        )}
      </div>
      <div className="completion">
        <div className="seal-stage">
          <div className="seal-wrap" ref={sealRef}>
            <Seal
              modules={enrolment.modules.map((m, index) => ({ id: m.id, number: index + 1, title: m.title, minutes: m.minutes, verified: m.status === "verified" }))}
              totalMinutes={enrolment.total_minutes}
              state={state}
              numeral={certificate ? (pressNumeral ?? certificate.contact_hours) : null}
              ringText={showRing && certificate?.issued_on ? { serial: certificate.serial, issued: monDYyyy(certificate.issued_on) } : null}
              ringFade={ringFade}
              unlanded={hidden}
              sweeping={sweeping}
              registerWedge={(id, el) => {
                if (el) wedges.current.set(id, el);
                else wedges.current.delete(id);
              }}
            />
          </div>
          <p className="seal-status" role="status" aria-label="Seal status" aria-live="polite">
            {statusText}
          </p>
          <div className="seal-actions">
            <button ref={shareRef} type="button" className="btn" disabled={!sealed || pressing} onClick={() => setSharing(true)}>
              <Icon name="link" />
              Share with a verifier
            </button>
            {certificate && (
              <a
                ref={downloadRef}
                className="btn secondary"
                href={`/api/certificates/${certificate.id}/pdf`}
                onClick={(event) => {
                  if (certificate.state === "sealing") {
                    event.preventDefault();
                    announce("The certificate PDF is still being stored.");
                  }
                }}
              >
                <Icon name="download" />
                Download certificate PDF
              </a>
            )}
          </div>
          {!certificate && (
            <p className="muted" style={{ textAlign: "center" }}>
              Finish every lesson and the post-evaluation to press this seal. <Link to={`/courses/${enrolment.course_id}`}>Back to the course</Link>
            </p>
          )}
        </div>
        <section aria-labelledby="seal-modules">
          <h2 id="seal-modules" className="label" style={{ fontSize: "19.2px", marginBottom: "var(--s3)" }}>
            Modules
          </h2>
          <ul className="ruled seal-list" aria-label="Modules" ref={listRef}>
            {enrolment.modules.map((m, index) => (
              <li key={m.id} className="module-row">
                <span className="num">{index + 1}.</span>
                <span>{m.title}</span>
                <span className="muted fig">{m.minutes} min</span>
                <span data-chip-for={m.id}>
                  <StatusGlyph verified={m.status === "verified"} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {sharing && certificate && <ShareDialog certificateId={certificate.id} onClosed={() => setSharing(false)} />}
    </>
  );
}
