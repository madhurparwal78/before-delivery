import { Router } from 'express';
import type { AppCtx } from './ctx';
import { ApiError } from './api-errors';
import { requireAuth } from './sessions';
import { respond } from './routes-session';
import { newHex } from './util';
import type { Kit } from '../shared/types';

/** Brand kits. Applying one is an op; editing a kit never changes a project. */
export function kitRoutes(ctx: AppCtx): Router {
  const r = Router();

  r.get('/kits', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) {
        const editor = await ctx.db.query(`SELECT 1 FROM members WHERE person_id = $1 AND role = 'editor'`, [person.id]);
        if ((editor.rowCount ?? 0) === 0) throw new ApiError('forbidden');
      }
      const rows = await ctx.db.query('SELECT id, name, text_colour, box_colour, font_weight FROM kits WHERE workspace_id = $1 ORDER BY created_at', [ctx.workspaceId]);
      res.json({ items: rows.rows });
    })().catch((err) => respond(res, err));
  });

  r.post('/kits', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      const kit = validateKit(body);
      const id = `kit-${newHex(6)}`;
      await ctx.db.query(
        'INSERT INTO kits (id, workspace_id, name, text_colour, box_colour, font_weight) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, ctx.workspaceId, kit.name, kit.text_colour, kit.box_colour, kit.font_weight],
      );
      res.status(201).json({ id, name: kit.name, text_colour: kit.text_colour, box_colour: kit.box_colour, font_weight: kit.font_weight });
    })().catch((err) => respond(res, err));
  });

  r.put('/kits/:id', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      const kit = validateKit(body);
      await ctx.db.query(
        'UPDATE kits SET name = $2, text_colour = $3, box_colour = $4, font_weight = $5 WHERE id = $1',
        [req.params.id!, kit.name, kit.text_colour, kit.box_colour, kit.font_weight],
      );
      res.json({ id: req.params.id!, name: kit.name, text_colour: kit.text_colour, box_colour: kit.box_colour, font_weight: kit.font_weight });
    })().catch((err) => respond(res, err));
  });

  return r;
}

interface KitInput {
  name: string;
  text_colour: string;
  box_colour: string;
  font_weight: number;
}

function validateKit(body: Record<string, unknown>): KitInput {
  const name = String(body.name ?? '').trim();
  const textColour = String(body.text_colour ?? '').trim();
  const boxColour = String(body.box_colour ?? '').trim();
  const weight = Number(body.font_weight ?? 0);
  const errors: Record<string, { key: 'other' }> = {};
  if (name === '') errors.name = { key: 'other' };
  if (!/^[0-9a-fA-F]{6}$/.test(textColour)) errors.text_colour = { key: 'other' };
  if (!/^[0-9a-fA-F]{6}$/.test(boxColour)) errors.box_colour = { key: 'other' };
  if (weight !== 400 && weight !== 600) errors.font_weight = { key: 'other' };
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors as never);
  return { name, text_colour: textColour.toLowerCase(), box_colour: boxColour.toLowerCase(), font_weight: weight };
}
