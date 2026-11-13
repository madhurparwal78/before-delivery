import { createTeam, createUser, findUserByEmail, type Role } from '../db/accounts';
import {
  createGroup,
  createPage,
  createSite,
  createTab,
  createVersion,
  pagesOfVersion,
  replaceRedirects,
  siteBySlug,
  type Version,
} from '../db/content';
import { withTx } from '../db/pool';
import type { RedirectKind } from '../domain/redirects';
import { apiError, validationFailed } from '../http/errors';
import { readJsonBody, sendJson, type Ctx } from '../http/http';
import { hashPassword } from '../services/passwords';
import { publishVersion, PublishBlocked, PublishFailed } from '../services/publisher';
import { startOutage, type OutageService } from '../services/outage';

interface SeedUser {
  key: string;
  email: string;
  name: string;
  password: string;
}

interface SeedPage {
  path: string;
  title: string;
  source: string;
}

interface SeedGroup {
  title: string;
  pages: SeedPage[];
}

interface SeedTab {
  title: string;
  groups: SeedGroup[];
}

interface SeedVersion {
  slug: string;
  title: string;
  default?: boolean;
  published?: boolean;
  tabs: SeedTab[];
  redirects?: { from: string; to: string; kind: RedirectKind }[];
}

interface SeedSite {
  slug: string;
  title: string;
  versions: SeedVersion[];
  ratings?: { version: string; path: string; yes: number; no: number }[];
  searchTerms?: { version: string; term: string; searches: number; results: number }[];
}

interface SeedBody {
  users: SeedUser[];
  team: { name: string; members: { user: string; role: Role }[] };
  sites: SeedSite[];
}

function parseSeed(body: Record<string, unknown>): SeedBody {
  const seed = body as unknown as SeedBody;
  const invalid =
    !Array.isArray(seed.users) ||
    seed.users.length === 0 ||
    typeof seed.team !== 'object' ||
    seed.team === null ||
    !Array.isArray(seed.team.members) ||
    seed.team.members.filter((member) => member.role === 'owner').length !== 1 ||
    !Array.isArray(seed.sites);
  if (invalid) throw validationFailed({ seed: 'Provide users, one owner and sites.' });
  return seed;
}

/** Builds one team with its sites, versions, pages, votes and search records (DP-04). */
export async function postSeed(ctx: Ctx): Promise<void> {
  const seed = parseSeed(await readJsonBody(ctx));
  for (const user of seed.users) {
    if ((await findUserByEmail(user.email.toLowerCase())) !== null) throw apiError('email_in_use');
  }
  for (const site of seed.sites) {
    if ((await siteBySlug(site.slug)) !== null) throw apiError('slug_taken');
  }

  const created = await withTx(async (tx) => {
    const team = await createTeam(tx, seed.team.name);
    const users: Record<string, string> = {};
    for (const user of seed.users) {
      const member = seed.team.members.find((candidate) => candidate.user === user.key);
      const record = await createUser(tx, {
        teamId: team.id,
        email: user.email.toLowerCase(),
        name: user.name,
        passwordHash: await hashPassword(user.password),
        role: member === undefined ? 'viewer' : member.role,
      });
      users[user.key] = record.id;
    }
    const owner = seed.team.members.find((member) => member.role === 'owner');
    const ownerId = users[(owner as { user: string }).user];
    const sites: Record<string, unknown> = {};
    const versionsToPublish: { site: string; version: Version }[] = [];
    for (const siteSeed of seed.sites) {
      const site = await createSite(tx, {
        teamId: team.id,
        slug: siteSeed.slug,
        title: siteSeed.title,
      });
      const versions: Record<string, unknown> = {};
      const versionBySlug = new Map<string, Version>();
      for (const versionSeed of siteSeed.versions) {
        const version = await createVersion(tx, {
          siteId: site.id,
          slug: versionSeed.slug,
          title: versionSeed.title,
          isDefault: versionSeed.default === true,
        });
        versionBySlug.set(version.slug, version);
        const tabs: Record<string, string> = {};
        const groups: Record<string, string> = {};
        const pages: Record<string, string> = {};
        const pageList: { id: string; path: string; title: string }[] = [];
        for (const tabSeed of versionSeed.tabs) {
          const tab = await createTab(tx, { versionId: version.id, title: tabSeed.title });
          tabs[tabSeed.title] = tab.id;
          for (const groupSeed of tabSeed.groups) {
            const group = await createGroup(tx, {
              versionId: version.id,
              tabId: tab.id,
              title: groupSeed.title,
            });
            groups[groupSeed.title] = group.id;
            for (const pageSeed of groupSeed.pages) {
              const page = await createPage(tx, {
                versionId: version.id,
                groupId: group.id,
                path: pageSeed.path,
                title: pageSeed.title,
                source: pageSeed.source,
                updatedBy: ownerId,
              });
              if (pages[pageSeed.path] === undefined) pages[pageSeed.path] = page.id;
              pageList.push({ id: page.id, path: page.path, title: page.title });
            }
          }
        }
        if (versionSeed.redirects !== undefined) {
          await replaceRedirects(
            tx,
            version.id,
            versionSeed.redirects.map((redirect) => ({
              from: redirect.from,
              to: redirect.to,
              kind: redirect.kind ?? 'manual',
            })),
          );
        }
        versions[versionSeed.slug] = {
          id: version.id,
          tabs,
          groups,
          pages,
          pageList,
        };
        if (versionSeed.published === true) {
          versionsToPublish.push({ site: siteSeed.slug, version });
        }
      }
      for (const rating of siteSeed.ratings ?? []) {
        const version = versionBySlug.get(rating.version);
        if (version === undefined) continue;
        const pages = await pagesOfVersion(tx, version.id);
        const page = pages.find((candidate) => candidate.path === rating.path);
        if (page === undefined) continue;
        for (let i = 0; i < rating.yes; i += 1) {
          await tx.query('INSERT INTO votes (reader_id, page_id, vote) VALUES ($1, $2, $3)', [
            `seed-yes-${page.id}-${i}`,
            page.id,
            'yes',
          ]);
        }
        for (let i = 0; i < rating.no; i += 1) {
          await tx.query('INSERT INTO votes (reader_id, page_id, vote) VALUES ($1, $2, $3)', [
            `seed-no-${page.id}-${i}`,
            page.id,
            'no',
          ]);
        }
      }
      for (const term of siteSeed.searchTerms ?? []) {
        const version = versionBySlug.get(term.version);
        if (version === undefined) continue;
        for (let i = 0; i < term.searches; i += 1) {
          await tx.query(
            'INSERT INTO search_records (site_id, version_id, term, results) VALUES ($1, $2, $3, $4)',
            [site.id, version.id, term.term, term.results],
          );
        }
      }
      sites[siteSeed.slug] = { id: site.id, slug: site.slug, versions, publish: {} };
    }
    return { team, users, sites, versionsToPublish };
  });

  for (const entry of created.versionsToPublish) {
    const site = created.sites[entry.site] as { id: string; slug: string; publish: Record<string, string> };
    const siteRecord = await siteBySlug(entry.site);
    if (siteRecord === null) continue;
    try {
      await publishVersion(siteRecord, entry.version);
      site.publish[entry.version.slug] = 'published';
    } catch (error) {
      if (error instanceof PublishBlocked) site.publish[entry.version.slug] = 'blocked';
      else if (error instanceof PublishFailed) site.publish[entry.version.slug] = 'failed';
      else throw error;
    }
  }

  const sites: Record<string, unknown> = {};
  for (const [slug, value] of Object.entries(created.sites)) {
    const site = value as { id: string; versions: unknown; publish: unknown };
    sites[slug] = { id: site.id, publish: site.publish, versions: site.versions };
  }
  sendJson(ctx, 201, { users: created.users, teamId: created.team.id, sites });
}

export async function postOutage(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const service = body.service;
  const ms = body.ms;
  if (service !== 'storage' && service !== 'mail') {
    throw validationFailed({ service: 'Choose storage or mail.' });
  }
  if (typeof ms !== 'number' || ms < 1 || ms > 600000) {
    throw validationFailed({ ms: 'Give 1 to 600000 milliseconds.' });
  }
  const until = startOutage(service as OutageService, ms);
  sendJson(ctx, 200, { service, until: until.toISOString() });
}


