import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, blockPayload, documentPayload } from '../lib/app';
import * as db from '../lib/store';
import { TEMPLATES, type TemplateDef } from '../lib/seed';
import { uuid } from '../lib/util';
import type { Block } from '../../shared/domain';
import { Dialog } from '../components/ui';
import { Eye } from 'lucide-react';

const CATEGORIES = ['All', 'Journal', 'Planning', 'Reading'] as const;

export function TemplatesScreen() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All');
  const [preview, setPreview] = useState<TemplateDef | null>(null);
  const previewOpenerRef = useRef<HTMLButtonElement | null>(null);
  const navigate = useNavigate();
  const markChange = useApp((s) => s.markChange);
  const reload = useApp((s) => s.reload);

  const shown = useMemo(
    () => (category === 'All' ? TEMPLATES : TEMPLATES.filter((t) => t.category === category)),
    [category]
  );

  const useTemplate = async (template: TemplateDef) => {
    const id = uuid();
    const now = Date.now();
    const doc = { id, title: template.name, folder: null, tags: [] as string[], starred: false, trashed: false, createdAt: now, updatedAt: now, journal: false };
    await db.putDocument(doc);
    const blocks: Block[] = template.blocks.map((b, i) => ({
      id: `${id}-${i + 1}`,
      documentId: id,
      type: b.type,
      text: b.text,
      indent: 0,
      checked: false,
      order: i,
    }));
    await db.putBlocks(blocks);
    await markChange('document', id, id, false, documentPayload(doc));
    for (const b of blocks) {
      await markChange('block', b.id, id, false, blockPayload(b));
    }
    await reload();
    setPreview(null);
    navigate(`/doc/${id}`);
    // focus lands on the copy's title
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('[aria-label="Document title"]')?.focus();
    });
  };

  return (
    <div>
      <div className="heading-row">
        <h1>Templates</h1>
      </div>
      <div className="chip-row" role="group" aria-label="Template categories">
        {CATEGORIES.map((c) => (
          <button key={c} className="chip" role="button" aria-pressed={category === c} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="template-grid">
        {shown.map((t) => (
          <div key={t.id} className="paper template-card">
            <h2 style={{ fontSize: '1.15rem' }}>{t.name}</h2>
            <p className="meta" style={{ margin: '2px 0 4px' }}>{t.category}</p>
            <p style={{ margin: '4px 0 10px' }}>{t.description}</p>
            <button
              className="button"
              aria-label={`Preview ${t.name}`}
              onClick={(e) => {
                setPreview(t);
                previewOpenerRef.current = e.currentTarget;
              }}
            >
              <Eye size={18} aria-hidden /> Preview
            </button>
          </div>
        ))}
      </div>
      {preview && (
        <Dialog
          label={preview.name}
          onClose={() => {
            setPreview(null);
            previewOpenerRef.current?.focus();
          }}
        >
          <h2>{preview.name}</h2>
          <p className="meta">{preview.category}</p>
          <div style={{ margin: '12px 0' }}>
            {preview.blocks.map((b, i) => (
              <p key={i} style={{ margin: '4px 0', fontWeight: b.type.startsWith('heading') ? 700 : 400 }} className={b.type === 'quote' ? 'quote' : ''}>
                {b.type === 'todo' ? (b.checked ? '☑ ' : '☐ ') : ''}
                {b.type === 'bulleted' ? '• ' : b.type === 'numbered' ? `${i + 1}. ` : ''}
                {b.text}
              </p>
            ))}
          </div>
          <div className="row">
            <button
              className="button"
              onClick={() => {
                setPreview(null);
                previewOpenerRef.current?.focus();
              }}
            >
              Close
            </button>
            <button
              className="button accent-button"
              onClick={() => void useTemplate(preview)}
            >
              Use this template
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
