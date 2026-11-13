import type { JSX } from 'preact';
import { copy } from '../../shared/copy.js';
import { Band, PageHeading } from '../components/ui.js';
import { Link } from '../lib/router.js';

export const NotFound = (): JSX.Element => (
  <Band>
    <PageHeading>{copy.notFound}</PageHeading>
    <p><Link href="/">Back to the start</Link></p>
  </Band>
);

export const SignInRequired = ({ path }: { path: string }): JSX.Element => (
  <Band>
    <PageHeading>{copy.signInRequired}</PageHeading>
    <p><Link href={`/signin?next=${encodeURIComponent(path)}`}>Sign in</Link></p>
  </Band>
);
