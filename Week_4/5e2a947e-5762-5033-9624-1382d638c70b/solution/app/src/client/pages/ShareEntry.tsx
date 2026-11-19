import { useLayoutEffect, useState } from 'preact/hooks';
import { HttpError, api } from '../api.ts';
import { navigate } from '../router.ts';
import { Modal } from '../ui/Modal.tsx';
import { Spinner } from '../ui/Spinner.tsx';

interface LinkInfo {
  map_id: string;
  map_title: string;
  role: string;
}

/** A share link: ask for a display name, then open the map as a guest. */
export function ShareEntry(props: { code: string }) {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [problem, setProblem] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    api<LinkInfo>('GET', `/api/share/${props.code}`)
      .then(setInfo)
      .catch((failure: unknown) => {
        if (!(failure instanceof HttpError)) throw failure;
        setProblem(failure.code === 'link_expired' ? 'This link has expired.' : failure.code === 'link_revoked' ? "This link was turned off by the map's owner." : "We couldn't find that page.");
      });
  }, [props.code]);

  const join = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api<{ map_id: string }>('POST', `/api/share/${props.code}/join`, { display_name: name.trim() });
      navigate(`/m/${result.map_id}`, { replace: true });
    } catch (failure) {
      if (failure instanceof HttpError) setError(failure.fields.display_name ?? failure.message);
    } finally {
      setBusy(false);
    }
  };

  if (problem) {
    return (
      <main class="gone">
        <h1>{problem}</h1>
      </main>
    );
  }
  return (
    <main class="gone">
      <h1>{info ? info.map_title : 'Opening link'}</h1>
      {info ? (
        <Modal label="Join map" dismissible={false} onClose={() => undefined}>
          <div class="dialog-body">
            <h2 class="dialog-title">Join map</h2>
            <p>{`You are joining ${info.map_title} as a ${info.role}. Pick a name the others will see.`}</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void join();
              }}
            >
              <label class="field-col">
                <span>Your name</span>
                <input type="text" aria-label="Your name" maxLength={30} value={name} onInput={(event) => setName(event.currentTarget.value)} />
              </label>
              {error ? <p class="field-error">{error}</p> : null}
              <button type="submit" class="btn btn-primary" disabled={busy || name.trim().length === 0}>
                {busy ? <Spinner /> : null} Join
              </button>
            </form>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
