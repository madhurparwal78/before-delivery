import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { DeskProvider } from './deskData.jsx';
import { Shell } from './root.jsx';
import { SCREENS } from './routes.jsx';
import './styles.css';

const data = window.__rostara;
const Screen = SCREENS[data.routeId];

hydrateRoot(
  document.getElementById('app'),
  <StrictMode>
    <DeskProvider value={data}>
      <Shell>
        <Screen />
      </Shell>
    </DeskProvider>
  </StrictMode>,
);
