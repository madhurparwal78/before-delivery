
### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Credwell\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Credwell\" [ref=e4] [cursor=pointer]:\n      - /url: /courses\n    - button \"Menu\" [ref=e5] [cursor=pointer]\n  - main [ref=e7]:\n    - generic [ref=e9]:\n      - heading \"Sign in to Credwell\" [level=1] [ref=e10]\n      - textbox \"Email\" [ref=e11]\n      - textbox \"Password\" [ref=e12]\n      - button \"Sign in\" [ref=e13] [cursor=pointer]\n  - status \"Activity status\" [ref=e14]",
  "events": "- New console entries: evidence/touch/console-2026-10-30T15-17-58-440Z.log#L1"
}
```

### Tool call: browser_snapshot
- Args
```json
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Credwell\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Credwell\" [ref=e4] [cursor=pointer]:\n      - /url: /courses\n    - button \"Menu\" [ref=e5] [cursor=pointer]\n  - main [ref=e7]:\n    - generic [ref=e9]:\n      - heading \"Sign in to Credwell\" [level=1] [ref=e10]\n      - textbox \"Email\" [ref=e11]\n      - textbox \"Password\" [ref=e12]\n      - button \"Sign in\" [ref=e13] [cursor=pointer]\n  - status \"Activity status\" [ref=e14]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e11",
      "name": "Email",
      "type": "textbox",
      "value": "dev.patel@mail.test"
    },
    {
      "target": "e12",
      "name": "Password",
      "type": "textbox",
      "value": "credwell-demo-1"
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
  "target": "e13"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/courses\n- Page Title: Credwell\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Credwell\" [ref=e4] [cursor=pointer]:\n      - /url: /courses\n    - button \"Sign out\" [ref=e15] [cursor=pointer]\n    - button \"Menu\" [ref=e5] [cursor=pointer]\n  - main [ref=e7]:\n    - heading \"Courses\" [level=1] [ref=e16]\n    - list \"Course catalogue\" [ref=e17]:\n      - listitem [ref=e18]:\n        - link \"Delirium Screening at the Bedside\" [ref=e19] [cursor=pointer]:\n          - /url: /courses/c0000000-0000-4000-8000-000000000003\n        - generic [ref=e20]:\n          - generic [ref=e21]: Self-paced\n          - generic [ref=e22]: 55 min\n          - generic [ref=e23]: 0.75 h\n          - generic [ref=e24]: $45.50\n      - listitem [ref=e25]:\n        - link \"Safe Opioid Stewardship\" [ref=e26] [cursor=pointer]:\n          - /url: /courses/c0000000-0000-4000-8000-000000000002\n        - generic [ref=e27]:\n          - generic [ref=e28]: Live cohort\n          - generic [ref=e29]: 120 min\n          - generic [ref=e30]: 2.00 h\n          - generic [ref=e31]: $140.00\n      - listitem [ref=e32]:\n        - link \"Sepsis Recognition in the First Hour\" [ref=e33] [cursor=pointer]:\n          - /url: /courses/c0000000-0000-4000-8000-000000000001\n        - generic [ref=e34]:\n          - generic [ref=e35]: Self-paced\n          - generic [ref=e36]: 75 min\n          - generic [ref=e37]: 1.25 h\n          - generic [ref=e38]: $90.00\n  - status \"Activity status\" [ref=e14]"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/learn/00000000-0000-4000-8000-000000000000/seal"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/learning\n- Page Title: Credwell\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e3]:\n    - link \"Credwell\" [ref=f1e4] [cursor=pointer]:\n      - /url: /courses\n    - button \"Sign out\" [ref=f1e5] [cursor=pointer]\n    - button \"Menu\" [ref=f1e6] [cursor=pointer]\n  - generic [ref=f1e7]:\n    - main\n  - status \"Activity status\" [ref=f1e8]",
  "events": "- New console entries: evidence/touch/console-2026-10-30T15-18-11-411Z.log#L1"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "fullPage": true,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of full page](evidence/touch/page-2026-10-30T15-18-15-631Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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EEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpUBR81MAAAPcSURBVDJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEEtlgFgqA8RSGSCWygCxVAaIpTJALJUBYqkMEOv/AQAA//+IzIGcAAAABklEQVQDAMn/NIa8TivtAAAAAElFTkSuQmCC",
      "mimeType": "image/png"
    }
  ]
}
```
