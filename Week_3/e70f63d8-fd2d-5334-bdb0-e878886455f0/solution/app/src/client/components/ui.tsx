import type { ComponentChildren, JSX } from 'preact';
import { useId } from 'preact/hooks';
import { feedbackStore } from '../lib/announce.js';
import { Link } from '../lib/router.js';

interface FieldProps {
  label: string;
  error?: string | undefined;
  children: (props: { id: string; 'aria-describedby': string | undefined; 'aria-invalid': boolean }) => JSX.Element;
}

/** A labelled control with its error under it, in words, linked by aria-describedby. */
export const Field = ({ label, error, children }: FieldProps): JSX.Element => {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {children({ id, 'aria-describedby': error ? errorId : undefined, 'aria-invalid': Boolean(error) })}
      {error ? <p class="band band-field" id={errorId}>{error}</p> : null}
    </div>
  );
};

/** A violet band with white text: errors, outages, results and not-found. */
export const Band = ({ id, children, role }: { id?: string; children: ComponentChildren; role?: 'status' }): JSX.Element => (
  <div class="band" id={id} role={role}>{children}</div>
);

/** One display-face line and one text link: an empty list. */
export const Empty = ({ line, href, link }: { line: string; href: string; link: string }): JSX.Element => (
  <div class="empty">
    <p class="display-line">{line}</p>
    <Link href={href}>{link}</Link>
  </div>
);

/** The still list-shaped placeholder shown while a page's data is on its way. */
export const Loading = (): JSX.Element => <div class="loading" role="status">Loading</div>;

/** What `#announcer` and `#alert` say, drawn for the sighted. The two live regions themselves stay visually hidden. */
export const FeedbackStrip = (): JSX.Element => {
  const feedback = feedbackStore.use();
  return (
    <div class={`feedback ${feedback?.kind === 'alert' ? 'band' : ''}`} id="feedback" aria-hidden="true">
      {feedback?.text ?? ''}
    </div>
  );
};

export const PageHeading = ({ children }: { children: ComponentChildren }): JSX.Element => <h1 class="page-heading" tabIndex={-1}>{children}</h1>;
