
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Bottega Semenza\n- Console: 3 errors, 0 warnings",
  "snapshot": "- generic [active] [ref=e1]:\n  - banner [ref=e2]:\n    - link \"Bottega Semenza\" [ref=e3] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e4]:\n      - button \"Work\" [ref=e5]\n      - link \"Enquire\" [ref=e6] [cursor=pointer]:\n        - /url: /enquire\n      - link \"Sign in\" [ref=e7] [cursor=pointer]:\n        - /url: /sign-in\n  - main [ref=e8]:\n    - heading \"ONE CHAIR AT A TIME.\" [level=1] [ref=e9]\n    - paragraph [ref=e10]: A conservator's desk in Turin, re-covering twentieth-century design chairs for Turin, London, New York, Kyoto and Dubai.\n    - link \"Send an enquiry\" [ref=e11] [cursor=pointer]:\n      - /url: /enquire\n    - generic [ref=e13]:\n      - paragraph [ref=e14]: \"38.75\"\n      - paragraph [ref=e15]: sq ft of one hide used for the Bentwood armchair\n  - contentinfo [ref=e940]:\n    - paragraph [ref=e941]: Bottega Semenza, Turin. One chair at a time.",
  "events": "- New console entries: evidence/touch/console-2026-11-16T11-42-53-400Z.log#L1-L3"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 2
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Bottega Semenza\n- Console: 3 errors, 0 warnings",
  "inlineSnapshot": "- generic [active] [ref=e1]:\n  - banner [ref=e2]:\n    - link \"Bottega Semenza\" [ref=e3] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e4]\n  - main [ref=e8]:\n    - heading \"ONE CHAIR AT A TIME.\" [level=1] [ref=e9]\n    - paragraph [ref=e10]: A conservator's desk in Turin, re-covering twentieth-century design chairs for Turin, London, New York, Kyoto and Dubai.\n    - link \"Send an enquiry\" [ref=e11] [cursor=pointer]:\n      - /url: /enquire\n    - generic [ref=e13]\n  - contentinfo [ref=e940]:\n    - paragraph [ref=e941]: Bottega Semenza, Turin. One chair at a time."
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "e4",
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Bottega Semenza\n- Console: 3 errors, 0 warnings",
  "inlineSnapshot": "- navigation [ref=e4]:\n  - button \"Work\" [ref=e5]\n  - link \"Enquire\" [ref=e6] [cursor=pointer]:\n    - /url: /enquire\n  - link \"Sign in\" [ref=e7] [cursor=pointer]:\n    - /url: /sign-in"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Work button",
  "target": "e5"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Bottega Semenza\n- Console: 3 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - banner [ref=e2]:\n    - link \"Bottega Semenza\" [ref=e3] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e4]:\n      - button \"Work\" [active] [ref=e5]\n      - link \"Enquire\" [ref=e6] [cursor=pointer]:\n        - /url: /enquire\n      - link \"Sign in\" [ref=e7] [cursor=pointer]:\n        - /url: /sign-in\n  - main [ref=e8]:\n    - heading \"ONE CHAIR AT A TIME.\" [level=1] [ref=e9]\n    - paragraph [ref=e10]: A conservator's desk in Turin, re-covering twentieth-century design chairs for Turin, London, New York, Kyoto and Dubai.\n    - link \"Send an enquiry\" [ref=e11] [cursor=pointer]:\n      - /url: /enquire\n    - generic [ref=e13]:\n      - paragraph [ref=e14]: \"38.75\"\n      - paragraph [ref=e15]: sq ft of one hide used for the Bentwood armchair\n  - contentinfo [ref=e940]:\n    - paragraph [ref=e941]: Bottega Semenza, Turin. One chair at a time."
}
```

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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Sign in — Semenza Desk\n- Console: 3 errors, 0 warnings",
  "snapshot": "- main [ref=f1e2]:\n  - link \"Bottega Semenza\" [ref=f1e3] [cursor=pointer]:\n    - /url: /\n  - heading \"Sign in\" [level=1] [ref=f1e4]\n  - generic [ref=f1e5]:\n    - generic [ref=f1e6]:\n      - text: Email\n      - textbox \"Email\" [ref=f1e7]\n    - generic [ref=f1e8]:\n      - text: Password\n      - textbox \"Password\" [ref=f1e9]\n    - button \"Sign in\" [ref=f1e10]\n    - paragraph [ref=f1e11]:\n      - link \"Start a desk\" [ref=f1e12] [cursor=pointer]:\n        - /url: /sign-up",
  "events": "- New console entries: evidence/touch/console-2026-11-16T11-44-08-675Z.log#L1-L3"
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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Sign in — Semenza Desk\n- Console: 3 errors, 0 warnings",
  "inlineSnapshot": "- main [ref=f1e2]:\n  - link \"Bottega Semenza\" [ref=f1e3] [cursor=pointer]:\n    - /url: /\n  - heading \"Sign in\" [level=1] [ref=f1e4]\n  - generic [ref=f1e5]:\n    - generic [ref=f1e6]:\n      - text: Email\n      - textbox \"Email\" [ref=f1e7]\n    - generic [ref=f1e8]:\n      - text: Password\n      - textbox \"Password\" [ref=f1e9]\n    - button \"Sign in\" [ref=f1e10]\n    - paragraph [ref=f1e11]:\n      - link \"Start a desk\" [ref=f1e12] [cursor=pointer]:\n        - /url: /sign-up"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e7",
      "name": "Email",
      "type": "textbox",
      "value": "agnese@bottega-semenza.example"
    },
    {
      "target": "f1e9",
      "name": "Password",
      "type": "textbox",
      "value": "tacks-and-hide-2027"
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
  "target": "f1e10"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in?email=agnese%40bottega-semenza.example&password=tacks-and-hide-2027\n- Page Title: Sign in — Semenza Desk\n- Console: 3 errors, 0 warnings",
  "snapshot": "- main [ref=f2e2]:\n  - link \"Bottega Semenza\" [ref=f2e3] [cursor=pointer]:\n    - /url: /\n  - heading \"Sign in\" [level=1] [ref=f2e4]\n  - generic [ref=f2e5]:\n    - generic [ref=f2e6]:\n      - text: Email\n      - textbox \"Email\" [ref=f2e7]\n    - generic [ref=f2e8]:\n      - text: Password\n      - textbox \"Password\" [ref=f2e9]\n    - button \"Sign in\" [ref=f2e10]\n    - paragraph [ref=f2e11]:\n      - link \"Start a desk\" [ref=f2e12] [cursor=pointer]:\n        - /url: /sign-up",
  "events": "- New console entries: evidence/touch/console-2026-11-16T11-44-08-675Z.log#L4-L6"
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
  "result": "- [Screenshot of viewport](evidence/touch/page-2026-11-16T11-44-19-797Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
