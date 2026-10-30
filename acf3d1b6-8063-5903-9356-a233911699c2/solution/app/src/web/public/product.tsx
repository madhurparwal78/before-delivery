import { useState } from 'preact/hooks';
import { MODELS } from '../../shared/catalog.js';
import { Art } from '../ui/art.js';
import { Tabs } from '../ui/tabs.js';

const MODEL_LINES: Record<string, string> = {
  'vela-4.5': 'Our most cinematic video model: steady camera moves, believable light and motion that holds for the whole shot.',
  'vela-4-turbo': 'Fast video drafts for exploring ideas, storyboards and social cuts at half the credits per second.',
  'vela-image-4': 'Detailed stills for key art, product shots and mood boards, priced per image.',
};

const TOOLS: [string, string][] = [
  ['Transform Video', 'Restyle footage you describe into a new look, season or medium while keeping its motion intact.'],
  ['Mood Boards', 'Explore a direction in a grid of drawn frames before a single shot is planned.'],
  ['Virtual Staging', 'Furnish and light an empty room in any style for listings and walkthroughs.'],
  ['Character Performance', 'Give a character a performance, from a glance to a full scene, with consistent looks.'],
  ['Virtual Try-On', 'Show garments and accessories on people in motion, in any setting you describe.'],
  ['Design Explorations', 'Iterate on products, packaging and spaces with dozens of variations in minutes.'],
  ['Storyboarding', 'Turn a script into a sequence of framed shots your team can review together.'],
  ['Animatics', 'Bring a storyboard to life with timing, camera moves and rough motion.'],
  ['Generate Yourself', 'Put yourself in the scene from a description, in any style or place.'],
  ['Visual Effects', 'Add weather, light and atmosphere to a shot without a VFX pipeline.'],
];

const APPS: [string, string][] = [
  ['Remove from Video', 'Remove anything from any video with a simple prompt.'],
  ['Reshoot Product', 'Place a product in a new scene, light and angle without a new shoot.'],
  ['Upscale Video', 'Sharpen footage to a higher resolution with natural detail.'],
  ['Add Dialogue', 'Give characters spoken lines with matching lip movement.'],
  ['Change Image Style', 'Redraw a picture in another style while keeping its composition.'],
  ['Add Performance', 'Animate a still character with gestures and expression.'],
  ['Change Backdrop', 'Swap the background of a shot for any place you describe.'],
  ['Change Time of Day', 'Move a scene from noon to dusk or night with matching light.'],
  ['Relight Scene', 'Change the direction, colour and softness of the light in a shot.'],
];

export function ProductPage() {
  const [tool, setTool] = useState(0);
  return (
    <>
      <section class="page-hero container">
        <h1 class="display">A new frontier for video generation.</h1>
        <div class="page-hero-actions">
          <a class="pill pill-dark pill-large" href="/signup">Get Started</a>
          <p class="caption">Used by 60M+ users globally - try today and cancel anytime</p>
        </div>
        <Art phrase="A new frontier for video generation, dawn light over layered hills" aspect="16:9" class="frame-art" />
      </section>

      <section class="section container">
        <h2 class="heading section-title">Every model you need to make anything you want.</h2>
        <div class="grid-3">
          {MODELS.map((model) => (
            <article key={model.id} class="card model-card">
              <Art phrase={`${model.name} ${MODEL_LINES[model.id]}`} aspect="16:9" class="card-art" />
              <h3>{model.name}</h3>
              <p>{MODEL_LINES[model.id]}</p>
              <p class="figure-line">
                <span class="figure">{model.credits_per_unit}</span> credits per {model.kind === 'video' ? 'second' : 'image'}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section class="section container">
        <h2 class="heading section-title">Dozens of tools. Endless ways to create.</h2>
        <Tabs
          id="tools"
          label="Creative tools"
          tabs={TOOLS.map(([name]) => name)}
          selected={tool}
          onSelect={setTool}
          class="tablist-scroll"
          panels={TOOLS.map(([name, text]) => (
            <div class="feature">
              <div class="feature-copy">
                <h3 class="heading">{name}</h3>
                <p>{text}</p>
              </div>
              <Art phrase={`${name}: ${text}`} aspect="16:9" class="feature-art" />
            </div>
          ))}
        />
      </section>

      <section class="section container">
        <h2 class="heading section-title">Explore other apps</h2>
        <div class="grid-3">
          {APPS.map(([name, text]) => (
            <article key={name} class="card tile">
              <h3>{name}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
