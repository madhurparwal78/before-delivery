import { one } from '../db';

export interface GameRow {
  id: string;
  slug: string;
  name: string;
  launcher_origin: string;
  widget_secret: string;
  server_secret: string;
  previous_server_secret: string | null;
  previous_valid_until: Date | null;
}

const COLUMNS = `id, slug, name, launcher_origin, widget_secret, server_secret,
  previous_server_secret, previous_valid_until`;

export async function findGameBySlug(slug: string): Promise<GameRow | null> {
  return one<GameRow>(`SELECT ${COLUMNS} FROM games WHERE slug = $1`, [slug]);
}

export async function findGameById(id: string): Promise<GameRow | null> {
  return one<GameRow>(`SELECT ${COLUMNS} FROM games WHERE id = $1`, [id]);
}
