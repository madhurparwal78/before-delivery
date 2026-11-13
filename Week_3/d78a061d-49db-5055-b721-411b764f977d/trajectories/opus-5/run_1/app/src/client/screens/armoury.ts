import { ApiFailure, api } from '../api.js';
import { clear, el } from '../dom.js';
import { statsBlock, weaponName, withPending, type AppContext, type Screen } from './shared.js';
import { degreesToStoredRadians } from '../../shared/pose.js';
import { storedRadiansToDegrees } from '../../shared/pose.js';
import type { Character, Weapon } from '../../shared/types.js';

export async function renderArmoury(ctx: AppContext, host: HTMLElement): Promise<Screen> {
  const [{ weapons }, { characters }] = await Promise.all([
    api.get<{ weapons: Weapon[] }>('/api/weapons'),
    api.get<{ characters: Character[] }>('/api/characters'),
  ]);
  const hero = characters.find((entry) => entry.equipped) ?? characters[0] ?? null;

  const listed = [...weapons];
  const list = el('ul', { class: 'armoury', role: 'list', 'aria-label': ctx.t('list.armoury') });
  const emptyHost = el('div', { class: 'paper-card empty-state' });
  host.append(el('div', { class: 'page' }, [emptyHost, list]));

  const showEmpty = (focus: boolean): void => {
    clear(emptyHost);
    const heading = el('h1', { text: ctx.t('armoury.emptyHeading'), tabindex: '-1' });
    emptyHost.append(heading, el('p', { text: ctx.t('armoury.emptyText') }));
    if (focus) heading.focus();
  };

  const equipOn = async (weapon: Weapon): Promise<void> => {
    if (hero === null) return;
    await api.put(`/api/characters/slots/${hero.slot}`, {
      revision: hero.revision,
      name: hero.name,
      parts: hero.parts,
      proportions: hero.proportions,
      pose: { right_arm_raise: degreesToStoredRadians(storedRadiansToDegrees(hero.pose.right_arm_raise)) },
      material: hero.material,
      accessories: hero.accessories,
      model_id: hero.model_id,
      weapon_id: weapon.id,
    });
    hero.revision += 1;
    hero.weapon_id = weapon.id;
  };

  const renderCards = (): void => {
    clear(list);
    if (listed.length === 0) {
      showEmpty(false);
      return;
    }
    clear(emptyHost);
    for (const weapon of listed) {
      const equip = el('button', { type: 'button', class: 'button' }, [
        ctx.t('btn.equip'),
      ]) as HTMLButtonElement;
      const remove = el('button', { type: 'button', class: 'button' }, [
        ctx.t('btn.delete'),
      ]) as HTMLButtonElement;
      const card = el('li', { class: 'paper-card weapon-card' }, [
        el('h2', { text: weaponName(ctx, weapon.number) }),
        statsBlock(ctx, ctx.locale, weapon.stats),
        hero !== null && hero.weapon_id === weapon.id
          ? el('p', { class: 'badge', text: ctx.t('weapon.equipped') })
          : null,
        el('div', { class: 'card-actions' }, [equip, remove]),
      ]);

      equip.addEventListener('click', () => {
        void withPending(ctx, equip, async () => {
          try {
            await equipOn(weapon);
            renderCards();
          } catch (failure) {
            ctx.announce(
              failure instanceof ApiFailure ? failure.localisedMessage : ctx.t('fb.generic'),
            );
          }
        });
      });

      remove.addEventListener('click', () => {
        void withPending(ctx, remove, async () => {
          try {
            await api.delete(`/api/weapons/${weapon.id}`);
            const index = listed.findIndex((entry) => entry.id === weapon.id);
            listed.splice(index, 1);
            const siblings = [...list.children];
            const next = siblings[index + 1] ?? siblings[index - 1] ?? null;
            card.remove();
            if (hero !== null && hero.weapon_id === weapon.id) hero.weapon_id = null;
            ctx.announce(ctx.t('fb.weaponDeleted'));
            if (listed.length === 0) {
              showEmpty(true);
              return;
            }
            next?.querySelector<HTMLButtonElement>('button')?.focus();
          } catch (failure) {
            ctx.announce(
              failure instanceof ApiFailure ? failure.localisedMessage : ctx.t('fb.generic'),
            );
          }
        });
      });

      list.append(card);
    }
  };

  renderCards();
  return {};
}
