import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Reference } from "../../../shared/api";
import type { SizeUnit } from "../../../shared/sizes";
import { api, ApiError, encodeMultipart, isNetworkFailure, type Multipart } from "../api";
import { FieldError, Segmented } from "../controls";
import { COPY, useDeck } from "../deck";
import { useField, type Marker } from "../field";
import { useDocumentTitle } from "../hooks";
import {
  EMPTY_FACTS,
  ReferenceFields,
  errorsByControl,
  focusFirstInvalid,
  type Errors,
  type FactsValues,
} from "../reference-fields";
import { SwatchPicker } from "../swatch-picker";

const RESEND_ATTEMPTS = 3;
const RESEND_DELAY_MS = 800;

export const UNIT_OPTIONS = [
  { value: "mm", label: "mm" },
  { value: "in", label: "in" },
] as const;

interface Preview {
  url: string;
  aspect: number;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function postCapture(multipart: Multipart, key: string): Promise<Reference> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await api<Reference>("POST", "/references", { multipart, headers: { "Idempotency-Key": key } });
    } catch (error) {
      if (!isNetworkFailure(error) || attempt === RESEND_ATTEMPTS) throw error;
      await wait(RESEND_DELAY_MS);
    }
  }
}

export function CaptureScreen() {
  useDocumentTitle("Capture an object");
  const field = useField();
  const { say, unit: savedUnit } = useDeck();
  const [values, setValues] = useState<FactsValues>(EMPTY_FACTS);
  const [unitChoice, setUnitChoice] = useState<SizeUnit | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileInput, setFileInput] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [point, setPoint] = useState<Marker | null>(null);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [focusToken, setFocusToken] = useState(0);
  const sending = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const unit = unitChoice ?? savedUnit;

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    let current = true;
    const image = new Image();
    image.onload = () => {
      if (current) setPreview({ url, aspect: image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1 });
    };
    image.onerror = () => {
      if (current) setPreview({ url, aspect: 1 });
    };
    image.src = url;
    return () => {
      current = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!preview) {
      field.show(null);
      return;
    }
    field.show({
      key: "capture",
      name: values.title.trim() || "Chosen photograph",
      size: "",
      swatch: null,
      photo: preview.url,
      whole: { aspect: preview.aspect },
    });
  }, [field, preview, values.title]);

  useEffect(() => () => field.show(null), [field]);

  useEffect(() => {
    if (focusToken > 0) focusFirstInvalid(errors);
  }, [focusToken]);

  const change = (key: keyof FactsValues, value: string) => setValues((previous) => ({ ...previous, [key]: value }));

  const formFields = (): (readonly [string, string | File])[] => {
    const fields: (readonly [string, string | File])[] = [];
    if (file) fields.push(["photo", file]);
    for (const [key, value] of Object.entries(values)) if (value.trim() !== "") fields.push([key, value]);
    fields.push(["unit", unit]);
    if (point) fields.push(["swatch_x", String(point.x)], ["swatch_y", String(point.y)]);
    return fields;
  };

  const signature = () =>
    JSON.stringify([values, unit, point, file && [file.name, file.size, file.lastModified]]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setErrors({});
    say(COPY.capturePending);
    const current = signature();
    if (attempt.current?.signature !== current) attempt.current = { signature: current, key: crypto.randomUUID() };
    try {
      await postCapture(await encodeMultipart(formFields()), attempt.current.key);
      say(COPY.captureSaved);
      setValues(EMPTY_FACTS);
      setUnitChoice(null);
      setFile(null);
      setFileInput((previous) => previous + 1);
      setPoint(null);
      attempt.current = null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setErrors(errorsByControl(error.fields));
        setFocusToken((previous) => previous + 1);
        say(COPY.checkFields);
      } else if (error instanceof ApiError && error.code === "idempotency_in_flight") {
        say(COPY.captureInFlight);
        saveButton.current?.focus();
      } else if (error instanceof ApiError && error.status === 503) {
        say(COPY.storageRefused);
        saveButton.current?.focus();
      } else {
        say(COPY.generic);
      }
    } finally {
      sending.current = false;
      setPending(false);
    }
  };

  return (
    <>
      <h1>Capture an object</h1>
      <form className="capture-form" noValidate onSubmit={submit}>
        <div className="field-row">
          <div className="label-line">
            <label htmlFor="f-photo">Photograph</label>
          </div>
          <input
            key={fileInput}
            id="f-photo"
            type="file"
            accept="image/jpeg,image/png"
            aria-invalid={errors.photo ? true : undefined}
            aria-describedby={errors.photo ? "f-photo-error" : undefined}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPoint(null);
            }}
          />
          <FieldError id="f-photo" error={errors.photo} />
        </div>
        <SwatchPicker
          active={picking}
          onActiveChange={setPicking}
          onSample={setPoint}
          chosen={point}
          disabled={!preview}
          error={errors.swatch}
        />
        <ReferenceFields
          values={values}
          errors={errors}
          onChange={change}
          unit={unit}
          unitControl={
            <div className="field-row">
              <span className="label-line">
                Size unit
              </span>
              <Segmented label="Size unit" name="capture-unit" value={unit} options={UNIT_OPTIONS} onChange={setUnitChoice} firstId="f-unit" />
              <FieldError id="f-unit" error={errors.unit} />
            </div>
          }
        />
        <button ref={saveButton} type="submit" className="btn primary" aria-disabled={pending || undefined}>
          Save to deck
        </button>
      </form>
    </>
  );
}
