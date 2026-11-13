import { userById } from '../db/accounts';
import {
  groupsOfVersion,
  pagesOfVersion,
  redirectsOfVersion,
  tabsOfVersion,
  type Page,
} from '../db/content';
import { latestAttempt } from '../db/publishing';
import { db } from '../db/pool';
import type { Redirect } from '../domain/redirects';

/** The three JSON documents all saved state is read through. */

export interface PageDocument {
  id: string;
  versionId: string;
  path: string;
  title: string;
  kind: string;
  operationId: string | null;
  source: string;
  revision: number;
  state: string;
  hasDraftChanges: boolean;
  updatedAt: string;
  updatedBy: { id: string; name: string } | null;
}

export async function pageDocument(page: Page): Promise<PageDocument> {
  const user = page.updatedBy === null ? null : await userById(page.updatedBy);
  return {
    id: page.id,
    versionId: page.versionId,
    path: page.path,
    title: page.title,
    kind: page.kind,
    operationId: page.operationId,
    source: page.source,
    revision: page.revision,
    state: page.state,
    hasDraftChanges: page.hasDraftChanges,
    updatedAt: page.updatedAt.toISOString(),
    updatedBy: user === null ? null : { id: user.id, name: user.name },
  };
}

export interface NavigationDocument {
  versionId: string;
  tabs: { id: string; title: string; groups: { id: string; title: string; pages: string[] }[] }[];
  redirects: Redirect[];
}

export async function navigationDocument(versionId: string): Promise<NavigationDocument> {
  const [tabs, groups, pages, redirects] = await Promise.all([
    tabsOfVersion(db, versionId),
    groupsOfVersion(db, versionId),
    pagesOfVersion(db, versionId),
    redirectsOfVersion(db, versionId),
  ]);
  return {
    versionId,
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      groups: groups
        .filter((group) => group.tabId === tab.id)
        .map((group) => ({
          id: group.id,
          title: group.title,
          pages: pages
            .filter((page) => page.groupId === group.id && page.state !== 'removed')
            .map((page) => page.id),
        })),
    })),
    redirects,
  };
}

export interface PublishReportDocument {
  versionId: string;
  status: string;
  publishedAt: string | null;
  snapshotId: string | null;
  errors: { file: string; line: number; code: string; message: string }[];
}

export async function publishReportDocument(versionId: string): Promise<PublishReportDocument> {
  const attempt = await latestAttempt(versionId);
  if (attempt === null) {
    return { versionId, status: 'idle', publishedAt: null, snapshotId: null, errors: [] };
  }
  return {
    versionId,
    status: attempt.status,
    publishedAt: attempt.publishedAt === null ? null : attempt.publishedAt.toISOString(),
    snapshotId: attempt.snapshotId,
    errors: attempt.errors,
  };
}
