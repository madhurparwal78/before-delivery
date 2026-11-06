'use strict';

const path = require('path');
const nunjucks = require('nunjucks');
const { Store } = require('../lib/repository');

const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'views')), {
  autoescape: true,
  trimBlocks: true,
  lstripBlocks: true,
});

env.addFilter('label', (value) => {
  const { LABELS, STOP_KIND_LABELS } = require('../lib/domain');
  return LABELS[value] || STOP_KIND_LABELS[value] || value;
});

function render(res, template, status, context) {
  const body = env.render(template, context);
  res.status(status).type('html').send(body);
}

function navFor(member) {
  const items = [{ href: '/requests', label: 'Requests', key: 'requests' }];
  if (member.role === 'dispatcher' || member.role === 'admin') {
    items.push({ href: '/dispatch', label: 'Dispatch', key: 'dispatch' });
    items.push({ href: '/fleet', label: 'Fleet', key: 'fleet' });
  }
  if (member.role === 'admin') items.push({ href: '/admin/users', label: 'Members', key: 'members' });
  return items;
}

function baseContext(req, member, { title, active, notices = [] } = {}) {
  return {
    member, nav: member ? navFor(member) : [], active,
    title, notices,
    publicUrl: req.app.locals.publicUrl,
    query: req.query || {},
    csrf: null,
  };
}

module.exports = { env, render, navFor, baseContext };
