import { sessionUser, type User } from '../db/accounts';
import {
  groupById,
  pageById,
  siteById,
  tabById,
  versionById,
  type Group,
  type Page,
  type Site,
  type Tab,
  type Version,
} from '../db/content';
import { db } from '../db/pool';
import { apiError, notFound } from '../http/errors';
import { cookies, type Ctx } from '../http/http';

export const SESSION_COOKIE = 'galley_session';
export const READER_COOKIE = 'galley_reader';

export async function currentUser(ctx: Ctx): Promise<User | null> {
  const sessionId = cookies(ctx)[SESSION_COOKIE];
  return sessionId === undefined ? null : await sessionUser(sessionId);
}

export async function requireUser(ctx: Ctx): Promise<User> {
  const user = await currentUser(ctx);
  if (user === null) throw apiError('unauthenticated');
  return user;
}

/** Writers are owners and editors; viewers are refused on every write. */
export function requireWriter(user: User): void {
  if (user.role === 'viewer') throw apiError('forbidden_role');
}

export function requireOwner(user: User): void {
  if (user.role !== 'owner') throw apiError('forbidden_role');
}

export async function loadSite(user: User, siteId: string): Promise<Site> {
  const site = await siteById(siteId);
  if (site === null || site.teamId !== user.teamId) throw notFound();
  return site;
}

export interface VersionScope {
  version: Version;
  site: Site;
}

export async function loadVersion(user: User, versionId: string): Promise<VersionScope> {
  const version = await versionById(versionId);
  if (version === null) throw notFound();
  const site = await siteById(version.siteId);
  if (site === null || site.teamId !== user.teamId) throw notFound();
  return { version, site };
}

export interface PageScope extends VersionScope {
  page: Page;
}

export async function loadPage(user: User, pageId: string): Promise<PageScope> {
  const page = await pageById(db, pageId);
  if (page === null) throw notFound();
  const scope = await loadVersion(user, page.versionId);
  return { ...scope, page };
}

export async function loadGroup(user: User, groupId: string): Promise<VersionScope & { group: Group }> {
  const group = await groupById(groupId);
  if (group === null) throw notFound();
  const scope = await loadVersion(user, group.versionId);
  return { ...scope, group };
}

export async function loadTab(user: User, tabId: string): Promise<VersionScope & { tab: Tab }> {
  const tab = await tabById(tabId);
  if (tab === null) throw notFound();
  const scope = await loadVersion(user, tab.versionId);
  return { ...scope, tab };
}
