import { createRoot } from 'react-dom/client';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('missing root');
createRoot(root).render(
  <main className="not-found">
    <h1>Return not found</h1>
    <p>This return doesn&#39;t exist, or you don&#39;t have access to it.</p>
  </main>,
);
