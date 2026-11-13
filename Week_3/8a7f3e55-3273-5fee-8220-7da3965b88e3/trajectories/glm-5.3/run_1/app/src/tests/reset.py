"""Reset app data: bookings, lines, weeks, emails, sessions, idempotency keys and
the Kill Bill accounts, plus the Mailpit message store."""
import base64
import requests

DATABASE_URL = __import__('os').environ['DATABASE_URL']

RESET_SQL = """
DELETE FROM prep_links;
DELETE FROM materials;
DELETE FROM audit_trail;
DELETE FROM invoice_lines;
DELETE FROM billing_weeks;
DELETE FROM email_queue;
DELETE FROM seats;
DELETE FROM bookings;
UPDATE booking_sequence SET last_value = 1000;
UPDATE line_sequence SET last_value = 5000;
DELETE FROM idempotency_keys;
DELETE FROM sessions;
DELETE FROM kb_accounts;
DELETE FROM contract_rates WHERE effective_from <> DATE '2026-01-01';
"""

def main():
    import subprocess
    node_reset = '''
import('pg').then(({default: pg}) => {
  const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
  pool.query(`%s`).then(() => { console.log('db reset'); return pool.end(); }).catch(e => { console.error(e); process.exit(1); });
});
''' % RESET_SQL
    subprocess.run(['node', '--input-type=module', '-e', node_reset], check=True,
                   env={**__import__('os').environ})

    kb = 'http://killbill:8080/1.0/kb'
    headers = {
        'X-Killbill-ApiVersion': 'v1',
        'X-Killbill-ApiKey': 'gfkit-dev',
        'X-Killbill-ApiSecret': 'gfkit-dev-secret',
        'X-Killbill-CreatedBy': 'cleanup',
        'Authorization': 'Basic ' + base64.b64encode(b'admin:password').decode(),
    }
    for key in ['riverbend', 'maple-valley', 'harlan-court']:
        r = requests.get(f'{kb}/accounts?externalKey={key}', headers=headers)
        if r.status_code == 200:
            aid = r.json()['accountId']
            requests.delete(f'{kb}/accounts/{aid}/forceClose', headers=headers)
            requests.delete(f'{kb}/accounts/{aid}?deleteDataOnly=true', headers=headers)
    requests.delete('http://mailpit:8025/api/v1/messages')
    print('kb and mailpit reset')

if __name__ == '__main__':
    main()
