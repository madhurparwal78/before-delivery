package rooms

import (
"context"
"encoding/json"
"errors"
"time"

"holdfast/internal/sim"
)

// TouchPlayer renews a seated player's lease.
func (h *Hub) TouchPlayer(r *sim.Room, playerID string) {
r.RoomLock()
p, ok := r.PlayerSeatedID(playerID)
if !ok {
r.RoomUnlock()
return
}
r.Touch(p, h.clock.Mono())
r.RoomUnlock()
ctx, cancel := context.WithTimeout(context.Background(), time.Second)
defer cancel()
h.valkey.renewSeatLease(ctx, r.Code, playerID)
}

// StoredReport is a stored report result with the canonical body it was
// first applied with.
type StoredReport struct {
Body   string
Result sim.ReportResult
}

// GetReport reads a stored report from the registry.
func (h *Hub) GetReport(ctx context.Context, code, reportID string) (StoredReport, bool, error) {
sr, found, err := h.valkey.getStoredReport(ctx, code, reportID)
return StoredReport{Body: sr.Body, Result: sr.Result}, found, err
}

// PutReport stores a report result in the registry. A same-moment duplicate
// with the same body is harmless; a different body is a conflict.
func (h *Hub) PutReport(ctx context.Context, code string, rr sim.ReportResult) error {
return h.valkey.putReport(ctx, code, rr)
}

// GetPurchase reads a stored purchase.
func (h *Hub) GetPurchase(ctx context.Context, code, purchaseID string) (sim.PurchaseRecord, bool, error) {
res, err := h.valkey.Client.Do(ctx,
h.valkey.Client.B().Hget().Key("hf:purchase:"+code).Field(purchaseID).Build()).ToString()
if err != nil {
if errors.Is(err, errValkeyNil) {
return sim.PurchaseRecord{}, false, nil
}
return sim.PurchaseRecord{}, false, err
}
var pr sim.PurchaseRecord
if err := json.Unmarshal([]byte(res), &pr); err != nil {
return sim.PurchaseRecord{}, false, err
}
return pr, true, nil
}

// PutPurchase stores a purchase.
func (h *Hub) PutPurchase(ctx context.Context, code string, rec sim.PurchaseRecord) error {
data, err := json.Marshal(rec)
if err != nil {
return err
}
return h.valkey.Client.Do(ctx,
h.valkey.Client.B().Hset().Key("hf:purchase:"+code).FieldValue().FieldValue(rec.PurchaseID, string(data)).Build()).Error()
}
