import { NOT_FOUND_PAGE } from '../../shared/copy.ts';
import { NotAvailable } from '../ui/index.ts';

export function NotFoundPage() {
  return <NotAvailable sentences={[NOT_FOUND_PAGE]} />;
}
