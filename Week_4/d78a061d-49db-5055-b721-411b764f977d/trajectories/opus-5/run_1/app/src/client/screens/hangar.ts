import { ApiFailure, api } from '../api.js';
import { el } from '../dom.js';
import { languagePicker } from '../main.js';
import { HeroPreview } from '../scene/preview.js';
import {
  DEFAULT_LOOK,
  lookFrom,
  statsBlock,
  weaponName,
  withPending,
  type AppContext,
  type Screen,
} from './shared.js';
import type { Character, ModelRecord, Weapon } from '../../shared/types.js';

export async function renderHangar(ctx: AppContext, host: HTMLElement): Promise<Screen> {
  const { characters } = await api.get<{ characters: Character[] }>('/api/characters');
  const hero = characters.find((entry) => entry.equipped) ?? characters[0] ?? null;

  const preview = new HeroPreview({ label: ctx.t('app.heroPreview'), turntable: true });
  preview.setHero(hero === null ? DEFAULT_LOOK : lookFrom(hero));

  const inspector = el('div', {
    class: 'paper-card inspector',
    role: 'region',
    'aria-label': ctx.t('region.equippedHero'),
  });

  host.append(
    el('div', { class: 'hangar-layout' }, [
      el('div', { class: 'scene-pane' }, [
        preview.element,
        preview.webglAvailable ? null : el('p', { class: 'notice', text: ctx.t('scene.noWebgl') }),
      ]),
      inspector,
    ]),
  );

  if (hero === null) {
    inspector.append(
      el('h1', { text: ctx.t('hangar.noHero') }),
      el('a', { href: '/builder', class: 'button primary', text: ctx.t('nav.builder') }),
      languagePicker(ctx),
    );
    return { destroy: () => preview.destroy() };
  }

  inspector.append(el('h1', { text: hero.name }));

  if (hero.weapon_id !== null) {
    try {
      const { weapon } = await api.get<{ weapon: Weapon }>(`/api/weapons/${hero.weapon_id}`);
      preview.setWeapon(weapon.strokes);
      inspector.append(
        el('h2', { text: weaponName(ctx, weapon.number) }),
        statsBlock(ctx, ctx.locale, weapon.stats),
      );
    } catch {
      inspector.append(el('p', { text: ctx.t('hangar.noWeapon') }));
    }
  } else {
    inspector.append(el('p', { text: ctx.t('hangar.noWeapon') }));
  }

  if (hero.model_id !== null) {
    try {
      const { model } = await api.get<{ model: ModelRecord }>(`/api/models/${hero.model_id}`);
      inspector.append(
        el('p', {}, [
          el('span', { text: `${ctx.t('hangar.modelLabel')}: ` }),
          el('span', { text: model.filename }),
        ]),
      );
    } catch {
      inspector.append(el('p', { text: ctx.t('hangar.noModel') }));
    }
  }

  inspector.append(languagePicker(ctx));

  const account = ctx.account;
  if (account !== null && !account.email_verified) {
    if (account.verification_email === 'not_sent') {
      ctx.setBanner(ctx.t('fb.verificationNotSent'));
    }
    const resend = el('button', { type: 'button', class: 'button' }, [
      ctx.t('btn.resendEmail'),
    ]) as HTMLButtonElement;
    resend.addEventListener('click', () => {
      void withPending(ctx, resend, async () => {
        try {
          await api.post('/api/auth/verification/resend');
          ctx.announce(ctx.t('fb.verificationSent', { email: account.email }));
          ctx.setBanner(null);
          await ctx.refreshAccount();
        } catch (failure) {
          if (failure instanceof ApiFailure && failure.code === 'mail_unavailable') {
            ctx.setBanner(failure.localisedMessage);
            return;
          }
          ctx.announce(ctx.t('fb.generic'));
        }
      });
    });
    inspector.append(el('p', { class: 'notice', text: ctx.t('hangar.unverified') }), resend);
  }

  return { destroy: () => preview.destroy() };
}
