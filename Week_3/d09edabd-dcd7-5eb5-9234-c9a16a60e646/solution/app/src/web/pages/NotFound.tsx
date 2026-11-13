import '../styles/pages.css';
import { LogoMark } from './Brand';
import { InternalLink } from './InternalLink';

export default function NotFound() {
  return (
    <main className="plain-page">
      <div className="sheet-card centred">
        <LogoMark size={36} />
        <p>This link isn't valid.</p>
        <InternalLink href="/" className="text-link">
          Back to Keyway bench
        </InternalLink>
      </div>
    </main>
  );
}
