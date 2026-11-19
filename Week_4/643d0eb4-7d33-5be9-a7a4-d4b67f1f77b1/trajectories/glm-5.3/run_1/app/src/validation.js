// Value validation at the write boundary: the six column types and what each refuses.
// A wrong-type refusal names the column caption and the type it wanted, and writes nothing.

const TYPES = ['text', 'integer', 'decimal', 'date', 'choice', 'flag'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Returns null when the value is right for the column, else a refusal descriptor naming the
// caption and the wanted type. `undefined` (the column is absent from the payload) is not a
// value at all; `null` and '' clear the column.
function validateValue(column, value) {
  const caption = column.caption;
  if (value === undefined) return null;
  if (value === null || value === '') return null;
  switch (column.type) {
    case 'text':
      if (typeof value !== 'string' || value.length > 500) {
        return { status: 422, reason: `${caption} wants a text of at most 500 characters.`, field: caption };
      }
      return null;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return { status: 422, reason: `${caption} wants an integer.`, field: caption };
      }
      return null;
    case 'decimal': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { status: 422, reason: `${caption} wants a decimal.`, field: caption };
      }
      const rounded = Math.round(value * 100);
      if (Math.abs(value * 100 - rounded) > 1e-9) {
        return { status: 422, reason: `${caption} wants a decimal of at most two places.`, field: caption };
      }
      return null;
    }
    case 'date':
      if (typeof value !== 'string' || !DATE_RE.test(value) || isNaN(new Date(value + 'T00:00:00Z').getTime())) {
        return { status: 422, reason: `${caption} wants a date as year month day.`, field: caption };
      }
      return null;
    case 'choice': {
      const options = column.options || [];
      const matches = options.some(o => String(o).toLowerCase() === String(value).toLowerCase());
      if (!matches) {
        return { status: 422, reason: `${caption} wants one of ${options.join(', ')}.`, field: caption };
      }
      return null;
    }
    case 'flag':
      if (typeof value !== 'boolean') {
        return { status: 422, reason: `${caption} wants true or false.`, field: caption };
      }
      return null;
    default:
      return { status: 422, reason: `${caption} wants a value of a known type.`, field: caption };
  }
}

// Validates a whole values map against a table's columns. Returns a list of per-column
// refusals, one per wrong column, or an empty list when every value is right.
function validateValues(columns, values) {
  const refusals = [];
  for (const column of columns) {
    const refusal = validateValue(column, values[column.caption]);
    if (refusal) refusals.push(refusal);
  }
  for (const key of Object.keys(values)) {
    if (!columns.some(c => c.caption === key)) {
      refusals.push({ status: 422, reason: `${key} is not a column of this table.`, field: key });
    }
  }
  return refusals;
}

// Normalises a validated value into its stored JSON type: numbers for integer and decimal,
// boolean for flag, strings for text, date and choice. A choice value is stored as the
// option's own casing.
function normaliseValue(column, value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  switch (column.type) {
    case 'choice': {
      const match = (column.options || []).find(o => String(o).toLowerCase() === String(value).toLowerCase());
      return match !== undefined ? match : value;
    }
    default:
      return value;
  }
}

module.exports = { TYPES, validateValue, validateValues, normaliseValue };
