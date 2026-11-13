
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Keyway bench",
  "snapshot": "- form \"Sign in\" [ref=e4]:\n  - heading \"Sign in\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - generic [ref=e7]: Email\n    - textbox \"Email\" [active] [ref=e8]\n  - generic [ref=e9]:\n    - generic [ref=e10]: Password\n    - textbox \"Password\" [ref=e11]\n  - alert\n  - button \"Sign in\" [ref=e12] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Keyway bench",
  "inlineSnapshot": "- form \"Sign in\" [ref=e4]:\n  - heading \"Sign in\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - generic [ref=e7]: Email\n    - textbox \"Email\" [active] [ref=e8]\n  - generic [ref=e9]:\n    - generic [ref=e10]: Password\n    - textbox \"Password\" [ref=e11]\n  - alert\n  - button \"Sign in\" [ref=e12] [cursor=pointer]"
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
      "value": "mara@lanternlane.test"
    },
    {
      "target": "e11",
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
  "target": "e12"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- form \"Sign in\" [ref=e4]:\n  - heading \"Sign in\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - generic [ref=e7]: Email\n    - textbox \"Email\" [ref=e8]: mara@lanternlane.test\n  - generic [ref=e9]:\n    - generic [ref=e10]: Password\n    - textbox \"Password\" [ref=e11]: wrong\n  - alert [ref=e13]: That email and password don't match.\n  - button \"Sign in\" [active] [ref=e12] [cursor=pointer]",
  "events": "- New console entries: evidence/reduced/console-2026-11-06T19-57-06-535Z.log#L1"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e11",
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
  "target": "e12"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [active] [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\"\n    - status \"Editor status\" [ref=e99]"
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
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\"\n    - status \"Editor status\" [ref=e99]\n    - dialog \"Open a room\" [ref=e103]:\n      - generic [ref=e104]:\n        - generic [ref=e105]:\n          - generic [ref=e106]: Keywaybench\n          - generic [ref=e108]: bench 1.0.0\n        - button \"Close\" [ref=e109] [cursor=pointer]: ✕\n      - generic [ref=e110]:\n        - generic [ref=e111]:\n          - button \"Back\" [ref=e112] [cursor=pointer]: ‹\n          - heading \"Pick a room\" [level=2] [ref=e113]\n        - paragraph [ref=e114]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=e115]:\n          - option \"Apothecary\" [active] [selected] [ref=e116] [cursor=pointer]:\n            - generic [ref=e117]\n          - option \"Clockmaker's Study\" [ref=e120] [cursor=pointer]:\n            - generic [ref=e121]\n          - option \"Judge Pack QZMXTA\" [ref=e124] [cursor=pointer]:\n            - generic [ref=e125]\n          - option \"Judge Pack ZKTRVA\" [ref=e128] [cursor=pointer]:\n            - generic [ref=e129]\n          - option \"Observatory\" [ref=e132] [cursor=pointer]:\n            - generic [ref=e133]\n          - option \"Ship's Hold\" [ref=e136] [cursor=pointer]:\n            - generic [ref=e137]\n          - option \"Signal Cabin\" [ref=e140] [cursor=pointer]:\n            - generic [ref=e141]\n          - option \"Vault\" [ref=e144] [cursor=pointer]:\n            - generic [ref=e145]\n        - paragraph [ref=e148]:\n          - link \"New room\" [ref=e149] [cursor=pointer]:\n            - /url: \"#\"\n        - generic [ref=e150]:\n          - generic [ref=e151]:\n            - checkbox \"Walk in when I pick a room\" [checked] [ref=e152]\n            - generic [ref=e153]: Walk in when I pick a room\n          - generic [ref=e154]:\n            - link \"Prop library\" [ref=e155] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Versions\" [ref=e156] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Keyboard shortcuts\" [ref=e157] [cursor=pointer]:\n              - /url: \"#\""
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Close",
  "target": "e109"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [active] [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\"\n    - status \"Editor status\" [ref=e99]"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Control+k"
}
```
- Result
```json
{}
```

### Tool call: browser_type
- Args
```json
{
  "element": "Command",
  "target": "[aria-label='Command']",
  "text": "new room"
}
```
- Result
```json
{}
```

### Tool call: browser_snapshot
- Args
```json
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\"\n    - status \"Editor status\" [ref=e99]\n    - dialog \"Command palette\" [ref=e159]:\n      - generic [ref=e160]:\n        - heading \"Command palette\" [level=2] [ref=e161]\n        - button \"Close\" [ref=e162] [cursor=pointer]: ✕\n      - combobox \"Command\" [expanded] [active] [ref=e163]: new room\n      - listbox \"Commands\""
}
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
  "element": "Room stage",
  "target": "e14"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [active] [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\"\n    - status \"Editor status\" [ref=e99]"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Tab"
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
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [active] [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\"\n    - status \"Editor status\" [ref=e99]"
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
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\"\n    - status \"Editor status\" [ref=e99]\n    - dialog \"Open a room\" [ref=e165]:\n      - generic [ref=e166]:\n        - generic [ref=e167]:\n          - generic [ref=e168]: Keywaybench\n          - generic [ref=e170]: bench 1.0.0\n        - button \"Close\" [ref=e171] [cursor=pointer]: ✕\n      - generic [ref=e172]:\n        - generic [ref=e173]:\n          - button \"Back\" [ref=e174] [cursor=pointer]: ‹\n          - heading \"Pick a room\" [level=2] [ref=e175]\n        - paragraph [ref=e176]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=e177]:\n          - option \"Apothecary\" [active] [selected] [ref=e178] [cursor=pointer]:\n            - generic [ref=e179]:\n              - generic [ref=e180]: Apothecary\n              - generic [ref=e181]: 0 of 6 solved · Longest run 3 · 4 props\n          - option \"Clockmaker's Study\" [ref=e182] [cursor=pointer]:\n            - generic [ref=e183]:\n              - generic [ref=e184]: Clockmaker's Study\n              - generic [ref=e185]: 0 of 1 solved · Longest run 1 · 1 prop\n          - option \"Judge Pack QZMXTA\" [ref=e186] [cursor=pointer]:\n            - generic [ref=e187]:\n              - generic [ref=e188]: Judge Pack QZMXTA\n              - generic [ref=e189]: 0 of 1 solved · Longest run 1 · 2 props\n          - option \"Judge Pack ZKTRVA\" [ref=e190] [cursor=pointer]:\n            - generic [ref=e191]:\n              - generic [ref=e192]: Judge Pack ZKTRVA\n              - generic [ref=e193]: 0 of 1 solved · Longest run 1 · 2 props\n          - option \"Observatory\" [ref=e194] [cursor=pointer]:\n            - generic [ref=e195]:\n              - generic [ref=e196]: Observatory\n              - generic [ref=e197]: 0 of 4 solved · Longest run 2 · 2 props\n          - option \"Ship's Hold\" [ref=e198] [cursor=pointer]:\n            - generic [ref=e199]:\n              - generic [ref=e200]: Ship's Hold\n              - generic [ref=e201]: 0 of 5 solved · Longest run 5 · 4 props\n          - option \"Signal Cabin\" [ref=e202] [cursor=pointer]:\n            - generic [ref=e203]:\n              - generic [ref=e204]: Signal Cabin\n              - generic [ref=e205]: 0 of 4 solved · Longest run 2 · 2 props\n          - option \"Vault\" [ref=e206] [cursor=pointer]:\n            - generic [ref=e207]:\n              - generic [ref=e208]: Vault\n              - generic [ref=e209]: 0 of 6 solved · Longest run 6 · 3 props\n        - paragraph [ref=e210]:\n          - link \"New room\" [ref=e211] [cursor=pointer]:\n            - /url: \"#\"\n        - generic [ref=e212]:\n          - generic [ref=e213]:\n            - checkbox \"Walk in when I pick a room\" [checked] [ref=e214]\n            - generic [ref=e215]: Walk in when I pick a room\n          - generic [ref=e216]:\n            - link \"Prop library\" [ref=e217] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Versions\" [ref=e218] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Keyboard shortcuts\" [ref=e219] [cursor=pointer]:\n              - /url: \"#\""
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
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\"\n    - status \"Editor status\" [ref=e99]\n    - dialog \"Open a room\" [ref=e165]:\n      - generic [ref=e166]:\n        - generic [ref=e167]:\n          - generic [ref=e168]: Keywaybench\n          - generic [ref=e170]: bench 1.0.0\n        - button \"Close\" [ref=e171] [cursor=pointer]: ✕\n      - generic [ref=e172]:\n        - generic [ref=e173]:\n          - button \"Back\" [ref=e174] [cursor=pointer]: ‹\n          - heading \"Pick a room\" [level=2] [ref=e175]\n        - paragraph [ref=e176]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=e177]:\n          - option \"Apothecary\" [active] [selected] [ref=e178] [cursor=pointer]:\n            - generic [ref=e179]\n          - option \"Clockmaker's Study\" [ref=e182] [cursor=pointer]:\n            - generic [ref=e183]\n          - option \"Judge Pack QZMXTA\" [ref=e186] [cursor=pointer]:\n            - generic [ref=e187]\n          - option \"Judge Pack ZKTRVA\" [ref=e190] [cursor=pointer]:\n            - generic [ref=e191]\n          - option \"Observatory\" [ref=e194] [cursor=pointer]:\n            - generic [ref=e195]\n          - option \"Ship's Hold\" [ref=e198] [cursor=pointer]:\n            - generic [ref=e199]\n          - option \"Signal Cabin\" [ref=e202] [cursor=pointer]:\n            - generic [ref=e203]\n          - option \"Vault\" [ref=e206] [cursor=pointer]:\n            - generic [ref=e207]\n        - paragraph [ref=e210]:\n          - link \"New room\" [ref=e211] [cursor=pointer]:\n            - /url: \"#\"\n        - generic [ref=e212]:\n          - generic [ref=e213]:\n            - checkbox \"Walk in when I pick a room\" [checked] [ref=e214]\n            - generic [ref=e215]: Walk in when I pick a room\n          - generic [ref=e216]:\n            - link \"Prop library\" [ref=e217] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Versions\" [ref=e218] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Keyboard shortcuts\" [ref=e219] [cursor=pointer]:\n              - /url: \"#\""
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "New room",
  "target": "e211"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\"\n    - status \"Editor status\" [ref=e99]\n    - dialog \"Open a room\" [ref=e165]:\n      - generic [ref=e166]:\n        - generic [ref=e167]:\n          - generic [ref=e168]: Keywaybench\n          - generic [ref=e170]: bench 1.0.0\n        - button \"Close\" [ref=e171] [cursor=pointer]: ✕\n      - generic [ref=e172]:\n        - generic [ref=e173]:\n          - button \"Back\" [ref=e174] [cursor=pointer]: ‹\n          - heading \"Pick a room\" [level=2] [ref=e175]\n        - paragraph [ref=e176]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=e177]:\n          - option \"Apothecary\" [selected] [ref=e178] [cursor=pointer]:\n            - generic [ref=e179]:\n              - generic [ref=e180]: Apothecary\n              - generic [ref=e181]: 0 of 6 solved · Longest run 3 · 4 props\n          - option \"Clockmaker's Study\" [ref=e182] [cursor=pointer]:\n            - generic [ref=e183]:\n              - generic [ref=e184]: Clockmaker's Study\n              - generic [ref=e185]: 0 of 1 solved · Longest run 1 · 1 prop\n          - option \"Judge Pack QZMXTA\" [ref=e186] [cursor=pointer]:\n            - generic [ref=e187]:\n              - generic [ref=e188]: Judge Pack QZMXTA\n              - generic [ref=e189]: 0 of 1 solved · Longest run 1 · 2 props\n          - option \"Judge Pack ZKTRVA\" [ref=e190] [cursor=pointer]:\n            - generic [ref=e191]:\n              - generic [ref=e192]: Judge Pack ZKTRVA\n              - generic [ref=e193]: 0 of 1 solved · Longest run 1 · 2 props\n          - option \"Observatory\" [ref=e194] [cursor=pointer]:\n            - generic [ref=e195]:\n              - generic [ref=e196]: Observatory\n              - generic [ref=e197]: 0 of 4 solved · Longest run 2 · 2 props\n          - option \"Ship's Hold\" [ref=e198] [cursor=pointer]:\n            - generic [ref=e199]:\n              - generic [ref=e200]: Ship's Hold\n              - generic [ref=e201]: 0 of 5 solved · Longest run 5 · 4 props\n          - option \"Signal Cabin\" [ref=e202] [cursor=pointer]:\n            - generic [ref=e203]:\n              - generic [ref=e204]: Signal Cabin\n              - generic [ref=e205]: 0 of 4 solved · Longest run 2 · 2 props\n          - option \"Vault\" [ref=e206] [cursor=pointer]:\n            - generic [ref=e207]:\n              - generic [ref=e208]: Vault\n              - generic [ref=e209]: 0 of 6 solved · Longest run 6 · 3 props\n        - paragraph [ref=e210]:\n          - link \"New room\" [ref=e211] [cursor=pointer]:\n            - /url: \"#\"\n        - generic [ref=e212]:\n          - generic [ref=e213]:\n            - checkbox \"Walk in when I pick a room\" [checked] [ref=e214]\n            - generic [ref=e215]: Walk in when I pick a room\n          - generic [ref=e216]:\n            - link \"Prop library\" [ref=e217] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Versions\" [ref=e218] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Keyboard shortcuts\" [ref=e219] [cursor=pointer]:\n              - /url: \"#\"\n    - dialog \"New room\" [ref=e221]:\n      - generic [ref=e222]:\n        - heading \"New room\" [level=2] [ref=e223]\n        - button \"Close\" [active] [ref=e224] [cursor=pointer]: ✕\n      - generic [ref=e225]:\n        - generic [ref=e226]: Room name\n        - textbox \"Room name\" [ref=e227]\n      - generic [ref=e228]:\n        - generic [ref=e229]: Width (m)\n        - textbox \"Width (m)\" [ref=e230]: \"4.000\"\n      - generic [ref=e231]:\n        - generic [ref=e232]: Depth (m)\n        - textbox \"Depth (m)\" [ref=e233]: \"3.500\"\n      - generic [ref=e234]:\n        - generic [ref=e235]: Height (m)\n        - textbox \"Height (m)\" [ref=e236]: \"2.700\"\n      - paragraph\n      - button \"Create room\" [ref=e237] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\"\n    - status \"Editor status\" [ref=e99]\n    - dialog \"Open a room\" [ref=e165]:\n      - generic [ref=e166]:\n        - generic [ref=e167]:\n          - generic [ref=e168]: Keywaybench\n          - generic [ref=e170]: bench 1.0.0\n        - button \"Close\" [ref=e171] [cursor=pointer]: ✕\n      - generic [ref=e172]:\n        - generic [ref=e173]:\n          - button \"Back\" [ref=e174] [cursor=pointer]: ‹\n          - heading \"Pick a room\" [level=2] [ref=e175]\n        - paragraph [ref=e176]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=e177]:\n          - option \"Apothecary\" [selected] [ref=e178] [cursor=pointer]:\n            - generic [ref=e179]\n          - option \"Clockmaker's Study\" [ref=e182] [cursor=pointer]:\n            - generic [ref=e183]\n          - option \"Judge Pack QZMXTA\" [ref=e186] [cursor=pointer]:\n            - generic [ref=e187]\n          - option \"Judge Pack ZKTRVA\" [ref=e190] [cursor=pointer]:\n            - generic [ref=e191]\n          - option \"Observatory\" [ref=e194] [cursor=pointer]:\n            - generic [ref=e195]\n          - option \"Ship's Hold\" [ref=e198] [cursor=pointer]:\n            - generic [ref=e199]\n          - option \"Signal Cabin\" [ref=e202] [cursor=pointer]:\n            - generic [ref=e203]\n          - option \"Vault\" [ref=e206] [cursor=pointer]:\n            - generic [ref=e207]\n        - paragraph [ref=e210]:\n          - link \"New room\" [ref=e211] [cursor=pointer]:\n            - /url: \"#\"\n        - generic [ref=e212]:\n          - generic [ref=e213]:\n            - checkbox \"Walk in when I pick a room\" [checked] [ref=e214]\n            - generic [ref=e215]: Walk in when I pick a room\n          - generic [ref=e216]:\n            - link \"Prop library\" [ref=e217] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Versions\" [ref=e218] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Keyboard shortcuts\" [ref=e219] [cursor=pointer]:\n              - /url: \"#\"\n    - dialog \"New room\" [ref=e221]:\n      - generic [ref=e222]:\n        - heading \"New room\" [level=2] [ref=e223]\n        - button \"Close\" [active] [ref=e224] [cursor=pointer]: ✕\n      - generic [ref=e225]:\n        - generic [ref=e226]: Room name\n        - textbox \"Room name\" [ref=e227]\n      - generic [ref=e228]:\n        - generic [ref=e229]: Width (m)\n        - textbox \"Width (m)\" [ref=e230]: \"4.000\"\n      - generic [ref=e231]:\n        - generic [ref=e232]: Depth (m)\n        - textbox \"Depth (m)\" [ref=e233]: \"3.500\"\n      - generic [ref=e234]:\n        - generic [ref=e235]: Height (m)\n        - textbox \"Height (m)\" [ref=e236]: \"2.700\"\n      - paragraph\n      - button \"Create room\" [ref=e237] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e227",
      "name": "name",
      "type": "textbox",
      "value": "Judge Walk RUVKMP"
    },
    {
      "target": "e230",
      "name": "width",
      "type": "textbox",
      "value": "4"
    },
    {
      "target": "e233",
      "name": "depth",
      "type": "textbox",
      "value": "3"
    },
    {
      "target": "e236",
      "name": "height",
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
  "target": "e237"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\"\n    - status \"Editor status\" [ref=e99]\n    - dialog \"Open a room\" [ref=e165]:\n      - generic [ref=e166]:\n        - generic [ref=e167]:\n          - generic [ref=e168]: Keywaybench\n          - generic [ref=e170]: bench 1.0.0\n        - button \"Close\" [ref=e171] [cursor=pointer]: ✕\n      - generic [ref=e172]:\n        - generic [ref=e173]:\n          - button \"Back\" [ref=e174] [cursor=pointer]: ‹\n          - heading \"Pick a room\" [level=2] [ref=e175]\n        - paragraph [ref=e176]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=e177]:\n          - option \"Apothecary\" [selected] [ref=e178] [cursor=pointer]:\n            - generic [ref=e179]:\n              - generic [ref=e180]: Apothecary\n              - generic [ref=e181]: 0 of 6 solved · Longest run 3 · 4 props\n          - option \"Clockmaker's Study\" [ref=e182] [cursor=pointer]:\n            - generic [ref=e183]:\n              - generic [ref=e184]: Clockmaker's Study\n              - generic [ref=e185]: 0 of 1 solved · Longest run 1 · 1 prop\n          - option \"Judge Pack QZMXTA\" [ref=e186] [cursor=pointer]:\n            - generic [ref=e187]:\n              - generic [ref=e188]: Judge Pack QZMXTA\n              - generic [ref=e189]: 0 of 1 solved · Longest run 1 · 2 props\n          - option \"Judge Pack ZKTRVA\" [ref=e190] [cursor=pointer]:\n            - generic [ref=e191]:\n              - generic [ref=e192]: Judge Pack ZKTRVA\n              - generic [ref=e193]: 0 of 1 solved · Longest run 1 · 2 props\n          - option \"Observatory\" [ref=e194] [cursor=pointer]:\n            - generic [ref=e195]:\n              - generic [ref=e196]: Observatory\n              - generic [ref=e197]: 0 of 4 solved · Longest run 2 · 2 props\n          - option \"Ship's Hold\" [ref=e198] [cursor=pointer]:\n            - generic [ref=e199]:\n              - generic [ref=e200]: Ship's Hold\n              - generic [ref=e201]: 0 of 5 solved · Longest run 5 · 4 props\n          - option \"Signal Cabin\" [ref=e202] [cursor=pointer]:\n            - generic [ref=e203]:\n              - generic [ref=e204]: Signal Cabin\n              - generic [ref=e205]: 0 of 4 solved · Longest run 2 · 2 props\n          - option \"Vault\" [ref=e206] [cursor=pointer]:\n            - generic [ref=e207]:\n              - generic [ref=e208]: Vault\n              - generic [ref=e209]: 0 of 6 solved · Longest run 6 · 3 props\n        - paragraph [ref=e210]:\n          - link \"New room\" [active] [ref=e211] [cursor=pointer]:\n            - /url: \"#\"\n        - generic [ref=e212]:\n          - generic [ref=e213]:\n            - checkbox \"Walk in when I pick a room\" [checked] [ref=e214]\n            - generic [ref=e215]: Walk in when I pick a room\n          - generic [ref=e216]:\n            - link \"Prop library\" [ref=e217] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Versions\" [ref=e218] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Keyboard shortcuts\" [ref=e219] [cursor=pointer]:\n              - /url: \"#\""
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/4fe61d1b-85c8-4bde-9b9f-511129b60523\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [active] [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - generic [ref=e238]: 4FE61D\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\" [ref=e241]:\n        - treeitem \"Judge Walk RUVKMP\" [expanded] [level=1] [ref=e242] [cursor=pointer]:\n          - text: Judge Walk RUVKMP\n          - group\n    - status \"Editor status\" [ref=e99]"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/4fe61d1b-85c8-4bde-9b9f-511129b60523\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - generic [ref=e238]: 4FE61D\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\" [ref=e241]:\n        - treeitem \"Judge Walk RUVKMP\" [expanded] [level=1] [ref=e242] [cursor=pointer]:\n          - text: Judge Walk RUVKMP\n          - group\n    - status \"Editor status\" [ref=e99]\n    - dialog \"Open a room\" [ref=e244]:\n      - generic [ref=e245]:\n        - generic [ref=e246]:\n          - generic [ref=e247]: Keywaybench\n          - generic [ref=e249]: bench 1.0.0\n        - button \"Close\" [ref=e250] [cursor=pointer]: ✕\n      - generic [ref=e251]:\n        - generic [ref=e252]:\n          - button \"Back\" [ref=e253] [cursor=pointer]: ‹\n          - heading \"Pick a room\" [level=2] [ref=e254]\n        - paragraph [ref=e255]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=e256]:\n          - option \"Apothecary\" [active] [selected] [ref=e257] [cursor=pointer]:\n            - generic [ref=e258]:\n              - generic [ref=e259]: Apothecary\n              - generic [ref=e260]: 0 of 6 solved · Longest run 3 · 4 props\n          - option \"Clockmaker's Study\" [ref=e261] [cursor=pointer]:\n            - generic [ref=e262]:\n              - generic [ref=e263]: Clockmaker's Study\n              - generic [ref=e264]: 0 of 1 solved · Longest run 1 · 1 prop\n          - option \"Judge Pack QZMXTA\" [ref=e265] [cursor=pointer]:\n            - generic [ref=e266]:\n              - generic [ref=e267]: Judge Pack QZMXTA\n              - generic [ref=e268]: 0 of 1 solved · Longest run 1 · 2 props\n          - option \"Judge Pack ZKTRVA\" [ref=e269] [cursor=pointer]:\n            - generic [ref=e270]:\n              - generic [ref=e271]: Judge Pack ZKTRVA\n              - generic [ref=e272]: 0 of 1 solved · Longest run 1 · 2 props\n          - option \"Judge Walk RUVKMP\" [ref=e273] [cursor=pointer]:\n            - generic [ref=e275]:\n              - generic [ref=e276]: Judge Walk RUVKMP\n              - generic [ref=e277]: 0 of 0 solved · Longest run 0 · 0 props\n          - option \"Observatory\" [ref=e278] [cursor=pointer]:\n            - generic [ref=e279]:\n              - generic [ref=e280]: Observatory\n              - generic [ref=e281]: 0 of 4 solved · Longest run 2 · 2 props\n          - option \"Ship's Hold\" [ref=e282] [cursor=pointer]:\n            - generic [ref=e283]:\n              - generic [ref=e284]: Ship's Hold\n              - generic [ref=e285]: 0 of 5 solved · Longest run 5 · 4 props\n          - option \"Signal Cabin\" [ref=e286] [cursor=pointer]:\n            - generic [ref=e287]:\n              - generic [ref=e288]: Signal Cabin\n              - generic [ref=e289]: 0 of 4 solved · Longest run 2 · 2 props\n          - option \"Vault\" [ref=e290] [cursor=pointer]:\n            - generic [ref=e291]:\n              - generic [ref=e292]: Vault\n              - generic [ref=e293]: 0 of 6 solved · Longest run 6 · 3 props\n        - paragraph [ref=e294]:\n          - link \"New room\" [ref=e295] [cursor=pointer]:\n            - /url: \"#\"\n        - generic [ref=e296]:\n          - generic [ref=e297]:\n            - checkbox \"Walk in when I pick a room\" [checked] [ref=e298]\n            - generic [ref=e299]: Walk in when I pick a room\n          - generic [ref=e300]:\n            - link \"Prop library\" [ref=e301] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Versions\" [ref=e302] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Keyboard shortcuts\" [ref=e303] [cursor=pointer]:\n              - /url: \"#\""
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/4fe61d1b-85c8-4bde-9b9f-511129b60523\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - generic [ref=e238]: 4FE61D\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\" [ref=e241]:\n        - treeitem \"Judge Walk RUVKMP\" [expanded] [level=1] [ref=e242] [cursor=pointer]:\n          - text: Judge Walk RUVKMP\n          - group\n    - status \"Editor status\" [ref=e99]\n    - dialog \"Open a room\" [ref=e244]:\n      - generic [ref=e245]:\n        - generic [ref=e246]:\n          - generic [ref=e247]: Keywaybench\n          - generic [ref=e249]: bench 1.0.0\n        - button \"Close\" [ref=e250] [cursor=pointer]: ✕\n      - generic [ref=e251]:\n        - generic [ref=e252]:\n          - button \"Back\" [ref=e253] [cursor=pointer]: ‹\n          - heading \"Pick a room\" [level=2] [ref=e254]\n        - paragraph [ref=e255]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=e256]:\n          - option \"Apothecary\" [active] [selected] [ref=e257] [cursor=pointer]:\n            - generic [ref=e258]\n          - option \"Clockmaker's Study\" [ref=e261] [cursor=pointer]:\n            - generic [ref=e262]\n          - option \"Judge Pack QZMXTA\" [ref=e265] [cursor=pointer]:\n            - generic [ref=e266]\n          - option \"Judge Pack ZKTRVA\" [ref=e269] [cursor=pointer]:\n            - generic [ref=e270]\n          - option \"Judge Walk RUVKMP\" [ref=e273] [cursor=pointer]:\n            - generic [ref=e275]\n          - option \"Observatory\" [ref=e278] [cursor=pointer]:\n            - generic [ref=e279]\n          - option \"Ship's Hold\" [ref=e282] [cursor=pointer]:\n            - generic [ref=e283]\n          - option \"Signal Cabin\" [ref=e286] [cursor=pointer]:\n            - generic [ref=e287]\n          - option \"Vault\" [ref=e290] [cursor=pointer]:\n            - generic [ref=e291]\n        - paragraph [ref=e294]:\n          - link \"New room\" [ref=e295] [cursor=pointer]:\n            - /url: \"#\"\n        - generic [ref=e296]:\n          - generic [ref=e297]:\n            - checkbox \"Walk in when I pick a room\" [checked] [ref=e298]\n            - generic [ref=e299]: Walk in when I pick a room\n          - generic [ref=e300]:\n            - link \"Prop library\" [ref=e301] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Versions\" [ref=e302] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Keyboard shortcuts\" [ref=e303] [cursor=pointer]:\n              - /url: \"#\""
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/82effe0f-db6d-4932-b450-f3386336d8ac\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Player height\n    - button \"Rooms\" [active] [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - generic [ref=e238]: 82EFFE\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 6 solvedLongest run 63 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e60] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\" [ref=e241]:\n        - treeitem \"Vault\" [expanded] [level=1] [ref=e306] [cursor=pointer]:\n          - text: Vault\n          - group [ref=e307]:\n            - treeitem \"Entry door\" [level=2] [ref=e308]\n            - treeitem \"Safe\" [level=2] [ref=e309]\n            - treeitem \"Desk\" [level=2] [ref=e310]\n            - treeitem \"Keypad pillar\" [level=2] [ref=e311]\n    - status \"Editor status\" [ref=e99]: Playtest running."
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/82effe0f-db6d-4932-b450-f3386336d8ac\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Player height\n    - button \"Rooms\" [active] [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 6 solvedLongest run 63 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Stop playtest\" [ref=e312] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n      - timer \"Playtest clock\" [ref=e315]: 59:56\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\" [ref=e241]\n    - status \"Editor status\" [ref=e99]: Playtest running."
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/82effe0f-db6d-4932-b450-f3386336d8ac\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [active] [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - generic [ref=e238]: 82EFFE\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 6 solvedLongest run 63 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e322] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\" [ref=e241]:\n        - treeitem \"Vault\" [expanded] [level=1] [ref=e325] [cursor=pointer]:\n          - text: Vault\n          - group [ref=e326]:\n            - treeitem \"Entry door\" [level=2] [ref=e327]\n            - treeitem \"Safe\" [level=2] [ref=e328]\n            - treeitem \"Desk\" [level=2] [ref=e329]\n            - treeitem \"Keypad pillar\" [level=2] [ref=e330]\n    - status \"Editor status\" [ref=e99]: Playtest ended"
}
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/82effe0f-db6d-4932-b450-f3386336d8ac\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [active] [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - generic [ref=e238]: 82EFFE\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 6 solvedLongest run 63 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e322] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\" [ref=e241]:\n        - treeitem \"Vault\" [expanded] [level=1] [ref=e331] [cursor=pointer]:\n          - text: Vault\n          - group [ref=e332]:\n            - treeitem \"Entry door\" [level=2] [ref=e333]\n            - treeitem \"Safe\" [level=2] [ref=e334]\n            - treeitem \"Desk\" [level=2] [ref=e335]\n            - treeitem \"Keypad pillar\" [level=2] [ref=e336]\n    - status \"Editor status\" [ref=e99]: Playtest ended"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "stage",
  "target": "e14"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/82effe0f-db6d-4932-b450-f3386336d8ac\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [active] [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - generic [ref=e238]: 82EFFE\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 6 solvedLongest run 63 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - region \"Inspector\" [ref=e337]:\n      - heading \"Inspector\" [level=3] [ref=e338]\n      - generic [ref=e339]:\n        - term [ref=e340]: Label\n        - definition [ref=e341]: Desk\n        - term [ref=e342]: X\n        - definition [ref=e343]: \"2.100\"\n        - term [ref=e344]: \"Y\"\n        - definition [ref=e345]: \"0.000\"\n        - term [ref=e346]: Z\n        - definition [ref=e347]: \"1.500\"\n        - term [ref=e348]: Width\n        - definition [ref=e349]: \"1.200\"\n        - term [ref=e350]: Depth\n        - definition [ref=e351]: \"0.700\"\n        - term [ref=e352]: Height\n        - definition [ref=e353]: \"0.800\"\n      - generic [ref=e354]:\n        - generic [ref=e355]: Rotation\n        - spinbutton \"Rotation\" [ref=e356]: \"0\"\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e322] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\" [ref=e241]:\n        - treeitem \"Vault\" [expanded] [level=1] [ref=e357] [cursor=pointer]:\n          - text: Vault\n          - group [ref=e358]:\n            - treeitem \"Entry door\" [level=2] [ref=e359]\n            - treeitem \"Safe\" [level=2] [ref=e360]\n            - treeitem \"Desk\" [level=2] [selected] [ref=e361]\n            - treeitem \"Keypad pillar\" [level=2] [ref=e362]\n    - status \"Editor status\" [ref=e99]: Playtest ended"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Tab"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/82effe0f-db6d-4932-b450-f3386336d8ac\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - generic [ref=e238]: 82EFFE\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 6 solvedLongest run 63 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - region \"Inspector\" [ref=e337]:\n      - heading \"Inspector\" [level=3] [ref=e338]\n      - generic [ref=e339]:\n        - term [ref=e340]: Label\n        - definition [ref=e341]: Desk\n        - term [ref=e342]: X\n        - definition [ref=e343]: \"2.100\"\n        - term [ref=e344]: \"Y\"\n        - definition [ref=e345]: \"0.000\"\n        - term [ref=e346]: Z\n        - definition [ref=e347]: \"1.500\"\n        - term [ref=e348]: Width\n        - definition [ref=e349]: \"1.200\"\n        - term [ref=e350]: Depth\n        - definition [ref=e351]: \"0.700\"\n        - term [ref=e352]: Height\n        - definition [ref=e353]: \"0.800\"\n      - generic [ref=e354]:\n        - generic [ref=e355]: Rotation\n        - spinbutton \"Rotation\" [ref=e356]: \"0\"\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e322] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\" [ref=e241]:\n        - treeitem \"Vault\" [expanded] [level=1] [ref=e357] [cursor=pointer]:\n          - text: Vault\n          - group [ref=e358]:\n            - treeitem \"Entry door\" [level=2] [ref=e359]\n            - treeitem \"Safe\" [level=2] [ref=e360]\n            - treeitem \"Desk\" [level=2] [selected] [ref=e361]\n            - treeitem \"Keypad pillar\" [level=2] [ref=e362]\n    - status \"Editor status\" [ref=e99]: Playtest ended\n    - dialog \"Open a room\" [ref=e364]:\n      - generic [ref=e365]:\n        - generic [ref=e366]:\n          - generic [ref=e367]: Keywaybench\n          - generic [ref=e369]: bench 1.0.0\n        - button \"Close\" [ref=e370] [cursor=pointer]: ✕\n      - generic [ref=e371]:\n        - generic [ref=e372]:\n          - button \"Back\" [ref=e373] [cursor=pointer]: ‹\n          - heading \"Pick a room\" [level=2] [ref=e374]\n        - paragraph [ref=e375]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=e376]:\n          - option \"Apothecary\" [active] [selected] [ref=e377] [cursor=pointer]:\n            - generic [ref=e378]:\n              - generic [ref=e379]: Apothecary\n              - generic [ref=e380]: 0 of 6 solved · Longest run 3 · 4 props\n          - option \"Clockmaker's Study\" [ref=e381] [cursor=pointer]:\n            - generic [ref=e382]:\n              - generic [ref=e383]: Clockmaker's Study\n              - generic [ref=e384]: 0 of 1 solved · Longest run 1 · 1 prop\n          - option \"Judge Pack QZMXTA\" [ref=e385] [cursor=pointer]:\n            - generic [ref=e386]:\n              - generic [ref=e387]: Judge Pack QZMXTA\n              - generic [ref=e388]: 0 of 1 solved · Longest run 1 · 2 props\n          - option \"Judge Pack ZKTRVA\" [ref=e389] [cursor=pointer]:\n            - generic [ref=e390]:\n              - generic [ref=e391]: Judge Pack ZKTRVA\n              - generic [ref=e392]: 0 of 1 solved · Longest run 1 · 2 props\n          - option \"Judge Walk RUVKMP\" [ref=e393] [cursor=pointer]:\n            - generic [ref=e395]:\n              - generic [ref=e396]: Judge Walk RUVKMP\n              - generic [ref=e397]: 0 of 0 solved · Longest run 0 · 0 props\n          - option \"Observatory\" [ref=e398] [cursor=pointer]:\n            - generic [ref=e399]:\n              - generic [ref=e400]: Observatory\n              - generic [ref=e401]: 0 of 4 solved · Longest run 2 · 2 props\n          - option \"Ship's Hold\" [ref=e402] [cursor=pointer]:\n            - generic [ref=e403]:\n              - generic [ref=e404]: Ship's Hold\n              - generic [ref=e405]: 0 of 5 solved · Longest run 5 · 4 props\n          - option \"Signal Cabin\" [ref=e406] [cursor=pointer]:\n            - generic [ref=e407]:\n              - generic [ref=e408]: Signal Cabin\n              - generic [ref=e409]: 0 of 4 solved · Longest run 2 · 2 props\n          - option \"Vault\" [ref=e410] [cursor=pointer]:\n            - generic [ref=e411]:\n              - generic [ref=e412]: Vault\n              - generic [ref=e413]: 0 of 6 solved · Longest run 6 · 3 props\n        - paragraph [ref=e414]:\n          - link \"New room\" [ref=e415] [cursor=pointer]:\n            - /url: \"#\"\n        - generic [ref=e416]:\n          - generic [ref=e417]:\n            - checkbox \"Walk in when I pick a room\" [checked] [ref=e418]\n            - generic [ref=e419]: Walk in when I pick a room\n          - generic [ref=e420]:\n            - link \"Prop library\" [ref=e421] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Versions\" [ref=e422] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Keyboard shortcuts\" [ref=e423] [cursor=pointer]:\n              - /url: \"#\""
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/82effe0f-db6d-4932-b450-f3386336d8ac\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - generic [ref=e238]: 82EFFE\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 6 solvedLongest run 63 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - region \"Inspector\" [ref=e337]:\n      - heading \"Inspector\" [level=3] [ref=e338]\n      - generic [ref=e339]:\n        - term [ref=e340]: Label\n        - definition [ref=e341]: Desk\n        - term [ref=e342]: X\n        - definition [ref=e343]: \"2.100\"\n        - term [ref=e344]: \"Y\"\n        - definition [ref=e345]: \"0.000\"\n        - term [ref=e346]: Z\n        - definition [ref=e347]: \"1.500\"\n        - term [ref=e348]: Width\n        - definition [ref=e349]: \"1.200\"\n        - term [ref=e350]: Depth\n        - definition [ref=e351]: \"0.700\"\n        - term [ref=e352]: Height\n        - definition [ref=e353]: \"0.800\"\n      - generic [ref=e354]:\n        - generic [ref=e355]: Rotation\n        - spinbutton \"Rotation\" [ref=e356]: \"0\"\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e322] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\" [ref=e241]:\n        - treeitem \"Vault\" [expanded] [level=1] [ref=e424] [cursor=pointer]:\n          - text: Vault\n          - group [ref=e425]\n    - status \"Editor status\" [ref=e99]: Playtest ended\n    - dialog \"Open a room\" [ref=e364]:\n      - generic [ref=e365]:\n        - generic [ref=e366]:\n          - generic [ref=e367]: Keywaybench\n          - generic [ref=e369]: bench 1.0.0\n        - button \"Close\" [ref=e370] [cursor=pointer]: ✕\n      - generic [ref=e371]:\n        - generic [ref=e372]:\n          - button \"Back\" [ref=e373] [cursor=pointer]: ‹\n          - heading \"Pick a room\" [level=2] [ref=e374]\n        - paragraph [ref=e375]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=e376]:\n          - option \"Apothecary\" [active] [selected] [ref=e377] [cursor=pointer]\n          - option \"Clockmaker's Study\" [ref=e381] [cursor=pointer]\n          - option \"Judge Pack QZMXTA\" [ref=e385] [cursor=pointer]\n          - option \"Judge Pack ZKTRVA\" [ref=e389] [cursor=pointer]\n          - option \"Judge Walk RUVKMP\" [ref=e393] [cursor=pointer]\n          - option \"Observatory\" [ref=e398] [cursor=pointer]\n          - option \"Ship's Hold\" [ref=e402] [cursor=pointer]\n          - option \"Signal Cabin\" [ref=e406] [cursor=pointer]\n          - option \"Vault\" [ref=e410] [cursor=pointer]\n        - paragraph [ref=e414]:\n          - link \"New room\" [ref=e415] [cursor=pointer]:\n            - /url: \"#\"\n        - generic [ref=e416]:\n          - generic [ref=e417]\n          - generic [ref=e420]"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "j"
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
  "key": "j"
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
  "key": "j"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/82effe0f-db6d-4932-b450-f3386336d8ac\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - generic [ref=e238]: 82EFFE\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 6 solvedLongest run 63 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - region \"Inspector\" [ref=e337]:\n      - heading \"Inspector\" [level=3] [ref=e338]\n      - generic [ref=e339]:\n        - term [ref=e340]: Label\n        - definition [ref=e341]: Desk\n        - term [ref=e342]: X\n        - definition [ref=e343]: \"2.100\"\n        - term [ref=e344]: \"Y\"\n        - definition [ref=e345]: \"0.000\"\n        - term [ref=e346]: Z\n        - definition [ref=e347]: \"1.500\"\n        - term [ref=e348]: Width\n        - definition [ref=e349]: \"1.200\"\n        - term [ref=e350]: Depth\n        - definition [ref=e351]: \"0.700\"\n        - term [ref=e352]: Height\n        - definition [ref=e353]: \"0.800\"\n      - generic [ref=e354]:\n        - generic [ref=e355]: Rotation\n        - spinbutton \"Rotation\" [ref=e356]: \"0\"\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e322] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\" [ref=e241]:\n        - treeitem \"Vault\" [expanded] [level=1] [ref=e430] [cursor=pointer]:\n          - text: Vault\n          - group [ref=e431]\n    - status \"Editor status\" [ref=e99]: Playtest ended\n    - dialog \"Open a room\" [ref=e364]:\n      - generic [ref=e365]:\n        - generic [ref=e366]:\n          - generic [ref=e367]: Keywaybench\n          - generic [ref=e369]: bench 1.0.0\n        - button \"Close\" [ref=e370] [cursor=pointer]: ✕\n      - generic [ref=e371]:\n        - generic [ref=e372]:\n          - button \"Back\" [ref=e373] [cursor=pointer]: ‹\n          - heading \"Pick a room\" [level=2] [ref=e374]\n        - paragraph [ref=e375]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=e376]:\n          - option \"Apothecary\" [active] [selected] [ref=e377] [cursor=pointer]\n          - option \"Clockmaker's Study\" [ref=e381] [cursor=pointer]\n          - option \"Judge Pack QZMXTA\" [ref=e385] [cursor=pointer]\n          - option \"Judge Pack ZKTRVA\" [ref=e389] [cursor=pointer]\n          - option \"Judge Walk RUVKMP\" [ref=e393] [cursor=pointer]\n          - option \"Observatory\" [ref=e398] [cursor=pointer]\n          - option \"Ship's Hold\" [ref=e402] [cursor=pointer]\n          - option \"Signal Cabin\" [ref=e406] [cursor=pointer]\n          - option \"Vault\" [ref=e410] [cursor=pointer]\n        - paragraph [ref=e414]:\n          - link \"New room\" [ref=e415] [cursor=pointer]:\n            - /url: \"#\"\n        - generic [ref=e416]:\n          - generic [ref=e417]\n          - generic [ref=e420]"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowUp"
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
  "key": "ArrowUp"
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
  "key": "ArrowUp"
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
  "key": "ArrowUp"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/c9295caa-45a3-4b6f-94c7-49334ae8b5c3\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Overview\n    - button \"Rooms\" [active] [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]:\n        - status \"Connection\" [ref=e27]: All changes saved.\n        - generic [ref=e238]: C9295C\n        - button \"Copy room code\" [ref=e28] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=e33]\n        - button \"Invite\" [disabled] [ref=e34]\n        - button \"Playtests\" [ref=e35] [cursor=pointer]\n        - button \"Session menu\" [ref=e36] [cursor=pointer]: ⌄\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 6 solvedLongest run 34 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Start playtest\" [ref=e322] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\" [ref=e241]:\n        - treeitem \"Apothecary\" [expanded] [level=1] [ref=e438] [cursor=pointer]:\n          - text: Apothecary\n          - group [ref=e439]:\n            - treeitem \"Entry door\" [level=2] [ref=e440]\n            - treeitem \"Herb cabinet\" [level=2] [ref=e441]\n            - treeitem \"Mortar table\" [level=2] [ref=e442]\n            - treeitem \"Scale plinth\" [level=2] [ref=e443]\n            - treeitem \"Poison shelf\" [level=2] [ref=e444]\n    - status \"Editor status\" [ref=e99]: Playtest ended"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/c9295caa-45a3-4b6f-94c7-49334ae8b5c3\n- Page Title: Keyway bench\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - generic:\n    - region \"Room stage\" [ref=e14]:\n      - status \"Camera\" [ref=e17]: Player height\n    - button \"Rooms\" [active] [ref=e18] [cursor=pointer]\n    - toolbar \"Live session\" [ref=e23]:\n      - generic [ref=e25]: Live\n      - generic [ref=e26]\n    - generic [ref=e37]:\n      - group \"Chain figures\" [ref=e38]: 0 of 6 solvedLongest run 34 props\n      - button \"Presence\" [ref=e39] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=e40] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=e41]:\n      - button \"Move\" [pressed] [ref=e42] [cursor=pointer]\n      - button \"Rotate\" [ref=e49] [cursor=pointer]\n      - button \"Scale\" [ref=e54] [cursor=pointer]\n      - button \"Stop playtest\" [ref=e445] [cursor=pointer]\n      - button \"Trigger graph\" [ref=e64] [cursor=pointer]\n      - button \"Prop library\" [ref=e71] [cursor=pointer]\n      - button \"Next node\" [ref=e77] [cursor=pointer]\n      - timer \"Playtest clock\" [ref=e315]: 59:57\n    - generic [ref=e81]:\n      - button \"Add primitive\" [ref=e82] [cursor=pointer]\n      - button \"Upload prop\" [ref=e85] [cursor=pointer]\n    - generic [ref=e90]:\n      - button \"Cue timeline\" [ref=e91] [cursor=pointer]\n      - button \"Units\" [ref=e97] [cursor=pointer]: m\n    - region \"Scene\" [ref=e98]:\n      - tree \"Scene\" [ref=e241]\n    - status \"Editor status\" [ref=e99]: Playtest running."
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

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/app/rooms/4fe61d1b-85c8-4bde-9b9f-511129b60523"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/4fe61d1b-85c8-4bde-9b9f-511129b60523\n- Page Title: Keyway bench",
  "snapshot": "- generic [active] [ref=f1e1]:\n  - generic:\n    - region \"Room stage\" [ref=f1e2]:\n      - status \"Camera\" [ref=f1e5]: Overview\n    - button \"Rooms\" [ref=f1e6] [cursor=pointer]\n    - toolbar \"Live session\" [ref=f1e11]:\n      - generic [ref=f1e13]: Live\n      - generic [ref=f1e14]:\n        - status \"Connection\" [ref=f1e15]: All changes saved.\n        - button \"Copy room code\" [ref=f1e16] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=f1e21]\n        - button \"Invite\" [disabled] [ref=f1e22]\n        - button \"Playtests\" [ref=f1e23] [cursor=pointer]\n        - button \"Session menu\" [ref=f1e24] [cursor=pointer]: ⌄\n    - generic [ref=f1e25]:\n      - group \"Chain figures\" [ref=f1e26]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=f1e27] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=f1e28] [cursor=pointer]\n    - toolbar \"Transport\" [ref=f1e29]:\n      - button \"Move\" [pressed] [ref=f1e30] [cursor=pointer]\n      - button \"Rotate\" [ref=f1e37] [cursor=pointer]\n      - button \"Scale\" [ref=f1e42] [cursor=pointer]\n      - button \"Start playtest\" [ref=f1e48] [cursor=pointer]\n      - button \"Trigger graph\" [ref=f1e52] [cursor=pointer]\n      - button \"Prop library\" [ref=f1e59] [cursor=pointer]\n      - button \"Next node\" [ref=f1e65] [cursor=pointer]\n    - generic [ref=f1e69]:\n      - button \"Add primitive\" [ref=f1e70] [cursor=pointer]\n      - button \"Upload prop\" [ref=f1e73] [cursor=pointer]\n    - generic [ref=f1e78]:\n      - button \"Cue timeline\" [ref=f1e79] [cursor=pointer]\n      - button \"Units\" [ref=f1e85] [cursor=pointer]: m\n    - region \"Scene\" [ref=f1e86]:\n      - tree \"Scene\"\n    - status \"Editor status\" [ref=f1e87]"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/4fe61d1b-85c8-4bde-9b9f-511129b60523\n- Page Title: Keyway bench",
  "inlineSnapshot": "- generic [ref=f1e1]:\n  - generic:\n    - region \"Room stage\" [ref=f1e2]:\n      - status \"Camera\" [ref=f1e5]: Overview\n    - button \"Rooms\" [ref=f1e6] [cursor=pointer]\n    - toolbar \"Live session\" [ref=f1e11]:\n      - generic [ref=f1e13]: Live\n      - generic [ref=f1e14]:\n        - status \"Connection\" [ref=f1e15]: All changes saved.\n        - generic [ref=f1e88]: 4FE61D\n        - button \"Copy room code\" [ref=f1e16] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=f1e21]\n        - button \"Invite\" [disabled] [ref=f1e22]\n        - button \"Playtests\" [ref=f1e23] [cursor=pointer]\n        - button \"Session menu\" [ref=f1e24] [cursor=pointer]: ⌄\n    - generic [ref=f1e25]:\n      - group \"Chain figures\" [ref=f1e26]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=f1e27] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=f1e28] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=f1e29]:\n      - button \"Move\" [pressed] [ref=f1e30] [cursor=pointer]\n      - button \"Rotate\" [ref=f1e37] [cursor=pointer]\n      - button \"Scale\" [ref=f1e42] [cursor=pointer]\n      - button \"Start playtest\" [ref=f1e48] [cursor=pointer]\n      - button \"Trigger graph\" [ref=f1e52] [cursor=pointer]\n      - button \"Prop library\" [ref=f1e59] [cursor=pointer]\n      - button \"Next node\" [ref=f1e65] [cursor=pointer]\n    - generic [ref=f1e69]:\n      - button \"Add primitive\" [ref=f1e70] [cursor=pointer]\n      - button \"Upload prop\" [ref=f1e73] [cursor=pointer]\n    - generic [ref=f1e78]:\n      - button \"Cue timeline\" [ref=f1e79] [cursor=pointer]\n      - button \"Units\" [ref=f1e85] [cursor=pointer]: m\n    - region \"Scene\" [ref=f1e86]:\n      - tree \"Scene\" [ref=f1e91]:\n        - treeitem \"Judge Walk RUVKMP\" [expanded] [level=1] [ref=f1e92] [cursor=pointer]\n    - status \"Editor status\" [ref=f1e87]\n    - dialog \"Open a room\" [ref=f1e94]:\n      - generic [ref=f1e95]:\n        - generic [ref=f1e96]\n        - button \"Close\" [ref=f1e100] [cursor=pointer]: ✕\n      - generic [ref=f1e101]:\n        - generic [ref=f1e102]\n        - paragraph [ref=f1e105]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=f1e106]\n        - paragraph [ref=f1e143]\n        - generic [ref=f1e145]"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/4fe61d1b-85c8-4bde-9b9f-511129b60523\n- Page Title: Keyway bench",
  "inlineSnapshot": "- generic [ref=f1e1]:\n  - generic:\n    - region \"Room stage\" [ref=f1e2]:\n      - status \"Camera\" [ref=f1e5]: Overview\n    - button \"Rooms\" [ref=f1e6] [cursor=pointer]\n    - toolbar \"Live session\" [ref=f1e11]:\n      - generic [ref=f1e13]: Live\n      - generic [ref=f1e14]:\n        - status \"Connection\" [ref=f1e15]: All changes saved.\n        - generic [ref=f1e88]: 4FE61D\n        - button \"Copy room code\" [ref=f1e16] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=f1e21]\n        - button \"Invite\" [disabled] [ref=f1e22]\n        - button \"Playtests\" [ref=f1e23] [cursor=pointer]\n        - button \"Session menu\" [ref=f1e24] [cursor=pointer]: ⌄\n    - generic [ref=f1e25]:\n      - group \"Chain figures\" [ref=f1e26]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=f1e27] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=f1e28] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=f1e29]:\n      - button \"Move\" [pressed] [ref=f1e30] [cursor=pointer]\n      - button \"Rotate\" [ref=f1e37] [cursor=pointer]\n      - button \"Scale\" [ref=f1e42] [cursor=pointer]\n      - button \"Start playtest\" [ref=f1e48] [cursor=pointer]\n      - button \"Trigger graph\" [ref=f1e52] [cursor=pointer]\n      - button \"Prop library\" [ref=f1e59] [cursor=pointer]\n      - button \"Next node\" [ref=f1e65] [cursor=pointer]\n    - generic [ref=f1e69]:\n      - button \"Add primitive\" [ref=f1e70] [cursor=pointer]\n      - button \"Upload prop\" [ref=f1e73] [cursor=pointer]\n    - generic [ref=f1e78]:\n      - button \"Cue timeline\" [ref=f1e79] [cursor=pointer]\n      - button \"Units\" [ref=f1e85] [cursor=pointer]: m\n    - region \"Scene\" [ref=f1e86]:\n      - tree \"Scene\" [ref=f1e91]:\n        - treeitem \"Judge Walk RUVKMP\" [expanded] [level=1] [ref=f1e92] [cursor=pointer]:\n          - text: Judge Walk RUVKMP\n          - group\n    - status \"Editor status\" [ref=f1e87]\n    - dialog \"Open a room\" [ref=f1e94]:\n      - generic [ref=f1e95]:\n        - generic [ref=f1e96]:\n          - generic [ref=f1e97]: Keywaybench\n          - generic [ref=f1e99]: bench 1.0.0\n        - button \"Close\" [ref=f1e100] [cursor=pointer]: ✕\n      - generic [ref=f1e101]:\n        - generic [ref=f1e102]:\n          - button \"Back\" [ref=f1e103] [cursor=pointer]: ‹\n          - heading \"Pick a room\" [level=2] [ref=f1e104]\n        - paragraph [ref=f1e105]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=f1e106]:\n          - option \"Apothecary\" [active] [selected] [ref=f1e107] [cursor=pointer]:\n            - generic [ref=f1e108]\n          - option \"Clockmaker's Study\" [ref=f1e111] [cursor=pointer]:\n            - generic [ref=f1e112]\n          - option \"Judge Pack QZMXTA\" [ref=f1e115] [cursor=pointer]:\n            - generic [ref=f1e116]\n          - option \"Judge Pack ZKTRVA\" [ref=f1e119] [cursor=pointer]:\n            - generic [ref=f1e120]\n          - option \"Judge Walk RUVKMP\" [ref=f1e123] [cursor=pointer]:\n            - generic [ref=f1e124]\n          - option \"Observatory\" [ref=f1e127] [cursor=pointer]:\n            - generic [ref=f1e128]\n          - option \"Ship's Hold\" [ref=f1e131] [cursor=pointer]:\n            - generic [ref=f1e132]\n          - option \"Signal Cabin\" [ref=f1e135] [cursor=pointer]:\n            - generic [ref=f1e136]\n          - option \"Vault\" [ref=f1e139] [cursor=pointer]:\n            - generic [ref=f1e140]\n        - paragraph [ref=f1e143]:\n          - link \"New room\" [ref=f1e144] [cursor=pointer]:\n            - /url: \"#\"\n        - generic [ref=f1e145]:\n          - generic [ref=f1e146]:\n            - checkbox \"Walk in when I pick a room\" [checked] [ref=f1e147]\n            - generic [ref=f1e148]: Walk in when I pick a room\n          - generic [ref=f1e149]:\n            - link \"Prop library\" [ref=f1e150] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Versions\" [ref=f1e151] [cursor=pointer]:\n              - /url: \"#\"\n            - link \"Keyboard shortcuts\" [ref=f1e152] [cursor=pointer]:\n              - /url: \"#\""
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/c9295caa-45a3-4b6f-94c7-49334ae8b5c3\n- Page Title: Keyway bench",
  "snapshot": "- generic [ref=f1e1]:\n  - generic:\n    - region \"Room stage\" [active] [ref=f1e2]:\n      - status \"Camera\" [ref=f1e5]: Player height\n    - button \"Rooms\" [ref=f1e6] [cursor=pointer]\n    - toolbar \"Live session\" [ref=f1e11]:\n      - generic [ref=f1e13]: Live\n      - generic [ref=f1e14]:\n        - status \"Connection\" [ref=f1e15]: All changes saved.\n        - generic [ref=f1e88]: C9295C\n        - button \"Copy room code\" [ref=f1e16] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=f1e21]\n        - button \"Invite\" [disabled] [ref=f1e22]\n        - button \"Playtests\" [ref=f1e23] [cursor=pointer]\n        - button \"Session menu\" [ref=f1e24] [cursor=pointer]: ⌄\n    - generic [ref=f1e25]:\n      - group \"Chain figures\" [ref=f1e26]: 0 of 6 solvedLongest run 34 props\n      - button \"Presence\" [ref=f1e27] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=f1e28] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=f1e29]:\n      - button \"Move\" [pressed] [ref=f1e30] [cursor=pointer]\n      - button \"Rotate\" [ref=f1e37] [cursor=pointer]\n      - button \"Scale\" [ref=f1e42] [cursor=pointer]\n      - button \"Stop playtest\" [ref=f1e153] [cursor=pointer]\n      - button \"Trigger graph\" [ref=f1e52] [cursor=pointer]\n      - button \"Prop library\" [ref=f1e59] [cursor=pointer]\n      - button \"Next node\" [ref=f1e65] [cursor=pointer]\n      - timer \"Playtest clock\" [ref=f1e156]: 60:00\n    - generic [ref=f1e69]:\n      - button \"Add primitive\" [ref=f1e70] [cursor=pointer]\n      - button \"Upload prop\" [ref=f1e73] [cursor=pointer]\n    - generic [ref=f1e78]:\n      - button \"Cue timeline\" [ref=f1e79] [cursor=pointer]\n      - button \"Units\" [ref=f1e85] [cursor=pointer]: m\n    - region \"Scene\" [ref=f1e86]:\n      - tree \"Scene\" [ref=f1e91]:\n        - treeitem \"Apothecary\" [expanded] [level=1] [ref=f1e157] [cursor=pointer]:\n          - text: Apothecary\n          - group [ref=f1e158]:\n            - treeitem \"Entry door\" [level=2] [ref=f1e159]\n            - treeitem \"Herb cabinet\" [level=2] [ref=f1e160]\n            - treeitem \"Mortar table\" [level=2] [ref=f1e161]\n            - treeitem \"Scale plinth\" [level=2] [ref=f1e162]\n            - treeitem \"Poison shelf\" [level=2] [ref=f1e163]\n    - status \"Editor status\" [ref=f1e87]: Playtest running."
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

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/app/rooms/4fe61d1b-85c8-4bde-9b9f-511129b60523"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/4fe61d1b-85c8-4bde-9b9f-511129b60523\n- Page Title: Keyway bench",
  "snapshot": "- generic [active] [ref=f2e1]:\n  - generic:\n    - region \"Room stage\" [ref=f2e2]:\n      - status \"Camera\" [ref=f2e5]: Overview\n    - button \"Rooms\" [ref=f2e6] [cursor=pointer]\n    - toolbar \"Live session\" [ref=f2e11]:\n      - generic [ref=f2e13]: Live\n      - generic [ref=f2e14]:\n        - status \"Connection\" [ref=f2e15]: All changes saved.\n        - button \"Copy room code\" [ref=f2e16] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=f2e21]\n        - button \"Invite\" [disabled] [ref=f2e22]\n        - button \"Playtests\" [ref=f2e23] [cursor=pointer]\n        - button \"Session menu\" [ref=f2e24] [cursor=pointer]: ⌄\n    - generic [ref=f2e25]:\n      - group \"Chain figures\" [ref=f2e26]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=f2e27] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=f2e28] [cursor=pointer]\n    - toolbar \"Transport\" [ref=f2e29]:\n      - button \"Move\" [pressed] [ref=f2e30] [cursor=pointer]\n      - button \"Rotate\" [ref=f2e37] [cursor=pointer]\n      - button \"Scale\" [ref=f2e42] [cursor=pointer]\n      - button \"Start playtest\" [ref=f2e48] [cursor=pointer]\n      - button \"Trigger graph\" [ref=f2e52] [cursor=pointer]\n      - button \"Prop library\" [ref=f2e59] [cursor=pointer]\n      - button \"Next node\" [ref=f2e65] [cursor=pointer]\n    - generic [ref=f2e69]:\n      - button \"Add primitive\" [ref=f2e70] [cursor=pointer]\n      - button \"Upload prop\" [ref=f2e73] [cursor=pointer]\n    - generic [ref=f2e78]:\n      - button \"Cue timeline\" [ref=f2e79] [cursor=pointer]\n      - button \"Units\" [ref=f2e85] [cursor=pointer]: m\n    - region \"Scene\" [ref=f2e86]:\n      - tree \"Scene\"\n    - status \"Editor status\" [ref=f2e87]"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/4fe61d1b-85c8-4bde-9b9f-511129b60523\n- Page Title: Keyway bench",
  "inlineSnapshot": "- generic [ref=f2e1]:\n  - generic:\n    - region \"Room stage\" [ref=f2e2]:\n      - status \"Camera\" [ref=f2e5]: Overview\n    - button \"Rooms\" [ref=f2e6] [cursor=pointer]\n    - toolbar \"Live session\" [ref=f2e11]:\n      - generic [ref=f2e13]: Live\n      - generic [ref=f2e14]:\n        - status \"Connection\" [ref=f2e15]: All changes saved.\n        - generic [ref=f2e88]: 4FE61D\n        - button \"Copy room code\" [ref=f2e16] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=f2e21]\n        - button \"Invite\" [disabled] [ref=f2e22]\n        - button \"Playtests\" [ref=f2e23] [cursor=pointer]\n        - button \"Session menu\" [ref=f2e24] [cursor=pointer]: ⌄\n    - generic [ref=f2e25]:\n      - group \"Chain figures\" [ref=f2e26]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=f2e27] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=f2e28] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=f2e29]:\n      - button \"Move\" [pressed] [ref=f2e30] [cursor=pointer]\n      - button \"Rotate\" [ref=f2e37] [cursor=pointer]\n      - button \"Scale\" [ref=f2e42] [cursor=pointer]\n      - button \"Start playtest\" [ref=f2e48] [cursor=pointer]\n      - button \"Trigger graph\" [ref=f2e52] [cursor=pointer]\n      - button \"Prop library\" [ref=f2e59] [cursor=pointer]\n      - button \"Next node\" [ref=f2e65] [cursor=pointer]\n    - generic [ref=f2e69]:\n      - button \"Add primitive\" [ref=f2e70] [cursor=pointer]\n      - button \"Upload prop\" [ref=f2e73] [cursor=pointer]\n    - generic [ref=f2e78]:\n      - button \"Cue timeline\" [ref=f2e79] [cursor=pointer]\n      - button \"Units\" [ref=f2e85] [cursor=pointer]: m\n    - region \"Scene\" [ref=f2e86]:\n      - tree \"Scene\" [ref=f2e91]:\n        - treeitem \"Judge Walk RUVKMP\" [expanded] [level=1] [ref=f2e92] [cursor=pointer]:\n          - text: Judge Walk RUVKMP\n          - group\n    - status \"Editor status\" [ref=f2e87]\n    - dialog \"Open a room\" [ref=f2e94]:\n      - generic [ref=f2e95]:\n        - generic [ref=f2e96]:\n          - generic [ref=f2e97]: Keywaybench\n          - generic [ref=f2e99]: bench 1.0.0\n        - button \"Close\" [ref=f2e100] [cursor=pointer]: ✕\n      - generic [ref=f2e101]:\n        - generic [ref=f2e102]:\n          - button \"Back\" [ref=f2e103] [cursor=pointer]: ‹\n          - heading \"Pick a room\" [level=2] [ref=f2e104]\n        - paragraph [ref=f2e105]: Choose a draft or a starter room. Enter walks you in.\n        - listbox \"Rooms\" [ref=f2e106]:\n          - option \"Apothecary\" [active] [selected] [ref=f2e107] [cursor=pointer]\n          - option \"Clockmaker's Study\" [ref=f2e111] [cursor=pointer]\n          - option \"Judge Pack QZMXTA\" [ref=f2e115] [cursor=pointer]\n          - option \"Judge Pack ZKTRVA\" [ref=f2e119] [cursor=pointer]\n          - option \"Judge Walk RUVKMP\" [ref=f2e123] [cursor=pointer]\n          - option \"Observatory\" [ref=f2e127] [cursor=pointer]\n          - option \"Ship's Hold\" [ref=f2e131] [cursor=pointer]\n          - option \"Signal Cabin\" [ref=f2e135] [cursor=pointer]\n          - option \"Vault\" [ref=f2e139] [cursor=pointer]\n        - paragraph [ref=f2e143]:\n          - link \"New room\" [ref=f2e144] [cursor=pointer]:\n            - /url: \"#\"\n        - generic [ref=f2e145]:\n          - generic [ref=f2e146]\n          - generic [ref=f2e149]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Close",
  "target": "f2e100"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/4fe61d1b-85c8-4bde-9b9f-511129b60523\n- Page Title: Keyway bench",
  "snapshot": "- generic [ref=f2e1]:\n  - generic:\n    - region \"Room stage\" [active] [ref=f2e2]:\n      - status \"Camera\" [ref=f2e5]: Overview\n    - button \"Rooms\" [ref=f2e6] [cursor=pointer]\n    - toolbar \"Live session\" [ref=f2e11]:\n      - generic [ref=f2e13]: Live\n      - generic [ref=f2e14]:\n        - status \"Connection\" [ref=f2e15]: All changes saved.\n        - generic [ref=f2e88]: 4FE61D\n        - button \"Copy room code\" [ref=f2e16] [cursor=pointer]\n        - status \"Service status\"\n        - textbox \"Invite tester email\" [ref=f2e21]\n        - button \"Invite\" [disabled] [ref=f2e22]\n        - button \"Playtests\" [ref=f2e23] [cursor=pointer]\n        - button \"Session menu\" [ref=f2e24] [cursor=pointer]: ⌄\n    - generic [ref=f2e25]:\n      - group \"Chain figures\" [ref=f2e26]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=f2e27] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=f2e28] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=f2e29]:\n      - button \"Move\" [pressed] [ref=f2e30] [cursor=pointer]\n      - button \"Rotate\" [ref=f2e37] [cursor=pointer]\n      - button \"Scale\" [ref=f2e42] [cursor=pointer]\n      - button \"Start playtest\" [ref=f2e48] [cursor=pointer]\n      - button \"Trigger graph\" [ref=f2e52] [cursor=pointer]\n      - button \"Prop library\" [ref=f2e59] [cursor=pointer]\n      - button \"Next node\" [ref=f2e65] [cursor=pointer]\n    - generic [ref=f2e69]:\n      - button \"Add primitive\" [ref=f2e70] [cursor=pointer]\n      - button \"Upload prop\" [ref=f2e73] [cursor=pointer]\n    - generic [ref=f2e78]:\n      - button \"Cue timeline\" [ref=f2e79] [cursor=pointer]\n      - button \"Units\" [ref=f2e85] [cursor=pointer]: m\n    - region \"Scene\" [ref=f2e86]:\n      - tree \"Scene\" [ref=f2e91]:\n        - treeitem \"Judge Walk RUVKMP\" [expanded] [level=1] [ref=f2e92] [cursor=pointer]:\n          - text: Judge Walk RUVKMP\n          - group\n    - status \"Editor status\" [ref=f2e87]"
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
  "page": "- Page URL: http://127.0.0.1:4173/app/rooms/4fe61d1b-85c8-4bde-9b9f-511129b60523\n- Page Title: Keyway bench",
  "inlineSnapshot": "- generic [ref=f2e1]:\n  - generic:\n    - region \"Room stage\" [active] [ref=f2e2]:\n      - status \"Camera\" [ref=f2e5]: Player height\n    - button \"Rooms\" [ref=f2e6] [cursor=pointer]\n    - toolbar \"Live session\" [ref=f2e11]:\n      - generic [ref=f2e13]: Live\n      - generic [ref=f2e14]\n    - generic [ref=f2e25]:\n      - group \"Chain figures\" [ref=f2e26]: 0 of 0 solvedLongest run 00 props\n      - button \"Presence\" [ref=f2e27] [cursor=pointer]: 1 here\n      - button \"Account\" [ref=f2e28] [cursor=pointer]: MQ\n    - toolbar \"Transport\" [ref=f2e29]:\n      - button \"Move\" [pressed] [ref=f2e30] [cursor=pointer]\n      - button \"Rotate\" [ref=f2e37] [cursor=pointer]\n      - button \"Scale\" [ref=f2e42] [cursor=pointer]\n      - button \"Stop playtest\" [ref=f2e153] [cursor=pointer]\n      - button \"Trigger graph\" [ref=f2e52] [cursor=pointer]\n      - button \"Prop library\" [ref=f2e59] [cursor=pointer]\n      - button \"Next node\" [ref=f2e65] [cursor=pointer]\n      - timer \"Playtest clock\" [ref=f2e156]: 59:57\n    - generic [ref=f2e69]:\n      - button \"Add primitive\" [ref=f2e70] [cursor=pointer]\n      - button \"Upload prop\" [ref=f2e73] [cursor=pointer]\n    - generic [ref=f2e78]:\n      - button \"Cue timeline\" [ref=f2e79] [cursor=pointer]\n      - button \"Units\" [ref=f2e85] [cursor=pointer]: m\n    - region \"Scene\" [ref=f2e86]:\n      - tree \"Scene\" [ref=f2e91]\n    - status \"Editor status\" [ref=f2e87]: Playtest running."
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
  "result": "- [Screenshot of viewport](evidence/reduced/page-2026-11-06T20-01-51-928Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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U+Kjmnlz59byTQ/RqehasggcxzF/9QoAAADW1Tgf1lAwhQ5hYl+SwI4w2RiQMXL0mBorq6JrEUAEAAAA1KTe+bCGvCl0IBP7ojR2hN5m3lp//fX+8tgjp592aueN4pZ13v52sXLp//78c//9WZl2fnXpLyQfiVIDAyNr/LhLdC0CiAAAAICa1Dsf1pA3hQ5nYp+bzI5Q3cBzu+6y87XX/e4DH3jfuHHjIvhhRF9/jX+aQnRd+8+LAwAAoM3qnQ9ryJtCBzWx753SjpB/qP9Gjx617TYfuvyKK5959tmddtxBcquJq6xyyre/deftt1z/+2uPOuLwZZZZJr1drJx7zln33TPpqisv32zTTdIbN998s59ectFDf7zvnsl37bnH7umNoly835f3zT549dVXP/usM+6Zcvc1V12x2267PPLQA4t7nDjx1FNOvuuOW2+64Q9HHH7owMCAuHH8+HHnnXv2pLtunzLpzjNOP23ChAkRAAAAAEBTj8R2hMyDQvGxj3507ty5kyZNvu222z/5yY9LbiUS1/nz5++866d233PvDd+zwTeOOza9/f3ve+8vf/m/+3zmc9NnzPjSl74obhFJ6YknHD9p0qRtP/Kxk7996pFHHLbWWm9KH7ztth8afPAXv/D59Mbzzjnr1Vdf2377nb527Df23nPPwR4vOP+cF154YZdddz/08CO22GLzQw85WNz4hc9/buWVV/rs576w2+57rbjCCh/9yIcjAAAAAIC+7vR2RPHdYdluu09cf8ONCxYsuPRXv37nO97x1re+pXQTUa0VSey3Tj7lueeenzr15cMOP1Ksp3dd97vf3z1p8mN//vPFF1+yztvXFrdMnz79g9t8+ILvfX/27DmvTJs2d+68t6+9dvrg66+/cfDBay+6UbS82mpvEK2JcvTDjzzyk4svHuxxpRVXPP2MM8XtDz308KWXXiYybXH7qFGjxo8bL1aeeOKJfT77uUt/dVkEAAAAADAyLMntz7sjOBMnTtx4o4023WSTPXb/VHrLXnvucfwJJxZvteqqq7700tTXX1/8p8z+/e//DN41e/biy7tnzprV37/wQIkc9cjDD9thh+3++c9/Pf/C80mU9PX19XjwQH+25X/964l0ZZWJqyy//PJ/eeyRwY5mzHhVLH/4wx+vueaa3zn1lBEj4vvuf+DCCy968t//jgAAAAAARkSqu/jnTvs7bgrbHp/a7e9//8d2O+yU/nO3XXc5/LBDTjzp5Pnz5xds9fTTTy+//HJjx45NM1WRtc6bN+/555/v+eAdtt9uq622EF089dTT4p+33HR9QcvPPvdcZ8urrLxyevtzzz73yiuvbL7le0WluvPxL02d+uX9vipWVl55pfPPPeeQQw465NDDIwAAAACAqcU58IioKbbffrtrr/vd4D+vuvpqUZ795Cc/UbzVpMlTRDn36KOOEA8eGBg4/bRTRI0378EzZ84UCe2C+QvEI7+y376i5lzQ8n333T9r1uxjv3a0eLB45K677pLefvekySJ/PvaYo8eNGzdmzJgffP97J514grj929866fTTThW3iK1ee+212bNmRW218cYb9fwvAgAAAAADaQU4+PLve7feaoUVlr/8iisHbxFp5PXX37j9dp+88srfFm+7/wEHiVrxnbffsuyyy95ww43fPuXUvEdec+11W265xY03/H7u3Lk33HjTk08+WdDs7NmzDzzo4M/s8+kpk+4UJd8f/ujCjd6z4WCPBx6w/3XX/Hb55Ve4/fbbxV3ixosuueSoI4944L4pCxYkU+6558yzz4la6ZKLLszLde+55959Pvu5CAAAAACULSwCxyNHLyX58Leuu8kLzzwZQctWW255xhmnbbzJ5pFjb15rrV9d+ouDDjnszjvvEv/88Lbbnn3WGZ0POO4barr8CAAAEABJREFUx1/2698cdOD++315387b13/3ewavZN5mmw9968QTdtl198HrkCdMmHD8N4/72Ec/cuutt335K/unN273yU+cduq3o0W1cVFIP+F/Tnro4YezIa04cXXJV45IfUUCvPY66/a89y+PPSISYJEGR4okAxAP+9ffHo4AAEBQ1nzbesxR4Tn5+bA/esZc+47kRfV/j0yJ5Fj4CvToFd+x6ofPecvn7hX/iRXxz7xH3nLT9bt/areuG397xW/2/+pXoib6yYU/EhXg0aNHbbbpJvt/db/JkyZHjvX19Yk0+8orr0qz39Tzzz8vUsrB/0T2m94+Zco9nbcPZr/LL7ecyHWP+8YJndnvVb+9fOkJE3571dVdPT7zzDNi29333Fs8+LtnfCdySXSkkf0CAIB2Gj9+3OmnnXrHbTeLKej/HP/NgYEB+W3FlFVsdd89k7q2Mmkz65ijjzzv3LMjM/ffO1lMNcXKmd89XcQW1W29ddftqrJYJwo5v7v26num3P3/LjhvzTXXGLz94x//2GW/+qU4IL/42SXvW/QzK2ERL6djv3b0Y48+dP55vb8KKl4weXd5RbwUReFqhx2277xx4sSJf3rkwRuv//3gLe9779Y//uH3p0y6887bb/nB97+36SabRJUwTYBFurvadhcvtcb74v5R4j+xIv5ZkANn/erXv57kPjOsxfnnX/Dhbbd58IH7fvyjH7z88svHffOEyLHDDz2kv6/vtNPPiAwcf/w3br/tjj9cP/QnvsTZ+MMf/fjzX9z3lVde6bnJX//6txNPOvkNb1hV1J8jq96z4YYbb/Serv/EjREAAEChk7910pvfstbhRx59/AknbrzxRt/8xtfltz300IMv/MnF79l4s7lz59pqsyXE8dl5px0jZ/77s/vstdee3//BD/fZ57/7+vvOO+es9GOI9ddb7+ST/ue22+7YcefdHvjjH797+mnW56WuXfjjH671pjddfc21UfimT5++8447dN6yx6d2e23J7+MIH/nwtueec9YTTz4pUoyDDj7sxRdf/H/fO3/zzTeL3DNNgJfbYN+4b2TnLeKf4sZI2vbbfXL99dcbN26c+LRGHIj0RlE1FR+5ffQjH44W/T3nS3/58z/ef8/FP/nx4GW0Qbjv/gf23HsfUbdc553rf/kr+0+bNi1yacstt9hjj92POubY0aNHf+iDH4i07LD9dltvteXb3vbWeybfddKJJ4wZM0bc+NJLL/38578s3vDVVxf+mNNSS8l+o17GJRf/5HvfO++cs8/q+k/cKO6KAAAAcqyxxhrbfOiDxx9/4pQp99x2+x3fPuXUHXfYYemll+56mEhiRenp3imTfnXpL9Kf0vzMPp8WxasJ48eLWtzVv71Co83DDzvk5hv/8OAD915y0YVvX3vt9MZdd9lZTGjF/PZHP/h/m2+2aefjC6bBm2yysXj8A/dNuerKy3fZefFvnYjp2dePPea2W24S/+215x5RmZ5di/0VdVqRgYjbReNpDVlYffXVzz7rDFFcveaqK3bbbZdHHnogvV2U70495eS77rj1phv+cMThh6Y5p6iHiwr2pLtuF0W8M04/bcKECeLofftbJ6222hvEMdxu+B+jFT2KArWo3IqDEy26tG2dt789vevQQw4WuZ9YETNYUSEUT8Q1V18p2jzl29/K7s7ee+31ox9feOVvr/rLX/966GFHrLbaG8WTIm7f59N7TZo85bzzL3jyySdPP+PMv/zlr3vt1X1wRAwH7P/Vn15ykcgsfnLhjwZLjl2xrbzySqLru+687ffXXXPUEYePGjUqjU2U/T/335+9/dabxMpRRx4xWP/v+YxruP76G0Q2+HpHlpg1Io6/dsxR4okQMXz2M/ukN4oIRQzXXXOVmMB/94zvrLrqqoMBn3PWd8XOpoeiyqxKnCAbbLDBW9/6lsVhjxjxye0+ceutt6X/7OvrE3vxy/+99H9O/Najj/7p/gce+Nqxx4ny2zePOzZyzzQBHvuGzSRvLCbSpxtuuPFjH/1I+s+PfvQjc+bM/cP1N4hbvviFz599zrkf3ObDt95++wXnnydekREyxOAr8tULvve9P/3psbXWelPn12lWWmklMcSk//3pkYcGbxdD6uDtJ39r8Q8m7/flL917731f+/pxhxx2xAbvfvcxRx0Z1USUed/+9rU33WzLTTfP/LfZluIu6sAAACDPO9+xztSpLw/+dZI777p73ry567x9WHIi8oQLzjvntttv/9C2Hznr7HNFaiQKMxdf8lNRvRCF3z32+vQnt99RtU1RwvrUbrt9/bhvbvPhj/3j8cf3+fTe4sZtt91G5Cfnnf+9D27zkRtuvOn8887p/OJu3jT4jW9c7ewzzxD1wA986MPfPfMskXF98APvFw8Qmfl66637pS/vt+fen950001Gjx5TcBwKut522w/98pf/u89nPjd9xgwx305vFAXVV199bfvtd/rasd/Ye889B9u54PxzXnjhhV123f3Qw4/YYovNRcoqbvzC5z8nZuaf/dwXdtt9rxVXWEEk7eLoHXPs1//zn6fEMbzq6mu6gllvvXee8D8nid0pCHiFFZYXyfYXv7Tfuedd8MlPfPw9G27Qea/4sOANb1j1rrvuTv85Y8arjzzySJplvfktb77vvvsHH3nvfff1rACLZ+THP75QZBaikfPOPWv55ZfPxnbBeecuWLBgp513PfiQw0Sh7rivfy19jAhMTEF33/PT+x948FZbbn7owQdFOc+4np/+7Oelj9lwww0e+/Nfdtt9z9vvuHP/r+6XJudHHXn42972tsOPOGqHnXadP3/+mUsuSxQB/+tfT4idFaWsirMq8aq+4447PrXbruk/t/nQhxbMX/Dgg4szkbe+5S0iQ/nJTy7u3EQEKT5jqiDX8+hnkC779eVbb72VeFmLdfEMXXX11eKVJ46a+Gzg7kmTxXAjjpEopm+15ZYRMvbea4/p06b/4Ic/zt718ssvD17o+4511x+8vfMaYPGhi7hlmWWWES+7M7571l//+jcxKPzs57/Yckvnf7Urz4gR8fx583v+jPPCW+fNFw+IAAAAehFl0hkzpg/+U8wdxIx83PjxnY/ZdZed/vLXv4lp97Rp0+6+e5JIP7J/rUa1zTGjR4vC4NixY0W6KBIqkQ2KG/faY/dLf/XrO+68U3R06a8uu+/++3db8gOZqZ7T4J123OH+B/7426uufuWVV24Vafrtt4tSpyidfeLjHz/n3PPFbO2pp54+5dTTimdEBV1ff/2NYo792J//fPHFl6y9qG4p6sCiePutk0955tlnH37kkZ9cvDg/EbevtOKKoqwqbn/ooYcvvfSy9y+6wlZkX+PHLdz9J554Yp/Pfk60HxW6/IrfTp5S8peK5sydK7L9Z555RkxERWzvete7Ou8dv+gQibxg8BaRvafHbfSo0Z1ft5w2bXrPbyaKnF8cTNGCKCM/8cST4iOPrtjEzr7pTWue9K1vP/fc86LI/J0zvitK2emXImfNmi0S3aeffloUnM4973vbbbewxN3zGXdHfP5y5ZW/FU/9yd8+Vezg2mv/l3hJ7LTjjmeddY44XCI28cGBSNonrrJKtOh7yN896+z0cFWZVSVJ0jei739/ddl2230yTdF32WVHUbQXr+r0AROWnjBv3jzxcurc6l9PPBEt/GtEy0eO9UdmXn9q0lJrvC97Y6RO1L7/89RTH//YR8UnXpttuumJJy3888IrrrjikUccJv4bfNhKK60YIaO/v/9tb3urqOVGBkaNWvhtdvGSHbxFvDQlt02HntdnzowAAADqNm16d/4j/vny1Kmdt6yy8ioi0Rr855NPPrnKKisbtnnTzbdcceWV+31536OPOvJPj/3pF7+8VJQcVl555aeeGvrbP6JAKkpznVv1nAaLrUTJt3N2d+edd4kC6ejRo55YlCoIIhEq/sZsQdeDfwB15qxZ/QMLkwJREn/ppamDDYriYbqyysRVRKW0MxJRehXLH/7wx2uuueZ3Tj1FJOH33f/AhRdeNPgnVHuaM2dOVGZux2Nmz57T9WfGpr68MJdbZumlB5+4pZYam+a9iz6MGDf4SDE1FTletn2RMA+uP/XUU6uuOrErtq6D8H//9/eRI0dOnLgwnxQ3Dh60x//5uDgmIvns+YxHzsyZs/iidBGJmKiPHBhYbrnlxEvi8t/8qvNhExftV+cV7FVmVXEcR3F06623ibNDfHxw192TNnrPRl879hvpVxiiRX+jVyQv4lCLjH1wK/Hhi1g++9yzkWOmCfDUB74/drXNOy8DTubPETdGWq6++lrxyZZ4of/xwYfSX9l98cUXr7zqqh/84EcRCp19znniv3T93e9+1y9//tNInfigS4x0++33pUMOPWKZZZbec8/dr/vd72U2fPNaa+2//1fEK/jxxx+PAAAA6vboI4+usMIKb3jDqiJFFP985zvfMTAw8rE//6XzMWKqvdFGGw3+c/XVV3/22ecM2xREGTBaVB395je+fsrJJ73/g9s+99xzb3jDGwYfICb6Iq3q2io7DRZJgqhVfnm/r3Y+TGRcog65xhpr/Pvf/xH/FMGI2mOUT6brQc8+99zyyy8nGkzTv1VWXvxxwHPPPieq0Jtv+d7BCl7qpalT0/BWXnml888955BDDjrk0MMjOaKp0WNGp+tjlqyUElmfSP7XXe+df/7LwsM+YsSIt731bT/72S/E+t//8Y/O62/Xefva//f3HnsqjljH+hsefuTRrgeICW3nQXjrW98icuNnnnl2rTe9aemlJ4ik96WXXhK3r/WmtUQpNf2uYvYZjyoknpqZM2d+9r+/0PVzpF1/EqiWrOqKK6/acYft11hj9TvvuktUyAdvFxmHOIk+vfdep572nTe+cbWT/ueEc887f8sttxBPa2d53xHTr0DPeuFP/7nqM689cWsyb7b4T6yIf4obIy2XX3Hlu961/oe33eaqJT+389Of/2LPPXZPv/3/vvduffedt7/lzW+OYEPnNcDiv/T7CQcfcpgYUh979KG77rjt73//x1lnnxstun4gfcxn9vn0+973XrHym8suTRtJ77r2mt+KEUekzV3Doqp77rlX/Cca3HjjjSIAAABdzzz77AMP/PHb3zppww022GrLLUVmcuttt3UVSy/79eVr/9fb0h9rWfu//mvvvff8xS//17DN3T+1m5gmidKWqM6JCqSoYYobf/aLX35qt13WWWfh33z6xCc+9p4NN/zVZb/uajw7Df7VZb951/rrpX/7SiTnv7/uml132VlkXNdce+1BB+6//HLLjRkz5ugjj+h5vdggma4H3Xff/SK7PvZrR4s8XMzxdl3yZem7J00W6cqxxxwtyqqi0x98/3snnbjwx03EoTj9tFPFLWKr1157bfasWeLG1157fczYMRMmTIgKiXnmvl/6oph2brDBu7feSuG7uDfceNO+X/yi2Jf/+q+3fR+7T2EAABAASURBVOe0U+bNmyuSK3H7ddf9TnyC8IXPf04kVPt/9SubbbZpzz+n/JEPbyuePrEisi+RmF19TfeFypMmT/nnP/919FFHiM8alltu2SMOO/S3V109c9GXHJMk+drRR4py60orrXTA/vulvw/a8xmvkijz/ubyKw4/7BCx4+KfBx6w/zVXXSE+Guh6WC1Z1WW//s073rGOKAL/esnvsA668KKLPrPP3l8/9pjx48ffe9/9F1/0k89+5jM/vrCKP3NrWgGOFuXAT//hQMkHH//N48R/6fof//jgHnt9uvNe8cHAlHvu3WTjjb6475fTW2644cbx48Ydcfhh4ti98OKL3/t/3xef7kQoJA7s2uusm67/4frrO3/QaFBnxbjTX/761x123KXrxvTHfrMPvurqa7J/3sDQPp/9nMh+RRq88UbviQAAAHQdfcyxIk/7+c8WXsh6yy23fiPzg5Si1veV/Q/c94tf+MbXv/b44/8899zzS3+BprTN6373+/XXW+93114lSgt/+9v/HX/Cwr8zKia0yyy99AnHf+PNa6314EMPf+WrBwx+u3hQdhoswtv/gIO+vO+Xjjn6yDiOxaTrmmuvE7d/6+RTDjv04Csuv2yppZb6zunfFQnkYCMiLRT/pevz5y94x7rry3Q9SNRXDzzoYFHwmDLpTlFX/OGPLhz8W8EiEpFZXXfNb5dffoXbb79d3CVuvOiSS4468ogH7puyYEEy5Z57zjx74U/UinsX/pXsW24UU82LLr4kr6/jvnn8eeecdeXll918y61/uP5GUU6P5Jx/wf+bMH7Caad8W+R4Ii848OBDRfq9sN877vzumWcffNABIhV8+eWXv3nCiY8+2qMmd9llvznqqMPfsc464rOM/Q84+Lnnns8+5iv7H3Dk4Yfdefst06ZNF59xnHnW4p/enTZt2iOP/mny3Xe9/MrLv//99d8986wo5xnXID5xuOWmoUn7wuJTr2l5T6eedvoBX/3K9y44T+S0Yq9PPe2MbFGqlqxKVMtvuvmWdd/5zltvu73rrp///JczX5/55S9/ae+9Fv6tNfEJSxyLF8+dkXvxyNGyv1vz1nU3eeGZJ6MWEx8miVHgM//9+QgqVpy4usYrRyTA55x91qab9/5EcPLdd4oB+p5774skSAYgHvavvz0cAQCAoKz5tvVaPkd1RFS5zzjjtI03qe1Polr3q0t/IRLXC39yUaTuQx/8gPgcYYut3hdp0ZsP16tnzO52ZK+99nj+uedFhT/Siur/Hin5+2qDpCvA/MFdVEt8lNjX3ydkv9iz8Nb+PvGACAAAAPb85MIf3XrrbZf+6lfvfte79v/qfpMnTY6ASoiacGRCpKtyyYFcAhxC9rvOOm//+teOEcupU6de+durzzl34fd7N998s/2+vO96675z9uzZZ5197i9++b+HHHyg+DRrp10W/437gw86YOutt9pp591GjRp1wP5f+cD737/CCsvfedfdp59xZvpHybbeassvfP5z6677zgcfevhvf/tbhKrcd//9f/7zXyZPunP+vEwC3N8n7hIPiAAAAGDP+edfcOghBx9z9JELFiy4/fY7jst8xxvwl1wObOEaYE8cc9SR/3riiUMOO3yNNdb49rdO+sP11z/zzLMnnnD8by6//PAjjtxs002P/+Zxk6dM+d9LL/viFz6/1lpvevzxf4qttt1mm8t+vfAvARx15OGrrbba4Ucc9cq0aSJJPvOM73xqj71EU+eec9app51+4MGHbrzxRiedeMKfH/tzhKrs85n/fs+GG2Z/3U7Ufsl+AQAArLvv/gf23HufqKF2+9Seka4bb7pZ/BchfBIJcCBffh45auSyyywzb+68e+6594PbfDi9MV1ZZpllRFo7d+68t6+99rXX/W7ylHt22Xmn075zxvrrr7fqqqtefsVv09+P3nOvTz/254X57bnnXXD976+duMoqO+24/SOP/in9e4DXX3/DB97/vvRHpVEZEl0AAAAAUiSKwGUJcDiX/n77lNOOOuLwiy++cNbMWbfdfscPf/SjJImOPPywHXbY7p///NfzLzyfRIlIdMUjr7rq6oMOOkAkwNtv98lbbr112rRpK664Ys/fj15pxZU6fx594U+HkwADAAAAgJ/KcmD5r0D7ngo/+OBD6Y8qvetd6/+/C86b+vJUUQ3eaqstttthp/THygf/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4Ttuu+X8885eeukJ4va11nqTuHH1N76x88HpERAxPPzg/SuuuELnXd8++aSLLvxR2uDp3zl18Pb9v7rfgw/cs+EGG4j1W266/k+PPLjKxFU6N9x5551ER+kmaafpf5PuukM09Za3vCVCqbjjg1XJ/6LMuuQyyqwbxS2/VNqxqJodAADADaU3x8jSW6S9N8fY8a7EOZtIdpcNsjWyB89LlUfnJAe23maPBmUrwKG82u+84653vWv9kaNGpf/cdOONn3/+hS222Dz95/rrr7f88svdfPMtkbFrrr1u7XXWXX+DjY485hiR8X7zuK8XP/72O+544cUXd9ppx8FbRo0evc02H7z66mu6HvmZffb+4uc/t/8Bh9z/wAPpLa++9toeu+3W+Zgdtt9u+owZnbds++GPiXh23vVT//7Pfy7+yY/ShBxFknjhf1G8eEX1vyizLrk0/S9Sf7MCAAB6JN9zdf9LMuulS8MJjPY0Jhuww/+85neUvh89d+T3vLqvQIv6qqiUDv7zkYceEPVesbLmGmucc9aZ995z91VX/maddd4++IA1Vl/97DO/K8qn11x1xW677Soen94+ceLEU085WVRob7rxD0ccftjAwEBnL3dPniI+jNhy84UZr8gwN9zg3dded93GG22U3rvVlls8+uijL730kuhUVEqnTL5LFFeP/8ZxI0bkHgeRjoqi8VprrdXz3jmzZ0+6e/IVV17VGXmeq6665uMf/cjgPz/xsY/On7/gmt/9vvMxorR72CEHH3LYkXfeddfgjTfdfMv22283GORb3/rW9d75jsmT78l28fTTT3/3zLMGRo7cYostIpSKlyzjzLrMyNy1LrkEAABIxZn10qXGpEVjulLzpEVpr2qO0j8VBhVGEbjbCJku3UUhkrrzzj1rxozpn/jkDsd984Rdd9l58K5zzznz1dde3W6HnY459ri999x98PYLzjv3hRde3Hm33Q897IgtNt/ssEMP7mxQZKRT7rl30802EetbbbH51KkvX3TxJW9721vS7x5v9J733D1pilg58sjDRAVwr70/8/kv7rvZ5pvutlvvL0WLdPQr++237777Pf7443m7IDLwjTd6zxNPPhmV+dVlv15rrTev+453pP/8xMc/dsP1N8yeNSv957x583becYfjv3mcOA433zKsRj1l8pT+/j5RLk7/udtuO998y61z5swu6GtESD/SVZ/iS2g0LqSJMut+iTPrpW+w/Md//Md//Md/of8XyS19lagvE62/+FHtJc+W5D3jNUTgkwrD8SnpiOVurvmPYG26ySarrrrqt7596nPPPf/QQw9fdMnP0ts322zT1VZb7Vsnn/LsM88+8sijF110yeDtK620wulnfFfcLh5/6a8ue997t+5qc9KkKZtuvLDku8UWm0+5917R8t///vf3ve99I0eN2mCDd99xxx3irq989cBDDjviyX//u29E39SXpv7X296Wje3jH/voMUcfceDBhzz62GPZe0X6ml52++AD9y41btzZ55wblXnmmWem3DNl990XfplZ7PXGG2906aWXDd4ritLHn/DNgf7+mTNf79wqSZIFCxZcfc21uy26dFlkwtt98pOX/OznPbsQ2fjBBx0wd86cW2+9PUIxpTdNyTfQKLNuLdbiZTZWWzsDAEDoJHNgyTlB6TLKrFcSvtKuaM8O3OyibXn7WVGvfgg6B3YbfL/1zt642mpvfOMb7540SebBEyeu8tLUqa+/vjjle+Jf/0pXVp04sfP2fz7xxOLHr7zy8ssvL9LOwRZmvDqjq82bb77l6KOOEA/bZOON/t/3F/5BrMlT7t1sk41Fojtjxqv33ne/uOVTn9r14AMPfOGF5195Zdq4cUv19/V1NTJh6aW//a0Tn3/xxbza7zXXXnf4EUeNW2rczTdff9dddz/22F/EjQvmL4gWvgaGHcZFfyd8Qbp+xRW/Pe7rx55w0sk77bi9SMsf+dOfBh+2ztvXPuzwI975jnee+D//85e//E0k50s2X+hnP/vF7669SqTNm226yXPPPvvHPz641557dPZy/R+uS1dEefzAgw4VxfMIxQw/2ow7WkjXJZf6sbqrPksGrb8DAAC4J/lmbNhF6TLKrEu3HSsubckG7m7SUZuecxgn+9A5c6pV7EUUXhh2wpRXgFUnvBu9Z8NTTzl58J+jR4167dXXxMqCBfNHLfnbVKNGj+5blHM+88yzyy+33NixY9Pb11hzzXTl2Wef67x9lVVWTleeef45kbKu8871115n3fS/jTbevCsAkTr+4x//eP/737fGGmvcdvvCQugdd9y57nrrbrjhu6dMWXjd7OpvfOPx3zjuK/sfsN0OO+/z2c/9/e89Utw5s2fvuMunxPKsM88ouEJY5JmXXPKzz+zzaZEJi38+/eyzc+bMedOb1hx8wMSJE8Vdf/vb39N//v4Pf5g3b97737f1B97/gWuv+11nU7+54srrr7/xrLPP+evf/nbG6aeJSm/nvU89/fTke+7Zc4/dd95pxyuuvCobSfpHsMR/W733/YN/PQslen7qKflfdkPJpZ2gu3Ygb6m0M1FZ0HZ2AAAANyTfjJX+k2y2wvBd74rt3fJb9hjZb71ulYTgTRFYZjP7X4F+8OFHlllm6a/st+8bVl312GOPnjt37qOL6pyPPfbnjd/znh22327MmDGHH3ZwsujXkydPmfL0008fc9QRAwMDory5z957po3ce//9s2bNPvZrR4vbRQ65286Lr9GddPfk/zz91Ne+trD0Ktr5wfcv+NaJJ2RjuHvy5M999jMPPfTwtGnTF/Uyedlll/ngBz+Qfv959pzZ8+cvGDtmYXa97TYf3HKr7hRahDZz5kyRRe/3lQPe8ua3HHPMkQX7++MLfyKW//3fn4kWpc033XTzAQfsn17ouzDT/ubX//znv4qm0gfPmzf/ut//bq899njLW9b6zeVXdLYzfvz4aOHHBAtEHXjVVSceecThXR39+jeXb/fJT6y99n9dfsUVEazoulQmMr5gJsqsuwo6kotJdWeyXQAAEDrJN/KeswHJzV1K1JeJ8ZSmpXMBJ/lwXH8mHGgO7EpnAtwjaI39ePzxxw859PBtPrTNddf8dt13vPOrBxz00ksviduvvuZa8d+3Tz7p0l/+7KEHH35t0debRb63/wEHL7PsslMm3fmzS35y8cU/TRsRmeSBBx08fvwEcfvPf3rR9TfeONj+/gccNHbsUtdde9V990yaP2/+D390YTaGu+68e6213jR5yuK/kyzSzvvuvf+Nq61266KC8HPPPf/dM88688zT//ynhz/96U/ff/8fu/c6Xvw15ieefPLgww7bfbfdPvmJj+ftr0iVL/npTz/96b3SIvAJJ550++13HHvsMQ8+cM9ZZ373iSeePOTQwzof/+tfX7HxxhvdceedL700tWeDL7zw4uFHHb3nHnu8d+thlzffeOPN8+bNvfGmm9OsHqZcfFwaZdaN4utaN/8EuLSpbNcAAIRO8o08VnljlWy2wvAj9XlBnLP3pcsos95M2SNlobmaNP/ZGhSX3RyP6B9d8ODOm9Z+92YvPFP+t45d2GrLLc8447SNN9k8AmxYceLqf33w3khVrHV9jqcDTpBBAwAgp/O9rOD9LhV7V/HUmG+gOhYOd03PWAVfWLDbhWZrSeHNNf8V6AI/+fEPP7PP3qNGj95ss033/+p+kxf9fBFgTaz+X6S7tBBr8TLOrJvvDAAA4Yoz6+ZvoFF1b6Aa8w2l/yLd3WKOsFBsfiA4kDUaTIC9exbOv+B7H95224ceuPfHP/z+yy+/fNw3vxkBFvW8MEbjIpmKYo3UL1uS3BkAANojyazLv7FG9b+xSoYfye2Kxm4xdxhimgbHNSRg7ju0fCWwk9YGvwId5z5kiRq/Ag3YtfAr0A+pfwXaubjsG06phM8NAQDwRiLxDh5gAfry8gAAEABJREFU4sjXsNXo73/lR85xh95/C7o/AuAL1x/AKr2PAQDQDBVkb/Lv4OGItZYmwk6h0/3X2Qf9Lf0kisCJ13uTJsBMdgGfWUxWq3kHAwDAH7be+7LfxipIpCmJqit9EgI4okZpcFX7F9aL0260C1sbUXAnAD+Ufq7c9V/pJlFmHQCAtknkll1vrwlvsrWJc/7zjmZYFe6N4348+E3ggghUvgLtdy0bUODpi9niNcAyn3DzMRcAoM2oDDdF17PkywHWrAZX9RJp70tRIQGeN29eX1///PnzIiBk4mUsXsyRj1wUby0m1QAAhC5xcz1w9j2aynB9sjOaOo+6ThrchNzU5pXAlo9Hf89Zb8+J8KzXXx0YOWr+TBJghE28jGfNfC3ynWTiKtlURDUYAAB7Vd9OVH29V3+JuLPkoLCB40gb/srM2b14RCRtxitTB0aNiYDAiZfxjFdejnxXWg3u+q90kyizDgAAUjIl3CTnv4g338DUef2wWpfuA3TZgwdXAvek8BXoaVOfX3HV1UX1bO6c2REQJvEC7u8fmP7Ki96UPKn0AgBQu+x7ZQWV4XAkkdRlziHuYuezWlHYasXdhldp69AXjxjI3pp3fs+fN2/p5VaaHcDXR4Hexi+9wovPPTV75uuyG8TSA33XG4MvLCbYAAA0SSBfXdZOPsmcVFVaFlboxnFQQRSBbQbZIwEuaF6kvqNGj1lqwrJzZknnD4A3xi+zwszXZkx9/plhX30p/i9SWUaZdTWlfcSZdfMdAACgnWy94UZu33BjuZC1w9felQbPI7qOicNunD1aTWOfy547ppYAC69Of1mkwCKRWDB/3oL58yMgBAMjR4na78xXZzz31BNDt8aZT0kllz4KMmgAAPwTYGmVyrA7bjNhtaaZz1kRj+jv/rtWMkd26eVWWnHV1efNmzt39sy5c2bz20jwU19fv0h9B0aN6e8feOHZ/0x/+cXIC8Fn2wAAoIxSVuo37a9hN5X9HZRt0eWhdda2td9D0mknu013Aqw03V56+ZXGL7386LFL9ff3e/tnvtBeSTJv3rxZM1+fMW3q9KllqW/w1WClHQAAAJ0CzOoSxRlL45PS6lk+pM3NgWtNgLObGSXAXU1F5hxm0U5alm7Uau/tzF808rswcr1G7QwAAO3WuKovCXapOtJgd7XayBE7ObCdBLj7GmDdKbalqbmrBLgp2a/DKxBaI/hEWmMHAACAHirDKGN5fi7VlrNJnuezRzvh2aoA+5wANyL7bU8uE3yCmofEFQCA1mpcZbhznQR7kLWdbVwd2KfLgIdVgBv6/Wf7zVaa/cYu9gAZDakMk1QDAKBBMqvzCZVeD1mbt9dbB3ag1j8X1dX3sAow5V+rjVrKfpEKPkHNQ+IKAEAjNaLSS4Ktx87RSCw8wlnX6k36UgS2UgFuVwJcUfYbu4gdikN5KshKL8kzAADmqAxDi52ZfGzhEchodgU45Oy3tYJPUPNI7gwAAGieABPpPJK7QoKdsrD7ddWBbbfqYQXYYAJuY+7enPKvWaexi6iRoy3VYAAAIE8pWfUjwyMp9ZaFuX1TZnTeXAY8VAFuXAIcZvaLTsEnqHlIXAEAaJVAEuk8JNjmTI9JYnS3m07V27PSoGYjg5uZV4AtTda9T4Cdf/mZrMcdjUTaL43K/gEACFOAmZ924koSa53jOVqbpoDGJXXjCrCfCXBo5d+Wpy3BJ6h5GrUzAADABsmsNAQk2KqM9jr8IrAflwH7UQFuQvmX7DdAQX7FOvvuQYINAIAjSlldfbQTUVTMaHYWG93tg9iLGBdXgGvO3oIv/5L9uqGRoPqLxBUAgNYKPCslwbbLWR24NUVgo8uAF1eA6yz/Rr4nwA7Lv2Q61QgykSZhBgDAWwFmgXxF2R/O5m6tmRSaVdLNKsAeJsBkvwEKMkHNQ+IKAAAkBZhI5yHBVqV/BKq/GNhekx5cBuxBBbid5V9yn7poJNv156ok1QAA1C6QZDU7h2lEft1A7Zy1eXAZ8MIKsEEUDU+AyX5rEGSCmif4HQAAALYFnpWSYNtldDWr7t22u1NszEpr+gduYQW4zvJv5O/3n11lv5HdMJFDI5H2S5BBAwDQPqWZX+CVYZJYH8VGd9vurg76IfVHqBiZS6qCBDWWXtpkcWeqCxoAAOiSeb+Wee92nInG0iGbhN+5LplgtxyHonJ1V4B9/f6zq/IvmUvtNBLv+guuwQQKAEBzBZLVkYgGR3P6VnER2J66LwM2uQbYtwTY5qGMDe+3t1HrBJmg5iFxBQAAXQLPSkmwHdG/plXrPtt9KbZU22XAC68BHrHor0CrszRf9zIBdlL+JcGpmEYiXT8SZgAAgtP0yjBJbDUcTO6aPl/U2T+xTdy36HeAtba1wb8EmOy3IgoJKocPAADAb0MJdhLKZwI+0ixqGtxtryOVlmw1pdNOrX8Ey9fvP6MKSc9lnHO7mSCrwQAAAPZUUPVNBjfOzuUSy7M71MDe5xYiDUxqexHwV6CHofxbuXjxwnWCGksvAQAAmkd1LiQzL+qcm5XM4uLhCXZCDtybTo5Zso29tLUhSIAdI6fqIXNQEsVlV2Ndn1aWJs9+VXpLdyDlV9AAAKAXpTKrHwwrw0lmXWYWl8Q5TYCE1blarwEO7wJgyr964qH/u670Vkcj8wYAAJARYCKdRznBJvnTe24Tzfvs9aLYkpWmdBqp9a9AW0uAq8l+I+WO2pv4xMP/qykE+fzUx1yVpBoAgCC0o9JbHQ+mkbWzvd/22mvCM6JXAfYq+408TYDbdcKa7W2QCWoeElcAAKAhkEQ6T0UJdiBHwwq1fU2M7rbXkUpL9RSB9SrAfP/ZQnOB8+bDuVil0pui0gsAAJxrVmXYl/C9mYJ6h6Mhiz+C5UYDX4FWPvVQGV6Vmu1az1tmH6/P+g4UBw0AAMJi8v6e/eTeWSYaay3lua0Mx5nOGiRu2g55ggqwfBMqvTQhcwn8AzZHybZbwQQKAAB6sZ/hWQ4tKgvTp5DVBT59dYnDMagB1wBbK+cZ3a/7WJ9UG3eQCWoeElcAAGBIMkP1lXaCXWmIAbJ3JbB3lwG36xrgBl8AHFiyE+aHZNlPJQNLpEmYAQBovAAT2sZWhlPBznubKq5n32qqAAeWADey/FtVoEEmqHkkd4AkFgAA2KKUlfrH68pwIBm8pSKwdxXgyEoRmAqwkyYaVv4N7XMvPcEk3tmPUgP+hAAAgHYLJFlteKVXXiCzYksxMpVMaVSAbRw6EuDaeBNiMAmqDBJXAABgUSCJdCevK72lvE/xFQKs4DJgryrAkWo8GhVgrxJgn77/7Hua06DCr1LR1Mc8lIQZAIBWCaTM2t7KsPfzZIXoKtiRsCerdVSAKf/WoL7ggkxQ85C4AgCAikmWVn0VWGXY7yNp46FNLAL7XwFuZALsb+7ToMJvT7FKNTgVQDU4RVINAEC4Asj2ItUw/c61bfB45sys0JL+CEWCfqH5F7yjanCcWc9bZh+vz/oOuAoUAADUIZZeFnOcPKuGqTo9CTLBTncy3Fzfl+PoJyrAxU2EW/5tXO4UN7LSq5cwAwCAcDlOaG2RL1p4Gb4NXhaTYCzoa4BdZ7+RbBd+vRY9iEZpuPQdiSsAAPBQ4JloSJVhnw6pbCzhXAbc/GuAKf86FLcxHwuyMhxMoAAAQFcgZdOQEtG6+DTHlg0knDlkXHWoXAPcGCG8yh1VhuPMet4y+3h9holrdYECAIA6xNLLYo6zUtUwVacnzUmwvQ4O8lQrwMYzcirATrQgU4pDrPR2CiZQAADgUiBZoHzRwptitntM2Pyk9ryoXgPcqATYQvYb+XAi+HcqKg2Xvgt+BwAAQBMFnokGXBmuOxSF/hPlOxTYOw7VXgbc6gowCXATBJNsx2UlbAAA0FRK2V59Ak5KAVlcA2yG7LdUBQlqLL00ZbgDcWHQAACgqWxNVhwn0qphyodcSfhVqTvKMI6Sv8KtAFtox0IFmAS4MhUk0vYFEygAAKgDlWGEK9SpbLjXADtNgEP5/rNPL7sgE9Q8JK4AAMBzkqVVXwVfGa41IOPLgC1Fb6sZrgGWaygyY6H8G1k4HmbIxAJKvEmqAQBARKUXPmjz1JNrgA2Q/cqoIEGNpZf6O9C5rr0D9oMDAAChMZkPKGWotkPLhikfciXhV6vWWEM6UN6hAqx+p+KjnGlZ1lRBIm0z0M51TwMFAAB1CyQjpDKMBqn2GuAwfgMpiO8/+5c7BZOgyiBxBQAAAQkwK21IZbi+sLy4DNje7pteBuztNcAkwNa0LwfTKKz6Ug0mkQYAAIOo+gJ1ogKsco/6o9zwPnFqfjU4RRILAADqQtXXE/4XgakAD6NUATae63uTAMfadyo+yo1GJ11BVno7kTADAAANgSS0VIabolmzUoW94a9Ad/H/leBThI4qvXFmPW+Zfbw+6zvgKlAAANBEtiY9jsupsfQyyqzLUEqwveBdQBn+R1ipQCvAdX//ObJwMHS1NYmKQ6wMSwYKAADaIztZ8TLDo9KLckHOZqkAayH7Ldb8ynBKZgdkAgUAAO2hOqHJ47hU6qLSK5n72wi/WjXFGtIh8ggVYOl71B/lQAuyprjBld76AwUAAL4KJCOkMozAUQEOiH+5U/MrvfI7UF2gAACgiVRLrnkcJ89UhnvzNCxktbECbFr+jSwcCS3tTp8cJds1BAoAAJDVlKovfBQr3Np0Sr8DbHaIAvgNJL7/bCDOfN2lNAf0Nx8kiQUAAAEJMEOVL2wEk2DXFKJst4nR1orNarVk2JTs5hVWgEmAjbQm6VIaCusPtHOdhBkAAFgRSEaoFGYYSawJpnxh4BpgKKqg0htLL00ZJq6xdNAAAADybE2GHCfPqmHKh9y57v3nAAgLFWC5e9QfZVvr86jAKsOeBgcAAHzVlEov4DcqwLAkDr0yXLoDSk1FdoMDAABN56jSayNDdTEHU7r6lwQb9oRYATZthwqw15SGwvoD7Vz3KDgAABCybMUg/MowSWwzhTfpbV0F2DT7RfCV3q6eTDLsuDBoAAAAPcVzDCuVYXthys/ZDEN2uSst0PtgtfAQtq4CbCEBriG7aWtCpTT8eR0oAABAMaq+DcCsLwBcA6yIV3UeqsFFSwAAgGJxZt1R1dcsK3VX9Y2qCL+BOCCK5CvAxvP4ZlSA60lnmp5EBVPp7WQxywcAAMgTSEZIZRg1k51+UwGGhOyA1d5Kb1dTke5HnQAAADLsllkLslKXYZqE3LlOUg1jVIAl7lF/lG1tTaiCqQx7HRwAAAiN42TVBJVeBI4KMCxpZmU4xTXAAACgSibzCsdZqbtKL0k1KjEigu8CyaCSsmWSWe+6UXLpikzQkVxwjMoAAMAWyUmSzLwqyqzXFKZ8yOHNsyh++C7u6x8j+cjIkJ2vQNf6/eeolpe0Z2dR6edzqcS7wJeQ3AEAAIAmScpKq/7Jzi3DqAxXHodCh4nCrW4iyG/DvBGpFoK7BjNDmqEAABAASURBVJgEuOmyA5mnuSqJNAAAqIBniatkUhpCfo12qqoCzF/A0udxKkU1GAAAwF8hlU0XU0qqPU2w64hJtk+PK8CReRHYqwowCbC+hqZhsfQA59EBIGEGAAA1UsoO6wjN+zAB/go0JDiq9MbSS1MWE1e3gQIAAOQzmTxJZqhmoZmHmacJlWF4gQpw2T3qj7KqfWlVdvCKbSfeNgMtDQ4AAMAEld7gMA/0GhVgGIilBz6NImvnevGnhvqDjGHQMsEBAACYMJlvOCiVUulF4KgAl92j/iirmptKxeqV3nqUBgoAAFANj0uuVIYRCCrAkOBJpVeflUpvXqAAAADVMCm5SmaoZqGZh5mHyjAsoQJcdo/6o6xqR4oVh1UN9jQ4AADQRFR9AZuoAEMR1eCiJQAAgF22yqmBVH1JquEYFeCye9QfZU/jcqo4lEpvp2ACBQAAbeJxRkgSyxTRY1SAkaMhld7OdcOgXQUKAACgroIyq1loMmFSGUblqACX3aP+KHtak18FUxn2OjgAANBEjpPVykIjKYUfqABDkaNkVf6TQlOGQbsNDgAAYDhbk6RaK73ZxxeHWRqyjfDRTlSAy+5Rf5Q9jcupHCXPbhUE51egAACgTTwuuVIZhseoACNHQyq9neuGQet9jAmghfJmdibree0DaC2TkqtShqobmnmYGiHbCB/NRgW47B71R1nS9ORKI8Gup+BaGigAAEA1HCeu5qFJJqWtSFCZJXqKCrC0Nr+GNZJVyWa71s0/HcztySTo4kABAACqoTp5yuOs6iuzjDLrxWFKhtyKpDpfy3dfhWQF2Hii34AKcNXJTlOSq2AqvZ0kAwUAAPCBg4TWFirDqI7ULH1EBAyS/1Qxlv4vyqxHNj4RlN2ZnkGX7kAkFyiAQPUeceIe67HSeixxu+pSpn259aJ9BxC4gnlL6X+R25lZLLeM1UOuJHw0DxXgsntUHmJV00/WmGuAAQAAlCh9J7iO0Kj0wntcAwwJGsmqZLNd664+wDMMujhQAK2VN5urch1Aq6hOnvI4SJ5j6WWUWS8OUzJkhkbIoQJcdo/KQ+xpaGYlmYfWX1iVDBQAAMAHDhJaW1pdGWbS6COuAUaO0g/w4sx66X+lzUaZdcs7IBl0JBcoAM/1Hll0r6EdWvd5qb5fRccKQCAK5i2l/0VuZ2ax3DJWD7mS8NE8VIDL7lF5iD0tOFNj6U8Eaz4Ysc+lagAA0FYel1OVqr5AtSqpAFvLflGh7Cdntj60K/24Lu8DPMs7YBJotgsAAVEa4HKXsQfr6iMpgxjQGAWnfFw24ck+LLI1AysJLSoLTWlGJjPUISCVpI2VVIBt7olRU7HGPSoPsadBZ20cdKXXl+AAAADkNOV6YMAN/go0OkjmgHp/7Vn+Qzt9hkms2+AAOCIqosmSGdOS9YVnfXZdepmOGnnrPi+L41dY5h3DoaPOLBXwlMl8xnFWGksv5Skl1QxdaFUF2Kj8G5keA0WVdlYPpTmdd4Gm6g8OAAC0lWfZXnaKJJmUolKxwq0NxV+B9pB/r8DSD+rizHrpf5HKUj/oqCxovUCzXQDwUOk4ILVUvC43lrg9Vny8agzayyizDsBbBadzXDbhyT4sMp2BxXKhRWWhFYdcuswGUzOPQkGKCnAk22Z1r95mnSdx0JVeX4IDAACQ41nJlcowPMM1wOjgKFlV/dDO4Q6Ubh65Cw6AsaGZkcG1vmkroV/rq7pUvjY479gOX+98LgB4wmQ+4yArjaVD05t2KSXVZruCZqACHMm2WV0SVF1PVVOar3kdKAAAgD8cJK7m4ZSGVneYaKewKsAkHhXKflpmJR908clfbk95gVINBhqgfJCSr2Q2qBqcuy+qx6RslsqMFfCKybzFQVYaS4emGmZpyDbCh7qQjnhYFWCjdmKNe1QeYk+lnTmhNF/zRUFwfgUKwBt5CWGV6wDQxePskCTWKaarcuK+/jEyD4tMkAArqPyVm51TBZCsdgoyaAAF4sLf9VW8vtfVMlXvel48NpYWrxkGEKhAstIwkuqqepXqJ9HfVL1Z9WYM2ynfnApw1PYEuEqdg47XeavXwQEAAAznWbIqmZSm/Mup0Wz8FWjkcJSsxpn1vKWpuKxGUrp55C44AFqUBqa8yuTiSmbHepuX2WNSeg1w7NEkG8BiJvMWB+d1rBiafJilITMsoQwV4EiqWVt74FNPDnUOOqXDU/28Dg5ATeKc8oQHSavUjC9vHUDjeZwdSiaxKYYuuME1wFHbE2CleV3Kr9xQMmgAHuo9AHl13W8qrHWXS83rgSNmtUB4PEue82gMgvVE6U8/if6m6s2qN2PYTvnmVICjtifArmXnPEozzaoDLQ0OQAvlJW/FA1ze7apL1RgAtJxniav2UAe4QQU48ikB9inL8jpZzUMSCzRD77NY4ndrs1VKluZLhd8TZlYLBK70XPZDdi4awPBTSRBSnST6m6o3q96MYTvlm1MBjkiA7ZPMQ+vPSSUDBdAA2dlQxcuU+e3Wl3nHB0ADeJwdag9RgJm2VICNst/I9ABIq6ib7j7DSFbzBBk00FrFVVxH1/emVNebRO846C41rhNeiN8NBjwTYFYqOZClqg6/ks5kO0mMtlZpU70Zw3bKN29LBZgE2AteJ9uSwQFosLyZkUEyWMOyeF8ANF7p+OBNOCHk1GgeKsAkwDmUZly+CCZQAItkZz1Fy5yKcbbq6OMyZX573cvF0XWsK/1ucPZ5B+CV0vPXD0EOOZUEIdtJYrS1SpvqzRi2U745FWASYAeUZoJ1kgwUQKCyMyCLy5TMugnVvizuY+dxAxAoj89xhiLUhApw6xNgjfmeXyQnpgBq4/l1v23mPo1W+K1grgEGPBNgVqqUVNcQnD+dUAEuRwIcVaKJ87FgEmwSaaB5shO1CpapatatLPOOFYBAKZ3vVYVTGlr9CSraggowCfDw/sNIVjtlB3RPAwWwSO9hpfbf9U2ZrFepxnRZYqnxu8EpZr5A7SRHDp9IDk/1qyQI2U4So61V2lRvxrCd8s2pAJMAW5Kdw5TONOvhdXAApDlKe5sqb38Nj2GKxBUIgmfZocZQBNhABbiVCbDG/NAvQQYNNF6v33QdqvhZvNY31bYU1gf20miuDQbCEmBW6l1STQVYshkqwMMbinSRANemc3DxOm+VnGYD8JzSoGOebtc1PthLRUtmhX5PcAH04Nl5rTFEAS5RASYBHt6/6pywfqWTXQC1632eFl/327HuaplSXfeZ3n65XBY/18x8Ad9IjhA+kRyS6ldJELKdJEZbq7Sp3oxhO+WbUwEmAbakc3DRmHVWHWhpcAA8pDTQ+DLoRMMjlr+9EhZTYwCe8+z81RhyABuoALcyAdZIVv0SZNBA40lc95u9Blh2mZJZhzsW0+XOKrHKNcDMgoFaBJKVep1UUwGWbIYK8PCGIl0kwLXRmNV6FxwAD2knXCnO8ZRZ6roYSSngLc8SV8kENcXQAjeoALc+Ac4ONIHNG0liAX/0HlBq+Y3fFKOAvLzjJjlfVVwWvza8mawDrRbI+agxDNUWqD+dUAEuRwIcVSLkeVows1GvgwOwSD2pbue8SG89O78yTxdl2pdfN6a9BwBqJznS1Bda5HuYaAYqwCTAw/uvaJ5pkWTQACpQnvrVWAFmRMiSOVYunh0qwEAIAjkfJYeeVJ3hV9KxbCeJ0dYqbao3Y9hO+eZUgEmALdGYmXoUaKr+4AAsYpjqGvVqsp4317J1u/m6MY2E10EUAHSUnqf1URpOADNUgFuZAGvMLf0SWLhAwxT/tV6nf+05bHkTuGZN7LLPncqy8zWj9NehATgVYIbqXchUgCWboQI8vKFIFwlwpbxOsDtHOy8CApBRep7Kp881UM1zVW+vnEZKm/JvQgy0jndZYBChodmoALc+AVaaZ/oomECBhuo9ZDi91jflUcrbGsXH38Yyya/0kmADFQskQ9UYjGoL1J9OqACXIwGOKhHa/E1jxuppoABqYZj2KveUt96GpcxxyK5LC2YGCmAR7xNahhA4QwW4NQlwdnZTOs/0S5BBA40hfa2vbKU3FcbZK581VrmUj80/6rub96ob9ppMG+faYMCxQLLS7JuN5LjqMCD3ZDtJjLZWaVO9GcN2yjenAtyaBLhKSpPCOnkXEIBFlJKjVA3nb958STU/Vc1ha51mas8oa40aaC8vMr/ucEpDSzFswA0qwK1PgDWSVb/yxGACBRqk98CRc92mWjorP/xwhlev+Lmwsex8zfR4XdU5cQdaJ5AMVWMwqi1QfzqhAlyOBDiqRMhzOcnZK8EBbWeY9ir3JLPe5mXx8dESzGwUaDHPzkfJYSPFsAEzVIBbkwBnBw5Xc05HJIMGYNHQwFHB7/3WT2mc9HaZty8+0UiRO5b8PjBQr9IByA/a46fDgNyT7SQx2lqlTfVmDNsp35wKcGsS4Cp5PfOVDA5ABZTmJimH56lM/uhPnls8f4urzn+zz5FkpAAq49n5qD2oAWaoALc+AdaYf9YvmECBBul9xln/vd+Uj0OOzLqLpWoMdcs+jzaW2ddbwe8DA7CudJDyg9K4WkNw/nSSGG2t0qZ6M4btlG9OBbj1CbCJYGayBcEBqIBGCqzcukZPLpYpd7fXssw7zoq0ewNgndL56HFoDBVQRwW4NQmw2/lnBeKyKSIACxr1e7/F2VvFy5T87ZUti49VtdQPicLvAwOwRGlA8YPSeOgwCPdkO0mMtlZpU70Zw3bKN6cC3JoEuEoBzIhLgwPgSHaSVPVgIZP31ZWNmi9V99EByTTWcRQAupWej96Ew1ABl6gAtz4BVppb+SKYQIHAZWcf3csKfu+3zt3NW/d5WRx/tbLPqe6y8zWWfe0VHAgAVgRyrimNkzUE508nidHWKm2qN2PYTvnmVIBbnwCb0JjVehooAOvcDhDFuV4Fy1Tx7a7Xa1lmj7kWpd4AWOf+LHcRGsMDbKAC3JoEODumlc7s/FI6BQVgQaN+71dp3LO1zO5woBlwHdR3MXtdesE1wPXtGNAong0ceTTGTOcBuSfbSWK0tUqb6s0YtlO+ORXg1iTArnUOHJITxHpIzlgBWKSRQVrrVSOCVi3zjpUDShEBsE5pJKgqnNLQGB5gGxXgVibA2bGuirmoodKgAVjR+1zLqQzrp16pes5epTGw8cvsMXFPY96bs+zx+szfSQDaJM/aumkMLpUG508nidHWKm2qN2PYTvnmVIBbmQCbyE6YCpapOme4pcEBsMj+oKA05Jgss5HVP4ypK47f6TKVt64Ydc2zVKBlPDvvNAYvQAUV4NYkwJKzP78EGTQQHCvX/abq/Lyrc11jmd2B+ndMXQUZcKraSad6mAW/D1zHDgCNVTpY+EFyPEy5Cr+SYyLbSWK0tUqb6s0YtlO+ORXg1iTArilNQFN1zpQ9CghoKI1BwUmvkhGwdD8P9GIGCrSYZ+ed9sAEmKEC3PoEuHS48VEwgQIB6j0cZH5pe6JYAAAQAElEQVTvN4RrgPPmdU5zx+yOma87XRYfKzfs7WL29cmsGXBBaUCpj+Tgkqo65Eo6k+0kMdpapU31ZgzbKd+cCnDrE2ATGhNB74IDYCg7mzA974rzMkfLVP1DlxmZfZGcH6ouU8ZzS6UeAFhRet55Ew5DAmygAtyaBFhjJli/YAIFAjR0NhX+hWdfrwHOToAMl1XvQLXy9lHjWKWqnYCqh1lwDXDdk3ugUUoHCz8ojW8Og3BPtpPEaGuVNtWbMWynfHMqwK1JgF3TmGh6FBwAK7JZkavzrjgXs7hMmax3krndfN3pMu+YG1DqGYAVnp1rDAOoEBXgVibAGrO/+gUTKBCg3mdW5rpfnWXK7VmazcYsLqvYAXvyYjY8Din3E1CzkId9c6FsZwBoC+T8UhrfKgrIn04So61V2lRvxrCd8s2pALcyATahMXH0KNBU/cEBgctmRToDQV5u5ShvrTMhN193o/j4WFka7JZSDwC0eXx+MQzAASrAjU6ANWaLfgkyaMBbnb+DWvh7v0XX/aaSKsfFrsxJY1l10GHKHiulZaqOpL1sWXI98PDfBwagxINBQZXSmGa5Y/dkO0mMtlZpU70Zw3bKN6cC3OgEuEpKk9R6gvMoIKCh3J5reVMq7bw4kY5YZr2TrZFFpn31hNBombI6vZXcAwAWeXCuaQxegA1UgFuZAGvM/uoXTKBAgHqfWe26BjgbaOhDi8bkUmYZRsg17QDQCoGcXx6MaZmA/OkkMdpapU31ZgzbKd+cCnArE2ATShPNOnkdHBA4O+dXdjiRbD2RjqDqxFtmZ0xuz67bkz1uVpYG4UtGBMCQZ+eXxmAEqKAC3OgEOFaZUfooyKABb+X83m/2GuC6E8vhQXucATeX9azXdmgqYWavb+caYMCWQLJSyYEj5Sr8So6JbCeJ0dYqbao3Y9hO+eZUgBudAFfJ61zV6+CAwNk/v/LmISYZWUFenFSWLxfvWPHjzRTvr5Wl/G4pRirZGwAlnp1fnPqoEBXg1iTASrPIlF+5YTCBAoEYOptyKsOmiaWrkLvD9zDQcFjMhv0Nrcfr3FXQQCtUOBCYUBq7qgi/kuMj20litLVKm+rNGLZTvjkV4NYkwLZ4PbmUDA6ABjvnV3a+YbhM2TnDrQdXyzJvX2zIHnOLYdroGYAGj88vpQEFkEMFuNEJcOmQkfIrN8xOjWKNSTaAJYbOIK+v+y099UMax5rLfaarEU7eeq8lvwkMuBNIhlrb2FXJcZDtJDHaWqVN9WYM2ynfnApwoxPgKmlMWD0KDoASpWzVQuuSPenly/qjQHGg1azLUU8UlZc2wuwZtWTPAJR4dk5xuqNCVIBbmQBrzBDrJxk0AElDZ1Bg1wBrLKsILnzZY6W09CycjmWP1/nwoN3sANBYFQ4EJmoauwoD8qeTxGhrlTbVmzFsp3xzKsCtTIBNaEw6PQoUgDY7J3w27TBcpuyc4daD82qZ3Ud12WNeRziOdxJoHaWzltAQPCrAjU6ANWaRfgkmUMBjQ2eQdqU35fYM1M6lqggOSxhmwO7DKQuN3wQG7JIcFHxS03hV0XGQ7SQx2lqlTfVmDNsp35wKcKMTYNc0JqlVB1cQKAAlkueU5vlV2rrq0iiangFZDM7pMhuzuuwxtBiOVmhKvQFQ4tk5xekOx6gAtyYBzs4+SmeOvggmUMB7vc8m7677VRqvqgio3bLHVmnpJgTdcIa95u0HCrSC5FlYN43BwnlA7sl2khhtrdKmejOG7ZRvTgW4NQmwCaXJaJ28Dg4IkJ1zSjufzfakfyZbCaI4IJlATW7XmMzJLLPHR53F0BTDKW0JgBLPzinJwSXFqQ85VIAblwBnBwKlCVz9JIMGkCvnWt/Ar/utIiDo0s50XYZTFhrXAwN21XTCq6rww8FMx+7JdpIYba3Spnozhu2Ub04FuHEJcF28y1uzo1fNAQGBc5uhKn12lziKxnoQtS+z+yUnewwthqAeTqTYG4BSkme5l+FwusMMFeDWJMDZgSO2O3N0LZhAAY/1Pu07ql5q6U3K/hmoNF5lA4JdhtmwmxB0w8m+5q0GCrRCIBmq9qd0DgNyT7aTxGhrlTbVmzFsp3xzKsCtSYBtqW1GbDE4AJLsnOTZOYbGUrlXWx0XB1HX0GIvI7QyEbQegmLPVncGaDV7Z6frcOoODeGiAtzoBFhjMlc/yaAB5OIaYFRNIwNOuZm8qifeXAMMmAskQ61tjKrkOMh2khhtrdKmejOG7ZRvTgW40Qmwa15PWCWDA1AgOwuweR6Vti6zTKlFY6Vj+YDcrVtZqrAYQvapsB0FAEmenUcOxi6gExXg1iTA2RlH6QSufsEECnhs6KzJqQyb5ne2w6wxCKjQyIZT9iavZgl5j/PCZnBAKwSSoSqNUQ6DcE+2k8Roa5U21ZsxbKd8cyrArUmATWhMTD0NFEAp/fMom+NoLFP6Z2xtHfsnu19Ky5TZpDAxeELUQ3C8M0AreHweKQ0cQD4qwI1LgLNjVOmEzy8tmZkCjnRXtDKV3qKqb8r+maadGSN02lmv7RDKwsm7Wj4Zfk4BKBBIVio3KDgIv5LjINtJYrS1SpvqzRi2U745FeDGJcBV8noiy8waMOf2PNLOi7MRqEWj3Vlxxy6GFpm+DPel85ioh1NJt6URFfQAoJRn55HSIAKoowLcmgQ4O+NQmtjVQzJQAAWGzhrvrgFWGpc49X2jkQ2n7E1ezZLwHueFzeCAVvA4Q9UeoxwG5J5sJ4nR1iptqjdj2E755lSAW5MA2+L1xNTr4IBA6J9HsW4+m21d7YytreNwaEwEs5NC9QmiWYKq2q1SqwB68uzckRy7UpzikEMFuHEJsNJEMOXXhE8yaABdhs4Ui5Vem6F1hxnQuARd2lmvjW7z1nstS64Bthkc0FiOT2xbHH/wV9ixe7KdJEZbq7Sp3oxhO+WbUwFuXAJcJa8nssysAXN2ziOl/NfmcKLdcbazUIYN9czPynxV7zm1Mc90sDNA63h27rgfONByVIBbkwBrTP7qF0yggGd6nzUdFS33yad+mJzuAcq+UCqfvJrl+6WBAugpkHNHaVxyGIR7sp0kRlurtKnejGE75ZtTAW5NAmyittmxfHAFgQIoJXmS524p2YrNIUS7Y53Omit7TCQniOqTRbMEVbXb0pYA9CR5ptYXmuRgAeSjAty4BFhpUugjZqyAjpzrfsuvAU7ZP7sME1Q0j+ME214IJb8DzG8CAzlqOrFNKI1LFjpzT7aTxGhrlTbVmzFsp3xzKsCNS4Cr5PWk1ruAgEDYP3e0c2HTRN15B37L7pfSMiU3+UsMnlnFrvR6BlDAs3OH0xqOUQFuTQKcnWWUTgTrF0yggGd6nzXa1wC7Outq6xguuc96u7rKW1dZMssG9Hh87mgMCs4Dck+2k8Roa5U21ZsxbKd8cyrArUmATQQzSfUuICAQdk7sbF6jNGyonbGGnSGlPUFUnyyaJaiq3Za2BKAnpTOS0BAkKsCNS4CVJoUpvyaFwQQKeCXsa4BdBQGfSGbAKTcTWbn5c8k1wK6CA4IXSFaq/cGfhY7dk+0kMdpapU31ZgzbKd+cCnDjEmDXgpnUFgQEoIDkiS3VimSLpkOIdmftpDH5U5kIWmlerquePdtuFWg+z84djUEEUEEFuDUJsLWZZpWYsQJ6hs6azHW/RdVgV0NCdh4V2FgEXe6zXpNuO5bZ88VZcECjKJ3k9ZFMqp0H4Z5sJ4nR1iptqjdj2E755lSAW5MAm/B6wioZHIAu+ueOUj5rc9hQ6linAyyh8aSqN2/YVWG3kj0AKODZuWNvgEDLUQFuXAKsMQOtXzCBAl7Rvu7XVZ6YnXxU1DFC4zjBLu5WJYTS64EBDJI8w3xS4fhT0b7LdpIYba3Spnozhu2Ub04FuHEJcJW8nuAy4wb0SJ7Yyi1Ktq5zxip1INtoOzhIRNWTzB7Ny3WltzMAunh2vrgfLNByVIBbkwBrzDrrF0yggGeGzhSuAUadKpzImiXe2fOFWTYgo/TE9oPSWOQwCPdkO0mMtlZpU70Zw3bKN6cC3JoE2ITSPKKe4DrXaw4ICISdk1kxzTDLc0mkK6PxpFbSfN56Tg+lvQEo4Nm542AsQjtRAW5cAqwxQfQLM1lA3tCZwjXACIl21mujW5UQuAYYkFfhyWxCfSCw17F7sp0kRlurtKnejGE75ZtTAW5cAuyaxgS36uA8CggIhJ1zR2l4MM2LnTTabg4mhRpNZpuX66pnz1pBA60jeaZ6Fg6nNXRRAW5NAiw5QaxfdtrjaaCAZ4bOlJy/Dl1fzqjRMZqnwomsWeLd4zyyGRzQWI5PbBOSg0LKVciVHAfZThKjrVXaVG/GsJ3yzakAtyYBVlWah7qaKesFymwaUKV/7igND6ZDhUYHsEsjm3TcvGJXtc12gcBZOskrCIfTGiqoADcuAQ5yshhMoIBXCiu9RVXflP2zK8jxB3VTmtTa7rYshLyr65lZA8UqPJlNVDr+VLLvsp0kRlurtKnejGE75ZtTAW5cAlwlyQluPZNdZtyAPPvZauecQSMvLu/VSaPtJpcRKk0KE8Unqus1k11X3BmtoIHWUTojaw2n7tDQDFSAW5MAa0wW6xdAiIA3ep8vXAMMXyhNaivpKmcuPezcsR8c0ChyZ1XtKhx/CoNwT7aTxGhrlTbVmzFsp3xzKsCtSYBNVDpT1guuIFAAPUme2LlbSrai3LpqmJzurmXHeeNJpEaTBtNqey0B7WJwklccTt2hISxUgBuXACvNTH0UTKBA7bSvAXZ1dpGsQkOFk1r1xJvfAQbkBZihVhpyJfsu20litLVKm+rNGLZTvjkV4MYlwK55nWAz4wb0FJwvCueO0vCg05PG+MOprydRfAoT2SadNS+/AymtVoHms3cWGoZQGk4doaEZqAA3OgHWmCzWrzRoAD0NnSkd1Sq1NCNl50zT6BjtUeGkVn0u3aPq6yo4oFE8Pl8kB4KUq5ArOQ6ynSRGW6u0qd6MYTvlm1MBbnQCbEIjea5nIsvMGpBn53xxnlQHM/60T6L49CtOY7Sbl+7KUqBAK3h2vkgmsZzWKEMFuHEJcJCTRcmgAUSdZ0fOL5RWe0bF6skq0KmmSa1ct9nr6rkeGJARSFYqOf5Y68w92U6oAJcjAY4qEcL0UGOyW8/El9k3IM/OCaw0POgMG8GMP+HTePLymzFsMtaZVSkGCrSawUleezic1lBHBbg1CbDGDLR+XgcHeGboTCn869A2ElH5cLpD47RuMclsOGU2qTVLvHucRzaDAxpF6cSuj+QQ4DwI92Q7SYy2VmlTvRnDdso3pwLcmgTYhPOZcgXBAYgkslI7rZgOFUodyDYKG9SzSckmnTUvvwMAunh2vigNCpzWyEcFuHEJsMZstH7BBAp4RbvSm7J/dnEqQ4NkBpyyN6mV6zbvSnuSZyBL6WT2g1JSbaEz92Q7SYy2VmlTvRnDdso3pwLcuATY0Elj8QAAEABJREFUtexExKPJLrNvQJ7980W1dqfck5NGUcbSBFFyauwg/zUIGmgdz84XS+MP0IkKcKMT4OysIYDJYjCBAh7ofZKH8TvANjtDaNxnvV1dKXXbsWTGDcgL5HxxPOYUduyebCeJ0dYqbao3Y9hO+eZUgBudAJsIJnn2OjjAM/rni9KQYJrnanSA6kk+Rw6aNJivWgoUaAXPzpfsm4rV8QftQQW4cQlwkJPFIIMGapFz3W/5NcAp+2eUkwwYbVXTpFauW34HGJAXSFYqmVSnTMOvZN+pAFMBltiycQmwa9mBwKOJr2RAALrYOV+UhgedoUKjUZiTPOZyzSg1qdK8m6CBVpA8Oz0Lh1MZuqgAtyYBtjYDda1zJGNWC8gbOlO0rwG2eaZV2hlC43hSa5Zsd547DoIDGkXybKubF2FWchxkO0mMtlZpU70Zw3bKN6cC3JoE2ITXyTMza0CenfNFMZ1QPxs7JyKc4t6SfOLlmlFqMtu8XFeRUaBA63h2vrgZFNBCVIAblwA7mY26FkyggAeGzg4vfgc4yDEHvlKa4NroSqVbfgcYkOf4BLalwjGnon2X7SQx2lqlTfVmDNsp35wKcOMSYNe8nuwy+wbk2TlfOucGGsNDeU9KHcC10gmi3GQxUXy1KDavGjSAQZ6dL0oDBCCHCnCjE2CN2Wj9ggkU8EDvM0WpGmzz7NJIVjmt2yn7GnA2wdXoqmM57JyyExDQWA5OYBccjzmFHbsn20litLVKm+rNGLZTvjkV4EYnwCY0JrL1YGYNyNM/XxTTBrOz0esxB0tIZpYpuQmlWbIq01Xp1gAGeXa+aAwQQC9UgBuXAAc5cQwyaKAW/A4wmsxepuugW34HGJAXSFYqmVSnTMOvZN+pAFMBltiycQmwa9mBwKOJr2RAACIX54vS8KAzVHg35rSDpQmiRvHG0pTZTatAM3lwvmgMFoAKKsCtSYCDmTiWTqEBDOp9vmj/DnDKzpkWzJiDOihNas0muGaJNzNuQJ7H54vkQOA8CPdkO0mMtlZpU70Zw3bKN6cC3JoE2ITXE1nJ4ABEts4X50m1RgeonuRz5KDJbPPSXVkKFGgFz84XN4MCWogKcOMS4CAnjsEECnhg6Oww/B1g2+FwKsOY0gTXRlcq3fI7wIA8xyewLRWOORXtu2wnidHWKm2qN2PYTvnmVIAblwC75vVkl9k3IM/O+dI5N9AYHsp78nrMaR9Lk8VE8Ynteo3ZCxpAF8/OF0tjDtCJCnCjE+AgJ47BBAp4oPeZEtLvAKOdOl8DFU5w1RPvYeeU/YCARnF8AttS4ZiT6dg92U4So61V2lRvxrCd8s2pADc6ATYRzES2IKD6gwM8o3++KKYNZmej12MOlpBMYlNyE0qNvFixq9KtAQzy7HzRGCCAXqgANy4BDnLiGGTQQC34HWA0mb1M10G3/A4wIC+QrFQyqU6Zhl/JvlMBpgIssWXjEmDXsgOBRxNfyYAARC7OF6XhQWeo4BSvhaUJokbxxtKU2U2rQDN5cL5oDBaACirArUmArc1AXSudQgMY1Pt84XeA4TulSa3ZBNcs8WbGDcjz+HyRHAicB+GebCeJ0dYqbao3Y9hO+eZUgFuTAJvweiIrGRyAyNb54jyp1ugA1ZN8jhw0mW1euitLgQKt4Nn54mZQQAtRAW5cAhzkxDGYQAEPDJ0d/A4wmkZpgmujK5Vu+R1gQJ7jE9iWCsecivZdtpPEaGuVNtWbMWynfHMqwI1LgF3zerLL7BuQZ+d86ZwbaAwP5T15Pea0j6XJYqL4xHa9xuwFDaCLZ+eLpTEH6EQFuNEJcJATx2ACBTzQ+0wJ6XeAOa3bKfsacDbB1eiqYznsnLITENBYDk5gFxyPOYUduyfbSWK0tUqb6s0YtlO+ORXgRifAJjQmsvVgZg3I0z9fFNMGs7PR6zEHS0hmlim5CaVZsirTVenWAAZ5dr5oDBBAL1SAG5cABzlxDDJooBb8DjCazF6m66BbfgcYkBdIViqZVKdMw69k36kAUwGW2LJxCbBr2YHAo4mvZEAAIhfni9LwoDNUaDQKc5LHXK4ZpSZVmtfrDUDk3fmiMVgAKqgAtyYBtjYDda1zJGNWC8gbOlO0fwfY5plWaWcIjeNJbd7bmly3neeOg+CARpE8w+rmRZiVHAfZThKjrVXaVG/GsJ3yzakAtyYBNuF18szMGpBn53xxnlR3TkQ4xb2ink26aDLbvFxXkVGgQOt4dr64GRTQQlSAG5cAO5mNuhZMoIAHhs4Ow98BtnN2kazCogontXKJd+c5xe8AA/JKT2Y/KCXVFjpzT7aTxGhrlTbVmzFsp3xzKsCNS4Bd83qyy+wbkGf/fNH4/E2tJyeNooxcpriY3GQxUXy1KDYv3xuALp6dL0oDBCCHCnCjE+DY52Q1TzCBAh7ofZJrXwNsE8kqCrjPeru6Uuq2Y8mMG5AXyPmiNP5Y7tg92U4So61V2lRvxrCd8s2pADc6ATYRTPLsdXCAZ/TPF6UhwTTP1egA1XMwiVRPUBeT7spSoEAreHa+ZN9UrI4/aA8qwI1LgJ3MRl2TDBpAFN7vAHMqQ15Nk1q5bvkdYEBeIFmpZFKdMg2/kn2X7YQKcDkS4KgSIUwPswOBd8k2s29AlZ0TWGl40DlLNcYf6JGcFJbNaTWasTTndNMq0EySZ2q14bgcINByVIBbkwBbm4FWyevgAM8MnSnafx06e6bpn3UxySqGs5RUO+qqY9njPGLGDeSQPNvq5njMkQ7CPdlOEqOtVdpUb8awnfLNqQC3JgE24XymXEFwACKJrNROK6ZDhVIHso3CBqVJpNyE0ixZtbgDALp4dr44GH/QTlSAG5cAa0wcfRFMoIAnCiu9Xl4P7KpjhKymSa1c4p13pT2zbCBL7qzyitL4Y6Ez96gAUwGW2LJxCbBrXifY3gUEBMLO+aI0POjkxV6PP80iOY9VmSBqNKnSfM/ebLcKNJ8H54uD8QfoRAW40QlwkJPF0qAB9DR0phj+DrCdM02jY7RHhZNa9bl0j7/27Co4oFE8Pl8kB4KUq5ArOQ6ynSRGW6u0qd6MYTvlm1MBbnQCbEIjea5nIsvMGpBXemIrtKKxtBamL+NP+2g88XJNGjYv11VkFCjQOp6dLxqDBdALFeDGJcBBThYlgwYwjPZfe3YXEKcylElOalP2JrVy3RZcA8wsGygQSFaqNP5Y6Mw9KsBUgCW2bFwCXCWvk21m34A8+5mrfAVPc9jQaBTyJI9tKn+CKDm31G1ebwcAdHFzFroIp+7Q0AxUgFuTAAc5WQwgRMAbvc+X2n4HuDw0Tu6WUZrU2uhKqduO5bBzx35wQKMEkqFWOP4UBuGebCeJ0dYqbao3Y9hO+eZUgFuTAJuodKasF1xBoAB6kjyxc7eUbMV02NBoFHZpZJMOmjSYVhsECrSaZ+eOpfEHoALcuARYaWbqo2ACBWqXcw2wzvXAds604McfVMVBUu2m2x7X/Q7/HWAAgwLJUGsafyrad9lOEqOtVdpUb8awnfLNqQA3LgF2zesJrncBAYGwc+4oDQ+mCblGo5CnNCnMnyBqzDNVmtfbAQAFPDh3NAYOQAUV4NYkwMFMEOOyKTSAnobOFO2/Dq2TiKqFFtBYBNvcZ71dXSl127HscR6ZBgS0gscZquSgkHIVciXHQbaTxGhrlTbVmzFsp3zzuG9gbNct+Y8teITJnCU2vN/W9KzkBq1WOu7Qm/ExGQSWIIkCgFpIjr0AhiRl9yqeSJqnWJL7D32J4f1mgSS5/05kt4r7Ro6LFMXKKbDebDTWvlOjR/Ms3OThFTQEAAAAoBIVJZtKG2jFlGjfqXsQ1D4F0PijDCMiAAAAAABagAQYAAAAANAKJMAAAAAAgFYgAQYAAAAAtEJ/BAB1yP7igNIfeOaPPQNAvdR/Ymox/mg0gBqRAAOoR5JZl19mWwAAVI/RG0BwSIABuBVrVQmo9AJAoLJjOFViAP4gAQbaosavHMdayyizDgDwX3YMr2b8J9kGIIMEGGiL7NfP/PnSWo3JOQBAnpXqrtPwlJZRZh1A45EAAxhSe5W4c91dlQAAoMdWdVeV54k3gIDEfQNju27Jf2zBI0zGtNjwfiuz37j0Bq1Wch6Ulz5otgi0jlKmDgCQoZFlAugt6XWLzAkm3Z56GJZO2cTwfrNAktx/J7JbxX0jx0WKYuUUWG8GGmvfqdGjeRZu8vAKGgI6GVZ6AQDwAZVh+KqiZFNpA62YEu07dQ+C2qcAiXovfAUaaKMksy6/dEEjCSchB4B6aSecdpNP397RAHgu+xXogsf2WNPrVOnROQ9XayS28pBK2rDbkCXtrQsaVkpJ0lAdL16USmcMkFJKnTwIwX04QHbYVlq2QEB7X1cpWKcV9U4SyduUG9HYXLoZvgItuYGVpF0Dc0QAAAAgLHwFOtI9CBV8BXrBfImHxcO7URTbyuL024nL7kl0t7fKUhU67AIM9VRAh/hoMlly1qTrmWXdhWHJJZpEo4zlPpyy5bBzp/OcigAUqenEVlXbuFTJcZDtJDHaWqVN9WYsFYTzUQGW3IAKMAAAAAAZVIAj3YNABTg/DEtbNq4CXNB2Mnw9gApMMIECHhs6a3KqxDoFWjtnoNK4xKnvM8nnLmWvoqL66u2q9GbPC1eBAo1VesLXJ/umJTlGOQzIPSrAVIAtdRYpN2htfsZEDwAAAAiLvc/57G1ABThFBbjRFeBKSzm2SAYNIFdhpVe26puyf9ZR6W087aqLvQqMegil1/3aCw5orNKT3A81jUtUgKWboQKsdScVYAAAAAA1sfd5nr0NqACnqAA3ugLc1XZ4VZdgAgU8NnTWcA0wbMq+IEqXKXsVFY0QOqu+2fPCVaBAY5We8H5QGqMcBuEeFWCpCvDA2K5b8h9b8AiT+Yh58dXONKzkBq1WMnerzuYs7BrQQEqJU4rECQCKaX+oAaBb0usWmRNMuj31MOx99mh0v1kgSe6/pYvf/RF0KCWxXRv2XALtIJmsSjbVtV58enGqAUAx+XFVfgqjNOcnqUaTqU5cOpklzxgu7usfI/OwyEQIX4HW3t6q0GbosXoVzqPgACixf5IrDSGJdARq0VgPQiY4mdutL7P7my/veFYYQml0LnsA2qX0nKoqBMlwQj3FKwlatpPEaGuVNtWbMWynfHP+CJbkBooN6u2xy4YAAAAAVMJWNhgpSjTv09soMdhWY6uk523KvfBHsBbfk+hub1UI6a5GxcOj4AAosXNOZT+411im9M9kK0HYDEhOXl+S1RKZZecxya6rhGllqXWAbLQEYCHPzik3A0dNqABLNlNBBZivQJttb5XtbjyZwKnJzsJ6Bg2gwNB5pP2Xn1Nuz7rS09338QpLuM90JUNQCafgt39dBgo0VoUnvImaxigSYOlmKkiA+Qq01AaKDVqbnzHRAwAAAMJiKxuMFCWa9+ltlBhsq7FV0vM25V74CvTiexLd7aAt3YoAABAASURBVK1y2Y1GpaV+wQQKBGLoDPLuN4GzYXaHzJBQE/XSqtMqilk4VHoBc5JnYd00BgvnAblHBVgijL4RIwaicmbTCr4CLSuE6ZvXE1CvgwMCZOec6pxXqGZPca85jJ3dMgxIPlB361aW2WOizno4NnoGoMGzc0py3Etx6kMOX4GW3ECxQb09dtkQAAAAgErYKodGihLN+/Q2Sgy21dgq6Xmbci98BXrxPYnu9laFnO5WWr6xGBwADZInvFHrkj0l0tHoD0V5FQbrgSoti+ORU3x8LIZmrLQ3AEqqPYMlw5EMLVSV7IBsJ4nR1iptqjdj2E755vwVaLk2be2BH93ozBbrJxk0gALZyc3CpdfXA2fD9yigZjHMgFNuJqlmCXmP13nzZtZAhQI5jzwYuzIBuUcCLJUAD4ztuiX/sQWPMJlfxIb3W5ndxKU3aLWS8yCZWZtCiwAWIykCACXeJQlAMyS9bjH44EDz1Ety/6EvMbzfLJAk99+J7Fb9EXQoJbE9Ny9YAs2VnUhZT1ZlTi9ONQBIxdLLKLOeh6Qa6MFk/m+WPGM4vgIt12ZF0+XQZuUayUw9vAsICJyjTy+GtS7Zk+rSKLLSQGV2QOZ2+XUzecfE8DhbClOpNwBKJM94L8MJ9dSvJGjZThKjrVXaVG/GsJ3yzUmAW5MAK80oU0llOy4jmECBQAydTYFdA9wdvlZwDBspixmw+zB1lz1e51EjZtNATWoaCFQpjV1VhE8CLNlMBQkw1wD3bkKrTamNJGdqCi0CWMyLLA0AwiH5wUeKzwoAWUmvWww+ONA89ZLcf+hLDO83CyTJ/XciuxXXAOtRSmJ7bl6wBJorO5GynqzKnF6cagCQyo6N5uOnZ98gAPxgMv/n5LGJr0DLtVnRdDnkWbnSW513wQHQ5uiTjNyeJHtVXWajtBx9JYrjt75MWZ2CKfUMQJtn51crTv1KdkC2k8Roa5U21ZsxbKd8cxLgVibAGrPC+gUTKBCg3mdWxzWTNhPLqsL3MND6ZPdRe5lyMxm1F2ZNOwC0Qun55QelMa2igPzppNUJcN+IEQNRORLgqBIVdWMkO38onVDWw+vggMDZzyaVhpZEKwL7Z35ePlXlupniY2VlaRC+ZEQADHl2fmkMRoCKuG/kuEhR3HMKERduoSPWvlOjx9jwfrOHV9AQAAAAgErY+5zS3gZaMSXad+oehETpnkS9l/5owXyJh8XDu1EUQgU40d3eqpDTXY3SjEfBAbDC7bmWrSI6WqZU16ukF6f1ZcpqAaba3oD2Kj3XvAmn7tDsqWQHZDtJjLZWaVO9GcN2yjfnGmC5Niua4FQ1j9KY/dVPMmgAGnqfWYFdA1y0K1YzYJ8Vx6+9TLmfgNoLOfsabsgMGvBA6WDhB6XxraKA/Omk1Qkw1wC3MgE2oTTRrFNtU3GgBewPBNZzWB/z2bzJVn3zxuLjY2WZyluXiE6yBwDaPD6/GAbgQNw3MFb6sT3W9DpVenTOw9Uaia08pJI27DZkiZ0JbiiyEzXJZaqBRwTBMXwR1yOYQNFLILNU7awdqI+VD54ax+NxppulkOw0kxjdLbmFciuG+5Z0/b8UfwRLcgMrSbsG5nloNe08jg8mAEBVdswk6QJ01ZX3Jpr36W1kPaEu3qp3uq3cC9cAy7VZ0cS5jvm5ZPbgl2ACBQLUeziwcj1w1R9MWPkExXzH3K1bX2aPmxv2dqXzNZl9rSZV7AzQCkqDSH0kB5dU1SFX0plsJ4nR1iptqjdj2E755lwD3PoE2ITGRLDq4AoCBWCd5KCg3GLeusVlSmbdZ/L7Yn2Z0ppbSkan2CoAWaXnnTfhMCTABirArUmANWaCfgkmUCA4nRWzdD2zNE0gXe9A92TIcFnnzpgpjt/Ksr5dUVkOew13vrYjAKY8GyxkeBFyJcdEtpPEaGuVNtWbMWynfHMqwK1JgF3rHDgkJ5dVB+dRQEALaGScRj3lrXuyTMnfXvuy+NgaU4oCgBWSo45n4TAkwLbsX4EuTxXjgvu0YjC836z3vCa02owlp0AGcQGNl51xWzylAAAmlHIokha0l95LP/+k0jyVktx/6EsM7zcLJMn9dyK7Vd+Ivq4KMAlwzg1arUhsUDyjZ4IP6FIqeAFAe0iOjSmSWECf0idGqAjXAMu1WdH82GU3kgmAX8kAWQtQBelrgPWvB3a9AwrfGlBdZnfGhzGzOB4ry1R9iZD6buW9eoe9tiMApiTPTp8ohewq/EqOiWwnidHWKm2qN2PYTvnmXAPcmgS4St7NjjWCA2BRdmZR5wDhNF/2dpm379l1q7SjA2Bd6TnoTTgMD3CJCnDrE2ClOZQvggkUCFx29tFZSRtal6wMyw8zdX4+lrceyrJ4X6qVfU5t7FaP12H+FgCsCORcUxpQagjOn04So61V2lRvxrCd8s2pALc+ATahMav1NFAA1mUzMFfnoFJPrpep4ttV12tf5h1nRZJ7ZtADAFken4NKAxOgjgpwaxLg7JhWOoPzS5BBAwEaOrMKK70h/D5wdrfy1tu8zB6TamVfGyrLkut+69wxoLFKBxQ/aAwuzgNyT7aTxGhrlTbVmzFsp3zzuG/kuEhR3HPqEhduoSPWvlOjx9jwfrOHV9AQAAAAgErYygYjRYnmfXobJQbbamyV9LxNuZf+aMF8iYfFw7tRFEIFONHd3qo60t3Sz8NSiVfJuGTQACyyXBkOb8iRWa9yKR9bfTQKMHmV3rzXXtlBAWBF6WDkB8lBJ1V1+FSAJZtxXgHmGmC5NiuaiFXUjTXBzGQlAwXgiEYKrNy6Rk8+LFMexpZ3bBVp7CWACiid/d6E5lOYCBfXALcmAXY7/6xAXDZ1BGCZ9O8Dlw8nPn4m1rnehmXevtdNPUXOfuOg5zXAKT92EmiU0oHGP0rjpMMg3JPtJDHaWqVN9WYM2ynfnApwaxLgKilNy+oJriBQALXwd+CQyR+L1/PyUNXb5dcroZ661hUpgIVqy/yUw6k7NDQbFeDWJ8Cl+aDvuWEwgQIN0nuYaOzvA9uSN5kLc5Knkf4qpsg9XlfMjoEKBZKhagxGtQXqTyeJ0dYqbao3QwV4eEORLhJg57yevUoGB6BiGimwcusy621eFh8fLdo9A3AqOyErODc9Do1hA2bivoGxXbfkP7bgEflbScRgeL9Z73lNyLfZcRbGdiZtwxsHWib7JheX5UQJ5woAVIJEBZCi99LPP8ESvQ8pktx/6EsM7zcLJMn9dyK7Vd+Ivq4KMAlwzg1arShunJ31R5YSaQC9kGwDaADt0j8AO5Q+GULNuAZYrs2K5rt1TKs1EgBfBBMo0Di9B46c32gd/Oza8u8Dc7ZXr/i5sLEsfi0lvV57ABwJ5NMUjcGotkD96SQx2lqlTfVmDNsp35xrgFufAJvoPQf2MCf1OjigxTQGEQvnbF4KpRRNcEv5fdeiHRGAWnh2bmaHecmBDFBHBbg1CXB24KhinmlR6Q4AcGroHLTy+8DFQ04YZ7VqZuli3W/Fz2/ZUuH3fof/9i8ApzxLnvOovhU5D7+S4yPbSWK0tUqb6s0YtlO+ORXg1iTAddGY+XoXHIAaxWUffvk4uIRPe+YYTnYOtEJt2V5ROJKhMZzADSrAJMDD+w9vPkkSC/ij95lYeG2wq2WKUUBP3jG09xx1vgZ6vE58mawDrRbI+Sg59KTqDJ8KsGQzVICHNxTpIgF2TmNm6mmgAGqXna3UmermzZ3k1/PmYMVzM5N1q7LHWWkJwBMen6cMJ6gQFeBWJsBKsxcfBRk00FBDZ1/OtcGLq3zW/wo0/JH3HKk/1wXX+na+xlLMiIHKBJiVepdUUwGWbMZ5BTjuGxjbdUv+YwseYTIhiQ3vtzIdiktv0GpFV+eUjwQPqETnGyHZGADPSX7SkOKzAsCt7Om3wPKJp9lSkvsPfYnh/WaBJLn/TmS36o/giuQMumDzgiXQbhqlQ8lmu9aLT0FORwB1cTFeaZTvASxkMm/nBKsaX4GWa7OiaW7Is2lHCUlFgabqDw5AhtLgUul5HecU2Kpcz4vHmEYmlJ20WY0IgCmPEy2loSVUfAVaspkKvgJNAmy2vVUVdaMzh/RLkEEDDTU0K5H+fWA7vxWMeuU9L+rpssLv/ZJUAzUJMCtVSqqr2BUSYMlmnCfA/BXoVibAVcoOLp7mrUy5gXApDTSqy1Qo44C9tLSmGSIAY0rndVXheBka2okKMAnw8P5V54T1i8smvgBqV56gZn4fuHO9imVKZr1TXaOMTDyOUmHFZfb55fd+AZ9Jnt8+CSbkSoKQ7SQx2lqlTfVmDNsp35wKMAmwJZ2Di8ZM06NAAQRBadDRS3ubxGI6nCJZBYLjWXaoPfwAZqgAtz4B9jpZLVYaNIAaDZ2VFV8b3IZ01jWL6XJnNTjvWt/s64TZLuCBALNSyQErVXX4VIAlm6ECPLyhSBcJcG00ZrIeBZqqPzgAWrIzHYvLlMl6J712rC+zxw1AcJTOd0JD61ABJgEe3n8YyWqn7KTN00ABLFI+xORUjJ0kfF0jhcl6Jxe3m6+7XA6r7uY9jxGzXcB3kiOHTySHqvpVEoRsJ4nR1iptqjdj2E755lSASYAt6RxcNGaaHgUKIDhKA5DMMlX/gKXOUQqcIlkFguZZdqgxRAE29Ecj+iJFcc9JQFy4hY5Y+06NHmPD+80eXkFDgAkr6UWKjxkAAJ0MP6pJkR/BM7bKoZGiRPO+RWLVjRL9YHS2SnreptxL3DcwVvqxPda0WEkm1RqJrTykkjbsNhQgyTQKUkhWAQvyZtnFnwzl3W4+u5dZB9qNpLoOpUe0nerKhHVaUe8kkbxNuRGNzaWb4RpguTYrSgJ8yjU0sqX6BRMogIzy4SbnmtL0EZ3rLN0ts8e89PpeJsFAQAI5f4MccioJSLaTxGhrlTbVm7GUD+fjGmASYAeU5lNeBwqgMTpnQ9n1CpYp+dsrW2aPCYDG8Dg7VBqiAHuoALc+Ac7OfwLLB4MMGkC08PyMC/5isMXfClZNT4vXO9U1ysjEI79uY5n3rOU+v0tCYIYLeCuQrFRjUKstUH86SYy2VmlTvRnDdso3pwLc+gTYtc6BRmMGWnWgpcEBaKHsQJa3XuWyOB4AreVZ5qc9pAFuUAEmAc7hdbKahyQWaIbeiWVZRTGOKqwYN32ZdwxLjn/kyYQbgKZAzuXsXLQgZF/CryQI2U4So61V2lRvxrCd8s2pAJMAO6A0z/I6UACNlzdLCiRRVVgW7y+ARvI4odUeugAzVIBbnwAHk6zmCTJoANHC83PoWlDF64HtV3pTLtY7mdxuvm5jmT3mJcvhz+lCw68BBuAtj5PnPEpJdQ3B+dNJYrS1SpvqzRi2U745FeDWJ8BVCibZ9jo4AACA4UqzvWozP41P4ICq9EdAT9kxszQflMkNY+mlnR3QTmLdBgdAi9LAJP+7wW24Zjh33wuPleSMldkrUDuZeUveHMZBVhpLhyY/vSJMGMk8AAAQAElEQVSphiVUgOXatLUHfnRTKaU5mneBpuoPDoCX8pLAKtcBoIvHGSGfrcEDXAPc+gQ4O9CUJqj+5oNeZ9gAtMQFFV3Fa4P5i9DFS6nre/OeC2avQCMoZah+UAq5zvAr6Vi2k8Roa5U21ZsxbKd887hv5LhIUdwzkYgLt9ARa9+p0WNseL/ZwytoCAAAAEAlbGWDkaJE8z69jRKDbTW2SnreptxLf7RgvsTD4uHdKAqhApzobm+VT+lu9tOygqWPggwagBalAUumkplXEa23QqtXxV28Lr3v/K4v0DZBVXo710uXfqECLNmM8wow1wDLtVlRulRRN5WSzEPrz0m9Dg4AAECOxxmhZBKb4jM3uMFfgW697EBjPVmNC5dRZl2f5A4UbB65Cw6AIWe/G9yGa4OL911hmXfMIwC+kJl45ZEcV8xCkw/TYsg2wkczUAGWa7OiDKiibrygNFR5F2iq/uAAAEBbeZztkYjCYyMioFSsspT8T6lZ/aAjN4FmuwDgudIxIXcZS9xe17pMnHIjLIMbEBzJ0zzOn97EcuNDtaEpzchkhjRgOCrAcm1WdBY18WSNOz7hi+UqvfUUVksDBQAA8FN2IuVZNbg0tLrDRHtQAUaHWGUp+V+k8tFdlFm3vAMmgQIIQtyxNnQKF69rLWPj9dhSO9n1HstIeb37eDIYAh7LnqryE6FIbuk4tNIwsyFXEj6ahwqwXJsVnTltOkFjrgEGAADQVlpCjbkGGMiiAgwJkh/URXIf2il9XGfnQ4+CoPUCzXYBIFBx4XrRssprg2X6lRtJGcSAxig45eOyCU+kMm5YDS0qC81KyAxvyEcFWK7Nis6iJp6ssfo1wPUoDRQAAMBPXAMMyKICDAnZT9TkP8yLVD66c0Um6NJAAbRWLL3uYhlprQNoFcnhSGZOVlNoBWFKhswQCDlUgKkAV6j0M7+Up9f9Ug0GAAB+8ricqlT19SNkNBsVYOSIVZaS/5U2FWXWHe6AeaAAGiDuWMuuxw1a795fBjSgQfQmPKXTHsehZcM0D9l2+GgeKsBybVZ0FrXpZI3Vrw2u8/eBS4MDAACoEtf6Ajr6I6BULD2QKeWDcWa9+AM8ow9ATIKWCQ4ABuXN7OKc7/nJPB4AupjMTxxkpfLzOtUwS0O2ET7aoz8a0Rcpinu+YOPCLXTE2ndq9Bgb3m/28AoaAtosVvnCgY9fRACAfBo5QsxlmIBbls4h5WYSzfsWiVU3SvSD0dkq6Xmbci9x38BY6cf2WNNiJZlUayS28pBK2rDbkAfalUqQaAE1iwuLrCxVsx8yIUCX9dOxcVqy93VlwjqtqHeSSN6m3IjG5tLNxH39Y2QeFpngGmBZFXXjHY3s0NNAAQAA3ClNGuujlNm3USU7L9tJYrS1SpvqzVjKh/NxDTAUOUpWY+ml8x0o3TxyFxwAAEA+k3mI46zU1lyuczpGUg0H+CvQVIBrIpmH1l9YNUyYAQAAXPC+Gty53vhvOiMcVICRIzswWU9WZT4dpOoLAADQg6NqsI1EOlYM02LINsJHs1EBpgLsAaXhzOtAAQAA3PG+6ktSCu9RAYYiR8lqLL10vgOlm0fuggMAAMjnqOrrPjS96RJJNRygAkwFuEKdg5RhHlqdYAIFAABt4n01uHO9IEySWFSLCjByaCSr8gXUznXzTwfLGSax1QUKAAAgx2k12CwrVZ3vyYfcuU5lGFqoAFMB9kwsPajVfLS8Dg4AADSF95VeElEEhQowDFisDHc1K7nUDzpS2YGCpiK7wQEAAAznqNJrI0N1MWdTCpkEG+qoAFMBrolGHkrVFwAAtJrHJdfsnM3LMAEqwJAQSw9kGpXezvXiTw3tJJiGGbZMoAAAAC6YlFwrqQabhxnVEz7agwowFWDPOEq2awgUAADAnMfZHkkpAkQFGIo6BzLJHNCva4C7ejJJYt0GBwAAYDbfqKTqa3fOxjXAcIwKMBXgmlSQSNsnGSgAAIALHmeE2Tmbs7wbMEEFGBJi6YFMo9LbuV78qaHDqm+Kqi8AAPCZyYTJcfIsP6+roDIM5KMCTAXYMzGVYQAA0HIeZ3t8RRmBowIMA46SVflPELOP10dlGAAAeMKkhOo4eVYNTWYqlJ12kVTDmbhvYGzXLfmPLXiEySw/NrzfSo4Rl96g1YqxuPAuqo5AmGKVD498/wYE0D6Sk3Um8UAT6H2IYPv01mwvyf2HvsTwfrNAktx/J7JbUQGuV+n7ZFy2ecESgK4KEtE4s666zLYDoBp1nb/ayTYAfSbzbU5OH8V9/WNkHhaZ4BpgWcxkh48JjhIP+yQDBQAAkOHxVwj4poOmSg6EbCeJ0dYqbao3Y9hO+eZUgGHAUbKa/XS8+EM3OwmmlaCLAwUAAJBhMgFynJW6+KZDdtpFUg1n+CvQVIA9IPM5YuxbMTWYQAEAQMgCyQgl53IpkljUhwowFDlKVlU/TTTdgc51R0EDAACYc1QNzmalLsOUDzmqJ3y0BxVgKsAeK81V9b6t7JbXwQEAAF95XDbNTme8DBOQQQUYljhKVrOfFJp/mqi5A0pNRXaDAwAATWde6e1ct1oqdTEfkwzZRvhAJyrAVIA9E0sPgl5UejvXPQ0UAACEJpCMkMQVAaICDEWOKr1dXUguTRkmrrF00AAAAPJMJkMVZqUu5mxK4dvbFbQHFWAqwB6rINm2TzJQAACATh6XULNzLZJSBIsKMCxxlKzGmfXiTxaNPiRR3YGCpqKyQAEAADqZzB8cV31dzMckk2ob4QOdqABTAfZMLD0IenS0ggkUAACEIJCMkMQVAaICDEWxm0pvVxeSS1MWd8BtoAAAoE1MJkMVZqUu5mxcAwzHqABTAQ5EBYl3bYECAIB28riEKv+NvFrDBFRRAYYDSsOlUrNd68WfMhp9YGKSYasGCgAA2smkhOo4K421lvJIqlETKsBUgD0Th1LpzRNMoAAAwCeBZIR8RRmBowIMA46S1TizXvwpo52kUnIHJJuK3AUKAACayLwa3LnuLHlWDVNm+qMUPkk1zFABpgIcCEfJtluSgQIAgHbyONuTv5wtqTNMQBUVYDigNFwqNdu1bv6Jo1Sv5uXs4kABAEA7mUxoHGelsdZSHkk1akIFmAqwZ+IQK72dJIMGAADo5HE1uBPXACNwVIBhwFGyGmfWiz9ltFnp7VzXTlxlggYAAOhkXg3uXHdWTlWtBstMf7gGGBWiAkwFOEAynztqJN5uSQYKAACazeMMTzIRtZ1TA1WiAgzHNJJVyWYll1FmXWcHOtcdBQ0AANrA40pvLB2m/BSGpBqeoQJMBTgQjhJpV4F2rnsaKAAAqFsgGSHX/aJBqADDEo28z3XVV59h4hpLBw0AANrMZHJTYfKsGqZ8ZVhpCdhABZgKcICUhsuUL5Xh0kABAECzeV/p7VwnKUXjxH0DY7tuyX9swSNMpu+x4f1Wkoe49AatVozFw0cXEiegEZS+McFnJoBv8j5g1TiXAYRE/sS2fXprtpfk/kNfYni/WSBJ7r8T2a36RvR1VYBJgHNu0GrFmEaLJMxA61lMsPPWAd8YJqLZpJQEFWg+pUEBDRH39Y+ReVhkgq9Aywp5aqk04U75O5kOfgcAAEDTBZ68aX84FapKdkC2k8Roa5U21ZsxbKd8c64BJgEOXJCJt2SgAACgGTz+ykHrElG0HX8FGhVSGl6Vmu1az1tmH295B1IyOyATKAAAaAaTCYrjrDTWWsrj0gN4hgowFeBAxCFWejtJBg0AAJotkCyQxBUNRQUYDgRf6e3qtTjzVmoqKgsaAAA0m3k1uHPdajVYPky9eZdk+LZ3BehEBZgKcOBK81MfK8OSgQIAgHBVmKyaULr6l6QU4WvLX4GODHNgEmArlIZX35HEAgCACgT+/WO+Sr1YJTsm1Umiv6l6s+rNGLZTvnlbKsARCXDogqz0diJhBgAAUTClVRJXNBTXAMMBR5XeOLOet8w+Xp9G5l3QVFQWNAAAaDaT+YBSVuoyTL15V7ZQUcmuAJ2oAEc+VYAr7amBNBLv+ouvkoECAICweJzVkYhWjSPoESrAqIlGsirZrOQyyqzr7EDnuvYOyAQKAADC4nGlN5YOUzXkSsIHTFABjqgAh81RIu1WMIECAABdkhlhyqfKsGTiShKLMFEBhmOxeqHUddVXn8UdcBsoAACoW5xZL37fz5sDVFhOVZ1TURlGgKgAR1SAm6OCZNu+0qABAEAoAsnwJJPSFEkpmoUKMGoSS79HaFSDO9fNP7mU6tVkB4qDBgAAoVAtoeZxnJW6mC9R6UUgqABHnlWAq+4seI4SabeCKU8DAABdAWaBXAPsBIfJL1SA5ZCJaMsOlNbzvlh6aZNhtm3r41YAAOCnQKrBJiHLh9+5HtRnAiHh0MmhAhzJNltdMkLaY0MFibd9wQQKAACWCCSrk//GHIkoGo0KMDygNBwrNdu1bv4pplSvVIYBAGgP1bJpHseZaKy1lMfXpxEIKsARFeCwxSqVXr1E2q1gAgUAAGWy39jyvrRK4oqWoQKMCtVe6dX7RDO3V/nMu7SpyF2gAACgKvKTkmJKWamNkOXnTvLhd65XsiuADCrAkX8V4Ko7ayaN/JTKMAAAUBZI2VS+CEFSahPH0TtxX/8YmYdFJvxIgCPDHJgE2B2l4dh3JK4AAEBD4JkoX6XurcL9lOoq0d9Uq2X1ZgzbKd+8RRXgiAS4kZQqvT7moUo7AAAAfKaUBfqBxBUtwzXAqJCjBDXOrMssbTLcGfkdAAAAPrM1EakwE1UNWT78zvWgPhNAs1EBLrtH5SH2kO1YFYdYJVYKGgAAVCmQrI7qLpBBBRiecZSgZj+5lFmaojIMAEAjmUwmJMujdYRJdRctQAW47B6Vh9hDVmPMUSLtVlxW9U35FTQAAO0WVDW4c53EFa1UyV+BjmzlwCTADVKa64Wa9wWTbQMAAJ8EnonKFx7alWBXuJ9SXSX6m2q1rNiGeSPlLVRSAY5IgFWRJjmjNDT7gqQaAIDaSZZQUz5VfSUT0RYlpWg1rgGGZzQSVL3rgWWWpizugNtAAQBAmTizXvy+nPcerZSV2ghZfs4jM63gq9QIHBXgsntUHmIPWY2xChJptySDBgAA9Qok8yNxBRaRrAB7MuFm3t8gceYrN9YTVBefekr1aitxlQkaAADUy+T9WjIrtRdmJBGy3nRDvvBAgt1AnjydUmFIVoAj0zm3H38Imgow1BJvHwuuwQQKAED4KkxQbVFKPklE0T5cAwyPOUpQXX8Cmttrcead4npgAAD8IT9pKFZhSVR1biMffuc6CTaCFfcNjJV+bO4/NPq18VjlGGLD++31VFdbkFM6rqeouFpT+vGA6jLFswUA8orHT+1lijzIgQqTaqixd9htPoGJ5n2qG6m1ZbiHSc/VYnHfyHGRspwvNBfNLjVmnobpqgfpsf3pNhN4oE55k7kKknYSeMB/jhLI4mSSFAfwg+0TUae9qlJcjfB66gAAEABJREFUiTslH6GwSZJ3m3IvcV//GMlHRia4BlgZc103tLMWXyjtAAAAMKH00YQftD9NgX3VHlyp3hL9TdWbVW/GXkE4H9cAw2OOEtQ4sy6zNBXbS1zldwAAAJiwNVGoMJFWDVk+/M71oD4TADrxV6DL7lF5iFUkMPbEkXIinXj1DAQZNAAAzRJsNbhzncQVrUcFGB6IVYqjJlVfmWWUWdentGOlTUXVBA0AAHpRnUzkqbwaHFkNvxNft0aAqACX3aPyEKtIZqoVZJXYYoINAABSFSaoJqjuAlqoACMQGrleSFVi7cQ1G1Bx0AAAoJjqhCCP45KoJ9VdEmyEhgpw2T0qD7GKpMWNChJptzR2AAAA6Akw8yNxBQpRAYZnKkhQ5T8xzT5en8XEVXUHAACAHlul1Qoz0VhrKY8EG4GjAlx2j8pDrCKBqZbSUJ7ysTJcGjQAAMjKvsFT6QWaiQqwt0hahourqgzLLKPMuj6LiatM0AAAICv7Bm9S6e1cp9LbWhwRT1EBLrtH/VH2kLc4UEEi7ZbGDgAAAHlKSSyVYfiB51EaFWB4poIENc6sF39Kaj+RNExcVXcAAADIszVRqCmRjrWW8kiwEbiqKsCRrSJwqyrA9XQJtWE95WOVOLCgAQCoVoDZm2ROTfJZPw69uqSig0YFGAGKVarE8oXVri4kl1FmXZ/FxLW6oAEACJPqm32eCjPR2EH4nZR2xd5uAVVqVwU4MiwC15AvkKK4VEEiXZ0ggwYAwA+SpVWfaFeDSVzbK1G4tbmoACMQjhJU15+kSkVQTdkaAADkkZ8QFKswkTaZw1jcFRJshCa4CnBkGIlRBTiycBjUkb1ULg69Mhxk0AAAVEspq/MDiWgYKj/uNT/Rgb3OqAAjQBUkqNlPSWWWppR2rLQpySUAAO1k672ywkTaRaW3Ewk2WkC+AhyZTpepAGsiS6mEo0S6OhaTZwAA2qbCJNaWzrd0EldA+mVNBdh/ZCyLVJCgxtJLmywmrnFmvYodAAAgfMFWgyOt8OV3pXOdBFsKny74jgqwxD3qj7KNpKU+Svmpj0VWpR0AAKB5tDM5PySKMxDyL6BQ3Nc/Rv7BkQk/EuDIMAcmAfZN8AlqHhJXAAC8EnginYfqrmV1HCCpPhP9TbVaVm/GsB3ZzVtXAY4ME+DIvH8NZDjuNSqRJnkG/j975wIvyVHX+3/NmfN+7tk9+wpJYHmYIAlJyIZXNF4FCR+5IKDgx6sBAooJoCgiYCBekIgXARGT3eAHAgQ/9+PlIRdEjPIyECDZE24gC0mAGNi89r17ds/72bdmaqanZ2qmpx9VXVXdv+9ntrdOd091dXVPdX373w8AAOiKgxKb2MEhrjkGWzYmiABHmxJ/LtVAVAI4L6idgLgCAAAAzuGgSHcCgp0Wa8O/hAiwDyLA0abEn0s1EB5D5DAy3LXQEGwAAAB5ApFeAEADPAUaOE4GgsqkdJShShSKa5RCw34BAADkCVUH7wxFOk3fI/qqBNMQbFAYEAGONiX+XKqBk2RIApF2PuoLAAAAFIGI5mcrEFcAUoMIsCvAVQJkIKgs8pCktBoUimuUFQAAAACKgHzwThMNDqYzEWlEhq0GVeAGLkaAKWVJ0kaAKW1NJAW6YhMZSLhe5KNW1xUAAAAAXCGWvdmBF7N3AdsCZMNu4N6O6OJToCl9jzytA0OA7cd5Qe0ExBUAAADIjByZaOLoLoiKiSqLukwv1bfj55wop5RZRf16hhFgItwGnBooTeYk8E173TNXZwIAAACAaDhue4gMuwHqPR1edhWIe4CB42QgqExKdxrK86tB4YqZWQEAAADAHCzyMBxD9skSDaMDwQYFAxHgyFOSzqgayIkdMP3inR3OrwAAAAAQ097sMzmIqMMY2hjYBxKBCDDIKbEOIQI3IsMJzDtitpTNCgAAAAB6iBse7XRckzsHmZgoIr0AZAIiwJGnJJ1RA/CQDInlm8nc0wzOrwAAAADQmYgSK7Db9iCutoMadwxEgIHjxBJUgb5Ib7IzspFKEHclI2ZL2awAAAAAkC3RD97y/J0wJNKIDAOgFEcjwJSyMCzxxJhzaQOKYhOx/NT2IKvzKwAAAKBIOGhs8kn5iMWHfNqIE5tEXyGd3CMzfA8wWSTAod+PnLPJ/j/cIw5xz2s66XeQVQAAACAxEa3UNRL0f0A8zFVZjCV7McbGQ93qK3gNUtQcChoBJucF2Pzii04CkXY46iuASAMAALAZx8OpiAy7B+rdSWJFgMkmB4YAQ0Uk5INBLEF1D4grAAAAoJyIJipwxz4h2OoxWi95igBnGP6lmBFgggAnm1EbsBr7cD4yHOssggCCDQAAIEsQ6QU2gI3hKogAx5mSbl4NwDqiUYjIcAJxBQAAAIAglonaDQQ7I1wJ/xIiwC0gAhx/YqIZtQGZMYTzkd4gkGcAAAA5wHHD82L2LiCrJnGo9rGjtOLue4DRFwehZCCoLPKQpLQaFK6YXNDwlQEAAABsQ9XB2JB9skTD6CAyDBTj6m7hbgSYdAaBHYoAE7TEXuKex2X2R4kdXgEAAAAuY0hKVQH5zBV52CRF3q3cvQeYrBBgUlAlKoByREY+qOTc6SCrAAAAgE9EExW4Y58Q7OywoL7iFcGLMTYe6qoC9wBHz4vSkSMBJpiMSXIV6Q0ScQUg0gAAALLEccNLIKvyagEzYAPkAUSAE01MNKN+ICEdSCCl7jmdfLB32LwBAAAA/SQwUddAZFgl1tRIjIJ4sSfEABHgGHmo6n9DgGXgNjaRq8hwAsGGbAMAAEgDIr3AHrBJtOFlXbeZR4ApdwJMampFKbCOaCSQUlcjww6bNwAAAKCOnNpnAtkWQLa7Y9+JFRVzWxQBViPARYkAE4LAnYHMZAiLExx1SapjrRgAAACgj8SGZx+QVZdwusZdsF8TOB0BJghwN6AlVeJedOS80zlv3gAAAIB+CmCfCfo/oIatdRGjXI4IsPURYFLQY3ZGgClG/nBgEA6LE0x1L0qc8zMKAAAAdCIf8BDdBWbJs/3mkXgry3p6hzpNCv1e+ExperpMySzKe9us6wiluZuGhU6KbnIAAAAAAAAkI/0JEcs8UHFxvI5/aMg/8SzpiuaFjfJif5dTDv0CBKawBBW30yQ/HT4M4ny4EwAAAAAAxCGlxMbtbVLoeFAcOu4D5dCrrttOYsEpXowvBvNgMRcaMgtLnk/o91ume13zT6Ns2f1I45Yyd81HykuR3QMRewAAAAXHS3pdspt4MXs4UMUKLtSCouufVayquurK/AZgMnMPMJFVtwF3yyIHtwHLQHWMwhIdnKy+BziYRoQfAABALGJZmt3Gllg+IaLGKFa9Yy8jiv0UaCqeAFOMRTjWq4eEBChoZDjnKwkAAKCoxLJPN0ks26CGUzViUfiXVFYdIsDJ8qLUFFWACW6jl1xFeoPEOlsAAAAARCd47HA8bBpxVVxeRZdBtRaXBBFgUtCptUyAu+USZxGudvgLIyqFi/QGibiSEFcAAAB5ogDGmUC2BYUTbDfXNl6pvdgTYmNVBDh2DgkiwFQ8AaZ4S3HYHaA9mZNbIY+1YgKINwAA5JvElmYfSqK7IFOcrXdF9gt8chABJiWdZghwM/CQOgmk1D2PSyCrAAAAgA1ENFGBy9HdBIIN2a7gfhWoE2BFdaG0SgsUASYEgZ0AtqOOlJFel6K+sVYMAAAAyJHVITJsEbmoUOvsVymemUIZigATBNgtCqAruZXSTsQycgAAAMB+Etiny0Cw25Ov9bRRgBXmpCQrRIA15hJzKTm0BoiQBhAZhmwDAEBRiGVpuYv0CgokotmTu5rFrqIHRIBjZVTkIHCQIllKbqW0E5BVAAAADhHLPt0Ekd4u5HeFbQz/Ks0MEeCU2ZEKVAowqSqUtcB/4iCf/U0wdAmINAAAgBByGjaVT4jnbhVtItdVZunK5aHOk0WASUGftQgCTKrK5QSOr2osQRXkx90Kt8IAAADySMGMs4iR4cKcJEiyotlEgNXGktPnliSHZBFgyqsAR8gIQeCIwJTSkThibDuFPtMAAADFIEdmJh+OiiWcxkElRiQb+80J5iLARPm/DTjpN3KNy9WRUkrd9jjIKgAAAINENFGBm/aZQLYFeZBtOFoAe8O/SjMzdAMwmYwAExUlCEwKi5ZjilpHKaUaAAAAANmDyHBCILrdKIj9GqVMIANgLN3p9IsyUXEZR3qZlI4yBAAAAIApkh27kx3HnYwMQ3QTgWrLhB5W6k3anbYtCKxSC9QHgUltAUHeyVjCzZDbFQMAgOKR2NLsBpFekBkJd5jMwr9KMXf9c+XXWSoP5kWASWHPmCmZRdGXgI0Uzt1iGTkAAACQnpxKdScSCzZkOwdosF9SvF+ozcykAOcpAkwOBIFJbRmB+xQi0hskwUoCAABwiwKIq5OXJQNb0bNLYEfrBCLAafKCAxeAQkhpJyCrAAAALKRgxonIcL5Jvo2yDP+qzq/QEWAqZBCY1BYTFAn5wJZDP4V4AwCAtchnfHNhYwlWS15FAOKibecpgP0mpxIBJrOhzGIGgUltSYFRWKKDJaLEAAAAQCs5kupOKJFtiHcOSLUFEf5NGP4lEQEmCHDy7NItDkYAOiEf5HLumBBpAABwmpzamxJZBUBG5+6BXS8cCyLABAcGjpAy0psHQQ2mc77CAAAATFMw44RsF4e028tLOE3D4uJnpio3pyPA5LoAU9olwhFAdFJGht1z0gQrCQAAQC0JzEyASC8AEjrtF0QBEWAlOaZeIrruTlM4KQ0Sa+UFkFUAAABBEOnN2/kE0BEFWzDj8K/qXN2PAKf7aiMP5b1h14LApLzIwHEKGukNpiHSAABgOQUQV0SGgUI0268e7NyPU5WqFgEmBIHT5qjkRAABqymclHYiwcoDAAAAUUhgnHkBkeF8o2YbIfxby4ji43+nFgGmvAkwORkEJuWlBoUhpZy7QSFWEgAAzFEAA0NEFxhBv/3qIZ87fV4jwGQiCEzqaoOAqyR2tLz5WqFD5AAAANqRWLDdRIlsQ7xdR9nm81JN1rPQ+PkhAtyaUw6CwKRsoRAB0JbEgu0qsVZYAJEGAAC1JLY3d1AiqwC0kJX96sFa+01L+ghwuq82ZWO7AEfOEQ5cMBDpbUoXaOUBAACooGAhUUSGC0KG9ovwb6yvpY8Ap/tqUzYOCHDkTOHAIFtSeqh7ThprhQUQbwAACCexjbmDEvkEoCvO22+eaUSAKXnfUF2fMj9BYFK2aPTY3SVlZNhtX0tp5AAAAPJHwUKciPQWlgztl3TtINaGfylZ2YLfaUSAKZ8CTEYdmJQtHV4ABIWL9AYp3AoDAIA5EtibAJFhUGCyVV/StfflfJ9WEgFO99WmbNwQ4JiZKjxBQMBGCi2lQVJWBAAAgOJQAKnuRMHOLRQFlZvGrP3qydiaG4CpJQJMCALrylRpAeALIDqFk3NIOAAAdKUAIU5EdEFmKN5hYL8allccAuMAABAASURBVN/8Z1MEmHIrwGSBA5PiMqDH7haJvSxvjharIgQQVAAAcIuCGWenQxaiu7nHkPqSxp1F0yXVCrNNklXLd1RFgNN9tTUnZ4LA8fOFAwM9JBZsgduOWbgVBgAAdRTM2BAZBqrIof3qwbT9yqiKAKf7amtOLgWBE+WruiToydtDYhGVHS0/QFABAKCwJBZs91Ei2xBv21C/OeLlqHN3yGf4l7peAk1xep3jk1tHJyYHhkbK5bIya/W8tbW1pYX52VMnTp04SorJrwPrzBU4TKGFvHArDAAAzSgxMHdIubourzrQjq69Irf2Oz45NTrOPXFYgyfOzc5wTzwS9UvSmIQCzNV3audZa2urq8uLqyvL6+trpI6ennJvX39v/2C53Hv04ENKNVhj19YWB84qe5CclF6WH0dLWREAAADsocCWqeQ8A8TbQrRvEXvsV2X2XH2ndpyZhSc++mAUDVYjwNvP3DU0OrEwN8NXiXTCV29oZGJhdubQwz8jZVjlwKS1PBkvBJhEPogW1CsLfUYBAACiUTBLg6CC6GS0lWMvxhX73f6Yx2btiQ89ED5nJAGm0M4gt9+B4dHZmWOUFaMTW5bmZ+HAakA/HxgGggoAALkngXECYJRM98E8268ZT+zswG3XrfUp0IJOnc3xya3jm7eePqn81twwVpYW+LptbKwvLy6QGrR3pm3XYEMLBMAO5FP6EHIAgNMkFk7IJygwBvZ929RXJeOTU1wVzXjiOvfE+ejfKlEcpnaexSPalDl8oVM7ziRlWHZFf+NL2e7kXvMHAFtgcYZMSnf9yF+MOCQpDQAANiC3UToaz8RNKAB2YLLr69lqv8oWwmXNmCfuPCvWV2JEgLnT9w8OLc7PUuZwre/tG/A8T10QmGyNA6f+qlpw5AI5AZFeAEABwQ2voKhYtP8mLIpb9svDv4Y9ccOLHgRuHwFuWxmjE5Ory4tkCL7o0fFJUkkWceCky7DmV+shUAyygcUZJghcxFoESWkAAHARFn8Yq4Gl+M0sSWkAUmNvfzVJUTzX7JfDNc2wJ0608cROa1iKvvIDQyO6H+cVAl/0wNAwOUgKB7ZSNz1YMdCBF2foSenEHznDiEOS0gAAkCVyW5SgIc2+CZULD0AcOu2J1pGwZI7+NrimmfbEkcize+XIs1K5XFb7HqdY8EVXXqOsGC+bc5BiV060pBRfzZLwHyvO84LkZHDpshyUQBADAGA/ydouuR2LghezNYbfghQ4v/skXIFs11vx0tzyxI6ztulCMtNdPS0FyMiB0y3JEQ3uBI6DBgn2Q1iiPkxir1SDF3NIUlqgsCIAAMA25MY6gayGi2uy1jhbMqgGAMJIvus4bb8V7PPEkJUs12dA3y4L0lW04xoMfDIWUSal4w7lfNSTWFBjLaIlnawiAADANrJs6BNYpp+55k5+ltUQBOIN0m08bPkMqVS28ouKXSRT/09tscGWEriJl2JIUlotLKmHphV1efXiVopaFFYEAADExXKjittiy9+KvBxXxDL9QSyDQgL1pN1sJjY7drVQAS5SDy7rdVWxvNQqDWzGmIg2z8wSDeV81ONQRQAAQFxMNcSJLVMPZqshmLZWvIExFGxd2K8+wtezHJit4D02Aw5MyjSY1GQG7EE+K5xsKOcmYOYEWw2qKiKIkxUBACgSGZhZstY1WzKrhmBa7QEHOImyjWpo78BOWasBXAIdxED/VZEGBzMjlVkC3RgUUSal4w7lfNSTuIISLy7BkKQ0AADoIMuGW4ll6iHLagiSgXgD61C8tYyeNwI1ugiwASM0jMlgFqlcdstejq65rchni5MN5dzSk7GQtydNBekgZaUAAEAnLLQr0y2wl6LRtbZKFBYGaEHLFjK92e3d7V7/uqurw6v4cN++6ev37OVDSkfXtS3FmTkV27dv4x9yAJO7iFf/aMvYs/k3ANrDkg6ZlI71SbxoktJ6SVlBWVYKAAB0Qm5AEzRolLRZi9XEyQXWA0s3zLJKTFQPUITGTrIdPW9Le/5cfe+7Z79Q33OefN4Vr7xy3/SdN3/8Jv655JLdpJ5GPZRizJuO17z6Sv6hlHjZbELzO4rmHwx82Cm8pENPSrcdmXgRJKXNkLKCPKUVRFIaAADSILctqhq6xM2dXLBs8dINvW7VQ0mPAHZUD+iGvL11LcACMilFTEHz1ff6G/Zy9b3+hj0kwr837OF/cg1+/dVXVWe4muITpShl6Ss4YSWwpSrEVtRclE67CnaGbGH1/S7uUBB3n5VPVNt+kpsF9lVrK0j+LgAApEFVYx0Fuc3sOvQLlmFvn6UekpSOQoLqMV1VxcZARVu2bW3c1Xh0V6iv8F4ZMZ7PxkPBneaJT1NVOPgQLH6OgWXTubTodECw2TSxWBn07zXgpRiSlFYLS+qe6T20gbyq9lQQAADkg7gtrfytRMtkKYaCbMQSByLrsKJCrdyqWRUqZvi3GundW7vpd3q67R2/PPYrJJn00P0SaLJwo3qZlci+Va9/TONF/gClyKeuEwyZlO76kb+YYCivAgAAAMDSDRMc1JQc2khKA2W40c+0uLNrqf0KeFz3ildeecnui+U7fsXV0dV59iYI/0YsTbndF9X8lLdv3xa86Xf3xRfz4duveZs/5iMfvenQocNkO6ImrWveDMWEE6DqF4gjTJU0556jnIeWz6YnGPqZY6MBAABITAaR4TRHVTkHUIzqsHslHdgE3HIrDrxvunI59NVXcQcWcWD+J/feytOw6n+mfyJ0ldY6iXoJtI1BYJZl59revnxw0+RaNwp2hDEoovKJbdtPiieuLAFMHQBQNOQ2UIlNqoalHpKUjkKC6jFdVUA3jmzMbIuZ9JpcHvsVD7jyNfiS3ZUgMFff2gxVMebDc558XvRso5em3OHrCrqDPLr77uve4/8pYr/BMWmBA0u0bHh06h1GPrucbCjnlh6Dct6eNJUl55Ae6yoIAGACz26Littyyt9Kvfw8VY/uAwvIHAc3oBv2S1XRFXf5ij+5BvuRXl99+Rjfh9PRppyR7gEGdRz7LXiBD8gh8untiEMmpWN95EwSDOVV0EvKysp/BYFOJNj8AFSRf8sJGh/KvAnKClPVw1RUT7ZVBTLD5Z6zY0UWbzyiyuXQtTceicc+Vy6Hnr5TvBaYtNFJgF2J82dfTldd0oMP54/E56c9Kd32I8+cYCgX1QwpK6vrh5IO5eIB87AUQpvmu6AYJG6OKFoLTumaJtPorp6ULbdcSOAy8h7hJpmXPYWCcdH13/ErNPj6G/ZWLoq++qrr9zReCyx8mNLSvpwOvgaphawvhKZ6Vbrdt+m026LHZiMssMFEOuJQ4KXYrvIJb9tPlhuvLNsrCITAEs3jRZgZvWUQwFTDKrd1sYZZYap6giSunmyrCkQnv5vFxJqlC0D6r0Hy3wbc8rRn/ypofa9BYqXyQKdJLX+fe+Ezjx58kJKyffs2qt4YTEmZ2nHWfXfd3n5a1g5cWyoVjyKuM4gIS+qeaj3UDVBZdsGijA+vZq9tstMswHVSyqQJscySTk0UxBLooah7h0X2e86Fz4jrif5twEKDxaOw+JiKIe/ZG/f5z9wT773rO9Lo2BFgxZ0qF954FJci9juj/9TQJTeGQZ9iUjruUM5HL4lFVFCsysolLGRMrKplzcn6buVJs6AbnwvS/37l33JclJilHlhoOvumTsk5Cv3VBlpAfYfifPWI2K+4Flq8+1c8+ErRq48opIrcvwRaYOBC6NqC0fvsRNzfJepRGV6KIUlpGZbUGdX6oxrk1UZlFQXWaQzrMls4XvPXmBcYGZiCjl1O8dJJaVxBTd+CmSNlVQniVlWyIUlpkAhUoToM1aWGpy+J659broLWTTm0T+VUfwsO7DhoFmNj0KeYlI47lPPRi0IRTbDolrTtlZV7WhTU997WMe2/1wmv/SjWNN3r+h3gNul/7/JvPwoZ26QKbGgalZyjyLbaAMiT/erEC5mSlwiwwKQDE7qnIGu8FEOS0mph6nzTU/Lbklc7TcWpRUll6aq4/NGm58xaJ7H20zvXaN10A5XutZveGhBGz9l6Ov2mEvw2Bfq2eZpWTs4hdVnSVJVcbfpIf0DAbxhkh7m9zTH77UJVgMO6SR66UJGBBgM7UOJTgjQNgOwZcYdyPnpJXHECs5VlsuJcgcl/tlffwBTWph6DY7zmUbV9qOq79R3C8/eMoAZ7zbmhC20rLDSd/W8zsUGyTPcyHU1aXOTm2fpqA6Az2BFj4YVPiRMBNq7+UQpgLAjcKEF1aLYMoNjIZ6aTDeXcZJgdsq2GNBUn5yCjpLJsrDgnkDvkDdlt/ov/Cx5G2vTDg1MD29yj1ry8iuiythqMULDjdPoNJvgtC6LvAjpap6xIWVVxq02uADerDRQbC/bCiApmljgFqAtwWA+qNm1tba2np7y+vkYm4IvmBYg0q3kHpua2GQA9KPEpJcVoSccdyvlkR8YVl76ybKk4t2itL9Y0XuiqGN+mlllQkr22WXv1XD1qNltW/5l6Nflt9N7FUr2oPXlgGSw0nc1vOaVN+gvNcL+zoQl0sNpAIbFmD4smljZ5YucC16fEiAAvLcz19vWvL5pZMb7opYX5qHNb4cACmDDQhnyWOtkwS5g6aVcj8IWquPBKVFOhFtLaVWaNkX6SBdS3lqhNa7gqYxRSRdUegufVvlOZ1/MCm014sleLBte+Uh0PB86W8P0/8VCQ/Qb0pHTcFixdgdM3RV4Rqw2Azli2b0UOq3JNM+2Jc9HnLzWSYStYmXZ65kRv/yAZgi96duZ4jC9Urjyzah/y6h8ADCGfMk8wZFI61kfOJMFQXp3scLriwivRTIXqpnUNWWOkSPJhidVqtlT9m39KjEdsvVJlEqt/KlP9T0/1ExxTmcGfuZKbV8lE5FbfciXWWGijbKwAm8Eiwvd/Uz9wJT9zeaX0w9QNi1RtAEjYpwkxTYprmllP5KJaTXYP/1KTAHfj1Ikj5XIvN2zKHL5QvuhTJ45SXGx8ZBlMGBgizTlvf+hJ6bYfeeYEQ7nY5nGi4myvxMxggUTQfqufqpyyWuy3ob4V7/WC0ttTFdceVhv21NMtf9aGLTJcza1Jg2tLFP83OTCTig0MIf92dP/wlfz85cKbQ3kVFqPaQPEI7rs2EV+guKaZ9sQj0b/Sw0rNV0GHHXjZ+tra+OTW5cXIlyIrYnR8y7GDDy0vLlAybLkcui3o6gDVyGe1Y52Ap3Qn45Wckjd/Yt5UJZKKirOlEs3CWhIB+xVHBcYCVV9TX19cax7LhOtWZqiMZ42AcOPTmORbtJ+zQNwBHDgS1ZPBUe3KDMwg/3YSD1nSBoFIWbNgAuVVmOBDKqrNXBWCvGPxSZek4UODnni04onzYbXaPIWVegaaR1BnKtN2nLlrYHh0duYYZcXoxJal+dlDD/2U0mC1AwvQyoICwAJtkEinHAq8gv6AxienRsc3DQwOl8tlF1q57GDt/qwvY/GXAAAQAElEQVQPK7tgy02/9Y9X6y2zlo60F+4TgXgSawpNeX6atQlZeSLBqF1EihCUshDPW1tbW1qcnz114tSJ7DpCdiG3vYmHAoZ9HRQH6/f1dBfPbj/zcUY88eBDD1T/SizAFMmBh0YnFuZmVleWSSc8oj00MrEwO5PWfgUu9Q7RkQWaUSKiRcektY9Pbpna/pi1tdXV5UXeFJt67qKdtLdfVks3vLfZcoM368qTIgqw5zVfnln/c6PDJAoqsdfIqiVnYA89PWXeOentHyyXe48eeji1BsMgE9GpKU1chQBoxJ39TMWto9yBM/bEuPZLyQSYKn2vrVt3nqWp79V0dHn0wSS3/nbCvQiJcwUGoApTJ9iQ7QpNFbr9jLOHRsczOLo4CpPSLfZbolqMtyTbbycNbnoZUgMvkGhSXEl9N1pGVr+z4X9XJCQHRv/cWup9r1OHHvkZjKpCShGF14O84druq+7BSeOTU1OZeOKRiif6t/6mFGCK5MBU1eCxicmBoRGVV9+J64sW5mdnjqtU3yBOXigIAwCJSCyiAshnBbsqkdvvwPBIltcXuUUU+xVjWoy3FFDiwE28tZFU/zOYc8N+6+HcjRb79dU3mK4nxBfhwE5Tvfpu7tAjB0gBKQ1SAAnvnEZ1gixwcI/R88zgyl1aE5sHhoY1eOLc6ZkTzU+9imG/1FGAKaoDR5o9Biq7iaHLyWpBWnC68AB0I7FvFkDmxye3bN56xqkThwm0I679+tLbeBOS7MOBODC124m8+tCP/bYY70bAh1smERzYfcYntx0/8khObgnWKpCQSZBbXN6zs3tjjoIFebFGd55SZqVOb0Lq1lXs3pVU1dlkpGVpZvvCrvXE3TcHALSy5fyXbfn5lw7vOK/cP04sxhvmwvA21pZPzR/cf+yHnz1296f4iKkdZ86dOhE9g4HB4b6Bwd7evlJPmdSxsb62urqysrS4lOhhj/pKtdZcKt9+a3/W/yhJrluqh4JLkgPzz2AP7R6mCwfpvCHa0UsjPdRXzWfVo9l1OrhK+xfoe4u0b54W1yvPyypVFZd/nZst8yo5i8CvEACvWozKDMKBWWUer15Cr1oSv0Mi6qpcmC3oYqkW5mb4D/P0zEkCABjHPRU1W+KYS/ciTle1Uq35sC7TJVj7OVipPFDPT4HisLbJ1HmFjNKJHc6XT/OET4P8MHX+y89+7jsZlXsGRkkP60uzHq0d+fb7Sse+E/HiZy4Dw6PjlRtwlhY03YHTPzBU7u2dnz0VXVe0lqocKNVCtVTB8G/wembZfpuGgamXjdFLN9HFwxXRHe0JW7qY4c55+uxJuvV0I/a7EUx4jYDwRvMF0sH7h6n6Z//g8FDBtqC7pRqd2HLy2OFTJ3FjAgAJyOOFAbasU8bl8LqOSJynojWpnW/ufAk0xb4Kmpy7ELq2tHzLGFQTtAOXEyti16/97eS5/708MEb62ViZWzzwtUe//vauc46MbeJd9rnTJzN4BiNfFl8KX1bXmXWXyt8l++qlmp89yZoFOMR+e5od+PIJ+v0pGi518V4ZbsLzG/QPR+mWmSb7XQ934OZnRA+NbSr3Fm4LulsqbuC8O/XwT3/S+dsprydm0rXFxUbrpdoAVMj1DuFlvHb6Ln5OOKWHh4ApBDhwboG+ABeQOyg2STu3383nvjAb++Wwnr7y6Bl9Y2fOH/jPkNl4H53HrGZOHNlYXyfN8EUsLcwNDo1yN1hZXiJzpWLNpVpenBuqlorHBIO38sqXOvc0D7ntPnGA/uZMet44bS5Tf/yL2flXRnrooiH6pTG6Z4lm1upXYgeGzZdlNxJiZx8e21QqFW4LOl0qz/OGRydOHD1IrpPSzSGWwD2Kt4MW3n4pnQATHDinoCoKDJPSCYZMSif+yBkmGMqrpoKpp758x9Ovysx+BdyBe8ces75wfPn4j9rOwCNR/YNDM02PRtTO8tIC7/1Xn824SoZK1WKUvEXnpRoZnWCet7622oj9trvmWXivcOAXb6L3n0VTvUnUNwj/Os/kJZvoxBr9aKn+FiVWuwG4qcR1vOqYvsHh3oEibkGnS+V5G6Njm44dfpRch6kbKjkQpCwGSWlQUHAapk5B7Lcb3R4UERoz0fkapLnZyuOt9bwGqcNyK0NocIXw/QlVlGs8KZ1sKOcmw1REdzOJ9Lbl7Oe8K2P7FZT6Rrc8809P//jzbacOj46fnjlOmTN3+uTYxOZON23qLlXLBvdv/Z2vlGpyZXG+0aMWcWDJfkvV4R9upxdMkFqu3kZn9dOHDrXfab3qI7LEQzrEWgyMFHELdsKlUuW7/yC3sYmHAha576r7SARyAjZzN7JWX/EaJF2eWH0NUuc3YnRb1whPSmzXm+Tqu3Xn2WtrK6vLS6dPHtXxwIlNW3dM7TzraOUFx9lqMBy4C7p/P6j/TFAin4I0wimfpE8zlPPUBg//MqbySbOxYKxn7Ekvkh2YB8TWVld13wnZFr5QvmheANlVsiwVk0q1Xi3VytK8sN/GG4+a7/vl9nvNTrpslEYUPcDbh2f4gnEaLdF1j9aMV/yCvKr3luppPuSD3qGib0HXS5VbbGurlQs50A7q2ijZ2i9XXy5xa5UnEy5q8sTJrdu37jzryKMHTskXAUVY126XQAuaG6kdZ+4a37x1fnZmcX6Wr5vnbZBSeIaVd1ksLayvrXLT7h8Y5JpPGQMNBsBmmOHo8dnP+Z+DU08iQ7CevlLv0OxP/qVl/NDo+MrSYqfrRXXDGOsbGFxeWqBsS9XSo2558nOJsf6BgdWlxTaXPQeufP6j7fSrY5V7d3XQV6KdvbSpl/bNNd0DLB+je0fGl4u3BcNxpVQ8HH3s8MNkG53aN09RywmpAcByMg/8bj/zcVVPPKnZExeFJw5UPDH2W+iinesOVB2334HhUW7bGZx25Yvg0W2+OF6VlDGVJ3KiXQegjpLT/0xKJ/7IGaYcyqsZyvD288ko/VvOlUf29vYZCYgJ+KJ5AeTxZku1tloplRDjYBA4+BysF2+qXPmsyX4FPHO+CL6gNi9bqheMD3vK2IKtOFWqKK1MtrDQtJKhkk/KYsgrCAAw4TJc2aqeeDgrTzzCF8fltDE22hrHu9iLe/bQ6MRstrfczM4c4wvlwXTKHmgwAAJPSicYelK660f+YoKhvAqpKQ+Mk1F6+trcflzqKau90CgWfNG8APL4zErF2iX4ont6yn43u/VRWERPGKA/26H+ymcZvgi+IL64llcNlwIWUPAt2BanShWlJbIbT90wVoOfcnEkpQEoMob8hcta1RMzfSM619KqJ26N9a3Ix/xqNW7defbC3CnKnIW5mamdZ5EpoMGgOMhn0xMHBEhdWCBliEBetfQw/cLUpQAIdlRoqQW/Vmq7DKvvPoEoa4k1OfDbdlCW8MWVml9EHCwecJw0LZQdMHVDpuJAIGeVeAhAETDqLFzWuLJR5nA55YpaSUVe9Rh9OO7WlademXrgROU6bxNBYB9oMCgC8tn0bCK9cT8Umk45lKsCOEig2+y1dKp9B758gs7soyzhi+MLbbLf5h4+cJk0LY7OElGK0nVtb7V+5MUlHgKQb0x7Cte0ylOvjHniSqwgcAwBHpvYvBr6PnqtrC4vjk5Mmm/GoMEAMCmdfXCA9IQI5FUDjsCkRMukYBDYl8/fn6JRnbf+yvDF8YU22S/Cv/nBvhZELpHCRpuMNt0UmgagOFjhJh7XNC5rZAiuqFxUo88fQ4AHhkbMPnCCF6CatMA/ocGgyHhSOsHQixZAIHWn/+Viy2mQC2o9atahE16//PiyMRo2cSU7XyhfNKPAE7ACFgBcxp2WJbw91Newk7rmPXxFACgCtvhIpQzWeGIkYhz8y2XDD5yovEa5hh2NHDQY5A/5bLryoEGsD6ULESBokGtaNl1LEDWolK37YFU7X7op6/CvgC+UL9ovBmu3hwI3idv6mCO8PTTV4Ctv9uUVBCAfWOQgtWLY5IndiTGr+Su0mgogqtuCVk3sf7h8DeQDhaEAMn1ungUWKqcTDKm+Iql/7lvHKlkcOY0zaLpggUSjR12/9ZcPB3vo4mEyBV80L8D8eqUwG6JgqfeFpz3top6eitCvr69/97v/j6zhkkt279s3TYVAf1PYqS3yUrRsLUMBM9FoU2B1WtJuHX0A0IdFsbfmktjliV2II8A2oqIrqgR/d4QJg8KiRDLVCicLTccdyvkk4sKzS39/RT9PvOHm5bsOKH5BfDK4olSGuyvDfdPTvq6I8Wbt5YUvfAEffuELX6RkVA2YBW64FeMuGabZdTMRYA5f9O5huvV0tTBV+2Xpjh6vefWrrvqDP1iuPqejv39g7403fuSjHyPT8P3n9VdfJfai62/Ye/0NewikRG2bpq+tUyjqfmHgsaDIWHfNqds/SNNv8lCAZRtAXJOAq6NBAVF1zt4felK67Ug5nXIor446hP3e8+gG//AE/5NM8/rXXX3zx2+qiMrui/mfPH3fPfv5SKoqsbBigzz3Oc85/7zzwudhzQn5z+AY8blgML79vuaasE8c+KIvHGwUJljaZGyd2vqlL33pWZdexj88wf8k07znr97N9yWeuOKVV57z5MoW9PerHHP++ecfPXbM/9z1/e/5k97whjd84xvfOPDggS9/5SsXXHBBeD6f/MdPBvN5zatfE5zaPzBw27e+9Y5rr6WuKGyWvWiNs/ImWl4RAAqCvU7h/A/S9QiwwEvXc9AGwsIgl+Qyuqs2+tGZCx/bc9M31sYGK+nb7zcf/uVC8vrXXcUVxQ/z8jCdGMl9eN/0nWQIETb044czM6dE2bp+kdX/k2W4Nqb633lDZBZRAFb9RTBLj2EJ4Zuschrlvvvuve8+nr5k+k6+d/nbjmuw2WiwzusaWE+57Hne1qnWtza+6U1vetlv/dbb3vLWRx55+Nq/uPajH7vpaRdeFJJRqVTau3fvte94R9up73znO1dXVq9797upe4mktNq2UW2UONbQL0DbNADuYnsILQ8/s3wIMNU3hq1diOCuDBkGruMpGpKULgA33brKh2+8vNdPG0SIrojOBdk3PX3FK6df/Osv4p/P/d/PU4aIItWKUVWUL3/lq4cPH65OusqfFDT2BPBWeEcvJeQj17WOiRn+FfACKD8YbN++jUzDA79it3nbn7+d6huUn0y5fk9Nes84YycfMzs7+4mbP0kmuGT3bl4ALRLueeWenvX1dblZe9GLXvSJj33sa1/9Kk9fe807bp/ed8455953771UqZAz/vXfvnTo4MHLn3e5P3+5p7y2uta2ebz88ue//OUvf95zf3Vj3YobKFIhHwvSHEFgv8Bd3LhuND+/sRxcAh3EhQ2DC6QBKB4Xnl268rLekKlkAqEBbcZffRWP4HGN4a4iwmWZwZ1EKDfXcm65/CPsl4/nY4Srv+ev39vVflmHUf54U3f/+ozUC8Ca/kvIHdPTv/Irv/wft3yJf3iC/0mGeOSRR/dN7+OY7AAAEABJREFU38l3HnG1s9hwfAzfo/hH6DGfZ3R0lAzBi8R3++r5FPXXYzPG1lZXb/7Hmw88dOCbt32Ty6o/yWs+7i8tNF6YOTw8wmnJ56lPfepdd3/vpwd+dsPePcPDtSe2bdu+7f0feP91f/nuH//4x8957nO3WXDKAwCQHJekIFfmUspsff74jX/49x/6IGnHnc2Du4UBKAb+U686zvDYnvAZdFB/NFGbIJi4aVN8rnjFqyhbuB35xWtBGMuv/PJ/o8h0un6z1/S1OH3NQk7pFPirX/3asy697FOf/gz/8AT/k8zBT0/wXYgCN/3y3YyftuDb9Nxzfo5PyviyAhl9Dtzb2zswOPj1r339sksvu+OOO/bcWHPXr3/9P694xSumprbw9NuuuebQoUM/O/Az8ZVHHnnkiY9//KXPvjSYT09PeWxs9OW/8bKrXnvVpZde+vo3vEGM/9CHPnT33d//yEc+wtM3fvjDT7voaQQAcAsn+/85UxVPXAKt/R5afox57e//nkjov/PH7suh24JrpAHIKVvHmHjq1dhg7cpnzgVnVUK+/p+c/l763BsHXnvTcmbvRrpk9+624d+meUw8BVrck8yj0FdIy63clrxvunJbaYHerNOFSm3UH1QmnhYWlDpTt9ryrSM2EN+az3/+83ji8bt2+VcdG3+yGtVrRlxUr7CWvnXbt6Y2bxHpt77lrb/zu797zrnnfvfOO69797sHBwe/c8e+4yeOb52a+st3vSs8n5e+5CUiwSO9z7702Rdc8FSefvoznv6Ll13W9ZlwAADrcDjWlb8oXWWNsrjuTtwCdPfd+/lH00VH7XB2gwXPDCE4DADQhnjsc+gMWT8Fmh8ghDgJy22ZysfEvfu30z2DK6Yb19VqAVLewCgeN+X/efjIEf7x/6zcfHuJSdUU1z/Pz88/8MBPecLO1yDt03a5+Nramp9eWVn5sze/+Qm7dn3tq1/lPnzTR2+Knk/lpuIq/f395XL5nnvvPXr8GP+Mj48RAMBOctKZz62G+A/B0hUEFvbLz/tOTIzzP7/xzduUn3DtjIOhYJmWnw3iwwA4BY/ovuHmZR4Evv3+Df+pVyL2+8Fban9eeVnv8iq9+INLlCG8399VgEUwljJEHC9E/LAlCFy9gKgSsr5+z9628eEgbQ5p1VF+ezq3TpNGnwI5W5OaepFSdDM6HU/9Z4aZhZ/7JvvwOydqLyW49Bcu/fgnbn7Jr//6wUMHr776dTMzp374wx/6Uy+//Pm/+Zsv+4VnPzv4Fd47et/7P3Do8KG3/3njaWqf/ed/fvDBA2/5s7f8wi/+4uXPv/wzn/40H/mNW7/hh5c59z/wAAEALCFvIau8qm9tvcrNo9TLVeXZj9Wrnt5+zduofpzu2utSSi402Ac+DIBr3HVggztw+DxdZ9BB+LXE4mqdLK809sOVbeOW4sDBS8UTouTTScvGm9GDq0kFONEzn2V4AdL0L4YGB2/+xMd27XocT0/f8e1/u+Xfr/2Ld/pT3/XOv3j+5ZULj2/ccz2Pvl7xilctLC5SVmR7iE+Cb7/Kz8Xf9s3bPnzjjbf8x79vbGx8/3vff9UrX7FUr/ktWzZ/8EN/945rrjl48GDwK8PDI5f90i8dPtQ08m1vfevHPvHxRw4+ymf+/Oe/8MG/zeARKgCAOOT2Is3s1utT/+d/f+c7t1900UVPePyuT336M7fffsefvulPHv/4Xfv3/+BNb37LkcAFTYporJo4/muUKDl6kOFFUA7KIYQWgDzCHThkqpH3IVVfzbr35o/fJL8GSdDpGdG6i0TVx1BTNdIbnMr/FC+wEc9Y4sO2zWXtVK5HHqv96Y+vXQ5dnWP/Av38IBmEF4DqPSgvfo/jKec9ZefOHRdd/HRxCoM7cFCAuf3ufvqzRPrbt93KZ87sRAYvi7jXqdOxnhc4+12rbQE09Ub+5r3v5R95/LFjx8950pPk8eIhWC0jK7f+PvNZFMoTdu0iAIAp4vbYnRHm4HppLzO33ytf/XuP37XrwzfuecYznv7bv3PFGWfsfP/73vt7r7nyur/6a1JM483jGT0EyxAOrhcCvADkmgvPLl342NoLcMSLkQy+DVgIwH337G+RAXFnqT5D6FqktojrotvO4Lf1IiH/2aLB/HPXIv3aesyXIclvAE7K7Dp9b7FRGL9sCbDtYWDiLIZ/9XXLfsVPbSS4kVs5RvZtAECxcD5EnEX5b7vtW6urq/f96Ed33333kaNHl5eXH3jgp9PTd+7cuZN0UVkv7fcAm8bx65/hwwDkCx4K5t7bX3388/KqmSufg/jPwhUxMXHxKlcU44bw5j/9k/7+yquhdl9cKZK4iYYfGv/mfR+gWFQV06sGhL16+JcPpudNvgqYL3rffCMiXTPhvFxPV33J0B5xmbEYs23bNn5KRexXGd9VLuM/oRoAAFSSn4uis1sRbr+1RVbx00yX8rS5B1glUV6ekeELNvJyGzB8GAD34dL7uTcO8ETGT73qhNAV8TadfdN3Vh6Ku2evPYZw7Phxik8wCOw/CFpo8Eb1/QeL63TnPF08TEbgi+YF4EXa8AtG8Thx4uTk5OS3b7tV/HngwIPBqfxPfxKfjc9MmeNr8O/8j9+m+suBYZ4AgPyQw9uA87dG7dH1ECzx5ozgoe7u/fu7zqOZ3EW5Q354cGMALOa1NxkO/MrYFhaLEultadN5ixhs+bxmDabA9c/ChD97kn5uwEAceHa9smgvGPsNFDIi999//wte+OLJyU3izx/s/0Fw6hWveNVTznuKSHP75TOTIbgDf+azn73ggqfecst/EAAAOEeB3kia+zVtfQhWcIIucfrCF75I5slLKLgr4T9X6DEARjlyujgHVAPUGnr/sueWj0cbrBIEvvU0/dE2AwI8v1FZdC386zWVLRYhWruwuGjP6YxDhw7DfgEA9lIgxe1EEWqgaR3L7Sbn3o4Ko8GdiPhThycDAByh5cFXLZOoHvX1bwbe8KjE6B+O0h9n68A8/MsXKgrgBa5/RgcMAAAUg4a1Oyar6GUv/20//Ydv/BM//Z6/fi8ppnU1dd0DvG96+uaP3xQyg3iRo8EXIUCDu5NxwwHfBgCoI3BdMWsJAgv75QHYW2boNzbRkzN8H9JDK5WFblCzAyeKAAMAgGPASC2i0NuirQArCAL7r3PsOMP0nddb8ZwVaLA1oFkEAhZolv132qQZCtRe3eJtECuRQfB7qdLpNuDWq6AD4d+N6jwb1ak88Z6D9MkMX6fKF7dRVd8mB0YQOCe4vwk9Ra1uSxsOALCIov0m26xvufOsabuKTr1kDxoMgDV4Ujr9UM45nG4SvrZ0qjy4icyxvnJaHrmxvtbTU15fXyMT8EVvtFt0ZqWSr4LmiXJ10Y3Yb3WSb788ff8SvfcgXb2NRjSf0JjboD2HK4vboGYHrpfNK/wWbItbpepIp5NxCoVTlXyaanUBANop4A+y/SqX4n4h13hoqgHQCwtNpxwyKZ34I2fYPJw/eDcZZfnYvfLI1dWV3r5+MgRfNC+APN5sqcq9lVIFo6y+fPqJz52kL87Q3Drpg2fOF8EXJC/dCwSB19ewBVtxq1Qd0dr0kc7GMFqTGGNIoWkAgBaK6TgdV9noJXyWAg0GQBteaDrl0JPS2j7H9n96fWmWDLGxMjf7k3+Vx68sLfYPDJEh+KJ5AeTxukvV0l6LC4n9bdU3MLi8tOSHf4OhYOGf69Xhhw7RrbO6HJhnyzPni/AX54d/Wwq2vlzELRiOW6WK2lhRaMNFepuvJB+5eImHFJoGACjGw29MJlyAi1xf2F0AsBg5eqA8YEJh8ZCjd/+T55m59pIqjrd++sefl8cvLc6Xe3uNhMX4QvmieQHkSVmWypNK1VMtVa3rXpdPP+3rKDff6x6lL56qXKisFp4hz5Znvt6s3CLk2xQE5lK3UPQt2IJzpcqg8Yn3CV+EkiEAwFIK7jJh6941Ahz4svEHdHjZl8CDCQNgI3L0IOXQC023+xz48jvWltrciKubjZXZY995X6ep87OnRsYM3JzMF8oX3Wmq7lK1tNF+EHi4UqrTTdstoJ2+jq7XHfjvDlVu01ULz5Bn6y8iGAFuegJW/bM0V8Qt2AmXSuXvdrqH0RqoLm2awiIBAOzCgLxUFmaBJwb/CJ83yiXQtSzW1ioPnCBD8EXzApCx9tZDSw9ARjApnXKoPKgigsDf/6cT934h4wuhN1bm5h74ctvwr4BHpVZXlsc3TVGG8MXxhbYPiFHWpfJb6vGJqZWV5cVq+JcCkhm8/1Yo6HpATT93kn73AbpnsfLC3jTwr/NMeFbivl9/ES36HbwQWhRyeXF+fbXQW5AcLJXfRVEcXM2mQZOzVTIkKQ0A0IsZWxGLtMQTAyUKnZ+VIpaVDY+Ol3p61tZWyQT9A4Pra6unTx6rlYYMguYcAFDh5I9vGZh8XP+mx5bKWVyHye138cDXDt16bfhsvHPe29c/PDrB28yNdZ1PdqpeC8p9gB8X5k6fJNOl8pvmvr7+sWqp5mdPsmCTzer983oi2F9n9fTJNfqXGTq2Tj83UDmK9sd8VgZX35PrdMMR+sAhOr7WerNxU+w3GP71GkdsXlflQm5Bd0tV7aKsnZ45VtmKjOINBQyn2QEAiTHWfPgLHh4Zs8MTI1VFdAEmViqNjG9q/9QH/QyOjM8cP7rcfM7VtInChAEwBAtNZxhg4Q68On947Kxneutr+jSYx5k3VhcOf+t/rT7wmZWlha7zcyvgRjU6vqmvb4Ax5lVQeW8rP9XKDzbcOgaHRxbmTi/MR7oUXHepyoFSLVZLxVoaaeYPGjLcPnLF6L+W6FMn6KFVmuihnX0VrQ03YTHDnfP0D0cr71X6yVKbBz4H7TeYkK9aXVmq1NVIwbagu6XiXZRTJ44sLy7obnBif0jdkELTAAADmDxt1rJsxoQndu+i6GBwZGzmOG+E5yLOz0o9MXpsTzzvkrnTJ1ZXlilb+GnXkbHJn/zgTnmSBc0vjgAAFB5GU+f/1pbzfnN4x/nlgXHespISvI21pVPzB+8+9oNPH/3eP/GlPOHnnxarEeb99r6Bwd7evpLSC5M2+InW1RV+PjTk8lQjpVoLlIrVg7pNclH13lI1XWLNieqw1DxefGuwhy4ZpgsG6bwh2tFLoz3UW810xas84fngKu1foLsWaXqeFtfrF1oHLLd2qXOI/XrSjZn1gLCoq3JhtqCLpRJdlPt/+N3KHwkiwCxyZJghSgwAEBhuC9ou/olPudikJ+7fF/0r8QR4fPPWLdvP5Kc5KVvGJ7cdO/RwyHLtcFCYMACqkTt/KYeCTmnrGZ+c2rztMadOqH5SU16Qo1O+A4s/S/UxQcUtBVy3xX5LdWdm7YJhAl9c/YuZNyQH9q24ZRLV56dA+Df4NKXgIoCd8C7K8cO8i3KUHCK8PVQo7QAAlZj/aYWUYHySe6KBLgpf7rFDD506HsNPY1wCTdWHc7N99GcAAAYZSURBVAwMDA2PTWR5IfToxObFudPHDj8cPptlPVjIMAAgHe06lMuLC5WrMceMXWVkP50cmAIddT6m0eev/ucFvinSNZtltY2wUf8z+OQqP+2b7To1veY3GOZtpGG/OWJ0Ygvvohw//AgitwAAPVjUfIQXpeqJgwY8cfY0D5TG+lY8AebMnT45WLkXZvPG+loGD5wYHa/Y78GHHqiO6G6VtnonfBiAzGGh6ZRDFppW8umQ+dzpmYHBId7tzqARdpQoDkyseU7ffus+7NtvMN0w3rYJ/47foAMHjNe/1FlMItivy1S7KBX7PfTwTyt/Z9M4hC9CyZCkNAAgU2xs+KOVyTPgibPcE/+LYhJbgKnqwBsb65u27OALLrGSpgdODI6MDQyOHD34UHPs110H9sFRBYDCw6ToUJzh3KmZaiO8vbdvoKThqT+uw9r92eLA8nye78At6huw32DgtyUU3MaBgxc/U+v7fv27fEPsF1hIvYsyzrsoxw4+dPzII3F/v4gMAwAkrG4LItqv+K/iieuZeeKDcWO/gnj3ALcwvnnb2MTmgaGRcrlMTJHXed7a2trSAg9yHO9w02+kBbljmfBhAOLDQi81TDkUeA78Oscnp/jpz4GhYZWNcC5o78C1YfUaZ9YaQqt+PFaPDzdH3TzWLlsfrzFkQculhvQ2j687cDXBmnNozRZYRK2LMj976ri9N/3K7ZiSoQACD4Aa3PjxRC5lmxnHJ7fq9cTjyW82TiXAIgdSSIzMcqbBPujCAgAkonRAmdLObqwTBFaeOGAtCVYbiP8ZNT0fq/GkK8Z8DW56gBZjnRy44a6eFwznNtS3Pr7pac+1CHDjK7W/m7MFNcL3NyNDAYQQABAJx1qHNOqbcsYMsksvwGS5A8ee1TpcLjsAliB3UhUOBVZKYMHp6sDBSG9T1Lc2sSkgTBQhAhzwXqoacf3P4KRaGvYLIqFJ+AUQeAC04OpvKWa5nbRfUiTAZM6B482dlx4petYA5IjwzmgGQ0FOBZ61pFljpK/BzZFe35Aryfokr01WzUfgugML760Zbov61ieJ/wM5eG2yAqmIsm9rEksIJwCFIw+/ZF3qS8qrR0F2qgSY1HeXtIltXvp1MvldMwAiwnQKpCBHclgQujowUestwRSwYn+28DuYqkbbpLX+Q638kZ4XmBf2CxSSgdgLIO2g0ORz74+/VqYCv8pyVCjAZNSBNc+dE9BtB6AYRIk46Y53JTihEDcdpz6a0qxpfM1vqRb+bR7fGEmdl+wFE15jjBcY2Sbw2xjfmo97JNuOVg0FkD0AikvhfvAa1Zd0VKeyHNUKMCXpmCjOUufcRQQ1BApDeCdYq/gB/TA5zZrG+38xanpcJZO+3vSH15oMHp+9ht96Xss3PGlmAsVDbhMyEHsACgH2+DBcU1/FmSZ5D3A3HHNg0lJioApsHAC6yXkwncFQECVtGUz+k7VOEhrsSd/xAp8g8viWIHAb9aXWwC+hp+YTdx/LZp+PKJaQTAAa4MdgKYk2TK7slzREgGvZkg70i62t3TYAQDrkTmpmQggsg8np9hosT++8Wb2W/ykgws3jvZbZ0EkE7chA+AUQeACKgXbvJX0NiPp8dUSAfYyHghN+Bx1XAEA+idLxNRVPS3miIc7JCNb2T9axzjp8rwWv6T8pLasv2awbqurcwn1JAPEDABSDLNSXNLWiuppmTRHgRv6kg0w0mHSVHgBgPXLn2IjUAZ2wTmNYl9nC8dr97XWdDeQbT/8JAgHEHgBQJemv3xL1Ja3tl9YIsEBbVy5DpUV3FABgI1E6vpnF1gRp0iZgIWPSFMxr+V+eUmyS7SdGhgKIJQDABVI0TvaoL+luZHVHgGtLIU1k7rNG+2kAANXInVqtQghshUUZH74dvbbJTrMAEEoG8i+AzAOQC9L9jhN921n7pUwiwAKdHUBDPos+LQCgoESJjJmK16UYsvATGdUho+ZDs3iec9v5A2mvw/i06U7LzeUwfH8DAICCkbr9S5qB3oY3i2Y9mwhwY3GkD0MaTHrXCgDgAnKnXNNQ0CkNFKGqRmFnuSX89wj5BwBoQ8VPv7jqK/j/AAAA//+RXXy1AAAABklEQVQDAHPGmK+lOzCFAAAAAElFTkSuQmCC",
      "mimeType": "image/png"
    }
  ]
}
```
