import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';
import { applySchema } from './db/pool';
import { applySeed } from './db/seed';
import { nowSeconds } from './domain/time';
import { makeRouter, type Reply, type Route } from './http/router';
import { checkRate } from './store/rate';
import { findSession } from './api/session';
import * as session from './api/session';
import * as labels from './api/labels';
import * as styles from './api/styles';
import * as requests from './api/requests';
import * as visits from './api/visits';
import * as results from './api/results';
import * as passports from './api/passports';
import * as dossiers from './api/dossiers';
import * as pages from './pages';
import { startWork } from './work';

const PUBLIC_DIR = join(__dirname, '..', 'public');

const ASSETS: Record<string, { file: string; contentType: string }> = {
  '/assets/app.js': { file: 'app.js', contentType: 'application/javascript; charset=utf-8' },
  '/assets/app.css': { file: 'app.css', contentType: 'text/css; charset=utf-8' },
  '/assets/fonts/sora-latin.woff2': { file: 'fonts/sora-latin.woff2', contentType: 'font/woff2' },
  '/assets/fonts/sora-latin-ext.woff2': { file: 'fonts/sora-latin-ext.woff2', contentType: 'font/woff2' },
  '/assets/fonts/noto-sans-regular.ttf': { file: 'fonts/noto-sans-regular.ttf', contentType: 'font/ttf' },
  '/assets/fonts/noto-sans-semibold.ttf': { file: 'fonts/noto-sans-semibold.ttf', contentType: 'font/ttf' },
  '/assets/fonts/noto-sans-arabic-regular.ttf': {
    file: 'fonts/noto-sans-arabic-regular.ttf',
    contentType: 'font/ttf',
  },
  '/assets/fonts/noto-sans-arabic-semibold.ttf': {
    file: 'fonts/noto-sans-arabic-semibold.ttf',
    contentType: 'font/ttf',
  },
};

const assetCache = new Map<string, Buffer>();

function staticReply(path: string): Reply | null {
  const asset = ASSETS[path];
  if (!asset) return null;
  let bytes = assetCache.get(path);
  if (!bytes) {
    try {
      bytes = readFileSync(join(PUBLIC_DIR, asset.file));
    } catch {
      return null;
    }
    assetCache.set(path, bytes);
  }
  return {
    status: 200,
    bytes,
    contentType: asset.contentType,
    headers: { 'Cache-Control': 'public, max-age=3600' },
  };
}

const routes: Route[] = [
  { method: 'GET', pattern: '/api/health', handler: () => ({ status: 200, json: { status: 'ok' } }) },

  { method: 'POST', pattern: '/api/sign-up', handler: session.signUp },
  { method: 'POST', pattern: '/api/sign-in', handler: session.signIn },
  { method: 'POST', pattern: '/api/sign-out', handler: session.signOut },
  { method: 'GET', pattern: '/api/session', handler: session.readSession },
  { method: 'POST', pattern: '/api/password', handler: session.changePassword },

  { method: 'GET', pattern: '/api/labels', handler: labels.listLabels },
  { method: 'POST', pattern: '/api/labels', handler: labels.createLabel },
  { method: 'GET', pattern: '/api/labels/<id>', handler: labels.readLabel },
  { method: 'PATCH', pattern: '/api/labels/<id>', handler: labels.renameLabel },
  { method: 'DELETE', pattern: '/api/labels/<id>', handler: labels.deleteLabel },
  { method: 'POST', pattern: '/api/labels/<id>/close', handler: labels.closeLabel },
  { method: 'POST', pattern: '/api/labels/<id>/bring-back', handler: labels.bringBackLabel },
  { method: 'POST', pattern: '/api/labels/<id>/catalogue/preview', handler: labels.previewCatalogue },
  { method: 'POST', pattern: '/api/labels/<id>/catalogue/save', handler: labels.saveCatalogue },

  { method: 'GET', pattern: '/api/styles', handler: styles.listStyles },
  { method: 'POST', pattern: '/api/styles', handler: styles.createStyle },
  { method: 'GET', pattern: '/api/styles/<id>', handler: styles.readStyle },
  { method: 'PATCH', pattern: '/api/styles/<id>', handler: styles.patchStyle },
  { method: 'POST', pattern: '/api/styles/<id>/duplicate', handler: styles.duplicateStyle },
  { method: 'POST', pattern: '/api/styles/<id>/archive', handler: styles.archiveStyle },
  { method: 'GET', pattern: '/api/materials', handler: styles.listMaterials },
  { method: 'GET', pattern: '/api/styles/<id>/lines', handler: styles.listLines },
  { method: 'POST', pattern: '/api/styles/<id>/lines', handler: styles.createLine },
  { method: 'PATCH', pattern: '/api/styles/<id>/lines/<lineId>', handler: styles.patchLine },
  { method: 'DELETE', pattern: '/api/styles/<id>/lines/<lineId>', handler: styles.deleteLine },
  { method: 'POST', pattern: '/api/styles/<id>/lines/<lineId>/move', handler: styles.moveLine },
  { method: 'POST', pattern: '/api/styles/<id>/legs', handler: styles.createLeg },
  { method: 'DELETE', pattern: '/api/styles/<id>/legs/<legId>', handler: styles.deleteLeg },

  { method: 'GET', pattern: '/api/requests', handler: requests.listRequests },
  { method: 'POST', pattern: '/api/requests', handler: requests.createRequest, rate: 'request' },
  { method: 'GET', pattern: '/api/requests/<id>', handler: requests.readRequest },
  { method: 'POST', pattern: '/api/requests/<id>/new-address', handler: requests.newAddress, rate: 'request' },
  { method: 'POST', pattern: '/api/requests/<id>/end', handler: requests.endRequest },
  { method: 'GET', pattern: '/api/a/<token>', handler: requests.readAnswerPage },
  {
    method: 'POST',
    pattern: '/api/a/<token>/evidence',
    handler: requests.uploadEvidence,
    limit: 'evidence',
  },
  { method: 'POST', pattern: '/api/a/<token>/answers', handler: requests.sendAnswers },
  { method: 'GET', pattern: '/api/evidence/<id>/file', handler: requests.downloadEvidence, rate: 'file' },

  { method: 'GET', pattern: '/api/visits', handler: visits.listVisits },
  { method: 'POST', pattern: '/api/visits', handler: visits.createVisit },
  { method: 'GET', pattern: '/api/visits/<id>', handler: visits.readVisit },
  { method: 'GET', pattern: '/api/calendar/<date>', handler: visits.readCalendarDay },
  { method: 'POST', pattern: '/api/visits/<id>/readings', handler: visits.recordReading },

  { method: 'POST', pattern: '/api/styles/<id>/results', handler: results.workOutResult },
  { method: 'GET', pattern: '/api/styles/<id>/results', handler: results.listResults },
  { method: 'GET', pattern: '/api/results/<id>', handler: results.readResult },
  { method: 'GET', pattern: '/api/results/<id>/factors', handler: results.readResultFactors },
  { method: 'POST', pattern: '/api/factors/check', handler: results.checkFactors },
  { method: 'POST', pattern: '/api/styles/<id>/scenarios/preview', handler: results.previewScenario },
  { method: 'GET', pattern: '/api/styles/<id>/scenarios', handler: results.listScenarios },
  { method: 'POST', pattern: '/api/styles/<id>/scenarios', handler: results.saveScenario },
  { method: 'POST', pattern: '/api/styles/<id>/score', handler: results.askScore },
  { method: 'GET', pattern: '/api/estimate', handler: results.estimate },

  { method: 'POST', pattern: '/api/styles/<id>/passport', handler: passports.publishPassport },
  { method: 'POST', pattern: '/api/styles/<id>/passport/withdraw', handler: passports.withdrawPassport },
  { method: 'GET', pattern: '/api/passports', handler: passports.listPassports },
  { method: 'GET', pattern: '/api/passports/<gtin>', handler: passports.readPublicPassport },
  { method: 'GET', pattern: '/api/passports/<gtin>/editions/<n>', handler: passports.readPublicPassportEdition },

  { method: 'POST', pattern: '/api/styles/<id>/dossiers', handler: dossiers.makeDossier },
  { method: 'GET', pattern: '/api/styles/<id>/dossiers', handler: dossiers.listDossiers },
  { method: 'GET', pattern: '/api/dossiers/<id>', handler: dossiers.readDossier },
  { method: 'GET', pattern: '/api/dossiers/<id>/file', handler: dossiers.downloadDossier, rate: 'file' },
  { method: 'POST', pattern: '/api/dossiers/<id>/sign-off-page', handler: dossiers.sendSignOffPage },
  { method: 'GET', pattern: '/api/s/<token>', handler: dossiers.readSignOffPage },
  { method: 'GET', pattern: '/api/s/<token>/file', handler: dossiers.downloadSignOffFile },
  { method: 'POST', pattern: '/api/s/<token>/sign', handler: dossiers.signDossier },
  {
    method: 'GET',
    pattern: '/api/styles/<id>/results-file',
    handler: dossiers.downloadResultsFile,
    rate: 'file',
  },

  { method: 'GET', pattern: '/', handler: pages.homeRoute, kind: 'page' },
  { method: 'GET', pattern: '/method', handler: pages.methodRoute, kind: 'page' },
  { method: 'GET', pattern: '/questions', handler: pages.questionsRoute, kind: 'page' },
  { method: 'GET', pattern: '/sign-in', handler: pages.signInRoute, kind: 'page' },
  { method: 'GET', pattern: '/sign-up', handler: pages.signUpRoute, kind: 'page' },
  { method: 'GET', pattern: '/p/<gtin>', handler: pages.passportNewestRoute, kind: 'page' },
  { method: 'GET', pattern: '/p/<gtin>/e/<n>', handler: pages.passportEditionRoute, kind: 'page' },
  { method: 'GET', pattern: '/a/<token>', handler: pages.answerPageRoute, kind: 'page' },
  { method: 'GET', pattern: '/s/<token>', handler: pages.signOffPageRoute, kind: 'page' },
  { method: 'GET', pattern: '/styles', handler: pages.stylesRoute, kind: 'page', auth: 'required' },
  { method: 'GET', pattern: '/styles/<id>', handler: pages.styleRoute, kind: 'page', auth: 'required' },
  {
    method: 'GET',
    pattern: '/styles/<id>/materials',
    handler: pages.materialsRoute,
    kind: 'page',
    auth: 'required',
  },
  {
    method: 'GET',
    pattern: '/styles/<id>/scenarios',
    handler: pages.scenariosRoute,
    kind: 'page',
    auth: 'required',
  },
  { method: 'GET', pattern: '/labels', handler: pages.labelsRoute, kind: 'page', auth: 'required' },
  { method: 'GET', pattern: '/labels/<id>', handler: pages.labelRoute, kind: 'page', auth: 'required' },
  { method: 'GET', pattern: '/requests', handler: pages.requestsRoute, kind: 'page', auth: 'required' },
  { method: 'GET', pattern: '/visits', handler: pages.visitsRoute, kind: 'page', auth: 'required' },
  { method: 'GET', pattern: '/visits/<id>', handler: pages.visitRoute, kind: 'page', auth: 'required' },
  { method: 'GET', pattern: '/passports', handler: pages.passportsRoute, kind: 'page', auth: 'required' },
];

const handle = makeRouter(routes, {
  findSession,
  checkRate,
  renderNotFound: async () => pages.notFoundReply(),
  staticReply,
});

async function main(): Promise<void> {
  const server = createServer((request, response) => void handle(request, response));
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Fio Contado Desk on ${config.port}\n`);
  });

  try {
    await applySchema();
    await applySeed(nowSeconds());
  } catch (thrown) {
    process.stderr.write(`start-up: ${String(thrown instanceof Error ? thrown.stack : thrown)}\n`);
  }
  startWork();
}

void main();
