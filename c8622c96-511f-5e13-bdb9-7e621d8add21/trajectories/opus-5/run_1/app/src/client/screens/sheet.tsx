import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { displayCoopTime } from '../../domain/time.js';
import {
  NoAnswer,
  RequestFailed,
  request,
  type EssayView,
  type FeedEssay,
  type FollowItem,
  type LicenceView,
  type Session,
  type ShortlistItem,
} from '../api.js';
import { ClaimControl, type ClaimRingState } from '../components/ClaimControl.js';
import { displayMoney, essayStamp } from '../format.js';
import { useEscape, useFocusTrap, usePolling, useReducedMotion, useWideViewport } from '../hooks.js';
import { navigate, useLocation } from '../router.js';

const UNAVAILABLE = "That essay isn't available.";
const CLAIMING = 'Claiming…';
const LICENSING = 'Licensing…';
const NOT_LICENSABLE = "This essay can't be licensed right now.";
const ALREADY_LICENSED = 'Your newsroom already licenses this essay.';
const CLAIM_NO_ANSWER =
  'Couldn’t reach Saltprint Desk. Hold Claim again to check whether your claim went through.';
const BUY_NO_ANSWER =
  'Couldn’t reach Saltprint Desk. Buy again to check whether your licence went through.';

interface SheetUrl {
  q: string;
  essay: string | null;
  frame: string | null;
}

function readUrl(search: string): SheetUrl {
  const params = new URLSearchParams(search);
  return { q: params.get('q') ?? '', essay: params.get('essay'), frame: params.get('frame') };
}

function writeUrl(next: SheetUrl, replace: boolean): void {
  const params = new URLSearchParams();
  if (next.q !== '') params.set('q', next.q);
  if (next.essay) {
    params.set('essay', next.essay);
    params.set('frame', next.frame ?? '1');
  }
  const query = params.toString();
  navigate(`/sheet${query === '' ? '' : `?${query}`}`, replace);
}

function clampFrame(raw: string | null, count: number): number {
  if (count === 0) return 1;
  const value = Number(raw);
  if (raw === null || raw.trim() === '' || Number.isNaN(value)) return 1;
  return Math.min(count, Math.max(1, Math.round(value)));
}

/** The idempotency key of a request that never got an HTTP answer, kept for the page's life. */
const unansweredKeys = new Map<string, string>();

function keyFor(essayId: string, kind: 'exclusive' | 'standard'): string {
  const slot = `${essayId}:${kind}`;
  const kept = unansweredKeys.get(slot);
  if (kept) return kept;
  const key = `${slot}:${crypto.randomUUID()}`;
  unansweredKeys.set(slot, key);
  return key;
}

function dropKey(essayId: string, kind: 'exclusive' | 'standard'): void {
  unansweredKeys.delete(`${essayId}:${kind}`);
}

function claimStampFor(essay: EssayView, mine: LicenceView | null): string {
  const window = essay.window;
  if (window.state === 'claimed' && window.held_until_display) {
    if (window.held_by === 'you') {
      if (mine?.state === 'pending_invoice') {
        return `PENDING INVOICE · window held for your newsroom until ${window.held_until_display}. Billing is unreachable; the invoice is raised automatically when it returns.`;
      }
      return `EXCLUSIVE · yours until ${window.held_until_display}`;
    }
    if (window.held_by === 'your_newsroom') return `Held by your newsroom until ${window.held_until_display}`;
    return `Held by another newsroom until ${window.held_until_display}`;
  }
  if (mine && (mine.state === 'active' || mine.state === 'pending_invoice')) {
    return ALREADY_LICENSED;
  }
  if (window.standard_running_until_display) {
    return `Standard licences run until ${window.standard_running_until_display}; the exclusive opens then.`;
  }
  if (essay.state !== 'embargoed' && essay.state !== 'live') return NOT_LICENSABLE;
  return '';
}

function licenceStampFor(essay: EssayView, mine: LicenceView | null): string {
  if (mine && mine.kind === 'standard') {
    if (mine.state === 'active') return `STANDARD · licensed until ${mine.window_end_display}`;
    if (mine.state === 'pending_invoice') {
      return `PENDING INVOICE · licence held until ${mine.hold_until_display}. Billing is unreachable; the invoice is raised automatically when it returns.`;
    }
  }
  if (mine && mine.kind === 'exclusive' && (mine.state === 'active' || mine.state === 'pending_invoice')) {
    return ALREADY_LICENSED;
  }
  const window = essay.window;
  if (window.state === 'claimed' && window.held_by === 'another_newsroom' && window.held_until_display) {
    return `Exclusive held by another newsroom until ${window.held_until_display}`;
  }
  if (essay.state !== 'embargoed' && essay.state !== 'live') return NOT_LICENSABLE;
  return '';
}

function stampFromFailure(failure: RequestFailed, claim: boolean): string {
  const error = failure.body;
  switch (error.code) {
    case 'window_held':
      if (error.held_by === 'your_newsroom') {
        return `Held by your newsroom until ${displayCoopTime(new Date(error.held_until ?? ''))}`;
      }
      return `Held by another newsroom until ${displayCoopTime(new Date(error.held_until ?? ''))}`;
    case 'exclusive_held':
      return `Exclusive held by another newsroom until ${displayCoopTime(new Date(error.held_until ?? ''))}`;
    case 'standard_licences_active':
      return `Standard licences run until ${displayCoopTime(
        new Date(error.blocked_until ?? ''),
      )}; the exclusive opens then.`;
    case 'already_licensed':
      return ALREADY_LICENSED;
    case 'not_licensable':
    case 'taken_down':
      return NOT_LICENSABLE;
    default:
      return claim ? error.message : error.message;
  }
}

function ringFor(stamp: string): ClaimRingState {
  if (stamp.startsWith('EXCLUSIVE')) return 'won';
  if (stamp.startsWith('PENDING INVOICE')) return 'pending';
  if (stamp.startsWith('Held by') || stamp.startsWith('Exclusive held')) return 'held';
  return 'idle';
}

interface LedgerProps {
  session: Session;
  essay: EssayView;
  frame: number;
  mine: LicenceView | null;
  follows: FollowItem[];
  shortlist: ShortlistItem[];
  onChanged: () => void;
  wide: boolean;
  expanded: boolean;
  onExpanded: (expanded: boolean) => void;
}

function Ledger({
  session,
  essay,
  frame,
  mine,
  follows,
  shortlist,
  onChanged,
  wide,
  expanded,
  onExpanded,
}: LedgerProps): React.ReactElement {
  const reducedMotion = useReducedMotion();
  const [claimStamp, setClaimStamp] = useState('');
  const [licenceStamp, setLicenceStamp] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [buying, setBuying] = useState(false);
  const [followStatus, setFollowStatus] = useState('');
  const [shortlistStatus, setShortlistStatus] = useState('');
  const editor = session.role === 'picture_editor';

  useEffect(() => {
    if (claiming || buying) return;
    setClaimStamp(claimStampFor(essay, mine));
    setLicenceStamp(licenceStampFor(essay, mine));
  }, [essay, mine, claiming, buying]);

  const sendLicence = async (kind: 'exclusive' | 'standard'): Promise<void> => {
    const setStamp = kind === 'exclusive' ? setClaimStamp : setLicenceStamp;
    const setBusy = kind === 'exclusive' ? setClaiming : setBuying;
    setBusy(true);
    setStamp(kind === 'exclusive' ? CLAIMING : LICENSING);
    try {
      const result = await request<LicenceView>(`/api/essays/${essay.id}/licences`, {
        method: 'POST',
        body: { kind },
        headers: { 'Idempotency-Key': keyFor(essay.id, kind) },
      });
      dropKey(essay.id, kind);
      const licence = result.data;
      if (kind === 'exclusive') {
        setStamp(
          licence.state === 'active'
            ? `EXCLUSIVE · yours until ${licence.window_end_display}`
            : `PENDING INVOICE · window held for your newsroom until ${licence.hold_until_display}. Billing is unreachable; the invoice is raised automatically when it returns.`,
        );
      } else {
        setStamp(
          licence.state === 'active'
            ? `STANDARD · licensed until ${licence.window_end_display}`
            : `PENDING INVOICE · licence held until ${licence.hold_until_display}. Billing is unreachable; the invoice is raised automatically when it returns.`,
        );
      }
    } catch (failure) {
      if (failure instanceof RequestFailed) {
        dropKey(essay.id, kind);
        setStamp(stampFromFailure(failure, kind === 'exclusive'));
      } else if (failure instanceof NoAnswer) {
        setStamp(kind === 'exclusive' ? CLAIM_NO_ANSWER : BUY_NO_ANSWER);
      }
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const followEssay = follows.find((follow) => follow.essay_id === essay.id) ?? null;
  const currentFrame = essay.frames[frame - 1];
  const onShortlist = currentFrame
    ? shortlist.some((item) => item.frame_id === currentFrame.id)
    : false;

  const toggleFollow = async (
    target: { essay_id: string } | { contributor: string },
    existing: FollowItem | null,
    label: string,
  ): Promise<void> => {
    try {
      if (existing) {
        await request(`/api/follows/${existing.id}`, { method: 'DELETE' });
        setFollowStatus(`Unfollowed ${label}.`);
      } else {
        await request('/api/follows', { method: 'POST', body: target });
        setFollowStatus(`Following ${label}.`);
      }
    } catch {
      setFollowStatus('Couldn’t reach Saltprint Desk. Nothing was changed; try again.');
    } finally {
      onChanged();
    }
  };

  const addToShortlist = async (): Promise<void> => {
    if (!currentFrame) return;
    try {
      await request('/api/shortlist', { method: 'POST', body: { frame_id: currentFrame.id } });
      setShortlistStatus(`Frame ${frame} added to shortlist.`);
    } catch {
      setShortlistStatus('Couldn’t reach Saltprint Desk. Nothing was changed; try again.');
    } finally {
      onChanged();
    }
  };

  const exclusiveGreyed = essay.window.state === 'claimed' && essay.window.held_by !== 'you';
  const stamp = (
    <span className={`stamp ${essay.state === 'embargoed' ? 'embargo' : 'live'}`}>
      {essayStamp(essay.state, essay.lift_display)}
    </span>
  );
  const heading = (
    <>
      <h2>{essay.title}</h2>
      <p className="band">{essay.credit_line}</p>
      {stamp}
      <div className="column-rule" />
      <p className={`band mono${exclusiveGreyed ? ' greyed' : ''}`}>
        Exclusive window · {essay.exclusive_days} {essay.exclusive_days === 1 ? 'day' : 'days'} ·{' '}
        {displayMoney(essay.exclusive_price_minor)}
      </p>
      <p className="band mono">
        Standard licence · {essay.standard_days} {essay.standard_days === 1 ? 'day' : 'days'} ·{' '}
        {displayMoney(essay.standard_price_minor)}
      </p>
      <div className="column-rule" />
    </>
  );
  const claimArea = (
    <>
      {editor ? (
        <>
          <ClaimControl
            reducedMotion={reducedMotion}
            statusText={claimStamp}
            ringState={claiming ? 'idle' : ringFor(claimStamp)}
            sending={claiming}
            onCommit={() => void sendLicence('exclusive')}
          >
            {essay.frames.slice(0, 3).map((item) => (
              <img key={item.id} className="print" src={item.grid_url} alt="" />
            ))}
          </ClaimControl>
          <button type="button" disabled={buying} onClick={() => void sendLicence('standard')}>
            Buy standard licence
          </button>
          <span className="status" role="status" aria-label="Licence status">
            {licenceStamp}
          </span>
        </>
      ) : (
        <span className="status" role="status" aria-label="Claim status">
          {claimStamp}
        </span>
      )}
    </>
  );
  const extras = (
    <>
      {editor ? (
        <>
          <div className="column-rule" />
          <div className="row">
            <button
              type="button"
              aria-pressed={followEssay !== null}
              onClick={() =>
                void toggleFollow({ essay_id: essay.id }, followEssay, essay.title)
              }
            >
              {followEssay ? 'Following essay' : 'Follow essay'}
            </button>
            {essay.credits.map((credit) => {
              const existing =
                follows.find((follow) => follow.contributor === credit.handle) ?? null;
              return (
                <button
                  key={credit.handle}
                  type="button"
                  aria-pressed={existing !== null}
                  onClick={() =>
                    void toggleFollow({ contributor: credit.handle }, existing, credit.name)
                  }
                >
                  {existing ? `Following ${credit.name}` : `Follow ${credit.name}`}
                </button>
              );
            })}
          </div>
          <span className="status" role="status" aria-label="Follow status">
            {followStatus}
          </span>
          <button type="button" disabled={onShortlist} onClick={() => void addToShortlist()}>
            {onShortlist ? 'On shortlist' : `Add frame ${frame} to shortlist`}
          </button>
          <span className="status" role="status" aria-label="Shortlist status">
            {shortlistStatus}
          </span>
        </>
      ) : null}
    </>
  );

  if (wide) {
    return (
      <aside className="ledger" aria-label="Ledger">
        {heading}
        {claimArea}
        {extras}
      </aside>
    );
  }
  return (
    <section className={`ledger${expanded ? '' : ' collapsed'}`} aria-label="Ledger">
      <div className="sheet-handle" onPointerDown={() => onExpanded(!expanded)} />
      <button type="button" onClick={() => onExpanded(!expanded)}>
        {expanded ? 'Collapse ledger' : 'Expand ledger'}
      </button>
      {expanded ? heading : stamp}
      {claimArea}
      {expanded ? extras : null}
    </section>
  );
}

interface ViewerProps {
  session: Session;
  essay: EssayView;
  frame: number;
  onFrame: (frame: number) => void;
  onClose: () => void;
  mine: LicenceView | null;
  follows: FollowItem[];
  shortlist: ShortlistItem[];
  onChanged: () => void;
}

function StoryViewer({
  session,
  essay,
  frame,
  onFrame,
  onClose,
  mine,
  follows,
  shortlist,
  onChanged,
}: ViewerProps): React.ReactElement {
  const wide = useWideViewport();
  const dialog = useRef<HTMLDivElement | null>(null);
  const swipeFrom = useRef<{ x: number; width: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const total = essay.frames.length;
  const current = essay.frames[frame - 1];
  useFocusTrap(dialog);

  const step = (direction: number): void => {
    const next = frame + direction;
    if (next < 1 || next > total) return;
    onFrame(next);
  };

  /** Escape collapses an expanded sheet first, then closes the story. */
  useEscape(() => {
    if (expanded && !wide) {
      setExpanded(false);
      return;
    }
    onClose();
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tag = target ? target.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div
      className="story"
      role="dialog"
      aria-modal="true"
      aria-label={essay.title}
      ref={dialog}
    >
      <div className="progress-rule" role="group" aria-label="Story progress">
        {essay.frames.map((item, index) => (
          <span key={item.id} className={index < frame ? 'filled' : ''} />
        ))}
      </div>
      <div className="story-body">
        <div className="story-frame">
          <div
            className="plate"
            onTouchStart={(event) => {
              const touch = event.touches[0];
              if (!touch) return;
              swipeFrom.current = {
                x: touch.clientX,
                width: event.currentTarget.getBoundingClientRect().width,
              };
            }}
            onTouchEnd={(event) => {
              const from = swipeFrom.current;
              const touch = event.changedTouches[0];
              swipeFrom.current = null;
              if (!from || !touch) return;
              const dx = touch.clientX - from.x;
              if (Math.abs(dx) < from.width / 4) return;
              step(dx < 0 ? 1 : -1);
            }}
          >
            {current ? <img key={current.id} src={current.preview_url} alt={current.caption} /> : null}
            <button
              type="button"
              className="half left"
              aria-label="Previous frame"
              disabled={frame <= 1}
              onClick={() => step(-1)}
            />
            <button
              type="button"
              className="half right"
              aria-label="Next frame"
              disabled={frame >= total}
              onClick={() => step(1)}
            />
          </div>
          <p className="frame-caption">
            {current ? current.caption : ''}
            <br />
            <span className="mono">
              Frame {frame} of {total}
            </span>
          </p>
          <div className="story-controls">
            <button type="button" disabled={frame <= 1} onClick={() => step(-1)}>
              Previous frame
            </button>
            <button type="button" disabled={frame >= total} onClick={() => step(1)}>
              Next frame
            </button>
            <button type="button" onClick={onClose}>
              Close story
            </button>
          </div>
        </div>
        <Ledger
          session={session}
          essay={essay}
          frame={frame}
          mine={mine}
          follows={follows}
          shortlist={shortlist}
          onChanged={onChanged}
          wide={wide}
          expanded={expanded}
          onExpanded={setExpanded}
        />
      </div>
    </div>
  );
}

export function ContactSheet({ session }: { session: Session }): React.ReactElement {
  const location = useLocation();
  const url = readUrl(location.search);
  const [searchText, setSearchText] = useState(url.q);
  const [feed, setFeed] = useState<FeedEssay[]>([]);
  const [sheetStatus, setSheetStatus] = useState('');
  const [essay, setEssay] = useState<EssayView | null>(null);
  const [licences, setLicences] = useState<LicenceView[]>([]);
  const [follows, setFollows] = useState<FollowItem[]>([]);
  const [shortlist, setShortlist] = useState<ShortlistItem[]>([]);
  const pushed = useRef(false);
  const opener = useRef<string | null>(null);
  const focusedFor = useRef<string | null>(null);
  const wasOpen = useRef(false);
  const editor = session.role === 'picture_editor';

  const loadFeed = useCallback(
    (query: string) => {
      void request<{ essays: FeedEssay[] }>(`/api/feed?q=${encodeURIComponent(query)}`)
        .then((result) => setFeed(result.data.essays))
        .catch(() => setFeed([]));
    },
    [],
  );

  useEffect(() => {
    setSearchText(url.q);
    loadFeed(url.q);
  }, [url.q, loadFeed]);

  usePolling(() => loadFeed(url.q), 30_000);

  const loadNewsroomState = useCallback(() => {
    if (!editor) return;
    void request<{ licences: LicenceView[] }>('/api/licences')
      .then((result) => setLicences(result.data.licences))
      .catch(() => undefined);
    void request<{ follows: FollowItem[] }>('/api/follows')
      .then((result) => setFollows(result.data.follows))
      .catch(() => undefined);
    void request<{ items: ShortlistItem[] }>('/api/shortlist')
      .then((result) => setShortlist(result.data.items))
      .catch(() => undefined);
  }, [editor]);

  const loadEssay = useCallback(
    (id: string) => {
      void request<EssayView>(`/api/essays/${id}`)
        .then((result) => {
          setEssay(result.data);
          setSheetStatus('');
        })
        .catch((failure: unknown) => {
          setEssay(null);
          if (failure instanceof RequestFailed) {
            setSheetStatus(UNAVAILABLE);
            writeUrl({ q: url.q, essay: null, frame: null }, true);
          }
        });
    },
    [url.q],
  );

  useEffect(() => {
    if (!url.essay) {
      setEssay(null);
      return;
    }
    opener.current = url.essay;
    if (essay?.id !== url.essay) loadEssay(url.essay);
    loadNewsroomState();
  }, [url.essay, essay?.id, loadEssay, loadNewsroomState]);

  usePolling(() => {
    if (url.essay) {
      loadEssay(url.essay);
      loadNewsroomState();
    }
  }, 10_000);

  const frame = essay ? clampFrame(url.frame, essay.frames.length) : 1;

  useEffect(() => {
    if (!essay || url.essay !== essay.id) return;
    if (url.frame !== String(frame)) {
      writeUrl({ q: url.q, essay: essay.id, frame: String(frame) }, true);
    }
  }, [essay, frame, url.essay, url.frame, url.q]);

  useEffect(() => {
    if (!essay) {
      focusedFor.current = null;
      return;
    }
    if (focusedFor.current === essay.id) return;
    focusedFor.current = essay.id;
    window.setTimeout(() => {
      const next = document.querySelector<HTMLButtonElement>('button[aria-label="Next frame"]');
      const previous = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Previous frame"]',
      );
      const close = [...document.querySelectorAll<HTMLButtonElement>('.story button')].find(
        (button) => button.textContent === 'Close story',
      );
      if (next && !next.disabled) next.focus();
      else if (previous && !previous.disabled) previous.focus();
      else close?.focus();
    }, 0);
  }, [essay]);

  const closeViewer = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    writeUrl({ q: url.q, essay: null, frame: null }, true);
  }, [url.q]);

  /** However the viewer closes, focus returns to its opening tile, or to the search field. */
  useEffect(() => {
    if (url.essay) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const openerId = opener.current;
    const restore = (attempt: number): void => {
      const tile = openerId
        ? document.querySelector<HTMLButtonElement>(`[data-essay="${openerId}"]`)
        : null;
      if (tile) {
        tile.focus();
        return;
      }
      if (attempt < 4) {
        window.setTimeout(() => restore(attempt + 1), 80);
        return;
      }
      document.querySelector<HTMLInputElement>('input[aria-label="Search essays"]')?.focus();
    };
    window.setTimeout(() => restore(0), 30);
  }, [url.essay]);

  const openEssay = (id: string): void => {
    pushed.current = true;
    opener.current = id;
    writeUrl({ q: url.q, essay: id, frame: '1' }, false);
  };

  const mine = useMemo(
    () =>
      licences.find(
        (licence) =>
          licence.essay_id === url.essay &&
          (licence.state === 'active' || licence.state === 'pending_invoice'),
      ) ?? null,
    [licences, url.essay],
  );

  return (
    <main>
      <div className="sheet-search field">
        <label htmlFor="sheet-search">Search essays</label>
        <input
          id="sheet-search"
          type="search"
          aria-label="Search essays"
          value={searchText}
          onChange={(event) => {
            setSearchText(event.target.value);
            writeUrl({ q: event.target.value, essay: null, frame: null }, true);
          }}
        />
      </div>
      <span className="status" role="status" aria-label="Sheet status">
        {sheetStatus}
      </span>
      {feed.length === 0 && searchText !== '' ? (
        <p className="stamp">No essays match “{searchText}”.</p>
      ) : null}
      <section className="contact-sheet" aria-label="Contact sheet">
        {feed.map((item) => (
          <button
            key={item.id}
            type="button"
            className="tile"
            data-essay={item.id}
            aria-label={`Open ${item.title}`}
            onClick={() => openEssay(item.id)}
          >
            <span className="frame">
              {item.cover_url ? <img src={item.cover_url} alt="" /> : null}
            </span>
            <span className="caption">
              <span className="title">{item.title}</span>
              <span className="credit">{item.credit_line}</span>
              <span className={`stamp ${item.state === 'embargoed' ? 'embargo' : 'live'}`}>
                {essayStamp(item.state, item.lift_display)}
              </span>
            </span>
          </button>
        ))}
      </section>
      {essay ? (
        <StoryViewer
          session={session}
          essay={essay}
          frame={frame}
          onFrame={(next) => writeUrl({ q: url.q, essay: essay.id, frame: String(next) }, true)}
          onClose={closeViewer}
          mine={mine}
          follows={follows}
          shortlist={shortlist}
          onChanged={() => {
            loadNewsroomState();
            loadEssay(essay.id);
          }}
        />
      ) : null}
    </main>
  );
}
