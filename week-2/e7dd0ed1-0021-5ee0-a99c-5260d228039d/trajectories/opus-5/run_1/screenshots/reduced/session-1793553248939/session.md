
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Sign in · Farshore\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e3]:\n  - heading \"Sign in to Farshore\" [level=1] [ref=e4]\n  - generic [ref=e5]:\n    - generic [ref=e6]: Email\n    - textbox \"Email\" [active] [ref=e7]\n    - paragraph [ref=e8]\n  - generic [ref=e9]:\n    - generic [ref=e10]: Password\n    - textbox \"Password\" [ref=e11]\n    - paragraph [ref=e12]\n  - button \"Sign in\" [ref=e13] [cursor=pointer]\n  - alert [ref=e14]",
  "events": "- New console entries: evidence/reduced/console-2026-11-01T17-14-09-044Z.log#L1-L2"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Sign in · Farshore\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e3]:\n  - heading \"Sign in to Farshore\" [level=1] [ref=e4]\n  - generic [ref=e5]:\n    - generic [ref=e6]: Email\n    - textbox \"Email\" [active] [ref=e7]\n    - paragraph [ref=e8]\n  - generic [ref=e9]:\n    - generic [ref=e10]: Password\n    - textbox \"Password\" [ref=e11]\n    - paragraph [ref=e12]\n  - button \"Sign in\" [ref=e13] [cursor=pointer]\n  - alert [ref=e14]"
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
      "value": "theo@lanternfish.test"
    },
    {
      "target": "e11",
      "name": "Password",
      "type": "textbox",
      "value": "farshore-demo-26"
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
  "page": "- Page URL: http://127.0.0.1:4173/console\n- Page Title: Console · Farshore",
  "snapshot": ""
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/console/lanternfish/lanternfish-replays?prefix=season-1/"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/console/lanternfish/lanternfish-replays?prefix=season-1/\n- Page Title: Console · Farshore",
  "snapshot": ""
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
  "page": "- Page URL: http://127.0.0.1:4173/console/lanternfish/lanternfish-replays?prefix=season-1/\n- Page Title: Console · Farshore",
  "inlineSnapshot": "- generic [ref=f2e2]:\n  - link \"Skip to objects\" [ref=f2e3] [cursor=pointer]:\n    - /url: \"#objects\"\n  - generic [ref=f2e4]:\n    - generic [ref=f2e5]:\n      - paragraph [ref=f2e6]: Lanternfish Games\n      - navigation \"Buckets\" [ref=f2e7]:\n        - link \"lanternfish-avatars\" [ref=f2e8] [cursor=pointer]:\n          - /url: /console/lanternfish/lanternfish-avatars\n          - generic [ref=f2e10]: Meridian, Cascade\n        - link \"lanternfish-replays\" [ref=f2e11] [cursor=pointer]:\n          - /url: /console/lanternfish/lanternfish-replays\n          - generic [ref=f2e13]: Cascade, Meridian, Monsoon\n      - button \"New bucket\" [ref=f2e14] [cursor=pointer]\n      - navigation \"Workspace\" [ref=f2e15]:\n        - link \"Objects\" [ref=f2e16] [cursor=pointer]:\n          - /url: /console/lanternfish/lanternfish-avatars\n        - link \"Share links\" [ref=f2e17] [cursor=pointer]:\n          - /url: /console/lanternfish/_share-links\n      - link \"Account\" [ref=f2e18] [cursor=pointer]:\n        - /url: /account\n      - button \"Sign out\" [ref=f2e19] [cursor=pointer]\n    - main [ref=f2e20]:\n      - heading \"lanternfish-replays\" [level=2] [ref=f2e21]\n      - paragraph [ref=f2e22]: /season-1/\n      - group \"Object tools\" [ref=f2e23]:\n        - searchbox \"Search objects\" [ref=f2e24]\n        - textbox \"Prefix\" [ref=f2e25]: season-1/\n        - textbox \"Tag filter\" [ref=f2e26]:\n          - /placeholder: env=qa and not team=art\n        - button \"Apply filters\" [ref=f2e27] [cursor=pointer]\n        - button \"Upload files\" [ref=f2e28] [cursor=pointer]\n        - button \"Delete selected\" [disabled] [ref=f2e29]\n        - button \"Lifecycle rules\" [ref=f2e30] [cursor=pointer]\n      - generic:\n        - list \"Delete results\"\n      - status \"Delete status\"\n      - status \"Upload status\"\n      - progressbar \"Upload progress\" [ref=f2e31]\n      - status \"Lifecycle status\"\n      - paragraph\n      - table \"Objects\" [ref=f2e33]:\n        - rowgroup [ref=f2e34]:\n          - row \"Select all on this page Key Size (bytes) Last modified (UTC) Regions (settled/placed) ETag\" [ref=f2e35]:\n            - columnheader \"Select all on this page\" [ref=f2e36]\n            - columnheader \"Key\" [ref=f2e38]\n            - columnheader \"Size (bytes)\" [ref=f2e39]\n            - columnheader \"Last modified (UTC)\" [ref=f2e40]\n            - columnheader \"Regions (settled/placed)\" [ref=f2e41]\n            - columnheader \"ETag\" [ref=f2e42]\n        - rowgroup [ref=f2e43]:\n          - row \"Select season-1/manifest.json Open season-1/manifest.json 28 2026-11-01 17:12:04 UTC 3/3 7c058635\" [ref=f2e44]:\n            - cell \"Select season-1/manifest.json\" [ref=f2e45]\n            - cell \"Open season-1/manifest.json\" [ref=f2e47]\n            - cell \"28\" [ref=f2e49]\n            - cell \"2026-11-01 17:12:04 UTC\" [ref=f2e50]\n            - cell \"3/3\" [ref=f2e51]\n            - cell \"7c058635\" [ref=f2e52]\n          - row \"Open folder season-1/replays/\" [ref=f2e53]:\n            - cell [ref=f2e54]\n            - cell \"Open folder season-1/replays/\" [ref=f2e55]\n            - cell [ref=f2e57]\n            - cell [ref=f2e58]\n            - cell [ref=f2e59]\n            - cell [ref=f2e60]\n      - generic [ref=f2e61]:\n        - button \"Previous page\" [disabled] [ref=f2e62]\n        - button \"Next page\" [disabled] [ref=f2e63]\n      - status \"Results status\" [ref=f2e64]: 2 objects on this page\n      - status \"Bucket status\""
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Open season-1/manifest.json",
  "target": "f2e47"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/console/lanternfish/lanternfish-replays?prefix=season-1%2F&object=season-1%2Fmanifest.json\n- Page Title: Console · Farshore",
  "snapshot": "- generic [ref=f2e2]:\n  - link \"Skip to objects\" [ref=f2e65] [cursor=pointer]:\n    - /url: \"#objects\"\n  - generic [ref=f2e66]:\n    - generic [ref=f2e67]:\n      - paragraph [ref=f2e68]: Lanternfish Games\n      - navigation \"Buckets\" [ref=f2e69]:\n        - link \"lanternfish-avatars\" [ref=f2e70] [cursor=pointer]:\n          - /url: /console/lanternfish/lanternfish-avatars\n          - generic [ref=f2e72]: Meridian, Cascade\n        - link \"lanternfish-replays\" [ref=f2e73] [cursor=pointer]:\n          - /url: /console/lanternfish/lanternfish-replays\n          - generic [ref=f2e75]: Cascade, Meridian, Monsoon\n      - button \"New bucket\" [ref=f2e76] [cursor=pointer]\n      - navigation \"Workspace\" [ref=f2e77]:\n        - link \"Objects\" [ref=f2e78] [cursor=pointer]:\n          - /url: /console/lanternfish/lanternfish-avatars\n        - link \"Share links\" [ref=f2e79] [cursor=pointer]:\n          - /url: /console/lanternfish/_share-links\n      - link \"Account\" [ref=f2e80] [cursor=pointer]:\n        - /url: /account\n      - button \"Sign out\" [ref=f2e81] [cursor=pointer]\n    - main [ref=f2e82]:\n      - heading \"lanternfish-replays\" [level=2] [ref=f2e83]\n      - paragraph [ref=f2e84]: /season-1/\n      - group \"Object tools\" [ref=f2e85]:\n        - searchbox \"Search objects\" [ref=f2e86]\n        - textbox \"Prefix\" [ref=f2e87]: season-1/\n        - textbox \"Tag filter\" [ref=f2e88]:\n          - /placeholder: env=qa and not team=art\n        - button \"Apply filters\" [ref=f2e89] [cursor=pointer]\n        - button \"Upload files\" [ref=f2e90] [cursor=pointer]\n        - button \"Delete selected\" [disabled] [ref=f2e91]\n        - button \"Lifecycle rules\" [ref=f2e92] [cursor=pointer]\n      - generic:\n        - list \"Delete results\"\n      - status \"Delete status\"\n      - status \"Upload status\"\n      - progressbar \"Upload progress\" [ref=f2e93]\n      - status \"Lifecycle status\"\n      - paragraph\n      - table \"Objects\" [ref=f2e95]:\n        - rowgroup [ref=f2e96]:\n          - row [ref=f2e97]:\n            - columnheader [ref=f2e98]:\n              - checkbox \"Select all on this page\" [ref=f2e99]\n            - columnheader \"Key\" [ref=f2e100]\n            - columnheader \"Size (bytes)\" [ref=f2e101]\n            - columnheader \"Last modified (UTC)\" [ref=f2e102]\n            - columnheader \"Regions (settled/placed)\" [ref=f2e103]\n            - columnheader \"ETag\" [ref=f2e104]\n        - rowgroup [ref=f2e105]:\n          - row [ref=f2e106]:\n            - cell [ref=f2e107]:\n              - checkbox \"Select season-1/manifest.json\" [ref=f2e108]\n            - cell [ref=f2e109]:\n              - button \"Open season-1/manifest.json\" [ref=f2e110] [cursor=pointer]: season-1/manifest.json\n            - cell \"28\" [ref=f2e111]\n            - cell \"2026-11-01 17:12:04 UTC\" [ref=f2e112]\n            - cell \"3/3\" [ref=f2e113]\n            - cell \"7c058635\" [ref=f2e114]\n          - row [ref=f2e115]:\n            - cell [ref=f2e116]\n            - cell [ref=f2e117]:\n              - button \"Open folder season-1/replays/\" [ref=f2e118] [cursor=pointer]: season-1/replays/\n            - cell [ref=f2e119]\n            - cell [ref=f2e120]\n            - cell [ref=f2e121]\n            - cell [ref=f2e122]\n      - generic [ref=f2e123]:\n        - button \"Previous page\" [disabled] [ref=f2e124]\n        - button \"Next page\" [disabled] [ref=f2e125]\n      - status \"Results status\" [ref=f2e126]: 2 objects on this page\n      - status \"Bucket status\"\n    - region \"Object inspector\" [ref=f2e127]:\n      - button \"Close inspector\" [ref=f2e128] [cursor=pointer]\n      - heading \"season-1/manifest.json\" [active] [level=3] [ref=f2e129]\n      - generic [ref=f2e130]:\n        - generic [ref=f2e131]:\n          - term [ref=f2e132]: Version\n          - definition [ref=f2e133]: sHO-WardyLmicPbx4fUUJLsbonXmqdwe\n        - generic [ref=f2e134]:\n          - term [ref=f2e135]: ETag\n          - definition [ref=f2e136]: \"\\\"7c058635be5b9e920c525665f79547c1\\\"\"\n        - generic [ref=f2e137]:\n          - term [ref=f2e138]: Size (bytes)\n          - definition [ref=f2e139]: \"28\"\n        - generic [ref=f2e140]:\n          - term [ref=f2e141]: Content type\n          - definition [ref=f2e142]: application/json\n        - generic [ref=f2e143]:\n          - term [ref=f2e144]: Tags\n          - definition [ref=f2e145]: env=prod, team=netcode\n        - generic [ref=f2e146]:\n          - term [ref=f2e147]: Metadata\n          - definition [ref=f2e148]: —\n      - figure \"Replica map\" [ref=f2e149]:\n        - img [aria-hidden] [ref=f2e150]:\n          - generic [ref=f2e672]:\n            - generic [ref=f2e674]: Cascade origin\n            - generic [ref=f2e675]: 0 ms\n          - generic [ref=f2e676]:\n            - generic [ref=f2e679]: Meridian\n            - generic [ref=f2e680]: 214 ms\n          - generic [ref=f2e681]:\n            - generic [ref=f2e684]: Monsoon\n            - generic [ref=f2e685]: 215 ms\n      - list \"Replica status\" [ref=f2e687]:\n        - listitem [ref=f2e688]: \"Cascade: origin, settled\"\n        - listitem [ref=f2e689]: \"Meridian: settled in 214 ms\"\n        - listitem [ref=f2e690]: \"Monsoon: settled in 215 ms\"\n      - status \"Replica announcements\" [ref=f2e691]\n      - status \"Release readiness\" [ref=f2e692]: \"Ready to ship: all 3 regions hold version sHO-Ward.\"\n      - generic [ref=f2e693]:\n        - button \"Download\" [ref=f2e694] [cursor=pointer]\n        - button \"Share link\" [ref=f2e695] [cursor=pointer]\n        - button \"Upload new version\" [ref=f2e696] [cursor=pointer]\n        - button \"Delete object\" [ref=f2e697] [cursor=pointer]\n      - status \"Share status\"\n      - list \"Versions\" [ref=f2e698]:\n        - listitem [ref=f2e699]:\n          - generic [ref=f2e700]: sHO-Ward · 28 bytes · 2026-11-01 17:12:04 UTC · current\n          - button \"Retention for sHO-Ward\" [ref=f2e701] [cursor=pointer]\n      - status \"Version status\""
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
  "page": "- Page URL: http://127.0.0.1:4173/console/lanternfish/lanternfish-replays?prefix=season-1%2F&object=season-1%2Fmanifest.json\n- Page Title: Console · Farshore",
  "inlineSnapshot": "- generic [ref=f2e2]:\n  - link \"Skip to objects\" [ref=f2e65] [cursor=pointer]:\n    - /url: \"#objects\"\n  - generic [ref=f2e66]:\n    - generic [ref=f2e67]:\n      - paragraph [ref=f2e68]: Lanternfish Games\n      - navigation \"Buckets\" [ref=f2e69]:\n        - link \"lanternfish-avatars\" [ref=f2e70] [cursor=pointer]:\n          - /url: /console/lanternfish/lanternfish-avatars\n          - generic [ref=f2e72]: Meridian, Cascade\n        - link \"lanternfish-replays\" [ref=f2e73] [cursor=pointer]:\n          - /url: /console/lanternfish/lanternfish-replays\n          - generic [ref=f2e75]: Cascade, Meridian, Monsoon\n      - button \"New bucket\" [ref=f2e76] [cursor=pointer]\n      - navigation \"Workspace\" [ref=f2e77]:\n        - link \"Objects\" [ref=f2e78] [cursor=pointer]:\n          - /url: /console/lanternfish/lanternfish-avatars\n        - link \"Share links\" [ref=f2e79] [cursor=pointer]:\n          - /url: /console/lanternfish/_share-links\n      - link \"Account\" [ref=f2e80] [cursor=pointer]:\n        - /url: /account\n      - button \"Sign out\" [ref=f2e81] [cursor=pointer]\n    - main [ref=f2e82]:\n      - heading \"lanternfish-replays\" [level=2] [ref=f2e83]\n      - paragraph [ref=f2e84]: /season-1/\n      - group \"Object tools\" [ref=f2e85]:\n        - searchbox \"Search objects\" [ref=f2e86]\n        - textbox \"Prefix\" [ref=f2e87]: season-1/\n        - textbox \"Tag filter\" [ref=f2e88]:\n          - /placeholder: env=qa and not team=art\n        - button \"Apply filters\" [ref=f2e89] [cursor=pointer]\n        - button \"Upload files\" [ref=f2e90] [cursor=pointer]\n        - button \"Delete selected\" [disabled] [ref=f2e91]\n        - button \"Lifecycle rules\" [ref=f2e92] [cursor=pointer]\n      - generic:\n        - list \"Delete results\"\n      - status \"Delete status\"\n      - status \"Upload status\"\n      - progressbar \"Upload progress\" [ref=f2e93]\n      - status \"Lifecycle status\"\n      - paragraph\n      - table \"Objects\" [ref=f2e95]:\n        - rowgroup [ref=f2e96]:\n          - row \"Select all on this page Key Size (bytes) Last modified (UTC) Regions (settled/placed) ETag\" [ref=f2e97]:\n            - columnheader \"Select all on this page\" [ref=f2e98]\n            - columnheader \"Key\" [ref=f2e100]\n            - columnheader \"Size (bytes)\" [ref=f2e101]\n            - columnheader \"Last modified (UTC)\" [ref=f2e102]\n            - columnheader \"Regions (settled/placed)\" [ref=f2e103]\n            - columnheader \"ETag\" [ref=f2e104]\n        - rowgroup [ref=f2e105]:\n          - row \"Select season-1/manifest.json Open season-1/manifest.json 28 2026-11-01 17:12:04 UTC 3/3 7c058635\" [ref=f2e106]:\n            - cell \"Select season-1/manifest.json\" [ref=f2e107]\n            - cell \"Open season-1/manifest.json\" [ref=f2e109]\n            - cell \"28\" [ref=f2e111]\n            - cell \"2026-11-01 17:12:04 UTC\" [ref=f2e112]\n            - cell \"3/3\" [ref=f2e113]\n            - cell \"7c058635\" [ref=f2e114]\n          - row \"Open folder season-1/replays/\" [ref=f2e115]:\n            - cell [ref=f2e116]\n            - cell \"Open folder season-1/replays/\" [ref=f2e117]\n            - cell [ref=f2e119]\n            - cell [ref=f2e120]\n            - cell [ref=f2e121]\n            - cell [ref=f2e122]\n      - generic [ref=f2e123]:\n        - button \"Previous page\" [disabled] [ref=f2e124]\n        - button \"Next page\" [disabled] [ref=f2e125]\n      - status \"Results status\" [ref=f2e126]: 2 objects on this page\n      - status \"Bucket status\"\n    - region \"Object inspector\" [ref=f2e127]:\n      - button \"Close inspector\" [ref=f2e128] [cursor=pointer]\n      - heading \"season-1/manifest.json\" [active] [level=3] [ref=f2e129]\n      - generic [ref=f2e130]:\n        - generic [ref=f2e131]:\n          - term [ref=f2e132]: Version\n          - definition [ref=f2e133]: sHO-WardyLmicPbx4fUUJLsbonXmqdwe\n        - generic [ref=f2e134]:\n          - term [ref=f2e135]: ETag\n          - definition [ref=f2e136]: \"\\\"7c058635be5b9e920c525665f79547c1\\\"\"\n        - generic [ref=f2e137]:\n          - term [ref=f2e138]: Size (bytes)\n          - definition [ref=f2e139]: \"28\"\n        - generic [ref=f2e140]:\n          - term [ref=f2e141]: Content type\n          - definition [ref=f2e142]: application/json\n        - generic [ref=f2e143]:\n          - term [ref=f2e144]: Tags\n          - definition [ref=f2e145]: env=prod, team=netcode\n        - generic [ref=f2e146]:\n          - term [ref=f2e147]: Metadata\n          - definition [ref=f2e148]: —\n      - figure \"Replica map\" [ref=f2e149]:\n        - img [aria-hidden] [ref=f2e150]:\n          - generic [ref=f2e672]:\n            - generic [ref=f2e674]: Cascade origin\n            - generic [ref=f2e675]: 0 ms\n          - generic [ref=f2e676]:\n            - generic [ref=f2e679]: Meridian\n            - generic [ref=f2e680]: 214 ms\n          - generic [ref=f2e681]:\n            - generic [ref=f2e684]: Monsoon\n            - generic [ref=f2e685]: 215 ms\n      - list \"Replica status\" [ref=f2e687]:\n        - listitem [ref=f2e688]: \"Cascade: origin, settled\"\n        - listitem [ref=f2e689]: \"Meridian: settled in 214 ms\"\n        - listitem [ref=f2e690]: \"Monsoon: settled in 215 ms\"\n      - status \"Replica announcements\" [ref=f2e691]\n      - status \"Release readiness\" [ref=f2e692]: \"Ready to ship: all 3 regions hold version sHO-Ward.\"\n      - generic [ref=f2e693]:\n        - button \"Download\" [ref=f2e694] [cursor=pointer]\n        - button \"Share link\" [ref=f2e695] [cursor=pointer]\n        - button \"Upload new version\" [ref=f2e696] [cursor=pointer]\n        - button \"Delete object\" [ref=f2e697] [cursor=pointer]\n      - status \"Share status\"\n      - list \"Versions\" [ref=f2e698]:\n        - listitem [ref=f2e702]:\n          - generic [ref=f2e703]: sHO-Ward · 28 bytes · 2026-11-01 17:12:04 UTC · current\n          - button \"Retention for sHO-Ward\" [ref=f2e704] [cursor=pointer]\n      - status \"Version status\""
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Replica map",
  "target": "f2e149",
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of Replica map](evidence/reduced/element-2026-11-01T17-14-38-470Z.png)",
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
  "element": "Replica map image",
  "target": "f2e150",
  "function": "(el)=>{const s=getComputedStyle(el);return {backgroundImage:s.backgroundImage,boxShadow:s.boxShadow,filter:s.filter}}"
}
```
- Result
```json
{
  "result": "{\n  \"backgroundImage\": \"none\",\n  \"boxShadow\": \"none\",\n  \"filter\": \"none\"\n}"
}
```
