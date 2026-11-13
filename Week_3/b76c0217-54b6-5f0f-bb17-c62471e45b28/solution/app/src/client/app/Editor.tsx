import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { copy } from '../../shared/copy';
import { timers } from '../../shared/rules';
import type {
  CheckResult,
  BootOf,
  GateError,
  ImportResult,
  MeJson,
  NavigationJson,
  OpenApiMeta,
  PageJson,
  PageSummary,
  PreviewLinkJson,
  PublishReport,
  RedirectJson,
  RenameResult,
  UserRef,
  VersionJson,
} from '../../shared/types';
import { announce, randomKey, reducedMotion, setBusy, tell } from '../shared/dom';
import { createDrawer, type Drawer } from '../shared/drawer';
import { tween } from '../shared/tween';
import { api, upload } from './api';
import { NewGroupDialog, NewPageDialog, NewVersionDialog, RemoveDialog, ShareDialog } from './Dialogs';
import { useEventStream, useMedia } from './hooks';
import { ProofMargin, type GateState } from './Margin';
import { PublishDialog, type PublishView } from './Publish';
import { SourcePane, type SaveStatus } from './Source';
import { Tree, type SpliceView } from './Tree';
import { Icon, signOut, ThemeSwitch } from './ui';

type Overlay =
  | { kind: 'newPage' }
  | { kind: 'newGroup' }
  | { kind: 'newVersion' }
  | { kind: 'remove'; pageId: string }
  | { kind: 'share'; link: PreviewLinkJson }
  | { kind: 'publish'; view: PublishView; returnTo: HTMLElement | null };

const pagesOf = (nav: NavigationJson): number => nav.tabs.reduce((sum, tab) => sum + tab.groups.reduce((n, group) => n + group.pages.length, 0), 0);

export function Editor({ boot }: { boot: BootOf<'editor'> }) {
  const { site } = boot;
  const [versions, setVersions] = useState<VersionJson[]>(site.versions);
  const version = versions.find((candidate) => candidate.id === boot.version.id) ?? boot.version;
  const [me, setMe] = useState<MeJson>(boot.me);
  const [nav, setNav] = useState<NavigationJson>(boot.navigation);
  const [pages, setPages] = useState<Record<string, PageSummary>>(Object.fromEntries(boot.pages.map((page) => [page.id, page])));
  const [pagePath, setPagePath] = useState(boot.pagePath ?? '');
  const canEdit = me.role !== 'viewer';
  const isPhone = useMedia('(max-width: 767.98px)');

  const summary = Object.values(pages).find((candidate) => candidate.path === pagePath) ?? null;
  const pageId = summary?.id ?? null;
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;

  // ---- the open page -----------------------------------------------------------------------------------
  const [page, setPage] = useState<PageJson | null>(null);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [conflict, setConflict] = useState<string | null>(null);
  const [presence, setPresence] = useState<UserRef[]>([]);
  const [source, setSource] = useState<OpenApiMeta | null>(null);
  const revision = useRef(0);
  const savedText = useRef('');
  const savedTitle = useRef('');
  const stopped = useRef(false);
  const textRef = useRef(text);
  const titleRef = useRef(title);
  textRef.current = text;
  titleRef.current = title;
  const pageRef = useRef(page);
  pageRef.current = page;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);

  const adopt = (data: PageJson): void => {
    revision.current = data.revision;
    savedText.current = data.source;
    savedTitle.current = data.title;
    setPage(data);
    setText(data.source);
    setTitle(data.title);
  };

  useLayoutEffect(() => {
    setPage(null);
    setConflict(null);
    setStatus('idle');
    setPresence([]);
    setErrorLine(null);
    stopped.current = false;
    if (pageId === null) {
      return undefined;
    }
    let current = true;
    void api<PageJson>('GET', `/api/pages/${pageId}`).then((result) => {
      if (current && result.ok) {
        adopt(result.data);
      }
    });
    return () => {
      current = false;
    };
  }, [pageId]);

  useLayoutEffect(() => {
    setSource(null);
    if (page?.kind === 'reference') {
      void api<OpenApiMeta>('GET', `/api/versions/${version.id}/openapi`).then((result) => result.ok && setSource(result.data));
    }
  }, [page?.id]);

  // ---- saving ------------------------------------------------------------------------------------------
  const gateRef = useRef<GateState | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const recheckRef = useRef<() => Promise<void>>(async () => undefined);

  const persist = async (): Promise<void> => {
    const open = pageRef.current;
    const nextText = textRef.current;
    const nextTitle = titleRef.current;
    if (open === null || stopped.current || (nextText === savedText.current && nextTitle === savedTitle.current)) {
      return;
    }
    setStatus('saving');
    const result = await api<PageJson>('PUT', `/api/pages/${open.id}`, { title: nextTitle, source: nextText, revision: revision.current });
    if (result.ok) {
      revision.current = result.data.revision;
      savedText.current = result.data.source;
      savedTitle.current = result.data.title;
      setStatus('saved');
      announce(copy.saved);
      setPages((previous) => ({ ...previous, [open.id]: { id: open.id, path: result.data.path, title: result.data.title, kind: result.data.kind } }));
      if (gateRef.current !== null) {
        await recheckRef.current();
      }
    } else if (result.failure.code === 'revision_conflict') {
      stopped.current = true;
      setConflict(result.failure.message);
      setStatus('idle');
      announce(result.failure.message);
    } else {
      setStatus('failed');
      announce(copy.saveFailed);
    }
  };
  const save = (): Promise<void> => {
    queue.current = queue.current.then(persist);
    return queue.current;
  };

  useLayoutEffect(() => {
    if (!canEdit || page === null || stopped.current || (text === savedText.current && title === savedTitle.current)) {
      return undefined;
    }
    const timer = window.setTimeout(() => void save(), timers.autosave);
    return () => window.clearTimeout(timer);
  }, [text, title, page?.id, canEdit]);

  // ---- live events -------------------------------------------------------------------------------------
  const [redirectsShown, setRedirectsShown] = useState<RedirectJson[]>(boot.navigation.redirects);
  const splicing = useRef(false);
  const navRef = useRef(nav);
  navRef.current = nav;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  useEventStream(`?versionId=${version.id}${pageId ? `&pageId=${pageId}` : ''}`, {
    navigation: (data) => {
      setNav(data);
      if (!splicing.current) {
        setRedirectsShown(data.redirects);
      }
    },
    page: (data) => {
      setPages((previous) => {
        const next = { ...previous };
        if (data.state === 'removed') {
          delete next[data.id];
        } else {
          next[data.id] = { id: data.id, path: data.path, title: data.title, kind: data.kind };
        }
        return next;
      });
      const open = pageRef.current;
      if (open !== null && data.id === open.id && data.state !== 'removed' && data.revision > revision.current) {
        if (textRef.current === savedText.current && titleRef.current === savedTitle.current) {
          adopt(data);
        }
        if (data.path !== open.path) {
          history.replaceState({}, '', pageUrl(data.path));
          setPagePath(data.path);
        }
      }
    },
    presence: (data) => {
      if (data.pageId === pageIdRef.current) {
        setPresence(data.editors.filter((user) => user.id !== me.user.id));
      }
    },
    role: (data) => {
      if (data.userId === me.user.id) {
        setMe((previous) => ({ ...previous, role: data.role }));
        announce(copy.roleChanged(data.role));
      }
    },
  });

  // ---- navigation among pages --------------------------------------------------------------------------
  const pageUrl = (path: string): string => `/app/sites/${site.slug}/${version.slug}/pages/${path}`;
  const drawer = useRef<Drawer | null>(null);

  const openPage = async (path: string): Promise<void> => {
    await save();
    history.pushState({}, '', pageUrl(path));
    setPagePath(path);
    if (isPhone) {
      drawer.current?.close();
    }
  };

  useLayoutEffect(() => {
    const onPop = (): void => setPagePath(decodeURIComponent(location.pathname.split('/pages/')[1] ?? ''));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ---- the Pages drawer on a phone ---------------------------------------------------------------------
  const treePane = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const pagesButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!isPhone || !treePane.current || !backdrop.current || !pagesButton.current) {
      return undefined;
    }
    const made = createDrawer({ panel: treePane.current, backdrop: backdrop.current, opener: pagesButton.current, label: 'Pages' });
    drawer.current = made;
    return () => {
      made.dispose();
      drawer.current = null;
    };
  }, [isPhone]);

  // ---- moving, renaming, removing ----------------------------------------------------------------------
  const move = async (url: string, body: object, message: string): Promise<boolean> => {
    const result = await api<NavigationJson>('POST', url, body);
    if (result.ok) {
      setNav(result.data);
      announce(message);
    } else {
      announce(result.failure.message);
    }
    return result.ok;
  };

  const [rewritten, setRewritten] = useState(0);
  const [splice, setSplice] = useState<SpliceView | null>(null);

  const runSplice = (result: RenameResult, oldPath: string): void => {
    const id = result.page.id;
    const newPath = result.page.path;
    const total = result.linksRewritten;
    const base = { pageId: id, oldPath, newPath, strike: 0, revealed: 0 };
    announce(copy.renamed(`/${newPath}`, total, result.redirectAdded ? `/${oldPath}` : null));
    const finish = (): void => {
      splicing.current = false;
      setRedirectsShown(navRef.current.redirects);
      setRewritten(total);
      setSplice({ ...base, phase: 'done', strike: 1, revealed: newPath.length });
    };
    if (reducedMotion()) {
      finish();
      return;
    }
    setRewritten(0);
    setSplice({ ...base, phase: 'strike' });
    tween(
      timers.spliceStrike,
      (eased) => setSplice({ ...base, phase: 'strike', strike: eased }),
      () => {
        const step = newPath.length > 1 ? Math.min(timers.spliceStagger, ((timers.spliceSet * 6) / 7) / (newPath.length - 1)) : timers.spliceStagger;
        setSplice({ ...base, phase: 'set', strike: 1 });
        tween(
          timers.spliceSet,
          (_, elapsed) => setSplice({ ...base, phase: 'set', strike: 1, revealed: Math.min(newPath.length, Math.floor(elapsed / step) + 1) }),
          () => {
            setSplice({ ...base, phase: 'file', strike: 1, revealed: newPath.length });
            flyChip(`/${oldPath} → /${newPath}`, id, () => {
              setRedirectsShown(navRef.current.redirects);
              setSplice({ ...base, phase: 'count', strike: 1, revealed: newPath.length });
              tween(
                timers.spliceCount,
                (eased) => setRewritten(Math.round(total * eased)),
                () => finish(),
              );
            });
          },
        );
      },
    );
  };

  const rename = async (id: string, path: string): Promise<{ ok: true } | { ok: false; message: string }> => {
    const previous = pagesRef.current[id]?.path ?? '';
    if (pageRef.current?.id === id) {
      await save();
    }
    const current = pageRef.current?.id === id ? { revision: revision.current } : await api<PageJson>('GET', `/api/pages/${id}`).then((r) => (r.ok ? r.data : { revision: 0 }));
    splicing.current = true;
    const result = await api<RenameResult>('POST', `/api/pages/${id}/rename`, { path, revision: current.revision });
    if (!result.ok) {
      splicing.current = false;
      return { ok: false, message: result.failure.fields?.path ?? result.failure.message };
    }
    const { page: renamed, navigation } = result.data;
    setNav(navigation);
    setPages((existing) => ({ ...existing, [id]: { id, path: renamed.path, title: renamed.title, kind: renamed.kind } }));
    if (pageRef.current?.id === id) {
      adopt(renamed);
      history.replaceState({}, '', pageUrl(renamed.path));
      setPagePath(renamed.path);
    }
    runSplice(result.data, previous);
    return { ok: true };
  };

  const remove = async (id: string): Promise<void> => {
    const removed = pagesRef.current[id];
    const result = await api<PageJson>('DELETE', `/api/pages/${id}`);
    if (!result.ok) {
      announce(result.failure.message);
      return;
    }
    setOverlay(null);
    const fresh = await api<NavigationJson>('GET', `/api/versions/${version.id}/navigation`);
    if (fresh.ok) {
      setNav(fresh.data);
      setRedirectsShown(fresh.data.redirects);
    }
    setPages((existing) => {
      const next = { ...existing };
      delete next[id];
      return next;
    });
    if (pageRef.current?.id === id) {
      const first = fresh.ok ? fresh.data.tabs.flatMap((tab) => tab.groups.flatMap((group) => group.pages))[0] : undefined;
      history.pushState({}, '', pageUrl(first ? (pagesRef.current[first]?.path ?? '') : ''));
      setPagePath(first ? (pagesRef.current[first]?.path ?? '') : '');
    }
    tell(`Removed ${removed?.title ?? 'the page'}.`);
  };

  // ---- publishing --------------------------------------------------------------------------------------
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [gate, setGate] = useState<GateState | null>(null);
  const [checking, setChecking] = useState(false);
  const [errorLine, setErrorLine] = useState<{ pageId: string; line: number } | null>(null);
  const pendingJump = useRef<{ pageId: string; line: number } | null>(null);
  gateRef.current = gate;

  const runCheck = async (): Promise<CheckResult | null> => {
    const result = await api<CheckResult>('POST', `/api/versions/${version.id}/check`);
    if (!result.ok) {
      announce(result.failure.message);
      return null;
    }
    return result.data;
  };

  recheckRef.current = async () => {
    const result = await runCheck();
    if (result !== null) {
      setGate({ errors: result.errors });
      announce(result.errors.length > 0 ? copy.problemsLeft(result.errors.length) : copy.noProblemsLeft);
      setErrorLine((line) => (line !== null && result.errors.some((error) => error.file === `pages/${pagesRef.current[line.pageId]?.path}.md` && error.line === line.line) ? line : null));
    }
  };

  const startPublish = async (): Promise<void> => {
    if (!canEdit || checking || overlay !== null) {
      return;
    }
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setChecking(true);
    announce(copy.checking(pagesOf(navRef.current)));
    await save();
    const result = await runCheck();
    setChecking(false);
    if (result === null) {
      return;
    }
    if (result.errors.length > 0) {
      announce(copy.checkFound(result.errors.length));
      setOverlay({ kind: 'publish', view: { kind: 'blocked', errors: result.errors }, returnTo });
    } else {
      announce(copy.checkClean);
      setOverlay({ kind: 'publish', view: { kind: 'confirm', changed: result.changedPages, busy: false, error: null }, returnTo });
    }
  };

  const publishNow = async (): Promise<void> => {
    setOverlay((current) => (current?.kind === 'publish' && current.view.kind === 'confirm' ? { ...current, view: { ...current.view, busy: true, error: null } } : current));
    announce(copy.publishing(version.title));
    const result = await api<PublishReport>('POST', `/api/versions/${version.id}/publish`, undefined, { 'Idempotency-Key': randomKey() });
    if (result.ok) {
      setOverlay(null);
      setGate(null);
      setVersions((existing) => existing.map((candidate) => (candidate.id === version.id ? { ...candidate, publishedAt: result.data.publishedAt } : candidate)));
      tell(copy.published(version.title));
      return;
    }
    const returnTo = overlay?.kind === 'publish' ? overlay.returnTo : null;
    const blocked = result.failure.report;
    if (result.failure.code === 'publish_blocked' && blocked) {
      announce(copy.checkFound(blocked.errors.length));
      setOverlay({ kind: 'publish', view: { kind: 'blocked', errors: blocked.errors }, returnTo });
      return;
    }
    announce(result.failure.message);
    setOverlay((current) => (current?.kind === 'publish' && current.view.kind === 'confirm' ? { ...current, view: { ...current.view, busy: false, error: result.failure.message } } : current));
  };

  const jump = (error: GateError): void => {
    const path = error.file.replace(/^pages\//, '').replace(/\.md$/, '');
    const target = Object.values(pagesRef.current).find((candidate) => candidate.path === path);
    if (target === undefined) {
      return;
    }
    const errors = overlay?.kind === 'publish' && overlay.view.kind === 'blocked' ? overlay.view.errors : (gateRef.current?.errors ?? []);
    pendingJump.current = { pageId: target.id, line: error.line };
    setGate({ errors });
    setOverlay(null);
    if (target.id !== pageRef.current?.id) {
      void openPage(target.path);
    } else {
      setJumpTick((tick) => tick + 1);
    }
  };
  const [jumpTick, setJumpTick] = useState(0);

  useLayoutEffect(() => {
    const wanted = pendingJump.current;
    if (wanted === null || page === null || page.id !== wanted.pageId || overlay !== null || textarea.current === null) {
      return;
    }
    pendingJump.current = null;
    const lines = text.split('\n');
    const offset = lines.slice(0, wanted.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
    setErrorLine(wanted);
    textarea.current.focus();
    textarea.current.setSelectionRange(offset, offset);
    document.querySelector(`[data-line="${wanted.line}"]`)?.scrollIntoView({ block: 'center' });
  }, [page?.id, overlay, jumpTick]);

  const publishRef = useRef(startPublish);
  publishRef.current = startPublish;
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        void publishRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- toolbar actions ---------------------------------------------------------------------------------
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  const addImage = async (file: File): Promise<void> => {
    setImageBusy(true);
    setImageError(null);
    await save();
    const result = await upload<{ url: string }>(`/api/sites/${site.id}/assets`, file, file.type);
    setImageBusy(false);
    if (!result.ok) {
      setImageError(result.failure.message);
      announce(result.failure.message);
      return;
    }
    const element = textarea.current as HTMLTextAreaElement;
    const alt = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim() || 'Image';
    const line = `![${alt}](${result.data.url})`;
    const at = element.selectionStart;
    pendingCaret.current = at + line.length;
    setText(textRef.current.slice(0, at) + line + textRef.current.slice(at));
    tell(copy.imageUploaded);
  };

  const importFile = async (file: File): Promise<void> => {
    setImportBusy(true);
    setImportError(null);
    const result = await upload<ImportResult>(`/api/versions/${version.id}/openapi?name=${encodeURIComponent(file.name)}`, file, 'application/json');
    setImportBusy(false);
    if (!result.ok) {
      setImportError(result.failure.message);
      announce(result.failure.message);
      return;
    }
    setPages((existing) => ({
      ...existing,
      ...Object.fromEntries(result.data.pages.map((entry) => [entry.id, { id: entry.id, path: entry.path, title: entry.title, kind: 'reference' as const }])),
    }));
    const fresh = await api<NavigationJson>('GET', `/api/versions/${version.id}/navigation`);
    if (fresh.ok) {
      setNav(fresh.data);
    }
    tell(copy.imported(result.data.pages.length));
  };

  const share = async (event: Event): Promise<void> => {
    if (page === null) {
      return;
    }
    const button = event.currentTarget as HTMLElement;
    setSharing(true);
    setBusy(button, true);
    await save();
    const result = await api<PreviewLinkJson>('POST', `/api/pages/${page.id}/preview-links`);
    setBusy(button, false);
    setSharing(false);
    if (result.ok) {
      announce(copy.previewLinkCreated);
      setOverlay({ kind: 'share', link: result.data });
    } else {
      announce(result.failure.message);
    }
  };

  const firstGroup = nav.tabs.flatMap((tab) => tab.groups).find((group) => group.pages.includes(pageId ?? ''))?.id ?? null;
  const removing = overlay?.kind === 'remove' ? pagesRef.current[overlay.pageId] : undefined;

  return (
    <>
      <header class="topbar">
        <div class="topbar-row">
          <button type="button" class="button pages-button" ref={pagesButton} aria-haspopup="dialog" onClick={() => drawer.current?.open()}>
            <Icon name="menu" />
            Pages
          </button>
          <div class="titles">
            <a class="site-name" href="/app">
              {site.title}
            </a>
            <span class="version-name">{version.title}</span>
          </div>
          <div class="topbar-end">
            <a class="button" href={`/app/sites/${site.slug}/analytics`}>
              Analytics
            </a>
            {me.role === 'owner' && (
              <a class="button" href="/app/team">
                Team
              </a>
            )}
            <ThemeSwitch />
            <button type="button" class="button" onClick={signOut}>
              <Icon name="logOut" size={16} />
              Sign out
            </button>
          </div>
        </div>
        <div class="topbar-actions">
          {canEdit && (
            <>
              <button type="button" class="button" onClick={() => setOverlay({ kind: 'newPage' })}>
                <Icon name="plus" size={16} />
                New page
              </button>
              <button type="button" class="button" onClick={() => setOverlay({ kind: 'newGroup' })}>
                <Icon name="folder" size={16} />
                New group
              </button>
              <button type="button" class="button" aria-busy={importBusy ? 'true' : undefined} onClick={() => importInput.current?.click()}>
                <Icon name="upload" size={16} />
                Import OpenAPI
              </button>
              <input
                ref={importInput}
                class="sr-only"
                type="file"
                tabIndex={-1}
                accept="application/json,.json"
                aria-label="OpenAPI file"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) {
                    void importFile(file);
                  }
                }}
              />
              <button type="button" class="button" onClick={() => setOverlay({ kind: 'newVersion' })}>
                <Icon name="layers" size={16} />
                New version
              </button>
            </>
          )}
          <a class="button" href={`/app/sites/${site.slug}/${version.slug}/redirects`}>
            <Icon name="arrowRightLeft" size={16} />
            Redirects
          </a>
          {summary && (
            <a class="button" href={`/app/sites/${site.slug}/${version.slug}/preview/${summary.path}`} target="_blank">
              <Icon name="eye" size={16} />
              Preview
            </a>
          )}
          {canEdit && summary && (
            <button type="button" class="button" disabled={page === null} aria-busy={sharing ? 'true' : undefined} onClick={(event) => void share(event)}>
              <Icon name="share" size={16} />
              Share preview
            </button>
          )}
          {canEdit && (
            <button type="button" class="button primary" aria-busy={checking ? 'true' : undefined} onClick={() => void startPublish()}>
              <Icon name="rocket" size={16} />
              Publish
            </button>
          )}
        </div>
      </header>
      {importError && <p class="form-error" style="margin:0.5rem 1rem">{importError}</p>}
      <div class="editor-grid">
        <div class="backdrop" ref={backdrop} hidden />
        <aside class="tree-pane" ref={treePane}>
          <h2>Pages</h2>
          <Tree
            nav={nav}
            pages={pages}
            selectedId={pageId}
            canEdit={canEdit}
            splice={splice}
            onOpen={(id) => void openPage(pagesRef.current[id]?.path ?? '')}
            onMovePage={(id, slot, message) => move(`/api/pages/${id}/move`, { groupId: slot.groupId, index: slot.index }, message)}
            onMoveGroup={(id, slot, message) => move(`/api/groups/${id}/move`, { tabId: slot.tabId, index: slot.index }, message)}
            onRename={rename}
            onRemove={(id) => setOverlay({ kind: 'remove', pageId: id })}
          />
        </aside>
        {page ? (
          <SourcePane
            textarea={textarea}
            title={title}
            text={text}
            readOnly={!canEdit || page.kind === 'reference'}
            canEdit={canEdit}
            isReference={page.kind === 'reference'}
            errorLine={errorLine?.pageId === page.id ? errorLine.line : null}
            status={status}
            imageBusy={imageBusy}
            imageError={imageError}
            pendingCaret={pendingCaret}
            onTitle={setTitle}
            onText={(value) => {
              setText(value);
              setStatus((current) => (current === 'saved' ? 'idle' : current));
            }}
            onImage={(file) => void addImage(file)}
          />
        ) : (
          <div class="editor-pane">
            <p class="reference-note">{pageId === null ? 'Choose a page in the tree, or file a new one with New page.' : ''}</p>
          </div>
        )}
        <ProofMargin
          loading={pageId !== null && page === null}
          presence={presence}
          conflict={conflict}
          redirects={redirectsShown}
          rewritten={rewritten}
          gate={gate}
          source={page?.kind === 'reference' ? source : null}
          versionId={version.id}
          onJump={jump}
          onCloseGate={() => {
            setGate(null);
            setErrorLine(null);
          }}
        />
      </div>
      {overlay?.kind === 'newPage' && (
        <NewPageDialog
          versionId={version.id}
          nav={nav}
          defaultGroupId={firstGroup}
          onClose={() => setOverlay(null)}
          onCreated={async (created) => {
            setOverlay(null);
            setPages((existing) => ({ ...existing, [created.id]: { id: created.id, path: created.path, title: created.title, kind: created.kind } }));
            const fresh = await api<NavigationJson>('GET', `/api/versions/${version.id}/navigation`);
            if (fresh.ok) {
              setNav(fresh.data);
            }
            await openPage(created.path);
          }}
        />
      )}
      {overlay?.kind === 'newGroup' && (
        <NewGroupDialog
          versionId={version.id}
          nav={nav}
          onClose={() => setOverlay(null)}
          onCreated={(fresh) => {
            setOverlay(null);
            setNav(fresh);
          }}
        />
      )}
      {overlay?.kind === 'newVersion' && (
        <NewVersionDialog
          siteId={site.id}
          versions={versions}
          currentId={version.id}
          onClose={() => setOverlay(null)}
          onCreated={(created) => {
            setOverlay(null);
            setVersions((existing) => [...existing, created]);
            tell(copy.versionCreated(created.title));
          }}
        />
      )}
      {removing && overlay?.kind === 'remove' && <RemoveDialog page={removing} onClose={() => setOverlay(null)} onRemove={() => remove(overlay.pageId)} />}
      {overlay?.kind === 'share' && <ShareDialog link={overlay.link} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'publish' && (
        <PublishDialog view={overlay.view} versionTitle={version.title} returnTo={overlay.returnTo} onJump={jump} onPublish={() => void publishNow()} onClose={() => setOverlay(null)} />
      )}
    </>
  );
}

/** The redirect chip lifts off the renamed row and travels into the proof margin's Redirects list. */
function flyChip(label: string, pageId: string, done: () => void): void {
  const from = document.getElementById(`row-${pageId}`)?.querySelector('.row-path')?.getBoundingClientRect();
  const to = document.querySelector('.proof-margin .chips')?.getBoundingClientRect();
  if (!from || !to) {
    done();
    return;
  }
  const chip = document.createElement('span');
  chip.className = 'chip flying-chip';
  chip.textContent = label;
  chip.setAttribute('aria-hidden', 'true');
  chip.style.left = `${from.left}px`;
  chip.style.top = `${from.top}px`;
  document.body.append(chip);
  const dx = to.left - from.left;
  const dy = to.bottom - from.top;
  tween(
    timers.spliceFile,
    (eased) => {
      chip.style.transform = `translate(${dx * eased}px, ${dy * eased}px)`;
    },
    () => {
      chip.remove();
      done();
    },
  );
}
