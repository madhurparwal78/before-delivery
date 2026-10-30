
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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e4]:\n  - heading \"Hearthshift\" [level=1] [ref=e5]\n  - paragraph [ref=e6]: Station time for shared kitchens.\n  - generic [ref=e7]:\n    - generic [ref=e8]: Email\n    - textbox \"Email\" [active] [ref=e9]\n  - generic [ref=e10]:\n    - generic [ref=e11]: Password\n    - textbox \"Password\" [ref=e12]\n  - button \"Sign in\" [ref=e13] [cursor=pointer]\n  - status \"Sign-in status\" [ref=e14]",
  "events": "- New console entries: evidence/touch/console-2026-10-29T12-10-16-415Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e4]:\n  - heading \"Hearthshift\" [level=1] [ref=e5]\n  - paragraph [ref=e6]: Station time for shared kitchens.\n  - generic [ref=e7]:\n    - generic [ref=e8]: Email\n    - textbox \"Email\" [active] [ref=e9]\n  - generic [ref=e10]:\n    - generic [ref=e11]: Password\n    - textbox \"Password\" [ref=e12]\n  - button \"Sign in\" [ref=e13] [cursor=pointer]\n  - status \"Sign-in status\" [ref=e14]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e9",
      "name": "Email",
      "type": "textbox",
      "value": "rafa@saltboxtacos.test"
    },
    {
      "target": "e12",
      "name": "Password",
      "type": "textbox",
      "value": "hearth-demo-2026"
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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-10-29\n        - button \"Next day\" [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e49]\n        - button \"Deck oven 1\" [ref=e50] [cursor=pointer]:\n          - generic [ref=e52]: $38.00/h\n        - button \"Deck oven 2\" [ref=e53] [cursor=pointer]:\n          - generic [ref=e55]: $38.00/h\n        - button \"Range line A\" [ref=e56] [cursor=pointer]:\n          - generic [ref=e58]: $32.00/h\n        - button \"Prep table 3\" [ref=e59] [cursor=pointer]:\n          - generic [ref=e61]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e62] [cursor=pointer]:\n          - generic [ref=e64]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e69]:\n                - generic [ref=e70]: 00:00 CDT\n                - generic [ref=e74]: 03:00\n                - generic [ref=e77]: 06:00\n                - generic [ref=e81]: 09:00\n                - generic [ref=e84]: 12:00\n                - generic [ref=e88]: 15:00\n                - generic [ref=e91]: 18:00\n                - generic [ref=e95]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e209]\n              - slider \"Deck oven 2\" [ref=e210]\n              - slider \"Range line A\" [ref=e211]\n              - slider \"Prep table 3\" [ref=e212]\n              - slider \"Walk-in shelf 4\" [ref=e213]\n            - list \"Dial segment labels\" [ref=e214]:\n              - listitem [ref=e215]:\n                - generic [ref=e216]: Prep table 3\n                - generic [ref=e217]: Your booking 07:15–07:30\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e218]:\n          - listitem [ref=e219]: Free\n          - listitem [ref=e221]: Held\n          - listitem [ref=e223]: Booked\n          - listitem [ref=e225]: Yours\n        - status \"Dial status\" [ref=e227]\n    - generic [ref=e228]:\n      - heading \"Tickets\" [level=2] [ref=e229]\n      - list \"Booking tickets\" [ref=e230]:\n        - listitem [ref=e231]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=e232] [cursor=pointer]:\n            - generic [ref=e234]: Prep table 3\n            - generic [ref=e235]: 2026-10-29 07:15 CDT – 07:30 CDT\n            - generic [ref=e236]: 0.25 h\n            - generic [ref=e237]: Checked in\n            - generic [ref=e238]: Paid\n            - generic [ref=e239]: $80.00\n        - listitem [ref=e240]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e241] [cursor=pointer]:\n            - generic [ref=e243]: Prep table 3\n            - generic [ref=e244]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e245]: 1.00 h\n            - generic [ref=e246]: Cancelled — refunded\n            - generic [ref=e247]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e248]: $95.00"
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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-10-29\n        - button \"Next day\" [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e49]\n        - button \"Deck oven 1\" [ref=e50] [cursor=pointer]:\n          - generic [ref=e52]: $38.00/h\n        - button \"Deck oven 2\" [ref=e53] [cursor=pointer]:\n          - generic [ref=e55]: $38.00/h\n        - button \"Range line A\" [ref=e56] [cursor=pointer]:\n          - generic [ref=e58]: $32.00/h\n        - button \"Prep table 3\" [ref=e59] [cursor=pointer]:\n          - generic [ref=e61]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e62] [cursor=pointer]:\n          - generic [ref=e64]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]\n          - region \"Selection summary\"\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e218]:\n          - listitem [ref=e219]: Free\n          - listitem [ref=e221]: Held\n          - listitem [ref=e223]: Booked\n          - listitem [ref=e225]: Yours\n        - status \"Dial status\" [ref=e227]\n    - generic [ref=e228]:\n      - heading \"Tickets\" [level=2] [ref=e229]\n      - list \"Booking tickets\" [ref=e230]:\n        - listitem [ref=e231]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=e232] [cursor=pointer]\n        - listitem [ref=e240]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e241] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Next day",
  "target": "e41"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-10-30\n        - button \"Next day\" [active] [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e49]\n        - button \"Deck oven 1\" [ref=e50] [cursor=pointer]:\n          - generic [ref=e52]: $38.00/h\n        - button \"Deck oven 2\" [ref=e53] [cursor=pointer]:\n          - generic [ref=e55]: $38.00/h\n        - button \"Range line A\" [ref=e56] [cursor=pointer]:\n          - generic [ref=e58]: $32.00/h\n        - button \"Prep table 3\" [ref=e59] [cursor=pointer]:\n          - generic [ref=e61]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e62] [cursor=pointer]:\n          - generic [ref=e64]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e249]:\n                - generic [ref=e250]: 00:00 CDT\n                - generic [ref=e254]: 03:00\n                - generic [ref=e257]: 06:00\n                - generic [ref=e261]: 09:00\n                - generic [ref=e264]: 12:00\n                - generic [ref=e268]: 15:00\n                - generic [ref=e271]: 18:00\n                - generic [ref=e275]: 21:00\n              - generic [ref=e279]: Booked 04:00–08:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e391]\n              - slider \"Deck oven 2\" [ref=e392]\n              - slider \"Range line A\" [ref=e393]\n              - slider \"Prep table 3\" [ref=e394]\n              - slider \"Walk-in shelf 4\" [ref=e395]\n            - list \"Dial segment labels\" [ref=e214]:\n              - listitem [ref=e396]:\n                - generic [ref=e397]: Deck oven 1\n                - generic [ref=e398]: Booked 04:00–08:00\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e218]:\n          - listitem [ref=e219]: Free\n          - listitem [ref=e221]: Held\n          - listitem [ref=e223]: Booked\n          - listitem [ref=e225]: Yours\n        - status \"Dial status\" [ref=e227]\n    - generic [ref=e228]:\n      - heading \"Tickets\" [level=2] [ref=e229]\n      - list \"Booking tickets\" [ref=e230]:\n        - listitem [ref=e399]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=e400] [cursor=pointer]:\n            - generic [ref=e402]: Prep table 3\n            - generic [ref=e403]: 2026-10-29 07:15 CDT – 07:30 CDT\n            - generic [ref=e404]: 0.25 h\n            - generic [ref=e405]: Checked in\n            - generic [ref=e406]: Paid\n            - generic [ref=e407]: $80.00\n        - listitem [ref=e408]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e409] [cursor=pointer]:\n            - generic [ref=e411]: Prep table 3\n            - generic [ref=e412]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e413]: 1.00 h\n            - generic [ref=e414]: Cancelled — refunded\n            - generic [ref=e415]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e416]: $95.00\n        - listitem [ref=e417]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e418] [cursor=pointer]:\n            - generic [ref=e420]: Prep table 3\n            - generic [ref=e421]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e422]: 1.00 h\n            - generic [ref=e423]: Cancelled — refunded\n            - generic [ref=e424]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e425]: $95.00"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Next day",
  "target": "e41"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-10-31\n        - button \"Next day\" [active] [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e49]\n        - button \"Deck oven 1\" [ref=e50] [cursor=pointer]:\n          - generic [ref=e52]: $38.00/h\n        - button \"Deck oven 2\" [ref=e53] [cursor=pointer]:\n          - generic [ref=e55]: $38.00/h\n        - button \"Range line A\" [ref=e56] [cursor=pointer]:\n          - generic [ref=e58]: $32.00/h\n        - button \"Prep table 3\" [ref=e59] [cursor=pointer]:\n          - generic [ref=e61]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e62] [cursor=pointer]:\n          - generic [ref=e64]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e426]:\n                - generic [ref=e427]: 00:00 CDT\n                - generic [ref=e431]: 03:00\n                - generic [ref=e434]: 06:00\n                - generic [ref=e438]: 09:00\n                - generic [ref=e441]: 12:00\n                - generic [ref=e445]: 15:00\n                - generic [ref=e448]: 18:00\n                - generic [ref=e452]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e565]\n              - slider \"Deck oven 2\" [ref=e566]\n              - slider \"Range line A\" [ref=e567]\n              - slider \"Prep table 3\" [ref=e568]\n              - slider \"Walk-in shelf 4\" [ref=e569]\n            - list \"Dial segment labels\"\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e218]:\n          - listitem [ref=e219]: Free\n          - listitem [ref=e221]: Held\n          - listitem [ref=e223]: Booked\n          - listitem [ref=e225]: Yours\n        - status \"Dial status\" [ref=e227]\n    - generic [ref=e228]:\n      - heading \"Tickets\" [level=2] [ref=e229]\n      - list \"Booking tickets\" [ref=e230]:\n        - listitem [ref=e570]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=e571] [cursor=pointer]:\n            - generic [ref=e573]: Prep table 3\n            - generic [ref=e574]: 2026-10-29 07:15 CDT – 07:30 CDT\n            - generic [ref=e575]: 0.25 h\n            - generic [ref=e576]: Checked in\n            - generic [ref=e577]: Paid\n            - generic [ref=e578]: $80.00\n        - listitem [ref=e579]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e580] [cursor=pointer]:\n            - generic [ref=e582]: Prep table 3\n            - generic [ref=e583]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e584]: 1.00 h\n            - generic [ref=e585]: Cancelled — refunded\n            - generic [ref=e586]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e587]: $95.00\n        - listitem [ref=e588]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e589] [cursor=pointer]:\n            - generic [ref=e591]: Prep table 3\n            - generic [ref=e592]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e593]: 1.00 h\n            - generic [ref=e594]: Cancelled — refunded\n            - generic [ref=e595]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e596]: $95.00"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Next day",
  "target": "e41"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-11-01\n        - button \"Next day\" [active] [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e49]\n        - button \"Deck oven 1\" [ref=e50] [cursor=pointer]:\n          - generic [ref=e52]: $38.00/h\n        - button \"Deck oven 2\" [ref=e53] [cursor=pointer]:\n          - generic [ref=e55]: $38.00/h\n        - button \"Range line A\" [ref=e56] [cursor=pointer]:\n          - generic [ref=e58]: $32.00/h\n        - button \"Prep table 3\" [ref=e59] [cursor=pointer]:\n          - generic [ref=e61]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e62] [cursor=pointer]:\n          - generic [ref=e64]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e597]:\n                - generic [ref=e598]: 00:00 CDT\n                - generic [ref=e600]: 01:00 CDT\n                - generic [ref=e602]: 01:00 CST\n                - generic [ref=e604]: 02:00\n                - generic [ref=e608]: 05:00\n                - generic [ref=e612]: 08:00\n                - generic [ref=e616]: 11:00\n                - generic [ref=e620]: 14:00\n                - generic [ref=e624]: 17:00\n                - generic [ref=e628]: 20:00\n                - generic [ref=e632]: 23:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e763]\n              - slider \"Deck oven 2\" [ref=e764]\n              - slider \"Range line A\" [ref=e765]\n              - slider \"Prep table 3\" [ref=e766]\n              - slider \"Walk-in shelf 4\" [ref=e767]\n            - list \"Dial segment labels\"\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e218]:\n          - listitem [ref=e219]: Free\n          - listitem [ref=e221]: Held\n          - listitem [ref=e223]: Booked\n          - listitem [ref=e225]: Yours\n        - status \"Dial status\" [ref=e227]\n    - generic [ref=e228]:\n      - heading \"Tickets\" [level=2] [ref=e229]\n      - list \"Booking tickets\" [ref=e230]:\n        - listitem [ref=e768]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=e769] [cursor=pointer]:\n            - generic [ref=e771]: Prep table 3\n            - generic [ref=e772]: 2026-10-29 07:15 CDT – 07:30 CDT\n            - generic [ref=e773]: 0.25 h\n            - generic [ref=e774]: Checked in\n            - generic [ref=e775]: Paid\n            - generic [ref=e776]: $80.00\n        - listitem [ref=e777]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e778] [cursor=pointer]:\n            - generic [ref=e780]: Prep table 3\n            - generic [ref=e781]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e782]: 1.00 h\n            - generic [ref=e783]: Cancelled — refunded\n            - generic [ref=e784]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e785]: $95.00\n        - listitem [ref=e786]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e787] [cursor=pointer]:\n            - generic [ref=e789]: Prep table 3\n            - generic [ref=e790]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e791]: 1.00 h\n            - generic [ref=e792]: Cancelled — refunded\n            - generic [ref=e793]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e794]: $95.00"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Next day",
  "target": "e41"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-11-02\n        - button \"Next day\" [active] [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e49]\n        - button \"Deck oven 1\" [ref=e50] [cursor=pointer]:\n          - generic [ref=e52]: $38.00/h\n        - button \"Deck oven 2\" [ref=e53] [cursor=pointer]:\n          - generic [ref=e55]: $38.00/h\n        - button \"Range line A\" [ref=e56] [cursor=pointer]:\n          - generic [ref=e58]: $32.00/h\n        - button \"Prep table 3\" [ref=e59] [cursor=pointer]:\n          - generic [ref=e61]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e62] [cursor=pointer]:\n          - generic [ref=e64]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e795]:\n                - generic [ref=e796]: 00:00 CST\n                - generic [ref=e800]: 03:00\n                - generic [ref=e803]: 06:00\n                - generic [ref=e807]: 09:00\n                - generic [ref=e810]: 12:00\n                - generic [ref=e814]: 15:00\n                - generic [ref=e817]: 18:00\n                - generic [ref=e821]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e934]\n              - slider \"Deck oven 2\" [ref=e935]\n              - slider \"Range line A\" [ref=e936]\n              - slider \"Prep table 3\" [ref=e937]\n              - slider \"Walk-in shelf 4\" [ref=e938]\n            - list \"Dial segment labels\"\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e218]:\n          - listitem [ref=e219]: Free\n          - listitem [ref=e221]: Held\n          - listitem [ref=e223]: Booked\n          - listitem [ref=e225]: Yours\n        - status \"Dial status\" [ref=e227]\n    - generic [ref=e228]:\n      - heading \"Tickets\" [level=2] [ref=e229]\n      - list \"Booking tickets\" [ref=e230]:\n        - listitem [ref=e939]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=e940] [cursor=pointer]:\n            - generic [ref=e942]: Prep table 3\n            - generic [ref=e943]: 2026-10-29 07:15 CDT – 07:30 CDT\n            - generic [ref=e944]: 0.25 h\n            - generic [ref=e945]: Checked in\n            - generic [ref=e946]: Paid\n            - generic [ref=e947]: $80.00\n        - listitem [ref=e948]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e949] [cursor=pointer]:\n            - generic [ref=e951]: Prep table 3\n            - generic [ref=e952]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e953]: 1.00 h\n            - generic [ref=e954]: Cancelled — refunded\n            - generic [ref=e955]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e956]: $95.00\n        - listitem [ref=e957]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e958] [cursor=pointer]:\n            - generic [ref=e960]: Prep table 3\n            - generic [ref=e961]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e962]: 1.00 h\n            - generic [ref=e963]: Cancelled — refunded\n            - generic [ref=e964]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e965]: $95.00"
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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]\n        - button \"Next day\" [active] [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e49]\n        - button \"Deck oven 1\" [ref=e50] [cursor=pointer]\n        - button \"Deck oven 2\" [ref=e53] [cursor=pointer]\n        - button \"Range line A\" [ref=e56] [cursor=pointer]\n        - button \"Prep table 3\" [ref=e59] [cursor=pointer]\n        - button \"Walk-in shelf 4\" [ref=e62] [cursor=pointer]\n      - generic [ref=e65]:\n        - generic [ref=e66]\n        - list \"Dial legend\" [ref=e218]\n        - status \"Dial status\" [ref=e227]\n    - generic [ref=e228]:\n      - heading \"Tickets\" [level=2] [ref=e229]\n      - list \"Booking tickets\" [ref=e230]:\n        - listitem [ref=e939]\n        - listitem [ref=e948]\n        - listitem [ref=e957]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Walk-in shelf 4",
  "target": "e62"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-11-02\n        - button \"Next day\" [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e966]\n        - button \"Deck oven 1\" [ref=e967] [cursor=pointer]:\n          - generic [ref=e969]: $38.00/h\n        - button \"Deck oven 2\" [ref=e970] [cursor=pointer]:\n          - generic [ref=e972]: $38.00/h\n        - button \"Range line A\" [ref=e973] [cursor=pointer]:\n          - generic [ref=e975]: $32.00/h\n        - button \"Prep table 3\" [ref=e976] [cursor=pointer]:\n          - generic [ref=e978]: $20.00/h\n        - button \"Walk-in shelf 4\" [pressed] [ref=e979] [cursor=pointer]:\n          - generic [ref=e981]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e982]:\n                - generic [ref=e983]: 00:00 CST\n                - generic [ref=e987]: 03:00\n                - generic [ref=e990]: 06:00\n                - generic [ref=e994]: 09:00\n                - generic [ref=e997]: 12:00\n                - generic [ref=e1001]: 15:00\n                - generic [ref=e1004]: 18:00\n                - generic [ref=e1008]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e1121]\n              - slider \"Deck oven 2\" [ref=e1122]\n              - slider \"Range line A\" [ref=e1123]\n              - slider \"Prep table 3\" [ref=e1124]\n              - slider \"Walk-in shelf 4\" [active] [ref=e1125]\n            - list \"Dial segment labels\"\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e218]:\n          - listitem [ref=e219]: Free\n          - listitem [ref=e221]: Held\n          - listitem [ref=e223]: Booked\n          - listitem [ref=e225]: Yours\n        - status \"Dial status\" [ref=e227]\n    - generic [ref=e228]:\n      - heading \"Tickets\" [level=2] [ref=e229]\n      - list \"Booking tickets\" [ref=e230]:\n        - listitem [ref=e939]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=e940] [cursor=pointer]:\n            - generic [ref=e942]: Prep table 3\n            - generic [ref=e943]: 2026-10-29 07:15 CDT – 07:30 CDT\n            - generic [ref=e944]: 0.25 h\n            - generic [ref=e945]: Checked in\n            - generic [ref=e946]: Paid\n            - generic [ref=e947]: $80.00\n        - listitem [ref=e948]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e949] [cursor=pointer]:\n            - generic [ref=e951]: Prep table 3\n            - generic [ref=e952]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e953]: 1.00 h\n            - generic [ref=e954]: Cancelled — refunded\n            - generic [ref=e955]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e956]: $95.00\n        - listitem [ref=e957]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e958] [cursor=pointer]:\n            - generic [ref=e960]: Prep table 3\n            - generic [ref=e961]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e962]: 1.00 h\n            - generic [ref=e963]: Cancelled — refunded\n            - generic [ref=e964]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e965]: $95.00"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Enter"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-11-02\n        - button \"Next day\" [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e966]\n        - button \"Deck oven 1\" [ref=e967] [cursor=pointer]:\n          - generic [ref=e969]: $38.00/h\n        - button \"Deck oven 2\" [ref=e970] [cursor=pointer]:\n          - generic [ref=e972]: $38.00/h\n        - button \"Range line A\" [ref=e973] [cursor=pointer]:\n          - generic [ref=e975]: $32.00/h\n        - button \"Prep table 3\" [ref=e976] [cursor=pointer]:\n          - generic [ref=e978]: $20.00/h\n        - button \"Walk-in shelf 4\" [pressed] [ref=e979] [cursor=pointer]:\n          - generic [ref=e981]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e1127]:\n                - generic [ref=e1128]: 00:00 CST\n                - generic [ref=e1132]: 03:00\n                - generic [ref=e1135]: 06:00\n                - generic [ref=e1139]: 09:00\n                - generic [ref=e1142]: 12:00\n                - generic [ref=e1146]: 15:00\n                - generic [ref=e1149]: 18:00\n                - generic [ref=e1153]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e1268]\n              - slider \"Deck oven 2\" [ref=e1269]\n              - slider \"Range line A\" [ref=e1270]\n              - slider \"Prep table 3\" [ref=e1271]\n              - slider \"Walk-in shelf 4\" [ref=e1272]\n            - list \"Dial segment labels\" [ref=e214]:\n              - listitem [ref=e1273]:\n                - generic [ref=e1274]: Walk-in shelf 4\n                - generic [ref=e1275]: Your hold 00:00–01:00\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\" [ref=e1276]: 09:59\n        - list \"Dial legend\" [ref=e218]:\n          - listitem [ref=e219]: Free\n          - listitem [ref=e221]: Held\n          - listitem [ref=e223]: Booked\n          - listitem [ref=e225]: Yours\n        - status \"Dial status\" [ref=e227]: Held until 07:31. Finish checkout to keep it.\n      - generic [ref=e1280]:\n        - button \"Checkout\" [ref=e1281] [cursor=pointer]\n        - dialog \"Checkout\" [ref=e1282]:\n          - heading \"Checkout\" [level=2] [ref=e1283]\n          - list [ref=e1284]:\n            - listitem [ref=e1285]: 2026-11-02 00:00–01:00 · 1.00 h\n          - generic [ref=e1286]:\n            - term [ref=e1287]: Pack hours\n            - definition [ref=e1288]: 0.00 h\n            - term [ref=e1289]: Card hours\n            - definition [ref=e1290]: 1.00 h\n            - term [ref=e1291]: Card total\n            - definition [ref=e1292]: $6.00\n            - term [ref=e1293]: Deposit\n            - definition [ref=e1294]: $75.00\n          - generic [ref=e1295]:\n            - checkbox \"Use pack hours\" [active] [ref=e1296]\n            - generic [ref=e1297]: Use pack hours (0.00 h available)\n          - radiogroup \"Card payment\" [ref=e1298]:\n            - generic [ref=e1299]:\n              - radio \"Pay now\" [checked] [ref=e1300]\n              - generic [ref=e1301]: Pay now\n            - generic [ref=e1302]:\n              - radio \"Pay later\" [ref=e1303]\n              - generic [ref=e1304]: Pay later (due by 2026-10-31 00:00 CST)\n          - paragraph [ref=e1305]: Free cancellation until 24 hours before start. Later cancellations keep the time charge and the deposit.\n          - paragraph [ref=e1306]: Held until 2026-10-29 07:31 CDT\n          - generic [ref=e1307]:\n            - button \"Confirm booking\" [ref=e1308] [cursor=pointer]\n            - button \"Let hold go\" [ref=e1309] [cursor=pointer]\n          - status \"Checkout status\" [ref=e1310]\n    - generic [ref=e228]:\n      - heading \"Tickets\" [level=2] [ref=e229]\n      - list \"Booking tickets\" [ref=e230]:\n        - listitem [ref=e939]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=e940] [cursor=pointer]:\n            - generic [ref=e942]: Prep table 3\n            - generic [ref=e943]: 2026-10-29 07:15 CDT – 07:30 CDT\n            - generic [ref=e944]: 0.25 h\n            - generic [ref=e945]: Checked in\n            - generic [ref=e946]: Paid\n            - generic [ref=e947]: $80.00\n        - listitem [ref=e948]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e949] [cursor=pointer]:\n            - generic [ref=e951]: Prep table 3\n            - generic [ref=e952]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e953]: 1.00 h\n            - generic [ref=e954]: Cancelled — refunded\n            - generic [ref=e955]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e956]: $95.00\n        - listitem [ref=e957]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e958] [cursor=pointer]:\n            - generic [ref=e960]: Prep table 3\n            - generic [ref=e961]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e962]: 1.00 h\n            - generic [ref=e963]: Cancelled — refunded\n            - generic [ref=e964]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e965]: $95.00"
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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-11-02\n        - button \"Next day\" [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e966]\n        - button \"Deck oven 1\" [ref=e967] [cursor=pointer]:\n          - generic [ref=e969]: $38.00/h\n        - button \"Deck oven 2\" [ref=e970] [cursor=pointer]:\n          - generic [ref=e972]: $38.00/h\n        - button \"Range line A\" [ref=e973] [cursor=pointer]:\n          - generic [ref=e975]: $32.00/h\n        - button \"Prep table 3\" [ref=e976] [cursor=pointer]:\n          - generic [ref=e978]: $20.00/h\n        - button \"Walk-in shelf 4\" [pressed] [ref=e979] [cursor=pointer]:\n          - generic [ref=e981]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]\n          - region \"Selection summary\"\n          - timer \"Hold time left\" [ref=e1276]: 09:55\n        - list \"Dial legend\" [ref=e218]:\n          - listitem [ref=e219]: Free\n          - listitem [ref=e221]: Held\n          - listitem [ref=e223]: Booked\n          - listitem [ref=e225]: Yours\n        - status \"Dial status\" [ref=e227]: Held until 07:31. Finish checkout to keep it.\n      - generic [ref=e1280]:\n        - button \"Checkout\" [ref=e1281] [cursor=pointer]\n        - dialog \"Checkout\" [ref=e1282]:\n          - heading \"Checkout\" [level=2] [ref=e1283]\n          - list [ref=e1284]\n          - generic [ref=e1286]\n          - generic [ref=e1295]\n          - radiogroup \"Card payment\" [ref=e1298]\n          - paragraph [ref=e1305]: Free cancellation until 24 hours before start. Later cancellations keep the time charge and the deposit.\n          - paragraph [ref=e1306]: Held until 2026-10-29 07:31 CDT\n          - generic [ref=e1307]\n          - status \"Checkout status\" [ref=e1310]\n    - generic [ref=e228]:\n      - heading \"Tickets\" [level=2] [ref=e229]\n      - list \"Booking tickets\" [ref=e230]:\n        - listitem [ref=e939]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=e940] [cursor=pointer]\n        - listitem [ref=e948]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e949] [cursor=pointer]\n        - listitem [ref=e957]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e958] [cursor=pointer]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const d=document.querySelector('[role=dialog][aria-label=\"Checkout\"]');const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Confirm booking');return {viewport:{w:innerWidth,h:innerHeight},dialog:d.getBoundingClientRect().toJSON(),button:b.getBoundingClientRect().toJSON(),position:getComputedStyle(d).position};}"
}
```
- Result
```json
{
  "result": "{\n  \"viewport\": {\n    \"w\": 375,\n    \"h\": 812\n  },\n  \"dialog\": {\n    \"x\": 0,\n    \"y\": 305.65625,\n    \"width\": 375,\n    \"height\": 506.34375,\n    \"top\": 305.65625,\n    \"right\": 375,\n    \"bottom\": 812,\n    \"left\": 0\n  },\n  \"button\": {\n    \"x\": 17,\n    \"y\": 723,\n    \"width\": 151.140625,\n    \"height\": 44,\n    \"top\": 723,\n    \"right\": 168.140625,\n    \"bottom\": 767,\n    \"left\": 17\n  },\n  \"position\": \"fixed\"\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/touch/page-2026-10-29T12-21-57-766Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "e1282",
  "depth": 5
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- dialog \"Checkout\" [ref=e1282]:\n  - heading \"Checkout\" [level=2] [ref=e1283]\n  - list [ref=e1284]:\n    - listitem [ref=e1285]: 2026-11-02 00:00–01:00 · 1.00 h\n  - generic [ref=e1286]:\n    - term [ref=e1287]: Pack hours\n    - definition [ref=e1288]: 0.00 h\n    - term [ref=e1289]: Card hours\n    - definition [ref=e1290]: 1.00 h\n    - term [ref=e1291]: Card total\n    - definition [ref=e1292]: $6.00\n    - term [ref=e1293]: Deposit\n    - definition [ref=e1294]: $75.00\n  - generic [ref=e1295]:\n    - checkbox \"Use pack hours\" [active] [ref=e1296]\n    - generic [ref=e1297]: Use pack hours (0.00 h available)\n  - radiogroup \"Card payment\" [ref=e1298]:\n    - generic [ref=e1299]:\n      - radio \"Pay now\" [checked] [ref=e1300]\n      - generic [ref=e1301]: Pay now\n    - generic [ref=e1302]:\n      - radio \"Pay later\" [ref=e1303]\n      - generic [ref=e1304]: Pay later (due by 2026-10-31 00:00 CST)\n  - paragraph [ref=e1305]: Free cancellation until 24 hours before start. Later cancellations keep the time charge and the deposit.\n  - paragraph [ref=e1306]: Held until 2026-10-29 07:31 CDT\n  - generic [ref=e1307]:\n    - button \"Confirm booking\" [ref=e1308] [cursor=pointer]\n    - button \"Let hold go\" [ref=e1309] [cursor=pointer]\n  - status \"Checkout status\" [ref=e1310]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Let hold go",
  "target": "e1309"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-11-02\n        - button \"Next day\" [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e966]\n        - button \"Deck oven 1\" [ref=e967] [cursor=pointer]:\n          - generic [ref=e969]: $38.00/h\n        - button \"Deck oven 2\" [ref=e970] [cursor=pointer]:\n          - generic [ref=e972]: $38.00/h\n        - button \"Range line A\" [ref=e973] [cursor=pointer]:\n          - generic [ref=e975]: $32.00/h\n        - button \"Prep table 3\" [ref=e976] [cursor=pointer]:\n          - generic [ref=e978]: $20.00/h\n        - button \"Walk-in shelf 4\" [pressed] [ref=e979] [cursor=pointer]:\n          - generic [ref=e981]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e1311]:\n                - generic [ref=e1312]: 00:00 CST\n                - generic [ref=e1316]: 03:00\n                - generic [ref=e1319]: 06:00\n                - generic [ref=e1323]: 09:00\n                - generic [ref=e1326]: 12:00\n                - generic [ref=e1330]: 15:00\n                - generic [ref=e1333]: 18:00\n                - generic [ref=e1337]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e1450]\n              - slider \"Deck oven 2\" [ref=e1451]\n              - slider \"Range line A\" [ref=e1452]\n              - slider \"Prep table 3\" [ref=e1453]\n              - slider \"Walk-in shelf 4\" [ref=e1454]\n            - list \"Dial segment labels\"\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e218]:\n          - listitem [ref=e219]: Free\n          - listitem [ref=e221]: Held\n          - listitem [ref=e223]: Booked\n          - listitem [ref=e225]: Yours\n        - status \"Dial status\" [ref=e227]: Hold released.\n      - dialog \"Checkout\" [ref=e1282]:\n        - heading \"Checkout\" [level=2] [ref=e1283]\n        - list [ref=e1284]:\n          - listitem [ref=e1285]: 2026-11-02 00:00–01:00 · 1.00 h\n        - generic [ref=e1286]:\n          - term [ref=e1287]: Pack hours\n          - definition [ref=e1288]: 0.00 h\n          - term [ref=e1289]: Card hours\n          - definition [ref=e1290]: 1.00 h\n          - term [ref=e1291]: Card total\n          - definition [ref=e1292]: $6.00\n          - term [ref=e1293]: Deposit\n          - definition [ref=e1294]: $75.00\n        - generic [ref=e1295]:\n          - checkbox \"Use pack hours\" [ref=e1296]\n          - generic [ref=e1297]: Use pack hours (0.00 h available)\n        - radiogroup \"Card payment\" [ref=e1298]:\n          - generic [ref=e1299]:\n            - radio \"Pay now\" [checked] [ref=e1300]\n            - generic [ref=e1301]: Pay now\n          - generic [ref=e1302]:\n            - radio \"Pay later\" [ref=e1303]\n            - generic [ref=e1304]: Pay later (due by 2026-10-31 00:00 CST)\n        - paragraph [ref=e1305]: Free cancellation until 24 hours before start. Later cancellations keep the time charge and the deposit.\n        - paragraph [ref=e1306]: Held until 2026-10-29 07:31 CDT\n        - generic [ref=e1307]:\n          - button \"Confirm booking\" [ref=e1308] [cursor=pointer]\n          - button \"Let hold go\" [active] [ref=e1309] [cursor=pointer]\n        - status \"Checkout status\" [ref=e1310]: Releasing…\n    - generic [ref=e228]:\n      - heading \"Tickets\" [level=2] [ref=e229]\n      - list \"Booking tickets\" [ref=e230]:\n        - listitem [ref=e1455]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=e1456] [cursor=pointer]:\n            - generic [ref=e1458]: Prep table 3\n            - generic [ref=e1459]: 2026-10-29 07:15 CDT – 07:30 CDT\n            - generic [ref=e1460]: 0.25 h\n            - generic [ref=e1461]: Checked in\n            - generic [ref=e1462]: Paid\n            - generic [ref=e1463]: $80.00\n        - listitem [ref=e1464]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e1465] [cursor=pointer]:\n            - generic [ref=e1467]: Prep table 3\n            - generic [ref=e1468]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e1469]: 1.00 h\n            - generic [ref=e1470]: Cancelled — refunded\n            - generic [ref=e1471]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e1472]: $95.00\n        - listitem [ref=e1473]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e1474] [cursor=pointer]:\n            - generic [ref=e1476]: Prep table 3\n            - generic [ref=e1477]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e1478]: 1.00 h\n            - generic [ref=e1479]: Cancelled — refunded\n            - generic [ref=e1480]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e1481]: $95.00"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Sign out",
  "target": "e28"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1483]:\n  - heading \"Hearthshift\" [level=1] [ref=e1484]\n  - paragraph [ref=e1485]: Station time for shared kitchens.\n  - generic [ref=e1486]:\n    - generic [ref=e1487]: Email\n    - textbox \"Email\" [active] [ref=e1488]\n  - generic [ref=e1489]:\n    - generic [ref=e1490]: Password\n    - textbox \"Password\" [ref=e1491]\n  - button \"Sign in\" [ref=e1492] [cursor=pointer]\n  - status \"Sign-in status\" [ref=e1493]"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1483]:\n  - heading \"Hearthshift\" [level=1] [ref=e1484]\n  - paragraph [ref=e1485]: Station time for shared kitchens.\n  - generic [ref=e1486]:\n    - generic [ref=e1487]: Email\n    - textbox \"Email\" [active] [ref=e1488]\n  - generic [ref=e1489]:\n    - generic [ref=e1490]: Password\n    - textbox \"Password\" [ref=e1491]\n  - button \"Sign in\" [ref=e1492] [cursor=pointer]\n  - status \"Sign-in status\" [ref=e1493]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e1488",
      "name": "Email",
      "type": "textbox",
      "value": "desk.halsted@emberrow.test"
    },
    {
      "target": "e1491",
      "name": "Password",
      "type": "textbox",
      "value": "hearth-demo-2026"
    }
  ]
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Hearthshift\n- Console: 2 errors, 0 warnings",
  "events": "- New console entries: evidence/touch/console-2026-10-29T12-10-16-415Z.log#L2"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Sign in",
  "target": "e1492"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/counter\n- Page Title: Hearthshift\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e1494]:\n    - generic [ref=e1495]: Hearthshift\n    - navigation \"Main\" [ref=e1500]:\n      - link \"Board\" [ref=e1501] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1502] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1503]:\n      - generic [ref=e1504]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1505] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1506]:\n    - generic [ref=e1507]:\n      - heading \"Counter\" [level=1] [ref=e1508]\n      - generic [ref=e1509]:\n        - generic [ref=e1510]: Site\n        - combobox \"Site\" [ref=e1511]:\n          - option \"Ember Row — Halsted\" [selected]\n      - status \"Counter status\" [ref=e1512]\n      - table \"Today's bookings\" [ref=e1514]:\n        - rowgroup [ref=e1515]:\n          - row [ref=e1516]:\n            - cell \"Renter Saltbox Tacos\" [ref=e1517]\n            - cell \"Station Prep table 3\" [ref=e1518]\n            - cell \"Time 07:15 CDT – 07:30 CDT\" [ref=e1519]\n            - cell \"Status Checked in Paid\" [ref=e1520]:\n              - text: Status Checked in\n              - generic [ref=e1521]: Paid\n            - cell [ref=e1522]:\n              - text: Actions\n              - generic [ref=e1523]:\n                - button \"Charge overrun\" [ref=e1524] [cursor=pointer]\n                - button \"Check out\" [ref=e1525] [cursor=pointer]"
}
```

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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift",
  "snapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e3]:\n    - generic [ref=f1e4]: Hearthshift\n    - navigation \"Main\" [ref=f1e9]:\n      - link \"Board\" [ref=f1e10] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=f1e11] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=f1e12]:\n      - generic [ref=f1e13]: Priya Lindqvist\n      - button \"Sign out\" [ref=f1e14] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=f1e15]:\n    - generic [ref=f1e16]:\n      - generic [ref=f1e17]:\n        - generic [ref=f1e18]: Site\n        - combobox \"Site\" [ref=f1e19]:\n          - option \"Ember Row — Halsted\" [selected]\n      - generic [ref=f1e20]:\n        - button \"Previous day\" [ref=f1e21] [cursor=pointer]\n        - generic [ref=f1e24]:\n          - generic [ref=f1e25]: Day\n          - textbox \"Day\" [ref=f1e26]: 2026-10-29\n        - button \"Next day\" [ref=f1e27] [cursor=pointer]\n      - generic [ref=f1e30]:\n        - generic [ref=f1e31]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=f1e32]: \"1\"\n      - generic [ref=f1e33]:\n        - generic [ref=f1e34]: Renter\n        - combobox \"Renter\" [ref=f1e35]:\n          - option \"Choose a renter\" [selected]\n    - generic [ref=f1e36]:\n      - generic [ref=f1e37]:\n        - heading \"Stations\" [level=2] [ref=f1e38]\n        - button \"Deck oven 1\" [ref=f1e39] [cursor=pointer]:\n          - generic [ref=f1e41]: $38.00/h\n        - button \"Deck oven 2\" [ref=f1e42] [cursor=pointer]:\n          - generic [ref=f1e44]: $38.00/h\n        - button \"Range line A\" [ref=f1e45] [cursor=pointer]:\n          - generic [ref=f1e47]: $32.00/h\n        - button \"Prep table 3\" [ref=f1e48] [cursor=pointer]:\n          - generic [ref=f1e50]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=f1e51] [cursor=pointer]:\n          - generic [ref=f1e53]: $6.00/h\n      - generic [ref=f1e54]:\n        - generic [ref=f1e55]:\n          - group \"Station dial\" [ref=f1e56]:\n            - list \"Dial segment labels\"\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=f1e58]:\n          - listitem [ref=f1e59]: Free\n          - listitem [ref=f1e61]: Held\n          - listitem [ref=f1e63]: Booked\n          - listitem [ref=f1e65]: Yours\n        - status \"Dial status\" [ref=f1e67]\n    - generic [ref=f1e68]:\n      - heading \"Tickets\" [level=2] [ref=f1e69]\n      - list \"Booking tickets\" [ref=f1e70]:\n        - listitem [ref=f1e71]: No tickets yet."
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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift",
  "inlineSnapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e3]:\n    - generic [ref=f1e4]: Hearthshift\n    - navigation \"Main\" [ref=f1e9]:\n      - link \"Board\" [ref=f1e10] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=f1e11] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=f1e12]:\n      - generic [ref=f1e13]: Priya Lindqvist\n      - button \"Sign out\" [ref=f1e14] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=f1e15]:\n    - generic [ref=f1e16]:\n      - generic [ref=f1e17]:\n        - generic [ref=f1e18]: Site\n        - combobox \"Site\" [ref=f1e19]:\n          - option \"Ember Row — Halsted\" [selected]\n      - generic [ref=f1e20]:\n        - button \"Previous day\" [ref=f1e21] [cursor=pointer]\n        - generic [ref=f1e24]:\n          - generic [ref=f1e25]: Day\n          - textbox \"Day\" [ref=f1e26]: 2026-10-29\n        - button \"Next day\" [ref=f1e27] [cursor=pointer]\n      - generic [ref=f1e30]:\n        - generic [ref=f1e31]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=f1e32]: \"1\"\n      - generic [ref=f1e33]:\n        - generic [ref=f1e34]: Renter\n        - combobox \"Renter\" [ref=f1e35]:\n          - option \"Choose a renter\" [selected]\n          - option \"Juniper Crumb Bakery\"\n          - option \"Little Ledger Meal Prep\"\n          - option \"Nightjar Pies\"\n          - option \"Saltbox Tacos\"\n    - generic [ref=f1e36]:\n      - generic [ref=f1e37]:\n        - heading \"Stations\" [level=2] [ref=f1e38]\n        - button \"Deck oven 1\" [ref=f1e39] [cursor=pointer]:\n          - generic [ref=f1e41]: $38.00/h\n        - button \"Deck oven 2\" [ref=f1e42] [cursor=pointer]:\n          - generic [ref=f1e44]: $38.00/h\n        - button \"Range line A\" [ref=f1e45] [cursor=pointer]:\n          - generic [ref=f1e47]: $32.00/h\n        - button \"Prep table 3\" [ref=f1e48] [cursor=pointer]:\n          - generic [ref=f1e50]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=f1e51] [cursor=pointer]:\n          - generic [ref=f1e53]: $6.00/h\n      - generic [ref=f1e54]:\n        - generic [ref=f1e55]:\n          - group \"Station dial\" [ref=f1e56]\n          - region \"Selection summary\"\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=f1e58]:\n          - listitem [ref=f1e59]: Free\n          - listitem [ref=f1e61]: Held\n          - listitem [ref=f1e63]: Booked\n          - listitem [ref=f1e65]: Yours\n        - status \"Dial status\" [ref=f1e67]\n    - generic [ref=f1e68]:\n      - heading \"Tickets\" [level=2] [ref=f1e69]\n      - list \"Booking tickets\" [ref=f1e70]:\n        - listitem [ref=f1e222]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=f1e223] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e35",
      "name": "Renter",
      "type": "combobox",
      "value": "Saltbox Tacos"
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
  "element": "Walk-in shelf 4",
  "target": "f1e51"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift",
  "snapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e3]:\n    - generic [ref=f1e4]: Hearthshift\n    - navigation \"Main\" [ref=f1e9]:\n      - link \"Board\" [ref=f1e10] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=f1e11] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=f1e12]:\n      - generic [ref=f1e13]: Priya Lindqvist\n      - button \"Sign out\" [ref=f1e14] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=f1e15]:\n    - generic [ref=f1e16]:\n      - generic [ref=f1e17]:\n        - generic [ref=f1e18]: Site\n        - combobox \"Site\" [ref=f1e19]:\n          - option \"Ember Row — Halsted\" [selected]\n      - generic [ref=f1e20]:\n        - button \"Previous day\" [ref=f1e21] [cursor=pointer]\n        - generic [ref=f1e24]:\n          - generic [ref=f1e25]: Day\n          - textbox \"Day\" [ref=f1e26]: 2026-10-29\n        - button \"Next day\" [ref=f1e27] [cursor=pointer]\n      - generic [ref=f1e30]:\n        - generic [ref=f1e31]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=f1e32]: \"1\"\n      - generic [ref=f1e33]:\n        - generic [ref=f1e34]: Renter\n        - combobox \"Renter\" [ref=f1e35]:\n          - option \"Choose a renter\"\n          - option \"Juniper Crumb Bakery\"\n          - option \"Little Ledger Meal Prep\"\n          - option \"Nightjar Pies\"\n          - option \"Saltbox Tacos\" [selected]\n    - generic [ref=f1e36]:\n      - generic [ref=f1e37]:\n        - heading \"Stations\" [level=2] [ref=f1e231]\n        - button \"Deck oven 1\" [ref=f1e232] [cursor=pointer]:\n          - generic [ref=f1e234]: $38.00/h\n        - button \"Deck oven 2\" [ref=f1e235] [cursor=pointer]:\n          - generic [ref=f1e237]: $38.00/h\n        - button \"Range line A\" [ref=f1e238] [cursor=pointer]:\n          - generic [ref=f1e240]: $32.00/h\n        - button \"Prep table 3\" [ref=f1e241] [cursor=pointer]:\n          - generic [ref=f1e243]: $20.00/h\n        - button \"Walk-in shelf 4\" [pressed] [ref=f1e244] [cursor=pointer]:\n          - generic [ref=f1e246]: $6.00/h\n      - generic [ref=f1e54]:\n        - generic [ref=f1e55]:\n          - group \"Station dial\" [ref=f1e56]:\n            - img [aria-hidden] [ref=f1e57]:\n              - generic [ref=f1e247]:\n                - generic [ref=f1e248]: 00:00 CDT\n                - generic [ref=f1e252]: 03:00\n                - generic [ref=f1e255]: 06:00\n                - generic [ref=f1e259]: 09:00\n                - generic [ref=f1e262]: 12:00\n                - generic [ref=f1e266]: 15:00\n                - generic [ref=f1e269]: 18:00\n                - generic [ref=f1e273]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=f1e387]\n              - slider \"Deck oven 2\" [ref=f1e388]\n              - slider \"Range line A\" [ref=f1e389]\n              - slider \"Prep table 3\" [ref=f1e390]\n              - slider \"Walk-in shelf 4\" [active] [ref=f1e391]\n            - list \"Dial segment labels\" [ref=f1e217]:\n              - listitem [ref=f1e392]:\n                - generic [ref=f1e393]: Prep table 3\n                - generic [ref=f1e394]: Booked 07:15–07:30\n                - generic [ref=f1e395]: Saltbox Tacos\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=f1e58]:\n          - listitem [ref=f1e59]: Free\n          - listitem [ref=f1e61]: Held\n          - listitem [ref=f1e63]: Booked\n          - listitem [ref=f1e65]: Yours\n        - status \"Dial status\" [ref=f1e67]\n    - generic [ref=f1e68]:\n      - heading \"Tickets\" [level=2] [ref=f1e69]\n      - list \"Booking tickets\" [ref=f1e70]:\n        - listitem [ref=f1e396]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=f1e397] [cursor=pointer]:\n            - generic [ref=f1e399]: Prep table 3\n            - generic [ref=f1e400]: 2026-10-29 07:15 CDT – 07:30 CDT\n            - generic [ref=f1e401]: 0.25 h\n            - generic [ref=f1e402]: Checked in\n            - generic [ref=f1e403]: Paid\n            - generic [ref=f1e404]: $80.00"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift",
  "inlineSnapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e3]:\n    - generic [ref=f1e4]: Hearthshift\n    - navigation \"Main\" [ref=f1e9]:\n      - link \"Board\" [ref=f1e10] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=f1e11] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=f1e12]:\n      - generic [ref=f1e13]: Priya Lindqvist\n      - button \"Sign out\" [ref=f1e14] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=f1e15]:\n    - generic [ref=f1e16]:\n      - generic [ref=f1e17]:\n        - generic [ref=f1e18]: Site\n        - combobox \"Site\" [ref=f1e19]\n      - generic [ref=f1e20]:\n        - button \"Previous day\" [ref=f1e21] [cursor=pointer]\n        - generic [ref=f1e24]\n        - button \"Next day\" [ref=f1e27] [cursor=pointer]\n      - generic [ref=f1e30]:\n        - generic [ref=f1e31]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=f1e32]: \"1\"\n      - generic [ref=f1e33]:\n        - generic [ref=f1e34]: Renter\n        - combobox \"Renter\" [ref=f1e35]\n    - generic [ref=f1e36]:\n      - generic [ref=f1e37]:\n        - heading \"Stations\" [level=2] [ref=f1e231]\n        - button \"Deck oven 1\" [ref=f1e232] [cursor=pointer]\n        - button \"Deck oven 2\" [ref=f1e235] [cursor=pointer]\n        - button \"Range line A\" [ref=f1e238] [cursor=pointer]\n        - button \"Prep table 3\" [ref=f1e241] [cursor=pointer]\n        - button \"Walk-in shelf 4\" [pressed] [ref=f1e244] [cursor=pointer]\n      - generic [ref=f1e54]:\n        - generic [ref=f1e55]\n        - list \"Dial legend\" [ref=f1e58]\n        - status \"Dial status\" [ref=f1e67]: Selection 07:15–07:30, 0.25 h\n    - generic [ref=f1e68]:\n      - heading \"Tickets\" [level=2] [ref=f1e69]\n      - list \"Booking tickets\" [ref=f1e70]:\n        - listitem [ref=f1e396]"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Enter"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift",
  "snapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e3]:\n    - generic [ref=f1e4]: Hearthshift\n    - navigation \"Main\" [ref=f1e9]:\n      - link \"Board\" [ref=f1e10] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=f1e11] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=f1e12]:\n      - generic [ref=f1e13]: Priya Lindqvist\n      - button \"Sign out\" [ref=f1e14] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=f1e15]:\n    - generic [ref=f1e16]:\n      - generic [ref=f1e17]:\n        - generic [ref=f1e18]: Site\n        - combobox \"Site\" [ref=f1e19]:\n          - option \"Ember Row — Halsted\" [selected]\n      - generic [ref=f1e20]:\n        - button \"Previous day\" [ref=f1e21] [cursor=pointer]\n        - generic [ref=f1e24]:\n          - generic [ref=f1e25]: Day\n          - textbox \"Day\" [ref=f1e26]: 2026-10-29\n        - button \"Next day\" [ref=f1e27] [cursor=pointer]\n      - generic [ref=f1e30]:\n        - generic [ref=f1e31]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=f1e32]: \"1\"\n      - generic [ref=f1e33]:\n        - generic [ref=f1e34]: Renter\n        - combobox \"Renter\" [ref=f1e35]:\n          - option \"Choose a renter\"\n          - option \"Juniper Crumb Bakery\"\n          - option \"Little Ledger Meal Prep\"\n          - option \"Nightjar Pies\"\n          - option \"Saltbox Tacos\" [selected]\n    - generic [ref=f1e36]:\n      - generic [ref=f1e37]:\n        - heading \"Stations\" [level=2] [ref=f1e231]\n        - button \"Deck oven 1\" [ref=f1e232] [cursor=pointer]:\n          - generic [ref=f1e234]: $38.00/h\n        - button \"Deck oven 2\" [ref=f1e235] [cursor=pointer]:\n          - generic [ref=f1e237]: $38.00/h\n        - button \"Range line A\" [ref=f1e238] [cursor=pointer]:\n          - generic [ref=f1e240]: $32.00/h\n        - button \"Prep table 3\" [ref=f1e241] [cursor=pointer]:\n          - generic [ref=f1e243]: $20.00/h\n        - button \"Walk-in shelf 4\" [pressed] [ref=f1e244] [cursor=pointer]:\n          - generic [ref=f1e246]: $6.00/h\n      - generic [ref=f1e54]:\n        - generic [ref=f1e55]:\n          - group \"Station dial\" [ref=f1e56]:\n            - img [aria-hidden] [ref=f1e57]:\n              - generic [ref=f1e556]:\n                - generic [ref=f1e557]: 00:00 CDT\n                - generic [ref=f1e561]: 03:00\n                - generic [ref=f1e564]: 06:00\n                - generic [ref=f1e568]: 09:00\n                - generic [ref=f1e571]: 12:00\n                - generic [ref=f1e575]: 15:00\n                - generic [ref=f1e578]: 18:00\n                - generic [ref=f1e582]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=f1e698]\n              - slider \"Deck oven 2\" [ref=f1e699]\n              - slider \"Range line A\" [ref=f1e700]\n              - slider \"Prep table 3\" [ref=f1e701]\n              - slider \"Walk-in shelf 4\" [ref=f1e702]\n            - list \"Dial segment labels\" [ref=f1e217]:\n              - listitem [ref=f1e703]:\n                - generic [ref=f1e704]: Prep table 3\n                - generic [ref=f1e705]: Booked 07:15–07:30\n                - generic [ref=f1e706]: Saltbox Tacos\n              - listitem [ref=f1e707]:\n                - generic [ref=f1e708]: Walk-in shelf 4\n                - generic [ref=f1e709]: Held 07:30–07:45\n                - generic [ref=f1e710]: Saltbox Tacos\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\" [ref=f1e711]: 09:59\n        - list \"Dial legend\" [ref=f1e58]:\n          - listitem [ref=f1e59]: Free\n          - listitem [ref=f1e61]: Held\n          - listitem [ref=f1e63]: Booked\n          - listitem [ref=f1e65]: Yours\n        - status \"Dial status\" [ref=f1e67]: Held until 07:35. Finish checkout to keep it.\n      - generic [ref=f1e715]:\n        - button \"Checkout\" [ref=f1e716] [cursor=pointer]\n        - dialog \"Checkout\" [ref=f1e717]:\n          - heading \"Checkout\" [level=2] [ref=f1e718]\n          - list [ref=f1e719]:\n            - listitem [ref=f1e720]: 2026-10-29 07:30–07:45 · 0.25 h\n          - generic [ref=f1e721]:\n            - term [ref=f1e722]: Pack hours\n            - definition [ref=f1e723]: 0.00 h\n            - term [ref=f1e724]: Card hours\n            - definition [ref=f1e725]: 0.25 h\n            - term [ref=f1e726]: Card total\n            - definition [ref=f1e727]: $1.50\n            - term [ref=f1e728]: Deposit\n            - definition [ref=f1e729]: $75.00\n          - generic [ref=f1e730]:\n            - checkbox \"Use pack hours\" [active] [ref=f1e731]\n            - generic [ref=f1e732]: Use pack hours (0.00 h available)\n          - radiogroup \"Card payment\" [ref=f1e733]:\n            - generic [ref=f1e734]:\n              - radio \"Pay now\" [checked] [ref=f1e735]\n              - generic [ref=f1e736]: Pay now\n            - generic [ref=f1e737]:\n              - radio \"Pay later\" [ref=f1e738]\n              - generic [ref=f1e739]: Pay later (due by 2026-10-27 07:30 CDT)\n          - paragraph [ref=f1e740]: Free cancellation until 24 hours before start. Later cancellations keep the time charge and the deposit.\n          - paragraph [ref=f1e741]: Held until 2026-10-29 07:35 CDT\n          - generic [ref=f1e742]:\n            - button \"Confirm booking\" [ref=f1e743] [cursor=pointer]\n            - button \"Let hold go\" [ref=f1e744] [cursor=pointer]\n          - status \"Checkout status\" [ref=f1e745]\n    - generic [ref=f1e68]:\n      - heading \"Tickets\" [level=2] [ref=f1e69]\n      - list \"Booking tickets\" [ref=f1e70]:\n        - listitem [ref=f1e396]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=f1e397] [cursor=pointer]:\n            - generic [ref=f1e399]: Prep table 3\n            - generic [ref=f1e400]: 2026-10-29 07:15 CDT – 07:30 CDT\n            - generic [ref=f1e401]: 0.25 h\n            - generic [ref=f1e402]: Checked in\n            - generic [ref=f1e403]: Paid\n            - generic [ref=f1e404]: $80.00"
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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift",
  "inlineSnapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e3]:\n    - generic [ref=f1e4]: Hearthshift\n    - navigation \"Main\" [ref=f1e9]:\n      - link \"Board\" [ref=f1e10] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=f1e11] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=f1e12]:\n      - generic [ref=f1e13]: Priya Lindqvist\n      - button \"Sign out\" [ref=f1e14] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=f1e15]:\n    - generic [ref=f1e16]:\n      - generic [ref=f1e17]:\n        - generic [ref=f1e18]: Site\n        - combobox \"Site\" [ref=f1e19]:\n          - option \"Ember Row — Halsted\" [selected]\n      - generic [ref=f1e20]:\n        - button \"Previous day\" [ref=f1e21] [cursor=pointer]\n        - generic [ref=f1e24]:\n          - generic [ref=f1e25]: Day\n          - textbox \"Day\" [ref=f1e26]: 2026-10-29\n        - button \"Next day\" [ref=f1e27] [cursor=pointer]\n      - generic [ref=f1e30]:\n        - generic [ref=f1e31]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=f1e32]: \"1\"\n      - generic [ref=f1e33]:\n        - generic [ref=f1e34]: Renter\n        - combobox \"Renter\" [ref=f1e35]:\n          - option \"Choose a renter\"\n          - option \"Juniper Crumb Bakery\"\n          - option \"Little Ledger Meal Prep\"\n          - option \"Nightjar Pies\"\n          - option \"Saltbox Tacos\" [selected]\n    - generic [ref=f1e36]:\n      - generic [ref=f1e37]:\n        - heading \"Stations\" [level=2] [ref=f1e231]\n        - button \"Deck oven 1\" [ref=f1e232] [cursor=pointer]:\n          - generic [ref=f1e234]: $38.00/h\n        - button \"Deck oven 2\" [ref=f1e235] [cursor=pointer]:\n          - generic [ref=f1e237]: $38.00/h\n        - button \"Range line A\" [ref=f1e238] [cursor=pointer]:\n          - generic [ref=f1e240]: $32.00/h\n        - button \"Prep table 3\" [ref=f1e241] [cursor=pointer]:\n          - generic [ref=f1e243]: $20.00/h\n        - button \"Walk-in shelf 4\" [pressed] [ref=f1e244] [cursor=pointer]:\n          - generic [ref=f1e246]: $6.00/h\n      - generic [ref=f1e54]:\n        - generic [ref=f1e55]:\n          - group \"Station dial\" [ref=f1e56]\n          - region \"Selection summary\"\n          - timer \"Hold time left\" [ref=f1e711]: 09:57\n        - list \"Dial legend\" [ref=f1e58]:\n          - listitem [ref=f1e59]: Free\n          - listitem [ref=f1e61]: Held\n          - listitem [ref=f1e63]: Booked\n          - listitem [ref=f1e65]: Yours\n        - status \"Dial status\" [ref=f1e67]: Held until 07:35. Finish checkout to keep it.\n      - generic [ref=f1e715]:\n        - button \"Checkout\" [ref=f1e716] [cursor=pointer]\n        - dialog \"Checkout\" [ref=f1e717]:\n          - heading \"Checkout\" [level=2] [ref=f1e718]\n          - list [ref=f1e719]\n          - generic [ref=f1e721]\n          - generic [ref=f1e730]\n          - radiogroup \"Card payment\" [ref=f1e733]\n          - paragraph [ref=f1e740]: Free cancellation until 24 hours before start. Later cancellations keep the time charge and the deposit.\n          - paragraph [ref=f1e741]: Held until 2026-10-29 07:35 CDT\n          - generic [ref=f1e742]\n          - status \"Checkout status\" [ref=f1e745]\n    - generic [ref=f1e68]:\n      - heading \"Tickets\" [level=2] [ref=f1e69]\n      - list \"Booking tickets\" [ref=f1e70]:\n        - listitem [ref=f1e396]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=f1e397] [cursor=pointer]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "f1e717",
  "depth": 5
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift",
  "inlineSnapshot": "- dialog \"Checkout\" [ref=f1e717]:\n  - heading \"Checkout\" [level=2] [ref=f1e718]\n  - list [ref=f1e719]:\n    - listitem [ref=f1e720]: 2026-10-29 07:30–07:45 · 0.25 h\n  - generic [ref=f1e721]:\n    - term [ref=f1e722]: Pack hours\n    - definition [ref=f1e723]: 0.00 h\n    - term [ref=f1e724]: Card hours\n    - definition [ref=f1e725]: 0.25 h\n    - term [ref=f1e726]: Card total\n    - definition [ref=f1e727]: $1.50\n    - term [ref=f1e728]: Deposit\n    - definition [ref=f1e729]: $75.00\n  - generic [ref=f1e730]:\n    - checkbox \"Use pack hours\" [active] [ref=f1e731]\n    - generic [ref=f1e732]: Use pack hours (0.00 h available)\n  - radiogroup \"Card payment\" [ref=f1e733]:\n    - generic [ref=f1e734]:\n      - radio \"Pay now\" [checked] [ref=f1e735]\n      - generic [ref=f1e736]: Pay now\n    - generic [ref=f1e737]:\n      - radio \"Pay later\" [ref=f1e738]\n      - generic [ref=f1e739]: Pay later (due by 2026-10-27 07:30 CDT)\n  - paragraph [ref=f1e740]: Free cancellation until 24 hours before start. Later cancellations keep the time charge and the deposit.\n  - paragraph [ref=f1e741]: Held until 2026-10-29 07:35 CDT\n  - generic [ref=f1e742]:\n    - button \"Confirm booking\" [ref=f1e743] [cursor=pointer]\n    - button \"Let hold go\" [ref=f1e744] [cursor=pointer]\n  - status \"Checkout status\" [ref=f1e745]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Confirm booking",
  "target": "f1e743"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift",
  "snapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e3]:\n    - generic [ref=f1e4]: Hearthshift\n    - navigation \"Main\" [ref=f1e9]:\n      - link \"Board\" [ref=f1e10] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=f1e11] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=f1e12]:\n      - generic [ref=f1e13]: Priya Lindqvist\n      - button \"Sign out\" [ref=f1e14] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=f1e15]:\n    - generic [ref=f1e16]:\n      - generic [ref=f1e17]:\n        - generic [ref=f1e18]: Site\n        - combobox \"Site\" [ref=f1e19]:\n          - option \"Ember Row — Halsted\" [selected]\n      - generic [ref=f1e20]:\n        - button \"Previous day\" [ref=f1e21] [cursor=pointer]\n        - generic [ref=f1e24]:\n          - generic [ref=f1e25]: Day\n          - textbox \"Day\" [ref=f1e26]: 2026-10-29\n        - button \"Next day\" [ref=f1e27] [cursor=pointer]\n      - generic [ref=f1e30]:\n        - generic [ref=f1e31]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=f1e32]: \"1\"\n      - generic [ref=f1e33]:\n        - generic [ref=f1e34]: Renter\n        - combobox \"Renter\" [ref=f1e35]:\n          - option \"Choose a renter\"\n          - option \"Juniper Crumb Bakery\"\n          - option \"Little Ledger Meal Prep\"\n          - option \"Nightjar Pies\"\n          - option \"Saltbox Tacos\" [selected]\n    - generic [ref=f1e36]:\n      - generic [ref=f1e37]:\n        - heading \"Stations\" [level=2] [ref=f1e231]\n        - button \"Deck oven 1\" [ref=f1e232] [cursor=pointer]:\n          - generic [ref=f1e234]: $38.00/h\n        - button \"Deck oven 2\" [ref=f1e235] [cursor=pointer]:\n          - generic [ref=f1e237]: $38.00/h\n        - button \"Range line A\" [ref=f1e238] [cursor=pointer]:\n          - generic [ref=f1e240]: $32.00/h\n        - button \"Prep table 3\" [ref=f1e241] [cursor=pointer]:\n          - generic [ref=f1e243]: $20.00/h\n        - button \"Walk-in shelf 4\" [pressed] [ref=f1e244] [cursor=pointer]:\n          - generic [ref=f1e246]: $6.00/h\n      - generic [ref=f1e54]:\n        - generic [ref=f1e55]:\n          - group \"Station dial\" [ref=f1e56]:\n            - img [aria-hidden] [ref=f1e57]:\n              - generic [ref=f1e746]:\n                - generic [ref=f1e747]: 00:00 CDT\n                - generic [ref=f1e751]: 03:00\n                - generic [ref=f1e754]: 06:00\n                - generic [ref=f1e758]: 09:00\n                - generic [ref=f1e761]: 12:00\n                - generic [ref=f1e765]: 15:00\n                - generic [ref=f1e768]: 18:00\n                - generic [ref=f1e772]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=f1e887]\n              - slider \"Deck oven 2\" [ref=f1e888]\n              - slider \"Range line A\" [ref=f1e889]\n              - slider \"Prep table 3\" [ref=f1e890]\n              - slider \"Walk-in shelf 4\" [ref=f1e891]\n            - list \"Dial segment labels\" [ref=f1e217]:\n              - listitem [ref=f1e892]:\n                - generic [ref=f1e893]: Prep table 3\n                - generic [ref=f1e894]: Booked 07:15–07:30\n                - generic [ref=f1e895]: Saltbox Tacos\n              - listitem [ref=f1e896]:\n                - generic [ref=f1e897]: Walk-in shelf 4\n                - generic [ref=f1e898]: Booked 07:30–07:45\n                - generic [ref=f1e899]: Saltbox Tacos\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=f1e58]:\n          - listitem [ref=f1e59]: Free\n          - listitem [ref=f1e61]: Held\n          - listitem [ref=f1e63]: Booked\n          - listitem [ref=f1e65]: Yours\n        - status \"Dial status\" [ref=f1e67]: Held until 07:35. Finish checkout to keep it.\n      - dialog \"Checkout\" [ref=f1e717]:\n        - heading \"Checkout\" [level=2] [ref=f1e718]\n        - list [ref=f1e719]:\n          - listitem [ref=f1e720]: 2026-10-29 07:30–07:45 · 0.25 h\n        - generic [ref=f1e721]:\n          - term [ref=f1e722]: Pack hours\n          - definition [ref=f1e723]: 0.00 h\n          - term [ref=f1e724]: Card hours\n          - definition [ref=f1e725]: 0.25 h\n          - term [ref=f1e726]: Card total\n          - definition [ref=f1e727]: $1.50\n          - term [ref=f1e728]: Deposit\n          - definition [ref=f1e729]: $75.00\n        - generic [ref=f1e730]:\n          - checkbox \"Use pack hours\" [ref=f1e731]\n          - generic [ref=f1e732]: Use pack hours (0.00 h available)\n        - radiogroup \"Card payment\" [ref=f1e733]:\n          - generic [ref=f1e734]:\n            - radio \"Pay now\" [checked] [ref=f1e735]\n            - generic [ref=f1e736]: Pay now\n          - generic [ref=f1e737]:\n            - radio \"Pay later\" [ref=f1e738]\n            - generic [ref=f1e739]: Pay later (due by 2026-10-27 07:30 CDT)\n        - paragraph [ref=f1e740]: Free cancellation until 24 hours before start. Later cancellations keep the time charge and the deposit.\n        - paragraph [ref=f1e741]: Held until 2026-10-29 07:35 CDT\n        - status \"Checkout status\" [ref=f1e745]: Booking confirmed. Confirmation email queued.\n    - generic [ref=f1e68]:\n      - heading \"Tickets\" [level=2] [ref=f1e69]\n      - list \"Booking tickets\" [ref=f1e70]:\n        - listitem [ref=f1e900]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Checked in Paid $80.00\" [ref=f1e901] [cursor=pointer]:\n            - generic [ref=f1e903]: Prep table 3\n            - generic [ref=f1e904]: 2026-10-29 07:15 CDT – 07:30 CDT\n            - generic [ref=f1e905]: 0.25 h\n            - generic [ref=f1e906]: Checked in\n            - generic [ref=f1e907]: Paid\n            - generic [ref=f1e908]: $80.00\n        - listitem [ref=f1e909]:\n          - button \"Walk-in shelf 4 2026-10-29 07:30 CDT – 07:45 CDT 0.25 h Confirmed Paid $76.50\" [ref=f1e910] [cursor=pointer]:\n            - generic [ref=f1e912]: Walk-in shelf 4\n            - generic [ref=f1e913]: 2026-10-29 07:30 CDT – 07:45 CDT\n            - generic [ref=f1e914]: 0.25 h\n            - generic [ref=f1e915]: Confirmed\n            - generic [ref=f1e916]: Paid\n            - generic [ref=f1e917]: $76.50"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Counter",
  "target": "f1e11"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/counter\n- Page Title: Hearthshift",
  "snapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e918]:\n    - generic [ref=f1e919]: Hearthshift\n    - navigation \"Main\" [ref=f1e924]:\n      - link \"Board\" [ref=f1e925] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=f1e926] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=f1e927]:\n      - generic [ref=f1e928]: Priya Lindqvist\n      - button \"Sign out\" [ref=f1e929] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=f1e930]:\n    - generic [ref=f1e931]:\n      - heading \"Counter\" [level=1] [ref=f1e932]\n      - generic [ref=f1e933]:\n        - generic [ref=f1e934]: Site\n        - combobox \"Site\" [ref=f1e935]:\n          - option \"Ember Row — Halsted\" [selected]\n      - status \"Counter status\" [ref=f1e936]\n      - table \"Today's bookings\" [ref=f1e938]:\n        - rowgroup [ref=f1e939]:\n          - row [ref=f1e940]:\n            - cell \"Renter Saltbox Tacos\" [ref=f1e941]\n            - cell \"Station Prep table 3\" [ref=f1e942]\n            - cell \"Time 07:15 CDT – 07:30 CDT\" [ref=f1e943]\n            - cell \"Status Checked in Paid\" [ref=f1e944]:\n              - text: Status Checked in\n              - generic [ref=f1e945]: Paid\n            - cell [ref=f1e946]:\n              - text: Actions\n              - generic [ref=f1e947]:\n                - button \"Charge overrun\" [ref=f1e948] [cursor=pointer]\n                - button \"Check out\" [ref=f1e949] [cursor=pointer]\n          - row [ref=f1e950]:\n            - cell \"Renter Saltbox Tacos\" [ref=f1e951]\n            - cell \"Station Walk-in shelf 4\" [ref=f1e952]\n            - cell \"Time 07:30 CDT – 07:45 CDT\" [ref=f1e953]\n            - cell \"Status Confirmed Paid\" [ref=f1e954]:\n              - text: Status Confirmed\n              - generic [ref=f1e955]: Paid\n            - cell [ref=f1e956]:\n              - text: Actions\n              - button \"Check in\" [ref=f1e958] [cursor=pointer]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 7
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/counter\n- Page Title: Hearthshift",
  "inlineSnapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e918]:\n    - generic [ref=f1e919]: Hearthshift\n    - navigation \"Main\" [ref=f1e924]:\n      - link \"Board\" [ref=f1e925] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=f1e926] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=f1e927]:\n      - generic [ref=f1e928]: Priya Lindqvist\n      - button \"Sign out\" [ref=f1e929] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=f1e930]:\n    - generic [ref=f1e931]:\n      - heading \"Counter\" [level=1] [ref=f1e932]\n      - generic [ref=f1e933]:\n        - generic [ref=f1e934]: Site\n        - combobox \"Site\" [ref=f1e935]:\n          - option \"Ember Row — Halsted\" [selected]\n      - status \"Counter status\" [ref=f1e936]\n      - table \"Today's bookings\" [ref=f1e938]:\n        - rowgroup [ref=f1e939]:\n          - row \"Renter Saltbox Tacos Station Prep table 3 Time 07:15 CDT – 07:30 CDT Status Checked in Paid Actions Charge overrun Check out\" [ref=f1e940]:\n            - cell \"Renter Saltbox Tacos\" [ref=f1e941]\n            - cell \"Station Prep table 3\" [ref=f1e942]\n            - cell \"Time 07:15 CDT – 07:30 CDT\" [ref=f1e943]\n            - cell \"Status Checked in Paid\" [ref=f1e944]:\n              - text: Status Checked in\n              - generic [ref=f1e945]: Paid\n            - cell \"Actions Charge overrun Check out\" [ref=f1e946]:\n              - text: Actions\n              - generic [ref=f1e947]\n          - row \"Renter Saltbox Tacos Station Walk-in shelf 4 Time 07:30 CDT – 07:45 CDT Status Confirmed Paid Actions Check in\" [ref=f1e950]:\n            - cell \"Renter Saltbox Tacos\" [ref=f1e951]\n            - cell \"Station Walk-in shelf 4\" [ref=f1e952]\n            - cell \"Time 07:30 CDT – 07:45 CDT\" [ref=f1e953]\n            - cell \"Status Confirmed Paid\" [ref=f1e954]:\n              - text: Status Confirmed\n              - generic [ref=f1e955]: Paid\n            - cell \"Actions Check in\" [ref=f1e956]:\n              - text: Actions\n              - button \"Check in\" [ref=f1e958] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Check in new Walk-in booking",
  "target": "f1e958"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/counter\n- Page Title: Hearthshift",
  "snapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e918]:\n    - generic [ref=f1e919]: Hearthshift\n    - navigation \"Main\" [ref=f1e924]:\n      - link \"Board\" [ref=f1e925] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=f1e926] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=f1e927]:\n      - generic [ref=f1e928]: Priya Lindqvist\n      - button \"Sign out\" [ref=f1e929] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=f1e930]:\n    - generic [ref=f1e931]:\n      - heading \"Counter\" [level=1] [ref=f1e932]\n      - generic [ref=f1e933]:\n        - generic [ref=f1e934]: Site\n        - combobox \"Site\" [ref=f1e935]:\n          - option \"Ember Row — Halsted\" [selected]\n      - status \"Counter status\" [ref=f1e936]: \"Checked in: Saltbox Tacos.\"\n      - table \"Today's bookings\" [ref=f1e938]:\n        - rowgroup [ref=f1e939]:\n          - row [ref=f1e959]:\n            - cell \"Renter Saltbox Tacos\" [ref=f1e960]\n            - cell \"Station Prep table 3\" [ref=f1e961]\n            - cell \"Time 07:15 CDT – 07:30 CDT\" [ref=f1e962]\n            - cell \"Status Checked in Paid\" [ref=f1e963]:\n              - text: Status Checked in\n              - generic [ref=f1e964]: Paid\n            - cell [ref=f1e965]:\n              - text: Actions\n              - generic [ref=f1e966]:\n                - button \"Charge overrun\" [ref=f1e967] [cursor=pointer]\n                - button \"Check out\" [ref=f1e968] [cursor=pointer]\n          - row [ref=f1e969]:\n            - cell \"Renter Saltbox Tacos\" [ref=f1e970]\n            - cell \"Station Walk-in shelf 4\" [ref=f1e971]\n            - cell \"Time 07:30 CDT – 07:45 CDT\" [ref=f1e972]\n            - cell \"Status Checked in Paid\" [ref=f1e973]:\n              - text: Status Checked in\n              - generic [ref=f1e974]: Paid\n            - cell [ref=f1e975]:\n              - text: Actions\n              - generic [ref=f1e976]:\n                - button \"Charge overrun\" [ref=f1e977] [cursor=pointer]\n                - button \"Check out\" [ref=f1e978] [cursor=pointer]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 7
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/counter\n- Page Title: Hearthshift",
  "inlineSnapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e918]:\n    - generic [ref=f1e919]: Hearthshift\n    - navigation \"Main\" [ref=f1e924]:\n      - link \"Board\" [ref=f1e925] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=f1e926] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=f1e927]:\n      - generic [ref=f1e928]: Priya Lindqvist\n      - button \"Sign out\" [ref=f1e929] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=f1e930]:\n    - generic [ref=f1e931]:\n      - heading \"Counter\" [level=1] [ref=f1e932]\n      - generic [ref=f1e933]:\n        - generic [ref=f1e934]: Site\n        - combobox \"Site\" [ref=f1e935]:\n          - option \"Ember Row — Halsted\" [selected]\n      - status \"Counter status\" [ref=f1e936]: \"Checked in: Saltbox Tacos.\"\n      - table \"Today's bookings\" [ref=f1e938]:\n        - rowgroup [ref=f1e939]:\n          - row \"Renter Saltbox Tacos Station Prep table 3 Time 07:15 CDT – 07:30 CDT Status Checked in Paid Actions Charge overrun Check out\" [ref=f1e959]:\n            - cell \"Renter Saltbox Tacos\" [ref=f1e960]\n            - cell \"Station Prep table 3\" [ref=f1e961]\n            - cell \"Time 07:15 CDT – 07:30 CDT\" [ref=f1e962]\n            - cell \"Status Checked in Paid\" [ref=f1e963]:\n              - text: Status Checked in\n              - generic [ref=f1e964]: Paid\n            - cell \"Actions Charge overrun Check out\" [ref=f1e965]:\n              - text: Actions\n              - generic [ref=f1e966]\n          - row \"Renter Saltbox Tacos Station Walk-in shelf 4 Time 07:30 CDT – 07:45 CDT Status Checked in Paid Actions Charge overrun Check out\" [ref=f1e969]:\n            - cell \"Renter Saltbox Tacos\" [ref=f1e970]\n            - cell \"Station Walk-in shelf 4\" [ref=f1e971]\n            - cell \"Time 07:30 CDT – 07:45 CDT\" [ref=f1e972]\n            - cell \"Status Checked in Paid\" [ref=f1e973]:\n              - text: Status Checked in\n              - generic [ref=f1e974]: Paid\n            - cell \"Actions Charge overrun Check out\" [ref=f1e975]:\n              - text: Actions\n              - generic [ref=f1e976]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const rows=[...document.querySelectorAll('[aria-label=\"Today\\'s bookings\"] tr')]; const row=rows.find(r=>r.textContent.includes('Walk-in shelf 4')); const buttons=[...row.querySelectorAll('button')].map(b=>({text:b.textContent.trim(),box:b.getBoundingClientRect().toJSON()}));return {row:row.getBoundingClientRect().toJSON(),text:row.textContent.trim(),buttons,scrollWidth:document.documentElement.scrollWidth};}"
}
```
- Result
```json
{
  "result": "{\n  \"row\": {\n    \"x\": 25,\n    \"y\": 602.375,\n    \"width\": 325,\n    \"height\": 281,\n    \"top\": 602.375,\n    \"right\": 350,\n    \"bottom\": 883.375,\n    \"left\": 25\n  },\n  \"text\": \"Saltbox TacosWalk-in shelf 407:30 CDT – 07:45 CDTChecked inPaidCharge overrunCheck out\",\n  \"buttons\": [\n    {\n      \"text\": \"Charge overrun\",\n      \"box\": {\n        \"x\": 34,\n        \"y\": 825.375,\n        \"width\": 142.828125,\n        \"height\": 44,\n        \"top\": 825.375,\n        \"right\": 176.828125,\n        \"bottom\": 869.375,\n        \"left\": 34\n      }\n    },\n    {\n      \"text\": \"Check out\",\n      \"box\": {\n        \"x\": 180.828125,\n        \"y\": 825.375,\n        \"width\": 105.390625,\n        \"height\": 44,\n        \"top\": 825.375,\n        \"right\": 286.21875,\n        \"bottom\": 869.375,\n        \"left\": 180.828125\n      }\n    }\n  ],\n  \"scrollWidth\": 375\n}"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 7
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/counter\n- Page Title: Hearthshift",
  "inlineSnapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e918]:\n    - generic [ref=f1e919]: Hearthshift\n    - navigation \"Main\" [ref=f1e924]:\n      - link \"Board\" [ref=f1e925] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=f1e926] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=f1e927]:\n      - generic [ref=f1e928]: Priya Lindqvist\n      - button \"Sign out\" [ref=f1e929] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=f1e930]:\n    - generic [ref=f1e931]:\n      - heading \"Counter\" [level=1] [ref=f1e932]\n      - generic [ref=f1e933]:\n        - generic [ref=f1e934]: Site\n        - combobox \"Site\" [ref=f1e935]:\n          - option \"Ember Row — Halsted\" [selected]\n      - status \"Counter status\" [ref=f1e936]: \"Checked in: Saltbox Tacos.\"\n      - table \"Today's bookings\" [ref=f1e938]:\n        - rowgroup [ref=f1e939]:\n          - row \"Renter Saltbox Tacos Station Prep table 3 Time 07:15 CDT – 07:30 CDT Status Checked in Paid Actions Charge overrun Check out\" [ref=f1e979]:\n            - cell \"Renter Saltbox Tacos\" [ref=f1e980]\n            - cell \"Station Prep table 3\" [ref=f1e981]\n            - cell \"Time 07:15 CDT – 07:30 CDT\" [ref=f1e982]\n            - cell \"Status Checked in Paid\" [ref=f1e983]:\n              - text: Status Checked in\n              - generic [ref=f1e984]: Paid\n            - cell \"Actions Charge overrun Check out\" [ref=f1e985]:\n              - text: Actions\n              - generic [ref=f1e986]\n          - row \"Renter Saltbox Tacos Station Walk-in shelf 4 Time 07:30 CDT – 07:45 CDT Status Checked in Paid Actions Charge overrun Check out\" [ref=f1e989]:\n            - cell \"Renter Saltbox Tacos\" [ref=f1e990]\n            - cell \"Station Walk-in shelf 4\" [ref=f1e991]\n            - cell \"Time 07:30 CDT – 07:45 CDT\" [ref=f1e992]\n            - cell \"Status Checked in Paid\" [ref=f1e993]:\n              - text: Status Checked in\n              - generic [ref=f1e994]: Paid\n            - cell \"Actions Charge overrun Check out\" [ref=f1e995]:\n              - text: Actions\n              - generic [ref=f1e996]"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "new Walk-in shelf booking stacked card",
  "target": "f1e989",
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of new Walk-in shelf booking stacked card](evidence/touch/element-2026-10-29T12-26-34-019Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
