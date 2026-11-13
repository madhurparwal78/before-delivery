// dialog "Support files": what GET /api/support-files lists (brief: Dashboard toolbar).
import { useEffect, useState } from 'react';
import type { SupportFiles } from '../../../shared/types.ts';
import { get } from '../../api.ts';
import { Dialog } from '../../ui/Dialog.tsx';
import { LoadingStrokes } from '../../ui/LoadingStrokes.tsx';

export function SupportFilesDialog({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<SupportFiles | null>(null);

  useEffect(() => {
    let active = true;
    get<SupportFiles>('/api/support-files').then((answer) => { if (active) setFiles(answer); }, () => undefined);
    return () => { active = false; };
  }, []);

  return (
    <Dialog label="Support files" onClose={onClose} className="dialog-wide">
      <h2>Support files</h2>
      {files === null ? <LoadingStrokes /> : (
        <div className="support-grid">
          <section><h3>Linetypes</h3><ul>{files.linetypes.map((name) => <li key={name}>{name}</li>)}</ul></section>
          <section><h3>Plot styles</h3><ul>{files.plot_styles.map((name) => <li key={name}>{name}</li>)}</ul></section>
          <section><h3>Blocks</h3><ul>{files.blocks.map((block) => <li key={block.name}>{block.name} <span className="muted">· base point {block.base_point}</span></li>)}</ul></section>
          <section><h3>Templates</h3><ul>{files.templates.map((name) => <li key={name}>{name}</li>)}</ul></section>
          <section><h3>Text styles</h3><ul>{files.text_styles.map((name) => <li key={name}>{name}</li>)}</ul></section>
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
