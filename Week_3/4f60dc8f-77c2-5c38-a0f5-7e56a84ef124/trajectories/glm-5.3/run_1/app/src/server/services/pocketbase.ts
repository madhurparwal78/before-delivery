import type { AppConfig } from '../config';
import type { CaseStudy, ServiceRecord } from '../types';

export interface TeamMember {
  name: string;
  role: string;
  bio: string;
}

export interface Insight {
  slug: string;
  title: string;
  summary: string;
}

export interface StudioContent {
  case_studies: CaseStudy[];
  services: ServiceRecord[];
  team: TeamMember[];
  insights: Insight[];
  marquee: string[];
}

interface PbRecord {
  id: string;
  [field: string]: unknown;
}

export class PocketBase {
  private readonly config: AppConfig;
  private token: string | null = null;
  private tokenExpiry = 0;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.pocketbase.url}/api/health`, { signal: AbortSignal.timeout(3_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async auth(force = false): Promise<string> {
    const now = Date.now();
    if (!force && this.token && now < this.tokenExpiry) {
      return this.token;
    }
    const response = await fetch(`${this.config.pocketbase.url}/api/admins/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: this.config.pocketbase.adminEmail, password: this.config.pocketbase.adminPassword }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error('unreachable');
    }
    const body = await response.json() as { token: string };
    this.token = body.token;
    this.tokenExpiry = now + 55 * 60 * 1000;
    return this.token;
  }

  async ensureCollections(): Promise<void> {
    const token = await this.auth();
    const wanted = [
      {
        name: 'case_studies',
        schema: [
          { name: 'slug', type: 'text', required: true },
          { name: 'title', type: 'text', required: true },
          { name: 'client', type: 'text', required: true },
          { name: 'summary', type: 'text' },
          { name: 'primitives', type: 'json', options: { maxSize: 2000 } },
          { name: 'accent', type: 'text' },
          { name: 'published', type: 'bool' },
          { name: 'sort', type: 'number' },
        ],
      },
      {
        name: 'services',
        schema: [
          { name: 'code', type: 'text', required: true },
          { name: 'title', type: 'text', required: true },
          { name: 'list_price_pence', type: 'number' },
          { name: 'azimuth_deg', type: 'number' },
          { name: 'elevation_deg', type: 'number' },
          { name: 'sort', type: 'number' },
        ],
      },
      {
        name: 'team',
        schema: [
          { name: 'name', type: 'text', required: true },
          { name: 'role', type: 'text' },
          { name: 'bio', type: 'text' },
        ],
      },
      {
        name: 'insights',
        schema: [
          { name: 'slug', type: 'text', required: true },
          { name: 'title', type: 'text', required: true },
          { name: 'summary', type: 'text' },
        ],
      },
      {
        name: 'marquee',
        schema: [
          { name: 'name', type: 'text', required: true },
          { name: 'sort', type: 'number' },
        ],
      },
    ];
    const list = await fetch(`${this.config.pocketbase.url}/api/collections?page=1&perPage=100`, {
      headers: { Authorization: token },
      signal: AbortSignal.timeout(5_000),
    });
    if (!list.ok) {
      throw new Error('unreachable');
    }
    const existing = (await list.json() as { items: { name: string }[] }).items.map(item => item.name);
    for (const collection of wanted) {
      if (!existing.includes(collection.name)) {
        const create = await fetch(`${this.config.pocketbase.url}/api/collections`, {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: collection.name, type: 'base', schema: collection.schema }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!create.ok) {
          throw new Error(`PocketBase collection creation failed: ${create.status}`);
        }
      } else {
        // Add any fields missing from an existing collection.
        const details = await fetch(`${this.config.pocketbase.url}/api/collections/${collection.name}`, {
          headers: { Authorization: token },
          signal: AbortSignal.timeout(5_000),
        });
        if (details.ok) {
          const current = await details.json() as { schema?: { name: string }[] };
          const currentFields = new Set((current.schema ?? []).map(field => field.name));
          const missing = collection.schema.filter(field => !currentFields.has(field.name));
          if (missing.length > 0) {
            const update = await fetch(`${this.config.pocketbase.url}/api/collections/${collection.name}`, {
              method: 'PATCH',
              headers: { Authorization: token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ schema: [...(current.schema ?? []), ...missing] }),
              signal: AbortSignal.timeout(5_000),
            });
            if (!update.ok) {
              throw new Error(`PocketBase collection update failed: ${update.status}`);
            }
          }
        }
      }
    }
  }

  private async request(method: string, path: string, body?: unknown, retry = true): Promise<unknown> {
    const token = await this.auth();
    const response = await fetch(`${this.config.pocketbase.url}/api/collections/${path}`, {
      method,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 401 && retry) {
      this.token = null;
      this.tokenExpiry = 0;
      return this.request(method, path, body, false);
    }
    if (!response.ok) {
      throw new Error(`PocketBase request failed: ${response.status}`);
    }
    return await response.json();
  }

  private async requestOk(method: string, path: string, body?: unknown, retry = true): Promise<boolean> {
    const token = await this.auth();
    const response = await fetch(`${this.config.pocketbase.url}/api/collections/${path}`, {
      method,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 401 && retry) {
      this.token = null;
      this.tokenExpiry = 0;
      return this.requestOk(method, path, body, false);
    }
    return response.ok;
  }

  private async listRecords(collection: string, extra = ''): Promise<PbRecord[]> {
    const result = await this.request('GET', `${collection}/records?perPage=200${extra}`) as { items?: PbRecord[] } | PbRecord[];
    if (Array.isArray(result)) {
      return result;
    }
    return result.items ?? [];
  }

  async getCaseStudies(includeDrafts: boolean): Promise<CaseStudy[]> {
    const records = await this.listRecords('case_studies', '&sort=sort');
    const studies = records
      .filter(record => includeDrafts || record.published === true)
      .map(record => ({
        slug: String(record.slug ?? ''),
        title: String(record.title ?? ''),
        client: String(record.client ?? ''),
        summary: String(record.summary ?? ''),
        scene: {
          primitives: Array.isArray(record.primitives) ? (record.primitives as string[]) : [],
          accent: String(record.accent ?? 'ember'),
        },
        published: record.published === true,
        sort: Number(record.sort ?? 0),
      }))
      .filter(study => study.slug !== '');
    return studies.sort((a, b) => a.sort - b.sort);
  }

  async getCaseStudy(slug: string): Promise<CaseStudy | null> {
    const studies = await this.getCaseStudies(true);
    return studies.find(study => study.slug === slug && study.published) ?? null;
  }

  async getServices(): Promise<ServiceRecord[]> {
    const records = await this.listRecords('services', '&sort=sort');
    return records
      .map(record => ({
        code: String(record.code ?? ''),
        title: String(record.title ?? ''),
        list_price_pence: Number(record.list_price_pence ?? 0),
        azimuth_deg: Number(record.azimuth_deg ?? 0),
        elevation_deg: Number(record.elevation_deg ?? 0),
        sort: Number(record.sort ?? 0),
      }))
      .filter(service => service.code !== '')
      .sort((a, b) => a.sort - b.sort);
  }

  async getTeam(): Promise<TeamMember[]> {
    const records = await this.listRecords('team');
    return records.map(record => ({
      name: String(record.name ?? ''),
      role: String(record.role ?? ''),
      bio: String(record.bio ?? ''),
    }));
  }

  async getInsights(): Promise<Insight[]> {
    const records = await this.listRecords('insights');
    return records.map(record => ({
      slug: String(record.slug ?? ''),
      title: String(record.title ?? ''),
      summary: String(record.summary ?? ''),
    }));
  }

  async getMarquee(): Promise<string[]> {
    const records = await this.listRecords('marquee', '&sort=sort');
    return records.map(record => String(record.name ?? ''));
  }

  async getContent(): Promise<StudioContent> {
    const [caseStudies, services, team, insights, marquee] = await Promise.all([
      this.getCaseStudies(false),
      this.getServices(),
      this.getTeam(),
      this.getInsights(),
      this.getMarquee(),
    ]);
    return { case_studies: caseStudies, services, team, insights, marquee };
  }

  async createCaseStudy(study: CaseStudy): Promise<void> {
    await this.request('POST', 'case_studies/records', {
      slug: study.slug,
      title: study.title,
      client: study.client,
      summary: study.summary,
      primitives: study.scene.primitives,
      accent: study.scene.accent,
      published: study.published,
      sort: study.sort,
    });
  }

  async createService(service: ServiceRecord): Promise<void> {
    await this.request('POST', 'services/records', {
      code: service.code,
      title: service.title,
      list_price_pence: service.list_price_pence,
      azimuth_deg: service.azimuth_deg,
      elevation_deg: service.elevation_deg,
      sort: service.sort,
    });
  }

  async ensureTeam(team: { name: string; role: string; bio: string }[]): Promise<void> {
    const existing = await this.listRecords('team');
    const existingNames = new Set(existing.map(record => String(record.name)));
    for (const member of team) {
      if (!existingNames.has(member.name)) {
        await this.request('POST', 'team/records', member);
      }
    }
  }

  async ensureInsights(insights: { slug: string; title: string; summary: string }[]): Promise<void> {
    const existing = await this.listRecords('insights');
    const existingSlugs = new Set(existing.map(record => String(record.slug)));
    for (const insight of insights) {
      if (!existingSlugs.has(insight.slug)) {
        await this.request('POST', 'insights/records', insight);
      }
    }
  }

  async ensureMarquee(names: string[]): Promise<void> {
    const existing = await this.listRecords('marquee');
    const existingNames = new Set(existing.map(record => String(record.name)));
    for (const [index, name] of names.entries()) {
      if (!existingNames.has(name)) {
        await this.request('POST', 'marquee/records', { name, sort: index + 1 });
      }
    }
  }

  async updateCaseStudy(slug: string, fields: Partial<CaseStudy>): Promise<void> {
    const records = await this.listRecords('case_studies');
    const match = records.find(record => record.slug === slug);
    if (!match) {
      throw new Error('not_found');
    }
    const payload: Record<string, unknown> = {};
    if (fields.title !== undefined) {
      payload.title = fields.title;
    }
    if (fields.client !== undefined) {
      payload.client = fields.client;
    }
    if (fields.summary !== undefined) {
      payload.summary = fields.summary;
    }
    if (fields.published !== undefined) {
      payload.published = fields.published;
    }
    if (fields.sort !== undefined) {
      payload.sort = fields.sort;
    }
    if (fields.scene !== undefined) {
      payload.primitives = fields.scene.primitives;
      payload.accent = fields.scene.accent;
    }
    await this.requestOk('PATCH', `case_studies/records/${match.id}`, payload);
  }

  async updateService(code: string, fields: Partial<ServiceRecord>): Promise<void> {
    const records = await this.listRecords('services');
    const match = records.find(record => record.code === code);
    if (!match) {
      throw new Error('not_found');
    }
    await this.requestOk('PATCH', `services/records/${match.id}`, fields);
  }
}
