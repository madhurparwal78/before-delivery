import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { StudioLayout } from './StudioLayout';
import { GenerationCard } from './GenerationCard';
import { Generation, loadRecentGenerations, Project, useRendering } from './data';
import { api, ApiError, newIdempotencyKey } from '../api';
import { Art, Spinner, TabPanel, TabRow } from '../components/ui';
import { RefreshMark } from '../components/Icons';
import { useAuth } from '../store';
import { generationCost, modelById, MODELS, TEMPLATE_TABS } from '../../shared/catalog';
import { creditWords } from '../format';

const ASPECTS: { id: '16:9' | '9:16' | '1:1'; label: string }[] = [
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '1:1', label: '1:1' }
];

const LENGTHS = [
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' }
];

export function StudioHome() {
  const { query } = useLocation();
  const auth = useAuth();

  const [projects, setProjects] = useState<Project[]>([]);
  const [recent, setRecent] = useState<Generation[]>([]);
  const [landedId, setLandedId] = useState<string | null>(null);

  const [prompt, setPrompt] = useState(query.prompt ?? '');
  const [model, setModel] = useState('vela-4.5');
  const [duration, setDuration] = useState(5);
  const [imageCount, setImageCount] = useState(1);
  const [aspect, setAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [projectId, setProjectId] = useState('');
  const [promptError, setPromptError] = useState('');
  const [refusal, setRefusal] = useState('');
  const [starting, setStarting] = useState(false);
  const [templateTab, setTemplateTab] = useState(TEMPLATE_TABS[0].id);

  const chosenModel = modelById(model)!;
  const cost = generationCost(chosenModel, duration, imageCount);

  const reload = async () => {
    const loaded = await api<Project[]>('/api/projects');
    setProjects(loaded);
    setProjectId((current) => current || (loaded[0]?.id ?? ''));
    setRecent(await loadRecentGenerations(loaded));
  };

  useEffect(() => {
    if (auth.state === 'signed-in') void reload();
  }, [auth.state]);

  useRendering(recent, () => void reload());

  const generate = async (event: Event) => {
    event.preventDefault();
    setRefusal('');
    if (!prompt.trim()) {
      setPromptError('Write a prompt first.');
      return;
    }
    setPromptError('');
    setStarting(true);
    try {
      const started = await api<Generation>('/api/generations', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: {
          project_id: projectId,
          model,
          prompt,
          duration: chosenModel.kind === 'video' ? duration : null,
          image_count: chosenModel.kind === 'image' ? imageCount : null,
          aspect
        }
      });
      setLandedId(started.id);
      setRecent((current) => [started, ...current].slice(0, 5));
      await auth.refresh();
      void reload();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 402) {
          setRefusal(
            `Not enough credits. This needs ${error.payload.needed} and you have ${error.payload.balance}.`
          );
        } else if (error.code === 'parallel_limit') {
          setRefusal(`Your plan runs ${error.payload.limit} generations at a time. Wait for one to finish.`);
        } else {
          const fields = Object.values(error.fieldErrors);
          setRefusal(fields[0] ?? 'That generation could not be started.');
        }
      }
    } finally {
      setStarting(false);
    }
  };

  const templates = TEMPLATE_TABS.find((tab) => tab.id === templateTab)!;

  return (
    <StudioLayout current="home">
      <h1 style="font-size:clamp(1.8rem,3vw,2.3rem)">What will you create today?</h1>

      <form class="composer" onSubmit={generate} noValidate>
        <div class="field">
          <label for="field-prompt">Prompt</label>
          <textarea
            class="textarea"
            id="field-prompt"
            name="prompt"
            placeholder="Type your thoughts..."
            value={prompt}
            aria-invalid={promptError ? 'true' : undefined}
            aria-describedby={promptError ? 'field-prompt-error' : undefined}
            onInput={(event) => setPrompt((event.target as HTMLTextAreaElement).value)}
          />
          {promptError ? (
            <span class="field-error" id="field-prompt-error" role="alert">
              {promptError}
            </span>
          ) : null}
        </div>

        <div class="composer-grid">
          <div class="field">
            <span class="field-legend" id="label-model">
              Model
            </span>
            <div class="radio-set" role="radiogroup" aria-labelledby="label-model">
              {MODELS.map((item) => (
                <label class="chip" key={item.id}>
                  <input
                    type="radio"
                    name="model"
                    value={item.id}
                    checked={model === item.id}
                    onChange={() => setModel(item.id)}
                  />
                  {item.name}
                </label>
              ))}
            </div>
          </div>

          {chosenModel.kind === 'video' ? (
            <div class="field">
              <span class="field-legend" id="label-length">
                Length
              </span>
              <div class="radio-set" role="radiogroup" aria-labelledby="label-length">
                {LENGTHS.map((item) => (
                  <label class="chip" key={item.value}>
                    <input
                      type="radio"
                      name="duration"
                      value={item.value}
                      checked={duration === item.value}
                      onChange={() => setDuration(item.value)}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div class="field">
              <label for="field-images">Images</label>
              <input
                class="input"
                id="field-images"
                name="images"
                type="number"
                min={1}
                max={4}
                value={imageCount}
                onInput={(event) => {
                  const raw = Number((event.target as HTMLInputElement).value);
                  setImageCount(Math.min(4, Math.max(1, Number.isFinite(raw) ? raw : 1)));
                }}
              />
            </div>
          )}

          <div class="field">
            <span class="field-legend" id="label-aspect">
              Aspect
            </span>
            <div class="radio-set" role="radiogroup" aria-labelledby="label-aspect">
              {ASPECTS.map((item) => (
                <label class="chip" key={item.id}>
                  <input
                    type="radio"
                    name="aspect"
                    value={item.id}
                    checked={aspect === item.id}
                    onChange={() => setAspect(item.id)}
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </div>

          <div class="field">
            <label for="field-project">Project</label>
            <select
              class="select"
              id="field-project"
              name="project"
              value={projectId}
              onChange={(event) => setProjectId((event.target as HTMLSelectElement).value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {refusal ? (
          <p class="alert" role="alert">
            {refusal}
          </p>
        ) : null}

        <div class="composer-foot">
          <span class="cost-line">This will use {creditWords(cost)}</span>
          <button type="submit" class="btn btn-accent btn-pill btn-big" disabled={starting}>
            {starting ? <Spinner /> : null}
            Generate
          </button>
        </div>
      </form>

      <section style="margin-top:38px">
        <h2 style="font-size:1.3rem">Start from a template</h2>
        <TabRow
          label="Template categories"
          idPrefix="templates"
          tabs={TEMPLATE_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
          value={templateTab}
          onChange={setTemplateTab}
        />
        <div style="margin-top:18px">
          <TabPanel idPrefix="templates" id={templateTab}>
            <div class="card-grid">
              {templates.cards.map((card) => (
                <button
                  type="button"
                  class="card lift"
                  key={card.title}
                  style="cursor:pointer;text-align:left;font:inherit;color:inherit"
                  onClick={() => {
                    setPrompt(card.prompt);
                    document.getElementById('field-prompt')?.focus();
                  }}
                >
                  <Art
                    className="art-thumb"
                    seed={`template ${card.title}`}
                    title={`${card.title} artwork`}
                    decorative
                  />
                  <h3 style="margin:14px 0 6px;font-size:1.05rem">{card.title}</h3>
                  <p class="muted" style="margin:0 0 10px;font-size:.92rem">
                    {card.prompt}
                  </p>
                  <span class="muted" style="align-items:center;display:inline-flex;gap:6px">
                    <RefreshMark />
                    Try
                  </span>
                </button>
              ))}
            </div>
          </TabPanel>
        </div>
      </section>

      <section style="margin-top:38px">
        <h2 style="font-size:1.3rem">Recent generations</h2>
        {recent.length === 0 ? (
          <div class="empty-state">
            <p style="margin:0">No generations yet. Start one from the composer.</p>
          </div>
        ) : (
          <div class="card-grid card-grid-2">
            {recent.map((generation) => (
              <GenerationCard
                key={generation.id}
                generation={generation}
                landed={generation.id === landedId}
                onChanged={() => {
                  void auth.refresh();
                  void reload();
                }}
              />
            ))}
          </div>
        )}
      </section>
    </StudioLayout>
  );
}
