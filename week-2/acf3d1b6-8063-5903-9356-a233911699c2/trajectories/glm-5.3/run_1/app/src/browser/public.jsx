// The public pages of the Kinora site.
import { useState, useMemo } from 'preact/hooks';
import { PublicLayout } from './chrome.jsx';
import {
  IconChevronRight, IconInfo, IconSearch, IconCopy, IconTry, toast,
} from './client.jsx';
import { artUri } from '../art.mjs';
import {
  PLANS, MODELS, EXAMPLES, EXAMPLE_CATEGORIES, PARTNERS, HOME_TABS, HOME_NEWS,
  PRODUCT_TOOLS, PRODUCT_APPS, USE_CASES, TEAM_FAQS, RESEARCH_PAPERS,
  RESOURCES_FEATURED, RESOURCES_ALL, ENTERPRISE_STATS, ENTERPRISE_POINTS, LICENSING_CARDS,
  WORKFLOW_REASONS, FEATURED_WORKFLOWS,
} from '../content.mjs';
import { EnquiryForm } from './forms.jsx';

// ---------------------------------------------------------------- home

function PartnerStrip() {
  const items = [...PARTNERS, ...PARTNERS];
  return (
    <div class="marquee" aria-label="Partner organizations">
      <div class="marquee-track">
        {items.map((p, i) => <span class="marquee-item" key={i}>{p}</span>)}
      </div>
    </div>
  );
}

export function HomePage() {
  const [tab, setTab] = useState(0);
  return (
    <PublicLayout>
      <section class="section-tight">
        <div class="container">
          <div class="hero-frame">
            <img class="hero-art" src={artUri('Kinora Real-World Intelligence dawn over a quiet city of light', '16:9')}
              alt="" width="1160" height="560" />
            <div class="hero-overlay">
              <h1>Building Real-World Intelligence</h1>
              <p>Kinora is building foundational Real-World Intelligence that can understand, simulate and act in the world. We offer products and services built on-top of this intelligence to empower individuals and organizations to do more in the world.</p>
              <a class="pill-soft hero-pill" href="/signup">Try Kinora for free<IconChevronRight /></a>
            </div>
          </div>
        </div>
      </section>

      <section class="section-tight">
        <div class="container">
          <p style="text-align:center;color:var(--muted);margin-bottom:8px">We partner with the world's leading organizations to advance their industries:</p>
          <PartnerStrip />
        </div>
      </section>

      <section class="section">
        <div class="container">
          <h2 style="text-align:center">Three platforms built on-top of the same Real-World Intelligence models</h2>
          <div class="plan-grid" style="margin-top:26px">
            <div class="card card-hover">
              <h3>Kinora Creative</h3>
              <p>Your complete Creative Suite with everything you need, to make anything you want.</p>
              <div class="row">
                <a class="btn btn-dark btn-sm" href="/signup">Try now</a>
                <a class="btn btn-light btn-sm" href="/product">Learn more</a>
                <a class="btn btn-light btn-sm" href="/enterprise">For Enterprise</a>
              </div>
              <p class="caption" style="margin:0">Used by 60m+ creatives around the world. Try free, cancel anytime.</p>
            </div>
            <div class="card card-hover">
              <h3>Kinora Dev</h3>
              <p>Build agents and automations on the same intelligence, through one API.</p>
              <a class="btn btn-light btn-sm" href="/enterprise-contact">Contact Sales</a>
            </div>
            <div class="card card-hover">
              <h3>Kinora Robotics</h3>
              <p>Bring Real-World Intelligence to machines that see, plan and act.</p>
              <a class="btn btn-light btn-sm" href="/enterprise-contact">Contact Sales</a>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="tablist" role="tablist" aria-label="How Kinora is used">
            {HOME_TABS.map((t, i) => (
              <button type="button" role="tab" class="tab tab-dim" id={`how-tab-${i}`}
                aria-selected={tab === i} aria-controls={`how-panel-${i}`}
                onClick={() => setTab(i)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') setTab((tab + 1) % HOME_TABS.length);
                  if (e.key === 'ArrowLeft') setTab((tab - 1 + HOME_TABS.length) % HOME_TABS.length);
                }}>{t.label}</button>
            ))}
          </div>
          <div class="card" style="margin-top:20px" role="tabpanel" id={`how-panel-${tab}`} aria-labelledby={`how-tab-${tab}`}>
            <div class="row" style="align-items:center;gap:26px">
              <div style="flex:1;min-width:240px">
                <h3>{HOME_TABS[tab].label}</h3>
                <p>{HOME_TABS[tab].desc}</p>
              </div>
              <div class="tmpl-art" style="flex:1;min-width:220px">
                <img src={artUri(HOME_TABS[tab].prompt, '16:9')} alt="" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section" style="background:var(--ink);color:#e8e9ee">
        <div class="container">
          <h2 style="color:#fff">Kinora Research</h2>
          <p style="color:#aeb2c2">Our research shapes the models behind every product.</p>
          <div class="stack" style="gap:0">
            {['Vela 4.5', 'General World Models', 'Research Hub'].map(t => (
              <a href="/research" style="color:#fff;font-weight:600;padding:16px 0;border-bottom:1px solid #2b2c33;text-decoration:none;display:flex;justify-content:space-between;align-items:center">
                {t}<IconChevronRight />
              </a>
            ))}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <h2>See the latest from Kinora</h2>
          <div class="news-grid">
            {HOME_NEWS.map(n => (
              <article class="card card-hover">
                <div class="tmpl-art" style="margin-bottom:14px">
                  <img src={artUri(n.title, '16:9')} alt="" />
                </div>
                <h3 style="font-size:1.05rem">{n.title}</h3>
                <p class="caption" style="margin:0">{n.summary}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------- product

export function ProductPage() {
  const [tab, setTab] = useState(0);
  return (
    <PublicLayout>
      <section class="section">
        <div class="container">
          <div class="spread" style="align-items:flex-end">
            <div style="max-width:640px">
              <h1>A new frontier for video generation.</h1>
              <p>Every model, every tool and every frame you need, in one studio.</p>
              <a class="btn btn-dark" href="/signup">Get Started</a>
              <p class="caption">Used by 60M+ users globally - try today and cancel anytime</p>
            </div>
          </div>
        </div>
      </section>

      <section class="section-tight">
        <div class="container">
          <h2>Every model you need to make anything you want.</h2>
          <div class="plan-grid">
            {MODELS.map(m => (
              <div class="card card-hover">
                <div class="tmpl-art" style="margin-bottom:16px">
                  <img src={artUri(m.blurb, '16:9')} alt="" />
                </div>
                <h3>{m.name}</h3>
                <p>{m.blurb}</p>
                <p class="mono caption" style="margin:0">{m.credits_per_unit} credits per {m.kind === 'video' ? 'second' : 'image'}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <h2>Dozens of tools. Endless ways to create.</h2>
          <div class="tablist" role="tablist" aria-label="Creative suite tools">
            {PRODUCT_TOOLS.map((t, i) => (
              <button type="button" role="tab" class="tab" id={`tool-tab-${i}`}
                aria-selected={tab === i} aria-controls="tool-panel"
                onClick={() => setTab(i)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') setTab((tab + 1) % PRODUCT_TOOLS.length);
                  if (e.key === 'ArrowLeft') setTab((tab - 1 + PRODUCT_TOOLS.length) % PRODUCT_TOOLS.length);
                }}>{t.name}</button>
            ))}
          </div>
          <div class="card" style="margin-top:20px" role="tabpanel" id="tool-panel" aria-labelledby={`tool-tab-${tab}`}>
            <h3>{PRODUCT_TOOLS[tab].name}</h3>
            <p style="margin:0">{PRODUCT_TOOLS[tab].desc}</p>
          </div>
        </div>
      </section>

      <section class="section-tight">
        <div class="container">
          <h2>Explore other apps</h2>
          <div class="proj-grid">
            {PRODUCT_APPS.map(a => (
              <article class="card card-hover">
                <h3 style="font-size:1rem">{a.name}</h3>
                <p class="caption" style="margin:0">{a.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------- pricing

function InfoTip({ text, id }) {
  const [open, setOpen] = useState(false);
  return (
    <span class="tip-pop">
      <button type="button" class="tip-btn" aria-label={`What credits buy (${id})`}
        aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconInfo />
      </button>
      {open && <span class="tip-popover" role="tooltip">{text}</span>}
    </span>
  );
}

export function priceLine(plan, yearly) {
  if (plan.id === 'enterprise') return <span class="amount">Custom</span>;
  if (plan.per_seat) return (
    <span>
      {yearly ? <><span class="strike">${plan.monthly_price / 100}</span><span class="amount">${plan.yearly_price / 100}</span></> : <span class="amount">${plan.monthly_price / 100}</span>}
      <span class="per">per seat per month</span>
    </span>
  );
  if (yearly) {
    return (
      <span>
        <span class="strike">${plan.monthly_price / 100}</span>
        <span class="amount">${plan.yearly_price / 100}</span>
        <span class="per">/month</span>
      </span>
    );
  }
  return <span><span class="amount">${plan.monthly_price / 100}</span><span class="per">/month</span></span>;
}

function PlanCard({ plan, yearly }) {
  const ctaHref = plan.id === 'free' ? '/signup' : '/enterprise-contact';
  return (
    <article class="card plan-card card-hover">
      {plan.tab && <span class="tag">{plan.tab}</span>}
      <div>
        <h3>{plan.name}</h3>
        {plan.badge && <span class="badge badge-orange">{plan.badge}</span>}
      </div>
      <div class="plan-price" key={`${plan.id}-${yearly}`}>
        {priceLine(plan, yearly)}
      </div>
      {yearly && plan.yearly_note && <p class="yearly-note" style="margin:-6px 0 0">{plan.yearly_note}</p>}
      <p class="plan-credits">
        {plan.credits_line}
        <InfoTip text={plan.tip} id={plan.name} />
      </p>
      <p class="caption" style="margin:0">{plan.description}</p>
      <ul class="plan-features">
        {plan.features.map(f => <li>{f}</li>)}
      </ul>
      <a class="btn btn-dark" href={ctaHref}>{plan.button}</a>
    </article>
  );
}

export function PricingPage() {
  const [family, setFamily] = useState('individual');
  const [yearly, setYearly] = useState(true);
  const individual = ['free', 'standard', 'pro', 'max'].map(id => PLANS.find(p => p.id === id));
  const teamEnterprise = ['team', 'enterprise'].map(id => PLANS.find(p => p.id === id));
  return (
    <PublicLayout>
      <section class="section">
        <div class="container">
          <h1>Choose the Right Plan for You</h1>
          <p class="caption">Trusted by 60M+ creators and leading enterprises</p>

          <div class="spread" style="margin:26px 0">
            <div class="tablist" role="tablist" aria-label="Plan family">
              {[{ id: 'individual', label: 'Individual' }, { id: 'team', label: 'Team & Enterprise' }, { id: 'api', label: 'API' }].map(f => (
                <button type="button" role="tab" class="tab" aria-selected={family === f.id}
                  onClick={() => setFamily(f.id)}>{f.label}</button>
              ))}
            </div>
            <div class="switch-row">
              <span>Monthly</span>
              <button type="button" class="switch" role="switch" aria-checked={yearly}
                aria-label="Yearly billing"
                onClick={() => setYearly(!yearly)}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setYearly(!yearly); } }}>
                <span class="knob" aria-hidden="true" />
              </button>
              <span>Yearly</span>
              <span class="badge">2 months free</span>
            </div>
          </div>

          {family === 'individual' && (
            <div class="plan-grid">
              {individual.map(p => <PlanCard plan={p} yearly={yearly} />)}
            </div>
          )}
          {family === 'team' && (
            <div class="plan-grid">
              {teamEnterprise.map(p => <PlanCard plan={p} yearly={yearly} />)}
            </div>
          )}
          {family === 'api' && (
            <div class="card plan-card" style="max-width:520px">
              <h3>API</h3>
              <p style="font-size:1.1rem;font-weight:600;color:var(--ink)">API access is arranged with our sales team.</p>
              <p class="caption">Custom pricing, custom limits, and the same Vela models behind everything we make.</p>
              <a class="btn btn-dark" href="/enterprise-contact">Contact sales</a>
            </div>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------- team plan

export function TeamPlanPage() {
  return (
    <PublicLayout>
      <section class="section">
        <div class="container">
          <h1>Kinora Team</h1>
          <p style="max-width:640px">Grow your business faster with more on-brand campaigns, product shots and social, made in a fraction of the time.</p>
          <a class="btn btn-dark" href="/enterprise-contact">Get Team</a>
        </div>
      </section>
      <section class="section-tight">
        <div class="container">
          <div class="plan-grid">
            {[
              { t: 'One place for your team’s work', d: 'Projects, generations and prompts live together, so nothing gets lost between people and tools.' },
              { t: 'Manage the whole team from one balance', d: 'Every seat adds 6,900 credits a month to a single shared pool, and they land the moment you add the seat.' },
              { t: 'Bring Kinora to the tools you already use', d: 'Export what you make and keep moving in the pipeline your team already runs.' },
            ].map(b => (
              <div class="card card-hover">
                <h3>{b.t}</h3>
                <p style="margin:0">{b.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section class="section-tight">
        <div class="container">
          <h2>For every team with creative needs</h2>
          <div class="plan-grid">
            {[
              { t: 'Marketing teams', d: 'Campaigns and variants in an afternoon, from one shared pool.' },
              { t: 'Studios and agencies', d: 'Client work with a consistent look, organized in projects.' },
              { t: 'In-house creative', d: 'Brand-safe output at the pace your company asks for.' },
            ].map(b => (
              <div class="card card-hover">
                <h3>{b.t}</h3>
                <p style="margin:0">{b.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section class="section-tight">
        <div class="container">
          <h2>Frequently asked questions</h2>
          <div class="stack" style="margin-top:20px">
            {TEAM_FAQS.map((f, i) => (
              <details class="disclosure" key={i}>
                <summary>{f.q}<IconChevronRight /></summary>
                <div class="answer"><p style="margin:0">{f.a}</p></div>
              </details>
            ))}
          </div>
        </div>
      </section>
      <section class="section-tight">
        <div class="container">
          <div class="plan-grid">
            {['team', 'enterprise'].map(id => {
              const p = PLANS.find(x => x.id === id);
              return <PlanCard plan={p} yearly />;
            })}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------- enterprise

export function EnterprisePage({ contactOnly }) {
  return (
    <PublicLayout>
      <section class="section">
        <div class="container">
          {!contactOnly && (
            <div style="margin-bottom:56px">
              <h1>Production-ready AI<br />Made for Enterprise</h1>
              <p style="max-width:640px">Our full suite of creative AI tools can help your teams realize bigger ideas with smaller budgets and timelines.</p>
              <a class="btn btn-dark" href="/enterprise-contact">Contact Sales</a>
            </div>
          )}
          {!contactOnly && (
            <div style="margin-bottom:56px">
              <h2>Why Enterprises Choose Kinora</h2>
              <div class="stat-grid">
                {ENTERPRISE_STATS.map(s => (
                  <div class="card card-hover">
                    <p class="mono" style="font-size:2rem;color:var(--ink);margin:0;font-weight:640">{s.stat}</p>
                    <p>{s.note}</p>
                    <p class="caption" style="margin:0">{s.company}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!contactOnly && (
            <div style="margin-bottom:56px">
              <h2>Built for Enterprise</h2>
              <div class="row">
                {ENTERPRISE_POINTS.map(p => <span class="pill-soft">{p}</span>)}
              </div>
            </div>
          )}
          <h2 id="enquiry-heading">Tell us more about your use case.</h2>
          <EnquiryForm source="contact" headingId="enquiry-heading" />
        </div>
      </section>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------- model licensing

export function LicensingPage() {
  return (
    <PublicLayout>
      <section class="section">
        <div class="container">
          <p class="eyebrow">Model licensing</p>
          <h1>Create your own frontier.</h1>
          <p style="max-width:640px">License state of the art Kinora model weights. Fine-tune on your own data, self-host on your infrastructure and commercialize what you create.</p>
          <a class="btn btn-dark" href="/enterprise-contact">Talk to our team</a>
        </div>
      </section>
      <section class="section-tight">
        <div class="container">
          <div class="plan-grid">
            {LICENSING_CARDS.map(c => (
              <div class="card card-hover">
                <h3>{c.title}</h3>
                <p style="margin:0">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section class="section-tight">
        <div class="container">
          <h2 id="licensing-heading">Talk to us about licensing</h2>
          <EnquiryForm source="licensing" headingId="licensing-heading" />
        </div>
      </section>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------- examples

export function ExamplesPage() {
  const [cat, setCat] = useState('all');
  const [search, setSearch] = useState('');
  const items = useMemo(() => {
    let list = EXAMPLES;
    if (cat !== 'all') list = list.filter(e => e.category === cat);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(e => e.heading.toLowerCase().includes(q) || e.prompt.toLowerCase().includes(q));
    return list;
  }, [cat, search]);

  const copy = async (prompt) => {
    try { await navigator.clipboard.writeText(prompt); } catch {
      const ta = document.createElement('textarea');
      ta.value = prompt; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    toast('Prompt copied');
  };
  const tryInStudio = (prompt) => {
    try { sessionStorage.setItem('kinora_try_prompt', prompt); } catch {}
    location.href = '/studio';
  };

  return (
    <PublicLayout>
      <section class="section">
        <div class="container">
          <h1>Explore all examples</h1>
          <div class="tablist" role="tablist" aria-label="Example categories">
            {EXAMPLE_CATEGORIES.map(c => (
              <button type="button" role="tab" class="tab" aria-selected={cat === c.id}
                onClick={() => setCat(c.id)}>{c.label}</button>
            ))}
          </div>
          <div style="margin:20px 0 8px;max-width:420px;position:relative">
            <label class="visually-hidden" for="example-search">Search examples</label>
            <input id="example-search" class="input" type="search" value={search}
              placeholder="Search examples" aria-label="Search examples"
              onInput={(e) => setSearch(e.target.value)} />
            <span style="position:absolute;right:13px;top:11px;color:var(--faint)"><IconSearch /></span>
          </div>
          <p class="caption">{items.length} example{items.length === 1 ? '' : 's'}</p>
          {items.length === 0 && search && <p role="alert">No examples match {search}.</p>}
          <div class="stack" style="margin-top:18px">
            {items.map((e, i) => (
              <article class="card card-hover" key={i}>
                <div class="spread">
                  <div>
                    <h3 style="font-size:1.08rem">{e.heading}</h3>
                    <p class="caption">{EXAMPLE_CATEGORIES.find(c => c.id === e.category)?.label}</p>
                  </div>
                  <div class="row">
                    <button type="button" class="btn btn-light btn-sm" onClick={() => tryInStudio(e.prompt)}><IconTry />Try in Studio</button>
                    <button type="button" class="btn btn-light btn-sm" onClick={() => copy(e.prompt)}><IconCopy />Copy prompt</button>
                  </div>
                </div>
                <p style="margin:12px 0 0">{e.prompt}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------- use cases, workflows, research, resources

export function UseCasesPage() {
  return (
    <PublicLayout>
      <section class="section">
        <div class="container">
          <h1>AI video for whatever you make</h1>
          <h2>Find your use case</h2>
          <div class="plan-grid">
            {USE_CASES.map(u => (
              <article class="card card-hover">
                <div class="tmpl-art" style="margin-bottom:14px"><img src={artUri(u.line, '16:9')} alt="" /></div>
                <h3 style="font-size:1.02rem">{u.name}</h3>
                <p class="caption" style="margin:0">{u.line}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

export function WorkflowsPage() {
  return (
    <PublicLayout>
      <section class="section">
        <div class="container">
          <h1>Introducing Kinora Workflows</h1>
          <p>Chain models, tools and tasks into reusable templates your whole team can run. Workflows are on our roadmap and are not part of the studio today.</p>
          <h2>Why Workflows?</h2>
          <div class="plan-grid">
            {WORKFLOW_REASONS.map(r => (
              <div class="card"><p style="margin:0;font-weight:560;color:var(--ink)">{r}</p></div>
            ))}
          </div>
          <h2 style="margin-top:44px">Featured Workflows</h2>
          <div class="row">
            {FEATURED_WORKFLOWS.map(w => <span class="pill-soft">{w}</span>)}
          </div>
          <div class="disclosure" style="margin-top:36px">
            <details>
              <summary>Do workflows take credits?<IconChevronRight /></summary>
              <div class="answer"><p style="margin:0">Yes. Media model nodes and LLM nodes use credits when they run.</p></div>
            </details>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

export function ResearchPage() {
  return (
    <PublicLayout>
      <section class="section">
        <div class="container">
          <h1>Building general-purpose multimodal<br />simulators of the world.</h1>
          <p style="max-width:640px">Kinora Research publishes the work behind the Vela family and our Real-World Intelligence program.</p>
          <div class="plan-grid" style="margin-top:26px">
            {RESEARCH_PAPERS.map(p => (
              <article class="card card-hover">
                <div class="tmpl-art" style="margin-bottom:16px"><img src={artUri(p.title, '16:9')} alt="" /></div>
                <h3 style="font-size:1.05rem">{p.title}</h3>
                <p class="caption" style="margin:0 0 8px">{p.authors} · {p.date}</p>
                <p style="margin:0">{p.abstract}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

export function ResourcesPage() {
  return (
    <PublicLayout>
      <section class="section">
        <div class="container">
          <h2>Featured</h2>
          <div class="plan-grid">
            {RESOURCES_FEATURED.map(a => (
              <article class="card card-hover">
                <div class="tmpl-art" style="margin-bottom:14px"><img src={artUri(a.title, '16:9')} alt="" /></div>
                <h3 style="font-size:1.02rem">{a.title}</h3>
                <p style="margin:0">{a.summary}</p>
                <p class="caption" style="margin:0">{a.author} · {a.date}</p>
              </article>
            ))}
          </div>
          <h2 style="margin-top:48px">All Resources</h2>
          <div class="stack">
            {RESOURCES_ALL.map(a => (
              <div class="member-row">
                <div>
                  <strong style="color:var(--ink)">{a.title}</strong>
                </div>
                <span class="caption">{a.author} · {a.date}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------- privacy + 404

export function PrivacyPage() {
  return (
    <PublicLayout>
      <section class="section">
        <div class="container" style="max-width:760px">
          <h1>Privacy Policy</h1>
          <p class="caption">Kinora keeps what it keeps to the minimum, and reads only what it needs.</p>

          <h2>What an account stores</h2>
          <p>When you sign up, Kinora stores your name, your email address and a hashed password, together with the workspace you own, its projects, your generations and the workspace's credit history. Passwords are never stored in plain text: only a one-way hash of your password is kept.</p>

          <h2>What an enquiry stores</h2>
          <p>When you send an enterprise or licensing enquiry, Kinora stores the fields of the form you filled in: your name, business email, company, company size, industry, the Kinora products you are interested in, and your message.</p>

          <h2>What an invitation stores</h2>
          <p>When a workspace owner invites a teammate, Kinora stores the invited email address, the workspace it belongs to and the time it was sent, until it is accepted or revoked.</p>

          <h2>Who reads them</h2>
          <p>Only Kinora staff and the members of your own workspace can read your workspace's projects, generations, credits and team. Nobody outside a workspace can read its records, and enquiries are read only by the Kinora sales team.</p>

          <h2>Cookies</h2>
          <p>Kinora sets at most one cookie: the session cookie that keeps you signed in. There is no tracking cookie, no analytics and no third-party measurement of any kind.</p>
        </div>
      </section>
    </PublicLayout>
  );
}

export function NotFoundPage() {
  return (
    <PublicLayout>
      <section class="section">
        <div class="container" style="text-align:center;padding-top:90px;padding-bottom:90px">
          <h1>Page not found</h1>
          <p>We could not find that page.</p>
          <a class="btn btn-dark" href="/">Back to home</a>
        </div>
      </section>
    </PublicLayout>
  );
}
