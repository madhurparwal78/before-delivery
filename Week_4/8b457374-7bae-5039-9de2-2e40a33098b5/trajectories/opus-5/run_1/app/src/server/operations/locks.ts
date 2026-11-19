const chains = new Map<string, Promise<void>>();

/**
 * Serialises every pledge check and change on one campaign, so two simultaneous
 * claims on a last copy, or two simultaneous reductions, cannot interleave.
 */
export function withCampaignLock<T>(campaignId: string, work: () => Promise<T>): Promise<T> {
  const queue = chains.get(campaignId) ?? Promise.resolve();
  const result = queue.then(work, work);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  chains.set(campaignId, settled);
  void settled.then(() => {
    if (chains.get(campaignId) === settled) chains.delete(campaignId);
  });
  return result;
}
