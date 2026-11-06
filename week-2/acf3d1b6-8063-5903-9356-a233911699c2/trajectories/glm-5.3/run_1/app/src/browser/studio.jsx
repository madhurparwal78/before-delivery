// The signed-in studio: sidebar, composer, projects, generations, credits and team.
import { useState, useEffect, useContext, useRef, useCallback } from 'preact/hooks';
import { createContext } from 'preact';
import { api, ApiError, fmtCredits, fmtSigned, utcDateTime, utcDate, dayHeading,
  Dialog, FieldError, ErrorBanner, Spinner, IconPlus, IconHome, IconRefresh,
  toast, clearToken, takeTryPrompt,
} from './client.jsx';
import { MODELS, TEMPLATES, generationCost, modelById, PLANS } from '../content.mjs';
import { artUri } from '../art.mjs';

// ---------------------------------------------------------------- session

const SessionContext = createContext(null);

/** Session for the studio pages; the provider lives in StudioLayout. */
export function useSession() {
  return useContext(SessionContext);
}

function StudioSidebar({ session, path, onNavigate, drawerOpen, setDrawerOpen, sideRef }) {
  const nav = (e, href) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    onNavigate(href);
  };
  const logout = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    clearToken();
    location.href = '/login';
  };
  const link = (href, label, icon) => (
    <a class="side-link" href={href} aria-current={path === href ? 'page' : null}
      onClick={(e) => nav(e, href)}>{icon}{label}</a>
  );
  return (
    <aside class={`sidebar ${drawerOpen ? 'open' : ''}`} aria-label="Studio navigation" ref={sideRef}>
      <div class="spread" style="margin-bottom:10px">
        <a class="wordmark" href="/studio" aria-label="Kinora" onClick={(e) => nav(e, '/studio')}>
          <span class="dot" aria-hidden="true" />kinora <span class="caption" style="font-weight:400">Creative</span>
        </a>
      </div>
      <a class="new-gen" href="/studio" aria-label="New generation"
        onClick={(e) => { e.preventDefault(); onNavigate('/studio', { focusPrompt: true }); }}>
        <span class="plus" aria-hidden="true"><IconPlus /></span>New generation
      </a>
      <nav aria-label="Studio">
        {link('/studio', 'Home', <IconHome />)}
        {link('/studio/projects', 'Projects')}
        {link('/studio/credits', 'Credits')}
        {link('/studio/team', 'Team')}
      </nav>
      <div class="sidebar-footer">
        <span class="who">{session?.user?.name}</span>
        <span>{session?.workspace?.name}</span>
        <span class="caption">{session?.workspace ? planName(session.workspace.plan) : ''}</span>
        <span class="balance">{session ? `${fmtCredits(session.balance)} credits` : ''}</span>
        <button type="button" class="side-logout" onClick={logout}>Log out</button>
      </div>
    </aside>
  );
}

function planName(planId) {
  return PLANS.find(p => p.id === planId)?.name || planId;
}

function StudioLayout({ children, path, onNavigate }) {
  const [session, setSession] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | out
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sideRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api('/api/me').then((res) => {
      if (!alive) return;
      setSession(res); setState('ready');
    }).catch(() => {
      if (!alive) return;
      if (typeof window !== 'undefined') location.href = '/login';
      else setState('out');
    });
    return () => { alive = false; };
  }, []);

  // The phone drawer behaves like a dialog: focus moves in, Tab stays in,
  // Escape closes it and focus returns to the control that opened it.
  useEffect(() => {
    if (!drawerOpen) return;
    const node = sideRef.current;
    const opener = document.activeElement;
    const items = node ? Array.from(node.querySelectorAll('a, button')) : [];
    if (items.length) items[0].focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setDrawerOpen(false); return; }
      if (e.key === 'Tab' && node) {
        const focusables = Array.from(node.querySelectorAll('input, button, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')).filter(el => !el.disabled);
        if (!focusables.length) return;
        const first = focusables[0]; const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!node.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [drawerOpen]);

  const refresh = useCallback(async () => {
    try { setSession(await api('/api/me')); } catch {}
  }, []);

  if (state !== 'ready') {
    return (
      <div class="studio-layout">
        <div class="work"><p class="caption">Loading…</p></div>
      </div>
    );
  }

  return (
    <SessionContext.Provider value={{ session, refresh }}>
      <div class="studio-layout">
        {drawerOpen && <div class="drawer-overlay" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
        <StudioSidebar session={session} path={path} sideRef={sideRef}
          onNavigate={(href) => { setDrawerOpen(false); onNavigate(href); }}
          drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen} />
        <div class="work">
          <div class="studio-top">
            <button type="button" class="menu-open-btn" aria-label="Menu" aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(!drawerOpen)}>
              <svg class="icon icon-lg" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
            </button>
          </div>
          {children}
        </div>
      </div>
    </SessionContext.Provider>
  );
}

// ---------------------------------------------------------------- generation card

function GenerationPreview({ gen }) {
  const model = modelById(gen.model);
  if (gen.status === 'ready') {
    return (
      <div class="gen-preview" style={{ aspectRatio: aspectCss(gen.aspect) }}>
        <img src={`/api/generations/${gen.id}/output`} alt={gen.prompt} />
      </div>
    );
  }
  return (
    <div class="gen-preview" style={{ aspectRatio: aspectCss(gen.aspect) }}>
      <div class="placeholder" aria-hidden="true" />
      {(gen.status === 'queued' || gen.status === 'rendering') && <div class="bar" aria-hidden="true" />}
    </div>
  );
}

function aspectCss(aspect) {
  if (aspect === '9:16') return '9/16';
  if (aspect === '1:1') return '1/1';
  return '16/9';
}

function statusWord(s) {
  return { queued: 'Queued', rendering: 'Rendering', ready: 'Ready', cancelled: 'Cancelled' }[s] || s;
}

export function GenerationCard({ gen: initial, onBalanceChange, showCancel = true }) {
  const [gen, setGen] = useState(initial);
  const [cancelling, setCancelling] = useState(false);
  const [announce, setAnnounce] = useState('');

  useEffect(() => {
    setGen(initial);
  }, [initial]);

  useEffect(() => {
    if (gen.status !== 'queued' && gen.status !== 'rendering') return;
    let alive = true;
    let timer;
    const poll = async () => {
      try {
        const next = await api(`/api/generations/${gen.id}`);
        if (!alive) return;
        if (next.status !== gen.status) {
          setAnnounce(`Generation ${statusWord(next.status)}`);
          setGen(next);
          if (next.status === 'ready' || next.status === 'cancelled') onBalanceChange?.();
        } else setGen(next);
      } catch {} finally {
        if (alive && (gen.status === 'queued' || gen.status === 'rendering')) {
          timer = setTimeout(poll, 1600);
        }
      }
    };
    timer = setTimeout(poll, 1600);
    return () => { alive = false; clearTimeout(timer); };
  }, [gen.id, gen.status]);

  const cancel = async () => {
    setCancelling(true);
    try {
      const next = await api(`/api/generations/${gen.id}/cancel`, { method: 'POST' });
      setGen(next);
      toast(`Cancelled. ${next.cost} credits returned.`, 'success');
      onBalanceChange?.();
    } catch (e) {
      toast('Could not cancel this generation.');
    } finally {
      setCancelling(false);
    }
  };

  const model = modelById(gen.model);
  return (
    <article class="card gen-card">
      <div class="visually-hidden" role="status" aria-live="polite">{announce}</div>
      <GenerationPreview gen={gen} />
      <div class="gen-body">
        <p class="gen-prompt">{gen.prompt}</p>
        <div class="gen-meta">
          <span class={`status-chip ${gen.status}`}>{statusWord(gen.status)}</span>
        </div>
        <div class="gen-meta">
          <span>{model?.name || gen.model}</span>
          <span class="sep" />
          <span>{model?.kind === 'image' ? `${gen.image_count} image${gen.image_count > 1 ? 's' : ''}` : `${gen.duration} s`}</span>
          <span class="sep" />
          <span>{gen.aspect}</span>
        </div>
        <div class="spread">
          <span class="gen-cost">{gen.cost} credits</span>
          <span class="caption">{gen.started_by}</span>
        </div>
        {showCancel && (gen.status === 'queued' || gen.status === 'rendering') && (
          <button type="button" class="btn btn-light btn-sm" onClick={cancel} disabled={cancelling}>
            {cancelling ? <Spinner dark /> : 'Cancel'}
          </button>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------- studio home (composer)

function Choice({ label, checked, onChange, name }) {
  return (
    <label class={`radio-card ${checked ? 'checked' : ''}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function Composer({ onStarted, prompt, setPrompt, focusRef }) {
  const { session, refresh } = useSession();
  const [projects, setProjects] = useState([]);
  const [model, setModel] = useState('vela-4.5');
  const [duration, setDuration] = useState(5);
  const [imageCount, setImageCount] = useState(1);
  const [aspect, setAspect] = useState('16:9');
  const [projectId, setProjectId] = useState(null);
  const [promptError, setPromptError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [banner, setBanner] = useState(null);
  const idemKey = useRef(null);

  useEffect(() => {
    api('/api/projects').then((rows) => {
      setProjects(rows);
      if (rows.length) setProjectId(rows[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (focusRef && focusRef.current) focusRef.current.focus();
  }, [focusRef]);

  useEffect(() => {
    const carried = takeTryPrompt();
    if (carried) setPrompt(carried);
  }, []);

  const chosenModel = modelById(model);
  const cost = generationCost(model, chosenModel?.kind === 'video' ? duration : null,
    chosenModel?.kind === 'image' ? imageCount : null);

  const start = async () => {
    if (!prompt.trim()) { setPromptError('Write a prompt first.'); return; }
    setPromptError(null);
    setStarting(true);
    setBanner(null);
    if (!idemKey.current) idemKey.current = (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`);
    try {
      const gen = await api('/api/generations', {
        method: 'POST',
        idempotencyKey: idemKey.current,
        body: {
          project_id: projectId,
          model, prompt,
          duration: chosenModel.kind === 'video' ? duration : null,
          image_count: chosenModel.kind === 'image' ? imageCount : null,
          aspect,
        },
      });
      idemKey.current = null;
      await refresh();
      onStarted?.(gen);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setBanner(`Not enough credits. This needs ${e.payload.needed} and you have ${e.payload.balance}.`);
      } else if (e instanceof ApiError && e.status === 409 && e.payload.error === 'parallel_limit') {
        setBanner(`Your plan runs ${e.payload.limit} generations at a time. Wait for one to finish.`);
      } else if (e instanceof ApiError && e.status === 422 && e.payload.errors) {
        const errs = e.payload.errors;
        if (errs.prompt) setPromptError(errs.prompt);
        setBanner(Object.values(errs)[0]);
      } else {
        setBanner('Could not start this generation.');
      }
      idemKey.current = null;
    } finally {
      setStarting(false);
    }
  };

  return (
    <div class="composer">
      <div class="field" style="margin:0">
        <label for="prompt" id="prompt-label">Prompt</label>
        <textarea id="prompt" ref={focusRef} value={prompt}
          placeholder="Type your thoughts..."
          aria-labelledby="prompt-label" aria-invalid={!!promptError}
          aria-describedby={promptError ? 'prompt-err' : null}
          onInput={(e) => { setPrompt(e.target.value); if (promptError) setPromptError(null); }} />
        <FieldError message={promptError} id="prompt-err" />
      </div>
      <ErrorBanner message={banner} />
      <div class="choices">
        <fieldset class="choice-group" style="border:none;padding:0;margin:0">
          <span id="model-label">Model</span>
          <div class="radio-row" role="radiogroup" aria-labelledby="model-label">
            {MODELS.map(m => (
              <Choice key={m.id} name="model" label={m.name} checked={model === m.id}
                onChange={() => setModel(m.id)} />
            ))}
          </div>
        </fieldset>
        {chosenModel?.kind === 'video' && (
          <fieldset class="choice-group" style="border:none;padding:0;margin:0">
            <span id="length-label">Length</span>
            <div class="radio-row" role="radiogroup" aria-labelledby="length-label">
              {[5, 10].map(d => (
                <Choice key={d} name="length" label={`${d} seconds`} checked={duration === d}
                  onChange={() => setDuration(d)} />
              ))}
            </div>
          </fieldset>
        )}
        {chosenModel?.kind === 'image' && (
          <div class="choice-group">
            <label for="images" id="images-label">Images</label>
            <input id="images" class="input" type="number" min="1" max="4" value={imageCount}
              style="width:110px"
              onInput={(e) => setImageCount(Math.max(1, Math.min(4, Number(e.target.value) || 1)))} />
          </div>
        )}
        <fieldset class="choice-group" style="border:none;padding:0;margin:0">
          <span id="aspect-label">Aspect</span>
          <div class="radio-row" role="radiogroup" aria-labelledby="aspect-label">
            {['16:9', '9:16', '1:1'].map(a => (
              <Choice key={a} name="aspect" label={a} checked={aspect === a}
                onChange={() => setAspect(a)} />
            ))}
          </div>
        </fieldset>
        <div class="choice-group">
          <label for="project">Project</label>
          <select id="project" class="select" style="min-width:180px" value={projectId ?? ''}
            onChange={(e) => setProjectId(Number(e.target.value))}>
            {projects.map(p => <option value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <div class="composer-foot">
        <span class="cost-line">This will use {cost} credits</span>
        <button type="button" class="btn btn-accent" onClick={start} disabled={starting}>
          {starting ? <><Spinner /> Generating</> : 'Generate'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- templates + recent

function TemplateTabs({ onPick }) {
  const [tab, setTab] = useState('marketing');
  const group = TEMPLATES.find(t => t.tab === tab);
  return (
    <div>
      <div class="tablist" role="tablist" aria-label="Starter templates">
        {TEMPLATES.map(t => (
          <button type="button" role="tab" class="tab" aria-selected={tab === t.tab}
            onClick={() => setTab(t.tab)}>{t.label}</button>
        ))}
      </div>
      <div class="tmpl-grid" style="margin-top:18px" role="tabpanel">
        {group.cards.map(c => (
          <button type="button" class="tmpl-card" onClick={() => onPick(c.prompt)}>
            <div class="tmpl-art">
              <img src={artUri(c.prompt, '16:9')} alt="" />
            </div>
            <strong style="color:var(--ink);font-size:0.98rem">{c.title}</strong>
            <span class="row" style="gap:6px;color:var(--accent);font-size:0.86rem;font-weight:560">
              <IconRefresh /> Try
            </span>
            <span class="caption" style="font-size:0.85rem">{c.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function StudioHomePage({ path, navigate }) {
  return (
    <StudioLayout path={path} onNavigate={navigate}>
      <StudioHomeContent />
    </StudioLayout>
  );
}

function StudioHomeContent() {
  const { refresh } = useSession();
  const [recent, setRecent] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [prompt, setPrompt] = useState('');
  const promptRef = useRef(null);

  const loadRecent = useCallback(async () => {
    try {
      const projects = await api('/api/projects');
      const rows = [];
      for (const p of projects) {
        const gens = await api(`/api/projects/${p.id}/generations`);
        rows.push(...gens);
      }
      rows.sort((a, b) => b.id - a.id);
      setRecent(rows.slice(0, 5));
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => { loadRecent(); }, []);

  const pickTemplate = (starter) => {
    setPrompt(starter);
    if (promptRef.current) promptRef.current.focus();
  };

  return (
    <>
      <h1>What will you create today?</h1>
      <Composer onStarted={() => { refresh(); loadRecent(); }} prompt={prompt} setPrompt={setPrompt} focusRef={promptRef} />
      <section style="margin-top:36px">
        <h2 style="font-size:1.25rem">Starter templates</h2>
        <TemplateTabs onPick={pickTemplate} />
      </section>
      <section style="margin-top:36px">
        <h2 style="font-size:1.25rem">Recent generations</h2>
        {loaded && recent.length === 0 && <p class="caption">No generations yet. Start one from the composer.</p>}
        <div class="gen-grid">
          {recent.map(g => <GenerationCard key={g.id} gen={g} onBalanceChange={refresh} />)}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- projects

function NewProjectDialog({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const project = await api('/api/projects', { method: 'POST', body: { name } });
      onCreated(project);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.payload.error === 'duplicate_name') {
        setError('A project with this name already exists.');
      } else if (e instanceof ApiError && e.status === 409 && e.payload.error === 'project_limit') {
        setError(`Your plan allows up to ${e.payload.limit} project${e.payload.limit === 1 ? '' : 's'}.`);
      } else if (e instanceof ApiError && e.status === 422 && e.payload.errors?.name) {
        setError(e.payload.errors.name);
      } else {
        setError('Could not create the project.');
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="New project" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div class="field">
          <label class="req" for="np-name">Project name</label>
          <input id="np-name" class="input" value={name} autoFocus
            onInput={(e) => { setName(e.target.value); if (error) setError(null); }}
            aria-invalid={!!error} aria-describedby={error ? 'np-err' : null} />
          <FieldError message={error} id="np-err" />
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" class="btn btn-accent" disabled={busy || !name.trim()}>
            {busy ? <><Spinner /> Creating</> : 'Create'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function StudioProjectsPage({ path, navigate }) {
  return (
    <StudioLayout path={path} onNavigate={navigate}>
      <ProjectsContent navigate={navigate} />
    </StudioLayout>
  );
}

function ProjectsContent({ navigate }) {
  const [projects, setProjects] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    try { setProjects(await api('/api/projects')); } catch { setProjects([]); }
  }, []);
  useEffect(() => { load(); }, []);

  return (
    <>
      <div class="spread">
        <h1>Projects</h1>
        <button type="button" class="btn btn-accent" onClick={() => setDialogOpen(true)}>
          <IconPlus />New project
        </button>
      </div>
      {projects === null && <p class="caption">Loading…</p>}
      {projects !== null && projects.length === 0 && (
        <div class="card" style="text-align:center;padding:44px">
          <p style="font-weight:560;color:var(--ink)">No projects yet</p>
          <button type="button" class="btn btn-accent" onClick={() => setDialogOpen(true)}>New project</button>
        </div>
      )}
      <div class="proj-grid" style="margin-top:18px">
        {projects?.map(p => (
          <a class="card card-hover" style="display:block;text-decoration:none"
            href={`/studio/projects/${p.id}`} onClick={(e) => { e.preventDefault(); navigate(`/studio/projects/${p.id}`); }}>
            <h3 style="font-size:1.08rem">{p.name}</h3>
            <p class="caption" style="margin:0">
              {p.generation_count === 0
                ? 'No generations yet'
                : `${p.generation_count} generation${p.generation_count === 1 ? '' : 's'}`}
              {' · '}
              {p.latest_generation_at ? utcDate(p.latest_generation_at) : ''}
            </p>
          </a>
        ))}
      </div>
      {dialogOpen && (
        <NewProjectDialog onClose={() => setDialogOpen(false)}
          onCreated={() => { setDialogOpen(false); load(); }} />
      )}
    </>
  );
}

export function StudioProjectPage({ path, navigate, id }) {
  return (
    <StudioLayout path={path} onNavigate={navigate}>
      <ProjectContent navigate={navigate} id={id} />
    </StudioLayout>
  );
}

function ProjectContent({ navigate, id }) {
  const { refresh } = useSession();
  const [project, setProject] = useState(null);
  const [gens, setGens] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const projects = await api('/api/projects');
      const found = projects.find(p => String(p.id) === String(id));
      if (!found) { setNotFound(true); return; }
      setProject(found);
      setGens(await api(`/api/projects/${id}/generations`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const saveRename = async () => {
    try {
      const updated = await api(`/api/projects/${id}`, { method: 'PATCH', body: { name: renameValue } });
      setProject(updated); setRenaming(false); setRenameError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.payload.error === 'duplicate_name') {
        setRenameError('A project with this name already exists.');
      } else if (e instanceof ApiError && e.status === 422 && e.payload.errors?.name) {
        setRenameError(e.payload.errors.name);
      } else {
        setRenameError('Could not rename the project.');
      }
    }
  };

  const groups = [];
  for (const g of gens || []) {
    const head = dayHeading(g.created_at);
    if (groups.length === 0 || groups[groups.length - 1].day !== head) groups.push({ day: head, items: [] });
    groups[groups.length - 1].items.push(g);
  }

  return (
    <>
      {notFound && <h1>That project does not exist.</h1>}
      {project && (
        <>
          {renaming ? (
            <div class="row" style="gap:10px">
              <label class="visually-hidden" for="rename-input">Project name</label>
              <input id="rename-input" class="input" style="max-width:380px" value={renameValue}
                autoFocus aria-invalid={!!renameError}
                onInput={(e) => { setRenameValue(e.target.value); if (renameError) setRenameError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveRename(); } if (e.key === 'Escape') setRenaming(false); }} />
              <button type="button" class="btn btn-accent btn-sm" onClick={saveRename}>Save</button>
              <button type="button" class="btn btn-light btn-sm" onClick={() => setRenaming(false)}>Cancel</button>
            </div>
          ) : (
            <div class="spread">
              <h1 style="margin:0">{project.name}</h1>
              <button type="button" class="btn btn-light btn-sm"
                onClick={() => { setRenameValue(project.name); setRenaming(true); }}>Rename</button>
            </div>
          )}
          <FieldError message={renameError} />
          {gens === null && <p class="caption">Loading…</p>}
          {gens !== null && gens.length === 0 && (
            <div class="card" style="text-align:center;padding:40px">
              <p style="font-weight:560;color:var(--ink)">No generations yet. Start one from the composer.</p>
              <a class="btn btn-accent" href="/studio" onClick={(e) => { e.preventDefault(); navigate('/studio'); }}>Open the composer</a>
            </div>
          )}
          {groups.map(g => (
            <div>
              <h2 class="day-heading">{g.day}</h2>
              <div class="gen-grid">
                {g.items.map(gen => <GenerationCard key={gen.id} gen={gen} onBalanceChange={refresh} />)}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

export function StudioGenerationPage({ path, navigate, id }) {
  return (
    <StudioLayout path={path} onNavigate={navigate}>
      <GenerationContent id={id} />
    </StudioLayout>
  );
}

function GenerationContent({ id }) {
  const { refresh } = useSession();
  const [gen, setGen] = useState(null);
  const [entries, setEntries] = useState([]);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api(`/api/generations/${id}`).then(setGen).catch((e) => {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
    });
    api('/api/credits').then((res) => {
      setEntries(res.entries.filter(e2 => e2.generation_id === Number(id)));
    }).catch(() => {});
  }, [id]);

  return (
    <>
      {notFound && <h1>That generation does not exist.</h1>}
      {gen && (
        <div style="max-width:760px">
          <h1 style="font-size:1.35rem">Generation</h1>
          <div style="margin-bottom:22px">
            <GenerationCard gen={gen} onBalanceChange={refresh} />
          </div>
          <div class="card">
            <h2 style="font-size:1.1rem">Details</h2>
            <p class="mono" style="margin:0;color:var(--ink)">{gen.prompt}</p>
            <div class="gen-meta" style="margin-top:10px">
              <span>{modelById(gen.model)?.name}</span>
              <span class="sep" />
              <span>{gen.duration ? `${gen.duration} s` : `${gen.image_count} image${gen.image_count > 1 ? 's' : ''}`}</span>
              <span class="sep" />
              <span>{gen.aspect}</span>
              <span class="sep" />
              <span>Cost {gen.cost} credits</span>
              <span class="sep" />
              <span>Started by {gen.started_by}</span>
            </div>
            {entries.length > 0 && (
              <div style="margin-top:14px">
                <h2 style="font-size:1.05rem">Credit history</h2>
                {entries.map(e2 => (
                  <p class="mono" style="margin:4px 0">
                    {e2.kind === 'charge' ? 'Generation' : 'Refund'} {fmtSigned(e2.amount)}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- credits

export function StudioCreditsPage({ path, navigate }) {
  return (
    <StudioLayout path={path} onNavigate={navigate}>
      <CreditsContent />
    </StudioLayout>
  );
}

function CreditsContent() {
  const [data, setData] = useState(null);
  const { session } = useSession();

  useEffect(() => {
    api('/api/credits').then(setData).catch(() => {});
  }, []);

  const kindWord = { plan: 'Plan credits', seat: 'Seat added', charge: 'Generation', refund: 'Refund' };
  const planLine = session?.workspace ? ({
    free: 'Free, 125 credits once',
    standard: 'Standard, 625 credits a month',
    pro: 'Pro, 2,250 credits a month',
    max: 'Max, 9,500 credits a month',
    team: 'Team, 6,900 credits per seat',
  }[session.workspace.plan]) : null;

  return (
    <>
      <h1>Credits</h1>
      {data === null && <p class="caption">Loading…</p>}
      {data && (
        <>
          <p class="credits-balance" style="margin:6px 0 2px">{fmtCredits(data.balance)} credits</p>
          <p class="caption">{planLine}</p>
          <table class="credit-table" style="margin-top:22px">
            <caption class="visually-hidden">Credit history, newest first</caption>
            <thead>
              <tr><th scope="col">Date (UTC)</th><th scope="col">Kind</th><th scope="col">Person</th><th scope="col">Change</th><th scope="col">Balance</th></tr>
            </thead>
            <tbody>
              {data.entries.map(e => (
                <tr>
                  <td class="mono">{utcDateTime(e.created_at)}</td>
                  <td><span class={`status-chip kind-${e.kind}`}>{kindWord[e.kind]}</span></td>
                  <td>{e.user_name}</td>
                  <td class={e.amount >= 0 ? 'amount-pos' : 'amount-neg'}>{fmtSigned(e.amount)}</td>
                  <td class="mono">{fmtCredits(e.balance_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- team

function InviteDialog({ onClose, onInvited }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api('/api/team/invitations', { method: 'POST', body: { email } });
      onInvited();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError(e.payload.error);
      else if (e instanceof ApiError && e.status === 422 && e.payload.errors?.email) setError(e.payload.errors.email);
      else setError('Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Invite teammate" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div class="field">
          <label class="req" for="inv-email">Email</label>
          <input id="inv-email" class="input" type="email" value={email} autoFocus
            onInput={(e) => { setEmail(e.target.value); if (error) setError(null); }}
            aria-invalid={!!error} aria-describedby={error ? 'inv-email-err' : null} />
          <FieldError message={error} id="inv-email-err" />
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" class="btn btn-accent" disabled={busy || !email.trim()}>
            {busy ? <><Spinner /> Sending</> : 'Send invite'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function StudioTeamPage({ path, navigate }) {
  return (
    <StudioLayout path={path} onNavigate={navigate}>
      <TeamContent />
    </StudioLayout>
  );
}

function TeamContent() {
  const [team, setTeam] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [error, setError] = useState(null);
  const { session } = useSession();
  const isTeamPlan = session?.workspace?.plan === 'team';
  const isOwner = session?.user?.role === 'owner';

  const load = useCallback(async () => {
    try { setTeam(await api('/api/team')); } catch {}
  }, []);
  useEffect(() => { load(); }, []);

  const revoke = async (id) => {
    try { await api(`/api/team/invitations/${id}`, { method: 'DELETE' }); load(); }
    catch (e) { setError(e instanceof ApiError ? e.payload?.error : 'Could not revoke.'); }
  };

  const removeMember = async () => {
    try {
      await api(`/api/team/members/${removing.id}`, { method: 'DELETE' });
      setRemoving(null); load();
    } catch (e) {
      setRemoving(null);
      setError(e instanceof ApiError && e.payload?.error === 'cannot_remove_self'
        ? 'You cannot remove yourself.' : 'Could not remove this member.');
    }
  };

  return (
    <>
      <h1>Team</h1>
      <ErrorBanner message={error} />
      {team === null && <p class="caption">Loading…</p>}
      {team && (
        <>
          {isTeamPlan ? (
            <>
              <p class="seat-line">{team.seats_used} of {team.seat_limit} seats used</p>
              {isOwner && (
                <button type="button" class="btn btn-accent" style="margin:12px 0"
                  onClick={() => setDialogOpen(true)}>
                  <IconPlus />Invite teammate
                </button>
              )}
              <h2>Members</h2>
              <div class="member-list">
                {team.members.map(m => (
                  <div class="member-row">
                    <div>
                      <strong style="color:var(--ink)">{m.name}</strong>
                      <div class="caption">{m.email}</div>
                    </div>
                    <div class="row" style="gap:14px">
                      <span class="caption">{m.role === 'owner' ? 'Owner' : 'Member'} · joined {utcDate(m.created_at)}</span>
                      {isOwner && m.role !== 'owner' && (
                        <button type="button" class="btn btn-danger btn-sm" onClick={() => setRemoving(m)}>Remove</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <h2 style="margin-top:30px">Pending invitations</h2>
              {team.invitations.length === 0 && <p class="caption">No pending invitations.</p>}
              <div class="member-list">
                {team.invitations.map(i => (
                  <div class="member-row">
                    <div>
                      <strong style="color:var(--ink)">{i.email}</strong>
                      <div class="caption">Sent {utcDate(i.created_at)}</div>
                    </div>
                    {isOwner && (
                      <button type="button" class="btn btn-light btn-sm" onClick={() => revoke(i.id)}>Revoke</button>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div class="card" style="max-width:560px">
              <p style="color:var(--ink);font-weight:560">Teams share one credit balance. Team workspaces are set up by our sales team.</p>
              <a class="u-link" href="/team-plan">Learn about the Team plan</a>
            </div>
          )}
        </>
      )}
      {dialogOpen && (
        <InviteDialog onClose={() => setDialogOpen(false)} onInvited={() => { setDialogOpen(false); load(); }} />
      )}
      {removing && (
        <Dialog title="Remove member" onClose={() => setRemoving(null)}>
          <p>Remove {removing.name} from this workspace? Their generations and credits stay, and nothing is refunded.</p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-light" onClick={() => setRemoving(null)}>Cancel</button>
            <button type="button" class="btn btn-danger" onClick={removeMember}>Remove</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
