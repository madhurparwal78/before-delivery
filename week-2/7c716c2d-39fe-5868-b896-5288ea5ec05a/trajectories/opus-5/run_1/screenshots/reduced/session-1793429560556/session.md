
### Tool call: browser_resize
- Args
```json
{
  "width": 1280,
  "height": 800
}
```
- Result
```json
{
  "page": "- Page URL: about:blank"
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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Tallyroom\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - region \"Service notices\"\n  - status \"Announcements\" [ref=e3]\n  - main [ref=e4]:\n    - form \"Sign in\" [ref=e5]:\n      - heading \"Sign in\" [level=1] [ref=e6]\n      - generic [ref=e7]: Email\n      - textbox \"Email\" [active] [ref=e8]\n      - generic [ref=e9]: Password\n      - textbox \"Password\" [ref=e10]\n      - button \"Sign in\" [ref=e11] [cursor=pointer]\n      - status [ref=e12]\n      - link \"Create an account\" [ref=e13] [cursor=pointer]:\n        - /url: /create-account",
  "events": "- New console entries: evidence/reduced/console-2026-10-31T06-52-44-336Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Tallyroom\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - region \"Service notices\"\n  - status \"Announcements\" [ref=e3]\n  - main [ref=e4]:\n    - form \"Sign in\" [ref=e5]:\n      - heading \"Sign in\" [level=1] [ref=e6]\n      - generic [ref=e7]: Email\n      - textbox \"Email\" [active] [ref=e8]\n      - generic [ref=e9]: Password\n      - textbox \"Password\" [ref=e10]\n      - button \"Sign in\" [ref=e11] [cursor=pointer]\n      - status [ref=e12]\n      - link \"Create an account\" [ref=e13] [cursor=pointer]:\n        - /url: /create-account"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e8",
      "name": "Email",
      "type": "textbox",
      "value": "ben@kereru.test"
    },
    {
      "target": "e10",
      "name": "Password",
      "type": "textbox",
      "value": "tally-demo-1"
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
  "target": "e11"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/issues\n- Page Title: Tallyroom\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - region \"Service notices\"\n  - status \"Announcements\" [ref=e14]\n  - generic [ref=e15]:\n    - navigation \"Modules\" [ref=e16]:\n      - link \"Issues\" [ref=e17] [cursor=pointer]:\n        - /url: /issues\n      - link \"Cycle\" [ref=e22] [cursor=pointer]:\n        - /url: /cycle\n      - link \"Chat\" [ref=e25] [cursor=pointer]:\n        - /url: /chat/inbox\n      - link \"Docs\" [ref=e30] [cursor=pointer]:\n        - /url: /docs\n      - link \"Office\" [ref=e35] [cursor=pointer]:\n        - /url: /office\n      - link \"Account\" [ref=e40] [cursor=pointer]:\n        - /url: /account\n      - button \"Sign out\" [ref=e45] [cursor=pointer]\n    - region \"List\" [ref=e50]:\n      - generic [ref=e51]:\n        - generic [ref=e52]:\n          - generic [ref=e53]: Project\n          - combobox \"Project filter\" [ref=e54]:\n            - option \"All projects\" [selected]\n            - option \"Atlas\"\n            - option \"Kiln\"\n        - generic [ref=e55]:\n          - generic [ref=e56]: Cycle\n          - combobox \"Cycle filter\" [ref=e57]:\n            - option \"Current cycle\" [selected]\n            - option \"All cycles\"\n            - option \"No cycle\"\n            - option \"Cycle 1\"\n        - button \"New issue\" [ref=e58] [cursor=pointer]\n      - grid \"Issues\" [ref=e59]:\n        - rowgroup [ref=e60]:\n          - text: Todo\n          - row \"ATL-1 Atlas search index\" [ref=e61]:\n            - gridcell \"ATL-1\" [ref=e62]\n            - gridcell \"Atlas search index\" [ref=e63]\n            - gridcell [ref=e64]:\n              - 'button \"Status: Todo\" [ref=e65] [cursor=pointer]': Todo\n            - gridcell [ref=e66]:\n              - 'button \"Assignee: Elin Park\" [ref=e67] [cursor=pointer]': Elin Park\n            - gridcell\n          - row \"KIL-1 Kiln onboarding checklist\" [ref=e68]:\n            - gridcell \"KIL-1\" [ref=e69]\n            - gridcell \"Kiln onboarding checklist\" [ref=e70]\n            - gridcell [ref=e71]:\n              - 'button \"Status: Todo\" [ref=e72] [cursor=pointer]': Todo\n            - gridcell [ref=e73]:\n              - 'button \"Assignee: Ben Ostrow\" [ref=e74] [cursor=pointer]': Ben Ostrow\n            - gridcell\n          - row \"KIL-4 Export date format\" [ref=e75]:\n            - gridcell \"KIL-4\" [ref=e76]\n            - gridcell \"Export date format\" [ref=e77]\n            - gridcell [ref=e78]:\n              - 'button \"Status: Todo\" [ref=e79] [cursor=pointer]': Todo\n            - gridcell [ref=e80]:\n              - 'button \"Assignee: Dev Ramaswamy\" [ref=e81] [cursor=pointer]': Dev Ramaswamy\n            - gridcell\n        - rowgroup [ref=e82]:\n          - text: In progress\n          - row \"KIL-2 Kiln billing export\" [ref=e83]:\n            - gridcell \"KIL-2\" [ref=e84]\n            - gridcell \"Kiln billing export\" [ref=e85]\n            - gridcell [ref=e86]:\n              - 'button \"Status: In progress\" [ref=e87] [cursor=pointer]': In progress\n            - gridcell [ref=e88]:\n              - 'button \"Assignee: Chiara Lund\" [ref=e89] [cursor=pointer]': Chiara Lund\n            - gridcell\n        - rowgroup [ref=e90]:\n          - text: In review\n          - row \"KIL-5 Kiln review checklist\" [ref=e91]:\n            - gridcell \"KIL-5\" [ref=e92]\n            - gridcell \"Kiln review checklist\" [ref=e93]\n            - gridcell [ref=e94]:\n              - 'button \"Status: In review\" [ref=e95] [cursor=pointer]': In review\n            - gridcell [ref=e96]:\n              - 'button \"Assignee: Femi Ade\" [ref=e97] [cursor=pointer]': Femi Ade\n            - gridcell\n        - rowgroup [ref=e98]:\n          - text: Done\n          - row \"KIL-3 Export CSV header row\" [ref=e99]:\n            - gridcell \"KIL-3\" [ref=e100]\n            - gridcell \"Export CSV header row\" [ref=e101]\n            - gridcell [ref=e102]:\n              - 'button \"Status: Done\" [ref=e103] [cursor=pointer]': Done\n            - gridcell [ref=e104]:\n              - 'button \"Assignee: Chiara Lund\" [ref=e105] [cursor=pointer]': Chiara Lund\n            - gridcell\n    - region \"Detail\" [ref=e106]:\n      - paragraph [ref=e108]: Choose an issue to see its sheet."
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/cycle"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/cycle\n- Page Title: Tallyroom",
  "snapshot": ""
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "boxes": true
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/cycle\n- Page Title: Tallyroom",
  "inlineSnapshot": "- generic [ref=f1e2] [box=0,0,1280,800]:\n  - region \"Service notices\" [box=0,0,1280,0]\n  - status \"Announcements\" [ref=f1e3] [box=0,0,1,1]\n  - generic [ref=f1e4] [box=0,0,1280,800]:\n    - navigation \"Modules\" [ref=f1e5] [box=0,0,56,800]:\n      - link \"Issues\" [ref=f1e6] [cursor=pointer] [box=4,4,48,44]:\n        - /url: /issues\n      - link \"Cycle\" [ref=f1e11] [cursor=pointer] [box=4,50,48,44]:\n        - /url: /cycle\n      - link \"Chat\" [ref=f1e14] [cursor=pointer] [box=4,96,48,44]:\n        - /url: /chat/inbox\n      - link \"Docs\" [ref=f1e19] [cursor=pointer] [box=4,142,48,44]:\n        - /url: /docs\n      - link \"Office\" [ref=f1e24] [cursor=pointer] [box=4,188,48,44]:\n        - /url: /office\n      - link \"Account\" [ref=f1e29] [cursor=pointer] [box=4,234,48,44]:\n        - /url: /account\n      - button \"Sign out\" [ref=f1e34] [cursor=pointer] [box=4,280,48,63]\n    - region \"List\" [ref=f1e39] [box=56,0,408,800]:\n      - grid \"Cycle issues\" [ref=f1e40] [box=68,8,383,666]:\n        - rowgroup [ref=f1e41] [box=68,8,383,306]:\n          - text: Todo\n          - row \"ATL-1 Atlas search index\" [ref=f1e42] [box=68,35,383,93]:\n            - gridcell \"ATL-1\" [ref=f1e43] [box=68,45,76,20]\n            - gridcell \"Atlas search index\" [ref=f1e44] [box=150,45,203,20]\n            - gridcell [ref=f1e45] [box=68,83,285,44]:\n              - 'button \"Status: Todo\" [ref=f1e46] [cursor=pointer] [box=68,83,44,44]': Todo\n            - gridcell [ref=f1e47] [box=359,83,92,44]:\n              - 'button \"Assignee: Elin Park\" [ref=f1e48] [cursor=pointer] [box=359,83,63,44]': Elin Park\n            - gridcell [box=359,55,92,0]\n          - row \"KIL-1 Kiln onboarding checklist\" [ref=f1e49] [box=68,128,383,93]:\n            - gridcell \"KIL-1\" [ref=f1e50] [box=68,138,76,20]\n            - gridcell \"Kiln onboarding checklist\" [ref=f1e51] [box=150,138,203,20]\n            - gridcell [ref=f1e52] [box=68,176,285,44]:\n              - 'button \"Status: Todo\" [ref=f1e53] [cursor=pointer] [box=68,176,44,44]': Todo\n            - gridcell [ref=f1e54] [box=359,176,92,44]:\n              - 'button \"Assignee: Ben Ostrow\" [ref=f1e55] [cursor=pointer] [box=359,176,81,44]': Ben Ostrow\n            - gridcell [box=359,148,92,0]\n          - row \"KIL-4 Export date format\" [ref=f1e56] [box=68,221,383,93]:\n            - gridcell \"KIL-4\" [ref=f1e57] [box=68,231,76,20]\n            - gridcell \"Export date format\" [ref=f1e58] [box=150,231,203,20]\n            - gridcell [ref=f1e59] [box=68,269,285,44]:\n              - 'button \"Status: Todo\" [ref=f1e60] [cursor=pointer] [box=68,269,44,44]': Todo\n            - gridcell [ref=f1e61] [box=359,269,92,44]:\n              - 'button \"Assignee: Dev Ramaswamy\" [ref=f1e62] [cursor=pointer] [box=359,269,115,44]': Dev Ramaswamy\n            - gridcell [box=359,241,92,0]\n        - rowgroup [ref=f1e63] [box=68,314,383,120]:\n          - text: In progress\n          - row \"KIL-2 Kiln billing export\" [ref=f1e64] [box=68,341,383,93]:\n            - gridcell \"KIL-2\" [ref=f1e65] [box=68,351,76,20]\n            - gridcell \"Kiln billing export\" [ref=f1e66] [box=150,351,203,20]\n            - gridcell [ref=f1e67] [box=68,389,285,44]:\n              - 'button \"Status: In progress\" [ref=f1e68] [cursor=pointer] [box=68,389,100,44]': In progress\n            - gridcell [ref=f1e69] [box=359,389,92,44]:\n              - 'button \"Assignee: Chiara Lund\" [ref=f1e70] [cursor=pointer] [box=359,389,82,44]': Chiara Lund\n            - gridcell [box=359,361,92,0]\n        - rowgroup [ref=f1e71] [box=68,434,383,120]:\n          - text: In review\n          - row \"KIL-5 Kiln review checklist\" [ref=f1e72] [box=68,461,383,93]:\n            - gridcell \"KIL-5\" [ref=f1e73] [box=68,471,76,20]\n            - gridcell \"Kiln review checklist\" [ref=f1e74] [box=150,471,203,20]\n            - gridcell [ref=f1e75] [box=68,509,285,44]:\n              - 'button \"Status: In review\" [ref=f1e76] [cursor=pointer] [box=68,509,84,44]': In review\n            - gridcell [ref=f1e77] [box=359,509,92,44]:\n              - 'button \"Assignee: Femi Ade\" [ref=f1e78] [cursor=pointer] [box=359,509,67,44]': Femi Ade\n            - gridcell [box=359,481,92,0]\n        - rowgroup [ref=f1e79] [box=68,554,383,120]:\n          - text: Done\n          - row \"KIL-3 Export CSV header row\" [ref=f1e80] [box=68,581,383,93]:\n            - gridcell \"KIL-3\" [ref=f1e81] [box=68,591,76,20]\n            - gridcell \"Export CSV header row\" [ref=f1e82] [box=150,591,203,20]\n            - gridcell [ref=f1e83] [box=68,629,285,44]:\n              - 'button \"Status: Done\" [ref=f1e84] [cursor=pointer] [box=68,629,44,44]': Done\n            - gridcell [ref=f1e85] [box=359,629,92,44]:\n              - 'button \"Assignee: Chiara Lund\" [ref=f1e86] [cursor=pointer] [box=359,629,82,44]': Chiara Lund\n            - gridcell [box=359,601,92,0]\n    - region \"Detail\" [ref=f1e87] [box=464,0,816,800]:\n      - generic [ref=f1e88] [box=476,8,792,493]:\n        - generic [ref=f1e89] [box=1188,8,80,58]:\n          - generic [ref=f1e90] [box=1195,13,66,16]: Cycle 1\n          - generic [ref=f1e91] [box=1195,29,66,16]: Current\n          - generic [ref=f1e92] [box=1195,45,66,16]: Fri 30 Oct\n        - generic [ref=f1e93] [box=476,12,792,176]:\n          - heading \"Cycle 1\" [level=1] [ref=f1e94] [box=484,12,784,29]\n          - paragraph [ref=f1e95] [box=484,61,784,20]: Mon 19 Oct to Fri 30 Oct\n          - paragraph [ref=f1e96] [box=484,97,784,20]: \"Today: Sat 31 Oct\"\n          - status \"Cycle length\" [ref=f1e97] [box=484,120,784,17]: 10 working days\n          - generic [ref=f1e98] [box=484,139,784,44]:\n            - button \"Previous cycle\" [disabled] [ref=f1e99] [cursor=pointer] [box=484,139,108,44]\n            - button \"Next cycle\" [ref=f1e100] [cursor=pointer] [box=598,139,83,44]\n        - group \"Unplaced\" [ref=f1e101] [box=476,196,792,32]:\n          - button \"ATL-1, no due date\" [ref=f1e102] [cursor=pointer] [box=479,199,56,26]: ATL-1\n          - button \"KIL-1, no due date\" [ref=f1e103] [cursor=pointer] [box=537,199,56,26]: KIL-1\n          - button \"KIL-4, no due date\" [ref=f1e104] [cursor=pointer] [box=595,199,56,26]: KIL-4\n          - button \"KIL-2, no due date\" [ref=f1e105] [cursor=pointer] [box=653,199,56,26]: KIL-2\n          - button \"KIL-5, no due date\" [ref=f1e106] [cursor=pointer] [box=711,199,56,26]: KIL-5\n          - button \"KIL-3, no due date\" [ref=f1e107] [cursor=pointer] [box=769,199,56,26]: KIL-3\n        - region \"Cycle ribbon\" [ref=f1e108] [box=476,236,792,132]:\n          - group \"Mon 19 Oct\" [ref=f1e109] [box=477,237,76,130]:\n            - generic [ref=f1e110] [box=477,237,75,15]: 19 Oct\n          - group \"Tue 20 Oct\" [ref=f1e112] [box=553,237,76,130]:\n            - generic [ref=f1e113] [box=553,237,75,15]: 20 Oct\n          - group \"Wed 21 Oct\" [ref=f1e115] [box=629,237,76,130]:\n            - generic [ref=f1e116] [box=629,237,75,15]: 21 Oct\n          - group \"Thu 22 Oct\" [ref=f1e118] [box=704,237,76,130]:\n            - generic [ref=f1e119] [box=704,237,75,15]: 22 Oct\n          - group \"Fri 23 Oct\" [ref=f1e121] [box=780,237,76,130]:\n            - generic [ref=f1e122] [box=780,237,75,15]: 23 Oct\n          - button \"Sat 24 Oct, not counted\" [ref=f1e125] [cursor=pointer] [box=856,237,8,130]: 24 Oct\n          - button \"Sun 25 Oct, not counted\" [ref=f1e127] [cursor=pointer] [box=864,237,8,130]: 25 Oct\n          - group \"Mon 26 Oct\" [ref=f1e128] [box=872,237,76,130]:\n            - generic [ref=f1e129] [box=872,237,75,15]: 26 Oct\n          - group \"Tue 27 Oct\" [ref=f1e131] [box=948,237,76,130]:\n            - generic [ref=f1e132] [box=948,237,75,15]: 27 Oct\n          - group \"Wed 28 Oct\" [ref=f1e134] [box=1024,237,76,130]:\n            - generic [ref=f1e135] [box=1024,237,75,15]: 28 Oct\n          - group \"Thu 29 Oct\" [ref=f1e137] [box=1099,237,76,130]:\n            - generic [ref=f1e138] [box=1099,237,75,15]: 29 Oct\n          - group \"Fri 30 Oct\" [ref=f1e140] [box=1175,237,76,130]:\n            - generic [ref=f1e141] [box=1175,237,75,15]: 30 Oct\n          - button \"Sat 31 Oct, not counted\" [ref=f1e144] [cursor=pointer] [box=1251,237,8,130]: 31 Oct\n          - button \"Sun 1 Nov, not counted\" [ref=f1e146] [cursor=pointer] [box=1259,237,8,130]: 1 Nov\n        - generic [ref=f1e147] [box=476,376,792,125]:\n          - img \"Burndown\" [ref=f1e148] [box=476,381,792,120]\n          - list \"Burndown values\" [ref=f1e160] [box=476,515,40,1]:\n            - listitem [box=516,515,0,20]: \"Mon 19 Oct: 6 open\"\n            - listitem [box=516,535,0,20]: \"Tue 20 Oct: 6 open\"\n            - listitem [box=516,556,0,20]: \"Wed 21 Oct: 5 open\"\n            - listitem [box=516,576,0,20]: \"Thu 22 Oct: 5 open\"\n            - listitem [box=516,596,0,20]: \"Fri 23 Oct: 5 open\"\n            - listitem [box=516,616,0,20]: \"Mon 26 Oct: 5 open\"\n            - listitem [box=516,637,0,20]: \"Tue 27 Oct: 5 open\"\n            - listitem [box=516,657,0,20]: \"Wed 28 Oct: 5 open\"\n            - listitem [box=516,677,0,20]: \"Thu 29 Oct: 5 open\"\n            - listitem [box=516,698,0,20]: \"Fri 30 Oct: 5 open\""
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Cycle ribbon",
  "target": "f1e108",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of Cycle ribbon](evidence/reduced/element-2026-10-31T06-53-16-112Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
