export type RenderResolution = '720p' | '1080p';

/** `duration_s` x 1 credit at 720p, or x 2 credits at 1080p, for either format. */
export function renderCostCredits(durationSeconds: number, resolution: RenderResolution): number {
  return durationSeconds * (resolution === '1080p' ? 2 : 1);
}
