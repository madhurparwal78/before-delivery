import { ApiFault, Unreachable, newTicket, request, serverNow, withRetries } from '../shared/api.js';
import { checkDisplayName } from '../../shared/displayNames.js';
import { el } from '../shared/dom.js';
import { motion, onFrame, page } from '../shared/motion.js';
import { Notices } from '../shared/notices.js';
import { copy } from './copy.js';
import { Scene, type OpenRoute, type ThreadPhase, type WorldInfo } from './scene.js';
import { BalanceReadout } from './ui/balance.js';
import {
  DepotCard,
  PostboxCard,
  SatchelCard,
  type DepotRead,
  type MissionRow,
  type PostcardRow,
  type RushRow,
} from './ui/cards.js';
import {
  ConfirmDialog,
  EmailDialog,
  OutfitterDialog,
  StampHistoryDialog,
  type Movement,
  type SatchelOffer,
} from './ui/dialogs.js';
import { Letter } from './ui/letter.js';
import { ModerationDrawer, type AuditEntry, type StaffCourier } from './ui/moderation.js';
import { PhotoMode } from './ui/photo.js';
import { StampCard, TouchControls, coarsePointer } from './ui/shell.js';
import type { PresenceEntry } from './figures.js';

interface Parcel {
  acceptance_id: string;
  mission_id: string;
  version: number;
  title: string;
  reward_stamps: number;
  resident: { resident_id: string; name: string; home: string };
  rush_id: string | null;
  hold_expires_at: string | null;
  route: {
    route_id: string;
    door: { lat: number; lon: number };
    total_arc_m: number;
    initial_bearing_deg: number;
  };
  dialogue: { offer: string[] };
}

interface Me {
  role: 'guest' | 'courier' | 'helper' | 'founder';
  display_name: string;
  satchel_colour: string;
  balance: number;
  email: string | null;
  name_locked: boolean;
  muted: boolean;
  satchels_owned: string[];
  open_parcel: Parcel | null;
}

const BOARD_REFRESH_MS = 10_000;
const PRESENCE_MS = 1000;
const STATUS_MS = 5000;
const STAFF_REFRESH_MS = 5000;
const HISTORY_PAGE = 20;

const WALK_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

class Game {
  private readonly notices = new Notices();
  private readonly balance = new BalanceReadout();
  private scene!: Scene;
  private me!: Me;
  private world!: WorldInfo;
  private satchelNames = new Map<string, string>();
  private openParcel: Parcel | null = null;
  private acceptPending = false;
  private handingPending = false;
  private readonly handoverTickets = new Map<string, { ticket: string; body: unknown | null }>();
  private readonly lapsedFor = new Set<string>();
  private holdTimer: number | null = null;
  private historyCursor: string | null = null;
  private mailTicket = newTicket();
  private mailAddress = '';
  private readonly stream = newTicket();
  private sequence = 0;
  private pendingEmote: string | null = null;
  private firstPresence = true;
  private darkroomOpen = true;
  private staffTimer: number | null = null;
  private pendingMission: MissionRow | null = null;
  private postcards: PostcardRow[] = [];
  private mailTarget: PostcardRow | null = null;
  private revokeTarget: PostcardRow | null = null;

  private readonly handOver = el('button', { type: 'button', class: 'primary hand-over' }, [
    'Hand over parcel',
  ]);
  private readonly emotes = el('div', { role: 'toolbar', 'aria-label': 'Emotes', class: 'emotes' });
  private readonly emotesToggle = el('button', { type: 'button', class: 'emotes-toggle' }, [
    'Emotes',
  ]);
  private readonly photoButton = el('button', { type: 'button' }, ['Photo mode']);
  private readonly moderationButton = el('button', { type: 'button' }, ['Moderation']);

  private readonly postbox = new PostboxCard({
    onClaimSave: (opener) => this.claimSave.dialog.show(opener, this.claimSave.field),
    onSaveName: (name) => void this.saveName(name),
    onSignOut: () => void this.signOut(),
    onCopyLink: (postcard) => void this.copyLink(postcard),
    onMail: (postcard, opener) => this.openMail(postcard, opener),
    onRevoke: (postcard, opener) => this.askRevoke(postcard, opener),
  });

  private readonly depot = new DepotCard({
    onRead: (mission, opener) => this.readLetter(mission, opener),
    onClaim: (row, button) => void this.claimRush(row, button),
  });

  private readonly satchel = new SatchelCard(
    {
      onOutfitter: (opener) => void this.openOutfitter(opener),
      onHistory: (opener) => void this.openHistory(opener),
      onDrop: () => void this.dropParcel(),
    },
    this.balance,
  );

  private readonly letter = new Letter(
    () => {
      this.pendingMission = null;
    },
    () => void this.takeParcel(),
  );

  private readonly outfitter = new OutfitterDialog(
    (offer) => void this.buySatchel(offer),
    (offer) => void this.wearSatchel(offer),
  );

  private readonly history = new StampHistoryDialog(() => void this.loadHistory(true));

  private readonly claimSave = new EmailDialog({
    label: 'Claim this save',
    fieldLabel: 'Email',
    sendLabel: 'Send postbox key',
    onSend: (value) => void this.sendPostboxKey(value),
  });

  private readonly mailDialog = new EmailDialog({
    label: 'Mail a postcard',
    fieldLabel: "Friend's email",
    sendLabel: 'Send postcard',
    onSend: (value) => void this.mailPostcard(value),
    onFieldChange: () => this.freshMailTicket(),
  });

  private readonly revokeConfirm = new ConfirmDialog({
    label: 'Revoke postcard',
    confirmLabel: 'Revoke',
    cancelLabel: 'Keep it',
    onConfirm: () => void this.revokePostcard(),
  });

  private photo!: PhotoMode;

  private readonly drawer = new ModerationDrawer({
    onToggle: (courier) => void this.toggleMute(courier),
    onRename: (courier) => void this.renameCourier(courier),
    onClose: () => this.closeDrawer(),
  });

  private touch: TouchControls | null = null;

  async start(): Promise<void> {
    const host = document.getElementById('bramble-app')!;
    this.notices.say(copy.session.pending);
    this.world = (await request<WorldInfo>('GET', '/api/world')).body;
    this.me = await this.loadMe();
    this.notices.clear();

    this.scene = new Scene(this.world, {
      onPhase: (phase) => this.phaseChanged(phase),
      onArrived: () => undefined,
    });
    this.photo = new PhotoMode(this.scene, {
      onCapture: () => void this.takePostcard(),
      onLeave: () => this.leavePhoto(),
    });
    if (coarsePointer()) {
      this.touch = new TouchControls({
        onWalk: (sign) => this.scene.setWalk(sign),
        onTurn: (sign) => this.scene.setTurn(sign),
        onJump: () => this.scene.hop(),
      });
    }

    this.buildLayout(host);
    this.scene.begin();
    this.balance.settle(this.me.balance);
    this.scene.wear(this.me.satchel_colour);
    this.applyParcel(this.me.open_parcel, { animate: false });

    this.listenToKeys();
    void this.refreshBoard();
    void this.loadOutfitter();
    void this.refreshPostcards();
    void this.pollStatus();
    this.startLoops();
    motion.subscribe(() => {
      this.notices.settleForPreference();
      this.letter.settleForPreference();
    });
    page.subscribe(() => {
      if (!page.visible) return;
      void this.refreshBoard();
      void this.checkHold('shown');
    });
  }

  private async loadMe(): Promise<Me> {
    try {
      return (await request<Me>('GET', '/api/me')).body;
    } catch (fault) {
      if (fault instanceof ApiFault && fault.status === 401) {
        return (await request<Me>('POST', '/api/guest', { json: {} })).body;
      }
      if (fault instanceof Unreachable) {
        this.notices.say(copy.session.unreachable);
        await new Promise((resume) => setTimeout(resume, 3000));
        return this.loadMe();
      }
      throw fault;
    }
  }

  // --- layout ---

  private buildLayout(host: HTMLElement): void {
    const tabs = el('div', { class: 'card-tabs' });
    const cards: StampCard[] = [this.postbox.card, this.depot.card, this.satchel.card];
    for (const card of cards) {
      card.tab.addEventListener('click', () => {
        const wasOpen = card.root.classList.contains('sheet-open');
        for (const other of cards) other.setOpen(false);
        card.setOpen(!wasOpen);
      });
      tabs.append(card.tab);
    }

    for (const emote of ['Wave', 'Cheer', 'Sleepy', 'Heart']) {
      const button = el('button', { type: 'button' }, [emote]);
      button.addEventListener('click', () => void this.sendEmote(emote.toLowerCase()));
      this.emotes.append(button);
    }
    this.emotesToggle.addEventListener('click', () => this.emotes.classList.toggle('emotes-open'));
    this.photoButton.addEventListener('click', () => this.enterPhoto());
    this.moderationButton.addEventListener('click', () => this.openDrawer());
    this.handOver.addEventListener('click', () => {
      if (this.handOver.getAttribute('aria-disabled') === 'true') return;
      void this.handOverParcel();
    });
    this.handOver.hidden = true;
    this.moderationButton.hidden = true;

    host.append(
      this.notices.region,
      tabs,
      this.postbox.card.root,
      this.depot.card.root,
      this.satchel.card.root,
      this.scene.region,
      this.handOver,
      el('div', { class: 'tools' }, [
        this.emotesToggle,
        this.emotes,
        this.photoButton,
        this.moderationButton,
      ]),
      el('div', { class: 'horizon' }, [
        this.scene.compass,
        this.scene.metresNumeral,
        this.scene.routeStatus,
      ]),
      this.scene.couriersList,
      this.letter.root,
      this.outfitter.dialog.root,
      this.history.dialog.root,
      this.claimSave.dialog.root,
      this.mailDialog.dialog.root,
      this.revokeConfirm.dialog.root,
      this.photo.root,
      this.drawer.root,
      this.drawer.renameConfirm.dialog.root,
    );
    if (this.touch !== null) {
      host.classList.add('touch');
      host.append(this.touch.stick, this.touch.jump);
    }
    this.renderMe();
  }

  private renderMe(): void {
    this.postbox.render(this.me);
    this.satchel.render(
      this.satchelNames.get(this.me.satchel_colour) ?? 'Canvas Satchel',
      this.openParcel !== null,
    );
    this.moderationButton.hidden = this.me.role !== 'helper' && this.me.role !== 'founder';
    this.postbox.renderPostcards(this.postcards);
  }

  // --- keys ---

  private listenToKeys(): void {
    const held = new Set<string>();
    const walking = (): void => {
      const forward = held.has('w') || held.has('arrowup');
      const back = held.has('s') || held.has('arrowdown');
      const left = held.has('a') || held.has('arrowleft');
      const right = held.has('d') || held.has('arrowright');
      this.scene.setWalk(forward === back ? 0 : forward ? 1 : -1);
      this.scene.setTurn(left === right ? 0 : left ? -1 : 1);
    };
    const inField = (target: EventTarget | null): boolean => {
      const node = target as HTMLElement | null;
      return node !== null && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA');
    };
    document.addEventListener('keydown', (event) => {
      if (this.scene.introPlaying) {
        this.scene.skipIntro();
        return;
      }
      if (event.key === 'Escape') {
        this.closeTopDialog();
        return;
      }
      if (inField(event.target) || this.photo.open) return;
      const key = event.key.toLowerCase();
      if (key === ' ') {
        event.preventDefault();
        this.scene.hop();
        return;
      }
      if (key === 'enter' && document.activeElement === this.scene.region) {
        if (!this.handOver.hidden) void this.handOverParcel();
        return;
      }
      if (WALK_KEYS.includes(key)) {
        event.preventDefault();
        held.add(key);
        walking();
      }
    });
    document.addEventListener('keyup', (event) => {
      held.delete(event.key.toLowerCase());
      walking();
    });
    document.addEventListener('pointerdown', () => this.scene.skipIntro(), { capture: true });
  }

  private closeTopDialog(): void {
    for (const dialog of [
      this.drawer.renameConfirm.dialog,
      this.revokeConfirm.dialog,
      this.mailDialog.dialog,
      this.claimSave.dialog,
      this.history.dialog,
      this.outfitter.dialog,
    ]) {
      if (dialog.open) {
        dialog.close();
        return;
      }
    }
    if (this.letter.isOpen) {
      this.letter.startFold();
      return;
    }
    for (const card of [this.postbox.card, this.depot.card, this.satchel.card]) {
      if (card.root.classList.contains('sheet-open')) {
        card.setOpen(false);
        card.tab.focus();
        return;
      }
    }
  }

  // --- loops ---

  private startLoops(): void {
    window.setInterval(() => {
      if (page.visible) void this.refreshBoard();
    }, BOARD_REFRESH_MS);
    window.setInterval(() => {
      if (page.visible) void this.heartbeat();
    }, PRESENCE_MS);
    window.setInterval(() => void this.pollStatus(), STATUS_MS);
    onFrame(() => {
      const phase = this.scene.threadPhase;
      const handing = phase === 'handing';
      this.handOver.hidden = !(phase === 'arrived' || handing);
      if (handing) this.handOver.setAttribute('aria-disabled', 'true');
      else this.handOver.removeAttribute('aria-disabled');
    });
  }

  private phaseChanged(phase: ThreadPhase): void {
    if (phase === 'idle') {
      this.satchel.render(
        this.satchelNames.get(this.me.satchel_colour) ?? 'Canvas Satchel',
        false,
      );
    }
  }

  private async pollStatus(): Promise<void> {
    try {
      const status = (
        await request<{ darkroom: string; post_office: string }>('GET', '/api/status')
      ).body;
      const open = status.darkroom === 'open';
      if (open !== this.darkroomOpen) {
        this.darkroomOpen = open;
        this.postbox.setDarkroomClosed(!open);
        this.postbox.renderPostcards(this.postcards);
      }
      this.photo.setDarkroom(open);
    } catch {
      /* the next poll tries afresh */
    }
  }

  // --- the board ---

  private async refreshBoard(): Promise<void> {
    try {
      const read = (await request<DepotRead>('GET', '/api/depot')).body;
      this.depot.render(read);
      this.checkHoldAgainstBoard(read);
    } catch {
      /* the next refresh tries afresh */
    }
  }

  // --- taking a parcel ---

  private residentName(residentId: string): string {
    return this.world.residents.find((each) => each.resident_id === residentId)?.name ?? '';
  }

  private residentHome(residentId: string): string {
    return this.world.residents.find((each) => each.resident_id === residentId)?.home ?? '';
  }

  private readLetter(mission: MissionRow, opener: HTMLElement): void {
    this.pendingMission = mission;
    this.letter.show(
      {
        kind: 'offer',
        resident: this.residentName(mission.resident_id),
        lines: mission.dialogue.offer,
        onTake: () => undefined,
      },
      this.scene.doorScreen(mission.resident_id),
      opener,
    );
  }

  private async takeParcel(): Promise<void> {
    const mission = this.pendingMission;
    if (mission === null || this.acceptPending) return;
    this.acceptPending = true;
    this.letter.setPending(true);
    this.notices.say(copy.accept.pending);
    const body = { position: this.scene.here };
    try {
      const answer = await withRetries(
        () => request<Parcel>('POST', `/api/missions/${mission.mission_id}/accept`, { json: body }),
        { onRetry: () => this.notices.say(copy.accept.retrying) },
      );
      this.acceptPending = false;
      this.letter.setPending(false);
      this.letter.startFold();
      this.applyParcel(answer.body, { animate: true });
      this.notices.say(copy.accept.success);
      void this.refreshBoard();
    } catch (fault) {
      this.acceptPending = false;
      this.letter.setPending(false);
      if (fault instanceof Unreachable) {
        const me = await this.readMe();
        if (me?.open_parcel) {
          this.letter.startFold();
          this.applyParcel(me.open_parcel, { animate: true });
          this.notices.say(copy.accept.success);
          void this.refreshBoard();
          return;
        }
        this.notices.say(copy.accept.unreachable);
        return;
      }
      if (fault instanceof ApiFault) {
        this.letter.startFold();
        this.notices.say(this.acceptCopy(fault));
        void this.refreshBoard();
      }
    }
  }

  private acceptCopy(fault: ApiFault): string {
    if (fault.code === 'mission_not_live') return copy.accept.mission_not_live;
    if (fault.code === 'hands_full') return copy.accept.hands_full;
    return fault.status === 500 ? copy.internal : fault.sentence;
  }

  private applyParcel(parcel: Parcel | null, options: { animate: boolean }): void {
    this.openParcel = parcel;
    if (parcel === null) {
      this.scene.closeRoute();
      this.stopHoldWatch();
      this.renderMe();
      return;
    }
    const route: OpenRoute = {
      routeId: parcel.route.route_id,
      door: parcel.route.door,
      totalArcM: parcel.route.total_arc_m,
      home: this.residentHome(parcel.resident.resident_id),
      carrying: parcel.rush_id === null ? 'standard' : 'rush',
    };
    this.scene.openRoute(route, options);
    this.renderMe();
    this.watchHold(parcel);
  }

  // --- handing over ---

  private async handOverParcel(): Promise<void> {
    const parcel = this.openParcel;
    if (parcel === null || this.handingPending) return;
    let held = this.handoverTickets.get(parcel.acceptance_id);
    if (held === undefined) {
      held = { ticket: newTicket(), body: null };
      this.handoverTickets.set(parcel.acceptance_id, held);
    }
    const body = held.body ?? { acceptance_id: parcel.acceptance_id, position: this.scene.here };
    this.handingPending = true;
    this.scene.markHanding();
    this.notices.say(copy.handover.pending);
    try {
      const answer = await withRetries(
        () =>
          request<{
            stamps_awarded: number;
            balance: number;
            dialogue: { thanks: string[] };
          }>('POST', '/api/deliveries', {
            json: body,
            headers: { 'Handover-Ticket': held.ticket },
          }),
        {
          onRetry: () => {
            held.body = body;
            this.notices.say(copy.handover.retrying);
          },
        },
      );
      this.handingPending = false;
      held.body = body;
      this.scene.markDelivered();
      this.balance.change(answer.body.balance);
      this.notices.say(copy.handover.success(parcel.resident.name, answer.body.stamps_awarded));
      this.letter.show(
        { kind: 'thanks', resident: parcel.resident.name, lines: answer.body.dialogue.thanks },
        this.scene.doorScreen(parcel.resident.resident_id),
        null,
      );
      this.openParcel = null;
      this.stopHoldWatch();
      this.renderMe();
      void this.refreshBoard();
    } catch (fault) {
      this.handingPending = false;
      if (fault instanceof Unreachable) {
        held.body = body;
        this.scene.markArrivedAgain();
        this.notices.say(copy.handover.unreachable);
        return;
      }
      held.body = null;
      if (!(fault instanceof ApiFault)) return;
      if (fault.code === 'hold_expired') {
        this.notices.say(copy.handover.hold_expired);
        this.applyLapse({ announced: true });
        return;
      }
      if (fault.code === 'already_delivered') {
        this.scene.markDelivered();
        this.notices.say(copy.handover.already_delivered);
        this.openParcel = null;
        this.renderMe();
        void this.refreshBoard();
        return;
      }
      this.scene.markArrivedAgain();
      this.notices.say(
        fault.fields?.position === 'too_far'
          ? copy.handover.too_far
          : fault.status === 500
            ? copy.internal
            : fault.sentence,
      );
    }
  }

  // --- rush ---

  private holdCopy(until: string | null): string {
    if (until === null) return copy.claim.success('');
    const when = new Date(until);
    const hours = String(when.getHours()).padStart(2, '0');
    const minutes = String(when.getMinutes()).padStart(2, '0');
    return copy.claim.success(`${hours}:${minutes}`);
  }

  private async claimRush(row: RushRow, button: HTMLButtonElement): Promise<void> {
    this.depot.markClaiming(row.rush_id, true);
    this.notices.say(copy.claim.pending);
    const body = { position: this.scene.here };
    try {
      const answer = await withRetries(
        () => request<Parcel>('POST', `/api/rush/${row.rush_id}/claim`, { json: body }),
        { onRetry: () => this.notices.say(copy.accept.retrying) },
      );
      this.depot.markClaiming(row.rush_id, false);
      this.applyParcel(answer.body, { animate: true });
      this.notices.say(this.holdCopy(answer.body.hold_expires_at));
      void this.refreshBoard();
    } catch (fault) {
      this.depot.markClaiming(row.rush_id, false);
      if (fault instanceof Unreachable) {
        const me = await this.readMe();
        if (me?.open_parcel?.rush_id === row.rush_id) {
          this.applyParcel(me.open_parcel, { animate: true });
          this.notices.say(this.holdCopy(me.open_parcel.hold_expires_at));
        } else {
          this.notices.say(copy.accept.unreachable);
        }
        void this.refreshBoard();
        return;
      }
      if (!(fault instanceof ApiFault)) return;
      const sentences: Record<string, string> = {
        parcel_taken: copy.claim.parcel_taken,
        sign_in_required: copy.claim.sign_in_required,
        hands_full: copy.accept.hands_full,
        board_closed: copy.claim.board_closed,
        mission_not_live: copy.accept.mission_not_live,
      };
      this.notices.say(
        sentences[fault.code] ?? (fault.status === 500 ? copy.internal : fault.sentence),
      );
      void this.refreshBoard();
      void button;
    }
  }

  private async dropParcel(): Promise<void> {
    const parcel = this.openParcel;
    if (parcel === null) return;
    this.notices.say(copy.drop.pending);
    try {
      await request('POST', `/api/acceptances/${parcel.acceptance_id}/drop`, { json: {} });
      this.openParcel = null;
      this.scene.rewind();
      this.stopHoldWatch();
      this.renderMe();
      this.notices.say(copy.drop.success);
      void this.refreshBoard();
    } catch (fault) {
      if (!(fault instanceof ApiFault)) return;
      if (fault.code === 'parcel_closed') {
        this.notices.say(copy.drop.parcel_closed);
        this.applyLapse({ announced: true });
        return;
      }
      this.notices.say(fault.sentence);
    }
  }

  // --- rush hold lapses ---

  private watchHold(parcel: Parcel): void {
    this.stopHoldWatch();
    if (parcel.hold_expires_at === null) return;
    const wait = new Date(parcel.hold_expires_at).getTime() - serverNow();
    this.holdTimer = window.setTimeout(() => void this.checkHold('deadline'), Math.max(0, wait));
  }

  private stopHoldWatch(): void {
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private async checkHold(reason: 'deadline' | 'shown'): Promise<void> {
    const parcel = this.openParcel;
    if (parcel === null || parcel.hold_expires_at === null) return;
    if (serverNow() < new Date(parcel.hold_expires_at).getTime()) return;
    if (reason === 'shown') this.applyLapse({ announced: false });
    const me = await this.readMe();
    if (me !== null && (me.open_parcel === null || me.open_parcel.acceptance_id !== parcel.acceptance_id)) {
      this.applyLapse({ announced: false });
    }
    void this.refreshBoard();
  }

  private checkHoldAgainstBoard(read: DepotRead): void {
    const parcel = this.openParcel;
    if (parcel === null || parcel.rush_id === null) return;
    const row = read.rush.find((each) => each.rush_id === parcel.rush_id);
    if (row === undefined) return;
    if (row.status !== 'yours' && row.status !== 'delivered') {
      this.applyLapse({ announced: false });
    }
  }

  /** A lapse is applied once, however many reads notice it. */
  private applyLapse(options: { announced: boolean }): void {
    const parcel = this.openParcel;
    if (parcel === null || this.lapsedFor.has(parcel.acceptance_id)) return;
    this.lapsedFor.add(parcel.acceptance_id);
    this.openParcel = null;
    this.scene.rewind();
    this.stopHoldWatch();
    this.renderMe();
    if (!options.announced) this.notices.say(copy.handover.hold_expired);
    void this.refreshBoard();
  }

  private async readMe(): Promise<Me | null> {
    try {
      const me = (await request<Me>('GET', '/api/me')).body;
      this.me = me;
      this.scene.wear(me.satchel_colour);
      return me;
    } catch {
      return null;
    }
  }

  // --- outfitter ---

  private async loadOutfitter(): Promise<void> {
    try {
      const view = (await request<{ satchels: SatchelOffer[] }>('GET', '/api/outfitter')).body;
      this.satchelNames = new Map(view.satchels.map((offer) => [offer.satchel_id, offer.name]));
      this.outfitter.render(view.satchels);
      this.renderMe();
    } catch {
      /* the card keeps its last reading */
    }
  }

  private async openOutfitter(opener: HTMLElement): Promise<void> {
    await this.loadOutfitter();
    this.outfitter.dialog.show(opener);
  }

  private async buySatchel(offer: SatchelOffer): Promise<void> {
    const ticket = newTicket();
    this.notices.say(copy.buy.pending);
    try {
      const answer = await withRetries(
        () =>
          request<{ balance: number }>('POST', `/api/outfitter/${offer.satchel_id}/buy`, {
            json: {},
            headers: { 'Purchase-Ticket': ticket },
          }),
        { onRetry: () => this.notices.say(copy.buy.retrying) },
      );
      this.balance.change(answer.body.balance);
      this.notices.say(copy.buy.success(offer.name));
      await this.loadOutfitter();
    } catch (fault) {
      if (fault instanceof Unreachable) {
        this.notices.say(copy.buy.unreachable);
        return;
      }
      if (!(fault instanceof ApiFault)) return;
      if (fault.code === 'insufficient_stamps') {
        const me = await this.readMe();
        this.notices.say(copy.buy.insufficient_stamps(offer.price - (me?.balance ?? 0)));
        return;
      }
      if (fault.code === 'already_owned') {
        this.notices.say(copy.buy.already_owned);
        await this.loadOutfitter();
        return;
      }
      this.notices.say(fault.status === 500 ? copy.internal : fault.sentence);
    }
  }

  private async wearSatchel(offer: SatchelOffer): Promise<void> {
    this.notices.say(copy.wear.pending);
    try {
      const answer = await request<Me>('PATCH', '/api/me', {
        json: { satchel_id: offer.satchel_id },
      });
      this.me = answer.body;
      this.scene.wear(answer.body.satchel_colour);
      this.notices.say(copy.wear.success(offer.name));
      await this.loadOutfitter();
    } catch (fault) {
      if (fault instanceof ApiFault) {
        this.notices.say(fault.code === 'not_owned' ? copy.wear.not_owned : fault.sentence);
      }
    }
  }

  // --- stamp history ---

  private async openHistory(opener: HTMLElement): Promise<void> {
    this.historyCursor = null;
    this.history.reset();
    this.history.dialog.show(opener);
    await this.loadHistory(false);
  }

  private async loadHistory(append: boolean): Promise<void> {
    this.notices.say(copy.history.pending);
    const query = new URLSearchParams({ limit: String(HISTORY_PAGE) });
    if (append && this.historyCursor !== null) query.set('before', this.historyCursor);
    try {
      const answer = (
        await request<{ balance: number; movements: Movement[]; next_cursor: string | null }>(
          'GET',
          `/api/me/ledger?${query.toString()}`,
        )
      ).body;
      this.historyCursor = answer.next_cursor;
      this.history.render(answer.balance, answer.movements, append, answer.next_cursor !== null);
      this.notices.clear();
    } catch {
      this.notices.say(copy.history.failure);
    }
  }

  // --- the postbox ---

  private async saveName(raw: string): Promise<void> {
    if (checkDisplayName(raw).fault !== null) {
      this.postbox.showNameError(copy.name.invalid);
      this.notices.say(copy.name.invalid);
      return;
    }
    this.postbox.showNameError(null);
    this.notices.say(copy.name.pending);
    try {
      const answer = await request<Me>('PATCH', '/api/me', { json: { display_name: raw } });
      this.me = answer.body;
      this.renderMe();
      this.notices.say(copy.name.success);
    } catch (fault) {
      if (!(fault instanceof ApiFault)) return;
      const message = fault.code === 'name_locked' ? copy.name.name_locked : copy.name.invalid;
      this.postbox.showNameError(message);
      this.notices.say(message);
    }
  }

  private async sendPostboxKey(email: string): Promise<void> {
    this.notices.say(copy.postboxKey.pending);
    try {
      await request('POST', '/api/auth/postbox-key', { json: { email } });
      this.claimSave.showError(null);
      this.notices.say(copy.postboxKey.success);
    } catch (fault) {
      if (!(fault instanceof ApiFault)) return;
      const message =
        fault.code === 'post_office_closed' ? copy.postboxKey.closed : copy.postboxKey.invalid;
      this.claimSave.showError(message);
      this.notices.say(message);
    }
  }

  private async signOut(): Promise<void> {
    this.notices.say(copy.signOut.pending);
    try {
      await request('POST', '/api/auth/sign-out', { json: {} });
      this.notices.say(copy.signOut.success);
      window.location.assign('/');
    } catch (fault) {
      if (fault instanceof ApiFault) this.notices.say(fault.sentence);
    }
  }

  // --- presence ---

  private async heartbeat(): Promise<void> {
    this.sequence += 1;
    const emote = this.pendingEmote;
    this.pendingEmote = null;
    try {
      const answer = await request<{ muted: boolean; emote: string | null }>(
        'POST',
        '/api/presence',
        {
          json: {
            stream: this.stream,
            seq: this.sequence,
            position: {
              lat: this.scene.here.lat,
              lon: this.scene.here.lon,
              heading_deg: Number(this.scene.region.getAttribute('data-heading-deg') ?? '0'),
            },
            ...(emote === null ? {} : { emote }),
          },
        },
      );
      if (emote !== null && answer.body.muted) this.notices.say(copy.emoteMuted);
      const read = (await request<{ couriers: PresenceEntry[] }>('GET', '/api/presence')).body;
      this.scene.presence(read.couriers, this.firstPresence);
      this.firstPresence = false;
    } catch {
      /* the next beat tries afresh */
    }
  }

  private async sendEmote(emote: string): Promise<void> {
    this.pendingEmote = emote;
    this.scene.showEmote(emote);
    await this.heartbeat();
  }

  // --- photo mode ---

  private enterPhoto(): void {
    this.photo.show(this.me.email !== null);
    this.scene.enterPhotoMode();
    document.getElementById('bramble-app')?.classList.add('photo-open');
    void this.pollStatus();
  }

  private leavePhoto(): void {
    this.photo.hide();
    this.scene.leavePhotoMode();
    document.getElementById('bramble-app')?.classList.remove('photo-open');
    this.photoButton.focus();
  }

  private async takePostcard(): Promise<void> {
    this.notices.say(copy.postcard.pending);
    try {
      const blob = await this.scene.capture();
      await request('POST', '/api/postcards', {
        raw: await blob.arrayBuffer(),
        contentType: 'image/png',
      });
      this.notices.say(copy.postcard.success);
      await this.refreshPostcards();
    } catch (fault) {
      if (!(fault instanceof ApiFault)) return;
      const sentences: Record<string, string> = {
        sign_in_required: copy.postcard.sign_in_required,
        postbox_full: copy.postcard.postbox_full,
        validation: copy.postcard.rejected,
        darkroom_closed: copy.postcard.darkroomClosed,
      };
      this.notices.say(sentences[fault.code] ?? copy.internal);
    }
  }

  private async refreshPostcards(): Promise<void> {
    if (this.me.email === null) {
      this.postcards = [];
      this.postbox.renderPostcards([]);
      return;
    }
    try {
      const answer = (await request<{ postcards: PostcardRow[] }>('GET', '/api/postcards')).body;
      this.postcards = answer.postcards;
      this.postbox.renderPostcards(answer.postcards);
    } catch {
      /* the list keeps its last reading */
    }
  }

  private async copyLink(postcard: PostcardRow): Promise<void> {
    try {
      await navigator.clipboard.writeText(postcard.share_url);
    } catch {
      /* the notice still reports what the press meant */
    }
    this.notices.say(copy.postcard.copied);
  }

  private openMail(postcard: PostcardRow, opener: HTMLElement): void {
    this.mailTarget = postcard;
    this.mailDialog.field.value = '';
    this.mailAddress = '';
    this.mailTicket = newTicket();
    this.mailDialog.showError(null);
    this.mailDialog.dialog.show(opener, this.mailDialog.field);
  }

  private freshMailTicket(): void {
    if (this.mailDialog.field.value !== this.mailAddress) {
      this.mailAddress = this.mailDialog.field.value;
      this.mailTicket = newTicket();
    }
  }

  private async mailPostcard(email: string): Promise<void> {
    const postcard = this.mailTarget;
    if (postcard === null) return;
    this.freshMailTicket();
    this.notices.say(copy.mail.pending);
    try {
      await withRetries(
        () =>
          request('POST', `/api/postcards/${postcard.postcard_id}/mail`, {
            json: { to: email },
            headers: { 'Mail-Ticket': this.mailTicket },
          }),
        { onRetry: () => this.notices.say(copy.mail.retrying) },
      );
      this.mailDialog.dialog.close();
      this.notices.say(copy.mail.success(email));
    } catch (fault) {
      if (fault instanceof Unreachable) {
        this.notices.say(copy.mail.unreachable);
        return;
      }
      if (!(fault instanceof ApiFault)) return;
      if (fault.code === 'mail_limit') {
        const seconds = Number(fault.headers.get('retry-after') ?? '60');
        this.notices.say(copy.mail.mail_limit(Math.ceil(seconds / 60)));
        return;
      }
      const message = fault.code === 'post_office_closed' ? copy.mail.closed : copy.mail.invalid;
      this.mailDialog.showError(message);
      this.notices.say(message);
    }
  }

  private askRevoke(postcard: PostcardRow, opener: HTMLElement): void {
    this.revokeTarget = postcard;
    this.revokeConfirm.ask('Revoke this postcard? Its link will stop working.', opener);
  }

  private async revokePostcard(): Promise<void> {
    const postcard = this.revokeTarget;
    this.revokeConfirm.dialog.close();
    if (postcard === null) return;
    this.notices.say(copy.postcard.revokePending);
    try {
      await request('DELETE', `/api/postcards/${postcard.postcard_id}`);
      this.notices.say(copy.postcard.revoked);
      await this.refreshPostcards();
    } catch (fault) {
      if (!(fault instanceof ApiFault)) return;
      this.notices.say(
        fault.code === 'darkroom_closed' ? copy.postcard.darkroomClosed : fault.sentence,
      );
    }
  }

  // --- moderation ---

  private openDrawer(): void {
    void this.refreshStaff().then(() => this.drawer.show());
    this.staffTimer = window.setInterval(() => void this.refreshStaff(), STAFF_REFRESH_MS);
  }

  private closeDrawer(): void {
    this.drawer.hide();
    if (this.staffTimer !== null) window.clearInterval(this.staffTimer);
    this.staffTimer = null;
    this.moderationButton.focus();
  }

  private async refreshStaff(): Promise<void> {
    try {
      const view = (await request<{ couriers: StaffCourier[] }>('GET', '/api/moderation/presence'))
        .body;
      const audit = (await request<{ entries: AuditEntry[] }>('GET', '/api/moderation/audit')).body;
      this.drawer.render(view.couriers, audit.entries);
    } catch {
      /* the drawer keeps its last reading */
    }
  }

  private async toggleMute(courier: StaffCourier): Promise<void> {
    const move = courier.muted ? 'unmute' : 'mute';
    this.notices.say(copy.moderation.pending);
    try {
      await request('POST', `/api/moderation/${courier.moderation_ref}/${move}`, { json: {} });
      this.notices.say(
        move === 'mute'
          ? copy.moderation.muted(courier.display_name)
          : copy.moderation.unmuted(courier.display_name),
      );
    } catch (fault) {
      if (!(fault instanceof ApiFault)) return;
      const sentences: Record<string, string> = {
        already_muted: copy.moderation.already_muted(courier.display_name),
        not_muted: copy.moderation.not_muted(courier.display_name),
        cannot_moderate_staff: copy.moderation.cannot_moderate_staff,
      };
      this.notices.say(sentences[fault.code] ?? fault.sentence);
    }
    await this.refreshStaff();
    this.drawer.focusToggleOf(courier.moderation_ref);
  }

  private async renameCourier(courier: StaffCourier): Promise<void> {
    this.notices.say(copy.moderation.pending);
    try {
      const answer = await request<{ display_name: string }>(
        'POST',
        `/api/moderation/${courier.moderation_ref}/rename`,
        { json: {} },
      );
      this.notices.say(copy.moderation.renamed(courier.display_name, answer.body.display_name));
    } catch (fault) {
      if (fault instanceof ApiFault) {
        this.notices.say(
          fault.code === 'cannot_moderate_staff'
            ? copy.moderation.cannot_moderate_staff
            : fault.sentence,
        );
      }
    }
    await this.refreshStaff();
    this.drawer.focusRenameOf(courier.moderation_ref);
  }
}

void new Game().start();
