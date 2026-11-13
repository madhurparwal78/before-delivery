import { pageCopy } from '../../shared/copy.js';
import { LiveRegions } from '../components/LiveRegions.jsx';
import { Toolbar, Wordmark } from '../components/Toolbar.jsx';

export function NotFound(): JSX.Element {
  return (
    <div className="screen">
      <Toolbar>
        <Wordmark />
      </Toolbar>
      <div className="screen-body">
        <div className="panel">
          <div className="panel-body">
            <h1>{pageCopy.notFound}</h1>
            <p>
              <a href="/">Rampwright home</a>
            </p>
          </div>
        </div>
      </div>
      <LiveRegions />
    </div>
  );
}
