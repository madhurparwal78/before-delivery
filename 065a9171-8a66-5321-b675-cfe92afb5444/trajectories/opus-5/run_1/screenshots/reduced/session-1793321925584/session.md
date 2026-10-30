
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
  "events": "- New console entries: evidence/reduced/console-2026-10-30T00-58-45-753Z.log#L1"
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
  "inlineSnapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Sign in to Tallow Cover\" [level=1] [ref=e5]\n    - form \"Sign in\" [ref=e6]:\n      - generic [ref=e7]\n      - generic [ref=e9]\n      - button \"Sign in\" [ref=e11] [cursor=pointer]\n    - status \"Sign-in status\" [ref=e12]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "input[aria-label='Email']",
      "name": "Email",
      "type": "textbox",
      "value": "priya.raman@hollinsvale.example"
    },
    {
      "target": "input[aria-label='Password']",
      "name": "Password",
      "type": "textbox",
      "value": "wrong-password"
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
  "target": "button:has-text('Sign in')"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Tallow Cover\n- Console: 2 errors, 0 warnings",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Sign in to Tallow Cover\" [level=1] [ref=e5]\n    - form \"Sign in\" [ref=e6]:\n      - generic [ref=e7]:\n        - text: Email\n        - textbox \"Email\" [ref=e8]: priya.raman@hollinsvale.example\n      - generic [ref=e9]:\n        - text: Password\n        - textbox \"Password\" [ref=e10]: wrong-password\n      - button \"Sign in\" [ref=e11] [cursor=pointer]\n    - status \"Sign-in status\" [ref=e12]: That email and password don't match.",
  "events": "- New console entries: evidence/reduced/console-2026-10-30T00-58-45-753Z.log#L2"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "input[aria-label='Password']",
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
  "target": "button:has-text('Sign in')"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/shifts\n- Page Title: Tallow Cover\n- Console: 2 errors, 0 warnings",
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

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "select[aria-label='Leave type']",
      "name": "Leave type",
      "type": "combobox",
      "value": "Unpaid leave"
    },
    {
      "target": "input[aria-label='First day']",
      "name": "First day",
      "type": "textbox",
      "value": "2027-01-06"
    },
    {
      "target": "input[aria-label='Last day']",
      "name": "Last day",
      "type": "textbox",
      "value": "2027-01-05"
    },
    {
      "target": "textarea[aria-label='Note']",
      "name": "Note",
      "type": "textbox",
      "value": "invalid-reduced"
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
  "target": "button:has-text('Submit request')"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/leave/new\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e3]:\n  - complementary [ref=f1e4]:\n    - paragraph [ref=f1e5]: Tallow Cover\n    - navigation \"Main\" [ref=f1e6]:\n      - list [ref=f1e7]:\n        - listitem [ref=f1e8]:\n          - link \"My shifts\" [ref=f1e9] [cursor=pointer]:\n            - /url: /shifts\n        - listitem [ref=f1e10]:\n          - link \"Request leave\" [ref=f1e11] [cursor=pointer]:\n            - /url: /leave/new\n        - listitem [ref=f1e12]:\n          - link \"My requests\" [ref=f1e13] [cursor=pointer]:\n            - /url: /leave\n        - listitem [ref=f1e14]:\n          - link \"Sickness\" [ref=f1e15] [cursor=pointer]:\n            - /url: /sickness\n        - listitem [ref=f1e16]:\n          - link \"Team rota\" [ref=f1e17] [cursor=pointer]:\n            - /url: /rota\n        - listitem [ref=f1e18]:\n          - link \"Profile\" [ref=f1e19] [cursor=pointer]:\n            - /url: /profile\n    - button \"Sign out\" [ref=f1e20] [cursor=pointer]\n  - main [ref=f1e21]:\n    - generic [ref=f1e22]:\n      - heading \"Request leave\" [level=1] [ref=f1e23]\n      - generic [ref=f1e24]:\n        - form \"Request leave\" [ref=f1e25]:\n          - generic [ref=f1e26]:\n            - text: Leave type\n            - combobox \"Leave type\" [ref=f1e27]:\n              - option \"Annual leave\"\n              - option \"Unpaid leave\" [selected]\n              - option \"Compassionate leave\"\n          - generic [ref=f1e28]:\n            - text: First day\n            - textbox \"First day\" [ref=f1e29]:\n              - /placeholder: YYYY-MM-DD\n              - text: 2027-01-06\n          - paragraph\n          - generic [ref=f1e30]:\n            - text: Last day\n            - textbox \"Last day\" [ref=f1e31]:\n              - /placeholder: YYYY-MM-DD\n              - text: 2027-01-05\n          - paragraph [ref=f1e38]: The last day can't be before the first day.\n          - generic [ref=f1e32]:\n            - text: Note\n            - textbox \"Note\" [ref=f1e33]: invalid-reduced\n          - paragraph\n          - paragraph\n          - generic [ref=f1e34]:\n            - button \"Save draft\" [ref=f1e35] [cursor=pointer]\n            - button \"Submit request\" [ref=f1e36] [cursor=pointer]\n        - status \"Leave status\" [ref=f1e37]: Check the highlighted fields.",
  "events": "- New console entries: evidence/reduced/console-2026-10-30T01-03-40-073Z.log#L1"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "input[aria-label='First day']",
      "name": "First day",
      "type": "textbox",
      "value": "2027-01-06"
    },
    {
      "target": "input[aria-label='Last day']",
      "name": "Last day",
      "type": "textbox",
      "value": "2027-01-06"
    },
    {
      "target": "textarea[aria-label='Note']",
      "name": "Note",
      "type": "textbox",
      "value": "QA-B9-8C4Z"
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
  "target": "button:has-text('Submit request')"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/leave/lrq-c7bd42442ac04f138c21cb40a65095b9\n- Page Title: Tallow Cover\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e39]:\n  - complementary [ref=f1e40]:\n    - paragraph [ref=f1e41]: Tallow Cover\n    - navigation \"Main\" [ref=f1e42]:\n      - list [ref=f1e43]:\n        - listitem [ref=f1e44]:\n          - link \"My shifts\" [ref=f1e45] [cursor=pointer]:\n            - /url: /shifts\n        - listitem [ref=f1e46]:\n          - link \"Request leave\" [ref=f1e47] [cursor=pointer]:\n            - /url: /leave/new\n        - listitem [ref=f1e48]:\n          - link \"My requests\" [ref=f1e49] [cursor=pointer]:\n            - /url: /leave\n        - listitem [ref=f1e50]:\n          - link \"Sickness\" [ref=f1e51] [cursor=pointer]:\n            - /url: /sickness\n        - listitem [ref=f1e52]:\n          - link \"Team rota\" [ref=f1e53] [cursor=pointer]:\n            - /url: /rota\n        - listitem [ref=f1e54]:\n          - link \"Profile\" [ref=f1e55] [cursor=pointer]:\n            - /url: /profile\n    - button \"Sign out\" [ref=f1e56] [cursor=pointer]\n  - main [ref=f1e57]:\n    - generic [ref=f1e58]:\n      - heading \"Leave request\" [level=1] [ref=f1e59]\n      - generic [ref=f1e60]:\n        - paragraph [ref=f1e61]: Unpaid leave · Submitted\n        - paragraph [ref=f1e62]: Wed 6 Jan 2027 to Wed 6 Jan 2027 · 1 days\n        - paragraph [ref=f1e63]: 8.00 hours booked\n        - paragraph [ref=f1e64]: QA-B9-8C4Z\n        - button \"Withdraw request\" [ref=f1e65] [cursor=pointer]\n      - status \"Leave status\" [ref=f1e66]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Sign out",
  "target": "button:has-text('Sign out')"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Tallow Cover\n- Console: 2 errors, 0 warnings",
  "snapshot": "- main [ref=f1e67]:\n  - generic [ref=f1e68]:\n    - heading \"Sign in to Tallow Cover\" [level=1] [ref=f1e69]\n    - form \"Sign in\" [ref=f1e70]:\n      - generic [ref=f1e71]:\n        - text: Email\n        - textbox \"Email\" [ref=f1e72]\n      - generic [ref=f1e73]:\n        - text: Password\n        - textbox \"Password\" [ref=f1e74]\n      - button \"Sign in\" [ref=f1e75] [cursor=pointer]\n    - status \"Sign-in status\" [ref=f1e76]",
  "events": "- New console entries: evidence/reduced/console-2026-10-30T01-03-40-073Z.log#L2"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "input[aria-label='Email']",
      "name": "Email",
      "type": "textbox",
      "value": "fenella.marsh@hollinsvale.example"
    },
    {
      "target": "input[aria-label='Password']",
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
  "target": "button:has-text('Sign in')"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/queue\n- Page Title: Tallow Cover\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e77]:\n  - complementary [ref=f1e78]:\n    - paragraph [ref=f1e79]: Tallow Cover\n    - navigation \"Main\" [ref=f1e80]:\n      - list [ref=f1e81]:\n        - listitem [ref=f1e82]:\n          - link \"Queue\" [ref=f1e83] [cursor=pointer]:\n            - /url: /queue\n        - listitem [ref=f1e84]:\n          - link \"Today\" [ref=f1e85] [cursor=pointer]:\n            - /url: /today\n        - listitem [ref=f1e86]:\n          - link \"Request leave\" [ref=f1e87] [cursor=pointer]:\n            - /url: /leave/new\n        - listitem [ref=f1e88]:\n          - link \"My requests\" [ref=f1e89] [cursor=pointer]:\n            - /url: /leave\n        - listitem [ref=f1e90]:\n          - link \"Team rota\" [ref=f1e91] [cursor=pointer]:\n            - /url: /rota\n        - listitem [ref=f1e92]:\n          - link \"Floors and policy\" [ref=f1e93] [cursor=pointer]:\n            - /url: /floors\n        - listitem [ref=f1e94]:\n          - link \"Attendance\" [ref=f1e95] [cursor=pointer]:\n            - /url: /attendance\n        - listitem [ref=f1e96]:\n          - link \"Audit log\" [ref=f1e97] [cursor=pointer]:\n            - /url: /audit\n        - listitem [ref=f1e98]:\n          - link \"Profile\" [ref=f1e99] [cursor=pointer]:\n            - /url: /profile\n    - navigation \"Homes and units\" [ref=f1e101]:\n      - list [ref=f1e102]:\n        - listitem [ref=f1e103]:\n          - strong [ref=f1e104]: Larchfield House\n        - listitem [ref=f1e105]:\n          - link \"Rowan\" [ref=f1e106] [cursor=pointer]:\n            - /url: /rota?unit=larchfield-rowan\n        - listitem [ref=f1e107]:\n          - link \"Willow\" [ref=f1e108] [cursor=pointer]:\n            - /url: /rota?unit=larchfield-willow\n    - button \"Sign out\" [ref=f1e109] [cursor=pointer]\n  - main [ref=f1e110]:\n    - generic [ref=f1e111]:\n      - generic [ref=f1e112]:\n        - heading \"Queue\" [level=1] [ref=f1e113]\n        - group \"Queue filters\" [ref=f1e114]:\n          - generic [ref=f1e115]:\n            - text: Home\n            - combobox \"Home\" [ref=f1e116]:\n              - option \"Larchfield House\" [selected]\n          - generic [ref=f1e117]:\n            - text: Status\n            - combobox \"Status\" [ref=f1e118]:\n              - option \"Open\" [selected]\n              - option \"Submitted\"\n              - option \"Escalated\"\n              - option \"Cover pending\"\n              - option \"Approved\"\n              - option \"Declined\"\n              - option \"Withdrawn\"\n              - option \"Cancelled\"\n          - generic [ref=f1e119]:\n            - text: Week\n            - combobox \"Week\" [ref=f1e120]:\n              - option \"All weeks\" [selected]\n              - option \"2026-W40\"\n              - option \"2026-W41\"\n              - option \"2026-W42\"\n              - option \"2026-W43\"\n              - option \"2026-W44\"\n              - option \"2026-W45\"\n              - option \"2026-W46\"\n              - option \"2026-W47\"\n              - option \"2026-W48\"\n              - option \"2026-W49\"\n              - option \"2026-W50\"\n              - option \"2026-W51\"\n              - option \"2026-W52\"\n              - option \"2026-W53\"\n              - option \"2027-W01\"\n              - option \"2027-W02\"\n              - option \"2027-W03\"\n        - region \"Queue counts\" [ref=f1e121]:\n          - generic [ref=f1e122]: Submitted 5\n          - generic [ref=f1e123]: Escalated 0\n          - generic [ref=f1e124]: Cover pending 1\n          - generic [ref=f1e125]: Approved 0\n          - generic [ref=f1e126]: Declined 0\n        - listbox \"Requests\" [ref=f1e127]:\n          - option \"Priya Raman, Unpaid leave, Wed 16 Dec 2026 to Wed 16 Dec 2026, Submitted\" [ref=f1e128] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 16 Dec 2026 to Wed 16 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Thu 17 Dec 2026 to Thu 17 Dec 2026, Submitted\" [ref=f1e129] [cursor=pointer]: Priya Raman · Unpaid leave · Thu 17 Dec 2026 to Thu 17 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Fri 18 Dec 2026 to Fri 18 Dec 2026, Submitted\" [ref=f1e130] [cursor=pointer]: Priya Raman · Unpaid leave · Fri 18 Dec 2026 to Fri 18 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Sat 19 Dec 2026 to Sat 19 Dec 2026, Cover pending\" [ref=f1e131] [cursor=pointer]: Priya Raman · Unpaid leave · Sat 19 Dec 2026 to Sat 19 Dec 2026 · Cover pending\n          - option \"Priya Raman, Unpaid leave, Sun 20 Dec 2026 to Sun 20 Dec 2026, Submitted\" [ref=f1e132] [cursor=pointer]: Priya Raman · Unpaid leave · Sun 20 Dec 2026 to Sun 20 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Wed 6 Jan 2027 to Wed 6 Jan 2027, Submitted\" [ref=f1e133] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 6 Jan 2027 to Wed 6 Jan 2027 · Submitted\n      - generic [ref=f1e134]:\n        - region \"Request detail\" [ref=f1e135]:\n          - paragraph [ref=f1e136]: Select a request to see its staffing.\n        - status \"Queue status\" [ref=f1e137]\n        - status \"Strip announcements\" [ref=f1e138]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "B9 request",
  "target": "[role=option]:has-text('Wed 6 Jan 2027')"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/queue?home=larchfield&status=open&week=&request=lrq-c7bd42442ac04f138c21cb40a65095b9\n- Page Title: Tallow Cover\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e139]:\n  - complementary [ref=f1e140]:\n    - paragraph [ref=f1e141]: Tallow Cover\n    - navigation \"Main\" [ref=f1e142]:\n      - list [ref=f1e143]:\n        - listitem [ref=f1e144]:\n          - link \"Queue\" [ref=f1e145] [cursor=pointer]:\n            - /url: /queue\n        - listitem [ref=f1e146]:\n          - link \"Today\" [ref=f1e147] [cursor=pointer]:\n            - /url: /today\n        - listitem [ref=f1e148]:\n          - link \"Request leave\" [ref=f1e149] [cursor=pointer]:\n            - /url: /leave/new\n        - listitem [ref=f1e150]:\n          - link \"My requests\" [ref=f1e151] [cursor=pointer]:\n            - /url: /leave\n        - listitem [ref=f1e152]:\n          - link \"Team rota\" [ref=f1e153] [cursor=pointer]:\n            - /url: /rota\n        - listitem [ref=f1e154]:\n          - link \"Floors and policy\" [ref=f1e155] [cursor=pointer]:\n            - /url: /floors\n        - listitem [ref=f1e156]:\n          - link \"Attendance\" [ref=f1e157] [cursor=pointer]:\n            - /url: /attendance\n        - listitem [ref=f1e158]:\n          - link \"Audit log\" [ref=f1e159] [cursor=pointer]:\n            - /url: /audit\n        - listitem [ref=f1e160]:\n          - link \"Profile\" [ref=f1e161] [cursor=pointer]:\n            - /url: /profile\n    - navigation \"Homes and units\" [ref=f1e163]:\n      - list [ref=f1e164]:\n        - listitem [ref=f1e165]:\n          - strong [ref=f1e166]: Larchfield House\n        - listitem [ref=f1e167]:\n          - link \"Rowan\" [ref=f1e168] [cursor=pointer]:\n            - /url: /rota?unit=larchfield-rowan\n        - listitem [ref=f1e169]:\n          - link \"Willow\" [ref=f1e170] [cursor=pointer]:\n            - /url: /rota?unit=larchfield-willow\n    - button \"Sign out\" [ref=f1e171] [cursor=pointer]\n  - main [ref=f1e172]:\n    - generic [ref=f1e173]:\n      - generic [ref=f1e174]:\n        - heading \"Queue\" [level=1] [ref=f1e175]\n        - group \"Queue filters\" [ref=f1e176]:\n          - generic [ref=f1e177]:\n            - text: Home\n            - combobox \"Home\" [ref=f1e178]:\n              - option \"Larchfield House\" [selected]\n          - generic [ref=f1e179]:\n            - text: Status\n            - combobox \"Status\" [ref=f1e180]:\n              - option \"Open\" [selected]\n              - option \"Submitted\"\n              - option \"Escalated\"\n              - option \"Cover pending\"\n              - option \"Approved\"\n              - option \"Declined\"\n              - option \"Withdrawn\"\n              - option \"Cancelled\"\n          - generic [ref=f1e181]:\n            - text: Week\n            - combobox \"Week\" [ref=f1e182]:\n              - option \"All weeks\" [selected]\n              - option \"2026-W40\"\n              - option \"2026-W41\"\n              - option \"2026-W42\"\n              - option \"2026-W43\"\n              - option \"2026-W44\"\n              - option \"2026-W45\"\n              - option \"2026-W46\"\n              - option \"2026-W47\"\n              - option \"2026-W48\"\n              - option \"2026-W49\"\n              - option \"2026-W50\"\n              - option \"2026-W51\"\n              - option \"2026-W52\"\n              - option \"2026-W53\"\n              - option \"2027-W01\"\n              - option \"2027-W02\"\n              - option \"2027-W03\"\n        - region \"Queue counts\" [ref=f1e183]:\n          - generic [ref=f1e184]: Submitted 5\n          - generic [ref=f1e185]: Escalated 0\n          - generic [ref=f1e186]: Cover pending 1\n          - generic [ref=f1e187]: Approved 0\n          - generic [ref=f1e188]: Declined 0\n        - listbox \"Requests\" [ref=f1e189]:\n          - option \"Priya Raman, Unpaid leave, Wed 16 Dec 2026 to Wed 16 Dec 2026, Submitted\" [ref=f1e190] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 16 Dec 2026 to Wed 16 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Thu 17 Dec 2026 to Thu 17 Dec 2026, Submitted\" [ref=f1e191] [cursor=pointer]: Priya Raman · Unpaid leave · Thu 17 Dec 2026 to Thu 17 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Fri 18 Dec 2026 to Fri 18 Dec 2026, Submitted\" [ref=f1e192] [cursor=pointer]: Priya Raman · Unpaid leave · Fri 18 Dec 2026 to Fri 18 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Sat 19 Dec 2026 to Sat 19 Dec 2026, Cover pending\" [ref=f1e193] [cursor=pointer]: Priya Raman · Unpaid leave · Sat 19 Dec 2026 to Sat 19 Dec 2026 · Cover pending\n          - option \"Priya Raman, Unpaid leave, Sun 20 Dec 2026 to Sun 20 Dec 2026, Submitted\" [ref=f1e194] [cursor=pointer]: Priya Raman · Unpaid leave · Sun 20 Dec 2026 to Sun 20 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Wed 6 Jan 2027 to Wed 6 Jan 2027, Submitted\" [selected] [ref=f1e195] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 6 Jan 2027 to Wed 6 Jan 2027 · Submitted\n      - generic [ref=f1e196]:\n        - region \"Request detail\" [ref=f1e197]:\n          - generic [ref=f1e198]: Priya Raman\n          - generic [ref=f1e199]:\n            - paragraph [ref=f1e200]: Unpaid leave · Wed 6 Jan 2027 to Wed 6 Jan 2027 · 8.00 hours\n            - paragraph [ref=f1e201]: Submitted\n            - paragraph [ref=f1e202]: QA-B9-8C4Z\n          - button \"Preview approval\" [ref=f1e203] [cursor=pointer]\n          - group \"Staffing strip\" [ref=f1e204]:\n            - generic [ref=f1e205]:\n              - generic [ref=f1e206]: Wed 6 Jan\n              - generic [ref=f1e207]:\n                - 'group \"Wed 6 Jan Early: 4 on duty, floor 4\" [ref=f1e208]':\n                  - generic [ref=f1e211]: \"4\"\n                - 'group \"Wed 6 Jan Late: 4 on duty, floor 4\" [ref=f1e213]':\n                  - generic [ref=f1e216]: \"4\"\n                - 'group \"Wed 6 Jan Night: 3 on duty, floor 3\" [ref=f1e218]':\n                  - generic [ref=f1e222]: \"3\"\n            - generic [ref=f1e224]:\n              - generic [ref=f1e225]: Thu 7 Jan\n              - generic [ref=f1e226]:\n                - 'group \"Thu 7 Jan Early: 4 on duty, floor 4\" [ref=f1e227]':\n                  - generic [ref=f1e231]: \"4\"\n                - 'group \"Thu 7 Jan Late: 4 on duty, floor 4\" [ref=f1e233]':\n                  - generic [ref=f1e236]: \"4\"\n                - 'group \"Thu 7 Jan Night: 3 on duty, floor 3\" [ref=f1e238]':\n                  - generic [ref=f1e242]: \"3\"\n            - generic [ref=f1e244]:\n              - generic [ref=f1e245]: Fri 8 Jan\n              - generic [ref=f1e246]:\n                - 'group \"Fri 8 Jan Early: 4 on duty, floor 4\" [ref=f1e247]':\n                  - generic [ref=f1e251]: \"4\"\n                - 'group \"Fri 8 Jan Late: 4 on duty, floor 4\" [ref=f1e253]':\n                  - generic [ref=f1e256]: \"4\"\n                - 'group \"Fri 8 Jan Night: 3 on duty, floor 3\" [ref=f1e258]':\n                  - generic [ref=f1e262]: \"3\"\n            - generic [ref=f1e264]:\n              - generic [ref=f1e265]: Sat 9 Jan\n              - generic [ref=f1e266]:\n                - 'group \"Sat 9 Jan Early: 4 on duty, floor 4\" [ref=f1e267]':\n                  - generic [ref=f1e271]: \"4\"\n                - 'group \"Sat 9 Jan Late: 4 on duty, floor 4\" [ref=f1e273]':\n                  - generic [ref=f1e276]: \"4\"\n                - 'group \"Sat 9 Jan Night: 3 on duty, floor 3\" [ref=f1e278]':\n                  - generic [ref=f1e282]: \"3\"\n            - generic [ref=f1e284]:\n              - generic [ref=f1e285]: Sun 10 Jan\n              - generic [ref=f1e286]:\n                - 'group \"Sun 10 Jan Early: 4 on duty, floor 4\" [ref=f1e287]':\n                  - generic [ref=f1e291]: \"4\"\n                - 'group \"Sun 10 Jan Late: 4 on duty, floor 4\" [ref=f1e293]':\n                  - generic [ref=f1e296]: \"4\"\n                - 'group \"Sun 10 Jan Night: 3 on duty, floor 3\" [ref=f1e298]':\n                  - generic [ref=f1e302]: \"3\"\n            - generic [ref=f1e304]:\n              - generic [ref=f1e305]: Mon 11 Jan\n              - generic [ref=f1e306]:\n                - 'group \"Mon 11 Jan Early: 4 on duty, floor 4\" [ref=f1e307]':\n                  - generic [ref=f1e311]: \"4\"\n                - 'group \"Mon 11 Jan Late: 4 on duty, floor 4\" [ref=f1e313]':\n                  - generic [ref=f1e316]: \"4\"\n                - 'group \"Mon 11 Jan Night: 3 on duty, floor 3\" [ref=f1e318]':\n                  - generic [ref=f1e322]: \"3\"\n            - generic [ref=f1e324]:\n              - generic [ref=f1e325]: Tue 12 Jan\n              - generic [ref=f1e326]:\n                - 'group \"Tue 12 Jan Early: 4 on duty, floor 4\" [ref=f1e327]':\n                  - generic [ref=f1e331]: \"4\"\n                - 'group \"Tue 12 Jan Late: 4 on duty, floor 4\" [ref=f1e333]':\n                  - generic [ref=f1e336]: \"4\"\n                - 'group \"Tue 12 Jan Night: 3 on duty, floor 3\" [ref=f1e338]':\n                  - generic [ref=f1e342]: \"3\"\n          - button \"Cover\" [ref=f1e344] [cursor=pointer]\n          - generic [ref=f1e345]:\n            - button \"Previous 7 days\" [ref=f1e346] [cursor=pointer]\n            - button \"Next 7 days\" [ref=f1e347] [cursor=pointer]\n            - button \"Approve\" [disabled] [ref=f1e348]\n            - button \"Approve with override\" [ref=f1e349] [cursor=pointer]\n            - button \"Decline\" [ref=f1e350] [cursor=pointer]\n          - generic [ref=f1e351]: Cover every gap or approve with override\n        - status \"Queue status\" [ref=f1e352]\n        - status \"Strip announcements\" [ref=f1e353]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Preview approval",
  "target": "button:has-text('Preview approval')"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/queue?home=larchfield&status=open&week=&request=lrq-c7bd42442ac04f138c21cb40a65095b9\n- Page Title: Tallow Cover\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e139]:\n  - complementary [ref=f1e140]:\n    - paragraph [ref=f1e141]: Tallow Cover\n    - navigation \"Main\" [ref=f1e142]:\n      - list [ref=f1e143]:\n        - listitem [ref=f1e144]:\n          - link \"Queue\" [ref=f1e145] [cursor=pointer]:\n            - /url: /queue\n        - listitem [ref=f1e146]:\n          - link \"Today\" [ref=f1e147] [cursor=pointer]:\n            - /url: /today\n        - listitem [ref=f1e148]:\n          - link \"Request leave\" [ref=f1e149] [cursor=pointer]:\n            - /url: /leave/new\n        - listitem [ref=f1e150]:\n          - link \"My requests\" [ref=f1e151] [cursor=pointer]:\n            - /url: /leave\n        - listitem [ref=f1e152]:\n          - link \"Team rota\" [ref=f1e153] [cursor=pointer]:\n            - /url: /rota\n        - listitem [ref=f1e154]:\n          - link \"Floors and policy\" [ref=f1e155] [cursor=pointer]:\n            - /url: /floors\n        - listitem [ref=f1e156]:\n          - link \"Attendance\" [ref=f1e157] [cursor=pointer]:\n            - /url: /attendance\n        - listitem [ref=f1e158]:\n          - link \"Audit log\" [ref=f1e159] [cursor=pointer]:\n            - /url: /audit\n        - listitem [ref=f1e160]:\n          - link \"Profile\" [ref=f1e161] [cursor=pointer]:\n            - /url: /profile\n    - navigation \"Homes and units\" [ref=f1e163]:\n      - list [ref=f1e164]:\n        - listitem [ref=f1e165]:\n          - strong [ref=f1e166]: Larchfield House\n        - listitem [ref=f1e167]:\n          - link \"Rowan\" [ref=f1e168] [cursor=pointer]:\n            - /url: /rota?unit=larchfield-rowan\n        - listitem [ref=f1e169]:\n          - link \"Willow\" [ref=f1e170] [cursor=pointer]:\n            - /url: /rota?unit=larchfield-willow\n    - button \"Sign out\" [ref=f1e171] [cursor=pointer]\n  - main [ref=f1e172]:\n    - generic [ref=f1e173]:\n      - generic [ref=f1e174]:\n        - heading \"Queue\" [level=1] [ref=f1e175]\n        - group \"Queue filters\" [ref=f1e176]:\n          - generic [ref=f1e177]:\n            - text: Home\n            - combobox \"Home\" [ref=f1e178]:\n              - option \"Larchfield House\" [selected]\n          - generic [ref=f1e179]:\n            - text: Status\n            - combobox \"Status\" [ref=f1e180]:\n              - option \"Open\" [selected]\n              - option \"Submitted\"\n              - option \"Escalated\"\n              - option \"Cover pending\"\n              - option \"Approved\"\n              - option \"Declined\"\n              - option \"Withdrawn\"\n              - option \"Cancelled\"\n          - generic [ref=f1e181]:\n            - text: Week\n            - combobox \"Week\" [ref=f1e182]:\n              - option \"All weeks\" [selected]\n              - option \"2026-W40\"\n              - option \"2026-W41\"\n              - option \"2026-W42\"\n              - option \"2026-W43\"\n              - option \"2026-W44\"\n              - option \"2026-W45\"\n              - option \"2026-W46\"\n              - option \"2026-W47\"\n              - option \"2026-W48\"\n              - option \"2026-W49\"\n              - option \"2026-W50\"\n              - option \"2026-W51\"\n              - option \"2026-W52\"\n              - option \"2026-W53\"\n              - option \"2027-W01\"\n              - option \"2027-W02\"\n              - option \"2027-W03\"\n        - region \"Queue counts\" [ref=f1e183]:\n          - generic [ref=f1e184]: Submitted 5\n          - generic [ref=f1e185]: Escalated 0\n          - generic [ref=f1e186]: Cover pending 1\n          - generic [ref=f1e187]: Approved 0\n          - generic [ref=f1e188]: Declined 0\n        - listbox \"Requests\" [ref=f1e189]:\n          - option \"Priya Raman, Unpaid leave, Wed 16 Dec 2026 to Wed 16 Dec 2026, Submitted\" [ref=f1e190] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 16 Dec 2026 to Wed 16 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Thu 17 Dec 2026 to Thu 17 Dec 2026, Submitted\" [ref=f1e191] [cursor=pointer]: Priya Raman · Unpaid leave · Thu 17 Dec 2026 to Thu 17 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Fri 18 Dec 2026 to Fri 18 Dec 2026, Submitted\" [ref=f1e192] [cursor=pointer]: Priya Raman · Unpaid leave · Fri 18 Dec 2026 to Fri 18 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Sat 19 Dec 2026 to Sat 19 Dec 2026, Cover pending\" [ref=f1e193] [cursor=pointer]: Priya Raman · Unpaid leave · Sat 19 Dec 2026 to Sat 19 Dec 2026 · Cover pending\n          - option \"Priya Raman, Unpaid leave, Sun 20 Dec 2026 to Sun 20 Dec 2026, Submitted\" [ref=f1e194] [cursor=pointer]: Priya Raman · Unpaid leave · Sun 20 Dec 2026 to Sun 20 Dec 2026 · Submitted\n          - option \"Priya Raman, Unpaid leave, Wed 6 Jan 2027 to Wed 6 Jan 2027, Submitted\" [selected] [ref=f1e195] [cursor=pointer]: Priya Raman · Unpaid leave · Wed 6 Jan 2027 to Wed 6 Jan 2027 · Submitted\n      - generic [ref=f1e196]:\n        - region \"Request detail\" [ref=f1e197]:\n          - generic [ref=f1e198]: Priya Raman\n          - generic [ref=f1e199]:\n            - paragraph [ref=f1e200]: Unpaid leave · Wed 6 Jan 2027 to Wed 6 Jan 2027 · 8.00 hours\n            - paragraph [ref=f1e201]: Submitted\n            - paragraph [ref=f1e202]: QA-B9-8C4Z\n          - button \"Preview approval\" [active] [pressed] [ref=f1e203] [cursor=pointer]\n          - group \"Staffing strip\" [ref=f1e204]:\n            - generic [ref=f1e205]:\n              - generic [ref=f1e206]: Wed 6 Jan\n              - generic [ref=f1e207]:\n                - 'group \"Wed 6 Jan Early: 3 on duty, floor 4, 1 below floor, no senior on shift\" [ref=f1e354]':\n                  - generic [ref=f1e211]:\n                    - button \"Post cover for Wed 6 Jan Early (senior)\" [ref=f1e356] [cursor=pointer]\n                    - generic [ref=f1e212]: \"3\"\n                    - generic [ref=f1e357]: 4 → 3\n                    - generic [ref=f1e358]:\n                      - generic [ref=f1e359]: \"-1 below floor\"\n                      - generic [ref=f1e360]: no senior on shift\n                - 'group \"Wed 6 Jan Late: 4 on duty, floor 4\" [ref=f1e213]':\n                  - generic [ref=f1e216]: \"4\"\n                - 'group \"Wed 6 Jan Night: 3 on duty, floor 3\" [ref=f1e218]':\n                  - generic [ref=f1e222]: \"3\"\n            - generic [ref=f1e224]:\n              - generic [ref=f1e225]: Thu 7 Jan\n              - generic [ref=f1e226]:\n                - 'group \"Thu 7 Jan Early: 4 on duty, floor 4\" [ref=f1e227]':\n                  - generic [ref=f1e231]: \"4\"\n                - 'group \"Thu 7 Jan Late: 4 on duty, floor 4\" [ref=f1e233]':\n                  - generic [ref=f1e236]: \"4\"\n                - 'group \"Thu 7 Jan Night: 3 on duty, floor 3\" [ref=f1e238]':\n                  - generic [ref=f1e242]: \"3\"\n            - generic [ref=f1e244]:\n              - generic [ref=f1e245]: Fri 8 Jan\n              - generic [ref=f1e246]:\n                - 'group \"Fri 8 Jan Early: 4 on duty, floor 4\" [ref=f1e247]':\n                  - generic [ref=f1e251]: \"4\"\n                - 'group \"Fri 8 Jan Late: 4 on duty, floor 4\" [ref=f1e253]':\n                  - generic [ref=f1e256]: \"4\"\n                - 'group \"Fri 8 Jan Night: 3 on duty, floor 3\" [ref=f1e258]':\n                  - generic [ref=f1e262]: \"3\"\n            - generic [ref=f1e264]:\n              - generic [ref=f1e265]: Sat 9 Jan\n              - generic [ref=f1e266]:\n                - 'group \"Sat 9 Jan Early: 4 on duty, floor 4\" [ref=f1e267]':\n                  - generic [ref=f1e271]: \"4\"\n                - 'group \"Sat 9 Jan Late: 4 on duty, floor 4\" [ref=f1e273]':\n                  - generic [ref=f1e276]: \"4\"\n                - 'group \"Sat 9 Jan Night: 3 on duty, floor 3\" [ref=f1e278]':\n                  - generic [ref=f1e282]: \"3\"\n            - generic [ref=f1e284]:\n              - generic [ref=f1e285]: Sun 10 Jan\n              - generic [ref=f1e286]:\n                - 'group \"Sun 10 Jan Early: 4 on duty, floor 4\" [ref=f1e287]':\n                  - generic [ref=f1e291]: \"4\"\n                - 'group \"Sun 10 Jan Late: 4 on duty, floor 4\" [ref=f1e293]':\n                  - generic [ref=f1e296]: \"4\"\n                - 'group \"Sun 10 Jan Night: 3 on duty, floor 3\" [ref=f1e298]':\n                  - generic [ref=f1e302]: \"3\"\n            - generic [ref=f1e304]:\n              - generic [ref=f1e305]: Mon 11 Jan\n              - generic [ref=f1e306]:\n                - 'group \"Mon 11 Jan Early: 4 on duty, floor 4\" [ref=f1e307]':\n                  - generic [ref=f1e311]: \"4\"\n                - 'group \"Mon 11 Jan Late: 4 on duty, floor 4\" [ref=f1e313]':\n                  - generic [ref=f1e316]: \"4\"\n                - 'group \"Mon 11 Jan Night: 3 on duty, floor 3\" [ref=f1e318]':\n                  - generic [ref=f1e322]: \"3\"\n            - generic [ref=f1e324]:\n              - generic [ref=f1e325]: Tue 12 Jan\n              - generic [ref=f1e326]:\n                - 'group \"Tue 12 Jan Early: 4 on duty, floor 4\" [ref=f1e327]':\n                  - generic [ref=f1e331]: \"4\"\n                - 'group \"Tue 12 Jan Late: 4 on duty, floor 4\" [ref=f1e333]':\n                  - generic [ref=f1e336]: \"4\"\n                - 'group \"Tue 12 Jan Night: 3 on duty, floor 3\" [ref=f1e338]':\n                  - generic [ref=f1e342]: \"3\"\n          - button \"Cover\" [ref=f1e344] [cursor=pointer]\n          - generic [ref=f1e345]:\n            - button \"Previous 7 days\" [ref=f1e346] [cursor=pointer]\n            - button \"Next 7 days\" [ref=f1e347] [cursor=pointer]\n            - button \"Approve\" [disabled] [ref=f1e348]\n            - button \"Approve with override\" [ref=f1e349] [cursor=pointer]\n            - button \"Decline\" [ref=f1e350] [cursor=pointer]\n          - generic [ref=f1e351]: Cover every gap or approve with override\n        - status \"Queue status\" [ref=f1e352]\n        - status \"Strip announcements\" [ref=f1e353]: \"Approving would leave 1 shift below floor: Wed Early\""
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "()=>{const cells=[...document.querySelectorAll('[aria-label=\"Staffing strip\"] .strip-cell')];return cells.slice(0,2).map((c,i)=>{const b=c.querySelector('.bar'),s=getComputedStyle(b);return {i,cellClass:c.className,barClass:b.className,bg:s.backgroundColor,opacity:s.opacity,backgroundImage:s.backgroundImage}})}"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"i\": 0,\n    \"cellClass\": \"strip-cell changed breach\",\n    \"barClass\": \"bar\",\n    \"bg\": \"rgb(21, 32, 43)\",\n    \"opacity\": \"1\",\n    \"backgroundImage\": \"none\"\n  },\n  {\n    \"i\": 1,\n    \"cellClass\": \"strip-cell\",\n    \"barClass\": \"bar\",\n    \"bg\": \"rgba(21, 32, 43, 0.42)\",\n    \"opacity\": \"1\",\n    \"backgroundImage\": \"none\"\n  }\n]"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Staffing strip",
  "target": "[aria-label='Staffing strip']",
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of Staffing strip](evidence/reduced/element-2026-10-30T01-04-19-739Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
