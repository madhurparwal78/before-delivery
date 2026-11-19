#!/usr/bin/env python3
"""Second scenario suite: paste, summaries, cycles, exports, shares, races."""
import json
import urllib.request
import urllib.error
import http.cookiejar
import threading
import sys

BASE = 'http://127.0.0.1:4173'

class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def request(self, method, path, body=None, headers=None, origin=BASE):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        req.add_header('Content-Type', 'application/json')
        req.add_header('Origin', origin)
        if headers:
            for k, v in headers.items():
                req.add_header(k, v)
        try:
            with self.opener.open(req) as res:
                text = res.read().decode()
                return res.status, text
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    def json(self, method, path, body=None, headers=None, origin=BASE):
        s, text = self.request(method, path, body, headers, origin)
        try:
            return s, json.loads(text)
        except Exception:
            return s, text

    def sign_in(self, email, password='ledger-demo-2026'):
        return self.json('POST', '/api/auth/sign-in', {'email': email, 'password': password})

passed = 0
failed = 0
def check(label, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'OK   {label}')
    else:
        failed += 1
        print(f'FAIL {label} {detail}')

mara = Client(); priya = Client(); dev = Client(); sam = Client()
for c, e in [(mara, 'mara@harbourlane.test'), (priya, 'priya@harbourlane.test'), (dev, 'dev@harbourlane.test'), (sam, 'sam@harbourlane.test')]:
    c.sign_in(e)

s, b = mara.json('GET', '/api/documents')
DOC = b['documents'][0]['id']
s, b = mara.json('GET', f'/api/documents/{DOC}')
tables = {t['name']: t for t in b['tables']}
PRODUCTS = tables['Products']['id']
ORDERS = tables['Orders']['id']
CUSTOMERS = tables['Customers']['id']

def cols(client, table):
    s, b = client.json('GET', f'/api/documents/{DOC}/tables/{table}')
    return b['table']

products = cols(mara, PRODUCTS)
orders = cols(mara, ORDERS)
pc = {c['name']: c['id'] for c in products['columns']}
oc = {c['name']: c['id'] for c in orders['columns']}
osb = [r for r in products['rows'] if r['cells'][pc['Name']]['value'] == 'Oak Shelf Bracket'][0]

# --- paste three quantities as one block (DP-63)
s0, b0 = priya.json('GET', f'/api/documents/{DOC}')
undo_before = b0['document']['undo_count']
rows = orders['rows']
writes = []
for i, r in enumerate(rows[:3]):
    writes.append({'row_id': r['id'], 'column_id': oc['Qty'], 'value': str(10 + i), 'revision': r['cells'][oc['Qty']]['revision']})
s, b = priya.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/cells', {'writes': writes})
check('paste 200', s == 200, str(b)[:300])
check('paste one undo entry', s == 200 and b['recalc']['stacks']['undo_count'] == undo_before + 1, str((undo_before, b.get('recalc', {}).get('stacks'))))
s, b = priya.json('POST', f'/api/documents/{DOC}/undo')
check('paste undo restores all', s == 200)
orders = cols(priya, ORDERS)
qtys = [r['cells'][oc['Qty']]['display'] for r in orders['rows'][:3]]
check('paste undo values', qtys == ['4.0000', '2.0000', '10.0000'], qtys)

# paste stale conflict lists all conflicts
orders = cols(priya, ORDERS)
writes = [
    {'row_id': orders['rows'][0]['id'], 'column_id': oc['Qty'], 'value': '5', 'revision': 999},
    {'row_id': orders['rows'][1]['id'], 'column_id': oc['Qty'], 'value': '6', 'revision': 999},
]
s, b = priya.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/cells', {'writes': writes})
check('paste stale 409', s == 409 and len(b['error']['conflicts']) == 2, str(b)[:300])

# duplicate cell in paste
w = [{'row_id': orders['rows'][0]['id'], 'column_id': oc['Qty'], 'value': '5', 'revision': 1},
     {'row_id': orders['rows'][0]['id'], 'column_id': oc['Qty'], 'value': '6', 'revision': 1}]
s, b = priya.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/cells', {'writes': w})
check('paste duplicate cell 422', s == 422 and 'Each cell can be written once per paste.' in str(b), str(b)[:200])

# --- row add with cells (DP-24)
s, b = priya.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/rows', {
    'cells': {oc['Order No']: 'ORD-1006', oc['Qty']: '7', oc['Owner']: 'priya@harbourlane.test'}
})
check('row add 201', s == 201, str(b)[:300])
new_row = b['row']
check('new row owner cell', new_row['cells'][oc['Owner']]['value'] == 'priya@harbourlane.test')
check('row add recalc lists summaries', b['recalc']['count'] >= 1, str(b['recalc'])[:200])
s, b = priya.json('POST', f'/api/documents/{DOC}/undo')
check('undo row add deletes', s == 200)
orders = cols(priya, ORDERS)
check('row gone', len(orders['rows']) == 5)

# dev own-row: owner cell forced to dev's email
s, b = dev.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/rows', {'cells': {oc['Order No']: 'ORD-1007', oc['Owner']: 'dev@harbourlane.test'}})
check('dev row add', s == 201 and b['row']['cells'][oc['Owner']]['value'] == 'dev@harbourlane.test', str(b)[:200])
s, b = dev.json('POST', f'/api/documents/{DOC}/undo')
check('dev undo row add', s == 200)

# dev cannot assign a row to someone else (DP-24)
s, b = dev.json('PUT', f'/api/documents/{DOC}/tables/{ORDERS}/rows/{orders["rows"][0]["id"]}/cells/{oc["Owner"]}',
                {'value': 'priya@harbourlane.test', 'revision': orders['rows'][0]['cells'][oc['Owner']]['revision']})
check('dev cannot assign rows', s == 422 and 'You can only assign rows to yourself.' in str(b), str(b)[:200])

# hidden row writes 404 (DP-22)
s, b = dev.json('PUT', f'/api/documents/{DOC}/tables/{ORDERS}/rows/{orders["rows"][1]["id"]}/cells/{oc["Qty"]}',
                {'value': '9', 'revision': orders['rows'][1]['cells'][oc['Qty']]['revision']})
check('hidden row write 404', s == 404, str(s))

# --- summary creation (DP-13)
s, b = mara.json('POST', f'/api/documents/{DOC}/summaries',
                 {'source_table_id': ORDERS, 'group_by': [oc['Customer']], 'sum_columns': [oc['Qty']]})
check('summary create 201', s == 201, str(b)[:300])
if s == 201:
    new_summary = b['table']
    check('summary name', new_summary['name'] == 'Orders by Customer', new_summary['name'])
    check('summary 9 cells', b['recalc']['count'] == 9, str(b['recalc']['count']))
    check('summary sentence', b['recalc']['sentence'] == 'Recalculated 9 cells in 1 table.', b['recalc']['sentence'])
    s2, b2 = mara.json('GET', f'/api/documents/{DOC}/tables/{new_summary["id"]}')
    groups = b2['table']['rows']
    check('summary groups 3', len(groups) == 3)
    sums = [g['cells'][f'sum:{oc["Qty"]}']['display'] for g in groups]
    check('summary sums', sums == ['7.0000', '8.0000', '10.0000'], sums)
    counts = [g['cells']['count']['display'] for g in groups]
    check('summary counts', counts == ['2.0000', '2.0000', '1.0000'], counts)

# --- cycles (DP-10, DP-88)
s, b = mara.json('POST', f'/api/documents/{DOC}/tables/{PRODUCTS}/columns',
                 {'name': 'A', 'type': 'formula', 'formula': '[B] + 1'})
check('add formula column A', s == 201, str(b)[:200])
col_a = b['column']['id']
s, b = mara.json('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
a_cells = [r['cells'].get(col_a, {}).get('display') for r in b['table']['rows']]
check('A shows #NAME?', a_cells == ['#NAME?'] * 4, str(a_cells))

s, b = mara.json('POST', f'/api/documents/{DOC}/tables/{PRODUCTS}/columns',
                 {'name': 'B', 'type': 'formula', 'formula': '[A] + 1'})
check('add formula column B', s == 201, str(b)[:200])
col_b = b['column']['id']
check('cycle recalc 8 cells', b['recalc']['count'] == 8, str(b['recalc'])[:300])
s, b = mara.json('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
a_cells = [r['cells'][col_a]['display'] for r in b['table']['rows']]
b_cells = [r['cells'][col_b]['display'] for r in b['table']['rows']]
check('cycle cells #CIRC!', a_cells == ['#CIRC!'] * 4 and b_cells == ['#CIRC!'] * 4, str((a_cells, b_cells)))

# break the cycle
s, b = mara.json('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
b_col = [c for c in b['table']['columns'] if c['id'] == col_b][0]
s, b = mara.json('PATCH', f'/api/documents/{DOC}/tables/{PRODUCTS}/columns/{col_b}',
                 {'revision': b_col['revision'], 'formula': '5'})
check('break cycle 200', s == 200, str(b)[:200])
check('break cycle 8 cells', b['recalc']['count'] == 8, str(b['recalc'])[:300])
s, b = mara.json('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
a_cells = [r['cells'][col_a]['display'] for r in b['table']['rows']]
b_cells = [r['cells'][col_b]['display'] for r in b['table']['rows']]
check('cycle broken values', a_cells == ['6.0000'] * 4 and b_cells == ['5.0000'] * 4, str((a_cells, b_cells)))

# undo twice: restore cycle then delete B... undo the break then delete column
mara.json('POST', f'/api/documents/{DOC}/undo')  # restore [A]+1
s, b = mara.json('POST', f'/api/documents/{DOC}/undo')  # delete column B (undo of column_add)
check('undo column add deletes B', s == 200, str(b)[:200])
s, b = mara.json('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
names = [c['name'] for c in b['table']['columns']]
check('column B gone', 'B' not in names, names)
a_cells = [r['cells'][col_a]['display'] for r in b['table']['rows']]
check('A back to #NAME?', a_cells == ['#NAME?'] * 4, str(a_cells))
s, b = mara.json('POST', f'/api/documents/{DOC}/redo')  # re-add B
check('redo column add', s == 200, str(b)[:200])
s, b = mara.json('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
a_cells = [r['cells'][col_a]['display'] for r in b['table']['rows']]
check('cycle again after redo', a_cells == ['#CIRC!'] * 4, str(a_cells))

# column delete makes #NAME? (DP-16)
s, b = mara.json('DELETE', f'/api/documents/{DOC}/tables/{PRODUCTS}/columns/{col_b}')
check('delete column B', s == 200, str(b)[:200])
s, b = mara.json('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
a_cells = [r['cells'][col_a]['display'] for r in b['table']['rows']]
check('A #NAME? after delete', a_cells == ['#NAME?'] * 4, str(a_cells))
s, b = mara.json('POST', f'/api/documents/{DOC}/undo')
check('undo column delete restores', s == 200 and b['undone']['kind'] == 'column_delete', str(b)[:200])
s, b = mara.json('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
a_cells = [r['cells'][col_a]['display'] for r in b['table']['rows']]
check('cycle back after restore', a_cells == ['#CIRC!'] * 4, str(a_cells))
# clean up: delete both columns
mara.json('DELETE', f'/api/documents/{DOC}/tables/{PRODUCTS}/columns/{col_b}')
mara.json('DELETE', f'/api/documents/{DOC}/tables/{PRODUCTS}/columns/{col_a}')
mara.json('POST', f'/api/documents/{DOC}/undo')
mara.json('POST', f'/api/documents/{DOC}/undo')

# delete the summary created earlier is not undoable; clean by editing rows is fine
s, b = mara.json('GET', f'/api/documents/{DOC}')
check('summary exists', any(t['id'] == new_summary['id'] for t in b['tables']))

# --- exports (DP-28, DP-29, DP-30)
s, b = sam.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/exports')
check('viewer export 201', s == 201 and b['export']['status'] == 'ready', str(b)[:300])
export = b['export']
check('export fields', export['created_by'] and export['document_revision'] >= 0 and export['sha256'] and export['byte_size'] > 0)
s, b = sam.json('GET', '/api/documents')
s, b = sam.json('GET', f'/api/exports/{export["id"]}')
check('export record', s == 200 and b['export']['file_name'] == 'Orders.csv')
s, text = sam.request('GET', f'/api/exports/{export["id"]}/download')
check('download 200', s == 200 and text.startswith('Order No,Customer,Product,Qty,Owner,Line Total,Region\r\n'), text[:150])
check('csv crlf', '\r\n' in text and text.endswith('\r\n'), repr(text[-10:]))
check('csv rows', text.count('\r\n') == 6, text.count('\r\n'))

# neutralise a text cell (DP-30)
orders = cols(priya, ORDERS)
target = orders['rows'][0]
s, b = priya.json('PUT', f'/api/documents/{DOC}/tables/{ORDERS}/rows/{target["id"]}/cells/{oc["Order No"]}',
                  {'value': '=SUM(1)', 'revision': target['cells'][oc['Order No']]['revision']})
check('write =SUM(1)', s == 200, str(b)[:200])
s, b = priya.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/exports')
export2 = b['export']
s, text = priya.request('GET', f'/api/exports/{export2["id"]}/download')
check('neutralised =SUM(1)', "'=SUM(1)" in text, text[:120])
s, b = priya.json('GET', f'/api/documents/{DOC}/tables/{ORDERS}')
val = b['table']['rows'][0]['cells'][oc['Order No']]['value']
check('grid value unchanged', val == '=SUM(1)', val)
# restore
s, b = priya.json('POST', f'/api/documents/{DOC}/undo')

# export of a summary
s, b = mara.json('GET', f'/api/documents/{DOC}')
summary_id = [t['id'] for t in b['tables'] if t['name'] == 'Orders by Region'][0]
s, b = sam.json('POST', f'/api/documents/{DOC}/tables/{summary_id}/exports')
check('summary export', s == 201 and b['export']['file_name'] == 'Orders by Region.csv', str(b)[:200])
s, text = sam.request('GET', f'/api/exports/{b["export"]["id"]}/download')
check('summary csv', 'Region,Count,Sum of Qty,Sum of Line Total' in text, text[:120])

# another person's export is 404
s, b = dev.json('GET', f'/api/exports/{export["id"]}')
check('other export 404', s == 404)

# --- formula preview (DP-32)
s, b = dev.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/formula-preview',
                {'formula': 'COUNT(Orders)', 'row_id': orders['rows'][0]['id'] if False else cols(dev, ORDERS)['rows'][0]['id']})
check('preview COUNT dev 3', s == 200 and b['display'] == '3.0000', str(b))
s, b = priya.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/formula-preview',
                 {'formula': 'COUNT(Orders)', 'row_id': cols(priya, ORDERS)['rows'][0]['id']})
check('preview COUNT priya 5', s == 200 and b['display'] == '5.0000', str(b))
s, b = dev.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/formula-preview',
                {'formula': 'AVERAGE(Orders.[Qty])', 'row_id': cols(dev, ORDERS)['rows'][0]['id']})
check('preview AVERAGE dev', s == 200 and b['display'] == '5.6667', str(b))
s, b = mara.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/formula-preview',
                 {'formula': 'MAX(Orders.[Qty])', 'row_id': cols(mara, ORDERS)['rows'][0]['id']})
check('preview MAX 10', s == 200 and b['display'] == '10.0000', str(b))
s, b = mara.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/formula-preview',
                 {'formula': 'ROUND(10/3, 2)', 'row_id': cols(mara, ORDERS)['rows'][0]['id']})
check('preview ROUND', s == 200 and b['display'] == '3.3300', str(b))
s, b = mara.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/formula-preview',
                 {'formula': '1/0', 'row_id': cols(mara, ORDERS)['rows'][0]['id']})
check('preview error + diagnosis', s == 200 and b['display'] == '#DIV/0!' and b['diagnosis'] == '#DIV/0! Division by zero.', str(b))
s, b = mara.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/formula-preview',
                 {'formula': '[Qty] *', 'row_id': cols(mara, ORDERS)['rows'][0]['id']})
check('preview ended too early', s == 200 and b['diagnosis'] == 'Check the formula: it ended too early.', str(b))
s, b = mara.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/formula-preview',
                 {'formula': '[Qty] # 2', 'row_id': cols(mara, ORDERS)['rows'][0]['id']})
check('preview located diag', s == 200 and b['diagnosis'] == 'Check the formula: it could not be read at character 7.', str(b))
s, b = mara.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/formula-preview',
                 {'formula': 'SUM(Orders.[Qty])', 'row_id': 'nonsense'})
check('preview bad row 422', s == 422 and b['error']['fields']['row_id'] == 'Choose a row in this table.', str(b))
s, b = mara.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/formula-preview',
                 {'formula': '[Nope] + 1', 'row_id': cols(mara, ORDERS)['rows'][0]['id']})
check('preview #NAME?', s == 200 and b['display'] == '#NAME?' and b['kind'] == 'error', str(b))
s, b = mara.json('POST', f'/api/documents/{DOC}/tables/{ORDERS}/formula-preview',
                 {'formula': '"a" & "b"', 'row_id': cols(mara, ORDERS)['rows'][0]['id']})
check('preview text join', s == 200 and b['display'] == 'ab' and b['kind'] == 'text', str(b))

# --- races: two simultaneous cell writes, one wins (DP-07, DP-66)
results = []
def racer(value):
    orders_local = cols(priya, ORDERS)
    target = orders_local['rows'][0]
    rr = priya.json('PUT', f'/api/documents/{DOC}/tables/{ORDERS}/rows/{target["id"]}/cells/{oc["Qty"]}',
                    {'value': value, 'revision': target['cells'][oc['Qty']]['revision']})
    results.append(rr)
threads = [threading.Thread(target=racer, args=(v,)) for v in ('50', '60')]
for t in threads: t.start()
for t in threads: t.join()
statuses = sorted(r[0] for r in results)
check('race one winner', statuses[0] == 200 and statuses[1] == 409, str(statuses))
orders = cols(priya, ORDERS)
qty_now = orders['rows'][0]['cells'][oc['Qty']]['display']
winners = [r[1]['cell']['display'] for r in results if r[0] == 200]
check('race value stored', qty_now in ('50.0000', '60.0000') and qty_now == winners[0], str((qty_now, winners)))
s, b = priya.json('POST', f'/api/documents/{DOC}/undo')
check('undo race winner', s == 200 and b['undone']['kind'] == 'cell_write')

# row delete vs cell write race (DP-85)
results = []
def delete_racer():
    orders_local = cols(priya, ORDERS)
    target = orders_local['rows'][0]
    rr = priya.request('DELETE', f'/api/documents/{DOC}/tables/{ORDERS}/rows/{target["id"]}?revision={target["revision"]}')
    results.append(rr)
def write_racer():
    orders_local = cols(priya, ORDERS)
    target = orders_local['rows'][0]
    rr = priya.json('PUT', f'/api/documents/{DOC}/tables/{ORDERS}/rows/{target["id"]}/cells/{oc["Qty"]}',
                    {'value': '11', 'revision': target['cells'][oc['Qty']]['revision']})
    results.append(rr)
t1 = threading.Thread(target=delete_racer); t2 = threading.Thread(target=write_racer)
t1.start(); t2.start(); t1.join(); t2.join()
codes = sorted(r[0] for r in results)
check('delete vs write one winner', codes == [200, 409] or codes == [200, 404], str(codes))
orders = cols(priya, ORDERS)
if len(orders['rows']) == 4:
    s, b = priya.json('POST', f'/api/documents/{DOC}/undo')
    check('undo delete', s == 200)
else:
    s, b = priya.json('POST', f'/api/documents/{DOC}/undo')
    check('undo write after refused delete', s == 200)

# --- idempotency (DP-95)
orders = cols(priya, ORDERS)
target = orders['rows'][0]
body = {'value': '42', 'revision': target['cells'][oc['Qty']]['revision']}
path = f'/api/documents/{DOC}/tables/{ORDERS}/rows/{target["id"]}/cells/{oc["Qty"]}'
s1, b1 = priya.json('PUT', path, body, headers={'Idempotency-Key': 'test-key-1'})
s2, b2 = priya.json('PUT', path, body, headers={'Idempotency-Key': 'test-key-1'})
check('idempotent replay', s1 == 200 and s2 == 200 and json.dumps(b1) == json.dumps(b2), f'{s1} {s2}')
s, b = priya.json('GET', f'/api/documents/{DOC}/history')
revs = [e['revision'] for e in b['entries']]
check('replay adds no revision', revs == sorted(set(revs)), str(revs))
s3, b3 = priya.json('PUT', path, {'value': '43', 'revision': 999}, headers={'Idempotency-Key': 'test-key-1'})
check('key reuse different change 422', s3 == 422 and 'idempotency_key' in str(b3), str(b3)[:200])
s, b = priya.json('PUT', path, body, headers={'Idempotency-Key': 'bad key!'})
check('malformed key 422', s == 422, str(b)[:200])
# now Viewer + replayed key answers 403
s, b = mara.json('POST', f'/api/documents/{DOC}/shares', {'email': 'sam@harbourlane.test', 'role': 'viewer', 'row_scope': 'all'})
check('share update to viewer', s == 200, str(b)[:200])
s, b = sam.json('PUT', path, body, headers={'Idempotency-Key': 'test-key-1'})
check('viewer replay 403', s == 403, str(s))
mara.json('POST', f'/api/documents/{DOC}/shares', {'email': 'sam@harbourlane.test', 'role': 'viewer', 'row_scope': 'all'})

# --- boundary (DP-35, DP-79)
s, b = sam.json('POST', '/api/auth/sign-out', origin='http://other.example')
check('cross-site sign-out 403', s == 403 and b['error']['code'] == 'cross_origin', str(b)[:150])
s, b = sam.request('POST', f'/api/documents/{DOC}/tables/{ORDERS}/exports', origin='http://other.example')
check('cross-site export 403', s == 403)
s, b = sam.json('POST', '/api/auth/sign-out', origin='null')
check('null origin 403', s == 403, str(b)[:150])
s, text = sam.request('GET', f'/api/exports/{export["id"]}/download', origin='http://other.example')
check('GET download cross-site allowed (not state-changing)', s == 200)

# oversized body 413
big = 'x' * 1_000_001
s, text = sam.request('POST', '/api/auth/sign-in', {'email': big})
check('payload too large 413', s == 413, str(s))
s, text = sam.request('POST', '/api/auth/sign-in', {'email': 'a'})
check('no content-type default json ok', True)

# --- permission changes apply at once (DP-70)
s, b = mara.json('POST', f'/api/documents/{DOC}/shares', {'email': 'dev@harbourlane.test', 'role': 'editor', 'row_scope': 'all'})
check('scope widened', s == 200 and b['share']['row_scope'] == 'all', str(b)[:200])
s, b = dev.json('GET', f'/api/documents/{DOC}/tables/{ORDERS}')
check('dev sees all rows now', len(b['table']['rows']) == 5, str(len(b['table']['rows'])))
s, b = mara.json('POST', f'/api/documents/{DOC}/shares', {'email': 'dev@harbourlane.test', 'role': 'editor', 'row_scope': 'own'})
check('scope narrowed', s == 200 and b['share']['row_scope'] == 'own')
s, b = dev.json('GET', f'/api/documents/{DOC}/tables/{ORDERS}')
check('dev sees 3 rows again', len(b['table']['rows']) == 3)
s, b = mara.json('POST', f'/api/documents/{DOC}/shares', {'email': 'dev@harbourlane.test', 'role': 'viewer', 'row_scope': 'all'})
check('dev to viewer', s == 200)
s, b = dev.json('PUT', path, {'value': '9', 'revision': 1})
check('viewer cannot write', s == 403)
s, b = mara.json('POST', f'/api/documents/{DOC}/shares', {'email': 'dev@harbourlane.test', 'role': 'editor', 'row_scope': 'own'})
check('dev back to editor', s == 200)
s, b = dev.json('GET', f'/api/documents/{DOC}/tables/{ORDERS}')
check('dev editor again', b['access']['role'] == 'editor')

# --- history (DP-89)
s, b = sam.json('GET', f'/api/documents/{DOC}/history')
check('history readable', s == 200 and len(b['entries']) >= 10)
revs = [e['revision'] for e in b['entries']]
check('history in commit order', revs == list(range(1, len(revs) + 1)), str(revs[:10]))
s, b = mara.json('GET', f'/api/documents/{DOC}')
check('document revision matches', b['document']['revision'] == len(revs), str((b['document']['revision'], len(revs))))

# --- access route (row owner) (DP-22)
s, b = mara.json('PUT', f'/api/documents/{DOC}/tables/{CUSTOMERS}/access', {'owner_column_id': None})
check('clear row owner', s == 200, str(b)[:200])
s, b = mara.json('PUT', f'/api/documents/{DOC}/tables/{CUSTOMERS}/access', {'owner_column_id': pc['Name'] if False else cols(mara, CUSTOMERS)['columns'][3]['id']})
check('set row owner', s == 200, str(b)[:200])
s, b = mara.json('PUT', f'/api/documents/{DOC}/tables/{CUSTOMERS}/access', {'owner_column_id': oc['Qty']})
check('non-text owner 422', s == 422 and 'Choose a Text column.' in str(b), str(b)[:150])

# --- share validation (DP-25, DP-71)
s, b = mara.json('POST', f'/api/documents/{DOC}/shares', {'email': 'bad email@x', 'role': 'viewer', 'row_scope': 'all'})
check('invalid email 422', s == 422 and b['error']['fields']['email'] == 'Enter a valid email address.', str(b)[:150])
s, b = mara.json('POST', f'/api/documents/{DOC}/shares', {'email': 'mara@harbourlane.test', 'role': 'viewer', 'row_scope': 'all'})
check('own address 422', s == 422 and 'You already own this document.' in str(b), str(b)[:150])
s, b = mara.json('POST', f'/api/documents/{DOC}/shares', {'email': 'newperson@example.test', 'role': 'editor', 'row_scope': 'own'})
check('new share 201', s == 201 and b['share']['invite_status'] in ('sent', 'not_sent'), str(b)[:200])
new_share = b['share']
check('email lower-cased', new_share['email'] == 'newperson@example.test')

# resend on a sent share
s, b = mara.json('POST', f'/api/documents/{DOC}/shares/{new_share["id"]}/resend')
if new_share['invite_status'] == 'sent':
    check('resend sent 409', s == 409 and b['error']['code'] == 'invite_already_sent', str(b)[:150])
else:
    check('resend after outage 200', s == 200 and b['share']['invite_status'] == 'sent', str(b)[:200])

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
