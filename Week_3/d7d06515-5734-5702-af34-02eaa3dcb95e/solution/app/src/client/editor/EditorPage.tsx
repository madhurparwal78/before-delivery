// The editor: header, Ribbon, banners, panels and canvas, layout bar, status bar and command line (brief: Screens and layout).
import { useRef } from 'react';
import { CommandReferenceDialog } from '../ui/CommandReference.tsx';
import { useMediaQuery } from '../ui/useMediaQuery.ts';
import type { LinkEndState } from '../pages/LinkEnded.tsx';
import { Canvas } from './canvas/Canvas.tsx';
import { ExportDialog } from './dialogs/ExportDialog.tsx';
import { SaveAsDialog } from './dialogs/SaveAsDialog.tsx';
import { ShareDialog } from './dialogs/ShareDialog.tsx';
import { Banners } from './shell/Banners.tsx';
import { ConflictDialog } from './shell/ConflictDialog.tsx';
import { CommandLine } from './shell/CommandLine.tsx';
import { Header } from './shell/Header.tsx';
import { useEditorKeys } from './shell/keys.ts';
import { LayoutBar } from './shell/LayoutBar.tsx';
import { PanelHost } from './shell/PanelHost.tsx';
import { Ribbon } from './shell/Ribbon.tsx';
import { PhoneBar, Sheets } from './shell/Sheets.tsx';
import { StatusBar } from './shell/StatusBar.tsx';
import { DESKTOP_QUERY, EditorProvider, PHONE_QUERY, useEditorState, useEditorStore } from './store.ts';
import './styles/editor.css';

interface EditorPageProps {
  /** Owner route /d/<id>. */
  drawingId?: string;
  /** Share-link route /s/<token>. */
  linkToken?: string;
  /** The editor calls this when the live `link` event says the link expired or was revoked. */
  onLinkEnded?: (state: LinkEndState) => void;
}

function Dialogs() {
  const store = useEditorStore();
  const { dialog } = useEditorState();
  const close = (): void => store.setState({ dialog: null });
  switch (dialog) {
    case 'reference': return <CommandReferenceDialog onClose={close} />;
    case 'export': return <ExportDialog onClose={close} />;
    case 'share': return <ShareDialog onClose={close} />;
    case 'saveas': return <SaveAsDialog onClose={close} />;
    case null: return null;
  }
}

function Shell() {
  const store = useEditorStore();
  const root = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery(PHONE_QUERY);
  const docked = useMediaQuery(DESKTOP_QUERY);
  useEditorKeys(root, store, !docked && !phone);
  return (
    <main ref={root} className={phone ? 'editor editor-phone' : 'editor'}>
      <Header phone={phone} />
      {phone ? <PhoneBar /> : <Ribbon />}
      <Banners />
      <div className="editor-main">
        {!phone && <PanelHost />}
        <Canvas />
      </div>
      <LayoutBar />
      <StatusBar phone={phone} />
      <CommandLine />
      <Sheets />
      <Dialogs />
      <ConflictDialog />
    </main>
  );
}

export function EditorPage({ drawingId, linkToken, onLinkEnded }: EditorPageProps) {
  return (
    <EditorProvider drawingId={drawingId} linkToken={linkToken} onLinkEnded={onLinkEnded}>
      <Shell />
    </EditorProvider>
  );
}
