#!/usr/bin/env python3
"""End-to-end API checks for Linewell against a running instance."""
import json
import urllib.request
import urllib.error
import http.cookiejar
import sys
import time

BASE = 'http://127.0.0.1:4173'
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

passed = 0
failed = 0

def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'  ok {name}')
    else:
        failed += 1
        print(f'FAIL {name} {detail}')

def req(method, path, body=None, headers=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header('content-type', 'application/json')
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        resp = opener.open(r)
        payload = resp.read()
        return resp.status, (payload if raw else (json.loads(payload) if payload else {}))
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, (payload if raw else json.loads(payload))
        except Exception:
            return e.code, payload

def main():
    suffix = str(time.time_ns())[-6:]
    ada_email = f'ada{suffix}@linewell.test'
    bea_email = f'bea{suffix}@linewell.test'
    cy_email = f'cy{suffix}@linewell.test'

    status, body = req('GET', '/api/health')
    check('health 200 ok', status == 200 and body == {'status': 'ok'}, body)

    for name, email, pwd in [
        ('Ada Lindqvist', ada_email, 'drafting-ada-01'),
        ('Bea Okafor', bea_email, 'drafting-bea-02'),
        ('Cy Moreau', cy_email, 'drafting-cy-03'),
    ]:
        status, body = req('POST', '/api/auth/signup', {'name': name, 'email': email, 'password': pwd})
        check(f'signup {name}', status == 201, body)

    # Sign back in as Ada so the diagram is created by the owner.
    status, body = req('POST', '/api/auth/signin', {'email': ada_email, 'password': 'drafting-ada-01'})
    check('signin Ada', status == 200, body)

    status, body = req('POST', '/api/diagrams', {'title': 'Bad\nTitle'})
    check('title newline 422', status == 422 and body['error']['code'] == 'invalid'
          and 'title' in body['error']['fields'], body)

    status, body = req('POST', '/api/diagrams', {'title': 'Pipeline'})
    check('create diagram', status == 201 and body['document']['pages'][0]['name'] == 'Page 1', body)
    did = body['diagram']['id']
    page_id = body['document']['pages'][0]['id']
    layer_id = body['document']['pages'][0]['layers'][0]['id']

    labels = ['Intake', 'Review', 'Archive', 'Log', 'Store']
    coords = {'Intake': (0, 0), 'Review': (400, 0), 'Archive': (200, 200), 'Log': (0, 300), 'Store': (400, 300)}
    shape_ids = {}
    seq = 0
    for i, label in enumerate(labels):
        x, y = coords[label]
        status, body = req('POST', f'/api/diagrams/{did}/operations', {
            'opId': f'add-{i}', 'baseSeq': seq,
            'op': {'kind': 'add_shape', 'page': page_id, 'layer': layer_id,
                   'shape': {'kind': 'rectangle', 'x': x, 'y': y, 'w': 160, 'h': 80, 'label': label},
                   'clientRef': f'ref-{i}'}})
        check(f'add {label}', status == 200, body)
        if status == 200:
            shape_ids[label] = body['ids'][f'ref-{i}']
            seq = body['seq']

    connectors = [('Intake', 'e', 'Review', 'w'), ('Archive', 'e', 'Store', 'w'), ('Log', 'e', 'Store', 'w')]
    conn_ids = []
    for i, (f, fp, t, tp) in enumerate(connectors):
        status, body = req('POST', f'/api/diagrams/{did}/operations', {
            'opId': f'conn-{i}', 'baseSeq': seq,
            'op': {'kind': 'add_connector', 'page': page_id,
                   'from': {'shape': shape_ids[f], 'port': fp},
                   'to': {'shape': shape_ids[t], 'port': tp},
                   'label': '', 'clientRef': f'cref-{i}'}})
        check(f'connect {f}->{t}', status == 200, body)
        if status == 200:
            conn_ids.append(body['ids'][f'cref-{i}'])
            seq = body['seq']

    status, body = req('GET', f'/api/diagrams/{did}/document')
    routes = {c['id']: c['route'] for p in body['pages'] for c in p['connectors']}
    check('route derived 2pt straight', len(routes[conn_ids[0]]) == 2, routes.get(conn_ids[0]))

    status, body = req('POST', f'/api/diagrams/{did}/operations', {
        'opId': 'mv-archive', 'baseSeq': seq,
        'op': {'kind': 'update_shape', 'shape': shape_ids['Archive'], 'set': {'x': 200, 'y': 300}}})
    check('move Archive', status == 200, body)
    rerouted = body.get('rerouted', [])
    check('rerouted includes Log-Store', conn_ids[2] in rerouted, rerouted)
    seq = body['seq']

    status, body = req('POST', f'/api/diagrams/{did}/operations', {
        'opId': 'us-deleted', 'baseSeq': seq,
        'op': {'kind': 'update_shapes', 'shapes': [
            {'shape': shape_ids['Intake'], 'set': {'x': 8}},
            {'shape': 's_nonexistent00', 'set': {'x': 16}}]}})
    check('update_shapes unknown 409', status == 409 and body['error']['code'] == 'shape_deleted', body)

    status, body = req('POST', f'/api/diagrams/{did}/operations', {
        'opId': 'us-route', 'baseSeq': seq,
        'op': {'kind': 'update_shape', 'shape': shape_ids['Intake'], 'set': {'x': 8, 'route': [[0, 0]]}}})
    check('set.route 422 dotted', status == 422 and 'op.set.route' in body['error']['fields'], body)

    for email, role in [(bea_email, 'editor'), (cy_email, 'viewer')]:
        status, body = req('POST', f'/api/diagrams/{did}/invites', {'email': email, 'role': role})
        check(f'invite {role}', status == 201, body)

    status, body = req('POST', f'/api/diagrams/{did}/comments', {
        'shape': shape_ids['Intake'], 'text': f'Hello @{bea_email}, look here'})
    check('post comment', status == 201, body)
    cid = body['comment']['id']
    status, body = req('POST', f'/api/diagrams/{did}/comments/{cid}/resolve')
    check('resolve comment', status == 200 and body['comment']['resolved'] is True, body)

    status, body = req('POST', f'/api/diagrams/{did}/versions', {'name': 'Checkpoint'})
    check('save version', status == 201, body)
    vid = body['version']['id']
    status, body = req('GET', f'/api/diagrams/{did}/versions/{vid}')
    check('get version document', status == 200 and 'document' in body, body)
    status, body = req('POST', f'/api/diagrams/{did}/versions/{vid}/restore')
    check('restore version', status == 200, body)

    status, body = req('POST', f'/api/diagrams/{did}/exports', {
        'page': page_id, 'format': 'svg', 'scale': 1, 'background': 'white'})
    check('export svg 202', status == 202, body)
    eid = body['id']
    time.sleep(2)
    status, body = req('GET', f'/api/exports/{eid}')
    check('export ready', status == 200 and body['status'] == 'ready', body)
    status, svg = req('GET', f'/api/exports/{eid}/file', raw=True)
    check('svg data-seq', status == 200 and b'data-seq=' in svg, svg[:120])

    status, body = req('POST', f'/api/diagrams/{did}/exports', {
        'page': page_id, 'format': 'png', 'scale': 2, 'background': 'transparent'})
    status2, body2 = req('POST', f'/api/diagrams/{did}/exports', {
        'page': page_id, 'format': 'png', 'scale': 2, 'background': 'transparent'})
    check('export dedup same id', body.get('id') == body2.get('id'), (body, body2))

    status, body = req('POST', f'/api/diagrams/{did}/operations', {
        'opId': 'x-origin', 'baseSeq': seq,
        'op': {'kind': 'delete_connector', 'connector': conn_ids[0]}},
        headers={'origin': 'http://evil.example'})
    check('cross origin 403', status == 403 and body['error']['code'] == 'cross_origin', body)

    r = urllib.request.Request(BASE + f'/api/diagrams/{did}/operations', data=b'not json', method='POST')
    r.add_header('content-type', 'application/json')
    try:
        resp = opener.open(r)
        status = resp.status
        body = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        status = e.code
        body = json.loads(e.read())
    check('non-json 415', status == 415 and body['error']['code'] == 'unsupported_media_type', body)

    status, body = req('GET', '/package.json')
    check('package.json 404', status == 404, body)
    status, body = req('GET', '/dist/server.cjs')
    check('server bundle 404', status == 404, body)
    status, body = req('GET', '/main.js.map')
    check('source map 404', status == 404, body)

    status, body = req('POST', '/api/grading/seed', {
        'users': [{'email': f'seed{suffix}@linewell.test', 'name': 'Seeder', 'password': 'drafting-seed-04'}],
        'diagrams': []})
    check('grading seed minimal', status == 201, body)

    status, body = req('POST', '/api/grading/save-outage', {'diagramId': did, 'ms': 2000})
    check('save outage 200', status == 200 and 'until' in body, body)
    status, body = req('POST', f'/api/diagrams/{did}/operations', {
        'opId': 'during-outage', 'baseSeq': seq,
        'op': {'kind': 'update_shape', 'shape': shape_ids['Intake'], 'set': {'x': 16}}})
    check('operation during outage 503', status == 503 and body['error']['code'] == 'save_unavailable', body)

    time.sleep(2.2)
    status, body = req('POST', f'/api/diagrams/{did}/operations', {
        'opId': 'after-outage', 'baseSeq': seq,
        'op': {'kind': 'update_shape', 'shape': shape_ids['Intake'], 'set': {'x': 24}}})
    check('operation after outage 200', status == 200, body)

    print(f'\n{passed} passed, {failed} failed')
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    main()
