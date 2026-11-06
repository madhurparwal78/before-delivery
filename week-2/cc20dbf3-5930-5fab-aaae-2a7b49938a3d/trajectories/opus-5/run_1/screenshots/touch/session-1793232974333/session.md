
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Common Shed Co. Shedline\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e3]:\n  - link \"Skip to content\" [ref=e4] [cursor=pointer]:\n    - /url: \"#content\"\n  - banner [ref=e5]:\n    - link \"Common Shed Co.\" [ref=e6] [cursor=pointer]:\n      - /url: /\n  - main [ref=e7]:\n    - generic [ref=e9]:\n      - heading \"Sign in\" [level=1] [ref=e10]\n      - generic [ref=e11]:\n        - generic [ref=e12]:\n          - generic [ref=e13]: Email\n          - textbox \"Email\" [ref=e14]\n        - generic [ref=e15]:\n          - generic [ref=e16]: Password\n          - textbox \"Password\" [ref=e17]\n        - button \"Sign in\" [ref=e18] [cursor=pointer]\n        - status \"Form status\"",
  "events": "- New console entries: evidence/touch/console-2026-10-29T00-16-15-010Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Common Shed Co. Shedline\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e3]:\n  - link \"Skip to content\" [ref=e4] [cursor=pointer]:\n    - /url: \"#content\"\n  - banner [ref=e5]:\n    - link \"Common Shed Co.\" [ref=e6] [cursor=pointer]:\n      - /url: /\n  - main [ref=e7]:\n    - generic [ref=e9]:\n      - heading \"Sign in\" [level=1] [ref=e10]\n      - generic [ref=e11]:\n        - generic [ref=e12]:\n          - generic [ref=e13]: Email\n          - textbox \"Email\" [ref=e14]\n        - generic [ref=e15]:\n          - generic [ref=e16]: Password\n          - textbox \"Password\" [ref=e17]\n        - button \"Sign in\" [ref=e18] [cursor=pointer]\n        - status \"Form status\""
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e14",
      "name": "Email",
      "type": "textbox",
      "value": "mina@members.example"
    },
    {
      "target": "e17",
      "name": "Password",
      "type": "textbox",
      "value": "pegboard-2026"
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
  "target": "e18"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/catalogue\n- Page Title: Common Shed Co. Shedline\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e19]:\n  - link \"Skip to content\" [ref=e20] [cursor=pointer]:\n    - /url: \"#content\"\n  - banner [ref=e21]:\n    - link \"Common Shed Co.\" [ref=e22] [cursor=pointer]:\n      - /url: /catalogue\n    - button \"Menu\" [ref=e23] [cursor=pointer]\n    - button \"Sign out\" [ref=e24] [cursor=pointer]\n  - main [ref=e25]:\n    - heading \"Catalogue\" [level=1] [ref=e27]"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/items/stud-finder"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/items/stud-finder\n- Page Title: Common Shed Co. Shedline",
  "snapshot": ""
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
  "page": "- Page URL: http://127.0.0.1:4173/items/stud-finder\n- Page Title: Common Shed Co. Shedline",
  "inlineSnapshot": "- generic [ref=f1e3]:\n  - link \"Skip to content\" [ref=f1e4] [cursor=pointer]:\n    - /url: \"#content\"\n  - banner [ref=f1e5]:\n    - link \"Common Shed Co.\" [ref=f1e6] [cursor=pointer]:\n      - /url: /catalogue\n    - button \"Menu\" [ref=f1e7] [cursor=pointer]\n    - button \"Sign out\" [ref=f1e8] [cursor=pointer]\n  - main [ref=f1e9]:\n    - generic [ref=f1e10]:\n      - heading \"Stud finder\" [level=1] [ref=f1e11]\n      - generic [ref=f1e12]:\n        - generic [ref=f1e13]:\n          - generic [ref=f1e14]:\n            - heading \"Stud finder\" [level=2] [ref=f1e15]\n            - generic [ref=f1e16]: Hand tools\n            - generic [ref=f1e17]: No deposit\n            - generic [ref=f1e18]: Replacement $24.99\n          - generic [ref=f1e19]:\n            - generic [ref=f1e20]\n            - generic [ref=f1e23]\n            - button \"Hold a unit\" [disabled] [ref=f1e26]\n          - region \"Availability\" [ref=f1e27]:\n            - generic [ref=f1e28]\n        - region \"Unit lanes\" [ref=f1e32]:\n          - generic [ref=f1e34]:\n            - group \"Unit SF-1\" [ref=f1e35]\n            - group \"Unit SF-2\" [ref=f1e76]\n      - status \"Claim result\""
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "f1e19",
  "depth": 4
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/items/stud-finder\n- Page Title: Common Shed Co. Shedline",
  "inlineSnapshot": "- generic [ref=f1e19]:\n  - generic [ref=f1e20]:\n    - generic [ref=f1e21]: Pickup date\n    - textbox \"Pickup date\" [ref=f1e22]\n  - generic [ref=f1e23]:\n    - generic [ref=f1e24]: Return date\n    - textbox \"Return date\" [ref=f1e25]\n  - button \"Hold a unit\" [disabled] [ref=f1e26]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e22",
      "name": "Pickup date",
      "type": "textbox",
      "value": "2026-11-03"
    },
    {
      "target": "f1e25",
      "name": "Return date",
      "type": "textbox",
      "value": "2026-11-05"
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
  "element": "Hold a unit",
  "target": "f1e26"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/items/stud-finder\n- Page Title: Common Shed Co. Shedline",
  "snapshot": "- generic [ref=f1e3]:\n  - link \"Skip to content\" [ref=f1e4] [cursor=pointer]:\n    - /url: \"#content\"\n  - banner [ref=f1e5]:\n    - link \"Common Shed Co.\" [ref=f1e6] [cursor=pointer]:\n      - /url: /catalogue\n    - button \"Menu\" [ref=f1e7] [cursor=pointer]\n    - button \"Sign out\" [ref=f1e8] [cursor=pointer]\n  - main [ref=f1e9]:\n    - generic [ref=f1e10]:\n      - heading \"Stud finder\" [level=1] [ref=f1e11]\n      - generic [ref=f1e12]:\n        - generic [ref=f1e13]:\n          - generic [ref=f1e14]:\n            - heading \"Stud finder\" [level=2] [ref=f1e15]\n            - generic [ref=f1e16]: Hand tools\n            - generic [ref=f1e17]: No deposit\n            - generic [ref=f1e18]: Replacement $24.99\n          - generic [ref=f1e19]:\n            - generic [ref=f1e20]:\n              - generic [ref=f1e21]: Pickup date\n              - textbox \"Pickup date\" [ref=f1e22]: 2026-11-03\n            - generic [ref=f1e23]:\n              - generic [ref=f1e24]: Return date\n              - textbox \"Return date\" [ref=f1e25]: 2026-11-05\n            - button \"Hold a unit\" [ref=f1e26] [cursor=pointer]\n          - region \"Availability\" [ref=f1e27]:\n            - generic [ref=f1e28]:\n              - generic [ref=f1e29]: \"2\"\n              - generic [ref=f1e30]: of 2 units free for these dates\n        - region \"Unit lanes\" [ref=f1e32]:\n          - generic [ref=f1e33]:\n            - generic [ref=f1e117]:\n              - group \"Unit SF-1\" [ref=f1e118]:\n                - generic [ref=f1e120]:\n                  - generic [ref=f1e126]: closed\n                  - generic [ref=f1e134]: closed\n                  - generic [ref=f1e142]: closed\n                  - generic [ref=f1e150]: closed\n                - generic [aria-hidden] [ref=f1e153]:\n                  - generic [ref=f1e154]: Wed 28 Oct\n                  - generic [ref=f1e155]: Wed 4 Nov\n                  - generic [ref=f1e156]: Wed 11 Nov\n                  - generic [ref=f1e157]: Wed 18 Nov\n                - generic [ref=f1e158]: Free for the whole window\n              - group \"Unit SF-2\" [ref=f1e159]:\n                - generic [ref=f1e161]:\n                  - generic [ref=f1e167]: closed\n                  - generic [ref=f1e175]: closed\n                  - generic [ref=f1e183]: closed\n                  - generic [ref=f1e191]: closed\n                - generic [aria-hidden] [ref=f1e194]:\n                  - generic [ref=f1e195]: Wed 28 Oct\n                  - generic [ref=f1e196]: Wed 4 Nov\n                  - generic [ref=f1e197]: Wed 11 Nov\n                  - generic [ref=f1e198]: Wed 18 Nov\n                - generic [ref=f1e199]: Free for the whole window\n            - img \"Claim bar\" [ref=f1e200]\n      - status \"Claim result\""
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/my-loans"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/my-loans\n- Page Title: Common Shed Co. Shedline",
  "snapshot": "- generic [ref=f2e3]:\n  - link \"Skip to content\" [ref=f2e4] [cursor=pointer]:\n    - /url: \"#content\"\n  - banner [ref=f2e5]:\n    - link \"Common Shed Co.\" [ref=f2e6] [cursor=pointer]:\n      - /url: /catalogue\n    - button \"Menu\" [ref=f2e7] [cursor=pointer]\n    - button \"Sign out\" [ref=f2e8] [cursor=pointer]\n  - main [ref=f2e9]:\n    - generic [ref=f2e10]:\n      - heading \"My loans\" [level=1] [ref=f2e11]\n      - status \"My loans status\"\n      - generic [ref=f2e12]:\n        - region \"Holds\" [ref=f2e13]:\n          - heading \"Holds\" [level=2] [ref=f2e14]\n          - list\n        - region \"Loans\" [ref=f2e15]:\n          - heading \"Loans\" [level=2] [ref=f2e16]\n          - list"
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
  "page": "- Page URL: http://127.0.0.1:4173/my-loans\n- Page Title: Common Shed Co. Shedline",
  "inlineSnapshot": "- generic [ref=f2e3]:\n  - link \"Skip to content\" [ref=f2e4] [cursor=pointer]:\n    - /url: \"#content\"\n  - banner [ref=f2e5]:\n    - link \"Common Shed Co.\" [ref=f2e6] [cursor=pointer]:\n      - /url: /catalogue\n    - button \"Menu\" [ref=f2e7] [cursor=pointer]\n    - button \"Sign out\" [ref=f2e8] [cursor=pointer]\n  - main [ref=f2e9]:\n    - generic [ref=f2e10]:\n      - heading \"My loans\" [level=1] [ref=f2e11]\n      - status \"My loans status\"\n      - generic [ref=f2e12]:\n        - region \"Holds\" [ref=f2e13]:\n          - heading \"Holds\" [level=2] [ref=f2e14]\n          - list [ref=f2e17]:\n            - listitem \"Stud finder, unit SF-1, Requested, 2026-11-03 to 2026-11-05\" [ref=f2e18]\n            - listitem \"Hedge trimmer, unit HT-1, Requested, 2026-10-30 to 2026-11-01\" [ref=f2e24]\n        - region \"Loans\" [ref=f2e15]:\n          - heading \"Loans\" [level=2] [ref=f2e16]\n          - list [ref=f2e30]:\n            - listitem [ref=f2e31]: No loans yet"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Menu",
  "target": "f2e7"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/my-loans\n- Page Title: Common Shed Co. Shedline",
  "snapshot": "- generic [ref=f2e3]:\n  - link \"Skip to content\" [ref=f2e4] [cursor=pointer]:\n    - /url: \"#content\"\n  - banner [ref=f2e5]:\n    - link \"Common Shed Co.\" [ref=f2e6] [cursor=pointer]:\n      - /url: /catalogue\n    - button \"Menu\" [expanded] [active] [ref=f2e7] [cursor=pointer]\n    - navigation \"Main\" [ref=f2e32]:\n      - link \"Catalogue\" [ref=f2e33] [cursor=pointer]:\n        - /url: /catalogue\n      - link \"My loans\" [ref=f2e34] [cursor=pointer]:\n        - /url: /my-loans\n    - button \"Sign out\" [ref=f2e8] [cursor=pointer]\n  - main [ref=f2e9]:\n    - generic [ref=f2e10]:\n      - heading \"My loans\" [level=1] [ref=f2e11]\n      - status \"My loans status\"\n      - generic [ref=f2e12]:\n        - region \"Holds\" [ref=f2e13]:\n          - heading \"Holds\" [level=2] [ref=f2e14]\n          - list [ref=f2e17]:\n            - listitem \"Stud finder, unit SF-1, Requested, 2026-11-03 to 2026-11-05\" [ref=f2e18]:\n              - generic [ref=f2e19]: Stud finder, unit SF-1\n              - generic [ref=f2e20]: Requested\n              - generic [ref=f2e22]: Tue 3 Nov – Thu 5 Nov\n              - button \"Cancel hold\" [ref=f2e23] [cursor=pointer]\n            - listitem \"Hedge trimmer, unit HT-1, Requested, 2026-10-30 to 2026-11-01\" [ref=f2e24]:\n              - generic [ref=f2e25]: Hedge trimmer, unit HT-1\n              - generic [ref=f2e26]: Requested\n              - generic [ref=f2e28]: Fri 30 Oct – Sun 1 Nov\n              - button \"Cancel hold\" [ref=f2e29] [cursor=pointer]\n        - region \"Loans\" [ref=f2e15]:\n          - heading \"Loans\" [level=2] [ref=f2e16]\n          - list [ref=f2e30]:\n            - listitem [ref=f2e31]: No loans yet"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Menu",
  "target": "f2e7"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/my-loans\n- Page Title: Common Shed Co. Shedline",
  "snapshot": "- generic [ref=f2e3]:\n  - link \"Skip to content\" [ref=f2e4] [cursor=pointer]:\n    - /url: \"#content\"\n  - banner [ref=f2e5]:\n    - link \"Common Shed Co.\" [ref=f2e6] [cursor=pointer]:\n      - /url: /catalogue\n    - button \"Menu\" [active] [ref=f2e7] [cursor=pointer]\n    - button \"Sign out\" [ref=f2e8] [cursor=pointer]\n  - main [ref=f2e9]:\n    - generic [ref=f2e10]:\n      - heading \"My loans\" [level=1] [ref=f2e11]\n      - status \"My loans status\"\n      - generic [ref=f2e12]:\n        - region \"Holds\" [ref=f2e13]:\n          - heading \"Holds\" [level=2] [ref=f2e14]\n          - list [ref=f2e17]:\n            - listitem \"Stud finder, unit SF-1, Requested, 2026-11-03 to 2026-11-05\" [ref=f2e35]:\n              - generic [ref=f2e36]: Stud finder, unit SF-1\n              - generic [ref=f2e37]: Requested\n              - generic [ref=f2e39]: Tue 3 Nov – Thu 5 Nov\n              - button \"Cancel hold\" [ref=f2e40] [cursor=pointer]\n            - listitem \"Hedge trimmer, unit HT-1, Requested, 2026-10-30 to 2026-11-01\" [ref=f2e41]:\n              - generic [ref=f2e42]: Hedge trimmer, unit HT-1\n              - generic [ref=f2e43]: Requested\n              - generic [ref=f2e45]: Fri 30 Oct – Sun 1 Nov\n              - button \"Cancel hold\" [ref=f2e46] [cursor=pointer]\n        - region \"Loans\" [ref=f2e15]:\n          - heading \"Loans\" [level=2] [ref=f2e16]\n          - list [ref=f2e30]:\n            - listitem [ref=f2e47]: No loans yet"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Holds with first rows",
  "target": "f2e13",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of Holds with first rows](evidence/touch/element-2026-10-29T00-17-26-916Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
