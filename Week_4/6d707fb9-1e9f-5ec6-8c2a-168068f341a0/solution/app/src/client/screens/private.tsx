import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { COUNTRIES, MEASURE_NAMES, STAGE_NAMES, type Language } from "../../shared/catalog";
import type { AnswerPage, SignOffPage } from "../../shared/api";
import { ANSWER_COPY } from "../../shared/copy";
import { shownDate } from "../../shared/time";
import { ApiFailure, announce, api, failureText, focusHeading, post, useAction, useResource } from "../lib";
import { Button, Field, Modal, Problems, TableFrame, useDialog, useForm } from "../ui";
import { RefreshLine } from "../frame";
import { Heading } from "./public";

type Step = "energy" | "water" | "fibreOrigin" | "evidence" | "send";

interface AnswerDraft {
  energy: string;
  unit: string;
  water: string;
  origin: string;
  evidence: { id: string; name: string }[];
}

const draftKey = (token: string): string => `fio.answer.${token}`;

function readDraft(token: string): AnswerDraft {
  const empty: AnswerDraft = { energy: "", unit: "kWh", water: "", origin: "", evidence: [] };
  try {
    return { ...empty, ...(JSON.parse(localStorage.getItem(draftKey(token)) ?? "{}") as Partial<AnswerDraft>) };
  } catch {
    return empty;
  }
}

const STEP_OF_FIELD: Record<string, Step> = { "energy.value": "energy", "energy.unit": "energy", "water.value": "water", fibreOrigin: "fibreOrigin", evidenceIds: "evidence" };

export function AnswerScreen({ token, initial, language }: { token: string; initial: AnswerPage; language: Language }): JSX.Element {
  const copy = ANSWER_COPY[language];
  const page = useResource<AnswerPage>(`/api/a/${token}`, { watchSession: false });
  const data = page.data ?? initial;
  const asked = data.questions;
  const steps: Step[] = [...(["energy", "water", "fibreOrigin"] as const).filter((step) => asked.includes(step)), "evidence", "send"];
  const [step, setStep] = useState<Step>(steps[0] as Step);
  const [draft, setDraft] = useState<AnswerDraft>(() => readDraft(token));
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const [sent, setSent] = useState(data.state === "answered");
  const form = useForm(null, {});
  const [fileBusy, runFile] = useAction();
  const unit = useDialog();
  const rail = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const rtl = language === "ar";
  const heading = sent ? copy.sent : copy.heading;

  const update = (changes: Partial<AnswerDraft>): void => {
    setDraft((current) => {
      const next = { ...current, ...changes };
      localStorage.setItem(draftKey(token), JSON.stringify(next));
      return next;
    });
  };

  useLayoutEffect(() => {
    if (moveFocus.current) {
      moveFocus.current = false;
      rail.current?.querySelector<HTMLElement>('[aria-current="step"]')?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (page.missing) location.reload();
  }, [page.missing]);

  const goTo = (next: Step, focusRail = false): void => {
    moveFocus.current = focusRail;
    setStep(next);
  };

  const onRailKey = (event: KeyboardEvent): void => {
    const at = steps.indexOf(step);
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const backward = rtl ? "ArrowRight" : "ArrowLeft";
    let next: number | null = null;
    if (event.key === forward) next = Math.min(steps.length - 1, at + 1);
    else if (event.key === backward) next = Math.max(0, at - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = steps.length - 1;
    if (next === null) return;
    event.preventDefault();
    goTo(steps[next] as Step, true);
  };

  const stepName = (entry: Step): string =>
    ({ energy: copy.stepEnergy, water: copy.stepWater, fibreOrigin: copy.stepOrigin, evidence: copy.stepEvidence, send: copy.stepSend })[entry];

  const fileRefusal = (error: unknown): string => {
    if (error instanceof ApiFailure && error.code === "too_large") return copy.tooBig;
    return failureText(error);
  };

  /** A chosen file goes to the store at once, so a refusal shows where it was chosen. */
  const upload = async (file: File): Promise<boolean> => {
    const body = new FormData();
    body.append("file", file);
    try {
      const made = await api<{ evidenceId: string; fileName: string }>(`/api/a/${token}/evidence`, { method: "POST", raw: body, noSessionWatch: true });
      update({ evidence: [...readDraft(token).evidence, { id: made.evidenceId, name: made.fileName }] });
      setFailedFile(null);
      return true;
    } catch (error) {
      setFailedFile(file);
      form.refuse(fileRefusal(error));
      return false;
    }
  };

  const send = (): void => {
    void form.submit(async () => {
      if (failedFile && !(await upload(failedFile))) return;
      const fresh = readDraft(token);
      const body = {
        ...(asked.includes("energy") ? { energy: { value: fresh.energy, unit: fresh.unit } } : {}),
        ...(asked.includes("water") ? { water: { value: fresh.water } } : {}),
        ...(asked.includes("fibreOrigin") ? { fibreOrigin: fresh.origin } : {}),
        evidenceIds: fresh.evidence.map((entry) => entry.id),
      };
      await post(`/api/a/${token}/answers`, body, { noSessionWatch: true });
      localStorage.removeItem(draftKey(token));
      setSent(true);
      announce(copy.sent);
    });
  };

  const atFirst = steps.indexOf(step) === 0;
  const atLast = step === "send";
  const sending = form.busy || fileBusy;

  return (
    <main class="one-column answer-page">
      <Heading>{copy.heading}</Heading>
      <RefreshLine copy={copy.refresh} />
      <p>{copy.intro(data.labelName, data.styleName)}</p>
      <p>
        {copy.due(data.dueDate, data.townName)
          .split(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)
          .map((part, index) => (index % 2 ? <bdi dir="ltr">{part}</bdi> : part))}
      </p>
      {sent ? (
        <div class="sent-copy">
          <p class="sent-word">{heading}</p>
          <dl class="facts">
            {draft.energy ? (
              <div>
                <dt>{copy.energy}</dt>
                <dd dir="ltr">
                  {draft.energy} {draft.unit}
                </dd>
              </div>
            ) : null}
            {draft.water ? (
              <div>
                <dt>{copy.water}</dt>
                <dd dir="ltr">{draft.water}</dd>
              </div>
            ) : null}
            {draft.origin ? (
              <div>
                <dt>{copy.origin}</dt>
                <dd>{copy.countries[draft.origin]}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : (
        <>
          <div ref={rail} class="rail" role="group" aria-label={copy.steps} onKeyDown={onRailKey}>
            {steps.map((entry) => (
              <button
                key={entry}
                type="button"
                class="rail-step"
                tabIndex={entry === step ? 0 : -1}
                aria-current={entry === step ? "step" : undefined}
                onClick={() => goTo(entry)}
              >
                {stepName(entry)}
              </button>
            ))}
          </div>
          <Problems form={form} title={copy.problems} onField={(key) => goTo(STEP_OF_FIELD[key] ?? step)} aliases={{ "energy.value": "energy", "water.value": "water", "energy.unit": "energy" }} />
          {step === "energy" ? (
            <div class="step-fields">
              <Field form={form} name="energy" label={copy.energy} inputMode="decimal" dir="ltr" aliasOf={["energy.value"]} value={draft.energy} onValue={(value) => update({ energy: value })} />
              <p class="unit-line">
                <Button onPress={unit.show}>{copy.unit}</Button>
                <span dir="ltr">{draft.unit === "m3" ? copy.gas : draft.unit}</span>
              </p>
            </div>
          ) : null}
          {step === "water" ? (
            <div class="step-fields">
              <Field form={form} name="water" label={copy.water} inputMode="decimal" dir="ltr" aliasOf={["water.value"]} value={draft.water} onValue={(value) => update({ water: value })} />
            </div>
          ) : null}
          {step === "fibreOrigin" ? (
            <div class="step-fields">
              <Field
                form={form}
                name="fibreOrigin"
                label={copy.origin}
                value={draft.origin}
                onValue={(value) => update({ origin: value })}
                options={[{ value: "", label: "—" }, ...COUNTRIES.map((country) => ({ value: country.id, label: copy.countries[country.id] as string }))]}
              />
            </div>
          ) : null}
          {step === "evidence" ? (
            <div class="step-fields">
              <div class="field">
                <label for="field-evidence">{copy.evidence}</label>
                <input
                  id="field-evidence"
                  type="file"
                  aria-invalid={failedFile ? "true" : undefined}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void runFile(async () => void (await upload(file)));
                  }}
                />
              </div>
              {draft.evidence.length ? (
                <ul class="plain-list">
                  {draft.evidence.map((entry) => (
                    <li key={entry.id}>{entry.name}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {step === "send" ? <div class="step-fields" /> : null}
          <div class="answer-bar">
            <Button class={atFirst ? "is-gone" : undefined} onPress={() => goTo(steps[Math.max(0, steps.indexOf(step) - 1)] as Step)}>
              {copy.back}
            </Button>
            <Button
              green
              busy={atLast && sending}
              busyText={copy.working}
              onPress={() => {
                if (atLast) send();
                else goTo(steps[steps.indexOf(step) + 1] as Step);
              }}
            >
              {atLast ? copy.send : copy.next}
            </Button>
          </div>
          <Modal name={copy.unit} control={unit} kind="side" dismissOutside>
            <div class="unit-sheet">
              <h2>{copy.unit}</h2>
              <fieldset class="chips">
                <legend class="sr-only">{copy.unit}</legend>
                {[
                  { id: "kWh", name: "kWh" },
                  { id: "MJ", name: "MJ" },
                  { id: "m3", name: copy.gas },
                ].map((entry) => (
                  <label key={entry.id} class="chip">
                    <input type="radio" name="unit" checked={draft.unit === entry.id} onChange={() => update({ unit: entry.id })} />
                    <span>{entry.name}</span>
                  </label>
                ))}
              </fieldset>
              <Button onPress={unit.hide}>{copy.close}</Button>
            </div>
          </Modal>
        </>
      )}
    </main>
  );
}

export function AnswerEnded({ language }: { language: Language }): JSX.Element {
  return (
    <main class="one-column answer-page">
      <Heading>{ANSWER_COPY[language].ended}</Heading>
    </main>
  );
}

export function SignOffScreen({ token, initial }: { token: string; initial: SignOffPage }): JSX.Element {
  const page = useResource<SignOffPage>(`/api/s/${token}`, { watchSession: false });
  const data = page.data ?? initial;
  const { dossier } = data;
  const form = useForm(null, { name: "" });

  useEffect(() => {
    if (page.missing) location.reload();
  }, [page.missing]);

  const sign = (event: Event): void => {
    event.preventDefault();
    void form.submit(async () => {
      await post(`/api/s/${token}/sign`, { name: form.values.name }, { noSessionWatch: true });
      await page.reload();
      focusHeading();
      announce(`Signed off by ${form.values.name.trim()}.`);
    });
  };

  return (
    <main class="one-column signoff">
      <Heading>{`Sign off ${dossier.styleName}`}</Heading>
      <RefreshLine />
      <p>
        Factor edition {dossier.edition} · Data quality {dossier.dataQualityGrade} ({dossier.dataQualityPercent}%)
      </p>
      {dossier.measures.map((measure) => (
        <section key={measure.measure} class="panel">
          <h2>
            {MEASURE_NAMES[measure.measure]}: <span class="figure">{measure.totalShown}</span>
          </h2>
          <TableFrame name={`${MEASURE_NAMES[measure.measure]} by stage`}>
            <table>
              <tbody>
                {measure.stages.map((stage) => (
                  <tr key={stage.stage}>
                    <td>{STAGE_NAMES[stage.stage]}</td>
                    <td class="figure">{stage.shown}</td>
                    <td class="figure">{stage.share}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        </section>
      ))}
      <p>
        <a class="cell-link" href={`/api/s/${token}/file`} download>
          Read the dossier
        </a>
      </p>
      {dossier.state === "signedOff" ? (
        <p class="state-word">
          Signed off by {dossier.signedOffBy} on {shownDate(dossier.signedOffAt as string)}
        </p>
      ) : (
        <form onSubmit={sign} noValidate>
          <Problems form={form} />
          <Field form={form} name="name" label="Your name" autoComplete="name" value={form.values.name} onValue={(value) => form.set("name", value)} />
          <div class="action-bar">
            <Button type="submit" green busy={form.busy}>
              Sign off
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}

export function SignOffEnded(): JSX.Element {
  return (
    <main class="one-column signoff">
      <Heading>{ANSWER_COPY.en.ended}</Heading>
    </main>
  );
}
