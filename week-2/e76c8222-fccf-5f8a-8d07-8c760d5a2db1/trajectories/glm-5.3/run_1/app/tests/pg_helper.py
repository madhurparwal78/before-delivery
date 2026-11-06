# Small helper for white-box scenario tests against the app's own database.
import os
import subprocess, json

def execute(sql, params=()):
    run(sql, params)

def scalar(sql, params=()):
    out = run(sql, params)
    rows = json.loads(out)
    if not rows:
        return None
    first = rows[0]
    return list(first.values())[0]

def run(sql, params=()):
    # Convert python-style %s placeholders to node-pg $1 style.
    converted = []
    idx = 0
    parts = sql.split('%s')
    out = parts[0]
    for part in parts[1:]:
        idx += 1
        out += '$' + str(idx) + part
    js = json.dumps({ 'sql': out, 'params': list(params) })
    return subprocess.check_output(['node', '-e', '''
const pg = require('pg');
const spec = JSON.parse(process.argv[1]);
(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const res = await pool.query(spec.sql, spec.params.map(p => p === null ? null : p));
  console.log(JSON.stringify(res.rows));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
''', js]).decode()

