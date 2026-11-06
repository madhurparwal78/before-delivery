import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useApp } from './lib/app';
import { Shell } from './components/Shell';
import { DocumentList } from './screens/DocumentList';
import { DocumentScreen } from './screens/DocumentScreen';
import { TrashScreen } from './screens/TrashScreen';
import { RecordsScreen } from './screens/RecordsScreen';
import { TableScreen } from './screens/TableScreen';
import { JournalScreen } from './screens/JournalScreen';
import { TemplatesScreen } from './screens/TemplatesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SharedScreen } from './screens/SharedScreen';
import { NotFound } from './screens/NotFound';
import './styles.css';

function App() {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);
  const tick = useApp((s) => s.tick);
  const location = useLocation();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const t = setInterval(() => void tick(), 5000);
    return () => clearInterval(t);
  }, [tick]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // offline readiness is best effort
      });
    }
  }, []);

  if (!ready && !location.pathname.startsWith('/s/')) {
    return null;
  }

  return (
    <Routes>
      <Route path="/" element={<WithShell><DocumentList /></WithShell>} />
      <Route path="/trash" element={<WithShell><TrashScreen /></WithShell>} />
      <Route path="/doc/:documentId" element={<WithShell><DocumentScreen /></WithShell>} />
      <Route path="/records" element={<WithShell><RecordsScreen /></WithShell>} />
      <Route path="/records/:tableId" element={<WithShell><TableScreen /></WithShell>} />
      <Route path="/journal" element={<WithShell><JournalScreen /></WithShell>} />
      <Route path="/journal/:date" element={<WithShell><JournalScreen /></WithShell>} />
      <Route path="/templates" element={<WithShell><TemplatesScreen /></WithShell>} />
      <Route path="/settings" element={<WithShell><SettingsScreen /></WithShell>} />
      <Route path="/s/:token" element={<SharedScreen />} />
      <Route path="*" element={<WithShell><NotFound /></WithShell>} />
    </Routes>
  );
}

function WithShell({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
