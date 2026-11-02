
### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/box"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/box\n- Page Title: Ceibo",
  "snapshot": "- generic [ref=e2]:\n  - link \"Skip to the crate\" [ref=e3] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=e4]:\n    - generic [ref=e5]:\n      - link \"Ceibo home\" [ref=e6] [cursor=pointer]:\n        - /url: /\n        - text: Ceibo\n      - generic [ref=e8]:\n        - button \"Menu\" [ref=e9] [cursor=pointer]\n        - button \"Cart (0)\" [ref=e12] [cursor=pointer]:\n          - generic [ref=e19]: Cart\n          - generic [ref=e20]: \"0\"\n  - main [ref=e21]:\n    - generic [ref=e22]:\n      - generic [ref=e23]:\n        - generic [ref=e24]:\n          - heading \"Build your crate\" [level=1] [ref=e25]\n          - paragraph [ref=e26]: Mix any 12 cans, or fill the whole crate with one flavour. Your crate holds them while you shop.\n        - list \"Flavours\" [ref=e28]:\n          - listitem\n          - listitem\n          - listitem\n          - listitem\n      - region \"Crate\" [ref=e29]:\n        - heading \"Your crate\" [level=2] [ref=e30]\n        - group \"Cans in crate\" [ref=e31]:\n          - generic [ref=e32]:\n            - text: \"00\"\n            - generic [ref=e33]: /12\n        - list \"Crate slots\" [ref=e34]:\n          - 'listitem \"Slot 1: empty\" [ref=e35]'\n          - 'listitem \"Slot 2: empty\" [ref=e37]'\n          - 'listitem \"Slot 3: empty\" [ref=e39]'\n          - 'listitem \"Slot 4: empty\" [ref=e41]'\n          - 'listitem \"Slot 5: empty\" [ref=e43]'\n          - 'listitem \"Slot 6: empty\" [ref=e45]'\n          - 'listitem \"Slot 7: empty\" [ref=e47]'\n          - 'listitem \"Slot 8: empty\" [ref=e49]'\n          - 'listitem \"Slot 9: empty\" [ref=e51]'\n          - 'listitem \"Slot 10: empty\" [ref=e53]'\n          - 'listitem \"Slot 11: empty\" [ref=e55]'\n          - 'listitem \"Slot 12: empty\" [ref=e57]'\n        - generic [ref=e59]:\n          - meter \"Free shipping\" [ref=e60]\n          - paragraph\n        - button \"Open cart\" [ref=e61] [cursor=pointer]:\n          - text: Cart\n          - generic [ref=e68]: \"0\"\n        - status \"Crate updates\" [ref=e69]"
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
  "page": "- Page URL: http://127.0.0.1:4173/box\n- Page Title: Ceibo",
  "inlineSnapshot": "- generic [ref=e2] [box=0,0,375,1650]:\n  - link \"Skip to the crate\" [ref=e3] [cursor=pointer] [box=100,-59,174,49]:\n    - /url: \"#main\"\n  - banner [ref=e4] [box=0,0,375,61]:\n    - generic [ref=e5] [box=0,0,375,60]:\n      - link \"Ceibo home\" [ref=e6] [cursor=pointer] [box=12,18,68,25]:\n        - /url: /\n        - text: Ceibo\n      - generic [ref=e8] [box=88,8,190,44]:\n        - button \"Menu\" [ref=e9] [cursor=pointer] [box=88,8,81,44]\n        - button \"Cart (0)\" [ref=e12] [cursor=pointer] [box=177,8,101,44]:\n          - generic [ref=e19] [box=211,19,29,22]: Cart\n          - generic [ref=e20] [box=244,19,25,22]: \"0\"\n  - main [ref=e21] [box=0,61,375,1589]:\n    - generic [ref=e22] [box=0,61,375,1589]:\n      - generic [ref=e23] [box=24,93,327,1167]:\n        - generic [ref=e24] [box=24,93,327,127]:\n          - heading \"Build your crate\" [level=1] [ref=e25] [box=24,93,327,41]\n          - paragraph [ref=e26] [box=24,146,327,74]: Mix any 12 cans, or fill the whole crate with one flavour. Your crate holds them while you shop.\n        - list \"Flavours\" [ref=e28] [box=24,244,327,1016]:\n          - listitem [ref=e70] [box=24,244,327,236]\n          - listitem [ref=e92] [box=24,504,327,236]\n          - listitem [ref=e113] [box=24,764,327,236]\n          - listitem [ref=e134] [box=24,1024,327,236]\n      - region \"Crate\" [ref=e29] [box=0,447,375,365]:\n        - heading \"Your crate\" [level=2] [ref=e30] [box=-1,446,1,1]\n        - group \"Cans in crate\" [ref=e31] [box=16,459,343,44]:\n          - generic [ref=e32] [box=16,462,72,37]\n        - list \"Crate slots\" [ref=e34] [box=56,514,264,487]:\n          - 'listitem \"Slot 1: empty\" [ref=e35] [box=56,514,83,116]'\n          - 'listitem \"Slot 2: empty\" [ref=e37] [box=146,514,83,116]'\n          - 'listitem \"Slot 3: empty\" [ref=e39] [box=237,514,83,116]'\n          - 'listitem \"Slot 4: empty\" [ref=e41] [box=56,638,83,116]'\n          - 'listitem \"Slot 5: empty\" [ref=e43] [box=146,638,83,116]'\n          - 'listitem \"Slot 6: empty\" [ref=e45] [box=237,638,83,116]'\n          - 'listitem \"Slot 7: empty\" [ref=e47] [box=56,762,83,116]'\n          - 'listitem \"Slot 8: empty\" [ref=e49] [box=146,762,83,116]'\n          - 'listitem \"Slot 9: empty\" [ref=e51] [box=237,762,83,116]'\n          - 'listitem \"Slot 10: empty\" [ref=e53] [box=56,886,83,116]'\n          - 'listitem \"Slot 11: empty\" [ref=e55] [box=146,886,83,116]'\n          - 'listitem \"Slot 12: empty\" [ref=e57] [box=237,886,83,116]'\n        - generic [ref=e59] [box=16,1013,343,42]:\n          - meter \"Free shipping\" [ref=e60] [box=16,1013,343,12]\n          - paragraph [ref=e156] [box=16,1033,343,22]: $35.00 to free shipping in Ontario.\n        - button \"Open cart\" [ref=e61] [cursor=pointer] [box=16,1068,343,44]:\n          - text: Cart\n          - generic [ref=e68] [box=216,1077,10,25]: \"0\"\n        - status \"Crate updates\" [ref=e69] [box=16,1140,343,23]"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "PageDown"
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
  "key": "PageDown"
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
  "depth": 4,
  "boxes": true
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/box\n- Page Title: Ceibo",
  "inlineSnapshot": "- generic [ref=e2] [box=0,-838,375,1650]:\n  - link \"Skip to the crate\" [ref=e3] [cursor=pointer] [box=100,-897,174,49]:\n    - /url: \"#main\"\n  - banner [ref=e4] [box=0,0,375,61]:\n    - generic [ref=e5] [box=0,0,375,60]:\n      - link \"Ceibo home\" [ref=e6] [cursor=pointer] [box=12,18,68,25]:\n        - /url: /\n        - text: Ceibo\n      - generic [ref=e8] [box=88,8,190,44]:\n        - button \"Menu\" [ref=e9] [cursor=pointer] [box=88,8,81,44]\n        - button \"Cart (0)\" [ref=e12] [cursor=pointer] [box=177,8,101,44]\n  - main [ref=e21] [box=0,-777,375,1589]:\n    - generic [ref=e22] [box=0,-777,375,1589]:\n      - generic [ref=e23] [box=24,-745,327,1167]:\n        - generic [ref=e24] [box=24,-745,327,127]\n        - list \"Flavours\" [ref=e28] [box=24,-594,327,1016]\n      - region \"Crate\" [ref=e29] [box=0,447,375,365]:\n        - heading \"Your crate\" [level=2] [ref=e30] [box=-1,446,1,1]\n        - group \"Cans in crate\" [ref=e31] [box=16,459,343,44]\n        - list \"Crate slots\" [ref=e34] [box=56,514,264,487]\n        - generic [ref=e59] [box=16,1013,343,42]\n        - button \"Open cart\" [ref=e61] [cursor=pointer] [box=16,1068,343,44]\n        - status \"Crate updates\" [ref=e69] [box=16,1140,343,23]"
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

### Tool call: browser_snapshot
- Args
```json
{
  "target": "e28",
  "depth": 6
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/box\n- Page Title: Ceibo",
  "inlineSnapshot": "- list \"Flavours\" [ref=e28]:\n  - listitem [ref=e70]:\n    - article [ref=e71]:\n      - img [aria-hidden] [ref=e75]:\n        - generic [ref=e76]: Ceibo\n      - generic [ref=e84]:\n        - heading [level=3] [ref=e85]:\n          - link \"Guava & Lime\" [ref=e86] [cursor=pointer]:\n            - /url: /flavours/guava-lime\n        - paragraph [ref=e87]: $3.33\n        - paragraph [ref=e88]: 598 left\n        - generic [ref=e89]:\n          - button \"Add Guava & Lime\" [ref=e90] [cursor=pointer]: Add\n          - button \"Fill crate with Guava & Lime\" [ref=e91] [cursor=pointer]: Fill crate\n  - listitem [ref=e92]:\n    - article [ref=e93]:\n      - img [aria-hidden] [ref=e97]:\n        - generic [ref=e98]: Ceibo\n      - generic [ref=e105]:\n        - heading [level=3] [ref=e106]:\n          - link \"Yuzu Ginger\" [ref=e107] [cursor=pointer]:\n            - /url: /flavours/yuzu-ginger\n        - paragraph [ref=e108]: $3.33\n        - paragraph [ref=e109]: 599 left\n        - generic [ref=e110]:\n          - button \"Add Yuzu Ginger\" [ref=e111] [cursor=pointer]: Add\n          - button \"Fill crate with Yuzu Ginger\" [ref=e112] [cursor=pointer]: Fill crate\n  - listitem [ref=e113]:\n    - article [ref=e114]:\n      - img [aria-hidden] [ref=e118]:\n        - generic [ref=e119]: Ceibo\n      - generic [ref=e126]:\n        - heading [level=3] [ref=e127]:\n          - link \"Passionfruit Basil\" [ref=e128] [cursor=pointer]:\n            - /url: /flavours/passionfruit-basil\n        - paragraph [ref=e129]: $3.33\n        - paragraph [ref=e130]: 596 left\n        - generic [ref=e131]:\n          - button \"Add Passionfruit Basil\" [ref=e132] [cursor=pointer]: Add\n          - button \"Fill crate with Passionfruit Basil\" [ref=e133] [cursor=pointer]: Fill crate\n  - listitem [ref=e134]:\n    - article [ref=e135]:\n      - img [aria-hidden] [ref=e139]:\n        - generic [ref=e140]: Ceibo\n      - generic [ref=e148]:\n        - heading [level=3] [ref=e149]:\n          - link \"Cacao Orange\" [ref=e150] [cursor=pointer]:\n            - /url: /flavours/cacao-orange\n        - paragraph [ref=e151]: $3.75\n        - paragraph [ref=e152]: 48 left\n        - generic [ref=e153]:\n          - button \"Add Cacao Orange\" [ref=e154] [cursor=pointer]: Add\n          - button \"Fill crate with Cacao Orange\" [ref=e155] [cursor=pointer]: Fill crate"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Add Guava & Lime",
  "target": "e90"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/box\n- Page Title: Ceibo",
  "snapshot": "- generic [ref=e2]:\n  - link \"Skip to the crate\" [ref=e3] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=e4]:\n    - generic [ref=e5]:\n      - link \"Ceibo home\" [ref=e6] [cursor=pointer]:\n        - /url: /\n        - text: Ceibo\n      - generic [ref=e8]:\n        - button \"Menu\" [ref=e9] [cursor=pointer]\n        - button \"Cart (1)\" [ref=e157] [cursor=pointer]:\n          - generic [ref=e19]: Cart\n          - generic [ref=e20]: \"1\"\n  - main [ref=e21]:\n    - generic [ref=e22]:\n      - generic [ref=e23]:\n        - generic [ref=e24]:\n          - heading \"Build your crate\" [level=1] [ref=e25]\n          - paragraph [ref=e26]: Mix any 12 cans, or fill the whole crate with one flavour. Your crate holds them while you shop.\n        - list \"Flavours\" [ref=e28]:\n          - listitem [ref=e70]:\n            - article [ref=e71]:\n              - img [aria-hidden] [ref=e75]:\n                - generic [ref=e76]: Ceibo\n              - generic [ref=e84]:\n                - heading [level=3] [ref=e85]:\n                  - link \"Guava & Lime\" [ref=e86] [cursor=pointer]:\n                    - /url: /flavours/guava-lime\n                - paragraph [ref=e87]: $3.33\n                - paragraph [ref=e88]: 597 left\n                - generic [ref=e89]:\n                  - button \"Add Guava & Lime\" [active] [ref=e90] [cursor=pointer]: Add\n                  - button \"Fill crate with Guava & Lime\" [ref=e91] [cursor=pointer]: Fill crate\n          - listitem [ref=e92]:\n            - article [ref=e93]:\n              - img [aria-hidden] [ref=e97]:\n                - generic [ref=e98]: Ceibo\n              - generic [ref=e105]:\n                - heading [level=3] [ref=e106]:\n                  - link \"Yuzu Ginger\" [ref=e107] [cursor=pointer]:\n                    - /url: /flavours/yuzu-ginger\n                - paragraph [ref=e108]: $3.33\n                - paragraph [ref=e109]: 599 left\n                - generic [ref=e110]:\n                  - button \"Add Yuzu Ginger\" [ref=e111] [cursor=pointer]: Add\n                  - button \"Fill crate with Yuzu Ginger\" [ref=e112] [cursor=pointer]: Fill crate\n          - listitem [ref=e113]:\n            - article [ref=e114]:\n              - img [aria-hidden] [ref=e118]:\n                - generic [ref=e119]: Ceibo\n              - generic [ref=e126]:\n                - heading [level=3] [ref=e127]:\n                  - link \"Passionfruit Basil\" [ref=e128] [cursor=pointer]:\n                    - /url: /flavours/passionfruit-basil\n                - paragraph [ref=e129]: $3.33\n                - paragraph [ref=e130]: 596 left\n                - generic [ref=e131]:\n                  - button \"Add Passionfruit Basil\" [ref=e132] [cursor=pointer]: Add\n                  - button \"Fill crate with Passionfruit Basil\" [ref=e133] [cursor=pointer]: Fill crate\n          - listitem [ref=e134]:\n            - article [ref=e135]:\n              - img [aria-hidden] [ref=e139]:\n                - generic [ref=e140]: Ceibo\n              - generic [ref=e148]:\n                - heading [level=3] [ref=e149]:\n                  - link \"Cacao Orange\" [ref=e150] [cursor=pointer]:\n                    - /url: /flavours/cacao-orange\n                - paragraph [ref=e151]: $3.75\n                - paragraph [ref=e152]: 48 left\n                - generic [ref=e153]:\n                  - button \"Add Cacao Orange\" [ref=e154] [cursor=pointer]: Add\n                  - button \"Fill crate with Cacao Orange\" [ref=e155] [cursor=pointer]: Fill crate\n      - region \"Crate\" [ref=e29]:\n        - heading \"Your crate\" [level=2] [ref=e30]\n        - group \"Cans in crate\" [ref=e31]:\n          - generic [ref=e32]:\n            - text: \"00\"\n            - generic [ref=e33]: /12\n        - list \"Crate slots\" [ref=e34]:\n          - 'listitem \"Slot 1: Guava & Lime\" [ref=e158]':\n            - button \"Remove Guava & Lime from slot 1\" [ref=e159] [cursor=pointer]\n          - 'listitem \"Slot 2: empty\" [ref=e37]'\n          - 'listitem \"Slot 3: empty\" [ref=e39]'\n          - 'listitem \"Slot 4: empty\" [ref=e41]'\n          - 'listitem \"Slot 5: empty\" [ref=e43]'\n          - 'listitem \"Slot 6: empty\" [ref=e45]'\n          - 'listitem \"Slot 7: empty\" [ref=e47]'\n          - 'listitem \"Slot 8: empty\" [ref=e49]'\n          - 'listitem \"Slot 9: empty\" [ref=e51]'\n          - 'listitem \"Slot 10: empty\" [ref=e53]'\n          - 'listitem \"Slot 11: empty\" [ref=e55]'\n          - 'listitem \"Slot 12: empty\" [ref=e57]'\n        - generic [ref=e59]:\n          - meter \"Free shipping\" [ref=e60]\n          - paragraph [ref=e156]: $31.67 to free shipping in Ontario.\n        - button \"Open cart\" [ref=e61] [cursor=pointer]:\n          - text: Cart\n          - generic [ref=e68]: \"1\"\n        - status \"Crate updates\" [ref=e69]: Added Guava & Lime. 1 of 12 cans in your crate. 597 left. $31.67 to free shipping in Ontario.\n  - generic [aria-hidden]:\n    - generic:\n      - img [aria-hidden]:\n        - generic: Ceibo"
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
  "page": "- Page URL: http://127.0.0.1:4173/box\n- Page Title: Ceibo",
  "inlineSnapshot": "- generic [ref=e2]:\n  - link \"Skip to the crate\" [ref=e3] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=e4]:\n    - generic [ref=e5]:\n      - link \"Ceibo home\" [ref=e6] [cursor=pointer]:\n        - /url: /\n        - text: Ceibo\n      - generic [ref=e8]\n  - main [ref=e21]:\n    - generic [ref=e22]:\n      - generic [ref=e23]\n      - region \"Crate\" [ref=e29]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "e29",
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/box\n- Page Title: Ceibo",
  "inlineSnapshot": "- region \"Crate\" [ref=e29]:\n  - heading \"Your crate\" [level=2] [ref=e30]\n  - group \"Cans in crate\" [ref=e31]:\n    - generic [ref=e32]:\n      - text: \"01\"\n      - generic [ref=e33]: /12\n  - list \"Crate slots\" [ref=e34]:\n    - 'listitem \"Slot 1: Guava & Lime\" [ref=e158]':\n      - button \"Remove Guava & Lime from slot 1\" [ref=e159] [cursor=pointer]\n    - 'listitem \"Slot 2: empty\" [ref=e37]'\n    - 'listitem \"Slot 3: empty\" [ref=e39]'\n    - 'listitem \"Slot 4: empty\" [ref=e41]'\n    - 'listitem \"Slot 5: empty\" [ref=e43]'\n    - 'listitem \"Slot 6: empty\" [ref=e45]'\n    - 'listitem \"Slot 7: empty\" [ref=e47]'\n    - 'listitem \"Slot 8: empty\" [ref=e49]'\n    - 'listitem \"Slot 9: empty\" [ref=e51]'\n    - 'listitem \"Slot 10: empty\" [ref=e53]'\n    - 'listitem \"Slot 11: empty\" [ref=e55]'\n    - 'listitem \"Slot 12: empty\" [ref=e57]'\n  - generic [ref=e59]:\n    - meter \"Free shipping\" [ref=e60]\n    - paragraph [ref=e156]: $31.67 to free shipping in Ontario.\n  - button \"Open cart\" [ref=e61] [cursor=pointer]:\n    - text: Cart\n    - generic [ref=e68]: \"1\"\n  - status \"Crate updates\" [ref=e69]: Added Guava & Lime. 1 of 12 cans in your crate. 597 left. $31.67 to free shipping in Ontario."
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
  "page": "- Page URL: http://127.0.0.1:4173/box\n- Page Title: Ceibo",
  "inlineSnapshot": "- generic [ref=e2]:\n  - link \"Skip to the crate\" [ref=e3] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=e4]:\n    - generic [ref=e5]:\n      - link \"Ceibo home\" [ref=e6] [cursor=pointer]:\n        - /url: /\n        - text: Ceibo\n      - generic [ref=e8]:\n        - button \"Menu\" [ref=e9] [cursor=pointer]\n        - button \"Cart (1)\" [ref=e157] [cursor=pointer]\n  - main [ref=e21]:\n    - generic [ref=e22]:\n      - generic [ref=e23]:\n        - generic [ref=e24]\n        - list \"Flavours\" [ref=e28]\n      - region \"Crate\" [ref=e29]:\n        - heading \"Your crate\" [level=2] [ref=e30]\n        - group \"Cans in crate\" [ref=e31]\n        - list \"Crate slots\" [ref=e34]\n        - generic [ref=e59]\n        - button \"Open cart\" [ref=e61] [cursor=pointer]\n        - status \"Crate updates\" [ref=e69]: Added Guava & Lime. 1 of 12 cans in your crate. 597 left. $31.67 to free shipping in Ontario."
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Cart (1)",
  "target": "e157"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/box\n- Page Title: Ceibo",
  "snapshot": "- generic [ref=e2]:\n  - link \"Skip to the crate\" [ref=e3] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=e4]:\n    - generic [ref=e5]:\n      - link \"Ceibo home\" [ref=e6] [cursor=pointer]:\n        - /url: /\n        - text: Ceibo\n      - generic [ref=e8]:\n        - button \"Menu\" [ref=e9] [cursor=pointer]\n        - button \"Cart (1)\" [ref=e157] [cursor=pointer]:\n          - generic [ref=e19]: Cart\n          - generic [ref=e20]: \"1\"\n  - main [ref=e21]:\n    - generic [ref=e22]:\n      - generic [ref=e23]:\n        - generic [ref=e24]:\n          - heading \"Build your crate\" [level=1] [ref=e25]\n          - paragraph [ref=e26]: Mix any 12 cans, or fill the whole crate with one flavour. Your crate holds them while you shop.\n        - list \"Flavours\" [ref=e28]:\n          - listitem [ref=e70]:\n            - article [ref=e71]:\n              - img [aria-hidden] [ref=e75]:\n                - generic [ref=e76]: Ceibo\n              - generic [ref=e84]:\n                - heading [level=3] [ref=e85]:\n                  - link \"Guava & Lime\" [ref=e86] [cursor=pointer]:\n                    - /url: /flavours/guava-lime\n                - paragraph [ref=e87]: $3.33\n                - paragraph [ref=e88]: 597 left\n                - generic [ref=e89]:\n                  - button \"Add Guava & Lime\" [ref=e90] [cursor=pointer]: Add\n                  - button \"Fill crate with Guava & Lime\" [ref=e91] [cursor=pointer]: Fill crate\n          - listitem [ref=e92]:\n            - article [ref=e93]:\n              - img [aria-hidden] [ref=e97]:\n                - generic [ref=e98]: Ceibo\n              - generic [ref=e105]:\n                - heading [level=3] [ref=e106]:\n                  - link \"Yuzu Ginger\" [ref=e107] [cursor=pointer]:\n                    - /url: /flavours/yuzu-ginger\n                - paragraph [ref=e108]: $3.33\n                - paragraph [ref=e109]: 599 left\n                - generic [ref=e110]:\n                  - button \"Add Yuzu Ginger\" [ref=e111] [cursor=pointer]: Add\n                  - button \"Fill crate with Yuzu Ginger\" [ref=e112] [cursor=pointer]: Fill crate\n          - listitem [ref=e113]:\n            - article [ref=e114]:\n              - img [aria-hidden] [ref=e118]:\n                - generic [ref=e119]: Ceibo\n              - generic [ref=e126]:\n                - heading [level=3] [ref=e127]:\n                  - link \"Passionfruit Basil\" [ref=e128] [cursor=pointer]:\n                    - /url: /flavours/passionfruit-basil\n                - paragraph [ref=e129]: $3.33\n                - paragraph [ref=e130]: 596 left\n                - generic [ref=e131]:\n                  - button \"Add Passionfruit Basil\" [ref=e132] [cursor=pointer]: Add\n                  - button \"Fill crate with Passionfruit Basil\" [ref=e133] [cursor=pointer]: Fill crate\n          - listitem [ref=e134]:\n            - article [ref=e135]:\n              - img [aria-hidden] [ref=e139]:\n                - generic [ref=e140]: Ceibo\n              - generic [ref=e148]:\n                - heading [level=3] [ref=e149]:\n                  - link \"Cacao Orange\" [ref=e150] [cursor=pointer]:\n                    - /url: /flavours/cacao-orange\n                - paragraph [ref=e151]: $3.75\n                - paragraph [ref=e152]: 48 left\n                - generic [ref=e153]:\n                  - button \"Add Cacao Orange\" [ref=e154] [cursor=pointer]: Add\n                  - button \"Fill crate with Cacao Orange\" [ref=e155] [cursor=pointer]: Fill crate\n      - region \"Crate\" [ref=e29]:\n        - heading \"Your crate\" [level=2] [ref=e30]\n        - group \"Cans in crate\" [ref=e31]:\n          - generic [ref=e32]:\n            - text: \"01\"\n            - generic [ref=e33]: /12\n        - list \"Crate slots\" [ref=e34]:\n          - 'listitem \"Slot 1: Guava & Lime\" [ref=e158]':\n            - button \"Remove Guava & Lime from slot 1\" [ref=e159] [cursor=pointer]\n          - 'listitem \"Slot 2: empty\" [ref=e37]'\n          - 'listitem \"Slot 3: empty\" [ref=e39]'\n          - 'listitem \"Slot 4: empty\" [ref=e41]'\n          - 'listitem \"Slot 5: empty\" [ref=e43]'\n          - 'listitem \"Slot 6: empty\" [ref=e45]'\n          - 'listitem \"Slot 7: empty\" [ref=e47]'\n          - 'listitem \"Slot 8: empty\" [ref=e49]'\n          - 'listitem \"Slot 9: empty\" [ref=e51]'\n          - 'listitem \"Slot 10: empty\" [ref=e53]'\n          - 'listitem \"Slot 11: empty\" [ref=e55]'\n          - 'listitem \"Slot 12: empty\" [ref=e57]'\n        - generic [ref=e59]:\n          - meter \"Free shipping\" [ref=e60]\n          - paragraph [ref=e156]: $31.67 to free shipping in Ontario.\n        - button \"Open cart\" [ref=e61] [cursor=pointer]:\n          - text: Cart\n          - generic [ref=e68]: \"1\"\n        - status \"Crate updates\" [ref=e69]: Added Guava & Lime. 1 of 12 cans in your crate. 597 left. $31.67 to free shipping in Ontario.\n  - dialog \"Cart\" [ref=e166]:\n    - generic [ref=e167]:\n      - heading \"Your cart\" [active] [level=2] [ref=e168]\n      - button \"Close cart\" [ref=e169] [cursor=pointer]:\n        - generic [ref=e173]: Close\n    - paragraph [ref=e174]:\n      - generic [ref=e175]: Hold time left\n      - timer \"Hold time left\" [ref=e176]: 14:46\n    - list [ref=e177]:\n      - listitem [ref=e178]:\n        - generic [ref=e179]: Guava & Lime\n        - generic [ref=e180]: x1\n    - paragraph [ref=e181]:\n      - generic [ref=e182]: Total\n      - generic [ref=e183]: $18.40\n    - region \"Order total\" [ref=e185]:\n      - heading \"Order total\" [level=3] [ref=e186]\n      - generic [ref=e187]:\n        - generic [ref=e188]: Province\n        - combobox \"Province\" [ref=e189]:\n          - option \"Alberta\"\n          - option \"British Columbia\"\n          - option \"Nova Scotia\"\n          - option \"Ontario\" [selected]\n          - option \"Quebec\"\n      - generic [ref=e190]:\n        - switch \"Subscribe and save 10%\" [disabled] [ref=e191]\n        - paragraph [ref=e195]: Subscriptions come as 12 of one flavour or 4 of each.\n      - table \"Price breakdown\" [ref=e196]:\n        - rowgroup [ref=e197]:\n          - row [ref=e198]:\n            - rowheader \"Subtotal\" [ref=e199]\n            - cell \"$3.33\" [ref=e200]\n          - row [ref=e201]:\n            - rowheader \"Deposit\" [ref=e202]\n            - cell \"$0.00\" [ref=e203]\n          - row [ref=e204]:\n            - rowheader \"Shipping\" [ref=e205]\n            - cell \"$12.95\" [ref=e206]\n          - row [ref=e207]:\n            - rowheader \"HST (13%)\" [ref=e208]\n            - cell \"$2.12\" [ref=e209]\n          - row [ref=e210]:\n            - rowheader \"Total\" [ref=e211]\n            - cell \"$18.40\" [ref=e212]\n      - status \"Total updates\" [ref=e213]\n      - paragraph [ref=e214]: Shipping to Ontario.\n    - link \"Checkout\" [ref=e215] [cursor=pointer]:\n      - /url: /sign-in?next=/checkout"
}
```
