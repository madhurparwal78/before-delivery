import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles.css';
import { OutageContext, useStatusPolling } from './lib/hooks';
import { Home } from './pages/Home';
import { Book } from './pages/Book';
import { Waitlist } from './pages/Waitlist';
import { Offer } from './pages/Offer';
import { Manage } from './pages/Manage';
import { HostSignIn } from './pages/HostSignIn';
import { HostFloor } from './pages/HostFloor';
import { NotFound } from './pages/NotFound';

function App(): JSX.Element {
  const outage = useStatusPolling();
  return (
    <OutageContext.Provider value={outage}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/book" element={<Book />} />
        <Route path="/waitlist" element={<Waitlist />} />
        <Route path="/offer/:token" element={<Offer />} />
        <Route path="/manage/:token" element={<Manage />} />
        <Route path="/host/sign-in" element={<HostSignIn />} />
        <Route path="/host" element={<HostFloor />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </OutageContext.Provider>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');
createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
