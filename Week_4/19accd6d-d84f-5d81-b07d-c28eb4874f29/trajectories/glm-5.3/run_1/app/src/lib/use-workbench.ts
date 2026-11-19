import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Step } from '../../shared/catalogue.js';
import { stepFrom } from '../../shared/catalogue.js';
import type { ClientConfig, LiveMessage, RecipeSummary, RecipeVersion, User } from '../../shared/protocol.js';
import { api, HttpError } from './api.js';
import { encodeInput, DEFAULT_CONFIG, DEFAULT_FAVOURITES, newTab, tabBytes, type BakeState, type InputTab, type RecipeRef, type SpanMapping } from './app-state.js';
import { mapSpan } from './app-state.js';
import { starterState } from './app-state.js';
import { suggestionFor } from './app-state.js';

export interface Announcement { text: string; at: number }

export interface Workbench {
  config: ClientConfig;
  user: User | null;
  steps: Step[];
  tabs: InputTab[];
  activeTab: string;
  bake: BakeState;
  output: Uint8Array | null;
  outputDisplay: { text: string; notUtf8: boolean; truncated: boolean; totalBytes: number };
  autoBake: boolean;
  busyBake: boolean;
  span: SpanMapping | null;
  recipeRef: RecipeRef;
  dirty: boolean;
  announcements: Announcement[];
  inputAlert: string | null;
  topAlert: string | null;
  linkField: string | null;
  updateBanner: { name: string; authorName: string; version: number } | null;
  livePaused: boolean;
  favourites: string[];
  suggestions: string | null;
  busy: Record<string, boolean>;

  addStep: (op: string, args?: Record<string, import('../../shared/catalogue.js').ArgValue>) => void;
  removeStep: (index: number) => void;
  moveStep: (index: number, to: number) => void;
  setStepArg: (index: number, key: string, value: string | number | boolean) => void;
  toggleDisabled: (index: number) => void;
  toggleBreakpoint: (index: number) => void;
  clearRecipe: () => void;
  setTabText: (text: string) => void;
  setTabEncoding: (enc: InputTab['encoding']) => void;
  setTabFile: (file: InputTab['file']) => void;
  setTabSelection: (sel: { start: number; end: number } | null) => void;
  selectTab: (id: string) => void;
  addTab: () => void;
  bakeNow: () => void;
  resume: () => void;
  step: () => void;
  setAutoBake: (on: boolean) => void;
  setOutputView: (v: 'Text' | 'Hex') => void;
  outputView: 'Text' | 'Hex';
  announce: (text: string) => void;
  setTopAlert: (text: string | null) => void;
  setInputAlert: (text: string | null) => void;
  saveRecipe: (name: string, note: string, tags: string, owner: { type: 'user' | 'team'; id?: string }) => Promise<'saved' | 'conflict'>;
  markSaved: (recipe: RecipeSummary, version: RecipeVersion) => void;
  loadVersion: (recipeId: string, version: number) => Promise<void>;
  refreshLibrarySignal: () => void;
  openRecipeLink: (steps: Step[], input: Uint8Array, notUtf8: boolean) => void;
  showLink: (link: string | null) => void;
  dismissUpdate: () => void;
  loadLatest: () => Promise<void>;
  setFavourites: (f: string[]) => void;
  editFavourites: boolean;
  setEditFavourites: (v: boolean) => void;
  libraryTick: number;
  encodingError: string | null;
  inputBytes: Uint8Array | null;
}

interface WorkerDone {
  type: 'done';
  runId: number;
  output: ArrayBuffer;
  ms: number;
  lastStep: number;
  pausedBefore: number | null;
  errorStep: number | null;
  errorMessage: string | null;
  intermediates: Record<string, ArrayBuffer>;
}


export function useWorkbench(): Workbench {
  const [config, setConfig] = useState<ClientConfig>(DEFAULT_CONFIG);
  const [user, setUser] = useState<User | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [tabs, setTabs] = useState<InputTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [bake, setBake] = useState<BakeState>({ kind: 'idle' });
  const [output, setOutput] = useState<Uint8Array | null>(null);
  const [autoBake, setAutoBake] = useState(true);
  const [outputView, setOutputView] = useState<'Text' | 'Hex'>('Text');
  const [recipeRef, setRecipeRef] = useState<RecipeRef>({ id: null, name: 'Unsaved recipe', baseVersion: 0, savedName: null, owner: 'user', ownerId: null, ownerName: 'Personal' });
  const [dirty, setDirty] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [inputAlert, setInputAlert] = useState<string | null>(null);
  const [topAlert, setTopAlert] = useState<string | null>(null);
  const [linkField, setLinkField] = useState<string | null>(null);
  const [updateBanner, setUpdateBanner] = useState<{ name: string; authorName: string; version: number } | null>(null);
  const [livePaused, setLivePaused] = useState(false);
  const [favourites, setFavouritesState] = useState<string[]>(DEFAULT_FAVOURITES);
  const [editFavourites, setEditFavourites] = useState(false);
  const [libraryTick, setLibraryTick] = useState(0);
  const [intermediates, setIntermediates] = useState<Map<number, Uint8Array>>(new Map());

  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  const autoTimer = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const busyTimer = useRef<number | null>(null);

  const tab = useMemo(() => tabs.find((t) => t.id === activeTab) ?? tabs[0], [tabs, activeTab]);
  const encoded = useMemo(() => (tab ? tabBytes(tab) : { bytes: new Uint8Array() }), [tab]);
  const encodingError = 'error' in encoded ? encoded.error : null;
  const inputBytes = 'error' in encoded ? null : encoded.bytes;
  const suggestions = useMemo(() => (tab ? suggestionFor(tab) : null), [tab]);

  // Announcements: keep the newest.
  const announce = useCallback((text: string) => {
    setAnnouncements((prev) => [...prev.slice(-4), { text, at: Date.now() }]);
  }, []);

  // Load config and session once.
  useEffect(() => {
    void api.config().then(setConfig).catch(() => undefined);
    // One session probe on load; 401 means signed out (no retry noise).
    void api.me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
    const savedFav = localStorage.getItem('wringbench.favourites');
    if (savedFav) {
      try { setFavouritesState(JSON.parse(savedFav) as string[]); } catch { /* fresh start */ }
    }
  }, []);

  // Boot the workbench state once: the starter recipe loads only with no link
  // and no saved browser state (Seed data / DP-09).
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    // A link or ?recipe= address replaces the starter, but Input 1 always exists (DP-09).
    const hasLink = location.hash.includes('r=') || new URLSearchParams(location.search).has('recipe');
    const initialTab = newTab(1);
    setTabs([initialTab]);
    setActiveTab(initialTab.id);
    if (hasLink) return;
    void import('fflate').then((fflate) => {
      (globalThis as { __wbFflate?: typeof fflate }).__wbFflate = fflate;
      const starter = starterState();
      setSteps(starter.steps);
      setTabs((prev) => prev.map((t) => (t.id === initialTab.id ? { ...t, text: starter.inputText } : t)));
    });
  }, []);

  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;
    const w = new Worker(new URL('../worker/worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent) => { void handleWorkerMessage(ev.data as WorkerDone); };
    workerRef.current = w;
    return w;
  }, []);

  const killWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const handleWorkerMessage = useCallback(async (msg: WorkerDone) => {
    if (msg.type !== 'done' || msg.runId !== runIdRef.current) return;
    if (watchdogRef.current !== null) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    const out = new Uint8Array(msg.output);
    const inter = new Map<number, Uint8Array>();
    for (const [k, buf] of Object.entries(msg.intermediates)) inter.set(Number(k), new Uint8Array(buf));
    setIntermediates(inter);
    setOutput(out);
    if (busyTimer.current !== null) { clearTimeout(busyTimer.current); busyTimer.current = null; }
    if (msg.errorStep !== null) {
      const stepNum = msg.errorStep + 1;
      setBake({ kind: 'error', stepIndex: msg.errorStep, step: stepNum, branch: null, message: msg.errorMessage ?? '' });
      return;
    }
    if (msg.pausedBefore !== null) {
      const stepNum = msg.pausedBefore + 1;
      setBake({ kind: 'paused', beforeStep: msg.pausedBefore });
      announce(`Paused at step ${stepNum}`);
      return;
    }
    setBake({ kind: 'done', ms: msg.ms });
    announce('Output updated');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  const startBake = useCallback((mode: { kind: 'full' } | { kind: 'resume'; beforeStep: number } | { kind: 'step'; alreadyRun: number }) => {
    if (!inputBytes) return;
    const stepsNow = steps;
    const stopBefore = stepsNow
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => !s.disabled && s.breakpoint && (mode.kind !== 'resume' || i > (mode as { beforeStep: number }).beforeStep))
      .map(({ i }) => i);
    let maxSteps: number | undefined;
    if (mode.kind === 'resume') {
      const startIndex = (mode as { beforeStep: number }).beforeStep;
      const enabled = stepsNow.map((s, i) => ({ s, i })).filter(({ s, i }) => !s.disabled && i >= startIndex);
      maxSteps = enabled.length;
    } else if (mode.kind === 'step') {
      maxSteps = mode.alreadyRun + 1;
    }
    if (mode.kind === 'step') {
      // Step runs exactly one enabled step: from the pause point or from the start.
      const enabledCount = stepsNow.filter((s) => !s.disabled).length;
      maxSteps = Math.min(mode.alreadyRun + 1, enabledCount);
    }
    const runId = ++runIdRef.current;
    setBake({ kind: 'running', startedAt: Date.now() });
    const w = ensureWorker();
    w.postMessage({ runId, steps: stepsNow, input: inputBytes.slice().buffer, stopBefore, maxEnabledSteps: maxSteps });

    // Busy indicator only after a quarter second (DP-08).
    if (busyTimer.current !== null) clearTimeout(busyTimer.current);
    busyTimer.current = window.setTimeout(() => { busyTimer.current = null; }, 250);

    // Regex budget watchdog on the page clock (DP-21).
    const hasRegex = stepsNow.some((s) => !s.disabled && (s.op === 'Find and Replace' || s.op === 'Extract Matches'));
    if (hasRegex && watchdogRef.current === null) {
      const budget = config.regexBudgetMs;
      const runAt = runId;
      watchdogRef.current = window.setTimeout(() => {
        watchdogRef.current = null;
        if (runIdRef.current !== runAt) return;
        killWorker();
        const idx = stepsNow.findIndex((s) => !s.disabled && (s.op === 'Find and Replace' || s.op === 'Extract Matches'));
        const stepNum = idx + 1;
        setBake({ kind: 'error', stepIndex: idx, step: stepNum, branch: null, message: `Stopped after ${budget} ms` });
        setOutput(null);
      }, budget);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, inputBytes, config.regexBudgetMs]);

  const scheduleAutoBake = useCallback(() => {
    if (autoTimer.current !== null) { clearTimeout(autoTimer.current); autoTimer.current = null; }
    if (!autoBake) return;
    autoTimer.current = window.setTimeout(() => {
      autoTimer.current = null;
      startBake({ kind: 'full' });
    }, config.autobakeMs);
  }, [autoBake, config.autobakeMs, startBake]);

  // Any recipe or input change cancels the current bake and schedules a new one.
  useEffect(() => {
    if (!tab) return;
    if (booted.current) scheduleAutoBake();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, tab?.text, tab?.encoding, tab?.file, activeTab, autoBake]);

  // Span mapping follows the latest bake intermediates and the selection (DP-28).
  const span = useMemo(() => {
    if (!tab || !tab.selection || tab.selection.start === tab.selection.end || !inputBytes) return null;
    const pausedBefore = bake.kind === 'paused' ? bake.beforeStep : null;
    return mapSpan(steps, inputBytes, tab.selection, intermediates, pausedBefore);
  }, [tab, inputBytes, steps, intermediates, bake]);

  // The span is announced whenever it changes (Feedback states).
  const spanAnnounced = useRef('');
  useEffect(() => {
    if (!span || !tab) return;
    let text: string;
    if (span.outputRange) {
      const lastStep = [...span.chips.keys()].pop();
      const n = lastStep === undefined ? steps.length : lastStep + 1;
      text = `Span maps to characters ${span.outputRange.start} to ${Math.max(span.outputRange.start, span.outputRange.end - 1)} at step ${n}`;
    } else {
      text = `Span lost at step ${(span.lostAt ?? 0) + 1}`;
    }
    if (spanAnnounced.current !== text) {
      spanAnnounced.current = text;
      announce(text);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [span]);

  const outputDisplay = useMemo(() => {
    if (bake.kind === 'error') {
      const step = steps[bake.stepIndex];
      const message = bake.branch
        ? `Operation ${bake.step} (${step?.op}) in branch ${bake.branch}: ${bake.message}`
        : `Operation ${bake.step} (${step?.op}): ${bake.message}`;
      return { text: message, notUtf8: false, truncated: false, totalBytes: 0 };
    }
    if (!output) return { text: '', notUtf8: false, truncated: false, totalBytes: 0 };
    const total = output.length;
    const cap = config.outputDisplayBytes;
    const sliced = total > cap ? output.subarray(0, cap) : output;
    if (outputView === 'Hex') {
      const text = [...sliced].map((b) => b.toString(16).padStart(2, '0')).join(' ');
      return { text, notUtf8: false, truncated: total > cap, totalBytes: total };
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(sliced);
      return { text, notUtf8: false, truncated: total > cap, totalBytes: total };
    } catch {
      const text = [...sliced].map((b) => b.toString(16).padStart(2, '0')).join(' ');
      return { text, notUtf8: true, truncated: total > cap, totalBytes: total };
    }
  }, [output, outputView, config.outputDisplayBytes, bake, steps]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closedByUs = false;
    let retryTimer: number | null = null;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/api/live`);
      ws.onopen = () => { setLivePaused(false); };
      ws.onclose = () => {
        setLivePaused(true);
        // A signed-out visitor gets 401 and must not retry every 2 seconds.
        if (!closedByUs && user !== null) retryTimer = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => { setLivePaused(false); };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as LiveMessage;
          liveHandlerRef.current(msg);
        } catch { /* ignore bad frames */ }
      };
    };
    if (user !== null) connect();
    return () => {
      closedByUs = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      ws?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleLiveMessage = useCallback((msg: LiveMessage) => {
    if (msg.type === 'version_saved' && msg.recipeId === recipeRef.id && msg.authorId !== user?.id) {
      setUpdateBanner({ name: msg.name ?? '', authorName: msg.authorName ?? '', version: msg.version ?? 0 });
      announce(`Recipe updated by ${msg.authorName ?? ''}`);
      setLibraryTick((t) => t + 1);
    }
    if (msg.type === 'membership_changed') {
      setLibraryTick((t) => t + 1);
    }
  }, [recipeRef.id, user?.id, announce]);

  // Live channel: the handler is read through a ref so the socket always sees the
  // latest recipe and user without reconnecting.
  const liveHandlerRef = useRef(handleLiveMessage);
  liveHandlerRef.current = handleLiveMessage;

  // --- mutations ---

  const addStep = useCallback((op: string, args?: Record<string, import('../../shared/catalogue.js').ArgValue>) => {
    setSteps((prev) => [...prev, stepFrom(op, args)]);
    setDirty(true);
    announce(`Added ${op} at step ${steps.length + 1}`);
  }, [steps.length, announce]);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => {
      const op = prev[index]?.op ?? '';
      const next = prev.filter((_, i) => i !== index);
      announce(`Removed ${op} from step ${index + 1}`);
      return next;
    });
    setDirty(true);
  }, [announce]);

  const moveStep = useCallback((index: number, to: number) => {
    setSteps((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(to, 0, moved);
      announce(`Moved ${moved.op} to step ${to + 1}`);
      return next;
    });
    setDirty(true);
  }, [announce]);

  const setStepArg = useCallback((index: number, key: string, value: string | number | boolean) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, args: { ...s.args, [key]: value } } : s)));
    setDirty(true);
  }, []);

  const toggleDisabled = useCallback((index: number) => {
    const willDisable = !steps[index]?.disabled;
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, disabled: !s.disabled } : s)));
    setDirty(true);
    announce(willDisable ? `Disabled step ${index + 1}` : `Enabled step ${index + 1}`);
  }, [steps, announce]);

  const toggleBreakpoint = useCallback((index: number) => {
    const willSet = !steps[index]?.breakpoint;
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, breakpoint: !s.breakpoint } : s)));
    setDirty(true);
    announce(willSet ? `Breakpoint set on step ${index + 1}` : `Breakpoint cleared on step ${index + 1}`);
  }, [steps, announce]);

  const clearRecipe = useCallback(() => {
    setSteps([]);
    setRecipeRef({ id: null, name: 'Unsaved recipe', baseVersion: 0, savedName: null, owner: 'user', ownerId: null, ownerName: 'Personal' });
    setDirty(false);
    announce('Recipe cleared');
  }, [announce]);

  const setTabText = useCallback((text: string) => {
    const bytes = encodeInput(text, tab?.encoding ?? 'UTF-8');
    if ('error' in bytes) {
      setInputAlert(bytes.error);
      return;
    }
    if (bytes.bytes.length > config.inputMaxBytes) {
      setInputAlert(`Input too large: ${bytes.bytes.length} bytes (limit ${config.inputMaxBytes} bytes).`);
      return;
    }
    setInputAlert(null);
    setLinkField(null);
    setTabs((prev) => prev.map((t) => (t.id === activeTab ? { ...t, text, file: null, selection: null } : t)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.encoding, activeTab, config.inputMaxBytes]);

  const setTabEncoding = useCallback((enc: InputTab['encoding']) => {
    setTabs((prev) => prev.map((t) => (t.id === activeTab ? { ...t, encoding: enc } : t)));
  }, [activeTab]);

  const setTabFile = useCallback((file: InputTab['file']) => {
    setLinkField(null);
    setTabs((prev) => prev.map((t) => (t.id === activeTab ? { ...t, file, selection: null } : t)));
  }, [activeTab]);

  const setTabSelection = useCallback((sel: { start: number; end: number } | null) => {
    setTabs((prev) => prev.map((t) => (t.id === activeTab ? { ...t, selection: sel } : t)));
  }, [activeTab]);

  const selectTab = useCallback((id: string) => {
    setActiveTab(id);
  }, []);

  const addTab = useCallback(() => {
    setTabs((prev) => {
      if (prev.length >= 10) return prev;
      const t = newTab(prev.length + 1);
      setActiveTab(t.id);
      return [...prev, t];
    });
  }, []);

  const bakeNow = useCallback(() => {
    if (bake.kind === 'paused') {
      startBake({ kind: 'resume', beforeStep: bake.beforeStep });
      return;
    }
    startBake({ kind: 'full' });
  }, [bake, startBake]);

  const stepOnce = useCallback(() => {
    const enabledCount = steps.filter((s) => !s.disabled).length;
    if (bake.kind === 'paused') {
      const already = steps.slice(0, bake.beforeStep).filter((s) => !s.disabled).length;
      startBake({ kind: 'step', alreadyRun: already });
    } else {
      startBake({ kind: 'step', alreadyRun: 0 });
    }
    void enabledCount;
  }, [bake, steps, startBake]);

  const saveRecipe = useCallback(async (name: string, note: string, tags: string, owner: { type: 'user' | 'team'; id?: string }) => {
    try {
      if (recipeRef.id === null) {
        const r = await api.createRecipe({ name, owner, tags, note, steps });
        setRecipeRef((prev) => ({ ...prev, id: r.recipe.id, name: r.recipe.name, savedName: r.recipe.name, baseVersion: r.version.n, owner: r.recipe.owner.type, ownerId: r.recipe.owner.id, ownerName: r.recipe.owner.name }));
        setDirty(false);
        announce(`Recipe saved as version ${r.version.n}`);
        setLibraryTick((t) => t + 1);
        return 'saved';
      }
      const r = await api.saveVersion(recipeRef.id, { baseVersion: recipeRef.baseVersion, name, note, tags, steps });
      setRecipeRef((prev) => ({ ...prev, name: r.recipe.name, savedName: r.recipe.name, baseVersion: r.version.n }));
      setDirty(false);
      announce(`Recipe saved as version ${r.version.n}`);
      setLibraryTick((t) => t + 1);
      return 'saved';
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) return 'conflict';
      throw e;
    }
  }, [recipeRef, steps, announce]);

  const markSaved = useCallback((recipe: RecipeSummary, version: RecipeVersion) => {
    setRecipeRef({ id: recipe.id, name: recipe.name, savedName: recipe.name, baseVersion: version.n, owner: recipe.owner.type, ownerId: recipe.owner.id, ownerName: recipe.owner.name });
    setDirty(false);
  }, []);

  const loadVersion = useCallback(async (recipeId: string, version: number) => {
    const r = await api.version(recipeId, version);
    setSteps(r.version.steps);
    const summary = await api.recipe(recipeId);
    setRecipeRef({ id: recipeId, name: r.version.name, savedName: summary.recipe.name, baseVersion: version, owner: summary.recipe.owner.type, ownerId: summary.recipe.owner.id, ownerName: summary.recipe.owner.name });
    setDirty(false);
  }, []);

  const openRecipeLink = useCallback((newSteps: Step[], input: Uint8Array, notUtf8: boolean) => {
    setSteps(newSteps);
    setRecipeRef({ id: null, name: 'Unsaved recipe', baseVersion: 0, savedName: null, owner: 'user', ownerId: null, ownerName: 'Personal' });
    setDirty(false);
    const t = newTab(1);
    if (notUtf8) {
      t.file = { id: `local-${Date.now()}`, name: 'input.bin', bytes: input };
      t.text = new TextDecoder('utf-8', { fatal: false }).decode(input);
    } else {
      t.text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    }
    setTabs([t]);
    setActiveTab(t.id);
  }, []);

  const loadLatest = useCallback(async () => {
    if (recipeRef.id === null) return;
    const r = await api.recipe(recipeRef.id);
    const latest = r.recipe.latestVersion;
    await loadVersion(recipeRef.id, latest);
    setUpdateBanner(null);
  }, [recipeRef.id, loadVersion]);

  const showLink = useCallback((link: string | null) => {
    setLinkField(link);
    if (link) announce('Link copied');
  }, [announce]);

  const setFavourites = useCallback((f: string[]) => {
    setFavouritesState(f);
    localStorage.setItem('wringbench.favourites', JSON.stringify(f));
  }, []);

  return {
    config,
    user,
    steps,
    tabs,
    activeTab: tab?.id ?? '',
    bake,
    output,
    outputDisplay,
    autoBake,
    busyBake: bake.kind === 'running',
    span,
    recipeRef,
    dirty,
    announcements,
    inputAlert,
    topAlert,
    linkField,
    updateBanner,
    livePaused,
    favourites,
    suggestions,
    busy: {},
    addStep,
    removeStep,
    moveStep,
    setStepArg,
    toggleDisabled,
    toggleBreakpoint,
    clearRecipe,
    setTabText,
    setTabEncoding,
    setTabFile,
    setTabSelection,
    selectTab,
    addTab,
    bakeNow,
    resume: bakeNow,
    step: stepOnce,
    setAutoBake,
    setOutputView,
    outputView,
    announce,
    setTopAlert,
    setInputAlert,
    saveRecipe,
    markSaved,
    loadVersion,
    refreshLibrarySignal: () => setLibraryTick((t) => t + 1),
    openRecipeLink,
    showLink,
    dismissUpdate: () => setUpdateBanner(null),
    loadLatest,
    setFavourites,
    editFavourites,
    setEditFavourites,
    libraryTick,
    encodingError,
    inputBytes,
  };
}


