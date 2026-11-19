/** The directory and a member's page: challenge or block from a row. */

import { api, toast } from './app.js';

document.addEventListener('click', async (event) => {
  const challenge = event.target.closest('[data-challenge-member]');
  if (challenge) {
    try {
      await api('POST', '/api/challenges', {
        opponent: challenge.dataset.challengeMember,
        colour: 'Random',
        rated: true,
      });
      toast(`Challenge sent to ${challenge.dataset.challengeMember}. See it on the challenges page.`);
    } catch (error) {
      toast(error.message, 'error');
    }
    return;
  }
  const block = event.target.closest('[data-block-member]');
  if (block) {
    const username = block.dataset.blockMember;
    try {
      await api('POST', '/api/blocks', { username });
      toast(`${username} is blocked. They cannot challenge or chat you.`);
    } catch (error) {
      toast(error.message, 'error');
    }
  }
});
