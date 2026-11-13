package domain

import "sort"

// Classify is the one merge classification. It compares every key of the base
// snapshot, the branch and current main field by field and sorts the result
// into new, edited and deleted keys, field-level conflicts and the field edits
// a merge would apply.
func Classify(base, branch, main KeySet, languages []string) Preview {
	preview := Preview{}
	ids := map[string]bool{}
	for id := range base {
		ids[id] = true
	}
	for id := range branch {
		ids[id] = true
	}
	for id := range main {
		ids[id] = true
	}
	ordered := make([]string, 0, len(ids))
	for id := range ids {
		ordered = append(ordered, id)
	}
	nameOf := func(id string) string {
		for _, set := range []KeySet{branch, base, main} {
			if k, ok := set[id]; ok {
				return k.Name
			}
		}
		return id
	}
	sort.Slice(ordered, func(i, j int) bool { return nameOf(ordered[i]) < nameOf(ordered[j]) })

	fields := append([]string{"name", "source"}, translationFields(languages)...)

	for _, id := range ordered {
		baseKey, inBase := base[id]
		branchKey, onBranch := branch[id]
		mainKey, onMain := main[id]

		switch {
		case !inBase:
			if onBranch && !onMain {
				preview.NewKeys = append(preview.NewKeys, id)
				if other := liveNameHolder(main, branchKey.Name, id); other != "" {
					preview.Conflicts = append(preview.Conflicts, Conflict{
						ID: id + ":name", KeyID: id, Key: branchKey.Name, Field: "name",
						Base: nil, Main: strPtr(main[other].Name), Branch: strPtr(branchKey.Name),
					})
				}
			}
		case !onBranch && !onMain:
			// Both sides deleted the key; nothing left to do.
		case !onBranch:
			if keyChanged(baseKey, mainKey, fields) {
				preview.Conflicts = append(preview.Conflicts, Conflict{
					ID: id + ":presence", KeyID: id, Key: baseKey.Name, Field: "presence",
					Base: strPtr("present"), Main: strPtr("changed"), Branch: strPtr("deleted"),
				})
			} else {
				preview.DeletedKeys = append(preview.DeletedKeys, id)
			}
		case !onMain:
			if keyChanged(baseKey, branchKey, fields) {
				preview.Conflicts = append(preview.Conflicts, Conflict{
					ID: id + ":presence", KeyID: id, Key: baseKey.Name, Field: "presence",
					Base: strPtr("present"), Main: strPtr("deleted"), Branch: strPtr("changed"),
				})
			}
		default:
			conflicted := false
			var edits []FieldEdit
			for _, field := range fields {
				baseValue := fieldValue(baseKey, field)
				branchValue := fieldValue(branchKey, field)
				mainValue := fieldValue(mainKey, field)
				branchChanged := !sameValue(baseValue, branchValue)
				mainChanged := !sameValue(baseValue, mainValue)
				switch {
				case branchChanged && mainChanged && !sameValue(branchValue, mainValue):
					conflicted = true
					preview.Conflicts = append(preview.Conflicts, Conflict{
						ID: id + ":" + field, KeyID: id, Key: branchKey.Name, Field: field,
						Base: baseValue, Main: mainValue, Branch: branchValue,
					})
				case branchChanged && !mainChanged:
					edits = append(edits, FieldEdit{KeyID: id, Field: field})
				}
			}
			if branchKey.Name != mainKey.Name {
				if other := liveNameHolder(main, branchKey.Name, id); other != "" {
					conflicted = true
					preview.Conflicts = append(preview.Conflicts, Conflict{
						ID: id + ":name", KeyID: id, Key: branchKey.Name, Field: "name",
						Base: strPtr(baseKey.Name), Main: strPtr(main[other].Name), Branch: strPtr(branchKey.Name),
					})
				}
			}
			if conflicted {
				continue
			}
			if len(edits) > 0 {
				preview.EditedKeys = append(preview.EditedKeys, id)
				preview.Edits = append(preview.Edits, edits...)
			}
		}
	}
	sort.Slice(preview.Conflicts, func(i, j int) bool {
		if preview.Conflicts[i].Key != preview.Conflicts[j].Key {
			return preview.Conflicts[i].Key < preview.Conflicts[j].Key
		}
		return preview.Conflicts[i].Field < preview.Conflicts[j].Field
	})
	return preview
}

func translationFields(languages []string) []string {
	fields := make([]string, 0, len(languages))
	for _, lang := range languages {
		fields = append(fields, "translation:"+lang)
	}
	sort.Strings(fields)
	return fields
}

func fieldValue(k *Key, field string) *string {
	if k == nil {
		return nil
	}
	switch field {
	case "name":
		return strPtr(k.Name)
	case "source":
		return strPtr(k.Source)
	}
	if len(field) > len("translation:") && field[:len("translation:")] == "translation:" {
		return segmentValue(k, field[len("translation:"):])
	}
	return nil
}

func keyChanged(base, other *Key, fields []string) bool {
	for _, field := range fields {
		if !sameValue(fieldValue(base, field), fieldValue(other, field)) {
			return true
		}
	}
	return false
}

func liveNameHolder(set KeySet, name, exceptID string) string {
	for id, k := range set {
		if id != exceptID && k.Name == name {
			return id
		}
	}
	return ""
}

// BelowThreshold counts the live segments of a key set that score below the
// project threshold.
func BelowThreshold(set KeySet, threshold int) int {
	count := 0
	for _, k := range set {
		for _, s := range k.Segments {
			if s.Score != nil && *s.Score < threshold {
				count++
			}
		}
	}
	return count
}

// NeedsReview counts the live segments of a key set waiting for review.
func NeedsReview(set KeySet) int {
	count := 0
	for _, k := range set {
		for _, s := range k.Segments {
			if s.Status == StatusNeedsReview {
				count++
			}
		}
	}
	return count
}
