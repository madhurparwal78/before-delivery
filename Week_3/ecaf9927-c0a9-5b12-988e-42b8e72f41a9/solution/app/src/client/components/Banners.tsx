import { useWorkbench } from '../workbench';

const OUTAGE_COPY = 'Storage is unreachable. Changes are kept, but parts are marked Not stored until a save reaches storage.';

/** The storage outage banner and the Save conflict notice, top-centre. */
export function Banners() {
  const { storage, conflict, reload } = useWorkbench();
  return (
    <div className="banners">
      {storage === 'unreachable' && (
        <div role="alert" aria-label="Storage outage" className="banner outage">
          {OUTAGE_COPY}
        </div>
      )}
      {conflict && (
        <div role="alert" aria-label="Save conflict" className="banner conflict">
          <p>{conflict}</p>
          <button type="button" onClick={() => void reload()}>
            Reload
          </button>
        </div>
      )}
    </div>
  );
}

export function ModelMessage() {
  const { message } = useWorkbench();
  return (
    <div role="status" aria-label="Model message" className={`model-message${message.text ? '' : ' empty'}`}>
      {message.text}
    </div>
  );
}
