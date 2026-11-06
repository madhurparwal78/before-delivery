import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="empty-state paper" style={{ maxWidth: 480, margin: '48px auto' }}>
      <h1>We could not find that page.</h1>
      <p><Link to="/">Back to documents</Link></p>
    </div>
  );
}
