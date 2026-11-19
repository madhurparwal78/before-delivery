import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { copy } from "../../../server/domain/copy.ts";
import { defaultPatternArea } from "../../../server/domain/placement.ts";
import { announce } from "../lib/announce.ts";
import { ApiFailure, get, post } from "../lib/api.ts";
import { Dialog, useDialog } from "../lib/dialog.tsx";
import { AsyncButton, type Choice, Field, type Form, Problems, SelectField, useForm } from "../lib/forms.tsx";
import { useLive } from "../lib/live.ts";
import { BackToPiece, Heading, Loading, MainAction, MintTile } from "../lib/screen.tsx";
import type { ScreenProps } from "../routes.tsx";

interface Display {
  material: string;
  labour: string;
  labourRate: string;
  subtotal: string;
  tax: string;
  total: string;
  milestones: string[];
  area: string | null;
}

interface Estimate {
  id?: string;
  version: number;
  state: "open" | "replaced" | "signedOff";
  materialCode: string | null;
  lot: string | null;
  patternAreaSqFt: string | null;
  hides: number | null;
  metres: string | null;
  labourHours: string;
  taxPercent: number;
  milestones: { percent: number; amountMinor: number }[];
  display: Display;
}

interface Material {
  code: string;
  name: string;
  unit: "sqFt" | "metre";
}

type Lot = { lot: string; hides: number; averageSqFt: string } | { lot: string; metres: string };

const STATE_NAMES = { open: "Open", replaced: "Replaced", signedOff: "Signed off" };
const SETTLE_MS = 640;
const PREVIEW_PAUSE_MS = 160;

function lotLabel(lot: Lot): string {
  if ("metres" in lot) return `${lot.lot}, ${lot.metres} m`;
  return `${lot.lot}, ${lot.hides === 1 ? "1 hide" : `${lot.hides} hides`} at ${lot.averageSqFt} sq ft`;
}

type Values = { materialCode: string; lot: string; patternAreaSqFt: string; metres: string; labourHours: string };

function requestBody(values: Values, unit: Material["unit"] | undefined): Record<string, string | null> {
  if (!values.materialCode) return { materialCode: null, lot: null, labourHours: values.labourHours };
  const amountKey = unit === "metre" ? "metres" : "patternAreaSqFt";
  return { materialCode: values.materialCode, lot: values.lot, [amountKey]: values[amountKey], labourHours: values.labourHours };
}

function valuesOf(estimate: Estimate | undefined): Values {
  return {
    materialCode: estimate?.materialCode ?? "",
    lot: estimate?.lot ?? "",
    patternAreaSqFt: estimate?.patternAreaSqFt ?? defaultPatternArea(),
    metres: estimate?.metres ?? "",
    labourHours: estimate?.labourHours ?? "",
  };
}

/** The lots of the chosen material; a choice replaced while its read is out never lands. */
function useLots(form: Form<Values>, open: boolean): Lot[] {
  const [lots, setLots] = useState<Lot[]>([]);
  const code = form.values.materialCode;
  useEffect(() => {
    setLots([]);
    if (!open || !code) return undefined;
    let current = true;
    get<{ lots: Lot[] }>(`/api/materials/${encodeURIComponent(code)}/lots`)
      .then((answer) => {
        if (!current) return;
        setLots(answer.lots);
        if (!answer.lots.some((lot) => lot.lot === form.values.lot)) form.set("lot", answer.lots[0]?.lot ?? "");
      })
      .catch((error: unknown) => {
        if (current && error instanceof ApiFailure) announce(error.message);
      });
    return () => {
      current = false;
    };
  }, [code, open]);
  return lots;
}

/** Totals in place on every input: the latest input wins over a late answer, and each settled change is announced once. */
function usePreview(id: string, form: Form<Values>, unit: Material["unit"] | undefined, open: boolean, savedTotal: string | undefined): Estimate | null {
  const [preview, setPreview] = useState<Estimate | null>(null);
  const turn = useRef(0);
  const spoken = useRef(savedTotal);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const key = JSON.stringify(requestBody(form.values, unit));

  useEffect(() => {
    if (!open) {
      setPreview(null);
      turn.current += 1;
      clearTimeout(settle.current);
      return undefined;
    }
    spoken.current ??= savedTotal;
    const mine = (turn.current += 1);
    clearTimeout(settle.current);
    const pause = setTimeout(() => {
      if (!form.values.labourHours.trim() || (form.values.materialCode && !form.values.lot)) return;
      post<{ estimate: Estimate }>(`/api/pieces/${id}/estimates/preview`, JSON.parse(key))
        .then(({ estimate }) => {
          if (mine !== turn.current) return;
          setPreview(estimate);
          settle.current = setTimeout(() => {
            if (mine !== turn.current || spoken.current === estimate.display.total) return;
            spoken.current = estimate.display.total;
            announce(copy("F-53", { total: estimate.display.total }));
          }, SETTLE_MS);
        })
        .catch(() => undefined);
    }, PREVIEW_PAUSE_MS);
    return () => clearTimeout(pause);
  }, [key, open]);

  useEffect(() => {
    if (!open) spoken.current = savedTotal;
  }, [savedTotal, open]);

  return preview;
}

interface DialogProps {
  id: string;
  control: ReturnType<typeof useDialog>;
  materials: Material[];
  open: Estimate | undefined;
  onPreview: (preview: Estimate | null) => void;
  onSaved: () => Promise<void>;
}

function EditDialog({ id, control, materials, open, onPreview, onSaved }: DialogProps): JSX.Element {
  const form = useForm<Values>(valuesOf(open), control);
  const openVersion = useRef<number | null>(null);
  const wasOpen = useRef(control.draft !== null);
  const unit = materials.find((material) => material.code === form.values.materialCode)?.unit;
  const lots = useLots(form, control.open);
  const preview = usePreview(id, form, unit, control.open, open?.display.total);

  useEffect(() => onPreview(preview), [preview]);

  // In the commit, not after paint: whatever is typed from the first moment must never be overwritten.
  useLayoutEffect(() => {
    if (control.open && !wasOpen.current) {
      form.replace(valuesOf(open));
      form.clear();
    }
    if (control.open) openVersion.current ??= open?.version ?? null;
    else openVersion.current = null;
    wasOpen.current = control.open;
  }, [control.open]);

  const materialChoices: Choice[] = [{ value: "", label: "None (frame only)" }, ...materials.map((material) => ({ value: material.code, label: `${material.name} ${material.code}` }))];

  return (
    <Dialog control={control} title="Edit estimate">
      <Problems form={form} firstField="materialCode" />
      <SelectField form={form} name="materialCode" label="Material" choices={materialChoices} />
      {form.values.materialCode ? <SelectField form={form} name="lot" label="Lot" choices={lots.length > 0 ? lots.map((lot) => ({ value: lot.lot, label: lotLabel(lot) })) : [{ value: form.values.lot, label: copy("F-99") }]} /> : null}
      {form.values.materialCode && unit === "sqFt" ? <Field form={form} name="patternAreaSqFt" label="Pattern area in sq ft" inputMode="decimal" /> : null}
      {form.values.materialCode && unit === "metre" ? <Field form={form} name="metres" label="Metres" inputMode="decimal" /> : null}
      <Field form={form} name="labourHours" label="Labour hours" inputMode="decimal" />
      <p class="estimate-preview">
        <span>Total</span>
        <span>{preview?.display.total ?? open?.display.total}</span>
      </p>
      <AsyncButton
        label="Save estimate"
        primary
        onPress={async () => {
          const body = { ...requestBody(form.values, unit), ...(openVersion.current === null ? {} : { openVersion: openVersion.current }) };
          let staleAnswer = false;
          const saved = await form.submit(async () => {
            try {
              await post(`/api/pieces/${id}/estimates`, body);
            } catch (error) {
              staleAnswer = error instanceof ApiFailure && error.status === 412;
              throw error;
            }
          });
          if (staleAnswer) openVersion.current = null;
          if (!saved) return;
          await onSaved();
          control.done();
          announce(copy("F-54"));
        }}
      />
    </Dialog>
  );
}

function Lines({ estimate, materialName }: { estimate: Estimate; materialName: string | null }): JSX.Element {
  const { display } = estimate;
  return (
    <section class="tile t-large estimate-lines" aria-label="Estimate lines">
      <h2>Lines</h2>
      <dl class="facts">
        {estimate.materialCode ? (
          <>
            <dt>Material</dt>
            <dd>
              {materialName ?? estimate.materialCode} {estimate.materialCode}, lot {estimate.lot}
            </dd>
            <dt>{estimate.metres === null ? "Pattern area" : "Metres"}</dt>
            <dd>{estimate.metres === null ? `${display.area ?? ""}, ${estimate.hides === 1 ? "1 hide" : `${estimate.hides} hides`}` : `${estimate.metres} m`}</dd>
            <dt>Material line</dt>
            <dd>{display.material}</dd>
          </>
        ) : null}
        <dt>Labour</dt>
        <dd>
          {estimate.labourHours} hours at {display.labourRate}: {display.labour}
        </dd>
        <dt>Subtotal</dt>
        <dd>{display.subtotal}</dd>
        <dt>Tax at {estimate.taxPercent}%</dt>
        <dd>{display.tax}</dd>
        <dt>Total</dt>
        <dd>{display.total}</dd>
      </dl>
      <div>
        <h3>Milestones</h3>
        <ol class="milestones">
          {estimate.milestones.map((milestone, index) => (
            <li key={milestone.percent + index * 100}>
              <span class="muted">{milestone.percent}%</span>
              <br />
              {display.milestones[index]}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function EstimateScreen({ id }: ScreenProps): JSX.Element {
  const piece = useLive(() => get<{ piece: { title: string } }>(`/api/pieces/${id}`), [id]);
  const estimates = useLive(() => get<{ estimates: Estimate[] }>(`/api/pieces/${id}/estimates`), [id]);
  const materials = useLive(() => get<{ materials: Material[] }>("/api/materials"), []);
  const edit = useDialog("Edit estimate");
  const [preview, setPreview] = useState<Estimate | null>(null);

  const list = estimates.data?.estimates;
  const open = list?.find((estimate) => estimate.state === "open");
  const latest = open ?? list?.find((estimate) => estimate.state === "signedOff") ?? list?.[0];
  const shown = preview ?? latest;
  const shownName = materials.data?.materials.find((material) => material.code === shown?.materialCode)?.name ?? null;
  const title = piece.data?.piece.title;
  const earlier = list?.filter((estimate) => estimate !== latest) ?? [];

  // The heading and the lines arrive together: a heading landing above shown tiles would push them down.
  if (title === undefined || list === undefined) {
    return (
      <div key="wait" class="bento">
        <Loading size="t-large" height={360} />
        <Loading size="t-medium" height={360} />
      </div>
    );
  }

  return (
    <>
      <BackToPiece id={id} />
      <Heading text={`Estimate for ${title}`}>
        <MainAction>
          <button type="button" class="button button--primary" onClick={(event) => edit.show(event.currentTarget)}>
            Edit estimate
          </button>
        </MainAction>
      </Heading>
      <div class="bento">
        {shown ? (
          <Lines estimate={shown} materialName={shownName} />
        ) : (
          <section class="tile t-large" aria-label="Estimate lines">
            <p>No estimate yet.</p>
          </section>
        )}
        <MintTile label="Total" figure={shown?.display.total ?? "No estimate yet."} size="t-medium estimate-mint" part="estimate-total" />
        {earlier.length > 0 ? (
          <section class="tile t-full" aria-label="Earlier estimates">
            <h2>Earlier estimates</h2>
            <ul class="estimate-earlier">
              {earlier.map((estimate) => (
                <li key={estimate.version}>
                  <span>Estimate {estimate.version}</span>
                  <span>{STATE_NAMES[estimate.state]}</span>
                  <span>{estimate.display.labourRate} an hour</span>
                  <span>{estimate.display.total}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {materials.data ? <EditDialog id={id} control={edit} materials={materials.data.materials} open={open} onPreview={setPreview} onSaved={estimates.reload} /> : null}
    </>
  );
}
