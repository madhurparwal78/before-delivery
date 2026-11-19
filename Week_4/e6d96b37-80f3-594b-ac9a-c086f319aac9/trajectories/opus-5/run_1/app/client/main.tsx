import { createRoot } from 'react-dom/client';
import { Desk } from './shell/Desk.tsx';

const host = document.getElementById('desk-root');
if (host) createRoot(host).render(<Desk />);
