/**
 * The Steward view: the price post form, the risk parameter form, the shock
 * ruler with Post this price, member onboarding and inbound transfers.
 */

import { ASSET_CODES, type Asset } from '../../domain/assets.ts';
import { ROLE_LABEL } from '../../domain/copy.ts';
import {
  formatAmount,
  formatPercentPlain,
  formatPriceForInput,
  parsePercentInput,
  parsePriceInput,
} from '../../domain/deskformat.ts';
import { ROLES, type Role } from '../../domain/roles.ts';
import { ApiProblem, request, requestWithEtag } from '../api.ts';
import { clear, el, setText } from '../dom.ts';
import { applyFieldErrors, button, Field, whilePending } from '../parts/fields.ts';
import type { LiveRegions } from '../parts/live.ts';
import { priceUnitsOf } from '../prices.ts';
import { ShockRuler } from '../parts/shockruler.ts';
import { store } from '../store.ts';
import type { MemberDto, PositionsDto, PricePostDto, RiskDto, TransferDto } from '../types.ts';
import { amountUnits } from './supply.ts';
import type { View } from './view.ts';

export function stewardView(
  live: LiveRegions,
  navigate: (path: string) => void,
  afterPost: () => void,
): View {
  const assetChooser = el('select', { class: 'chooser', 'aria-label': 'Asset' });
  for (const asset of ASSET_CODES) {
    assetChooser.append(el('option', { value: asset, text: asset }));
  }
  assetChooser.value = 'MBTC';
  assetChooser.id = 'steward-asset';
  const chosen = (): Asset => assetChooser.value as Asset;

  // ---- price post ---------------------------------------------------------
  const newPrice = new Field('New price', { kind: 'price' });
  const confirmLarge = el('input', {
    type: 'checkbox',
    id: 'confirm-large-move',
    'aria-label': 'Confirm large move',
  });
  const postButton = button('Post price');
  newPrice.submitsWith(postButton);

  // ---- risk parameters ----------------------------------------------------
  const ltv = new Field('Loan-to-value (%)', { kind: 'percent' });
  const threshold = new Field('Liquidation threshold (%)', { kind: 'percent' });
  const bonus = new Field('Liquidation bonus (%)', { kind: 'percent' });
  const reserve = new Field('Reserve factor (%)', { kind: 'percent' });
  const saveRisk = button('Save risk parameters');
  const riskNow = new Map<string, HTMLElement>();
  let riskEtag: string | null = null;

  function riskRow(field: Field, name: string): HTMLElement {
    const now = el('span', { class: 'now figure' });
    riskNow.set(name, now);
    return el('div', { class: 'risk-row' }, [field.row, now]);
  }

  // ---- onboarding ---------------------------------------------------------
  const memberName = el('input', {
    type: 'text',
    class: 'field-input',
    'aria-label': 'Member name',
    id: 'member-name',
    autocomplete: 'off',
  });
  const memberEmail = el('input', {
    type: 'text',
    class: 'field-input',
    'aria-label': 'Member email',
    id: 'member-email',
    autocomplete: 'off',
  });
  const memberRole = el('select', {
    class: 'chooser',
    'aria-label': 'Member role',
    id: 'member-role',
  });
  for (const role of ROLES) {
    memberRole.append(el('option', { value: role, text: ROLE_LABEL[role] }));
  }
  const addMember = button('Add member');

  // ---- transfers ----------------------------------------------------------
  const memberChooser = el('select', {
    class: 'chooser',
    'aria-label': 'Member',
    id: 'transfer-member',
  });
  const transferAsset = el('select', {
    class: 'chooser',
    'aria-label': 'Transfer asset',
    id: 'transfer-asset',
  });
  for (const asset of ASSET_CODES) {
    transferAsset.append(el('option', { value: asset, text: asset }));
  }
  const transferAmount = new Field('Transfer amount', {
    kind: 'amount',
    decimals: () => store.decimalsOf(transferAsset.value as Asset),
  });
  const recordTransfer = button('Record transfer');
  transferAmount.submitsWith(recordTransfer);

  const ruler = new ShockRuler({
    showPost: true,
    onPost: (shocked) => {
      // Post this price copies the shocked price into New price without `$`.
      newPrice.value = formatPriceForInput(shocked);
      newPrice.validate();
      postButton.focus();
    },
  });

  postButton.addEventListener('click', () => void doPost());
  saveRisk.addEventListener('click', () => void doSaveRisk());
  addMember.addEventListener('click', () => void doAddMember());
  recordTransfer.addEventListener('click', () => void doTransfer());
  assetChooser.addEventListener('change', () => {
    void loadRisk();
    void loadRuler();
  });

  async function doPost(): Promise<void> {
    if (!newPrice.validate() || !newPrice.ready) {
      newPrice.focus();
      return;
    }
    const parsed = parsePriceInput(newPrice.value);
    if (!parsed.ok) {
      newPrice.focus();
      return;
    }
    live.clearProblems();
    live.announce('Posting price');
    try {
      await whilePending(postButton, async () => {
        const reply = await request<PricePostDto>('POST', '/api/prices', {
          token: store.token,
          body: {
            asset: chosen(),
            price: parsed.value,
            ...(confirmLarge.checked ? { confirm_large_move: true } : {}),
          },
        });
        const count = reply.positions_below_one;
        live.announce(
          `Price posted. ${count === 1 ? '1 position' : `${count} positions`} now below health factor 1.`,
        );
        newPrice.value = '';
        confirmLarge.checked = false;
        await store.refresh();
        afterPost();
        await loadRuler();
      });
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 422) {
        live.validation(applyFieldErrors([{ name: 'price', field: newPrice }], error.errors));
      } else {
        live.report(error);
      }
    }
  }

  async function loadRisk(): Promise<void> {
    const reply = await requestWithEtag<RiskDto>(`/api/assets/${chosen()}/risk`, {
      token: store.token,
    });
    riskEtag = reply.etag;
    ltv.value = formatPercentPlain(BigInt(reply.body.ltv_bps));
    threshold.value = formatPercentPlain(BigInt(reply.body.liquidation_threshold_bps));
    bonus.value = formatPercentPlain(BigInt(reply.body.liquidation_bonus_bps));
    reserve.value = formatPercentPlain(BigInt(reply.body.reserve_factor_bps));
    for (const now of riskNow.values()) setText(now, '');
  }

  async function doSaveRisk(): Promise<void> {
    const fields = [
      { name: 'ltv_bps', field: ltv },
      { name: 'liquidation_threshold_bps', field: threshold },
      { name: 'liquidation_bonus_bps', field: bonus },
      { name: 'reserve_factor_bps', field: reserve },
    ];
    let bad = false;
    for (const entry of fields) {
      if (!entry.field.validate() || !entry.field.ready) bad = true;
    }
    if (bad) {
      fields.find((entry) => entry.field.hasError || !entry.field.ready)?.field.focus();
      return;
    }
    const body: Record<string, number> = {};
    for (const entry of fields) {
      const parsed = parsePercentInput(entry.field.value);
      if (parsed.ok) body[entry.name] = Number(parsed.value);
    }
    live.clearProblems();
    live.announce('Saving risk parameters');
    try {
      await whilePending(saveRisk, async () => {
        const reply = await request<RiskDto>('PATCH', `/api/assets/${chosen()}/risk`, {
          token: store.token,
          body,
          ...(riskEtag === null ? {} : { ifMatch: riskEtag }),
        });
        live.announce(`Risk parameters saved for ${reply.asset}.`);
        await loadRisk();
        await store.refresh();
      });
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 412) {
        // The typed values stay; the current stored value is shown under each
        // field and the remembered version updates.
        live.report(error);
        const current = await requestWithEtag<RiskDto>(`/api/assets/${chosen()}/risk`, {
          token: store.token,
        });
        riskEtag = current.etag;
        setText(
          riskNow.get('ltv_bps') ?? el('span'),
          `Now ${formatPercentPlain(BigInt(current.body.ltv_bps))}%`,
        );
        setText(
          riskNow.get('liquidation_threshold_bps') ?? el('span'),
          `Now ${formatPercentPlain(BigInt(current.body.liquidation_threshold_bps))}%`,
        );
        setText(
          riskNow.get('liquidation_bonus_bps') ?? el('span'),
          `Now ${formatPercentPlain(BigInt(current.body.liquidation_bonus_bps))}%`,
        );
        setText(
          riskNow.get('reserve_factor_bps') ?? el('span'),
          `Now ${formatPercentPlain(BigInt(current.body.reserve_factor_bps))}%`,
        );
        return;
      }
      if (error instanceof ApiProblem && error.status === 422) {
        live.validation(applyFieldErrors(fields, error.errors));
        return;
      }
      live.report(error);
    }
  }

  async function doAddMember(): Promise<void> {
    live.clearProblems();
    live.announce('Adding member');
    try {
      await whilePending(addMember, async () => {
        const reply = await request<MemberDto>('POST', '/api/actors', {
          token: store.token,
          body: {
            name: memberName.value,
            email: memberEmail.value,
            role: memberRole.value as Role,
          },
        });
        live.announce(`Member added: ${reply.name}.`);
        memberName.value = '';
        memberEmail.value = '';
        await store.loadActors();
        renderMemberChooser();
      });
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 422) {
        for (const [field, input] of [
          ['name', memberName],
          ['email', memberEmail],
        ] as const) {
          const message = error.errors[field];
          if (message === undefined) {
            input.removeAttribute('aria-invalid');
            continue;
          }
          input.setAttribute('aria-invalid', 'true');
        }
        live.problem('Check the highlighted fields.');
        if (error.errors['name'] !== undefined) memberName.focus();
        else if (error.errors['email'] !== undefined) memberEmail.focus();
        return;
      }
      live.report(error);
    }
  }

  async function doTransfer(): Promise<void> {
    if (!transferAmount.validate() || !transferAmount.ready) {
      transferAmount.focus();
      return;
    }
    const asset = transferAsset.value as Asset;
    live.clearProblems();
    live.announce('Recording transfer');
    try {
      await whilePending(recordTransfer, async () => {
        const reply = await request<TransferDto>('POST', '/api/transfers', {
          token: store.token,
          body: {
            actor_id: memberChooser.value,
            asset,
            amount: amountUnits(transferAmount.value, store.decimalsOf(asset)),
          },
        });
        const name =
          store.actors.find((actor) => actor.actor_id === reply.actor_id)?.name ??
          reply.actor_id;
        live.announce(
          `Transfer recorded: ${formatAmount(BigInt(reply.amount), store.decimalsOf(asset))} ${asset} to ${name}.`,
        );
        transferAmount.value = '';
        await store.refresh();
      });
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 422) {
        live.validation(
          applyFieldErrors([{ name: 'amount', field: transferAmount }], error.errors),
        );
      } else {
        live.report(error);
      }
    }
  }

  function renderMemberChooser(): void {
    const wanted = store.actors.map((actor) => actor.actor_id).join(',');
    if (memberChooser.dataset['ids'] === wanted) return;
    memberChooser.dataset['ids'] = wanted;
    const chosenBefore = memberChooser.value;
    clear(memberChooser);
    for (const actor of store.actors) {
      memberChooser.append(
        el('option', {
          value: actor.actor_id,
          text: `${actor.name} (${ROLE_LABEL[actor.role]})`,
        }),
      );
    }
    if (chosenBefore !== '') memberChooser.value = chosenBefore;
  }

  async function loadRuler(): Promise<void> {
    const asset = chosen();
    const pool = store.poolFor(asset);
    if (pool === null) return;
    const reply = await request<PositionsDto>(
      'GET',
      `/api/positions?collateral_asset=${asset}`,
      { token: store.token },
    );
    ruler.setData(asset, priceUnitsOf(pool.price), reply.positions);
  }

  const element = el('section', { class: 'worksheet-body' }, [
    el('h1', { class: 'view-head', text: 'Steward' }),
    el('div', { class: 'field' }, [
      el('label', { class: 'label', text: 'Asset', for: 'steward-asset' }),
      assetChooser,
    ]),
    el('h2', { class: 'zone-head', text: 'Post a price' }),
    newPrice.row,
    el('div', { class: 'field checkbox' }, [
      confirmLarge,
      el('label', { class: 'label', text: 'Confirm large move', for: 'confirm-large-move' }),
    ]),
    postButton,
    el('h2', { class: 'zone-head', text: 'Risk parameters' }),
    riskRow(ltv, 'ltv_bps'),
    riskRow(threshold, 'liquidation_threshold_bps'),
    riskRow(bonus, 'liquidation_bonus_bps'),
    riskRow(reserve, 'reserve_factor_bps'),
    saveRisk,
    ruler.element,
    el('h2', { class: 'zone-head', text: 'Onboard a member' }),
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Member name', for: 'member-name' }),
        memberName,
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Member email', for: 'member-email' }),
        memberEmail,
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Member role', for: 'member-role' }),
        memberRole,
      ]),
    ]),
    addMember,
    el('h2', { class: 'zone-head', text: 'Record an inbound transfer' }),
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Member', for: 'transfer-member' }),
        memberChooser,
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Transfer asset', for: 'transfer-asset' }),
        transferAsset,
      ]),
      transferAmount.row,
    ]),
    recordTransfer,
  ]);

  renderMemberChooser();
  void loadRisk();
  void loadRuler();

  return {
    element,
    update: () => {
      renderMemberChooser();
      if (!ruler.isDragging) void loadRuler().catch(() => undefined);
    },
    navigateAway: () => undefined,
    onPost: () => ruler.recentre(),
    navigate,
  };
}
