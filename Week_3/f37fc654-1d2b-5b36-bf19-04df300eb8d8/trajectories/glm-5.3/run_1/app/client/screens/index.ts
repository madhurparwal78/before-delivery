import { registerRoute } from './router.js';
import { landingScreen } from './landing.js';
import { briefScreen } from './brief.js';
import { commissionScreen } from './commission.js';
import { filesScreen, previewScreen } from './files-preview.js';
import { configureScreen } from './configurator.js';
import { dayScreen, checkoutScreen } from './checkout.js';
import {
  inviteScreen,
  shareScreen,
  commissionsScreen,
  studioScreen,
  jobsScreen,
  crewScreen,
  crewDayScreen,
  crmSettingsScreen,
  deliveriesScreen,
  maintenanceScreen,
} from './misc.js';

export async function ensureRoutes(): Promise<void> {
  registerRoute(/^\/$/, landingScreen);
  registerRoute(/^\/brief\/new$/, briefScreen);
  registerRoute(/^\/briefs\/[0-9a-f-]+$/, briefScreen);
  registerRoute(/^\/commissions$/, commissionsScreen);
  registerRoute(/^\/c\/[0-9a-f-]+$/, commissionScreen);
  registerRoute(/^\/c\/[0-9a-f-]+\/files$/, filesScreen);
  registerRoute(/^\/c\/[0-9a-f-]+\/preview$/, previewScreen);
  registerRoute(/^\/c\/[0-9a-f-]+\/configure$/, configureScreen);
  registerRoute(/^\/c\/[0-9a-f-]+\/day$/, dayScreen);
  registerRoute(/^\/c\/[0-9a-f-]+\/checkout$/, checkoutScreen);
  registerRoute(/^\/c\/[0-9a-f-]+\/share$/, shareScreen);
  registerRoute(/^\/c\/[0-9a-f-]+\/webhooks$/, deliveriesScreen);
  registerRoute(/^\/c\/[0-9a-f-]+\/maintenance$/, maintenanceScreen);
  registerRoute(/^\/i\/[A-Za-z0-9_-]+$/, inviteScreen);
  registerRoute(/^\/studio$/, studioScreen);
  registerRoute(/^\/studio\/jobs$/, jobsScreen);
  registerRoute(/^\/crew$/, crewScreen);
  registerRoute(/^\/crew\/days\/[0-9a-f-]+$/, crewDayScreen);
  registerRoute(/^\/settings\/crm$/, crmSettingsScreen);
}

await ensureRoutes();
