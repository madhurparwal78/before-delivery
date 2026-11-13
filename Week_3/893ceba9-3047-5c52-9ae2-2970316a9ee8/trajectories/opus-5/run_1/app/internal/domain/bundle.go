package domain

import (
	"sort"
	"strings"
	"unicode/utf8"
)

// Bundle writes the one published locale bundle format: a flat JSON object of
// dotted key names, sorted by Unicode code point, two-space indentation,
// non-ASCII characters as themselves and a trailing newline.
func Bundle(values map[string]string) []byte {
	if len(values) == 0 {
		return []byte("{}\n")
	}
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool { return codePointLess(names[i], names[j]) })

	var b strings.Builder
	b.WriteString("{\n")
	for i, name := range names {
		b.WriteString("  ")
		writeJSONString(&b, name)
		b.WriteString(": ")
		writeJSONString(&b, values[name])
		if i < len(names)-1 {
			b.WriteString(",")
		}
		b.WriteString("\n")
	}
	b.WriteString("}\n")
	return []byte(b.String())
}

// codePointLess compares two strings by Unicode code point.
func codePointLess(a, b string) bool {
	for a != "" && b != "" {
		ra, sizeA := utf8.DecodeRuneInString(a)
		rb, sizeB := utf8.DecodeRuneInString(b)
		if ra != rb {
			return ra < rb
		}
		a, b = a[sizeA:], b[sizeB:]
	}
	return len(a) < len(b)
}

const hexDigits = "0123456789abcdef"

func writeJSONString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		default:
			if r < 0x20 {
				b.WriteString(`\u00`)
				b.WriteByte(hexDigits[(r>>4)&0xf])
				b.WriteByte(hexDigits[r&0xf])
				continue
			}
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
}
