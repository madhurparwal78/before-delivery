import { EmptyState } from '../../ui';

/** What members who may not open a page (the editor, the board) get instead. */
export function NotAvailable() {
  return <EmptyState heading="h1" sentence="This profile isn't available" action={{ label: 'Go to Home', to: '/feed' }} />;
}
