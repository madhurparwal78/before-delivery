import { el, t } from './ui.js';
import { api, getJson, type Character, type Weapon, type Model, type Story, type Progress } from './api-client.js';
import { store, notify, loadMe } from './store.js';
import { languagePickerHtml } from './language.js';
import { signOut } from './pages-auth.js';
import { createHeroPreview, reducedMotion, type HeroData, type SceneHandle } from './scene.js';

/**
 * The hangar, builder, forge and armoury screens.
 */

export function navTabs(active: string): HTMLElement {
  const nav = el('nav', { class: 'app-nav', 'aria-label': t('controls', 'main') });
  const items: [string, string][] = [
    ['/hangar', 'hangar'], ['/builder', 'builder'], ['/forge', 'forge'],
    ['/armoury', 'armoury'], ['/models', 'models'], ['/stories', 'stories'], ['/lobby', 'lobby'],
  ];
  for (const [href, key] of items) {
    const link = el('a', { href, text: t('nav', key), class: `nav-tab${href === active ? ' active' : ''}` });
    link.setAttribute('aria-current', href === active ? 'page' : 'false');
    nav.append(link);
  }
  return nav;
}

export function signOutButton(): HTMLElement {
  const button = el('button', { class: 'ghost', text: t('copy', 'signout') });
  button.addEventListener('click', () => void signOut());
  return button;
}

export function heroDataOf(character: Character | null): HeroData {
  if (!character) {
    return { name: '', parts: { head: 'round', torso: 'stick', arms: 'thin', legs: 'thin' }, proportions: { head_size: 1, neck_length: 1, spine_length: 1, upper_arm_length: 1, forearm_length: 1, thigh_length: 1, shin_length: 1 }, pose: { right_arm_raise: 0 }, material: 'graphite', accessories: { head: 'none', back: 'none', left_hand: 'none' } };
  }
  return {
    name: character.name,
    parts: character.parts,
    proportions: character.proportions,
    pose: character.pose,
    material: character.material,
    accessories: character.accessories,
  };
}

export async function weaponById(id: string | null): Promise<Weapon | null> {
  if (!id) return null;
  const res = await getJson<{ weapon: Weapon }>(`/api/weapons/${id}`);
  return res?.weapon ?? null;
}

export async function mountHangar(): Promise<void> {
  await loadMe();
  const root = document.getElementById('root');
  if (!root) return;
  root.replaceChildren();
  const layout = el('div', { class: 'screen-layout' });
  layout.append(navTabs('/hangar'));
  const scene = el('div', { class: 'scene-hold' });
  const inspector = el('aside', { class: 'inspector-card', role: 'region', 'aria-label': t('controls', 'equipped-hero') });
  const equipped = store.equippedCharacter;
  if (!equipped) {
    const heading = el('h1', { class: 'no-hero-heading', tabindex: '-1', text: t('copy', 'hangar-no-hero') });
    const link = el('a', { href: '/builder', class: 'primary-link', text: t('copy', 'open-builder') });
    inspector.append(heading, link);
    root.append(layout, scene, inspector);
    return;
  }
  const hero = heroDataOf(equipped);
  const weapon = await weaponById(equipped.weapon_id);
  const handle = createHeroPreview(hero, weapon ? { strokes: weapon.strokes, stats: weapon.stats } : null, { turntable: true, reduced: reducedMotion() });
  scene.append(handle.element);
  const heading = el('h1', { class: 'screen-heading', text: equipped.name });
  const weaponBlock = el('div', { class: 'hero-weapon' });
  if (weapon) {
    weaponBlock.append(
      el('h2', { text: t('copy', 'weapon-name', { n: weapon.number }) }),
      el('p', { text: `${t('copy', 'reach')}: ${t('copy', 'stats-reach', { reach: weapon.stats.reach_m.toFixed(2) })}` }),
      el('p', { text: `${t('copy', 'weight')}: ${t('copy', 'stats-weight', { weight: weapon.stats.weight_kg.toFixed(2) })}` }),
      el('p', { text: `${t('copy', 'swing-speed')}: ${t('copy', 'stats-swing', { swing: weapon.stats.swing_per_s.toFixed(2) })}` }),
    );
  }
  inspector.append(heading, weaponBlock);
  if (store.account && !store.account.email_verified) {
    if (store.account.verification_email === 'not_sent') {
      const banner = el('div', { class: 'alert-banner', role: 'alert', text: t('copy', 'verification-not-sent') });
      inspector.append(banner);
    } else {
      const notice = el('p', { class: 'verify-notice', text: t('copy', 'resend-hint') });
      inspector.append(notice);
    }
    const resend = el('button', { class: 'ghost', text: t('controls', 'resend-email') });
    resend.addEventListener('click', async () => {
      resend.disabled = true;
      resend.textContent = t('copy', 'working');
      const result = await api('POST', '/api/auth/verification/resend');
      resend.disabled = false;
      resend.textContent = t('controls', 'resend-email');
      if (result.status === 202) {
        notify(t('copy', 'verification-sent', { email: store.account?.email ?? '' }));
      }
    });
    inspector.append(resend);
  }
  inspector.append(languagePickerHtml(), signOutButton());
  root.append(layout, scene, inspector);
  handle.render();
}
