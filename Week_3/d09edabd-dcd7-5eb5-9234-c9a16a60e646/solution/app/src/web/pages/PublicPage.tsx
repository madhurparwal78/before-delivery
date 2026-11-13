import '../styles/pages.css';
import { useEffect } from 'react';
import { get } from '../api';
import { navigate } from '../nav';
import { ChainCard } from '../public/ChainCard';
import { SignUpSheet } from '../public/SignUpSheet';
import { TourPanels } from '../public/TourPanels';
import { TourStage } from '../public/TourStage';
import { useLitCount } from '../public/useLitCount';
import { Brand } from './Brand';
import { InternalLink } from './InternalLink';

/** Signed-in visitors belong in the editor; for everyone else the lookup simply fails and the page stays. */
function useSignedInRedirect(): void {
  useEffect(() => {
    let waiting = true;
    get('/api/me').then(
      () => waiting && navigate('/app', true),
      () => undefined,
    );
    return () => {
      waiting = false;
    };
  }, []);
}

export default function PublicPage() {
  useSignedInRedirect();
  const lit = useLitCount();
  return (
    <>
      <TourStage lit={lit} />
      <header className="tour-header">
        <Brand />
        <InternalLink href="/signin" className="text-link">
          Sign in
        </InternalLink>
      </header>
      <main className="tour-scroll">
        <TourPanels />
        <SignUpSheet />
      </main>
      <ChainCard lit={lit} />
    </>
  );
}
