package main

import (
	"bytes"
	"encoding/json"
)

func jsonMarshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func jsonUnmarshal(b []byte, v any) error {
	return json.Unmarshal(b, v)
}
