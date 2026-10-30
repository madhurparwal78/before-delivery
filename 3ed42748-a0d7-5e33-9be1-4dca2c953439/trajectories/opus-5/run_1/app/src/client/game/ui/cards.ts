import { el } from '../../shared/dom.js';
import { StampCard } from './shell.js';
import type { BalanceReadout } from './balance.js';

export interface MissionRow {
  mission_id: string;
  title: string;
  resident_id: string;
  reward_stamps: number;
  version: number;
  dialogue: { offer: string[] };
}

export interface RushRow {
  rush_id: string;
  mission_id: string;
  slot: number;
  slots: number;
  title: string;
  resident_id: string;
  reward_stamps: number;
  version: number;
  status: 'posted' | 'taken' | 'yours' | 'delivered';
  hold_expires_at: string | null;
}

export interface DepotRead {
  board_date: string;
  time_zone: string;
  rush_left: number;
  missions: MissionRow[];
  rush: RushRow[];
}

export interface PostcardRow {
  postcard_id: string;
  share_url: string;
  width: number;
  height: number;
  bytes: number;
  created_at: string;
}

export interface PostboxHooks {
  onClaimSave: (opener: HTMLElement) => void;
  onSaveName: (name: string) => void;
  onSignOut: () => void;
  onCopyLink: (postcard: PostcardRow) => void;
  onMail: (postcard: PostcardRow, opener: HTMLElement) => void;
  onRevoke: (postcard: PostcardRow, opener: HTMLElement) => void;
}

export class PostboxCard {
  readonly card = new StampCard('Postbox', 'top-left');
  private readonly nameLine = el('p', { class: 'courier-name' });
  private readonly identity = el('div', { class: 'identity' });
  private readonly nameField = el('input', { type: 'text', id: 'display-name-field' });
  private readonly saveName = el('button', { type: 'button' }, ['Save name']);
  private readonly nameError = el('p', { class: 'field-error', id: 'display-name-error' });
  private readonly postcards = el('ul', { role: 'list', 'aria-label': 'Postcards', class: 'postcards' });
  private readonly signOut = el('button', { type: 'button' }, ['Sign out']);
  private readonly claimSave = el('button', { type: 'button', class: 'primary' }, [
    'Claim this save',
  ]);
  private readonly darkroomClosed = { closed: false };

  constructor(private readonly hooks: PostboxHooks) {
    this.nameField.setAttribute('aria-label', 'Display name');
    this.saveName.addEventListener('click', () => this.hooks.onSaveName(this.nameField.value));
    this.signOut.addEventListener('click', () => this.hooks.onSignOut());
    this.claimSave.addEventListener('click', () => this.hooks.onClaimSave(this.claimSave));
    this.card.body.append(
      this.nameLine,
      this.identity,
      el('div', { class: 'name-editor' }, [this.nameField, this.saveName]),
      this.nameError,
      this.postcards,
    );
  }

  showNameError(message: string | null): void {
    this.nameError.textContent = message ?? '';
    if (message === null) this.nameField.removeAttribute('aria-describedby');
    else this.nameField.setAttribute('aria-describedby', 'display-name-error');
  }

  render(me: { display_name: string; email: string | null; role: string }): void {
    this.nameLine.textContent = me.display_name;
    if (this.nameField !== document.activeElement) this.nameField.value = me.display_name;
    this.identity.replaceChildren(
      me.email === null ? this.claimSave : el('p', { class: 'courier-email' }, [me.email]),
    );
    if (me.email !== null) {
      if (!this.card.body.contains(this.signOut)) this.card.body.append(this.signOut);
    } else {
      this.signOut.remove();
    }
    this.postcards.hidden = me.email === null;
  }

  setDarkroomClosed(closed: boolean): void {
    this.darkroomClosed.closed = closed;
  }

  renderPostcards(rows: PostcardRow[]): void {
    this.postcards.replaceChildren(
      ...rows.map((row) => {
        const thumbnail = this.darkroomClosed.closed
          ? el('span', { class: 'postcard-thumb blank' }, ['Image in the darkroom'])
          : el('img', {
              class: 'postcard-thumb',
              src: `${new URL(row.share_url).pathname}/image.png`,
              alt: '',
              width: 96,
              height: 64,
            });
        const copy = el('button', { type: 'button' }, ['Copy link']);
        const mail = el('button', { type: 'button' }, ['Mail to a friend']);
        const revoke = el('button', { type: 'button' }, ['Revoke postcard']);
        copy.addEventListener('click', () => this.hooks.onCopyLink(row));
        mail.addEventListener('click', () => this.hooks.onMail(row, mail));
        revoke.addEventListener('click', () => this.hooks.onRevoke(row, revoke));
        return el('li', { class: 'postcard-row' }, [thumbnail, copy, mail, revoke]);
      }),
    );
  }
}

export interface DepotHooks {
  onRead: (mission: MissionRow, opener: HTMLElement) => void;
  onClaim: (row: RushRow, button: HTMLButtonElement) => void;
}

export class DepotCard {
  readonly card = new StampCard('Depot board', 'top-right');
  private readonly missionList = el('div', { class: 'mission-list' });
  private readonly rushHeading = el('h3', { class: 'rush-heading' });
  private readonly rushList = el('div', { class: 'rush-list' });
  private pendingClaims = new Set<string>();
  private latest: DepotRead | null = null;

  constructor(private readonly hooks: DepotHooks) {
    this.card.body.append(this.missionList, this.rushHeading, this.rushList);
  }

  get read(): DepotRead | null {
    return this.latest;
  }

  markClaiming(rushId: string, pending: boolean): void {
    if (pending) this.pendingClaims.add(rushId);
    else this.pendingClaims.delete(rushId);
    if (this.latest !== null) this.render(this.latest);
  }

  render(read: DepotRead): void {
    this.latest = read;
    this.rushHeading.textContent = `Rush board · ${read.board_date} · ${read.rush_left} left`;
    this.missionList.replaceChildren(
      ...read.missions.map((mission) => {
        const button = el('button', { type: 'button', class: 'mission-row' }, [
          el('span', { class: 'mission-title' }, [mission.title]),
          el('span', { class: 'mission-reward' }, [`+${mission.reward_stamps} stamps`]),
        ]);
        button.setAttribute('aria-label', `Read ${mission.title}`);
        button.addEventListener('click', () => this.hooks.onRead(mission, button));
        return button;
      }),
    );
    this.rushList.replaceChildren(
      ...read.rush.map((row) => {
        const text = el('span', { class: 'rush-text' }, [
          `Parcel ${row.slot} of ${row.slots} · ${row.title}`,
        ]);
        const line = el('div', { class: 'rush-row' }, [text]);
        if (row.status === 'posted') {
          const claiming = this.pendingClaims.has(row.rush_id);
          const button = el('button', { type: 'button', class: 'primary rush-claim' }, [
            claiming ? 'Claiming…' : 'Claim',
          ]);
          button.setAttribute(
            'aria-label',
            `Claim ${row.title}, parcel ${row.slot} of ${row.slots}`,
          );
          if (claiming) button.setAttribute('aria-disabled', 'true');
          button.addEventListener('click', () => {
            if (button.getAttribute('aria-disabled') === 'true') return;
            this.hooks.onClaim(row, button);
          });
          line.append(button);
        } else {
          const words = { taken: 'Taken', yours: 'Yours', delivered: 'Delivered' } as const;
          line.append(el('span', { class: 'rush-state' }, [words[row.status]]));
        }
        return line;
      }),
    );
  }
}

export interface SatchelHooks {
  onOutfitter: (opener: HTMLElement) => void;
  onHistory: (opener: HTMLElement) => void;
  onDrop: () => void;
}

export class SatchelCard {
  readonly card = new StampCard('Satchel', 'bottom-left');
  readonly outfitter = el('button', { type: 'button' }, ['Outfitter']);
  readonly history = el('button', { type: 'button' }, ['Stamp history']);
  readonly drop = el('button', { type: 'button' }, ['Drop parcel']);
  private readonly wearing = el('p', { class: 'wearing' });

  constructor(
    private readonly hooks: SatchelHooks,
    balance: BalanceReadout,
  ) {
    this.outfitter.addEventListener('click', () => this.hooks.onOutfitter(this.outfitter));
    this.history.addEventListener('click', () => this.hooks.onHistory(this.history));
    this.drop.addEventListener('click', () => this.hooks.onDrop());
    this.card.body.append(
      balance.region,
      this.wearing,
      el('div', { class: 'satchel-actions' }, [this.outfitter, this.history]),
    );
  }

  render(satchelName: string, carrying: boolean): void {
    this.wearing.textContent = `Wearing ${satchelName}`;
    if (carrying) {
      if (!this.card.body.contains(this.drop)) this.card.body.append(this.drop);
    } else {
      this.drop.remove();
    }
  }
}
