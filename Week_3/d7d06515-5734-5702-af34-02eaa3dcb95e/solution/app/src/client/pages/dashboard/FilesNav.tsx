// navigation "Files": the three actions and the three views. Rendered in the sidebar, or in the Files menu sheet on phones.
import { FolderPlus, Plus, Upload } from 'lucide-react';
import { Link } from '../../router.tsx';
import type { DashboardView } from './model.ts';

interface FilesNavProps {
  view: DashboardView;
  isRoot: boolean;
  onNewDrawing: () => void;
  onUpload: () => void;
  onNewFolder: () => void;
  /** Runs after any action or link, so the phone sheet can close. */
  onAction?: () => void;
}

export function FilesNav({ view, isRoot, onNewDrawing, onUpload, onNewFolder, onAction }: FilesNavProps) {
  const run = (action: () => void) => () => {
    onAction?.();
    action();
  };
  const current = (active: boolean): 'page' | undefined => (active ? 'page' : undefined);
  return (
    <nav aria-label="Files" className="files-nav">
      <div className="files-actions">
        <button type="button" className="btn btn-primary" onClick={run(onNewDrawing)}><Plus aria-hidden="true" size={18} />New Drawing</button>
        <button type="button" className="btn btn-outline" onClick={run(onUpload)}><Upload aria-hidden="true" size={18} />Upload...</button>
        <button type="button" className="btn btn-outline" onClick={run(onNewFolder)}><FolderPlus aria-hidden="true" size={18} />New Folder</button>
      </div>
      <ul className="files-links">
        <li><Link to="/drawings?view=recent" aria-current={current(view.kind === 'recent')} onClick={onAction}>Recent</Link></li>
        <li><Link to="/drawings?view=samples" aria-current={current(view.kind === 'samples')} onClick={onAction}>Sample Files</Link></li>
        <li><Link to="/drawings" aria-current={current(view.kind === 'folder' && isRoot)} onClick={onAction}>My Drawings</Link></li>
      </ul>
    </nav>
  );
}
