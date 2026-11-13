/** The bank transfer file: ISO 20022 pain.001.001.03. */

import { formatMonth, isoSeconds, type BrusselsDate, type BrusselsMonth } from '../../shared/brussels.js';
import { formatAmountPlain } from '../../shared/money.js';

const NAMESPACE = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03';

export interface CreditTransfer {
  payoutId: string;
  creditorName: string;
  iban: string;
  amountCents: number;
}

export interface BankFile {
  month: BrusselsMonth;
  msgId: string;
  createdAt: number;
  executionDate: BrusselsDate;
  debtorName: string;
  debtorIban: string;
  transfers: readonly CreditTransfer[];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function controlSumCents(transfers: readonly CreditTransfer[]): number {
  return transfers.reduce((sum, transfer) => sum + transfer.amountCents, 0);
}

export function renderBankFile(file: BankFile): string {
  const count = file.transfers.length;
  const sum = formatAmountPlain(controlSumCents(file.transfers));
  const transfers = file.transfers
    .map(
      (transfer) => `      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${escapeXml(transfer.payoutId)}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="EUR">${formatAmountPlain(transfer.amountCents)}</InstdAmt>
        </Amt>
        <Cdtr>
          <Nm>${escapeXml(transfer.creditorName)}</Nm>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <IBAN>${escapeXml(transfer.iban)}</IBAN>
          </Id>
        </CdtrAcct>
        <RmtInf>
          <Ustrd>Consignment payout ${escapeXml(formatMonth(file.month))}</Ustrd>
        </RmtInf>
      </CdtTrfTxInf>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${NAMESPACE}">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${escapeXml(file.msgId)}</MsgId>
      <CreDtTm>${isoSeconds(file.createdAt)}</CreDtTm>
      <NbOfTxs>${count}</NbOfTxs>
      <CtrlSum>${sum}</CtrlSum>
      <InitgPty>
        <Nm>${escapeXml(file.debtorName)}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${escapeXml(file.msgId)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${count}</NbOfTxs>
      <CtrlSum>${sum}</CtrlSum>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
      </PmtTpInf>
      <ReqdExctnDt>${file.executionDate}</ReqdExctnDt>
      <Dbtr>
        <Nm>${escapeXml(file.debtorName)}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>${escapeXml(file.debtorIban)}</IBAN>
        </Id>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
          <Othr>
            <Id>NOTPROVIDED</Id>
          </Othr>
        </FinInstnId>
      </DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${transfers}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}
