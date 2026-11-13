
### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/login"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/login\n- Page Title: Slackwater",
  "snapshot": "- generic [ref=e3]:\n  - heading \"Slackwater\" [level=1] [ref=e4]\n  - textbox \"Email\" [ref=e5]\n  - textbox \"Password\" [ref=e6]\n  - button \"Sign in\" [ref=e7] [cursor=pointer]\n  - status [ref=e8]",
  "events": "- New console entries: evidence/touch/console-2026-11-05T20-21-30-749Z.log#L1"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 2
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/login\n- Page Title: Slackwater",
  "inlineSnapshot": "- generic [ref=e3]:\n  - heading \"Slackwater\" [level=1] [ref=e4]\n  - textbox \"Email\" [ref=e5]\n  - textbox \"Password\" [ref=e6]\n  - button \"Sign in\" [ref=e7] [cursor=pointer]\n  - status [ref=e8]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e5",
      "name": "Email",
      "type": "textbox",
      "value": "p04@ebbstone.example"
    },
    {
      "target": "e6",
      "name": "Password",
      "type": "textbox",
      "value": "Slackwater-2026"
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
  "target": "e7"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/pilot\n- Page Title: Slackwater",
  "snapshot": ""
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
  "page": "- Page URL: http://127.0.0.1:4173/pilot\n- Page Title: Slackwater",
  "inlineSnapshot": "- generic [ref=f1e2]:\n  - banner [ref=f1e3]:\n    - generic [ref=f1e4]: Slackwater\n    - generic [ref=f1e5]: 16:21:41\n    - generic [ref=f1e6]: Ruairi Banks\n    - region \"Service state\" [ref=f1e7]:\n      - generic [ref=f1e8]: Billing up\n      - generic [ref=f1e9]: Storage up\n      - generic [ref=f1e10]: Mail up\n    - button \"Sign out\" [ref=f1e11] [cursor=pointer]\n  - status \"Service announcements\" [ref=f1e12]\n  - generic [ref=f1e13]:\n    - generic [ref=f1e14]:\n      - heading \"Sable Quay\" [level=1] [ref=f1e15]\n      - generic [ref=f1e16]: MV-1004 2026-11-07 05:00 Pilot assigned\n      - generic [ref=f1e17]:\n        - generic [ref=f1e18]\n        - generic [ref=f1e21]\n        - generic [ref=f1e24]\n        - generic [ref=f1e27]\n        - generic [ref=f1e30]\n        - generic [ref=f1e33]\n        - generic [ref=f1e36]: Estimate $4,425.00 CAD\n      - button \"Confirm pilot away\" [ref=f1e38] [cursor=pointer]\n    - region \"Keel Section\" [ref=f1e39]:\n      - img [aria-hidden] [ref=f1e41]:\n        - generic [ref=f1e47]: Outer Bar\n        - generic [ref=f1e48]: 2.74 m\n        - generic [ref=f1e50]: Gannet Shoal\n        - generic [ref=f1e51]: 2.35 m\n        - generic [ref=f1e53]: Narrows Sill\n        - generic [ref=f1e54]: 1.77 m\n        - generic [ref=f1e55]: Pinch +0.63\n        - generic [ref=f1e56]: 8 kn\n        - generic [ref=f1e58]: Mid Reach\n        - generic [ref=f1e59]: 4.09 m\n        - generic [ref=f1e61]: Kettle Bend\n        - generic [ref=f1e62]: 2.74 m\n        - generic [ref=f1e63]: 7 kn\n        - generic [ref=f1e65]: Inner Sill\n        - generic [ref=f1e66]: 2.26 m\n        - generic [ref=f1e67]: 7 kn\n      - slider \"Boarding time\" [ref=f1e70]: \"300\"\n  - generic [ref=f1e71]:\n    - button \"Jobs\" [ref=f1e72] [cursor=pointer]\n    - button \"Waypoints\" [ref=f1e73] [cursor=pointer]\n  - status \"Move announcements\" [ref=f1e74]\n  - status \"Report announcements\" [ref=f1e75]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Jobs",
  "target": "f1e72"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/pilot\n- Page Title: Slackwater",
  "snapshot": "- generic [ref=f1e1]:\n  - generic [ref=f1e2]:\n    - banner [ref=f1e3]:\n      - generic [ref=f1e4]: Slackwater\n      - generic [ref=f1e5]: 16:21:41\n      - generic [ref=f1e6]: Ruairi Banks\n      - region \"Service state\" [ref=f1e7]:\n        - generic [ref=f1e8]: Billing up\n        - generic [ref=f1e9]: Storage up\n        - generic [ref=f1e10]: Mail up\n      - button \"Sign out\" [ref=f1e11] [cursor=pointer]\n    - status \"Service announcements\" [ref=f1e12]\n    - generic [ref=f1e13]:\n      - generic [ref=f1e14]:\n        - heading \"Sable Quay\" [level=1] [ref=f1e15]\n        - generic [ref=f1e16]: MV-1004 2026-11-07 05:00 Pilot assigned\n        - generic [ref=f1e17]:\n          - generic [ref=f1e18]:\n            - generic [ref=f1e19]: Outer Bar\n            - generic [ref=f1e20]: 2.74 m / 9 ft 0 in / +1.60\n          - generic [ref=f1e21]:\n            - generic [ref=f1e22]: Gannet Shoal\n            - generic [ref=f1e23]: 2.35 m / 7 ft 8.5 in / +1.21\n          - generic [ref=f1e24]:\n            - generic [ref=f1e25]: Narrows Sill\n            - generic [ref=f1e26]: 1.77 m / 5 ft 9.75 in / +0.63\n          - generic [ref=f1e27]:\n            - generic [ref=f1e28]: Mid Reach\n            - generic [ref=f1e29]: 4.09 m / 13 ft 4.75 in / +2.95\n          - generic [ref=f1e30]:\n            - generic [ref=f1e31]: Kettle Bend\n            - generic [ref=f1e32]: 2.74 m / 9 ft 0 in / +1.60\n          - generic [ref=f1e33]:\n            - generic [ref=f1e34]: Inner Sill\n            - generic [ref=f1e35]: 2.26 m / 7 ft 4.75 in / +1.12\n          - generic [ref=f1e36]: Estimate $4,425.00 CAD\n        - button \"Confirm pilot away\" [ref=f1e38] [cursor=pointer]\n      - region \"Keel Section\" [ref=f1e39]:\n        - img [aria-hidden] [ref=f1e41]:\n          - generic [ref=f1e47]: Outer Bar\n          - generic [ref=f1e48]: 2.74 m\n          - generic [ref=f1e50]: Gannet Shoal\n          - generic [ref=f1e51]: 2.35 m\n          - generic [ref=f1e53]: Narrows Sill\n          - generic [ref=f1e54]: 1.77 m\n          - generic [ref=f1e55]: Pinch +0.63\n          - generic [ref=f1e56]: 8 kn\n          - generic [ref=f1e58]: Mid Reach\n          - generic [ref=f1e59]: 4.09 m\n          - generic [ref=f1e61]: Kettle Bend\n          - generic [ref=f1e62]: 2.74 m\n          - generic [ref=f1e63]: 7 kn\n          - generic [ref=f1e65]: Inner Sill\n          - generic [ref=f1e66]: 2.26 m\n          - generic [ref=f1e67]: 7 kn\n        - slider \"Boarding time\" [ref=f1e70]: \"300\"\n    - generic [ref=f1e71]:\n      - button \"Jobs\" [active] [ref=f1e72] [cursor=pointer]\n      - button \"Waypoints\" [ref=f1e73] [cursor=pointer]\n    - status \"Move announcements\" [ref=f1e74]\n    - status \"Report announcements\" [ref=f1e75]\n  - dialog \"Jobs\" [ref=f1e77]:\n    - generic [ref=f1e78]:\n      - heading \"Your assignments\" [level=2] [ref=f1e79]\n      - generic [ref=f1e80]: MV-1004 Sable Quay Pilot assigned\n      - link \"Open MV-1004\" [ref=f1e82] [cursor=pointer]:\n        - /url: /moves/MV-1004\n      - button \"Close jobs\" [ref=f1e83] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/pilot\n- Page Title: Slackwater",
  "inlineSnapshot": "- generic [ref=f1e1]:\n  - generic [ref=f1e2]:\n    - banner [ref=f1e3]:\n      - generic [ref=f1e4]: Slackwater\n      - generic [ref=f1e5]: 16:21:41\n      - generic [ref=f1e6]: Ruairi Banks\n      - region \"Service state\" [ref=f1e7]\n      - button \"Sign out\" [ref=f1e11] [cursor=pointer]\n    - status \"Service announcements\" [ref=f1e12]\n    - generic [ref=f1e13]:\n      - generic [ref=f1e14]\n      - region \"Keel Section\" [ref=f1e39]\n    - generic [ref=f1e71]:\n      - button \"Jobs\" [active] [ref=f1e72] [cursor=pointer]\n      - button \"Waypoints\" [ref=f1e73] [cursor=pointer]\n    - status \"Move announcements\" [ref=f1e74]\n    - status \"Report announcements\" [ref=f1e75]\n  - dialog \"Jobs\" [ref=f1e77]:\n    - generic [ref=f1e78]:\n      - heading \"Your assignments\" [level=2] [ref=f1e79]\n      - generic [ref=f1e80]: MV-1004 Sable Quay Pilot assigned\n      - link \"Open MV-1004\" [ref=f1e82] [cursor=pointer]:\n        - /url: /moves/MV-1004\n      - button \"Close jobs\" [ref=f1e83] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Close jobs",
  "target": "f1e83"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/pilot\n- Page Title: Slackwater",
  "snapshot": "- generic [ref=f1e1]:\n  - generic [ref=f1e2]:\n    - banner [ref=f1e3]:\n      - generic [ref=f1e4]: Slackwater\n      - generic [ref=f1e5]: 16:21:41\n      - generic [ref=f1e6]: Ruairi Banks\n      - region \"Service state\" [ref=f1e7]:\n        - generic [ref=f1e8]: Billing up\n        - generic [ref=f1e9]: Storage up\n        - generic [ref=f1e10]: Mail up\n      - button \"Sign out\" [ref=f1e11] [cursor=pointer]\n    - status \"Service announcements\" [ref=f1e12]\n    - generic [ref=f1e13]:\n      - generic [ref=f1e14]:\n        - heading \"Sable Quay\" [level=1] [ref=f1e15]\n        - generic [ref=f1e16]: MV-1004 2026-11-07 05:00 Pilot assigned\n        - generic [ref=f1e17]:\n          - generic [ref=f1e18]:\n            - generic [ref=f1e19]: Outer Bar\n            - generic [ref=f1e20]: 2.74 m / 9 ft 0 in / +1.60\n          - generic [ref=f1e21]:\n            - generic [ref=f1e22]: Gannet Shoal\n            - generic [ref=f1e23]: 2.35 m / 7 ft 8.5 in / +1.21\n          - generic [ref=f1e24]:\n            - generic [ref=f1e25]: Narrows Sill\n            - generic [ref=f1e26]: 1.77 m / 5 ft 9.75 in / +0.63\n          - generic [ref=f1e27]:\n            - generic [ref=f1e28]: Mid Reach\n            - generic [ref=f1e29]: 4.09 m / 13 ft 4.75 in / +2.95\n          - generic [ref=f1e30]:\n            - generic [ref=f1e31]: Kettle Bend\n            - generic [ref=f1e32]: 2.74 m / 9 ft 0 in / +1.60\n          - generic [ref=f1e33]:\n            - generic [ref=f1e34]: Inner Sill\n            - generic [ref=f1e35]: 2.26 m / 7 ft 4.75 in / +1.12\n          - generic [ref=f1e36]: Estimate $4,425.00 CAD\n        - button \"Confirm pilot away\" [ref=f1e38] [cursor=pointer]\n      - region \"Keel Section\" [ref=f1e39]:\n        - img [aria-hidden] [ref=f1e41]:\n          - generic [ref=f1e47]: Outer Bar\n          - generic [ref=f1e48]: 2.74 m\n          - generic [ref=f1e50]: Gannet Shoal\n          - generic [ref=f1e51]: 2.35 m\n          - generic [ref=f1e53]: Narrows Sill\n          - generic [ref=f1e54]: 1.77 m\n          - generic [ref=f1e55]: Pinch +0.63\n          - generic [ref=f1e56]: 8 kn\n          - generic [ref=f1e58]: Mid Reach\n          - generic [ref=f1e59]: 4.09 m\n          - generic [ref=f1e61]: Kettle Bend\n          - generic [ref=f1e62]: 2.74 m\n          - generic [ref=f1e63]: 7 kn\n          - generic [ref=f1e65]: Inner Sill\n          - generic [ref=f1e66]: 2.26 m\n          - generic [ref=f1e67]: 7 kn\n        - slider \"Boarding time\" [ref=f1e70]: \"300\"\n    - generic [ref=f1e71]:\n      - button \"Jobs\" [ref=f1e72] [cursor=pointer]\n      - button \"Waypoints\" [ref=f1e73] [cursor=pointer]\n    - status \"Move announcements\" [ref=f1e74]\n    - status \"Report announcements\" [ref=f1e75]\n  - dialog \"Jobs\" [ref=f1e77]:\n    - generic [ref=f1e78]:\n      - heading \"Your assignments\" [level=2] [ref=f1e79]\n      - generic [ref=f1e80]: MV-1004 Sable Quay Pilot assigned\n      - link \"Open MV-1004\" [ref=f1e82] [cursor=pointer]:\n        - /url: /moves/MV-1004\n      - button \"Close jobs\" [active] [ref=f1e83] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Waypoints",
  "target": "f1e73"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/pilot\n- Page Title: Slackwater",
  "snapshot": "- generic [ref=f1e1]:\n  - generic [ref=f1e2]:\n    - banner [ref=f1e3]:\n      - generic [ref=f1e4]: Slackwater\n      - generic [ref=f1e5]: 16:21:41\n      - generic [ref=f1e6]: Ruairi Banks\n      - region \"Service state\" [ref=f1e7]:\n        - generic [ref=f1e8]: Billing up\n        - generic [ref=f1e9]: Storage up\n        - generic [ref=f1e10]: Mail up\n      - button \"Sign out\" [ref=f1e11] [cursor=pointer]\n    - status \"Service announcements\" [ref=f1e12]\n    - generic [ref=f1e13]:\n      - generic [ref=f1e14]:\n        - heading \"Sable Quay\" [level=1] [ref=f1e15]\n        - generic [ref=f1e16]: MV-1004 2026-11-07 05:00 Pilot assigned\n        - generic [ref=f1e17]:\n          - generic [ref=f1e18]:\n            - generic [ref=f1e19]: Outer Bar\n            - generic [ref=f1e20]: 2.74 m / 9 ft 0 in / +1.60\n          - generic [ref=f1e21]:\n            - generic [ref=f1e22]: Gannet Shoal\n            - generic [ref=f1e23]: 2.35 m / 7 ft 8.5 in / +1.21\n          - generic [ref=f1e24]:\n            - generic [ref=f1e25]: Narrows Sill\n            - generic [ref=f1e26]: 1.77 m / 5 ft 9.75 in / +0.63\n          - generic [ref=f1e27]:\n            - generic [ref=f1e28]: Mid Reach\n            - generic [ref=f1e29]: 4.09 m / 13 ft 4.75 in / +2.95\n          - generic [ref=f1e30]:\n            - generic [ref=f1e31]: Kettle Bend\n            - generic [ref=f1e32]: 2.74 m / 9 ft 0 in / +1.60\n          - generic [ref=f1e33]:\n            - generic [ref=f1e34]: Inner Sill\n            - generic [ref=f1e35]: 2.26 m / 7 ft 4.75 in / +1.12\n          - generic [ref=f1e36]: Estimate $4,425.00 CAD\n        - button \"Confirm pilot away\" [ref=f1e38] [cursor=pointer]\n      - region \"Keel Section\" [ref=f1e39]:\n        - img [aria-hidden] [ref=f1e41]:\n          - generic [ref=f1e47]: Outer Bar\n          - generic [ref=f1e48]: 2.74 m\n          - generic [ref=f1e50]: Gannet Shoal\n          - generic [ref=f1e51]: 2.35 m\n          - generic [ref=f1e53]: Narrows Sill\n          - generic [ref=f1e54]: 1.77 m\n          - generic [ref=f1e55]: Pinch +0.63\n          - generic [ref=f1e56]: 8 kn\n          - generic [ref=f1e58]: Mid Reach\n          - generic [ref=f1e59]: 4.09 m\n          - generic [ref=f1e61]: Kettle Bend\n          - generic [ref=f1e62]: 2.74 m\n          - generic [ref=f1e63]: 7 kn\n          - generic [ref=f1e65]: Inner Sill\n          - generic [ref=f1e66]: 2.26 m\n          - generic [ref=f1e67]: 7 kn\n        - slider \"Boarding time\" [ref=f1e70]: \"300\"\n    - generic [ref=f1e71]:\n      - button \"Jobs\" [ref=f1e72] [cursor=pointer]\n      - button \"Waypoints\" [active] [ref=f1e73] [cursor=pointer]\n    - status \"Move announcements\" [ref=f1e74]\n    - status \"Report announcements\" [ref=f1e75]\n  - dialog \"Waypoints\" [ref=f1e85]:\n    - generic [ref=f1e86]:\n      - heading \"Waypoints\" [level=2] [ref=f1e87]\n      - table \"Waypoints\" [ref=f1e88]:\n        - rowgroup [ref=f1e89]:\n          - row [ref=f1e90]:\n            - columnheader \"Waypoint\" [ref=f1e91]\n            - columnheader \"Arrives\" [ref=f1e92]\n            - columnheader \"Leg speed\" [ref=f1e93]\n            - columnheader \"Squat\" [ref=f1e94]\n            - columnheader \"Water\" [ref=f1e95]\n            - columnheader \"Clearance\" [ref=f1e96]\n            - columnheader \"Required\" [ref=f1e97]\n            - columnheader \"Margin\" [ref=f1e98]\n        - rowgroup [ref=f1e99]:\n          - row [ref=f1e100]:\n            - cell \"Outer Bar\" [ref=f1e101]\n            - cell \"05:22 AST\" [ref=f1e102]\n            - cell \"8 kn\" [ref=f1e103]\n            - cell \"0.49 m\" [ref=f1e104]\n            - cell \"14.63 m\" [ref=f1e105]\n            - cell \"2.74 m / 9 ft 0 in\" [ref=f1e106]\n            - cell \"NaN m\" [ref=f1e107]\n            - cell \"+1.60\" [ref=f1e108]\n          - row [ref=f1e109]:\n            - cell \"Gannet Shoal\" [ref=f1e110]\n            - cell \"05:56 AST\" [ref=f1e111]\n            - cell \"8 kn\" [ref=f1e112]\n            - cell \"0.49 m\" [ref=f1e113]\n            - cell \"14.24 m\" [ref=f1e114]\n            - cell \"2.35 m / 7 ft 8.5 in\" [ref=f1e115]\n            - cell \"NaN m\" [ref=f1e116]\n            - cell \"+1.21\" [ref=f1e117]\n          - row [ref=f1e118]:\n            - cell \"Narrows Sill\" [ref=f1e119]\n            - cell \"06:30 AST\" [ref=f1e120]\n            - cell \"8 kn\" [ref=f1e121]\n            - cell \"0.97 m\" [ref=f1e122]\n            - cell \"14.14 m\" [ref=f1e123]\n            - cell \"1.77 m / 5 ft 9.75 in\" [ref=f1e124]\n            - cell \"NaN m\" [ref=f1e125]\n            - cell \"+0.63\" [ref=f1e126]\n          - row [ref=f1e127]:\n            - cell \"Mid Reach\" [ref=f1e128]\n            - cell \"07:00 AST\" [ref=f1e129]\n            - cell \"8 kn\" [ref=f1e130]\n            - cell \"0.49 m\" [ref=f1e131]\n            - cell \"15.97 m\" [ref=f1e132]\n            - cell \"4.09 m / 13 ft 4.75 in\" [ref=f1e133]\n            - cell \"NaN m\" [ref=f1e134]\n            - cell \"+2.95\" [ref=f1e135]\n          - row [ref=f1e136]:\n            - cell \"Kettle Bend\" [ref=f1e137]\n            - cell \"07:30 AST\" [ref=f1e138]\n            - cell \"7 kn\" [ref=f1e139]\n            - cell \"0.74 m\" [ref=f1e140]\n            - cell \"14.89 m\" [ref=f1e141]\n            - cell \"2.74 m / 9 ft 0 in\" [ref=f1e142]\n            - cell \"NaN m\" [ref=f1e143]\n            - cell \"+1.60\" [ref=f1e144]\n          - row [ref=f1e145]:\n            - cell \"Inner Sill\" [ref=f1e146]\n            - cell \"07:51 AST\" [ref=f1e147]\n            - cell \"7 kn\" [ref=f1e148]\n            - cell \"0.74 m\" [ref=f1e149]\n            - cell \"14.40 m\" [ref=f1e150]\n            - cell \"2.26 m / 7 ft 4.75 in\" [ref=f1e151]\n            - cell \"NaN m\" [ref=f1e152]\n            - cell \"+1.12\" [ref=f1e153]\n      - button \"Close waypoints\" [ref=f1e154] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/pilot\n- Page Title: Slackwater",
  "inlineSnapshot": "- generic [ref=f1e1]:\n  - generic [ref=f1e2]:\n    - banner [ref=f1e3]:\n      - generic [ref=f1e4]: Slackwater\n      - generic [ref=f1e5]: 16:21:41\n      - generic [ref=f1e6]: Ruairi Banks\n      - region \"Service state\" [ref=f1e7]\n      - button \"Sign out\" [ref=f1e11] [cursor=pointer]\n    - status \"Service announcements\" [ref=f1e12]\n    - generic [ref=f1e13]:\n      - generic [ref=f1e14]\n      - region \"Keel Section\" [ref=f1e39]\n    - generic [ref=f1e71]:\n      - button \"Jobs\" [ref=f1e72] [cursor=pointer]\n      - button \"Waypoints\" [active] [ref=f1e73] [cursor=pointer]\n    - status \"Move announcements\" [ref=f1e74]\n    - status \"Report announcements\" [ref=f1e75]\n  - dialog \"Waypoints\" [ref=f1e85]:\n    - generic [ref=f1e86]:\n      - heading \"Waypoints\" [level=2] [ref=f1e87]\n      - table \"Waypoints\" [ref=f1e88]\n      - button \"Close waypoints\" [ref=f1e154] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Close waypoints",
  "target": "f1e154"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/pilot\n- Page Title: Slackwater",
  "snapshot": "- generic [ref=f1e1]:\n  - generic [ref=f1e2]:\n    - banner [ref=f1e3]:\n      - generic [ref=f1e4]: Slackwater\n      - generic [ref=f1e5]: 16:21:41\n      - generic [ref=f1e6]: Ruairi Banks\n      - region \"Service state\" [ref=f1e7]:\n        - generic [ref=f1e8]: Billing up\n        - generic [ref=f1e9]: Storage up\n        - generic [ref=f1e10]: Mail up\n      - button \"Sign out\" [ref=f1e11] [cursor=pointer]\n    - status \"Service announcements\" [ref=f1e12]\n    - generic [ref=f1e13]:\n      - generic [ref=f1e14]:\n        - heading \"Sable Quay\" [level=1] [ref=f1e15]\n        - generic [ref=f1e16]: MV-1004 2026-11-07 05:00 Pilot assigned\n        - generic [ref=f1e17]:\n          - generic [ref=f1e18]:\n            - generic [ref=f1e19]: Outer Bar\n            - generic [ref=f1e20]: 2.74 m / 9 ft 0 in / +1.60\n          - generic [ref=f1e21]:\n            - generic [ref=f1e22]: Gannet Shoal\n            - generic [ref=f1e23]: 2.35 m / 7 ft 8.5 in / +1.21\n          - generic [ref=f1e24]:\n            - generic [ref=f1e25]: Narrows Sill\n            - generic [ref=f1e26]: 1.77 m / 5 ft 9.75 in / +0.63\n          - generic [ref=f1e27]:\n            - generic [ref=f1e28]: Mid Reach\n            - generic [ref=f1e29]: 4.09 m / 13 ft 4.75 in / +2.95\n          - generic [ref=f1e30]:\n            - generic [ref=f1e31]: Kettle Bend\n            - generic [ref=f1e32]: 2.74 m / 9 ft 0 in / +1.60\n          - generic [ref=f1e33]:\n            - generic [ref=f1e34]: Inner Sill\n            - generic [ref=f1e35]: 2.26 m / 7 ft 4.75 in / +1.12\n          - generic [ref=f1e36]: Estimate $4,425.00 CAD\n        - button \"Confirm pilot away\" [ref=f1e38] [cursor=pointer]\n      - region \"Keel Section\" [ref=f1e39]:\n        - img [aria-hidden] [ref=f1e41]:\n          - generic [ref=f1e47]: Outer Bar\n          - generic [ref=f1e48]: 2.74 m\n          - generic [ref=f1e50]: Gannet Shoal\n          - generic [ref=f1e51]: 2.35 m\n          - generic [ref=f1e53]: Narrows Sill\n          - generic [ref=f1e54]: 1.77 m\n          - generic [ref=f1e55]: Pinch +0.63\n          - generic [ref=f1e56]: 8 kn\n          - generic [ref=f1e58]: Mid Reach\n          - generic [ref=f1e59]: 4.09 m\n          - generic [ref=f1e61]: Kettle Bend\n          - generic [ref=f1e62]: 2.74 m\n          - generic [ref=f1e63]: 7 kn\n          - generic [ref=f1e65]: Inner Sill\n          - generic [ref=f1e66]: 2.26 m\n          - generic [ref=f1e67]: 7 kn\n        - slider \"Boarding time\" [ref=f1e70]: \"300\"\n    - generic [ref=f1e71]:\n      - button \"Jobs\" [ref=f1e72] [cursor=pointer]\n      - button \"Waypoints\" [ref=f1e73] [cursor=pointer]\n    - status \"Move announcements\" [ref=f1e74]\n    - status \"Report announcements\" [ref=f1e75]\n  - dialog \"Waypoints\" [ref=f1e85]:\n    - generic [ref=f1e86]:\n      - heading \"Waypoints\" [level=2] [ref=f1e87]\n      - table \"Waypoints\" [ref=f1e88]:\n        - rowgroup [ref=f1e89]:\n          - row [ref=f1e90]:\n            - columnheader \"Waypoint\" [ref=f1e91]\n            - columnheader \"Arrives\" [ref=f1e92]\n            - columnheader \"Leg speed\" [ref=f1e93]\n            - columnheader \"Squat\" [ref=f1e94]\n            - columnheader \"Water\" [ref=f1e95]\n            - columnheader \"Clearance\" [ref=f1e96]\n            - columnheader \"Required\" [ref=f1e97]\n            - columnheader \"Margin\" [ref=f1e98]\n        - rowgroup [ref=f1e99]:\n          - row [ref=f1e100]:\n            - cell \"Outer Bar\" [ref=f1e101]\n            - cell \"05:22 AST\" [ref=f1e102]\n            - cell \"8 kn\" [ref=f1e103]\n            - cell \"0.49 m\" [ref=f1e104]\n            - cell \"14.63 m\" [ref=f1e105]\n            - cell \"2.74 m / 9 ft 0 in\" [ref=f1e106]\n            - cell \"NaN m\" [ref=f1e107]\n            - cell \"+1.60\" [ref=f1e108]\n          - row [ref=f1e109]:\n            - cell \"Gannet Shoal\" [ref=f1e110]\n            - cell \"05:56 AST\" [ref=f1e111]\n            - cell \"8 kn\" [ref=f1e112]\n            - cell \"0.49 m\" [ref=f1e113]\n            - cell \"14.24 m\" [ref=f1e114]\n            - cell \"2.35 m / 7 ft 8.5 in\" [ref=f1e115]\n            - cell \"NaN m\" [ref=f1e116]\n            - cell \"+1.21\" [ref=f1e117]\n          - row [ref=f1e118]:\n            - cell \"Narrows Sill\" [ref=f1e119]\n            - cell \"06:30 AST\" [ref=f1e120]\n            - cell \"8 kn\" [ref=f1e121]\n            - cell \"0.97 m\" [ref=f1e122]\n            - cell \"14.14 m\" [ref=f1e123]\n            - cell \"1.77 m / 5 ft 9.75 in\" [ref=f1e124]\n            - cell \"NaN m\" [ref=f1e125]\n            - cell \"+0.63\" [ref=f1e126]\n          - row [ref=f1e127]:\n            - cell \"Mid Reach\" [ref=f1e128]\n            - cell \"07:00 AST\" [ref=f1e129]\n            - cell \"8 kn\" [ref=f1e130]\n            - cell \"0.49 m\" [ref=f1e131]\n            - cell \"15.97 m\" [ref=f1e132]\n            - cell \"4.09 m / 13 ft 4.75 in\" [ref=f1e133]\n            - cell \"NaN m\" [ref=f1e134]\n            - cell \"+2.95\" [ref=f1e135]\n          - row [ref=f1e136]:\n            - cell \"Kettle Bend\" [ref=f1e137]\n            - cell \"07:30 AST\" [ref=f1e138]\n            - cell \"7 kn\" [ref=f1e139]\n            - cell \"0.74 m\" [ref=f1e140]\n            - cell \"14.89 m\" [ref=f1e141]\n            - cell \"2.74 m / 9 ft 0 in\" [ref=f1e142]\n            - cell \"NaN m\" [ref=f1e143]\n            - cell \"+1.60\" [ref=f1e144]\n          - row [ref=f1e145]:\n            - cell \"Inner Sill\" [ref=f1e146]\n            - cell \"07:51 AST\" [ref=f1e147]\n            - cell \"7 kn\" [ref=f1e148]\n            - cell \"0.74 m\" [ref=f1e149]\n            - cell \"14.40 m\" [ref=f1e150]\n            - cell \"2.26 m / 7 ft 4.75 in\" [ref=f1e151]\n            - cell \"NaN m\" [ref=f1e152]\n            - cell \"+1.12\" [ref=f1e153]\n      - button \"Close waypoints\" [active] [ref=f1e154] [cursor=pointer]"
}
```
