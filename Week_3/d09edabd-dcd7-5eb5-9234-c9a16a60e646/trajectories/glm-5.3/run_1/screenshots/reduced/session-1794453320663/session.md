
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
  "url": "http://127.0.0.1:4173/signin"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Keyway Bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- form \"Sign in\" [ref=e4]:\n  - heading \"Keyway bench\" [level=2] [ref=e6]\n  - generic [ref=e7]:\n    - generic [ref=e8]: Email\n    - textbox \"Email\" [ref=e9]\n  - generic [ref=e10]:\n    - generic [ref=e11]: Password\n    - textbox \"Password\" [ref=e12]\n  - button \"Sign in\" [ref=e13] [cursor=pointer]\n  - paragraph [ref=e14]:\n    - link \"Back to the tour\" [ref=e15] [cursor=pointer]:\n      - /url: /",
  "events": "- New console entries: evidence/reduced/console-2026-11-12T03-15-23-196Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Keyway Bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- form \"Sign in\" [ref=e4]:\n  - heading \"Keyway bench\" [level=2] [ref=e6]\n  - generic [ref=e7]:\n    - generic [ref=e8]: Email\n    - textbox \"Email\" [ref=e9]\n  - generic [ref=e10]:\n    - generic [ref=e11]: Password\n    - textbox \"Password\" [ref=e12]\n  - button \"Sign in\" [ref=e13] [cursor=pointer]\n  - paragraph [ref=e14]:\n    - link \"Back to the tour\" [ref=e15] [cursor=pointer]:\n      - /url: /",
  "events": "- New console entries: evidence/reduced/console-2026-11-12T03-15-23-196Z.log#L2"
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
      "value": "mara@lanternlane.test"
    },
    {
      "target": "e12",
      "name": "Password",
      "type": "textbox",
      "value": "wrong"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Keyway Bench\n- Console: 2 errors, 0 warnings",
  "snapshot": "- form \"Sign in\" [ref=e4]:\n  - heading \"Keyway bench\" [level=2] [ref=e6]\n  - generic [ref=e7]:\n    - generic [ref=e8]: Email\n    - textbox \"Email\" [ref=e9]: mara@lanternlane.test\n  - generic [ref=e10]:\n    - generic [ref=e11]: Password\n    - textbox \"Password\" [ref=e12]: wrong\n  - button \"Sign in\" [active] [ref=e13] [cursor=pointer]\n  - status [ref=e16]: That email and password don't match.\n  - paragraph [ref=e14]:\n    - link \"Back to the tour\" [ref=e15] [cursor=pointer]:\n      - /url: /",
  "events": "- New console entries: evidence/reduced/console-2026-11-12T03-15-23-196Z.log#L3"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e12",
      "name": "Password",
      "type": "textbox",
      "value": "keyway-owner-1"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Keyway Bench",
  "snapshot": ""
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/app"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway Bench",
  "snapshot": "- generic [ref=f3e2]:\n  - status [ref=f3e3]\n  - status [ref=f3e4]: Overview\n  - dialog \"Open a room\" [ref=f3e6]:\n    - generic [ref=f3e7]:\n      - generic [ref=f3e8]: Keyway bench\n      - button \"Close\" [ref=f3e11] [cursor=pointer]\n    - generic [ref=f3e13]: bench 1.0.0\n    - generic [ref=f3e14]:\n      - button \"Back\" [disabled] [ref=f3e15] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f3e17]\n    - generic [ref=f3e18]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f3e19]\n    - link \"New room\" [ref=f3e22] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f3e23]:\n      - generic [ref=f3e24]:\n        - checkbox \"Walk in when I pick a room\" [checked] [ref=f3e25]\n        - text: Walk in when I pick a room\n      - generic [ref=f3e26]:\n        - link \"Prop library\" [ref=f3e27] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Versions\" [ref=f3e28] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Keyboard shortcuts\" [ref=f3e29] [cursor=pointer]:\n          - /url: \"#\""
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
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f3e2]:\n  - status [ref=f3e3]\n  - status [ref=f3e4]: Overview\n  - dialog \"Open a room\" [ref=f3e6]:\n    - generic [ref=f3e7]:\n      - generic [ref=f3e8]: Keyway bench\n      - button \"Close\" [ref=f3e11] [cursor=pointer]\n    - generic [ref=f3e13]: bench 1.0.0\n    - generic [ref=f3e14]:\n      - button \"Back\" [disabled] [ref=f3e15] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f3e17]\n    - generic [ref=f3e18]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f3e19]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [active] [selected] [ref=f3e35] [cursor=pointer]:\n        - generic [ref=f3e36]\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f3e38] [cursor=pointer]:\n        - generic [ref=f3e39]\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f3e41] [cursor=pointer]:\n        - generic [ref=f3e42]\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f3e44] [cursor=pointer]:\n        - generic [ref=f3e45]\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f3e47] [cursor=pointer]:\n        - generic [ref=f3e48]\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f3e50] [cursor=pointer]:\n        - generic [ref=f3e51]\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f3e53] [cursor=pointer]:\n        - generic [ref=f3e54]\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f3e56] [cursor=pointer]:\n        - generic [ref=f3e57]\n    - link \"New room\" [ref=f3e22] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f3e23]:\n      - generic [ref=f3e24]:\n        - checkbox \"Walk in when I pick a room\" [checked] [ref=f3e25]\n        - text: Walk in when I pick a room\n      - generic [ref=f3e26]:\n        - link \"Prop library\" [ref=f3e27] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Versions\" [ref=f3e28] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Keyboard shortcuts\" [ref=f3e29] [cursor=pointer]:\n          - /url: \"#\""
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Close",
  "target": "f3e11"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway Bench",
  "snapshot": "- generic [ref=f3e2]:\n  - status [ref=f3e3]\n  - status [ref=f3e4]: Overview"
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
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f3e2]:\n  - status [ref=f3e3]\n  - status [ref=f3e4]: Overview"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/app"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway Bench",
  "snapshot": "- generic [ref=f4e2]:\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - dialog \"Open a room\" [ref=f4e6]:\n    - generic [ref=f4e7]:\n      - generic [ref=f4e8]: Keyway bench\n      - button \"Close\" [ref=f4e11] [cursor=pointer]\n    - generic [ref=f4e13]: bench 1.0.0\n    - generic [ref=f4e14]:\n      - button \"Back\" [disabled] [ref=f4e15] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e17]\n    - generic [ref=f4e18]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e19]\n    - link \"New room\" [ref=f4e22] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e23]:\n      - generic [ref=f4e24]:\n        - checkbox \"Walk in when I pick a room\" [checked] [ref=f4e25]\n        - text: Walk in when I pick a room\n      - generic [ref=f4e26]:\n        - link \"Prop library\" [ref=f4e27] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Versions\" [ref=f4e28] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Keyboard shortcuts\" [ref=f4e29] [cursor=pointer]:\n          - /url: \"#\""
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "New room",
  "target": "f4e22"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway Bench",
  "snapshot": "- generic [ref=f4e2]:\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - dialog \"Open a room\" [ref=f4e6]:\n    - generic [ref=f4e7]:\n      - generic [ref=f4e8]: Keyway bench\n      - button \"Close\" [ref=f4e11] [cursor=pointer]\n    - generic [ref=f4e13]: bench 1.0.0\n    - generic [ref=f4e14]:\n      - button \"Back\" [disabled] [ref=f4e15] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e17]\n    - generic [ref=f4e18]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e19]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [selected] [ref=f4e35] [cursor=pointer]:\n        - generic [ref=f4e36]:\n          - generic [ref=f4e37]: Apothecary\n          - text: 0 of 6 solved · Longest run 3 · 4 props\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e38] [cursor=pointer]:\n        - generic [ref=f4e39]:\n          - generic [ref=f4e40]: Clockmaker's Study\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e41] [cursor=pointer]:\n        - generic [ref=f4e42]:\n          - generic [ref=f4e43]: Judge Pack qzmtvk\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e44] [cursor=pointer]:\n        - generic [ref=f4e45]:\n          - generic [ref=f4e46]: Judge Pack xkqjrw\n          - text: 0 of 1 solved · Longest run 1 · 3 props\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e47] [cursor=pointer]:\n        - generic [ref=f4e48]:\n          - generic [ref=f4e49]: Observatory\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f4e50] [cursor=pointer]:\n        - generic [ref=f4e51]:\n          - generic [ref=f4e52]: Ship's Hold\n          - text: 0 of 5 solved · Longest run 5 · 4 props\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e53] [cursor=pointer]:\n        - generic [ref=f4e54]:\n          - generic [ref=f4e55]: Signal Cabin\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f4e56] [cursor=pointer]:\n        - generic [ref=f4e57]:\n          - generic [ref=f4e58]: Vault\n          - text: 0 of 6 solved · Longest run 6 · 3 props\n    - link \"New room\" [ref=f4e22] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e23]:\n      - generic [ref=f4e24]:\n        - checkbox \"Walk in when I pick a room\" [checked] [ref=f4e25]\n        - text: Walk in when I pick a room\n      - generic [ref=f4e26]:\n        - link \"Prop library\" [ref=f4e27] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Versions\" [ref=f4e28] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Keyboard shortcuts\" [ref=f4e29] [cursor=pointer]:\n          - /url: \"#\"\n  - dialog \"New room\" [ref=f4e60]:\n    - generic [ref=f4e61]:\n      - heading \"New room\" [level=2] [ref=f4e62]\n      - button \"Close\" [active] [ref=f4e63] [cursor=pointer]\n    - generic [ref=f4e68]:\n      - generic [ref=f4e69]:\n        - generic [ref=f4e70]: Room name\n        - textbox \"Room name\" [ref=f4e71]\n      - generic [ref=f4e72]:\n        - generic [ref=f4e73]:\n          - generic [ref=f4e74]: Width (m)\n          - textbox \"Width (m)\" [ref=f4e75]\n        - generic [ref=f4e76]:\n          - generic [ref=f4e77]: Depth (m)\n          - textbox \"Depth (m)\" [ref=f4e78]\n        - generic [ref=f4e79]:\n          - generic [ref=f4e80]: Height (m)\n          - textbox \"Height (m)\" [ref=f4e81]\n      - button \"Create room\" [disabled] [ref=f4e82] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f4e2]:\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - dialog \"Open a room\" [ref=f4e6]:\n    - generic [ref=f4e7]:\n      - generic [ref=f4e8]: Keyway bench\n      - button \"Close\" [ref=f4e11] [cursor=pointer]\n    - generic [ref=f4e13]: bench 1.0.0\n    - generic [ref=f4e14]:\n      - button \"Back\" [disabled] [ref=f4e15] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e17]\n    - generic [ref=f4e18]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e19]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [selected] [ref=f4e35] [cursor=pointer]:\n        - generic [ref=f4e36]:\n          - generic [ref=f4e37]: Apothecary\n          - text: 0 of 6 solved · Longest run 3 · 4 props\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e38] [cursor=pointer]:\n        - generic [ref=f4e39]:\n          - generic [ref=f4e40]: Clockmaker's Study\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e41] [cursor=pointer]:\n        - generic [ref=f4e42]:\n          - generic [ref=f4e43]: Judge Pack qzmtvk\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e44] [cursor=pointer]:\n        - generic [ref=f4e45]:\n          - generic [ref=f4e46]: Judge Pack xkqjrw\n          - text: 0 of 1 solved · Longest run 1 · 3 props\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e47] [cursor=pointer]:\n        - generic [ref=f4e48]:\n          - generic [ref=f4e49]: Observatory\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f4e50] [cursor=pointer]:\n        - generic [ref=f4e51]:\n          - generic [ref=f4e52]: Ship's Hold\n          - text: 0 of 5 solved · Longest run 5 · 4 props\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e53] [cursor=pointer]:\n        - generic [ref=f4e54]:\n          - generic [ref=f4e55]: Signal Cabin\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f4e56] [cursor=pointer]:\n        - generic [ref=f4e57]:\n          - generic [ref=f4e58]: Vault\n          - text: 0 of 6 solved · Longest run 6 · 3 props\n    - link \"New room\" [ref=f4e22] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e23]:\n      - generic [ref=f4e24]:\n        - checkbox \"Walk in when I pick a room\" [checked] [ref=f4e25]\n        - text: Walk in when I pick a room\n      - generic [ref=f4e26]:\n        - link \"Prop library\" [ref=f4e27] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Versions\" [ref=f4e28] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Keyboard shortcuts\" [ref=f4e29] [cursor=pointer]:\n          - /url: \"#\"\n  - dialog \"New room\" [ref=f4e60]:\n    - generic [ref=f4e61]:\n      - heading \"New room\" [level=2] [ref=f4e62]\n      - button \"Close\" [active] [ref=f4e63] [cursor=pointer]\n    - generic [ref=f4e68]:\n      - generic [ref=f4e69]:\n        - generic [ref=f4e70]: Room name\n        - textbox \"Room name\" [ref=f4e71]\n      - generic [ref=f4e72]:\n        - generic [ref=f4e73]:\n          - generic [ref=f4e74]: Width (m)\n          - textbox \"Width (m)\" [ref=f4e75]\n        - generic [ref=f4e76]:\n          - generic [ref=f4e77]: Depth (m)\n          - textbox \"Depth (m)\" [ref=f4e78]\n        - generic [ref=f4e79]:\n          - generic [ref=f4e80]: Height (m)\n          - textbox \"Height (m)\" [ref=f4e81]\n      - button \"Create room\" [disabled] [ref=f4e82] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f4e71",
      "name": "Room name",
      "type": "textbox",
      "value": "Judge Walk rtpnuz"
    },
    {
      "target": "f4e75",
      "name": "Width",
      "type": "textbox",
      "value": "4"
    },
    {
      "target": "f4e78",
      "name": "Depth",
      "type": "textbox",
      "value": "3"
    },
    {
      "target": "f4e81",
      "name": "Height",
      "type": "textbox",
      "value": "2.4"
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
  "element": "Create room",
  "target": "f4e82"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/9MAlG-YlQGU6\n- Page Title: Keyway Bench",
  "snapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e84] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e88]:\n    - generic [ref=f4e90]: Live\n    - status [ref=f4e91]: All changes saved.\n    - generic \"Room code\" [ref=f4e92]: 9MALG-\n    - button \"Copy room code\" [ref=f4e93] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e98]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e99] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e100] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e101] [cursor=pointer]\n  - generic [ref=f4e106]:\n    - group \"Chain figures\" [ref=f4e107]:\n      - generic [ref=f4e108]: 0 of 0 solved\n      - generic [ref=f4e109]: Longest run 0\n      - generic [ref=f4e110]: 0 props\n    - button \"Presence\" [ref=f4e111] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e112] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e113]:\n    - tree \"Scene\" [ref=f4e114]:\n      - treeitem \"Judge Walk rtpnuz\" [expanded] [level=1] [ref=f4e115]\n  - generic [ref=f4e116]:\n    - button \"Add primitive\" [ref=f4e117] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e120] [cursor=pointer]\n  - generic [ref=f4e125]:\n    - button \"Cue timeline\" [ref=f4e126] [cursor=pointer]\n    - button \"Units\" [ref=f4e131] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e132]:\n    - button \"Move\" [pressed] [ref=f4e133] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e134] [cursor=pointer]\n    - button \"Scale\" [ref=f4e135] [cursor=pointer]\n    - button \"Start playtest\" [ref=f4e137] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e142] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e143] [cursor=pointer]\n    - button \"Next node\" [ref=f4e144] [cursor=pointer]\n  - region \"Room stage\" [ref=f4e145]\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - generic: This room is empty. Add a primitive or place a prop."
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/9MAlG-YlQGU6\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e84] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e88]:\n    - generic [ref=f4e90]: Live\n    - status [ref=f4e91]: All changes saved.\n    - generic \"Room code\" [ref=f4e92]: 9MALG-\n    - button \"Copy room code\" [ref=f4e93] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e98]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e99] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e100] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e101] [cursor=pointer]\n  - generic [ref=f4e106]:\n    - group \"Chain figures\" [ref=f4e107]\n    - button \"Presence\" [ref=f4e111] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e112] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e113]:\n    - tree \"Scene\" [ref=f4e114]\n  - generic [ref=f4e116]:\n    - button \"Add primitive\" [ref=f4e117] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e120] [cursor=pointer]\n  - generic [ref=f4e125]:\n    - button \"Cue timeline\" [ref=f4e126] [cursor=pointer]\n    - button \"Units\" [ref=f4e131] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e132]:\n    - button \"Move\" [pressed] [ref=f4e133] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e134] [cursor=pointer]\n    - button \"Scale\" [ref=f4e135] [cursor=pointer]\n    - button \"Start playtest\" [ref=f4e137] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e142] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e143] [cursor=pointer]\n    - button \"Next node\" [ref=f4e144] [cursor=pointer]\n  - region \"Room stage\" [ref=f4e145]\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - generic: This room is empty. Add a primitive or place a prop."
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Rooms",
  "target": "f4e84"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/9MAlG-YlQGU6\n- Page Title: Keyway Bench",
  "snapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e84] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e88]:\n    - generic [ref=f4e90]: Live\n    - status [ref=f4e91]: All changes saved.\n    - generic \"Room code\" [ref=f4e92]: 9MALG-\n    - button \"Copy room code\" [ref=f4e93] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e98]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e99] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e100] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e101] [cursor=pointer]\n  - generic [ref=f4e106]:\n    - group \"Chain figures\" [ref=f4e107]:\n      - generic [ref=f4e108]: 0 of 0 solved\n      - generic [ref=f4e109]: Longest run 0\n      - generic [ref=f4e110]: 0 props\n    - button \"Presence\" [ref=f4e111] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e112] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e113]:\n    - tree \"Scene\" [ref=f4e114]:\n      - treeitem \"Judge Walk rtpnuz\" [expanded] [level=1] [ref=f4e115]\n  - generic [ref=f4e116]:\n    - button \"Add primitive\" [ref=f4e117] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e120] [cursor=pointer]\n  - generic [ref=f4e125]:\n    - button \"Cue timeline\" [ref=f4e126] [cursor=pointer]\n    - button \"Units\" [ref=f4e131] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e132]:\n    - button \"Move\" [pressed] [ref=f4e133] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e134] [cursor=pointer]\n    - button \"Scale\" [ref=f4e135] [cursor=pointer]\n    - button \"Start playtest\" [ref=f4e137] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e142] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e143] [cursor=pointer]\n    - button \"Next node\" [ref=f4e144] [cursor=pointer]\n  - region \"Room stage\" [ref=f4e145]\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - generic: This room is empty. Add a primitive or place a prop.\n  - dialog \"Open a room\" [ref=f4e148]:\n    - generic [ref=f4e149]:\n      - generic [ref=f4e150]: Keyway bench\n      - button \"Close\" [ref=f4e153] [cursor=pointer]\n    - generic [ref=f4e158]: bench 1.0.0\n    - generic [ref=f4e159]:\n      - button \"Back\" [disabled] [ref=f4e160] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e164]\n    - generic [ref=f4e165]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e166]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [active] [selected] [ref=f4e167] [cursor=pointer]:\n        - generic [ref=f4e168]:\n          - generic [ref=f4e169]: Apothecary\n          - text: 0 of 6 solved · Longest run 3 · 4 props\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e170] [cursor=pointer]:\n        - generic [ref=f4e171]:\n          - generic [ref=f4e172]: Clockmaker's Study\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e173] [cursor=pointer]:\n        - generic [ref=f4e174]:\n          - generic [ref=f4e175]: Judge Pack qzmtvk\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e176] [cursor=pointer]:\n        - generic [ref=f4e177]:\n          - generic [ref=f4e178]: Judge Pack xkqjrw\n          - text: 0 of 1 solved · Longest run 1 · 3 props\n      - option \"Judge Walk rtpnuz 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e179] [cursor=pointer]:\n        - generic [ref=f4e180]:\n          - generic [ref=f4e181]: Judge Walk rtpnuz\n          - text: 0 of 0 solved · Longest run 0 · 0 props\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e182] [cursor=pointer]:\n        - generic [ref=f4e183]:\n          - generic [ref=f4e184]: Observatory\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f4e185] [cursor=pointer]:\n        - generic [ref=f4e186]:\n          - generic [ref=f4e187]: Ship's Hold\n          - text: 0 of 5 solved · Longest run 5 · 4 props\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e188] [cursor=pointer]:\n        - generic [ref=f4e189]:\n          - generic [ref=f4e190]: Signal Cabin\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f4e191] [cursor=pointer]:\n        - generic [ref=f4e192]:\n          - generic [ref=f4e193]: Vault\n          - text: 0 of 6 solved · Longest run 6 · 3 props\n    - link \"New room\" [ref=f4e195] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e196]:\n      - generic [ref=f4e197]:\n        - checkbox \"Walk in when I pick a room\" [checked] [ref=f4e198]\n        - text: Walk in when I pick a room\n      - generic [ref=f4e199]:\n        - link \"Prop library\" [ref=f4e200] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Versions\" [ref=f4e201] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Keyboard shortcuts\" [ref=f4e202] [cursor=pointer]:\n          - /url: \"#\""
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/9MAlG-YlQGU6\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e84] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e88]:\n    - generic [ref=f4e90]: Live\n    - status [ref=f4e91]: All changes saved.\n    - generic \"Room code\" [ref=f4e92]: 9MALG-\n    - button \"Copy room code\" [ref=f4e93] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e98]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e99] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e100] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e101] [cursor=pointer]\n  - generic [ref=f4e106]:\n    - group \"Chain figures\" [ref=f4e107]:\n      - generic [ref=f4e108]: 0 of 0 solved\n      - generic [ref=f4e109]: Longest run 0\n      - generic [ref=f4e110]: 0 props\n    - button \"Presence\" [ref=f4e111] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e112] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e113]:\n    - tree \"Scene\" [ref=f4e114]:\n      - treeitem \"Judge Walk rtpnuz\" [expanded] [level=1] [ref=f4e115]\n  - generic [ref=f4e116]:\n    - button \"Add primitive\" [ref=f4e117] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e120] [cursor=pointer]\n  - generic [ref=f4e125]:\n    - button \"Cue timeline\" [ref=f4e126] [cursor=pointer]\n    - button \"Units\" [ref=f4e131] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e132]:\n    - button \"Move\" [pressed] [ref=f4e133] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e134] [cursor=pointer]\n    - button \"Scale\" [ref=f4e135] [cursor=pointer]\n    - button \"Start playtest\" [ref=f4e137] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e142] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e143] [cursor=pointer]\n    - button \"Next node\" [ref=f4e144] [cursor=pointer]\n  - region \"Room stage\" [ref=f4e145]\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - generic: This room is empty. Add a primitive or place a prop.\n  - dialog \"Open a room\" [ref=f4e148]:\n    - generic [ref=f4e149]:\n      - generic [ref=f4e150]: Keyway bench\n      - button \"Close\" [ref=f4e153] [cursor=pointer]\n    - generic [ref=f4e158]: bench 1.0.0\n    - generic [ref=f4e159]:\n      - button \"Back\" [disabled] [ref=f4e160] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e164]\n    - generic [ref=f4e165]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e166]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [active] [selected] [ref=f4e167] [cursor=pointer]:\n        - generic [ref=f4e168]\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e170] [cursor=pointer]:\n        - generic [ref=f4e171]\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e173] [cursor=pointer]:\n        - generic [ref=f4e174]\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e176] [cursor=pointer]:\n        - generic [ref=f4e177]\n      - option \"Judge Walk rtpnuz 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e179] [cursor=pointer]:\n        - generic [ref=f4e180]\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e182] [cursor=pointer]:\n        - generic [ref=f4e183]\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f4e185] [cursor=pointer]:\n        - generic [ref=f4e186]\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e188] [cursor=pointer]:\n        - generic [ref=f4e189]\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f4e191] [cursor=pointer]:\n        - generic [ref=f4e192]\n    - link \"New room\" [ref=f4e195] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e196]:\n      - generic [ref=f4e197]:\n        - checkbox \"Walk in when I pick a room\" [checked] [ref=f4e198]\n        - text: Walk in when I pick a room\n      - generic [ref=f4e199]:\n        - link \"Prop library\" [ref=f4e200] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Versions\" [ref=f4e201] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Keyboard shortcuts\" [ref=f4e202] [cursor=pointer]:\n          - /url: \"#\""
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowDown"
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
  "key": "ArrowDown"
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
  "key": "ArrowDown"
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
  "key": "ArrowDown"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/room_signal_cabin\n- Page Title: Keyway Bench",
  "snapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e84] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e88]:\n    - generic [ref=f4e90]: Live\n    - status [ref=f4e91]: All changes saved.\n    - generic \"Room code\" [ref=f4e92]: ROOM_S\n    - button \"Copy room code\" [ref=f4e93] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e98]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e99] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e100] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e101] [cursor=pointer]\n  - generic [ref=f4e106]:\n    - group \"Chain figures\" [ref=f4e107]:\n      - generic [ref=f4e108]: 0 of 4 solved\n      - generic [ref=f4e109]: Longest run 2\n      - generic [ref=f4e110]: 2 props\n    - button \"Presence\" [ref=f4e111] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e112] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e113]:\n    - tree \"Scene\" [ref=f4e114]:\n      - treeitem \"Signal Cabin\" [expanded] [level=1] [ref=f4e203]\n      - treeitem \"Entry door\" [level=2] [ref=f4e204]\n      - treeitem \"Telegraph desk\" [level=2] [ref=f4e209]\n      - treeitem \"Lever frame\" [level=2] [ref=f4e214]\n  - generic [ref=f4e116]:\n    - button \"Add primitive\" [ref=f4e117] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e120] [cursor=pointer]\n  - generic [ref=f4e125]:\n    - button \"Cue timeline\" [ref=f4e126] [cursor=pointer]\n    - button \"Units\" [ref=f4e131] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e132]:\n    - button \"Move\" [pressed] [ref=f4e133] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e134] [cursor=pointer]\n    - button \"Scale\" [ref=f4e135] [cursor=pointer]\n    - button \"Stop playtest\" [ref=f4e219] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e142] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e143] [cursor=pointer]\n    - button \"Next node\" [ref=f4e144] [cursor=pointer]\n    - timer \"Playtest clock\" [ref=f4e222]: 60:00\n  - region \"Room stage\" [ref=f4e145]\n  - status [ref=f4e3]: Playtest running.\n  - status [ref=f4e4]: Player height"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/room_signal_cabin\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e84] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e88]:\n    - generic [ref=f4e90]: Live\n    - status [ref=f4e91]: All changes saved.\n    - generic \"Room code\" [ref=f4e92]: ROOM_S\n    - button \"Copy room code\" [ref=f4e93] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e98]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e99] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e100] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e101] [cursor=pointer]\n  - generic [ref=f4e106]:\n    - group \"Chain figures\" [ref=f4e107]\n    - button \"Presence\" [ref=f4e111] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e112] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e113]:\n    - tree \"Scene\" [ref=f4e114]\n  - generic [ref=f4e116]:\n    - button \"Add primitive\" [ref=f4e117] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e120] [cursor=pointer]\n  - generic [ref=f4e125]:\n    - button \"Cue timeline\" [ref=f4e126] [cursor=pointer]\n    - button \"Units\" [ref=f4e131] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e132]:\n    - button \"Move\" [pressed] [ref=f4e133] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e134] [cursor=pointer]\n    - button \"Scale\" [ref=f4e135] [cursor=pointer]\n    - button \"Stop playtest\" [ref=f4e219] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e142] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e143] [cursor=pointer]\n    - button \"Next node\" [ref=f4e144] [cursor=pointer]\n    - timer \"Playtest clock\" [ref=f4e222]: 59:56\n  - region \"Room stage\" [ref=f4e145]\n  - status [ref=f4e3]: Playtest running.\n  - status [ref=f4e4]: Player height"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/reduced/page-2026-11-12T03-16-51-984Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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EIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAKYf1k0AABAASURBVAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABQAMAAIAKCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAA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",
      "mimeType": "image/png"
    }
  ]
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "p"
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
  "key": "Escape"
}
```
- Result
```json
{}
```
