import { useState } from 'react';
import { Ellipsis, History, Redo2, Undo2, Users } from 'lucide-react';
import { MESSAGES } from '../../shared/messages';
import { isHere } from '../../shared/messages';
import { useSession } from '../session';
import { editGate, MenuButton, type MenuItemDef } from './controls';
import { useEditorSelector, useEditorStore } from './EditorProvider';
import { MembersDialog } from './MembersDialog';
import { publish, usePublishing } from './publish';
import { VersionsDialog } from './VersionsDialog';

const SAVE_TEXT = { saved: MESSAGES.saved, saving: MESSAGES.saving, failed: MESSAGES.notSaved } as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function EditorStatuses() {
  const saveStatus = useEditorSelector((e) => e.saveStatus);
  const statusText = useEditorSelector((e) => e.statusText);
  const connection = useEditorSelector((e) => e.connection);
  return (
    <>
      <div role="status" aria-label="Save status" className={`status-text${saveStatus === 'failed' ? ' warn' : ''}`}>
        {SAVE_TEXT[saveStatus]}
      </div>
      <div role="status" aria-label="Editor status" className={`status-text editor-status${connection === 'down' ? ' warn' : ''}`}>
        {statusText}
      </div>
    </>
  );
}

export function ScenePicker() {
  const { actions } = useEditorStore();
  const scenes = useEditorSelector((e) => e.document.scenes);
  const sceneId = useEditorSelector((e) => e.sceneId);
  return (
    <select aria-label="Scene" className="scene-picker" value={sceneId} onChange={(event) => actions.selectScene(event.target.value)}>
      {scenes.map((scene) => (
        <option key={scene.id} value={scene.id}>
          {scene.name}
        </option>
      ))}
    </select>
  );
}

function Presence() {
  const people = useEditorSelector((e) => e.people);
  const meId = useEditorSelector((e) => e.me.id);
  return (
    <div className="presence">
      {people
        .filter((person) => person.id !== meId)
        .map((person) => (
          <span key={person.id} role="img" aria-label={isHere(person.name)} title={isHere(person.name)} className="avatar">
            {initials(person.name)}
          </span>
        ))}
    </div>
  );
}

type Dialogs = 'members' | 'versions' | null;

/** The header actions: statuses, presence, Undo, Redo, Members, Versions and Publish; on a phone, the More actions menu. */
export function EditorHeaderActions({ phone }: { phone: boolean }) {
  const store = useEditorStore();
  const { actions } = store;
  const session = useSession();
  const canEdit = useEditorSelector((e) => e.canEdit);
  const role = useEditorSelector((e) => e.role);
  const publishing = usePublishing();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [publishError, setPublishError] = useState<string | undefined>();
  const gate = editGate(canEdit);
  const owner = role === 'Owner';
  const publishHint = canEdit ? MESSAGES.publishRefusal : MESSAGES.viewerRefusal;

  const doPublish = async (): Promise<void> => {
    setPublishError(undefined);
    const failure = await publish(store);
    if (failure) setPublishError(failure);
  };

  const menu: MenuItemDef[] = [
    { label: 'Undo', onSelect: actions.undo, disabled: !canEdit },
    { label: 'Redo', onSelect: actions.redo, disabled: !canEdit },
    { label: 'Members', onSelect: () => setDialog('members') },
    { label: 'Versions', onSelect: () => setDialog('versions') },
    { label: publishing ? MESSAGES.publishing : 'Publish', onSelect: () => void doPublish(), disabled: !owner || publishing },
    { label: 'Sign out', onSelect: () => void session.signOut() },
  ];

  return (
    <>
      {phone ? (
        <MenuButton menuLabel="More actions" label="More actions" align="end" className="btn btn-icon" items={menu}>
          <Ellipsis size={18} aria-hidden="true" />
        </MenuButton>
      ) : (
        <>
          <EditorStatuses />
          <Presence />
          <ScenePicker />
          <button type="button" className="btn btn-icon" aria-label="Undo" {...gate} onClick={actions.undo}>
            <Undo2 size={18} aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-icon" aria-label="Redo" {...gate} onClick={actions.redo}>
            <Redo2 size={18} aria-hidden="true" />
          </button>
          <button type="button" className="btn" onClick={() => setDialog('members')}>
            <Users size={16} aria-hidden="true" /> <span className="btn-label">Members</span>
          </button>
          <button type="button" className="btn" onClick={() => setDialog('versions')}>
            <History size={16} aria-hidden="true" /> <span className="btn-label">Versions</span>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!owner || publishing}
            aria-busy={publishing}
            aria-describedby={owner ? undefined : 'publish-hint'}
            title={owner ? undefined : publishHint}
            onClick={() => void doPublish()}
          >
            {publishing ? MESSAGES.publishing : 'Publish'}
          </button>
          {!owner && (
            <span id="publish-hint" className="sr-only">
              {publishHint}
            </span>
          )}
          {publishError && (
            <div role="alert" className="notice header-notice">
              {publishError}
            </div>
          )}
        </>
      )}
      {phone && publishError && (
        <div role="alert" className="notice header-notice">
          {publishError}
        </div>
      )}
      {dialog === 'members' && <MembersDialog onClose={() => setDialog(null)} />}
      {dialog === 'versions' && <VersionsDialog onClose={() => setDialog(null)} />}
    </>
  );
}
