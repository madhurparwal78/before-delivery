import type { JSX } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { clientCopy, copy } from "../../../server/domain/copy.ts";
import { parseNote } from "../../../server/domain/markup.ts";
import { datetimeCopy } from "../../../server/domain/time.ts";
import type { Language } from "../../../server/domain/towns.ts";
import { announce } from "../lib/announce.ts";
import { ApiFailure, get, post, send } from "../lib/api.ts";
import { Dialog, type DialogControl, useDialog } from "../lib/dialog.tsx";
import { AsyncButton, Field, Problems, useForm } from "../lib/forms.tsx";
import { useLive } from "../lib/live.ts";
import { EASE, MOVE_MS, reducedMotion } from "../lib/motion.ts";
import { BackToPiece, Heading, Loading, MainAction, MintTile } from "../lib/screen.tsx";
import type { ScreenProps } from "../routes.tsx";

type DossierState = "waiting" | "rendering" | "stored" | "failed" | "signed";

interface Dossier {
  id: string;
  state: DossierState;
  message: string | null;
  signedBy: string | null;
  signedAt: string | null;
  history: { at: string; who: string; what: string }[];
}

interface Piece {
  title: string;
  clientId: string;
  clientName: string;
  maker: string | null;
  year: string | null;
  stampNumber: string | null;
}

interface Pin {
  id: string;
  number: number;
  kind: string;
  note: string;
  signed: boolean;
}

interface Photograph {
  id: string;
  side: "before" | "after";
  state: string;
}

interface Estimate {
  state: string;
  materialCode: string | null;
  lot: string | null;
  hides: number | null;
  metres: string | null;
}

const SECTIONS = [
  ["the-piece", "01 The piece"],
  ["condition", "02 Condition"],
  ["materials", "03 Materials"],
  ["photographs", "04 Photographs"],
  ["care-card", "05 Care card"],
  ["history", "06 History"],
] as const;

const RAIL_LINE_PX = 96;
const LANDING_GAP_PX = 16;
const POLL_MS = 1000;
const STEPS = ["Waiting", "Rendering", "Stored"] as const;
const KIND_NAMES: Record<string, string> = { tear: "Tear", crack: "Crack", stain: "Stain", looseJoint: "Loose joint", woodworm: "Woodworm" };

type StepState = "pending" | "current" | "done";

function stepStates(state: DossierState | null): readonly StepState[] {
  switch (state) {
    case "waiting":
      return ["current", "pending", "pending"];
    case "rendering":
    case "failed":
      return ["done", "current", "pending"];
    case "stored":
    case "signed":
      return ["done", "done", "done"];
    default:
      return ["pending", "pending", "pending"];
  }
}

async function readDossier(pieceId: string): Promise<Dossier | null> {
  try {
    return (await get<{ dossier: Dossier }>(`/api/pieces/${pieceId}/dossier`)).dossier;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) return null;
    throw error;
  }
}

/** Follows the case-page rule: the last heading past the line, section six once the page bottoms out, `01` before any. */
function useRail(ready: boolean): { current: string; jump: (hash: string) => void; frame: { current: HTMLDivElement | null } } {
  const [current, setCurrent] = useState<string>(SECTIONS[0][0]);
  const heldAt = useRef<number | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  const land = useCallback((hash: string) => {
    const heading = document.getElementById(hash);
    if (!heading) return;
    const top = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
    const rail = frame.current;
    const railDepth = rail && getComputedStyle(rail).position === "sticky" && rail.offsetWidth > innerWidth / 2 ? rail.offsetHeight : 0;
    const y = heading.getBoundingClientRect().top + window.scrollY - top - railDepth - LANDING_GAP_PX;
    window.scrollTo({ top: y, behavior: "instant" });
    heldAt.current = window.scrollY;
    heading.focus({ preventScroll: true });
    setCurrent(hash);
  }, []);

  const jump = useCallback(
    (hash: string) => {
      history.pushState(history.state, "", `#${hash}`);
      land(hash);
    },
    [land],
  );

  useEffect(() => {
    if (!ready) return undefined;
    const read = (): void => {
      if (heldAt.current !== null) {
        if (Math.abs(window.scrollY - heldAt.current) < 1) return;
        heldAt.current = null;
      }
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1;
      let found: string = SECTIONS[0][0];
      for (const [hash] of SECTIONS) {
        const heading = document.getElementById(hash);
        if (heading && heading.getBoundingClientRect().top <= RAIL_LINE_PX) found = hash;
      }
      setCurrent(atBottom ? (SECTIONS.at(-1) as (typeof SECTIONS)[number])[0] : found);
    };
    const follow = (): void => {
      const hash = window.location.hash.slice(1);
      if (SECTIONS.some(([id]) => id === hash)) land(hash);
    };
    follow();
    if (!window.location.hash) read();
    addEventListener("scroll", read, { passive: true });
    addEventListener("resize", read);
    addEventListener("popstate", follow);
    return () => {
      removeEventListener("scroll", read);
      removeEventListener("resize", read);
      removeEventListener("popstate", follow);
    };
  }, [ready, land]);

  useEffect(() => {
    const box = frame.current;
    const link = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!box || !link || box.scrollWidth <= box.clientWidth) return;
    const left = link.offsetLeft - box.offsetLeft;
    if (left < box.scrollLeft) box.scrollLeft = left;
    else if (left + link.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = left + link.offsetWidth - box.clientWidth;
  }, [current]);

  return { current, jump, frame };
}

function Note({ note }: { note: string }): JSX.Element {
  return (
    <>
      {parseNote(note).map((part, index) => {
        if (part.kind === "bold") return <strong key={index}>{part.text}</strong>;
        if (part.kind === "italic") return <em key={index}>{part.text}</em>;
        if (part.kind === "link") return <a key={index} href={part.address}>{part.text}</a>;
        return part.text;
      })}
    </>
  );
}

/** The strip. A step that finishes while the screen is open draws its check once; one already done shows it at rest. */
function Strip({ state }: { state: DossierState | null }): JSX.Element {
  const list = useRef<HTMLOListElement>(null);
  const states = stepStates(state);
  const seen = useRef<readonly StepState[] | null>(null);

  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = states;
    if (!before || reducedMotion()) return;
    states.forEach((step, index) => {
      if (step !== "done" || before[index] === "done") return;
      const check = list.current?.querySelectorAll('[data-part="dossier-step"]')[index]?.querySelector('[data-part="step-check"]');
      check?.animate([{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }], { duration: MOVE_MS, easing: EASE });
    });
  }, [state]);

  return (
    <ol ref={list} class="dossier-steps" aria-label="Dossier steps">
      {STEPS.map((step, index) => (
        <li key={step} class="dossier-step" data-part="dossier-step" data-state={states[index]}>
          {states[index] === "done" ? (
            <svg data-part="step-check" class="step-check" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M5 13l4 4 10-11" fill="none" stroke="currentColor" stroke-width="3" pathLength={24} stroke-dasharray="24" />
            </svg>
          ) : (
            <span class="step-dot" aria-hidden="true" />
          )}
          {step}
        </li>
      ))}
    </ol>
  );
}

function SignDialog({ control, pieceId, reload }: { control: DialogControl; pieceId: string; reload: () => Promise<void> }): JSX.Element {
  const form = useForm({ typedName: "" }, control);
  return (
    <Dialog control={control} title="Sign dossier">
      <Problems form={form} firstField="typedName" />
      <Field form={form} name="typedName" label="Your full name" autocomplete="name" />
      <AsyncButton
        label="Sign"
        primary
        onPress={async () => {
          const saved = await form.submit(() => post(`/api/pieces/${pieceId}/dossier/sign`, form.values).then(reload));
          if (!saved) return;
          control.opener.current = null;
          control.done();
          announce(copy("F-94"));
        }}
      />
    </Dialog>
  );
}

function downloadBlob(blob: Blob, name: string): void {
  const address = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = address;
  link.download = name;
  link.click();
  URL.revokeObjectURL(address);
}

export function DossierScreen({ id }: ScreenProps): JSX.Element {
  const live = useLive(
    async () => {
      const [{ piece }, dossier, { pins }, { photographs }, { estimates }, { materials }] = await Promise.all([
        get<{ piece: Piece }>(`/api/pieces/${id}`),
        readDossier(id),
        get<{ pins: Pin[] }>(`/api/pieces/${id}/pins`),
        get<{ photographs: Photograph[] }>(`/api/pieces/${id}/photographs`),
        get<{ estimates: Estimate[] }>(`/api/pieces/${id}/estimates`),
        get<{ materials: { code: string; name: string }[] }>("/api/materials"),
      ]);
      const { client } = await get<{ client: { language: Language } }>(`/api/clients/${piece.clientId}`);
      return { piece, dossier, pins, photographs, estimates, materials, language: client.language };
    },
    [id],
  );
  const sign = useDialog("Sign dossier");
  const data = live.data;
  const state = data?.dossier?.state ?? null;
  const rail = useRail(data !== undefined);
  const lastState = useRef<DossierState | null | undefined>(undefined);

  useEffect(() => {
    if (data === undefined) return;
    const before = lastState.current;
    lastState.current = state;
    if (before === "waiting" || before === "rendering") {
      if (state === "stored") announce(copy("F-93"));
      if (state === "failed" && data.dossier?.message) announce(data.dossier.message);
    }
  }, [data === undefined, state]);

  useEffect(() => {
    if (state !== "waiting" && state !== "rendering") return undefined;
    const timer = setInterval(() => void live.reload().catch(() => undefined), POLL_MS);
    return () => clearInterval(timer);
  }, [state]);

  const download = async (event: MouseEvent): Promise<void> => {
    event.preventDefault();
    try {
      const response = await send("GET", `/api/pieces/${id}/dossier/pdf`);
      downloadBlob(await response.blob(), `dossier-${id}.pdf`);
    } catch (error) {
      if (error instanceof ApiFailure) announce(error.message);
    }
  };

  if (!data) return <Loading height={480} />;
  const { piece, dossier, photographs, language } = data;
  const signedPins = data.pins.filter((pin) => pin.signed);
  const estimate = data.estimates.find((item) => item.state === "signedOff");
  const material = data.materials.find((item) => item.code === estimate?.materialCode);
  const latest = (side: Photograph["side"]): Photograph | undefined => photographs.filter((photo) => photo.side === side && photo.state === "stored").at(-1);
  const pictures = [
    ["before", "Before", "Photograph before the work"],
    ["after", "After", "Photograph after the work"],
  ] as const;

  return (
    <>
      <BackToPiece id={id} />
      <Heading text={`Dossier for ${piece.title}`}>
        <MainAction>
          <AsyncButton
            label="Make dossier"
            primary
            onPress={async () => {
              try {
                lastState.current = "waiting";
                await post(`/api/pieces/${id}/dossier`);
                await live.reload();
              } catch (error) {
                lastState.current = state;
                if (error instanceof ApiFailure) announce(error.message);
              }
            }}
          />
        </MainAction>
      </Heading>
      <div class="bento dossier-top">
        <section class="tile t-large stack" aria-label="Dossier state">
          <Strip state={state} />
          {dossier?.state === "failed" ? <p class="refused-note">{dossier.message}</p> : null}
          {dossier?.signedBy && dossier.signedAt ? (
            <p>
              Signed by {dossier.signedBy}, {datetimeCopy(new Date(dossier.signedAt))}
            </p>
          ) : null}
          <div class="actions" data-print="no">
            {state === "stored" || state === "signed" ? (
              <a class="button" href={`/api/pieces/${id}/dossier/pdf`} onClick={(event) => void download(event)}>
                Download PDF
              </a>
            ) : null}
            {state === "stored" ? (
              <button type="button" class="button" onClick={(event) => sign.show(event.currentTarget)}>
                Sign dossier
              </button>
            ) : null}
          </div>
        </section>
        <MintTile label="Dossier" figure={state === "signed" ? "Signed" : state === "failed" ? "Failed" : state ? (STEPS[["waiting", "rendering", "stored"].indexOf(state)] as string) : "Not made"} size="t-medium" />
      </div>
      <div class="dossier-body">
        <div ref={rail.frame} class="dossier-rail" role="region" aria-label="Section numbers" tabIndex={0} data-print="no">
          <nav aria-label="Sections">
            <ol>
              {SECTIONS.map(([hash, heading]) => (
                <li key={hash}>
                  <a
                    class="rail-link"
                    href={`#${hash}`}
                    aria-current={rail.current === hash ? "true" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      rail.jump(hash);
                    }}
                  >
                    <span class="rail-number">{heading.slice(0, 2)}</span>
                    <span class="rail-words"> {heading.slice(3)}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
        <div class="dossier-sections">
          <section class="tile" aria-labelledby="the-piece">
            <h2 id="the-piece" tabIndex={-1}>{SECTIONS[0][1]}</h2>
            <dl class="facts">
              <dt>Piece</dt>
              <dd>{piece.title}</dd>
              <dt>Client</dt>
              <dd>{piece.clientName}</dd>
              <dt>Maker</dt>
              <dd>{[piece.maker, piece.year].filter(Boolean).join(", ")}</dd>
              <dt>Stamp number</dt>
              <dd>{piece.stampNumber}</dd>
            </dl>
          </section>
          <section class="tile" aria-labelledby="condition">
            <h2 id="condition" tabIndex={-1}>{SECTIONS[1][1]}</h2>
            {signedPins.length === 0 ? (
              <p class="muted">No pins yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th scope="col">Pin</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {signedPins.map((pin) => (
                    <tr key={pin.id}>
                      <td>{pin.number}</td>
                      <td>{KIND_NAMES[pin.kind]}</td>
                      <td>
                        <Note note={pin.note} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section class="tile" aria-labelledby="materials">
            <h2 id="materials" tabIndex={-1}>{SECTIONS[2][1]}</h2>
            {estimate?.materialCode ? (
              <dl class="facts">
                <dt>Material</dt>
                <dd>
                  {material?.name} {estimate.materialCode}
                </dd>
                <dt>Dye lot</dt>
                <dd>{estimate.lot}</dd>
                <dt>Amount</dt>
                <dd>{estimate.metres ? `${estimate.metres} m` : estimate.hides === 1 ? "1 hide" : `${estimate.hides} hides`}</dd>
              </dl>
            ) : (
              <p class="muted">{copy("F-92")}</p>
            )}
          </section>
          <section class="tile" aria-labelledby="photographs">
            <h2 id="photographs" tabIndex={-1}>{SECTIONS[3][1]}</h2>
            {latest("before") || latest("after") ? (
              <div class="dossier-pictures">
                {pictures.map(([side, caption, alt]) => {
                  const photo = latest(side);
                  return photo ? (
                    <figure key={side}>
                      <img src={`/api/pieces/${id}/photographs/${photo.id}/file`} alt={alt} width={480} height={360} />
                      <figcaption>{caption}</figcaption>
                    </figure>
                  ) : null;
                })}
              </div>
            ) : (
              <p class="muted">No photographs yet.</p>
            )}
          </section>
          <section class="tile" aria-labelledby="care-card">
            <h2 id="care-card" tabIndex={-1}>{SECTIONS[4][1]}</h2>
            <div lang={language} dir={language === "ar" ? "rtl" : "ltr"}>
              {language === "en" ? null : <h3>{clientCopy("K1", language)}</h3>}
              <p class="measure">{clientCopy("K2", language)}</p>
            </div>
          </section>
          <section class="tile" aria-labelledby="history">
            <h2 id="history" tabIndex={-1}>{SECTIONS[5][1]}</h2>
            <ol class="stack" aria-label="Dossier history">
              {(dossier?.history ?? []).map((entry) => (
                <li key={`${entry.what}-${entry.at}`}>
                  {entry.who}, {entry.what}, {datetimeCopy(new Date(entry.at))}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
      <SignDialog control={sign} pieceId={id} reload={live.reload} />
    </>
  );
}
