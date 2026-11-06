import { RouteErrorBoundary } from '../components/ErrorPages.jsx';
import { useRouteError, data } from 'react-router';

export async function loader() {
  throw data(null, { status: 404 });
}

export function ErrorBoundary() {
  return <RouteErrorBoundary error={useRouteError()} />;
}

export default function Splat() {
  return null;
}
