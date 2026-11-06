import { h, type VNode } from './jsx/runtime.js';
import { api } from './api.js';
import { store } from './store.js';
import { rerender } from './rerender.js';
import type { Me, Region, PlanRow } from '../shared/types.js';
import { WorldStrip, PricingTable, PricingCards } from './marketing.tsx';
import { SignIn } from './signin.js';
import { Console } from './console.js';
import { Account } from './account.js';
import { Ops } from './ops.js';
import { Invite } from './invite.js';

export async function loadMe(): Promise<Me | null> {
  const r = await api<Me>('GET', '/api/me');
  store.me = r.status === 200 ? r.data : null;
  return store.me;
}

export async function loadRegions(): Promise<Region[]> {
  const r = await api<{ regions: Region[] }>('GET', '/api/regions');
  store.regions = r.data.regions ?? [];
  return store.regions;
}

export async function loadPlans(): Promise<PlanRow[]> {
  if (store.plans.length > 0) return store.plans;
  const r = await api<{ plans: PlanRow[] }>('GET', '/api/plans');
  store.plans = r.data.plans ?? [];
  return store.plans;
}

/** The root view: decides which page to render from the address. */
export function App(_props: Record<string, never>): VNode {
  const url = new URL(location.href);
  const path = url.pathname;
  if (path === '/' || path === '') return Marketing();
  if (path === '/signin') return SignIn({});
  if (path === '/account') return Account({});
  if (path.startsWith('/ops')) return Ops({ path });
  if (path.startsWith('/invite/')) return Invite({ token: path.split('/')[2] ?? '' });
  return Console({ path, query: url.searchParams });
}

function Marketing(): VNode {
  return (
    <div class="marketing">
      <header>
        <nav style="display:flex;gap:24px;align-items:center;padding:18px 0">
          <b style="font-family:'Space Grotesk';font-size:1.1rem">Farshore</b>
          <a href="#pricing">Pricing</a>
          <span style="flex:1"></span>
          <a href="/signin">Sign in</a>
        </nav>
      </header>
      <section class="hero">
        <h1>Every region you pick holds the bytes you shipped.</h1>
        <p class="lead">One endpoint, regions you choose per bucket, and a console that shows every replica as it lands. Built for small studios whose players are everywhere.</p>
        <p class="cta"><a class="btn" href="/signin" style="display:inline-flex;align-items:center;min-height:44px;padding:0 18px;background:var(--amber);color:#131318;border-radius:6px;font-weight:600">Open the console</a></p>
      </section>
      <WorldStrip regions={store.regions} />
      <section class="feature-rows">
        <div class="feature-row"><b>One endpoint</b><span>Your S3 client and your console both speak to the same origin. No extra hops to configure.</span></div>
        <div class="feature-row"><b>Per-object replica state</b><span>Every object shows which regions hold the current version and how long each copy took to arrive.</span></div>
        <div class="feature-row"><b>Versions that expire on your rules</b><span>Set lifecycle rules per bucket. Versions under retention or legal hold stay put.</span></div>
        <div class="feature-row"><b>The bill before the invoice</b><span>Watch month-to-date storage and egress against your plan, and export the rows for your books.</span></div>
      </section>
      <section class="pricing" id="pricing">
        <h2>Pricing</h2>
        <PricingTable plans={store.plans} />
        <PricingCards plans={store.plans} />
      </section>
      <footer><span>Farshore · object storage for small studios</span></footer>
      <Loaders />
    </div>
  );
}

function Loaders(): VNode {
  if (store.regions.length === 0) queueMicrotask(async () => {
    await loadRegions();
    await loadPlans();
    rerender();
  });
  return h('span', null);
}
