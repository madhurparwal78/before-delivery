import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Art } from '../ui/art.js';
import { ChevronRight } from '../ui/icons.js';
import { EASE_OUT, play } from '../ui/motion.js';
import { Tabs } from '../ui/tabs.js';

const PARTNERS = [
  'Halvard Pictures',
  'Northwind Optics',
  'Lumen & Vale',
  'Orchid Motors',
  'Saltmarsh Media',
  'Bramble Foods',
  'Kestrel Air',
  'Tidewater Labs',
  'Copperline',
  'Ferro Studios',
];

const USES: { tab: string; title: string; text: string; phrase: string }[] = [
  {
    tab: 'How Kinora is Used',
    title: 'From a sentence to a finished shot',
    text: 'Creators, agencies and brand teams write what they want to see and get a short film back in seconds, then refine it shot by shot until it is ready to publish.',
    phrase: 'a calm studio desk at golden hour with a glowing screen',
  },
  {
    tab: 'Create with Agent',
    title: 'Direct a whole sequence in plain words',
    text: 'Describe the story once and the agent plans the shots, keeps characters and light consistent between them and hands you every cut to approve.',
    phrase: 'a storyboard of soft violet frames drifting in sequence',
  },
  {
    tab: 'Build your own Workflows',
    title: 'Turn a good result into a repeatable recipe',
    text: 'Chain models, prompts and steps into a workflow your team can run again on new products, new seasons and new markets without starting over.',
    phrase: 'connected pathways of light over a quiet green valley',
  },
  {
    tab: 'Enterprise-grade',
    title: 'Security and control for whole organisations',
    text: 'Single sign-on, permissions for every team, full ownership of your outputs and a promise that we never train on your data.',
    phrase: 'a steady harbour of deep blue water under a clear sky',
  },
  {
    tab: "The World's Best Models",
    title: 'Vela models, built on Real-World Intelligence',
    text: 'Vela 4.5 for cinematic video, Vela 4 Turbo for fast drafts and Vela Image 4 for stills, all understanding light, motion and physics the way the world does.',
    phrase: 'sunset bands of amber light over a wide desert horizon',
  },
];

const NEWS = [
  { title: 'Vela 4.5 arrives in the studio', text: 'Longer, steadier shots with lighting that holds from the first frame to the last.' },
  { title: 'Kinora Team now pools credits', text: 'Every seat adds to one shared balance, so a whole team draws from the same pool.' },
  { title: 'A field guide to writing prompts', text: 'How subject, light and camera words shape what the models draw, with worked examples.' },
  { title: 'General World Models, explained', text: 'A plain-language look at how simulating the world helps models make believable video.' },
];

export function HomePage() {
  const [use, setUse] = useState(0);
  const hero = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    play(hero.current, [{ transform: 'scale(1.04)' }, { transform: 'none' }], { duration: 2000, easing: EASE_OUT, fill: 'forwards' });
    const glide = play(strip.current, [{ transform: 'translateX(0)' }, { transform: 'translateX(-50%)' }], {
      duration: 30000,
      iterations: Infinity,
    });
    return () => glide?.cancel();
  }, []);
  return (
    <>
      <section class="hero">
        <div class="hero-frame">
          <div class="hero-art" ref={hero}>
            <Art phrase="Building Real-World Intelligence at night over a quiet violet horizon" aspect="16:9" />
          </div>
          <div class="hero-copy">
            <h1 class="display">Building Real-World Intelligence</h1>
            <p class="hero-lede">
              Kinora is building foundational Real-World Intelligence that can understand, simulate and act in the world. We
              offer products and services built on-top of this intelligence to empower individuals and organizations to do
              more in the world.
            </p>
            <a class="pill pill-light pill-large" href="/signup">
              Try Kinora for free <ChevronRight size={16} />
            </a>
          </div>
        </div>
      </section>

      <section class="section partners" aria-labelledby="partners-title">
        <p id="partners-title" class="partners-line">
          We partner with the world's leading organizations to advance their industries:
        </p>
        <div class="marquee">
          <div class="marquee-track" ref={strip}>
            {[0, 1].map((copy) => (
              <ul key={copy} class="marquee-list" aria-hidden={copy === 1 ? 'true' : undefined}>
                {PARTNERS.map((name, i) => (
                  <li key={name} class={`partner partner-${i % 4}`}>{name}</li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </section>

      <section class="section container">
        <h2 class="heading section-title">Three platforms built on-top of the same Real-World Intelligence models</h2>
        <div class="platforms">
          <article class="platform card">
            <Art phrase="Kinora Creative soft amber glow over layered dunes" aspect="16:9" class="platform-art" />
            <h3>Kinora Creative</h3>
            <p>Your complete Creative Suite with everything you need, to make anything you want.</p>
            <div class="button-row">
              <a class="button button-dark" href="/signup">Try now</a>
              <a class="button button-light" href="/product">Learn more</a>
              <a class="button button-light" href="/enterprise">For Enterprise</a>
            </div>
            <p class="caption">Used by 60m+ creatives around the world. Try free, cancel anytime.</p>
          </article>
          <article class="platform card">
            <Art phrase="Kinora Dev cool blue river of light through mist" aspect="16:9" class="platform-art" />
            <h3>Kinora Dev</h3>
            <p>Build on our world models through one API for video, images and simulation, inside your own products.</p>
            <div class="button-row">
              <a class="button button-light" href="/enterprise-contact">Contact Sales</a>
            </div>
          </article>
          <article class="platform card">
            <Art phrase="Kinora Robotics green forest of quiet pine under fog" aspect="16:9" class="platform-art" />
            <h3>Kinora Robotics</h3>
            <p>Train and test robots in simulated worlds that behave like the real one, before they ever leave the lab.</p>
            <div class="button-row">
              <a class="button button-light" href="/enterprise-contact">Contact Sales</a>
            </div>
          </article>
        </div>
      </section>

      <section class="section container" aria-label="How Kinora is used">
        <Tabs
          id="uses"
          label="Kinora uses"
          tabs={USES.map((u) => u.tab)}
          selected={use}
          onSelect={setUse}
          class="tablist-editorial"
          panels={USES.map((u) => (
            <div class="feature">
              <div class="feature-copy">
                <h3 class="heading">{u.title}</h3>
                <p>{u.text}</p>
              </div>
              <Art phrase={u.phrase} aspect="16:9" class="feature-art" />
            </div>
          ))}
        />
      </section>

      <section class="research-band" aria-labelledby="research-title">
        <div class="container">
          <h2 id="research-title" class="heading">Kinora Research</h2>
          <ul class="research-rows">
            {[
              ['Vela 4.5', 'Our newest video model, with steadier motion and light that holds across a shot.'],
              ['General World Models', 'Models that learn how the world moves so what they draw behaves like it.'],
              ['Research Hub', 'Papers, notes and results from the Kinora research team.'],
            ].map(([title, line]) => (
              <li key={title}>
                <a href="/research" class="research-row">
                  <span class="research-row-title">{title}</span>
                  <span class="research-row-line">{line}</span>
                  <ChevronRight size={20} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section class="section container" aria-labelledby="news-title">
        <h2 id="news-title" class="heading section-title">See the latest from Kinora</h2>
        <div class="news">
          {NEWS.map((item) => (
            <article key={item.title} class="card news-card">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
