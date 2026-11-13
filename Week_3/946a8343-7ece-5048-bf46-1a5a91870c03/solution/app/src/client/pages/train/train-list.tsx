// `list "Merge train"`: the staircase of train cars, shared by the train page and the merge request panel.
//   <TrainList project target variant currentIid? />   variant "page" draws the staircase (and the empty start band), "panel" a
//       compact vertical list for the request panel. It loads the train, applies live `train` messages inside the socket handler
//       and plays Train Ref Resolve (see resolve.ts) for cars that join, move, leave or get a new stored commit.
//   focusCar(iid)   focuses that car's listitem as soon as it exists (call it after `Add to merge train`); mounted lists reload.
import { useCallback, useLayoutEffect, useRef, useState } from "preact/hooks";
import { api, ApiError, asApiError } from "../../api.ts";
import { prefersReducedMotion } from "../../hooks.ts";
import { type LiveMessage, subscribeProject, useLivePage } from "../../live.ts";
import { A } from "../../router.ts";
import { asNumber, isRecord, nextTick } from "../../util.ts";
import { EmptyState, Notice, Skeleton } from "../../ui/index.ts";
import "../../styles/train.css";
import { playLeave, playStep, randomGlyphs, resolveKicker, shortId, STAGGER_MS, type StepFrom } from "./resolve.ts";
import type { TrainBody, TrainCar } from "./types.ts";

interface TrainListProps {
  project: number;
  target: string;
  variant: "page" | "panel";
  currentIid?: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Ghost {
  key: number;
  car: TrainCar;
  box: Box;
}

const mounted = new Set<() => Promise<void>>();
let wantedCar: number | null = null;

function focusWanted(root: ParentNode): void {
  if (wantedCar === null) return;
  const item = root.querySelector<HTMLElement>(`li[data-iid="${wantedCar}"]`);
  if (!item) return;
  wantedCar = null;
  item.focus();
}

export function focusCar(iid: number): void {
  wantedCar = iid;
  focusWanted(document);
  for (const reload of [...mounted]) void reload();
}

function carsFromMessage(data: Record<string, unknown>, current: readonly TrainCar[]): TrainCar[] | null {
  if (!Array.isArray(data.cars)) return null;
  const known = new Map(current.map((car) => [car.iid, car]));
  const next: TrainCar[] = [];
  for (const raw of data.cars) {
    if (!isRecord(raw)) return null;
    const iid = asNumber(raw.iid);
    const position = asNumber(raw.position);
    const sha = typeof raw.sha === "string" ? raw.sha : null;
    if (iid === null || position === null || sha === null) return null;
    const before = known.get(iid);
    next.push({ iid, position, sha, pipeline_id: before?.pipeline_id ?? null, pipeline_status: before?.pipeline_status ?? null });
  }
  return next.sort((a, b) => a.position - b.position);
}

interface TrainState {
  cars: TrainCar[] | null;
  error: ApiError | null;
}

function useTrainCars(project: number, target: string) {
  const [state, setState] = useState<TrainState>({ cars: null, error: null });
  const page = useLivePage();
  const run = useRef({
    epoch: 0,
    generation: 0,
    running: false,
    again: false,
    tick: 0,
    waiters: [] as Array<() => void>,
    cars: [] as TrainCar[],
  });
  run.current.cars = state.cars ?? [];
  const latest = useRef({ page, project, target });
  latest.current = { page, project, target };

  const fetchOnce = useCallback((): void => {
    const r = run.current;
    const generation = r.generation;
    const epoch = r.epoch;
    const waiters = r.waiters;
    r.waiters = [];
    r.running = true;
    r.again = false;
    r.tick = nextTick();
    const path = `/api/projects/${latest.current.project}/train?target=${encodeURIComponent(latest.current.target)}`;
    api.get<TrainBody>(path).then(
      (body) => {
        // A message that arrived while this request was out is newer than its answer; the follow-up request settles it.
        if (generation === r.generation && epoch === r.epoch) setState({ cars: body.cars, error: null });
      },
      (cause: unknown) => {
        if (generation === r.generation) setState((s) => ({ cars: s.cars, error: asApiError(cause) }));
      },
    ).finally(() => {
      for (const done of waiters) done();
      r.running = false;
      if (generation !== r.generation) return;
      if (r.again || r.waiters.length > 0) fetchOnce();
    });
  }, []);

  const reload = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const r = run.current;
        r.waiters.push(resolve);
        if (r.running) r.again = true;
        else fetchOnce();
      }),
    [fetchOnce],
  );

  useLayoutEffect(() => {
    const r = run.current;
    r.generation++;
    r.epoch++;
    r.running = false;
    r.waiters = [];
    setState({ cars: null, error: null });
    const onMessage = (message: LiveMessage) => {
      const { page: tracker, target: wanted } = latest.current;
      if (message.type === "train") {
        if (message.data.target !== wanted) return;
        r.epoch++;
        const cars = carsFromMessage(message.data, r.cars);
        if (cars) setState({ cars, error: null });
      } else if (message.type !== "pipeline") {
        return;
      }
      const done = message.seq !== null && tracker ? tracker.begin(message.seq) : null;
      void reload().then(done ?? undefined);
    };
    const unsubscribe = subscribeProject(project, {
      onMessage,
      onResync: () => void reload(),
      onSnapshot: (tick) => {
        if (r.tick < tick) void reload();
      },
    });
    mounted.add(reload);
    void reload();
    return () => {
      unsubscribe();
      mounted.delete(reload);
      r.generation++;
    };
  }, [project, target]);

  return { ...state, reload };
}

function carLabel(car: TrainCar): string {
  return `Position ${car.position}, !${car.iid}, testing ${shortId(car.sha)}, pipeline ${car.pipeline_status ?? "none"}`;
}

function CarBody({ car, project, linkable }: { car: TrainCar; project: number; linkable: boolean }) {
  const short = shortId(car.sha);
  return (
    <>
      <div class="sp-car__head">
        {linkable ? (
          <A href={`/projects/${project}/-/merge_requests/${car.iid}`} class="sp-car__id">
            {`!${car.iid}`}
          </A>
        ) : (
          <span class="sp-car__id">{`!${car.iid}`}</span>
        )}
        <span class="sp-car__status">{car.pipeline_status ?? "none"}</span>
      </div>
      <span class="sp-car__kicker" role="img" aria-label={`Testing ${short}`}>
        [ <span class="sp-car__glyphs" data-glyphs="">{short}</span> ]
      </span>
    </>
  );
}

function GhostCar({ ghost, project, onDone }: { ghost: Ghost; project: number; onDone: (key: number) => void }) {
  const block = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (block.current) playLeave(block.current, () => onDone(ghost.key));
  }, []);
  const { left, top, width, height } = ghost.box;
  return (
    <div ref={block} class="sp-car sp-car--leaving" aria-hidden="true" style={{ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }}>
      <CarBody car={ghost.car} project={project} linkable={false} />
    </div>
  );
}

export function TrainList({ project, target, variant, currentIid }: TrainListProps) {
  const { cars, error } = useTrainCars(project, target);
  const wrap = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<number, HTMLLIElement>());
  const view = useRef({ cars: [] as TrainCar[], boxes: new Map<number, { car: TrainCar; box: Box }>(), stops: new Map<number, () => void>(), ghostKey: 0 });
  const [ghosts, setGhosts] = useState<Ghost[]>([]);

  useLayoutEffect(() => {
    const v = view.current;
    if (cars === null) {
      for (const stop of v.stops.values()) stop();
      v.stops.clear();
      v.cars = [];
      v.boxes = new Map();
      return;
    }
    const before = new Map(v.cars.map((car) => [car.iid, car]));
    const present = new Set(cars.map((car) => car.iid));
    const calm = prefersReducedMotion();
    const leaving: Ghost[] = [];
    const now = new Map(cars.map((car) => [car.iid, car]));
    for (const [iid, stop] of v.stops) {
      if (calm || now.get(iid)?.sha !== before.get(iid)?.sha) {
        stop();
        v.stops.delete(iid);
      }
    }
    if (calm) {
      for (const car of cars) {
        const glyphs = items.current.get(car.iid)?.querySelector<HTMLElement>("[data-glyphs]");
        if (glyphs?.firstChild instanceof Text) glyphs.firstChild.data = shortId(car.sha);
      }
    } else {
      for (const was of v.cars) {
        const kept = v.boxes.get(was.iid);
        if (!present.has(was.iid) && kept) leaving.push({ key: ++v.ghostKey, car: was, box: kept.box });
      }
      let moving = 0;
      for (const car of cars) {
        const block = items.current.get(car.iid);
        const was = before.get(car.iid);
        if (!block) continue;
        let from: StepFrom | null = null;
        if (was === undefined) from = "above";
        else if (car.position < was.position) from = "below";
        const delay = from === null ? 0 : moving++ * STAGGER_MS;
        if (from !== null) playStep(block, from, delay);
        if (was?.sha !== car.sha) {
          const glyphs = block.querySelector<HTMLElement>("[data-glyphs]");
          if (glyphs) {
            const short = shortId(car.sha);
            v.stops.set(car.iid, resolveKicker(glyphs, was ? shortId(was.sha) : randomGlyphs(short.length), short, delay));
          }
        }
      }
    }
    v.cars = cars;
    v.boxes = new Map();
    for (const car of cars) {
      const block = items.current.get(car.iid);
      if (block) v.boxes.set(car.iid, { car, box: { left: block.offsetLeft, top: block.offsetTop, width: block.offsetWidth, height: block.offsetHeight } });
    }
    if (leaving.length > 0) setGhosts((current) => [...current, ...leaving]);
    if (wrap.current) focusWanted(wrap.current);
  }, [cars]);

  useLayoutEffect(
    () => () => {
      for (const stop of view.current.stops.values()) stop();
      view.current.stops.clear();
    },
    [],
  );

  const dropGhost = useCallback((key: number) => setGhosts((current) => current.filter((ghost) => ghost.key !== key)), []);

  if (error && cars === null) return <Notice>{error.message}</Notice>;
  if (cars === null) return <Skeleton rows={3} height={96} />;
  if (cars.length === 0) {
    if (variant === "panel") return <p class="sp-muted">The train is empty</p>;
    return <EmptyState eyebrow="MERGE TRAIN" headline="The train is empty" action={{ label: "Open merge requests", href: `/projects/${project}/-/merge_requests` }} />;
  }
  return (
    <div ref={wrap} class={`sp-train sp-train--${variant}`}>
      {error ? <Notice>{error.message}</Notice> : null}
      <ul role="list" aria-label="Merge train" class="sp-train__list">
        {cars.map((car) => (
          <li
            key={car.iid}
            ref={(element) => {
              if (element) items.current.set(car.iid, element);
              else items.current.delete(car.iid);
            }}
            tabIndex={-1}
            class={`sp-car${car.iid === currentIid ? " sp-car--current" : ""}`}
            aria-label={carLabel(car)}
            aria-current={car.iid === currentIid ? "true" : undefined}
            data-position={car.position}
            data-iid={car.iid}
            data-sha={car.sha}
          >
            <CarBody car={car} project={project} linkable />
          </li>
        ))}
      </ul>
      {ghosts.map((ghost) => (
        <GhostCar key={ghost.key} ghost={ghost} project={project} onDone={dropGhost} />
      ))}
    </div>
  );
}
