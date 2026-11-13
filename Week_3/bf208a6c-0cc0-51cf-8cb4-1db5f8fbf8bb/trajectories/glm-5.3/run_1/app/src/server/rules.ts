import type { Config } from './config.js';

export interface Limits {
  titleMax: number;
  bodyMax: number;
  commentMax: number;
  displayNameMax: number;
  boardTitleMax: number;
  sectionTitleMax: number;
  passwordMin: number;
  passwordMax: number;
  boardPasswordMin: number;
  boardPasswordMax: number;
  sectionsMin: number;
  sectionsMax: number;
}

export const limits: Limits = {
  titleMax: 80,
  bodyMax: 2000,
  commentMax: 500,
  displayNameMax: 40,
  boardTitleMax: 80,
  sectionTitleMax: 40,
  passwordMin: 8,
  passwordMax: 72,
  boardPasswordMin: 8,
  boardPasswordMax: 64,
  sectionsMin: 1,
  sectionsMax: 12,
};

export function csvFileName(boardTitle: string): string {
  const slug = boardTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'board';
}

function neutralise(field: string): string {
  if (/^[=+\-@\t\r]/.test(field)) return `'${field}`;
  return field;
}

export function csvField(field: string): string {
  const value = neutralise(field);
  return `"${value.replace(/"/g, '""')}"`;
}

export const csvHeader = 'post_id,section,position,title,body,author,likes,score,comments,attachment,created_at';

export function csvTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function uploadLimitText(config: Config): string {
  return config.uploadMaxBytes.toLocaleString('en-US');
}
