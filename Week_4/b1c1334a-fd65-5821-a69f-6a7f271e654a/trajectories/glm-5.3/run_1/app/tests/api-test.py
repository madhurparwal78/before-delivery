#!/usr/bin/env python3
"""End-to-end API verification against the seeded Tallyframe."""
import json
import urllib.request
import urllib.error
import http.cookiejar
import sys

BASE = 'http://127.0.0.1:4173'

class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def request(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        req.add_header('Content-Type', 'application/json')
        if headers:
            for k, v in headers.items():
                req.add_header(k, v)
        req.add_header('Origin', BASE)
        try:
            with self.opener.open(req) as res:
                text = res.read().decode()
                return res.status, json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            text = e.read().decode()
            try:
                return e.code, json.loads(text)
            except Exception:
                return e.code, text

    def sign_in(self, email, password='ledger-demo-2026'):
        return self.request('POST', '/api/auth/sign-in', {'email': email, 'password': password})

    def sign_out(self):
        return self.request('POST', '/api/auth/sign-out')

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

mara = Client()
priya = Client()
dev = Client()
sam = Client()
jonah = Client()

s, b = mara.sign_in('mara@harbourlane.test')
check('sign-in owner', s == 200 and b['user']['email'] == 'mara@harbourlane.test')
s1, b1 = mara.request('POST', '/api/auth/sign-in', {'email': 'mara@harbourlane.test', 'password': 'wrong'})
s2, b2 = mara.request('POST', '/api/auth/sign-in', {'email': 'unknown@x.test', 'password': 'x'})
check('401 identical (DP-01)', s1 == 401 and s2 == 401 and json.dumps(b1) == json.dumps(b2), f'{b1} vs {b2}')

for c, email in [(priya, 'priya@harbourlane.test'), (dev, 'dev@harbourlane.test'), (sam, 'sam@harbourlane.test'), (jonah, 'jonah@harbourlane.test')]:
    c.sign_in(email)

s, b = sam.request('GET', '/api/me')
check('me route (DP-02)', s == 200 and b['user']['email'] == 'sam@harbourlane.test')

s, b = priya.request('GET', '/api/documents')
check('documents list', s == 200 and any(d['name'] == 'Harbour Lane Ops' and d['role'] == 'editor' for d in b['documents']))
s, b = jonah.request('GET', '/api/documents')
check('no access documents empty', s == 200 and b['documents'] == [])

s, b = mara.request('GET', '/api/documents')
DOC = b['documents'][0]['id']
check('doc id found', bool(DOC))

s, b = priya.request('GET', '/api/documents/nonexistent')
check('unknown document 404', s == 404 and b['error']['code'] == 'not_found')

s, b = mara.request('GET', f'/api/documents/{DOC}')
check('document read', s == 200 and b['document']['revision'] >= 0)
tables = {t['name']: t for t in b['tables']}
check('seed tables', set(tables) == {'Products', 'Customers', 'Orders', 'Orders by Region'}, list(tables))
check('seed summary row counts', tables['Orders by Region']['row_count'] == 2 and tables['Orders']['row_count'] == 5)
check('summary column counts', tables['Orders by Region']['column_count'] == 4)
PRODUCTS = tables['Products']['id']
ORDERS = tables['Orders']['id']
CUSTOMERS = tables['Customers']['id']
SUMMARY = tables['Orders by Region']['id']

s, b = dev.request('GET', f'/api/documents/{DOC}/tables/{ORDERS}')
check('dev own rows 3', s == 200 and len(b['table']['rows']) == 3, str(len(b.get('table', {}).get('rows', []))))
check('dev access', b['access'] == {'role': 'editor', 'row_scope': 'own'})

s, b = dev.request('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
units_col = [c for c in b['table']['columns'] if c['name'] == 'Units Ordered'][0]['id']
left_col = [c for c in b['table']['columns'] if c['name'] == 'Stock Left'][0]['id']
price_col = [c for c in b['table']['columns'] if c['name'] == 'Price'][0]['id']
stock_col = [c for c in b['table']['columns'] if c['name'] == 'Stock'][0]['id']
units = [r['cells'][units_col]['display'] for r in b['table']['rows']]
check('dev units ordered view', units == ['4.0000', '0.0000', '10.0000', '3.0000'], units)
lefts = [r['cells'][left_col]['display'] for r in b['table']['rows']]
check('dev stock left view', lefts == ['36.0000', '12.0000', '140.0000', '22.0000'], lefts)

s, b = mara.request('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
mara_units = [r['cells'][units_col]['display'] for r in b['table']['rows']]
check('mara units ordered', mara_units == ['10.0000', '2.0000', '10.0000', '3.0000'], mara_units)

s, b = mara.request('GET', f'/api/documents/{DOC}/tables/{SUMMARY}')
rows = b['table']['rows']
cols = b['table']['columns']
first_col_id = cols[0]['id']
check('summary groups', [r['cells'][first_col_id]['display'] for r in rows] == ['North', 'South'])
count_id = [c['id'] for c in cols if c['id'] == 'count'][0]
check('summary count', rows[0]['cells'][count_id]['display'] == '3.0000')
sum_ids = [c['id'] for c in cols if c['id'].startswith('sum:')]
check('summary sum ids', len(sum_ids) == 2)

s, b = dev.request('GET', f'/api/documents/{DOC}/tables/{SUMMARY}')
check('dev summary one group', len(b['table']['rows']) == 1)

s, b = mara.request('GET', f'/api/documents/{DOC}/tables/{ORDERS}')
order_cols = {c['name']: c['id'] for c in b['table']['columns']}
qty_col = order_cols['Qty']
total_col = order_cols['Line Total']
region_col = order_cols['Region']
prod_ref_col = order_cols['Product']
order_rows = b['table']['rows']
check('line totals', [r['cells'][total_col]['display'] for r in order_rows] == ['50.0000', '136.0000', '97.5000', '75.0000', '123.6000'])
check('regions', [r['cells'][region_col]['display'] for r in order_rows] == ['North', 'South', 'North', 'South', 'North'])
check('reference display', order_rows[0]['cells'][prod_ref_col]['display'] == 'Oak Shelf Bracket')

osb_row_id = order_rows[0]['cells'][prod_ref_col]['value']

s, b = mara.request('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
osb_row = [r for r in b['table']['rows'] if r['id'] == osb_row_id][0]
price_cell = osb_row['cells'][price_col]
rev_before = b['document_revision'] if 'document_revision' in b else None
s, b = mara.request('PUT', f'/api/documents/{DOC}/tables/{PRODUCTS}/rows/{osb_row["id"]}/cells/{price_col}',
                    {'value': '13', 'revision': price_cell['revision']})
check('price write 200', s == 200, str(b))
if s == 200:
    recalc = b['recalc']
    check('price recalc 4 cells', recalc['count'] == 4 and recalc['tables'] == 2, json.dumps(recalc['cells'], default=str))
    check('price recalc sentence', recalc['sentence'] == 'Recalculated 4 cells in 2 tables.', recalc['sentence'])
    check('price cell display', b['cell']['display'] == '13.0000')
    check('price stacks', recalc['stacks'] == {'undo_count': 1, 'redo_count': 0}, str(recalc['stacks']))

s, b = mara.request('PUT', f'/api/documents/{DOC}/tables/{PRODUCTS}/rows/{osb_row["id"]}/cells/{price_col}',
                    {'value': '99', 'revision': price_cell['revision']})
check('stale cell 409', s == 409 and b['error']['code'] == 'stale_revision' and b['error']['current']['display'] == '13.0000', str(b))

s, b = mara.request('PUT', f'/api/documents/{DOC}/tables/{PRODUCTS}/rows/{osb_row["id"]}/cells/{price_col}',
                    {'value': '1e3', 'revision': 2})
check('invalid decimal 422', s == 422 and b['error']['fields']['value'] == 'Enter a number with up to 15 digits before the decimal point.', str(b))

s, b = mara.request('POST', f'/api/documents/{DOC}/undo', headers={'Idempotency-Key': 'undo-price-1'})
check('undo 200', s == 200 and b['undone']['kind'] == 'cell_write', str(b))
check('undo sentence', b['recalc']['sentence'] == 'Recalculated 4 cells in 2 tables.', str(b['recalc']['sentence']))
s, b = mara.request('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
osb_after_undo = [r for r in b['table']['rows'] if r['id'] == osb_row_id][0]
check('undo restored the value', osb_after_undo['cells'][price_col]['display'] == '12.5000', str(osb_after_undo['cells'][price_col]))

s, b = mara.request('POST', f'/api/documents/{DOC}/redo')
check('redo 200', s == 200 and b['redone']['kind'] == 'cell_write')

mara.request('POST', f'/api/documents/{DOC}/undo')
s, b = mara.request('POST', f'/api/documents/{DOC}/undo')
check('nothing to undo 409', s == 409 and b['error']['code'] == 'nothing_to_undo', str(b))

s, b = sam.request('POST', f'/api/documents/{DOC}/undo')
check('viewer undo 403', s == 403 and b['error']['code'] == 'forbidden')

s, b = sam.request('PUT', f'/api/documents/{DOC}/tables/{PRODUCTS}/rows/{osb_row["id"]}/cells/{stock_col}',
                   {'value': '5', 'revision': 1})
check('viewer write 403', s == 403)

s, b = priya.request('PATCH', f'/api/documents/{DOC}/tables/{PRODUCTS}/columns/{price_col}',
                     {'revision': 1, 'name': 'New Price'})
check('editor rename 403', s == 403)

s, b = priya.request('PATCH', f'/api/documents/{DOC}/tables/{ORDERS}/columns/{total_col}',
                     {'revision': 1, 'formula': '[Qty] * [Product].[Price]'})
check('editor formula change 200', s == 200, str(b))

s, b = priya.request('PATCH', f'/api/documents/{DOC}/tables/{ORDERS}/columns/{total_col}',
                     {'revision': 2, 'formula': '[Qty] * * 2'})
check('formula diag 422', s == 422 and b['error']['fields']['formula'] == 'Check the formula: it could not be read at character 9.', str(b))

s, b = priya.request('PATCH', f'/api/documents/{DOC}/tables/{ORDERS}/columns/{total_col}',
                     {'revision': 2, 'formula': '=[Qty] * [Product].[Price]'})
check('equals stripped', s == 200 and b['column']['formula'] == '[Qty] * [Product].[Price]', str(b.get('column')))

s, b = mara.request('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
price_column = [c for c in b['table']['columns'] if c['id'] == price_col][0]
s, b = mara.request('PATCH', f'/api/documents/{DOC}/tables/{PRODUCTS}/columns/{price_col}',
                    {'revision': price_column['revision'], 'name': 'Unit Price'})
check('column rename 200', s == 200 and b['column']['name'] == 'Unit Price', str(b))
s, b = mara.request('GET', f'/api/documents/{DOC}/tables/{ORDERS}')
total_formula = [c for c in b['table']['columns'] if c['id'] == total_col][0]['formula']
check('rename rewrote formula', total_formula == '[Qty] * [Product].[Unit Price]', total_formula)

s, b = mara.request('POST', f'/api/documents/{DOC}/undo')
check('undo rename 200', s == 200 and b['undone']['kind'] == 'column_update', str(b))
s, b = mara.request('GET', f'/api/documents/{DOC}/tables/{ORDERS}')
total_formula = [c for c in b['table']['columns'] if c['id'] == total_col][0]['formula']
check('undo rename restored text', total_formula == '[Qty] * [Product].[Price]', total_formula)

s, b = mara.request('PATCH', f'/api/documents/{DOC}/tables/{PRODUCTS}', {'name': 'Stock_Items', 'revision': 1})
check('table rename 200', s == 200 and b['table']['name'] == 'Stock_Items', str(b))
s, b = mara.request('PATCH', f'/api/documents/{DOC}/tables/{ORDERS}', {'name': 'Sales', 'revision': 1})
check('orders rename 200', s == 200, str(b))
s, b = mara.request('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
units_formula = [c for c in b['table']['columns'] if c['id'] == units_col][0]['formula']
check('units formula rewrote to Sales', units_formula == 'SUMBY(Sales.[Qty], Sales.[Product])', units_formula)
s, b = mara.request('GET', f'/api/documents/{DOC}')
check('summary renamed', any(t['name'] == 'Sales by Region' for t in b['tables']), [t['name'] for t in b['tables']])

s, b = mara.request('POST', f'/api/documents/{DOC}/undo')
check('undo orders rename', s == 200 and b['undone']['kind'] == 'table_rename', str(b))
s, b = mara.request('POST', f'/api/documents/{DOC}/undo')
check('undo products rename', s == 200 and b['undone']['kind'] == 'table_rename', str(b))
s, b = mara.request('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
units_formula = [c for c in b['table']['columns'] if c['id'] == units_col][0]['formula']
check('undo table rename restored text', units_formula == 'SUMBY(Orders.[Qty], Orders.[Product])', units_formula)

# row delete: references turn #REF! (DP-15)
s, b = mara.request('GET', f'/api/documents/{DOC}/tables/{PRODUCTS}')
osb_row = [r for r in b['table']['rows'] if r['id'] == osb_row_id][0]
s, b = mara.request('DELETE', f'/api/documents/{DOC}/tables/{PRODUCTS}/rows/{osb_row_id}?revision={osb_row["revision"]}')
check('row delete 200', s == 200, str(b))
recalc = b['recalc']
check('delete recalc 6 cells', recalc['count'] == 6 and recalc['tables'] == 2, json.dumps(recalc['cells'], default=str))
check('delete sentence', recalc['sentence'] == 'Recalculated 6 cells in 2 tables.', recalc['sentence'])
s, b = mara.request('GET', f'/api/documents/{DOC}/tables/{ORDERS}')
prod_cell = b['table']['rows'][0]['cells'][prod_ref_col]
check('ref now #REF!', prod_cell['display'] == '#REF!' and prod_cell['kind'] == 'error', str(prod_cell))
check('row count dropped', len(b['table']['rows']) == 5 and True)

# undo restores (DP-18)
s, b = mara.request('POST', f'/api/documents/{DOC}/undo')
check('undo delete restores', s == 200 and b['undone']['kind'] == 'row_delete', str(b))
check('undo delete recalc 8 cells', b['recalc']['count'] == 8 and b['recalc']['tables'] == 3, json.dumps(b['recalc']['cells'], default=str))
s, b = mara.request('GET', f'/api/documents/{DOC}/tables/{ORDERS}')
check('ref restored', b['table']['rows'][0]['cells'][prod_ref_col]['display'] == 'Oak Shelf Bracket')

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
