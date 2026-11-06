
### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/sign-in"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Clinchline — Rasp & Rein\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - form \"Sign in\" [ref=e3]:\n    - heading \"Rasp & Rein Clinchline\" [level=1] [ref=e4]\n    - generic [ref=e5]:\n      - text: Email\n      - textbox \"Email\" [ref=e6]\n    - generic [ref=e7]:\n      - text: Password\n      - textbox \"Password\" [ref=e8]\n    - button \"Sign in\" [ref=e9] [cursor=pointer]\n  - status \"Notices\" [ref=e10]",
  "events": "- New console entries: evidence/touch/console-2026-11-03T20-52-56-318Z.log#L1-L2"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Clinchline — Rasp & Rein\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - form \"Sign in\" [ref=e3]:\n    - heading \"Rasp & Rein Clinchline\" [level=1] [ref=e4]\n    - generic [ref=e5]:\n      - text: Email\n      - textbox \"Email\" [ref=e6]\n    - generic [ref=e7]:\n      - text: Password\n      - textbox \"Password\" [ref=e8]\n    - button \"Sign in\" [ref=e9] [cursor=pointer]\n  - status \"Notices\" [ref=e10]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e6",
      "name": "Email",
      "type": "textbox",
      "value": "farrier@clinchline.test"
    },
    {
      "target": "e8",
      "name": "Password",
      "type": "textbox",
      "value": "hoofcare-2026"
    }
  ]
}
```
- Result
```json
{}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Sign in",
  "target": "e9"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Clinchline — Rasp & Rein\n- Console: 1 errors, 0 warnings",
  "snapshot": ""
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Clinchline — Rasp & Rein\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=f1e2]:\n  - form \"Sign in\" [ref=f1e3]:\n    - heading \"Rasp & Rein Clinchline\" [level=1] [ref=f1e4]\n    - generic [ref=f1e5]:\n      - text: Email\n      - textbox \"Email\" [ref=f1e6]\n    - generic [ref=f1e7]:\n      - text: Password\n      - textbox \"Password\" [ref=f1e8]\n    - button \"Sign in\" [ref=f1e9] [cursor=pointer]\n  - status \"Notices\" [ref=f1e10]",
  "events": "- New console entries: evidence/touch/console-2026-11-03T20-52-56-318Z.log#L3-L4"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e6",
      "name": "Email",
      "type": "textbox",
      "value": "farrier@clinchline.test"
    },
    {
      "target": "f1e8",
      "name": "Password",
      "type": "textbox",
      "value": "hoofcare-2026"
    }
  ]
}
```
- Result
```json
{}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Sign in retry",
  "target": "f1e9"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Clinchline — Rasp & Rein\n- Console: 1 errors, 0 warnings",
  "snapshot": ""
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/touch/page-2026-11-03T20-53-49-967Z.png)",
  "events": "- New console entries: evidence/touch/console-2026-11-03T20-52-56-318Z.log#L5-L6",
  "attachments": [
    {
      "type": "image",
      "data": "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EyWpYsq3vrNgiTLHUsYAgJosBgA0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHQPnW07AAAFRklEQVSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHSRMgB0kTIAdJEyAHT9HwAA//+QU/1+AAAABklEQVQDAEL1HxmdQey9AAAAAElFTkSuQmCC",
      "mimeType": "image/png"
    }
  ]
}
```
