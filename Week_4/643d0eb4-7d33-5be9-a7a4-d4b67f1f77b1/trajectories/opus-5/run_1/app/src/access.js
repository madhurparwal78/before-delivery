'use strict';
const db = require('./db');
const core = require('./core');
const { refusal, roleAllows } = core;

/** Every department the caller holds an authorising role on, right now. */
function departmentsFor(auth) {
  return (auth && auth.grants ? auth.grants : []).map((g) => g.department);
}

function roleFor(auth, department) {
  if (!auth) return null;
  const g = (auth.grants || []).find((x) => x.department === department);
  return g ? g.role : null;
}

/**
 * The one department boundary. A reader with no role on a department is
 * refused that department everywhere, and the refusal names it.
 */
function requireDepartment(auth, department, action) {
  if (!auth) throw refusal(401, 'This address needs a session.', 'session');
  const role = roleFor(auth, department);
  if (!role) throw core.DEPARTMENT_CLOSED(department);
  if (action && !roleAllows(role, action)) {
    throw refusal(403, `A ${role} does not do this on ${department}.`, 'role');
  }
  return role;
}

/** Resolve a table slug: a slug with no table is a 404 before anything else. */
async function requireTable(slug, client) {
  const table = await core.tableBySlug(slug, client);
  if (!table) throw refusal(404, 'That table is not part of Keystone Tables.', 'table');
  return table;
}

async function stewardDepartments(auth) {
  return (auth && auth.grants ? auth.grants : [])
    .filter((g) => g.role === 'steward')
    .map((g) => g.department);
}

async function isSteward(auth) {
  return (auth && auth.grants ? auth.grants : []).some((g) => g.role === 'steward');
}

module.exports = { departmentsFor, roleFor, requireDepartment, requireTable, stewardDepartments, isSteward, db };
