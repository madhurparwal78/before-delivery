import { Link } from 'react-router-dom';
import { LinkButton } from './Button';

interface EmptyStateProps {
  /** One big sentence at heading size. */
  sentence: string;
  /** Render the sentence as a heading (`This profile isn't available`) instead of a paragraph. */
  heading?: 'h1' | 'h2';
  /** One underlined action: a link (`to`) or a button (`onClick`). */
  action?: { label: string; to?: string; onClick?: () => void };
}

/** Empty, unavailable and failure states: one big sentence plus one underlined action. */
export function EmptyState({ sentence, heading, action }: EmptyStateProps) {
  const Sentence = heading ?? 'p';
  return (
    <div className="empty">
      <Sentence className="empty-sentence">{sentence}</Sentence>
      {action?.to ? (
        <Link to={action.to} className="empty-action">
          {action.label}
        </Link>
      ) : action ? (
        <LinkButton className="empty-action" onClick={action.onClick}>
          {action.label}
        </LinkButton>
      ) : null}
    </div>
  );
}
