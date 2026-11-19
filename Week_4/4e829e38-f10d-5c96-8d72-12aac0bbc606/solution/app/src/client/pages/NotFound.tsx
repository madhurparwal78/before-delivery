import { useState } from "preact/hooks";
import { useMount } from "../hooks";
import { Pill } from "../ui";
import { navigate } from "../router";

/** A large sentence with a pill action on the lighter grey. */
export function EmptyState({ title, action, onAction, level = 2, motif = true }: {
  title: string; action?: string; onAction?: () => void; level?: 1 | 2; motif?: boolean;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <section class="empty-state">
      {motif && (
        <svg width="96" height="60" viewBox="0 0 44 28" aria-hidden="true" focusable="false" class="empty-motif">
          <path d="M14 14h16" stroke="#0D0D0D" stroke-width="2.5" stroke-linecap="round" />
          <circle cx="14" cy="14" r="10" fill="#FFC7F2" stroke="#0D0D0D" stroke-width="2" />
          <circle cx="30" cy="14" r="10" fill="#0D0D0D" />
        </svg>
      )}
      <Heading class="empty-title" tabIndex={-1}>{title}</Heading>
      {action && <Pill onClick={onAction}>{action}</Pill>}
    </section>
  );
}

export function NotFoundPage({ title }: { title: string }) {
  return (
    <div class="page narrow">
      <EmptyState level={1} title={title} action="Back to My work" onAction={() => navigate("/")} />
    </div>
  );
}

/** The sentence `Loading` on the lighter grey, with a pill `Reload` after five seconds. */
export function LoadingBlock({ reload }: { reload: () => void }) {
  const [slow, setSlow] = useState(false);
  useMount(() => {
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(timer);
  }, []);
  return <div class="loading-block"><p class="empty-title">Loading</p>{slow && <Pill onClick={reload}>Reload</Pill>}</div>;
}
