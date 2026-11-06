import { request } from '../../api.js';
import { noticeCopy, pendingCopy } from '../../copy.js';
import { button, el, setText } from '../../dom.js';
import { amounts, localDateTime } from '../../format.js';
import { refreshRewards, refreshVillage, state } from '../../store.js';
import { run } from '../action.js';

export function rewardsPanel(handlers: { onChanged: () => void }): {
  node: HTMLElement;
  update: () => void;
} {
  const chestState = el('p', { class: 'reward-line' });
  const streak = el('p', { class: 'reward-line' });
  const chestHolds = el('p', { class: 'reward-line' });
  const bonusState = el('p', { class: 'reward-line' });
  const starBonus = el('p', { class: 'reward-line' });

  const openChest = button('Open daily chest', { class: 'primary' });
  openChest.addEventListener('click', () => {
    void run({
      action: 'daily',
      pending: pendingCopy.daily,
      control: openChest,
      work: () =>
        request<{ credited: Record<string, number>; streak: number }>(
          'POST',
          '/api/me/rewards/daily',
          { body: {} }
        ),
      success: (result) => noticeCopy.dailySuccess(result.streak, amounts(result.credited))
    }).then(async () => {
      await refreshRewards();
      await refreshVillage();
      handlers.onChanged();
    });
  });

  const claimBonus = button('Claim league bonus', { class: 'primary' });
  claimBonus.addEventListener('click', () => {
    void run({
      action: 'weekly',
      pending: pendingCopy.weekly,
      control: claimBonus,
      work: () =>
        request<{ credited: Record<string, number>; league: string }>(
          'POST',
          '/api/me/rewards/weekly',
          { body: {} }
        ),
      success: (result) => noticeCopy.weeklySuccess(result.league, amounts(result.credited))
    }).then(async () => {
      await refreshRewards();
      await refreshVillage();
      handlers.onChanged();
    });
  });

  const node = el('aside', { role: 'complementary', 'aria-label': 'Rewards', class: 'panel' }, [
    el('h2', { text: 'Rewards' }),
    chestState,
    streak,
    chestHolds,
    openChest,
    bonusState,
    claimBonus,
    starBonus
  ]);

  const update = (): void => {
    const rewards = state.rewards;
    if (rewards === null) return;
    setText(
      chestState,
      rewards.daily.claimed && rewards.daily.nextClaimAt !== null
        ? `Next chest ${localDateTime(rewards.daily.nextClaimAt)}`
        : 'Chest ready to open'
    );
    setText(streak, `Streak day ${rewards.daily.streak} of 7`);
    setText(chestHolds, `Next chest holds ${amounts(rewards.daily.chest)}`);
    setText(
      bonusState,
      rewards.weekly.claimed && rewards.weekly.nextClaimAt !== null
        ? `Next league bonus ${localDateTime(rewards.weekly.nextClaimAt)}`
        : 'League bonus ready to claim'
    );
    setText(
      starBonus,
      `Star bonuses today ${rewards.starBonus.used}/${rewards.starBonus.cap}`
    );
  };

  update();
  return { node, update };
}
