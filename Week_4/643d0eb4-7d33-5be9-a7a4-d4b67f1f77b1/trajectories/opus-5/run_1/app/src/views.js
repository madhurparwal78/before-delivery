'use strict';
const { refusal } = require('./core');

const OPERATORS = ['equals', 'not equals', 'contains', 'greater than', 'less than', 'is empty'];

const ORDERED_TYPES = ['integer', 'decimal', 'date', 'text', 'choice'];

/** Which operators one column type supports. */
function operatorsFor(type) {
  const out = ['equals', 'not equals'];
  if (type === 'text') out.push('contains');
  if (ORDERED_TYPES.includes(type)) out.push('greater than', 'less than');
  out.push('is empty');
  return out;
}

function operatorSupported(type, operator) {
  return operatorsFor(type).includes(operator);
}

function numericType(type) {
  return type === 'integer' || type === 'decimal';
}

/** The SQL sort key for one column, so the whole table is ordered before a page is cut. */
function sortKeySql(col, placeholder) {
  if (numericType(col.type)) return `((values->>${placeholder})::numeric)`;
  if (col.type === 'flag') return `((values->>${placeholder})::boolean)`;
  if (col.type === 'date') return `(values->>${placeholder})`;
  return `lower(values->>${placeholder})`;
}

/**
 * Build the WHERE fragments and the ORDER BY for one view over one table.
 * Params are pushed onto `params`, which already holds the table slug at $1.
 */
function buildRowQuery(cols, filters, sorts, params) {
  const byCaption = new Map(cols.map((c) => [c.caption, c]));
  const where = [];

  for (const f of filters || []) {
    const col = byCaption.get(f.column);
    if (!col) throw refusal(422, `${f.column} is not a column of this table.`, 'filters');
    if (!operatorSupported(col.type, f.operator)) {
      throw refusal(
        422,
        `${f.operator} is not offered for a ${col.type} column.`,
        'filters'
      );
    }
    params.push(col.caption);
    const c = `$${params.length}`;
    const isEmpty = `(jsonb_typeof(values->${c}) IS NULL OR jsonb_typeof(values->${c}) = 'null')`;

    if (f.operator === 'is empty') {
      where.push(isEmpty);
      continue;
    }

    if (f.operator === 'equals' || f.operator === 'not equals') {
      let test;
      if (numericType(col.type)) {
        params.push(String(Number(f.value)));
        test = `(NOT ${isEmpty} AND (values->>${c})::numeric = $${params.length}::numeric)`;
      } else if (col.type === 'flag') {
        params.push(f.value === true || f.value === 'true' ? 'true' : 'false');
        test = `(NOT ${isEmpty} AND (values->>${c})::boolean = $${params.length}::boolean)`;
      } else if (col.type === 'date') {
        params.push(String(f.value));
        test = `(NOT ${isEmpty} AND (values->>${c}) = $${params.length})`;
      } else {
        params.push(String(f.value).toLowerCase());
        test = `(NOT ${isEmpty} AND lower(values->>${c}) = $${params.length})`;
      }
      where.push(f.operator === 'equals' ? test : `(NOT ${test})`);
      continue;
    }

    if (f.operator === 'contains') {
      params.push(String(f.value).toLowerCase());
      where.push(
        `(NOT ${isEmpty} AND position($${params.length} in lower(values->>${c})) > 0)`
      );
      continue;
    }

    // greater than / less than; an empty value satisfies neither.
    const sign = f.operator === 'greater than' ? '>' : '<';
    if (numericType(col.type)) {
      params.push(String(Number(f.value)));
      where.push(`(NOT ${isEmpty} AND (values->>${c})::numeric ${sign} $${params.length}::numeric)`);
    } else if (col.type === 'date') {
      params.push(String(f.value));
      where.push(`(NOT ${isEmpty} AND (values->>${c}) ${sign} $${params.length})`);
    } else {
      params.push(String(f.value).toLowerCase());
      where.push(`(NOT ${isEmpty} AND lower(values->>${c}) ${sign} $${params.length})`);
    }
  }

  // Every filter placeholder sits before every sort placeholder, so a caller
  // can run the count query on the filter params alone.
  const filterCount = params.length;

  const order = [];
  for (const s of sorts || []) {
    const col = byCaption.get(s.column);
    if (!col) throw refusal(422, `${s.column} is not a column of this table.`, 'sorts');
    const direction = s.direction === 'desc' ? 'DESC' : 'asc' === s.direction ? 'ASC' : null;
    if (direction === null) throw refusal(422, 'A sort runs asc or desc.', 'sorts');
    params.push(col.caption);
    order.push(`${sortKeySql(col, `$${params.length}`)} ${direction}`);
  }
  // Two rows tied on every sort column keep their insertion order.
  order.push('inserted_position ASC');

  return { where, order, filterCount };
}

function validateViewBody(cols, body) {
  const byCaption = new Map(cols.map((c) => [c.caption, c]));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw refusal(422, 'A view carries a name.', 'name');
  if (name.length > 120) throw refusal(422, 'A view name is at most 120 characters.', 'name');
  const visibility = body.visibility;
  if (visibility !== 'private' && visibility !== 'shared') {
    throw refusal(422, 'A view is private or shared.', 'visibility');
  }
  const filters = Array.isArray(body.filters) ? body.filters : [];
  const sorts = Array.isArray(body.sorts) ? body.sorts : [];
  const cleanFilters = [];
  for (const f of filters) {
    if (!f || typeof f !== 'object') throw refusal(422, 'A filter carries a column, an operator and a value.', 'filters');
    const col = byCaption.get(f.column);
    if (!col) throw refusal(422, `${f.column} is not a column of this table.`, 'filters');
    if (!OPERATORS.includes(f.operator)) throw refusal(422, `${f.operator} is not a filter operator.`, 'filters');
    if (!operatorSupported(col.type, f.operator)) {
      throw refusal(422, `${f.operator} is not offered for a ${col.type} column.`, 'filters');
    }
    cleanFilters.push({
      column: col.caption,
      operator: f.operator,
      value: f.operator === 'is empty' ? null : f.value === undefined ? null : f.value,
    });
  }
  const cleanSorts = [];
  for (const s of sorts) {
    if (!s || typeof s !== 'object') throw refusal(422, 'A sort carries a column and a direction.', 'sorts');
    const col = byCaption.get(s.column);
    if (!col) throw refusal(422, `${s.column} is not a column of this table.`, 'sorts');
    if (s.direction !== 'asc' && s.direction !== 'desc') {
      throw refusal(422, 'A sort runs asc or desc.', 'sorts');
    }
    cleanSorts.push({ column: col.caption, direction: s.direction });
  }
  return { name, visibility, filters: cleanFilters, sorts: cleanSorts };
}

function publicView(row) {
  return {
    id: String(row.id),
    table: row.table_slug,
    name: row.name,
    owner: row.owner,
    visibility: row.visibility,
    filters: row.filters || [],
    sorts: row.sorts || [],
  };
}

module.exports = {
  OPERATORS,
  operatorsFor,
  operatorSupported,
  buildRowQuery,
  validateViewBody,
  publicView,
};
