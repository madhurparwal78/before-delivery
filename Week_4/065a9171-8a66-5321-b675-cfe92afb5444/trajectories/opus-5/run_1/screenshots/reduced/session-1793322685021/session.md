
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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Sign in to Tallow Cover\" [level=1] [ref=e5]\n    - form \"Sign in\" [ref=e6]:\n      - generic [ref=e7]:\n        - text: Email\n        - textbox \"Email\" [ref=e8]\n      - generic [ref=e9]:\n        - text: Password\n        - textbox \"Password\" [ref=e10]\n      - button \"Sign in\" [ref=e11] [cursor=pointer]\n    - status \"Sign-in status\" [ref=e12]",
  "events": "- New console entries: evidence/reduced/console-2026-10-30T01-11-25-319Z.log#L1"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "form",
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- form \"Sign in\" [ref=e6]:\n  - generic [ref=e7]:\n    - text: Email\n    - textbox \"Email\" [ref=e8]\n  - generic [ref=e9]:\n    - text: Password\n    - textbox \"Password\" [ref=e10]\n  - button \"Sign in\" [ref=e11] [cursor=pointer]"
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
      "target": "e10",
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
  "target": "e11"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/shifts\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e13]:\n  - complementary [ref=e14]:\n    - paragraph [ref=e15]: Tallow Cover\n    - navigation \"Main\" [ref=e16]:\n      - list [ref=e17]:\n        - listitem [ref=e18]:\n          - link \"My shifts\" [ref=e19] [cursor=pointer]:\n            - /url: /shifts\n        - listitem [ref=e20]:\n          - link \"Request leave\" [ref=e21] [cursor=pointer]:\n            - /url: /leave/new\n        - listitem [ref=e22]:\n          - link \"My requests\" [ref=e23] [cursor=pointer]:\n            - /url: /leave\n        - listitem [ref=e24]:\n          - link \"Sickness\" [ref=e25] [cursor=pointer]:\n            - /url: /sickness\n        - listitem [ref=e26]:\n          - link \"Team rota\" [ref=e27] [cursor=pointer]:\n            - /url: /rota\n        - listitem [ref=e28]:\n          - link \"Profile\" [ref=e29] [cursor=pointer]:\n            - /url: /profile\n    - button \"Sign out\" [ref=e30] [cursor=pointer]\n  - main [ref=e31]:\n    - generic [ref=e32]:\n      - heading \"My shifts\" [level=1] [ref=e33]\n      - generic [ref=e34]:\n        - button \"Clock in\" [ref=e35] [cursor=pointer]\n        - status \"Clock status\" [ref=e36]\n        - paragraph\n      - generic [ref=e37]:\n        - heading \"Next 14 days\" [level=2] [ref=e38]\n        - list \"Upcoming shifts\" [ref=e39]:\n          - listitem [ref=e40]:\n            - generic [ref=e41]: Fri 30 Oct Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e42]:\n            - generic [ref=e43]: Sat 31 Oct Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e44]:\n            - generic [ref=e45]: Sun 1 Nov Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e46]:\n            - generic [ref=e47]: Mon 2 Nov Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e48]:\n            - generic [ref=e49]: Tue 3 Nov Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e50]:\n            - generic [ref=e51]: Wed 4 Nov Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e52]:\n            - generic [ref=e53]: Thu 5 Nov Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e54]:\n            - generic [ref=e55]: Fri 6 Nov Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e56]:\n            - generic [ref=e57]: Sat 7 Nov Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e58]:\n            - generic [ref=e59]: Sun 8 Nov Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e60]:\n            - generic [ref=e61]: Mon 9 Nov Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e62]:\n            - generic [ref=e63]: Tue 10 Nov Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e64]:\n            - generic [ref=e65]: Wed 11 Nov Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e66]:\n            - generic [ref=e67]: Thu 12 Nov Early · 07:00–15:00 · 8.00 h\n          - listitem [ref=e68]:\n            - generic [ref=e69]: Fri 13 Nov Early · 07:00–15:00 · 8.00 h\n      - region \"Holiday\" [ref=e70]:\n        - heading \"Holiday\" [level=2] [ref=e71]\n        - paragraph [ref=e72]: 168.00 of 168.00 hours left this leave year"
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
  "snapshot": "- generic [ref=f1e3]:\n  - complementary [ref=f1e4]:\n    - paragraph [ref=f1e5]: Tallow Cover\n    - navigation \"Main\" [ref=f1e6]:\n      - list [ref=f1e7]:\n        - listitem [ref=f1e8]:\n          - link \"My shifts\" [ref=f1e9] [cursor=pointer]:\n            - /url: /shifts\n        - listitem [ref=f1e10]:\n          - link \"Request leave\" [ref=f1e11] [cursor=pointer]:\n            - /url: /leave/new\n        - listitem [ref=f1e12]:\n          - link \"My requests\" [ref=f1e13] [cursor=pointer]:\n            - /url: /leave\n        - listitem [ref=f1e14]:\n          - link \"Sickness\" [ref=f1e15] [cursor=pointer]:\n            - /url: /sickness\n        - listitem [ref=f1e16]:\n          - link \"Team rota\" [ref=f1e17] [cursor=pointer]:\n            - /url: /rota\n        - listitem [ref=f1e18]:\n          - link \"Profile\" [ref=f1e19] [cursor=pointer]:\n            - /url: /profile\n    - button \"Sign out\" [ref=f1e20] [cursor=pointer]\n  - main [ref=f1e21]:\n    - generic [ref=f1e22]:\n      - heading \"Request leave\" [level=1] [ref=f1e23]\n      - generic [ref=f1e24]:\n        - form \"Request leave\" [ref=f1e25]:\n          - generic [ref=f1e26]:\n            - text: Leave type\n            - combobox \"Leave type\" [ref=f1e27]:\n              - option \"Annual leave\" [selected]\n              - option \"Unpaid leave\"\n              - option \"Compassionate leave\"\n          - generic [ref=f1e28]:\n            - text: First day\n            - textbox \"First day\" [ref=f1e29]:\n              - /placeholder: YYYY-MM-DD\n          - paragraph\n          - generic [ref=f1e30]:\n            - text: Last day\n            - textbox \"Last day\" [ref=f1e31]:\n              - /placeholder: YYYY-MM-DD\n          - paragraph\n          - generic [ref=f1e32]:\n            - text: Note\n            - textbox \"Note\" [ref=f1e33]\n          - paragraph\n          - paragraph\n          - generic [ref=f1e34]:\n            - button \"Save draft\" [ref=f1e35] [cursor=pointer]\n            - button \"Submit request\" [ref=f1e36] [cursor=pointer]\n        - status \"Leave status\" [ref=f1e37]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "form",
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/leave/new\n- Page Title: Tallow Cover",
  "inlineSnapshot": "- form \"Request leave\" [ref=f1e25]:\n  - generic [ref=f1e26]:\n    - text: Leave type\n    - combobox \"Leave type\" [ref=f1e27]:\n      - option \"Annual leave\" [selected]\n      - option \"Unpaid leave\"\n      - option \"Compassionate leave\"\n  - generic [ref=f1e28]:\n    - text: First day\n    - textbox \"First day\" [ref=f1e29]:\n      - /placeholder: YYYY-MM-DD\n  - paragraph\n  - generic [ref=f1e30]:\n    - text: Last day\n    - textbox \"Last day\" [ref=f1e31]:\n      - /placeholder: YYYY-MM-DD\n  - paragraph\n  - generic [ref=f1e32]:\n    - text: Note\n    - textbox \"Note\" [ref=f1e33]\n  - paragraph\n  - paragraph\n  - generic [ref=f1e34]:\n    - button \"Save draft\" [ref=f1e35] [cursor=pointer]\n    - button \"Submit request\" [ref=f1e36] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e27",
      "name": "Leave type",
      "type": "combobox",
      "value": "Unpaid leave"
    },
    {
      "target": "f1e29",
      "name": "First day",
      "type": "textbox",
      "value": "2027-01-16"
    },
    {
      "target": "f1e31",
      "name": "Last day",
      "type": "textbox",
      "value": "2027-01-16"
    },
    {
      "target": "f1e33",
      "name": "Note",
      "type": "textbox",
      "value": "qa-B9-r33d"
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
  "target": "f1e36"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/leave/lrq-bd9f2ed87d894cea85f332329c3a787e\n- Page Title: Tallow Cover",
  "snapshot": "- generic [ref=f1e38]:\n  - complementary [ref=f1e39]:\n    - paragraph [ref=f1e40]: Tallow Cover\n    - navigation \"Main\" [ref=f1e41]:\n      - list [ref=f1e42]:\n        - listitem [ref=f1e43]:\n          - link \"My shifts\" [ref=f1e44] [cursor=pointer]:\n            - /url: /shifts\n        - listitem [ref=f1e45]:\n          - link \"Request leave\" [ref=f1e46] [cursor=pointer]:\n            - /url: /leave/new\n        - listitem [ref=f1e47]:\n          - link \"My requests\" [ref=f1e48] [cursor=pointer]:\n            - /url: /leave\n        - listitem [ref=f1e49]:\n          - link \"Sickness\" [ref=f1e50] [cursor=pointer]:\n            - /url: /sickness\n        - listitem [ref=f1e51]:\n          - link \"Team rota\" [ref=f1e52] [cursor=pointer]:\n            - /url: /rota\n        - listitem [ref=f1e53]:\n          - link \"Profile\" [ref=f1e54] [cursor=pointer]:\n            - /url: /profile\n    - button \"Sign out\" [ref=f1e55] [cursor=pointer]\n  - main [ref=f1e56]:\n    - generic [ref=f1e57]:\n      - heading \"Leave request\" [level=1] [ref=f1e58]\n      - generic [ref=f1e59]:\n        - paragraph [ref=f1e60]: Unpaid leave · Submitted\n        - paragraph [ref=f1e61]: Sat 16 Jan 2027 to Sat 16 Jan 2027 · 1 days\n        - paragraph [ref=f1e62]: 8.00 hours booked\n        - paragraph [ref=f1e63]: qa-B9-r33d\n        - button \"Withdraw request\" [ref=f1e64] [cursor=pointer]\n      - status \"Leave status\" [ref=f1e65]"
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
  "page": "- Page URL: http://127.0.0.1:4173/leave/lrq-bd9f2ed87d894cea85f332329c3a787e\n- Page Title: Tallow Cover",
  "inlineSnapshot": "- generic [ref=f1e38]:\n  - complementary [ref=f1e39]:\n    - paragraph [ref=f1e40]: Tallow Cover\n    - navigation \"Main\" [ref=f1e41]\n    - button \"Sign out\" [ref=f1e55] [cursor=pointer]\n  - main [ref=f1e56]:\n    - generic [ref=f1e57]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Sign out",
  "target": "f1e55"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "snapshot": "- main [ref=f1e66]:\n  - generic [ref=f1e67]:\n    - heading \"Sign in to Tallow Cover\" [level=1] [ref=f1e68]\n    - form \"Sign in\" [ref=f1e69]:\n      - generic [ref=f1e70]:\n        - text: Email\n        - textbox \"Email\" [ref=f1e71]\n      - generic [ref=f1e72]:\n        - text: Password\n        - textbox \"Password\" [ref=f1e73]\n      - button \"Sign in\" [ref=f1e74] [cursor=pointer]\n    - status \"Sign-in status\" [ref=f1e75]",
  "events": "- New console entries: evidence/reduced/console-2026-10-30T01-11-46-377Z.log#L1"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "form",
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- form \"Sign in\" [ref=f1e69]:\n  - generic [ref=f1e70]:\n    - text: Email\n    - textbox \"Email\" [ref=f1e71]\n  - generic [ref=f1e72]:\n    - text: Password\n    - textbox \"Password\" [ref=f1e73]\n  - button \"Sign in\" [ref=f1e74] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e71",
      "name": "Email",
      "type": "textbox",
      "value": "fenella.marsh@hollinsvale.example"
    },
    {
      "target": "f1e73",
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
  "target": "f1e74"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/queue\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e76]:\n  - complementary [ref=f1e77]:\n    - paragraph [ref=f1e78]: Tallow Cover\n    - navigation \"Main\" [ref=f1e79]:\n      - list [ref=f1e80]:\n        - listitem [ref=f1e81]:\n          - link \"Queue\" [ref=f1e82] [cursor=pointer]:\n            - /url: /queue\n        - listitem [ref=f1e83]:\n          - link \"Today\" [ref=f1e84] [cursor=pointer]:\n            - /url: /today\n        - listitem [ref=f1e85]:\n          - link \"Request leave\" [ref=f1e86] [cursor=pointer]:\n            - /url: /leave/new\n        - listitem [ref=f1e87]:\n          - link \"My requests\" [ref=f1e88] [cursor=pointer]:\n            - /url: /leave\n        - listitem [ref=f1e89]:\n          - link \"Team rota\" [ref=f1e90] [cursor=pointer]:\n            - /url: /rota\n        - listitem [ref=f1e91]:\n          - link \"Floors and policy\" [ref=f1e92] [cursor=pointer]:\n            - /url: /floors\n        - listitem [ref=f1e93]:\n          - link \"Attendance\" [ref=f1e94] [cursor=pointer]:\n            - /url: /attendance\n        - listitem [ref=f1e95]:\n          - link \"Audit log\" [ref=f1e96] [cursor=pointer]:\n            - /url: /audit\n        - listitem [ref=f1e97]:\n          - link \"Profile\" [ref=f1e98] [cursor=pointer]:\n            - /url: /profile\n    - navigation \"Homes and units\" [ref=f1e100]:\n      - list [ref=f1e101]:\n        - listitem [ref=f1e102]:\n          - strong [ref=f1e103]: Larchfield House\n        - listitem [ref=f1e104]:\n          - link \"Rowan\" [ref=f1e105] [cursor=pointer]:\n            - /url: /rota?unit=larchfield-rowan\n        - listitem [ref=f1e106]:\n          - link \"Willow\" [ref=f1e107] [cursor=pointer]:\n            - /url: /rota?unit=larchfield-willow\n    - button \"Sign out\" [ref=f1e108] [cursor=pointer]\n  - main [ref=f1e109]:\n    - generic [ref=f1e110]:\n      - generic [ref=f1e111]:\n        - heading \"Queue\" [level=1] [ref=f1e112]\n        - group \"Queue filters\" [ref=f1e113]:\n          - generic [ref=f1e114]:\n            - text: Home\n            - combobox \"Home\" [ref=f1e115]:\n              - option \"Larchfield House\" [selected]\n          - generic [ref=f1e116]:\n            - text: Status\n            - combobox \"Status\" [ref=f1e117]:\n              - option \"Open\" [selected]\n              - option \"Submitted\"\n              - option \"Escalated\"\n              - option \"Cover pending\"\n              - option \"Approved\"\n              - option \"Declined\"\n              - option \"Withdrawn\"\n              - option \"Cancelled\"\n          - generic [ref=f1e118]:\n            - text: Week\n            - combobox \"Week\" [ref=f1e119]:\n              - option \"All weeks\" [selected]\n              - option \"2026-W40\"\n              - option \"2026-W41\"\n              - option \"2026-W42\"\n              - option \"2026-W43\"\n              - option \"2026-W44\"\n              - option \"2026-W45\"\n              - option \"2026-W46\"\n              - option \"2026-W47\"\n              - option \"2026-W48\"\n              - option \"2026-W49\"\n              - option \"2026-W50\"\n              - option \"2026-W51\"\n              - option \"2026-W52\"\n              - option \"2026-W53\"\n              - option \"2027-W01\"\n              - option \"2027-W02\"\n              - option \"2027-W03\"\n        - region \"Queue counts\" [ref=f1e120]:\n          - generic [ref=f1e121]: Submitted 11\n          - generic [ref=f1e122]: Escalated 0\n          - generic [ref=f1e123]: Cover pending 2\n          - generic [ref=f1e124]: Approved 0\n          - generic [ref=f1e125]: Declined 0\n        - listbox \"Requests\" [ref=f1e126]:\n          - option \"Priya Raman, Unpaid leave, Wed 16 Dec 2026 to Wed 16 Dec 2026, Submitted\" [ref=f1e127] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 16 Dec 2026 to Wed 16 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Thu 17 Dec 2026 to Thu 17 Dec 2026, Submitted\" [ref=f1e128] [cursor=pointer]: Priya Raman · Unpaid leave · Thu 17 Dec 2026 to Thu 17 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Fri 18 Dec 2026 to Fri 18 Dec 2026, Submitted\" [ref=f1e129] [cursor=pointer]: Priya Raman · Unpaid leave · Fri 18 Dec 2026 to Fri 18 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Sat 19 Dec 2026 to Sat 19 Dec 2026, Cover pending\" [ref=f1e130] [cursor=pointer]: Priya Raman · Unpaid leave · Sat 19 Dec 2026 to Sat 19 Dec 2026 · Cover pending\n          - option \"Priya Raman, Unpaid leave, Sun 20 Dec 2026 to Sun 20 Dec 2026, Submitted\" [ref=f1e131] [cursor=pointer]: Priya Raman · Unpaid leave · Sun 20 Dec 2026 to Sun 20 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Wed 6 Jan 2027 to Wed 6 Jan 2027, Submitted\" [ref=f1e132] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 6 Jan 2027 to Wed 6 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Sun 10 Jan 2027 to Sun 10 Jan 2027, Submitted\" [ref=f1e133] [cursor=pointer]: Priya Raman · Unpaid leave · Sun 10 Jan 2027 to Sun 10 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Mon 11 Jan 2027 to Mon 11 Jan 2027, Submitted\" [ref=f1e134] [cursor=pointer]: Priya Raman · Unpaid leave · Mon 11 Jan 2027 to Mon 11 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Tue 12 Jan 2027 to Tue 12 Jan 2027, Submitted\" [ref=f1e135] [cursor=pointer]: Priya Raman · Unpaid leave · Tue 12 Jan 2027 to Tue 12 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Wed 13 Jan 2027 to Wed 13 Jan 2027, Submitted\" [ref=f1e136] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 13 Jan 2027 to Wed 13 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Thu 14 Jan 2027 to Thu 14 Jan 2027, Cover pending\" [ref=f1e137] [cursor=pointer]: Priya Raman · Unpaid leave · Thu 14 Jan 2027 to Thu 14 Jan 2027 · Cover pending\n          - option \"Priya Raman, Unpaid leave, Fri 15 Jan 2027 to Fri 15 Jan 2027, Submitted\" [ref=f1e138] [cursor=pointer]: Priya Raman · Unpaid leave · Fri 15 Jan 2027 to Fri 15 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Sat 16 Jan 2027 to Sat 16 Jan 2027, Submitted\" [ref=f1e139] [cursor=pointer]: Priya Raman · Unpaid leave · Sat 16 Jan 2027 to Sat 16 Jan 2027 · Submitted\n      - generic [ref=f1e140]:\n        - region \"Request detail\" [ref=f1e141]:\n          - paragraph [ref=f1e142]: Select a request to see its staffing.\n        - status \"Queue status\" [ref=f1e143]\n        - status \"Strip announcements\" [ref=f1e144]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "[role=listbox]",
  "depth": 2
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/queue\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- listbox \"Requests\" [ref=f1e126]:\n  - option \"Priya Raman, Unpaid leave, Wed 16 Dec 2026 to Wed 16 Dec 2026, Submitted\" [ref=f1e127] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 16 Dec 2026 to Wed 16 Dec 2026 · Submitted\n  - option \"Priya Raman, Unpaid leave, Thu 17 Dec 2026 to Thu 17 Dec 2026, Submitted\" [ref=f1e128] [cursor=pointer]: Priya Raman · Unpaid leave · Thu 17 Dec 2026 to Thu 17 Dec 2026 · Submitted\n  - option \"Priya Raman, Unpaid leave, Fri 18 Dec 2026 to Fri 18 Dec 2026, Submitted\" [ref=f1e129] [cursor=pointer]: Priya Raman · Unpaid leave · Fri 18 Dec 2026 to Fri 18 Dec 2026 · Submitted\n  - option \"Priya Raman, Unpaid leave, Sat 19 Dec 2026 to Sat 19 Dec 2026, Cover pending\" [ref=f1e130] [cursor=pointer]: Priya Raman · Unpaid leave · Sat 19 Dec 2026 to Sat 19 Dec 2026 · Cover pending\n  - option \"Priya Raman, Unpaid leave, Sun 20 Dec 2026 to Sun 20 Dec 2026, Submitted\" [ref=f1e131] [cursor=pointer]: Priya Raman · Unpaid leave · Sun 20 Dec 2026 to Sun 20 Dec 2026 · Submitted\n  - option \"Priya Raman, Unpaid leave, Wed 6 Jan 2027 to Wed 6 Jan 2027, Submitted\" [ref=f1e132] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 6 Jan 2027 to Wed 6 Jan 2027 · Submitted\n  - option \"Priya Raman, Unpaid leave, Sun 10 Jan 2027 to Sun 10 Jan 2027, Submitted\" [ref=f1e133] [cursor=pointer]: Priya Raman · Unpaid leave · Sun 10 Jan 2027 to Sun 10 Jan 2027 · Submitted\n  - option \"Priya Raman, Unpaid leave, Mon 11 Jan 2027 to Mon 11 Jan 2027, Submitted\" [ref=f1e134] [cursor=pointer]: Priya Raman · Unpaid leave · Mon 11 Jan 2027 to Mon 11 Jan 2027 · Submitted\n  - option \"Priya Raman, Unpaid leave, Tue 12 Jan 2027 to Tue 12 Jan 2027, Submitted\" [ref=f1e135] [cursor=pointer]: Priya Raman · Unpaid leave · Tue 12 Jan 2027 to Tue 12 Jan 2027 · Submitted\n  - option \"Priya Raman, Unpaid leave, Wed 13 Jan 2027 to Wed 13 Jan 2027, Submitted\" [ref=f1e136] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 13 Jan 2027 to Wed 13 Jan 2027 · Submitted\n  - option \"Priya Raman, Unpaid leave, Thu 14 Jan 2027 to Thu 14 Jan 2027, Cover pending\" [ref=f1e137] [cursor=pointer]: Priya Raman · Unpaid leave · Thu 14 Jan 2027 to Thu 14 Jan 2027 · Cover pending\n  - option \"Priya Raman, Unpaid leave, Fri 15 Jan 2027 to Fri 15 Jan 2027, Submitted\" [ref=f1e138] [cursor=pointer]: Priya Raman · Unpaid leave · Fri 15 Jan 2027 to Fri 15 Jan 2027 · Submitted\n  - option \"Priya Raman, Unpaid leave, Sat 16 Jan 2027 to Sat 16 Jan 2027, Submitted\" [ref=f1e139] [cursor=pointer]: Priya Raman · Unpaid leave · Sat 16 Jan 2027 to Sat 16 Jan 2027 · Submitted"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "B9 request",
  "target": "f1e139"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/queue?home=larchfield&status=open&week=&request=lrq-bd9f2ed87d894cea85f332329c3a787e\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e145]:\n  - complementary [ref=f1e146]:\n    - paragraph [ref=f1e147]: Tallow Cover\n    - navigation \"Main\" [ref=f1e148]:\n      - list [ref=f1e149]:\n        - listitem [ref=f1e150]:\n          - link \"Queue\" [ref=f1e151] [cursor=pointer]:\n            - /url: /queue\n        - listitem [ref=f1e152]:\n          - link \"Today\" [ref=f1e153] [cursor=pointer]:\n            - /url: /today\n        - listitem [ref=f1e154]:\n          - link \"Request leave\" [ref=f1e155] [cursor=pointer]:\n            - /url: /leave/new\n        - listitem [ref=f1e156]:\n          - link \"My requests\" [ref=f1e157] [cursor=pointer]:\n            - /url: /leave\n        - listitem [ref=f1e158]:\n          - link \"Team rota\" [ref=f1e159] [cursor=pointer]:\n            - /url: /rota\n        - listitem [ref=f1e160]:\n          - link \"Floors and policy\" [ref=f1e161] [cursor=pointer]:\n            - /url: /floors\n        - listitem [ref=f1e162]:\n          - link \"Attendance\" [ref=f1e163] [cursor=pointer]:\n            - /url: /attendance\n        - listitem [ref=f1e164]:\n          - link \"Audit log\" [ref=f1e165] [cursor=pointer]:\n            - /url: /audit\n        - listitem [ref=f1e166]:\n          - link \"Profile\" [ref=f1e167] [cursor=pointer]:\n            - /url: /profile\n    - navigation \"Homes and units\" [ref=f1e169]:\n      - list [ref=f1e170]:\n        - listitem [ref=f1e171]:\n          - strong [ref=f1e172]: Larchfield House\n        - listitem [ref=f1e173]:\n          - link \"Rowan\" [ref=f1e174] [cursor=pointer]:\n            - /url: /rota?unit=larchfield-rowan\n        - listitem [ref=f1e175]:\n          - link \"Willow\" [ref=f1e176] [cursor=pointer]:\n            - /url: /rota?unit=larchfield-willow\n    - button \"Sign out\" [ref=f1e177] [cursor=pointer]\n  - main [ref=f1e178]:\n    - generic [ref=f1e179]:\n      - generic [ref=f1e180]:\n        - heading \"Queue\" [level=1] [ref=f1e181]\n        - group \"Queue filters\" [ref=f1e182]:\n          - generic [ref=f1e183]:\n            - text: Home\n            - combobox \"Home\" [ref=f1e184]:\n              - option \"Larchfield House\" [selected]\n          - generic [ref=f1e185]:\n            - text: Status\n            - combobox \"Status\" [ref=f1e186]:\n              - option \"Open\" [selected]\n              - option \"Submitted\"\n              - option \"Escalated\"\n              - option \"Cover pending\"\n              - option \"Approved\"\n              - option \"Declined\"\n              - option \"Withdrawn\"\n              - option \"Cancelled\"\n          - generic [ref=f1e187]:\n            - text: Week\n            - combobox \"Week\" [ref=f1e188]:\n              - option \"All weeks\" [selected]\n              - option \"2026-W40\"\n              - option \"2026-W41\"\n              - option \"2026-W42\"\n              - option \"2026-W43\"\n              - option \"2026-W44\"\n              - option \"2026-W45\"\n              - option \"2026-W46\"\n              - option \"2026-W47\"\n              - option \"2026-W48\"\n              - option \"2026-W49\"\n              - option \"2026-W50\"\n              - option \"2026-W51\"\n              - option \"2026-W52\"\n              - option \"2026-W53\"\n              - option \"2027-W01\"\n              - option \"2027-W02\"\n              - option \"2027-W03\"\n        - region \"Queue counts\" [ref=f1e189]:\n          - generic [ref=f1e190]: Submitted 11\n          - generic [ref=f1e191]: Escalated 0\n          - generic [ref=f1e192]: Cover pending 2\n          - generic [ref=f1e193]: Approved 0\n          - generic [ref=f1e194]: Declined 0\n        - listbox \"Requests\" [ref=f1e195]:\n          - option \"Priya Raman, Unpaid leave, Wed 16 Dec 2026 to Wed 16 Dec 2026, Submitted\" [ref=f1e196] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 16 Dec 2026 to Wed 16 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Thu 17 Dec 2026 to Thu 17 Dec 2026, Submitted\" [ref=f1e197] [cursor=pointer]: Priya Raman · Unpaid leave · Thu 17 Dec 2026 to Thu 17 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Fri 18 Dec 2026 to Fri 18 Dec 2026, Submitted\" [ref=f1e198] [cursor=pointer]: Priya Raman · Unpaid leave · Fri 18 Dec 2026 to Fri 18 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Sat 19 Dec 2026 to Sat 19 Dec 2026, Cover pending\" [ref=f1e199] [cursor=pointer]: Priya Raman · Unpaid leave · Sat 19 Dec 2026 to Sat 19 Dec 2026 · Cover pending\n          - option \"Priya Raman, Unpaid leave, Sun 20 Dec 2026 to Sun 20 Dec 2026, Submitted\" [ref=f1e200] [cursor=pointer]: Priya Raman · Unpaid leave · Sun 20 Dec 2026 to Sun 20 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Wed 6 Jan 2027 to Wed 6 Jan 2027, Submitted\" [ref=f1e201] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 6 Jan 2027 to Wed 6 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Sun 10 Jan 2027 to Sun 10 Jan 2027, Submitted\" [ref=f1e202] [cursor=pointer]: Priya Raman · Unpaid leave · Sun 10 Jan 2027 to Sun 10 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Mon 11 Jan 2027 to Mon 11 Jan 2027, Submitted\" [ref=f1e203] [cursor=pointer]: Priya Raman · Unpaid leave · Mon 11 Jan 2027 to Mon 11 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Tue 12 Jan 2027 to Tue 12 Jan 2027, Submitted\" [ref=f1e204] [cursor=pointer]: Priya Raman · Unpaid leave · Tue 12 Jan 2027 to Tue 12 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Wed 13 Jan 2027 to Wed 13 Jan 2027, Submitted\" [ref=f1e205] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 13 Jan 2027 to Wed 13 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Thu 14 Jan 2027 to Thu 14 Jan 2027, Cover pending\" [ref=f1e206] [cursor=pointer]: Priya Raman · Unpaid leave · Thu 14 Jan 2027 to Thu 14 Jan 2027 · Cover pending\n          - option \"Priya Raman, Unpaid leave, Fri 15 Jan 2027 to Fri 15 Jan 2027, Submitted\" [ref=f1e207] [cursor=pointer]: Priya Raman · Unpaid leave · Fri 15 Jan 2027 to Fri 15 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Sat 16 Jan 2027 to Sat 16 Jan 2027, Submitted\" [selected] [ref=f1e208] [cursor=pointer]: Priya Raman · Unpaid leave · Sat 16 Jan 2027 to Sat 16 Jan 2027 · Submitted\n      - generic [ref=f1e209]:\n        - region \"Request detail\" [ref=f1e210]:\n          - generic [ref=f1e211]: Priya Raman\n          - generic [ref=f1e212]:\n            - paragraph [ref=f1e213]: Unpaid leave · Sat 16 Jan 2027 to Sat 16 Jan 2027 · 8.00 hours\n            - paragraph [ref=f1e214]: Submitted\n            - paragraph [ref=f1e215]: qa-B9-r33d\n          - button \"Preview approval\" [ref=f1e216] [cursor=pointer]\n          - group \"Staffing strip\" [ref=f1e217]:\n            - generic [ref=f1e218]:\n              - generic [ref=f1e219]: Sat 16 Jan\n              - generic [ref=f1e220]:\n                - 'group \"Sat 16 Jan Early: 4 on duty, floor 4\" [ref=f1e221]':\n                  - generic [ref=f1e224]: \"4\"\n                - 'group \"Sat 16 Jan Late: 4 on duty, floor 4\" [ref=f1e226]':\n                  - generic [ref=f1e229]: \"4\"\n                - 'group \"Sat 16 Jan Night: 3 on duty, floor 3\" [ref=f1e231]':\n                  - generic [ref=f1e235]: \"3\"\n            - generic [ref=f1e237]:\n              - generic [ref=f1e238]: Sun 17 Jan\n              - generic [ref=f1e239]:\n                - 'group \"Sun 17 Jan Early: 4 on duty, floor 4\" [ref=f1e240]':\n                  - generic [ref=f1e244]: \"4\"\n                - 'group \"Sun 17 Jan Late: 4 on duty, floor 4\" [ref=f1e246]':\n                  - generic [ref=f1e249]: \"4\"\n                - 'group \"Sun 17 Jan Night: 3 on duty, floor 3\" [ref=f1e251]':\n                  - generic [ref=f1e255]: \"3\"\n            - generic [ref=f1e257]:\n              - generic [ref=f1e258]: Mon 18 Jan\n              - generic [ref=f1e259]:\n                - 'group \"Mon 18 Jan Early: 4 on duty, floor 4\" [ref=f1e260]':\n                  - generic [ref=f1e264]: \"4\"\n                - 'group \"Mon 18 Jan Late: 4 on duty, floor 4\" [ref=f1e266]':\n                  - generic [ref=f1e269]: \"4\"\n                - 'group \"Mon 18 Jan Night: 3 on duty, floor 3\" [ref=f1e271]':\n                  - generic [ref=f1e275]: \"3\"\n            - generic [ref=f1e277]:\n              - generic [ref=f1e278]: Tue 19 Jan\n              - generic [ref=f1e279]:\n                - 'group \"Tue 19 Jan Early: 4 on duty, floor 4\" [ref=f1e280]':\n                  - generic [ref=f1e284]: \"4\"\n                - 'group \"Tue 19 Jan Late: 4 on duty, floor 4\" [ref=f1e286]':\n                  - generic [ref=f1e289]: \"4\"\n                - 'group \"Tue 19 Jan Night: 3 on duty, floor 3\" [ref=f1e291]':\n                  - generic [ref=f1e295]: \"3\"\n            - generic [ref=f1e297]:\n              - generic [ref=f1e298]: Wed 20 Jan\n              - generic [ref=f1e299]:\n                - 'group \"Wed 20 Jan Early: 4 on duty, floor 4\" [ref=f1e300]':\n                  - generic [ref=f1e304]: \"4\"\n                - 'group \"Wed 20 Jan Late: 4 on duty, floor 4\" [ref=f1e306]':\n                  - generic [ref=f1e309]: \"4\"\n                - 'group \"Wed 20 Jan Night: 3 on duty, floor 3\" [ref=f1e311]':\n                  - generic [ref=f1e315]: \"3\"\n            - generic [ref=f1e317]:\n              - generic [ref=f1e318]: Thu 21 Jan\n              - generic [ref=f1e319]:\n                - 'group \"Thu 21 Jan Early: 4 on duty, floor 4\" [ref=f1e320]':\n                  - generic [ref=f1e324]: \"4\"\n                - 'group \"Thu 21 Jan Late: 4 on duty, floor 4\" [ref=f1e326]':\n                  - generic [ref=f1e329]: \"4\"\n                - 'group \"Thu 21 Jan Night: 3 on duty, floor 3\" [ref=f1e331]':\n                  - generic [ref=f1e335]: \"3\"\n            - generic [ref=f1e337]:\n              - generic [ref=f1e338]: Fri 22 Jan\n              - generic [ref=f1e339]:\n                - 'group \"Fri 22 Jan Early: 4 on duty, floor 4\" [ref=f1e340]':\n                  - generic [ref=f1e344]: \"4\"\n                - 'group \"Fri 22 Jan Late: 4 on duty, floor 4\" [ref=f1e346]':\n                  - generic [ref=f1e349]: \"4\"\n                - 'group \"Fri 22 Jan Night: 3 on duty, floor 3\" [ref=f1e351]':\n                  - generic [ref=f1e355]: \"3\"\n          - button \"Cover\" [ref=f1e357] [cursor=pointer]\n          - generic [ref=f1e358]:\n            - button \"Previous 7 days\" [ref=f1e359] [cursor=pointer]\n            - button \"Next 7 days\" [ref=f1e360] [cursor=pointer]\n            - button \"Approve\" [disabled] [ref=f1e361]\n            - button \"Approve with override\" [ref=f1e362] [cursor=pointer]\n            - button \"Decline\" [ref=f1e363] [cursor=pointer]\n          - generic [ref=f1e364]: Cover every gap or approve with override\n        - status \"Queue status\" [ref=f1e365]\n        - status \"Strip announcements\" [ref=f1e366]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "[role=region][aria-label='Request detail']",
  "depth": 2
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/queue?home=larchfield&status=open&week=&request=lrq-bd9f2ed87d894cea85f332329c3a787e\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- region \"Request detail\" [ref=f1e210]:\n  - generic [ref=f1e211]: Priya Raman\n  - generic [ref=f1e212]:\n    - paragraph [ref=f1e213]: Unpaid leave · Sat 16 Jan 2027 to Sat 16 Jan 2027 · 8.00 hours\n    - paragraph [ref=f1e214]: Submitted\n    - paragraph [ref=f1e215]: qa-B9-r33d\n  - button \"Preview approval\" [ref=f1e216] [cursor=pointer]\n  - group \"Staffing strip\" [ref=f1e217]:\n    - generic [ref=f1e218]\n    - generic [ref=f1e237]\n    - generic [ref=f1e257]\n    - generic [ref=f1e277]\n    - generic [ref=f1e297]\n    - generic [ref=f1e317]\n    - generic [ref=f1e337]\n  - button \"Cover\" [ref=f1e357] [cursor=pointer]\n  - generic [ref=f1e358]:\n    - button \"Previous 7 days\" [ref=f1e359] [cursor=pointer]\n    - button \"Next 7 days\" [ref=f1e360] [cursor=pointer]\n    - button \"Approve\" [disabled] [ref=f1e361]\n    - button \"Approve with override\" [ref=f1e362] [cursor=pointer]\n    - button \"Decline\" [ref=f1e363] [cursor=pointer]\n  - generic [ref=f1e364]: Cover every gap or approve with override"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Preview approval",
  "target": "f1e216"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/queue?home=larchfield&status=open&week=&request=lrq-bd9f2ed87d894cea85f332329c3a787e\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e145]:\n  - complementary [ref=f1e146]:\n    - paragraph [ref=f1e147]: Tallow Cover\n    - navigation \"Main\" [ref=f1e148]:\n      - list [ref=f1e149]:\n        - listitem [ref=f1e150]:\n          - link \"Queue\" [ref=f1e151] [cursor=pointer]:\n            - /url: /queue\n        - listitem [ref=f1e152]:\n          - link \"Today\" [ref=f1e153] [cursor=pointer]:\n            - /url: /today\n        - listitem [ref=f1e154]:\n          - link \"Request leave\" [ref=f1e155] [cursor=pointer]:\n            - /url: /leave/new\n        - listitem [ref=f1e156]:\n          - link \"My requests\" [ref=f1e157] [cursor=pointer]:\n            - /url: /leave\n        - listitem [ref=f1e158]:\n          - link \"Team rota\" [ref=f1e159] [cursor=pointer]:\n            - /url: /rota\n        - listitem [ref=f1e160]:\n          - link \"Floors and policy\" [ref=f1e161] [cursor=pointer]:\n            - /url: /floors\n        - listitem [ref=f1e162]:\n          - link \"Attendance\" [ref=f1e163] [cursor=pointer]:\n            - /url: /attendance\n        - listitem [ref=f1e164]:\n          - link \"Audit log\" [ref=f1e165] [cursor=pointer]:\n            - /url: /audit\n        - listitem [ref=f1e166]:\n          - link \"Profile\" [ref=f1e167] [cursor=pointer]:\n            - /url: /profile\n    - navigation \"Homes and units\" [ref=f1e169]:\n      - list [ref=f1e170]:\n        - listitem [ref=f1e171]:\n          - strong [ref=f1e172]: Larchfield House\n        - listitem [ref=f1e173]:\n          - link \"Rowan\" [ref=f1e174] [cursor=pointer]:\n            - /url: /rota?unit=larchfield-rowan\n        - listitem [ref=f1e175]:\n          - link \"Willow\" [ref=f1e176] [cursor=pointer]:\n            - /url: /rota?unit=larchfield-willow\n    - button \"Sign out\" [ref=f1e177] [cursor=pointer]\n  - main [ref=f1e178]:\n    - generic [ref=f1e179]:\n      - generic [ref=f1e180]:\n        - heading \"Queue\" [level=1] [ref=f1e181]\n        - group \"Queue filters\" [ref=f1e182]:\n          - generic [ref=f1e183]:\n            - text: Home\n            - combobox \"Home\" [ref=f1e184]:\n              - option \"Larchfield House\" [selected]\n          - generic [ref=f1e185]:\n            - text: Status\n            - combobox \"Status\" [ref=f1e186]:\n              - option \"Open\" [selected]\n              - option \"Submitted\"\n              - option \"Escalated\"\n              - option \"Cover pending\"\n              - option \"Approved\"\n              - option \"Declined\"\n              - option \"Withdrawn\"\n              - option \"Cancelled\"\n          - generic [ref=f1e187]:\n            - text: Week\n            - combobox \"Week\" [ref=f1e188]:\n              - option \"All weeks\" [selected]\n              - option \"2026-W40\"\n              - option \"2026-W41\"\n              - option \"2026-W42\"\n              - option \"2026-W43\"\n              - option \"2026-W44\"\n              - option \"2026-W45\"\n              - option \"2026-W46\"\n              - option \"2026-W47\"\n              - option \"2026-W48\"\n              - option \"2026-W49\"\n              - option \"2026-W50\"\n              - option \"2026-W51\"\n              - option \"2026-W52\"\n              - option \"2026-W53\"\n              - option \"2027-W01\"\n              - option \"2027-W02\"\n              - option \"2027-W03\"\n        - region \"Queue counts\" [ref=f1e189]:\n          - generic [ref=f1e190]: Submitted 11\n          - generic [ref=f1e191]: Escalated 0\n          - generic [ref=f1e192]: Cover pending 2\n          - generic [ref=f1e193]: Approved 0\n          - generic [ref=f1e194]: Declined 0\n        - listbox \"Requests\" [ref=f1e195]:\n          - option \"Priya Raman, Unpaid leave, Wed 16 Dec 2026 to Wed 16 Dec 2026, Submitted\" [ref=f1e196] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 16 Dec 2026 to Wed 16 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Thu 17 Dec 2026 to Thu 17 Dec 2026, Submitted\" [ref=f1e197] [cursor=pointer]: Priya Raman · Unpaid leave · Thu 17 Dec 2026 to Thu 17 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Fri 18 Dec 2026 to Fri 18 Dec 2026, Submitted\" [ref=f1e198] [cursor=pointer]: Priya Raman · Unpaid leave · Fri 18 Dec 2026 to Fri 18 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Sat 19 Dec 2026 to Sat 19 Dec 2026, Cover pending\" [ref=f1e199] [cursor=pointer]: Priya Raman · Unpaid leave · Sat 19 Dec 2026 to Sat 19 Dec 2026 · Cover pending\n          - option \"Priya Raman, Unpaid leave, Sun 20 Dec 2026 to Sun 20 Dec 2026, Submitted\" [ref=f1e200] [cursor=pointer]: Priya Raman · Unpaid leave · Sun 20 Dec 2026 to Sun 20 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Wed 6 Jan 2027 to Wed 6 Jan 2027, Submitted\" [ref=f1e201] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 6 Jan 2027 to Wed 6 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Sun 10 Jan 2027 to Sun 10 Jan 2027, Submitted\" [ref=f1e202] [cursor=pointer]: Priya Raman · Unpaid leave · Sun 10 Jan 2027 to Sun 10 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Mon 11 Jan 2027 to Mon 11 Jan 2027, Submitted\" [ref=f1e203] [cursor=pointer]: Priya Raman · Unpaid leave · Mon 11 Jan 2027 to Mon 11 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Tue 12 Jan 2027 to Tue 12 Jan 2027, Submitted\" [ref=f1e204] [cursor=pointer]: Priya Raman · Unpaid leave · Tue 12 Jan 2027 to Tue 12 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Wed 13 Jan 2027 to Wed 13 Jan 2027, Submitted\" [ref=f1e205] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 13 Jan 2027 to Wed 13 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Thu 14 Jan 2027 to Thu 14 Jan 2027, Cover pending\" [ref=f1e206] [cursor=pointer]: Priya Raman · Unpaid leave · Thu 14 Jan 2027 to Thu 14 Jan 2027 · Cover pending\n          - option \"Priya Raman, Unpaid leave, Fri 15 Jan 2027 to Fri 15 Jan 2027, Submitted\" [ref=f1e207] [cursor=pointer]: Priya Raman · Unpaid leave · Fri 15 Jan 2027 to Fri 15 Jan 2027 · Submitted\n          - option \"Priya Raman, Unpaid leave, Sat 16 Jan 2027 to Sat 16 Jan 2027, Submitted\" [selected] [ref=f1e208] [cursor=pointer]: Priya Raman · Unpaid leave · Sat 16 Jan 2027 to Sat 16 Jan 2027 · Submitted\n      - generic [ref=f1e209]:\n        - region \"Request detail\" [ref=f1e210]:\n          - generic [ref=f1e211]: Priya Raman\n          - generic [ref=f1e212]:\n            - paragraph [ref=f1e213]: Unpaid leave · Sat 16 Jan 2027 to Sat 16 Jan 2027 · 8.00 hours\n            - paragraph [ref=f1e214]: Submitted\n            - paragraph [ref=f1e215]: qa-B9-r33d\n          - button \"Preview approval\" [active] [pressed] [ref=f1e216] [cursor=pointer]\n          - group \"Staffing strip\" [ref=f1e217]:\n            - generic [ref=f1e218]:\n              - generic [ref=f1e219]: Sat 16 Jan\n              - generic [ref=f1e220]:\n                - 'group \"Sat 16 Jan Early: 3 on duty, floor 4, 1 below floor, no senior on shift\" [ref=f1e367]':\n                  - generic [ref=f1e224]:\n                    - button \"Post cover for Sat 16 Jan Early (senior)\" [ref=f1e369] [cursor=pointer]\n                    - generic [ref=f1e225]: \"3\"\n                    - generic [ref=f1e370]: 4 → 3\n                    - generic [ref=f1e371]:\n                      - generic [ref=f1e372]: \"-1 below floor\"\n                      - generic [ref=f1e373]: no senior on shift\n                - 'group \"Sat 16 Jan Late: 4 on duty, floor 4\" [ref=f1e226]':\n                  - generic [ref=f1e229]: \"4\"\n                - 'group \"Sat 16 Jan Night: 3 on duty, floor 3\" [ref=f1e231]':\n                  - generic [ref=f1e235]: \"3\"\n            - generic [ref=f1e237]:\n              - generic [ref=f1e238]: Sun 17 Jan\n              - generic [ref=f1e239]:\n                - 'group \"Sun 17 Jan Early: 4 on duty, floor 4\" [ref=f1e240]':\n                  - generic [ref=f1e244]: \"4\"\n                - 'group \"Sun 17 Jan Late: 4 on duty, floor 4\" [ref=f1e246]':\n                  - generic [ref=f1e249]: \"4\"\n                - 'group \"Sun 17 Jan Night: 3 on duty, floor 3\" [ref=f1e251]':\n                  - generic [ref=f1e255]: \"3\"\n            - generic [ref=f1e257]:\n              - generic [ref=f1e258]: Mon 18 Jan\n              - generic [ref=f1e259]:\n                - 'group \"Mon 18 Jan Early: 4 on duty, floor 4\" [ref=f1e260]':\n                  - generic [ref=f1e264]: \"4\"\n                - 'group \"Mon 18 Jan Late: 4 on duty, floor 4\" [ref=f1e266]':\n                  - generic [ref=f1e269]: \"4\"\n                - 'group \"Mon 18 Jan Night: 3 on duty, floor 3\" [ref=f1e271]':\n                  - generic [ref=f1e275]: \"3\"\n            - generic [ref=f1e277]:\n              - generic [ref=f1e278]: Tue 19 Jan\n              - generic [ref=f1e279]:\n                - 'group \"Tue 19 Jan Early: 4 on duty, floor 4\" [ref=f1e280]':\n                  - generic [ref=f1e284]: \"4\"\n                - 'group \"Tue 19 Jan Late: 4 on duty, floor 4\" [ref=f1e286]':\n                  - generic [ref=f1e289]: \"4\"\n                - 'group \"Tue 19 Jan Night: 3 on duty, floor 3\" [ref=f1e291]':\n                  - generic [ref=f1e295]: \"3\"\n            - generic [ref=f1e297]:\n              - generic [ref=f1e298]: Wed 20 Jan\n              - generic [ref=f1e299]:\n                - 'group \"Wed 20 Jan Early: 4 on duty, floor 4\" [ref=f1e300]':\n                  - generic [ref=f1e304]: \"4\"\n                - 'group \"Wed 20 Jan Late: 4 on duty, floor 4\" [ref=f1e306]':\n                  - generic [ref=f1e309]: \"4\"\n                - 'group \"Wed 20 Jan Night: 3 on duty, floor 3\" [ref=f1e311]':\n                  - generic [ref=f1e315]: \"3\"\n            - generic [ref=f1e317]:\n              - generic [ref=f1e318]: Thu 21 Jan\n              - generic [ref=f1e319]:\n                - 'group \"Thu 21 Jan Early: 4 on duty, floor 4\" [ref=f1e320]':\n                  - generic [ref=f1e324]: \"4\"\n                - 'group \"Thu 21 Jan Late: 4 on duty, floor 4\" [ref=f1e326]':\n                  - generic [ref=f1e329]: \"4\"\n                - 'group \"Thu 21 Jan Night: 3 on duty, floor 3\" [ref=f1e331]':\n                  - generic [ref=f1e335]: \"3\"\n            - generic [ref=f1e337]:\n              - generic [ref=f1e338]: Fri 22 Jan\n              - generic [ref=f1e339]:\n                - 'group \"Fri 22 Jan Early: 4 on duty, floor 4\" [ref=f1e340]':\n                  - generic [ref=f1e344]: \"4\"\n                - 'group \"Fri 22 Jan Late: 4 on duty, floor 4\" [ref=f1e346]':\n                  - generic [ref=f1e349]: \"4\"\n                - 'group \"Fri 22 Jan Night: 3 on duty, floor 3\" [ref=f1e351]':\n                  - generic [ref=f1e355]: \"3\"\n          - button \"Cover\" [ref=f1e357] [cursor=pointer]\n          - generic [ref=f1e358]:\n            - button \"Previous 7 days\" [ref=f1e359] [cursor=pointer]\n            - button \"Next 7 days\" [ref=f1e360] [cursor=pointer]\n            - button \"Approve\" [disabled] [ref=f1e361]\n            - button \"Approve with override\" [ref=f1e362] [cursor=pointer]\n            - button \"Decline\" [ref=f1e363] [cursor=pointer]\n          - generic [ref=f1e364]: Cover every gap or approve with override\n        - status \"Queue status\" [ref=f1e365]\n        - status \"Strip announcements\" [ref=f1e366]: \"Approving would leave 1 shift below floor: Sat Early\""
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const cells=[...document.querySelectorAll('[role=group][aria-label=\"Staffing strip\"] .strip-cell')];return [0,1].map(i=>{const c=cells[i];return {i,aria:c.getAttribute('aria-label'),children:[...c.children].map(e=>{const s=getComputedStyle(e);return {cls:e.className,bg:s.backgroundColor,bi:s.backgroundImage,opacity:s.opacity,height:e.getBoundingClientRect().height}})}})}"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"i\": 0,\n    \"aria\": \"Sat 16 Jan Early: 3 on duty, floor 4, 1 below floor, no senior on shift\",\n    \"children\": [\n      {\n        \"cls\": \"bar\",\n        \"bg\": \"rgb(21, 32, 43)\",\n        \"bi\": \"none\",\n        \"opacity\": \"1\",\n        \"height\": 172\n      },\n      {\n        \"cls\": \"floor-rule\",\n        \"bg\": \"rgb(11, 81, 89)\",\n        \"bi\": \"none\",\n        \"opacity\": \"1\",\n        \"height\": 2\n      },\n      {\n        \"cls\": \"floor-step\",\n        \"bg\": \"rgb(11, 81, 89)\",\n        \"bi\": \"none\",\n        \"opacity\": \"1\",\n        \"height\": 0\n      },\n      {\n        \"cls\": \"cell-body\",\n        \"bg\": \"rgba(0, 0, 0, 0)\",\n        \"bi\": \"none\",\n        \"opacity\": \"1\",\n        \"height\": 172\n      }\n    ]\n  },\n  {\n    \"i\": 1,\n    \"aria\": \"Sat 16 Jan Late: 4 on duty, floor 4\",\n    \"children\": [\n      {\n        \"cls\": \"bar\",\n        \"bg\": \"rgba(21, 32, 43, 0.42)\",\n        \"bi\": \"none\",\n        \"opacity\": \"1\",\n        \"height\": 229.4375\n      },\n      {\n        \"cls\": \"floor-rule\",\n        \"bg\": \"rgb(11, 81, 89)\",\n        \"bi\": \"none\",\n        \"opacity\": \"1\",\n        \"height\": 2\n      },\n      {\n        \"cls\": \"floor-step\",\n        \"bg\": \"rgb(11, 81, 89)\",\n        \"bi\": \"none\",\n        \"opacity\": \"1\",\n        \"height\": 0\n      },\n      {\n        \"cls\": \"cell-body\",\n        \"bg\": \"rgba(0, 0, 0, 0)\",\n        \"bi\": \"none\",\n        \"opacity\": \"1\",\n        \"height\": 114.5625\n      }\n    ]\n  }\n]"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "reduced-motion preview strip",
  "target": "[role=group][aria-label='Staffing strip']",
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of reduced-motion preview strip](evidence/reduced/element-2026-10-30T01-12-39-025Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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ACCEQwAAhHAIAIAQDgEAEMIhAABCOAQAQAiHAAAI4RAAACEcAgAghEMAAIRwCACAEA4BABDCIQAAQjgEAEAIhwAACOEQAAAhHAIAIIRDAACEcAgAgBAOAQAQwiEAAEI4BABACIcAAAjhEAAAIRwCACCEQwAAhHAIAIAQDgEAEMIhAABCOAQAQAiHAAAI4RAAACEcAgAghEMAAIRwCACAEA4BABDCIQAAQjgEAEAIhwAACOEQAAAhHAIAIIRDAACEcAgAgBAOAQAQwiEAAEI4BABACIcAAAjhEAAAIRwCACCEQwAAhHAIAIAQDgEAEMIhAABCOAQAQAiHAAAI4RAAACEcAgAghEMAAIRwCACAEA4BABDCIQAAQjgEAEAIhwAACOEQAAAhHAIAIIRDAACEcAgAgBAOAQAQwiEAAEI4BABACIcAAAjhEAAAIRwCACCEQwAAhHAIAIAQDgEAEMIhAABCOAQAQAiHAAAI4RAAACEcAgAghEMAAIRwCACAEA4BABDCIQAAQjgEAEAIhwAACOEQAAAhHAIAIIRDAACEcAgAgBAOAQAQwiEAAEI4BABACIcAAAjhEAAAIRwCACCEQwAAhHAIAIAQDgEAEMIhAABCOAQAQAiHAAAI4RAAACEcAgAghEMAAIRwCACAEA4BABDCIQAAQjgEAEAIhwAACOEQAAAhHAIAIIRDAACEcAgAgBAOAQAQwiEAAEI4BABA/R8AAP//BdR3vQAAAAZJREFUAwAAtXsJwOBPDAAAAABJRU5ErkJggg==",
      "mimeType": "image/png"
    }
  ]
}
```
