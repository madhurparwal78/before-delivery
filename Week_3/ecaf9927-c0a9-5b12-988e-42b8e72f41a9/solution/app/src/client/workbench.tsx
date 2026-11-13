import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  Assembly,
  Bom,
  Constraint,
  ConstraintKind,
  Direction,
  Entity,
  Feature,
  Material,
  Member,
  Operation,
  Part,
  Plane,
  PurchasedPart,
  Sketch,
  TreeRow,
  Workspace,
} from '../shared/api';
import { NO_ANSWER_COPY, NoAnswer, call, get, type Failure, type Result } from './api';
import { editableLength, toleranceText } from '../shared/units';
import { measure } from './lib/geometry';

export type Tool = 'select' | 'line' | 'circle' | 'arc' | 'point';

type View =
  | { kind: 'assembly'; id: string }
  | { kind: 'part'; id: string; extrudeId?: string }
  | { kind: 'sketch'; id: string; partId: string };

type DialogKind = 'part' | 'assembly' | 'purchased' | 'sketch' | 'add';

/** A dimension being typed: which constraint it will become, or which one is being edited. */
interface DimensionDraft {
  kind: ConstraintKind;
  refs: string[];
  value: string;
  tolerance: string;
  editing?: Constraint;
  fieldErrors: Record<string, string>;
}

interface ExtrudeDraft {
  /** Set when an existing extrude is being edited. */
  featureId?: string;
  depth: string;
  operation: Operation;
  direction: Direction;
  fieldErrors: Record<string, string>;
}

/** A refused constraint: the ghost glyph and the glyph of the constraint it conflicts with flash together. */
interface Flash {
  nonce: number;
  refusedLabel: string;
  kind: ConstraintKind;
  refs: string[];
  value: number | undefined;
  namedLabel: string;
}

type Pending = Record<string, boolean>;

interface Outcome<T = undefined> {
  ok: boolean;
  data?: T;
  fields?: Record<string, string>;
  failure?: Failure;
}

interface Bench {
  member: Member | null;
  booted: boolean;
  workspace: Workspace | null;
  materials: Material[];
  parts: Part[];
  assemblies: Assembly[];
  purchased: PurchasedPart[];
  view: View | null;
  assembly: { assembly: Assembly; rows: TreeRow[]; bom: Bom } | null;
  expanded: Set<string>;
  assemblyTab: 'model' | 'bom';
  part: Part | null;
  sketch: Sketch | null;
  storage: 'ok' | 'unreachable';
  message: { text: string; nonce: number };
  conflict: string | null;
  saving: Pending;
  selection: string[];
  cursor: string;
  tool: Tool;
  dimension: DimensionDraft | null;
  extrude: ExtrudeDraft | null;
  slackShown: number | null;
  /** Rises with every constraint accepted, edited or deleted; the canvas animates only on those changes. */
  motion: number;
  flash: Flash | null;
  steadyConflict: boolean;
  dialog: DialogKind | null;
  sheet: 'tree' | 'properties' | null;
  signInError: { message: string; fields: Record<string, string> } | null;
  signingIn: boolean;
}

interface Actions {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  setUnits(units: Member['units']): Promise<void>;
  setPrecision(precision: number): Promise<void>;
  openAssembly(id: string): Promise<void>;
  setAssemblyTab(tab: 'model' | 'bom'): void;
  toggleExpanded(instanceId: string): void;
  openPart(id: string, extrudeId?: string): Promise<void>;
  openSketch(id: string, partId: string): Promise<void>;
  closeSketch(): Promise<void>;
  reload(): Promise<void>;
  setDialog(kind: DialogKind | null): void;
  setSheet(sheet: 'tree' | 'properties' | null): void;
  createPart(name: string, materialId: string): Promise<Outcome>;
  createAssembly(name: string): Promise<Outcome>;
  createPurchased(name: string, mass: string): Promise<Outcome>;
  createSketch(plane: Plane, offset: string): Promise<Outcome>;
  setMaterial(materialId: string): Promise<void>;
  savePart(): Promise<void>;
  addInstance(component: { type: string; id: string }, quantity: number, key: string): Promise<Outcome>;
  setQuantity(instanceId: string, quantity: number): Promise<void>;
  removeInstance(instanceId: string): Promise<void>;
  setTool(tool: Tool): void;
  select(refs: string[]): void;
  setCursor(ref: string): void;
  placeEntity(entity: unknown): Promise<Outcome>;
  constrain(kind: ConstraintKind, refs: string[], value?: string, tolerance?: string): Promise<Outcome>;
  editConstraint(constraint: Constraint, value: string, tolerance: string): Promise<Outcome>;
  deleteConstraint(constraint: Constraint): Promise<void>;
  deleteSelection(): Promise<void>;
  openDimension(kind: ConstraintKind, refs: string[], editing?: Constraint): void;
  updateDimension(patch: Partial<DimensionDraft>): void;
  closeDimension(): void;
  openExtrude(): void;
  updateExtrude(patch: Partial<ExtrudeDraft>): void;
  closeExtrude(): void;
  beginEdit(feature: Feature): Promise<void>;
  confirmExtrude(key: string): Promise<Outcome>;
  applyDepth(feature: Feature, depth: string, direction: Direction): Promise<Outcome>;
  clearConflictOutline(): void;
  setSlackShown(value: number | null): void;
  clearFlash(): void;
  focusCanvas(): void;
  registerCanvasFocus(focus: (() => void) | null): void;
}

const WorkbenchContext = createContext<(Bench & Actions) | null>(null);

export function useWorkbench(): Bench & Actions {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error('useWorkbench outside Workbench');
  return value;
}

const STORAGE_POLL_MS = 10000;

const byName = <T extends { name: string }>(items: T[]): T[] => [...items].sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));

export function Workbench({ children }: { children: ReactNode }) {
  const [member, setMember] = useState<Member | null>(null);
  const [booted, setBooted] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [purchased, setPurchased] = useState<PurchasedPart[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [assembly, setAssembly] = useState<Bench['assembly']>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [assemblyTab, setAssemblyTab] = useState<'model' | 'bom'>('model');
  const [part, setPart] = useState<Part | null>(null);
  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [storage, setStorage] = useState<'ok' | 'unreachable'>('ok');
  const [message, setMessage] = useState({ text: '', nonce: 0 });
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState<Pending>({});
  const [selection, setSelection] = useState<string[]>([]);
  const [cursor, setCursor] = useState('origin');
  const [tool, setToolState] = useState<Tool>('select');
  const [dimension, setDimension] = useState<DimensionDraft | null>(null);
  const [extrude, setExtrude] = useState<ExtrudeDraft | null>(null);
  const [slackShown, setSlackShown] = useState<number | null>(null);
  const [motion, setMotion] = useState(0);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [steadyConflict, setSteadyConflict] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [sheet, setSheet] = useState<'tree' | 'properties' | null>(null);
  const [signInError, setSignInError] = useState<Bench['signInError']>(null);
  const [signingIn, setSigningIn] = useState(false);
  const canvasFocus = useRef<(() => void) | null>(null);
  const flashCount = useRef(0);
  const live = useRef({ view, part, sketch, assembly, member });
  live.current = { view, part, sketch, assembly, member };
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const extrudeRef = useRef(extrude);
  extrudeRef.current = extrude;

  const say = useCallback((text: string) => setMessage((m) => ({ text, nonce: m.nonce + 1 })), []);

  const checkStorage = useCallback(async () => {
    try {
      const result = await get<{ storage: 'ok' | 'unreachable' }>('/api/status');
      if (result.ok) setStorage(result.data.storage);
    } catch (error) {
      if (!(error instanceof NoAnswer)) throw error;
    }
  }, []);

  const refreshLists = useCallback(async () => {
    const [p, a, pu] = await Promise.all([
      get<{ parts: Part[] }>('/api/parts'),
      get<{ assemblies: Assembly[] }>('/api/assemblies'),
      get<{ purchased: PurchasedPart[] }>('/api/purchased'),
    ]);
    if (p.ok) setParts(byName(p.data.parts));
    if (a.ok) setAssemblies(byName(a.data.assemblies));
    if (pu.ok) setPurchased(byName(pu.data.purchased));
  }, []);

  const loadAssembly = useCallback(async (id: string) => {
    const [a, tree, bom] = await Promise.all([
      get<{ assembly: Assembly }>(`/api/assemblies/${id}`),
      get<{ rows: TreeRow[] }>(`/api/assemblies/${id}/tree`),
      get<Bom>(`/api/assemblies/${id}/bom`),
    ]);
    if (a.ok && tree.ok && bom.ok) setAssembly({ assembly: a.data.assembly, rows: tree.data.rows, bom: bom.data });
  }, []);

  /** Runs a request, turning a missing answer into the Model message and a stale revision into the conflict notice. */
  const attempt = useCallback(
    async <T,>(request: () => Promise<Result<T>>): Promise<Result<T> | undefined> => {
      try {
        const result = await request();
        if (!result.ok && result.failure.status === 412) setConflict(result.failure.message);
        return result;
      } catch (error) {
        if (!(error instanceof NoAnswer)) throw error;
        say(NO_ANSWER_COPY);
        return undefined;
      }
    },
    [say],
  );

  /** A part change: Save status reads Saving… until the server answers; the storage status is checked afterwards. */
  const partChange = useCallback(
    async <T,>(partId: string, request: () => Promise<Result<T>>): Promise<Result<T> | undefined> => {
      setSaving((s) => ({ ...s, [partId]: true }));
      const result = await attempt(request);
      setSaving((s) => ({ ...s, [partId]: false }));
      void checkStorage();
      return result;
    },
    [attempt, checkStorage],
  );

  const adoptPart = useCallback((next: Part) => {
    setParts((list) => byName(list.map((p) => (p.id === next.id ? next : p))));
    setPart((current) => (current?.id === next.id ? next : current));
  }, []);

  const resetEditing = useCallback(() => {
    setSelection([]);
    setCursor('origin');
    setToolState('select');
    setDimension(null);
    setExtrude(null);
    setFlash(null);
    setSteadyConflict(false);
  }, []);

  const bootWorkspace = useCallback(async () => {
    const [ws, mats] = await Promise.all([get<Workspace>('/api/workspace'), get<{ materials: Material[] }>('/api/materials'), refreshLists(), checkStorage()]);
    if (ws.ok) {
      setWorkspace(ws.data);
      if (mats.ok) setMaterials(mats.data.materials);
      setExpanded(new Set());
      setView({ kind: 'assembly', id: ws.data.product.assembly_id });
      await loadAssembly(ws.data.product.assembly_id);
    }
  }, [checkStorage, loadAssembly, refreshLists]);

  useEffect(() => {
    void (async () => {
      const me = await call<{ member: Member }>('GET', '/api/me');
      if (me.ok) {
        setMember(me.data.member);
        await bootWorkspace();
      }
      setBooted(true);
    })();
  }, [bootWorkspace]);

  useEffect(() => {
    if (!member) return;
    const timer = setInterval(() => void checkStorage(), STORAGE_POLL_MS);
    return () => clearInterval(timer);
  }, [member, checkStorage]);

  const actions: Actions = useMemo(() => {
    const openAssembly = async (id: string) => {
      resetEditing();
      setSlackShown(null);
      setMessage((m) => ({ text: '', nonce: m.nonce }));
      setExpanded(new Set());
      setAssemblyTab('model');
      setSheet(null);
      setView({ kind: 'assembly', id });
      await Promise.all([loadAssembly(id), refreshLists(), checkStorage()]);
    };

    const openPart = async (id: string, extrudeId?: string) => {
      resetEditing();
      setSlackShown(null);
      setMessage((m) => ({ text: '', nonce: m.nonce }));
      setSheet(null);
      const result = await attempt(() => get<{ part: Part }>(`/api/parts/${id}`));
      if (result?.ok) {
        setPart(result.data.part);
        adoptPart(result.data.part);
        setView({ kind: 'part', id, extrudeId });
        setSketch(null);
      }
      void checkStorage();
    };

    const openSketch = async (id: string, partId: string) => {
      resetEditing();
      setMessage((m) => ({ text: '', nonce: m.nonce }));
      setSheet(null);
      const [s, p] = await Promise.all([attempt(() => get<{ sketch: Sketch }>(`/api/sketches/${id}`)), attempt(() => get<{ part: Part }>(`/api/parts/${partId}`))]);
      if (s?.ok && p?.ok) {
        setSketch(s.data.sketch);
        setPart(p.data.part);
        adoptPart(p.data.part);
        setSlackShown(s.data.sketch.slack);
        setView({ kind: 'sketch', id, partId });
      }
    };

    const reloadOpen = async () => {
      const { view: v } = live.current;
      setConflict(null);
      setDimension(null);
      setExtrude(null);
      if (v?.kind === 'sketch') await openSketch(v.id, v.partId);
      else if (v?.kind === 'part') await openPart(v.id, v.extrudeId);
      else if (v?.kind === 'assembly') await openAssembly(v.id);
    };

    /** Applies the sketch and part returned by a sketch change. */
    const adoptSketchChange = (data: { sketch: Sketch; part: Part }, animated = false) => {
      setSketch(data.sketch);
      adoptPart(data.part);
      if (animated) setMotion((n) => n + 1);
    };

    const sketchBase = () => (live.current.sketch as Sketch).revision;
    const sketchId = () => (live.current.sketch as Sketch).id;
    const partId = () => (live.current.sketch as Sketch).part_id;

    const fail = (result: Result<unknown> | undefined): Outcome => {
      if (!result) return { ok: false };
      if (result.ok) return { ok: true };
      const f = result.failure;
      if (f.status === 422) return { ok: false, fields: f.fields, failure: f };
      if (f.status !== 412) say(f.message);
      return { ok: false, failure: f };
    };

    return {
      async signIn(email, password) {
        setSigningIn(true);
        setSignInError(null);
        const result = await attempt(() => call<{ member: Member }>('POST', '/api/session', { email, password }));
        setSigningIn(false);
        if (!result) return;
        if (result.ok) {
          setMember(result.data.member);
          await bootWorkspace();
        } else {
          setSignInError({ message: result.failure.message, fields: result.failure.fields ?? {} });
        }
      },
      async signOut() {
        await call<undefined>('DELETE', '/api/session');
        setMember(null);
        setView(null);
        setAssembly(null);
        setPart(null);
        setSketch(null);
        resetEditing();
        setSlackShown(null);
        setConflict(null);
      },
      async setUnits(units) {
        const result = await attempt(() => call<{ member: Member }>('PATCH', '/api/me', { units }));
        if (result?.ok) setMember(result.data.member);
      },
      async setPrecision(precision) {
        const result = await attempt(() => call<{ member: Member }>('PATCH', '/api/me', { precision }));
        if (result?.ok) setMember(result.data.member);
      },
      openAssembly,
      setAssemblyTab(tab) {
        setAssemblyTab(tab);
        const v = live.current.view;
        if (v?.kind === 'assembly') void loadAssembly(v.id);
      },
      toggleExpanded(instanceId) {
        setExpanded((current) => {
          const next = new Set(current);
          if (!next.delete(instanceId)) next.add(instanceId);
          return next;
        });
      },
      openPart,
      openSketch,
      async closeSketch() {
        const v = live.current.view;
        if (v?.kind === 'sketch') await openPart(v.partId);
      },
      reload: reloadOpen,
      setDialog,
      setSheet,
      async createPart(name, materialId) {
        const result = await attempt(() => call<{ part: Part }>('POST', '/api/parts', { name, material_id: materialId }));
        if (result?.ok) {
          await refreshLists();
          return { ok: true };
        }
        return fail(result);
      },
      async createAssembly(name) {
        const result = await attempt(() => call<{ assembly: Assembly }>('POST', '/api/assemblies', { name }));
        if (result?.ok) {
          await refreshLists();
          return { ok: true };
        }
        return fail(result);
      },
      async createPurchased(name, mass) {
        const parsed = Number(mass.trim());
        const result = await attempt(() =>
          call<{ purchased: PurchasedPart }>('POST', '/api/purchased', { name, declared_mass_g: mass.trim() === '' || Number.isNaN(parsed) ? mass : parsed }),
        );
        if (result?.ok) {
          await refreshLists();
          return { ok: true };
        }
        return fail(result);
      },
      async createSketch(plane, offset) {
        const p = live.current.part as Part;
        const result = await partChange(p.id, () => call<{ sketch: Sketch; part: Part }>('POST', `/api/parts/${p.id}/sketches`, { base_revision: p.revision, plane, offset }));
        if (result?.ok) {
          adoptPart(result.data.part);
          await openSketch(result.data.sketch.id, p.id);
          return { ok: true };
        }
        return fail(result);
      },
      async setMaterial(materialId) {
        const p = live.current.part as Part;
        const result = await partChange(p.id, () => call<{ part: Part }>('PATCH', `/api/parts/${p.id}`, { base_revision: p.revision, material_id: materialId }));
        if (result?.ok) adoptPart(result.data.part);
        else fail(result);
      },
      async savePart() {
        const p = live.current.part as Part;
        const result = await partChange(p.id, () => call<{ part: Part }>('POST', `/api/parts/${p.id}/save`, {}));
        if (result?.ok) adoptPart(result.data.part);
        else fail(result);
      },
      async addInstance(component, quantity, key) {
        const current = live.current.assembly?.assembly as Assembly;
        const result = await attempt(() =>
          call<{ assembly: Assembly }>('POST', `/api/assemblies/${current.id}/instances`, { base_revision: current.revision, component, quantity }, { 'Idempotency-Key': key }),
        );
        if (result?.ok) {
          const placed = result.data.assembly.instances.find((i) => i.component.id === component.id && i.component.type === component.type);
          await Promise.all([loadAssembly(current.id), refreshLists()]);
          say(`${placed?.component.name ?? ''} ×${quantity} added to ${current.name}.`);
          return { ok: true };
        }
        if (result && !result.ok && result.failure.status !== 412 && result.failure.status !== 422) return { ok: false, fields: { component: result.failure.message } };
        return fail(result);
      },
      async setQuantity(instanceId, quantity) {
        const current = live.current.assembly?.assembly as Assembly;
        const result = await attempt(() => call<{ assembly: Assembly }>('PATCH', `/api/assemblies/${current.id}/instances/${instanceId}`, { base_revision: current.revision, quantity }));
        fail(result);
        await Promise.all([loadAssembly(current.id), refreshLists()]);
      },
      async removeInstance(instanceId) {
        const current = live.current.assembly?.assembly as Assembly;
        const result = await attempt(() => call<{ assembly: Assembly }>('DELETE', `/api/assemblies/${current.id}/instances/${instanceId}?base_revision=${current.revision}`));
        if (!result?.ok) fail(result);
        await Promise.all([loadAssembly(current.id), refreshLists()]);
      },
      setTool(next) {
        setToolState(next);
        setDimension(null);
        if (next !== 'select') setExtrude(null);
      },
      select: setSelection,
      setCursor,
      async placeEntity(entity) {
        const result = await partChange(partId(), () => call<{ sketch: Sketch; part: Part; entity: Entity }>('POST', `/api/sketches/${sketchId()}/entities`, { base_revision: sketchBase(), entity }));
        if (result?.ok) {
          adoptSketchChange(result.data);
          setSlackShown(result.data.sketch.slack);
          setCursor(result.data.entity.id);
          return { ok: true };
        }
        return fail(result);
      },
      async constrain(kind, refs, value, tolerance) {
        const before = live.current.sketch as Sketch;
        setSteadyConflict(false);
        setFlash(null);
        const body: Record<string, unknown> = { base_revision: before.revision, kind, refs };
        if (value !== undefined) body['value'] = value;
        if (tolerance !== undefined && tolerance !== '') body['tolerance'] = tolerance;
        const result = await partChange(partId(), () => call<{ sketch: Sketch; part: Part; constraint: Constraint }>('POST', `/api/sketches/${sketchId()}/constraints`, body));
        if (result?.ok) {
          adoptSketchChange(result.data, true);
          const { constraint, sketch: after } = result.data;
          say(
            constraint.redundant
              ? `${constraint.label} added and marked redundant.`
              : after.slack === 0
                ? `${constraint.label} added. Fully held.`
                : `${constraint.label} added. Slack ${after.slack}.`,
          );
          return { ok: true };
        }
        if (result && !result.ok && result.failure.code === 'over_constrained' && result.failure.conflicts_with && result.failure.refused_label) {
          say(result.failure.message);
          flashCount.current += 1;
          setFlash({
            nonce: flashCount.current,
            refusedLabel: result.failure.refused_label,
            kind,
            refs,
            value: value === undefined ? undefined : measure(before, kind, refs),
            namedLabel: result.failure.conflicts_with.label,
          });
          setSteadyConflict(true);
          return { ok: false, failure: result.failure };
        }
        return fail(result);
      },
      async editConstraint(constraint, value, tolerance) {
        const result = await partChange(partId(), () =>
          call<{ sketch: Sketch; part: Part; constraint: Constraint }>('PATCH', `/api/sketches/${sketchId()}/constraints/${constraint.id}`, { base_revision: sketchBase(), value, tolerance }),
        );
        if (result?.ok) {
          adoptSketchChange(result.data, true);
          return { ok: true };
        }
        return fail(result);
      },
      async deleteConstraint(constraint) {
        const result = await partChange(partId(), () =>
          call<{ sketch: Sketch; part: Part }>('DELETE', `/api/sketches/${sketchId()}/constraints/${constraint.id}?base_revision=${sketchBase()}`),
        );
        if (result?.ok) {
          adoptSketchChange(result.data, true);
          setSteadyConflict(false);
          setFlash(null);
        } else fail(result);
      },
      async deleteSelection() {
        const sk = live.current.sketch as Sketch;
        const ids = sk.entities.filter((e) => selectionRef.current.includes(e.id)).map((e) => e.id);
        for (const id of ids) {
          const current = live.current.sketch as Sketch;
          const result = await partChange(partId(), () =>
            call<{ sketch: Sketch; part: Part }>('DELETE', `/api/sketches/${sketchId()}/entities/${id}?base_revision=${current.revision}`),
          );
          if (result?.ok) {
            adoptSketchChange(result.data);
            setSlackShown(result.data.sketch.slack);
            setSelection([]);
          } else {
            fail(result);
            return;
          }
        }
      },
      openDimension(kind, refs, editing) {
        const sk = live.current.sketch as Sketch;
        const unit = (live.current.member as Member).units;
        const measured = measure(sk, kind, refs);
        const nominal = editing?.value_mm ?? measured;
        setDimension({
          kind,
          refs,
          value: nominal === undefined ? '' : editableLength(nominal, unit),
          tolerance: editing?.tolerance ? toleranceText(editing.tolerance, unit) : '',
          editing,
          fieldErrors: {},
        });
      },
      updateDimension: (patch) => setDimension((d) => (d ? { ...d, ...patch } : d)),
      closeDimension: () => setDimension(null),
      openExtrude() {
        const p = live.current.part as Part;
        setToolState('select');
        setDimension(null);
        setExtrude({ depth: '10 mm', operation: p.features.length === 0 ? 'new' : 'join', direction: 'normal', fieldErrors: {} });
      },
      updateExtrude: (patch) => setExtrude((e) => (e ? { ...e, ...patch } : e)),
      closeExtrude: () => setExtrude(null),
      async beginEdit(feature) {
        const unit = (live.current.member as Member).units;
        const fresh = await attempt(() => get<{ sketch: Sketch }>(`/api/sketches/${feature.sketch_id}`));
        if (fresh?.ok) setSketch(fresh.data.sketch);
        setExtrude({ featureId: feature.id, depth: editableLength(feature.depth_mm, unit), operation: feature.operation, direction: feature.direction, fieldErrors: {} });
      },
      async confirmExtrude(key) {
        const p = live.current.part as Part;
        const sk = live.current.sketch as Sketch;
        const draft = extrudeRef.current as ExtrudeDraft;
        const result = await partChange(p.id, () =>
          call<{ feature: Feature; part: Part }>(
            'POST',
            `/api/parts/${p.id}/features`,
            { base_revision: p.revision, sketch_id: sk.id, operation: draft.operation, depth: draft.depth, direction: draft.direction },
            { 'Idempotency-Key': key },
          ),
        );
        if (result?.ok) {
          adoptPart(result.data.part);
          setExtrude(null);
          const fresh = await attempt(() => get<{ sketch: Sketch }>(`/api/sketches/${sk.id}`));
          if (fresh?.ok) setSketch(fresh.data.sketch);
          say(`${result.data.feature.name} added.`);
          return { ok: true };
        }
        return fail(result);
      },
      async applyDepth(feature, depth, direction) {
        const p = live.current.part as Part;
        const result = await partChange(p.id, () =>
          call<{ feature: Feature; part: Part }>('PATCH', `/api/parts/${p.id}/features/${feature.id}`, { base_revision: p.revision, depth, direction }),
        );
        if (result?.ok) {
          adoptPart(result.data.part);
          return { ok: true };
        }
        return fail(result);
      },
      clearConflictOutline: () => {
        setSteadyConflict(false);
        setFlash(null);
      },
      setSlackShown,
      clearFlash: () => setFlash(null),
      focusCanvas: () => canvasFocus.current?.(),
      registerCanvasFocus: (focus) => {
        canvasFocus.current = focus;
      },
    };
  }, [attempt, adoptPart, bootWorkspace, checkStorage, loadAssembly, partChange, refreshLists, resetEditing, say]);


  const value = { member, booted, workspace, materials, parts, assemblies, purchased, view, assembly, expanded, assemblyTab, part, sketch, storage, message, conflict, saving, selection, cursor, tool, dimension, extrude, slackShown, motion, flash, steadyConflict, dialog, sheet, signInError, signingIn, ...actions };
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}
