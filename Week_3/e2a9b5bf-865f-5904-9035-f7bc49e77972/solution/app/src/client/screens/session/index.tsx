import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { COPY, CONCENTRATION_CLASSES } from "../../../shared/messages";
import { apertureLabel, deriveFor, swapSentence, TRAINS } from "../../../shared/optics";
import { clampToField } from "../../../shared/projection";
import { localClock, offsetAt, parseUtText, utText, parseUtc } from "../../../shared/time";
import type { Observation, Optics, Session, StrokeFile } from "../../../shared/types";
import { parseStrokeFile, serialiseStrokeFile } from "../../../shared/stroke";
import { FieldController } from "../../field/swap";
import type { CompassParts } from "../../field/compass";
import { Sketch } from "../../field/sketch";
import { uuid } from "../../lib/ids";
import { navigate } from "../../lib/router";
import { useSelect } from "../../lib/store";
import {
  nowIso,
  observationCreate,
  observationDelete,
  observationUpdate,
  queueChanges,
  sessionOptics,
  sketchPut,
  type Queued,
} from "../../state/changes";
import { deleteDraft, readDraft, writeDraft, type Draft, type FormValues } from "../../state/drafts";
import { useEffective, objectOf } from "../../state/lookup";
import { app, isOffline } from "../../state/model";
import { refreshSession, refreshStroke } from "../../state/refresh";
import { awaitOutcomes, canSendNow, requestSync, syncEvents } from "../../state/sync";
import { DeleteDialog, type DeleteTarget } from "../../ui/delete-dialog";
import { useDialog } from "../../ui/dialog";
import { FieldShell } from "../../ui/form";
import { connection, NotFoundScreen, Skeleton, WorkingScreen } from "../../ui/layout";
import { checkForm } from "../session-validate";
import { createFrameStore, FieldRegion, type FieldModel } from "./field-region";

const carried: { status: string } = { status: "" };
const justCreated = new Map<string, { draft: Draft }>();

function blankValues(objectId: string): FormValues {
  return { object_id: objectId, ut: "", seeing: "", nelm: "", concentration: "", description: "" };
}

function valuesOf(obs: Observation): FormValues {
  const when = obs.observed_at ? parseUtc(obs.observed_at) : null;
  return {
    object_id: obs.object_id,
    ut: when ? utText(when) : "",
    seeing: obs.seeing === null ? "" : String(obs.seeing),
    nelm: obs.transparency_nelm === null ? "" : obs.transparency_nelm.toFixed(1),
    concentration: obs.concentration_class ?? "",
    description: obs.description,
  };
}

function canonicalText(text: string | undefined): string {
  const file = text ? parseStrokeFile(text) : null;
  return serialiseStrokeFile(file ?? { format: "lowlamp-strokes/1", strokes: [], stars: [] });
}

export function SessionScreen({ sessionId, observationId }: { sessionId: string; observationId: string | null }) {
  const eff = useEffective();
  const offline = useSelect(app, (s) => isOffline(s));
  const kit = useSelect(app, (s) => s.server.kit);
  const objects = useSelect(app, (s) => s.server.objects);
  const [missing, setMissing] = useState(false);
  const [resets, setResets] = useState(0);
  const session = eff.sessions[sessionId];
  const observation = observationId ? eff.observations[observationId] : undefined;
  const wrong = observation && observation.session_id !== sessionId;

  const seen = useRef(new Set<string>());
  if (observationId && observation) seen.current.add(observationId);
  useLayoutEffect(() => {
    setMissing(false);
    if (session && (!observationId || observation)) return;
    if (observationId && seen.current.has(observationId)) return;
    void refreshSession(sessionId).then((status) => {
      if (status === 404) setMissing(true);
      else if (status === 200 && observationId && !app.get().server.observations[observationId]) setMissing(true);
    });
  }, [sessionId, observationId, Boolean(session), Boolean(observation)]);

  const unheld = !session || (observationId !== null && !observation);
  useLayoutEffect(() => {
    connection.set({ notHere: unheld && offline });
    return () => connection.set({ notHere: false });
  }, [unheld, offline]);

  useLayoutEffect(
    () =>
      syncEvents.on((event) => {
        if (event.t === "rejected-create" && event.observationId === observationId) {
          const kept = justCreated.get(event.observationId);
          const account = app.get().account?.id;
          if (kept && account) writeDraft(account, sessionId, null, { ...kept.draft, newId: uuid() });
          justCreated.delete(event.observationId);
          navigate(`/sessions/${sessionId}`, { replace: true });
          setResets((n) => n + 1);
        } else if (event.t === "gone" && event.observationId === observationId) {
          navigate(`/sessions/${sessionId}`, { replace: true });
          setResets((n) => n + 1);
        }
      }),
    [observationId, sessionId],
  );

  if (missing || wrong) return <NotFoundScreen />;
  if (unheld || !kit || !objects) {
    return (
      <WorkingScreen heading="Session">
        {offline ? null : <Skeleton rows={4} />}
      </WorkingScreen>
    );
  }
  return (
    <Workspace
      key={`${observationId ?? "new"}:${resets}`}
      session={session}
      observation={observation ?? null}
      resetNew={() => {
        navigate(`/sessions/${sessionId}`);
        setResets((n) => n + 1);
      }}
    />
  );
}

interface WorkspaceProps {
  session: Session;
  observation: Observation | null;
  resetNew(): void;
}

function Workspace({ session, observation, resetNew }: WorkspaceProps) {
  const account = useSelect(app, (s) => s.account)!;
  const kit = useSelect(app, (s) => s.server.kit)!;
  const objects = useSelect(app, (s) => s.server.objects)!;
  const eff = useEffective();
  const sessionId = session.id;
  const obsId = observation?.id ?? null;

  const draftOnOpen = useMemo(() => readDraft(account.id, sessionId, obsId), []);
  const newId = useRef(draftOnOpen?.newId ?? uuid());
  const sketch = useRef<Sketch>(null as unknown as Sketch);
  if (!sketch.current) sketch.current = new Sketch();
  const frames = useMemo(createFrameStore, []);
  const painter = useRef<(() => void) | null>(null);
  const compassParts = useRef<CompassParts>({ north: null, east: null, northLabel: null, eastLabel: null });
  const blocked = useRef(new Set<number>());
  const contact = useRef<{ end(): void } | null>(null);

  const subjectOptics: Optics = observation ? observation.optics : session.optics;
  const subjectDerived = observation ? observation.derived : session.derived;
  const [announcement, setAnnouncement] = useState("");
  const [compassSentence, setCompassSentence] = useState(subjectDerived.orientation.sentence);
  const [saveStatus, setSaveStatus] = useState(draftOnOpen ? COPY.restored : carried.status);
  carried.status = "";
  const [values, setValues] = useState<FormValues>(() => draftOnOpen?.values ?? (observation ? valuesOf(observation) : blankValues(objects[0]?.id ?? "m2")));
  const dirty = useRef(new Set<string>(draftOnOpen?.dirty ?? []));
  const editedAt = useRef<Record<string, string>>(draftOnOpen?.editedAt ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, tick] = useState(0);
  const alertBox = useRef<HTMLDivElement>(null);
  const [strokeState, setStrokeState] = useState<"ok" | "unreadable">("ok");

  const kindOf = (objectId: string) => objectOf(objects, objectId)?.kind ?? null;
  const kind = kindOf(values.object_id);

  const sayRef = useRef((text: string) => setAnnouncement(text));
  const opticsRef = useRef(subjectOptics);
  const targetKey = useRef(JSON.stringify(subjectOptics));
  const controller = useRef<FieldController>(null as unknown as FieldController);
  if (!controller.current) {
    controller.current = new FieldController(
      subjectDerived,
      (frame) => {
        frames.set({ frame: frame.active ? frame : null });
        painter.current?.();
      },
      (derived, announce) => {
        setCompassSentence(derived.orientation.sentence);
        if (announce) sayRef.current(swapSentence(derived));
      },
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  }
  useLayoutEffect(() => () => controller.current.dispose(), []);

  // The optics on screen follow the device copy unless a local pick is already showing them.
  const optKey = JSON.stringify(subjectOptics);
  useLayoutEffect(() => {
    if (optKey === targetKey.current) return;
    targetKey.current = optKey;
    opticsRef.current = subjectOptics;
    controller.current.reset(subjectDerived);
    setCompassSentence(subjectDerived.orientation.sentence);
    sketch.current.cursor = clampToField(sketch.current.cursor, subjectDerived.true_field_arcmin);
  }, [optKey]);

  // Stroke file: load it, or say plainly that it cannot be read.
  const strokeText = obsId ? eff.strokes[obsId] : undefined;
  const loadedText = useRef<string | null>(null);
  useLayoutEffect(() => {
    const s = sketch.current;
    if (draftOnOpen && loadedText.current === null) {
      s.restore(draftOnOpen.sketch);
      s.mode = draftOnOpen.mode;
      s.width = draftOnOpen.width;
      s.brightness = draftOnOpen.brightness;
      loadedText.current = canonicalText(strokeText);
      return;
    }
    if (!obsId || !observation?.sketch) {
      if (loadedText.current === null) {
        s.load(null, observation?.pair ?? null);
        loadedText.current = canonicalText(undefined);
      }
      return;
    }
    if (strokeText === undefined) {
      void refreshStroke(obsId).then((result) => {
        if (result === "unavailable" || result === "offline") {
          s.locked = true;
          setStrokeState("unreadable");
          setAnnouncement(COPY.sketchUnreadable);
          s.load(null, observation?.pair ?? null);
        }
      });
      return;
    }
    const canonical = canonicalText(strokeText);
    const unsaved = loadedText.current !== null && s.text() !== loadedText.current;
    if (loadedText.current === canonical || unsaved) return;
    const file: StrokeFile | null = parseStrokeFile(strokeText);
    const cursor = s.cursor;
    s.locked = false;
    setStrokeState("ok");
    s.load(file, observation.pair);
    s.cursor = loadedText.current === null ? [0, 0] : cursor;
    loadedText.current = canonical;
    s.setCursor(s.cursor);
  }, [strokeText, obsId, Boolean(observation?.sketch)]);

  // Unsaved work is kept on the device at every change.
  const snapshotDirty = () => {
    const s = sketch.current;
    const text = s.text();
    const baseline = loadedText.current ?? canonicalText(undefined);
    const marksChanged = text !== baseline || pairKey() !== (observation?.pair ? JSON.stringify([observation.pair.primary, observation.pair.secondary]) : "");
    return dirty.current.size > 0 || marksChanged;
  };
  const pairKey = () => {
    const p = sketch.current.pair();
    return p ? JSON.stringify(p) : "";
  };
  const persist = () => {
    const s = sketch.current;
    if (!snapshotDirty()) return deleteDraft(account.id, sessionId, obsId);
    writeDraft(account.id, sessionId, obsId, {
      values,
      dirty: [...dirty.current],
      editedAt: editedAt.current,
      sketch: s.snapshot(),
      mode: s.mode,
      width: s.width,
      brightness: s.brightness,
      newId: obsId ? null : newId.current,
    });
  };
  useLayoutEffect(() => {
    persist();
  }, [values, sketch.current.version]);
  useLayoutEffect(() => sketch.current.subscribe(() => tick((n) => n + 1)), []);

  // The device copy replaces every field the observer has not typed in.
  useLayoutEffect(() => {
    if (!observation) return;
    const fresh = valuesOf(observation);
    setValues((current) => {
      const next = { ...current };
      for (const key of Object.keys(fresh) as (keyof FormValues)[]) if (!dirty.current.has(key)) next[key] = fresh[key];
      return next;
    });
  }, [observation]);

  const say = (text: string) => setAnnouncement(text);
  sayRef.current = say;

  const setField = (name: keyof FormValues, value: string) => {
    dirty.current.add(name);
    editedAt.current[name] = nowIso();
    setValues((v) => {
      const next = { ...v, [name]: value };
      if (name === "object_id") {
        const nextKind = kindOf(value);
        if (nextKind !== "globular") next.concentration = "";
        if (nextKind !== "double_star") {
          if (sketch.current.mode === "measure") sketch.current.setMode("pencil");
          if (sketch.current.pairMarks.length > 0) {
            sketch.current.pairMarks = [];
          }
        }
      }
      return next;
    });
  };

  const stepOptics = (partial: Partial<Optics>) => {
    const next: Optics = { ...opticsRef.current, ...partial };
    const derived = deriveFor(next, kit);
    if (!derived) return;
    opticsRef.current = next;
    targetKey.current = JSON.stringify(next);
    contact.current?.end();
    const s = sketch.current;
    const clamped = clampToField(s.cursor, derived.true_field_arcmin);
    if (clamped !== s.cursor) s.setCursor(clamped);
    controller.current.start(derived);
    const items: Queued[] = [
      {
        change: sessionOptics(sessionId, next),
        meta: { designation: null, date: session.evening_date, observationId: null, sessionId },
      },
    ];
    if (observation) {
      items.push({
        change: observationUpdate(observation.id, observation.version, nowIso(), { optics: next }),
        meta: { designation: observation.designation, date: observation.evening_date, observationId: observation.id, sessionId },
      });
    }
    void queueChanges(items, canSendNow() ? "save" : "queue").then(() => requestSync());
  };

  const stepEyepiece = (delta: number) => {
    const eyepieces = kit.eyepieces;
    const at = eyepieces.findIndex((e) => e.id === opticsRef.current.eyepiece_id);
    const to = eyepieces[at + delta];
    if (at < 0 || !to) return say(delta > 0 ? COPY.noShorter : COPY.noLonger);
    stepOptics({ eyepiece_id: to.id });
  };

  const model: FieldModel = {
    sketch: sketch.current,
    controller: controller.current,
    frames,
    painter,
    compassParts,
    derived: subjectDerived,
    compassSentence,
    announcement,
    say,
    pick: stepOptics,
    stepEyepiece,
    kind,
    locked: strokeState === "unreadable",
    landed: () => controller.current.finish(),
    blocked,
    contact,
  };

  // ---- saving ----
  const baseline = observation ? valuesOf(observation) : null;
  const save = async () => {
    const s = sketch.current;
    const objectKind = kindOf(values.object_id);
    const checked = checkForm(values, objectKind, session.started_at, s.pairMarks.length === 2);
    const keys = Object.keys(checked.errors);
    if (keys.length > 0) {
      setErrors(checked.errors as Record<string, string>);
      setSaveStatus("");
      requestAnimationFrame(() => alertBox.current?.focus());
      alertBox.current?.focus();
      return;
    }
    setErrors({});
    const object = objectOf(objects, values.object_id)!;
    const stamp = (names: string[]) => names.map((n) => editedAt.current[n]).filter(Boolean).sort().pop() ?? nowIso();
    const pair = s.pair();
    const items: Queued[] = [];
    const meta = { designation: object.designation, date: session.evening_date, observationId: obsId ?? newId.current, sessionId };
    const text = s.text();
    const savedSketch = canonicalText(obsId ? eff.strokes[obsId] : undefined);
    if (!obsId) {
      const fields: Record<string, unknown> = {};
      if (checked.observedAt) fields.observed_at = checked.observedAt;
      if (checked.seeing !== null) fields.seeing = checked.seeing;
      if (checked.transparency !== null) fields.transparency_nelm = checked.transparency;
      if (values.concentration) fields.concentration_class = values.concentration;
      if (values.description.trim()) fields.description = values.description.trim();
      if (pair) fields.pair = { primary: pair[0], secondary: pair[1] };
      const when = stamp(Object.keys(fields).map((k) => (k === "transparency_nelm" ? "nelm" : k === "observed_at" ? "ut" : k === "concentration_class" ? "concentration" : k)));
      items.push({ change: observationCreate(newId.current, sessionId, object.id, when, fields), meta });
      if (!s.empty) items.push({ change: sketchPut(newId.current, 1, nowIso(), text), meta });
    } else if (observation && baseline) {
      const fields: Record<string, unknown> = {};
      const names: string[] = [];
      if (values.ut !== baseline.ut) {
        fields.observed_at = checked.observedAt;
        names.push("ut");
      }
      if (values.seeing !== baseline.seeing) {
        fields.seeing = checked.seeing;
        names.push("seeing");
      }
      if (values.nelm !== baseline.nelm) {
        fields.transparency_nelm = checked.transparency;
        names.push("nelm");
      }
      if (values.concentration !== baseline.concentration) {
        fields.concentration_class = values.concentration || null;
        names.push("concentration");
      }
      if (values.description.trim() !== baseline.description.trim()) {
        fields.description = values.description.trim();
        names.push("description");
      }
      const wasPair = observation.pair ? JSON.stringify([observation.pair.primary, observation.pair.secondary]) : "";
      if (pairKey() !== wasPair && (pair || wasPair)) {
        fields.pair = pair ? { primary: pair[0], secondary: pair[1] } : null;
        names.push("pair");
      }
      if (Object.keys(fields).length > 0) {
        items.push({ change: observationUpdate(observation.id, observation.version, stamp(names), fields), meta });
      }
      if (text !== savedSketch) items.push({ change: sketchPut(observation.id, observation.version, nowIso(), text), meta });
    }
    if (items.length === 0) {
      deleteDraft(account.id, sessionId, obsId);
      dirty.current.clear();
      return setSaveStatus(COPY.saved(object.designation));
    }
    const online = canSendNow();
    setSaveStatus(online ? COPY.saving(object.designation) : "");
    const isNew = !obsId;
    if (isNew) {
      justCreated.set(newId.current, {
        draft: {
          values,
          dirty: [...dirty.current],
          editedAt: editedAt.current,
          sketch: s.snapshot(),
          mode: s.mode,
          width: s.width,
          brightness: s.brightness,
          newId: null,
        },
      });
    }
    deleteDraft(account.id, sessionId, obsId);
    dirty.current.clear();
    loadedText.current = canonicalText(text);
    await queueChanges(items, online ? "save" : "queue");
    const ops = items.map((i) => i.change.client_op_id);
    let sentence: string;
    if (!online) sentence = COPY.savedOffline(object.designation);
    else {
      const outcomes = await awaitOutcomes(ops);
      const list = Object.values(outcomes);
      if (isNew && list.includes("rejected") && !eff.observations[newId.current]) {
        justCreated.delete(newId.current);
        newId.current = uuid();
        for (const name of Object.keys(values)) dirty.current.add(name);
        loadedText.current = canonicalText(undefined);
        setValues({ ...values });
        return setSaveStatus("");
      }
      sentence = list.includes("storage")
        ? COPY.storageSketch
        : list.includes("rejected")
          ? ""
          : list.includes("waiting")
            ? COPY.savedOffline(object.designation)
            : COPY.saved(object.designation);
    }
    if (isNew) {
      carried.status = sentence;
      navigate(`/sessions/${sessionId}?observation=${newId.current}`, { replace: true });
    } else {
      setSaveStatus(sentence);
    }
  };

  const localTime = (() => {
    const when = parseUtText(values.ut);
    return when ? COPY.localTime(localClock(when, session.site.time_zone), offsetAt(when, session.site.time_zone)) : "";
  })();

  // ---- the session's observation list ----
  const rows = Object.values(eff.observations)
    .filter((o) => o.session_id === sessionId)
    .sort((a, b) => (a.observed_at ?? "9") < (b.observed_at ?? "9") ? -1 : (a.observed_at ?? "9") > (b.observed_at ?? "9") ? 1 : a.id < b.id ? -1 : 1);
  const del = useDialog();
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const confirmDelete = (picked: DeleteTarget) => {
    const at = rows.findIndex((r) => r.id === picked.id);
    const obs = rows[at];
    const neighbour = rows[at + 1] ?? rows[at - 1];
    del.close(false);
    const items = [...(list.current?.querySelectorAll("li") ?? [])];
    const next = neighbour ? items[rows.indexOf(neighbour)]?.querySelector<HTMLElement>("button") : null;
    (next ?? document.getElementById("new-observation"))?.focus();
    if (!obs) return;
    deleteDraft(account.id, sessionId, obs.id);
    if (obs.id === obsId) navigate(`/sessions/${sessionId}`, { replace: true });
    void queueChanges(
      [
        {
          change: observationDelete(obs.id, obs.version),
          meta: { designation: obs.designation, date: obs.evening_date, observationId: obs.id, sessionId },
        },
      ],
      "save",
    ).then(() => requestSync());
  };

  const fieldId = (name: string) => `obs-${name}`;
  const errorFor = (key: string) => errors[key];
  const errorItems = Object.entries(errors);
  const idOf: Record<string, string> = {
    object_id: fieldId("object"),
    observed_at: fieldId("ut"),
    seeing: fieldId("seeing"),
    transparency_nelm: fieldId("nelm"),
    description: fieldId("description"),
    concentration_class: fieldId("class"),
    pair: "obs-field",
  };

  return (
    <WorkingScreen heading={`Session ${session.evening_date} · ${session.site.name}`} className="session">
      <FieldRegion model={model} />
      <div
        class="pickers"
        onFocusIn={() => {
          if (window.matchMedia("(orientation: landscape) and (max-height: 500px)").matches) {
            document.querySelector(".eyepiece")?.scrollIntoView({ block: "nearest", behavior: "instant" });
          }
        }}
      >
        <FieldShell label="Telescope" id="pick-telescope">
          <select id="pick-telescope" value={subjectOptics.telescope_id} onChange={(e) => stepOptics({ telescope_id: (e.target as HTMLSelectElement).value })}>
            {kit.telescopes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Eyepiece" id="pick-eyepiece">
          <select id="pick-eyepiece" value={subjectOptics.eyepiece_id} onChange={(e) => stepOptics({ eyepiece_id: (e.target as HTMLSelectElement).value })}>
            {kit.eyepieces.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Barlow" id="pick-barlow">
          <select
            id="pick-barlow"
            value={subjectOptics.barlow_id ?? ""}
            onChange={(e) => stepOptics({ barlow_id: (e.target as HTMLSelectElement).value || null })}
          >
            <option value="">No Barlow</option>
            {kit.barlows.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Train" id="pick-train">
          <select id="pick-train" value={subjectOptics.train} onChange={(e) => stepOptics({ train: (e.target as HTMLSelectElement).value as Optics["train"] })}>
            {TRAINS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </FieldShell>
      </div>

      <form
        class="obs-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <FieldShell label="Object" id={fieldId("object")} error={errorFor("object_id")}>
          <select id={fieldId("object")} value={values.object_id} onChange={(e) => setField("object_id", (e.target as HTMLSelectElement).value)}>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.designation}
              </option>
            ))}
          </select>
        </FieldShell>
        <div class="ut-row">
          <FieldShell label="UT date and time" id={fieldId("ut")} error={errorFor("observed_at")}>
            <input
              id={fieldId("ut")}
              type="text"
              placeholder="YYYY-MM-DD HH:MM"
              autocomplete="off"
              value={values.ut}
              onInput={(e) => setField("ut", (e.target as HTMLInputElement).value)}
            />
          </FieldShell>
          <div role="status" aria-label="Local time" class="local-time">
            {localTime || null}
          </div>
        </div>
        <div class="seeing-row">
          <FieldShell label="Seeing (1–10)" id={fieldId("seeing")} error={errorFor("seeing")}>
            <input
              id={fieldId("seeing")}
              type="number"
              step="1"
              inputMode="numeric"
              value={values.seeing}
              onInput={(e) => setField("seeing", (e.target as HTMLInputElement).value)}
            />
          </FieldShell>
          <FieldShell label="Transparency (limiting magnitude)" id={fieldId("nelm")} error={errorFor("transparency_nelm")}>
            <input
              id={fieldId("nelm")}
              type="text"
              inputMode="decimal"
              autocomplete="off"
              value={values.nelm}
              onInput={(e) => setField("nelm", (e.target as HTMLInputElement).value)}
            />
          </FieldShell>
        </div>
        {kind === "globular" ? (
          <FieldShell label="Concentration class" id={fieldId("class")} error={errorFor("concentration_class")}>
            <select id={fieldId("class")} value={values.concentration} onChange={(e) => setField("concentration", (e.target as HTMLSelectElement).value)}>
              <option value="">Not recorded</option>
              {CONCENTRATION_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FieldShell>
        ) : null}
        <FieldShell label="Description" id={fieldId("description")} error={errorFor("description")}>
          <textarea
            id={fieldId("description")}
            rows={4}
            value={values.description}
            onInput={(e) => setField("description", (e.target as HTMLTextAreaElement).value)}
          />
        </FieldShell>
        {errorItems.length > 0 ? (
          <div role="alert" aria-label="Fix these first" class="fix-first" tabIndex={-1} ref={alertBox}>
            <p class="sentence">Fix these first</p>
            <ul>
              {errorItems.map(([key, message]) => (
                <li key={key}>
                  <a
                    href={`#${idOf[key] ?? ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(idOf[key] ?? "")?.focus();
                    }}
                  >
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div role="status" aria-label="Save status" class="sentences">
          {saveStatus ? <p class="sentence">{saveStatus}</p> : null}
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">
            Save observation
          </button>
          <button
            type="button"
            id="new-observation"
            class="btn"
            onClick={() => {
              deleteDraft(account.id, sessionId, null);
              resetNew();
            }}
          >
            New observation
          </button>
        </div>
      </form>

      <h2>Observations</h2>
      {rows.length > 0 ? (
        <ul class="rows" aria-label="Observations" ref={list}>
          {rows.map((o) => (
            <li key={o.id} class="obs-row">
              <div class="obs-text">
                <span class="ink">{o.designation}</span>
                <span class="muted">{` ${o.local_time ? `${o.local_time} local, UTC${o.local_offset} · ` : ""}${apertureLabel(o.derived.aperture_mm)} mm · ${o.derived.magnification}×`}</span>
              </div>
              <div class="row-actions">
                <button type="button" class="btn" aria-label={`Open ${o.designation}`} onClick={() => navigate(`/sessions/${sessionId}?observation=${o.id}`)}>
                  Open
                </button>
                <button
                  type="button"
                  class="btn"
                  aria-label={`Delete ${o.designation}`}
                  onClick={() => {
                    setTarget({ id: o.id, designation: o.designation, date: o.evening_date });
                    del.show();
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">Nothing logged in this session yet.</p>
      )}
      <DeleteDialog handle={del} target={target} onConfirm={confirmDelete} />
    </WorkingScreen>
  );
}

