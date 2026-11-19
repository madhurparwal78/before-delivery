// The Kill Bill sync: catalog, accounts, subscriptions, and the recorded plan state.

import type { Db } from './db.js';
import { many } from './db.js';
import type { KillBill } from './services/killbill.js';
import { ALL_PLANS } from '../shared/constants.js';
import { seatCapOf } from '../shared/domain.js';

const CATALOG_NAME = 'DEFAULT';

function catalogXml(effectiveDate: string): string {
  const rules = `
    <rules>
        <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
        <changeAlignment><changeAlignmentCase><alignment>START_OF_BUNDLE</alignment></changeAlignmentCase></changeAlignment>
        <cancelPolicy><cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase></cancelPolicy>
        <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
        <billingAlignment><billingAlignmentCase><alignment>ACCOUNT</alignment></billingAlignmentCase></billingAlignment>
        <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
    </rules>`;
  const plans = ALL_PLANS.map((plan) => {
    const price = plan === 'rushes-pro-5' ? '150.00' : plan === 'rushes-pro-10' ? '280.00' : '650.00';
    return `
        <plan name="${plan}">
            <product>rushes-seats</product>
            <finalPhase type="EVERGREEN">
                <duration><unit>UNLIMITED</unit></duration>
                <recurring>
                    <billingPeriod>MONTHLY</billingPeriod>
                    <recurringPrice>
                        <price><currency>USD</currency><value>${price}</value></price>
                    </recurringPrice>
                </recurring>
            </finalPhase>
        </plan>`;
  }).join('');
  const priceList = ALL_PLANS.map((p) => `<plan>${p}</plan>`).join('\n                ');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog>
    <effectiveDate>${effectiveDate}</effectiveDate>
    <catalogName>${CATALOG_NAME}</catalogName>
    <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
    <currencies><currency>USD</currency></currencies>
    <units/>
    <products><product name="rushes-seats"><category>BASE</category></product></products>
    ${rules}
    <plans>${plans}
    </plans>
    <priceLists>
        <defaultPriceList name="DEFAULT" prettyName="DEFAULT">
            <plans>
                ${priceList}
            </plans>
        </defaultPriceList>
    </priceLists>
</catalog>
`;
}

export class KillBillSync {
  private readonly db: Db;
  private readonly kb: KillBill;
  private syncing = false;

  constructor(db: Db, kb: KillBill) {
    this.db = db;
    this.kb = kb;
  }

  async ensureAll(): Promise<void> {
    await this.ensureCatalog();
    const workspaces = await many<{ slug: string; name: string; plan: string }>(
      this.db,
      `select w.slug, w.name, coalesce(s.plan, 'rushes-pro-5') as plan
         from workspaces w left join seat_state s on s.workspace_id = w.id
        order by w.position`,
    );
    for (const ws of workspaces) {
      try {
        const sub = await this.kb.ensureAccountAndSubscription(ws.slug, ws.name, ws.plan);
        await this.recordPlan(ws.slug, sub.plan);
      } catch {
        // Leave the last recorded plan; retried by the jobs loop.
      }
    }
  }

  /** Make sure the tenant has the three plans. Retries via the jobs loop on failure. */
  async ensureCatalog(): Promise<void> {
    // The catalog XML upload needs a strictly later effective date and the same
    // catalog name; the seeded catalog is named DEFAULT. Upload a version effective
    // now if the current catalog is empty of our plans.
    const plans = await this.listPlans().catch(() => null);
    if (plans && ALL_PLANS.every((p) => plans.includes(p))) return;
    const effective = new Date(Date.now() - 60_000).toISOString().replace(/\.\d+Z$/, 'Z');
    await this.kb.uploadCatalog(catalogXml(effective));
  }

  async listPlans(): Promise<string[]> {
    return this.kb.currentPlanNames();
  }

  async recordPlan(slug: string, plan: string): Promise<void> {
    const ws = await this.db.query<{ id: string }>(`select id from workspaces where slug = $1`, [slug]);
    const row = ws.rows[0];
    if (!row) return;
    await this.db.query(
      `insert into seat_state (workspace_id, plan, seat_cap, updated_at) values ($1,$2,$3, now())
       on conflict (workspace_id) do update set plan = excluded.plan, seat_cap = excluded.seat_cap, updated_at = now()`,
      [row.id, plan, seatCapOf(plan)],
    );
  }

  /** Read the plan for one workspace, recording it, or fall back to the last recorded. */
  async readPlan(slug: string): Promise<{ plan: string } | null> {
    try {
      const sub = await this.kb.readPlan(slug);
      if (sub) {
        await this.recordPlan(slug, sub.plan);
        return sub;
      }
    } catch {
      // fall through to the last recorded plan
    }
    return null;
  }

  async ensureAllPeriodically(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      await this.ensureAll();
    } finally {
      this.syncing = false;
    }
  }
}
