import { useState } from 'react';
import type { FormEvent } from 'react';
import { NOT_A_POINT, UNDERLAY_ATTACHED, UPLOADING } from '../../../shared/copy.ts';
import { parsePoint } from '../../../shared/commands/points.ts';
import { onRefusal, sendBytes } from '../../api.ts';
import { Button, Dialog } from '../../ui/index.ts';
import '../../styles/drawing/forms.css';

interface UnderlayDialogProps {
  drawingId: string;
  /** a storage action's sentence for `status "Storage notice"` and the announcements */
  notify: (sentence: string) => void;
  onClose: () => void;
}

/** `dialog "Add underlay"`: an image and the two world corners it is stretched between. */
export function UnderlayDialog({ drawingId, notify, onClose }: UnderlayDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [first, setFirst] = useState('');
  const [opposite, setOpposite] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function attach(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const from = parsePoint(first.trim(), [0, 0]);
    const to = parsePoint(opposite.trim(), [0, 0]);
    if (!file || !from || !to) {
      setProblem(NOT_A_POINT);
      return;
    }
    setProblem(null);
    notify(UPLOADING);
    const query = new URLSearchParams({ x1: String(from[0]), y1: String(from[1]), x2: String(to[0]), y2: String(to[1]) });
    await onRefusal(
      async () => {
        await sendBytes(`/api/drawings/${drawingId}/underlays?${query}`, file);
        notify(UNDERLAY_ATTACHED);
        onClose();
      },
      (failure) => {
        setProblem(failure.message);
        notify(failure.message);
      },
    );
  }

  return (
    <Dialog name="Add underlay" onClose={onClose}>
      <form className="form" onSubmit={(event) => void attach(event)} noValidate>
        <div className="form-row">
          <label className="label" htmlFor="underlay-file">Image file</label>
          <input id="underlay-file" className="field" type="file" accept="image/png,image/jpeg" data-autofocus onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </div>
        <div className="form-row">
          <label className="label" htmlFor="underlay-first">First corner</label>
          <input id="underlay-first" className="field" type="text" autoComplete="off" placeholder="0,0" value={first} onChange={(event) => setFirst(event.target.value)} />
        </div>
        <div className="form-row">
          <label className="label" htmlFor="underlay-opposite">Opposite corner</label>
          <input id="underlay-opposite" className="field" type="text" autoComplete="off" placeholder="10,10" value={opposite} onChange={(event) => setOpposite(event.target.value)} />
        </div>
        {problem ? <p>{problem}</p> : null}
        <div className="actions">
          <Button primary type="submit">Attach</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
