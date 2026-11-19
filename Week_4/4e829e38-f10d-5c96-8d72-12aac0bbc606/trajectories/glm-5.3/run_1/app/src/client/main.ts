import { clear } from './dom';
import { loadConfig } from './motion';
import { renderWelcome } from './welcome';
import { renderAccount } from './account';
import { renderMyWork } from './mywork';
import { renderProject } from './project';
import { renderRules } from './rules';
import { renderGoals } from './goals';
import { renderWorkload } from './workload';
import { renderInbox } from './inbox';
import { renderForm } from './form';

async function boot(): Promise<void> {
  await loadConfig();
  const root = document.getElementById('app');
  if (!root) return;
  const page = root.dataset.page ?? 'welcome';
  switch (page) {
    case 'welcome': renderWelcome(root); break;
    case 'account': renderAccount(root); break;
    case 'mywork': void renderMyWork(root); break;
    case 'project': void renderProject(root); break;
    case 'rules': void renderRules(root); break;
    case 'goals': void renderGoals(root); break;
    case 'workload': void renderWorkload(root); break;
    case 'inbox': void renderInbox(root); break;
    case 'form': void renderForm(root); break;
    default: clear(root); root.append('Page not found');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot());
} else {
  void boot();
}
