import { registerAssetRoutes } from '../assets';
import { registerEmbedRoutes } from '../embed';
import { registerImportRoutes } from '../imports';
import { registerMemberRoutes } from '../members';
import { startOutbox } from '../outbox';
import { registerVersionRoutes } from '../versions';

export function registerServiceRoutes(): void {
  registerAssetRoutes();
  registerVersionRoutes();
  registerEmbedRoutes();
  registerImportRoutes();
  registerMemberRoutes();
}

export function startServiceJobs(): void {
  startOutbox();
}
