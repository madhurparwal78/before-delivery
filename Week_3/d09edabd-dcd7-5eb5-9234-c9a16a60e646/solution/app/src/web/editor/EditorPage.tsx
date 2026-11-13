import { useEffect, useRef } from 'react';
import '../styles/chrome.css';
import '../styles/editor.css';
import { navigate } from '../nav';
import { Dialog } from '../ui/Dialog';
import { usePhone } from '../ui/hooks';
import { DesktopChrome, PhoneChrome } from './Chrome';
import CueTimeline from './CueTimeline';
import DebriefDialog from './DebriefDialog';
import Inspector from './Inspector';
import Palette from './Palette';
import Picker from './Picker';
import Playtests from './Playtests';
import PropLibrary from './PropLibrary';
import ScenePanel from './ScenePanel';
import { NewRoom, PropLocked, Shortcuts } from './SmallDialogs';
import Stage from './Stage';
import TriggerGraph from './TriggerGraph';
import VersionsSheet from './VersionsSheet';
import { installKeys } from './keys';
import { resyncSession } from './play';
import { startQueue } from './queue';
import { loadIdentity, loadRooms, openRoom, refreshOpenThumbnail, startHealthPolling } from './rooms';
import { closeDialog, openDialog, useEditor } from './state';
import { loadProps } from './props';

const RESYNC_MS = 15_000;
const THUMBNAIL_DELAY_MS = 2000;

function StatusLine() {
  const status = useEditor((s) => s.status);
  const cues = useEditor((s) => s.cuesOpen);
  return (
    <div role="status" aria-label="Editor status" className="toast" data-cues={cues} key={status.nonce}>
      {status.text}
    </div>
  );
}

function SceneSheet() {
  const open = useEditor((s) => s.dialogs.scene === true);
  return (
    <Dialog name="Scene" open={open} onClose={() => closeDialog('scene')} className="centered">
      <div className="dialog-head">
        <h2>Scene</h2>
      </div>
      <ScenePanel inSheet />
    </Dialog>
  );
}

/** The editor: the stage, its floating chrome and every sheet. */
export default function EditorPage() {
  const phone = usePhone();
  const me = useEditor((s) => s.me);
  const cuesOpen = useEditor((s) => s.cuesOpen);
  const room = useEditor((s) => s.room);
  const placements = useEditor((s) => s.placements);
  const storage = useEditor((s) => s.storageUp);
  const session = useEditor((s) => s.session);
  const thumbnailed = useRef<string | null>(null);

  useEffect(() => {
    const removeKeys = installKeys();
    startQueue();
    void (async () => {
      if (!(await loadIdentity())) return navigate('/signin', true);
      await loadRooms();
      startHealthPolling();
      void loadProps().catch(() => undefined);
      const wanted = /^\/app\/rooms\/([^/]+)$/.exec(location.pathname)?.[1];
      if (wanted) await openRoom(wanted, false).catch(() => undefined);
      openDialog('picker');
    })();
    return removeKeys;
  }, []);

  useEffect(() => {
    // A running playtest freezes the room's edits, so its thumbnail waits until the session ends.
    if (!room || !storage || session?.state === 'running') return;
    const first = thumbnailed.current !== room.id;
    thumbnailed.current = room.id;
    if (first && room.thumbnailUrl) return;
    const wait = first ? 0 : THUMBNAIL_DELAY_MS;
    const id = window.setTimeout(() => void refreshOpenThumbnail(), wait);
    return () => window.clearTimeout(id);
  }, [room?.id, room?.widthMm, room?.depthMm, room?.heightMm, placements, storage, session?.state]);

  useEffect(() => {
    if (!session) return;
    const id = window.setInterval(() => void resyncSession(), RESYNC_MS);
    return () => window.clearInterval(id);
  }, [session?.id]);

  if (!me) return <div className="stage-region" />;
  return (
    <>
      <Stage />
      {phone ? <PhoneChrome /> : <DesktopChrome />}
      {!phone && room ? <ScenePanel /> : null}
      <Inspector />
      {cuesOpen ? <CueTimeline /> : null}
      <StatusLine />
      <Picker />
      <NewRoom />
      <TriggerGraph />
      <PropLibrary />
      <VersionsSheet />
      <Playtests />
      <DebriefDialog />
      <Shortcuts />
      <PropLocked />
      <Palette />
      {phone ? <SceneSheet /> : null}
    </>
  );
}

