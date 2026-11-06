import { useState } from 'preact/hooks';
import { PublicLayout } from '../components/Chrome';
import { Art, TabPanel, TabRow } from '../components/ui';
import { MODELS } from '../../shared/catalog';

const TOOLS = [
  {
    id: 'transform-video',
    label: 'Transform Video',
    body: 'Keep the take you shot and change the world around it: a new season, a new city, a new palette.'
  },
  {
    id: 'mood-boards',
    label: 'Mood Boards',
    body: 'Fill a board with stills in one consistent light, then carry the winning frame into motion.'
  },
  {
    id: 'virtual-staging',
    label: 'Virtual Staging',
    body: 'Dress an empty room with furniture and daylight that match the architecture already on screen.'
  },
  {
    id: 'character-performance',
    label: 'Character Performance',
    body: 'Hold a character steady across cuts and give them a described performance beat by beat.'
  },
  {
    id: 'virtual-try-on',
    label: 'Virtual Try-On',
    body: 'Put the same garment on different people and let the fabric move the way it should.'
  },
  {
    id: 'design-explorations',
    label: 'Design Explorations',
    body: 'Sweep through shapes, finishes and colourways before anything is tooled.'
  },
  {
    id: 'storyboarding',
    label: 'Storyboarding',
    body: 'Turn a script into numbered frames with the lens and light noted for each shot.'
  },
  {
    id: 'animatics',
    label: 'Animatics',
    body: 'Give the board timing, so a client can feel the pace before a crew is booked.'
  },
  {
    id: 'generate-yourself',
    label: 'Generate Yourself',
    body: 'Build a likeness you control and keep it consistent across a whole campaign.'
  },
  {
    id: 'visual-effects',
    label: 'Visual Effects',
    body: 'Add weather, debris, smoke or light that sits inside the frame instead of on top of it.'
  }
];

const APPS = [
  { name: 'Remove from Video', line: 'Remove anything from any video with a simple prompt.' },
  { name: 'Reshoot Product', line: 'Put the same product in a new set, lens and light.' },
  { name: 'Upscale Video', line: 'Raise a clip to a cleaner resolution without inventing detail.' },
  { name: 'Add Dialogue', line: 'Write a line and have a character speak it in frame.' },
  { name: 'Change Image Style', line: 'Restyle a still while keeping its composition.' },
  { name: 'Add Performance', line: 'Give a figure a described gesture or reaction.' },
  { name: 'Change Backdrop', line: 'Swap the background and keep the subject lit correctly.' },
  { name: 'Change Time of Day', line: 'Move a scene from noon to dusk in one pass.' },
  { name: 'Relight Scene', line: 'Rebuild the lighting of a shot from a description.' }
];

export function Product() {
  const [tool, setTool] = useState(TOOLS[0].id);
  const active = TOOLS.find((item) => item.id === tool)!;

  return (
    <PublicLayout>
      <section class="shell section-tight">
        <div class="hero-frame">
          <div class="hero-art">
            <Art seed="kinora creative suite frontier" title="Creative suite artwork" decorative />
          </div>
          <div class="hero-body">
            <h1>A new frontier for video generation.</h1>
            <a class="btn btn-light btn-pill btn-big" href="/signup">
              Get Started
            </a>
            <p style="margin:18px 0 0;color:#e7e7ee">
              Used by 60M+ users globally - try today and cancel anytime
            </p>
          </div>
        </div>
      </section>

      <section class="shell section">
        <h2>Every model you need to make anything you want.</h2>
        <div class="card-grid" style="margin-top:26px">
          {MODELS.map((model) => (
            <article class="card" key={model.id}>
              <Art className="art-thumb" seed={`model ${model.id}`} title={`${model.name} artwork`} decorative />
              <h3 style="margin-top:16px">{model.name}</h3>
              <p>{model.blurb}</p>
              <p class="mono muted" style="margin:0">
                {model.credits_per_unit} credits {model.kind === 'video' ? 'per second' : 'per image'}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section class="shell section">
        <h2>Dozens of tools. Endless ways to create.</h2>
        <div style="margin-top:22px">
          <TabRow
            label="Creative tools"
            idPrefix="product-tools"
            tabs={TOOLS.map((item) => ({ id: item.id, label: item.label }))}
            value={tool}
            onChange={setTool}
          />
          <div style="margin-top:22px">
            <TabPanel idPrefix="product-tools" id={active.id}>
              <div class="card">
                <h3>{active.label}</h3>
                <p style="margin-bottom:0">{active.body}</p>
              </div>
            </TabPanel>
          </div>
        </div>
      </section>

      <section class="shell section">
        <h2>Explore other apps</h2>
        <div class="card-grid" style="margin-top:24px">
          {APPS.map((app) => (
            <article class="card lift" key={app.name}>
              <h3 style="font-size:1.08rem">{app.name}</h3>
              <p style="margin:0">{app.line}</p>
            </article>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}
