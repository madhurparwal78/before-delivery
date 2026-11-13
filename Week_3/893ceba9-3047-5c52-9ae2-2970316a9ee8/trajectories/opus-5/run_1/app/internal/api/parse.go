package api

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"encoding/xml"
	"io"
	"strings"
)

// importRow is one row offered by a spreadsheet or a TMX file.
type importRow struct {
	Line     int
	Source   string
	Target   string
	Language string
	Note     string
}

// parseCSV reads a spreadsheet whose header holds source, target and
// target_language. Line numbers count from 1 at the header.
func parseCSV(data []byte) ([]importRow, *apiError) {
	reader := csv.NewReader(bytes.NewReader(withoutBOM(data)))
	reader.FieldsPerRecord = -1
	header, err := reader.Read()
	if err != nil {
		return nil, errField("file", "The spreadsheet needs source, target and target_language columns.")
	}
	columns := map[string]int{}
	for i, name := range header {
		columns[strings.ToLower(strings.TrimSpace(name))] = i
	}
	sourceAt, hasSource := columns["source"]
	targetAt, hasTarget := columns["target"]
	languageAt, hasLanguage := columns["target_language"]
	if !hasSource || !hasTarget || !hasLanguage {
		return nil, errField("file", "The spreadsheet needs source, target and target_language columns.")
	}
	noteAt, hasNote := columns["note"]

	rows := []importRow{}
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, errField("file", "That spreadsheet can't be read.")
		}
		line, _ := reader.FieldPos(0)
		row := importRow{Line: line}
		row.Source = at(record, sourceAt)
		row.Target = at(record, targetAt)
		row.Language = strings.TrimSpace(at(record, languageAt))
		if hasNote {
			row.Note = at(record, noteAt)
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func at(record []string, index int) string {
	if index < len(record) {
		return record[index]
	}
	return ""
}

// tmxNode is one element inside a <seg>, whose text counts towards the segment.
type tmxNode struct {
	Text   string    `xml:",chardata"`
	Inline []tmxNode `xml:",any"`
}

type tmxVariant struct {
	Lang      string  `xml:"http://www.w3.org/XML/1998/namespace lang,attr"`
	PlainLang string  `xml:"lang,attr"`
	Seg       tmxNode `xml:"seg"`
}

type tmxUnit struct {
	Variants []tmxVariant `xml:"tuv"`
}

// parseTMX reads a TMX file, taking each non-source language variant of a
// translation unit as one row at the line of its <tu> opening tag.
func parseTMX(data []byte, sourceLanguage string, targets []string) ([]importRow, *apiError) {
	clean := withoutBOM(data)
	decoder := xml.NewDecoder(bytes.NewReader(clean))
	rows := []importRow{}
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, errField("file", "That TMX file can't be read.")
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "tu" {
			continue
		}
		line := lineOf(clean, decoder.InputOffset())
		var unit tmxUnit
		if err := decoder.DecodeElement(&unit, &start); err != nil {
			return nil, errField("file", "That TMX file can't be read.")
		}
		source := ""
		for _, variant := range unit.Variants {
			if primarySubtag(variantLang(variant)) == primarySubtag(sourceLanguage) {
				source = segmentText(variant.Seg)
				break
			}
		}
		for _, variant := range unit.Variants {
			lang := variantLang(variant)
			if primarySubtag(lang) == primarySubtag(sourceLanguage) {
				continue
			}
			rows = append(rows, importRow{
				Line:     line,
				Source:   source,
				Target:   segmentText(variant.Seg),
				Language: matchTarget(lang, targets),
			})
		}
	}
	return rows, nil
}

func segmentText(node tmxNode) string {
	var b strings.Builder
	collectText(node, &b)
	return strings.TrimSpace(b.String())
}

func collectText(node tmxNode, b *strings.Builder) {
	b.WriteString(node.Text)
	for _, child := range node.Inline {
		collectText(child, b)
	}
}

func variantLang(variant tmxVariant) string {
	if variant.Lang != "" {
		return variant.Lang
	}
	return variant.PlainLang
}

func primarySubtag(code string) string {
	code = strings.TrimSpace(code)
	if at := strings.IndexAny(code, "-_"); at > 0 {
		code = code[:at]
	}
	return strings.ToLower(code)
}

// matchTarget maps a TMX language to a project target: exactly first, then by
// primary subtag.
func matchTarget(lang string, targets []string) string {
	trimmed := strings.TrimSpace(lang)
	for _, target := range targets {
		if target == trimmed {
			return target
		}
	}
	for _, target := range targets {
		if primarySubtag(target) == primarySubtag(trimmed) {
			return target
		}
	}
	return trimmed
}

func lineOf(data []byte, offset int64) int {
	if offset > int64(len(data)) {
		offset = int64(len(data))
	}
	return 1 + bytes.Count(data[:offset], []byte("\n"))
}

// parseSourceLocale reads a JSON source locale file into flat dotted keys. Only
// string leaves are accepted, and duplicate member names are rejected.
func parseSourceLocale(data []byte) (map[string]string, *apiError) {
	decoder := json.NewDecoder(bytes.NewReader(withoutBOM(data)))
	decoder.UseNumber()
	token, err := decoder.Token()
	if err != nil {
		return nil, errField("file", "The file must be a JSON object whose values are all strings.")
	}
	if delim, ok := token.(json.Delim); !ok || delim != '{' {
		return nil, errField("file", "The file must be a JSON object whose values are all strings.")
	}
	out := map[string]string{}
	if fail := readObject(decoder, "", out); fail != nil {
		return nil, fail
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, errField("file", "The file must be a JSON object whose values are all strings.")
	}
	for name := range out {
		if !validKeyName(name) {
			return nil, errField("file", "The file must be a JSON object whose values are all strings.")
		}
	}
	return out, nil
}

func readObject(decoder *json.Decoder, prefix string, out map[string]string) *apiError {
	seen := map[string]bool{}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return errField("file", "The file must be a JSON object whose values are all strings.")
		}
		name, ok := token.(string)
		if !ok {
			return errField("file", "The file must be a JSON object whose values are all strings.")
		}
		if seen[name] {
			return errField("file", "The file must be a JSON object whose values are all strings.")
		}
		seen[name] = true
		full := name
		if prefix != "" {
			full = prefix + "." + name
		}
		value, err := decoder.Token()
		if err != nil {
			return errField("file", "The file must be a JSON object whose values are all strings.")
		}
		switch typed := value.(type) {
		case string:
			out[full] = typed
		case json.Delim:
			if typed != '{' {
				return errField("file", "The file must be a JSON object whose values are all strings.")
			}
			if fail := readObject(decoder, full, out); fail != nil {
				return fail
			}
		default:
			return errField("file", "The file must be a JSON object whose values are all strings.")
		}
	}
	if _, err := decoder.Token(); err != nil {
		return errField("file", "The file must be a JSON object whose values are all strings.")
	}
	return nil
}
