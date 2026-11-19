
### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/signin"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Sprigmap",
  "snapshot": "- generic [active] [ref=e1]:\n  - generic [ref=e2]:\n    - banner [ref=e3]:\n      - link \"Sprigmap\" [ref=e4] [cursor=pointer]:\n        - /url: /\n    - generic [ref=e5]:\n      - heading \"Sign in\" [level=1] [ref=e6]\n      - alert\n      - generic [ref=e7]: Username\n      - textbox \"Username\" [ref=e8]\n      - generic [ref=e9]: Password\n      - textbox \"Password\" [ref=e10]\n      - button \"Sign in\" [ref=e11] [cursor=pointer]\n  - region \"Notices\""
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "input[name=username]",
      "name": "Username",
      "type": "textbox",
      "value": "judge_q7m2kx"
    },
    {
      "target": "input[name=password]",
      "name": "Password",
      "type": "textbox",
      "value": "wrong"
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
  "target": "button"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Sprigmap\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - generic [ref=e2]:\n    - banner [ref=e3]:\n      - link \"Sprigmap\" [ref=e4] [cursor=pointer]:\n        - /url: /\n    - generic [ref=e5]:\n      - heading \"Sign in\" [level=1] [ref=e6]\n      - alert [ref=e12]: Wrong username or password.\n      - generic [ref=e7]: Username\n      - textbox \"Username\" [ref=e8]: judge_q7m2kx\n      - generic [ref=e9]: Password\n      - textbox \"Password\" [ref=e10]: wrong\n      - button \"Sign in\" [active] [ref=e11] [cursor=pointer]\n  - region \"Notices\"",
  "events": "- New console entries: evidence/touch/console-2026-11-12T20-56-33-541Z.log#L1"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "input[name=password]",
      "name": "Password",
      "type": "textbox",
      "value": "sprig-pass-1"
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
  "target": "button"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/maps\n- Page Title: Sprigmap",
  "snapshot": "- generic [active]:\n  - region \"Notices\""
}
```
