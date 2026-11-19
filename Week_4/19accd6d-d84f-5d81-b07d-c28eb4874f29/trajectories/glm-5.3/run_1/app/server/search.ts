import { searchClient, searchUp } from './services.js';
import { config } from './config.js';
import { dependencyDown } from './errors.js';
import type { VisibleRecipe } from './recipes.js';
import type { Step } from '../shared/catalogue.js';

export interface SearchDoc {
  id: string;
  name: string;
  note: string;
  tags: string[];
  operations: string[];
  argumentValues: string[];
  ownerUserId: string | null;
  teamId: string | null;
  latestVersion: number;
  updatedAt: number;
}

export function docFor(recipe: VisibleRecipe, name: string, note: string, tags: string[], steps: Step[]): SearchDoc {
  const args = new Set<string>();
  const ops: string[] = [];
  for (const s of steps) {
    if (!s.disabled) ops.push(s.op);
    for (const v of Object.values(s.args)) {
      if (typeof v === 'string' || typeof v === 'number') args.add(String(v));
    }
  }
  return {
    id: recipe.id,
    name,
    note,
    tags,
    operations: ops,
    argumentValues: [...args],
    ownerUserId: recipe.owner_type === 'user' ? recipe.owner_user_id : null,
    teamId: recipe.owner_type === 'team' ? recipe.owner_team_id : null,
    latestVersion: recipe.current_version,
    updatedAt: Math.floor(recipe.updated_at.getTime() / 1000),
  };
}

export async function applyIndexSettings(): Promise<void> {
  const client = searchClient();
  const index = client.index(config().meili.index);
  await client.createIndex(config().meili.index, { primaryKey: 'id' }).catch(() => undefined);
  await index.updateSettings({
    searchableAttributes: ['name', 'tags', 'operations', 'argumentValues', 'note'],
    filterableAttributes: ['ownerUserId', 'teamId'],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'exactness', 'updatedAt:desc'],
  });
}

export async function indexRecipe(doc: SearchDoc): Promise<void> {
  const index = searchClient().index(config().meili.index);
  await index.addDocuments([doc], { primaryKey: 'id' });
}

export async function deleteRecipeFromIndex(recipeId: string): Promise<void> {
  const index = searchClient().index(config().meili.index);
  await index.deleteDocument(recipeId);
}

/** Runs a query filtered to the caller's own recipes and teams; 503 when search is down (DP-38). */
export async function searchRecipes(userId: string, query: string, recipes: VisibleRecipe[]): Promise<{ ids: string[]; total: number }> {
  if (!(await searchUp())) throw dependencyDown('search_unavailable', 'Search is unavailable. Showing recent recipes.');
  const teamIds = recipes.filter((r) => r.owner_type === 'team' && r.owner_team_id).map((r) => r.owner_team_id!);
  const filter = [`ownerUserId = ${JSON.stringify(userId)}`];
  if (teamIds.length > 0) filter.push(`teamId IN [${teamIds.map((t) => JSON.stringify(t)).join(', ')}]`);
  const index = searchClient().index(config().meili.index);
  const result = await index.search(query, {
    filter: filter.join(' OR '),
    attributesToRetrieve: ['id'],
    limit: 100,
  });
  const ids = (result.hits as { id: string }[]).map((h) => h.id);
  return { ids, total: result.estimatedTotalHits ?? ids.length };
}
