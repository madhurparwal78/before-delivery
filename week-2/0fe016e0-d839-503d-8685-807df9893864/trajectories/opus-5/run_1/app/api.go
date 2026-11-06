package main

import (
	"net/http"
)

func (a *app) readSnapshotFor(w http.ResponseWriter, r *http.Request) *snapshot {
	ctx, cancel := withTimeout(r.Context())
	defer cancel()
	state, err := a.snapshotNow(ctx)
	if err != nil {
		writeFailure(w, err)
		return nil
	}
	return state
}

func (a *app) handleFlagList(w http.ResponseWriter, r *http.Request) {
	state := a.readSnapshotFor(w, r)
	if state == nil {
		return
	}
	records := state.flags
	if records == nil {
		records = []flagRecord{}
	}
	writeJSON(w, http.StatusOK, records)
}

func (a *app) handleCohortList(w http.ResponseWriter, r *http.Request) {
	state := a.readSnapshotFor(w, r)
	if state == nil {
		return
	}
	records := state.cohorts
	if records == nil {
		records = []cohortRecord{}
	}
	writeJSON(w, http.StatusOK, records)
}

func (a *app) handleDeviceList(w http.ResponseWriter, r *http.Request) {
	state := a.readSnapshotFor(w, r)
	if state == nil {
		return
	}
	records := state.devices
	if records == nil {
		records = []deviceRecord{}
	}
	writeJSON(w, http.StatusOK, records)
}

func (a *app) handleAdverseEventList(w http.ResponseWriter, r *http.Request) {
	state := a.readSnapshotFor(w, r)
	if state == nil {
		return
	}
	records := state.events
	if records == nil {
		records = []adverseEventRecord{}
	}
	writeJSON(w, http.StatusOK, records)
}

func (a *app) handlePromotionList(w http.ResponseWriter, r *http.Request) {
	state := a.readSnapshotFor(w, r)
	if state == nil {
		return
	}
	flagCode := r.URL.Query().Get("flag_code")
	if flagCode == "" {
		writeJSON(w, http.StatusOK, state.promotionsInSequenceOrder())
		return
	}
	rows := state.promotionsForFlag(flagCode)
	if state.flagByCode(flagCode) != nil {
		a.recordJourneyMarks(r.Context(), []journeyMark{
			{"WF-03", []int{3}},
			{"WF-04", []int{3}},
		}, state.Now)
	}
	writeJSON(w, http.StatusOK, rows)
}

func (a *app) handleEvidencePackList(w http.ResponseWriter, r *http.Request) {
	state := a.readSnapshotFor(w, r)
	if state == nil {
		return
	}
	packs := state.evidencePacks()
	a.recordJourneyMarks(r.Context(), []journeyMark{
		{"WF-01", []int{4}},
		{"WF-02", []int{3}},
	}, state.Now)
	writeJSON(w, http.StatusOK, packs)
}

func (a *app) handleFlagDetail(w http.ResponseWriter, r *http.Request) {
	state := a.readSnapshotFor(w, r)
	if state == nil {
		return
	}
	flagCode := r.PathValue("flag_code")
	if state.flagByCode(flagCode) == nil {
		writeFailure(w, failure(http.StatusNotFound, "not found"))
		return
	}
	detail := state.flagDetailFor(flagCode)
	a.recordJourneyMarks(r.Context(), []journeyMark{
		{"WF-02", []int{2}},
		{"WF-03", []int{2}},
		{"WF-04", []int{2}},
	}, state.Now)
	writeJSON(w, http.StatusOK, detail)
}

func (a *app) handleSummary(entity string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		state := a.readSnapshotFor(w, r)
		if state == nil {
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"total": state.entityTotal(entity)})
	}
}

func (s *snapshot) entityTotal(entity string) int {
	switch entity {
	case "capability_flag":
		return len(s.flags)
	case "cohort":
		return len(s.cohorts)
	case "device":
		return len(s.devices)
	case "promotion":
		return len(s.promotions)
	case "adverse_event":
		return len(s.events)
	default:
		return len(s.evidencePacks())
	}
}
