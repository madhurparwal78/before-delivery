
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Kerf Frequencies 2027 — Kerf Collective",
  "snapshot": "- generic [ref=e2]:\n  - navigation \"Main\" [ref=e3]:\n    - link \"Kerf\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - link \"Programme\" [ref=e5] [cursor=pointer]:\n      - /url: /\n    - link \"Gallery\" [ref=e6] [cursor=pointer]:\n      - /url: /#gallery\n    - link \"Tickets\" [ref=e7] [cursor=pointer]:\n      - /url: /#tickets\n    - link \"My tickets\" [ref=e8] [cursor=pointer]:\n      - /url: /tickets\n    - link \"Sign in\" [ref=e9] [cursor=pointer]:\n      - /url: /signin\n  - main [ref=e10]:\n    - generic [ref=e11]:\n      - heading \"Kerf Frequencies 2027\" [level=1] [ref=e12]:\n        - generic [ref=e13]: Kerf\n        - generic [ref=e14]: Frequencies\n        - generic [ref=e15]: \"2027\"\n      - figure \"Programme lattice\" [ref=e16]\n      - group \"Lattice controls\" [ref=e18]\n    - generic [ref=e19]:\n      - region \"Schedule\" [ref=e20]:\n        - heading \"Schedule\" [level=2] [ref=e21]\n        - generic [ref=e22]:\n          - generic [ref=e23]:\n            - text: Day\n            - combobox \"Day\" [ref=e24]:\n              - option \"All days\" [selected]\n          - generic [ref=e25]:\n            - text: Venue\n            - combobox \"Venue\" [ref=e26]:\n              - option \"All venues\" [selected]\n          - generic [ref=e27]:\n            - text: Discipline\n            - combobox \"Discipline\" [ref=e28]:\n              - option \"All disciplines\" [selected]\n          - generic [ref=e29]:\n            - checkbox \"Clashes only\" [ref=e30]\n            - text: Clashes only\n          - button \"Clear filters\" [ref=e31] [cursor=pointer]\n        - status \"Programme results\" [ref=e32]: 0 sessions\n        - list \"Sessions\"\n      - button \"Open my agenda\" [ref=e33] [cursor=pointer]\n      - complementary \"My agenda\" [ref=e34]:\n        - heading \"My agenda\" [level=2] [ref=e35]\n        - status \"Agenda updates\" [ref=e36]\n        - list [ref=e37]:\n          - listitem [ref=e38]: Nothing yet.\n        - button \"Get tickets for my agenda\" [ref=e39] [cursor=pointer]\n    - region \"About the festival\" [ref=e40]:\n      - generic [ref=e41]:\n        - paragraph [ref=e42]: Four days.\n        - paragraph [aria-hidden] [ref=e43]: Five venues.\n        - paragraph [aria-hidden] [ref=e44]: One lattice.\n    - region \"Gallery\" [ref=e45]:\n      - generic [ref=e46]:\n        - heading \"Gallery\" [level=2]\n    - region \"Tickets\" [ref=e47]:\n      - heading \"Tickets\" [level=2] [ref=e48]\n      - table \"Pass prices\" [ref=e49]:\n        - rowgroup [ref=e50]:\n          - row [ref=e51]:\n            - cell \"Full-festival pass\" [ref=e52]\n            - cell \"€0.00\" [ref=e53]\n            - cell \"€0.00\" [ref=e54]\n            - cell [ref=e55]:\n              - button \"Buy full-festival pass\" [ref=e56] [cursor=pointer]\n          - row [ref=e57]:\n            - cell \"Day pass\" [ref=e58]\n            - cell \"€0.00\" [ref=e59]\n            - cell \"€0.00\" [ref=e60]\n            - cell [ref=e61]:\n              - button \"Buy day pass\" [ref=e62] [cursor=pointer]\n      - paragraph [ref=e63]: Day passes admit to one festival day at every venue except the Planetarium Dome.\n    - generic [ref=e64]:\n      - paragraph [ref=e65]: Kerf Collective · Kerf Frequencies 2027 · Brussels\n      - paragraph [ref=e66]: 0 days · 0 venues · 0 published sessions\n    - generic:\n      - status \"Checkout status\"\n      - alert \"Checkout problem\""
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "End"
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
  "key": "Home"
}
```
- Result
```json
{}
```
