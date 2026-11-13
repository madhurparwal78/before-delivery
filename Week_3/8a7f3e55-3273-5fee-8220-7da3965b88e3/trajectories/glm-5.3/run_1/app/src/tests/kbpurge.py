"""Purge the Kill Bill test accounts completely so charge descriptions cannot collide
between test runs."""
import base64
import requests

KB = 'http://killbill:8080/1.0/kb'
H = {
    'X-Killbill-ApiVersion': 'v1',
    'X-Killbill-ApiKey': 'gfkit-dev',
    'X-Killbill-ApiSecret': 'gfkit-dev-secret',
    'X-Killbill-CreatedBy': 'cleanup',
    'Authorization': 'Basic ' + base64.b64encode(b'admin:password').decode(),
    'Content-Type': 'application/json',
}

def purge(key):
    r = requests.get(f'{KB}/accounts?externalKey={key}', headers=H)
    if r.status_code != 200:
        return False
    aid = r.json()['accountId']
    # Void all invoices so the account can be closed, then close and delete the account.
    invoices = requests.get(f'{KB}/accounts/{aid}/invoices', headers=H).json()
    for inv in invoices:
        requests.put(f'{KB}/invoices/{inv["invoiceId"]}/voidInvoice', headers=H)
    close = requests.delete(f'{KB}/accounts/{aid}/forceClose', headers=H)
    deleted = requests.delete(f'{KB}/accounts/{aid}', headers=H)
    print(key, 'close:', close.status_code, 'delete:', deleted.status_code)
    return deleted.status_code in (200, 204)

if __name__ == '__main__':
    for k in ['riverbend', 'maple-valley', 'harlan-court', 'probe-org', 'probe2']:
        purge(k)
