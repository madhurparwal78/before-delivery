import { Shell } from './shell.js';
import { renderAccount, restoreSession } from './views/account.js';
import { loadCampaign, renderCampaign, renderLoadout } from './views/campaign.js';
import { installShortcuts, renderDefence, renderResult } from './views/defence.js';
import { loadLevels, renderEditor } from './views/editor.js';
import { loadSeason, renderCommunity, renderLeaderboard, runSearch } from './views/community.js';
import { renderReplay } from './views/replay.js';
import { renderRules } from './views/rules.js';
import { renderTutorial } from './views/tutorial.js';
import { RequestFailed } from './api.js';

const root = document.querySelector('#app') as HTMLElement;
const shell = new Shell(root);

async function quietly(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof RequestFailed)) throw error;
  }
}

shell.registerView('Account', renderAccount);
shell.registerView('Tutorial', renderTutorial);
shell.registerView('Campaign', renderCampaign, async (current) => {
  if (current.state.account === null) return;
  await quietly(() => loadCampaign(current, true));
});
shell.registerView('Loadout', renderLoadout);
shell.registerView('Defence', renderDefence);
shell.registerView('Result', renderResult);
shell.registerView('Editor', renderEditor, async (current) => {
  if (current.state.account === null) return;
  await quietly(() => loadLevels(current, true));
});
shell.registerView('Community', renderCommunity, async (current) => {
  await quietly(() => loadSeason(current, null));
  await quietly(() => runSearch(current, true));
});
shell.registerView('Leaderboard', renderLeaderboard);
shell.registerView('Replay', renderReplay);
shell.registerView('Rules', renderRules);

installShortcuts(shell);

async function boot(): Promise<void> {
  await restoreSession(shell);
  shell.navigate(shell.state.account === null ? 'Account' : 'Campaign');
  await quietly(() => loadSeason(shell, null));
}

void boot();
