import type { SettlementDto, SettlementLineDto } from '../../shared/types.js';
import type { CampaignRow } from '../data/campaigns.js';
import type { Db } from '../data/db.js';
import { findSettlement } from '../data/documents.js';
import { listPledgesByCampaign, type PledgeRow } from '../data/pledges.js';
import { feesFor } from '../domain/fees.js';

function lineFor(pledge: PledgeRow): SettlementLineDto {
  const fees =
    pledge.platform_fee === null || pledge.processing_fee === null || pledge.to_creator === null
      ? feesFor(pledge.amount)
      : {
          platform_fee: pledge.platform_fee,
          processing_fee: pledge.processing_fee,
          to_creator: pledge.to_creator,
        };
  return {
    pledge_id: pledge.id,
    amount: pledge.amount,
    platform_fee: fees.platform_fee,
    processing_fee: fees.processing_fee,
    to_creator: fees.to_creator,
  };
}

/** The settlement sums captured pledges only, line by line from each statement. */
export async function computeSettlement(db: Db, campaign: CampaignRow): Promise<SettlementDto> {
  const pledges = await listPledgesByCampaign(db, campaign.id);
  const captured = pledges.filter((pledge) => pledge.state === 'captured');
  const lines = captured.map(lineFor);
  const sum = (pick: (line: SettlementLineDto) => number): number =>
    lines.reduce((running, line) => running + pick(line), 0);
  const document = await findSettlement(db, campaign.id);
  return {
    campaign_id: campaign.id,
    status: campaign.status,
    captured_count: captured.length,
    dropped_count: pledges.filter((pledge) => pledge.state === 'dropped').length,
    errored_count: pledges.filter((pledge) => pledge.state === 'errored').length,
    gross: sum((line) => line.amount),
    platform_fee: sum((line) => line.platform_fee),
    processing_fee: sum((line) => line.processing_fee),
    net: sum((line) => line.to_creator),
    lines,
    pdf: document === null ? 'none' : document.status,
  };
}
