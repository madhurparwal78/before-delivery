import { useEffect, useRef, useState } from 'react';
import { Trash2, X } from '../ui/icons';
import { lengthIn, parseMetres } from '../../shared/units';
import type { Prop } from '../../shared/types';
import { Dialog } from '../ui/Dialog';
import { METRES_ONLY } from './copy';
import { placeProp } from './placements';
import { deleteProp, loadProps, uploadProp } from './props';
import { closeDialog, say, useEditor } from './state';

/** A little box drawn to the prop's own proportions (the card picture). */
function PropPicture({ prop }: { prop: Pick<Prop, 'widthMm' | 'depthMm' | 'heightMm'> }) {
  const longest = Math.max(prop.widthMm, prop.depthMm, prop.heightMm);
  const w = (prop.widthMm / longest) * 34;
  const d = (prop.depthMm / longest) * 20;
  const h = (prop.heightMm / longest) * 34;
  const x = 32 - w / 2;
  const y = 46 - h;
  return (
    <svg viewBox="0 0 64 56" className="prop-picture" aria-hidden="true" focusable="false">
      <path d={`M ${x} ${y} h ${w} v ${h} h ${-w} z`} fill="var(--prop-front)" />
      <path d={`M ${x} ${y} l ${d / 2} ${-d / 2} h ${w} l ${-d / 2} ${d / 2} z`} fill="var(--prop-top)" />
      <path d={`M ${x + w} ${y} l ${d / 2} ${-d / 2} v ${h} l ${-d / 2} ${d / 2} z`} fill="var(--prop-side)" />
    </svg>
  );
}

/** The Prop library sheet: the upload form, then the stored props as cards. */
export default function PropLibrary() {
  const open = useEditor((s) => s.dialogs.props === true);
  const props = useEditor((s) => s.props);
  const loaded = useEditor((s) => s.propsLoaded);
  const units = useEditor((s) => s.units);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [size, setSize] = useState({ width: '', depth: '', height: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (open) void loadProps().catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (added) cards.current.get(added)?.focus();
  }, [added, props]);

  const submit = async (): Promise<void> => {
    const [widthMm, depthMm, heightMm] = [size.width, size.depth, size.height].map(parseMetres);
    const next: Record<string, string> = {};
    if (!file) next.file = 'Choose a glTF file.';
    if (!name.trim()) next.name = 'Give the prop a name.';
    if (widthMm === null) next.width = METRES_ONLY;
    if (depthMm === null) next.depth = METRES_ONLY;
    if (heightMm === null) next.height = METRES_ONLY;
    setErrors(next);
    if (Object.keys(next).length > 0 || !file) {
      say('Upload failed. Nothing was added.');
      return;
    }
    setPending(file.name);
    const prop = await uploadProp({ file, name: name.trim(), widthMm: widthMm!, depthMm: depthMm!, heightMm: heightMm! });
    setPending(null);
    if (prop) {
      setAdded(prop.id);
      setFile(null);
      setName('');
      setSize({ width: '', depth: '', height: '' });
    }
  };

  const remove = async (prop: Prop): Promise<void> => {
    if (!(await deleteProp(prop))) say(`${prop.name} is still placed in a room.`);
  };

  return (
    <Dialog name="Prop library" open={open} onClose={() => closeDialog('props')} className="centered wide" initialFocus={(root) => root.querySelector<HTMLElement>('input[type="file"]')}>
      <div className="dialog-head">
        <h2>Prop library</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => closeDialog('props')}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="dialog-body">
        <form className="upload-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label className="field wide">
            <span>glTF file</span>
            <input type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            {errors.file ? <span className="field-error">{errors.file}</span> : null}
          </label>
          <label className="field wide">
            <span>Prop name</span>
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
            {errors.name ? <span className="field-error">{errors.name}</span> : null}
          </label>
          {(['width', 'depth', 'height'] as const).map((axis) => (
            <label key={axis} className="field">
              <span>{`${axis[0]!.toUpperCase()}${axis.slice(1)} (m)`}</span>
              <input type="text" inputMode="decimal" value={size[axis]} onChange={(event) => setSize({ ...size, [axis]: event.target.value })} />
              {errors[axis] ? <span className="field-error">{errors[axis]}</span> : null}
            </label>
          ))}
          <button type="submit" className="btn primary">
            Upload
          </button>
        </form>
        {loaded && props.length === 0 && !pending ? <p className="muted empty-copy">No props yet. Upload a glTF file to start the library.</p> : null}
        <ul aria-label="Props" className="card-grid prop-grid">
          {pending ? (
            <li className="card pending" aria-busy="true">
              <div className="thumb placeholder" aria-hidden="true" />
              <span className="strip">
                <b className="card-name">{pending}</b>
              </span>
            </li>
          ) : null}
          {props.map((prop) => (
            <li key={prop.id} className="card">
              <div className="thumb">
                <PropPicture prop={prop} />
              </div>
              <span className="strip">
                <b className="card-name">{prop.name}</b>
                <span className="card-figures tabular">{[prop.widthMm, prop.depthMm, prop.heightMm].map((mm) => lengthIn(mm, units)).join(' × ')}</span>
              </span>
              <span className="card-actions">
                <button
                  type="button"
                  className="btn"
                  aria-label={`Place ${prop.name}`}
                  ref={(element) => {
                    if (element) cards.current.set(prop.id, element);
                    else cards.current.delete(prop.id);
                  }}
                  onClick={() => {
                    closeDialog('props');
                    void placeProp(prop);
                  }}
                >
                  Place
                </button>
                <button type="button" className="icon-btn" aria-label={`Delete ${prop.name}`} onClick={() => void remove(prop)}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
