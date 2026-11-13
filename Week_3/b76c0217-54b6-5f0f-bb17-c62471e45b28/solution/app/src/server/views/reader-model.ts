import type { ReaderBoot } from '../../shared/types';
import type { ReaderModel } from './reader';

interface NavPage {
  id: string;
  title: string;
  path: string;
}

interface NavSource {
  tabs: { id: string; title: string; groups: { id: string; title: string; pages: NavPage[] }[] }[];
}

/** Sidebar, sections and the current group of a reader page. Empty groups and tabs are left out. */
export function readerModel(args: {
  mode: ReaderBoot['mode'];
  documentTitle: string;
  site: { slug: string; title: string };
  version: { slug: string; title: string };
  navigation: NavSource;
  currentPageId: string | null;
  hrefOf: (path: string) => string;
  versions: ReaderBoot['versions'];
  article: (groupTitle: string) => ReaderModel['article'];
}): ReaderModel {
  const filled = args.navigation.tabs
    .map((tab) => ({ ...tab, groups: tab.groups.filter((group) => group.pages.length > 0) }))
    .filter((tab) => tab.groups.length > 0);
  const owner = filled.find((tab) => tab.groups.some((group) => group.pages.some((page) => page.id === args.currentPageId)));
  const current = owner ?? filled[0];
  const group = current?.groups.find((g) => g.pages.some((p) => p.id === args.currentPageId));
  const first = (tab: (typeof filled)[number]): string => args.hrefOf(tab.groups[0]?.pages[0]?.path ?? '');
  return {
    mode: args.mode,
    documentTitle: args.documentTitle,
    site: args.site,
    version: args.version,
    homeHref: filled[0] ? first(filled[0]) : '#',
    tabs: filled.map((tab) => ({ id: tab.id, title: tab.title, href: first(tab), current: tab === current })),
    groups: (current?.groups ?? []).map((g) => ({
      id: g.id,
      title: g.title,
      pages: g.pages.map((page) => ({ id: page.id, title: page.title, href: args.hrefOf(page.path), current: page.id === args.currentPageId })),
    })),
    versions: args.versions,
    article: args.article(group?.title ?? ''),
  };
}
