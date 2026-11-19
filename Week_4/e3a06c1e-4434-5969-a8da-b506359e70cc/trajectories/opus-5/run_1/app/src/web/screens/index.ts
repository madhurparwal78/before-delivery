import { joinScreen, signInScreen } from './entry.js';
import { membersScreen } from './members.js';
import { planScreen } from './plan.js';
import { projectScreen } from './project.js';
import { projectsScreen } from './projects.js';
import { publicSiteScreen } from './publicsite.js';
import { sessionDetailScreen } from './sessiondetail.js';
import { usageScreen } from './usage.js';

export const entryScreens = {
  publicSite: publicSiteScreen,
  signIn: signInScreen,
  join: joinScreen,
  projects: projectsScreen,
  project: projectScreen,
  sessionDetail: sessionDetailScreen,
  usage: usageScreen,
  members: membersScreen,
  plan: planScreen,
};
