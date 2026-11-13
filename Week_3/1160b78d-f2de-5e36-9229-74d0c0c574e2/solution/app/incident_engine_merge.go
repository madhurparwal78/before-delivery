package main

import (
	"fmt"
	"net/http"
	"slices"
)

const maxAlertsPerIncident = 1000

// mergeRequest is the body of a merge: the incidents folded into the target named by the path.
type mergeRequest struct {
	SourceIDs []string `json:"source_ids"`
}

// mergeIncidents folds open incidents into an open target. Alerts move with their keys, the sources' timeline entries are
// copied into the target's, source timers stop and their unsent steps are cancelled.
func (a *App) mergeIncidents(w *Work, targetID string, sourceIDs []string, by actorRef) error {
	target, err := loadIncident(w.Ctx, w.Tx, targetID)
	if err != nil {
		return fmt.Errorf("load incident: %w", err)
	}
	if target.outcome(actMerge, by) == verdictConflict {
		return errConflict("merge_target_resolved")
	}
	sources, mergesItself, err := a.mergeSources(w, target, slices.Compact(slices.Clone(sourceIDs)), by)
	if err != nil {
		return fmt.Errorf("read sources to merge: %w", err)
	}
	if mergesItself {
		return errField("source_ids", "An incident cannot merge into itself.")
	}
	if len(sources) == 0 {
		return errField("source_ids", "Choose at least one incident.")
	}
	var total int
	err = w.Tx.QueryRow(w.Ctx, `select count(*) from alerts where incident_id = any($1)`,
		append([]string{targetID}, incidentIDs(sources)...)).Scan(&total)
	if err != nil {
		return fmt.Errorf("count alerts to merge into incident %s: %w", targetID, err)
	}
	if total > maxAlertsPerIncident {
		return errField("source_ids", "An incident can hold at most 1000 alerts.")
	}
	urgency := target.Urgency
	for _, source := range sources {
		if source.Urgency == "high" {
			urgency = "high"
		}
		if err := a.mergeOne(w, &target, source, by); err != nil {
			return fmt.Errorf("merge one: %w", err)
		}
	}
	raised, err := a.raiseUrgency(w, &target, urgency, by.Name)
	if err != nil {
		return fmt.Errorf("raise urgency of incident #%d: %w", target.Number, err)
	}
	if raised {
		return nil
	}
	if err := w.touchIncident(targetID); err != nil {
		return fmt.Errorf("touch incident: %w", err)
	}
	if err := w.publishIncident(targetID, ""); err != nil {
		return fmt.Errorf("publish incident: %w", err)
	}
	return nil
}

func incidentIDs(rows []incidentRow) []string {
	ids := make([]string, len(rows))
	for n, r := range rows {
		ids[n] = r.ID
	}
	return ids
}

// mergeSources reads the incidents to merge. A source that is resolved refuses the merge, and so does one that does not
// exist; naming the target itself is reported rather than read.
func (a *App) mergeSources(w *Work, target incidentRow, ids []string, by actorRef) (sources []incidentRow, mergesItself bool, err error) {
	for _, id := range ids {
		if id == target.ID {
			mergesItself = true
			continue
		}
		source, err := loadIncident(w.Ctx, w.Tx, id)
		if isNoRows(err) {
			return nil, false, errNotFound()
		}
		if err != nil {
			return nil, false, fmt.Errorf("read incident to merge: %w", err)
		}
		if source.outcome(actMerge, by) == verdictConflict {
			return nil, false, errConflict("merge_source_resolved", "number", source.Number)
		}
		sources = append(sources, source)
	}
	return sources, mergesItself, nil
}

// mergeOne closes one source into the target.
func (a *App) mergeOne(w *Work, target *incidentRow, source incidentRow, by actorRef) error {
	_, err := w.Tx.Exec(w.Ctx, `update alerts set incident_id = $2 where incident_id = $1`, source.ID, target.ID)
	if err != nil {
		return fmt.Errorf("move alerts of incident #%d: %w", source.Number, err)
	}
	err = a.closeIncident(w, &source, closure{Reason: "Merged", Kind: "merged", Actor: by.Name,
		Text: fmt.Sprintf("Incident #%d merged into #%d by %s", source.Number, target.Number, by.Name),
		Hook: hookMerged, MergedInto: &target.Number})
	if err != nil {
		return fmt.Errorf("close merged incident: %w", err)
	}
	_, err = w.Tx.Exec(w.Ctx, `insert into timeline (incident_id, at, kind, actor, text, from_number)
		select $2, at, kind, actor, text, coalesce(from_number, $3) from timeline where incident_id = $1`,
		source.ID, target.ID, source.Number)
	if err != nil {
		return fmt.Errorf("copy timeline of incident #%d: %w", source.Number, err)
	}
	return nil
}

// splitAlert opens a new incident for one alert of an open incident, on the alert's service at its current policy.
func (a *App) splitAlert(w *Work, incidentID, alertID string, by actorRef) (string, error) {
	inc, err := loadIncident(w.Ctx, w.Tx, incidentID)
	if err != nil {
		return "", fmt.Errorf("load incident: %w", err)
	}
	if inc.outcome(actSplit, by) == verdictConflict {
		return "", inc.decisionConflict()
	}
	var alert newAlert
	err = w.Tx.QueryRow(w.Ctx, `select dedup_key, summary, severity, service_id from alerts where id = $1 and incident_id = $2`,
		alertID, incidentID).Scan(&alert.DedupKey, &alert.Summary, &alert.Severity, &alert.ServiceID)
	if isNoRows(err) {
		return "", errNotFound()
	}
	if err != nil {
		return "", fmt.Errorf("read alert %s: %w", alertID, err)
	}
	var count int
	if err := w.Tx.QueryRow(w.Ctx, `select count(*) from alerts where incident_id = $1`, incidentID).Scan(&count); err != nil {
		return "", fmt.Errorf("count alerts of incident %s: %w", incidentID, err)
	}
	if count == 1 {
		return "", errConflict("last_alert")
	}
	service, err := loadService(w.Ctx, w.Tx, alert.ServiceID)
	if err != nil {
		return "", fmt.Errorf("load service: %w", err)
	}
	snapshot, err := a.policySnapshotOf(w.Ctx, w.Tx, service.PolicyID)
	if err != nil {
		return "", fmt.Errorf("copy policy of %s: %w", service.Name, err)
	}
	place, err := a.levels(w, snapshot).seek(1, 0)
	if err != nil {
		return "", fmt.Errorf("find who is on call: %w", err)
	}
	opened, err := a.insertIncident(w, newIncident{Service: service, Snapshot: snapshot, Place: place, Title: alert.Summary,
		Urgency: urgencyOf(alert.Severity), Actor: by.Name})
	if err != nil {
		return "", fmt.Errorf("open incident for split alert: %w", err)
	}
	if _, err := w.Tx.Exec(w.Ctx, `update alerts set incident_id = $2 where id = $1`, alertID, opened.ID); err != nil {
		return "", fmt.Errorf("move alert %s: %w", alertID, err)
	}
	if err := a.announceOpened(w, &opened, by.Name); err != nil {
		return "", fmt.Errorf("announce opened: %w", err)
	}
	if err := w.touchIncident(incidentID); err != nil {
		return "", fmt.Errorf("touch incident: %w", err)
	}
	text := fmt.Sprintf("Alert %s split into incident #%d by %s", alert.DedupKey, opened.Number, by.Name)
	if err := w.report(&inc, "split", by.Name, text, ""); err != nil {
		return opened.ID, fmt.Errorf("report split: %w", err)
	}
	return opened.ID, nil
}

func (a *App) hMerge(rq *Req) error {
	if err := rq.Idempotent(func() error {
		var req mergeRequest
		if err := rq.Decode(&req); err != nil {
			return fmt.Errorf("decode: %w", err)
		}
		id := rq.Param("id")
		err := a.Do(rq.Ctx(), func(w *Work) error {
			if err := a.mergeIncidents(w, id, req.SourceIDs, rq.ref()); err != nil {
				return fmt.Errorf("merge sources: %w", err)
			}
			return nil
		})
		if err != nil {
			return fmt.Errorf("merge into incident %s: %w", id, err)
		}
		if err := a.respond(rq, id); err != nil {
			return fmt.Errorf("answer merge: %w", err)
		}
		return nil
	}); err != nil {
		return fmt.Errorf("merge incidents: %w", err)
	}
	return nil
}

func (a *App) hSplit(rq *Req) error {
	var splitID string
	err := a.Do(rq.Ctx(), func(w *Work) error {
		var err error
		splitID, err = a.splitAlert(w, rq.Param("id"), rq.Param("alert_id"), rq.ref())
		if err != nil {
			return fmt.Errorf("split alert %s: %w", rq.Param("alert_id"), err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("split alert %s: %w", rq.Param("alert_id"), err)
	}
	view, _, err := a.incidentJSON(rq.Ctx(), a.db, splitID, rq.viewerZone())
	if err != nil {
		return fmt.Errorf("read incident %s: %w", splitID, err)
	}
	return rq.JSON(http.StatusCreated, view)
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "POST /api/incidents/{id}/merge", Access: accLead, Resource: "incident", Handler: a.hMerge})
		a.route(route{Pattern: "POST /api/incidents/{id}/alerts/{alert_id}/split", Access: accLead, Resource: "incident", Handler: a.hSplit})
	})
}
