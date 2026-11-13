package serve

import (
	"encoding/json"
)

// mustJSON marshals for storage; it never fails on these shapes.
func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("null")
	}
	return b
}

// jsonUnmarshal parses JSON into a value.
func jsonUnmarshal(data string, v any) error {
return json.Unmarshal([]byte(data), v)
}
