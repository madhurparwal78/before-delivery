
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
  "events": "- New console entries: evidence/reduced/console-2026-11-12T03-19-42-089Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Keyway Bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- form \"Sign in\" [ref=e4]:\n  - heading \"Keyway bench\" [level=2] [ref=e6]\n  - generic [ref=e7]:\n    - generic [ref=e8]: Email\n    - textbox \"Email\" [ref=e9]\n  - generic [ref=e10]:\n    - generic [ref=e11]: Password\n    - textbox \"Password\" [ref=e12]\n  - button \"Sign in\" [ref=e13] [cursor=pointer]\n  - paragraph [ref=e14]:\n    - link \"Back to the tour\" [ref=e15] [cursor=pointer]:\n      - /url: /",
  "events": "- New console entries: evidence/reduced/console-2026-11-12T03-19-42-089Z.log#L2"
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
  "events": "- New console entries: evidence/reduced/console-2026-11-12T03-19-42-089Z.log#L3"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Keyway Bench\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- form \"Sign in\" [ref=e4]:\n  - heading \"Keyway bench\" [level=2] [ref=e6]\n  - generic [ref=e7]:\n    - generic [ref=e8]: Email\n    - textbox \"Email\" [ref=e9]: mara@lanternlane.test\n  - generic [ref=e10]:\n    - generic [ref=e11]: Password\n    - textbox \"Password\" [ref=e12]: wrong\n  - button \"Sign in\" [active] [ref=e13] [cursor=pointer]\n  - status [ref=e16]: That email and password don't match.\n  - paragraph [ref=e14]:\n    - link \"Back to the tour\" [ref=e15] [cursor=pointer]:\n      - /url: /"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/room_apothecary\n- Page Title: Keyway Bench",
  "snapshot": "- generic [ref=f2e2]:\n  - button \"Rooms\" [ref=f2e4] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f2e8]:\n    - generic [ref=f2e10]: Live\n    - status [ref=f2e11]: All changes saved.\n    - generic \"Room code\" [ref=f2e12]: ROOM_A\n    - button \"Copy room code\" [ref=f2e13] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f2e18]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f2e19] [cursor=pointer]\n    - button \"Playtests\" [ref=f2e20] [cursor=pointer]\n    - button \"Session menu\" [ref=f2e21] [cursor=pointer]\n  - generic [ref=f2e26]:\n    - group \"Chain figures\" [ref=f2e27]:\n      - generic [ref=f2e28]: 0 of 6 solved\n      - generic [ref=f2e29]: Longest run 3\n      - generic [ref=f2e30]: 4 props\n    - button \"Presence\" [ref=f2e31] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f2e32] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f2e33]:\n    - tree \"Scene\" [ref=f2e34]:\n      - treeitem \"Apothecary\" [expanded] [level=1] [ref=f2e35]\n      - treeitem \"Entry door\" [level=2] [ref=f2e36]\n      - treeitem \"Herb cabinet\" [level=2] [ref=f2e41]\n      - treeitem \"Mortar table\" [level=2] [ref=f2e46]\n      - treeitem \"Scale plinth\" [level=2] [ref=f2e51]\n      - treeitem \"Poison shelf\" [level=2] [ref=f2e56]\n  - generic [ref=f2e61]:\n    - button \"Add primitive\" [ref=f2e62] [cursor=pointer]\n    - button \"Upload prop\" [ref=f2e65] [cursor=pointer]\n  - generic [ref=f2e70]:\n    - button \"Cue timeline\" [ref=f2e71] [cursor=pointer]\n    - button \"Units\" [ref=f2e76] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f2e77]:\n    - button \"Move\" [pressed] [ref=f2e78] [cursor=pointer]\n    - button \"Rotate\" [ref=f2e79] [cursor=pointer]\n    - button \"Scale\" [ref=f2e80] [cursor=pointer]\n    - button \"Start playtest\" [ref=f2e82] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f2e87] [cursor=pointer]\n    - button \"Prop library\" [ref=f2e88] [cursor=pointer]\n    - button \"Next node\" [ref=f2e89] [cursor=pointer]\n  - region \"Room stage\" [ref=f2e90]\n  - status [ref=f2e92]\n  - status [ref=f2e93]: Overview"
}
```

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
{}
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
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f3e2]:\n  - status [ref=f3e3]\n  - status [ref=f3e4]: Overview\n  - dialog \"Open a room\" [ref=f3e6]:\n    - generic [ref=f3e7]:\n      - generic [ref=f3e8]: Keyway bench\n      - button \"Close\" [ref=f3e11] [cursor=pointer]\n    - generic [ref=f3e13]: bench 1.0.0\n    - generic [ref=f3e14]:\n      - button \"Back\" [disabled] [ref=f3e15] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f3e17]\n    - generic [ref=f3e18]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f3e19]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [active] [selected] [ref=f3e35] [cursor=pointer]\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f3e38] [cursor=pointer]\n      - option \"Judge Pack abkqrs 0 of 1 solved · Longest run 1 · 3 props\" [ref=f3e41] [cursor=pointer]\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f3e44] [cursor=pointer]\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f3e47] [cursor=pointer]\n      - option \"Judge Walk rtpnuz 0 of 0 solved · Longest run 0 · 0 props\" [ref=f3e50] [cursor=pointer]\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f3e53] [cursor=pointer]\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f3e56] [cursor=pointer]\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f3e59] [cursor=pointer]\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f3e62] [cursor=pointer]\n    - link \"New room\" [ref=f3e22] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f3e23]:\n      - generic [ref=f3e24]\n      - generic [ref=f3e26]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Close picker",
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
  "depth": 3
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
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f4e2]:\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - dialog \"Open a room\" [ref=f4e6]:\n    - generic [ref=f4e7]:\n      - generic [ref=f4e8]: Keyway bench\n      - button \"Close\" [ref=f4e11] [cursor=pointer]\n    - generic [ref=f4e13]: bench 1.0.0\n    - generic [ref=f4e14]:\n      - button \"Back\" [disabled] [ref=f4e15] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e17]\n    - generic [ref=f4e18]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e19]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [active] [selected] [ref=f4e35] [cursor=pointer]\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e38] [cursor=pointer]\n      - option \"Judge Pack abkqrs 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e41] [cursor=pointer]\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e44] [cursor=pointer]\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e47] [cursor=pointer]\n      - option \"Judge Walk rtpnuz 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e50] [cursor=pointer]\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e53] [cursor=pointer]\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f4e56] [cursor=pointer]\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e59] [cursor=pointer]\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f4e62] [cursor=pointer]\n    - link \"New room\" [ref=f4e22] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e23]:\n      - generic [ref=f4e24]\n      - generic [ref=f4e26]"
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
  "snapshot": "- generic [ref=f4e2]:\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - dialog \"Open a room\" [ref=f4e6]:\n    - generic [ref=f4e7]:\n      - generic [ref=f4e8]: Keyway bench\n      - button \"Close\" [ref=f4e11] [cursor=pointer]\n    - generic [ref=f4e13]: bench 1.0.0\n    - generic [ref=f4e14]:\n      - button \"Back\" [disabled] [ref=f4e15] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e17]\n    - generic [ref=f4e18]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e19]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [selected] [ref=f4e35] [cursor=pointer]:\n        - generic [ref=f4e36]:\n          - generic [ref=f4e37]: Apothecary\n          - text: 0 of 6 solved · Longest run 3 · 4 props\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e38] [cursor=pointer]:\n        - generic [ref=f4e39]:\n          - generic [ref=f4e40]: Clockmaker's Study\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack abkqrs 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e41] [cursor=pointer]:\n        - generic [ref=f4e42]:\n          - generic [ref=f4e43]: Judge Pack abkqrs\n          - text: 0 of 1 solved · Longest run 1 · 3 props\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e44] [cursor=pointer]:\n        - generic [ref=f4e45]:\n          - generic [ref=f4e46]: Judge Pack qzmtvk\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e47] [cursor=pointer]:\n        - generic [ref=f4e48]:\n          - generic [ref=f4e49]: Judge Pack xkqjrw\n          - text: 0 of 1 solved · Longest run 1 · 3 props\n      - option \"Judge Walk rtpnuz 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e50] [cursor=pointer]:\n        - generic [ref=f4e51]:\n          - generic [ref=f4e52]: Judge Walk rtpnuz\n          - text: 0 of 0 solved · Longest run 0 · 0 props\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e53] [cursor=pointer]:\n        - generic [ref=f4e54]:\n          - generic [ref=f4e55]: Observatory\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f4e56] [cursor=pointer]:\n        - generic [ref=f4e57]:\n          - generic [ref=f4e58]: Ship's Hold\n          - text: 0 of 5 solved · Longest run 5 · 4 props\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e59] [cursor=pointer]:\n        - generic [ref=f4e60]:\n          - generic [ref=f4e61]: Signal Cabin\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f4e62] [cursor=pointer]:\n        - generic [ref=f4e63]:\n          - generic [ref=f4e64]: Vault\n          - text: 0 of 6 solved · Longest run 6 · 3 props\n    - link \"New room\" [ref=f4e22] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e23]:\n      - generic [ref=f4e24]:\n        - checkbox \"Walk in when I pick a room\" [checked] [ref=f4e25]\n        - text: Walk in when I pick a room\n      - generic [ref=f4e26]:\n        - link \"Prop library\" [ref=f4e27] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Versions\" [ref=f4e28] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Keyboard shortcuts\" [ref=f4e29] [cursor=pointer]:\n          - /url: \"#\"\n  - dialog \"New room\" [ref=f4e66]:\n    - generic [ref=f4e67]:\n      - heading \"New room\" [level=2] [ref=f4e68]\n      - button \"Close\" [active] [ref=f4e69] [cursor=pointer]\n    - generic [ref=f4e74]:\n      - generic [ref=f4e75]:\n        - generic [ref=f4e76]: Room name\n        - textbox \"Room name\" [ref=f4e77]\n      - generic [ref=f4e78]:\n        - generic [ref=f4e79]:\n          - generic [ref=f4e80]: Width (m)\n          - textbox \"Width (m)\" [ref=f4e81]\n        - generic [ref=f4e82]:\n          - generic [ref=f4e83]: Depth (m)\n          - textbox \"Depth (m)\" [ref=f4e84]\n        - generic [ref=f4e85]:\n          - generic [ref=f4e86]: Height (m)\n          - textbox \"Height (m)\" [ref=f4e87]\n      - button \"Create room\" [disabled] [ref=f4e88] [cursor=pointer]"
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
  "inlineSnapshot": "- generic [ref=f4e2]:\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - dialog \"Open a room\" [ref=f4e6]:\n    - generic [ref=f4e7]:\n      - generic [ref=f4e8]: Keyway bench\n      - button \"Close\" [ref=f4e11] [cursor=pointer]\n    - generic [ref=f4e13]: bench 1.0.0\n    - generic [ref=f4e14]:\n      - button \"Back\" [disabled] [ref=f4e15] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e17]\n    - generic [ref=f4e18]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e19]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [selected] [ref=f4e35] [cursor=pointer]:\n        - generic [ref=f4e36]:\n          - generic [ref=f4e37]: Apothecary\n          - text: 0 of 6 solved · Longest run 3 · 4 props\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e38] [cursor=pointer]:\n        - generic [ref=f4e39]:\n          - generic [ref=f4e40]: Clockmaker's Study\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack abkqrs 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e41] [cursor=pointer]:\n        - generic [ref=f4e42]:\n          - generic [ref=f4e43]: Judge Pack abkqrs\n          - text: 0 of 1 solved · Longest run 1 · 3 props\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e44] [cursor=pointer]:\n        - generic [ref=f4e45]:\n          - generic [ref=f4e46]: Judge Pack qzmtvk\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e47] [cursor=pointer]:\n        - generic [ref=f4e48]:\n          - generic [ref=f4e49]: Judge Pack xkqjrw\n          - text: 0 of 1 solved · Longest run 1 · 3 props\n      - option \"Judge Walk rtpnuz 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e50] [cursor=pointer]:\n        - generic [ref=f4e51]:\n          - generic [ref=f4e52]: Judge Walk rtpnuz\n          - text: 0 of 0 solved · Longest run 0 · 0 props\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e53] [cursor=pointer]:\n        - generic [ref=f4e54]:\n          - generic [ref=f4e55]: Observatory\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f4e56] [cursor=pointer]:\n        - generic [ref=f4e57]:\n          - generic [ref=f4e58]: Ship's Hold\n          - text: 0 of 5 solved · Longest run 5 · 4 props\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e59] [cursor=pointer]:\n        - generic [ref=f4e60]:\n          - generic [ref=f4e61]: Signal Cabin\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f4e62] [cursor=pointer]:\n        - generic [ref=f4e63]:\n          - generic [ref=f4e64]: Vault\n          - text: 0 of 6 solved · Longest run 6 · 3 props\n    - link \"New room\" [ref=f4e22] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e23]:\n      - generic [ref=f4e24]:\n        - checkbox \"Walk in when I pick a room\" [checked] [ref=f4e25]\n        - text: Walk in when I pick a room\n      - generic [ref=f4e26]:\n        - link \"Prop library\" [ref=f4e27] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Versions\" [ref=f4e28] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Keyboard shortcuts\" [ref=f4e29] [cursor=pointer]:\n          - /url: \"#\"\n  - dialog \"New room\" [ref=f4e66]:\n    - generic [ref=f4e67]:\n      - heading \"New room\" [level=2] [ref=f4e68]\n      - button \"Close\" [active] [ref=f4e69] [cursor=pointer]\n    - generic [ref=f4e74]:\n      - generic [ref=f4e75]:\n        - generic [ref=f4e76]: Room name\n        - textbox \"Room name\" [ref=f4e77]\n      - generic [ref=f4e78]:\n        - generic [ref=f4e79]:\n          - generic [ref=f4e80]: Width (m)\n          - textbox \"Width (m)\" [ref=f4e81]\n        - generic [ref=f4e82]:\n          - generic [ref=f4e83]: Depth (m)\n          - textbox \"Depth (m)\" [ref=f4e84]\n        - generic [ref=f4e85]:\n          - generic [ref=f4e86]: Height (m)\n          - textbox \"Height (m)\" [ref=f4e87]\n      - button \"Create room\" [disabled] [ref=f4e88] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f4e77",
      "name": "Room",
      "type": "textbox",
      "value": "Judge Walk zxcvbn"
    },
    {
      "target": "f4e81",
      "name": "Width",
      "type": "textbox",
      "value": "4"
    },
    {
      "target": "f4e84",
      "name": "Depth",
      "type": "textbox",
      "value": "3"
    },
    {
      "target": "f4e87",
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
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f4e2]:\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - dialog \"Open a room\" [ref=f4e6]:\n    - generic [ref=f4e7]:\n      - generic [ref=f4e8]: Keyway bench\n      - button \"Close\" [ref=f4e11] [cursor=pointer]\n    - generic [ref=f4e13]: bench 1.0.0\n    - generic [ref=f4e14]:\n      - button \"Back\" [disabled] [ref=f4e15] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e17]\n    - generic [ref=f4e18]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e19]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [selected] [ref=f4e35] [cursor=pointer]\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e38] [cursor=pointer]\n      - option \"Judge Pack abkqrs 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e41] [cursor=pointer]\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e44] [cursor=pointer]\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e47] [cursor=pointer]\n      - option \"Judge Walk rtpnuz 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e50] [cursor=pointer]\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e53] [cursor=pointer]\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f4e56] [cursor=pointer]\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e59] [cursor=pointer]\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f4e62] [cursor=pointer]\n    - link \"New room\" [ref=f4e22] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e23]:\n      - generic [ref=f4e24]\n      - generic [ref=f4e26]\n  - dialog \"New room\" [ref=f4e66]:\n    - generic [ref=f4e67]:\n      - heading \"New room\" [level=2] [ref=f4e68]\n      - button \"Close\" [ref=f4e69] [cursor=pointer]\n    - generic [ref=f4e74]:\n      - generic [ref=f4e75]\n      - generic [ref=f4e78]\n      - button \"Create room\" [ref=f4e88] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Create room",
  "target": "f4e88"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/ZdssUW4sgptL\n- Page Title: Keyway Bench",
  "snapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e90] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e94]:\n    - generic [ref=f4e96]: Live\n    - status [ref=f4e97]: All changes saved.\n    - generic \"Room code\" [ref=f4e98]: ZDSSUW\n    - button \"Copy room code\" [ref=f4e99] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e104]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e105] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e106] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e107] [cursor=pointer]\n  - generic [ref=f4e112]:\n    - group \"Chain figures\" [ref=f4e113]:\n      - generic [ref=f4e114]: 0 of 0 solved\n      - generic [ref=f4e115]: Longest run 0\n      - generic [ref=f4e116]: 0 props\n    - button \"Presence\" [ref=f4e117] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e118] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e119]:\n    - tree \"Scene\" [ref=f4e120]:\n      - treeitem \"Judge Walk zxcvbn\" [expanded] [level=1] [ref=f4e121]\n  - generic [ref=f4e122]:\n    - button \"Add primitive\" [ref=f4e123] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e126] [cursor=pointer]\n  - generic [ref=f4e131]:\n    - button \"Cue timeline\" [ref=f4e132] [cursor=pointer]\n    - button \"Units\" [ref=f4e137] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e138]:\n    - button \"Move\" [pressed] [ref=f4e139] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e140] [cursor=pointer]\n    - button \"Scale\" [ref=f4e141] [cursor=pointer]\n    - button \"Start playtest\" [ref=f4e143] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e148] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e149] [cursor=pointer]\n    - button \"Next node\" [ref=f4e150] [cursor=pointer]\n  - region \"Room stage\" [ref=f4e151]\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - generic: This room is empty. Add a primitive or place a prop."
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/ZdssUW4sgptL\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e90] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e94]:\n    - generic [ref=f4e96]: Live\n    - status [ref=f4e97]: All changes saved.\n    - generic \"Room code\" [ref=f4e98]: ZDSSUW\n    - button \"Copy room code\" [ref=f4e99] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e104]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e105] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e106] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e107] [cursor=pointer]\n  - generic [ref=f4e112]:\n    - group \"Chain figures\" [ref=f4e113]:\n      - generic [ref=f4e114]: 0 of 0 solved\n      - generic [ref=f4e115]: Longest run 0\n      - generic [ref=f4e116]: 0 props\n    - button \"Presence\" [ref=f4e117] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e118] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e119]:\n    - tree \"Scene\" [ref=f4e120]:\n      - treeitem \"Judge Walk zxcvbn\" [expanded] [level=1] [ref=f4e121]\n  - generic [ref=f4e122]:\n    - button \"Add primitive\" [ref=f4e123] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e126] [cursor=pointer]\n  - generic [ref=f4e131]:\n    - button \"Cue timeline\" [ref=f4e132] [cursor=pointer]\n    - button \"Units\" [ref=f4e137] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e138]:\n    - button \"Move\" [pressed] [ref=f4e139] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e140] [cursor=pointer]\n    - button \"Scale\" [ref=f4e141] [cursor=pointer]\n    - button \"Start playtest\" [ref=f4e143] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e148] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e149] [cursor=pointer]\n    - button \"Next node\" [ref=f4e150] [cursor=pointer]\n  - region \"Room stage\" [ref=f4e151]\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - generic: This room is empty. Add a primitive or place a prop."
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Rooms",
  "target": "f4e90"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/ZdssUW4sgptL\n- Page Title: Keyway Bench",
  "snapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e90] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e94]:\n    - generic [ref=f4e96]: Live\n    - status [ref=f4e97]: All changes saved.\n    - generic \"Room code\" [ref=f4e98]: ZDSSUW\n    - button \"Copy room code\" [ref=f4e99] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e104]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e105] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e106] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e107] [cursor=pointer]\n  - generic [ref=f4e112]:\n    - group \"Chain figures\" [ref=f4e113]:\n      - generic [ref=f4e114]: 0 of 0 solved\n      - generic [ref=f4e115]: Longest run 0\n      - generic [ref=f4e116]: 0 props\n    - button \"Presence\" [ref=f4e117] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e118] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e119]:\n    - tree \"Scene\" [ref=f4e120]:\n      - treeitem \"Judge Walk zxcvbn\" [expanded] [level=1] [ref=f4e121]\n  - generic [ref=f4e122]:\n    - button \"Add primitive\" [ref=f4e123] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e126] [cursor=pointer]\n  - generic [ref=f4e131]:\n    - button \"Cue timeline\" [ref=f4e132] [cursor=pointer]\n    - button \"Units\" [ref=f4e137] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e138]:\n    - button \"Move\" [pressed] [ref=f4e139] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e140] [cursor=pointer]\n    - button \"Scale\" [ref=f4e141] [cursor=pointer]\n    - button \"Start playtest\" [ref=f4e143] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e148] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e149] [cursor=pointer]\n    - button \"Next node\" [ref=f4e150] [cursor=pointer]\n  - region \"Room stage\" [ref=f4e151]\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - generic: This room is empty. Add a primitive or place a prop.\n  - dialog \"Open a room\" [ref=f4e154]:\n    - generic [ref=f4e155]:\n      - generic [ref=f4e156]: Keyway bench\n      - button \"Close\" [ref=f4e159] [cursor=pointer]\n    - generic [ref=f4e164]: bench 1.0.0\n    - generic [ref=f4e165]:\n      - button \"Back\" [disabled] [ref=f4e166] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e170]\n    - generic [ref=f4e171]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e172]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [active] [selected] [ref=f4e173] [cursor=pointer]:\n        - generic [ref=f4e174]:\n          - generic [ref=f4e175]: Apothecary\n          - text: 0 of 6 solved · Longest run 3 · 4 props\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e176] [cursor=pointer]:\n        - generic [ref=f4e177]:\n          - generic [ref=f4e178]: Clockmaker's Study\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack abkqrs 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e179] [cursor=pointer]:\n        - generic [ref=f4e180]:\n          - generic [ref=f4e181]: Judge Pack abkqrs\n          - text: 0 of 1 solved · Longest run 1 · 3 props\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e182] [cursor=pointer]:\n        - generic [ref=f4e183]:\n          - generic [ref=f4e184]: Judge Pack qzmtvk\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e185] [cursor=pointer]:\n        - generic [ref=f4e186]:\n          - generic [ref=f4e187]: Judge Pack xkqjrw\n          - text: 0 of 1 solved · Longest run 1 · 3 props\n      - option \"Judge Walk rtpnuz 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e188] [cursor=pointer]:\n        - generic [ref=f4e189]:\n          - generic [ref=f4e190]: Judge Walk rtpnuz\n          - text: 0 of 0 solved · Longest run 0 · 0 props\n      - option \"Judge Walk zxcvbn 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e191] [cursor=pointer]:\n        - generic [ref=f4e192]:\n          - generic [ref=f4e193]: Judge Walk zxcvbn\n          - text: 0 of 0 solved · Longest run 0 · 0 props\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e194] [cursor=pointer]:\n        - generic [ref=f4e195]:\n          - generic [ref=f4e196]: Observatory\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f4e197] [cursor=pointer]:\n        - generic [ref=f4e198]:\n          - generic [ref=f4e199]: Ship's Hold\n          - text: 0 of 5 solved · Longest run 5 · 4 props\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e200] [cursor=pointer]:\n        - generic [ref=f4e201]:\n          - generic [ref=f4e202]: Signal Cabin\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f4e203] [cursor=pointer]:\n        - generic [ref=f4e204]:\n          - generic [ref=f4e205]: Vault\n          - text: 0 of 6 solved · Longest run 6 · 3 props\n    - link \"New room\" [ref=f4e207] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e208]:\n      - generic [ref=f4e209]:\n        - checkbox \"Walk in when I pick a room\" [checked] [ref=f4e210]\n        - text: Walk in when I pick a room\n      - generic [ref=f4e211]:\n        - link \"Prop library\" [ref=f4e212] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Versions\" [ref=f4e213] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Keyboard shortcuts\" [ref=f4e214] [cursor=pointer]:\n          - /url: \"#\""
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/ZdssUW4sgptL\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e90] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e94]:\n    - generic [ref=f4e96]: Live\n    - status [ref=f4e97]: All changes saved.\n    - generic \"Room code\" [ref=f4e98]: ZDSSUW\n    - button \"Copy room code\" [ref=f4e99] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e104]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e105] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e106] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e107] [cursor=pointer]\n  - generic [ref=f4e112]:\n    - group \"Chain figures\" [ref=f4e113]:\n      - generic [ref=f4e114]: 0 of 0 solved\n      - generic [ref=f4e115]: Longest run 0\n      - generic [ref=f4e116]: 0 props\n    - button \"Presence\" [ref=f4e117] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e118] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e119]:\n    - tree \"Scene\" [ref=f4e120]:\n      - treeitem \"Judge Walk zxcvbn\" [expanded] [level=1] [ref=f4e121]\n  - generic [ref=f4e122]:\n    - button \"Add primitive\" [ref=f4e123] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e126] [cursor=pointer]\n  - generic [ref=f4e131]:\n    - button \"Cue timeline\" [ref=f4e132] [cursor=pointer]\n    - button \"Units\" [ref=f4e137] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e138]:\n    - button \"Move\" [pressed] [ref=f4e139] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e140] [cursor=pointer]\n    - button \"Scale\" [ref=f4e141] [cursor=pointer]\n    - button \"Start playtest\" [ref=f4e143] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e148] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e149] [cursor=pointer]\n    - button \"Next node\" [ref=f4e150] [cursor=pointer]\n  - region \"Room stage\" [ref=f4e151]\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - generic: This room is empty. Add a primitive or place a prop.\n  - dialog \"Open a room\" [ref=f4e154]:\n    - generic [ref=f4e155]:\n      - generic [ref=f4e156]: Keyway bench\n      - button \"Close\" [ref=f4e159] [cursor=pointer]\n    - generic [ref=f4e164]: bench 1.0.0\n    - generic [ref=f4e165]:\n      - button \"Back\" [disabled] [ref=f4e166] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e170]\n    - generic [ref=f4e171]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e172]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [active] [selected] [ref=f4e173] [cursor=pointer]\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e176] [cursor=pointer]\n      - option \"Judge Pack abkqrs 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e179] [cursor=pointer]\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e182] [cursor=pointer]\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e185] [cursor=pointer]\n      - option \"Judge Walk rtpnuz 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e188] [cursor=pointer]\n      - option \"Judge Walk zxcvbn 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e191] [cursor=pointer]\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e194] [cursor=pointer]\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f4e197] [cursor=pointer]\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e200] [cursor=pointer]\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f4e203] [cursor=pointer]\n    - link \"New room\" [ref=f4e207] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e208]:\n      - generic [ref=f4e209]\n      - generic [ref=f4e211]"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/ZdssUW4sgptL\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e90] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e94]:\n    - generic [ref=f4e96]: Live\n    - status [ref=f4e97]: All changes saved.\n    - generic \"Room code\" [ref=f4e98]: ZDSSUW\n    - button \"Copy room code\" [ref=f4e99] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e104]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e105] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e106] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e107] [cursor=pointer]\n  - generic [ref=f4e112]:\n    - group \"Chain figures\" [ref=f4e113]:\n      - generic [ref=f4e114]: 0 of 0 solved\n      - generic [ref=f4e115]: Longest run 0\n      - generic [ref=f4e116]: 0 props\n    - button \"Presence\" [ref=f4e117] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e118] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e119]:\n    - tree \"Scene\" [ref=f4e120]:\n      - treeitem \"Judge Walk zxcvbn\" [expanded] [level=1] [ref=f4e121]\n  - generic [ref=f4e122]:\n    - button \"Add primitive\" [ref=f4e123] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e126] [cursor=pointer]\n  - generic [ref=f4e131]:\n    - button \"Cue timeline\" [ref=f4e132] [cursor=pointer]\n    - button \"Units\" [ref=f4e137] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e138]:\n    - button \"Move\" [pressed] [ref=f4e139] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e140] [cursor=pointer]\n    - button \"Scale\" [ref=f4e141] [cursor=pointer]\n    - button \"Start playtest\" [ref=f4e143] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e148] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e149] [cursor=pointer]\n    - button \"Next node\" [ref=f4e150] [cursor=pointer]\n  - region \"Room stage\" [ref=f4e151]\n  - status [ref=f4e3]\n  - status [ref=f4e4]: Overview\n  - generic: This room is empty. Add a primitive or place a prop.\n  - dialog \"Open a room\" [ref=f4e154]:\n    - generic [ref=f4e155]:\n      - generic [ref=f4e156]: Keyway bench\n      - button \"Close\" [ref=f4e159] [cursor=pointer]\n    - generic [ref=f4e164]: bench 1.0.0\n    - generic [ref=f4e165]:\n      - button \"Back\" [disabled] [ref=f4e166] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e170]\n    - generic [ref=f4e171]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e172]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [active] [selected] [ref=f4e173] [cursor=pointer]:\n        - generic [ref=f4e174]:\n          - generic [ref=f4e175]: Apothecary\n          - text: 0 of 6 solved · Longest run 3 · 4 props\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e176] [cursor=pointer]:\n        - generic [ref=f4e177]:\n          - generic [ref=f4e178]: Clockmaker's Study\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack abkqrs 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e179] [cursor=pointer]:\n        - generic [ref=f4e180]:\n          - generic [ref=f4e181]: Judge Pack abkqrs\n          - text: 0 of 1 solved · Longest run 1 · 3 props\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e182] [cursor=pointer]:\n        - generic [ref=f4e183]:\n          - generic [ref=f4e184]: Judge Pack qzmtvk\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e185] [cursor=pointer]:\n        - generic [ref=f4e186]:\n          - generic [ref=f4e187]: Judge Pack xkqjrw\n          - text: 0 of 1 solved · Longest run 1 · 3 props\n      - option \"Judge Walk rtpnuz 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e188] [cursor=pointer]:\n        - generic [ref=f4e189]:\n          - generic [ref=f4e190]: Judge Walk rtpnuz\n          - text: 0 of 0 solved · Longest run 0 · 0 props\n      - option \"Judge Walk zxcvbn 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e191] [cursor=pointer]:\n        - generic [ref=f4e192]:\n          - generic [ref=f4e193]: Judge Walk zxcvbn\n          - text: 0 of 0 solved · Longest run 0 · 0 props\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e194] [cursor=pointer]:\n        - generic [ref=f4e195]:\n          - generic [ref=f4e196]: Observatory\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f4e197] [cursor=pointer]:\n        - generic [ref=f4e198]:\n          - generic [ref=f4e199]: Ship's Hold\n          - text: 0 of 5 solved · Longest run 5 · 4 props\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e200] [cursor=pointer]:\n        - generic [ref=f4e201]:\n          - generic [ref=f4e202]: Signal Cabin\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f4e203] [cursor=pointer]:\n        - generic [ref=f4e204]:\n          - generic [ref=f4e205]: Vault\n          - text: 0 of 6 solved · Longest run 6 · 3 props\n    - link \"New room\" [ref=f4e207] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e208]:\n      - generic [ref=f4e209]:\n        - checkbox \"Walk in when I pick a room\" [checked] [ref=f4e210]\n        - text: Walk in when I pick a room\n      - generic [ref=f4e211]:\n        - link \"Prop library\" [ref=f4e212] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Versions\" [ref=f4e213] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Keyboard shortcuts\" [ref=f4e214] [cursor=pointer]:\n          - /url: \"#\""
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/jHhrYrG3Xrr4\n- Page Title: Keyway Bench",
  "snapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e90] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e94]:\n    - generic [ref=f4e96]: Live\n    - status [ref=f4e97]: All changes saved.\n    - generic \"Room code\" [ref=f4e98]: JHHRYR\n    - button \"Copy room code\" [ref=f4e99] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e104]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e105] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e106] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e107] [cursor=pointer]\n  - generic [ref=f4e112]:\n    - group \"Chain figures\" [ref=f4e113]:\n      - generic [ref=f4e114]: 0 of 1 solved\n      - generic [ref=f4e115]: Longest run 1\n      - generic [ref=f4e116]: 3 props\n    - button \"Presence\" [ref=f4e117] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e118] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e119]:\n    - tree \"Scene\" [ref=f4e120]:\n      - treeitem \"Judge Pack abkqrs\" [expanded] [level=1] [ref=f4e215]\n      - treeitem \"New box\" [level=2] [ref=f4e216]\n      - treeitem \"New box\" [level=2] [ref=f4e221]\n      - treeitem \"New box\" [level=2] [ref=f4e226]\n  - generic [ref=f4e122]:\n    - button \"Add primitive\" [ref=f4e123] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e126] [cursor=pointer]\n  - generic [ref=f4e131]:\n    - button \"Cue timeline\" [ref=f4e132] [cursor=pointer]\n    - button \"Units\" [ref=f4e137] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e138]:\n    - button \"Move\" [pressed] [ref=f4e139] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e140] [cursor=pointer]\n    - button \"Scale\" [ref=f4e141] [cursor=pointer]\n    - button \"Stop playtest\" [ref=f4e231] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e148] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e149] [cursor=pointer]\n    - button \"Next node\" [ref=f4e150] [cursor=pointer]\n    - timer \"Playtest clock\" [ref=f4e234]: 60:00\n  - region \"Room stage\" [ref=f4e151]\n  - status [ref=f4e3]: Playtest running.\n  - status [ref=f4e4]: Player height"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/jHhrYrG3Xrr4\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e90] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e94]:\n    - generic [ref=f4e96]: Live\n    - status [ref=f4e97]: All changes saved.\n    - generic \"Room code\" [ref=f4e98]: JHHRYR\n    - button \"Copy room code\" [ref=f4e99] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e104]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e105] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e106] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e107] [cursor=pointer]\n  - generic [ref=f4e112]:\n    - group \"Chain figures\" [ref=f4e113]:\n      - generic [ref=f4e114]: 0 of 1 solved\n      - generic [ref=f4e115]: Longest run 1\n      - generic [ref=f4e116]: 3 props\n    - button \"Presence\" [ref=f4e117] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e118] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e119]:\n    - tree \"Scene\" [ref=f4e120]:\n      - treeitem \"Judge Pack abkqrs\" [expanded] [level=1] [ref=f4e215]\n      - treeitem \"New box\" [level=2] [ref=f4e216]\n      - treeitem \"New box\" [level=2] [ref=f4e221]\n      - treeitem \"New box\" [level=2] [ref=f4e226]\n  - generic [ref=f4e122]:\n    - button \"Add primitive\" [ref=f4e123] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e126] [cursor=pointer]\n  - generic [ref=f4e131]:\n    - button \"Cue timeline\" [ref=f4e132] [cursor=pointer]\n    - button \"Units\" [ref=f4e137] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e138]:\n    - button \"Move\" [pressed] [ref=f4e139] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e140] [cursor=pointer]\n    - button \"Scale\" [ref=f4e141] [cursor=pointer]\n    - button \"Stop playtest\" [ref=f4e231] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e148] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e149] [cursor=pointer]\n    - button \"Next node\" [ref=f4e150] [cursor=pointer]\n    - timer \"Playtest clock\" [ref=f4e234]: 59:54\n  - region \"Room stage\" [ref=f4e151]\n  - status [ref=f4e3]: Playtest running.\n  - status [ref=f4e4]: Player height"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "P"
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

### Tool call: browser_click
- Args
```json
{
  "element": "Rooms",
  "target": "f4e90"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/jHhrYrG3Xrr4\n- Page Title: Keyway Bench",
  "snapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e90] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e94]:\n    - generic [ref=f4e96]: Live\n    - status [ref=f4e97]: All changes saved.\n    - generic \"Room code\" [ref=f4e98]: JHHRYR\n    - button \"Copy room code\" [ref=f4e99] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e104]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e105] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e106] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e107] [cursor=pointer]\n  - generic [ref=f4e112]:\n    - group \"Chain figures\" [ref=f4e113]:\n      - generic [ref=f4e114]: 0 of 1 solved\n      - generic [ref=f4e115]: Longest run 1\n      - generic [ref=f4e116]: 3 props\n    - button \"Presence\" [ref=f4e117] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e118] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e119]:\n    - tree \"Scene\" [ref=f4e120]:\n      - treeitem \"Judge Pack abkqrs\" [expanded] [level=1] [ref=f4e215]\n      - treeitem \"New box\" [level=2] [ref=f4e216]\n      - treeitem \"New box\" [level=2] [ref=f4e221]\n      - treeitem \"New box\" [level=2] [ref=f4e226]\n  - generic [ref=f4e122]:\n    - button \"Add primitive\" [ref=f4e123] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e126] [cursor=pointer]\n  - generic [ref=f4e131]:\n    - button \"Cue timeline\" [ref=f4e132] [cursor=pointer]\n    - button \"Units\" [ref=f4e137] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e138]:\n    - button \"Move\" [pressed] [ref=f4e139] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e140] [cursor=pointer]\n    - button \"Scale\" [ref=f4e141] [cursor=pointer]\n    - button \"Start playtest\" [ref=f4e235] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e148] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e149] [cursor=pointer]\n    - button \"Next node\" [ref=f4e150] [cursor=pointer]\n    - timer \"Playtest clock\" [ref=f4e234]: 59:37\n  - region \"Room stage\" [ref=f4e151]\n  - status [ref=f4e3]: Playtest running.\n  - status [ref=f4e4]: Overview\n  - dialog \"Open a room\" [ref=f4e239]:\n    - generic [ref=f4e240]:\n      - generic [ref=f4e241]: Keyway bench\n      - button \"Close\" [ref=f4e244] [cursor=pointer]\n    - generic [ref=f4e249]: bench 1.0.0\n    - generic [ref=f4e250]:\n      - button \"Back\" [disabled] [ref=f4e251] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e255]\n    - generic [ref=f4e256]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e257]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [active] [selected] [ref=f4e258] [cursor=pointer]:\n        - generic [ref=f4e259]:\n          - generic [ref=f4e260]: Apothecary\n          - text: 0 of 6 solved · Longest run 3 · 4 props\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e261] [cursor=pointer]:\n        - generic [ref=f4e262]:\n          - generic [ref=f4e263]: Clockmaker's Study\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack abkqrs 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e264] [cursor=pointer]:\n        - generic [ref=f4e265]:\n          - generic [ref=f4e266]: Judge Pack abkqrs\n          - text: 0 of 1 solved · Longest run 1 · 3 props\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e267] [cursor=pointer]:\n        - generic [ref=f4e268]:\n          - generic [ref=f4e269]: Judge Pack qzmtvk\n          - text: 0 of 1 solved · Longest run 1 · 1 prop\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e270] [cursor=pointer]:\n        - generic [ref=f4e271]:\n          - generic [ref=f4e272]: Judge Pack xkqjrw\n          - text: 0 of 1 solved · Longest run 1 · 3 props\n      - option \"Judge Walk rtpnuz 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e273] [cursor=pointer]:\n        - generic [ref=f4e274]:\n          - generic [ref=f4e275]: Judge Walk rtpnuz\n          - text: 0 of 0 solved · Longest run 0 · 0 props\n      - option \"Judge Walk zxcvbn 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e276] [cursor=pointer]:\n        - generic [ref=f4e277]:\n          - generic [ref=f4e278]: Judge Walk zxcvbn\n          - text: 0 of 0 solved · Longest run 0 · 0 props\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e279] [cursor=pointer]:\n        - generic [ref=f4e280]:\n          - generic [ref=f4e281]: Observatory\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f4e282] [cursor=pointer]:\n        - generic [ref=f4e283]:\n          - generic [ref=f4e284]: Ship's Hold\n          - text: 0 of 5 solved · Longest run 5 · 4 props\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e285] [cursor=pointer]:\n        - generic [ref=f4e286]:\n          - generic [ref=f4e287]: Signal Cabin\n          - text: 0 of 4 solved · Longest run 2 · 2 props\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f4e288] [cursor=pointer]:\n        - generic [ref=f4e289]:\n          - generic [ref=f4e290]: Vault\n          - text: 0 of 6 solved · Longest run 6 · 3 props\n    - link \"New room\" [ref=f4e292] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e293]:\n      - generic [ref=f4e294]:\n        - checkbox \"Walk in when I pick a room\" [checked] [ref=f4e295]\n        - text: Walk in when I pick a room\n      - generic [ref=f4e296]:\n        - link \"Prop library\" [ref=f4e297] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Versions\" [ref=f4e298] [cursor=pointer]:\n          - /url: \"#\"\n        - link \"Keyboard shortcuts\" [ref=f4e299] [cursor=pointer]:\n          - /url: \"#\""
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/jHhrYrG3Xrr4\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e90] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e94]:\n    - generic [ref=f4e96]: Live\n    - status [ref=f4e97]: All changes saved.\n    - generic \"Room code\" [ref=f4e98]: JHHRYR\n    - button \"Copy room code\" [ref=f4e99] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e104]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e105] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e106] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e107] [cursor=pointer]\n  - generic [ref=f4e112]:\n    - group \"Chain figures\" [ref=f4e113]:\n      - generic [ref=f4e114]: 0 of 1 solved\n      - generic [ref=f4e115]: Longest run 1\n      - generic [ref=f4e116]: 3 props\n    - button \"Presence\" [ref=f4e117] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e118] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e119]:\n    - tree \"Scene\" [ref=f4e120]:\n      - treeitem \"Judge Pack abkqrs\" [expanded] [level=1] [ref=f4e215]\n      - treeitem \"New box\" [level=2] [ref=f4e216]\n      - treeitem \"New box\" [level=2] [ref=f4e221]\n      - treeitem \"New box\" [level=2] [ref=f4e226]\n  - generic [ref=f4e122]:\n    - button \"Add primitive\" [ref=f4e123] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e126] [cursor=pointer]\n  - generic [ref=f4e131]:\n    - button \"Cue timeline\" [ref=f4e132] [cursor=pointer]\n    - button \"Units\" [ref=f4e137] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e138]:\n    - button \"Move\" [pressed] [ref=f4e139] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e140] [cursor=pointer]\n    - button \"Scale\" [ref=f4e141] [cursor=pointer]\n    - button \"Start playtest\" [ref=f4e235] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e148] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e149] [cursor=pointer]\n    - button \"Next node\" [ref=f4e150] [cursor=pointer]\n    - timer \"Playtest clock\" [ref=f4e234]: 59:34\n  - region \"Room stage\" [ref=f4e151]\n  - status [ref=f4e3]: Playtest running.\n  - status [ref=f4e4]: Overview\n  - dialog \"Open a room\" [ref=f4e239]:\n    - generic [ref=f4e240]:\n      - generic [ref=f4e241]: Keyway bench\n      - button \"Close\" [ref=f4e244] [cursor=pointer]\n    - generic [ref=f4e249]: bench 1.0.0\n    - generic [ref=f4e250]:\n      - button \"Back\" [disabled] [ref=f4e251] [cursor=pointer]\n      - heading \"Pick a room\" [level=2] [ref=f4e255]\n    - generic [ref=f4e256]: Choose a draft or a starter room. Enter walks you in.\n    - listbox \"Rooms\" [ref=f4e257]:\n      - option \"Apothecary 0 of 6 solved · Longest run 3 · 4 props\" [active] [selected] [ref=f4e258] [cursor=pointer]\n      - option \"Clockmaker's Study 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e261] [cursor=pointer]\n      - option \"Judge Pack abkqrs 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e264] [cursor=pointer]\n      - option \"Judge Pack qzmtvk 0 of 1 solved · Longest run 1 · 1 prop\" [ref=f4e267] [cursor=pointer]\n      - option \"Judge Pack xkqjrw 0 of 1 solved · Longest run 1 · 3 props\" [ref=f4e270] [cursor=pointer]\n      - option \"Judge Walk rtpnuz 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e273] [cursor=pointer]\n      - option \"Judge Walk zxcvbn 0 of 0 solved · Longest run 0 · 0 props\" [ref=f4e276] [cursor=pointer]\n      - option \"Observatory 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e279] [cursor=pointer]\n      - option \"Ship's Hold 0 of 5 solved · Longest run 5 · 4 props\" [ref=f4e282] [cursor=pointer]\n      - option \"Signal Cabin 0 of 4 solved · Longest run 2 · 2 props\" [ref=f4e285] [cursor=pointer]\n      - option \"Vault 0 of 6 solved · Longest run 6 · 3 props\" [ref=f4e288] [cursor=pointer]\n    - link \"New room\" [ref=f4e292] [cursor=pointer]:\n      - /url: \"#\"\n    - generic [ref=f4e293]:\n      - generic [ref=f4e294]\n      - generic [ref=f4e296]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Judge Walk zxcvbn",
  "target": "f4e276"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/ZdssUW4sgptL\n- Page Title: Keyway Bench",
  "snapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e90] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e94]:\n    - generic [ref=f4e96]: Live\n    - status [ref=f4e97]: All changes saved.\n    - generic \"Room code\" [ref=f4e98]: ZDSSUW\n    - button \"Copy room code\" [ref=f4e99] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e104]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e105] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e106] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e107] [cursor=pointer]\n  - generic [ref=f4e112]:\n    - group \"Chain figures\" [ref=f4e113]:\n      - generic [ref=f4e114]: 0 of 0 solved\n      - generic [ref=f4e115]: Longest run 0\n      - generic [ref=f4e116]: 0 props\n    - button \"Presence\" [ref=f4e117] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e118] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e119]:\n    - tree \"Scene\" [ref=f4e120]:\n      - treeitem \"Judge Walk zxcvbn\" [expanded] [level=1] [ref=f4e300]\n  - generic [ref=f4e122]:\n    - button \"Add primitive\" [ref=f4e123] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e126] [cursor=pointer]\n  - generic [ref=f4e131]:\n    - button \"Cue timeline\" [ref=f4e132] [cursor=pointer]\n    - button \"Units\" [ref=f4e137] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e138]:\n    - button \"Move\" [pressed] [ref=f4e139] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e140] [cursor=pointer]\n    - button \"Scale\" [ref=f4e141] [cursor=pointer]\n    - button \"Stop playtest\" [ref=f4e301] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e148] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e149] [cursor=pointer]\n    - button \"Next node\" [ref=f4e150] [cursor=pointer]\n  - region \"Room stage\" [ref=f4e151]\n  - status [ref=f4e3]: Playtest running.\n  - status [ref=f4e4]: Overview\n  - generic: This room is empty. Add a primitive or place a prop."
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/ZdssUW4sgptL\n- Page Title: Keyway Bench",
  "inlineSnapshot": "- generic [ref=f4e2]:\n  - button \"Rooms\" [ref=f4e90] [cursor=pointer]\n  - toolbar \"Live session\" [ref=f4e94]:\n    - generic [ref=f4e96]: Live\n    - status [ref=f4e97]: All changes saved.\n    - generic \"Room code\" [ref=f4e98]: ZDSSUW\n    - button \"Copy room code\" [ref=f4e99] [cursor=pointer]\n    - textbox \"Invite tester email\" [ref=f4e104]:\n      - /placeholder: tester email\n    - button \"Invite\" [ref=f4e105] [cursor=pointer]\n    - button \"Playtests\" [ref=f4e106] [cursor=pointer]\n    - button \"Session menu\" [ref=f4e107] [cursor=pointer]\n  - generic [ref=f4e112]:\n    - group \"Chain figures\" [ref=f4e113]:\n      - generic [ref=f4e114]: 0 of 0 solved\n      - generic [ref=f4e115]: Longest run 0\n      - generic [ref=f4e116]: 0 props\n    - button \"Presence\" [ref=f4e117] [cursor=pointer]: 1 here\n    - button \"Account\" [ref=f4e118] [cursor=pointer]: MQ\n  - region \"Scene\" [ref=f4e119]:\n    - tree \"Scene\" [ref=f4e120]:\n      - treeitem \"Judge Walk zxcvbn\" [expanded] [level=1] [ref=f4e300]\n  - generic [ref=f4e122]:\n    - button \"Add primitive\" [ref=f4e123] [cursor=pointer]\n    - button \"Upload prop\" [ref=f4e126] [cursor=pointer]\n  - generic [ref=f4e131]:\n    - button \"Cue timeline\" [ref=f4e132] [cursor=pointer]\n    - button \"Units\" [ref=f4e137] [cursor=pointer]: m\n  - toolbar \"Transport\" [ref=f4e138]:\n    - button \"Move\" [pressed] [ref=f4e139] [cursor=pointer]\n    - button \"Rotate\" [ref=f4e140] [cursor=pointer]\n    - button \"Scale\" [ref=f4e141] [cursor=pointer]\n    - button \"Stop playtest\" [ref=f4e301] [cursor=pointer]\n    - button \"Trigger graph\" [ref=f4e148] [cursor=pointer]\n    - button \"Prop library\" [ref=f4e149] [cursor=pointer]\n    - button \"Next node\" [ref=f4e150] [cursor=pointer]\n  - region \"Room stage\" [ref=f4e151]\n  - status [ref=f4e3]: Playtest running.\n  - status [ref=f4e4]: Overview\n  - generic: This room is empty. Add a primitive or place a prop."
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
  "result": "- [Screenshot of viewport](evidence/reduced/page-2026-11-12T03-28-00-108Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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AABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAA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CMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYADQAAACogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAACVX01YAABAASURBVAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAR37Tp4ePl4eHgZ3T3d3AyaZtBchc1qtVnSTGZzqjk1WQMAAAAAFI6PX6C3T4CHp7eb0ehaKc9iMZtSUpLjkxPjtGt1jQFYoq+8KfaQaUpNSYq3Wi2aK3GTZeXu6eHpJTMpbxAxGAAAAADyJ9E3IKiSxEyzyWSKj3bNlOfrX0FmMj428tpi8LUEYHlfjEaP5ISYtDST5pJkUVlNyWZTsru7p7dvgLu7x/XsJAAAAACAG1tgcBUvb1/JTeUi5fkHVvTw9ImLjtCKqMjHAEv6NRjcEuKuuOz74kxmUmZVZlhmWwMAAAAA5CDp18PTKyEuqvykvCiZYZltrYiKFoA9vHyk9puUEKOVKzLDMtsy8xoAAAAAwIkUC6X2m5QQq5UrMsMy20WtdBYtANsPqU2K18ohmW2ZeQ0AAAAA4CQgqFJKUoJWDslsy8wX6SFFC8CWNFO5qInnJLMtM08RGAAAAAAcpIJqsZjLccqzmItUBC5CALZZbWZTqlZuycx7eHhpAAAAAIB03j4BZlO5TL86mfkidfUtQgA2GOwVYK3ckpk3untqAAAAAIB0Hp7e5T3lyUso/PhFuQySQXO1K0EVicy8m5vrXMcZAAAAAMqYm9FY7lOe0Vj48Yt0HeAbID0SgAEAAADAQa2UV+TrAAMAAAAAUB4RgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBLcNQAAAAAAikPDxk2NbkYZsFgtx44c0lwMARgAAAAAUDyGDh/r4+srA8lJSZ8eeVNzMWUcgKtUrSb/RoRf1AAAAAAA5dynH7pc6HVWxgG4W89+8u+cWdM0AAAAAEB5FlqpcuMmLeRfzaBdjrx05NB++VdzJXSBBgAAAABcr34Dhnbu1is+Pi7i4nmbprVt16lXn4FbN69btXyx5jIIwAAAAACA6zJk+Ji27TstWTh3986tjsa27TsPGX6Tp6f3koVzNNfAZZAAAAAAANeucdMWkn7/mjXNOf3WrFXnyuVLc2ZNk7tkBM01lHYFuErVavpxv7rqNWrJv2MmTHK0bFq/inNiAQAKZNCKxqYBAIAS0aZdx8OH9h85tN/RIul3/C1Tzp459efMX+UuGcH53jJEBRgAUD4Ysv6V8sMBAEBeJO6eOHbE+eaEW/9x8fw5/WzHcpe0aK6htCvAUt11PuezXvvlLNAAgLyUUFh1nizFYQAAroenp1dKcpLjZvde/c6dtdd+rVar3JS7ZATNNXASLACAKypy7s35gELnWkPRRgcAAFnExcUGh1R03Jw57Ufne+UuGUFzDXSBBgC4loK7KBty+3O6M7/RDAVPFQAAFMmJY4ebt2yT171yl4yguQYCMADAVeSXP50SrCHPbGvQ70wfyDv8FhSGicEAABTJ1s3rK1ep1nfA0Jx3SaPcJSNorqGMu0BvWr9KA8oAXR0B12Io6A5D4UYvcByD09ff5jyWLffHs7IAAKBA0VFX/p4zc9SYicEhFXds3Xj+3Bn5Ia1Rs3bHzt0aNWkud8kImmso4wDMFY9Q+tzcjFaLRQPgGvKPvoaCRixkqdaW2yMcYfhqEiYGAwBwTQ7s2xMfF9er74DbptzraDx75uS0n7+VfzWXwUmwoByju6fZlKIBKGv5J9q8ou+1dU7O9ihb1uarSTjvGEwGBgAgf3rcrSBV4NBKcvPK5ciY6CjNxRCAoRwPT8+khBgNQJky5N2UMwLnFXoNRUnDttyqwFmTsC3rf7I+Vy5tAAAgOwm9Lph7HQjAUIu7u6fR6JGcGKcBKCP5FH4LjL6Goh8KnOvYNlv2NpvTLb0gnFcMJgMDAFB+EYChFm9f//jYSA1AGcmr8Jt/9DUY8n54xmmh82PLeror5wllS8JOt2wGx7HBZGAAAG4UBGAoxNc/KDUlifIvUFbyTb/5Rd/sdeBcekvnmUlt+rWRbM4ttpxPZnMqATsG8yoF0x0aAIByigAMJbi7e0rtV9JvXHSEBqAsGHK7nS3I5hN9nUNvtrhbUEdo597NWfJwziScVwymFAwAwI2BAIwbmZub0eju6eFpP+43PjaS2i9QVvJOv4WOvk65N/8Dg7Oz5XY76+mfrybhrDHYdvUZ8iwFk4EBAChHlAvAQSFVNajCZrVYzKaUpIQYoi9QhnKm37wKv7lE39xyr8HpcQZbARnU6cTOGWHXiS196gZDxt3ZY3DWUnDuRwWTgQEAKEeUC8DhZw9rAIDSkn/6LUz0zT6OzZDl4kUFdYC2s9lzsi1z9BxhOJcYbNPLvllKwXl2hyYDAwBQXtAFGgBQUq4h/eqjGAzZo68j9zo/MuuJnbN0hc7MthmPsTlPLTMMaxmBN/MRmTE411Kwc3doMjAAAOUUARgAUCIKn35zFn4NmXdpmSVfx2Myo6nBkNcTaVlG07Sr6ddmyziUN+Nem2O2ssRgPTFnKwU7d4cmAwMAUE4RgAEAxa+o6Tdnn+eMqq+WJfrqsTdb6TjL5LNyvgKwPcSmV5YzkmpmqM0oCGeNwTZD9lJwtu7QeZ0aGgAAuDICMACgmBUm/Wbv9py18Otc9c1sNGR9YPZsnNe8pGfdzEKuXtTVuzSnT1BqwrbM8Ju1GpwxkuY4OVYhMjBxGAAAF0cABgCUpEKkX+cjfg3pt7JVfa8G44wjhB2PtWlatoN/s7NlVnrTz4SVEYIdSVjLjMFOXZwNelE4/QlsWY4KJgMDAFDOEYABXC8vbz9v30BPL283o4ehgEuy4sZnyLXFkOXeLP86gm7mTUOWbJx95OxTMGgFfuZsTqd8dvxrszkNa3rd1+a4plJu92ZOzelfLetdWtZxABQLm9ViNptSUxKSE2OtFosGANeBAAzg2nl4+QQGVXYzuplNKcmJcRarJSNqQFW5pN/s0deQrdGQNQPr9V5Hss06giFrPM6SfnM+tS3bsC0jzToN27Ik4asj2ByZ2TkJa1eztC3bU2T74PM1AIqRwc3NaPTw9PYLCKqUEHclIfayBgDXigAM4Br5+lcIqFApJSnelJisAYVIvzkb80q/eqOb5ojBV6Nv1iKwIdsFhLNxpFZ7X2WD4/RXei/o9E7R9uGMGKw/V3riTT8G2dHdWbt6JaTMM0IbstV9HRcNdrw0MjBQXGxWa5o1Nc2cakpO9Pbx96xcO/ryeSkLawBQdG4aABSdj3+Qf1DFxLgoUyrpF7nLmX6deytnT7+GzPRryIi4bukDblL7Mcif/efK/m/6gCGj0WBMv2k0ZNxldPpztGSOICOnPyo9M2dMUJ+mZkh/loxfRKekbchRgr76uq6ehSuvl68BKGZWqyUpMVaib0hoTQ0ArgkBGECRuXt4BQVXTUqItVjSNCCdoeARrnZ+ziX9pt9ycyrz5hp9Hbk3W8R1jsHOYdjRbsycgh6GDXrizZx4xgwYMmcg1wzs9DJzzcAc/w6UjpTkBKtmDQyuqgFA0dEFGkCR+QeFpiTFW9LMGpCHfA79dRziqzmlXzenbs9X46hTn2fn3tGOgSrexnbB3s0DPev7e1TzcQ/xcvMzukmINVltcWZrZKrlbGLa0Xjz3tjU7VEpeidnW2b/ZJtmsNpvXL3Skc1msGqOvs6ZnZgNWU797LjHuc9zznGztQMoXvIbFBAUmpzoYzbRCwlA0RCAARSN0d3D08s3PuaSBmTKVvvM59BfQ+YdTpXVXNKvcyXWzSn66t2WJOsOq+7Xr7JP8yBPLTeeboZQL6P8NQv0HFzN3pJssa2LTF4enrQyIsmWeQywTNNqPwzY5pYeXK3pZef0AVv+GdjphRtshFyg9NlsppQkX/8KsVEEYABFQwAGUDRePv5mc4oGFFq2CxU5dyp2HPerZaZfN0ftN7Pw6+ZU9W1VwevWOgFDq/lqReRjNAyu6it/F5LTZp1J+PV0nMWqXwtY/rVfhlhuuWmZMVhKwTkysM2WcSlgLfME0c4nxKIIDJQysykvkjdwAAAQAElEQVTFPzAkVgOAoiEAAygaDw9va1E6Pxvc3G3W0j5U2M3dx37e0DSCemnIv/yb66G/hUu/GXVg/V+p+j7YMGhEDT/t+lT3cX+0SYVb6wZ8eyzuz3Px6UVg/RTQ9oibnn5zz8BXk216S86O0ABKk9Vqka+o0d2D43EAFAkBGEDRyNZGYY658g1tGlC9i0+l5j4Vm2llcUJcc2J4aszxhIs7Yk6tKv0EDmc5D/3Vsp5fKq/06wjAE2sHTG1SwdOt2D5Ilb2Mz7cI7lfF5/1DMScSTHoB1yrVZr3Om1sGNmSt5ubsCE0RGChlVovFzehOAAZQJARgAEVUUAYxegaENBwWVHdAcmRYzOE/ImJP2SypWmkzuPuEeFdsUaH+YP/qnaOPLUoI36mhBBSm/Jtt/GwnsjJkO+uVU/qVmx5uhv9rWXFY9SL3eS6MbqHev3av8tq+qIUXEt0yM7D9XFi51YENtuwHA2sUgYGyZiiLHawAyjUCMIBiVqn5zb6VWkbs+MAcf14rM7a05CsJ59bKX1D9YZVbT7HZLIkRezSUutw7P2f2izbkctarq+m3uq/7W21CW+Rxpqti4eVmeLV1xeo+7t+dSD+WMLMObM1IvOn/Zp4WWn89tqwZOKOZIjAAAOUBARhAcarYeLRv5Tbhm1+3prnKmTljTyyyWkyhzSaYk66Y4s9pKD5FK/9m6/xsyHiI09mes6Tfev4eH7SvVMu3NH6nHmwU5ONu+PRIjP1GegaWmOuWfnhw+kzZDLYsl0FyRhEYAIByxE0DgKLIp7+Zh1+VCg2GRR38zXXSry7+9AqrOSmoVncNpStL+ddxGHDWm26awTkD6+m3io/xvXallH51d9YLvL9hhYx50K+9lDGQ0T3bqcN21qDveLFZjnG+ujsAAAC4DgIwgGITUL2DJflyypWDmuuJO7nYr2o7gxvdXkpcIcu/2Q/9dT4tlkF7o3VoHb/SXlj3NQgcV8vfqat21tzr9DpyifQFxV3iMAAAroAADKDYeFdokBTposfZpsYc8/Cv5ulXWUMxyav/c7aWXMu/mpbLSbDcMivAL7QIaRvspZUFeepWFbwcc+IchrWiF4EBAICrIQADKDbuPhXNieGaq0pLvOThSwAuS87lXz1RZjkAOH1geHW/sTX9tbLzdLPg7FcqLlwROCd6QQMA4GoIwACKLo/z/bi5+2hWi+aqbDZLxil9UWKy9X92dA/Or/zrlDP93A2PNq6glakWQZ73NgjKOnv5FoEz0QsaAADXRwAGAFyvvPo/a86pz7l/cNbyr2Pgnw0rhHoZtbL2zwZBVX2MuRaBdc4xPtde0AAAwDURgAEUH7b8lVHIRe0XEOzu4Zn5kIy0mFf5t5qP++S6AZoLcDNod9TLWgTWrp4WS+cchr38g43uWS5WzFcBAADXRAAGABSnnCXQ3Po/G5wb9Zx5S22XSL+6W2r7h3i5Zc6kIXsSdrRmlU8lHAAAuAICMACgeBhyu+k4GtiQczzD1SQs/xld009zJaNrZF4SKWvX52xhvkiIwwAAlC0CMACgmGXpJ5wRGg1aLqeVunqppEFV/YI8XOsnaUhV3yxXcnI6FZYzQy4D5FwAAFwUARgAcF2K1Ms3l/NIpQ/1qeyjuZjGgZ71/T2v9oJ2uksP9o54r+VW2iUEAwDggso4AN86+W750wAANyhDjt7CGX2KDVkycJeK3prr6VzRK2MmHaVgQ7Yu0ORcAADKk7IMwD17D6hTt4H8yYAGACgnDPndZShg3CwNGWXVhv6ewZ6u2COpTQUvTctyAaQCcdYrAABcmbtWRiT09ujd/8rlSBmWAfl3/doVGgDghmDIGnWdS75XR8gsqzYO9NCujZePNulxLTC4gNG2r9I2LNSKrkmgp30mbfZhQ9Zqti3z3wLJFGyFGQ8AAJS8sgnAevrdsHZlaOUqcvPQgb1kYEAFb77+yqCB/V9+5fX5CxY5GqtWrTL3z5kREZdGj71Zcw0jb5rQolW79EFbQnz8uXNnFv0922Qy5TV+w0ZN3dzcjhw+kNcI7u4ePXr127RhjcmUqpWkTl16tGrTPjgkNCUl+VLExcUL5sTHxRZpCnXrNxwxavxnH72tFZGhoPuudnjOMXIdv2sNwH3HaB36Fjxa3WbXFoBr+7q7GwxWR35Nj7wS5G1OydeQ5T9F8NCjzwQEBmVr/OP3n04cP+K4GRhUYcpdD8z7a8bZ0ye1cqhPv8EVQirOnf27VtwcX1KbzXrxwvkD+/bs2LZJKz72OQ8Omfvn9KbNWvYfPOLbLz6sXrPWiNETPvvwLc2FtW7bYdjIcUsWztm9c5ve4unp9fgzL3331UeXIy8VfjoltMqa+vRLM6f9cOH8WQ0Ayk7ZBGA9/UrcHTNhkpaZe6WRAAzc8OLi40ePHOEcgMePG5OUlKy5mL17diz8+0+JtdWq1xw8bPSgoaMWzJud18j1GzZ2d3fPLwB7uHft0WfH9s0lGoBr1a7bu9+gZYvnHz18oHqNWn0HDJU5nz3jF62s5Xne5MwicFVvo3ZtjIX7FfPw1K5VVW/3M0nmzAifJQk7XFuv588/fkcfeOSJ55ct/lv2BeccJyE+btf2LbIvQ0MOzl9SiabyHdyyaZ1W3CSt7di6qaR3XRUj+cz07DPw2JFDCQnx2rUqnVUWAJSJsgnAb7/2QrYWib6kX0AFGzZsGjJ4YIMG9Y8fPyE3ZeN1+NAh69ZvaNumtT5C5UqV/vXQ/d26dUmIT1i7bsPnX37t4eGxaP5fr7z25vIVq2QELy+vpYvmvfbG28uWrxw7ZvToUSMaNmiw/8CBr7/5fueu3Vqxslqt58+d2b1rW4eO3TR7WnPr3qtv02atfH39jh09tHbV0sTEhFFjb2newj7zrdp0+OCdVywWi1ROmrVoLeWj48cOL/x7tlRg7v/XkzLCvx57VopUy5fM9/Xz6913cINGTdLM5v37dm9Yu0qqWNp1q1m77rkzp8N2b5dheeqLF87pvWxE1Wo1ZCejJGSpAskzSqaSRqPRPdusJiUmOk9QckX3Xv1q16kXHXVl66Z1B/aHaUVUyGRYwcUugOQsyNNNS9JK07Mvvr5ty4ZmzVudPnV8/txZvfoOPHRwb2pKiiyvnn36N2/RxmAwbFi3UkKOVFbPnT2dV7t8ubr37NekWUt//wD5uK5esVg+rlLhHzp8zPnzZxs2arpi6fyw3Tscz5vXdCbfeX/UlchqNWp5uHt8+em7UrWW6miDhk08vbx2bt+8YqmU1m3SIsVqs9nUtHmrqCuXd2zbvH/vLn2yMrU+/Qe3bN3ekpa2eePa3Tu3asVK/5Lu2rGlecs2EoBlTqpUre7h6Vm9Rs2vPntfZkla5MWmpKYcPrhPdr7L+Pqb/PdfM7r27BsQEHj86OFVyxfJm5Pr9ENCK3Xs0n3LprX6zXYdu3Tr0ddqsUjNed2aFfLNzfmWyovt2Llb5SrVoqIuL5w3Wy94Oi/W6Kgo+fr//P0X+jS79ezbuEnzn777XCsO8kpl3mTn159//Jbtrlw/EkNHjA2tVPnXH7+W5Th81LgKwRVlVZBtleWYgrzYwUNHb1y/unPXnv4BAUcO7V+8YI5+l7z/7Tp0qVS5ytkzpzZvWCMLRUv/UMkHuFn6GnL9mhX5z4kGAKWCyyABKFWJiYkbNm4eN2a0frNf3z4Wq2Xvvn2OEd579y1pmTzl7uee/0+rli2effoJecjKVWsGD8o4W54MmEzmFStXy8Cdd0z+4qtvRo+dsH7DxvfffUvCs1bcJPTWrddQNmRlWLbj69Vv9Ncfv3375YdSGJk46U65XzajZeNbilGya08a23XoXKtOvflz/5D6ns1m69t/SEx01EfvvSYP/+yjt/VNyZtv/YdUaX74+hPZQpUg0atP8ZwIUDZGK1aq3HfAkJq16hiNxqSkxDOn7HsZ/Pz8b51895FDBz778C3ZHO/VZ6BkdWnPOavOU5MNU5nPvXt2fvbh2yuXLxo87Ka69RpoxcoRj72Nrvtj5O1WBme1qlAh+Nefvpb069woS7ZW7XrTf/v+p++/qF23ga+vb0HtQ6tUrfbXLPvHVVKf3uVKBFUIvnL50ucfveWcfvOZjqhRs86iv/+U9CvDAwYNl0/LT99//ttPX9dv0Lhl67b6OJJ/IiIufvHxO6tXLhk8bFSduvX19jp16kdcvPDjt58dPXJQnkKSj1YyDJnnH5M9QRI133/7v3GxMRNuuUNe+3dffzx7xi+1atUdMHiEY/zO3XpJwv/2iw/l5YwZf1thnkLek2rVavz07Wd/TP+pYeOmsr9Ab3d+S+27jXr2lSj+8fuvH9q/d+RNV4/scCzWsD0yWg3ZZaC3y06HvWE7tWLibnTfsnFtcMXQRk2aZ7sr14+EhHZZRXTq0l3Gl/0XC+bNyrnKcia5NyiowvTfvlu9YkmrNu1l55o0yidh4JCRsk/w84/ePnRg38RJdwWmd+/vP2iYrI6m//qdpP16DRp5enrkMycAUDoIwABKj2xouhmNf/41Z/iwoZ6e9l6pN40euWDhYqs1oztp504d6tSp/e67H16KjDxy9NhHn34+bOgQHx/vOXP/7t6tq5+fn4wzaOCARYuXyDbTuLE3zZr919at26OjY379bXpcfLzUjbViIhFRKjby99S//+vl6SUFCtm8bt+xqwxIGE5OTpKSkX9AYO269bI9cPvWjRIMpPohVeLYmOhKlatmG6F6jVrywPVrV0hAjbwULrWyxs1aaMXhyuXIH7/51N3dY/S4W6c+/Z+RN03w8w/Q7IcFdgy/eEEiutlslpn/5YcvD+7fU+Csyjtw+vQJCdWS6iVIHzl8oEmzVhpKxfq1K2WJOLfIx69Nu07y8ZNqfGJC/Iol82XXTP7tbdt3XiUf1yuXpba2fs1yySGyoOWulOTkjetWpaamFmb6OinbOo7bnDP7d8lIki0lysqUpc6pt58+eXzX9i0yWfm07NqxtW2HjC/juXOnDx3cJ9OUr4yXl1fF0MpacQsOqSi1x4OZPRROnzwmn1uLxSLfNaltrly2MDkpSV7X8qUL2rTraMzsNi/RTr4y8hKWL/m7es1aISGhhXmuFcsWykPkgRL/5JulNzq/pRcvnPv68/dlZuSJ4uJiZN7kK6mP5lis8XGxZ06dbJP+cPneBYeE7NtTPAHYZrMvSlk9LlkwZ/DQUZ6eXo678vpIyGph3l8zpKzdb8BQeVHZPng5yRu7Yd3KpMTEsN3bL144L2+dNEqRfMfWTVL7NZlMUvw/c/qEfJzkGWU1cvVDtXSBvpMinw8ngHJKtpdatm53zwOP/fOhJ2RvWuu2He576PGpT/1nyPCbNNdTql2g9csd5d/VuTDjACinDOmbP+vWb4yOiRk+bMiWLds6tG/7ymtv9OndSx+hatWq0VHRSckZhwQfP35CKgZVqlTZvSfswsXwIYMHSuFXQvL/3v1A7g2tWPGxR/8l9LQt5gAAEABJREFUf47pV6pUqE3YwtAPL5Qt139Nffb4scOyoebj6+vh4SG1EX0E2cSUDCAlnTNZHyj1n2Gjxnm4eyQkxJtNppz1Lin7SHFVfiocLakpKVoxkVAtm/XyV6Vq9S7de98y6c7vv/4kMCjIeaNWNkYLM6sBgYFNm7Vs6jSfx44e0oqV4yjaFEsx9AAvISnWMjiDc1qaOVuLt4+P88dPFnRqako+7V7e3tJ+34OPO09EP+dWmiUt5zPmNZ2M+XF6SItW7foPHJaQECcRSAKt42OT4jR+TPSVWrXrZr6WjMfKV8ZisRqN13q8dw4SrvS+DDLlfWE7HQcAp1ks+oAUZhMTEhwzIN9iCaV+/v7yzZWbshtLb5fgKqNVCA7RO3rkIyU5xfFtlZHli6wnOuf3R6qpQ0eOlUQnIVl/Isdb5LxY94bt6tVnwLo1y6WIevTIoXzOsVckjqtwnTt7+ujhg1KAXbks44QLeX0kZFlLaJe9XdWr19yZfnBE/hzvpz5sdLMv0MDACvtj9jjaZSUTVKFCtg+VZODUVFP+c6IBKLcqVAj5/quP69RrMGb8pAN7d3/z+YfVqte4dfI9sgP95PGjmisp1QBcq072Ukn4xfMFjgPgxjN/waJRI4bXrlVz0+atly9fcbSHh4cHhwT7+vjoGbhBg/omkzkiIkKGFy9e2q9vb9lsCtu77+y5c9JyJSpKqsc//FSCJ3mSDdbNG9Z27d5HKlpS5JGNVNlK1k8tIxu1snkdk6NaMmrMxF07tmzbskFLPyNrh07dso0gxR+pR338/huFu4ZOEcjTJcTH6+cQjgi/IAW3hx59RnJ7XGxsHafey/aXEB8nW675z2p8fNzRwwdyHkZYJIV8hTFm1w3AsSaXmDf5+Mmn0fHx8/Dw9PLyzqc9NSVVPq6//vhl5KUI5+nUrd+wSNPPxj8gcORN43/45jP9vFwjb5rguCsos0OvZv+MVZTPj1bC9L1U+Ywg+30k7rq7u+uZLaRiqMWSJllXvzc4uKJ+LUaJ8TJabGx0gc/o7eMt4U3PwFIxluqlLccVrnr3G2xJS/v0g7fkuWRvl374a06HDuwdNHSk1M+bNGu5eMFfWglYtWLRvQ9MrVUnY79VXh8JLb37erVqNUxmU9fuvTdvXKMVndS6ZW+g46bUvS+FX5QPlZSXHR8qP/8ALy/P/OcEQPl1+NB+WSWeOnHMZEqVyoFsAsjOtchL4RKMNRdTxl2gN29YI38aAMXMmft3s2ZNhg0bIgPO7Vu37Th9+szjUx+RMlFwcIXHHn5o4aLFycn2zc158xe0btVyQL++Cxct0UeeMXPWzRPGtmvbRoZ79ui+bPH8+vXqasVt+9aN8m/Hzt1ltb5rx+a+A4bK5rJ+Xh+9H6PcK+t6Xz9/fXyz2eSRfs5h2T52RMo0s1ke7p/eIfn8uTPR0Vf6DRwi5WWpR42fOHnQ0FFacZDEIpm2Zet2np5estE5ZPhNly9fkrAdtnt71WrVpZyrpW+DTr7z/qbNW+U1qw5hu7bXrFVXP79XQEDgvQ9Ola1k7ZrYsgVhp1t6fAhPsWiuKjzFnp3SZ9N5vrOMUwo1Yvn8yB70fgOHyVKWj033Xn316JV3u1U+rv0HjdA/dV179Ln7n4/kc1ayvKaTjYQ6Kbfqxy/Ua9CoYaNmjrtCK1Vu276zDEioa9ehs+xb0crahfNnL0deku+sfGHlaztg8Ig9O7dbMqu1PXr3l91DsidrwOCRF86f08Nw/uQ9GTBohKydfHx8+w4YIt+RnOPI10p2Hki1W97JPlmPq3cmuxsOH9wv75gskpPHj2klQMLn4gVzBgwarmXMfO4ficDAoMHDRi9b/PfCebPlPdEPhXBeZRWG7Efr0LlbxYr2szA0atysdp36e3ZtkynITor0dab9QyVzop+BrKgfTgDlgmPtal9X2q77SgklqWzOAp2/cnq1QwCFFxUVtXrNuhbNm63fsDHbXU8+9dxjj/5rycJ5cXFxcu+nn3+lt0uhePuOnR07tH9k6pN6y8pVa/z9/B995KFmTZtcuRL13Q8/nTh5SituskKXkkj3Xv0kCa9Zuaxnn/5T7nrQ18/v+NFDM6f9qGef3Tu3DRk+5unnX/32yw+XL5k/bOS4Xn0Hyvb0qZPH9I6gUoBavWLxuImTz505Ne+vGbNn/CIj/POhx+2nUT18cPPGtVpxkG1Qo7v7wCEjR4yeIL89p0+dmPHbD5r9xGMJ03/9vmfv/sNHT5AksGnD6n1h9tNl5zqrDvKomb//KBvEg4ePMRi0sN07ZHs9n2e35Zeu7PfZMi8eZMuRGE8nmjWXdCYpLc35ZzwjB2eZfVuW/5SgJYvmdevR5577H/X08l6+5G/H9WnyapePa7eefSZOuqtS5SoSBSXh5D+XeU3HmexPWb50wfhbpnh7e58+eeLM6ROOu44fO1K1Wo1nXnhNisNLF/19+uRxzQXMmvFzvwHDHn783zLnRw7vdz4R8Y5tm++692EJq8ePHv5rVqF6OiTEx8s7+dhT/0lOSty/d/e6NbkcrrVp/erR426V9yEhPi7bacay2Ru285ZJd23bvL7kPj0nTxw9f+601GP1m7l9JDSZ20MH9qWXa7Stm9eNHnfLj998lm2VVfATHT9qX5+MGqefBXrGb9/HpV+BfOWyRbKGcXyoHL38ivrhBIBiZPALLOwhc1VrNYmNCteuQ+069W6bcu+ZfPOtjKNfIlgrAUEhVcPPHtYAXIeKVeqYUiQW5HLEWt0Bb8cenZN8eZ/mkqp2ff7ygekJ4Xs0XJ9sQddx2KEh85K/hszL5voHhJhTEyxmkyH9lErS7iZ/msEtc8CYPtA4wHN6j6raNRg+xf5XGA8P1opuWXjSc7svS9HKatMsUreyaenD9gFbemP6vzZ3v+C0lERLmknfhLfZMkKy46azYtnMl/fzyede/vn7L7NdIjiv9uKafl769BtcIaTi3Nm/a+XEsy++/s0XH0RduayVHSmkP/7M/339+fuOw/JRVH4BwXHRl0yppXulMuCGc/0pz3ml+tCjzyxeMEc/IGvynfc7Lr5YooqU8kq1AizRV8Jt/kf5/v7Lt2eoAAOAC8un2CvBz5DlTlu+D7afs1b+cyzBFG2yBnu63IUJ9sTYq6A2WxFSq63E6lhduvUODArauG6Vh6dn1+69ExMT9UMo82ovrumjJBiNxlZtOpw6eZz0CwClrLS7QHN6ZwBQik272vnZkNGSnnvTs3LGCDZty5WUodV8izz13E5onAvzNZ5id+uVVOcqrs0pDGf+W3r9Nvfu2TFg8IiHHnvGzc0YfvH8zN9+kFJ0Pu3FNX0UOzc3N6n9SqlkzqxpGgCUf2+/9oJj+POP33EM//rjV5rrKdUu0GWOLtDA9aMLNLQ8ekEbMu4yOHWBDjalJlrMJrf0Nrf06nB6/2d7j2jHgNGgDa7m92abilpReflokx7XAoMLGG37Km3DQq2IjsSZJm0Kt9jsXZ2t6VnQqg9r6V2g07tD6yf6cPcLNqckWtO7QGdG5auV4JLoAg1Aows0UExUS3mueBIsAEC5Zq/wZlZ3HSeOkvBryzwbli39dkZcTB9YFp74XPPgII8i9oJOTdZ+eEMrGUvCk64WfjNrv7a8z2ntNEDIBQDARbncAVcAgHLKlttNx0mSbTnHs2VUSvV4Oe9couZK5p1PyMi9WTNu1i7QRUMyBgCgbBGAAQDFKWf905YjNDpyr+ZUXJ1xJl5zGTPOJESlWjNn0pZZ/r1aDc5ozSrnGbBK7pxYAADgGhCAAQBFVshYlxgfnZZ5AirHlYGy9ijOOIxW/i4mp/16yiUysATfn0/GZplJR27PfOXOVeHUhGhL1qPiib0AALgmAjAAlZBLSkY+lU/nns+OQ4Kvdn62ZcnDXx+LuZxq0cra18djw5Mt2fK588WQnErZWo5DgvmQAQDgugjAAIqN1ZysuRk1V2UwGPO+fi2Kx9V463zTlmsv6FyKwIlpto+PxGhlan+s6dvjsTnDuS3jf5k3C9H/OfsIGgAAKGMEYADFJi35iodfVc1VuftVNidd0lB2MoJuZinYuQisX1hIBhZeSPzrXIJWdv53MDpnMs8zwzsd4ZwTBwADAOBqCMAAik1KzHHfSm00l+RVoaE5IdyUSAAuNtnCXV69oHMGxVyKwOlh2HGh3df3R+2OTtXKgjz13phUx5wUXP7Nrf8zsRcAAJdFAAZQbOIv7DD6hHpXbKa5nsB6QxPDd9qsaRpKWLZe0FlasxaB9dwr/1pzlFufD7t8OrG0F9Y3x+P+PJvgHHpttsKWf+n/DABAuUAABlBszIkRMccXhTS73c3dR3MlAXUGuHn4xp7dqKF05VMEdvxZs3aEtqbn4Yhky5O7Is8mlV4G/vFk3FfHYjLmwf5vRjK32nIk4cKVf+n/DACACyIAAyhOV47MS7q0p2qX5zwCamiuIaj+sIBafS4fnGWKP6ehWOXVC7qQRWAtSyk4I2o6MvDJBPND2y/tjzVpJe+Lo7GfHolxPLU+hxl16azpV7um8i8AAHARRk8v30KO6h8UmppclicmuX7ePv4JcVc0ANfB17+CJc1steZ5rZrkqGNGD5+KzSd5+FW1WVIspgTNVvoXtjG4+1T0rdqpYst/GNz9rhycnRixW0MJyHZabYMhS7sh/b8GQ44HGDLuyvhHHytjbEerlmC2zr+QWMPHo1GAh1YyUq22/+6NmnEm3lH7lbxrzZrMsx60fC3lXwIyUBI8vXxSUxItFrMG4DqolvLctSK4AX7B2QgBrpc9AOR7LSGLKT7ywMzES2EB1btUaHKzj/2Q4DK4+JA5MTw15njMiaUxp1Zx6G/JsWVduvZPh+Fqu8RCQ9alb8v8j81w9fH2uGiQT5bBatDc0oettowMbLLa/rP38t7YgKlNKni6FfMHadPllPcPxZxIMDmnXz33WjP+zd75Ocu5uzJfMoCywpW3geKgVsorQgC2WixubsZ8yj4uzj7zlvI684DrkPKvWyEu9pt0+ZD8aUBmKtZ/mgyZidnmyMrpnY0l91oNNrccGVgfY8bp+LWXkh9sGDSihp9WHC6lWr49FvfnuXinrHu19pt7+tVs2Xo+X32BlH+BsuBmlE079m8C10u1lFeELtD2MQ1u5XdF4+7hLds2KUnxGoDrYHT38PDySTOXzVVq4JqusSO05uj9nFlJNjj+53hwZnfoNOvqS8lSs/U2ujW8jh7RF5LTfjgR99yey/tjTZkHHutHIOdb+3WOtTbHP5R/gTIjm7xeXr7xsZc1ANdHtZRXhABsMBi8ffzMpvK61Sszn5wUx1Y7cJ1kB6F/YKgpJVEDMuUfgNMHDAaDU0uWMGy/xzkDZ0bmrBk4/WZkimVlRNLf5xOjzVZ/d7dK3gV3RtAlW2yrLiV/dSz2jQP2iww7rvGbvdtznuk3o8abs/Mz5V+gTMgWbJpslZbzAxcBV6BayrkpXSgAAAXESURBVDP4BYZqhVa5eoPkxLi0tNI4J2fxcnf39PELvHThuIb/Z+9umto24jiO/1fG4CdMSplpO710euyt7/8t9NZjjx2m7SSB4pAANvZmJe1Ku6sH28E2tvl+MmMkWSsRmDj66b+7Al7s3dXP5jL/iQwMz+pFYOWF3Dz6mj+JezdxW8xrUu6Qrit/NVv4odf5/bveb+PTX0fdn/onl2fJsJMk2cjhyWzx/mn+9+fnvz7N/rx7+uPmMXgmkzfvtBR1YB08k8lPv34r8QKwLgc1WwRgYBeUOr+4un1/PZs+CIAXe1Mpb70AbI4+Gn9/P7mRQzMaX95PPprfqwB4sZPu2dWPv5h/U/Nn5t6EVZ2famkGLpfzxGvSr7clcfNCh6FXxW0rp/Npv7uyW13YBe/5wy7NrpV+hfIv8Ep6w/F8Npvc/isANuFNpbw1ukAbprJsLnwPrkQ+GF1MTa3qAH+jwH5aLObzxbP5xJnPptm0QUBqlY7QEiZVpfzGKtrbaxQcSGdzabnlbB5pP+WKy7RSlHmjVRt/tYRzXGW9oKU2/cra6RfAlvT6o0R1/v94LQA25E2lvPUCsGFO0T3tDYbj9AJ47+cKMzXx/Ocyuf1PAGzO8/TJRIPRxZUJwHMm4URmaRFYvMHA1X2iBvmQYN0Qg10cVaLi6KsrMTgPvUUGFu3tExZ+pSn9Via+itJvFXEY2Lgk6fQHY1HJ7Ydr7jkBm/V2Ut7aAViyn4655B2eX550u+lwLZ1fJOwR8/l40u2Zexjmb3c/+UDtF9iG2fRx+vTQH1yc9QdpptGa5zFirY7Q1X1qGrhlXbZO2SzqwnBtBl5ElVvtbfefbFSNvnbSKwnedfu4IwXo/Axsj0oSc7F72h8ORu8evkzubv4h/QLb8EZS3npjgCP94bjXPze3CpJOp+6y57WkBSlzaf748IlBv8AOnPWGvcH49Mx8FHSV2p+PArwOVbsljsHeaziatxjuK65cHO0cH0Et/+8nGgkslWTr4rHWEoTh8F13NO9VpC4NE4CBjTIXdrOZqfTcP3y+W+tpnwC+zXGnvBcFYAAAqlS44offKPSKTbnaeytd80cEK3dbRamygOza6ryJNCvuXtuRw672K0HtVwcFXuVVgLOTFB2ei1vhxVcdrgvpFwCAPXYiAABsj047KruuysqO7NXlg391uYdWeV7Nx/66r3mEzbrZZ7uqrHlR/VV5SG05v5KynGtzr0hT9M23Fe+qshXpFwCAw0cABgBsmI6KwA0ZOGUDrKm5qjTaSjHENl9zM1xlY8zzarANyLb2K/Hg4Pg78boqRx2hvdKw9qKvVAq/QvoFAOBYEIABAJu3SgaWPESqog4sLslqm5CVK8sWVeEsBhf9nrVNv9I+AVs5fFfrcNUe3o++Uun2LKulXwAAsP8IwACArVgrA4t4peA0Bpd5NK4G2111eQS7MRgK7AJqXVAteji3Rl8J069f6K1Nv2RhAAD2HwEYALAtq2fgYEiwSDEqWFx/aRuDJUzC4p2g5VkNYYLV7sjV6CvSXvgV0i8AAAeNAAwA2KKlGVjCIcEiNT2iy2OJl4TzCL1a9AxCbxhro+grzd2ey2XSLwAAh4kADADYrtoMLPYhRsrfoTEGi1STcJFI2x8+7WZ5Dpva5RWjr5B+AQA4DgRgAMDWVTOwi7828nrJty4Gp3vYxwMHSbg4Wuupw1VVbA3miPZPHTdsnPKK9AsAwGEhAAMAdqEmA0tNKVhaY7Br6I5U9KWWlvG/ZeJ1W+LcK83RVxoKv0L6BQDgABGAAQA7EmdgqSkFS3MMLjeGHZqzOaNV63l1ZYtbaKwlE30BADhCBGAAwO7UZ+CgFCyNMVjixnEeXnbqcnlJpiX9AgBwnAjAAICdCmu63tYy/tbHYKkG19bpr+Iz6MZvJlprir5C+gUA4MARgAEAr6CpFFyJwRI96shvpb81jzaVdYm+AAAct68AAAD//5/Kzx0AAAAGSURBVAMALpmOX1qZybwAAAAASUVORK5CYII=",
      "mimeType": "image/png"
    }
  ]
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "P"
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
