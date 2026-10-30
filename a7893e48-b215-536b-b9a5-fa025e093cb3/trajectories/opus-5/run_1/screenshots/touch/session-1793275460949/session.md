
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
  "snapshot": "- generic [ref=e4]:\n  - heading \"Hearthshift\" [level=1] [ref=e5]\n  - paragraph [ref=e6]: Station time for shared kitchens.\n  - generic [ref=e7]:\n    - generic [ref=e8]: Email\n    - textbox \"Email\" [active] [ref=e9]\n  - generic [ref=e10]:\n    - generic [ref=e11]: Password\n    - textbox \"Password\" [ref=e12]\n  - button \"Sign in\" [ref=e13] [cursor=pointer]\n  - status \"Sign-in status\" [ref=e14]",
  "events": "- New console entries: evidence/touch/console-2026-10-29T12-04-21-095Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
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
  "target": "e13"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-10-29\n        - button \"Next day\" [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e49]\n        - button \"Deck oven 1\" [ref=e50] [cursor=pointer]:\n          - generic [ref=e52]: $38.00/h\n        - button \"Deck oven 2\" [ref=e53] [cursor=pointer]:\n          - generic [ref=e55]: $38.00/h\n        - button \"Range line A\" [ref=e56] [cursor=pointer]:\n          - generic [ref=e58]: $32.00/h\n        - button \"Prep table 3\" [ref=e59] [cursor=pointer]:\n          - generic [ref=e61]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e62] [cursor=pointer]:\n          - generic [ref=e64]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e69]:\n                - generic [ref=e70]: 00:00 CDT\n                - generic [ref=e74]: 03:00\n                - generic [ref=e77]: 06:00\n                - generic [ref=e81]: 09:00\n                - generic [ref=e84]: 12:00\n                - generic [ref=e88]: 15:00\n                - generic [ref=e91]: 18:00\n                - generic [ref=e95]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e208]\n              - slider \"Deck oven 2\" [ref=e209]\n              - slider \"Range line A\" [ref=e210]\n              - slider \"Prep table 3\" [ref=e211]\n              - slider \"Walk-in shelf 4\" [ref=e212]\n            - list \"Dial segment labels\"\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e213]:\n          - listitem [ref=e214]: Free\n          - listitem [ref=e216]: Held\n          - listitem [ref=e218]: Booked\n          - listitem [ref=e220]: Yours\n        - status \"Dial status\" [ref=e222]\n    - generic [ref=e223]:\n      - heading \"Tickets\" [level=2] [ref=e224]\n      - list \"Booking tickets\" [ref=e225]:\n        - listitem [ref=e226]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e227] [cursor=pointer]:\n            - generic [ref=e229]: Prep table 3\n            - generic [ref=e230]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e231]: 1.00 h\n            - generic [ref=e232]: Cancelled — refunded\n            - generic [ref=e233]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e234]: $95.00"
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
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]\n        - button \"Next day\" [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e49]\n        - button \"Deck oven 1\" [ref=e50] [cursor=pointer]\n        - button \"Deck oven 2\" [ref=e53] [cursor=pointer]\n        - button \"Range line A\" [ref=e56] [cursor=pointer]\n        - button \"Prep table 3\" [ref=e59] [cursor=pointer]\n        - button \"Walk-in shelf 4\" [ref=e62] [cursor=pointer]\n      - generic [ref=e65]:\n        - generic [ref=e66]\n        - list \"Dial legend\" [ref=e213]\n        - status \"Dial status\" [ref=e222]\n    - generic [ref=e223]:\n      - heading \"Tickets\" [level=2] [ref=e224]\n      - list \"Booking tickets\" [ref=e225]:\n        - listitem [ref=e226]"
}
```

### Tool call: browser_click
- Args
```json
{
  "target": "e41",
  "doubleClick": true
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-10-31\n        - button \"Next day\" [active] [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e49]\n        - button \"Deck oven 1\" [ref=e50] [cursor=pointer]:\n          - generic [ref=e52]: $38.00/h\n        - button \"Deck oven 2\" [ref=e53] [cursor=pointer]:\n          - generic [ref=e55]: $38.00/h\n        - button \"Range line A\" [ref=e56] [cursor=pointer]:\n          - generic [ref=e58]: $32.00/h\n        - button \"Prep table 3\" [ref=e59] [cursor=pointer]:\n          - generic [ref=e61]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e62] [cursor=pointer]:\n          - generic [ref=e64]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e235]:\n                - generic [ref=e236]: 00:00 CDT\n                - generic [ref=e240]: 03:00\n                - generic [ref=e243]: 06:00\n                - generic [ref=e247]: 09:00\n                - generic [ref=e250]: 12:00\n                - generic [ref=e254]: 15:00\n                - generic [ref=e257]: 18:00\n                - generic [ref=e261]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e375]\n              - slider \"Deck oven 2\" [ref=e376]\n              - slider \"Range line A\" [ref=e377]\n              - slider \"Prep table 3\" [ref=e378]\n              - slider \"Walk-in shelf 4\" [ref=e379]\n            - list \"Dial segment labels\" [ref=e380]:\n              - listitem [ref=e381]:\n                - generic [ref=e382]: Prep table 3\n                - generic [ref=e383]: Your hold 00:00–01:00\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e213]:\n          - listitem [ref=e214]: Free\n          - listitem [ref=e216]: Held\n          - listitem [ref=e218]: Booked\n          - listitem [ref=e220]: Yours\n        - status \"Dial status\" [ref=e222]\n    - generic [ref=e223]:\n      - heading \"Tickets\" [level=2] [ref=e224]\n      - list \"Booking tickets\" [ref=e225]:\n        - listitem [ref=e384]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e385] [cursor=pointer]:\n            - generic [ref=e387]: Prep table 3\n            - generic [ref=e388]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e389]: 1.00 h\n            - generic [ref=e390]: Cancelled — refunded\n            - generic [ref=e391]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e392]: $95.00"
}
```

### Tool call: browser_click
- Args
```json
{
  "target": "e41",
  "doubleClick": true
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-11-02\n        - button \"Next day\" [active] [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e49]\n        - button \"Deck oven 1\" [ref=e50] [cursor=pointer]:\n          - generic [ref=e52]: $38.00/h\n        - button \"Deck oven 2\" [ref=e53] [cursor=pointer]:\n          - generic [ref=e55]: $38.00/h\n        - button \"Range line A\" [ref=e56] [cursor=pointer]:\n          - generic [ref=e58]: $32.00/h\n        - button \"Prep table 3\" [ref=e59] [cursor=pointer]:\n          - generic [ref=e61]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e62] [cursor=pointer]:\n          - generic [ref=e64]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e393]:\n                - generic [ref=e394]: 00:00 CST\n                - generic [ref=e398]: 03:00\n                - generic [ref=e401]: 06:00\n                - generic [ref=e405]: 09:00\n                - generic [ref=e408]: 12:00\n                - generic [ref=e412]: 15:00\n                - generic [ref=e415]: 18:00\n                - generic [ref=e419]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e532]\n              - slider \"Deck oven 2\" [ref=e533]\n              - slider \"Range line A\" [ref=e534]\n              - slider \"Prep table 3\" [ref=e535]\n              - slider \"Walk-in shelf 4\" [ref=e536]\n            - list \"Dial segment labels\"\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e213]:\n          - listitem [ref=e214]: Free\n          - listitem [ref=e216]: Held\n          - listitem [ref=e218]: Booked\n          - listitem [ref=e220]: Yours\n        - status \"Dial status\" [ref=e222]\n    - generic [ref=e223]:\n      - heading \"Tickets\" [level=2] [ref=e224]\n      - list \"Booking tickets\" [ref=e225]:\n        - listitem [ref=e537]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e538] [cursor=pointer]:\n            - generic [ref=e540]: Prep table 3\n            - generic [ref=e541]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e542]: 1.00 h\n            - generic [ref=e543]: Cancelled — refunded\n            - generic [ref=e544]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e545]: $95.00"
}
```

### Tool call: browser_click
- Args
```json
{
  "target": "e62"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-11-02\n        - button \"Next day\" [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e546]\n        - button \"Deck oven 1\" [ref=e547] [cursor=pointer]:\n          - generic [ref=e549]: $38.00/h\n        - button \"Deck oven 2\" [ref=e550] [cursor=pointer]:\n          - generic [ref=e552]: $38.00/h\n        - button \"Range line A\" [ref=e553] [cursor=pointer]:\n          - generic [ref=e555]: $32.00/h\n        - button \"Prep table 3\" [ref=e556] [cursor=pointer]:\n          - generic [ref=e558]: $20.00/h\n        - button \"Walk-in shelf 4\" [pressed] [ref=e559] [cursor=pointer]:\n          - generic [ref=e561]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e562]:\n                - generic [ref=e563]: 00:00 CST\n                - generic [ref=e567]: 03:00\n                - generic [ref=e570]: 06:00\n                - generic [ref=e574]: 09:00\n                - generic [ref=e577]: 12:00\n                - generic [ref=e581]: 15:00\n                - generic [ref=e584]: 18:00\n                - generic [ref=e588]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e701]\n              - slider \"Deck oven 2\" [ref=e702]\n              - slider \"Range line A\" [ref=e703]\n              - slider \"Prep table 3\" [ref=e704]\n              - slider \"Walk-in shelf 4\" [active] [ref=e705]\n            - list \"Dial segment labels\"\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e213]:\n          - listitem [ref=e214]: Free\n          - listitem [ref=e216]: Held\n          - listitem [ref=e218]: Booked\n          - listitem [ref=e220]: Yours\n        - status \"Dial status\" [ref=e222]\n    - generic [ref=e223]:\n      - heading \"Tickets\" [level=2] [ref=e224]\n      - list \"Booking tickets\" [ref=e225]:\n        - listitem [ref=e537]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e538] [cursor=pointer]:\n            - generic [ref=e540]: Prep table 3\n            - generic [ref=e541]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e542]: 1.00 h\n            - generic [ref=e543]: Cancelled — refunded\n            - generic [ref=e544]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e545]: $95.00"
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
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-11-02\n        - button \"Next day\" [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e546]\n        - button \"Deck oven 1\" [ref=e547] [cursor=pointer]:\n          - generic [ref=e549]: $38.00/h\n        - button \"Deck oven 2\" [ref=e550] [cursor=pointer]:\n          - generic [ref=e552]: $38.00/h\n        - button \"Range line A\" [ref=e553] [cursor=pointer]:\n          - generic [ref=e555]: $32.00/h\n        - button \"Prep table 3\" [ref=e556] [cursor=pointer]:\n          - generic [ref=e558]: $20.00/h\n        - button \"Walk-in shelf 4\" [pressed] [ref=e559] [cursor=pointer]:\n          - generic [ref=e561]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e707]:\n                - generic [ref=e708]: 00:00 CST\n                - generic [ref=e712]: 03:00\n                - generic [ref=e715]: 06:00\n                - generic [ref=e719]: 09:00\n                - generic [ref=e722]: 12:00\n                - generic [ref=e726]: 15:00\n                - generic [ref=e729]: 18:00\n                - generic [ref=e733]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e848]\n              - slider \"Deck oven 2\" [ref=e849]\n              - slider \"Range line A\" [ref=e850]\n              - slider \"Prep table 3\" [ref=e851]\n              - slider \"Walk-in shelf 4\" [ref=e852]\n            - list \"Dial segment labels\" [ref=e380]:\n              - listitem [ref=e853]:\n                - generic [ref=e854]: Walk-in shelf 4\n                - generic [ref=e855]: Your hold 00:00–01:00\n          - region \"Selection summary\":\n            - generic: 0.12 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\" [ref=e856]: 09:59\n        - list \"Dial legend\" [ref=e213]:\n          - listitem [ref=e214]: Free\n          - listitem [ref=e216]: Held\n          - listitem [ref=e218]: Booked\n          - listitem [ref=e220]: Yours\n        - status \"Dial status\" [ref=e222]: Held until 07:15. Finish checkout to keep it.\n      - generic [ref=e860]:\n        - button \"Checkout\" [ref=e861] [cursor=pointer]\n        - dialog \"Checkout\" [ref=e862]:\n          - heading \"Checkout\" [level=2] [ref=e863]\n          - list [ref=e864]:\n            - listitem [ref=e865]: 2026-11-02 00:00–01:00 · 1.00 h\n          - generic [ref=e866]:\n            - term [ref=e867]: Pack hours\n            - definition [ref=e868]: 0.00 h\n            - term [ref=e869]: Card hours\n            - definition [ref=e870]: 1.00 h\n            - term [ref=e871]: Card total\n            - definition [ref=e872]: $6.00\n            - term [ref=e873]: Deposit\n            - definition [ref=e874]: $75.00\n          - generic [ref=e875]:\n            - checkbox \"Use pack hours\" [active] [ref=e876]\n            - generic [ref=e877]: Use pack hours (0.00 h available)\n          - radiogroup \"Card payment\" [ref=e878]:\n            - generic [ref=e879]:\n              - radio \"Pay now\" [checked] [ref=e880]\n              - generic [ref=e881]: Pay now\n            - generic [ref=e882]:\n              - radio \"Pay later\" [ref=e883]\n              - generic [ref=e884]: Pay later (due by 2026-10-31 00:00 CST)\n          - paragraph [ref=e885]: Free cancellation until 24 hours before start. Later cancellations keep the time charge and the deposit.\n          - paragraph [ref=e886]: Held until 2026-10-29 07:15 CDT\n          - generic [ref=e887]:\n            - button \"Confirm booking\" [ref=e888] [cursor=pointer]\n            - button \"Let hold go\" [ref=e889] [cursor=pointer]\n          - status \"Checkout status\" [ref=e890]\n    - generic [ref=e223]:\n      - heading \"Tickets\" [level=2] [ref=e224]\n      - list \"Booking tickets\" [ref=e225]:\n        - listitem [ref=e537]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e538] [cursor=pointer]:\n            - generic [ref=e540]: Prep table 3\n            - generic [ref=e541]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e542]: 1.00 h\n            - generic [ref=e543]: Cancelled — refunded\n            - generic [ref=e544]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e545]: $95.00"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const d=document.querySelector('[role=dialog][aria-label=Checkout]');const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Confirm booking'));return {viewport:[innerWidth,innerHeight],dialog:d.getBoundingClientRect().toJSON(),button:b.getBoundingClientRect().toJSON()}}"
}
```
- Result
```json
{
  "result": "{\n  \"viewport\": [\n    375,\n    812\n  ],\n  \"dialog\": {\n    \"x\": 0,\n    \"y\": 305.65625,\n    \"width\": 375,\n    \"height\": 506.34375,\n    \"top\": 305.65625,\n    \"right\": 375,\n    \"bottom\": 812,\n    \"left\": 0\n  },\n  \"button\": {\n    \"x\": 17,\n    \"y\": 723,\n    \"width\": 151.140625,\n    \"height\": 44,\n    \"top\": 723,\n    \"right\": 168.140625,\n    \"bottom\": 767,\n    \"left\": 17\n  }\n}"
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
  "result": "- [Screenshot of viewport](evidence/touch/page-2026-10-29T12-05-30-428Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Let hold go",
  "target": "[role=dialog] .button.quiet"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e15]:\n    - generic [ref=e16]: Hearthshift\n    - navigation \"Main\" [ref=e21]:\n      - link \"Board\" [ref=e22] [cursor=pointer]:\n        - /url: /board\n      - link \"Tickets\" [ref=e23] [cursor=pointer]:\n        - /url: /tickets\n      - link \"Pack\" [ref=e24] [cursor=pointer]:\n        - /url: /pack\n      - link \"Documents\" [ref=e25] [cursor=pointer]:\n        - /url: /documents\n    - generic [ref=e26]:\n      - generic [ref=e27]: Rafa Quintero\n      - button \"Sign out\" [ref=e28] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e29]:\n    - generic [ref=e30]:\n      - generic [ref=e31]:\n        - generic [ref=e32]: Site\n        - combobox \"Site\" [ref=e33]:\n          - option \"Ember Row — Halsted\" [selected]\n          - option \"Ember Row — Corktown\"\n      - generic [ref=e34]:\n        - button \"Previous day\" [ref=e35] [cursor=pointer]\n        - generic [ref=e38]:\n          - generic [ref=e39]: Day\n          - textbox \"Day\" [ref=e40]: 2026-11-02\n        - button \"Next day\" [ref=e41] [cursor=pointer]\n      - generic [ref=e44]:\n        - generic [ref=e45]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e46]: \"1\"\n    - generic [ref=e47]:\n      - generic [ref=e48]:\n        - heading \"Stations\" [level=2] [ref=e546]\n        - button \"Deck oven 1\" [ref=e547] [cursor=pointer]:\n          - generic [ref=e549]: $38.00/h\n        - button \"Deck oven 2\" [ref=e550] [cursor=pointer]:\n          - generic [ref=e552]: $38.00/h\n        - button \"Range line A\" [ref=e553] [cursor=pointer]:\n          - generic [ref=e555]: $32.00/h\n        - button \"Prep table 3\" [ref=e556] [cursor=pointer]:\n          - generic [ref=e558]: $20.00/h\n        - button \"Walk-in shelf 4\" [pressed] [ref=e559] [cursor=pointer]:\n          - generic [ref=e561]: $6.00/h\n      - generic [ref=e65]:\n        - generic [ref=e66]:\n          - group \"Station dial\" [ref=e67]:\n            - img [aria-hidden] [ref=e68]:\n              - generic [ref=e891]:\n                - generic [ref=e892]: 00:00 CST\n                - generic [ref=e896]: 03:00\n                - generic [ref=e899]: 06:00\n                - generic [ref=e903]: 09:00\n                - generic [ref=e906]: 12:00\n                - generic [ref=e910]: 15:00\n                - generic [ref=e913]: 18:00\n                - generic [ref=e917]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e1030]\n              - slider \"Deck oven 2\" [ref=e1031]\n              - slider \"Range line A\" [ref=e1032]\n              - slider \"Prep table 3\" [ref=e1033]\n              - slider \"Walk-in shelf 4\" [ref=e1034]\n            - list \"Dial segment labels\"\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e213]:\n          - listitem [ref=e214]: Free\n          - listitem [ref=e216]: Held\n          - listitem [ref=e218]: Booked\n          - listitem [ref=e220]: Yours\n        - status \"Dial status\" [ref=e222]: Hold released.\n    - generic [ref=e223]:\n      - heading \"Tickets\" [level=2] [ref=e224]\n      - list \"Booking tickets\" [ref=e225]:\n        - listitem [ref=e1035]:\n          - button \"Prep table 3 2026-11-03 00:00 CST – 01:00 CST 1.00 h Cancelled — refunded Balance due by 2026-11-01 00:00 CDT $95.00\" [ref=e1036] [cursor=pointer]:\n            - generic [ref=e1038]: Prep table 3\n            - generic [ref=e1039]: 2026-11-03 00:00 CST – 01:00 CST\n            - generic [ref=e1040]: 1.00 h\n            - generic [ref=e1041]: Cancelled — refunded\n            - generic [ref=e1042]: Balance due by 2026-11-01 00:00 CDT\n            - generic [ref=e1043]: $95.00"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Sign out",
  "target": "button.button.quiet"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Hearthshift\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1045]:\n  - heading \"Hearthshift\" [level=1] [ref=e1046]\n  - paragraph [ref=e1047]: Station time for shared kitchens.\n  - generic [ref=e1048]:\n    - generic [ref=e1049]: Email\n    - textbox \"Email\" [active] [ref=e1050]\n  - generic [ref=e1051]:\n    - generic [ref=e1052]: Password\n    - textbox \"Password\" [ref=e1053]\n  - button \"Sign in\" [ref=e1054] [cursor=pointer]\n  - status \"Sign-in status\" [ref=e1055]"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Hearthshift\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1045]:\n  - heading \"Hearthshift\" [level=1] [ref=e1046]\n  - paragraph [ref=e1047]: Station time for shared kitchens.\n  - generic [ref=e1048]:\n    - generic [ref=e1049]: Email\n    - textbox \"Email\" [active] [ref=e1050]\n  - generic [ref=e1051]:\n    - generic [ref=e1052]: Password\n    - textbox \"Password\" [ref=e1053]\n  - button \"Sign in\" [ref=e1054] [cursor=pointer]\n  - status \"Sign-in status\" [ref=e1055]",
  "events": "- New console entries: evidence/touch/console-2026-10-29T12-04-21-095Z.log#L2"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e1050",
      "name": "Email",
      "type": "textbox",
      "value": "desk.halsted@emberrow.test"
    },
    {
      "target": "e1053",
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
  "target": "e1054"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/counter\n- Page Title: Hearthshift\n- Console: 3 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e1056]:\n    - generic [ref=e1057]: Hearthshift\n    - navigation \"Main\" [ref=e1062]:\n      - link \"Board\" [ref=e1063] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1064] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1065]:\n      - generic [ref=e1066]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1067] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1068]:\n    - generic [ref=e1069]:\n      - heading \"Counter\" [level=1] [ref=e1070]\n      - generic [ref=e1071]:\n        - generic [ref=e1072]: Site\n        - combobox \"Site\" [ref=e1073]:\n          - option \"Ember Row — Halsted\" [selected]\n      - status \"Counter status\" [ref=e1074]\n      - table \"Today's bookings\" [ref=e1076]:\n        - rowgroup [ref=e1077]:\n          - row [ref=e1078]:\n            - cell \"No bookings today.\" [ref=e1079]",
  "events": "- New console entries: evidence/touch/console-2026-10-29T12-04-21-095Z.log#L3"
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
  "page": "- Page URL: http://127.0.0.1:4173/counter\n- Page Title: Hearthshift\n- Console: 3 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e1056]:\n    - generic [ref=e1057]: Hearthshift\n    - navigation \"Main\" [ref=e1062]:\n      - link \"Board\" [ref=e1063] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1064] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1065]:\n      - generic [ref=e1066]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1067] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1068]:\n    - generic [ref=e1069]:\n      - heading \"Counter\" [level=1] [ref=e1070]\n      - generic [ref=e1071]:\n        - generic [ref=e1072]: Site\n        - combobox \"Site\" [ref=e1073]\n      - status \"Counter status\" [ref=e1074]\n      - table \"Today's bookings\" [ref=e1076]:\n        - rowgroup [ref=e1077]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Board",
  "target": "e1063"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 3 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e1080]:\n    - generic [ref=e1081]: Hearthshift\n    - navigation \"Main\" [ref=e1086]:\n      - link \"Board\" [ref=e1087] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1088] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1089]:\n      - generic [ref=e1090]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1091] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1092]:\n    - generic [ref=e1093]:\n      - generic [ref=e1094]:\n        - generic [ref=e1095]: Site\n        - combobox \"Site\" [ref=e1096]:\n          - option \"Ember Row — Halsted\" [selected]\n      - generic [ref=e1097]:\n        - button \"Previous day\" [ref=e1098] [cursor=pointer]\n        - generic [ref=e1101]:\n          - generic [ref=e1102]: Day\n          - textbox \"Day\" [ref=e1103]: 2026-10-29\n        - button \"Next day\" [ref=e1104] [cursor=pointer]\n      - generic [ref=e1107]:\n        - generic [ref=e1108]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e1109]: \"1\"\n      - generic [ref=e1110]:\n        - generic [ref=e1111]: Renter\n        - combobox \"Renter\" [ref=e1112]:\n          - option \"Choose a renter\" [selected]\n          - option \"Juniper Crumb Bakery\"\n          - option \"Little Ledger Meal Prep\"\n          - option \"Nightjar Pies\"\n          - option \"Saltbox Tacos\"\n    - generic [ref=e1113]:\n      - generic [ref=e1114]:\n        - heading \"Stations\" [level=2] [ref=e1115]\n        - button \"Deck oven 1\" [ref=e1116] [cursor=pointer]:\n          - generic [ref=e1118]: $38.00/h\n        - button \"Deck oven 2\" [ref=e1119] [cursor=pointer]:\n          - generic [ref=e1121]: $38.00/h\n        - button \"Range line A\" [ref=e1122] [cursor=pointer]:\n          - generic [ref=e1124]: $32.00/h\n        - button \"Prep table 3\" [ref=e1125] [cursor=pointer]:\n          - generic [ref=e1127]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e1128] [cursor=pointer]:\n          - generic [ref=e1130]: $6.00/h\n      - generic [ref=e1131]:\n        - generic [ref=e1132]:\n          - group \"Station dial\" [ref=e1133]:\n            - img [aria-hidden] [ref=e1134]:\n              - generic [ref=e1135]:\n                - generic [ref=e1136]: 00:00 CDT\n                - generic [ref=e1140]: 03:00\n                - generic [ref=e1143]: 06:00\n                - generic [ref=e1147]: 09:00\n                - generic [ref=e1150]: 12:00\n                - generic [ref=e1154]: 15:00\n                - generic [ref=e1157]: 18:00\n                - generic [ref=e1161]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e1274]\n              - slider \"Deck oven 2\" [ref=e1275]\n              - slider \"Range line A\" [ref=e1276]\n              - slider \"Prep table 3\" [ref=e1277]\n              - slider \"Walk-in shelf 4\" [ref=e1278]\n            - list \"Dial segment labels\"\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e1279]:\n          - listitem [ref=e1280]: Free\n          - listitem [ref=e1282]: Held\n          - listitem [ref=e1284]: Booked\n          - listitem [ref=e1286]: Yours\n        - status \"Dial status\" [ref=e1288]\n    - generic [ref=e1289]:\n      - heading \"Tickets\" [level=2] [ref=e1290]\n      - list \"Booking tickets\" [ref=e1291]:\n        - listitem [ref=e1292]: No tickets yet."
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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 3 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e1080]:\n    - generic [ref=e1081]: Hearthshift\n    - navigation \"Main\" [ref=e1086]:\n      - link \"Board\" [ref=e1087] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1088] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1089]:\n      - generic [ref=e1090]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1091] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1092]:\n    - generic [ref=e1093]:\n      - generic [ref=e1094]:\n        - generic [ref=e1095]: Site\n        - combobox \"Site\" [ref=e1096]:\n          - option \"Ember Row — Halsted\" [selected]\n      - generic [ref=e1097]:\n        - button \"Previous day\" [ref=e1098] [cursor=pointer]\n        - generic [ref=e1101]:\n          - generic [ref=e1102]: Day\n          - textbox \"Day\" [ref=e1103]: 2026-10-29\n        - button \"Next day\" [ref=e1104] [cursor=pointer]\n      - generic [ref=e1107]:\n        - generic [ref=e1108]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e1109]: \"1\"\n      - generic [ref=e1110]:\n        - generic [ref=e1111]: Renter\n        - combobox \"Renter\" [ref=e1112]:\n          - option \"Choose a renter\" [selected]\n          - option \"Juniper Crumb Bakery\"\n          - option \"Little Ledger Meal Prep\"\n          - option \"Nightjar Pies\"\n          - option \"Saltbox Tacos\"\n    - generic [ref=e1113]:\n      - generic [ref=e1114]:\n        - heading \"Stations\" [level=2] [ref=e1115]\n        - button \"Deck oven 1\" [ref=e1116] [cursor=pointer]:\n          - generic [ref=e1118]: $38.00/h\n        - button \"Deck oven 2\" [ref=e1119] [cursor=pointer]:\n          - generic [ref=e1121]: $38.00/h\n        - button \"Range line A\" [ref=e1122] [cursor=pointer]:\n          - generic [ref=e1124]: $32.00/h\n        - button \"Prep table 3\" [ref=e1125] [cursor=pointer]:\n          - generic [ref=e1127]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e1128] [cursor=pointer]:\n          - generic [ref=e1130]: $6.00/h\n      - generic [ref=e1131]:\n        - generic [ref=e1132]:\n          - group \"Station dial\" [ref=e1133]\n          - region \"Selection summary\"\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e1279]:\n          - listitem [ref=e1280]: Free\n          - listitem [ref=e1282]: Held\n          - listitem [ref=e1284]: Booked\n          - listitem [ref=e1286]: Yours\n        - status \"Dial status\" [ref=e1288]\n    - generic [ref=e1289]:\n      - heading \"Tickets\" [level=2] [ref=e1290]\n      - list \"Booking tickets\" [ref=e1291]:\n        - listitem [ref=e1292]: No tickets yet."
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e1112",
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
  "element": "Prep table 3",
  "target": "e1125"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 3 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e1080]:\n    - generic [ref=e1081]: Hearthshift\n    - navigation \"Main\" [ref=e1086]:\n      - link \"Board\" [ref=e1087] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1088] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1089]:\n      - generic [ref=e1090]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1091] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1092]:\n    - generic [ref=e1093]:\n      - generic [ref=e1094]:\n        - generic [ref=e1095]: Site\n        - combobox \"Site\" [ref=e1096]:\n          - option \"Ember Row — Halsted\" [selected]\n      - generic [ref=e1097]:\n        - button \"Previous day\" [ref=e1098] [cursor=pointer]\n        - generic [ref=e1101]:\n          - generic [ref=e1102]: Day\n          - textbox \"Day\" [ref=e1103]: 2026-10-29\n        - button \"Next day\" [ref=e1104] [cursor=pointer]\n      - generic [ref=e1107]:\n        - generic [ref=e1108]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e1109]: \"1\"\n      - generic [ref=e1110]:\n        - generic [ref=e1111]: Renter\n        - combobox \"Renter\" [ref=e1112]:\n          - option \"Choose a renter\"\n          - option \"Juniper Crumb Bakery\"\n          - option \"Little Ledger Meal Prep\"\n          - option \"Nightjar Pies\"\n          - option \"Saltbox Tacos\" [selected]\n    - generic [ref=e1113]:\n      - generic [ref=e1114]:\n        - heading \"Stations\" [level=2] [ref=e1293]\n        - button \"Deck oven 1\" [ref=e1294] [cursor=pointer]:\n          - generic [ref=e1296]: $38.00/h\n        - button \"Deck oven 2\" [ref=e1297] [cursor=pointer]:\n          - generic [ref=e1299]: $38.00/h\n        - button \"Range line A\" [ref=e1300] [cursor=pointer]:\n          - generic [ref=e1302]: $32.00/h\n        - button \"Prep table 3\" [pressed] [ref=e1303] [cursor=pointer]:\n          - generic [ref=e1305]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e1306] [cursor=pointer]:\n          - generic [ref=e1308]: $6.00/h\n      - generic [ref=e1131]:\n        - generic [ref=e1132]:\n          - group \"Station dial\" [ref=e1133]:\n            - img [aria-hidden] [ref=e1134]:\n              - generic [ref=e1309]:\n                - generic [ref=e1310]: 00:00 CDT\n                - generic [ref=e1314]: 03:00\n                - generic [ref=e1317]: 06:00\n                - generic [ref=e1321]: 09:00\n                - generic [ref=e1324]: 12:00\n                - generic [ref=e1328]: 15:00\n                - generic [ref=e1331]: 18:00\n                - generic [ref=e1335]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e1448]\n              - slider \"Deck oven 2\" [ref=e1449]\n              - slider \"Range line A\" [ref=e1450]\n              - slider \"Prep table 3\" [active] [ref=e1451]\n              - slider \"Walk-in shelf 4\" [ref=e1452]\n            - list \"Dial segment labels\"\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e1279]:\n          - listitem [ref=e1280]: Free\n          - listitem [ref=e1282]: Held\n          - listitem [ref=e1284]: Booked\n          - listitem [ref=e1286]: Yours\n        - status \"Dial status\" [ref=e1288]\n    - generic [ref=e1289]:\n      - heading \"Tickets\" [level=2] [ref=e1290]\n      - list \"Booking tickets\" [ref=e1291]:\n        - listitem [ref=e1453]: No tickets yet."
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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 3 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e1080]:\n    - generic [ref=e1081]: Hearthshift\n    - navigation \"Main\" [ref=e1086]:\n      - link \"Board\" [ref=e1087] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1088] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1089]:\n      - generic [ref=e1090]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1091] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1092]:\n    - generic [ref=e1093]:\n      - generic [ref=e1094]:\n        - generic [ref=e1095]: Site\n        - combobox \"Site\" [ref=e1096]:\n          - option \"Ember Row — Halsted\" [selected]\n      - generic [ref=e1097]:\n        - button \"Previous day\" [ref=e1098] [cursor=pointer]\n        - generic [ref=e1101]:\n          - generic [ref=e1102]: Day\n          - textbox \"Day\" [ref=e1103]: 2026-10-29\n        - button \"Next day\" [ref=e1104] [cursor=pointer]\n      - generic [ref=e1107]:\n        - generic [ref=e1108]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e1109]: \"1\"\n      - generic [ref=e1110]:\n        - generic [ref=e1111]: Renter\n        - combobox \"Renter\" [ref=e1112]:\n          - option \"Choose a renter\"\n          - option \"Juniper Crumb Bakery\"\n          - option \"Little Ledger Meal Prep\"\n          - option \"Nightjar Pies\"\n          - option \"Saltbox Tacos\" [selected]\n    - generic [ref=e1113]:\n      - generic [ref=e1114]:\n        - heading \"Stations\" [level=2] [ref=e1293]\n        - button \"Deck oven 1\" [ref=e1294] [cursor=pointer]:\n          - generic [ref=e1296]: $38.00/h\n        - button \"Deck oven 2\" [ref=e1297] [cursor=pointer]:\n          - generic [ref=e1299]: $38.00/h\n        - button \"Range line A\" [ref=e1300] [cursor=pointer]:\n          - generic [ref=e1302]: $32.00/h\n        - button \"Prep table 3\" [pressed] [ref=e1303] [cursor=pointer]:\n          - generic [ref=e1305]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e1306] [cursor=pointer]:\n          - generic [ref=e1308]: $6.00/h\n      - generic [ref=e1131]:\n        - generic [ref=e1132]:\n          - group \"Station dial\" [ref=e1133]\n          - region \"Selection summary\"\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e1279]:\n          - listitem [ref=e1280]: Free\n          - listitem [ref=e1282]: Held\n          - listitem [ref=e1284]: Booked\n          - listitem [ref=e1286]: Yours\n        - status \"Dial status\" [ref=e1288]: Selection 07:00–07:15, 0.25 h\n    - generic [ref=e1289]:\n      - heading \"Tickets\" [level=2] [ref=e1290]\n      - list \"Booking tickets\" [ref=e1291]:\n        - listitem [ref=e1453]: No tickets yet."
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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 3 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e1080]:\n    - generic [ref=e1081]: Hearthshift\n    - navigation \"Main\" [ref=e1086]:\n      - link \"Board\" [ref=e1087] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1088] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1089]:\n      - generic [ref=e1090]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1091] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1092]:\n    - generic [ref=e1093]:\n      - generic [ref=e1094]:\n        - generic [ref=e1095]: Site\n        - combobox \"Site\" [ref=e1096]:\n          - option \"Ember Row — Halsted\" [selected]\n      - generic [ref=e1097]:\n        - button \"Previous day\" [ref=e1098] [cursor=pointer]\n        - generic [ref=e1101]:\n          - generic [ref=e1102]: Day\n          - textbox \"Day\" [ref=e1103]: 2026-10-29\n        - button \"Next day\" [ref=e1104] [cursor=pointer]\n      - generic [ref=e1107]:\n        - generic [ref=e1108]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e1109]: \"1\"\n      - generic [ref=e1110]:\n        - generic [ref=e1111]: Renter\n        - combobox \"Renter\" [ref=e1112]:\n          - option \"Choose a renter\"\n          - option \"Juniper Crumb Bakery\"\n          - option \"Little Ledger Meal Prep\"\n          - option \"Nightjar Pies\"\n          - option \"Saltbox Tacos\" [selected]\n    - generic [ref=e1113]:\n      - generic [ref=e1114]:\n        - heading \"Stations\" [level=2] [ref=e1293]\n        - button \"Deck oven 1\" [ref=e1294] [cursor=pointer]:\n          - generic [ref=e1296]: $38.00/h\n        - button \"Deck oven 2\" [ref=e1297] [cursor=pointer]:\n          - generic [ref=e1299]: $38.00/h\n        - button \"Range line A\" [ref=e1300] [cursor=pointer]:\n          - generic [ref=e1302]: $32.00/h\n        - button \"Prep table 3\" [pressed] [ref=e1303] [cursor=pointer]:\n          - generic [ref=e1305]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e1306] [cursor=pointer]:\n          - generic [ref=e1308]: $6.00/h\n      - generic [ref=e1131]:\n        - generic [ref=e1132]:\n          - group \"Station dial\" [ref=e1133]:\n            - img [aria-hidden] [ref=e1134]:\n              - generic [ref=e1600]:\n                - generic [ref=e1601]: 00:00 CDT\n                - generic [ref=e1605]: 03:00\n                - generic [ref=e1608]: 06:00\n                - generic [ref=e1612]: 09:00\n                - generic [ref=e1615]: 12:00\n                - generic [ref=e1619]: 15:00\n                - generic [ref=e1622]: 18:00\n                - generic [ref=e1626]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e1741]\n              - slider \"Deck oven 2\" [ref=e1742]\n              - slider \"Range line A\" [ref=e1743]\n              - slider \"Prep table 3\" [ref=e1744]\n              - slider \"Walk-in shelf 4\" [ref=e1745]\n            - list \"Dial segment labels\" [ref=e1746]:\n              - listitem [ref=e1747]:\n                - generic [ref=e1748]: Prep table 3\n                - generic [ref=e1749]: Held 07:15–07:30\n                - generic [ref=e1750]: Saltbox Tacos\n          - region \"Selection summary\":\n            - generic: 0.01 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\" [ref=e1751]: 09:59\n        - list \"Dial legend\" [ref=e1279]:\n          - listitem [ref=e1280]: Free\n          - listitem [ref=e1282]: Held\n          - listitem [ref=e1284]: Booked\n          - listitem [ref=e1286]: Yours\n        - status \"Dial status\" [ref=e1288]: Held until 07:16. Finish checkout to keep it.\n      - generic [ref=e1755]:\n        - button \"Checkout\" [ref=e1756] [cursor=pointer]\n        - dialog \"Checkout\" [ref=e1757]:\n          - heading \"Checkout\" [level=2] [ref=e1758]\n          - list [ref=e1759]:\n            - listitem [ref=e1760]: 2026-10-29 07:15–07:30 · 0.25 h\n          - generic [ref=e1761]:\n            - term [ref=e1762]: Pack hours\n            - definition [ref=e1763]: 0.00 h\n            - term [ref=e1764]: Card hours\n            - definition [ref=e1765]: 0.25 h\n            - term [ref=e1766]: Card total\n            - definition [ref=e1767]: $5.00\n            - term [ref=e1768]: Deposit\n            - definition [ref=e1769]: $75.00\n          - generic [ref=e1770]:\n            - checkbox \"Use pack hours\" [active] [ref=e1771]\n            - generic [ref=e1772]: Use pack hours (0.00 h available)\n          - radiogroup \"Card payment\" [ref=e1773]:\n            - generic [ref=e1774]:\n              - radio \"Pay now\" [checked] [ref=e1775]\n              - generic [ref=e1776]: Pay now\n            - generic [ref=e1777]:\n              - radio \"Pay later\" [ref=e1778]\n              - generic [ref=e1779]: Pay later (due by 2026-10-27 07:15 CDT)\n          - paragraph [ref=e1780]: Free cancellation until 24 hours before start. Later cancellations keep the time charge and the deposit.\n          - paragraph [ref=e1781]: Held until 2026-10-29 07:16 CDT\n          - generic [ref=e1782]:\n            - button \"Confirm booking\" [ref=e1783] [cursor=pointer]\n            - button \"Let hold go\" [ref=e1784] [cursor=pointer]\n          - status \"Checkout status\" [ref=e1785]\n    - generic [ref=e1289]:\n      - heading \"Tickets\" [level=2] [ref=e1290]\n      - list \"Booking tickets\" [ref=e1291]:\n        - listitem [ref=e1453]: No tickets yet."
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
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 3 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e1080]:\n    - generic [ref=e1081]: Hearthshift\n    - navigation \"Main\" [ref=e1086]:\n      - link \"Board\" [ref=e1087] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1088] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1089]:\n      - generic [ref=e1090]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1091] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1092]:\n    - generic [ref=e1093]:\n      - generic [ref=e1094]:\n        - generic [ref=e1095]: Site\n        - combobox \"Site\" [ref=e1096]:\n          - option \"Ember Row — Halsted\" [selected]\n      - generic [ref=e1097]:\n        - button \"Previous day\" [ref=e1098] [cursor=pointer]\n        - generic [ref=e1101]:\n          - generic [ref=e1102]: Day\n          - textbox \"Day\" [ref=e1103]: 2026-10-29\n        - button \"Next day\" [ref=e1104] [cursor=pointer]\n      - generic [ref=e1107]:\n        - generic [ref=e1108]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e1109]: \"1\"\n      - generic [ref=e1110]:\n        - generic [ref=e1111]: Renter\n        - combobox \"Renter\" [ref=e1112]:\n          - option \"Choose a renter\"\n          - option \"Juniper Crumb Bakery\"\n          - option \"Little Ledger Meal Prep\"\n          - option \"Nightjar Pies\"\n          - option \"Saltbox Tacos\" [selected]\n    - generic [ref=e1113]:\n      - generic [ref=e1114]:\n        - heading \"Stations\" [level=2] [ref=e1293]\n        - button \"Deck oven 1\" [ref=e1294] [cursor=pointer]:\n          - generic [ref=e1296]: $38.00/h\n        - button \"Deck oven 2\" [ref=e1297] [cursor=pointer]:\n          - generic [ref=e1299]: $38.00/h\n        - button \"Range line A\" [ref=e1300] [cursor=pointer]:\n          - generic [ref=e1302]: $32.00/h\n        - button \"Prep table 3\" [pressed] [ref=e1303] [cursor=pointer]:\n          - generic [ref=e1305]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e1306] [cursor=pointer]:\n          - generic [ref=e1308]: $6.00/h\n      - generic [ref=e1131]:\n        - generic [ref=e1132]:\n          - group \"Station dial\" [ref=e1133]:\n            - img [aria-hidden] [ref=e1134]\n            - generic\n            - list \"Dial segment labels\" [ref=e1746]\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\" [ref=e1751]: 09:57\n        - list \"Dial legend\" [ref=e1279]:\n          - listitem [ref=e1280]: Free\n          - listitem [ref=e1282]: Held\n          - listitem [ref=e1284]: Booked\n          - listitem [ref=e1286]: Yours\n        - status \"Dial status\" [ref=e1288]: Held until 07:16. Finish checkout to keep it.\n      - generic [ref=e1755]:\n        - button \"Checkout\" [ref=e1756] [cursor=pointer]\n        - dialog \"Checkout\" [ref=e1757]:\n          - heading \"Checkout\" [level=2] [ref=e1758]\n          - list [ref=e1759]:\n            - listitem [ref=e1760]: 2026-10-29 07:15–07:30 · 0.25 h\n          - generic [ref=e1761]:\n            - term [ref=e1762]: Pack hours\n            - definition [ref=e1763]: 0.00 h\n            - term [ref=e1764]: Card hours\n            - definition [ref=e1765]: 0.25 h\n            - term [ref=e1766]: Card total\n            - definition [ref=e1767]: $5.00\n            - term [ref=e1768]: Deposit\n            - definition [ref=e1769]: $75.00\n          - generic [ref=e1770]:\n            - checkbox \"Use pack hours\" [active] [ref=e1771]\n            - generic [ref=e1772]: Use pack hours (0.00 h available)\n          - radiogroup \"Card payment\" [ref=e1773]:\n            - generic [ref=e1774]\n            - generic [ref=e1777]\n          - paragraph [ref=e1780]: Free cancellation until 24 hours before start. Later cancellations keep the time charge and the deposit.\n          - paragraph [ref=e1781]: Held until 2026-10-29 07:16 CDT\n          - generic [ref=e1782]:\n            - button \"Confirm booking\" [ref=e1783] [cursor=pointer]\n            - button \"Let hold go\" [ref=e1784] [cursor=pointer]\n          - status \"Checkout status\" [ref=e1785]\n    - generic [ref=e1289]:\n      - heading \"Tickets\" [level=2] [ref=e1290]\n      - list \"Booking tickets\" [ref=e1291]:\n        - listitem [ref=e1453]: No tickets yet."
}
```

### Tool call: browser_click
- Args
```json
{
  "target": "e1783"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/board\n- Page Title: Hearthshift\n- Console: 3 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e1080]:\n    - generic [ref=e1081]: Hearthshift\n    - navigation \"Main\" [ref=e1086]:\n      - link \"Board\" [ref=e1087] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1088] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1089]:\n      - generic [ref=e1090]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1091] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1092]:\n    - generic [ref=e1093]:\n      - generic [ref=e1094]:\n        - generic [ref=e1095]: Site\n        - combobox \"Site\" [ref=e1096]:\n          - option \"Ember Row — Halsted\" [selected]\n      - generic [ref=e1097]:\n        - button \"Previous day\" [ref=e1098] [cursor=pointer]\n        - generic [ref=e1101]:\n          - generic [ref=e1102]: Day\n          - textbox \"Day\" [ref=e1103]: 2026-10-29\n        - button \"Next day\" [ref=e1104] [cursor=pointer]\n      - generic [ref=e1107]:\n        - generic [ref=e1108]: Repeat weeks\n        - spinbutton \"Repeat weeks\" [ref=e1109]: \"1\"\n      - generic [ref=e1110]:\n        - generic [ref=e1111]: Renter\n        - combobox \"Renter\" [ref=e1112]:\n          - option \"Choose a renter\"\n          - option \"Juniper Crumb Bakery\"\n          - option \"Little Ledger Meal Prep\"\n          - option \"Nightjar Pies\"\n          - option \"Saltbox Tacos\" [selected]\n    - generic [ref=e1113]:\n      - generic [ref=e1114]:\n        - heading \"Stations\" [level=2] [ref=e1293]\n        - button \"Deck oven 1\" [ref=e1294] [cursor=pointer]:\n          - generic [ref=e1296]: $38.00/h\n        - button \"Deck oven 2\" [ref=e1297] [cursor=pointer]:\n          - generic [ref=e1299]: $38.00/h\n        - button \"Range line A\" [ref=e1300] [cursor=pointer]:\n          - generic [ref=e1302]: $32.00/h\n        - button \"Prep table 3\" [pressed] [ref=e1303] [cursor=pointer]:\n          - generic [ref=e1305]: $20.00/h\n        - button \"Walk-in shelf 4\" [ref=e1306] [cursor=pointer]:\n          - generic [ref=e1308]: $6.00/h\n      - generic [ref=e1131]:\n        - generic [ref=e1132]:\n          - group \"Station dial\" [ref=e1133]:\n            - img [aria-hidden] [ref=e1134]:\n              - generic [ref=e1786]:\n                - generic [ref=e1787]: 00:00 CDT\n                - generic [ref=e1791]: 03:00\n                - generic [ref=e1794]: 06:00\n                - generic [ref=e1798]: 09:00\n                - generic [ref=e1801]: 12:00\n                - generic [ref=e1805]: 15:00\n                - generic [ref=e1808]: 18:00\n                - generic [ref=e1812]: 21:00\n            - generic:\n              - slider \"Deck oven 1\" [ref=e1926]\n              - slider \"Deck oven 2\" [ref=e1927]\n              - slider \"Range line A\" [ref=e1928]\n              - slider \"Prep table 3\" [ref=e1929]\n              - slider \"Walk-in shelf 4\" [ref=e1930]\n            - list \"Dial segment labels\" [ref=e1746]:\n              - listitem [ref=e1931]:\n                - generic [ref=e1932]: Prep table 3\n                - generic [ref=e1933]: Booked 07:15–07:30\n                - generic [ref=e1934]: Saltbox Tacos\n          - region \"Selection summary\":\n            - generic: 0.00 h\n            - generic: $0.00\n            - generic: Pack 0.00 h\n            - generic: Card 0.00 h\n            - generic: Pack balance 0.00 h\n          - timer \"Hold time left\"\n        - list \"Dial legend\" [ref=e1279]:\n          - listitem [ref=e1280]: Free\n          - listitem [ref=e1282]: Held\n          - listitem [ref=e1284]: Booked\n          - listitem [ref=e1286]: Yours\n        - status \"Dial status\" [ref=e1288]: Held until 07:16. Finish checkout to keep it.\n      - dialog \"Checkout\" [ref=e1757]:\n        - heading \"Checkout\" [level=2] [ref=e1758]\n        - list [ref=e1759]:\n          - listitem [ref=e1760]: 2026-10-29 07:15–07:30 · 0.25 h\n        - generic [ref=e1761]:\n          - term [ref=e1762]: Pack hours\n          - definition [ref=e1763]: 0.00 h\n          - term [ref=e1764]: Card hours\n          - definition [ref=e1765]: 0.25 h\n          - term [ref=e1766]: Card total\n          - definition [ref=e1767]: $5.00\n          - term [ref=e1768]: Deposit\n          - definition [ref=e1769]: $75.00\n        - generic [ref=e1770]:\n          - checkbox \"Use pack hours\" [ref=e1771]\n          - generic [ref=e1772]: Use pack hours (0.00 h available)\n        - radiogroup \"Card payment\" [ref=e1773]:\n          - generic [ref=e1774]:\n            - radio \"Pay now\" [checked] [ref=e1775]\n            - generic [ref=e1776]: Pay now\n          - generic [ref=e1777]:\n            - radio \"Pay later\" [ref=e1778]\n            - generic [ref=e1779]: Pay later (due by 2026-10-27 07:15 CDT)\n        - paragraph [ref=e1780]: Free cancellation until 24 hours before start. Later cancellations keep the time charge and the deposit.\n        - paragraph [ref=e1781]: Held until 2026-10-29 07:16 CDT\n        - status \"Checkout status\" [ref=e1785]: Booking confirmed. Confirmation email queued.\n    - generic [ref=e1289]:\n      - heading \"Tickets\" [level=2] [ref=e1290]\n      - list \"Booking tickets\" [ref=e1291]:\n        - listitem [ref=e1935]:\n          - button \"Prep table 3 2026-10-29 07:15 CDT – 07:30 CDT 0.25 h Confirmed Paid $80.00\" [ref=e1936] [cursor=pointer]:\n            - generic [ref=e1938]: Prep table 3\n            - generic [ref=e1939]: 2026-10-29 07:15 CDT – 07:30 CDT\n            - generic [ref=e1940]: 0.25 h\n            - generic [ref=e1941]: Confirmed\n            - generic [ref=e1942]: Paid\n            - generic [ref=e1943]: $80.00"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Counter",
  "target": "a[href='/counter']"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/counter\n- Page Title: Hearthshift\n- Console: 3 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e1944]:\n    - generic [ref=e1945]: Hearthshift\n    - navigation \"Main\" [ref=e1950]:\n      - link \"Board\" [ref=e1951] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1952] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1953]:\n      - generic [ref=e1954]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1955] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1956]:\n    - generic [ref=e1957]:\n      - heading \"Counter\" [level=1] [ref=e1958]\n      - generic [ref=e1959]:\n        - generic [ref=e1960]: Site\n        - combobox \"Site\" [ref=e1961]:\n          - option \"Ember Row — Halsted\" [selected]\n      - status \"Counter status\" [ref=e1962]\n      - table \"Today's bookings\" [ref=e1964]:\n        - rowgroup [ref=e1965]:\n          - row [ref=e1966]:\n            - cell \"Renter Saltbox Tacos\" [ref=e1967]\n            - cell \"Station Prep table 3\" [ref=e1968]\n            - cell \"Time 07:15 CDT – 07:30 CDT\" [ref=e1969]\n            - cell \"Status Confirmed Paid\" [ref=e1970]:\n              - text: Status Confirmed\n              - generic [ref=e1971]: Paid\n            - cell [ref=e1972]:\n              - text: Actions\n              - button \"Check in\" [ref=e1974] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/counter\n- Page Title: Hearthshift\n- Console: 3 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e1944]:\n    - generic [ref=e1945]: Hearthshift\n    - navigation \"Main\" [ref=e1950]:\n      - link \"Board\" [ref=e1951] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1952] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1953]:\n      - generic [ref=e1954]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1955] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1956]:\n    - generic [ref=e1957]:\n      - heading \"Counter\" [level=1] [ref=e1958]\n      - generic [ref=e1959]:\n        - generic [ref=e1960]: Site\n        - combobox \"Site\" [ref=e1961]:\n          - option \"Ember Row — Halsted\" [selected]\n      - status \"Counter status\" [ref=e1962]\n      - table \"Today's bookings\" [ref=e1964]:\n        - rowgroup [ref=e1965]:\n          - row \"Renter Saltbox Tacos Station Prep table 3 Time 07:15 CDT – 07:30 CDT Status Confirmed Paid Actions Check in\" [ref=e1966]:\n            - cell \"Renter Saltbox Tacos\" [ref=e1967]\n            - cell \"Station Prep table 3\" [ref=e1968]\n            - cell \"Time 07:15 CDT – 07:30 CDT\" [ref=e1969]\n            - cell \"Status Confirmed Paid\" [ref=e1970]:\n              - text: Status Confirmed\n              - generic [ref=e1971]: Paid\n            - cell \"Actions Check in\" [ref=e1972]:\n              - text: Actions\n              - button \"Check in\" [ref=e1974] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Check in",
  "target": "e1974"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/counter\n- Page Title: Hearthshift\n- Console: 3 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e1944]:\n    - generic [ref=e1945]: Hearthshift\n    - navigation \"Main\" [ref=e1950]:\n      - link \"Board\" [ref=e1951] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1952] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1953]:\n      - generic [ref=e1954]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1955] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1956]:\n    - generic [ref=e1957]:\n      - heading \"Counter\" [level=1] [ref=e1958]\n      - generic [ref=e1959]:\n        - generic [ref=e1960]: Site\n        - combobox \"Site\" [ref=e1961]:\n          - option \"Ember Row — Halsted\" [selected]\n      - status \"Counter status\" [ref=e1962]: \"Checked in: Saltbox Tacos.\"\n      - table \"Today's bookings\" [ref=e1964]:\n        - rowgroup [ref=e1965]:\n          - row [ref=e1975]:\n            - cell \"Renter Saltbox Tacos\" [ref=e1976]\n            - cell \"Station Prep table 3\" [ref=e1977]\n            - cell \"Time 07:15 CDT – 07:30 CDT\" [ref=e1978]\n            - cell \"Status Checked in Paid\" [ref=e1979]:\n              - text: Status Checked in\n              - generic [ref=e1980]: Paid\n            - cell [ref=e1981]:\n              - text: Actions\n              - generic [ref=e1982]:\n                - button \"Charge overrun\" [ref=e1983] [cursor=pointer]\n                - button \"Check out\" [ref=e1984] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/counter\n- Page Title: Hearthshift\n- Console: 3 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e1944]:\n    - generic [ref=e1945]: Hearthshift\n    - navigation \"Main\" [ref=e1950]:\n      - link \"Board\" [ref=e1951] [cursor=pointer]:\n        - /url: /board\n      - link \"Counter\" [ref=e1952] [cursor=pointer]:\n        - /url: /counter\n    - generic [ref=e1953]:\n      - generic [ref=e1954]: Priya Lindqvist\n      - button \"Sign out\" [ref=e1955] [cursor=pointer]\n    - status \"Service status\"\n  - main [ref=e1956]:\n    - generic [ref=e1957]:\n      - heading \"Counter\" [level=1] [ref=e1958]\n      - generic [ref=e1959]:\n        - generic [ref=e1960]: Site\n        - combobox \"Site\" [ref=e1961]:\n          - option \"Ember Row — Halsted\" [selected]\n      - status \"Counter status\" [ref=e1962]: \"Checked in: Saltbox Tacos.\"\n      - table \"Today's bookings\" [ref=e1964]:\n        - rowgroup [ref=e1965]:\n          - row \"Renter Saltbox Tacos Station Prep table 3 Time 07:15 CDT – 07:30 CDT Status Checked in Paid Actions Charge overrun Check out\" [ref=e1975]:\n            - cell \"Renter Saltbox Tacos\" [ref=e1976]\n            - cell \"Station Prep table 3\" [ref=e1977]\n            - cell \"Time 07:15 CDT – 07:30 CDT\" [ref=e1978]\n            - cell \"Status Checked in Paid\" [ref=e1979]:\n              - text: Status Checked in\n              - generic [ref=e1980]: Paid\n            - cell \"Actions Charge overrun Check out\" [ref=e1981]:\n              - text: Actions\n              - generic [ref=e1982]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const bs=[...document.querySelectorAll('button')].filter(b=>['Charge overrun','Check out'].includes(b.textContent.trim()));return bs.map(b=>({text:b.textContent.trim(),box:b.getBoundingClientRect().toJSON()}))}"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"text\": \"Charge overrun\",\n    \"box\": {\n      \"x\": 34,\n      \"y\": 536.375,\n      \"width\": 142.828125,\n      \"height\": 44,\n      \"top\": 536.375,\n      \"right\": 176.828125,\n      \"bottom\": 580.375,\n      \"left\": 34\n    }\n  },\n  {\n    \"text\": \"Check out\",\n    \"box\": {\n      \"x\": 180.828125,\n      \"y\": 536.375,\n      \"width\": 105.390625,\n      \"height\": 44,\n      \"top\": 536.375,\n      \"right\": 286.21875,\n      \"bottom\": 580.375,\n      \"left\": 180.828125\n    }\n  }\n]"
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
  "result": "- [Screenshot of viewport](evidence/touch/page-2026-10-29T12-07-42-725Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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ZQAAbMH1MgAAtuB6GQAAW+DLAADYIpGRkZGbkysoluMorxHEnM+CMgAAFIvMzExBDOFXROKJhIyMtJRUha93SE/hAACg6EhLS3+zHr4MAIAt8GUAAGzB9TIAALbgehkAAFvgywAA2AJfBgDAFvgyAAC2wJcBALAFvgwAgC3wZQAAbIEvAwBgC3wZAABb4MsAANgCXwYAwBb4MgAAtsCXAQCwpTBfJjk+hgMAgP9GubSUJCkpKa7U+fjxI3ShC92/QfeX+TLQhS50/xLdX+bLQBe60P1LdH/Z9TLQhS50/xLdX3a9DHShC92/RBe+DHShC122uvBloAtd6LLVhS8DXehCl60ufBnoQhe6bHXhy0AXutBlqwtfBrrQhS5bXfgy0IUudNnqwpeBLnShy1YXvgx0oQtdtrrwZaALXeiy1YUvA13oQpetLnwZ6EIXumx14ctAF7rQZasLXwa60IUuW134MtCFLnTZ6sKXgS50octWVyIjIyM3Jzd/P0F8Euz7+Z/yl/6Y1GdlZUEXutD9G3QlZGSkpaQqcKWOuLgYdKEL3b9BF74MdKELXba6EpmZmXm5eYJiqWdc0IUudP8GXYyYoAtd6LLVxYgJutCFLltdzGRDF7rQZauLXxhAF7rQZauLXxhAF7rQZasLXwa60IUuW134MtCFLnTZ6sKXgS50octWF74MdKELXba68GWgC13ostWFLwNd6EKXrS58GehCF7psdeHLQBe60GWrC18GutCFLltd+DLQhS502erCl4EudKHLVhe+DHShC122uvBloAtd6LLVhS8DXehCl60ufBnoQhe6bHXhy0AXutBlqwtfBrrQhS5bXfgy0IUudNnqwpeBLnShy1YXvgx0oQtdtrrwZaALXeiy1YUvA13oQpetLnwZ6EIXumx14ctAF7rQZasLXwa60IUuW134MtCFLnTZ6sKXgS50octWF74MdKELXba68GWgC13ostWFLwNd6EKXrS58GehCF7psdeHLQBe60GWrC18GutCFLltd+DLQhS502epKZGRk5Obk5u8niE+CfT//U/7SH5P6rKws6EIXun+DroSMjLSUVAWu1BEXF4MudKH7N+jCl4EudKHLVhe+DHShC122urheBrrQhS5bXVwvA13oQpetLnwZ6EIXumx14ctAF7rQZasLXwa60IUuW134MtCFLnTZ6sKXgS50octWF74MdKELXba68GWgC13ostWFLwNd6EKXrS58GehCF7psdeHLQJcJ0IWuEPgy0IUudNnqwpeBLnShy1YXvgx0oQtdtrrwZaALXeiy1YUvA13oQpetLnwZ6EIXumx14ctAF7rQZasLXwa60IUuW134MtCFLnTZ6sKXgS50octWF74MdKELXba68GWgC13ostWFLwNd6EKXrS58GehCF7psdeHLQBe60GWrC18GutCFLltd+DLQhS502erCl4EudKHLVhe+DHShC122uvBloAtd6LLVhS8DXehCl60ufBnoQhe6bHXhy0AXutBlqwtfBrrQhS5bXYmMjIzcnNz8/QTxSbDv53/KX/pjUp+VlQVd6EL3b9CVkJGRlpKqwJU64uJi0IUudP8GXfgy0IUudNnqwpeBLnShy1YX18tAF7rQZauL62WgC13ostWFLwNd6EKXrS58GehCF7psdeHLQBe60GWrC18GutCFLltd+DLQhS502erCl4EudKHLVhe+DHShC122uvBloAtd6LLVhS8DXehCl60ufBnoQhe6bHXhy0AXutBlqwtfBrrQhS5bXfgy0IUudNnqwpeBLnShy1YXvgx0oQtdtrrwZaALXeiy1YUvA13oQpetLnwZ6EIXumx14ctAF7rQZasLXwa60IUuW134MtCFLnTZ6sKXgS50octWF74MdKELXba68GWgC13ostWFLwNd6EKXrS58GehCF7psdeHLQBe60GWrC18GutAtAaBbCPBloAtd6LLVhS8DXehCl60ufBnoQhe6bHXhy0AXutBlqwtfBrrQhS5bXfgy0IUudNnqSmRkZOTm5ObvJ4hPgn0//1P+0h+T+qysLOhCF7p/g66EjIy0lFQFrtQRFxeDLnSh+zfowpeBLnShy1YXvgx0oQtdtrq4Xga60IUuW11cLwNd6EKXrS58GehCF7psdeHLQBe60GWrC18GutCFLltd+DLQhS502erCl4EudKHLVhe+DHShC122uvBloAtd6LLVhS8DXehCl60ufBnoQhe6bHXhy0AXutBlqwtfBrrQhS5bXfgy0IUudNnqwpeBLnShy1YXvgx0oQtdtrrwZaALXeiy1YUvA13oQpetLnwZ6EIXumx14ctAF7rQZasLXwa60IUuW134MtCFLnTZ6sKXgS50octWF74MdKELXba68GWgC13ostWFLwNd6EKXrS58GehCF7psdeHLQBe60GWrC18GutCFLltd+DLQhS502erCl4EudKHLVhe+DHShC122uvBloAtd6LLVhS8DXehCl60ufBnoQhe6bHXhy0AXutBlqyuRkZGRm5Obv58gPgn2/fxP+Ut/TOqzsrKgC13o/g26EjIy0lJSFbhSR1xcDLrQhe7foAtfBrrQhS5bXfgy0IUudNnq4noZ6EIXumx1cb0MdKELXba68GWgC13ostWFLwNd6EKXrS58GehCF7psdf8HAAD//yQKQjIAAAAGSURBVAMAYBACKeHmxfMAAAAASUVORK5CYII=",
      "mimeType": "image/png"
    }
  ]
}
```
