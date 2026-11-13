// The editor header: breadcrumb, file actions, undo and redo, and the sync, collaborator, trial, access and link statuses.
import { BookOpen, Ellipsis, Printer, Redo2, Save, Share2, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { copy } from '../../../shared/copy.ts';
import { Menu } from '../../ui/Menu.tsx';
import { useEditor, useEditorStore } from '../store.ts';

const ACCESS_LABELS = { owner: 'Can edit', edit: 'Can edit', markup: 'Mark-up only', view: 'View only' } as const;

function Breadcrumb() {
  const { drawing } = useEditor();
  const store = useEditorStore();
  const name = drawing?.name ?? '';
  return (
    <nav aria-label="Breadcrumb" className="breadcrumb">
      {store.isLinkHolder ? <span>Shared drawing</span> : <a href={drawing ? `/drawings?folder=${drawing.folder_id}` : '/drawings'}>My Drawings</a>}
      <span aria-hidden="true">/</span>
      <span className="breadcrumb-name" title={name}>{name}</span>
    </nav>
  );
}

function Statuses() {
  const editor = useEditor();
  const { trial, collaborators, linkInfo, isOwner, access } = editor;
  return (
    <div className="header-statuses">
      {editor.syncLabel && <span role="status" aria-label="Sync" aria-live="off" className="chip">{editor.syncLabel}</span>}
      <ul aria-label="Collaborators" className="collaborators">
        {collaborators.map((person) => <li key={person.name} className="chip">{person.name} · {person.state}</li>)}
      </ul>
      {isOwner && trial && <span role="status" aria-label="Trial" className="chip">{copy.trialLabel(trial.days_left)}</span>}
      <span role="status" aria-label="Access" className="chip">{ACCESS_LABELS[access]}</span>
      {linkInfo && <span role="status" aria-label="Link" className="chip">{linkInfo.expiry_label}</span>}
    </div>
  );
}

export function Header({ phone }: { phone: boolean }) {
  const editor = useEditor();
  const { isOwner, openDialog } = editor;
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  const actions = [
    { label: 'Save as', Icon: Save, run: () => openDialog('saveas') },
    { label: 'Print', Icon: Printer, run: () => openDialog('export') },
    ...(isOwner ? [{ label: 'Share', Icon: Share2, run: () => openDialog('share') }] : []),
    { label: 'Learning material', Icon: BookOpen, run: () => openDialog('reference') },
  ];
  const undoRedo = (
    <>
      <button type="button" className="header-button" aria-label="Undo" onClick={() => editor.startCommand('UNDO')}>
        <Undo2 size={18} strokeWidth={1.5} aria-hidden="true" /><span className="header-label">Undo</span>
      </button>
      <button type="button" className="header-button" aria-label="Redo" onClick={() => editor.startCommand('REDO')}>
        <Redo2 size={18} strokeWidth={1.5} aria-hidden="true" /><span className="header-label">Redo</span>
      </button>
    </>
  );

  return (
    <header className="editor-header">
      <Breadcrumb />
      <div className="header-actions">
        {phone ? (
          <>
            <button ref={anchor} type="button" className="header-button" aria-haspopup="menu" aria-expanded={menu} aria-label="File actions" onClick={() => setMenu(!menu)}>
              <Ellipsis size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
            {menu && anchor.current && (
              <Menu
                label="File actions"
                anchor={anchor.current}
                onClose={() => setMenu(false)}
                items={actions.map(({ label, run }) => ({ label, onSelect: () => { anchor.current?.focus(); run(); } }))}
              />
            )}
          </>
        ) : (
          actions.map(({ label, Icon, run }) => (
            <button key={label} type="button" className="header-button" aria-label={label} onClick={run}>
              <Icon size={18} strokeWidth={1.5} aria-hidden="true" /><span className="header-label">{label}</span>
            </button>
          ))
        )}
        {undoRedo}
      </div>
      <Statuses />
    </header>
  );
}
