#!/usr/bin/env python3
"""End-to-end API checks against a running Fluxseal server."""
import json
import urllib.request
import urllib.error
import hashlib

BASE = 'http://127.0.0.1:4173'


def req(method, path, body=None, cookie=None, headers=None, raw=False):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if body is not None:
        r.add_header('Content-Type', 'application/json')
    if cookie:
        r.add_header('Cookie', cookie)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r) as resp:
            content = resp.read()
            return resp.status, dict(resp.headers), content if raw else (json.loads(content) if content else None)
    except urllib.error.HTTPError as e:
        content = e.read()
        try:
            parsed = json.loads(content) if content and not raw else content
        except Exception:
            parsed = content
        return e.code, dict(e.headers), parsed


def check(name, cond, detail=''):
    status = 'PASS' if cond else 'FAIL'
    print(f'{status}  {name}  {detail if not cond else ""}')
    return cond


def main():
    ok = True
    s, h, b = req('GET', '/api/health')
    ok &= check('health', s == 200 and b == {'status': 'ok'}, f'{s} {b}')

    s, h, b = req('POST', '/api/session', {'email': 'tomas@levelmoor.example', 'password': 'moss-and-tower-26'})
    ok &= check('session', s == 200 and b['person']['id'] == 'p-tomas', f'{s} {b}')
    cookie = 'fluxseal_session=' + h['Set-Cookie'].split('fluxseal_session=')[1].split(';')[0]

    s, h, b = req('POST', '/api/session', {'email': 'tomas@levelmoor.example', 'password': 'nope'})
    ok &= check('invalid credentials', s == 401 and b == {'error': 'unauthenticated'}, f'{s} {b}')

    s, h, b = req('GET', '/api/projects', cookie=cookie)
    ok &= check('projects list', s == 200 and len(b['projects']) == 2, f'{s}')
    bm = next(p for p in b['projects'] if p['slug'] == 'blackmere-moss')
    ok &= check('tomas role', bm['role'] == 'sealer', bm['role'])

    s, h, b = req('POST', '/api/session', {'email': 'wren@levelmoor.example', 'password': 'moss-and-tower-26'})
    wren_cookie = 'fluxseal_session=' + h['Set-Cookie'].split('fluxseal_session=')[1].split(';')[0]
    s, h, b = req('GET', '/api/projects', cookie=wren_cookie)
    ok &= check('wren sees one project', len(b['projects']) == 1, b)
    s, h, b = req('GET', '/api/projects/saltings-reach', cookie=wren_cookie)
    ok &= check('wren saltings 404', s == 404, f'{s} {b}')
    s, h, b = req('POST', '/api/projects/blackmere-moss/preview',
                  {'start': '2026-06-01T00:00:00Z', 'end': '2026-06-15T00:00:00Z',
                   'sensor_ids': ['BM-T1', 'BM-T2', 'BM-S1', 'BM-S2', 'BM-S3', 'BM-S4']},
                  cookie=wren_cookie)
    ok &= check('wren preview 403', s == 403 and b == {'error': 'forbidden'}, f'{s} {b}')

    s, h, b = req('GET', '/api/projects/blackmere-moss/timeline?from=2026-06-01&to=2026-06-15', cookie=cookie)
    ok &= check('timeline 14 days', s == 200 and len(b['days']) == 14, f'{s} {len(b.get("days", []))}')
    d1 = b['days'][0]
    ok &= check('day 1 value', d1['net_tco2e'] == '-0.437' and d1['coverage_pct'] == '41.7', d1)
    d3 = b['days'][2]
    ok &= check('day 3 value', d3['net_tco2e'] == '-1.636' and d3['coverage_pct'] == '100.0', d3)

    s, h, b = req('GET', '/api/projects/blackmere-moss/timeline?from=2026-6-1', cookie=cookie)
    ok &= check('timeline bad from 422', s == 422 and 'from' in b['errors'], f'{s} {b}')

    all_sensors = ['BM-T1', 'BM-T2', 'BM-S1', 'BM-S2', 'BM-S3', 'BM-S4']
    s, h, prev = req('POST', '/api/projects/blackmere-moss/preview',
                     {'start': '2026-06-01T00:00:00Z', 'end': '2026-06-15T00:00:00Z', 'sensor_ids': all_sensors},
                     cookie=cookie)
    ok &= check('preview whole record', s == 200 and prev['net_tco2e'] == '-16.808' and prev['coverage_pct'] == '85.0'
                and prev['buffer_tco2e'] == '2.521' and prev['credited_tco2e'] == '-14.287'
                and prev['readings_count'] == 3648 and prev['sealable'] is True, prev if s != 200 else '')
    fp = prev['fingerprint']

    s, h, b = req('POST', '/api/projects/blackmere-moss/preview',
                  {'start': '2026-06-01T00:00:00Z', 'end': '2026-06-03T00:00:00Z', 'sensor_ids': all_sensors},
                  cookie=cookie)
    ok &= check('preview below floor', b['sealable'] is False and b['blocked_reason'] == 'below_coverage_floor'
                and b['net_tco2e'] == '-0.873' and b['coverage_pct'] == '41.7', b)

    s, h, b = req('POST', '/api/projects/blackmere-moss/preview',
                  {'start': '2026-06-01T00:00:01Z', 'end': '2026-06-15T00:00:00Z', 'sensor_ids': all_sensors},
                  cookie=cookie)
    ok &= check('preview bad start 422', s == 422 and 'start' in b['errors'], f'{s} {b}')
    s, h, b = req('POST', '/api/projects/blackmere-moss/preview',
                  {'start': '2026-06-01T00:00:00Z', 'end': '2026-06-15T00:00:00Z', 'sensor_ids': []},
                  cookie=cookie)
    ok &= check('preview empty sensors 422', s == 422 and 'sensor_ids' in b['errors'], f'{s} {b}')
    s, h, b = req('POST', '/api/projects/blackmere-moss/preview',
                  {'start': '2026-06-01T00:00:00Z', 'end': '2026-16-15T00:00:00Z', 'sensor_ids': all_sensors},
                  cookie=cookie)
    ok &= check('preview out of record 422', s == 422, f'{s} {b}')

    seal_body = {'start': '2026-06-01T00:00:00Z', 'end': '2026-06-15T00:00:00Z',
                 'sensor_ids': all_sensors, 'preview_fingerprint': fp}
    s, h, fig = req('POST', '/api/projects/blackmere-moss/figures', seal_body, cookie=cookie,
                    headers={'Idempotency-Key': 'key-A'})
    ok &= check('seal 201', s == 201 and fig['id'] == 'BM-F0001' and fig['status'] == 'sealed', f'{s} {fig if s != 201 else ""}')
    fig_id = fig['id']

    s2, h2, b2 = req('POST', '/api/projects/blackmere-moss/figures',
                     {**seal_body, 'sensor_ids': list(reversed(all_sensors))},
                     cookie=cookie, headers={'Idempotency-Key': 'key-A'})
    ok &= check('replay 201', s2 == 201 and h2.get('Idempotent-Replay') == 'true'
                and json.dumps(b2, sort_keys=True) == json.dumps(fig, sort_keys=True), f'{s2} {h2.get("Idempotent-Replay")}')

    s2, h2, b2 = req('POST', '/api/projects/blackmere-moss/figures',
                     {'start': '2026-06-03T00:00:00Z', 'end': '2026-06-08T00:00:00Z',
                      'sensor_ids': all_sensors, 'preview_fingerprint': fp},
                     cookie=cookie, headers={'Idempotency-Key': 'key-A'})
    ok &= check('key conflict 409', s2 == 409 and b2 == {'error': 'idempotency_key_conflict'}, f'{s2} {b2}')

    s2, h2, b2 = req('POST', '/api/projects/blackmere-moss/figures', seal_body, cookie=cookie,
                     headers={'Idempotency-Key': 'key-B'})
    ok &= check('already sealed 409', s2 == 409 and b2 == {'error': 'already_sealed', 'figure_id': fig_id}, f'{s2} {b2}')

    s2, h2, b2 = req('POST', '/api/projects/blackmere-moss/preview',
                     {'start': '2026-06-03T00:00:00Z', 'end': '2026-06-08T00:00:00Z', 'sensor_ids': all_sensors},
                     cookie=cookie)
    ok &= check('overlap preview blocked', b2['blocked_reason'] == 'overlaps_sealed' and b2['blocking_figure_id'] == fig_id, b2)
    s2, h2, b2 = req('POST', '/api/projects/blackmere-moss/figures',
                     {'start': '2026-06-03T00:00:00Z', 'end': '2026-06-08T00:00:00Z', 'sensor_ids': all_sensors,
                      'preview_fingerprint': b2['fingerprint']},
                     cookie=cookie, headers={'Idempotency-Key': 'key-C'})
    ok &= check('overlap seal 409', s2 == 409 and b2 == {'error': 'interval_overlaps_sealed', 'figure_id': fig_id}, f'{s2} {b2}')

    s, h, led = req('GET', '/api/projects/blackmere-moss/ledger', cookie=cookie)
    kinds = [(e['kind'], e['tco2e']) for e in led['entries']]
    ok &= check('ledger entries', kinds == [('issuance', '-16.808'), ('buffer', '2.521')], kinds)
    ok &= check('ledger balance', led['balance_tco2e'] == '-14.287' and led['buffer_tco2e'] == '2.521', led)

    s, h, b = req('GET', '/api/projects/blackmere-moss/figures', cookie=cookie)
    ok &= check('summary after seal', b['summary'] == {'sealed_net_tco2e': '-14.287', 'buffer_tco2e': '2.521',
                 'intact_count': 1, 'broken_count': 0, 'superseded_count': 0}, b['summary'])

    s, h, link = req('POST', f'/api/figures/{fig_id}/links', {}, cookie=cookie)
    ok &= check('issue link 201', s == 201 and link['status'] == 'live' and link['url'].endswith(link['token']), f'{s} {link}')
    token = link['token']

    s, h, pub = req('GET', f'/api/public/links/{token}')
    ok &= check('public read', s == 200 and pub['figure']['id'] == fig_id and pub['link']['status'] == 'live', f'{s}')
    ok &= check('public rederived', 'rederived' in pub['figure'] and pub['figure']['rederived']['matches'] is True, pub['figure'].get('rederived'))

    s, h, pub2 = req('POST', f'/api/public/links/{token}/rederive', {})
    ok &= check('public rederive', s == 200 and pub2['figure']['rederived']['matches'] is True, f'{s}')

    s, h, ev = req('GET', f'/api/public/links/{token}/evidence', raw=True)
    ok &= check('evidence 200', s == 200 and ev.startswith(b'sensor_id,interval_start,fc,fch4,qc\n'), f'{s}')
    sha = hashlib.sha256(ev).hexdigest()
    ok &= check('evidence hash matches fingerprint', sha == fig['fingerprint'], sha)
    ok &= check('evidence headers', h.get('X-Fluxseal-Fingerprint') == fig['fingerprint']
                and 'attachment' in h.get('Content-Disposition', ''), dict(h))

    s, h, b = req('POST', '/api/session', {'email': 'priya@levelmoor.example', 'password': 'moss-and-tower-26'})
    steward_cookie = 'fluxseal_session=' + h['Set-Cookie'].split('fluxseal_session=')[1].split(';')[0]

    s, h, b = req('POST', '/api/projects/blackmere-moss/readings',
                  {'readings': [{'sensor_id': 'BM-T1', 'interval_start': '2026-06-01T00:00:00Z', 'fc': 1, 'fch4': 1, 'qc': 0}]},
                  cookie=cookie)
    ok &= check('non-steward ingest 403', s == 403, f'{s} {b}')

    s, h, b = req('POST', '/api/projects/blackmere-moss/readings',
                  {'readings': [{'sensor_id': 'BM-T1', 'interval_start': '2026-06-05T12:00:00Z',
                                 'fc': -2.5, 'fch4': 15.0, 'qc': 0}]},
                  cookie=steward_cookie)
    ok &= check('ingest revised', s == 200 and b['revised'] == 1 and b['inserted'] == 0 and b['unchanged'] == 0
                and b['broken_figures'] == [fig_id], f'{s} {b}')

    s, h, b = req('POST', '/api/projects/blackmere-moss/readings',
                  {'readings': [{'sensor_id': 'BM-T1', 'interval_start': '2026-06-05T12:00:00Z',
                                 'fc': -2.5, 'fch4': 15.0, 'qc': 0}]},
                  cookie=steward_cookie)
    ok &= check('ingest unchanged', s == 200 and b['unchanged'] == 1 and b['broken_figures'] == [], f'{s} {b}')

    s, h, led = req('GET', '/api/projects/blackmere-moss/ledger', cookie=cookie)
    kinds = [(e['kind'], e['tco2e']) for e in led['entries']]
    ok &= check('reversals in ledger', kinds == [('issuance', '-16.808'), ('buffer', '2.521'),
                                                 ('reversal', '16.808'), ('reversal', '-2.521')], kinds)
    ok &= check('balance back to zero', led['balance_tco2e'] == '0.000' and led['buffer_tco2e'] == '0.000', led)

    s, h, figs = req('GET', '/api/projects/blackmere-moss/figures', cookie=cookie)
    ok &= check('figure broken', figs['figures'][0]['status'] == 'broken'
                and figs['summary']['broken_count'] == 1 and figs['summary']['intact_count'] == 0, figs['summary'])

    s, h, audit = req('GET', f'/api/figures/{fig_id}/audit', cookie=cookie)
    ok &= check('audit trail', s == 200 and len(audit['moved']) == 1
                and audit['moved'][0]['old']['fc'] == '-3.0000' and audit['moved'][0]['new']['fc'] == '-2.5000', audit)

    s, h, audit = req('GET', f'/api/public/links/{token}/audit')
    ok &= check('public audit live after break', s == 200, f'{s}')

    s, h, pub = req('GET', f'/api/public/links/{token}')
    ok &= check('public broken', pub['figure']['status'] == 'broken' and pub['figure']['rederived']['matches'] is False, pub['figure']['status'])

    s, h, ev = req('GET', f'/api/public/links/{token}/evidence', raw=True)
    ok &= check('evidence still hashes to fingerprint', s == 200 and hashlib.sha256(ev).hexdigest() == fig['fingerprint'], s)

    s, h, b = req('POST', '/api/projects/blackmere-moss/preview',
                  {'start': '2026-06-01T00:00:00Z', 'end': '2026-06-15T00:00:00Z', 'sensor_ids': all_sensors},
                  cookie=cookie)
    ok &= check('re-seal preview armed', b['sealable'] is True and b['blocked_reason'] is None, b)
    s, h, fig2 = req('POST', '/api/projects/blackmere-moss/figures',
                     {'start': '2026-06-01T00:00:00Z', 'end': '2026-06-15T00:00:00Z', 'sensor_ids': all_sensors,
                      'preview_fingerprint': b['fingerprint']},
                     cookie=cookie, headers={'Idempotency-Key': 'key-D'})
    ok &= check('re-seal supersedes', s == 201 and fig2['id'] == 'BM-F0002' and fig2['supersedes'] == fig_id, f'{s} {fig2.get("supersedes")}')
    s, h, old = req('GET', f'/api/figures/{fig_id}', cookie=cookie)
    ok &= check('old superseded', old['status'] == 'superseded' and old['superseded_by'] == 'BM-F0002', (old['status'], old['superseded_by']))

    s2, h2, b2 = req('POST', '/api/projects/blackmere-moss/figures', seal_body, cookie=cookie,
                     headers={'Idempotency-Key': 'key-A'})
    ok &= check('replay after break', s2 == 201 and h2.get('Idempotent-Replay') == 'true' and b2['status'] == 'sealed', f'{s2}')

    s, h, links = req('GET', f'/api/figures/{fig_id}/links', cookie=cookie)
    ok &= check('links list', s == 200 and links['links'][0]['status'] == 'live', f'{s} {links}')
    s, h, b = req('POST', f'/api/figures/{fig_id}/links/{links["links"][0]["id"]}/revoke', {}, cookie=cookie)
    ok &= check('revoke', s == 200 and b['status'] == 'revoked', f'{s} {b}')
    s, h, b = req('POST', f'/api/figures/{fig_id}/links/{links["links"][0]["id"]}/revoke', {}, cookie=cookie)
    ok &= check('revoke twice 409', s == 409 and b == {'error': 'link_revoked'}, f'{s} {b}')
    s, h, b = req('GET', f'/api/public/links/{token}')
    ok &= check('revoked link 410', s == 410 and b['error'] == 'link_revoked', f'{s} {b}')
    s, h, b = req('GET', '/api/public/links/nonexistent')
    ok &= check('unknown link 404', s == 404, f'{s} {b}')

    s, h, b = req('POST', f'/api/figures/{fig_id}/links', {}, cookie=cookie)
    ok &= check('link on superseded 409', s == 409 and b == {'error': 'figure_not_sealed'}, f'{s} {b}')

    s, h, b = req('POST', '/api/session', {'email': 'x@y.z', 'password': 'a'},
                  headers={'Content-Type': 'text/plain'})
    ok &= check('415 wrong media type', s == 415 and b == {'error': 'unsupported_media_type'}, f'{s} {b}')

    r = urllib.request.Request(BASE + '/api/session', data=b'{oops', method='POST')
    r.add_header('Content-Type', 'application/json')
    try:
        urllib.request.urlopen(r)
        ok &= check('400 invalid json', False)
    except urllib.error.HTTPError as e:
        body = json.loads(e.read())
        ok &= check('400 invalid json', e.code == 400 and body == {'error': 'invalid_json'}, f'{e.code} {body}')

    big = b'{"email":"' + b'a' * 70000 + b'"}'
    r = urllib.request.Request(BASE + '/api/session', data=big, method='POST')
    r.add_header('Content-Type', 'application/json')
    try:
        urllib.request.urlopen(r)
        ok &= check('413 payload too large', False)
    except urllib.error.HTTPError as e:
        body = json.loads(e.read())
        ok &= check('413 payload too large', e.code == 413 and body == {'error': 'payload_too_large'}, f'{e.code} {body}')

    r = urllib.request.Request(BASE + '/api/session', data=json.dumps({'email': 'x', 'password': 'y'}).encode(), method='POST')
    r.add_header('Content-Type', 'application/json')
    r.add_header('Origin', 'http://evil.example')
    r.add_header('Host', '127.0.0.1:4173')
    try:
        urllib.request.urlopen(r)
        ok &= check('403 cross origin', False)
    except urllib.error.HTTPError as e:
        body = json.loads(e.read())
        ok &= check('403 cross origin', e.code == 403 and body == {'error': 'cross_origin'}, f'{e.code} {body}')

    s, h, b = req('POST', '/api/session', {'email': 'ines@levelmoor.example', 'password': 'moss-and-tower-26'})
    admin_cookie = 'fluxseal_session=' + h['Set-Cookie'].split('fluxseal_session=')[1].split(';')[0]
    s, h, b = req('GET', '/api/access', cookie=admin_cookie)
    ok &= check('access list', s == 200 and len(b['people']) == 6 and len(b['projects']) == 3, f'{s}')
    s, h, b = req('GET', '/api/access', cookie=cookie)
    ok &= check('access non-admin 403', s == 403, f'{s}')

    s, h, b = req('PUT', '/api/projects/saltings-reach/grants/p-wren', {'role': 'sealer'}, cookie=admin_cookie)
    ok &= check('grant put', s == 200 and b['role'] == 'sealer', f'{s} {b}')
    s, h, b = req('GET', '/api/projects/saltings-reach', cookie=wren_cookie)
    ok &= check('wren now sees saltings', s == 200 and b['role'] == 'sealer', f'{s}')
    s, h, b = req('DELETE', '/api/projects/saltings-reach/grants/p-wren', cookie=admin_cookie)
    ok &= check('grant delete 204', s == 204, f'{s}')
    s, h, b = req('GET', '/api/projects/saltings-reach', cookie=wren_cookie)
    ok &= check('wren lost saltings 404', s == 404, f'{s}')

    s, h, b = req('POST', '/api/projects/blackmere-moss/readings',
                  {'readings': [{'sensor_id': 'BM-T1', 'interval_start': '2026-06-01T00:00:00Z', 'fc': 101, 'fch4': 1, 'qc': 0}]},
                  cookie=steward_cookie)
    ok &= check('fc out of range 422', s == 422 and 'readings[0].fc' in b['errors'], f'{s} {b}')
    s, h, b = req('POST', '/api/projects/blackmere-moss/readings',
                  {'readings': [{'sensor_id': 'BM-T1', 'interval_start': '2026-06-01T00:00:00Z', 'fc': 1, 'fch4': 1, 'qc': 4}]},
                  cookie=steward_cookie)
    ok &= check('qc invalid 422', s == 422 and 'readings[0].qc' in b['errors'], f'{s} {b}')
    s, h, b = req('POST', '/api/projects/blackmere-moss/readings',
                  {'readings': [
                      {'sensor_id': 'BM-T1', 'interval_start': '2026-06-01T00:00:00Z', 'fc': 1, 'fch4': 1, 'qc': 0},
                      {'sensor_id': 'BM-T1', 'interval_start': '2026-06-01T00:00:00Z', 'fc': 2, 'fch4': 1, 'qc': 0}]},
                  cookie=steward_cookie)
    ok &= check('duplicate in batch 422', s == 422 and 'readings[1]' in b['errors'], f'{s} {b}')

    s, h, b = req('POST', '/api/projects/saltings-reach/preview',
                  {'start': '2026-06-01T00:00:00Z', 'end': '2026-06-15T00:00:00Z',
                   'sensor_ids': ['SR-T1', 'SR-S1', 'SR-S2']},
                  cookie=cookie)
    ok &= check('saltings whole record', s == 200 and b['net_tco2e'] == '-10.854' and b['co2_tco2e'] == '-17.035'
                and b['ch4_tco2e'] == '6.181' and b['buffer_tco2e'] == '1.085' and b['credited_tco2e'] == '-9.769', b if s != 200 else '')

    s, h, b = req('POST', '/api/projects/saltings-reach/preview',
                  {'start': '2026-06-05T10:00:00Z', 'end': '2026-06-05T12:00:00Z',
                   'sensor_ids': ['SR-T1', 'SR-S1', 'SR-S2']},
                  cookie=cookie)
    ok &= check('saltings tie interval', s == 200 and b['net_tco2e'] == '-0.065' and b['buffer_tco2e'] == '0.006'
                and b['credited_tco2e'] == '-0.059', b if s != 200 else '')
    contrib = {c['sensor_id']: c for c in b['contributions']}
    ok &= check('saltings tie allocation', contrib['SR-S1']['net_tco2e'] == '-0.011' and contrib['SR-S2']['net_tco2e'] == '-0.012'
                and contrib['SR-T1']['net_tco2e'] == '-0.042', contrib)

    s, h, b = req('GET', '/api/projects/hollin-wood', cookie=cookie)
    ok &= check('hollin invisible to tomas', s == 404, f'{s}')
    s, h, b = req('GET', '/api/projects/hollin-wood', cookie=admin_cookie)
    ok &= check('hollin visible to admin', s == 200 and b['record_start'] is None and b['role'] == 'viewer', f'{s}')

    print('\nALL PASS' if ok else '\nFAILURES PRESENT')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
