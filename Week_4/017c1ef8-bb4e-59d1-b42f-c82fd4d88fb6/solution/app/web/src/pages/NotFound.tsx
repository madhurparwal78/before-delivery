import { EmptyState } from '../ui';

export default function NotFound() {
  return <EmptyState heading="h1" sentence="We couldn't find that page." action={{ label: 'Go to Home', to: '/' }} />;
}
