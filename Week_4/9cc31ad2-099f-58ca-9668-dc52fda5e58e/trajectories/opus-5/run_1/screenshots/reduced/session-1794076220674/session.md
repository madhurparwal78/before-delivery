
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
  "url": "http://127.0.0.1:4173/"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Kerbline\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e3]:\n  - banner [ref=e4]:\n    - link \"Kerbline\" [ref=e5] [cursor=pointer]:\n      - /url: /garage\n  - generic [ref=e6]:\n    - generic [aria-hidden] [ref=e7]:\n      - generic [ref=e8]:\n        - strong [ref=e9]: \"01\"\n        - text: Age\n      - generic [ref=e10]:\n        - strong [ref=e11]: \"02\"\n        - text: Car\n      - generic [ref=e12]:\n        - strong [ref=e13]: \"03\"\n        - text: Start\n    - main [ref=e14]:\n      - heading \"Kerbline\" [level=1] [ref=e15]\n      - paragraph [ref=e16]: Short sessions, kept progress. Every ranked time is replayed on the server before it counts.\n      - generic [ref=e17]:\n        - generic [ref=e18] [cursor=pointer]:\n          - checkbox \"I am 13 or older\" [ref=e19]\n          - text: I am 13 or older\n        - radiogroup \"Starter car\" [ref=e20]:\n          - generic [ref=e22] [cursor=pointer]:\n            - radio \"Kestrel Hatch\" [checked] [ref=e23]\n            - generic [ref=e24]:\n              - text: Kestrel Hatch · class D ·\n              - generic [ref=e25]: PI 220\n          - generic [ref=e26] [cursor=pointer]:\n            - radio \"Wren Coupe\" [ref=e27]\n            - generic [ref=e28]:\n              - text: Wren Coupe · class D ·\n              - generic [ref=e29]: PI 230\n          - generic [ref=e30] [cursor=pointer]:\n            - radio \"Moth Roadster\" [ref=e31]\n            - generic [ref=e32]:\n              - text: Moth Roadster · class D ·\n              - generic [ref=e33]: PI 215\n        - button \"Start racing\" [ref=e35] [cursor=pointer]",
  "events": "- New console entries: evidence/reduced/console-2026-11-07T18-30-20-897Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Kerbline\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e3]:\n  - banner [ref=e4]:\n    - link \"Kerbline\" [ref=e5] [cursor=pointer]:\n      - /url: /garage\n  - generic [ref=e6]:\n    - generic [aria-hidden] [ref=e7]:\n      - generic [ref=e8]:\n        - strong [ref=e9]: \"01\"\n        - text: Age\n      - generic [ref=e10]:\n        - strong [ref=e11]: \"02\"\n        - text: Car\n      - generic [ref=e12]:\n        - strong [ref=e13]: \"03\"\n        - text: Start\n    - main [ref=e14]:\n      - heading \"Kerbline\" [level=1] [ref=e15]\n      - paragraph [ref=e16]: Short sessions, kept progress. Every ranked time is replayed on the server before it counts.\n      - generic [ref=e17]:\n        - generic [ref=e18] [cursor=pointer]:\n          - checkbox \"I am 13 or older\" [ref=e19]\n          - text: I am 13 or older\n        - radiogroup \"Starter car\" [ref=e20]:\n          - generic [ref=e22] [cursor=pointer]\n          - generic [ref=e26] [cursor=pointer]\n          - generic [ref=e30] [cursor=pointer]\n        - button \"Start racing\" [ref=e35] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Start racing",
  "target": "e35"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Kerbline\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e3]:\n  - banner [ref=e4]:\n    - link \"Kerbline\" [ref=e5] [cursor=pointer]:\n      - /url: /garage\n  - generic [ref=e6]:\n    - generic [aria-hidden] [ref=e7]:\n      - generic [ref=e8]:\n        - strong [ref=e9]: \"01\"\n        - text: Age\n      - generic [ref=e10]:\n        - strong [ref=e11]: \"02\"\n        - text: Car\n      - generic [ref=e12]:\n        - strong [ref=e13]: \"03\"\n        - text: Start\n    - main [ref=e14]:\n      - heading \"Kerbline\" [level=1] [ref=e15]\n      - paragraph [ref=e16]: Short sessions, kept progress. Every ranked time is replayed on the server before it counts.\n      - generic [ref=e17]:\n        - alert [ref=e36]: Confirm you are 13 or older to play.\n        - generic [ref=e18] [cursor=pointer]:\n          - checkbox \"I am 13 or older\" [active] [ref=e19]\n          - text: I am 13 or older\n        - radiogroup \"Starter car\" [ref=e20]:\n          - generic [ref=e22] [cursor=pointer]:\n            - radio \"Kestrel Hatch\" [checked] [ref=e23]\n            - generic [ref=e24]:\n              - text: Kestrel Hatch · class D ·\n              - generic [ref=e25]: PI 220\n          - generic [ref=e26] [cursor=pointer]:\n            - radio \"Wren Coupe\" [ref=e27]\n            - generic [ref=e28]:\n              - text: Wren Coupe · class D ·\n              - generic [ref=e29]: PI 230\n          - generic [ref=e30] [cursor=pointer]:\n            - radio \"Moth Roadster\" [ref=e31]\n            - generic [ref=e32]:\n              - text: Moth Roadster · class D ·\n              - generic [ref=e33]: PI 215\n        - button \"Start racing\" [ref=e35] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "age checkbox",
  "target": "e19"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Kerbline\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e3]:\n  - banner [ref=e4]:\n    - link \"Kerbline\" [ref=e5] [cursor=pointer]:\n      - /url: /garage\n  - generic [ref=e6]:\n    - generic [aria-hidden] [ref=e7]:\n      - generic [ref=e8]:\n        - strong [ref=e9]: \"01\"\n        - text: Age\n      - generic [ref=e10]:\n        - strong [ref=e11]: \"02\"\n        - text: Car\n      - generic [ref=e12]:\n        - strong [ref=e13]: \"03\"\n        - text: Start\n    - main [ref=e14]:\n      - heading \"Kerbline\" [level=1] [ref=e15]\n      - paragraph [ref=e16]: Short sessions, kept progress. Every ranked time is replayed on the server before it counts.\n      - generic [ref=e17]:\n        - alert [ref=e36]: Confirm you are 13 or older to play.\n        - generic [ref=e18] [cursor=pointer]:\n          - checkbox \"I am 13 or older\" [checked] [active] [ref=e19]\n          - text: I am 13 or older\n        - radiogroup \"Starter car\" [ref=e20]:\n          - generic [ref=e22] [cursor=pointer]:\n            - radio \"Kestrel Hatch\" [checked] [ref=e23]\n            - generic [ref=e24]:\n              - text: Kestrel Hatch · class D ·\n              - generic [ref=e25]: PI 220\n          - generic [ref=e26] [cursor=pointer]:\n            - radio \"Wren Coupe\" [ref=e27]\n            - generic [ref=e28]:\n              - text: Wren Coupe · class D ·\n              - generic [ref=e29]: PI 230\n          - generic [ref=e30] [cursor=pointer]:\n            - radio \"Moth Roadster\" [ref=e31]\n            - generic [ref=e32]:\n              - text: Moth Roadster · class D ·\n              - generic [ref=e33]: PI 215\n        - button \"Start racing\" [ref=e35] [cursor=pointer]"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowLeft"
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
  "element": "Start racing",
  "target": "e35"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/race?layout=saltflat-ring&mode=practice&event=guided-first-race\n- Page Title: Kerbline\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e37]:\n  - banner [ref=e38]:\n    - link \"Kerbline\" [ref=e39] [cursor=pointer]:\n      - /url: /garage\n    - navigation [ref=e40]:\n      - link \"Garage\" [ref=e41] [cursor=pointer]:\n        - /url: /garage\n      - link \"Leaderboards\" [ref=e42] [cursor=pointer]:\n        - /url: /boards\n      - link \"Championship\" [ref=e43] [cursor=pointer]:\n        - /url: /championship\n      - link \"Online lobby\" [ref=e44] [cursor=pointer]:\n        - /url: /lobby/new\n  - generic [ref=e45]:\n    - generic [aria-hidden] [ref=e46]:\n      - generic [ref=e47]:\n        - strong [ref=e48]: \"01\"\n        - text: Track\n      - generic [ref=e49]:\n        - strong [ref=e50]: \"02\"\n        - text: HUD\n    - main [ref=e51]:\n      - heading \"Race\" [level=1] [ref=e52]\n      - generic [ref=e53]:\n        - img \"Race view\" [ref=e54]\n        - region \"Race HUD\" [active] [ref=e55]:\n          - generic [ref=e56]: Lap 1/1\n          - generic [ref=e57]: 0 km/h\n          - generic [ref=e58]: Coins 0\n          - generic [ref=e59]: Press Enter to start\n      - button \"Pause\" [ref=e61] [cursor=pointer]\n      - status \"Race updates\" [ref=e62]"
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
  "page": "- Page URL: http://127.0.0.1:4173/race?layout=saltflat-ring&mode=practice&event=guided-first-race\n- Page Title: Kerbline\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e37]:\n  - banner [ref=e38]:\n    - link \"Kerbline\" [ref=e39] [cursor=pointer]:\n      - /url: /garage\n    - navigation [ref=e40]:\n      - link \"Garage\" [ref=e41] [cursor=pointer]:\n        - /url: /garage\n      - link \"Leaderboards\" [ref=e42] [cursor=pointer]:\n        - /url: /boards\n      - link \"Championship\" [ref=e43] [cursor=pointer]:\n        - /url: /championship\n      - link \"Online lobby\" [ref=e44] [cursor=pointer]:\n        - /url: /lobby/new\n  - generic [ref=e45]:\n    - generic [aria-hidden] [ref=e46]:\n      - generic [ref=e47]:\n        - strong [ref=e48]: \"01\"\n        - text: Track\n      - generic [ref=e49]:\n        - strong [ref=e50]: \"02\"\n        - text: HUD\n    - main [ref=e51]:\n      - heading \"Race\" [level=1] [ref=e52]\n      - generic [ref=e53]:\n        - img \"Race view\" [ref=e54]\n        - region \"Race HUD\" [active] [ref=e55]:\n          - generic [ref=e56]: Lap 1/1\n          - generic [ref=e57]: 0 km/h\n          - generic [ref=e58]: Coins 0\n          - generic [ref=e59]: Press Enter to start\n      - button \"Pause\" [ref=e61] [cursor=pointer]\n      - status \"Race updates\" [ref=e62]"
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
  "page": "- Page URL: http://127.0.0.1:4173/race?layout=saltflat-ring&mode=practice&event=guided-first-race\n- Page Title: Kerbline\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e37]:\n  - banner [ref=e38]:\n    - link \"Kerbline\" [ref=e39] [cursor=pointer]:\n      - /url: /garage\n    - navigation [ref=e40]:\n      - link \"Garage\" [ref=e41] [cursor=pointer]:\n        - /url: /garage\n      - link \"Leaderboards\" [ref=e42] [cursor=pointer]:\n        - /url: /boards\n      - link \"Championship\" [ref=e43] [cursor=pointer]:\n        - /url: /championship\n      - link \"Online lobby\" [ref=e44] [cursor=pointer]:\n        - /url: /lobby/new\n  - generic [ref=e45]:\n    - generic [aria-hidden] [ref=e46]:\n      - generic [ref=e47]:\n        - strong [ref=e48]: \"01\"\n        - text: Track\n      - generic [ref=e49]:\n        - strong [ref=e50]: \"02\"\n        - text: HUD\n    - main [ref=e51]:\n      - heading \"Race\" [level=1] [ref=e52]\n      - generic [ref=e53]:\n        - img \"Race view\" [ref=e54]\n        - region \"Race HUD\" [active] [ref=e55]:\n          - generic [ref=e56]: Lap 1/1\n          - generic [ref=e57]: 0 km/h\n          - generic [ref=e58]: Coins 0\n          - generic [ref=e59]: Press Enter to start\n      - button \"Pause\" [ref=e61] [cursor=pointer]\n      - status \"Race updates\" [ref=e62]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Pause",
  "target": "e61"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/race?layout=saltflat-ring&mode=practice&event=guided-first-race\n- Page Title: Kerbline\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e37]:\n  - banner [ref=e38]:\n    - link \"Kerbline\" [ref=e39] [cursor=pointer]:\n      - /url: /garage\n    - navigation [ref=e40]:\n      - link \"Garage\" [ref=e41] [cursor=pointer]:\n        - /url: /garage\n      - link \"Leaderboards\" [ref=e42] [cursor=pointer]:\n        - /url: /boards\n      - link \"Championship\" [ref=e43] [cursor=pointer]:\n        - /url: /championship\n      - link \"Online lobby\" [ref=e44] [cursor=pointer]:\n        - /url: /lobby/new\n  - generic [ref=e45]:\n    - generic [aria-hidden] [ref=e46]:\n      - generic [ref=e47]:\n        - strong [ref=e48]: \"01\"\n        - text: Track\n      - generic [ref=e49]:\n        - strong [ref=e50]: \"02\"\n        - text: HUD\n    - main [ref=e51]:\n      - heading \"Race\" [level=1] [ref=e52]\n      - generic [ref=e53]:\n        - img \"Race view\" [ref=e54]\n        - region \"Race HUD\" [ref=e55]:\n          - generic [ref=e56]: Lap 1/1\n          - generic [ref=e57]: 0 km/h\n          - generic [ref=e58]: Coins 0\n          - generic [ref=e59]: Press Enter to start\n      - button \"Pause\" [active] [ref=e61] [cursor=pointer]\n      - status \"Race updates\" [ref=e62]"
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
  "page": "- Page URL: http://127.0.0.1:4173/race?layout=saltflat-ring&mode=practice&event=guided-first-race\n- Page Title: Kerbline\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e37]:\n  - banner [ref=e38]:\n    - link \"Kerbline\" [ref=e39] [cursor=pointer]:\n      - /url: /garage\n    - navigation [ref=e40]:\n      - link \"Garage\" [ref=e41] [cursor=pointer]:\n        - /url: /garage\n      - link \"Leaderboards\" [ref=e42] [cursor=pointer]:\n        - /url: /boards\n      - link \"Championship\" [ref=e43] [cursor=pointer]:\n        - /url: /championship\n      - link \"Online lobby\" [ref=e44] [cursor=pointer]:\n        - /url: /lobby/new\n  - generic [ref=e45]:\n    - generic [aria-hidden] [ref=e46]:\n      - generic [ref=e47]:\n        - strong [ref=e48]: \"01\"\n        - text: Track\n      - generic [ref=e49]:\n        - strong [ref=e50]: \"02\"\n        - text: HUD\n    - main [ref=e51]:\n      - heading \"Race\" [level=1] [ref=e52]\n      - generic [ref=e53]:\n        - img \"Race view\" [ref=e54]\n        - region \"Race HUD\" [ref=e55]:\n          - generic [ref=e56]: Lap 1/1\n          - generic [ref=e57]: 0 km/h\n          - generic [ref=e58]: Coins 0\n          - generic [ref=e59]: Press Enter to start\n      - button \"Pause\" [active] [ref=e61] [cursor=pointer]\n      - status \"Race updates\" [ref=e62]"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/garage"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/garage\n- Page Title: Kerbline",
  "snapshot": "- generic [ref=f1e3]:\n  - banner [ref=f1e4]:\n    - link \"Kerbline\" [ref=f1e5] [cursor=pointer]:\n      - /url: /garage\n    - navigation [ref=f1e6]:\n      - link \"Garage\" [ref=f1e7] [cursor=pointer]:\n        - /url: /garage\n      - link \"Leaderboards\" [ref=f1e8] [cursor=pointer]:\n        - /url: /boards\n      - link \"Championship\" [ref=f1e9] [cursor=pointer]:\n        - /url: /championship\n      - link \"Online lobby\" [ref=f1e10] [cursor=pointer]:\n        - /url: /lobby/new\n  - generic [ref=f1e11]:\n    - generic [aria-hidden] [ref=f1e12]:\n      - generic [ref=f1e13]:\n        - strong [ref=f1e14]: \"01\"\n        - text: Car\n      - generic [ref=f1e15]:\n        - strong [ref=f1e16]: \"02\"\n        - text: Slots\n      - generic [ref=f1e17]:\n        - strong [ref=f1e18]: \"03\"\n        - text: Setup\n    - main [ref=f1e19]:\n      - heading \"Garage\" [level=1] [ref=f1e20]"
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
  "page": "- Page URL: http://127.0.0.1:4173/garage\n- Page Title: Kerbline",
  "inlineSnapshot": "- generic [ref=f1e3]:\n  - banner [ref=f1e4]:\n    - link \"Kerbline\" [ref=f1e5] [cursor=pointer]:\n      - /url: /garage\n    - navigation [ref=f1e6]:\n      - link \"Garage\" [ref=f1e7] [cursor=pointer]:\n        - /url: /garage\n      - link \"Leaderboards\" [ref=f1e8] [cursor=pointer]:\n        - /url: /boards\n      - link \"Championship\" [ref=f1e9] [cursor=pointer]:\n        - /url: /championship\n      - link \"Online lobby\" [ref=f1e10] [cursor=pointer]:\n        - /url: /lobby/new\n  - generic [ref=f1e11]:\n    - generic [aria-hidden] [ref=f1e12]:\n      - generic [ref=f1e13]:\n        - strong [ref=f1e14]: \"01\"\n        - text: Car\n      - generic [ref=f1e15]:\n        - strong [ref=f1e16]: \"02\"\n        - text: Slots\n      - generic [ref=f1e17]:\n        - strong [ref=f1e18]: \"03\"\n        - text: Setup\n    - main [ref=f1e19]:\n      - heading \"Garage\" [level=1] [ref=f1e20]\n      - generic [ref=f1e21]:\n        - status \"Coin balance\" [ref=f1e22]: 1,000 coins\n        - generic [ref=f1e23]:\n          - generic [ref=f1e24]: Car\n          - combobox \"Car\" [ref=f1e25]:\n            - option \"Kestrel Hatch\" [selected]\n        - generic [ref=f1e26]:\n          - generic [ref=f1e27]: Reference map\n          - combobox \"Reference map\" [ref=f1e28]:\n            - option \"Saltflat Ring\" [selected]\n        - radiogroup \"Speed units\" [ref=f1e29]:\n          - generic [ref=f1e31] [cursor=pointer]:\n            - radio \"km/h\" [checked] [ref=f1e32]\n            - text: km/h\n          - generic [ref=f1e33] [cursor=pointer]:\n            - radio \"mph\" [ref=f1e34]\n            - text: mph\n      - generic [ref=f1e35]:\n        - region \"Car\" [ref=f1e36]:\n          - heading \"Car\" [level=2] [ref=f1e37]\n          - img \"Kestrel Hatch, 3D view\" [ref=f1e38]\n          - paragraph [ref=f1e39]:\n            - text: Kestrel Hatch · class D ·\n            - generic [ref=f1e40]: PI 220\n        - region \"Upgrade slots\" [ref=f1e41]:\n          - heading \"Upgrade slots\" [level=2] [ref=f1e42]\n          - group \"Engine\" [ref=f1e43]:\n            - img \"Stage 0 of 3\" [ref=f1e45]\n            - button \"Upgrade Engine to stage 1\" [ref=f1e50] [cursor=pointer]\n          - group \"Tires\" [ref=f1e51]:\n            - img \"Stage 0 of 3\" [ref=f1e53]\n            - button \"Upgrade Tires to stage 1\" [ref=f1e58] [cursor=pointer]\n          - group \"Brakes\" [ref=f1e59]:\n            - img \"Stage 0 of 3\" [ref=f1e61]\n            - button \"Upgrade Brakes to stage 1\" [ref=f1e66] [cursor=pointer]\n          - group \"Suspension\" [ref=f1e67]:\n            - img \"Stage 0 of 3\" [ref=f1e69]\n            - button \"Upgrade Suspension to stage 1\" [ref=f1e74] [cursor=pointer]\n        - region \"Setup sheet\" [ref=f1e75]:\n          - heading \"Setup sheet\" [level=2] [ref=f1e76]\n          - generic [ref=f1e77]:\n            - generic [ref=f1e78]: Acceleration\n            - meter \"Acceleration\" [ref=f1e79]\n            - generic [ref=f1e81]: 4.0 m/s²\n          - generic [ref=f1e82]:\n            - generic [ref=f1e83]: Braking\n            - meter \"Braking\" [ref=f1e84]\n            - generic [ref=f1e86]: 8.0 m/s²\n          - generic [ref=f1e87]:\n            - generic [ref=f1e88]: Top speed\n            - meter \"Top speed\" [ref=f1e89]\n            - generic [ref=f1e91]: 162 km/h\n          - generic [ref=f1e92]:\n            - generic [ref=f1e93]: Grip\n            - meter \"Grip\" [ref=f1e94]\n            - generic [ref=f1e96]: 100%\n          - generic [ref=f1e97]:\n            - generic [ref=f1e98]: Lane change\n            - meter \"Lane change\" [ref=f1e99]\n            - generic [ref=f1e101]: 30 steps\n          - figure \"Reference lap\" [ref=f1e102]:\n            - img \"Reference marker\" [ref=f1e108]\n            - generic [ref=f1e109]\n            - paragraph [ref=f1e113]: Predicted lap —\n      - status \"Garage updates\" [ref=f1e114]\n      - generic [ref=f1e115]:\n        - link \"Coin history\" [ref=f1e116] [cursor=pointer]:\n          - /url: /garage/coins\n        - link \"Dealer\" [ref=f1e117] [cursor=pointer]:\n          - /url: /garage/dealer\n        - link \"Save my garage\" [ref=f1e118] [cursor=pointer]:\n          - /url: /sign-in"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Engine upgrade",
  "target": "f1e50"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/garage\n- Page Title: Kerbline",
  "snapshot": "- generic [ref=f1e3]:\n  - banner [ref=f1e4]:\n    - link \"Kerbline\" [ref=f1e5] [cursor=pointer]:\n      - /url: /garage\n    - navigation [ref=f1e6]:\n      - link \"Garage\" [ref=f1e7] [cursor=pointer]:\n        - /url: /garage\n      - link \"Leaderboards\" [ref=f1e8] [cursor=pointer]:\n        - /url: /boards\n      - link \"Championship\" [ref=f1e9] [cursor=pointer]:\n        - /url: /championship\n      - link \"Online lobby\" [ref=f1e10] [cursor=pointer]:\n        - /url: /lobby/new\n  - generic [ref=f1e11]:\n    - generic [aria-hidden] [ref=f1e12]:\n      - generic [ref=f1e13]:\n        - strong [ref=f1e14]: \"01\"\n        - text: Car\n      - generic [ref=f1e15]:\n        - strong [ref=f1e16]: \"02\"\n        - text: Slots\n      - generic [ref=f1e17]:\n        - strong [ref=f1e18]: \"03\"\n        - text: Setup\n    - main [ref=f1e19]:\n      - heading \"Garage\" [level=1] [ref=f1e20]\n      - generic [ref=f1e21]:\n        - status \"Coin balance\" [ref=f1e22]: 1,000 coins\n        - generic [ref=f1e23]:\n          - generic [ref=f1e24]: Car\n          - combobox \"Car\" [ref=f1e25]:\n            - option \"Kestrel Hatch\" [selected]\n        - generic [ref=f1e26]:\n          - generic [ref=f1e27]: Reference map\n          - combobox \"Reference map\" [ref=f1e28]:\n            - option \"Saltflat Ring\" [selected]\n        - radiogroup \"Speed units\" [ref=f1e29]:\n          - generic [ref=f1e31] [cursor=pointer]:\n            - radio \"km/h\" [checked] [ref=f1e32]\n            - text: km/h\n          - generic [ref=f1e33] [cursor=pointer]:\n            - radio \"mph\" [ref=f1e34]\n            - text: mph\n      - generic [ref=f1e35]:\n        - region \"Car\" [ref=f1e36]:\n          - heading \"Car\" [level=2] [ref=f1e37]\n          - img \"Kestrel Hatch, 3D view\" [ref=f1e38]\n          - paragraph [ref=f1e39]:\n            - text: Kestrel Hatch · class D ·\n            - generic [ref=f1e40]: PI 220\n        - region \"Upgrade slots\" [ref=f1e41]:\n          - heading \"Upgrade slots\" [level=2] [ref=f1e42]\n          - group \"Engine\" [ref=f1e43]:\n            - img \"Stage 0 of 3\" [ref=f1e45]\n            - button \"Upgrade Engine to stage 1\" [ref=f1e50] [cursor=pointer]\n          - group \"Tires\" [ref=f1e51]:\n            - img \"Stage 0 of 3\" [ref=f1e53]\n            - button \"Upgrade Tires to stage 1\" [ref=f1e58] [cursor=pointer]\n          - group \"Brakes\" [ref=f1e59]:\n            - img \"Stage 0 of 3\" [ref=f1e61]\n            - button \"Upgrade Brakes to stage 1\" [ref=f1e66] [cursor=pointer]\n          - group \"Suspension\" [ref=f1e67]:\n            - img \"Stage 0 of 3\" [ref=f1e69]\n            - button \"Upgrade Suspension to stage 1\" [ref=f1e74] [cursor=pointer]\n        - region \"Setup sheet\" [ref=f1e75]:\n          - heading \"Setup sheet\" [level=2] [ref=f1e76]\n          - generic [ref=f1e77]:\n            - generic [ref=f1e78]: Acceleration\n            - meter \"Acceleration\" [ref=f1e79]\n            - generic [ref=f1e81]: 4.0 m/s²\n          - generic [ref=f1e82]:\n            - generic [ref=f1e83]: Braking\n            - meter \"Braking\" [ref=f1e84]\n            - generic [ref=f1e86]: 8.0 m/s²\n          - generic [ref=f1e87]:\n            - generic [ref=f1e88]: Top speed\n            - meter \"Top speed\" [ref=f1e89]\n            - generic [ref=f1e91]: 162 km/h\n          - generic [ref=f1e92]:\n            - generic [ref=f1e93]: Grip\n            - meter \"Grip\" [ref=f1e94]\n            - generic [ref=f1e96]: 100%\n          - generic [ref=f1e97]:\n            - generic [ref=f1e98]: Lane change\n            - meter \"Lane change\" [ref=f1e99]\n            - generic [ref=f1e101]: 30 steps\n          - figure \"Reference lap\" [ref=f1e102]:\n            - img \"Reference marker\" [ref=f1e108]\n            - generic [ref=f1e109]:\n              - generic [ref=f1e110]: S1\n              - generic [ref=f1e111]: S2\n              - generic [ref=f1e112]: S3\n            - paragraph [ref=f1e113]: Predicted lap —\n      - status \"Garage updates\" [ref=f1e114]\n      - generic [ref=f1e115]:\n        - link \"Coin history\" [ref=f1e116] [cursor=pointer]:\n          - /url: /garage/coins\n        - link \"Dealer\" [ref=f1e117] [cursor=pointer]:\n          - /url: /garage/dealer\n        - link \"Save my garage\" [ref=f1e118] [cursor=pointer]:\n          - /url: /sign-in\n      - dialog \"Confirm upgrade\" [ref=f1e120]:\n        - heading \"Confirm upgrade\" [level=2] [ref=f1e121]\n        - paragraph [ref=f1e122]:\n          - text: Engine stage 1 ·\n          - generic [ref=f1e123]: 300 coins\n        - list [ref=f1e124]:\n          - listitem [ref=f1e125]:\n            - generic [ref=f1e126]:\n              - generic [ref=f1e127]: Acceleration\n              - meter \"Acceleration\" [ref=f1e128]\n              - generic [ref=f1e130]: 5.0 m/s²\n          - listitem [ref=f1e131]:\n            - generic [ref=f1e132]:\n              - generic [ref=f1e133]: Top speed\n              - meter \"Top speed\" [ref=f1e134]\n              - generic [ref=f1e136]: 169 km/h\n        - generic [ref=f1e137]:\n          - button \"Buy for 300 coins\" [active] [ref=f1e138] [cursor=pointer]\n          - button \"Cancel\" [ref=f1e139] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/garage\n- Page Title: Kerbline",
  "snapshot": "- generic [ref=f1e3]:\n  - banner [ref=f1e4]:\n    - link \"Kerbline\" [ref=f1e5] [cursor=pointer]:\n      - /url: /garage\n    - navigation [ref=f1e6]:\n      - link \"Garage\" [ref=f1e7] [cursor=pointer]:\n        - /url: /garage\n      - link \"Leaderboards\" [ref=f1e8] [cursor=pointer]:\n        - /url: /boards\n      - link \"Championship\" [ref=f1e9] [cursor=pointer]:\n        - /url: /championship\n      - link \"Online lobby\" [ref=f1e10] [cursor=pointer]:\n        - /url: /lobby/new\n  - generic [ref=f1e11]:\n    - generic [aria-hidden] [ref=f1e12]:\n      - generic [ref=f1e13]:\n        - strong [ref=f1e14]: \"01\"\n        - text: Car\n      - generic [ref=f1e15]:\n        - strong [ref=f1e16]: \"02\"\n        - text: Slots\n      - generic [ref=f1e17]:\n        - strong [ref=f1e18]: \"03\"\n        - text: Setup\n    - main [ref=f1e19]:\n      - heading \"Garage\" [level=1] [ref=f1e20]\n      - generic [ref=f1e21]:\n        - status \"Coin balance\" [ref=f1e22]: 700 coins\n        - generic [ref=f1e23]:\n          - generic [ref=f1e24]: Car\n          - combobox \"Car\" [ref=f1e25]:\n            - option \"Kestrel Hatch\" [selected]\n        - generic [ref=f1e26]:\n          - generic [ref=f1e27]: Reference map\n          - combobox \"Reference map\" [ref=f1e28]:\n            - option \"Saltflat Ring\" [selected]\n        - radiogroup \"Speed units\" [ref=f1e29]:\n          - generic [ref=f1e31] [cursor=pointer]:\n            - radio \"km/h\" [checked] [ref=f1e32]\n            - text: km/h\n          - generic [ref=f1e33] [cursor=pointer]:\n            - radio \"mph\" [ref=f1e34]\n            - text: mph\n      - generic [ref=f1e35]:\n        - region \"Car\" [ref=f1e36]:\n          - heading \"Car\" [level=2] [ref=f1e37]\n          - img \"Kestrel Hatch, 3D view\" [ref=f1e38]\n          - paragraph [ref=f1e39]:\n            - text: Kestrel Hatch · class D ·\n            - generic [ref=f1e40]: PI 240\n        - region \"Upgrade slots\" [ref=f1e41]:\n          - heading \"Upgrade slots\" [level=2] [ref=f1e42]\n          - group \"Engine\" [ref=f1e43]:\n            - img \"Stage 1 of 3\" [ref=f1e140]\n            - generic [ref=f1e49]:\n              - button \"Upgrade Engine to stage 2\" [active] [ref=f1e141] [cursor=pointer]\n              - button \"Refit Engine to stock\" [ref=f1e142] [cursor=pointer]\n          - group \"Tires\" [ref=f1e51]:\n            - img \"Stage 0 of 3\" [ref=f1e53]\n            - button \"Upgrade Tires to stage 1\" [ref=f1e58] [cursor=pointer]\n          - group \"Brakes\" [ref=f1e59]:\n            - img \"Stage 0 of 3\" [ref=f1e61]\n            - button \"Upgrade Brakes to stage 1\" [ref=f1e66] [cursor=pointer]\n          - group \"Suspension\" [ref=f1e67]:\n            - img \"Stage 0 of 3\" [ref=f1e69]\n            - button \"Upgrade Suspension to stage 1\" [ref=f1e74] [cursor=pointer]\n        - region \"Setup sheet\" [ref=f1e75]:\n          - heading \"Setup sheet\" [level=2] [ref=f1e76]\n          - generic [ref=f1e77]:\n            - generic [ref=f1e78]: Acceleration\n            - meter \"Acceleration\" [ref=f1e79]\n            - generic [ref=f1e81]: 6.0 m/s²\n          - generic [ref=f1e82]:\n            - generic [ref=f1e83]: Braking\n            - meter \"Braking\" [ref=f1e84]\n            - generic [ref=f1e86]: 8.0 m/s²\n          - generic [ref=f1e87]:\n            - generic [ref=f1e88]: Top speed\n            - meter \"Top speed\" [ref=f1e89]\n            - generic [ref=f1e91]: 176 km/h\n          - generic [ref=f1e92]:\n            - generic [ref=f1e93]: Grip\n            - meter \"Grip\" [ref=f1e94]\n            - generic [ref=f1e96]: 100%\n          - generic [ref=f1e97]:\n            - generic [ref=f1e98]: Lane change\n            - meter \"Lane change\" [ref=f1e99]\n            - generic [ref=f1e101]: 30 steps\n          - figure \"Reference lap\" [ref=f1e102]:\n            - img \"Reference marker\" [ref=f1e108]\n            - generic [ref=f1e109]:\n              - generic [ref=f1e110]: S1 −1.083 s\n              - generic [ref=f1e111]: S2 −0.200 s\n              - generic [ref=f1e112]: S3 −0.601 s\n            - paragraph [ref=f1e113]: Predicted lap 0:44.383 0:46.267\n            - paragraph [ref=f1e146]: Cost −300 coins\n            - paragraph [ref=f1e147]: −1.884 s, mostly S1\n      - status \"Garage updates\" [ref=f1e114]: \"Engine stage 1 fitted. Balance: 700 coins. −1.884 s, mostly S1\"\n      - generic [ref=f1e115]:\n        - link \"Coin history\" [ref=f1e116] [cursor=pointer]:\n          - /url: /garage/coins\n        - link \"Dealer\" [ref=f1e117] [cursor=pointer]:\n          - /url: /garage/dealer\n        - link \"Save my garage\" [ref=f1e118] [cursor=pointer]:\n          - /url: /sign-in"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/garage"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/garage\n- Page Title: Kerbline",
  "snapshot": "- generic [ref=f2e3]:\n  - banner [ref=f2e4]:\n    - link \"Kerbline\" [ref=f2e5] [cursor=pointer]:\n      - /url: /garage\n    - navigation [ref=f2e6]:\n      - link \"Garage\" [ref=f2e7] [cursor=pointer]:\n        - /url: /garage\n      - link \"Leaderboards\" [ref=f2e8] [cursor=pointer]:\n        - /url: /boards\n      - link \"Championship\" [ref=f2e9] [cursor=pointer]:\n        - /url: /championship\n      - link \"Online lobby\" [ref=f2e10] [cursor=pointer]:\n        - /url: /lobby/new\n  - generic [ref=f2e11]:\n    - generic [aria-hidden] [ref=f2e12]:\n      - generic [ref=f2e13]:\n        - strong [ref=f2e14]: \"01\"\n        - text: Car\n      - generic [ref=f2e15]:\n        - strong [ref=f2e16]: \"02\"\n        - text: Slots\n      - generic [ref=f2e17]:\n        - strong [ref=f2e18]: \"03\"\n        - text: Setup\n    - main [ref=f2e19]:\n      - heading \"Garage\" [level=1] [ref=f2e20]"
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
  "page": "- Page URL: http://127.0.0.1:4173/garage\n- Page Title: Kerbline",
  "inlineSnapshot": "- generic [ref=f2e3]:\n  - banner [ref=f2e4]:\n    - link \"Kerbline\" [ref=f2e5] [cursor=pointer]:\n      - /url: /garage\n    - navigation [ref=f2e6]:\n      - link \"Garage\" [ref=f2e7] [cursor=pointer]:\n        - /url: /garage\n      - link \"Leaderboards\" [ref=f2e8] [cursor=pointer]:\n        - /url: /boards\n      - link \"Championship\" [ref=f2e9] [cursor=pointer]:\n        - /url: /championship\n      - link \"Online lobby\" [ref=f2e10] [cursor=pointer]:\n        - /url: /lobby/new\n  - generic [ref=f2e11]:\n    - generic [aria-hidden] [ref=f2e12]:\n      - generic [ref=f2e13]:\n        - strong [ref=f2e14]: \"01\"\n        - text: Car\n      - generic [ref=f2e15]:\n        - strong [ref=f2e16]: \"02\"\n        - text: Slots\n      - generic [ref=f2e17]:\n        - strong [ref=f2e18]: \"03\"\n        - text: Setup\n    - main [ref=f2e19]:\n      - heading \"Garage\" [level=1] [ref=f2e20]\n      - generic [ref=f2e21]:\n        - status \"Coin balance\" [ref=f2e22]: 700 coins\n        - generic [ref=f2e23]:\n          - generic [ref=f2e24]: Car\n          - combobox \"Car\" [ref=f2e25]:\n            - option \"Kestrel Hatch\" [selected]\n        - generic [ref=f2e26]:\n          - generic [ref=f2e27]: Reference map\n          - combobox \"Reference map\" [ref=f2e28]:\n            - option \"Saltflat Ring\" [selected]\n        - radiogroup \"Speed units\" [ref=f2e29]:\n          - generic [ref=f2e31] [cursor=pointer]:\n            - radio \"km/h\" [checked] [ref=f2e32]\n            - text: km/h\n          - generic [ref=f2e33] [cursor=pointer]:\n            - radio \"mph\" [ref=f2e34]\n            - text: mph\n      - generic [ref=f2e35]:\n        - region \"Car\" [ref=f2e36]:\n          - heading \"Car\" [level=2] [ref=f2e37]\n          - img \"Kestrel Hatch, 3D view\" [ref=f2e38]\n          - paragraph [ref=f2e39]:\n            - text: Kestrel Hatch · class D ·\n            - generic [ref=f2e40]: PI 240\n        - region \"Upgrade slots\" [ref=f2e41]:\n          - heading \"Upgrade slots\" [level=2] [ref=f2e42]\n          - group \"Engine\" [ref=f2e43]:\n            - img \"Stage 1 of 3\" [ref=f2e45]\n            - generic [ref=f2e49]:\n              - button \"Upgrade Engine to stage 2\" [ref=f2e50] [cursor=pointer]\n              - button \"Refit Engine to stock\" [ref=f2e51] [cursor=pointer]\n          - group \"Tires\" [ref=f2e52]:\n            - img \"Stage 0 of 3\" [ref=f2e54]\n            - button \"Upgrade Tires to stage 1\" [ref=f2e59] [cursor=pointer]\n          - group \"Brakes\" [ref=f2e60]:\n            - img \"Stage 0 of 3\" [ref=f2e62]\n            - button \"Upgrade Brakes to stage 1\" [ref=f2e67] [cursor=pointer]\n          - group \"Suspension\" [ref=f2e68]:\n            - img \"Stage 0 of 3\" [ref=f2e70]\n            - button \"Upgrade Suspension to stage 1\" [ref=f2e75] [cursor=pointer]\n        - region \"Setup sheet\" [ref=f2e76]:\n          - heading \"Setup sheet\" [level=2] [ref=f2e77]\n          - generic [ref=f2e78]:\n            - generic [ref=f2e79]: Acceleration\n            - meter \"Acceleration\" [ref=f2e80]\n            - generic [ref=f2e82]: 5.0 m/s²\n          - generic [ref=f2e83]:\n            - generic [ref=f2e84]: Braking\n            - meter \"Braking\" [ref=f2e85]\n            - generic [ref=f2e87]: 8.0 m/s²\n          - generic [ref=f2e88]:\n            - generic [ref=f2e89]: Top speed\n            - meter \"Top speed\" [ref=f2e90]\n            - generic [ref=f2e92]: 169 km/h\n          - generic [ref=f2e93]:\n            - generic [ref=f2e94]: Grip\n            - meter \"Grip\" [ref=f2e95]\n            - generic [ref=f2e97]: 100%\n          - generic [ref=f2e98]:\n            - generic [ref=f2e99]: Lane change\n            - meter \"Lane change\" [ref=f2e100]\n            - generic [ref=f2e102]: 30 steps\n          - figure \"Reference lap\" [ref=f2e103]:\n            - img \"Reference marker\" [ref=f2e112]\n            - generic [ref=f2e113]:\n              - generic [ref=f2e114]: S1 −1.083 s\n              - generic [ref=f2e115]: S2 −0.200 s\n              - generic [ref=f2e116]: S3 −0.601 s\n            - paragraph [ref=f2e117]: Predicted lap 0:44.383 0:46.267\n            - paragraph [ref=f2e118]: Cost −300 coins\n            - paragraph [ref=f2e119]: −1.884 s, mostly S1\n      - status \"Garage updates\" [ref=f2e120]\n      - generic [ref=f2e121]:\n        - link \"Coin history\" [ref=f2e122] [cursor=pointer]:\n          - /url: /garage/coins\n        - link \"Dealer\" [ref=f2e123] [cursor=pointer]:\n          - /url: /garage/dealer\n        - link \"Save my garage\" [ref=f2e124] [cursor=pointer]:\n          - /url: /sign-in"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const fig=document.querySelector('figure[aria-label=\"Reference lap\"]'); if(!fig) return null; return [...fig.querySelectorAll('*')].map(e=>{const c=getComputedStyle(e);return {tag:e.tagName,text:e.textContent?.trim(),color:c.color,textDecoration:c.textDecorationLine}}).filter(x=>/^S[123]/.test(x.text||'')||/0:\\d\\d\\.\\d{3}/.test(x.text||'')); }"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"tag\": \"DIV\",\n    \"text\": \"S1 −1.083 sS2 −0.200 sS3 −0.601 s\",\n    \"color\": \"rgb(23, 21, 15)\",\n    \"textDecoration\": \"none\"\n  },\n  {\n    \"tag\": \"SPAN\",\n    \"text\": \"S1 −1.083 s\",\n    \"color\": \"rgb(23, 21, 15)\",\n    \"textDecoration\": \"none\"\n  },\n  {\n    \"tag\": \"SPAN\",\n    \"text\": \"S2 −0.200 s\",\n    \"color\": \"rgb(23, 21, 15)\",\n    \"textDecoration\": \"none\"\n  },\n  {\n    \"tag\": \"SPAN\",\n    \"text\": \"S3 −0.601 s\",\n    \"color\": \"rgb(23, 21, 15)\",\n    \"textDecoration\": \"none\"\n  },\n  {\n    \"tag\": \"P\",\n    \"text\": \"Predicted lap 0:44.383 0:46.267\",\n    \"color\": \"rgb(23, 21, 15)\",\n    \"textDecoration\": \"none\"\n  },\n  {\n    \"tag\": \"SPAN\",\n    \"text\": \"0:46.267\",\n    \"color\": \"rgb(65, 60, 46)\",\n    \"textDecoration\": \"line-through\"\n  }\n]"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Reference lap figure",
  "target": "f2e103",
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of Reference lap figure](evidence/reduced/element-2026-11-07T18-31-55-670Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
