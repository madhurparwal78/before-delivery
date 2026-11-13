// Building a whole workspace from one description: the grading seed, and the demo data at first start.

import { hashPassword } from '../auth';
import { db, one, transaction } from '../db';
import { ApiError, fail } from '../errors';
import { newId } from '../ids';
import { insertPage } from './pages';
import { publishVersion } from './publish';
import { versionById } from './scopes';
import { isPagePath, isSlug } from '../../shared/rules';
import type { RedirectKind, Role } from '../../shared/types';

export type SeedBody = {
  users: { key: string; email: string; name: string; password: string }[];
  team: { name: string; members: { user: string; role: Role }[] };
  sites: {
    slug: string;
    title: string;
    versions: {
      slug: string;
      title: string;
      default?: boolean;
      published?: boolean;
      tabs: { title: string; groups: { title: string; pages: { path: string; title: string; source: string }[] }[] }[];
      redirects?: { from: string; to: string; kind: RedirectKind }[];
    }[];
    ratings?: { version: string; path: string; yes: number; no: number }[];
    searchTerms?: { version: string; term: string; searches: number; results: number }[];
  }[];
};

interface SeedResult {
  users: Record<string, string>;
  teamId: string;
  sites: Record<
    string,
    {
      id: string;
      publish: Record<string, 'published' | 'blocked' | 'failed'>;
      versions: Record<
        string,
        {
          id: string;
          tabs: Record<string, string>;
          groups: Record<string, string>;
          pages: Record<string, string>;
          pageList: { id: string; path: string; title: string }[];
        }
      >;
    }
  >;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const every = <T>(value: unknown, check: (item: unknown) => item is T): value is T[] => Array.isArray(value) && value.every(check);
const optional = (value: unknown, check: (item: unknown) => boolean): boolean => value === undefined || check(value);

type SeedSite = SeedBody['sites'][number];
type SeedVersion = SeedSite['versions'][number];

const isUser = (value: unknown): value is SeedBody['users'][number] =>
  isRecord(value) && isText(value.key) && isText(value.email) && isText(value.name) && isText(value.password);
const isMember = (value: unknown): value is SeedBody['team']['members'][number] =>
  isRecord(value) && isText(value.user) && (value.role === 'owner' || value.role === 'editor' || value.role === 'viewer');
const isPage = (value: unknown): value is SeedVersion['tabs'][number]['groups'][number]['pages'][number] =>
  isRecord(value) && isText(value.path) && isPagePath(value.path) && isText(value.title) && isText(value.source);
const isGroup = (value: unknown): value is SeedVersion['tabs'][number]['groups'][number] => isRecord(value) && isText(value.title) && every(value.pages, isPage);
const isTab = (value: unknown): value is SeedVersion['tabs'][number] => isRecord(value) && isText(value.title) && every(value.groups, isGroup);
const isRedirect = (value: unknown): value is NonNullable<SeedVersion['redirects']>[number] =>
  isRecord(value) && isText(value.from) && isText(value.to) && (value.kind === 'auto' || value.kind === 'manual');
const isVersion = (value: unknown): value is SeedVersion =>
  isRecord(value) && isText(value.slug) && isSlug(value.slug) && isText(value.title) && every(value.tabs, isTab) &&
  optional(value.default, (v) => typeof v === 'boolean') && optional(value.published, (v) => typeof v === 'boolean') &&
  optional(value.redirects, (v) => every(v, isRedirect));
const isRating = (value: unknown): value is NonNullable<SeedSite['ratings']>[number] =>
  isRecord(value) && isText(value.version) && isText(value.path) && typeof value.yes === 'number' && typeof value.no === 'number';
const isTerm = (value: unknown): value is NonNullable<SeedSite['searchTerms']>[number] =>
  isRecord(value) && isText(value.version) && isText(value.term) && typeof value.searches === 'number' && typeof value.results === 'number';
const isSite = (value: unknown): value is SeedSite =>
  isRecord(value) && isText(value.slug) && isSlug(value.slug) && isText(value.title) && every(value.versions, isVersion) &&
  optional(value.ratings, (v) => every(v, isRating)) && optional(value.searchTerms, (v) => every(v, isTerm));

/** A seed body whose shape is right, whose team has exactly one owner and whose members are drawn from its users. */
function isSeedBody(value: unknown): value is SeedBody {
  if (!isRecord(value) || !every(value.users, isUser) || !isRecord(value.team) || !isText(value.team.name) || !every(value.team.members, isMember) || !every(value.sites, isSite)) {
    return false;
  }
  const keys = new Set(value.users.map((user) => user.key));
  return value.team.members.filter((member) => member.role === 'owner').length === 1 && value.team.members.every((member) => keys.has(member.user));
}

export async function seedWorkspace(body: unknown): Promise<SeedResult> {
  if (!isSeedBody(body)) {
    throw fail.validation({ seed: 'The seed needs users, a team with one owner and its members, and sites with valid slugs and paths.' });
  }
  for (const user of body.users) {
    if ((await one(db, 'select 1 as x from users where email = $1', [user.email.toLowerCase()])) !== null) {
      throw fail.emailInUse();
    }
  }
  for (const site of body.sites) {
    if ((await one(db, 'select 1 as x from sites where slug = $1', [site.slug])) !== null) {
      throw fail.slugTaken();
    }
  }
  const hashes = await Promise.all(body.users.map((user) => hashPassword(user.password)));
  const userIds = new Map(body.users.map((user) => [user.key, newId('usr')]));
  const teamId = newId('tm');
  const ownerKey = body.team.members.find((m) => m.role === 'owner')?.user ?? '';
  const ownerId = userIds.get(ownerKey) as string;

  const result: SeedResult = { users: Object.fromEntries(userIds), teamId, sites: {} };
  const toPublish: { siteSlug: string; versionSlug: string; versionId: string }[] = [];
  await transaction(async (tx) => {
    await tx.query('insert into teams (id, name) values ($1, $2)', [teamId, body.team.name]);
    for (const [index, user] of body.users.entries()) {
      const role = body.team.members.find((m) => m.user === user.key)?.role ?? 'viewer';
      await tx.query('insert into users (id, team_id, email, name, password_hash, role) values ($1, $2, $3, $4, $5, $6)', [
        userIds.get(user.key), teamId, user.email.toLowerCase(), user.name, hashes[index], role,
      ]);
    }
    for (const site of body.sites) {
      const siteId = newId('site');
      await tx.query('insert into sites (id, team_id, slug, title) values ($1, $2, $3, $4)', [siteId, teamId, site.slug, site.title]);
      const out: SeedResult['sites'][string] = { id: siteId, publish: {}, versions: {} };
      result.sites[site.slug] = out;
      const pageIds = new Map<string, Map<string, string>>();
      for (const [versionIndex, version] of site.versions.entries()) {
        const versionId = newId('ver');
        await tx.query('insert into versions (id, site_id, slug, title, is_default) values ($1, $2, $3, $4, $5)', [
          versionId, siteId, version.slug, version.title, version.default ?? versionIndex === 0,
        ]);
        const info: SeedResult['sites'][string]['versions'][string] = { id: versionId, tabs: {}, groups: {}, pages: {}, pageList: [] };
        out.versions[version.slug] = info;
        pageIds.set(version.slug, new Map());
        for (const [tabPosition, tab] of version.tabs.entries()) {
          const tabId = newId('tab');
          await tx.query('insert into tabs (id, version_id, title, position) values ($1, $2, $3, $4)', [tabId, versionId, tab.title, tabPosition]);
          info.tabs[tab.title] = tabId;
          for (const [groupPosition, group] of tab.groups.entries()) {
            const groupId = newId('grp');
            await tx.query('insert into groups (id, tab_id, version_id, title, position) values ($1, $2, $3, $4, $5)', [groupId, tabId, versionId, group.title, groupPosition]);
            info.groups[group.title] = groupId;
            for (const page of group.pages) {
              const id = await insertPage(tx, { versionId, groupId, path: page.path, title: page.title, source: page.source, userId: ownerId });
              info.pages[page.path] ??= id;
              pageIds.get(version.slug)?.set(page.path, id);
              info.pageList.push({ id, path: page.path, title: page.title });
            }
          }
        }
        for (const redirect of version.redirects ?? []) {
          await tx.query('insert into redirects (version_id, from_path, to_path, kind) values ($1, $2, $3, $4)', [versionId, redirect.from, redirect.to, redirect.kind]);
        }
        if (version.published) {
          toPublish.push({ siteSlug: site.slug, versionSlug: version.slug, versionId });
        }
      }
      for (const rating of site.ratings ?? []) {
        const pageId = pageIds.get(rating.version)?.get(rating.path);
        for (const [vote, count] of [['yes', rating.yes], ['no', rating.no]] as const) {
          for (let n = 0; n < count; n += 1) {
            await tx.query('insert into votes (page_id, reader, vote) values ($1, $2, $3)', [pageId, `seed-${vote}-${n}`, vote]);
          }
        }
      }
      for (const term of site.searchTerms ?? []) {
        const versionId = out.versions[term.version]?.id;
        for (let n = 0; n < term.searches; n += 1) {
          await tx.query('insert into search_records (site_id, version_id, term, results) values ($1, $2, $3, $4)', [siteId, versionId, term.term.toLowerCase(), term.results]);
        }
      }
    }
  });

  for (const entry of toPublish) {
    const scope = await versionById(entry.versionId);
    try {
      await publishVersion(scope, `seed-${entry.versionId}`);
      result.sites[entry.siteSlug]!.publish[entry.versionSlug] = 'published';
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      result.sites[entry.siteSlug]!.publish[entry.versionSlug] = error.code === 'publish_blocked' ? 'blocked' : 'failed';
    }
  }
  return result;
}
