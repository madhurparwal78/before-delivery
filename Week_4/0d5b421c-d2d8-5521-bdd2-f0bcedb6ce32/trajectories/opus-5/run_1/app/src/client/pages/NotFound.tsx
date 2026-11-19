import { OutageBanners, PinnedTitle } from '../components/Shell';
import { COPY } from '../lib/format';

export function NotFound(): JSX.Element {
  return (
    <div className="page">
      <OutageBanners />
      <PinnedTitle>{COPY.notFound}</PinnedTitle>
    </div>
  );
}
