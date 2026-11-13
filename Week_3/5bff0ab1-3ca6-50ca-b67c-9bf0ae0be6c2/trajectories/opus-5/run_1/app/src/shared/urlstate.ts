import {
  CHAPTERS,
  DEFAULT_FINISH,
  DEFAULT_HUB,
  DEFAULT_MODEL,
  chapterForProgress,
  isChapterId,
  isFinishId,
  isHubId,
  isModelId,
  partsOf,
  type ChapterId,
  type FinishId,
  type HubId,
  type ModelId,
} from './catalogue.js';

export interface ShowroomState {
  hub: HubId;
  model: ModelId;
  finish: FinishId;
  chapter: ChapterId;
  part: string | null;
  progress: number;
  corrected: boolean;
}

/** The URL rules for the long page, applied the same way on server and client. */
export function readShowroomState(params: URLSearchParams, atHero: boolean): ShowroomState {
  let corrected = false;
  const rawHub = params.get('hub');
  const rawModel = params.get('model');
  const rawFinish = params.get('finish');
  const hub = isHubId(rawHub) ? rawHub : DEFAULT_HUB;
  const model = isModelId(rawModel) ? rawModel : DEFAULT_MODEL;
  const finish = isFinishId(rawFinish) ? rawFinish : DEFAULT_FINISH;
  if ((rawHub !== null && !isHubId(rawHub)) || (rawModel !== null && !isModelId(rawModel))) {
    corrected = true;
  }
  if (rawFinish !== null && !isFinishId(rawFinish)) corrected = true;

  const rawAt = params.get('at');
  const parsed = rawAt === null ? Number.NaN : Number(rawAt);
  const hasAt = rawAt !== null && Number.isFinite(parsed) && parsed >= 0 && parsed <= 1;
  if (rawAt !== null && !hasAt) corrected = true;

  const rawChapter = params.get('ch');
  const chapterKnown = isChapterId(rawChapter);
  if (rawChapter !== null && !chapterKnown) corrected = true;

  let chapter: ChapterId;
  let progress: number;
  if (hasAt) {
    progress = parsed;
    chapter = chapterForProgress(progress).id;
    if (chapterKnown && rawChapter !== chapter) corrected = true;
  } else if (chapterKnown) {
    chapter = rawChapter;
    progress = CHAPTERS.find((c) => c.id === chapter)?.jump ?? 0;
  } else {
    chapter = (CHAPTERS[0] as { id: ChapterId }).id;
    progress = 0;
  }
  if (atHero && !hasAt && !chapterKnown) progress = 0;

  const rawPart = params.get('part');
  const part = rawPart !== null && partsOf(chapter).some((p) => p.id === rawPart) ? rawPart : null;
  if (rawPart !== null && part === null) corrected = true;

  return { hub, model, finish, chapter, part, progress, corrected };
}

export function showroomUrl(state: ShowroomState): string {
  const params = new URLSearchParams();
  params.set('model', state.model);
  params.set('hub', state.hub);
  params.set('finish', state.finish);
  params.set('ch', state.chapter);
  if (state.part) params.set('part', state.part);
  params.set('at', state.progress.toFixed(3));
  return `/showroom?${params.toString()}`;
}

export function isSlotParam(value: string | null): value is string {
  return value !== null && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
