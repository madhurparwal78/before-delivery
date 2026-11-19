import { useRef, useState } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { useDraft } from '../lib/drafts.ts';
import { useMove } from '../lib/moves.tsx';
import { api } from '../lib/api.ts';
import { Review, ReviewLine } from '../shell/Review.tsx';
import { WorkspaceFrame } from './Workspace.tsx';
import { F, Ftpl } from '../../shared/feedback.ts';

/**
 * Intake: two staged face photographs are dropped into their slots, a
 * reference is typed, and the specimen is created only by confirming the
 * review. A refused file is reported in its own slot and never sent.
 */

const UPLOAD_MAX_BYTES = 5_000_000;
const MIN_EDGE = 1000;
const MAX_EDGE = 8000;
const MAX_PIXELS = 40_000_000;

interface Staged {
  file: File;
  url: string;
  width: number;
  height: number;
}

type Slot = 'obverse' | 'reverse';

/** The browser applies the same checks as the server when a file is dropped. */
async function judge(file: File): Promise<{ staged?: Staged; refusal?: string }> {
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const head = new TextDecoder().decode(bytes.slice(0, 512));
  if (/^\s*(?:<\?xml|<!DOCTYPE\s+svg|<svg[\s>])/i.test(head)) return { refusal: F.PHOTO_SVG };

  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isWebp =
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!isPng && !isJpeg && !isWebp) return { refusal: F.PHOTO_TYPE };
  if (file.size > UPLOAD_MAX_BYTES) return { refusal: Ftpl.photoBytes(UPLOAD_MAX_BYTES) };

  const url = URL.createObjectURL(file);
  const measured = await new Promise<{ width: number; height: number } | null>((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
    probe.onerror = () => resolve(null);
    probe.src = url;
  });
  if (!measured) {
    URL.revokeObjectURL(url);
    return { refusal: F.PHOTO_TYPE };
  }
  const longEdge = Math.max(measured.width, measured.height);
  if (longEdge < MIN_EDGE || longEdge > MAX_EDGE) {
    URL.revokeObjectURL(url);
    return { refusal: Ftpl.photoEdge(MIN_EDGE, MAX_EDGE) };
  }
  if (measured.width * measured.height > MAX_PIXELS) {
    URL.revokeObjectURL(url);
    return { refusal: Ftpl.photoPixels(MAX_PIXELS) };
  }
  return { staged: { file, url, ...measured } };
}

export function Intake(): JSX.Element {
  const desk = useDesk();
  const [reference, setReference] = useDraft(desk.ns, 'intake', 'reference', '');
  // Staged photo files survive only within the open tab.
  const [staged, setStaged] = useState<Record<Slot, Staged | null>>({
    obverse: null,
    reverse: null,
  });
  const [slotErrors, setSlotErrors] = useState<Record<string, string>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const created = useRef<HTMLHeadingElement>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const take = async (slot: Slot, file: File | undefined): Promise<void> => {
    if (!file) return;
    const judged = await judge(file);
    if (judged.refusal) {
      // The reason is shown in that slot, and nothing is stored.
      setSlotErrors((was) => ({ ...was, [slot]: judged.refusal as string }));
      return;
    }
    setSlotErrors((was) => {
      const next = { ...was };
      delete next[slot];
      return next;
    });
    setStaged((was) => ({ ...was, [slot]: judged.staged ?? null }));
  };

  // Swapping two staged faces exchanges them; no image is silently dropped.
  const move = useMove((source, destination) => {
    const from = source as Slot;
    const to = destination as Slot;
    if (from === to) return;
    setStaged((was) => ({ ...was, [from]: was[to], [to]: was[from] }));
  });

  const fieldErrors = { ...slotErrors, ...desk.feedback.fields };

  const create = async (): Promise<void> => {
    const form = new FormData();
    form.set('command_id', `intake-${reference}-${Date.now()}`);
    form.set('reference', reference);
    if (staged.obverse) form.set('obverse', staged.obverse.file, 'obverse.png');
    if (staged.reverse) form.set('reverse', staged.reverse.file, 'reverse.png');
    await api.upload(`/api/desks/${desk.ns}/specimens`, form);
  };

  const confirm = async (): Promise<void> => {
    setReviewOpen(false);
    const ok = await desk.run({
      label: 'Create specimen',
      success: F.INTAKE_OK,
      send: create,
    });
    if (ok) {
      setCreatedKey(reference);
      setStaged({ obverse: null, reverse: null });
      setReference('');
      // After intake, focus moves to the created specimen's heading.
      window.setTimeout(() => created.current?.focus(), 0);
    } else {
      reviewButton.current?.focus();
    }
  };

  const slot = (which: Slot): JSX.Element => (
    <div className="slot-group">
      <button
        type="button"
        className="target source-button"
        aria-label={which === 'obverse' ? 'Obverse photo' : 'Reverse photo'}
        {...move.source(which)}
        onClick={() => {
          const chooser = document.createElement('input');
          chooser.type = 'file';
          chooser.accept = 'image/jpeg,image/png,image/webp';
          chooser.onchange = () => void take(which, chooser.files?.[0]);
          chooser.click();
        }}
      >
        {which === 'obverse' ? 'Obverse photo' : 'Reverse photo'}
      </button>
      <button
        type="button"
        className="target slot"
        aria-label={which === 'obverse' ? 'Obverse slot' : 'Reverse slot'}
        {...move.destination(which)}
        onDrop={(event) => {
          event.preventDefault();
          const dropped = event.dataTransfer.files?.[0];
          if (dropped) {
            void take(which, dropped);
            return;
          }
          move.destination(which).onDrop(event);
        }}
      >
        {staged[which] ? (
          <img className="slot-image" src={staged[which]?.url} alt={`Staged ${which}`} />
        ) : (
          <span className="slot-empty">Drop the {which} here</span>
        )}
      </button>
      {fieldErrors[which] ? <p className="field-error">{fieldErrors[which]}</p> : null}
    </div>
  );

  const bothStaged = staged.obverse !== null && staged.reverse !== null;

  return (
    <>
      {createdKey ? (
        <h2 className="workspace-heading" tabIndex={-1} ref={created}>
          Specimen {createdKey}
        </h2>
      ) : null}
      <WorkspaceFrame
        id="intake"
        listKind="stock"
        left={<div className="face-column">{slot('obverse')}</div>}
        right={<div className="face-column">{slot('reverse')}</div>}
        below={
          <div className="stack">
            <label className="field">
              <span className="field-label">Specimen reference:</span>
              <input
                className="target"
                type="text"
                aria-label="Specimen reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </label>
            {fieldErrors['reference'] ? (
              <p className="field-error">{fieldErrors['reference']}</p>
            ) : null}
            <button
              type="button"
              className="target primary"
              ref={reviewButton}
              onClick={() => setReviewOpen(true)}
            >
              Review intake
            </button>
          </div>
        }
      />
      <Review
        open={reviewOpen}
        title="Create specimen"
        opener={reviewButton}
        confirmDisabled={desk.busy || !bothStaged || reference === ''}
        onCancel={() => setReviewOpen(false)}
        onConfirm={() => void confirm()}
      >
        <ReviewLine label="Reference" value={reference || '(none typed)'} />
        <ReviewLine label="Obverse" value={staged.obverse ? 'Staged' : 'Missing'} />
        <ReviewLine label="Reverse" value={staged.reverse ? 'Staged' : 'Missing'} />
        {!bothStaged ? <p className="field-error">{F.PHOTO_MISSING}</p> : null}
      </Review>
    </>
  );
}
