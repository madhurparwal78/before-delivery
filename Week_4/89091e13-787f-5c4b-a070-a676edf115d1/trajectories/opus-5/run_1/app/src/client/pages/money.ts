import {
  ApiFailure,
  ErrorBody,
  get,
  LedgerResponse,
  Member,
  Proposal,
  StakingMe,
  Validator,
} from '../api.js';
import { el, field, table } from '../dom.js';
import { observeEntrances } from '../motion.js';
import { PageContext } from '../router.js';
import { announce, consoleFooter } from '../shell.js';
import { blockAnnouncement, rejectionCopy } from '../../shared/live.js';
import { parseRate } from '../../shared/fees.js';
import { formatPercent } from '../../shared/format.js';
import { VOTE_OPTION_LABELS, VoteOption } from '../../shared/governance.js';
import {
  buildForm,
  dateTime,
  fern,
  roleRefusal,
  selectBox,
  submitJson,
  textArea,
  textbox,
  time,
  TRANSACTION_SENT,
} from './common.js';

function percentOfRate(rate: string): string {
  const fraction = parseRate(rate);
  return formatPercent(fraction.numerator, fraction.denominator, 2);
}

export async function renderStake(context: PageContext): Promise<void> {
  const id = context.workspace.id;
  const [validators, me, fee] = await Promise.all([
    get<Validator[]>(`/api/w/${id}/validators`),
    get<StakingMe>(`/api/w/${id}/staking/me`),
    get<{ gas: number; feeUfern: number }>(`/api/w/${id}/staking/fee`),
  ]);
  const feeCopy = `Fee ${fern(fee.feeUfern)} FERN`;
  const stakeStatus = el('p', {
    class: 'status-area',
    attrs: { role: 'status', 'aria-label': 'Stake status', 'aria-live': 'polite' },
  });
  const options = validators.map((validator) => ({ value: validator.id, label: validator.name }));

  const delegateValidator = selectBox('delegate-validator', 'validator', 'Validator', options);
  const delegateAmount = textbox('delegate-amount', 'amount');
  const delegateForm = buildForm({
    name: 'Delegate',
    heading: 'Delegate',
    statusName: 'Stake status',
    statusRegion: stakeStatus,
    submitLabel: 'Delegate',
    role: context.workspace.role,
    scope: 'transaction',
    fields: [
      field('delegate-validator', 'Validator', delegateValidator),
      field('delegate-amount', 'Amount (FERN)', delegateAmount),
      el('p', { class: 'field-note', text: feeCopy }),
    ],
    onSubmit: async () => {
      await submitJson(`/api/w/${id}/staking/delegate`, {
        validator: delegateValidator.value,
        amount: delegateAmount.value.trim(),
      });
      context.refresh();
      return TRANSACTION_SENT;
    },
  });

  const undelegateValidator = selectBox('undelegate-validator', 'validator', 'Validator', options);
  const undelegateAmount = textbox('undelegate-amount', 'amount');
  const undelegateForm = buildForm({
    name: 'Undelegate',
    heading: 'Undelegate',
    statusName: 'Stake status',
    statusRegion: stakeStatus,
    submitLabel: 'Undelegate',
    role: context.workspace.role,
    scope: 'transaction',
    fields: [
      field('undelegate-validator', 'Validator', undelegateValidator),
      field('undelegate-amount', 'Amount (FERN)', undelegateAmount),
      el('p', { class: 'field-note', text: feeCopy }),
    ],
    onSubmit: async () => {
      await submitJson(`/api/w/${id}/staking/undelegate`, {
        validator: undelegateValidator.value,
        amount: undelegateAmount.value.trim(),
      });
      context.refresh();
      return TRANSACTION_SENT;
    },
  });

  const fromValidator = selectBox('redelegate-from', 'from', 'From validator', options);
  const toValidator = selectBox('redelegate-to', 'to', 'To validator', options);
  const redelegateAmount = textbox('redelegate-amount', 'amount');
  const redelegateForm = buildForm({
    name: 'Redelegate',
    heading: 'Redelegate',
    statusName: 'Stake status',
    statusRegion: stakeStatus,
    submitLabel: 'Redelegate',
    role: context.workspace.role,
    scope: 'transaction',
    fields: [
      field('redelegate-from', 'From validator', fromValidator),
      field('redelegate-to', 'To validator', toValidator),
      field('redelegate-amount', 'Amount (FERN)', redelegateAmount),
      el('p', { class: 'field-note', text: feeCopy }),
    ],
    onSubmit: async () => {
      await submitJson(`/api/w/${id}/staking/redelegate`, {
        from: fromValidator.value,
        to: toValidator.value,
        amount: redelegateAmount.value.trim(),
      });
      context.refresh();
      return TRANSACTION_SENT;
    },
  });

  const claimButton = el(
    'button',
    {
      class: 'pill pill-primary',
      attrs: { type: 'button' },
      on: {
        click: () => {
          claimButton.setAttribute('disabled', '');
          claimButton.setAttribute('aria-busy', 'true');
          stakeStatus.textContent = 'Working…';
          void submitJson(`/api/w/${id}/staking/claim`, {})
            .then(() => {
              stakeStatus.textContent = TRANSACTION_SENT;
              context.refresh();
            })
            .catch((error: unknown) => {
              stakeStatus.textContent =
                error instanceof ApiFailure
                  ? ((error.body as ErrorBody).error ?? 'That did not work.')
                  : 'That did not work.';
            })
            .finally(() => {
              claimButton.removeAttribute('disabled');
              claimButton.removeAttribute('aria-busy');
            });
        },
      },
    },
    'Claim rewards',
  );
  const claimPanel = el('div', { class: 'panel' }, claimButton);
  const refusal = roleRefusal(context.workspace.role, 'transaction');
  if (refusal) {
    claimPanel.appendChild(el('p', { class: 'field-note', attrs: { id: 'claim-role' }, text: refusal }));
    claimButton.setAttribute('disabled', '');
    claimButton.setAttribute('aria-describedby', 'claim-role');
  }

  context.main.append(
    el('div', { class: 'container stack' }, [
      el('h1', { class: 'page-title', text: 'Stake' }),
      el('p', { text: `Balance ${fern(me.balanceUfern)} FERN` }),
      el('p', { text: `Available ${fern(me.availableUfern)} FERN` }),
      table(
        'Validators',
        ['Name', 'Stake', 'Commission', 'Share of bonded'],
        validators.map((validator) => [
          validator.name,
          `${fern(validator.stakeUfern)} FERN`,
          `${percentOfRate(validator.commission)}%`,
          `${validator.shareOfBonded}%`,
        ]),
      ),
      delegateForm.form,
      undelegateForm.form,
      redelegateForm.form,
      claimPanel,
      stakeStatus,
      table(
        'Your delegations',
        ['Validator', 'Amount', 'Pending rewards'],
        me.delegations.map((delegation) => [
          delegation.validatorName,
          `${fern(delegation.amountUfern)} FERN`,
          `${fern(delegation.pendingRewardsUfern)} FERN`,
        ]),
        'No delegations yet.',
      ),
      table(
        'Unbondings',
        ['Validator', 'Amount', 'Completes', 'Status'],
        me.unbondings.map((unbonding) => [
          unbonding.validatorName,
          `${fern(unbonding.amountUfern)} FERN`,
          dateTime(unbonding.completesAt),
          unbonding.status === 'released'
            ? 'Released'
            : `Unbonding until ${time(unbonding.completesAt)}`,
        ]),
        'No unbondings.',
      ),
    ]),
    consoleFooter([]),
  );
  observeEntrances(context.main);

  context.subscribe((event) => {
    if (event.kind === 'block') {
      announce(
        context.networkUpdates,
        blockAnnouncement(event.height, event.blobs, event.squareWidth),
      );
      context.refresh();
    }
    if (event.kind === 'rejected') {
      announce(context.networkUpdates, rejectionCopy(event));
      context.refresh();
    }
    if (event.kind === 'transactions') context.refresh();
  });
}

export async function renderVote(context: PageContext): Promise<void> {
  const id = context.workspace.id;
  const proposals = await get<Proposal[]>(`/api/w/${id}/proposals`);
  const title = textbox('proposal-title', 'title');
  const description = textArea('proposal-description', 'description');
  const deposit = textbox('proposal-deposit', 'amount', { value: '0' });
  const form = buildForm({
    name: 'New proposal',
    heading: 'New proposal',
    statusName: 'Vote status',
    submitLabel: 'Submit proposal',
    role: context.workspace.role,
    scope: 'transaction',
    fields: [
      field('proposal-title', 'Title', title),
      field('proposal-description', 'Description', description),
      field('proposal-deposit', 'Initial deposit (FERN)', deposit),
    ],
    onSubmit: async () => {
      await submitJson(`/api/w/${id}/proposals`, {
        title: title.value.trim(),
        description: description.value,
        initialDeposit: deposit.value.trim(),
      });
      context.refresh();
      return TRANSACTION_SENT;
    },
  });

  context.main.append(
    el('div', { class: 'container stack' }, [
      el('h1', { class: 'page-title', text: 'Vote' }),
      table(
        'Proposals',
        ['Number', 'Title', 'Status'],
        proposals.map((proposal) => [
          el('a', { attrs: { href: `/w/${id}/vote/${proposal.number}` } }, String(proposal.number)),
          proposal.title,
          proposal.statusText,
        ]),
        'No proposals yet.',
      ),
      form.form,
    ]),
    consoleFooter([]),
  );
  observeEntrances(context.main);
  context.subscribe((event) => {
    if (event.kind === 'block' || event.kind === 'transactions') context.refresh();
  });
}

export async function renderProposal(context: PageContext): Promise<void> {
  const id = context.workspace.id;
  const number = Number(context.params.number);
  const proposal = await get<Proposal>(`/api/w/${id}/proposals/${number}`);
  const voteStatus = el('p', {
    class: 'status-area',
    attrs: { role: 'status', 'aria-label': 'Vote status', 'aria-live': 'polite' },
  });
  const final = !['deposit', 'voting'].includes(proposal.status);

  const tally = el(
    'section',
    { class: 'panel', attrs: { 'aria-label': 'Tally' } },
    [
      el('h2', { text: 'Tally' }),
      el('p', {
        text: `Votes ${fern(proposal.tally.votesUfern)} of ${fern(
          proposal.tally.totalBondedUfern,
        )} FERN (${proposal.tally.turnout}%)`,
      }),
      el('p', { text: `Yes ${fern(proposal.tally.yesUfern)} FERN` }),
      el('p', { text: `No ${fern(proposal.tally.noUfern)} FERN` }),
      el('p', {
        text: `No with veto ${fern(proposal.tally.noWithVetoUfern)} FERN (${proposal.tally.vetoShare}%)`,
      }),
      el('p', { text: `Abstain ${fern(proposal.tally.abstainUfern)} FERN` }),
      el('p', { text: `Yes share ${proposal.tally.yesShare}%` }),
      el('p', {
        text: final
          ? `Result ${proposal.tally.result}`
          : `Projected result ${proposal.tally.result}`,
      }),
    ],
  );

  const voteGroup = el('div', {
    class: 'radio-row',
    attrs: { role: 'radiogroup', 'aria-label': 'Your vote' },
  });
  for (const option of ['yes', 'no', 'no_with_veto', 'abstain'] as VoteOption[]) {
    voteGroup.appendChild(
      el('label', {}, [
        el('input', {
          attrs: {
            type: 'radio',
            name: 'your-vote',
            value: option,
            checked: proposal.myVote === option,
          },
        }),
        VOTE_OPTION_LABELS[option],
      ]),
    );
  }
  const castButton = el(
    'button',
    {
      class: 'pill pill-primary',
      attrs: { type: 'button' },
      on: {
        click: () => {
          const chosen = voteGroup.querySelector<HTMLInputElement>('input:checked');
          castButton.setAttribute('disabled', '');
          castButton.setAttribute('aria-busy', 'true');
          voteStatus.textContent = 'Working…';
          void submitJson(`/api/w/${id}/proposals/${number}/votes`, {
            option: chosen?.value ?? '',
          })
            .then(() => {
              voteStatus.textContent = TRANSACTION_SENT;
            })
            .catch((error: unknown) => {
              const body = error instanceof ApiFailure ? (error.body as ErrorBody) : {};
              voteStatus.textContent =
                body.error ?? Object.values(body.errors ?? {})[0] ?? 'That did not work.';
            })
            .finally(() => {
              castButton.removeAttribute('disabled');
              castButton.removeAttribute('aria-busy');
            });
        },
      },
    },
    'Cast vote',
  );
  const votePanel = el('div', { class: 'panel stack' }, [
    el('h2', { text: 'Your vote' }),
    voteGroup,
    castButton,
  ]);
  const refusal = roleRefusal(context.workspace.role, 'transaction');
  if (refusal) {
    votePanel.appendChild(el('p', { class: 'field-note', attrs: { id: 'vote-role' }, text: refusal }));
    castButton.setAttribute('disabled', '');
    castButton.setAttribute('aria-describedby', 'vote-role');
    for (const input of voteGroup.querySelectorAll<HTMLElement>('input')) {
      input.setAttribute('disabled', '');
      input.setAttribute('aria-describedby', 'vote-role');
    }
  }

  const depositAmount = textbox('deposit-amount', 'amount');
  const depositForm = buildForm({
    name: 'Deposit',
    heading: 'Deposit',
    statusName: 'Vote status',
    statusRegion: voteStatus,
    submitLabel: 'Deposit',
    role: context.workspace.role,
    scope: 'transaction',
    fields: [field('deposit-amount', 'Deposit (FERN)', depositAmount)],
    onSubmit: async () => {
      await submitJson(`/api/w/${id}/proposals/${number}/deposits`, {
        amount: depositAmount.value.trim(),
      });
      context.refresh();
      return TRANSACTION_SENT;
    },
  });

  context.main.append(
    el('div', { class: 'container stack' }, [
      el('h1', { class: 'page-title', text: `Proposal ${number}: ${proposal.title}` }),
      el('p', { text: proposal.statusText }),
      el('p', {
        class: 'muted',
        text: `Deposit period ends ${dateTime(proposal.depositEndsAt)}${
          proposal.votingEndsAt ? ` · Voting period ends ${dateTime(proposal.votingEndsAt)}` : ''
        }`,
      }),
      el('p', {
        class: 'muted',
        text: `Deposit ${fern(proposal.depositUfern)} of ${fern(proposal.minDepositUfern)} FERN`,
      }),
      el('p', { text: proposal.description }),
      tally,
      votePanel,
      proposal.status === 'deposit' ? depositForm.form : null,
      voteStatus,
    ]),
    consoleFooter([]),
  );
  observeEntrances(context.main);
  context.subscribe((event) => {
    if (event.kind === 'block') {
      announce(
        context.networkUpdates,
        blockAnnouncement(event.height, event.blobs, event.squareWidth),
      );
      context.refresh();
    }
    if (event.kind === 'transactions') context.refresh();
  });
}

export async function renderLedger(context: PageContext): Promise<void> {
  const id = context.workspace.id;
  const account = `member:${context.identity.user.id}`;
  const ledger = await get<LedgerResponse>(
    `/api/w/${id}/ledger?account=${encodeURIComponent(account)}`,
  );
  let running = ledger.balanceUfern;
  const rows = ledger.entries.map((entry) => {
    const after = running;
    running -= entry.amountUfern;
    return [
      time(entry.at),
      entry.height === null ? '—' : String(entry.height),
      entry.label,
      `${entry.amountUfern < 0 ? '-' : ''}${fern(Math.abs(entry.amountUfern))} FERN`,
      `${fern(after)} FERN`,
    ];
  });
  context.main.append(
    el('div', { class: 'container stack' }, [
      el('h1', { class: 'page-title', text: 'Ledger' }),
      el('p', { text: `Balance ${fern(ledger.balanceUfern)} FERN` }),
      table('Ledger', ['Time', 'Height', 'Entry', 'Amount', 'Balance after'], rows, 'No entries yet.'),
    ]),
    consoleFooter([]),
  );
  observeEntrances(context.main);
  context.subscribe((event) => {
    if (event.kind === 'block' || event.kind === 'transactions') context.refresh();
  });
}

export async function renderMembers(context: PageContext): Promise<void> {
  const id = context.workspace.id;
  const members = await get<Member[]>(`/api/w/${id}/members`);
  const email = textbox('invite-email', 'email', { type: 'email' });
  const roleGroup = el('div', {
    class: 'radio-row',
    attrs: { role: 'radiogroup', 'aria-label': 'Role' },
  });
  for (const option of [
    { value: 'developer', label: 'Developer' },
    { value: 'viewer', label: 'Viewer' },
  ]) {
    roleGroup.appendChild(
      el('label', {}, [
        el('input', {
          attrs: {
            type: 'radio',
            name: 'invite-role',
            value: option.value,
            checked: option.value === 'developer',
            'data-field': 'role',
          },
        }),
        option.label,
      ]),
    );
  }
  const form = buildForm({
    name: 'Invite member',
    heading: 'Invite member',
    statusName: 'Invite member status',
    submitLabel: 'Send invite',
    role: context.workspace.role,
    scope: 'members',
    fields: [field('invite-email', 'Email', email), roleGroup],
    onSubmit: async (host) => {
      const chosen = host.querySelector<HTMLInputElement>('input[name="invite-role"]:checked');
      const address = email.value.trim();
      await submitJson(`/api/w/${id}/invites`, { email: address, role: chosen?.value ?? '' });
      return `Invite queued for ${address}.`;
    },
  });

  context.main.append(
    el('div', { class: 'container stack' }, [
      el('h1', { class: 'page-title', text: 'Members' }),
      table(
        'Members',
        ['Name', 'Email', 'Role'],
        members.map((member) => [
          member.name,
          member.email,
          member.role.charAt(0).toUpperCase() + member.role.slice(1),
        ]),
      ),
      form.form,
    ]),
    consoleFooter([]),
  );
  observeEntrances(context.main);
}
