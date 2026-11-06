// The Drops screen and the four-step New drop form (brief: Staff screens; Interactions → New drop).
import { type FormEvent, useEffect, useState } from "react";
import { marketTime } from "../../shared/format";
import { CITY, MARKETS, type Market } from "../../shared/time";
import { api } from "../api";
import { useDraft } from "../drafts";
import { Link, useRouter } from "../router";
import { useSession } from "../session";
import type { StaffDrop } from "../types";
import { Button, EmptyRow, Field, Loading, PageTitle, Problems, StatusMark, StatusRegion, refusalMessage, useMessage, useProblems, wholeOrText } from "../ui";

export function DropsScreen(): JSX.Element {
  const { member } = useSession();
  const [drops, setDrops] = useState<StaffDrop[] | null>(null);
  const [message, setMessage] = useMessage();
  useEffect(() => {
    void api<{ items: StaffDrop[] }>("GET", "/api/drops").then((r) => (r.ok ? setDrops(r.data.items) : setMessage(refusalMessage(r))));
  }, [setMessage]);
  const producer = member?.role === "launch_producer";
  const merch = member?.role === "merchandiser";
  return (
    <div className="screen">
      <div className="screen-head with-action">
        <div>
          <p className="eyebrow">Season drops</p>
          <PageTitle>Drops</PageTitle>
        </div>
        {producer ? (
          <Link to="/studio/drops/new" className="btn btn-primary">
            New drop
          </Link>
        ) : null}
      </div>
      <StatusRegion name="Drops status" message={message} />
      <section className="panel">
        {!drops ? <Loading /> : null}
        <div className="table-scroll" tabIndex={0}>
          <table aria-label="Drops" className="ruled cards-on-phone">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Opens</th>
              </tr>
            </thead>
            <tbody>
              {drops?.length === 0 ? <EmptyRow columns={4} /> : null}
              {drops?.map((d) => (
                <tr key={d.id}>
                  <th scope="row" data-label="Name">
                    <Link to={producer ? `/studio/drops/${d.id}` : merch ? `/studio/drops/${d.id}/allocations` : `/studio/drops/${d.id}/allocations`}>{d.name}</Link>
                    {merch ? (
                      <span className="row-links inline-links">
                        <Link to={`/studio/drops/${d.id}/line-sheet`}>Line sheet</Link>
                        <Link to={`/studio/drops/${d.id}/lookbook`}>Lookbook</Link>
                      </span>
                    ) : null}
                    {producer ? (
                      <span className="row-links inline-links">
                        <Link to={`/studio/drops/${d.id}/allocations`}>Allocations</Link>
                      </span>
                    ) : null}
                  </th>
                  <td data-label="Type">{d.type === "rolling" ? "Rolling" : "Simultaneous"}</td>
                  <td data-label="Status">
                    <StatusMark status={d.status} />
                  </td>
                  <td data-label="Opens" className="mono">
                    {d.goLiveAt ? marketTime(Date.parse(d.goLiveAt)) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

interface StyleDraft {
  styleNumber: string;
  name: string;
  colour: string;
  wholesaleEdition: string;
}

interface NewDropDraft {
  step: number;
  name: string;
  type: "simultaneous" | "rolling";
  holdSeconds: string;
  internalNote: string;
  pieces: Record<Market, string>;
  styles: StyleDraft[];
}

const EMPTY: NewDropDraft = {
  step: 1,
  name: "",
  type: "simultaneous",
  holdSeconds: "900",
  internalNote: "",
  pieces: Object.fromEntries(MARKETS.map((m) => [m, "0"])) as Record<Market, string>,
  styles: [],
};

const STEPS = ["Basics", "Markets", "Styles", "Review"];

export function NewDropScreen(): JSX.Element {
  const { navigate } = useRouter();
  const draft = useDraft<NewDropDraft>("new-drop", EMPTY);
  const d = draft.value;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useMessage();
  const fields = [
    { path: "name", id: "nd-name", label: "Drop name" },
    { path: "type", id: "nd-type-simultaneous", label: "Drop type" },
    { path: "holdSeconds", id: "nd-hold", label: "Hold length in seconds" },
    { path: "internalNote", id: "nd-note", label: "Internal note" },
    ...MARKETS.map((m) => ({ path: `markets.${m}`, id: `nd-pieces-${m}`, label: `${CITY[m]} pieces` })),
    { path: "styles", id: "nd-add-style", label: "Styles" },
    ...d.styles.flatMap((_, i) => [
      { path: `styles.${i}.styleNumber`, id: `nd-style-${i}-number`, label: `Style ${i + 1} style number` },
      { path: `styles.${i}.name`, id: `nd-style-${i}-name`, label: `Style ${i + 1} style name` },
      { path: `styles.${i}.colour`, id: `nd-style-${i}-colour`, label: `Style ${i + 1} colour` },
      { path: `styles.${i}.wholesaleEdition`, id: `nd-style-${i}-edition`, label: `Style ${i + 1} wholesale edition` },
    ]),
  ];
  const p = useProblems(fields);
  const payload = (step: number): Record<string, unknown> => {
    const basics = { name: d.name, type: d.type, holdSeconds: wholeOrText(d.holdSeconds), internalNote: d.internalNote };
    const markets = { markets: Object.fromEntries(MARKETS.map((m) => [m, wholeOrText(d.pieces[m])])) };
    const styles = {
      styles: d.styles.map((s) => ({ styleNumber: s.styleNumber, name: s.name, colour: s.colour, wholesaleEdition: wholeOrText(s.wholesaleEdition) })),
    };
    if (step === 1) return basics;
    if (step === 2) return markets;
    if (step === 3) return styles;
    return { ...basics, ...markets, ...styles, status: "draft" };
  };
  const next = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    const r = await api("POST", "/api/drops/checks", payload(d.step));
    setPending(false);
    if (r.ok) {
      p.clear();
      setMessage(null);
      draft.set((v) => ({ ...v, step: Math.min(4, v.step + 1) }));
      return;
    }
    if (r.status === 422) p.show(r.fields);
    setMessage(refusalMessage(r));
  };
  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (d.step < 4) {
      await next();
      return;
    }
    if (pending) return;
    setPending(true);
    setMessage("Creating…");
    const r = await api<StaffDrop>("POST", "/api/drops", payload(4));
    setPending(false);
    if (r.ok) {
      draft.clear();
      setMessage("Drop created.");
      navigate(`/studio/drops/${r.data.id}`);
      return;
    }
    if (r.status === 422) p.show(r.fields);
    setMessage(refusalMessage(r));
  };
  const setStyle = (i: number, patch: Partial<StyleDraft>): void =>
    draft.set((v) => ({ ...v, styles: v.styles.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  return (
    <div className="screen narrow">
      <div className="screen-head">
        <p className="eyebrow">Studio · Drops</p>
        <PageTitle>New drop</PageTitle>
      </div>
      <form className="panel stepper" onSubmit={(e) => void create(e)} noValidate>
        <ol className="steps" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} className={i + 1 === d.step ? "is-current" : i + 1 < d.step ? "is-done" : ""} aria-current={i + 1 === d.step ? "step" : undefined}>
              <span className="mono">{String(i + 1).padStart(2, "0")}</span> {label}
            </li>
          ))}
        </ol>
        <p className="step-count mono">{`Step ${d.step} / 4`}</p>
        <Problems problems={p.problems} regionRef={p.regionRef} />
        {d.step === 1 ? (
          <fieldset className="stack">
            <legend>Basics</legend>
            <Field id="nd-name" label="Drop name" value={d.name} onChange={(name) => draft.set((v) => ({ ...v, name }))} error={p.errors.name} />
            <fieldset className="radios" role="radiogroup" aria-labelledby="nd-type-legend">
              <legend id="nd-type-legend">Drop type</legend>
              {(["simultaneous", "rolling"] as const).map((t) => (
                <label key={t} className="radio">
                  <input id={`nd-type-${t}`} type="radio" name="nd-type" checked={d.type === t} onChange={() => draft.set((v) => ({ ...v, type: t }))} />
                  {t === "simultaneous" ? "Simultaneous" : "Rolling"}
                </label>
              ))}
            </fieldset>
            <Field id="nd-hold" label="Hold length in seconds" type="number" value={d.holdSeconds} onChange={(holdSeconds) => draft.set((v) => ({ ...v, holdSeconds }))} error={p.errors.holdSeconds} />
            <Field id="nd-note" label="Internal note" multiline rows={3} value={d.internalNote} onChange={(internalNote) => draft.set((v) => ({ ...v, internalNote }))} error={p.errors.internalNote} hint="Staff only. Never shown to shoppers or the press." />
          </fieldset>
        ) : null}
        {d.step === 2 ? (
          <fieldset className="pieces-grid">
            <legend>Markets</legend>
            {MARKETS.map((m) => (
              <Field key={m} id={`nd-pieces-${m}`} label={`${CITY[m]} pieces`} type="number" value={d.pieces[m]} onChange={(v) => draft.set((x) => ({ ...x, pieces: { ...x.pieces, [m]: v } }))} error={p.errors[`markets.${m}`]} />
            ))}
          </fieldset>
        ) : null}
        {d.step === 3 ? (
          <fieldset className="stack">
            <legend>Styles</legend>
            <div className="table-scroll" tabIndex={0}>
              <table aria-label="Styles" className="ruled edit-table">
                <thead>
                  <tr>
                    <th scope="col">Style number</th>
                    <th scope="col">Style name</th>
                    <th scope="col">Colour</th>
                    <th scope="col">Wholesale edition</th>
                  </tr>
                </thead>
                <tbody>
                  {d.styles.length === 0 ? <EmptyRow columns={4} /> : null}
                  {d.styles.map((s, i) => (
                    <tr key={i}>
                      <td>
                        <Field id={`nd-style-${i}-number`} label="Style number" value={s.styleNumber} onChange={(styleNumber) => setStyle(i, { styleNumber })} error={p.errors[`styles.${i}.styleNumber`]} />
                      </td>
                      <td>
                        <Field id={`nd-style-${i}-name`} label="Style name" value={s.name} onChange={(name) => setStyle(i, { name })} error={p.errors[`styles.${i}.name`]} />
                      </td>
                      <td>
                        <Field id={`nd-style-${i}-colour`} label="Colour" value={s.colour} onChange={(colour) => setStyle(i, { colour })} error={p.errors[`styles.${i}.colour`]} />
                      </td>
                      <td>
                        <Field id={`nd-style-${i}-edition`} label="Wholesale edition" type="number" value={s.wholesaleEdition} onChange={(wholesaleEdition) => setStyle(i, { wholesaleEdition })} error={p.errors[`styles.${i}.wholesaleEdition`]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div id="nd-add-style" tabIndex={-1}>
              <Button onClick={() => draft.set((v) => ({ ...v, styles: [...v.styles, { styleNumber: "", name: "", colour: "", wholesaleEdition: "0" }] }))}>Add style</Button>
            </div>
          </fieldset>
        ) : null}
        {d.step === 4 ? (
          <div className="review">
            <h2>Review</h2>
            <dl className="facts">
              <div>
                <dt>Drop name</dt>
                <dd>{d.name}</dd>
              </div>
              <div>
                <dt>Drop type</dt>
                <dd>{d.type === "rolling" ? "Rolling" : "Simultaneous"}</dd>
              </div>
              <div>
                <dt>Hold length</dt>
                <dd className="mono">{d.holdSeconds} s</dd>
              </div>
              <div>
                <dt>Store pieces</dt>
                <dd className="mono">{MARKETS.map((m) => `${CITY[m]} ${d.pieces[m]}`).join(" · ")}</dd>
              </div>
              <div>
                <dt>Styles</dt>
                <dd>{d.styles.map((s) => `${s.styleNumber} ${s.name}, ${s.colour}, ${s.wholesaleEdition}`).join("; ")}</dd>
              </div>
            </dl>
            <p className="muted">The drop is created as a draft; set its time on the planner and schedule it from there.</p>
          </div>
        ) : null}
        <div className="step-actions">
          <Button disabled={d.step === 1} onClick={() => draft.set((v) => ({ ...v, step: Math.max(1, v.step - 1) }))}>
            Back
          </Button>
          {d.step < 4 ? (
            <Button variant="primary" pending={pending} onClick={() => void next()}>
              Next
            </Button>
          ) : (
            <Button type="submit" variant="primary" pending={pending} pendingText="Creating…">
              Create drop
            </Button>
          )}
        </div>
        <StatusRegion name="New drop status" message={message} />
      </form>
    </div>
  );
}
