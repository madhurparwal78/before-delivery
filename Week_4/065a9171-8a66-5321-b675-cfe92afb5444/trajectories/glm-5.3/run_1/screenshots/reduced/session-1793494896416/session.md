
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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "snapshot": "- form \"Sign in\" [ref=e4]:\n  - heading \"Sign in to Tallow Cover\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - generic [ref=e7]: Email\n    - textbox \"Email\" [ref=e8]\n  - generic [ref=e9]:\n    - generic [ref=e10]: Password\n    - textbox \"Password\" [ref=e11]\n  - button \"Sign in\" [ref=e12] [cursor=pointer]\n  - status \"Sign-in status\" [ref=e13]",
  "events": "- New console entries: evidence/reduced/console-2026-11-01T01-01-36-631Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- form \"Sign in\" [ref=e4]:\n  - heading \"Sign in to Tallow Cover\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - generic [ref=e7]: Email\n    - textbox \"Email\" [ref=e8]\n  - generic [ref=e9]:\n    - generic [ref=e10]: Password\n    - textbox \"Password\" [ref=e11]\n  - button \"Sign in\" [ref=e12] [cursor=pointer]\n  - status \"Sign-in status\" [ref=e13]",
  "events": "- New console entries: evidence/reduced/console-2026-11-01T01-01-36-631Z.log#L2"
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
      "value": "priya.raman@hollinsvale.example"
    },
    {
      "target": "e11",
      "name": "Password",
      "type": "textbox",
      "value": "cover-demo-2026"
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
  "target": "e12"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/shifts\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e14]:\n  - complementary \"Rail\" [ref=e15]:\n    - paragraph [ref=e16]:\n      - link \"Tallow Cover\" [ref=e17] [cursor=pointer]:\n        - /url: /shifts\n    - navigation \"Main\" [ref=e18]:\n      - link \"My shifts\" [ref=e19] [cursor=pointer]:\n        - /url: /shifts\n      - link \"Request leave\" [ref=e20] [cursor=pointer]:\n        - /url: /leave/new\n      - link \"My requests\" [ref=e21] [cursor=pointer]:\n        - /url: /leave\n      - link \"Sickness\" [ref=e22] [cursor=pointer]:\n        - /url: /sickness\n      - link \"Team rota\" [ref=e23] [cursor=pointer]:\n        - /url: /rota\n      - link \"Profile\" [ref=e24] [cursor=pointer]:\n        - /url: /profile\n    - button \"Sign out\" [ref=e25] [cursor=pointer]\n  - main [ref=e26]:\n    - generic [ref=e27]:\n      - heading \"My shifts\" [level=1] [ref=e28]\n      - status \"Clock status\" [ref=e29]\n      - button \"Clock in\" [ref=e31] [cursor=pointer]\n      - list \"Upcoming shifts\" [ref=e32]:\n        - listitem [ref=e33]:\n          - generic [ref=e34]: Sun 1 Nov 2026 Early · 07:00–15:00 · 8.00 h\n        - listitem [ref=e35]:\n          - generic [ref=e36]: Mon 2 Nov 2026 Early · 07:00–15:00 · 8.00 h\n        - listitem [ref=e37]:\n          - generic [ref=e38]: Tue 3 Nov 2026 Early · 07:00–15:00 · 8.00 h\n        - listitem [ref=e39]:\n          - generic [ref=e40]: Wed 4 Nov 2026 Early · 07:00–15:00 · 8.00 h\n        - listitem [ref=e41]:\n          - generic [ref=e42]: Thu 5 Nov 2026 Early · 07:00–15:00 · 8.00 h\n        - listitem [ref=e43]:\n          - generic [ref=e44]: Fri 6 Nov 2026 Early · 07:00–15:00 · 8.00 h\n        - listitem [ref=e45]:\n          - generic [ref=e46]: Sat 7 Nov 2026 Early · 07:00–15:00 · 8.00 h\n        - listitem [ref=e47]:\n          - generic [ref=e48]: Sun 8 Nov 2026 Early · 07:00–15:00 · 8.00 h\n        - listitem [ref=e49]:\n          - generic [ref=e50]: Mon 9 Nov 2026 Early · 07:00–15:00 · 8.00 h\n        - listitem [ref=e51]:\n          - generic [ref=e52]: Tue 10 Nov 2026 Early · 07:00–15:00 · 8.00 h\n        - listitem [ref=e53]:\n          - generic [ref=e54]: Wed 11 Nov 2026 Early · 07:00–15:00 · 8.00 h\n        - listitem [ref=e55]:\n          - generic [ref=e56]: Thu 12 Nov 2026 Early · 07:00–15:00 · 8.00 h\n        - listitem [ref=e57]:\n          - generic [ref=e58]: Fri 13 Nov 2026 Early · 07:00–15:00 · 8.00 h\n        - listitem [ref=e59]:\n          - generic [ref=e60]: Sat 14 Nov 2026 Early · 07:00–15:00 · 8.00 h\n      - region \"Holiday\" [ref=e62]:\n        - paragraph [ref=e63]: 168.00 of 168.00 hours left this leave year"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/leave/new"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/leave/new\n- Page Title: Tallow Cover",
  "snapshot": "- generic [ref=f1e3]:\n  - complementary \"Rail\" [ref=f1e4]:\n    - paragraph [ref=f1e5]:\n      - link \"Tallow Cover\" [ref=f1e6] [cursor=pointer]:\n        - /url: /shifts\n    - navigation \"Main\" [ref=f1e7]:\n      - link \"My shifts\" [ref=f1e8] [cursor=pointer]:\n        - /url: /shifts\n      - link \"Request leave\" [ref=f1e9] [cursor=pointer]:\n        - /url: /leave/new\n      - link \"My requests\" [ref=f1e10] [cursor=pointer]:\n        - /url: /leave\n      - link \"Sickness\" [ref=f1e11] [cursor=pointer]:\n        - /url: /sickness\n      - link \"Team rota\" [ref=f1e12] [cursor=pointer]:\n        - /url: /rota\n      - link \"Profile\" [ref=f1e13] [cursor=pointer]:\n        - /url: /profile\n    - button \"Sign out\" [ref=f1e14] [cursor=pointer]\n  - main [ref=f1e15]:\n    - generic [ref=f1e16]:\n      - heading \"Request leave\" [level=1] [ref=f1e17]\n      - form \"Request leave\" [ref=f1e18]:\n        - generic [ref=f1e19]:\n          - generic [ref=f1e20]: Leave type\n          - combobox \"Leave type\" [ref=f1e21]:\n            - option \"Annual leave\" [selected]\n            - option \"Unpaid leave\"\n            - option \"Compassionate leave\"\n        - generic [ref=f1e22]:\n          - generic [ref=f1e23]:\n            - generic [ref=f1e24]: First day\n            - textbox \"First day\" [ref=f1e25]\n          - generic [ref=f1e26]:\n            - generic [ref=f1e27]: Last day\n            - textbox \"Last day\" [ref=f1e28]\n        - generic [ref=f1e29]:\n          - generic [ref=f1e30]: Note\n          - textbox \"Note\" [ref=f1e31]\n        - generic [ref=f1e32]:\n          - button \"Save draft\" [ref=f1e33] [cursor=pointer]\n          - button \"Submit request\" [ref=f1e34] [cursor=pointer]\n        - status \"Leave status\" [ref=f1e35]"
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
  "page": "- Page URL: http://127.0.0.1:4173/leave/new\n- Page Title: Tallow Cover",
  "inlineSnapshot": "- generic [ref=f1e3]:\n  - complementary \"Rail\" [ref=f1e4]:\n    - paragraph [ref=f1e5]:\n      - link \"Tallow Cover\" [ref=f1e6] [cursor=pointer]:\n        - /url: /shifts\n    - navigation \"Main\" [ref=f1e7]:\n      - link \"My shifts\" [ref=f1e8] [cursor=pointer]:\n        - /url: /shifts\n      - link \"Request leave\" [ref=f1e9] [cursor=pointer]:\n        - /url: /leave/new\n      - link \"My requests\" [ref=f1e10] [cursor=pointer]:\n        - /url: /leave\n      - link \"Sickness\" [ref=f1e11] [cursor=pointer]:\n        - /url: /sickness\n      - link \"Team rota\" [ref=f1e12] [cursor=pointer]:\n        - /url: /rota\n      - link \"Profile\" [ref=f1e13] [cursor=pointer]:\n        - /url: /profile\n    - button \"Sign out\" [ref=f1e14] [cursor=pointer]\n  - main [ref=f1e15]:\n    - generic [ref=f1e16]:\n      - heading \"Request leave\" [level=1] [ref=f1e17]\n      - form \"Request leave\" [ref=f1e18]:\n        - generic [ref=f1e19]\n        - generic [ref=f1e22]\n        - generic [ref=f1e29]\n        - generic [ref=f1e32]\n        - status \"Leave status\" [ref=f1e35]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "f1e18",
  "depth": 5
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/leave/new\n- Page Title: Tallow Cover",
  "inlineSnapshot": "- form \"Request leave\" [ref=f1e18]:\n  - generic [ref=f1e19]:\n    - generic [ref=f1e20]: Leave type\n    - combobox \"Leave type\" [ref=f1e21]:\n      - option \"Annual leave\" [selected]\n      - option \"Unpaid leave\"\n      - option \"Compassionate leave\"\n  - generic [ref=f1e22]:\n    - generic [ref=f1e23]:\n      - generic [ref=f1e24]: First day\n      - textbox \"First day\" [ref=f1e25]\n    - generic [ref=f1e26]:\n      - generic [ref=f1e27]: Last day\n      - textbox \"Last day\" [ref=f1e28]\n  - generic [ref=f1e29]:\n    - generic [ref=f1e30]: Note\n    - textbox \"Note\" [ref=f1e31]\n  - generic [ref=f1e32]:\n    - button \"Save draft\" [ref=f1e33] [cursor=pointer]\n    - button \"Submit request\" [ref=f1e34] [cursor=pointer]\n  - status \"Leave status\" [ref=f1e35]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e21",
      "name": "Leave type",
      "type": "combobox",
      "value": "Unpaid leave"
    },
    {
      "target": "f1e25",
      "name": "First day",
      "type": "textbox",
      "value": "2026-12-26"
    },
    {
      "target": "f1e28",
      "name": "Last day",
      "type": "textbox",
      "value": "2026-12-26"
    },
    {
      "target": "f1e31",
      "name": "Note",
      "type": "textbox",
      "value": "qa-b9-red-7e1"
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
  "element": "Submit request",
  "target": "f1e34"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/leave/new\n- Page Title: Tallow Cover",
  "snapshot": "- generic [ref=f1e3]:\n  - complementary \"Rail\" [ref=f1e4]:\n    - paragraph [ref=f1e5]:\n      - link \"Tallow Cover\" [ref=f1e6] [cursor=pointer]:\n        - /url: /shifts\n    - navigation \"Main\" [ref=f1e7]:\n      - link \"My shifts\" [ref=f1e8] [cursor=pointer]:\n        - /url: /shifts\n      - link \"Request leave\" [ref=f1e9] [cursor=pointer]:\n        - /url: /leave/new\n      - link \"My requests\" [ref=f1e10] [cursor=pointer]:\n        - /url: /leave\n      - link \"Sickness\" [ref=f1e11] [cursor=pointer]:\n        - /url: /sickness\n      - link \"Team rota\" [ref=f1e12] [cursor=pointer]:\n        - /url: /rota\n      - link \"Profile\" [ref=f1e13] [cursor=pointer]:\n        - /url: /profile\n    - button \"Sign out\" [ref=f1e14] [cursor=pointer]\n  - main [ref=f1e15]:\n    - generic [ref=f1e16]:\n      - heading \"Request leave\" [level=1] [ref=f1e17]\n      - form \"Request leave\" [ref=f1e18]:\n        - generic [ref=f1e19]:\n          - generic [ref=f1e20]: Leave type\n          - combobox \"Leave type\" [ref=f1e21]:\n            - option \"Annual leave\"\n            - option \"Unpaid leave\" [selected]\n            - option \"Compassionate leave\"\n        - generic [ref=f1e22]:\n          - generic [ref=f1e23]:\n            - generic [ref=f1e24]: First day\n            - textbox \"First day\" [ref=f1e25]: 2026-12-26\n          - generic [ref=f1e26]:\n            - generic [ref=f1e27]: Last day\n            - textbox \"Last day\" [ref=f1e28]: 2026-12-26\n        - generic [ref=f1e29]:\n          - generic [ref=f1e30]: Note\n          - textbox \"Note\" [ref=f1e31]\n        - generic [ref=f1e32]:\n          - button \"Save draft\" [ref=f1e33] [cursor=pointer]\n          - button \"Submit request\" [ref=f1e34] [cursor=pointer]\n        - status \"Leave status\" [ref=f1e35]: Request sent to Larchfield House."
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "f1e18",
  "depth": 4
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/leave/new\n- Page Title: Tallow Cover",
  "inlineSnapshot": "- form \"Request leave\" [ref=f1e18]:\n  - generic [ref=f1e19]:\n    - generic [ref=f1e20]: Leave type\n    - combobox \"Leave type\" [ref=f1e21]:\n      - option \"Annual leave\"\n      - option \"Unpaid leave\" [selected]\n      - option \"Compassionate leave\"\n  - generic [ref=f1e22]:\n    - generic [ref=f1e23]:\n      - generic [ref=f1e24]: First day\n      - textbox \"First day\" [ref=f1e25]: 2026-12-26\n    - generic [ref=f1e26]:\n      - generic [ref=f1e27]: Last day\n      - textbox \"Last day\" [ref=f1e28]: 2026-12-26\n  - generic [ref=f1e29]:\n    - generic [ref=f1e30]: Note\n    - textbox \"Note\" [ref=f1e31]\n  - generic [ref=f1e32]:\n    - button \"Save draft\" [ref=f1e33] [cursor=pointer]\n    - button \"Submit request\" [ref=f1e34] [cursor=pointer]\n  - status \"Leave status\" [ref=f1e35]: Request sent to Larchfield House."
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
  "page": "- Page URL: http://127.0.0.1:4173/leave/new\n- Page Title: Tallow Cover",
  "inlineSnapshot": "- generic [ref=f1e3]:\n  - complementary \"Rail\" [ref=f1e4]:\n    - paragraph [ref=f1e5]:\n      - link \"Tallow Cover\" [ref=f1e6] [cursor=pointer]:\n        - /url: /shifts\n    - navigation \"Main\" [ref=f1e7]:\n      - link \"My shifts\" [ref=f1e8] [cursor=pointer]:\n        - /url: /shifts\n      - link \"Request leave\" [ref=f1e9] [cursor=pointer]:\n        - /url: /leave/new\n      - link \"My requests\" [ref=f1e10] [cursor=pointer]:\n        - /url: /leave\n      - link \"Sickness\" [ref=f1e11] [cursor=pointer]:\n        - /url: /sickness\n      - link \"Team rota\" [ref=f1e12] [cursor=pointer]:\n        - /url: /rota\n      - link \"Profile\" [ref=f1e13] [cursor=pointer]:\n        - /url: /profile\n    - button \"Sign out\" [ref=f1e14] [cursor=pointer]\n  - main [ref=f1e15]:\n    - generic [ref=f1e16]:\n      - heading \"Request leave\" [level=1] [ref=f1e17]\n      - form \"Request leave\" [ref=f1e18]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Sign out",
  "target": "f1e14"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "snapshot": "- form \"Sign in\" [ref=f1e37]:\n  - heading \"Sign in to Tallow Cover\" [level=1] [ref=f1e38]\n  - generic [ref=f1e39]:\n    - generic [ref=f1e40]: Email\n    - textbox \"Email\" [ref=f1e41]\n  - generic [ref=f1e42]:\n    - generic [ref=f1e43]: Password\n    - textbox \"Password\" [ref=f1e44]\n  - button \"Sign in\" [ref=f1e45] [cursor=pointer]\n  - status \"Sign-in status\" [ref=f1e46]",
  "events": "- New console entries: evidence/reduced/console-2026-11-01T01-01-48-814Z.log#L1-L2"
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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- form \"Sign in\" [ref=f1e37]:\n  - heading \"Sign in to Tallow Cover\" [level=1] [ref=f1e38]\n  - generic [ref=f1e39]:\n    - generic [ref=f1e40]: Email\n    - textbox \"Email\" [ref=f1e41]\n  - generic [ref=f1e42]:\n    - generic [ref=f1e43]: Password\n    - textbox \"Password\" [ref=f1e44]\n  - button \"Sign in\" [ref=f1e45] [cursor=pointer]\n  - status \"Sign-in status\" [ref=f1e46]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e41",
      "name": "Email",
      "type": "textbox",
      "value": "fenella.marsh@hollinsvale.example"
    },
    {
      "target": "f1e44",
      "name": "Password",
      "type": "textbox",
      "value": "cover-demo-2026"
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
  "target": "f1e45"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/leave/new\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e47]:\n  - complementary \"Rail\" [ref=f1e48]:\n    - paragraph [ref=f1e49]:\n      - link \"Tallow Cover\" [ref=f1e50] [cursor=pointer]:\n        - /url: /leave/new\n    - navigation \"Main\" [ref=f1e51]:\n      - link \"Request leave\" [ref=f1e52] [cursor=pointer]:\n        - /url: /leave/new\n      - link \"My requests\" [ref=f1e53] [cursor=pointer]:\n        - /url: /leave\n      - link \"Team rota\" [ref=f1e54] [cursor=pointer]:\n        - /url: /rota\n      - link \"Queue\" [ref=f1e55] [cursor=pointer]:\n        - /url: /queue\n      - link \"Today\" [ref=f1e56] [cursor=pointer]:\n        - /url: /today\n      - link \"Floors and policy\" [ref=f1e57] [cursor=pointer]:\n        - /url: /floors\n      - link \"Attendance\" [ref=f1e58] [cursor=pointer]:\n        - /url: /attendance\n      - link \"Audit log\" [ref=f1e59] [cursor=pointer]:\n        - /url: /audit\n      - link \"Profile\" [ref=f1e60] [cursor=pointer]:\n        - /url: /profile\n    - navigation \"Homes and units\" [ref=f1e61]:\n      - heading \"Homes and units\" [level=3] [ref=f1e62]\n      - generic [ref=f1e63]:\n        - link \"Larchfield House\" [ref=f1e64] [cursor=pointer]:\n          - /url: /rota?home=larchfield\n        - link \"Rowan\" [ref=f1e65] [cursor=pointer]:\n          - /url: /rota?unit=larchfield-rowan\n        - link \"Willow\" [ref=f1e66] [cursor=pointer]:\n          - /url: /rota?unit=larchfield-willow\n    - button \"Sign out\" [ref=f1e67] [cursor=pointer]\n  - main [ref=f1e68]:\n    - generic [ref=f1e69]:\n      - heading \"Request leave\" [level=1] [ref=f1e70]\n      - form \"Request leave\" [ref=f1e71]:\n        - generic [ref=f1e72]:\n          - generic [ref=f1e73]: Leave type\n          - combobox \"Leave type\" [ref=f1e74]:\n            - option \"Annual leave\" [selected]\n            - option \"Unpaid leave\"\n            - option \"Compassionate leave\"\n        - generic [ref=f1e75]:\n          - generic [ref=f1e76]:\n            - generic [ref=f1e77]: First day\n            - textbox \"First day\" [ref=f1e78]\n          - generic [ref=f1e79]:\n            - generic [ref=f1e80]: Last day\n            - textbox \"Last day\" [ref=f1e81]\n        - generic [ref=f1e82]:\n          - generic [ref=f1e83]: Note\n          - textbox \"Note\" [ref=f1e84]\n        - generic [ref=f1e85]:\n          - button \"Save draft\" [ref=f1e86] [cursor=pointer]\n          - button \"Submit request\" [ref=f1e87] [cursor=pointer]\n        - status \"Leave status\" [ref=f1e88]"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/queue"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/queue\n- Page Title: Tallow Cover",
  "snapshot": "- generic [ref=f2e3]:\n  - complementary \"Rail\" [ref=f2e4]:\n    - paragraph [ref=f2e5]:\n      - link \"Tallow Cover\" [ref=f2e6] [cursor=pointer]:\n        - /url: /leave/new\n    - navigation \"Main\" [ref=f2e7]:\n      - link \"Request leave\" [ref=f2e8] [cursor=pointer]:\n        - /url: /leave/new\n      - link \"My requests\" [ref=f2e9] [cursor=pointer]:\n        - /url: /leave\n      - link \"Team rota\" [ref=f2e10] [cursor=pointer]:\n        - /url: /rota\n      - link \"Queue\" [ref=f2e11] [cursor=pointer]:\n        - /url: /queue\n      - link \"Today\" [ref=f2e12] [cursor=pointer]:\n        - /url: /today\n      - link \"Floors and policy\" [ref=f2e13] [cursor=pointer]:\n        - /url: /floors\n      - link \"Attendance\" [ref=f2e14] [cursor=pointer]:\n        - /url: /attendance\n      - link \"Audit log\" [ref=f2e15] [cursor=pointer]:\n        - /url: /audit\n      - link \"Profile\" [ref=f2e16] [cursor=pointer]:\n        - /url: /profile\n    - navigation \"Homes and units\" [ref=f2e17]:\n      - heading \"Homes and units\" [level=3] [ref=f2e18]\n      - generic [ref=f2e19]:\n        - link \"Larchfield House\" [ref=f2e20] [cursor=pointer]:\n          - /url: /rota?home=larchfield\n        - link \"Rowan\" [ref=f2e21] [cursor=pointer]:\n          - /url: /rota?unit=larchfield-rowan\n        - link \"Willow\" [ref=f2e22] [cursor=pointer]:\n          - /url: /rota?unit=larchfield-willow\n    - button \"Sign out\" [ref=f2e23] [cursor=pointer]\n  - main [ref=f2e24]:\n    - generic [ref=f2e25]:\n      - heading \"Queue\" [level=1] [ref=f2e26]\n      - status \"Queue status\" [ref=f2e27]\n      - status \"Strip announcements\" [ref=f2e28]\n      - group \"Queue filters\" [ref=f2e30]:\n        - generic [ref=f2e31]:\n          - generic [ref=f2e32]:\n            - generic [ref=f2e33]: Home\n            - combobox \"Home\" [ref=f2e34]:\n              - option \"Larchfield House\" [selected]\n              - option \"Brackenmoor Lodge\"\n          - generic [ref=f2e35]:\n            - generic [ref=f2e36]: Status\n            - combobox \"Status\" [ref=f2e37]:\n              - option \"Open\" [selected]\n              - option \"Submitted\"\n              - option \"Escalated\"\n              - option \"Cover pending\"\n              - option \"Approved\"\n              - option \"Declined\"\n              - option \"Withdrawn\"\n              - option \"Cancelled\"\n          - generic [ref=f2e38]:\n            - generic [ref=f2e39]: Week\n            - combobox \"Week\" [ref=f2e40]:\n              - option \"All weeks\" [selected]\n              - option \"Week of 12 Oct\"\n              - option \"Week of 19 Oct\"\n              - option \"Week of 26 Oct\"\n              - option \"Week of 2 Nov\"\n              - option \"Week of 9 Nov\"\n              - option \"Week of 16 Nov\"\n              - option \"Week of 23 Nov\"\n              - option \"Week of 30 Nov\"\n              - option \"Week of 7 Dec\"\n              - option \"Week of 14 Dec\"\n              - option \"Week of 21 Dec\"\n      - region \"Queue counts\"\n      - generic [ref=f2e41]:\n        - listbox \"Requests\" [ref=f2e43]\n        - region \"Request detail\""
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
  "page": "- Page URL: http://127.0.0.1:4173/queue?home=larchfield&status=open&week=&request=cKTD6Ac_7zpMgvmw\n- Page Title: Tallow Cover",
  "inlineSnapshot": "- generic [ref=f2e3]:\n  - complementary \"Rail\" [ref=f2e4]:\n    - paragraph [ref=f2e5]:\n      - link \"Tallow Cover\" [ref=f2e6] [cursor=pointer]:\n        - /url: /leave/new\n    - navigation \"Main\" [ref=f2e7]:\n      - link \"Request leave\" [ref=f2e8] [cursor=pointer]:\n        - /url: /leave/new\n      - link \"My requests\" [ref=f2e9] [cursor=pointer]:\n        - /url: /leave\n      - link \"Team rota\" [ref=f2e10] [cursor=pointer]:\n        - /url: /rota\n      - link \"Queue\" [ref=f2e11] [cursor=pointer]:\n        - /url: /queue\n      - link \"Today\" [ref=f2e12] [cursor=pointer]:\n        - /url: /today\n      - link \"Floors and policy\" [ref=f2e13] [cursor=pointer]:\n        - /url: /floors\n      - link \"Attendance\" [ref=f2e14] [cursor=pointer]:\n        - /url: /attendance\n      - link \"Audit log\" [ref=f2e15] [cursor=pointer]:\n        - /url: /audit\n      - link \"Profile\" [ref=f2e16] [cursor=pointer]:\n        - /url: /profile\n    - navigation \"Homes and units\" [ref=f2e17]:\n      - heading \"Homes and units\" [level=3] [ref=f2e18]\n      - generic [ref=f2e19]:\n        - link \"Larchfield House\" [ref=f2e20] [cursor=pointer]:\n          - /url: /rota?home=larchfield\n        - link \"Rowan\" [ref=f2e21] [cursor=pointer]:\n          - /url: /rota?unit=larchfield-rowan\n        - link \"Willow\" [ref=f2e22] [cursor=pointer]:\n          - /url: /rota?unit=larchfield-willow\n    - button \"Sign out\" [ref=f2e23] [cursor=pointer]\n  - main [ref=f2e24]:\n    - generic [ref=f2e25]:\n      - heading \"Queue\" [level=1] [ref=f2e26]\n      - status \"Queue status\" [ref=f2e27]\n      - status \"Strip announcements\" [ref=f2e28]\n      - group \"Queue filters\" [ref=f2e30]:\n        - generic [ref=f2e31]:\n          - generic [ref=f2e32]\n          - generic [ref=f2e35]\n          - generic [ref=f2e38]\n      - region \"Queue counts\" [ref=f2e44]: Submitted 10 · Escalated 0 · Cover pending 2 · Approved 0 · Declined 0\n      - generic [ref=f2e41]:\n        - listbox \"Requests\" [ref=f2e43]:\n          - option \"Priya Raman, Unpaid leave, Sat 26 Dec 2026 to Sat 26 Dec 2026, Submitted\" [selected] [ref=f2e45]\n          - option \"Priya Raman, Unpaid leave, Sat 19 Dec 2026 to Sat 19 Dec 2026, Cover pending\" [ref=f2e46]\n          - option \"Priya Raman, Unpaid leave, Fri 18 Dec 2026 to Fri 18 Dec 2026, Submitted\" [ref=f2e47]\n          - option \"Priya Raman, Unpaid leave, Thu 17 Dec 2026 to Thu 17 Dec 2026, Submitted\" [ref=f2e48]\n          - option \"Priya Raman, Unpaid leave, Wed 16 Dec 2026 to Wed 16 Dec 2026, Submitted\" [ref=f2e49]\n          - option \"Priya Raman, Unpaid leave, Tue 5 Jan 2027 to Tue 5 Jan 2027, Submitted\" [ref=f2e50]\n          - option \"Priya Raman, Unpaid leave, Wed 30 Dec 2026 to Wed 30 Dec 2026, Submitted\" [ref=f2e51]\n          - option \"Priya Raman, Unpaid leave, Thu 24 Dec 2026 to Thu 24 Dec 2026, Submitted\" [ref=f2e52]\n          - option \"Priya Raman, Unpaid leave, Wed 23 Dec 2026 to Wed 23 Dec 2026, Cover pending\" [ref=f2e53]\n          - option \"Priya Raman, Unpaid leave, Tue 22 Dec 2026 to Tue 22 Dec 2026, Submitted\" [ref=f2e54]\n          - option \"Priya Raman, Unpaid leave, Mon 21 Dec 2026 to Mon 21 Dec 2026, Submitted\" [ref=f2e55]\n          - option \"Priya Raman, Unpaid leave, Sun 20 Dec 2026 to Sun 20 Dec 2026, Submitted\" [ref=f2e56]\n        - region \"Request detail\" [ref=f2e57]:\n          - heading \"Priya Raman\" [level=2] [ref=f2e58]\n          - paragraph [ref=f2e59]: Unpaid leave, Sat 26 Dec 2026 to Sat 26 Dec 2026\n          - paragraph [ref=f2e60]: 8.00 hours\n          - text: \"null\"\n          - paragraph [ref=f2e61]: \"Note: qa-b9-red-7e1\"\n          - paragraph [ref=f2e62]: Submitted\n          - button \"Preview approval\" [ref=f2e63] [cursor=pointer]\n          - group \"Staffing strip\" [ref=f2e66]\n          - button \"Cover\" [ref=f2e151]\n          - generic [ref=f2e152]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Preview approval",
  "target": "f2e63"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/queue?home=larchfield&status=open&week=&request=cKTD6Ac_7zpMgvmw\n- Page Title: Tallow Cover",
  "snapshot": "- generic [ref=f2e3]:\n  - complementary \"Rail\" [ref=f2e4]:\n    - paragraph [ref=f2e5]:\n      - link \"Tallow Cover\" [ref=f2e6] [cursor=pointer]:\n        - /url: /leave/new\n    - navigation \"Main\" [ref=f2e7]:\n      - link \"Request leave\" [ref=f2e8] [cursor=pointer]:\n        - /url: /leave/new\n      - link \"My requests\" [ref=f2e9] [cursor=pointer]:\n        - /url: /leave\n      - link \"Team rota\" [ref=f2e10] [cursor=pointer]:\n        - /url: /rota\n      - link \"Queue\" [ref=f2e11] [cursor=pointer]:\n        - /url: /queue\n      - link \"Today\" [ref=f2e12] [cursor=pointer]:\n        - /url: /today\n      - link \"Floors and policy\" [ref=f2e13] [cursor=pointer]:\n        - /url: /floors\n      - link \"Attendance\" [ref=f2e14] [cursor=pointer]:\n        - /url: /attendance\n      - link \"Audit log\" [ref=f2e15] [cursor=pointer]:\n        - /url: /audit\n      - link \"Profile\" [ref=f2e16] [cursor=pointer]:\n        - /url: /profile\n    - navigation \"Homes and units\" [ref=f2e17]:\n      - heading \"Homes and units\" [level=3] [ref=f2e18]\n      - generic [ref=f2e19]:\n        - link \"Larchfield House\" [ref=f2e20] [cursor=pointer]:\n          - /url: /rota?home=larchfield\n        - link \"Rowan\" [ref=f2e21] [cursor=pointer]:\n          - /url: /rota?unit=larchfield-rowan\n        - link \"Willow\" [ref=f2e22] [cursor=pointer]:\n          - /url: /rota?unit=larchfield-willow\n    - button \"Sign out\" [ref=f2e23] [cursor=pointer]\n  - main [ref=f2e24]:\n    - generic [ref=f2e25]:\n      - heading \"Queue\" [level=1] [ref=f2e26]\n      - status \"Queue status\" [ref=f2e27]\n      - status \"Strip announcements\" [ref=f2e28]: \"Approving would leave 1 shift below floor: Sat Early\"\n      - group \"Queue filters\" [ref=f2e30]:\n        - generic [ref=f2e31]:\n          - generic [ref=f2e32]:\n            - generic [ref=f2e33]: Home\n            - combobox \"Home\" [ref=f2e34]:\n              - option \"Larchfield House\" [selected]\n              - option \"Brackenmoor Lodge\"\n          - generic [ref=f2e35]:\n            - generic [ref=f2e36]: Status\n            - combobox \"Status\" [ref=f2e37]:\n              - option \"Open\" [selected]\n              - option \"Submitted\"\n              - option \"Escalated\"\n              - option \"Cover pending\"\n              - option \"Approved\"\n              - option \"Declined\"\n              - option \"Withdrawn\"\n              - option \"Cancelled\"\n          - generic [ref=f2e38]:\n            - generic [ref=f2e39]: Week\n            - combobox \"Week\" [ref=f2e40]:\n              - option \"All weeks\" [selected]\n              - option \"Week of 12 Oct\"\n              - option \"Week of 19 Oct\"\n              - option \"Week of 26 Oct\"\n              - option \"Week of 2 Nov\"\n              - option \"Week of 9 Nov\"\n              - option \"Week of 16 Nov\"\n              - option \"Week of 23 Nov\"\n              - option \"Week of 30 Nov\"\n              - option \"Week of 7 Dec\"\n              - option \"Week of 14 Dec\"\n              - option \"Week of 21 Dec\"\n      - region \"Queue counts\" [ref=f2e44]: Submitted 10 · Escalated 0 · Cover pending 2 · Approved 0 · Declined 0\n      - generic [ref=f2e41]:\n        - listbox \"Requests\" [ref=f2e43]:\n          - option \"Priya Raman, Unpaid leave, Sat 26 Dec 2026 to Sat 26 Dec 2026, Submitted\" [selected] [ref=f2e45]\n          - option \"Priya Raman, Unpaid leave, Sat 19 Dec 2026 to Sat 19 Dec 2026, Cover pending\" [ref=f2e46]\n          - option \"Priya Raman, Unpaid leave, Fri 18 Dec 2026 to Fri 18 Dec 2026, Submitted\" [ref=f2e47]\n          - option \"Priya Raman, Unpaid leave, Thu 17 Dec 2026 to Thu 17 Dec 2026, Submitted\" [ref=f2e48]\n          - option \"Priya Raman, Unpaid leave, Wed 16 Dec 2026 to Wed 16 Dec 2026, Submitted\" [ref=f2e49]\n          - option \"Priya Raman, Unpaid leave, Tue 5 Jan 2027 to Tue 5 Jan 2027, Submitted\" [ref=f2e50]\n          - option \"Priya Raman, Unpaid leave, Wed 30 Dec 2026 to Wed 30 Dec 2026, Submitted\" [ref=f2e51]\n          - option \"Priya Raman, Unpaid leave, Thu 24 Dec 2026 to Thu 24 Dec 2026, Submitted\" [ref=f2e52]\n          - option \"Priya Raman, Unpaid leave, Wed 23 Dec 2026 to Wed 23 Dec 2026, Cover pending\" [ref=f2e53]\n          - option \"Priya Raman, Unpaid leave, Tue 22 Dec 2026 to Tue 22 Dec 2026, Submitted\" [ref=f2e54]\n          - option \"Priya Raman, Unpaid leave, Mon 21 Dec 2026 to Mon 21 Dec 2026, Submitted\" [ref=f2e55]\n          - option \"Priya Raman, Unpaid leave, Sun 20 Dec 2026 to Sun 20 Dec 2026, Submitted\" [ref=f2e56]\n        - region \"Request detail\" [ref=f2e57]:\n          - heading \"Priya Raman\" [level=2] [ref=f2e58]\n          - paragraph [ref=f2e59]: Unpaid leave, Sat 26 Dec 2026 to Sat 26 Dec 2026\n          - paragraph [ref=f2e60]: 8.00 hours\n          - text: \"null\"\n          - paragraph [ref=f2e61]: \"Note: qa-b9-red-7e1\"\n          - paragraph [ref=f2e62]: Submitted\n          - button \"Preview approval\" [active] [pressed] [ref=f2e63] [cursor=pointer]\n          - group \"Staffing strip\" [ref=f2e159]:\n            - 'group \"Sat 26 Dec 2026 Early: 3 on duty, floor 4, -1 below floor, no senior on shift\" [ref=f2e160]':\n              - generic [ref=f2e162]: 4 → 3\n              - generic [ref=f2e163]: Sat Early\n              - generic [ref=f2e164]: \"-1 below floor, no senior on shift\"\n              - button \"Post cover for Sat 26 Dec 2026 Early (Senior)\" [ref=f2e165] [cursor=pointer]\n            - 'group \"Sat 26 Dec 2026 Late: 4 on duty, floor 4\" [ref=f2e166]':\n              - generic [ref=f2e168]: \"4\"\n              - generic [ref=f2e169]: Sat Late\n            - 'group \"Sat 26 Dec 2026 Night: 3 on duty, floor 3\" [ref=f2e170]':\n              - generic [ref=f2e172]: \"3\"\n              - generic [ref=f2e173]: Sat Night\n            - 'group \"Sun 27 Dec 2026 Early: 4 on duty, floor 4\" [ref=f2e174]':\n              - generic [ref=f2e176]: \"4\"\n              - generic [ref=f2e177]: Sun Early\n            - 'group \"Sun 27 Dec 2026 Late: 4 on duty, floor 4\" [ref=f2e178]':\n              - generic [ref=f2e180]: \"4\"\n              - generic [ref=f2e181]: Sun Late\n            - 'group \"Sun 27 Dec 2026 Night: 3 on duty, floor 3\" [ref=f2e182]':\n              - generic [ref=f2e184]: \"3\"\n              - generic [ref=f2e185]: Sun Night\n            - 'group \"Mon 28 Dec 2026 Early: 4 on duty, floor 4\" [ref=f2e186]':\n              - generic [ref=f2e188]: \"4\"\n              - generic [ref=f2e189]: Mon Early\n            - 'group \"Mon 28 Dec 2026 Late: 4 on duty, floor 4\" [ref=f2e190]':\n              - generic [ref=f2e192]: \"4\"\n              - generic [ref=f2e193]: Mon Late\n            - 'group \"Mon 28 Dec 2026 Night: 3 on duty, floor 3\" [ref=f2e194]':\n              - generic [ref=f2e196]: \"3\"\n              - generic [ref=f2e197]: Mon Night\n            - 'group \"Tue 29 Dec 2026 Early: 4 on duty, floor 4\" [ref=f2e198]':\n              - generic [ref=f2e200]: \"4\"\n              - generic [ref=f2e201]: Tue Early\n            - 'group \"Tue 29 Dec 2026 Late: 4 on duty, floor 4\" [ref=f2e202]':\n              - generic [ref=f2e204]: \"4\"\n              - generic [ref=f2e205]: Tue Late\n            - 'group \"Tue 29 Dec 2026 Night: 3 on duty, floor 3\" [ref=f2e206]':\n              - generic [ref=f2e208]: \"3\"\n              - generic [ref=f2e209]: Tue Night\n            - 'group \"Wed 30 Dec 2026 Early: 4 on duty, floor 4\" [ref=f2e210]':\n              - generic [ref=f2e212]: \"4\"\n              - generic [ref=f2e213]: Wed Early\n            - 'group \"Wed 30 Dec 2026 Late: 4 on duty, floor 4\" [ref=f2e214]':\n              - generic [ref=f2e216]: \"4\"\n              - generic [ref=f2e217]: Wed Late\n            - 'group \"Wed 30 Dec 2026 Night: 3 on duty, floor 3\" [ref=f2e218]':\n              - generic [ref=f2e220]: \"3\"\n              - generic [ref=f2e221]: Wed Night\n            - 'group \"Thu 31 Dec 2026 Early: 4 on duty, floor 4\" [ref=f2e222]':\n              - generic [ref=f2e224]: \"4\"\n              - generic [ref=f2e225]: Thu Early\n            - 'group \"Thu 31 Dec 2026 Late: 4 on duty, floor 4\" [ref=f2e226]':\n              - generic [ref=f2e228]: \"4\"\n              - generic [ref=f2e229]: Thu Late\n            - 'group \"Thu 31 Dec 2026 Night: 3 on duty, floor 3\" [ref=f2e230]':\n              - generic [ref=f2e232]: \"3\"\n              - generic [ref=f2e233]: Thu Night\n            - 'group \"Fri 1 Jan 2027 Early: 4 on duty, floor 4\" [ref=f2e234]':\n              - generic [ref=f2e236]: \"4\"\n              - generic [ref=f2e237]: Fri Early\n            - 'group \"Fri 1 Jan 2027 Late: 4 on duty, floor 4\" [ref=f2e238]':\n              - generic [ref=f2e240]: \"4\"\n              - generic [ref=f2e241]: Fri Late\n            - 'group \"Fri 1 Jan 2027 Night: 3 on duty, floor 3\" [ref=f2e242]':\n              - generic [ref=f2e244]: \"3\"\n              - generic [ref=f2e245]: Fri Night\n          - button \"Cover\" [ref=f2e151]\n          - generic [ref=f2e152]:\n            - button \"Previous 7 days\" [ref=f2e153] [cursor=pointer]\n            - button \"Next 7 days\" [ref=f2e154] [cursor=pointer]\n            - button \"Approve\" [disabled] [ref=f2e155]\n            - button \"Approve with override\" [ref=f2e156] [cursor=pointer]\n            - button \"Decline\" [ref=f2e157] [cursor=pointer]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "f2e57",
  "depth": 4
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/queue?home=larchfield&status=open&week=&request=cKTD6Ac_7zpMgvmw\n- Page Title: Tallow Cover",
  "inlineSnapshot": "- region \"Request detail\" [ref=f2e57]:\n  - heading \"Priya Raman\" [level=2] [ref=f2e58]\n  - paragraph [ref=f2e59]: Unpaid leave, Sat 26 Dec 2026 to Sat 26 Dec 2026\n  - paragraph [ref=f2e60]: 8.00 hours\n  - text: \"null\"\n  - paragraph [ref=f2e61]: \"Note: qa-b9-red-7e1\"\n  - paragraph [ref=f2e62]: Submitted\n  - button \"Preview approval\" [active] [pressed] [ref=f2e63] [cursor=pointer]\n  - group \"Staffing strip\" [ref=f2e159]:\n    - 'group \"Sat 26 Dec 2026 Early: 3 on duty, floor 4, -1 below floor, no senior on shift\" [ref=f2e160]':\n      - generic [ref=f2e162]: 4 → 3\n      - generic [ref=f2e163]: Sat Early\n      - generic [ref=f2e164]: \"-1 below floor, no senior on shift\"\n      - button \"Post cover for Sat 26 Dec 2026 Early (Senior)\" [ref=f2e165] [cursor=pointer]\n    - 'group \"Sat 26 Dec 2026 Late: 4 on duty, floor 4\" [ref=f2e166]':\n      - generic [ref=f2e168]: \"4\"\n      - generic [ref=f2e169]: Sat Late\n    - 'group \"Sat 26 Dec 2026 Night: 3 on duty, floor 3\" [ref=f2e170]':\n      - generic [ref=f2e172]: \"3\"\n      - generic [ref=f2e173]: Sat Night\n    - 'group \"Sun 27 Dec 2026 Early: 4 on duty, floor 4\" [ref=f2e174]':\n      - generic [ref=f2e176]: \"4\"\n      - generic [ref=f2e177]: Sun Early\n    - 'group \"Sun 27 Dec 2026 Late: 4 on duty, floor 4\" [ref=f2e178]':\n      - generic [ref=f2e180]: \"4\"\n      - generic [ref=f2e181]: Sun Late\n    - 'group \"Sun 27 Dec 2026 Night: 3 on duty, floor 3\" [ref=f2e182]':\n      - generic [ref=f2e184]: \"3\"\n      - generic [ref=f2e185]: Sun Night\n    - 'group \"Mon 28 Dec 2026 Early: 4 on duty, floor 4\" [ref=f2e186]':\n      - generic [ref=f2e188]: \"4\"\n      - generic [ref=f2e189]: Mon Early\n    - 'group \"Mon 28 Dec 2026 Late: 4 on duty, floor 4\" [ref=f2e190]':\n      - generic [ref=f2e192]: \"4\"\n      - generic [ref=f2e193]: Mon Late\n    - 'group \"Mon 28 Dec 2026 Night: 3 on duty, floor 3\" [ref=f2e194]':\n      - generic [ref=f2e196]: \"3\"\n      - generic [ref=f2e197]: Mon Night\n    - 'group \"Tue 29 Dec 2026 Early: 4 on duty, floor 4\" [ref=f2e198]':\n      - generic [ref=f2e200]: \"4\"\n      - generic [ref=f2e201]: Tue Early\n    - 'group \"Tue 29 Dec 2026 Late: 4 on duty, floor 4\" [ref=f2e202]':\n      - generic [ref=f2e204]: \"4\"\n      - generic [ref=f2e205]: Tue Late\n    - 'group \"Tue 29 Dec 2026 Night: 3 on duty, floor 3\" [ref=f2e206]':\n      - generic [ref=f2e208]: \"3\"\n      - generic [ref=f2e209]: Tue Night\n    - 'group \"Wed 30 Dec 2026 Early: 4 on duty, floor 4\" [ref=f2e210]':\n      - generic [ref=f2e212]: \"4\"\n      - generic [ref=f2e213]: Wed Early\n    - 'group \"Wed 30 Dec 2026 Late: 4 on duty, floor 4\" [ref=f2e214]':\n      - generic [ref=f2e216]: \"4\"\n      - generic [ref=f2e217]: Wed Late\n    - 'group \"Wed 30 Dec 2026 Night: 3 on duty, floor 3\" [ref=f2e218]':\n      - generic [ref=f2e220]: \"3\"\n      - generic [ref=f2e221]: Wed Night\n    - 'group \"Thu 31 Dec 2026 Early: 4 on duty, floor 4\" [ref=f2e222]':\n      - generic [ref=f2e224]: \"4\"\n      - generic [ref=f2e225]: Thu Early\n    - 'group \"Thu 31 Dec 2026 Late: 4 on duty, floor 4\" [ref=f2e226]':\n      - generic [ref=f2e228]: \"4\"\n      - generic [ref=f2e229]: Thu Late\n    - 'group \"Thu 31 Dec 2026 Night: 3 on duty, floor 3\" [ref=f2e230]':\n      - generic [ref=f2e232]: \"3\"\n      - generic [ref=f2e233]: Thu Night\n    - 'group \"Fri 1 Jan 2027 Early: 4 on duty, floor 4\" [ref=f2e234]':\n      - generic [ref=f2e236]: \"4\"\n      - generic [ref=f2e237]: Fri Early\n    - 'group \"Fri 1 Jan 2027 Late: 4 on duty, floor 4\" [ref=f2e238]':\n      - generic [ref=f2e240]: \"4\"\n      - generic [ref=f2e241]: Fri Late\n    - 'group \"Fri 1 Jan 2027 Night: 3 on duty, floor 3\" [ref=f2e242]':\n      - generic [ref=f2e244]: \"3\"\n      - generic [ref=f2e245]: Fri Night\n  - button \"Cover\" [ref=f2e151]\n  - generic [ref=f2e152]:\n    - button \"Previous 7 days\" [ref=f2e153] [cursor=pointer]\n    - button \"Next 7 days\" [ref=f2e154] [cursor=pointer]\n    - button \"Approve\" [disabled] [ref=f2e155]\n    - button \"Approve with override\" [ref=f2e156] [cursor=pointer]\n    - button \"Decline\" [ref=f2e157] [cursor=pointer]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "element": "affected Early cell",
  "target": "f2e160",
  "function": "e=>{const b=e.querySelector('.bar'),s=getComputedStyle(b);return {background:s.backgroundColor,backgroundImage:s.backgroundImage,opacity:s.opacity,height:s.height}}"
}
```
- Result
```json
{
  "result": "{\n  \"background\": \"rgb(180, 69, 46)\",\n  \"backgroundImage\": \"none\",\n  \"opacity\": \"1\",\n  \"height\": \"2px\"\n}"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "element": "unaffected Late cell",
  "target": "f2e166",
  "function": "e=>{const b=e.querySelector('.bar'),s=getComputedStyle(b);return {background:s.backgroundColor,backgroundImage:s.backgroundImage,opacity:s.opacity,height:s.height}}"
}
```
- Result
```json
{
  "result": "{\n  \"background\": \"rgb(90, 101, 109)\",\n  \"backgroundImage\": \"none\",\n  \"opacity\": \"0.6\",\n  \"height\": \"18.8125px\"\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Staffing strip",
  "target": "f2e159",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of Staffing strip](evidence/reduced/element-2026-11-01T01-02-35-167Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
