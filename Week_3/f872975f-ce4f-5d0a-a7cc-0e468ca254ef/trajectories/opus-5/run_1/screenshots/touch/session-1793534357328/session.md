
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Kerfwell Rack",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Rack\" [ref=e6] [cursor=pointer]:\n        - /url: /\n      - link \"Sign in\" [ref=e7] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\" [ref=e8]\n  - main [ref=e9]:\n    - generic [ref=e10]:\n      - heading \"The rack\" [level=1] [ref=e11]\n      - button \"Filters\" [ref=e13] [cursor=pointer]\n      - status \"Rack count\" [ref=e14]: 8 boards on the rack\n      - list \"Rack\" [ref=e15]:\n        - listitem [ref=e16]:\n          - img \"Board KW-0001\" [ref=e18]\n          - generic [ref=e24]:\n            - link \"KW-0001\" [ref=e25] [cursor=pointer]:\n              - /url: /boards/KW-0001\n            - generic [ref=e26]: White oak · Hollis Road dairy barn\n            - generic [ref=e27]: 2440 mm × 190 mm × 32 mm\n            - generic [ref=e28]: 6.29 bd ft · $69.15\n        - listitem [ref=e29]:\n          - img \"Board KW-0002\" [ref=e31]\n          - generic [ref=e35]:\n            - link \"KW-0002\" [ref=e36] [cursor=pointer]:\n              - /url: /boards/KW-0002\n            - generic [ref=e37]: Black walnut · Marsh Lane farmhouse\n            - generic [ref=e38]: 2100 mm × 305 mm × 45 mm\n            - generic [ref=e39]: 12.21 bd ft · $293.14\n        - listitem [ref=e40]:\n          - img \"Board KW-0003\" [ref=e42]\n          - generic [ref=e47]:\n            - link \"KW-0003\" [ref=e48] [cursor=pointer]:\n              - /url: /boards/KW-0003\n            - generic [ref=e49]: Black walnut · Marsh Lane farmhouse\n            - generic [ref=e50]: 1830 mm × 210 mm × 25 mm\n            - generic [ref=e51]: 4.07 bd ft · $75.32\n        - listitem [ref=e52]:\n          - img \"Board KW-0004\" [ref=e54]\n          - generic [ref=e60]:\n            - link \"KW-0004\" [ref=e61] [cursor=pointer]:\n              - /url: /boards/KW-0004\n            - generic [ref=e62]: Douglas fir · Pell Street shoe factory\n            - generic [ref=e63]: 4880 mm × 235 mm × 70 mm\n            - generic [ref=e64]: 34.02 bd ft · $170.10\n        - listitem [ref=e65]:\n          - img \"Board KW-0005\" [ref=e67]\n          - generic [ref=e69]:\n            - link \"KW-0005\" [ref=e70] [cursor=pointer]:\n              - /url: /boards/KW-0005\n            - generic [ref=e71]: Heart pine · Pell Street shoe factory\n            - generic [ref=e72]: 3050 mm × 140 mm × 38 mm\n            - generic [ref=e73]: 6.88 bd ft · $110.02\n        - listitem [ref=e74]:\n          - img \"Board KW-0006\" [ref=e76]\n          - generic [ref=e81]:\n            - link \"KW-0006\" [ref=e82] [cursor=pointer]:\n              - /url: /boards/KW-0006\n            - generic [ref=e83]: Chestnut · Marsh Lane farmhouse\n            - generic [ref=e84]: 2740 mm × 250 mm × 28 mm\n            - generic [ref=e85]: 8.13 bd ft · $178.82\n        - listitem [ref=e86]:\n          - img \"Board KW-0007\" [ref=e88]\n          - generic [ref=e94]:\n            - link \"KW-0007\" [ref=e95] [cursor=pointer]:\n              - /url: /boards/KW-0007\n            - generic [ref=e96]: White oak · Hollis Road dairy barn\n            - generic [ref=e97]: 3660 mm × 200 mm × 50 mm\n            - generic [ref=e98]: 15.51 bd ft · $124.08\n        - listitem [ref=e99]:\n          - img \"Board KW-0010\" [ref=e101]\n          - generic [ref=e103]:\n            - link \"KW-0010\" [ref=e104] [cursor=pointer]:\n              - /url: /boards/KW-0010\n            - generic [ref=e105]: Black walnut · Marsh Lane farmhouse\n            - generic [ref=e106]: 1220 mm × 330 mm × 50 mm\n            - generic [ref=e107]: 8.53 bd ft · $204.73"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Kerfwell Rack",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Rack\" [ref=e6] [cursor=pointer]:\n        - /url: /\n      - link \"Sign in\" [ref=e7] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\" [ref=e8]\n  - main [ref=e9]:\n    - generic [ref=e10]:\n      - heading \"The rack\" [level=1] [ref=e11]\n      - button \"Filters\" [ref=e13] [cursor=pointer]\n      - status \"Rack count\" [ref=e14]: 8 boards on the rack\n      - list \"Rack\" [ref=e15]:\n        - listitem [ref=e16]\n        - listitem [ref=e29]\n        - listitem [ref=e40]\n        - listitem [ref=e52]\n        - listitem [ref=e65]\n        - listitem [ref=e74]\n        - listitem [ref=e86]\n        - listitem [ref=e99]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Filters",
  "target": "e13"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Kerfwell Rack",
  "snapshot": "- generic [ref=e1]:\n  - generic [ref=e2]:\n    - banner [ref=e3]:\n      - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n        - /url: /\n      - navigation [ref=e5]:\n        - link \"Rack\" [ref=e6] [cursor=pointer]:\n          - /url: /\n        - link \"Sign in\" [ref=e7] [cursor=pointer]:\n          - /url: /sign-in\n    - status \"Service notice\" [ref=e8]\n    - main [ref=e9]:\n      - generic [ref=e10]:\n        - heading \"The rack\" [level=1] [ref=e11]\n        - button \"Filters\" [ref=e13] [cursor=pointer]\n        - status \"Rack count\" [ref=e14]: 8 boards on the rack\n        - list \"Rack\" [ref=e15]:\n          - listitem [ref=e16]:\n            - img \"Board KW-0001\" [ref=e18]\n            - generic [ref=e24]:\n              - link \"KW-0001\" [ref=e25] [cursor=pointer]:\n                - /url: /boards/KW-0001\n              - generic [ref=e26]: White oak · Hollis Road dairy barn\n              - generic [ref=e27]: 2440 mm × 190 mm × 32 mm\n              - generic [ref=e28]: 6.29 bd ft · $69.15\n          - listitem [ref=e29]:\n            - img \"Board KW-0002\" [ref=e31]\n            - generic [ref=e35]:\n              - link \"KW-0002\" [ref=e36] [cursor=pointer]:\n                - /url: /boards/KW-0002\n              - generic [ref=e37]: Black walnut · Marsh Lane farmhouse\n              - generic [ref=e38]: 2100 mm × 305 mm × 45 mm\n              - generic [ref=e39]: 12.21 bd ft · $293.14\n          - listitem [ref=e40]:\n            - img \"Board KW-0003\" [ref=e42]\n            - generic [ref=e47]:\n              - link \"KW-0003\" [ref=e48] [cursor=pointer]:\n                - /url: /boards/KW-0003\n              - generic [ref=e49]: Black walnut · Marsh Lane farmhouse\n              - generic [ref=e50]: 1830 mm × 210 mm × 25 mm\n              - generic [ref=e51]: 4.07 bd ft · $75.32\n          - listitem [ref=e52]:\n            - img \"Board KW-0004\" [ref=e54]\n            - generic [ref=e60]:\n              - link \"KW-0004\" [ref=e61] [cursor=pointer]:\n                - /url: /boards/KW-0004\n              - generic [ref=e62]: Douglas fir · Pell Street shoe factory\n              - generic [ref=e63]: 4880 mm × 235 mm × 70 mm\n              - generic [ref=e64]: 34.02 bd ft · $170.10\n          - listitem [ref=e65]:\n            - img \"Board KW-0005\" [ref=e67]\n            - generic [ref=e69]:\n              - link \"KW-0005\" [ref=e70] [cursor=pointer]:\n                - /url: /boards/KW-0005\n              - generic [ref=e71]: Heart pine · Pell Street shoe factory\n              - generic [ref=e72]: 3050 mm × 140 mm × 38 mm\n              - generic [ref=e73]: 6.88 bd ft · $110.02\n          - listitem [ref=e74]:\n            - img \"Board KW-0006\" [ref=e76]\n            - generic [ref=e81]:\n              - link \"KW-0006\" [ref=e82] [cursor=pointer]:\n                - /url: /boards/KW-0006\n              - generic [ref=e83]: Chestnut · Marsh Lane farmhouse\n              - generic [ref=e84]: 2740 mm × 250 mm × 28 mm\n              - generic [ref=e85]: 8.13 bd ft · $178.82\n          - listitem [ref=e86]:\n            - img \"Board KW-0007\" [ref=e88]\n            - generic [ref=e94]:\n              - link \"KW-0007\" [ref=e95] [cursor=pointer]:\n                - /url: /boards/KW-0007\n              - generic [ref=e96]: White oak · Hollis Road dairy barn\n              - generic [ref=e97]: 3660 mm × 200 mm × 50 mm\n              - generic [ref=e98]: 15.51 bd ft · $124.08\n          - listitem [ref=e99]:\n            - img \"Board KW-0010\" [ref=e101]\n            - generic [ref=e103]:\n              - link \"KW-0010\" [ref=e104] [cursor=pointer]:\n                - /url: /boards/KW-0010\n              - generic [ref=e105]: Black walnut · Marsh Lane farmhouse\n              - generic [ref=e106]: 1220 mm × 330 mm × 50 mm\n              - generic [ref=e107]: 8.53 bd ft · $204.73\n  - dialog \"Filters\" [ref=e109]:\n    - heading \"Filters\" [level=2] [ref=e110]\n    - generic [ref=e111]:\n      - group \"Species\" [ref=e112]:\n        - generic [ref=e114]:\n          - checkbox \"Black walnut\" [active] [ref=e115]\n          - generic [ref=e116]: Black walnut\n        - generic [ref=e117]:\n          - checkbox \"Chestnut\" [ref=e118]\n          - generic [ref=e119]: Chestnut\n        - generic [ref=e120]:\n          - checkbox \"Douglas fir\" [ref=e121]\n          - generic [ref=e122]: Douglas fir\n        - generic [ref=e123]:\n          - checkbox \"Heart pine\" [ref=e124]\n          - generic [ref=e125]: Heart pine\n        - generic [ref=e126]:\n          - checkbox \"White oak\" [ref=e127]\n          - generic [ref=e128]: White oak\n      - group \"Grade\" [ref=e129]:\n        - generic [ref=e131]:\n          - checkbox \"Select\" [ref=e132]\n          - generic [ref=e133]: Select\n        - generic [ref=e134]:\n          - checkbox \"Character\" [ref=e135]\n          - generic [ref=e136]: Character\n        - generic [ref=e137]:\n          - checkbox \"Rustic\" [ref=e138]\n          - generic [ref=e139]: Rustic\n      - generic [ref=e140]:\n        - generic [ref=e141]: Minimum length (mm)\n        - textbox \"Minimum length (mm)\" [ref=e142]\n      - generic [ref=e143]:\n        - generic [ref=e144]: Minimum clear run (mm)\n        - textbox \"Minimum clear run (mm)\" [ref=e145]\n      - generic [ref=e146]:\n        - generic [ref=e147]: Salvage lot\n        - combobox \"Salvage lot\" [ref=e148]:\n          - option \"All lots\" [selected]\n          - option \"Hollis Road dairy barn\"\n          - option \"Pell Street shoe factory\"\n          - option \"Marsh Lane farmhouse\"\n    - button \"Done\" [ref=e149] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Kerfwell Rack",
  "inlineSnapshot": "- generic [ref=e1]:\n  - generic [ref=e2]:\n    - banner [ref=e3]:\n      - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n        - /url: /\n      - navigation [ref=e5]:\n        - link \"Rack\" [ref=e6] [cursor=pointer]:\n          - /url: /\n        - link \"Sign in\" [ref=e7] [cursor=pointer]:\n          - /url: /sign-in\n    - status \"Service notice\" [ref=e8]\n    - main [ref=e9]:\n      - generic [ref=e10]:\n        - heading \"The rack\" [level=1] [ref=e11]\n        - button \"Filters\" [ref=e13] [cursor=pointer]\n        - status \"Rack count\" [ref=e14]: 8 boards on the rack\n        - list \"Rack\" [ref=e15]:\n          - listitem [ref=e16]\n          - listitem [ref=e29]\n          - listitem [ref=e40]\n          - listitem [ref=e52]\n          - listitem [ref=e65]\n          - listitem [ref=e74]\n          - listitem [ref=e86]\n          - listitem [ref=e99]\n  - dialog \"Filters\" [ref=e109]:\n    - heading \"Filters\" [level=2] [ref=e110]\n    - generic [ref=e111]:\n      - group \"Species\" [ref=e112]:\n        - generic [ref=e114]:\n          - checkbox \"Black walnut\" [active] [ref=e115]\n          - generic [ref=e116]: Black walnut\n        - generic [ref=e117]:\n          - checkbox \"Chestnut\" [ref=e118]\n          - generic [ref=e119]: Chestnut\n        - generic [ref=e120]:\n          - checkbox \"Douglas fir\" [ref=e121]\n          - generic [ref=e122]: Douglas fir\n        - generic [ref=e123]:\n          - checkbox \"Heart pine\" [ref=e124]\n          - generic [ref=e125]: Heart pine\n        - generic [ref=e126]:\n          - checkbox \"White oak\" [ref=e127]\n          - generic [ref=e128]: White oak\n      - group \"Grade\" [ref=e129]:\n        - generic [ref=e131]:\n          - checkbox \"Select\" [ref=e132]\n          - generic [ref=e133]: Select\n        - generic [ref=e134]:\n          - checkbox \"Character\" [ref=e135]\n          - generic [ref=e136]: Character\n        - generic [ref=e137]:\n          - checkbox \"Rustic\" [ref=e138]\n          - generic [ref=e139]: Rustic\n      - generic [ref=e140]:\n        - generic [ref=e141]: Minimum length (mm)\n        - textbox \"Minimum length (mm)\" [ref=e142]\n      - generic [ref=e143]:\n        - generic [ref=e144]: Minimum clear run (mm)\n        - textbox \"Minimum clear run (mm)\" [ref=e145]\n      - generic [ref=e146]:\n        - generic [ref=e147]: Salvage lot\n        - combobox \"Salvage lot\" [ref=e148]:\n          - option \"All lots\" [selected]\n          - option \"Hollis Road dairy barn\"\n          - option \"Pell Street shoe factory\"\n          - option \"Marsh Lane farmhouse\"\n    - button \"Done\" [ref=e149] [cursor=pointer]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const d=document.querySelector('[role=\"dialog\"]'), b=[...d.querySelectorAll('button')].find(e=>e.textContent.trim()==='Done'); const out=e=>{const s=getComputedStyle(e);return {boxShadow:s.boxShadow,backgroundImage:s.backgroundImage,backgroundColor:s.backgroundColor}}; return {dialog:out(d),done:out(b)} }"
}
```
- Result
```json
{
  "result": "{\n  \"dialog\": {\n    \"boxShadow\": \"none\",\n    \"backgroundImage\": \"none\",\n    \"backgroundColor\": \"rgb(246, 241, 228)\"\n  },\n  \"done\": {\n    \"boxShadow\": \"none\",\n    \"backgroundImage\": \"none\",\n    \"backgroundColor\": \"rgb(181, 64, 31)\"\n  }\n}"
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
  "result": "- [Screenshot of viewport](evidence/touch/page-2026-11-01T11-59-40-846Z.png)",
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
  "element": "Done",
  "target": "e149"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Kerfwell Rack",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Rack\" [ref=e6] [cursor=pointer]:\n        - /url: /\n      - link \"Sign in\" [ref=e7] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\" [ref=e8]\n  - main [ref=e9]:\n    - generic [ref=e10]:\n      - heading \"The rack\" [level=1] [ref=e11]\n      - button \"Filters\" [active] [ref=e13] [cursor=pointer]\n      - status \"Rack count\" [ref=e14]: 8 boards on the rack\n      - list \"Rack\" [ref=e15]:\n        - listitem [ref=e16]:\n          - img \"Board KW-0001\" [ref=e18]\n          - generic [ref=e24]:\n            - link \"KW-0001\" [ref=e25] [cursor=pointer]:\n              - /url: /boards/KW-0001\n            - generic [ref=e26]: White oak · Hollis Road dairy barn\n            - generic [ref=e27]: 2440 mm × 190 mm × 32 mm\n            - generic [ref=e28]: 6.29 bd ft · $69.15\n        - listitem [ref=e29]:\n          - img \"Board KW-0002\" [ref=e31]\n          - generic [ref=e35]:\n            - link \"KW-0002\" [ref=e36] [cursor=pointer]:\n              - /url: /boards/KW-0002\n            - generic [ref=e37]: Black walnut · Marsh Lane farmhouse\n            - generic [ref=e38]: 2100 mm × 305 mm × 45 mm\n            - generic [ref=e39]: 12.21 bd ft · $293.14\n        - listitem [ref=e40]:\n          - img \"Board KW-0003\" [ref=e42]\n          - generic [ref=e47]:\n            - link \"KW-0003\" [ref=e48] [cursor=pointer]:\n              - /url: /boards/KW-0003\n            - generic [ref=e49]: Black walnut · Marsh Lane farmhouse\n            - generic [ref=e50]: 1830 mm × 210 mm × 25 mm\n            - generic [ref=e51]: 4.07 bd ft · $75.32\n        - listitem [ref=e52]:\n          - img \"Board KW-0004\" [ref=e54]\n          - generic [ref=e60]:\n            - link \"KW-0004\" [ref=e61] [cursor=pointer]:\n              - /url: /boards/KW-0004\n            - generic [ref=e62]: Douglas fir · Pell Street shoe factory\n            - generic [ref=e63]: 4880 mm × 235 mm × 70 mm\n            - generic [ref=e64]: 34.02 bd ft · $170.10\n        - listitem [ref=e65]:\n          - img \"Board KW-0005\" [ref=e67]\n          - generic [ref=e69]:\n            - link \"KW-0005\" [ref=e70] [cursor=pointer]:\n              - /url: /boards/KW-0005\n            - generic [ref=e71]: Heart pine · Pell Street shoe factory\n            - generic [ref=e72]: 3050 mm × 140 mm × 38 mm\n            - generic [ref=e73]: 6.88 bd ft · $110.02\n        - listitem [ref=e74]:\n          - img \"Board KW-0006\" [ref=e76]\n          - generic [ref=e81]:\n            - link \"KW-0006\" [ref=e82] [cursor=pointer]:\n              - /url: /boards/KW-0006\n            - generic [ref=e83]: Chestnut · Marsh Lane farmhouse\n            - generic [ref=e84]: 2740 mm × 250 mm × 28 mm\n            - generic [ref=e85]: 8.13 bd ft · $178.82\n        - listitem [ref=e86]:\n          - img \"Board KW-0007\" [ref=e88]\n          - generic [ref=e94]:\n            - link \"KW-0007\" [ref=e95] [cursor=pointer]:\n              - /url: /boards/KW-0007\n            - generic [ref=e96]: White oak · Hollis Road dairy barn\n            - generic [ref=e97]: 3660 mm × 200 mm × 50 mm\n            - generic [ref=e98]: 15.51 bd ft · $124.08\n        - listitem [ref=e99]:\n          - img \"Board KW-0010\" [ref=e101]\n          - generic [ref=e103]:\n            - link \"KW-0010\" [ref=e104] [cursor=pointer]:\n              - /url: /boards/KW-0010\n            - generic [ref=e105]: Black walnut · Marsh Lane farmhouse\n            - generic [ref=e106]: 1220 mm × 330 mm × 50 mm\n            - generic [ref=e107]: 8.53 bd ft · $204.73"
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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Kerfwell Rack",
  "snapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e3]:\n    - link \"Kerfwell\" [ref=f1e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=f1e5]:\n      - link \"Rack\" [ref=f1e6] [cursor=pointer]:\n        - /url: /\n      - link \"Sign in\" [ref=f1e7] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\" [ref=f1e8]\n  - main [ref=f1e9]:\n    - generic [ref=f1e10]:\n      - heading \"Sign in\" [level=1] [ref=f1e11]\n      - generic [ref=f1e12]:\n        - generic [ref=f1e13]:\n          - generic [ref=f1e14]: Email\n          - textbox \"Email\" [ref=f1e15]\n        - generic [ref=f1e16]:\n          - generic [ref=f1e17]: Password\n          - textbox \"Password\" [ref=f1e18]\n        - button \"Sign in\" [ref=f1e19] [cursor=pointer]\n        - alert"
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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Kerfwell Rack",
  "inlineSnapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e3]:\n    - link \"Kerfwell\" [ref=f1e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=f1e5]:\n      - link \"Rack\" [ref=f1e6] [cursor=pointer]:\n        - /url: /\n      - link \"Sign in\" [ref=f1e7] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\" [ref=f1e8]\n  - main [ref=f1e9]:\n    - generic [ref=f1e10]:\n      - heading \"Sign in\" [level=1] [ref=f1e11]\n      - generic [ref=f1e12]:\n        - generic [ref=f1e13]\n        - generic [ref=f1e16]\n        - button \"Sign in\" [ref=f1e19] [cursor=pointer]\n        - alert"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "f1e12",
  "depth": 4
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Kerfwell Rack",
  "inlineSnapshot": "- generic [ref=f1e12]:\n  - generic [ref=f1e13]:\n    - generic [ref=f1e14]: Email\n    - textbox \"Email\" [ref=f1e15]\n  - generic [ref=f1e16]:\n    - generic [ref=f1e17]: Password\n    - textbox \"Password\" [ref=f1e18]\n  - button \"Sign in\" [ref=f1e19] [cursor=pointer]\n  - alert"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e15",
      "name": "Email",
      "type": "textbox",
      "value": "hand@kerfwell.test"
    },
    {
      "target": "f1e18",
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
  "target": "f1e19"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Kerfwell Rack\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e3]:\n    - link \"Kerfwell\" [ref=f1e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=f1e5]:\n      - link \"Rack\" [ref=f1e6] [cursor=pointer]:\n        - /url: /\n      - link \"Sign in\" [ref=f1e7] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\" [ref=f1e8]\n  - main [ref=f1e9]:\n    - generic [ref=f1e10]:\n      - heading \"Sign in\" [level=1] [ref=f1e11]\n      - generic [ref=f1e12]:\n        - generic [ref=f1e13]:\n          - generic [ref=f1e14]: Email\n          - textbox \"Email\" [ref=f1e15]: hand@kerfwell.test\n        - generic [ref=f1e16]:\n          - generic [ref=f1e17]: Password\n          - textbox \"Password\" [ref=f1e18]: wrong-password\n        - button \"Sign in\" [ref=f1e19] [cursor=pointer]\n        - alert [ref=f1e20]: That email and password don't match.",
  "events": "- New console entries: evidence/touch/console-2026-11-01T11-59-49-155Z.log#L1"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "f1e12",
  "depth": 4
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Kerfwell Rack\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=f1e12]:\n  - generic [ref=f1e13]:\n    - generic [ref=f1e14]: Email\n    - textbox \"Email\" [ref=f1e15]: hand@kerfwell.test\n  - generic [ref=f1e16]:\n    - generic [ref=f1e17]: Password\n    - textbox \"Password\" [ref=f1e18]: wrong-password\n  - button \"Sign in\" [ref=f1e19] [cursor=pointer]\n  - alert [ref=f1e20]: That email and password don't match."
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e18",
      "name": "Password",
      "type": "textbox",
      "value": "rack-hand-2026"
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
  "target": "f1e19"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Kerfwell Rack\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e3]:\n    - link \"Kerfwell\" [ref=f1e21] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=f1e22]:\n      - link \"Rack\" [ref=f1e23] [cursor=pointer]:\n        - /url: /\n      - link \"Yard\" [ref=f1e24] [cursor=pointer]:\n        - /url: /yard\n    - generic [ref=f1e25]:\n      - generic [ref=f1e26]: Teo Varga\n      - generic [ref=f1e27]: Yard hand\n      - button \"Sign out\" [ref=f1e28] [cursor=pointer]\n  - status \"Service notice\" [ref=f1e8]\n  - main [ref=f1e9]:\n    - generic [ref=f1e29]:\n      - heading \"The rack\" [level=1] [ref=f1e30]\n      - button \"Filters\" [ref=f1e32] [cursor=pointer]\n      - status \"Rack count\" [ref=f1e33]: 8 boards on the rack\n      - list \"Rack\" [ref=f1e34]:\n        - listitem [ref=f1e35]:\n          - img \"Board KW-0001\" [ref=f1e37]\n          - generic [ref=f1e43]:\n            - link \"KW-0001\" [ref=f1e44] [cursor=pointer]:\n              - /url: /boards/KW-0001\n            - generic [ref=f1e45]: White oak · Hollis Road dairy barn\n            - generic [ref=f1e46]: 2440 mm × 190 mm × 32 mm\n            - generic [ref=f1e47]: 6.29 bd ft · $69.15\n        - listitem [ref=f1e48]:\n          - img \"Board KW-0002\" [ref=f1e50]\n          - generic [ref=f1e54]:\n            - link \"KW-0002\" [ref=f1e55] [cursor=pointer]:\n              - /url: /boards/KW-0002\n            - generic [ref=f1e56]: Black walnut · Marsh Lane farmhouse\n            - generic [ref=f1e57]: 2100 mm × 305 mm × 45 mm\n            - generic [ref=f1e58]: 12.21 bd ft · $293.14\n        - listitem [ref=f1e59]:\n          - img \"Board KW-0003\" [ref=f1e61]\n          - generic [ref=f1e66]:\n            - link \"KW-0003\" [ref=f1e67] [cursor=pointer]:\n              - /url: /boards/KW-0003\n            - generic [ref=f1e68]: Black walnut · Marsh Lane farmhouse\n            - generic [ref=f1e69]: 1830 mm × 210 mm × 25 mm\n            - generic [ref=f1e70]: 4.07 bd ft · $75.32\n        - listitem [ref=f1e71]:\n          - img \"Board KW-0004\" [ref=f1e73]\n          - generic [ref=f1e79]:\n            - link \"KW-0004\" [ref=f1e80] [cursor=pointer]:\n              - /url: /boards/KW-0004\n            - generic [ref=f1e81]: Douglas fir · Pell Street shoe factory\n            - generic [ref=f1e82]: 4880 mm × 235 mm × 70 mm\n            - generic [ref=f1e83]: 34.02 bd ft · $170.10\n        - listitem [ref=f1e84]:\n          - img \"Board KW-0005\" [ref=f1e86]\n          - generic [ref=f1e88]:\n            - link \"KW-0005\" [ref=f1e89] [cursor=pointer]:\n              - /url: /boards/KW-0005\n            - generic [ref=f1e90]: Heart pine · Pell Street shoe factory\n            - generic [ref=f1e91]: 3050 mm × 140 mm × 38 mm\n            - generic [ref=f1e92]: 6.88 bd ft · $110.02\n        - listitem [ref=f1e93]:\n          - img \"Board KW-0006\" [ref=f1e95]\n          - generic [ref=f1e100]:\n            - link \"KW-0006\" [ref=f1e101] [cursor=pointer]:\n              - /url: /boards/KW-0006\n            - generic [ref=f1e102]: Chestnut · Marsh Lane farmhouse\n            - generic [ref=f1e103]: 2740 mm × 250 mm × 28 mm\n            - generic [ref=f1e104]: 8.13 bd ft · $178.82\n        - listitem [ref=f1e105]:\n          - img \"Board KW-0007\" [ref=f1e107]\n          - generic [ref=f1e113]:\n            - link \"KW-0007\" [ref=f1e114] [cursor=pointer]:\n              - /url: /boards/KW-0007\n            - generic [ref=f1e115]: White oak · Hollis Road dairy barn\n            - generic [ref=f1e116]: 3660 mm × 200 mm × 50 mm\n            - generic [ref=f1e117]: 15.51 bd ft · $124.08\n        - listitem [ref=f1e118]:\n          - img \"Board KW-0010\" [ref=f1e120]\n          - generic [ref=f1e122]:\n            - link \"KW-0010\" [ref=f1e123] [cursor=pointer]:\n              - /url: /boards/KW-0010\n            - generic [ref=f1e124]: Black walnut · Marsh Lane farmhouse\n            - generic [ref=f1e125]: 1220 mm × 330 mm × 50 mm\n            - generic [ref=f1e126]: 8.53 bd ft · $204.73"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/yard"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/yard\n- Page Title: Kerfwell Rack",
  "snapshot": "- generic [ref=f2e2]:\n  - banner [ref=f2e3]:\n    - link \"Kerfwell\" [ref=f2e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=f2e5]:\n      - link \"Rack\" [ref=f2e6] [cursor=pointer]:\n        - /url: /\n      - link \"Yard\" [ref=f2e7] [cursor=pointer]:\n        - /url: /yard\n    - generic [ref=f2e8]:\n      - generic [ref=f2e9]: Teo Varga\n      - generic [ref=f2e10]: Yard hand\n      - button \"Sign out\" [ref=f2e11] [cursor=pointer]\n  - status \"Service notice\" [ref=f2e12]\n  - main"
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
  "page": "- Page URL: http://127.0.0.1:4173/yard\n- Page Title: Kerfwell Rack",
  "inlineSnapshot": "- generic [ref=f2e2]:\n  - banner [ref=f2e3]:\n    - link \"Kerfwell\" [ref=f2e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=f2e5]:\n      - link \"Rack\" [ref=f2e6] [cursor=pointer]:\n        - /url: /\n      - link \"Yard\" [ref=f2e7] [cursor=pointer]:\n        - /url: /yard\n    - generic [ref=f2e8]:\n      - generic [ref=f2e9]: Teo Varga\n      - generic [ref=f2e10]: Yard hand\n      - button \"Sign out\" [ref=f2e11] [cursor=pointer]\n  - status \"Service notice\" [ref=f2e12]\n  - main [ref=f2e13]:\n    - generic [ref=f2e14]:\n      - heading \"The yard\" [level=1] [ref=f2e15]\n      - generic [ref=f2e16]:\n        - generic [ref=f2e17]:\n          - heading \"Tag a board\" [level=2] [ref=f2e18]\n          - status \"Intake status\" [ref=f2e19]\n          - generic [ref=f2e20]:\n            - generic [ref=f2e21]\n            - paragraph\n            - generic [ref=f2e24]\n            - paragraph\n            - generic [ref=f2e27]\n            - paragraph\n            - generic [ref=f2e30]\n            - paragraph\n            - generic [ref=f2e33]\n            - paragraph\n          - img \"Intake strip\" [ref=f2e37]\n          - generic [ref=f2e38]:\n            - generic [ref=f2e39]\n            - generic [ref=f2e42]\n            - generic [ref=f2e45]\n            - button \"Add defect\" [ref=f2e48] [cursor=pointer]\n          - paragraph\n          - list \"Defect zones\"\n          - generic [ref=f2e49]:\n            - generic [ref=f2e50]: Board photos\n            - button \"Board photos\" [ref=f2e51]\n          - button \"Tag board\" [ref=f2e52] [cursor=pointer]\n        - generic [ref=f2e53]:\n          - heading \"Saw queue\" [level=2] [ref=f2e54]\n          - status \"Saw status\" [ref=f2e55]\n          - paragraph [ref=f2e57]: Nothing waiting at the saw."
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "f2e20",
  "depth": 5
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/yard\n- Page Title: Kerfwell Rack",
  "inlineSnapshot": "- generic [ref=f2e20]:\n  - generic [ref=f2e21]:\n    - generic [ref=f2e22]: Lot\n    - combobox \"Lot\" [ref=f2e23]:\n      - option \"Hollis Road dairy barn\" [selected]\n      - option \"Pell Street shoe factory\"\n      - option \"Marsh Lane farmhouse\"\n  - paragraph\n  - generic [ref=f2e24]:\n    - generic [ref=f2e25]: Species\n    - combobox \"Species\" [ref=f2e26]:\n      - option \"Black walnut\" [selected]\n      - option \"Chestnut\"\n      - option \"Douglas fir\"\n      - option \"Heart pine\"\n      - option \"White oak\"\n  - paragraph\n  - generic [ref=f2e27]:\n    - generic [ref=f2e28]: Length (mm)\n    - textbox \"Length (mm)\" [ref=f2e29]\n  - paragraph\n  - generic [ref=f2e30]:\n    - generic [ref=f2e31]: Width (mm)\n    - textbox \"Width (mm)\" [ref=f2e32]\n  - paragraph\n  - generic [ref=f2e33]:\n    - generic [ref=f2e34]: Thickness (mm)\n    - textbox \"Thickness (mm)\" [ref=f2e35]\n  - paragraph"
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
  "page": "- Page URL: http://127.0.0.1:4173/yard\n- Page Title: Kerfwell Rack",
  "inlineSnapshot": "- generic [ref=f2e2]:\n  - banner [ref=f2e3]:\n    - link \"Kerfwell\" [ref=f2e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=f2e5]:\n      - link \"Rack\" [ref=f2e6] [cursor=pointer]:\n        - /url: /\n      - link \"Yard\" [ref=f2e7] [cursor=pointer]:\n        - /url: /yard\n    - generic [ref=f2e8]:\n      - generic [ref=f2e9]: Teo Varga\n      - generic [ref=f2e10]: Yard hand\n      - button \"Sign out\" [ref=f2e11] [cursor=pointer]\n  - status \"Service notice\" [ref=f2e12]\n  - main [ref=f2e13]:\n    - generic [ref=f2e14]:\n      - heading \"The yard\" [level=1] [ref=f2e15]\n      - generic [ref=f2e16]:\n        - generic [ref=f2e17]:\n          - heading \"Tag a board\" [level=2] [ref=f2e18]\n          - status \"Intake status\" [ref=f2e19]\n          - generic [ref=f2e20]:\n            - generic [ref=f2e21]:\n              - generic [ref=f2e22]: Lot\n              - combobox \"Lot\" [ref=f2e23]\n            - paragraph\n            - generic [ref=f2e24]:\n              - generic [ref=f2e25]: Species\n              - combobox \"Species\" [ref=f2e26]\n            - paragraph\n            - generic [ref=f2e27]:\n              - generic [ref=f2e28]: Length (mm)\n              - textbox \"Length (mm)\" [ref=f2e29]\n            - paragraph\n            - generic [ref=f2e30]:\n              - generic [ref=f2e31]: Width (mm)\n              - textbox \"Width (mm)\" [ref=f2e32]\n            - paragraph\n            - generic [ref=f2e33]:\n              - generic [ref=f2e34]: Thickness (mm)\n              - textbox \"Thickness (mm)\" [ref=f2e35]\n            - paragraph\n          - img \"Intake strip\" [ref=f2e37]\n          - generic [ref=f2e38]:\n            - generic [ref=f2e39]:\n              - generic [ref=f2e40]: Defect start (mm)\n              - textbox \"Defect start (mm)\" [ref=f2e41]\n            - generic [ref=f2e42]:\n              - generic [ref=f2e43]: Defect end (mm)\n              - textbox \"Defect end (mm)\" [ref=f2e44]\n            - generic [ref=f2e45]:\n              - generic [ref=f2e46]: Defect kind\n              - combobox \"Defect kind\" [ref=f2e47]\n            - button \"Add defect\" [ref=f2e48] [cursor=pointer]\n          - paragraph\n          - list \"Defect zones\"\n          - generic [ref=f2e49]:\n            - generic [ref=f2e50]: Board photos\n            - button \"Board photos\" [ref=f2e51]\n          - button \"Tag board\" [ref=f2e52] [cursor=pointer]\n        - generic [ref=f2e53]:\n          - heading \"Saw queue\" [level=2] [ref=f2e54]\n          - status \"Saw status\" [ref=f2e55]\n          - paragraph [ref=f2e57]: Nothing waiting at the saw."
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f2e29",
      "name": "Length (mm)",
      "type": "textbox",
      "value": "2400"
    },
    {
      "target": "f2e41",
      "name": "Defect start (mm)",
      "type": "textbox",
      "value": "900"
    },
    {
      "target": "f2e44",
      "name": "Defect end (mm)",
      "type": "textbox",
      "value": "600"
    },
    {
      "target": "f2e47",
      "name": "Defect kind",
      "type": "combobox",
      "value": "check"
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
  "element": "Add defect",
  "target": "f2e48"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/yard\n- Page Title: Kerfwell Rack",
  "snapshot": "- generic [ref=f2e2]:\n  - banner [ref=f2e3]:\n    - link \"Kerfwell\" [ref=f2e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=f2e5]:\n      - link \"Rack\" [ref=f2e6] [cursor=pointer]:\n        - /url: /\n      - link \"Yard\" [ref=f2e7] [cursor=pointer]:\n        - /url: /yard\n    - generic [ref=f2e8]:\n      - generic [ref=f2e9]: Teo Varga\n      - generic [ref=f2e10]: Yard hand\n      - button \"Sign out\" [ref=f2e11] [cursor=pointer]\n  - status \"Service notice\" [ref=f2e12]\n  - main [ref=f2e13]:\n    - generic [ref=f2e14]:\n      - heading \"The yard\" [level=1] [ref=f2e15]\n      - generic [ref=f2e16]:\n        - generic [ref=f2e17]:\n          - heading \"Tag a board\" [level=2] [ref=f2e18]\n          - status \"Intake status\" [ref=f2e19]: Check the highlighted fields.\n          - generic [ref=f2e20]:\n            - generic [ref=f2e21]:\n              - generic [ref=f2e22]: Lot\n              - combobox \"Lot\" [ref=f2e23]:\n                - option \"Hollis Road dairy barn\" [selected]\n                - option \"Pell Street shoe factory\"\n                - option \"Marsh Lane farmhouse\"\n            - paragraph\n            - generic [ref=f2e24]:\n              - generic [ref=f2e25]: Species\n              - combobox \"Species\" [ref=f2e26]:\n                - option \"Black walnut\" [selected]\n                - option \"Chestnut\"\n                - option \"Douglas fir\"\n                - option \"Heart pine\"\n                - option \"White oak\"\n            - paragraph\n            - generic [ref=f2e27]:\n              - generic [ref=f2e28]: Length (mm)\n              - textbox \"Length (mm)\" [ref=f2e29]: \"2400\"\n            - paragraph\n            - generic [ref=f2e30]:\n              - generic [ref=f2e31]: Width (mm)\n              - textbox \"Width (mm)\" [ref=f2e32]\n            - paragraph\n            - generic [ref=f2e33]:\n              - generic [ref=f2e34]: Thickness (mm)\n              - textbox \"Thickness (mm)\" [ref=f2e35]\n            - paragraph\n          - img \"Intake strip\" [ref=f2e58]\n          - generic [ref=f2e38]:\n            - generic [ref=f2e39]:\n              - generic [ref=f2e40]: Defect start (mm)\n              - textbox \"Defect start (mm)\" [ref=f2e41]: \"900\"\n            - generic [ref=f2e42]:\n              - generic [ref=f2e43]: Defect end (mm)\n              - textbox \"Defect end (mm)\" [ref=f2e44]: \"600\"\n            - generic [ref=f2e45]:\n              - generic [ref=f2e46]: Defect kind\n              - combobox \"Defect kind\" [ref=f2e47]:\n                - option \"nail hole\"\n                - option \"check\" [selected]\n                - option \"bolt hole\"\n            - button \"Add defect\" [active] [ref=f2e48] [cursor=pointer]\n          - paragraph\n          - list \"Defect zones\"\n          - generic [ref=f2e49]:\n            - generic [ref=f2e50]: Board photos\n            - button \"Board photos\" [ref=f2e51]\n          - button \"Tag board\" [ref=f2e52] [cursor=pointer]\n        - generic [ref=f2e53]:\n          - heading \"Saw queue\" [level=2] [ref=f2e54]\n          - status \"Saw status\" [ref=f2e55]\n          - paragraph [ref=f2e57]: Nothing waiting at the saw."
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f2e41",
      "name": "Defect start (mm)",
      "type": "textbox",
      "value": "600"
    },
    {
      "target": "f2e44",
      "name": "Defect end (mm)",
      "type": "textbox",
      "value": "900"
    },
    {
      "target": "f2e47",
      "name": "Defect kind",
      "type": "combobox",
      "value": "check"
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
  "element": "Add defect",
  "target": "f2e48"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/yard\n- Page Title: Kerfwell Rack",
  "snapshot": "- generic [ref=f2e2]:\n  - banner [ref=f2e3]:\n    - link \"Kerfwell\" [ref=f2e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=f2e5]:\n      - link \"Rack\" [ref=f2e6] [cursor=pointer]:\n        - /url: /\n      - link \"Yard\" [ref=f2e7] [cursor=pointer]:\n        - /url: /yard\n    - generic [ref=f2e8]:\n      - generic [ref=f2e9]: Teo Varga\n      - generic [ref=f2e10]: Yard hand\n      - button \"Sign out\" [ref=f2e11] [cursor=pointer]\n  - status \"Service notice\" [ref=f2e12]\n  - main [ref=f2e13]:\n    - generic [ref=f2e14]:\n      - heading \"The yard\" [level=1] [ref=f2e15]\n      - generic [ref=f2e16]:\n        - generic [ref=f2e17]:\n          - heading \"Tag a board\" [level=2] [ref=f2e18]\n          - status \"Intake status\" [ref=f2e19]: Check the highlighted fields.\n          - generic [ref=f2e20]:\n            - generic [ref=f2e21]:\n              - generic [ref=f2e22]: Lot\n              - combobox \"Lot\" [ref=f2e23]:\n                - option \"Hollis Road dairy barn\" [selected]\n                - option \"Pell Street shoe factory\"\n                - option \"Marsh Lane farmhouse\"\n            - paragraph\n            - generic [ref=f2e24]:\n              - generic [ref=f2e25]: Species\n              - combobox \"Species\" [ref=f2e26]:\n                - option \"Black walnut\" [selected]\n                - option \"Chestnut\"\n                - option \"Douglas fir\"\n                - option \"Heart pine\"\n                - option \"White oak\"\n            - paragraph\n            - generic [ref=f2e27]:\n              - generic [ref=f2e28]: Length (mm)\n              - textbox \"Length (mm)\" [ref=f2e29]: \"2400\"\n            - paragraph\n            - generic [ref=f2e30]:\n              - generic [ref=f2e31]: Width (mm)\n              - textbox \"Width (mm)\" [ref=f2e32]\n            - paragraph\n            - generic [ref=f2e33]:\n              - generic [ref=f2e34]: Thickness (mm)\n              - textbox \"Thickness (mm)\" [ref=f2e35]\n            - paragraph\n          - img \"Intake strip\" [ref=f2e60]\n          - generic [ref=f2e38]:\n            - generic [ref=f2e39]:\n              - generic [ref=f2e40]: Defect start (mm)\n              - textbox \"Defect start (mm)\" [ref=f2e41]\n            - generic [ref=f2e42]:\n              - generic [ref=f2e43]: Defect end (mm)\n              - textbox \"Defect end (mm)\" [ref=f2e44]\n            - generic [ref=f2e45]:\n              - generic [ref=f2e46]: Defect kind\n              - combobox \"Defect kind\" [ref=f2e47]:\n                - option \"nail hole\"\n                - option \"check\" [selected]\n                - option \"bolt hole\"\n            - button \"Add defect\" [active] [ref=f2e48] [cursor=pointer]\n          - paragraph\n          - list \"Defect zones\" [ref=f2e63]:\n            - listitem [ref=f2e64]:\n              - generic [ref=f2e65]: check 600–900 mm\n              - button \"Remove defect 1\" [ref=f2e66] [cursor=pointer]\n          - generic [ref=f2e49]:\n            - generic [ref=f2e50]: Board photos\n            - button \"Board photos\" [ref=f2e51]\n          - button \"Tag board\" [ref=f2e52] [cursor=pointer]\n        - generic [ref=f2e53]:\n          - heading \"Saw queue\" [level=2] [ref=f2e54]\n          - status \"Saw status\" [ref=f2e55]\n          - paragraph [ref=f2e57]: Nothing waiting at the saw."
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const root=document.querySelector('[aria-label=\"Intake strip\"]'); const d=root.querySelector('[data-defect]'); const s=getComputedStyle(d); const fill=d.getAttribute('fill'); const id=fill?.match(/#([^\\)]+)/)?.[1]; const pattern=id&&document.getElementById(id); return {defect:{outerHTML:d.outerHTML,fillAttr:fill,computedFill:s.fill,stroke:s.stroke},pattern:pattern?.outerHTML,cssDefect:getComputedStyle(document.documentElement).getPropertyValue('--defect').trim()}; }"
}
```
- Result
```json
{
  "result": "{\n  \"defect\": {\n    \"outerHTML\": \"<rect x=\\\"93.75\\\" y=\\\"10\\\" width=\\\"46.875\\\" height=\\\"42\\\" fill=\\\"url(#kerfwell-defect-hatch)\\\" stroke=\\\"var(--defect)\\\" stroke-width=\\\"1\\\" data-defect=\\\"check\\\"></rect>\",\n    \"fillAttr\": \"url(#kerfwell-defect-hatch)\",\n    \"computedFill\": \"url(\\\"#kerfwell-defect-hatch\\\")\",\n    \"stroke\": \"rgb(122, 98, 72)\"\n  },\n  \"pattern\": \"<pattern id=\\\"kerfwell-defect-hatch\\\" width=\\\"6\\\" height=\\\"6\\\" patternUnits=\\\"userSpaceOnUse\\\" patternTransform=\\\"rotate(45)\\\"><rect width=\\\"6\\\" height=\\\"6\\\" fill=\\\"var(--defect-wash)\\\"></rect><line x1=\\\"0\\\" y1=\\\"0\\\" x2=\\\"0\\\" y2=\\\"6\\\" stroke=\\\"var(--defect)\\\" stroke-width=\\\"2\\\"></line></pattern>\",\n  \"cssDefect\": \"#7a6248\"\n}"
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
  "page": "- Page URL: http://127.0.0.1:4173/yard\n- Page Title: Kerfwell Rack",
  "inlineSnapshot": "- generic [ref=f2e2]:\n  - banner [ref=f2e3]:\n    - link \"Kerfwell\" [ref=f2e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=f2e5]:\n      - link \"Rack\" [ref=f2e6] [cursor=pointer]:\n        - /url: /\n      - link \"Yard\" [ref=f2e7] [cursor=pointer]:\n        - /url: /yard\n    - generic [ref=f2e8]:\n      - generic [ref=f2e9]: Teo Varga\n      - generic [ref=f2e10]: Yard hand\n      - button \"Sign out\" [ref=f2e11] [cursor=pointer]\n  - status \"Service notice\" [ref=f2e12]\n  - main [ref=f2e13]:\n    - generic [ref=f2e14]:\n      - heading \"The yard\" [level=1] [ref=f2e15]\n      - generic [ref=f2e16]:\n        - generic [ref=f2e17]:\n          - heading \"Tag a board\" [level=2] [ref=f2e18]\n          - status \"Intake status\" [ref=f2e19]: Check the highlighted fields.\n          - generic [ref=f2e20]:\n            - generic [ref=f2e21]\n            - paragraph\n            - generic [ref=f2e24]\n            - paragraph\n            - generic [ref=f2e27]\n            - paragraph\n            - generic [ref=f2e30]\n            - paragraph\n            - generic [ref=f2e33]\n            - paragraph\n          - img \"Intake strip\" [ref=f2e60]\n          - generic [ref=f2e38]:\n            - generic [ref=f2e39]\n            - generic [ref=f2e42]\n            - generic [ref=f2e45]\n            - button \"Add defect\" [active] [ref=f2e48] [cursor=pointer]\n          - paragraph\n          - list \"Defect zones\" [ref=f2e63]:\n            - listitem [ref=f2e64]\n          - generic [ref=f2e49]:\n            - generic [ref=f2e50]: Board photos\n            - button \"Board photos\" [ref=f2e51]\n          - button \"Tag board\" [ref=f2e52] [cursor=pointer]\n        - generic [ref=f2e53]:\n          - heading \"Saw queue\" [level=2] [ref=f2e54]\n          - status \"Saw status\" [ref=f2e55]\n          - paragraph [ref=f2e57]: Nothing waiting at the saw."
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Intake strip",
  "target": "f2e60",
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of Intake strip](evidence/touch/element-2026-11-01T12-01-01-660Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "iVBORw0KGgoAAAANSUhEUgAAAXcAAABLCAIAAAAEbVDLAAAETUlEQVR4nOzc228UVRzA8bPTmdki2AstAaTF0opt15SKGmNMMJp6CZpUi8RYwUvQ6H/gow8+GB98xURMVBJMjdEQG+MNGxqIcZVI3RaWrhXSQMutUOCBQne3WyYhIeXs2Z1ml5OZk3w/STfpb7d96zfTM5OfPXNlQgCANpYAAJ2oDAC9qAwAvagMAL2oDAC9qAwAvagMAL2oDAC97E937hLIc216UoRJtKresqMCMJCdzV4XyBPJznQ+/MjCyeXpi8cSQ20dnbX1K6QPjyVHvNf1sQ5pfunC1OjIv+0bHqqpq5Pe+u/ocIVV0dL+gDSfnjo3ljzStmFjde3yW8PEoXg2e7cl5gVgINv7eu/dtwRu983nOxubWhqamm9+O/5/Kj448OJrb7a0xqRP/vR9X/3K1c+/3CvNT6SS8cHft2x/u2l9q/TWj9/uWXVP43M9r0hzr1Z/H9y/5fV31jbft3B+dOifV3u3LuwOYIrPdn1lC/jxErN3z5fdvW8oE+O9KhPzQ9/unm07lIlxHFeZGO+3eT8iJcaTnuV6EwajMj4CT0x/3+5IJCIAY1GZYsKQmCVLlzou574wGHeyCzo7eTIMiXmme6sATMa1jFoulzu47xcSA5SPyqhl0unHu54lMUD5qIya47prGpukIYkBSkBl1CxLPrEiMUBpqMyiBJuYubmsAIxFZfwFm5jUkUQmPSsAY1EZH4EnZl//d260UgDG4nmZYsKQmJe27bCsCgEYi8oUFD8wIEKQmIZ71wnAZFRGLZvJCBID3AmcyxT02BNd0oTEACWgMmq240gTEgOUhsosStCJYUseDEZl/AV+FZOe5XkZGIzK+Ag8MXu//iJiscUKBuMeUzFhSExVTa3jsMUKBqMyBZ0+NR6GxHS90CMAk/Efk1oul/tj4FcSA5SPyqhl0ulNT28mMUD5qIya47qrGtZKQxIDlIDKqOVvsSIxQGmozKIEmxi2WMFoVMZfsIlJJg6zxQpGozI+Ak/M4M/9bLGC0XheppgwJKZnO1usYDYqU9Cf+38LQ2JW593qAsxCZdQymUyF7ZAYoHycyxT06KanpAmJAUpAZdScvC1WJAYoDZVZlKATwxYrGIzK+As2Mbm5ObZYwWhUxkfgiWGLFUzHPaZiwpCYuhUr2WIFo1GZgibGT4QhMU9u7haAyaiMmvdHHj8wQGKA8kU+/vB9gTxXT4+1xmLVtculeWok4bhOc2tMml88f+54KtnW8aBXE+mt0eGhaGXluvvbpfnU2TPjY6n2zo3LqqoXzudz86Mjh5fctezWDq3EobhVs8ayXQEYKPLJRx8I5Lk2PSnCJFpVb9mczsBIkZkrEwIAtOFcBoBeVAaAXlQGgF5UBoBeVAaAXlQGgF5UBoBeVAaAXlQGgF5UBoBeVAaAXlQGgF5UBoBeVAaAXlQGgF5UBoBeVAaAXlQGgF5UBoBeVAaAXvax4b8EAGhzAwAA//8Z3oOtAAAABklEQVQDAASCbn6XcinFAAAAAElFTkSuQmCC",
      "mimeType": "image/png"
    }
  ]
}
```
