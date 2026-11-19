import { formatTime, pretty } from '../format';
import { Button, Chip, Modal } from '../ui';
import type { RunStep } from '../types';

export function LogDialog({ step, returnTo, onClose }: { step: RunStep; returnTo: HTMLElement | null; onClose: () => void }) {
  return (
    <Modal label={`Step log: ${step.name}`} onClose={onClose} returnTo={returnTo} className="log-dialog">
      <div className="modal-head">
        <h2>{step.name}</h2>
      </div>
      <div role="group" aria-label="Status" className="log-group">
        <p className="mono-label muted">Status</p>
        <Chip status={step.status} />
      </div>
      <div role="group" aria-label="Input" className="log-group">
        <p className="mono-label muted">Input</p>
        <pre>{pretty(step.input)}</pre>
      </div>
      <div role="group" aria-label="Output" className="log-group">
        <p className="mono-label muted">Output</p>
        <pre>{pretty(step.output)}</pre>
      </div>
      {step.log.length > 0 ? (
        <ul aria-label="Log" className="log-lines">
          {step.log.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No log lines yet.</p>
      )}
      <div role="group" aria-label="Attempts" className="log-group">
        <p>{`Attempts: ${step.attempts}`}</p>
      </div>
      <div role="group" aria-label="Timing" className="log-group">
        <p>{`Started: ${formatTime(step.started_at)}`}</p>
        <p>{`Finished: ${formatTime(step.finished_at)}`}</p>
        {step.due_at ? <p>{`Due: ${formatTime(step.due_at)}`}</p> : null}
        {step.retry_at && step.status === 'retrying' ? <p>{`Retry at: ${formatTime(step.retry_at)}`}</p> : null}
      </div>
      <div className="modal-foot">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
