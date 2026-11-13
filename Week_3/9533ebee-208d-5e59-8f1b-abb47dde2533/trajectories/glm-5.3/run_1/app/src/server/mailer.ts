import { getConfig } from './config.js';
import { deskAmount, deskHealthFactor, deskPrice } from '../shared/deskFormat.js';
import { ASSETS } from '../shared/assets.js';
import type { AssetCode } from '../shared/types.js';

export interface MarginNotice {
  position_id: string;
  borrower_email: string;
  health_factor: bigint | null;
  debt: bigint;
  debt_asset: AssetCode;
  collateral: bigint;
  collateral_asset: AssetCode;
  liquidation_price: bigint | null;
}

export function marginSubject(notice: MarginNotice): string {
  return `Margin notice: ${notice.position_id} at health factor ${deskHealthFactor(notice.health_factor)}`;
}

export function marginBody(notice: MarginNotice): string {
  const debtDecimals = ASSETS[notice.debt_asset].decimals;
  const collateralDecimals = ASSETS[notice.collateral_asset].decimals;
  const liqPrice = notice.liquidation_price === null ? 'No debt' : deskPrice(notice.liquidation_price);
  return [
    `Position ${notice.position_id} has fallen to health factor ${deskHealthFactor(notice.health_factor)}.`,
    `Debt: ${deskAmount(notice.debt, debtDecimals, false)} ${notice.debt_asset}.`,
    `Collateral: ${deskAmount(notice.collateral, collateralDecimals, false)} ${notice.collateral_asset}.`,
    `Liquidation price: ${liqPrice}.`,
    'Repay or add collateral to stay above health factor 1.',
    '',
  ].join('\n');
}

export interface LiquidationNotice {
  position_id: string;
  borrower_email: string;
  round: bigint;
  repaid: bigint;
  seized: bigint;
  bonus_amount: bigint;
  health_factor_after: bigint | null;
  settlement_id: string;
  debt_asset: AssetCode;
  collateral_asset: AssetCode;
}

export function liquidationSubject(notice: LiquidationNotice): string {
  return `Liquidation notice: ${notice.position_id} fill ${notice.round.toString()}`;
}

export function liquidationBody(notice: LiquidationNotice): string {
  const debtDecimals = ASSETS[notice.debt_asset].decimals;
  const collateralDecimals = ASSETS[notice.collateral_asset].decimals;
  return [
    `Your position ${notice.position_id} was liquidated in fill ${notice.round.toString()}.`,
    `Repaid: ${deskAmount(notice.repaid, debtDecimals, false)} ${notice.debt_asset}.`,
    `Seized collateral: ${deskAmount(notice.seized, collateralDecimals, false)} ${notice.collateral_asset}.`,
    `Liquidation bonus: ${deskAmount(notice.bonus_amount, collateralDecimals, false)} ${notice.collateral_asset}.`,
    `Health factor after: ${deskHealthFactor(notice.health_factor_after)}.`,
    `Settlement: ${notice.settlement_id}`,
    '',
  ].join('\n');
}

/** Send one notice over SMTP. Throws when the mail server is unreachable. */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const cfg = getConfig();
  const message = buildMime(to, subject, body, cfg.mailFrom);
  const { connect } = await import('node:net');
  await new Promise<void>((resolve, reject): void => {
    const socket = connect(cfg.smtpPort, cfg.smtpHost);
    socket.setTimeout(5_000);
    let step = 0;
    let buffer = '';
    const steps: Array<{ expect: RegExp; send: string }> = [
      { expect: /^220/, send: `EHLO quillmoor.local\r\n` },
      { expect: /^250/, send: `MAIL FROM:<${extractAddress(cfg.mailFrom)}>\r\n` },
      { expect: /^250/, send: `RCPT TO:<${to}>\r\n` },
      { expect: /^250/, send: `DATA\r\n` },
      { expect: /^354/, send: message },
      { expect: /^250/, send: `QUIT\r\n` },
    ];
    socket.on('data', (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      if (!/\r\n$/.test(buffer)) return;
      const current = steps[step];
      if (current === undefined) return;
      if (current.expect.test(buffer.trim())) {
        buffer = '';
        step += 1;
        socket.write(current.send);
        if (step >= steps.length) {
          socket.end();
          resolve();
        }
      } else if (buffer.trim().startsWith('5') || buffer.trim().startsWith('4')) {
        socket.destroy();
        reject(new Error(`mail refused: ${buffer.trim()}`));
      }
    });
    socket.on('timeout', (): void => {
      socket.destroy();
      reject(new Error('mail timeout'));
    });
    socket.on('error', (err: Error): void => {
      reject(err);
    });
  });
}

function extractAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match !== null ? match[1] : from;
}

function buildMime(to: string, subject: string, body: string, from: string): string {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
  ].join('\r\n');
  return headers + '\r\n' + body.replace(/\r?\n/g, '\r\n') + '\r\n.\r\n';
}
