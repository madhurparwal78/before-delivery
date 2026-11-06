
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
  "events": "- New console entries: evidence/touch/console-2026-11-04T20-50-12-589Z.log#L1-L2"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "input[type=email]",
      "name": "Email",
      "type": "textbox",
      "value": "ida.holm@marenvale.example"
    },
    {
      "target": "input[type=password]",
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
  "target": "button[type=submit]"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Hourline Launch Hub\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [active] [ref=e1]:\n  - link \"Skip to content\" [ref=e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - main [ref=e4]:\n    - generic [ref=e5]:\n      - heading \"Sign in\" [level=1] [ref=e6]\n      - form \"Sign in\" [ref=e7]:\n        - generic [ref=e8]:\n          - generic [ref=e9]: Email\n          - textbox \"Email\" [ref=e10]: ida.holm@marenvale.example\n        - generic [ref=e11]:\n          - generic [ref=e12]: Password\n          - textbox \"Password\" [ref=e13]: Hourline-Seed-2027\n        - button \"Signing in…\" [disabled] [ref=e17]\n        - link \"Forgot password?\" [ref=e15] [cursor=pointer]:\n          - /url: /forgot-password\n        - status \"Sign-in status\" [ref=e16]"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/studio/drops"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops\n- Page Title: Hourline Launch Hub",
  "snapshot": "- generic [ref=f1e1]:\n  - link \"Skip to content\" [ref=f1e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - main [ref=f1e4]:\n    - generic [ref=f1e5]:\n      - heading \"Page not found\" [active] [level=1] [ref=f1e6]\n      - link \"Back to the drop calendar\" [ref=f1e7] [cursor=pointer]:\n        - /url: /"
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
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops\n- Page Title: Hourline Launch Hub",
  "inlineSnapshot": "- generic [ref=f1e1]:\n  - link \"Skip to content\" [ref=f1e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - main [ref=f1e4]:\n    - generic [ref=f1e5]:\n      - heading \"Page not found\" [active] [level=1] [ref=f1e6]\n      - link \"Back to the drop calendar\" [ref=f1e7] [cursor=pointer]:\n        - /url: /"
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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Hourline Launch Hub",
  "snapshot": "- generic [ref=f2e1]:\n  - link \"Skip to content\" [ref=f2e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - main [ref=f2e4]:\n    - generic [ref=f2e5]:\n      - heading \"Sign in\" [active] [level=1] [ref=f2e6]\n      - form \"Sign in\" [ref=f2e7]:\n        - generic [ref=f2e8]:\n          - generic [ref=f2e9]: Email\n          - textbox \"Email\" [ref=f2e10]\n        - generic [ref=f2e11]:\n          - generic [ref=f2e12]: Password\n          - textbox \"Password\" [ref=f2e13]\n        - button \"Sign in\" [ref=f2e14] [cursor=pointer]\n        - link \"Forgot password?\" [ref=f2e15] [cursor=pointer]:\n          - /url: /forgot-password\n        - status \"Sign-in status\" [ref=f2e16]",
  "events": "- New console entries: evidence/touch/console-2026-11-04T20-50-32-062Z.log#L1"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "input[type=email]",
      "name": "Email",
      "type": "textbox",
      "value": "ida.holm@marenvale.example"
    },
    {
      "target": "input[type=password]",
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
  "target": "button[type=submit]"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Hourline Launch Hub",
  "snapshot": "- generic [active] [ref=f2e1]:\n  - link \"Skip to content\" [ref=f2e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - main [ref=f2e4]:\n    - generic [ref=f2e5]:\n      - heading \"Sign in\" [level=1] [ref=f2e6]\n      - form \"Sign in\" [ref=f2e7]:\n        - generic [ref=f2e8]:\n          - generic [ref=f2e9]: Email\n          - textbox \"Email\" [ref=f2e10]: ida.holm@marenvale.example\n        - generic [ref=f2e11]:\n          - generic [ref=f2e12]: Password\n          - textbox \"Password\" [ref=f2e13]: Hourline-Seed-2027\n        - button \"Signing in…\" [disabled] [ref=f2e17]\n        - link \"Forgot password?\" [ref=f2e15] [cursor=pointer]:\n          - /url: /forgot-password\n        - status \"Sign-in status\" [ref=f2e16]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => location.href"
}
```
- Result
```json
{
  "result": "\"http://127.0.0.1:4173/studio/drops\"",
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops\n- Page Title: Hourline Launch Hub"
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
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops\n- Page Title: Hourline Launch Hub",
  "inlineSnapshot": "- generic [ref=f2e1]:\n  - link \"Skip to content\" [ref=f2e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=f2e19]:\n    - generic [ref=f2e20]: Hourline\n    - navigation \"Studio\" [ref=f2e21]:\n      - link \"Drops\" [ref=f2e22] [cursor=pointer]:\n        - /url: /studio/drops\n      - link \"Members\" [ref=f2e23] [cursor=pointer]:\n        - /url: /studio/members\n      - link \"Price lists\" [ref=f2e24] [cursor=pointer]:\n        - /url: /studio/price-lists\n    - button \"Sign out\" [ref=f2e25] [cursor=pointer]\n  - main [ref=f2e26]:\n    - heading \"Drops\" [active] [level=1] [ref=f2e27]\n    - generic [ref=f2e29]:\n      - link \"New drop\" [ref=f2e30] [cursor=pointer]:\n        - /url: /studio/drops/new\n      - table \"Drops\" [ref=f2e31]:\n        - caption [ref=f2e32]: Drops\n        - rowgroup [ref=f2e33]:\n          - row \"Name Harbour Wool Edit Type Simultaneous Status scheduled Opens Thu 18 Mar 2027, 10:00 Copenhagen time\" [ref=f2e34]\n          - row \"Name Midwinter Draft Type Simultaneous Status draft Opens —\" [ref=f2e42]\n          - row \"Name Lantern Ceramics Type Simultaneous Status Withdrawn Opens Thu 3 Dec 2026, 10:00 Copenhagen time\" [ref=f2e50]\n          - row \"Name Night Ferry Knits Type Rolling Status Live Opens Thu 1 Oct 2026, 03:00 Copenhagen time\" [ref=f2e61]\n          - row \"Name New Year Studio Type Rolling Status scheduled Opens Fri 1 Jan 2027, 04:00 Copenhagen time\" [ref=f2e72]\n          - row \"Name Salt Linen Type Simultaneous Status Sold out Opens Thu 4 Jun 2026, 10:00 Copenhagen time\" [ref=f2e80]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "f2e34",
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops\n- Page Title: Hourline Launch Hub",
  "inlineSnapshot": "- row [ref=f2e34]:\n  - cell [ref=f2e35]:\n    - text: Name\n    - link \"Harbour Wool Edit\" [ref=f2e36] [cursor=pointer]:\n      - /url: /studio/drops/drop_5m1m3y392z0q1754562w\n  - cell \"Type Simultaneous\" [ref=f2e37]\n  - cell [ref=f2e38]:\n    - text: Status\n    - cell \"scheduled\" [ref=f2e39]\n  - cell \"Opens Thu 18 Mar 2027, 10:00 Copenhagen time\" [ref=f2e41]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Harbour Wool Edit",
  "target": "f2e36"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops\n- Page Title: Hourline Launch Hub",
  "snapshot": "- generic [ref=f2e1]:\n  - link \"Skip to content\" [ref=f2e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=f2e19]:\n    - generic [ref=f2e20]: Hourline\n    - navigation \"Studio\" [ref=f2e21]:\n      - link \"Drops\" [ref=f2e22] [cursor=pointer]:\n        - /url: /studio/drops\n      - link \"Members\" [ref=f2e23] [cursor=pointer]:\n        - /url: /studio/members\n      - link \"Price lists\" [ref=f2e24] [cursor=pointer]:\n        - /url: /studio/price-lists\n    - button \"Sign out\" [ref=f2e25] [cursor=pointer]\n  - main [ref=f2e26]:\n    - heading \"Drops\" [level=1] [ref=f2e27]\n    - generic [ref=f2e29]:\n      - link \"New drop\" [ref=f2e30] [cursor=pointer]:\n        - /url: /studio/drops/new\n      - table [ref=f2e31]:\n        - caption [ref=f2e32]: Drops\n        - rowgroup [ref=f2e33]:\n          - row [ref=f2e34]:\n            - cell [ref=f2e35]:\n              - text: Name\n              - link \"Harbour Wool Edit\" [active] [ref=f2e36] [cursor=pointer]:\n                - /url: /studio/drops/drop_5m1m3y392z0q1754562w\n            - cell \"Type Simultaneous\" [ref=f2e37]\n            - cell [ref=f2e38]:\n              - text: Status\n              - cell \"scheduled\" [ref=f2e39]\n            - cell \"Opens Thu 18 Mar 2027, 10:00 Copenhagen time\" [ref=f2e41]\n          - row [ref=f2e42]:\n            - cell [ref=f2e43]:\n              - text: Name\n              - link \"Midwinter Draft\" [ref=f2e44] [cursor=pointer]:\n                - /url: /studio/drops/drop_3w640d316u1q1z3h4834\n            - cell \"Type Simultaneous\" [ref=f2e45]\n            - cell [ref=f2e46]:\n              - text: Status\n              - cell \"draft\" [ref=f2e47]\n            - cell \"Opens —\" [ref=f2e49]\n          - row [ref=f2e50]:\n            - cell [ref=f2e51]:\n              - text: Name\n              - link \"Lantern Ceramics\" [ref=f2e52] [cursor=pointer]:\n                - /url: /studio/drops/drop_6k0l1q2f1u2a3i354850\n            - cell \"Type Simultaneous\" [ref=f2e53]\n            - cell [ref=f2e54]:\n              - text: Status\n              - cell \"Withdrawn\" [ref=f2e55]\n            - cell \"Opens Thu 3 Dec 2026, 10:00 Copenhagen time\" [ref=f2e60]\n          - row [ref=f2e61]:\n            - cell [ref=f2e62]:\n              - text: Name\n              - link \"Night Ferry Knits\" [ref=f2e63] [cursor=pointer]:\n                - /url: /studio/drops/drop_5u5j0v1a67355q1x3i2s\n            - cell \"Type Rolling\" [ref=f2e64]\n            - cell [ref=f2e65]:\n              - text: Status\n              - cell \"Live\" [ref=f2e66]\n            - cell \"Opens Thu 1 Oct 2026, 03:00 Copenhagen time\" [ref=f2e71]\n          - row [ref=f2e72]:\n            - cell [ref=f2e73]:\n              - text: Name\n              - link \"New Year Studio\" [ref=f2e74] [cursor=pointer]:\n                - /url: /studio/drops/drop_110b6n2e704k5q0e3x0t\n            - cell \"Type Rolling\" [ref=f2e75]\n            - cell [ref=f2e76]:\n              - text: Status\n              - cell \"scheduled\" [ref=f2e77]\n            - cell \"Opens Fri 1 Jan 2027, 04:00 Copenhagen time\" [ref=f2e79]\n          - row [ref=f2e80]:\n            - cell [ref=f2e81]:\n              - text: Name\n              - link \"Salt Linen\" [ref=f2e82] [cursor=pointer]:\n                - /url: /studio/drops/drop_2r11576854591l6e5e69\n            - cell \"Type Simultaneous\" [ref=f2e83]\n            - cell [ref=f2e84]:\n              - text: Status\n              - cell \"Sold out\" [ref=f2e85]\n            - cell \"Opens Thu 4 Jun 2026, 10:00 Copenhagen time\" [ref=f2e90]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => location.href"
}
```
- Result
```json
{
  "result": "\"http://127.0.0.1:4173/studio/drops/drop_5m1m3y392z0q1754562w\"",
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops/drop_5m1m3y392z0q1754562w\n- Page Title: Hourline Launch Hub"
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
  "page": "- Page URL: http://127.0.0.1:4173/studio/drops/drop_5m1m3y392z0q1754562w\n- Page Title: Hourline Launch Hub",
  "inlineSnapshot": "- generic [ref=f2e1]:\n  - link \"Skip to content\" [ref=f2e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=f2e19]:\n    - generic [ref=f2e20]: Hourline\n    - navigation \"Studio\" [ref=f2e21]:\n      - link \"Drops\" [ref=f2e22] [cursor=pointer]:\n        - /url: /studio/drops\n      - link \"Members\" [ref=f2e23] [cursor=pointer]:\n        - /url: /studio/members\n      - link \"Price lists\" [ref=f2e24] [cursor=pointer]:\n        - /url: /studio/price-lists\n    - button \"Sign out\" [ref=f2e25] [cursor=pointer]\n  - main [ref=f2e91]:\n    - heading \"Plan Harbour Wool Edit\" [active] [level=1] [ref=f2e92]\n    - generic [ref=f2e93]:\n      - generic [ref=f2e94]:\n        - generic [ref=f2e95]\n        - group \"Embargo dial\" [ref=f2e108]\n        - paragraph [aria-hidden] [ref=f2e241]: Copenhagen skips from 02:00 to 03:00 on Thursday. Choose another time.\n        - paragraph [ref=f2e242]: Move the slider or press the ring to set the time.\n      - generic [ref=f2e243]:\n        - table \"Market times\" [ref=f2e244]\n        - generic [ref=f2e290]\n        - generic [ref=f2e293]\n        - status \"Planner status\" [ref=f2e296]\n      - region \"Weekly restock\" [ref=f2e298]:\n        - heading \"Weekly restock\" [level=2] [ref=f2e299]\n        - generic [ref=f2e300]\n      - table \"Next restocks\" [ref=f2e327]:\n        - caption [ref=f2e328]: Next restocks\n        - rowgroup [ref=f2e329]\n        - rowgroup [ref=f2e336]\n    - region \"Markets\" [ref=f2e339]:\n      - heading \"Markets\" [level=2] [ref=f2e340]\n      - paragraph [ref=f2e341]: Copenhagen\n      - paragraph [ref=f2e342]: Stockholm\n      - paragraph [ref=f2e343]: Paris\n      - paragraph [ref=f2e344]: London\n      - paragraph [ref=f2e345]: New York\n      - paragraph [ref=f2e346]: Tokyo"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const g=document.querySelector('[role=group][aria-label=\"Embargo dial\"], fieldset'); const r=g.getBoundingClientRect(); return {viewport:innerWidth,x:r.x,right:r.right,width:r.width,height:r.height};}"
}
```
- Result
```json
{
  "result": "{\n  \"viewport\": 404,\n  \"x\": 19,\n  \"right\": 384.71875,\n  \"width\": 365.71875,\n  \"height\": 389.71875\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Embargo dial",
  "target": "f2e108",
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of Embargo dial](evidence/touch/element-2026-11-04T20-51-03-708Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
