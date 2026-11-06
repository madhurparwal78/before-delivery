
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Fluxseal\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e3]:\n  - heading \"Fluxseal\" [level=1] [ref=e4]\n  - generic [ref=e5]:\n    - generic [ref=e6]:\n      - text: Email\n      - textbox \"Email\" [active] [ref=e7]\n    - generic [ref=e8]:\n      - text: Password\n      - textbox \"Password\" [ref=e9]\n    - button \"Sign in\" [ref=e10] [cursor=pointer]",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T08-09-12-210Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Fluxseal\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e3]:\n  - heading \"Fluxseal\" [level=1] [ref=e4]\n  - generic [ref=e5]:\n    - generic [ref=e6]:\n      - text: Email\n      - textbox \"Email\" [active] [ref=e7]\n    - generic [ref=e8]:\n      - text: Password\n      - textbox \"Password\" [ref=e9]\n    - button \"Sign in\" [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e7",
      "name": "Email",
      "type": "textbox",
      "value": "hal@levelmoor.example"
    },
    {
      "target": "e9",
      "name": "Password",
      "type": "textbox",
      "value": "moss-and-tower-26"
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
  "target": "e10"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/projects\n- Page Title: Fluxseal\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - navigation \"Main\" [ref=e11]:\n    - generic [ref=e12]: Fluxseal\n    - link \"Projects\" [ref=e14] [cursor=pointer]:\n      - /url: /projects\n    - button \"Sign out\" [ref=e15] [cursor=pointer]\n  - main [ref=e16]:\n    - generic [ref=e17]:\n      - heading \"Projects\" [level=1] [ref=e18]\n      - table \"Projects\" [ref=e20]:\n        - rowgroup [ref=e21]:\n          - row [ref=e22]:\n            - columnheader \"Project\" [ref=e23]\n            - columnheader \"Kind\" [ref=e24]\n            - columnheader \"Sealed net tCO2e\" [ref=e25]\n            - columnheader \"Buffer tCO2e\" [ref=e26]\n            - columnheader \"Intact\" [ref=e27]\n            - columnheader \"Broken\" [ref=e28]\n            - columnheader \"Superseded\" [ref=e29]\n        - rowgroup [ref=e30]:\n          - row [ref=e31]:\n            - cell [ref=e32]:\n              - link \"Blackmere Moss\" [ref=e33] [cursor=pointer]:\n                - /url: /projects/blackmere-moss\n            - cell \"peatland rewetting\" [ref=e34]\n            - cell \"-2.258\" [ref=e35]\n            - cell \"0.398\" [ref=e36]\n            - cell \"2\" [ref=e37]\n            - cell \"0\" [ref=e38]\n            - cell \"0\" [ref=e39]\n          - row [ref=e40]:\n            - cell [ref=e41]:\n              - link \"Hollin Wood\" [ref=e42] [cursor=pointer]:\n                - /url: /projects/hollin-wood\n            - cell \"managed forest\" [ref=e43]\n            - cell \"0.000\" [ref=e44]\n            - cell \"0.000\" [ref=e45]\n            - cell \"0\" [ref=e46]\n            - cell \"0\" [ref=e47]\n            - cell \"0\" [ref=e48]\n          - row [ref=e49]:\n            - cell [ref=e50]:\n              - link \"Saltings Reach\" [ref=e51] [cursor=pointer]:\n                - /url: /projects/saltings-reach\n            - cell \"wetland restoration\" [ref=e52]\n            - cell \"0.000\" [ref=e53]\n            - cell \"0.000\" [ref=e54]\n            - cell \"0\" [ref=e55]\n            - cell \"0\" [ref=e56]\n            - cell \"0\" [ref=e57]"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/projects/blackmere-moss?from=2026-06-01&to=2026-06-14&start=202606010000&end=202606030000&sensors=BM-S1,BM-S2,BM-S3,BM-S4,BM-T1,BM-T2"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/projects/blackmere-moss?from=2026-06-01&to=2026-06-14&start=202606010000&end=202606030000&sensors=BM-S1,BM-S2,BM-S3,BM-S4,BM-T1,BM-T2\n- Page Title: Fluxseal",
  "snapshot": "- generic [ref=f1e2]:\n  - navigation \"Main\" [ref=f1e3]:\n    - generic [ref=f1e4]: Fluxseal\n    - link \"Projects\" [ref=f1e6] [cursor=pointer]:\n      - /url: /projects\n    - button \"Sign out\" [ref=f1e7] [cursor=pointer]\n  - main [ref=f1e8]"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/projects/blackmere-moss?from=2026-06-01&to=2026-06-02&start=202606010000&end=202606030000&sensors=BM-S1,BM-S2,BM-S3,BM-S4,BM-T1,BM-T2"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/projects/blackmere-moss?from=2026-06-01&to=2026-06-02&start=202606010000&end=202606030000&sensors=BM-S1,BM-S2,BM-S3,BM-S4,BM-T1,BM-T2\n- Page Title: Fluxseal",
  "snapshot": "- generic [ref=f2e2]:\n  - navigation \"Main\" [ref=f2e3]:\n    - generic [ref=f2e4]: Fluxseal\n    - link \"Projects\" [ref=f2e6] [cursor=pointer]:\n      - /url: /projects\n    - button \"Sign out\" [ref=f2e7] [cursor=pointer]\n  - main [ref=f2e8]"
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
  "page": "- Page URL: http://127.0.0.1:4173/projects/blackmere-moss?from=2026-06-01&to=2026-06-02&start=202606010000&end=202606030000&sensors=BM-S1,BM-S2,BM-S3,BM-S4,BM-T1,BM-T2\n- Page Title: Fluxseal",
  "inlineSnapshot": "- generic [ref=f2e2]:\n  - navigation \"Main\" [ref=f2e3]:\n    - generic [ref=f2e4]: Fluxseal\n    - link \"Projects\" [ref=f2e6] [cursor=pointer]:\n      - /url: /projects\n    - button \"Sign out\" [ref=f2e7] [cursor=pointer]\n  - main [ref=f2e8]:\n    - heading \"Blackmere Moss\" [level=1] [ref=f2e9]\n    - paragraph [ref=f2e10]: peatland rewetting · coverage floor 60.0% · buffer 15.0%\n    - status \"Workspace status\" [ref=f2e11]: Coverage 41.7%, net -0.873 tCO2e. Below the 60.0% floor.\n    - generic [ref=f2e12]:\n      - group \"Flux timeline\" [ref=f2e14]:\n        - generic [ref=f2e15]:\n          - generic [ref=f2e16]:\n            - text: From\n            - textbox \"From\" [ref=f2e17]: 2026-06-01\n          - generic [ref=f2e18]:\n            - text: To\n            - textbox \"To\" [ref=f2e19]: 2026-06-02\n          - button \"Apply dates\" [ref=f2e20] [cursor=pointer]\n        - list \"Daily net CO2e\" [ref=f2e21]:\n          - listitem \"2026-06-01 -0.437 tCO2e\" [ref=f2e22]\n          - listitem \"2026-06-02 -0.437 tCO2e\" [ref=f2e25]\n        - separator \"Zero rule\" [ref=f2e28]\n        - generic [ref=f2e33]:\n          - slider \"Interval start\"\n          - slider \"Interval position\"\n          - slider \"Interval end\"\n          - button \"Previous interval\" [ref=f2e34] [cursor=pointer]\n          - button \"Next interval\" [ref=f2e35] [cursor=pointer]\n      - group \"Coverage map\" [ref=f2e37]:\n        - heading \"Coverage map\" [level=2] [ref=f2e38]\n        - img \"Boundary map with sensor footprints\" [ref=f2e39]:\n          - generic [ref=f2e40]:\n            - generic [ref=f2e41]: 0 m\n            - generic [ref=f2e42]: 200 m\n            - generic [ref=f2e43]: 400 m\n            - generic [ref=f2e44]: 600 m\n            - generic [ref=f2e45]: 800 m\n            - generic [ref=f2e46]: 1000 m\n            - generic [ref=f2e47]: 0 m\n            - generic [ref=f2e48]: 200 m\n            - generic [ref=f2e49]: 400 m\n            - generic [ref=f2e50]: 600 m\n        - generic [ref=f2e61]:\n          - button \"BM-S1 footprint\" [pressed] [ref=f2e62] [cursor=pointer]\n          - button \"BM-S2 footprint\" [pressed] [ref=f2e63] [cursor=pointer]\n          - button \"BM-S3 footprint\" [pressed] [ref=f2e64] [cursor=pointer]\n          - button \"BM-S4 footprint\" [pressed] [ref=f2e65] [cursor=pointer]\n          - button \"BM-T1 footprint\" [pressed] [ref=f2e66] [cursor=pointer]\n          - button \"BM-T2 footprint\" [pressed] [ref=f2e67] [cursor=pointer]\n      - group \"Sensors\" [ref=f2e68]:\n        - heading \"Sensors\" [level=2] [ref=f2e69]\n        - generic [ref=f2e70]:\n          - checkbox \"BM-S1\" [checked] [ref=f2e71]\n          - text: BM-S1 Satellite cell\n        - generic [ref=f2e72]:\n          - checkbox \"BM-S2\" [checked] [ref=f2e73]\n          - text: BM-S2 Satellite cell\n        - generic [ref=f2e74]:\n          - checkbox \"BM-S3\" [checked] [ref=f2e75]\n          - text: BM-S3 Satellite cell\n        - generic [ref=f2e76]:\n          - checkbox \"BM-S4\" [checked] [ref=f2e77]\n          - text: BM-S4 Satellite cell\n        - generic [ref=f2e78]:\n          - checkbox \"BM-T1\" [checked] [ref=f2e79]\n          - text: BM-T1 Tower\n        - generic [ref=f2e80]:\n          - checkbox \"BM-T2\" [checked] [ref=f2e81]\n          - text: BM-T2 Tower\n      - region \"Figure\" [ref=f2e82]:\n        - generic [ref=f2e83]:\n          - generic [aria-hidden] [ref=f2e84]: 41.7%\n          - generic [aria-hidden] [ref=f2e85]: \"-0.873\"\n          - button \"Seal figure\" [disabled] [ref=f2e86]\n          - button \"Figure details\" [ref=f2e87] [cursor=pointer]\n        - heading \"Figure\" [level=2] [ref=f2e88]\n        - generic [ref=f2e90]:\n          - term [ref=f2e91]: Interval\n          - definition [ref=f2e92]: 2026-06-01 00:00 UTC to 2026-06-03 00:00 UTC\n          - term [ref=f2e93]: Coverage\n          - definition [ref=f2e94]:\n            - generic [ref=f2e95]: 41.7%\n          - term [ref=f2e96]: Net tCO2e\n          - definition [ref=f2e97]:\n            - generic [ref=f2e98]: \"-0.873\"\n          - term [ref=f2e100]: CO2 tCO2e\n          - definition [ref=f2e101]: \"-1.255\"\n          - term [ref=f2e102]: CH4 tCO2e\n          - definition [ref=f2e103]: \"0.382\"\n          - term [ref=f2e104]: Buffer tCO2e\n          - definition [ref=f2e105]: \"0.131\"\n          - term [ref=f2e106]: Credited tCO2e\n          - definition [ref=f2e107]: \"-0.742\"\n          - term [ref=f2e108]: Readings\n          - definition [ref=f2e109]: \"192\"\n          - generic [ref=f2e110]:\n            - meter \"Coverage\" [ref=f2e112]\n            - generic [ref=f2e114]: Floor 60.0%\n        - button \"Unit breakdown\" [ref=f2e116] [cursor=pointer]\n        - paragraph [ref=f2e117]: Coverage 41.7% is below this project's 60.0% floor, so this figure cannot be sealed.\n    - generic [ref=f2e118]:\n      - region \"Project balance\" [ref=f2e119]:\n        - heading \"Project balance\" [level=2] [ref=f2e120]\n        - generic [ref=f2e121]:\n          - generic [ref=f2e122]:\n            - generic [ref=f2e123]: Sealed net tCO2e\n            - generic [ref=f2e124]: \"-2.258\"\n          - generic [ref=f2e125]:\n            - generic [ref=f2e126]: Buffer tCO2e\n            - generic [ref=f2e127]: \"0.398\"\n          - generic [ref=f2e128]:\n            - generic [ref=f2e129]: Intact figures\n            - generic [ref=f2e130]: \"2\"\n          - generic [ref=f2e131]:\n            - generic [ref=f2e132]: Broken figures\n            - generic [ref=f2e133]: \"0\"\n          - generic [ref=f2e134]:\n            - generic [ref=f2e135]: Superseded figures\n            - generic [ref=f2e136]: \"0\"\n      - generic [ref=f2e137]:\n        - heading \"Figures\" [level=2] [ref=f2e138]\n        - table \"Figures\" [ref=f2e140]:\n          - rowgroup [ref=f2e141]:\n            - row \"Figure Interval Net tCO2e Buffer tCO2e Credited tCO2e Coverage Status Checked at\" [ref=f2e142]\n          - rowgroup [ref=f2e151]:\n            - row \"BM-F0002 2026-06-09 to 2026-06-10 -1.328 0.199 -1.129 85.0 Sealed 2026-11-05 08:11:59 UTC\" [ref=f2e152]\n            - row \"BM-F0001 2026-06-08 to 2026-06-09 -1.328 0.199 -1.129 85.0 Sealed 2026-11-05 08:06:49 UTC\" [ref=f2e163]\n      - generic [ref=f2e174]:\n        - heading \"Sealed-tonnes ledger\" [level=2] [ref=f2e175]\n        - table \"Sealed-tonnes ledger\" [ref=f2e177]:\n          - rowgroup [ref=f2e178]:\n            - row \"Entry Figure Kind tCO2e Recorded at\" [ref=f2e179]\n          - rowgroup [ref=f2e185]:\n            - row \"led-51ed0f08- BM-F0001 Issuance -1.328 2026-11-05 08:05:48 UTC\" [ref=f2e186]\n            - row \"led-a3cf7b22- BM-F0001 Buffer 0.199 2026-11-05 08:05:48 UTC\" [ref=f2e192]\n            - row \"led-00020120- BM-F0002 Issuance -1.328 2026-11-05 08:10:25 UTC\" [ref=f2e198]\n            - row \"led-f582330d- BM-F0002 Buffer 0.199 2026-11-05 08:10:25 UTC\" [ref=f2e204]\n            - row \"Balance -2.258\" [ref=f2e210]"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Coverage map",
  "target": "[aria-label='Coverage map']",
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of Coverage map](evidence/reduced/element-2026-11-05T08-13-12-896Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const g=document.querySelector('[aria-label=\"Coverage map\"]'); return {boundary:{fill:getComputedStyle(g.querySelector('.map-boundary')).fill},covered:[...g.querySelectorAll('.map-covered')].map(e=>({fill:getComputedStyle(e).fill,points:e.getAttribute('points')})),pattern:g.querySelector('pattern')?.outerHTML}}"
}
```
- Result
```json
{
  "result": "{\n  \"boundary\": {\n    \"fill\": \"rgb(251, 248, 240)\"\n  },\n  \"covered\": [\n    {\n      \"fill\": \"rgb(169, 191, 160)\",\n      \"points\": \"116.7,343.3 343.3,343.3 343.3,116.7 116.7,116.7\"\n    },\n    {\n      \"fill\": \"rgb(169, 191, 160)\",\n      \"points\": \"286.7,286.7 513.3,286.7 513.3,116.7 286.7,116.7\"\n    }\n  ],\n  \"pattern\": \"<pattern id=\\\"hatch\\\" width=\\\"7\\\" height=\\\"7\\\" patternUnits=\\\"userSpaceOnUse\\\" patternTransform=\\\"rotate(45)\\\"><rect width=\\\"2\\\" height=\\\"7\\\" fill=\\\"#47524a\\\"></rect></pattern>\"\n}"
}
```
