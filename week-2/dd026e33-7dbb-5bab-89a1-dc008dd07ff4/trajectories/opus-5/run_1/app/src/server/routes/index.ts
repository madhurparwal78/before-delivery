import { register } from '../http/pipeline';
import { boardRoutes } from './board';
import { careRoutes } from './care';
import { carRoutes } from './cars';
import { fileRoutes } from './files';
import { invoiceRoutes } from './invoices';
import { jobRoutes } from './jobs';
import { releaseRoutes } from './releases';
import { sessionRoutes } from './session';

export function registerRoutes(): void {
  register(sessionRoutes);
  register(carRoutes);
  register(fileRoutes);
  register(careRoutes);
  register(jobRoutes);
  register(invoiceRoutes);
  register(releaseRoutes);
  register(boardRoutes);
}
