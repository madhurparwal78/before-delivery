package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"sort"

	"github.com/jackc/pgx/v5"
)

type aiDraft struct {
	Draft  *string `json:"draft"`
	Issues []Issue `json:"issues"`
}

func errAIDown(tmReused, drafted int) *apiError {
	return newErr(http.StatusServiceUnavailable, "ai_engine_unavailable",
		"The AI engine isn't answering. Exact matches from translation memory still apply; other segments stay untranslated.").
		with(map[string]any{"tm_reused": tmReused, "ai_drafted": drafted})
}

// askEngine requests one draft; any transport failure, non-200 status or body without a string draft is a failure.
func (a *App) askEngine(ctx context.Context, p *Project, lang, engine string, s *Segment) (*aiDraft, bool) {
	status, body, err := a.ai.call(ctx, http.MethodPost, "/ai/v1/draft",
		url.Values{"engine": {engine}, "source": {p.SourceLanguage}, "target": {lang}}, map[string]string{"key": s.KeyName, "text": s.Source})
	if err != nil || status != http.StatusOK {
		return nil, false
	}
	var d aiDraft
	if json.Unmarshal(body, &d) != nil || d.Draft == nil {
		return nil, false
	}
	return &d, true
}

func (a *App) handleDraft(w http.ResponseWriter, r *http.Request) error {
	pr, p, b, err := a.ownerBranch(r)
	if err != nil {
		return err
	}
	var in struct {
		Language string `json:"language"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	ctx := r.Context()
	var tmReused, drafted int
	var aiFailed bool
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		if b, err = branchByID(ctx, tx, b.ID); err != nil {
			return err
		}
		if err := b.requireEditable(); err != nil {
			return err
		}
		if !slices.Contains(p.TargetLanguages, in.Language) {
			return errField("language", "Choose one of the project's target languages.")
		}
		segs, err := branchSegments(ctx, tx, b.ID, in.Language)
		if err != nil {
			return err
		}
		var todo []*Segment
		for _, byLang := range segs {
			if s := byLang[in.Language]; s != nil && s.Status == statusUntranslated {
				todo = append(todo, s)
			}
		}
		sort.Slice(todo, func(i, j int) bool { return todo[i].KeyName < todo[j].KeyName })
		engine := p.AIRoutes[in.Language]
		for _, s := range todo {
			at := now()
			hit, err := tmLookup(ctx, tx, p.ID, s.Language, s.Source)
			if err != nil {
				return err
			}
			if hit != nil {
				s.setValue(hit.reusedValue(s.Source), "tm", pr.Email, at)
				tmReused++
			} else {
				d, ok := a.askEngine(ctx, p, in.Language, engine, s)
				if !ok {
					aiFailed = true
					break
				}
				issues := []Issue{}
				for _, i := range d.Issues {
					if validIssue(i) == nil {
						issues = append(issues, i)
					}
				}
				s.draftFromAI(*d.Draft, engine, issues, pr.Email, at)
				drafted++
			}
			if err := s.save(ctx, tx); err != nil {
				return err
			}
		}
		if tmReused+drafted > 0 {
			if err := touch(ctx, tx, p.ID, b); err != nil {
				return err
			}
			detail := fmt.Sprintf("%s (%s): %d from TM, %d from AI", b.Name, in.Language, tmReused, drafted)
			if aiFailed {
				detail += ", stopped by an AI engine failure"
			}
			return a.audit(ctx, tx, pr.Email, "branch.drafted", p, detail)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if aiFailed {
		return errAIDown(tmReused, drafted)
	}
	writeJSON(w, http.StatusOK, map[string]any{"tm_reused": tmReused, "ai_drafted": drafted})
	return nil
}
