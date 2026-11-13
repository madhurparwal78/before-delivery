import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { Reel, ReelSummary, Reference } from "../../../shared/api";
import type { SizeUnit } from "../../../shared/sizes";
import { api, ApiError } from "../api";
import { FieldError, Segmented } from "../controls";
import { COPY, useDeck } from "../deck";
import { Dialog } from "../dialog";
import { useField } from "../field";
import { unitName, utcStamp } from "../format";
import { isTextEntry, useDocumentTitle } from "../hooks";
import {
  ReferenceFields,
  errorsByControl,
  factsOf,
  focusFirstInvalid,
  type Errors,
  type FactsValues,
} from "../reference-fields";
import { SwatchPicker } from "../swatch-picker";
import { UNIT_OPTIONS } from "./capture";
import { subjectOf } from "./library";

type Load = "loading" | "ready" | "missing";

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function textOrDash(value: string | number | null): string {
  return value === null || value === "" ? "—" : String(value);
}

export function FactsScreen() {
  const { id = "" } = useParams();
  const field = useField();
  const { say, unit, setUnit } = useDeck();
  const [reference, setReference] = useState<Reference | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<FactsValues | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [focusToken, setFocusToken] = useState(0);
  const [picking, setPicking] = useState(false);
  const [original, setOriginal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [reels, setReels] = useState<ReelSummary[]>([]);
  const [targetReel, setTargetReel] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);
  const refocusEdit = useRef(false);
  useDocumentTitle(reference?.title ?? "Reference");

  const reload = useCallback(async () => {
    try {
      setReference(await api<Reference>("GET", `/references/${id}`));
      setLoad("ready");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setLoad("missing");
      else say(COPY.generic);
    }
  }, [id, say]);

  useEffect(() => {
    setLoad("loading");
    setReference(null);
    setEditing(false);
    setPicking(false);
    void reload();
  }, [id, reload]);

  useEffect(() => {
    if (reference) {
      field.show({
        ...subjectOf(reference, unit),
        photo: picking ? reference.photo.original_url : reference.photo.display_url,
        srcSet: picking ? undefined : subjectOf(reference, unit).srcSet,
        ...(picking ? { whole: { aspect: reference.photo.width / reference.photo.height } } : {}),
      });
    } else {
      field.show(null, load === "missing" ? COPY.unknown : COPY.loading);
    }
  }, [field, reference, unit, picking, load]);

  useEffect(() => () => field.show(null), [field]);

  useEffect(() => {
    if (focusToken > 0) focusFirstInvalid(errors);
  }, [focusToken]);

  useEffect(() => {
    if (!editing && refocusEdit.current) {
      refocusEdit.current = false;
      editButton.current?.focus();
    }
  }, [editing, reference]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "o" || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTextEntry(event.target) || document.querySelector("dialog[open]") || !reference) return;
      event.preventDefault();
      setOriginal(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [reference]);

  if (load === "missing") {
    return (
      <>
        <h1>Reference not found</h1>
        <p className="muted">{COPY.unknown}</p>
      </>
    );
  }
  if (!reference) return <h1>Opening</h1>;

  const trashed = reference.state === "trashed";

  const startEditing = () => {
    setValues(factsOf(reference, unit));
    setErrors({});
    setEditing(true);
  };

  const saveFacts = async (event: FormEvent) => {
    event.preventDefault();
    if (!values) return;
    say(COPY.factsPending);
    setErrors({});
    try {
      const saved = await api<Reference>("PATCH", `/references/${reference.id}`, {
        json: {
          version: reference.version,
          unit,
          ...values,
          year: values.year.trim() === "" ? null : values.year,
          source_url: values.source_url.trim() === "" ? null : values.source_url,
        },
      });
      setReference(saved);
      setEditing(false);
      say(COPY.factsSaved);
    } catch (error) {
      if (error instanceof ApiError && error.code === "reference_version_conflict") {
        refocusEdit.current = true;
        setEditing(false);
        await reload();
        say(COPY.factsConflict);
      } else if (error instanceof ApiError && error.status === 422) {
        setErrors(errorsByControl(error.fields));
        setFocusToken((previous) => previous + 1);
        say(COPY.checkFields);
      } else {
        say(COPY.generic);
      }
    }
  };

  const changeUnit = (next: SizeUnit) => {
    setUnit(next);
    api("PUT", "/settings/unit", { json: { unit: next } }).then(
      () => say(`Sizes now show in ${unitName(next)}.`),
      () => say(COPY.generic),
    );
  };

  const swatchRequest = async (request: () => Promise<Reference>, done: string) => {
    say(COPY.measuring);
    try {
      setReference(await request());
      say(done);
    } catch (error) {
      say(error instanceof ApiError && error.status === 503 ? COPY.storageRefused : COPY.generic);
    }
  };

  const openAdd = async () => {
    setAdding(true);
    try {
      const listing = await api<{ reels: ReelSummary[] }>("GET", "/reels");
      setReels(listing.reels);
      setTargetReel((previous) => previous || listing.reels[0]?.id || "");
    } catch {
      say(COPY.generic);
    }
  };

  const addToReel = async () => {
    const reel = reels.find((candidate) => candidate.id === targetReel);
    setAdding(false);
    if (!reel) return;
    try {
      await api<Reel>("POST", `/reels/${reel.id}/stops`, { json: { reference_id: reference.id } });
      say(`Added to ${reel.name}.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "already_in_reel") say(`${reference.title} is already in ${reel.name}.`);
      else if (error instanceof ApiError && error.code === "reel_full") say(COPY.reelFull);
      else say(COPY.generic);
    }
  };

  const moveToTrash = async () => {
    setTrashing(false);
    try {
      setReference(await api<Reference>("DELETE", `/references/${reference.id}`));
      say(`Moved ${reference.title} to the trash.`);
    } catch {
      say(COPY.generic);
    }
  };

  return (
    <>
      <h1>{reference.title}</h1>
      {trashed && (
        <p className="muted">
          This reference is in the trash. <Link to="/trash">Open Trash</Link>
        </p>
      )}
      <div className="actions">
        {!trashed && !editing && (
          <button ref={editButton} type="button" className="btn primary" onClick={startEditing}>
            Edit facts
          </button>
        )}
        {!trashed && (
          <SwatchPicker
            active={picking}
            onActiveChange={setPicking}
            onSample={(point) =>
              swatchRequest(() => api<Reference>("POST", `/references/${reference.id}/swatch`, { json: point }), COPY.swatchSet)
            }
          />
        )}
        {!trashed && reference.swatch_source === "eyedropper" && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              void swatchRequest(() => api<Reference>("DELETE", `/references/${reference.id}/swatch`), COPY.swatchReset).then(() =>
                document.getElementById("f-swatch")?.focus(),
              );
            }}
          >
            Reset swatch
          </button>
        )}
        <button type="button" className="btn" onClick={() => setOriginal(true)}>
          View original (O)
        </button>
        {!trashed && (
          <button type="button" className="btn" onClick={() => void openAdd()}>
            Add to reel
          </button>
        )}
        {!trashed && (
          <button type="button" className="btn" onClick={() => setTrashing(true)}>
            Move to trash
          </button>
        )}
      </div>
      <section className="facts" aria-label="Facts">
        <div className="facts-unit">
          <Segmented label="Size unit" name="facts-unit" value={unit} options={UNIT_OPTIONS} onChange={changeUnit} />
        </div>
        {editing && values ? (
          <form className="facts-form" noValidate onSubmit={saveFacts}>
            <ReferenceFields
              values={values}
              errors={errors}
              unit={unit}
              onChange={(key, value) => setValues({ ...values, [key]: value })}
            />
            <FieldError id="f-version" error={errors.version} />
            <button type="submit" className="btn primary">
              Save facts
            </button>
          </form>
        ) : (
          <dl className="fact-list">
            <Fact term="Maker">{textOrDash(reference.maker)}</Fact>
            <Fact term="Year">{textOrDash(reference.year)}</Fact>
            <Fact term="Size">
              <span className="size-line">{reference.size_text[unit]}</span>
            </Fact>
            <Fact term="Materials">{textOrDash(reference.materials.join(", "))}</Fact>
            <Fact term="Finish">{textOrDash(reference.finish)}</Fact>
            <Fact term="Colour family">{reference.colour_family}</Fact>
            <Fact term="Swatch">
              <span className="chip" style={{ backgroundColor: reference.swatch }} aria-hidden="true" />
              {reference.swatch}, {reference.swatch_source === "eyedropper" ? "set with the eyedropper" : "measured from the photograph"}
            </Fact>
            <Fact term="Source">
              {reference.source_url ? (
                <a href={reference.source_url} rel="noopener noreferrer" target="_blank">
                  {reference.source_url}
                </a>
              ) : (
                "—"
              )}
            </Fact>
            <Fact term="Where found">{textOrDash(reference.source_note)}</Fact>
            <Fact term="Notes">{textOrDash(reference.notes)}</Fact>
            <Fact term="Captured">{utcStamp(reference.captured_at)}</Fact>
          </dl>
        )}
      </section>

      <Dialog open={original} label="Original photograph" onClose={() => setOriginal(false)}>
        <img className="original" src={reference.photo.original_url} alt={reference.title} />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setOriginal(false)}>
            Close
          </button>
        </div>
      </Dialog>

      <Dialog open={adding} label="Add to reel" onClose={() => setAdding(false)}>
        <p className="dialog-title">Add to reel</p>
        {reels.length === 0 ? (
          <p className="muted">There are no reels yet. Create one in Reels.</p>
        ) : (
          <div role="radiogroup" aria-label="Reel" className="radio-list">
            {reels.map((reel) => (
              <label key={reel.id} className="radio-row">
                <input type="radio" name="target-reel" checked={targetReel === reel.id} onChange={() => setTargetReel(reel.id)} />
                <span>{reel.name}</span>
              </label>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setAdding(false)}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void addToReel()}>
            Add
          </button>
        </div>
      </Dialog>

      <Dialog open={trashing} label="Move to trash?" initialFocus="[data-keep]" onClose={() => setTrashing(false)}>
        <p className="dialog-title">Move to trash?</p>
        <p>{reference.title} will be purged 30 days after it is trashed unless you restore it.</p>
        <div className="dialog-actions">
          <button type="button" className="btn" data-keep onClick={() => setTrashing(false)}>
            Keep it
          </button>
          <button type="button" className="btn primary" onClick={() => void moveToTrash()}>
            Move to trash
          </button>
        </div>
      </Dialog>
    </>
  );
}
