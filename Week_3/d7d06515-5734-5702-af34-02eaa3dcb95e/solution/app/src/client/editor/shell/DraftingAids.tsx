// toolbar "Drafting aids": OSNAP, ORTHO, POLAR, SNAP & GRID and OTRACK.
import { AID_LABELS, useEditorState, useEditorStore, type Aids } from '../store.ts';

const ORDER: (keyof Aids)[] = ['osnap', 'ortho', 'polar', 'grid', 'otrack'];

export function DraftingAids() {
  const store = useEditorStore();
  const { aids } = useEditorState();
  return (
    <div role="toolbar" aria-label="Drafting aids" className="aids">
      {ORDER.map((name) => (
        <button key={name} type="button" className="aid-button" aria-pressed={aids[name]} onClick={() => store.toggleAid(name)}>
          {AID_LABELS[name].button}
        </button>
      ))}
    </div>
  );
}
