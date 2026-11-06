import { config } from './config.js';
import { one, query } from './db.js';

interface KbOpts { method: string; path: string; body?: string; contentType?: string; timeoutMs?: number }

async function kbFetch(opts: KbOpts): Promise<{ status: number; ok: boolean; text: string; location: string | null }> {
  const res = await fetch(config.killbill.url + opts.path, {
    method: opts.method,
    headers: {
      'Authorization': 'Basic ' + Buffer.from(config.killbill.username + ':' + config.killbill.password).toString('base64'),
      'X-Killbill-ApiKey': config.killbill.apiKey,
      'X-Killbill-ApiSecret': config.killbill.apiSecret,
      'X-Killbill-CreatedBy': 'farshore',
      'Content-Type': opts.contentType ?? 'application/json',
    },
    body: opts.body,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text, location: res.headers.get('location') };
}

const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Farshore</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <units>
    <unit name="storage-gb-hours"/>
    <unit name="egress-gb"/>
    <unit name="request-units"/>
  </units>
  <products>
    <product name="sandbox-monthly">
      <category>BASE</category>
    </product>
    <product name="indie-monthly">
      <category>BASE</category>
    </product>
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase>
        <policy>IMMEDIATE</policy>
      </changePolicyCase>
    </changePolicy>
    <cancelPolicy>
      <cancelPolicyCase>
        <policy>IMMEDIATE</policy>
      </cancelPolicyCase>
    </cancelPolicy>
    <createAlignment>
      <createAlignmentCase>
        <alignment>START_OF_BUNDLE</alignment>
      </createAlignmentCase>
    </createAlignment>
    <billingAlignment>
      <billingAlignmentCase>
        <alignment>ACCOUNT</alignment>
      </billingAlignmentCase>
    </billingAlignment>
    <priceList>
      <priceListCase>
        <toPriceList>DEFAULT</toPriceList>
      </priceListCase>
    </priceList>
  </rules>
  <plans>
    <plan name="farshore-sandbox-monthly">
      <product>sandbox-monthly</product>
      <recurringBillingMode>IN_ARREAR</recurringBillingMode>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>0</value>
            </price>
          </recurringPrice>
        </recurring>
        <usages>
          <usage name="sandbox-storage" billingMode="IN_ARREAR" usageType="CONSUMABLE">
            <billingPeriod>MONTHLY</billingPeriod>
            <tiers>
              <tier>
                <blocks>
                  <tieredBlock>
                    <unit>storage-gb-hours</unit>
                    <size>1</size>
                    <prices>
                      <price>
                        <currency>USD</currency>
                        <value>0</value>
                      </price>
                    </prices>
                    <max>-1</max>
                  </tieredBlock>
                </blocks>
              </tier>
            </tiers>
          </usage>
        </usages>
      </finalPhase>
    </plan>
    <plan name="farshore-indie-monthly">
      <product>indie-monthly</product>
      <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>19.00</value>
            </price>
          </recurringPrice>
        </recurring>
        <usages>
          <usage name="indie-storage" billingMode="IN_ARREAR" usageType="CONSUMABLE">
            <billingPeriod>MONTHLY</billingPeriod>
            <tiers>
              <tier>
                <blocks>
                  <tieredBlock>
                    <unit>storage-gb-hours</unit>
                    <size>1</size>
                    <prices>
                      <price>
                        <currency>USD</currency>
                        <value>0.006</value>
                      </price>
                    </prices>
                    <max>-1</max>
                  </tieredBlock>
                </blocks>
              </tier>
            </tiers>
          </usage>
          <usage name="indie-egress" billingMode="IN_ARREAR" usageType="CONSUMABLE">
            <billingPeriod>MONTHLY</billingPeriod>
            <tiers>
              <tier>
                <blocks>
                  <tieredBlock>
                    <unit>egress-gb</unit>
                    <size>1</size>
                    <prices>
                      <price>
                        <currency>USD</currency>
                        <value>0.010</value>
                      </price>
                    </prices>
                    <max>-1</max>
                  </tieredBlock>
                </blocks>
              </tier>
            </tiers>
          </usage>
          <usage name="indie-requests" billingMode="IN_ARREAR" usageType="CONSUMABLE">
            <billingPeriod>MONTHLY</billingPeriod>
            <tiers>
              <tier>
                <blocks>
                  <tieredBlock>
                    <unit>request-units</unit>
                    <size>1000000</size>
                    <prices>
                      <price>
                        <currency>USD</currency>
                        <value>0.40</value>
                      </price>
                    </prices>
                    <max>-1</max>
                  </tieredBlock>
                </blocks>
              </tier>
            </tiers>
          </usage>
        </usages>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>farshore-sandbox-monthly</plan>
        <plan>farshore-indie-monthly</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;

/** True when Kill Bill answers any request. */
export async function killbillUp(): Promise<boolean> {
  try {
    const r = await kbFetch({ method: 'GET', path: '/1.0/kb/tenants' });
    return r.status < 500;
  } catch { return false; }
}

/** The catalog XML this app uploads to the tenant. */
export function catalogXml(): string { return CATALOG_XML; }

/** Ensures the catalog, one USD account and one subscription exist for the workspace. */
export async function ensureWorkspaceBilling(ws: { slug: string; name: string; plan: string }): Promise<boolean> {
  try {
    const existing = await one<{ account_id: string | null; account_created: boolean; subscription_id: string | null }>(
      `SELECT account_id, account_created, subscription_id FROM kb_accounts WHERE workspace_slug = $1`, [ws.slug]
    );
    if (existing?.account_created && existing.subscription_id) return true;

    // Catalog: upload only when the tenant has none of ours.
    const cat = await kbFetch({ method: 'GET', path: '/1.0/kb/catalog/xml' });
    if (!cat.text.includes('farshore')) {
      const upload = await kbFetch({
        method: 'POST', path: '/1.0/kb/catalog/xml?apiKey=' + config.killbill.apiKey,
        body: CATALOG_XML, contentType: 'text/xml',
      });
      if (!(upload.status === 200 || upload.status === 201)) {
        console.error('[farshore] catalog upload failed:', upload.status, upload.text.slice(0, 200));
        return false;
      }
    }

    // Account: create, or reuse the one already keyed to this workspace.
    let accountId = existing?.account_id ?? null;
    if (!accountId) {
      const acct = await kbFetch({
        method: 'POST', path: '/1.0/kb/accounts',
        body: JSON.stringify({ name: ws.name, externalKey: `farshore-${ws.slug}`, currency: 'USD' }),
      });
      if (acct.status === 201 && acct.location) {
        accountId = acct.location.split('/').pop() ?? null;
      } else {
        const search = await kbFetch({ method: 'GET', path: `/1.0/kb/accounts/search/farshore-${ws.slug}` });
        if (search.status === 200) {
          try {
            const accounts = JSON.parse(search.text) as Array<{ accountId: string; externalKey: string }>;
            accountId = accounts.find(a => a.externalKey === `farshore-${ws.slug}`)?.accountId ?? null;
          } catch { /* leave null */ }
        }
      }
      if (!accountId) {
        console.error('[farshore] account creation failed:', acct.status, acct.text.slice(0, 200));
        return false;
      }
      await query(
        `INSERT INTO kb_accounts (workspace_slug, account_id, account_created) VALUES ($1,$2,true)
         ON CONFLICT (workspace_slug) DO UPDATE SET account_id = $2, account_created = true`,
        [ws.slug, accountId]
      );
    }

    // Subscription: create one on the workspace's plan, or reuse the account's existing bundle.
    let subscriptionId: string | null = existing?.subscription_id ?? null;
    if (!subscriptionId) {
      const planName = ws.plan === 'sandbox' ? 'farshore-sandbox-monthly' : 'farshore-indie-monthly';
      const sub = await kbFetch({
        method: 'POST', path: '/1.0/kb/subscriptions',
        body: JSON.stringify({ accountId, planName }),
      });
      if (sub.status === 201) {
        try {
          subscriptionId = (JSON.parse(sub.text) as { subscriptionId: string }).subscriptionId;
        } catch { /* fall through to bundles */ }
      }
      if (!subscriptionId) {
        const bundles = await kbFetch({ method: 'GET', path: `/1.0/kb/accounts/${accountId}/bundles` });
        if (bundles.status === 200) {
          try {
            const list = JSON.parse(bundles.text) as Array<{ subscriptions: Array<{ subscriptionId: string }> }>;
            subscriptionId = list[0]?.subscriptions?.[0]?.subscriptionId ?? null;
          } catch { /* leave null */ }
        }
      }
      if (!subscriptionId) {
        console.error('[farshore] subscription creation failed:', sub.status, sub.text.slice(0, 200));
        return false;
      }
      await query(`UPDATE kb_accounts SET subscription_id = $1 WHERE workspace_slug = $2`, [subscriptionId, ws.slug]);
    }
    return true;
  } catch (e) {
    console.error('[farshore] billing ensure error:', (e as Error).message);
    return false;
  }
}

/** Posts one sealed usage row to the workspace's Kill Bill subscription. */
export async function postUsageRow(row: {
  workspace_slug: string; bucket_name: string; unit: string; window_start: Date; amount: string; tracking_id: string;
}): Promise<boolean> {
  const kb = await one<{ account_id: string | null; account_created: boolean; subscription_id: string | null }>(
    `SELECT account_id, account_created, subscription_id FROM kb_accounts WHERE workspace_slug = $1`,
    [row.workspace_slug]
  );
  if (!kb?.account_created || !kb.subscription_id) return false;
  void kb.account_id;
  void row.bucket_name;
  try {
    const r = await kbFetch({
      method: 'POST', path: '/1.0/kb/usages',
      body: JSON.stringify({
        subscriptionId: kb.subscription_id,
        trackingId: row.tracking_id,
        unitUsageRecords: [{
          unitType: row.unit,
          usageRecords: [{ recordDate: row.window_start.toISOString(), amount: Number(row.amount) }],
        }],
      }),
    });
    if (r.ok) return true;
    // A duplicate tracking ID means Kill Bill already has the record.
    if (r.text.includes('trackingId') || r.text.includes('already')) return true;
    return false;
  } catch { return false; }
}
