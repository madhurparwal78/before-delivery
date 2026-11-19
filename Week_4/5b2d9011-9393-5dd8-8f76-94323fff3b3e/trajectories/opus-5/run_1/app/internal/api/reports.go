package api

import (
	"fmt"
	"net/http"

	"github.com/cinderlatch/holdfast/internal/apierr"
	"github.com/cinderlatch/holdfast/internal/sim"
)

// reportBody is one report exactly as it arrives.
type reportBody struct {
	ReportID string   `json:"report_id"`
	Type     string   `json:"type"`
	Aim      *float64 `json:"aim"`
	Target   *struct {
		X *float64 `json:"x"`
		Z *float64 `json:"z"`
	} `json:"target"`
	TargetPlayer *string `json:"target_player"`
}

// parse checks a report body and builds the fingerprint that tells a replay from
// a conflict.
func (b reportBody) parse() (sim.ReportInput, map[string]string) {
	fields := map[string]string{}
	if !validReportID(b.ReportID) {
		fields["report_id"] = "Use 1 to 64 letters, digits, underscores or hyphens."
	}

	in := sim.ReportInput{ReportID: b.ReportID, Type: b.Type}
	switch b.Type {
	case "shot":
		if b.Aim == nil || *b.Aim < 0 || *b.Aim > 360 {
			fields["aim"] = "Use a bearing from 0 to 360."
			break
		}
		in.Aim = *b.Aim
		in.Fingerprint = fmt.Sprintf("shot|aim=%.6f", in.Aim)
	case "reload":
		in.Fingerprint = "reload"
	case "grenade":
		if b.Target == nil || b.Target.X == nil || b.Target.Z == nil {
			fields["target"] = "Send target.x and target.z."
			break
		}
		in.TargetX, in.TargetZ = *b.Target.X, *b.Target.Z
		in.Fingerprint = fmt.Sprintf("grenade|x=%.6f|z=%.6f", in.TargetX, in.TargetZ)
	case "revive":
		if b.TargetPlayer == nil || *b.TargetPlayer == "" {
			fields["target_player"] = "Send the downed player's id."
			break
		}
		in.TargetPlayer = *b.TargetPlayer
		in.Fingerprint = "revive|player=" + in.TargetPlayer
	default:
		fields["type"] = "Use shot, reload, grenade or revive."
	}
	return in, fields
}

func (s *Server) handleReport(w http.ResponseWriter, r *http.Request) {
	var body reportBody
	if failure := decode(r, &body); failure != nil {
		apierr.Write(w, failure)
		return
	}
	room, player, failure := s.roomFor(r, true)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	in, fields := body.parse()
	if len(fields) > 0 {
		apierr.Write(w, apierr.Validation(fields))
		return
	}

	result, err := s.rooms.ApplyReport(r.Context(), room, player.ID, in)
	if err != nil {
		apierr.Write(w, roomError(err))
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleReportBatch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Reports []reportBody `json:"reports"`
	}
	if failure := decode(r, &body); failure != nil {
		apierr.Write(w, failure)
		return
	}
	room, player, failure := s.roomFor(r, true)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	if len(body.Reports) < 1 || len(body.Reports) > 64 {
		apierr.Write(w, apierr.Field("reports", "Send 1 to 64 reports."))
		return
	}

	batch := make([]sim.ReportInput, 0, len(body.Reports))
	for index, entry := range body.Reports {
		in, fields := entry.parse()
		if len(fields) > 0 {
			named := make(map[string]string, len(fields))
			for key, message := range fields {
				named[fmt.Sprintf("reports.%d.%s", index, key)] = message
			}
			apierr.Write(w, apierr.Validation(named))
			return
		}
		batch = append(batch, in)
	}

	results, failures, err := s.rooms.ApplyReports(r.Context(), room, player.ID, batch)
	if err != nil {
		apierr.Write(w, roomError(err))
		return
	}

	entries := make([]any, len(results))
	for i := range results {
		if failures[i] != nil {
			mapped := roomError(failures[i])
			entries[i] = map[string]any{
				"error": map[string]any{"code": mapped.Code, "message": mapped.Message},
			}
			continue
		}
		entries[i] = results[i]
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": entries})
}
