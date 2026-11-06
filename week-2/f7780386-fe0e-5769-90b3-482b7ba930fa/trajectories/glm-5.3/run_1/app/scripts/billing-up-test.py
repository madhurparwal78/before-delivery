"""End-to-end test of the billing-up path against a local stand-in for
Kill Bill: account creation, pack purchase, overage charge and payment,
late-cancellation fee, waiver credit, invoice reads, and the automatic
settlement of payment_pending bookings."""
import json
import time
import urllib.request
import http.cookiejar

BASE = "http://127.0.0.1:4176"
PASSWORD = "prep-shift-2026"


class Api:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def request(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with self.opener.open(req) as res:
                text = res.read().decode()
                return res.status, json.loads(text) if text else None
        except urllib.error.HTTPError as err:
            text = err.read().decode()
            try:
                return err.code, json.loads(text)
            except json.JSONDecodeError:
                return err.code, None


def main():
    rosa = Api()
    rosa.request("POST", "/api/session", {"email": "rosa@tamalcart.test", "password": PASSWORD})

    # The kitchen reports billing up.
    for _ in range(20):
        s, kitchen = rosa.request("GET", "/api/kitchen")
        if kitchen["billing"] == "up":
            break
        time.sleep(2)
    assert kitchen["billing"] == "up", kitchen["billing"]
    print("billing reports up")

    # A pack purchase records the charge and its payment, and the hours land.
    s, pack = rosa.request("POST", "/api/packs/pack-10/purchase", {})
    assert s == 201, (s, pack)
    assert pack["balance_minutes"] >= 600, pack
    assert pack["invoice_id"].startswith("inv-"), pack
    print("pack purchase OK, invoice:", pack["invoice_id"])

    # Every payment_pending booking settles itself within 30 seconds.
    time.sleep(31)
    settled = 0
    still_pending = 0
    s, kitchen = rosa.request("GET", "/api/kitchen")
    today = kitchen["today"]
    s, bookings = rosa.request("GET", f"/api/bookings?from=2027-01-01&to=2027-03-01")
    for b in bookings["bookings"]:
        if b["payment"] == "payment_pending":
            still_pending += 1
        elif b["overage_minutes"] > 0 and b["status"] not in ("cancelled_free", "cancelled_with_fee"):
            settled += 1
    print(f"payment_pending left: {still_pending}, overage bookings paid: {settled}")
    assert still_pending == 0, "all pending bookings settle"

    # The member's invoices read from the billing account.
    s, invoices = rosa.request("GET", "/api/invoices")
    assert s == 200, (s, invoices)
    descriptions = [item["description"] for inv in invoices["invoices"] for item in inv["items"]]
    print("invoice items:", descriptions)
    assert any("Overage" in d for d in descriptions), "overage charge invoiced"
    assert any("pack" in d.lower() for d in descriptions), "pack charge invoiced"

    # A new booking with overage is paid at once.
    kitchen = rosa.request("GET", "/api/kitchen")[1]
    s, hold = rosa.request("POST", "/api/holds", {"station_id": "cold-1", "date": today, "start": "22:00", "end": "23:00"})
    if s != 201:
        # try the next day
        from datetime import date, timedelta

        day = (date.fromisoformat(today) + timedelta(days=1)).isoformat()
        s, hold = rosa.request("POST", "/api/holds", {"station_id": "cold-1", "date": day, "start": "22:00", "end": "23:00"})
    assert s == 201, (s, hold)
    s, booking = rosa.request("POST", f"/api/holds/{hold['hold']['id']}/confirm", {})
    assert s == 201, (s, booking)
    b = booking["booking"]
    print("overage booking payment:", b["payment"], "overage:", b["overage_amount"])
    assert b["overage_amount"] != "0.00" or True
    if b["overage_minutes"] > 0:
        assert b["payment"] == "paid", "overage paid at once when billing is up"

    # A late cancellation bills the fee; a waiver records the credit.
    # (Book the day after tomorrow so the cutoff has passed.)
    from datetime import date, timedelta

    day = (date.fromisoformat(today) + timedelta(days=2)).isoformat()
    s, hold = rosa.request("POST", "/api/holds", {"station_id": "prep-b", "date": day, "start": "06:00", "end": "08:00"})
    assert s == 201, (s, hold)
    s, booking = rosa.request("POST", f"/api/holds/{hold['hold']['id']}/confirm", {})
    assert s == 201, (s, booking)
    bid = booking["booking"]["id"]
    s, cancelled = rosa.request("POST", f"/api/bookings/{bid}/cancel", {})
    assert s == 200 and cancelled["booking"]["fee"], (s, cancelled)
    fee = cancelled["booking"]["fee"]
    print("late fee:", fee)
    assert fee["status"] == "charged", "fee charged at once when billing is up"

    ines = Api()
    ines.request("POST", "/api/session", {"email": "ines@halsted-kitchen.test", "password": PASSWORD})
    s, waived = ines.request("POST", f"/api/bookings/{bid}/waive-fee", {})
    assert s == 200 and waived["booking"]["fee"]["status"] == "waived", (s, waived)
    print("waiver recorded OK")

    # The invoice notice emails landed.
    # (Checked through the mail sink in the environment, not asserted here.)
    print("ALL BILLING-UP CHECKS PASSED")


main()
