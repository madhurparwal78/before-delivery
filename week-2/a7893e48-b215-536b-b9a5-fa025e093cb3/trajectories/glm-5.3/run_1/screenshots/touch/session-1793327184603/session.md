
### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/board"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- HTTP status: 404 Not Found\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [active] [ref=e1]: Not found",
  "events": "- New console entries: evidence/touch/console-2026-10-30T02-26-24-692Z.log#L1"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- status \"Service status\" [active] [ref=f1e1]:\n  - main [ref=f1e2]:\n    - generic [ref=f1e3]:\n      - heading \"Hearthshift\" [level=1] [ref=f1e4]\n      - generic [ref=f1e5]:\n        - generic [ref=f1e6]: Email\n        - textbox \"Email\" [ref=f1e7]\n      - generic [ref=f1e8]:\n        - generic [ref=f1e9]: Password\n        - textbox \"Password\" [ref=f1e10]\n      - button \"Sign in\" [ref=f1e11] [cursor=pointer]\n      - status \"Sign-in status\" [ref=f1e12]",
  "events": "- New console entries: evidence/touch/console-2026-10-30T02-26-29-668Z.log#L1"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 4
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- status \"Service status\" [active] [ref=f1e1]:\n  - main [ref=f1e2]:\n    - generic [ref=f1e3]:\n      - heading \"Hearthshift\" [level=1] [ref=f1e4]\n      - generic [ref=f1e5]:\n        - generic [ref=f1e6]: Email\n        - textbox \"Email\" [ref=f1e7]\n      - generic [ref=f1e8]:\n        - generic [ref=f1e9]: Password\n        - textbox \"Password\" [ref=f1e10]\n      - button \"Sign in\" [ref=f1e11] [cursor=pointer]\n      - status \"Sign-in status\" [ref=f1e12]",
  "events": "- New console entries: evidence/touch/console-2026-10-30T02-26-29-668Z.log#L2"
}
```

### Tool call: browser_console_messages
- Args
```json
{
  "level": "error",
  "all": true
}
```
- Result
```json
{
  "result": "Total messages: 2 (Errors: 1, Warnings: 0)\n\n[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) @ http://127.0.0.1:4173/board:0\n[ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized) @ http://127.0.0.1:4173/api/me:0"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 5
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- status \"Service status\" [active] [ref=f1e1]"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/?x=1"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/?x=1\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- status \"Service status\" [active] [ref=f2e1]:\n  - main [ref=f2e2]:\n    - generic [ref=f2e3]:\n      - heading \"Hearthshift\" [level=1] [ref=f2e4]\n      - generic [ref=f2e5]:\n        - generic [ref=f2e6]: Email\n        - textbox \"Email\" [ref=f2e7]\n      - generic [ref=f2e8]:\n        - generic [ref=f2e9]: Password\n        - textbox \"Password\" [ref=f2e10]\n      - button \"Sign in\" [ref=f2e11] [cursor=pointer]\n      - status \"Sign-in status\" [ref=f2e12]",
  "events": "- New console entries: evidence/touch/console-2026-10-30T02-27-19-906Z.log#L1"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 5
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/?x=1\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- status \"Service status\" [active] [ref=f2e1]:\n  - main [ref=f2e2]:\n    - generic [ref=f2e3]:\n      - heading \"Hearthshift\" [level=1] [ref=f2e4]\n      - generic [ref=f2e5]:\n        - generic [ref=f2e6]: Email\n        - textbox \"Email\" [ref=f2e7]\n      - generic [ref=f2e8]:\n        - generic [ref=f2e9]: Password\n        - textbox \"Password\" [ref=f2e10]\n      - button \"Sign in\" [ref=f2e11] [cursor=pointer]\n      - status \"Sign-in status\" [ref=f2e12]",
  "events": "- New console entries: evidence/touch/console-2026-10-30T02-27-19-906Z.log#L2"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/touch/page-2026-10-30T02-27-25-457Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
