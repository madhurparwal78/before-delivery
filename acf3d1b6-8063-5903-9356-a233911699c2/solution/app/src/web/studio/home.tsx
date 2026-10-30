import { useEffect, useRef, useState } from 'preact/hooks';
import { Spinner } from '../ui/spinner.js';
import {
  ASPECTS,
  DURATIONS,
  IMAGE_COUNT_MAX,
  IMAGE_COUNT_MIN,
  MODELS,
  TEMPLATE_TABS,
  generationCost,
  modelOf,
  type Aspect,
  type ModelId,
} from '../../shared/catalog.js';
import { checkGeneration, type FieldErrors } from '../../shared/rules.js';
import { PENDING_PROMPT, api } from '../api.js';
import type { Generation, Project } from '../data.js';
import { Art } from '../ui/art.js';
import { ChevronDown, Refresh } from '../ui/icons.js';
import { TabPanel, Tabs } from '../ui/tabs.js';
import { GenerationCard, useGenerationUpdates } from './generation-card.js';
import { FOCUS_PROMPT_EVENT, promptFocus, useSession } from './layout.js';

const RECENT = 5;

/** A fresh key for every press of Generate, so a repeated request is charged once. */
function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function ChoiceGroup<T extends string | number>({
  name,
  legend,
  choices,
  value,
  onChange,
  label,
}: {
  name: string;
  legend: string;
  choices: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: (value: T) => string;
}) {
  return (
    <fieldset class="choice-group">
      <legend>{legend}</legend>
      <div class="choices">
        {choices.map((choice) => (
          <label key={choice} class="choice">
            <input type="radio" name={name} checked={choice === value} onChange={() => onChange(choice)} />
            <span>{label(choice)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The five newest generations of the workspace, read project by project. */
async function recentGenerations(projects: Project[]): Promise<Generation[]> {
  const lists = await Promise.all(
    projects.filter((p) => p.generation_count > 0).map((p) => api<Generation[]>('GET', `/projects/${p.id}/generations`)),
  );
  return lists
    .flatMap((reply) => (reply.ok ? reply.data : []))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, RECENT);
}

export function StudioHome() {
  const { me, refresh } = useSession();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [recent, setRecent] = useState<Generation[] | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState<ModelId>('vela-4.5');
  const [duration, setDuration] = useState<number>(5);
  const [images, setImages] = useState('1');
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [projectId, setProjectId] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [refusal, setRefusal] = useState('');
  const [saving, setSaving] = useState(false);
  const [templateTab, setTemplateTab] = useState(0);
  const saving$ = useRef(false);
  const promptBox = useRef<HTMLTextAreaElement>(null);

  const model = modelOf(modelId)!;
  const video = model.kind === 'video';
  const imageCount = Number(images);
  const countValid = Number.isInteger(imageCount) && imageCount >= IMAGE_COUNT_MIN && imageCount <= IMAGE_COUNT_MAX;
  const cost = video ? generationCost(model, duration, null) : countValid ? generationCost(model, null, imageCount) : null;

  useEffect(() => {
    const pending = sessionStorage.getItem(PENDING_PROMPT);
    if (pending) {
      sessionStorage.removeItem(PENDING_PROMPT);
      setPrompt(pending);
    }
    const focus = () => {
      promptFocus.wanted = false;
      promptBox.current?.focus();
    };
    if (promptFocus.wanted) focus();
    window.addEventListener(FOCUS_PROMPT_EVENT, focus);
    api<Project[]>('GET', '/projects').then(async (reply) => {
      if (!reply.ok) return;
      setProjects(reply.data);
      setProjectId((current) => current || reply.data[0]?.id || '');
      setRecent(await recentGenerations(reply.data));
    });
    return () => window.removeEventListener(FOCUS_PROMPT_EVENT, focus);
  }, []);

  const replace = (generation: Generation) =>
    setRecent((list) => list && list.map((item) => (item.id === generation.id ? generation : item)));
  useGenerationUpdates(recent, replace);

  const generate = async (event: Event) => {
    event.preventDefault();
    if (saving$.current) return;
    setRefusal('');
    const body = {
      project_id: projectId,
      model: modelId,
      prompt,
      duration: video ? duration : null,
      image_count: video ? null : imageCount,
      aspect,
    };
    const checked = checkGeneration(body);
    if (!checked.ok) {
      setErrors(checked.errors);
      if (checked.errors.prompt) promptBox.current?.focus();
      return;
    }
    setErrors({});
    saving$.current = true;
    setSaving(true);
    const reply = await api<Generation>('POST', '/generations', body, { 'Idempotency-Key': newIdempotencyKey() });
    saving$.current = false;
    setSaving(false);
    if (reply.ok) {
      setLanded(reply.data.id);
      setRecent((list) => [reply.data, ...(list ?? []).filter((g) => g.id !== reply.data.id)].slice(0, RECENT));
      await refresh();
      return;
    }
    const b = reply.data as unknown as Record<string, number>;
    if (reply.error === 'insufficient_credits') setRefusal(`Not enough credits. This needs ${b.needed} and you have ${b.balance}.`);
    else if (reply.error === 'parallel_limit') setRefusal(`Your plan runs ${b.limit} generations at a time. Wait for one to finish.`);
    else if (reply.status === 404) setRefusal('That project does not exist.');
    else if (reply.errors) setErrors(reply.errors);
  };

  return (
    <div class="studio-page studio-home">
      <h1 class="heading studio-title">What will you create today?</h1>
      <form class="composer" noValidate onSubmit={generate}>
        <div class={`field${errors.prompt ? ' has-error' : ''}`}>
          <label for="prompt" class="composer-label">
            Prompt
          </label>
          <textarea
            id="prompt"
            ref={promptBox}
            class="composer-prompt"
            placeholder="Type your thoughts..."
            rows={3}
            value={prompt}
            onInput={(e) => setPrompt((e.currentTarget as HTMLTextAreaElement).value)}
            aria-describedby={errors.prompt ? 'prompt-error' : undefined}
            aria-invalid={errors.prompt ? 'true' : undefined}
          />
          {errors.prompt && (
            <p id="prompt-error" class="field-error" role="alert">
              {errors.prompt}
            </p>
          )}
        </div>
        <div class="composer-options">
          <ChoiceGroup
            name="model"
            legend="Model"
            choices={MODELS.map((m) => m.id)}
            value={modelId}
            onChange={setModelId}
            label={(id) => modelOf(id)!.name}
          />
          {video ? (
            <ChoiceGroup
              name="length"
              legend="Length"
              choices={DURATIONS}
              value={duration as (typeof DURATIONS)[number]}
              onChange={setDuration}
              label={(seconds) => `${seconds} seconds`}
            />
          ) : (
            <div class={`field field-compact${errors.image_count ? ' has-error' : ''}`}>
              <label for="images">Images</label>
              <input
                id="images"
                class="input input-number"
                type="number"
                min={IMAGE_COUNT_MIN}
                max={IMAGE_COUNT_MAX}
                step={1}
                value={images}
                onInput={(e) => setImages((e.currentTarget as HTMLInputElement).value)}
                aria-describedby={errors.image_count ? 'images-error' : undefined}
                aria-invalid={errors.image_count ? 'true' : undefined}
              />
              {errors.image_count && (
                <p id="images-error" class="field-error">
                  {errors.image_count}
                </p>
              )}
            </div>
          )}
          <ChoiceGroup name="aspect" legend="Aspect" choices={ASPECTS} value={aspect} onChange={setAspect} label={(a) => a} />
          <div class="field field-compact">
            <label for="project">Project</label>
            <div class="select-wrap">
              <select
                id="project"
                class="input select"
                value={projectId}
                onChange={(e) => setProjectId((e.currentTarget as HTMLSelectElement).value)}
              >
                {(projects ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <ChevronDown class="select-chevron" />
            </div>
          </div>
        </div>
        <div class="composer-foot">
          <p class="cost-line" aria-live="polite">
            {cost === null ? (
              'Choose 1 to 4 images'
            ) : (
              <>
                This will use <span class="figure">{cost}</span> credits
              </>
            )}
          </p>
          <p class="unit-price">
            <span class="figure">{model.credits_per_unit}</span> credits per {video ? 'second' : 'image'}
          </p>
          <button
            type="submit"
            class={`button button-accent button-large${saving ? ' is-saving' : ''}`}
            disabled={saving || !me}
            aria-disabled={saving ? 'true' : undefined}
          >
            {saving && <Spinner />}
            Generate
          </button>
        </div>
        {refusal && (
          <p class="composer-refusal" role="alert">
            {refusal}
          </p>
        )}
      </form>

      <section class="templates" aria-labelledby="templates-title">
        <h2 id="templates-title" class="sr-only">
          Templates
        </h2>
        <Tabs
          id="templates"
          label="Templates"
          tabs={TEMPLATE_TABS.map((t) => t.name)}
          selected={templateTab}
          onSelect={setTemplateTab}
          class="tablist-scroll"
        />
        <TabPanel id="templates" selected={templateTab} class="template-grid">
          {TEMPLATE_TABS[templateTab].templates.map((template) => (
            <button
              key={template.title}
              type="button"
              class="card template-card"
              onClick={() => {
                setPrompt(template.prompt);
                promptBox.current?.focus();
              }}
            >
              <Art phrase={template.prompt} aspect="16:9" class="template-art" />
              <span class="template-title">{template.title}</span>
              <span class="template-try">
                <Refresh size={14} /> Try
              </span>
            </button>
          ))}
        </TabPanel>
      </section>

      <section class="recent" aria-labelledby="recent-title">
        <h2 id="recent-title" class="heading-small">
          Recent generations
        </h2>
        {recent === null ? (
          <div class="card-grid">
            <div class="skeleton skeleton-card" />
            <div class="skeleton skeleton-card" />
            <div class="skeleton skeleton-card" />
          </div>
        ) : recent.length === 0 ? (
          <p class="empty-line">No generations yet. Write a prompt above and press Generate.</p>
        ) : (
          <div class="card-grid">
            {recent.map((generation) => (
              <GenerationCard key={generation.id} generation={generation} onChange={replace} landing={generation.id === landed} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
