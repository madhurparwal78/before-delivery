// The profile editor (booker, director): profile form, portfolio reorder by keyboard or drag, upload and the
// lightbox. A save refused because the session ended keeps the typed values for after signing in again.

import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { api, type ApiErrorBody } from "../../../api.js";
import { definePage, useLocation } from "../../../router.js";
import { DRAFT_RESTORED_COPY, keepDraft, sessionCopy, takeDraft } from "../../../session.js";
import { Dialog } from "../../../ui/dialog.js";
import { Button } from "../../../ui/button.js";
import { RadioGroup, TextArea, TextField } from "../../../ui/fields.js";
import { Icon } from "../../../ui/icons.js";
import { Problems, useFormErrors } from "../../../ui/problems.js";
import { useAnnouncer } from "../../../ui/status.js";
import { cmToInches, feetAndInches, parseGirth, parseHeight } from "../../../../shared/measure.js";
import { LOADING, RecordsPage, useOfficeTime } from "./common.js";
import { failureCopy } from "../../../workspace/data.js";

interface PortfolioPhoto {
  photoId: string;
  url: string;
  width: number;
  height: number;
}

interface TalentRecord {
  id: string;
  slug: string;
  displayName: string;
  state: string;
  measurements: { heightCm: number | null; chestCm: number | null; waistCm: number | null; hipsCm: number | null };
  reach: { instagram: number | null; tiktok: number | null; youtube: number | null };
  officeNote: string | null;
  portfolio: PortfolioPhoto[];
  version: number;
  portfolioVersion: number;
}

type Unit = "cm" | "ft_in";
type Girth = "chest" | "waist" | "hips";
const GIRTHS: Girth[] = ["chest", "waist", "hips"];
const REACH = ["instagram", "tiktok", "youtube"] as const;

const FIELDS = {
  displayName: "profile-display-name",
  height: "profile-height",
  chest: "profile-chest",
  waist: "profile-waist",
  hips: "profile-hips",
  instagram: "profile-instagram",
  tiktok: "profile-tiktok",
  youtube: "profile-youtube",
  officeNote: "profile-office-note",
};

type Values = Record<keyof typeof FIELDS, string>;

const UNITS = [{ value: "cm", label: "cm" }, { value: "ft_in", label: "ft and in" }];

function shown(cm: number | null, girth: boolean, unit: Unit): string {
  if (cm === null) return "";
  if (unit === "cm") return String(cm);
  return girth ? String(cmToInches(cm)) : feetAndInches(cm);
}

function centimetres(typed: string, girth: boolean, unit: Unit): number | null {
  const value = typed.trim();
  if (!value) return null;
  if (girth) return parseGirth(unit === "cm" ? `${value} cm` : `${value} in`);
  return parseHeight(unit === "cm" ? `${value} cm` : value);
}

function valuesOf(talent: TalentRecord): Values {
  const { measurements, reach } = talent;
  return {
    displayName: talent.displayName,
    height: shown(measurements.heightCm, false, "cm"),
    chest: shown(measurements.chestCm, true, "cm"),
    waist: shown(measurements.waistCm, true, "cm"),
    hips: shown(measurements.hipsCm, true, "cm"),
    instagram: reach.instagram === null ? "" : String(reach.instagram),
    tiktok: reach.tiktok === null ? "" : String(reach.tiktok),
    youtube: reach.youtube === null ? "" : String(reach.youtube),
    officeNote: talent.officeNote ?? "",
  };
}

function count(typed: string): number | string | null {
  const value = typed.trim().replace(/,/g, "");
  if (!value) return null;
  return /^\d+$/.test(value) ? Number(value) : typed;
}

function ProfileForm({ talent, path, onSaved, announce }: {
  talent: TalentRecord;
  path: string;
  onSaved: (next: TalentRecord) => void;
  announce: (text: string) => void;
}) {
  const officeTime = useOfficeTime();
  const [values, setValues] = useState<Values>(() => valuesOf(talent));
  const [unit, setUnit] = useState<Unit>("cm");
  const [pending, setPending] = useState(false);
  const save = useRef<HTMLButtonElement>(null);
  const form = useFormErrors({ ...FIELDS, email: FIELDS.displayName });

  useEffect(() => {
    const kept = takeDraft(path);
    if (!kept) return;
    const { unit: keptUnit, ...rest } = kept.values;
    setValues((current) => ({ ...current, ...rest }));
    if (keptUnit === "cm" || keptUnit === "ft_in") setUnit(keptUnit);
    announce(DRAFT_RESTORED_COPY);
  }, [path, announce]);

  const set = (key: keyof Values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

  const switchUnit = (next: string) => {
    if (next !== "cm" && next !== "ft_in") return;
    setValues((current) => {
      const converted = { ...current };
      const height = centimetres(current.height, false, unit);
      if (height !== null) converted.height = shown(height, false, next);
      for (const girth of GIRTHS) {
        const cm = centimetres(current[girth], true, unit);
        if (cm !== null) converted[girth] = shown(cm, true, next);
      }
      return converted;
    });
    setUnit(next);
  };

  const refused = (error: ApiErrorBody) => {
    if (error.error === "stale_version" && typeof error.savedBy === "string" && typeof error.savedAt === "string") {
      announce(`${error.savedBy} saved a newer version at ${officeTime(error.savedAt)}. Your changes were not saved.`);
      return;
    }
    if (sessionCopy(error)) keepDraft({ path, values: { ...values, unit } });
    announce(failureCopy(error));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const measure = (key: "height" | Girth) => {
      const value = values[key].trim();
      const girthUnit = unit === "cm" ? "cm" : "in";
      return { value: value || null, unit: key === "height" ? unit : girthUnit };
    };
    setPending(true);
    const result = await api<TalentRecord>("PATCH", `/api/talent/${talent.id}`, {
      version: talent.version,
      displayName: values.displayName,
      measurements: { height: measure("height"), chest: measure("chest"), waist: measure("waist"), hips: measure("hips") },
      reach: Object.fromEntries(REACH.map((key) => [key, count(values[key])])),
      officeNote: values.officeNote,
    });
    setPending(false);
    requestAnimationFrame(() => save.current?.focus());
    if (result.ok) {
      form.clear();
      onSaved(result.data);
      announce("Profile saved.");
      return;
    }
    if (!form.take(result.error, announce)) refused(result.error);
  };

  const girthLabel = unit === "cm" ? "cm" : "in";
  return (
    <form aria-label="Profile" noValidate className="profile-form stack" onSubmit={(event) => void submit(event)}>
      <Problems items={form.problems} />
      <TextField id={FIELDS.displayName} label="Display name" value={values.displayName} onChange={set("displayName")}
        error={form.error("displayName")} />
      <RadioGroup id="profile-unit" label="Measurement unit" name="profile-unit" choices={UNITS} value={unit}
        onChange={switchUnit} />
      <div className="field-grid">
        <TextField id={FIELDS.height} label="Height" inputMode={unit === "cm" ? "numeric" : "text"} value={values.height}
          onChange={set("height")} error={form.error("height")} hint={unit === "cm" ? "In cm, like 178" : "Like 5 ft 10 in"} />
        <TextField id={FIELDS.chest} label="Chest" inputMode="numeric" value={values.chest} onChange={set("chest")}
          error={form.error("chest")} hint={`In ${girthLabel}`} />
        <TextField id={FIELDS.waist} label="Waist" inputMode="numeric" value={values.waist} onChange={set("waist")}
          error={form.error("waist")} hint={`In ${girthLabel}`} />
        <TextField id={FIELDS.hips} label="Hips" inputMode="numeric" value={values.hips} onChange={set("hips")}
          error={form.error("hips")} hint={`In ${girthLabel}`} />
      </div>
      <div className="field-grid">
        <TextField id={FIELDS.instagram} label="Instagram followers" inputMode="numeric" value={values.instagram}
          onChange={set("instagram")} error={form.error("instagram")} />
        <TextField id={FIELDS.tiktok} label="TikTok followers" inputMode="numeric" value={values.tiktok}
          onChange={set("tiktok")} error={form.error("tiktok")} />
        <TextField id={FIELDS.youtube} label="YouTube subscribers" inputMode="numeric" value={values.youtube}
          onChange={set("youtube")} error={form.error("youtube")} />
      </div>
      <TextArea id={FIELDS.officeNote} label="Office note" rows={3} value={values.officeNote} onChange={set("officeNote")}
        error={form.error("officeNote")} hint="Private to the agency; never shown on the public site." />
      <div className="btn-row">
        <Button ref={save} type="submit" pending={pending} pendingLabel="Saving profile…">Save profile</Button>
      </div>
    </form>
  );
}

type MoveButton = "earlier" | "later" | "open";

/** Keeps focus on the moved photo's button when the reorder (or a newly disabled button) dropped it. */
function focusPhotoButton(photoId: string, preferred: MoveButton): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && !(active instanceof HTMLButtonElement && active.disabled)) return;
    const pick = (action: MoveButton) =>
      document.querySelector<HTMLButtonElement>(`[data-photo="${photoId}"] [data-action="${action}"]:not(:disabled)`);
    (pick(preferred) ?? pick(preferred === "later" ? "earlier" : "later") ?? pick("open"))?.focus();
  });
}

function Lightbox({ photos, start, name, onClose }: {
  photos: PortfolioPhoto[];
  start: number;
  name: string;
  onClose: (shown: PortfolioPhoto) => void;
}) {
  const [index, setIndex] = useState(start);
  const swipe = useRef<number | null>(null);
  const step = (delta: number) => setIndex((current) => (current + delta + photos.length) % photos.length);
  const photo = photos[index];
  const latest = useRef(photo);
  latest.current = photo;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []); // the lightbox listens for arrows for as long as it is open

  const onPointerDown = (event: ReactPointerEvent) => {
    swipe.current = event.pointerType === "touch" ? event.clientX : null;
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    if (swipe.current === null) return;
    const dx = event.clientX - swipe.current;
    swipe.current = null;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
  };

  return (
    <Dialog title="Portfolio" wide onClose={() => onClose(latest.current)}
      returnFocus={() => document.querySelector<HTMLElement>(`[data-photo="${latest.current.photoId}"] [data-action="open"]`)}
      actions={<Button variant="quiet" onClick={() => onClose(latest.current)}>Close</Button>}>
      <figure className="lightbox-figure" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <img src={photo.url} alt={`${name}, photo ${index + 1} of ${photos.length}`} draggable={false} />
        <figcaption className="num">{index + 1} of {photos.length}</figcaption>
      </figure>
      <div className="btn-row lightbox-nav">
        <Button variant="quiet" onClick={() => step(-1)}><Icon name="chevron-left" />Previous photo</Button>
        <Button variant="quiet" onClick={() => step(1)}>Next photo<Icon name="chevron-right" /></Button>
      </div>
    </Dialog>
  );
}

interface Drag {
  photoId: string;
  pointerId: number;
  x: number;
  y: number;
  active: boolean;
  touch: boolean;
  timer: number;
  startOrder: string;
}

function Portfolio({ talent, announce, reload }: {
  talent: TalentRecord;
  announce: (text: string) => void;
  reload: () => Promise<TalentRecord | null>;
}) {
  const officeTime = useOfficeTime();
  const [order, setOrder] = useState(talent.portfolio);
  const [open, setOpen] = useState<number | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const version = useRef(talent.portfolioVersion);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const drag = useRef<Drag | null>(null);
  const latest = useRef(order);
  latest.current = order;
  const list = useRef<HTMLUListElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOrder(talent.portfolio);
    version.current = talent.portfolioVersion;
  }, [talent]);

  const commit = (next: PortfolioPhoto[], moved: string) => {
    queue.current = queue.current.then(async () => {
      const result = await api<{ portfolioVersion: number; photoIds: string[] }>("PUT", `/api/talent/${talent.id}/photos/order`,
        { portfolioVersion: version.current, photoIds: next.map((photo) => photo.photoId) });
      if (result.ok) {
        version.current = result.data.portfolioVersion;
        announce(`Moved photo to position ${next.findIndex((photo) => photo.photoId === moved) + 1} of ${next.length}.`);
        return;
      }
      const { error } = result;
      if (error.error === "stale_version" && typeof error.savedBy === "string" && typeof error.savedAt === "string") {
        const fresh = await reload();
        if (fresh) {
          setOrder(fresh.portfolio);
          version.current = fresh.portfolioVersion;
        }
        announce(`${error.savedBy} saved a newer order at ${officeTime(error.savedAt)}. The previous order is back.`);
        return;
      }
      announce(failureCopy(error));
    });
  };

  const move = (photoId: string, delta: number, button: MoveButton) => {
    const from = latest.current.findIndex((photo) => photo.photoId === photoId);
    const to = from + delta;
    if (to < 0 || to >= latest.current.length) return;
    const next = [...latest.current];
    next.splice(to, 0, ...next.splice(from, 1));
    setOrder(next);
    focusPhotoButton(photoId, button);
    commit(next, photoId);
  };

  useEffect(() => {
    const target = list.current;
    if (!target) return undefined;
    const holdScroll = (event: TouchEvent) => {
      if (drag.current?.active) event.preventDefault();
    };
    target.addEventListener("touchmove", holdScroll, { passive: false });
    return () => target.removeEventListener("touchmove", holdScroll);
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const distance = Math.hypot(event.clientX - current.x, event.clientY - current.y);
      if (!current.active) {
        if (current.touch) {
          if (distance > 8) {
            window.clearTimeout(current.timer);
            drag.current = null;
          }
          return;
        }
        if (distance < 4) return;
        current.active = true;
        setDragging(current.photoId);
      }
      const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-photo]");
      const overId = over?.dataset.photo;
      if (!overId || overId === current.photoId) return;
      const items = [...latest.current];
      const from = items.findIndex((photo) => photo.photoId === current.photoId);
      const to = items.findIndex((photo) => photo.photoId === overId);
      items.splice(to, 0, ...items.splice(from, 1));
      setOrder(items);
    };
    const onEnd = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || event.pointerId !== current.pointerId) return;
      window.clearTimeout(current.timer);
      drag.current = null;
      setDragging(null);
      if (current.active && latest.current.map((photo) => photo.photoId).join() !== current.startOrder) {
        commit(latest.current, current.photoId);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  });

  const startDrag = (event: ReactPointerEvent, photoId: string) => {
    if (event.button !== 0) return;
    const touch = event.pointerType === "touch";
    const state: Drag = { photoId, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false, touch,
      timer: 0, startOrder: latest.current.map((photo) => photo.photoId).join() };
    if (touch) {
      state.timer = window.setTimeout(() => {
        state.active = true;
        setDragging(photoId);
      }, 500);
    }
    drag.current = state;
  };

  const upload = async () => {
    const picked = file.current?.files?.[0];
    if (!picked) return;
    const data = new FormData();
    data.append("file", picked);
    setUploading(true);
    const result = await api<{ portfolioVersion: number }>("POST", `/api/talent/${talent.id}/photos`, data);
    setUploading(false);
    if (file.current) file.current.value = "";
    if (result.ok) {
      const fresh = await reload();
      if (fresh) {
        setOrder(fresh.portfolio);
        version.current = fresh.portfolioVersion;
      }
      announce("Photo added to the portfolio.");
      return;
    }
    if (result.status === 413) announce("That photo is larger than 12,000,000 bytes.");
    else announce(result.error.errors?.file ?? failureCopy(result.error));
  };

  const n = order.length;
  return (
    <section className="portfolio-editor" aria-labelledby="portfolio-title">
      <div className="section-head">
        <h2 id="portfolio-title">Portfolio</h2>
        <Button variant="quiet" pending={uploading} pendingLabel="Uploading photo…"
          onClick={() => file.current?.click()}>Upload photo</Button>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={() => void upload()} />
      </div>
      {n ? (
        <ul ref={list} aria-label="Portfolio" className="portfolio-editor-grid">
          {order.map((photo, i) => (
            <li key={photo.photoId} data-photo={photo.photoId} aria-label={`Photo ${i + 1} of ${n}`}
              className={dragging === photo.photoId ? "dragging" : undefined}>
              <div className="portfolio-drag" onPointerDown={(event) => startDrag(event, photo.photoId)}>
                <img src={photo.url} alt="" draggable={false} loading="lazy" />
                <span className="grip"><Icon name="grip-vertical" /></span>
              </div>
              <div className="portfolio-actions">
                <Button variant="quiet" data-action="earlier" disabled={i === 0}
                  onClick={() => move(photo.photoId, -1, "earlier")}>Move earlier</Button>
                <Button variant="quiet" data-action="later" disabled={i === n - 1}
                  onClick={() => move(photo.photoId, 1, "later")}>Move later</Button>
                <Button variant="quiet" data-action="open" onClick={() => setOpen(i)}>Open</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-panel">No photos yet. Upload the first photo to give this talent a cover on the boards.</p>
      )}
      {open !== null && n ? (
        <Lightbox photos={order} start={Math.min(open, n - 1)} name={talent.displayName}
          onClose={() => setOpen(null)} />
      ) : null}
    </section>
  );
}

function TalentEditor({ id }: { id: string }) {
  const { pathname, query } = useLocation();
  const path = pathname + (query.toString() ? `?${query.toString()}` : "");
  const [talent, setTalent] = useState<TalentRecord | null>(null);
  const [missing, setMissing] = useState(false);
  const { message, announce } = useAnnouncer();

  const reload = async () => {
    const result = await api<TalentRecord>("GET", `/api/talent/${id}`);
    if (result.ok) {
      setTalent(result.data);
      return result.data;
    }
    setMissing(true);
    return null;
  };

  useEffect(() => {
    void reload();
  }, [id]); // load the talent this address names

  return (
    <RecordsPage title={talent ? talent.displayName : "Talent profile"}
      lede={talent ? `Profile and portfolio · ${talent.slug}` : undefined} statusName="Profile" message={message}>
      {talent ? (
        <div className="editor-layout">
          <ProfileForm talent={talent} path={path} announce={announce} onSaved={setTalent} />
          <Portfolio talent={talent} announce={announce} reload={reload} />
        </div>
      ) : missing ? <p className="empty-panel">This talent is not on the roster.</p> : LOADING}
    </RecordsPage>
  );
}

definePage({
  pattern: "/workspace/talent/:id",
  kind: "workspace",
  roles: ["agency_director", "booker"],
  render: (match) => <TalentEditor key={match.params.id} id={match.params.id} />,
});
