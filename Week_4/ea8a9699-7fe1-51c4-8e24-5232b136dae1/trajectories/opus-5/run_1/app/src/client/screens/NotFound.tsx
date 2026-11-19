import { TopBar } from '../components/TopBar.js';
import { notFoundCopy } from '../lib/copy.js';

export function NotFound(): JSX.Element {
  return (
    <>
      <TopBar />
      <div className="page">
        <h1>{notFoundCopy}</h1>
      </div>
    </>
  );
}
