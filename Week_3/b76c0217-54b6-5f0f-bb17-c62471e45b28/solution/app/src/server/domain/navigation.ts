// A version's navigation: tabs, then groups, then pages, plus its redirects. Moves are applied one at a time.

import { one, type Db } from '../db';
import { fail } from '../errors';
import { newId } from '../ids';
import type { NavigationJson, RedirectJson } from '../../shared/types';

export async function loadRedirects(source: Db, versionId: string): Promise<RedirectJson[]> {
  const rows = await source.query<{ fromPath: string; toPath: string; kind: RedirectJson['kind'] }>(
    'select from_path, to_path, kind from redirects where version_id = $1 order by from_path collate "C"',
    [versionId],
  );
  return rows.map((row) => ({ from: row.fromPath, to: row.toPath, kind: row.kind }));
}

export async function loadNavigation(source: Db, versionId: string): Promise<NavigationJson> {
  const [tabs, groups, pages, redirects] = await Promise.all([
    source.query<{ id: string; title: string }>('select id, title from tabs where version_id = $1 order by position', [versionId]),
    source.query<{ id: string; tabId: string; title: string }>('select id, tab_id, title from groups where version_id = $1 order by position', [versionId]),
    source.query<{ id: string; groupId: string }>('select id, group_id from pages where version_id = $1 and not removed order by position', [versionId]),
    loadRedirects(source, versionId),
  ]);
  return {
    versionId,
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      groups: groups
        .filter((group) => group.tabId === tab.id)
        .map((group) => ({ id: group.id, title: group.title, pages: pages.filter((page) => page.groupId === group.id).map((page) => page.id) })),
    })),
    redirects,
  };
}

/** Serialise the writers of one version: the later move wins and the navigation stays consistent. */
export async function lockVersion(tx: Db, versionId: string): Promise<void> {
  await tx.query('select id from versions where id = $1 for update', [versionId]);
}

export async function addTab(tx: Db, versionId: string, title: string): Promise<string> {
  const id = newId('tab');
  await tx.query('insert into tabs (id, version_id, title, position) values ($1, $2, $3, (select count(*) from tabs where version_id = $2))', [id, versionId, title]);
  return id;
}

export async function addGroup(tx: Db, versionId: string, tabId: string, title: string): Promise<string> {
  const id = newId('grp');
  await tx.query(
    'insert into groups (id, tab_id, version_id, title, position) values ($1, $2, $3, $4, (select count(*) from groups where tab_id = $2))',
    [id, tabId, versionId, title],
  );
  return id;
}

async function renumberPages(tx: Db, groupId: string, ordered: string[]): Promise<void> {
  for (const [position, id] of ordered.entries()) {
    await tx.query('update pages set group_id = $2, position = $3 where id = $1', [id, groupId, position]);
  }
}

async function renumberGroups(tx: Db, tabId: string, ordered: string[]): Promise<void> {
  for (const [position, id] of ordered.entries()) {
    await tx.query('update groups set tab_id = $2, position = $3 where id = $1', [id, tabId, position]);
  }
}

/** Slot `index` is counted after the page has left its old place. */
export async function movePage(tx: Db, versionId: string, pageId: string, groupId: string, index: number): Promise<void> {
  const target = await one<{ id: string }>(tx, 'select id from groups where id = $1 and version_id = $2', [groupId, versionId]);
  if (target === null) {
    throw fail.validation({ groupId: 'Choose a group of this version.' });
  }
  const members = async (group: string): Promise<string[]> =>
    (await tx.query<{ id: string }>('select id from pages where group_id = $1 and not removed order by position', [group])).map((r) => r.id);
  const origin = await one<{ groupId: string }>(tx, 'select group_id from pages where id = $1', [pageId]);
  const source = (await members(origin?.groupId ?? groupId)).filter((id) => id !== pageId);
  const destination = origin?.groupId === groupId ? source : (await members(groupId)).filter((id) => id !== pageId);
  destination.splice(Math.min(Math.max(index, 0), destination.length), 0, pageId);
  if (origin !== null && origin.groupId !== groupId) {
    await renumberPages(tx, origin.groupId, source);
  }
  await renumberPages(tx, groupId, destination);
}

export async function moveGroup(tx: Db, versionId: string, groupId: string, tabId: string, index: number): Promise<void> {
  const target = await one<{ id: string }>(tx, 'select id from tabs where id = $1 and version_id = $2', [tabId, versionId]);
  if (target === null) {
    throw fail.validation({ tabId: 'Choose a tab of this version.' });
  }
  const members = async (tab: string): Promise<string[]> =>
    (await tx.query<{ id: string }>('select id from groups where tab_id = $1 order by position', [tab])).map((r) => r.id);
  const origin = await one<{ tabId: string }>(tx, 'select tab_id from groups where id = $1', [groupId]);
  const source = (await members(origin?.tabId ?? tabId)).filter((id) => id !== groupId);
  const destination = origin?.tabId === tabId ? source : (await members(tabId)).filter((id) => id !== groupId);
  destination.splice(Math.min(Math.max(index, 0), destination.length), 0, groupId);
  if (origin !== null && origin.tabId !== tabId) {
    await renumberGroups(tx, origin.tabId, source);
  }
  await renumberGroups(tx, tabId, destination);
}

/** Close the gap a removed page leaves in its group. */
export async function compactGroup(tx: Db, groupId: string): Promise<void> {
  const rows = await tx.query<{ id: string }>('select id from pages where group_id = $1 and not removed order by position', [groupId]);
  await renumberPages(tx, groupId, rows.map((row) => row.id));
}
