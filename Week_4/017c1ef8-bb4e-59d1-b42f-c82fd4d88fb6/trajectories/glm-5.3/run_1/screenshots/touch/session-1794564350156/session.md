
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Plainwork",
  "snapshot": "- generic [ref=e2]:\n  - status [ref=e3]\n  - status [ref=e4]\n  - status [ref=e5]\n  - status [ref=e6]\n  - status [ref=e7]\n  - main [ref=e8]:\n    - generic [ref=e10]:\n      - generic [ref=e11]: Email\n      - textbox \"Email\" [ref=e12]\n      - generic [ref=e13]: Password\n      - textbox \"Password\" [ref=e14]\n      - button \"Sign in\" [ref=e15] [cursor=pointer]",
  "events": "- New console entries: evidence/touch/console-2026-11-13T10-05-50-240Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Plainwork\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - status [ref=e3]\n  - status [ref=e4]\n  - status [ref=e5]\n  - status [ref=e6]\n  - status [ref=e7]\n  - main [ref=e8]:\n    - generic [ref=e10]:\n      - generic [ref=e11]: Email\n      - textbox \"Email\" [ref=e12]\n      - generic [ref=e13]: Password\n      - textbox \"Password\" [ref=e14]\n      - button \"Sign in\" [ref=e15] [cursor=pointer]",
  "events": "- New console entries: evidence/touch/console-2026-11-13T10-05-50-240Z.log#L2"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e12",
      "name": "Email",
      "type": "textbox",
      "value": "ines@demo.plainwork.example"
    },
    {
      "target": "e14",
      "name": "Password",
      "type": "textbox",
      "value": "plainwork-demo-2027"
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
  "target": "e15"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/feed\n- Page Title: Plainwork\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - status [ref=e3]\n  - status [ref=e4]\n  - status [ref=e5]\n  - status [ref=e6]\n  - status [ref=e7]\n  - banner [ref=e16]:\n    - link \"Plainwork\" [ref=e17] [cursor=pointer]:\n      - /url: /\n      - text: Pw\n    - searchbox \"Search\" [ref=e19]\n  - navigation \"Tabs\" [ref=e21]:\n    - link \"Home\" [ref=e22] [cursor=pointer]:\n      - /url: /feed\n    - link \"Network\" [ref=e23] [cursor=pointer]:\n      - /url: /network\n    - link \"Post\" [ref=e24] [cursor=pointer]:\n      - /url: /feed#compose\n    - link \"Messaging\" [ref=e25] [cursor=pointer]:\n      - /url: /messaging\n    - link \"Jobs\" [ref=e26] [cursor=pointer]:\n      - /url: /jobs\n  - main [ref=e8]:\n    - generic [ref=e29]:\n      - button \"Start a post\" [ref=e30] [cursor=pointer]\n      - article [ref=e31]:\n        - generic [ref=e32]:\n          - link \"Theo Marchetti\" [ref=e33] [cursor=pointer]:\n            - /url: /in/theo-marchetti\n          - generic [ref=e34]: Kitchen lead at Brine and Barley\n        - link [ref=e35] [cursor=pointer]:\n          - /url: /posts/c1d1e1d6667e422c84dd4cd6ef188678\n          - time [ref=e36]: 26m\n        - paragraph [ref=e37]: Prep list done, walk-in organised, and the new cook already knows where the tongs live.\n        - paragraph\n        - generic [ref=e38]:\n          - button \"React\" [ref=e39] [cursor=pointer]\n          - button \"Choose reaction\" [ref=e40] [cursor=pointer]\n          - button \"Comment\" [ref=e41] [cursor=pointer]\n          - button \"Repost\" [ref=e42] [cursor=pointer]\n        - generic [ref=e43]: Add a comment\n        - textbox \"Add a comment\" [ref=e44]\n        - button \"Post comment\" [disabled] [ref=e45]\n      - article [ref=e46]:\n        - generic [ref=e47]:\n          - link \"Ines Okafor-Vale\" [ref=e48] [cursor=pointer]:\n            - /url: /in/ines-okafor\n          - generic [ref=e49]: Site electrician at Calder Yard Builders\n        - link [ref=e50] [cursor=pointer]:\n          - /url: /posts/57fcb82b547e403fbd95efc0de0879ce\n          - time [ref=e51]: 3h\n        - paragraph [ref=e52]:\n          - text: Finished a 200-amp panel swap before lunch. Label every circuit, every time.\n          - link \"#PanelDay\" [ref=e53] [cursor=pointer]:\n            - /url: /hashtag/panelday\n        - paragraph [ref=e54]: Theo Marchetti and 1 other\n        - paragraph [ref=e55]: 1 comment\n        - generic [ref=e56]:\n          - button \"React\" [ref=e57] [cursor=pointer]\n          - button \"Choose reaction\" [ref=e58] [cursor=pointer]\n          - button \"Comment\" [ref=e59] [cursor=pointer]\n          - button \"Repost\" [ref=e60] [cursor=pointer]\n          - button \"Post actions\" [ref=e61] [cursor=pointer]\n        - generic [ref=e62]: Add a comment\n        - textbox \"Add a comment\" [ref=e63]\n        - button \"Post comment\" [disabled] [ref=e64]\n      - article [ref=e65]:\n        - generic [ref=e66]:\n          - link \"Priya Dunmore\" [ref=e67] [cursor=pointer]:\n            - /url: /in/priya-dunmore\n          - generic [ref=e68]: Recruiter at Calder Yard Builders\n        - link [ref=e69] [cursor=pointer]:\n          - /url: /posts/9d2b765ee4d24f7aa23b03b35583f16b\n          - time [ref=e70]: 1d\n        - paragraph [ref=e71]:\n          - text: We are hiring two apprentice electricians in Chicago. Every stage of our process is on the job page.\n          - link \"#OpenRoles\" [ref=e72] [cursor=pointer]:\n            - /url: /hashtag/openroles\n        - paragraph\n        - generic [ref=e73]:\n          - button \"React\" [ref=e74] [cursor=pointer]\n          - button \"Choose reaction\" [ref=e75] [cursor=pointer]\n          - button \"Comment\" [ref=e76] [cursor=pointer]\n          - button \"Repost\" [ref=e77] [cursor=pointer]\n        - generic [ref=e78]: Add a comment\n        - textbox \"Add a comment\" [ref=e79]\n        - button \"Post comment\" [disabled] [ref=e80]"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/feed"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/feed\n- Page Title: Plainwork",
  "snapshot": "- generic [ref=f1e2]:\n  - status [ref=f1e3]\n  - status [ref=f1e4]\n  - status [ref=f1e5]\n  - status [ref=f1e6]\n  - status [ref=f1e7]\n  - main [ref=f1e8]:\n    - generic [ref=f1e10]:\n      - generic [ref=f1e11]: Email\n      - textbox \"Email\" [ref=f1e12]\n      - generic [ref=f1e13]: Password\n      - textbox \"Password\" [ref=f1e14]\n      - button \"Sign in\" [ref=f1e15] [cursor=pointer]",
  "events": "- New console entries: evidence/touch/console-2026-11-13T10-06-04-185Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/feed\n- Page Title: Plainwork",
  "inlineSnapshot": "- generic [ref=f1e2]:\n  - status [ref=f1e3]\n  - status [ref=f1e4]\n  - status [ref=f1e5]\n  - status [ref=f1e6]\n  - status [ref=f1e7]\n  - banner [ref=f1e16]:\n    - link \"Plainwork\" [ref=f1e17] [cursor=pointer]:\n      - /url: /\n      - text: Pw\n    - searchbox \"Search\" [ref=f1e19]\n  - navigation \"Tabs\" [ref=f1e21]:\n    - link \"Home\" [ref=f1e22] [cursor=pointer]:\n      - /url: /feed\n    - link \"Network\" [ref=f1e23] [cursor=pointer]:\n      - /url: /network\n    - link \"Post\" [ref=f1e24] [cursor=pointer]:\n      - /url: /feed#compose\n    - link \"Messaging\" [ref=f1e25] [cursor=pointer]:\n      - /url: /messaging\n    - link \"Jobs\" [ref=f1e26] [cursor=pointer]:\n      - /url: /jobs\n  - main [ref=f1e8]:\n    - generic [ref=f1e29]:\n      - button \"Start a post\" [ref=f1e30] [cursor=pointer]\n      - article [ref=f1e31]:\n        - generic [ref=f1e32]\n        - link \"26m\" [ref=f1e35] [cursor=pointer]:\n          - /url: /posts/c1d1e1d6667e422c84dd4cd6ef188678\n        - paragraph [ref=f1e37]: Prep list done, walk-in organised, and the new cook already knows where the tongs live.\n        - paragraph\n        - generic [ref=f1e38]\n        - generic [ref=f1e43]: Add a comment\n        - textbox \"Add a comment\" [ref=f1e44]\n        - button \"Post comment\" [disabled] [ref=f1e45]\n      - article [ref=f1e46]:\n        - generic [ref=f1e47]\n        - link \"3h\" [ref=f1e50] [cursor=pointer]:\n          - /url: /posts/57fcb82b547e403fbd95efc0de0879ce\n        - paragraph [ref=f1e52]\n        - paragraph [ref=f1e54]: Theo Marchetti and 1 other\n        - paragraph [ref=f1e55]: 1 comment\n        - generic [ref=f1e56]\n        - generic [ref=f1e62]: Add a comment\n        - textbox \"Add a comment\" [ref=f1e63]\n        - button \"Post comment\" [disabled] [ref=f1e64]\n      - article [ref=f1e65]:\n        - generic [ref=f1e66]\n        - link \"1d\" [ref=f1e69] [cursor=pointer]:\n          - /url: /posts/9d2b765ee4d24f7aa23b03b35583f16b\n        - paragraph [ref=f1e71]\n        - paragraph\n        - generic [ref=f1e73]\n        - generic [ref=f1e78]: Add a comment\n        - textbox \"Add a comment\" [ref=f1e79]\n        - button \"Post comment\" [disabled] [ref=f1e80]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Start a post",
  "target": "f1e30"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/feed\n- Page Title: Plainwork",
  "snapshot": "- generic [ref=f1e2]:\n  - status [ref=f1e3]\n  - status [ref=f1e4]\n  - status [ref=f1e5]\n  - status [ref=f1e6]\n  - status [ref=f1e7]\n  - banner [ref=f1e16]:\n    - link \"Plainwork\" [ref=f1e17] [cursor=pointer]:\n      - /url: /\n      - text: Pw\n    - searchbox \"Search\" [ref=f1e19]\n  - navigation \"Tabs\" [ref=f1e21]:\n    - link \"Home\" [ref=f1e22] [cursor=pointer]:\n      - /url: /feed\n    - link \"Network\" [ref=f1e23] [cursor=pointer]:\n      - /url: /network\n    - link \"Post\" [ref=f1e24] [cursor=pointer]:\n      - /url: /feed#compose\n    - link \"Messaging\" [ref=f1e25] [cursor=pointer]:\n      - /url: /messaging\n    - link \"Jobs\" [ref=f1e26] [cursor=pointer]:\n      - /url: /jobs\n  - main [ref=f1e8]:\n    - generic [ref=f1e27]:\n      - generic [ref=f1e29]:\n        - button \"Start a post\" [ref=f1e30] [cursor=pointer]\n        - article [ref=f1e31]:\n          - generic [ref=f1e32]:\n            - link \"Theo Marchetti\" [ref=f1e33] [cursor=pointer]:\n              - /url: /in/theo-marchetti\n            - generic [ref=f1e34]: Kitchen lead at Brine and Barley\n          - link [ref=f1e35] [cursor=pointer]:\n            - /url: /posts/c1d1e1d6667e422c84dd4cd6ef188678\n            - time [ref=f1e36]: 26m\n          - paragraph [ref=f1e37]: Prep list done, walk-in organised, and the new cook already knows where the tongs live.\n          - paragraph\n          - generic [ref=f1e38]:\n            - button \"React\" [ref=f1e39] [cursor=pointer]\n            - button \"Choose reaction\" [ref=f1e40] [cursor=pointer]\n            - button \"Comment\" [ref=f1e41] [cursor=pointer]\n            - button \"Repost\" [ref=f1e42] [cursor=pointer]\n          - generic [ref=f1e43]: Add a comment\n          - textbox \"Add a comment\" [ref=f1e44]\n          - button \"Post comment\" [disabled] [ref=f1e45]\n        - article [ref=f1e46]:\n          - generic [ref=f1e47]:\n            - link \"Ines Okafor-Vale\" [ref=f1e48] [cursor=pointer]:\n              - /url: /in/ines-okafor\n            - generic [ref=f1e49]: Site electrician at Calder Yard Builders\n          - link [ref=f1e50] [cursor=pointer]:\n            - /url: /posts/57fcb82b547e403fbd95efc0de0879ce\n            - time [ref=f1e51]: 3h\n          - paragraph [ref=f1e52]:\n            - text: Finished a 200-amp panel swap before lunch. Label every circuit, every time.\n            - link \"#PanelDay\" [ref=f1e53] [cursor=pointer]:\n              - /url: /hashtag/panelday\n          - paragraph [ref=f1e54]: Theo Marchetti and 1 other\n          - paragraph [ref=f1e55]: 1 comment\n          - generic [ref=f1e56]:\n            - button \"React\" [ref=f1e57] [cursor=pointer]\n            - button \"Choose reaction\" [ref=f1e58] [cursor=pointer]\n            - button \"Comment\" [ref=f1e59] [cursor=pointer]\n            - button \"Repost\" [ref=f1e60] [cursor=pointer]\n            - button \"Post actions\" [ref=f1e61] [cursor=pointer]\n          - generic [ref=f1e62]: Add a comment\n          - textbox \"Add a comment\" [ref=f1e63]\n          - button \"Post comment\" [disabled] [ref=f1e64]\n        - article [ref=f1e65]:\n          - generic [ref=f1e66]:\n            - link \"Priya Dunmore\" [ref=f1e67] [cursor=pointer]:\n              - /url: /in/priya-dunmore\n            - generic [ref=f1e68]: Recruiter at Calder Yard Builders\n          - link [ref=f1e69] [cursor=pointer]:\n            - /url: /posts/9d2b765ee4d24f7aa23b03b35583f16b\n            - time [ref=f1e70]: 1d\n          - paragraph [ref=f1e71]:\n            - text: We are hiring two apprentice electricians in Chicago. Every stage of our process is on the job page.\n            - link \"#OpenRoles\" [ref=f1e72] [cursor=pointer]:\n              - /url: /hashtag/openroles\n          - paragraph\n          - generic [ref=f1e73]:\n            - button \"React\" [ref=f1e74] [cursor=pointer]\n            - button \"Choose reaction\" [ref=f1e75] [cursor=pointer]\n            - button \"Comment\" [ref=f1e76] [cursor=pointer]\n            - button \"Repost\" [ref=f1e77] [cursor=pointer]\n          - generic [ref=f1e78]: Add a comment\n          - textbox \"Add a comment\" [ref=f1e79]\n          - button \"Post comment\" [disabled] [ref=f1e80]\n      - dialog \"Create a post\" [ref=f1e82]:\n        - generic [ref=f1e83]: What do you want to talk about?\n        - textbox \"What do you want to talk about?\" [active] [ref=f1e84]\n        - status \"Character count\" [ref=f1e85]: 0 / 280\n        - generic [ref=f1e86]:\n          - button \"Add a photo\" [ref=f1e87] [cursor=pointer]\n          - button \"Photo\" [ref=f1e88]\n          - button \"Post\" [disabled] [ref=f1e89]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 5,
  "boxes": true
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/feed\n- Page Title: Plainwork",
  "inlineSnapshot": "- generic [ref=f1e2] [box=0,0,375,1731]:\n  - status [ref=f1e3] [box=0,0,1,1]\n  - status [ref=f1e4] [box=0,0,1,1]\n  - status [ref=f1e5] [box=0,0,1,1]\n  - status [ref=f1e6] [box=0,0,1,1]\n  - status [ref=f1e7] [box=0,0,1,1]\n  - banner [ref=f1e16] [box=0,0,375,69]:\n    - link \"Plainwork\" [ref=f1e17] [cursor=pointer] [box=24,16,39,38]:\n      - /url: /\n      - text: Pw\n    - searchbox \"Search\" [ref=f1e19] [box=83,12,268,45]\n  - navigation \"Tabs\" [ref=f1e21] [box=0,768,375,44]:\n    - link \"Home\" [ref=f1e22] [cursor=pointer] [box=0,768,67,44]:\n      - /url: /feed\n    - link \"Network\" [ref=f1e23] [cursor=pointer] [box=67,768,85,44]:\n      - /url: /network\n    - link \"Post\" [ref=f1e24] [cursor=pointer] [box=152,768,60,44]:\n      - /url: /feed#compose\n    - link \"Messaging\" [ref=f1e25] [cursor=pointer] [box=213,768,102,44]:\n      - /url: /messaging\n    - link \"Jobs\" [ref=f1e26] [cursor=pointer] [box=315,768,60,44]:\n      - /url: /jobs\n  - main [ref=f1e8] [box=0,69,375,1661]:\n    - generic [ref=f1e27] [box=16,81,343,1529]:\n      - generic [ref=f1e29] [box=16,81,343,1529]:\n        - button \"Start a post\" [ref=f1e30] [cursor=pointer] [box=16,81,343,45]\n        - article [ref=f1e31] [box=16,146,343,441]:\n          - generic [ref=f1e32] [box=36,166,303,68]\n          - link \"26m\" [ref=f1e35] [cursor=pointer] [box=36,235,32,20]:\n            - /url: /posts/c1d1e1d6667e422c84dd4cd6ef188678\n          - paragraph [ref=f1e37] [box=36,270,303,70]: Prep list done, walk-in organised, and the new cook already knows where the tongs live.\n          - paragraph [box=36,351,303,0]\n          - generic [ref=f1e38] [box=36,353,303,96]\n          - generic [ref=f1e43] [box=36,449,1,1]: Add a comment\n          - textbox \"Add a comment\" [ref=f1e44] [box=36,449,303,68]\n          - button \"Post comment\" [disabled] [ref=f1e45] [box=36,524,142,44]\n        - article [ref=f1e46] [box=16,612,343,510]:\n          - generic [ref=f1e47] [box=36,632,303,68]\n          - link \"3h\" [ref=f1e50] [cursor=pointer] [box=36,701,18,20]:\n            - /url: /posts/57fcb82b547e403fbd95efc0de0879ce\n          - paragraph [ref=f1e52] [box=36,735,303,70]\n          - paragraph [ref=f1e54] [box=36,814,303,23]: Theo Marchetti and 1 other\n          - paragraph [ref=f1e55] [box=36,850,303,23]: 1 comment\n          - generic [ref=f1e56] [box=36,887,303,96]\n          - generic [ref=f1e62] [box=36,983,1,1]: Add a comment\n          - textbox \"Add a comment\" [ref=f1e63] [box=36,983,303,68]\n          - button \"Post comment\" [disabled] [ref=f1e64] [box=36,1057,142,44]\n        - article [ref=f1e65] [box=16,1145,343,441]:\n          - generic [ref=f1e66] [box=36,1165,303,68]\n          - link \"1d\" [ref=f1e69] [cursor=pointer] [box=36,1234,18,20]:\n            - /url: /posts/9d2b765ee4d24f7aa23b03b35583f16b\n          - paragraph [ref=f1e71] [box=36,1269,303,70]\n          - paragraph [box=36,1350,303,0]\n          - generic [ref=f1e73] [box=36,1352,303,96]\n          - generic [ref=f1e78] [box=36,1448,1,1]: Add a comment\n          - textbox \"Add a comment\" [ref=f1e79] [box=36,1448,303,68]\n          - button \"Post comment\" [disabled] [ref=f1e80] [box=36,1523,142,44]\n      - dialog \"Create a post\" [ref=f1e82] [box=0,0,375,812]:\n        - generic [ref=f1e83] [box=24,24,327,23]: What do you want to talk about?\n        - textbox \"What do you want to talk about?\" [active] [ref=f1e84] [box=24,51,327,138]\n        - status \"Character count\" [ref=f1e85] [box=24,195,327,23]: 0 / 280\n        - generic [ref=f1e86] [box=24,235,327,44]:\n          - button \"Add a photo\" [ref=f1e87] [cursor=pointer] [box=24,235,87,44]\n          - button \"Photo\" [ref=f1e88] [box=24,235,1,1]\n          - button \"Post\" [disabled] [ref=f1e89] [box=123,235,68,44]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const d=document.querySelector('dialog'), t=d?.querySelector('textarea,input'), b=[...d.querySelectorAll('button')].find(e=>e.textContent?.trim()==='Post'), a=document.querySelector('article');return {viewport:[innerWidth,innerHeight],dialog:{box:d?.getBoundingClientRect().toJSON(),radius:getComputedStyle(d).borderRadius},textbox:getComputedStyle(t).borderRadius,post:getComputedStyle(b).borderRadius,article:getComputedStyle(a).borderRadius}}"
}
```
- Result
```json
{
  "error": "TypeError: Cannot read properties of null (reading 'querySelectorAll')\n    at eval (eval at <anonymous> (eval at evaluate (:368:30)), <anonymous>:1:97)\n    at eval (eval at evaluate (:368:30), <anonymous>:4:50)\n    at UtilityScript.evaluate (<anonymous>:370:16)\n    at UtilityScript.<anonymous> (<anonymous>:1:44)",
  "isError": true
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
  "result": "- [Screenshot of viewport](evidence/touch/page-2026-11-13T10-06-17-290Z.png)",
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
  "function": "() => {const d=document.querySelector('[role=\"dialog\"]'), t=d?.querySelector('textarea,input'), b=[...d.querySelectorAll('button')].find(e=>e.textContent?.trim()==='Post'), a=document.querySelector('article');return {dialog:{box:d?.getBoundingClientRect().toJSON(),radius:getComputedStyle(d).borderRadius},textbox:getComputedStyle(t).borderRadius,post:getComputedStyle(b).borderRadius,article:getComputedStyle(a).borderRadius}}"
}
```
- Result
```json
{
  "result": "{\n  \"dialog\": {\n    \"box\": {\n      \"x\": 0,\n      \"y\": 0,\n      \"width\": 375,\n      \"height\": 812,\n      \"top\": 0,\n      \"right\": 375,\n      \"bottom\": 812,\n      \"left\": 0\n    },\n    \"radius\": \"0px\"\n  },\n  \"textbox\": \"0px\",\n  \"post\": \"0px\",\n  \"article\": \"0px\"\n}"
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
