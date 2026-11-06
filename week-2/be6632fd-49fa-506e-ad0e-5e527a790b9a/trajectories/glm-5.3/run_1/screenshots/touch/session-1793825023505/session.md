
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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Hourline Launch Hub\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - link \"Skip to content\" [ref=e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - main [ref=e4]:\n    - generic [ref=e5]:\n      - heading \"Sign in\" [active] [level=1] [ref=e6]\n      - form \"Sign in\" [ref=e7]:\n        - generic [ref=e8]:\n          - generic [ref=e9]: Email\n          - textbox \"Email\" [ref=e10]\n        - generic [ref=e11]:\n          - generic [ref=e12]: Password\n          - textbox \"Password\" [ref=e13]\n        - button \"Sign in\" [ref=e14] [cursor=pointer]\n        - link \"Forgot password?\" [ref=e15] [cursor=pointer]:\n          - /url: /forgot-password\n        - status \"Sign-in status\" [ref=e16]",
  "events": "- New console entries: evidence/touch/console-2026-11-04T20-43-43-603Z.log#L1-L2"
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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Hourline Launch Hub\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - link \"Skip to content\" [ref=e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - main [ref=e4]:\n    - generic [ref=e5]:\n      - heading \"Sign in\" [active] [level=1] [ref=e6]\n      - form \"Sign in\" [ref=e7]:\n        - generic [ref=e8]:\n          - generic [ref=e9]: Email\n          - textbox \"Email\" [ref=e10]\n        - generic [ref=e11]:\n          - generic [ref=e12]: Password\n          - textbox \"Password\" [ref=e13]\n        - button \"Sign in\" [ref=e14] [cursor=pointer]\n        - link \"Forgot password?\" [ref=e15] [cursor=pointer]:\n          - /url: /forgot-password\n        - status \"Sign-in status\" [ref=e16]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e10",
      "name": "Email",
      "type": "textbox",
      "value": "ida.holm@marenvale.example"
    },
    {
      "target": "e13",
      "name": "Password",
      "type": "textbox",
      "value": "Hourline-Seed-2027"
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
  "target": "e14"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Hourline Launch Hub\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [active] [ref=e1]:\n  - link \"Skip to content\" [ref=e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - main [ref=e4]:\n    - generic [ref=e5]:\n      - heading \"Sign in\" [level=1] [ref=e6]\n      - form \"Sign in\" [ref=e7]:\n        - generic [ref=e8]:\n          - generic [ref=e9]: Email\n          - textbox \"Email\" [ref=e10]: ida.holm@marenvale.example\n        - generic [ref=e11]:\n          - generic [ref=e12]: Password\n          - textbox \"Password\" [ref=e13]: Hourline-Seed-2027\n        - button \"Signing in…\" [disabled] [ref=e17]\n        - link \"Forgot password?\" [ref=e15] [cursor=pointer]:\n          - /url: /forgot-password\n        - status \"Sign-in status\" [ref=e16]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "()=>new Promise(r=>setTimeout(()=>r(location.href),700))"
}
```
- Result
```json
{
  "result": "\"http://127.0.0.1:4173/studio/drops\"",
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops\n- Page Title: Hourline Launch Hub\n- Console: 1 errors, 0 warnings"
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
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops\n- Page Title: Hourline Launch Hub\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - link \"Skip to content\" [ref=e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=e19]:\n    - generic [ref=e20]: Hourline\n    - navigation \"Studio\" [ref=e21]:\n      - link \"Drops\" [ref=e22] [cursor=pointer]:\n        - /url: /studio/drops\n      - link \"Members\" [ref=e23] [cursor=pointer]:\n        - /url: /studio/members\n      - link \"Price lists\" [ref=e24] [cursor=pointer]:\n        - /url: /studio/price-lists\n    - button \"Sign out\" [ref=e25] [cursor=pointer]\n  - main [ref=e26]:\n    - heading \"Drops\" [active] [level=1] [ref=e27]\n    - generic [ref=e29]:\n      - link \"New drop\" [ref=e30] [cursor=pointer]:\n        - /url: /studio/drops/new\n      - table \"Drops\" [ref=e31]:\n        - caption [ref=e32]: Drops\n        - rowgroup [ref=e33]:\n          - row \"Name Harbour Wool Edit Type Simultaneous Status scheduled Opens Thu 18 Mar 2027, 10:00 Copenhagen time\" [ref=e34]\n          - row \"Name Midwinter Draft Type Simultaneous Status draft Opens —\" [ref=e42]\n          - row \"Name Lantern Ceramics Type Simultaneous Status Withdrawn Opens Thu 3 Dec 2026, 10:00 Copenhagen time\" [ref=e50]\n          - row \"Name Night Ferry Knits Type Rolling Status Live Opens Thu 1 Oct 2026, 03:00 Copenhagen time\" [ref=e61]\n          - row \"Name New Year Studio Type Rolling Status scheduled Opens Fri 1 Jan 2027, 04:00 Copenhagen time\" [ref=e72]\n          - row \"Name Salt Linen Type Simultaneous Status Sold out Opens Thu 4 Jun 2026, 10:00 Copenhagen time\" [ref=e80]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "e34",
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops\n- Page Title: Hourline Launch Hub\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- row [ref=e34]:\n  - cell [ref=e35]:\n    - text: Name\n    - link \"Harbour Wool Edit\" [ref=e36] [cursor=pointer]:\n      - /url: /studio/drops/drop_5m1m3y392z0q1754562w\n  - cell \"Type Simultaneous\" [ref=e37]\n  - cell [ref=e38]:\n    - text: Status\n    - cell \"scheduled\" [ref=e39]\n  - cell \"Opens Thu 18 Mar 2027, 10:00 Copenhagen time\" [ref=e41]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Harbour Wool Edit",
  "target": "e36"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops\n- Page Title: Hourline Launch Hub\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - link \"Skip to content\" [ref=e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=e19]:\n    - generic [ref=e20]: Hourline\n    - navigation \"Studio\" [ref=e21]:\n      - link \"Drops\" [ref=e22] [cursor=pointer]:\n        - /url: /studio/drops\n      - link \"Members\" [ref=e23] [cursor=pointer]:\n        - /url: /studio/members\n      - link \"Price lists\" [ref=e24] [cursor=pointer]:\n        - /url: /studio/price-lists\n    - button \"Sign out\" [ref=e25] [cursor=pointer]\n  - main [ref=e26]:\n    - heading \"Drops\" [level=1] [ref=e27]\n    - generic [ref=e29]:\n      - link \"New drop\" [ref=e30] [cursor=pointer]:\n        - /url: /studio/drops/new\n      - table [ref=e31]:\n        - caption [ref=e32]: Drops\n        - rowgroup [ref=e33]:\n          - row [ref=e34]:\n            - cell [ref=e35]:\n              - text: Name\n              - link \"Harbour Wool Edit\" [active] [ref=e36] [cursor=pointer]:\n                - /url: /studio/drops/drop_5m1m3y392z0q1754562w\n            - cell \"Type Simultaneous\" [ref=e37]\n            - cell [ref=e38]:\n              - text: Status\n              - cell \"scheduled\" [ref=e39]\n            - cell \"Opens Thu 18 Mar 2027, 10:00 Copenhagen time\" [ref=e41]\n          - row [ref=e42]:\n            - cell [ref=e43]:\n              - text: Name\n              - link \"Midwinter Draft\" [ref=e44] [cursor=pointer]:\n                - /url: /studio/drops/drop_3w640d316u1q1z3h4834\n            - cell \"Type Simultaneous\" [ref=e45]\n            - cell [ref=e46]:\n              - text: Status\n              - cell \"draft\" [ref=e47]\n            - cell \"Opens —\" [ref=e49]\n          - row [ref=e50]:\n            - cell [ref=e51]:\n              - text: Name\n              - link \"Lantern Ceramics\" [ref=e52] [cursor=pointer]:\n                - /url: /studio/drops/drop_6k0l1q2f1u2a3i354850\n            - cell \"Type Simultaneous\" [ref=e53]\n            - cell [ref=e54]:\n              - text: Status\n              - cell \"Withdrawn\" [ref=e55]\n            - cell \"Opens Thu 3 Dec 2026, 10:00 Copenhagen time\" [ref=e60]\n          - row [ref=e61]:\n            - cell [ref=e62]:\n              - text: Name\n              - link \"Night Ferry Knits\" [ref=e63] [cursor=pointer]:\n                - /url: /studio/drops/drop_5u5j0v1a67355q1x3i2s\n            - cell \"Type Rolling\" [ref=e64]\n            - cell [ref=e65]:\n              - text: Status\n              - cell \"Live\" [ref=e66]\n            - cell \"Opens Thu 1 Oct 2026, 03:00 Copenhagen time\" [ref=e71]\n          - row [ref=e72]:\n            - cell [ref=e73]:\n              - text: Name\n              - link \"New Year Studio\" [ref=e74] [cursor=pointer]:\n                - /url: /studio/drops/drop_110b6n2e704k5q0e3x0t\n            - cell \"Type Rolling\" [ref=e75]\n            - cell [ref=e76]:\n              - text: Status\n              - cell \"scheduled\" [ref=e77]\n            - cell \"Opens Fri 1 Jan 2027, 04:00 Copenhagen time\" [ref=e79]\n          - row [ref=e80]:\n            - cell [ref=e81]:\n              - text: Name\n              - link \"Salt Linen\" [ref=e82] [cursor=pointer]:\n                - /url: /studio/drops/drop_2r11576854591l6e5e69\n            - cell \"Type Simultaneous\" [ref=e83]\n            - cell [ref=e84]:\n              - text: Status\n              - cell \"Sold out\" [ref=e85]\n            - cell \"Opens Thu 4 Jun 2026, 10:00 Copenhagen time\" [ref=e90]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "()=>new Promise(r=>setTimeout(()=>r(location.href),700))"
}
```
- Result
```json
{
  "result": "\"http://127.0.0.1:4173/studio/drops/drop_5m1m3y392z0q1754562w\"",
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops/drop_5m1m3y392z0q1754562w\n- Page Title: Hourline Launch Hub\n- Console: 1 errors, 0 warnings"
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
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops/drop_5m1m3y392z0q1754562w\n- Page Title: Hourline Launch Hub\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - link \"Skip to content\" [ref=e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=e19]:\n    - generic [ref=e20]: Hourline\n    - navigation \"Studio\" [ref=e21]:\n      - link \"Drops\" [ref=e22] [cursor=pointer]:\n        - /url: /studio/drops\n      - link \"Members\" [ref=e23] [cursor=pointer]:\n        - /url: /studio/members\n      - link \"Price lists\" [ref=e24] [cursor=pointer]:\n        - /url: /studio/price-lists\n    - button \"Sign out\" [ref=e25] [cursor=pointer]\n  - main [ref=e91]:\n    - heading \"Plan Harbour Wool Edit\" [active] [level=1] [ref=e92]\n    - generic [ref=e93]:\n      - generic [ref=e94]:\n        - generic [ref=e95]:\n          - generic [ref=e96]\n          - generic [ref=e99]\n        - group \"Embargo dial\" [ref=e108]:\n          - slider \"Drop time\" [ref=e109]: \"40\"\n          - img [aria-hidden] [ref=e110]\n        - paragraph [aria-hidden] [ref=e241]: Copenhagen skips from 02:00 to 03:00 on Thursday. Choose another time.\n        - paragraph [ref=e242]: Move the slider or press the ring to set the time.\n      - generic [ref=e243]:\n        - table \"Market times\" [ref=e244]:\n          - caption [ref=e245]: Market times\n          - rowgroup [ref=e246]\n          - rowgroup [ref=e253]\n        - generic [ref=e290]:\n          - button \"Save time\" [disabled] [ref=e291]\n          - button \"Schedule drop\" [ref=e292] [cursor=pointer]\n        - generic [ref=e293]:\n          - button \"Withdraw drop\" [ref=e294] [cursor=pointer]\n          - button \"Add VIP members\" [ref=e295] [cursor=pointer]\n        - status \"Planner status\" [ref=e296]\n      - region \"Weekly restock\" [ref=e298]:\n        - heading \"Weekly restock\" [level=2] [ref=e299]\n        - generic [ref=e300]:\n          - generic [ref=e301]\n          - generic [ref=e304]\n          - generic [ref=e307]\n          - generic [ref=e310]\n          - generic [ref=e313]\n          - generic [ref=e316]\n          - generic [ref=e319]\n          - generic [ref=e322]\n          - button \"Save restock\" [ref=e325] [cursor=pointer]\n      - table \"Next restocks\" [ref=e327]:\n        - caption [ref=e328]: Next restocks\n        - rowgroup [ref=e329]:\n          - row \"# Copenhagen London New York UTC\" [ref=e330]\n        - rowgroup [ref=e336]:\n          - row \"Nothing here yet.\" [ref=e337]\n    - region \"Markets\" [ref=e339]:\n      - heading \"Markets\" [level=2] [ref=e340]\n      - paragraph [ref=e341]: Copenhagen\n      - paragraph [ref=e342]: Stockholm\n      - paragraph [ref=e343]: Paris\n      - paragraph [ref=e344]: London\n      - paragraph [ref=e345]: New York\n      - paragraph [ref=e346]: Tokyo"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "element": "Embargo dial",
  "target": "e108",
  "function": "(e)=>({rect:e.getBoundingClientRect().toJSON(),viewport:innerWidth,svg:e.querySelector('svg').getBoundingClientRect().toJSON(),scrollWidth:document.documentElement.scrollWidth})"
}
```
- Result
```json
{
  "result": "{\n  \"rect\": {\n    \"x\": 19,\n    \"y\": 466.625,\n    \"width\": 365.71875,\n    \"height\": 389.71875,\n    \"top\": 466.625,\n    \"right\": 384.71875,\n    \"bottom\": 856.34375,\n    \"left\": 19\n  },\n  \"viewport\": 404,\n  \"svg\": {\n    \"x\": 19,\n    \"y\": 490.625,\n    \"width\": 365.71875,\n    \"height\": 365.71875,\n    \"top\": 490.625,\n    \"right\": 384.71875,\n    \"bottom\": 856.34375,\n    \"left\": 19\n  },\n  \"scrollWidth\": 404\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Embargo dial",
  "target": "e108",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of Embargo dial](evidence/touch/element-2026-11-04T20-46-07-704Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
