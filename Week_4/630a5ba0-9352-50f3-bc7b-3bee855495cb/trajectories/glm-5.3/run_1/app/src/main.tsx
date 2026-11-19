import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SessionProvider } from './api/session';
import { AnnouncerProvider } from './api/session';

import './styles.css';

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
    <AnnouncerProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </AnnouncerProvider>
);
