
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Sign in",
  "snapshot": "- generic [active] [ref=e1]:\n  - generic [ref=e2]:\n    - banner [ref=e3]:\n      - link \"Sprigmap\" [ref=e4] [cursor=pointer]:\n        - /url: /\n    - main [ref=e7]:\n      - generic [ref=e8]:\n        - heading \"Sign in to Sprigmap\" [level=1] [ref=e9]\n        - alert\n        - generic [ref=e10]:\n          - generic [ref=e11]: Username\n          - textbox \"Username\" [ref=e12]\n          - paragraph\n        - generic [ref=e13]:\n          - generic [ref=e14]: Password\n          - textbox \"Password\" [ref=e15]\n          - paragraph\n        - button \"Sign in\" [ref=e16] [cursor=pointer]\n        - paragraph [ref=e17]:\n          - link \"Create an account instead\" [ref=e18] [cursor=pointer]:\n            - /url: /signup\n  - status \"Map announcements\" [ref=e19]\n  - region \"Notices\""
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 6
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Sign in",
  "inlineSnapshot": "- generic [active] [ref=e1]:\n  - generic [ref=e2]:\n    - banner [ref=e3]:\n      - link \"Sprigmap\" [ref=e4] [cursor=pointer]:\n        - /url: /\n    - main [ref=e7]:\n      - generic [ref=e8]:\n        - heading \"Sign in to Sprigmap\" [level=1] [ref=e9]\n        - alert\n        - generic [ref=e10]:\n          - generic [ref=e11]: Username\n          - textbox \"Username\" [ref=e12]\n          - paragraph\n        - generic [ref=e13]:\n          - generic [ref=e14]: Password\n          - textbox \"Password\" [ref=e15]\n          - paragraph\n        - button \"Sign in\" [ref=e16] [cursor=pointer]\n        - paragraph [ref=e17]:\n          - link \"Create an account instead\" [ref=e18] [cursor=pointer]:\n            - /url: /signup\n  - status \"Map announcements\" [ref=e19]\n  - region \"Notices\""
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e12",
      "name": "Username",
      "type": "textbox",
      "value": "judge_q7m2kx"
    },
    {
      "target": "e15",
      "name": "Password",
      "type": "textbox",
      "value": "wrong-pass"
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
  "target": "e16"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Sign in\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - generic [ref=e2]:\n    - banner [ref=e3]:\n      - link \"Sprigmap\" [ref=e4] [cursor=pointer]:\n        - /url: /\n    - main [ref=e7]:\n      - generic [ref=e8]:\n        - heading \"Sign in to Sprigmap\" [level=1] [ref=e9]\n        - alert [ref=e20]: Wrong username or password.\n        - generic [ref=e10]:\n          - generic [ref=e11]: Username\n          - textbox \"Username\" [ref=e12]: judge_q7m2kx\n          - paragraph\n        - generic [ref=e13]:\n          - generic [ref=e14]: Password\n          - textbox \"Password\" [ref=e15]: wrong-pass\n          - paragraph\n        - button \"Sign in\" [active] [ref=e16] [cursor=pointer]\n        - paragraph [ref=e17]:\n          - link \"Create an account instead\" [ref=e18] [cursor=pointer]:\n            - /url: /signup\n  - status \"Map announcements\" [ref=e19]\n  - region \"Notices\"",
  "events": "- New console entries: evidence/touch/console-2026-11-10T15-52-21-344Z.log#L1"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e15",
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
  "target": "e16"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/maps\n- Page Title: Your maps\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [active] [ref=e1]:\n  - generic [ref=e2]:\n    - banner [ref=e21]:\n      - link \"Sprigmap\" [ref=e22] [cursor=pointer]:\n        - /url: /\n      - button \"Inbox (0)\" [ref=e26] [cursor=pointer]\n    - main [ref=e27]:\n      - generic [ref=e28]:\n        - heading \"Your maps\" [level=1] [ref=e29]\n        - button \"New map\" [ref=e30] [cursor=pointer]\n      - region \"Recent maps\" [ref=e31]:\n        - heading \"Recent maps\" [level=2] [ref=e32]\n        - list [ref=e33]:\n          - listitem [ref=e34]:\n            - link \"Fair q7m2kx\" [ref=e50] [cursor=pointer]:\n              - /url: /m/8d1020f7-f824-4cff-8e4b-96255984558a\n            - paragraph [ref=e51]: 7 topics · owner\n          - listitem [ref=e52]:\n            - link \"Move q7m2kx\" [ref=e64] [cursor=pointer]:\n              - /url: /m/af110567-dc7f-422b-b488-fde213a3a1f8\n            - paragraph [ref=e65]: 5 topics · owner\n          - listitem [ref=e66]:\n            - link \"Revise q7m2kx\" [ref=e82] [cursor=pointer]:\n              - /url: /m/2ef78a0a-fd8e-441c-9365-5369be313d64\n            - paragraph [ref=e83]: 7 topics · owner\n      - list \"All maps\" [ref=e84]:\n        - listitem [ref=e85]:\n          - link \"Fair q7m2kx\" [ref=e101] [cursor=pointer]:\n            - /url: /m/8d1020f7-f824-4cff-8e4b-96255984558a\n          - paragraph [ref=e102]: 7 topics · owner\n        - listitem [ref=e103]:\n          - link \"Move q7m2kx\" [ref=e115] [cursor=pointer]:\n            - /url: /m/af110567-dc7f-422b-b488-fde213a3a1f8\n          - paragraph [ref=e116]: 5 topics · owner\n        - listitem [ref=e117]:\n          - link \"Revise q7m2kx\" [ref=e133] [cursor=pointer]:\n            - /url: /m/2ef78a0a-fd8e-441c-9365-5369be313d64\n          - paragraph [ref=e134]: 7 topics · owner\n  - status \"Map announcements\" [ref=e19]\n  - region \"Notices\""
}
```
