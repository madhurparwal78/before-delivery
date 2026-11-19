
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [active] [ref=e1]:\n  - main [ref=e3]:\n    - region \"Hero\" [ref=e4]:\n      - generic [ref=e6]:\n        - heading \"Brainstorm face down. Reveal together.\" [level=1] [ref=e7]\n        - paragraph [ref=e8]: \"Lanternfold Rooms is the shared canvas for freelance facilitators: silent rounds nobody can peek at, one reveal, honest dot votes, and a recap in the client's inbox before the day is out.\"\n        - separator [ref=e9]\n        - paragraph [ref=e10]: No guest seats. No board caps. Your words stay yours until you choose to show them.\n        - generic [ref=e11]:\n          - link \"Sign in\" [ref=e12] [cursor=pointer]:\n            - /url: \"#/signin\"\n          - link \"Start a workshop\" [ref=e13] [cursor=pointer]:\n            - /url: \"#/signin\"\n      - region \"Reveal demo\" [ref=e14]:\n        - heading \"Problems\" [level=3] [ref=e16]\n        - button \"Play the reveal\" [ref=e30] [cursor=pointer]\n    - region \"Plans\" [ref=e31]:\n      - heading \"Plans\" [level=2] [ref=e32]\n      - radiogroup \"Billing term\" [ref=e33]:\n        - generic [ref=e34]:\n          - radio \"Monthly\" [checked] [ref=e35] [cursor=pointer]\n          - text: Monthly\n        - generic [ref=e36]:\n          - radio \"Annual\" [ref=e37] [cursor=pointer]\n          - text: Annual\n      - generic [ref=e38]:\n        - group \"Free plan\" [ref=e39]:\n          - heading \"Free\" [level=3] [ref=e40]\n          - generic [ref=e41]: €0.00 / month\n        - group \"Studio plan\" [ref=e42]:\n          - generic [ref=e43]: Recommended\n          - heading \"Studio\" [level=3] [ref=e44]\n          - generic [ref=e45]: €24.00 / month\n        - group \"Agency plan\" [ref=e46]:\n          - heading \"Agency\" [level=3] [ref=e47]\n          - generic [ref=e48]: €59.00 / month\n  - status \"Page status\" [ref=e49]\n  - alert [ref=e50]",
  "events": "- New console entries: evidence/normal/console-2026-11-02T10-43-35-302Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [active] [ref=e1]:\n  - main [ref=e3]:\n    - region \"Hero\" [ref=e4]:\n      - generic [ref=e6]:\n        - heading \"Brainstorm face down. Reveal together.\" [level=1] [ref=e7]\n        - paragraph [ref=e8]: \"Lanternfold Rooms is the shared canvas for freelance facilitators: silent rounds nobody can peek at, one reveal, honest dot votes, and a recap in the client's inbox before the day is out.\"\n        - separator [ref=e9]\n        - paragraph [ref=e10]: No guest seats. No board caps. Your words stay yours until you choose to show them.\n        - generic [ref=e11]:\n          - link \"Sign in\" [ref=e12] [cursor=pointer]:\n            - /url: \"#/signin\"\n          - link \"Start a workshop\" [ref=e13] [cursor=pointer]:\n            - /url: \"#/signin\"\n      - region \"Reveal demo\" [ref=e14]:\n        - heading \"Problems\" [level=3] [ref=e16]\n        - button \"Play the reveal\" [ref=e30] [cursor=pointer]\n    - region \"Plans\" [ref=e31]:\n      - heading \"Plans\" [level=2] [ref=e32]\n      - radiogroup \"Billing term\" [ref=e33]:\n        - generic [ref=e34]:\n          - radio \"Monthly\" [checked] [ref=e35] [cursor=pointer]\n          - text: Monthly\n        - generic [ref=e36]:\n          - radio \"Annual\" [ref=e37] [cursor=pointer]\n          - text: Annual\n      - generic [ref=e38]:\n        - group \"Free plan\" [ref=e39]:\n          - heading \"Free\" [level=3] [ref=e40]\n          - generic [ref=e41]: €0.00 / month\n        - group \"Studio plan\" [ref=e42]:\n          - generic [ref=e43]: Recommended\n          - heading \"Studio\" [level=3] [ref=e44]\n          - generic [ref=e45]: €24.00 / month\n        - group \"Agency plan\" [ref=e46]:\n          - heading \"Agency\" [level=3] [ref=e47]\n          - generic [ref=e48]: €59.00 / month\n  - status \"Page status\" [ref=e49]\n  - alert [ref=e50]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Sign in link",
  "target": "e12"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin#/signin\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [active] [ref=e1]:\n  - main [ref=e51]:\n    - heading \"Sign in\" [level=1] [ref=e52]\n    - generic [ref=e53]:\n      - generic [ref=e54]: Email\n      - textbox \"Email\" [ref=e55]\n      - generic [ref=e56]: Password\n      - textbox \"Password\" [ref=e57]\n      - button \"Sign in\" [ref=e58] [cursor=pointer]\n  - status \"Page status\" [ref=e49]\n  - alert [ref=e50]"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin#/signin\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [active] [ref=e1]:\n  - main [ref=e51]:\n    - heading \"Sign in\" [level=1] [ref=e52]\n    - generic [ref=e53]:\n      - generic [ref=e54]: Email\n      - textbox \"Email\" [ref=e55]\n      - generic [ref=e56]: Password\n      - textbox \"Password\" [ref=e57]\n      - button \"Sign in\" [ref=e58] [cursor=pointer]\n  - status \"Page status\" [ref=e49]\n  - alert [ref=e50]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e55",
      "name": "Email",
      "type": "textbox",
      "value": "juno@lanternfold.test"
    },
    {
      "target": "e57",
      "name": "Password",
      "type": "textbox",
      "value": "fold-the-lantern-26"
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
  "element": "Sign in button",
  "target": "e58"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin#/workshops\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [active] [ref=e1]:\n  - main [ref=e59]:\n    - heading \"Your workshops\" [level=1] [ref=e60]\n    - generic [ref=e61]:\n      - button \"New workshop\" [ref=e62] [cursor=pointer]\n      - link \"Plan and billing\" [ref=e63] [cursor=pointer]:\n        - /url: \"#/billing\"\n      - link \"Activity log\" [ref=e64] [cursor=pointer]:\n        - /url: \"#/activity\"\n      - button \"Sign out\" [ref=e65] [cursor=pointer]\n    - list \"Workshops\" [ref=e66]:\n      - listitem [ref=e67]:\n        - link \"Judge recap 1102B\" [ref=e68] [cursor=pointer]:\n          - /url: \"#/w/ws_z3lqZ-5rxjPi0xf0\"\n        - generic [ref=e69]: Open\n        - generic [ref=e70]: 2027-06-15 10:00\n      - listitem [ref=e71]:\n        - link \"Judge recap X021034\" [ref=e72] [cursor=pointer]:\n          - /url: \"#/w/ws_Xp39uqnd1DUf9jPC\"\n        - generic [ref=e73]: Draft\n        - generic [ref=e74]: 2027-06-15 10:00\n      - listitem [ref=e75]:\n        - link \"Judge recap 1102A\" [ref=e76] [cursor=pointer]:\n          - /url: \"#/w/ws_JZeKxPFrDPE_WtTh\"\n        - generic [ref=e77]: Draft\n        - generic [ref=e78]: 2027-06-15 10:00\n      - listitem [ref=e79]:\n        - link \"Harbourline Studio — discovery sprint\" [ref=e80] [cursor=pointer]:\n          - /url: \"#/w/ws_harbourline\"\n        - generic [ref=e81]: Draft\n        - generic [ref=e82]: 2027-03-04 14:00\n      - listitem [ref=e83]:\n        - link \"Fernmoor Clinic — Q3 retrospective\" [ref=e84] [cursor=pointer]:\n          - /url: \"#/w/ws_fernmoor\"\n        - generic [ref=e85]: Revealed\n        - generic [ref=e86]: 2027-02-11 09:00\n  - status \"Page status\" [ref=e49]\n  - alert [ref=e50]"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin#/workshops\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [active] [ref=e1]:\n  - main [ref=e59]:\n    - heading \"Your workshops\" [level=1] [ref=e60]\n    - generic [ref=e61]:\n      - button \"New workshop\" [ref=e62] [cursor=pointer]\n      - link \"Plan and billing\" [ref=e63] [cursor=pointer]:\n        - /url: \"#/billing\"\n      - link \"Activity log\" [ref=e64] [cursor=pointer]:\n        - /url: \"#/activity\"\n      - button \"Sign out\" [ref=e65] [cursor=pointer]\n    - list \"Workshops\" [ref=e66]:\n      - listitem [ref=e67]:\n        - link \"Judge recap 1102B\" [ref=e68] [cursor=pointer]:\n          - /url: \"#/w/ws_z3lqZ-5rxjPi0xf0\"\n        - generic [ref=e69]: Open\n        - generic [ref=e70]: 2027-06-15 10:00\n      - listitem [ref=e71]:\n        - link \"Judge recap X021034\" [ref=e72] [cursor=pointer]:\n          - /url: \"#/w/ws_Xp39uqnd1DUf9jPC\"\n        - generic [ref=e73]: Draft\n        - generic [ref=e74]: 2027-06-15 10:00\n      - listitem [ref=e75]:\n        - link \"Judge recap 1102A\" [ref=e76] [cursor=pointer]:\n          - /url: \"#/w/ws_JZeKxPFrDPE_WtTh\"\n        - generic [ref=e77]: Draft\n        - generic [ref=e78]: 2027-06-15 10:00\n      - listitem [ref=e79]:\n        - link \"Harbourline Studio — discovery sprint\" [ref=e80] [cursor=pointer]:\n          - /url: \"#/w/ws_harbourline\"\n        - generic [ref=e81]: Draft\n        - generic [ref=e82]: 2027-03-04 14:00\n      - listitem [ref=e83]:\n        - link \"Fernmoor Clinic — Q3 retrospective\" [ref=e84] [cursor=pointer]:\n          - /url: \"#/w/ws_fernmoor\"\n        - generic [ref=e85]: Revealed\n        - generic [ref=e86]: 2027-02-11 09:00\n  - status \"Page status\" [ref=e49]\n  - alert [ref=e50]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "New workshop button",
  "target": "e62"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin#/workshops\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - main [ref=e59]:\n    - heading \"Your workshops\" [level=1] [ref=e60]\n    - generic [ref=e61]:\n      - button \"New workshop\" [ref=e62] [cursor=pointer]\n      - link \"Plan and billing\" [ref=e63] [cursor=pointer]:\n        - /url: \"#/billing\"\n      - link \"Activity log\" [ref=e64] [cursor=pointer]:\n        - /url: \"#/activity\"\n      - button \"Sign out\" [ref=e65] [cursor=pointer]\n    - list \"Workshops\" [ref=e66]:\n      - listitem [ref=e67]:\n        - link \"Judge recap 1102B\" [ref=e68] [cursor=pointer]:\n          - /url: \"#/w/ws_z3lqZ-5rxjPi0xf0\"\n        - generic [ref=e69]: Open\n        - generic [ref=e70]: 2027-06-15 10:00\n      - listitem [ref=e71]:\n        - link \"Judge recap X021034\" [ref=e72] [cursor=pointer]:\n          - /url: \"#/w/ws_Xp39uqnd1DUf9jPC\"\n        - generic [ref=e73]: Draft\n        - generic [ref=e74]: 2027-06-15 10:00\n      - listitem [ref=e75]:\n        - link \"Judge recap 1102A\" [ref=e76] [cursor=pointer]:\n          - /url: \"#/w/ws_JZeKxPFrDPE_WtTh\"\n        - generic [ref=e77]: Draft\n        - generic [ref=e78]: 2027-06-15 10:00\n      - listitem [ref=e79]:\n        - link \"Harbourline Studio — discovery sprint\" [ref=e80] [cursor=pointer]:\n          - /url: \"#/w/ws_harbourline\"\n        - generic [ref=e81]: Draft\n        - generic [ref=e82]: 2027-03-04 14:00\n      - listitem [ref=e83]:\n        - link \"Fernmoor Clinic — Q3 retrospective\" [ref=e84] [cursor=pointer]:\n          - /url: \"#/w/ws_fernmoor\"\n        - generic [ref=e85]: Revealed\n        - generic [ref=e86]: 2027-02-11 09:00\n  - status \"Page status\" [ref=e49]\n  - alert [ref=e50]\n  - dialog \"New workshop\" [ref=e87]:\n    - heading \"New workshop\" [level=2] [ref=e88]\n    - generic [ref=e89]: Title\n    - textbox \"Title\" [active] [ref=e90]\n    - radiogroup \"Template\" [ref=e91]:\n      - generic [ref=e92]:\n        - radio \"Retrospective\" [checked] [ref=e93] [cursor=pointer]\n        - text: Retrospective\n      - generic [ref=e94]:\n        - radio \"Discovery sprint\" [ref=e95] [cursor=pointer]\n        - text: Discovery sprint\n      - generic [ref=e96]:\n        - radio \"Strategy offsite\" [ref=e97] [cursor=pointer]\n        - text: Strategy offsite\n      - generic [ref=e98]:\n        - radio \"Blank\" [ref=e99] [cursor=pointer]\n        - text: Blank\n    - generic [ref=e100]: Starts\n    - textbox \"Starts\" [ref=e101]\n    - generic [ref=e102]: Ends\n    - textbox \"Ends\" [ref=e103]\n    - generic [ref=e104]: Sponsor email\n    - textbox \"Sponsor email\" [ref=e105]\n    - generic [ref=e106]: Client fee (EUR)\n    - textbox \"Client fee (EUR)\" [ref=e107]\n    - generic [ref=e108]:\n      - button \"Create workshop\" [ref=e109] [cursor=pointer]\n      - button \"Cancel\" [ref=e110] [cursor=pointer]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 8
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin#/workshops\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e1]:\n  - main [ref=e59]:\n    - heading \"Your workshops\" [level=1] [ref=e60]\n    - generic [ref=e61]:\n      - button \"New workshop\" [ref=e62] [cursor=pointer]\n      - link \"Plan and billing\" [ref=e63] [cursor=pointer]:\n        - /url: \"#/billing\"\n      - link \"Activity log\" [ref=e64] [cursor=pointer]:\n        - /url: \"#/activity\"\n      - button \"Sign out\" [ref=e65] [cursor=pointer]\n    - list \"Workshops\" [ref=e66]:\n      - listitem [ref=e67]:\n        - link \"Judge recap 1102B\" [ref=e68] [cursor=pointer]:\n          - /url: \"#/w/ws_z3lqZ-5rxjPi0xf0\"\n        - generic [ref=e69]: Open\n        - generic [ref=e70]: 2027-06-15 10:00\n      - listitem [ref=e71]:\n        - link \"Judge recap X021034\" [ref=e72] [cursor=pointer]:\n          - /url: \"#/w/ws_Xp39uqnd1DUf9jPC\"\n        - generic [ref=e73]: Draft\n        - generic [ref=e74]: 2027-06-15 10:00\n      - listitem [ref=e75]:\n        - link \"Judge recap 1102A\" [ref=e76] [cursor=pointer]:\n          - /url: \"#/w/ws_JZeKxPFrDPE_WtTh\"\n        - generic [ref=e77]: Draft\n        - generic [ref=e78]: 2027-06-15 10:00\n      - listitem [ref=e79]:\n        - link \"Harbourline Studio — discovery sprint\" [ref=e80] [cursor=pointer]:\n          - /url: \"#/w/ws_harbourline\"\n        - generic [ref=e81]: Draft\n        - generic [ref=e82]: 2027-03-04 14:00\n      - listitem [ref=e83]:\n        - link \"Fernmoor Clinic — Q3 retrospective\" [ref=e84] [cursor=pointer]:\n          - /url: \"#/w/ws_fernmoor\"\n        - generic [ref=e85]: Revealed\n        - generic [ref=e86]: 2027-02-11 09:00\n  - status \"Page status\" [ref=e49]\n  - alert [ref=e50]\n  - dialog \"New workshop\" [ref=e87]:\n    - heading \"New workshop\" [level=2] [ref=e88]\n    - generic [ref=e89]: Title\n    - textbox \"Title\" [active] [ref=e90]\n    - radiogroup \"Template\" [ref=e91]:\n      - generic [ref=e92]:\n        - radio \"Retrospective\" [checked] [ref=e93] [cursor=pointer]\n        - text: Retrospective\n      - generic [ref=e94]:\n        - radio \"Discovery sprint\" [ref=e95] [cursor=pointer]\n        - text: Discovery sprint\n      - generic [ref=e96]:\n        - radio \"Strategy offsite\" [ref=e97] [cursor=pointer]\n        - text: Strategy offsite\n      - generic [ref=e98]:\n        - radio \"Blank\" [ref=e99] [cursor=pointer]\n        - text: Blank\n    - generic [ref=e100]: Starts\n    - textbox \"Starts\" [ref=e101]\n    - generic [ref=e102]: Ends\n    - textbox \"Ends\" [ref=e103]\n    - generic [ref=e104]: Sponsor email\n    - textbox \"Sponsor email\" [ref=e105]\n    - generic [ref=e106]: Client fee (EUR)\n    - textbox \"Client fee (EUR)\" [ref=e107]\n    - generic [ref=e108]:\n      - button \"Create workshop\" [ref=e109] [cursor=pointer]\n      - button \"Cancel\" [ref=e110] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Blank template radio",
  "target": "e99"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin#/workshops\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e1]:\n  - main [ref=e59]:\n    - heading \"Your workshops\" [level=1] [ref=e60]\n    - generic [ref=e61]:\n      - button \"New workshop\" [ref=e62] [cursor=pointer]\n      - link \"Plan and billing\" [ref=e63] [cursor=pointer]:\n        - /url: \"#/billing\"\n      - link \"Activity log\" [ref=e64] [cursor=pointer]:\n        - /url: \"#/activity\"\n      - button \"Sign out\" [ref=e65] [cursor=pointer]\n    - list \"Workshops\" [ref=e66]:\n      - listitem [ref=e67]:\n        - link \"Judge recap 1102B\" [ref=e68] [cursor=pointer]:\n          - /url: \"#/w/ws_z3lqZ-5rxjPi0xf0\"\n        - generic [ref=e69]: Open\n        - generic [ref=e70]: 2027-06-15 10:00\n      - listitem [ref=e71]:\n        - link \"Judge recap X021034\" [ref=e72] [cursor=pointer]:\n          - /url: \"#/w/ws_Xp39uqnd1DUf9jPC\"\n        - generic [ref=e73]: Draft\n        - generic [ref=e74]: 2027-06-15 10:00\n      - listitem [ref=e75]:\n        - link \"Judge recap 1102A\" [ref=e76] [cursor=pointer]:\n          - /url: \"#/w/ws_JZeKxPFrDPE_WtTh\"\n        - generic [ref=e77]: Draft\n        - generic [ref=e78]: 2027-06-15 10:00\n      - listitem [ref=e79]:\n        - link \"Harbourline Studio — discovery sprint\" [ref=e80] [cursor=pointer]:\n          - /url: \"#/w/ws_harbourline\"\n        - generic [ref=e81]: Draft\n        - generic [ref=e82]: 2027-03-04 14:00\n      - listitem [ref=e83]:\n        - link \"Fernmoor Clinic — Q3 retrospective\" [ref=e84] [cursor=pointer]:\n          - /url: \"#/w/ws_fernmoor\"\n        - generic [ref=e85]: Revealed\n        - generic [ref=e86]: 2027-02-11 09:00\n  - status \"Page status\" [ref=e49]\n  - alert [ref=e50]\n  - dialog \"New workshop\" [ref=e87]:\n    - heading \"New workshop\" [level=2] [ref=e88]\n    - generic [ref=e89]: Title\n    - textbox \"Title\" [ref=e90]\n    - radiogroup \"Template\" [ref=e91]:\n      - generic [ref=e92]:\n        - radio \"Retrospective\" [ref=e93] [cursor=pointer]\n        - text: Retrospective\n      - generic [ref=e94]:\n        - radio \"Discovery sprint\" [ref=e95] [cursor=pointer]\n        - text: Discovery sprint\n      - generic [ref=e96]:\n        - radio \"Strategy offsite\" [ref=e97] [cursor=pointer]\n        - text: Strategy offsite\n      - generic [ref=e98]:\n        - radio \"Blank\" [checked] [active] [ref=e99] [cursor=pointer]\n        - text: Blank\n    - generic [ref=e100]: Starts\n    - textbox \"Starts\" [ref=e101]\n    - generic [ref=e102]: Ends\n    - textbox \"Ends\" [ref=e103]\n    - generic [ref=e104]: Sponsor email\n    - textbox \"Sponsor email\" [ref=e105]\n    - generic [ref=e106]: Client fee (EUR)\n    - textbox \"Client fee (EUR)\" [ref=e107]\n    - generic [ref=e108]:\n      - button \"Create workshop\" [ref=e109] [cursor=pointer]\n      - button \"Cancel\" [ref=e110] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e90",
      "name": "Title",
      "type": "textbox",
      "value": "Judge silent 1102C"
    },
    {
      "target": "e101",
      "name": "Starts",
      "type": "textbox",
      "value": "2027-06-15T10:00"
    },
    {
      "target": "e103",
      "name": "Ends",
      "type": "textbox",
      "value": "2027-06-15T12:00"
    },
    {
      "target": "e105",
      "name": "Sponsor email",
      "type": "textbox",
      "value": "judge-1102c@example.com"
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
  "element": "Create workshop button",
  "target": "e109"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin#/w/ws_jJsT9Q13qRLFnWh0\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [active] [ref=e1]:\n  - generic [ref=e2]:\n    - generic [ref=e111]:\n      - banner [ref=e112]:\n        - heading \"Judge silent 1102C\" [level=1] [ref=e113]\n        - generic [ref=e114]: Draft\n        - button \"Frames\" [ref=e115] [cursor=pointer]\n        - button \"Session\" [ref=e116] [cursor=pointer]\n        - search [ref=e117]:\n          - searchbox \"Search notes\" [ref=e118]\n      - navigation \"Frames\" [ref=e119]:\n        - heading \"Frames\" [level=2] [ref=e120]\n        - navigation \"Frames\" [ref=e121]:\n          - button \"Ideas\" [ref=e122] [cursor=pointer]\n          - button \"Add frame\" [ref=e123] [cursor=pointer]\n      - main [ref=e124]:\n        - region \"Ideas\" [ref=e126]:\n          - generic [ref=e127]:\n            - heading \"Ideas\" [level=2] [ref=e128]\n            - generic [ref=e129]: 0 notes\n            - button \"Frame options\" [ref=e130] [cursor=pointer]: ⋮\n        - toolbar \"Board tools\" [ref=e131]:\n          - button \"Add note\" [ref=e132] [cursor=pointer]\n          - button \"Add image\" [ref=e134] [cursor=pointer]\n          - button \"Add cluster\" [ref=e139] [cursor=pointer]\n          - button \"Connect notes\" [ref=e142] [cursor=pointer]\n          - button \"Zoom out\" [ref=e146] [cursor=pointer]\n          - button \"Zoom in\" [ref=e150] [cursor=pointer]\n          - button \"Fit board\" [ref=e154] [cursor=pointer]\n      - complementary \"Session\" [ref=e160]:\n        - heading \"Session\" [level=2] [ref=e161]\n        - generic [ref=e162]:\n          - generic [ref=e163]:\n            - heading \"Timer\" [level=2] [ref=e164]\n            - timer \"Session timer\" [ref=e165]: \"--:--\"\n          - generic [ref=e166]:\n            - heading \"Facilitator\" [level=2] [ref=e167]\n            - button \"Open room\" [ref=e168] [cursor=pointer]\n          - generic [ref=e169]:\n            - heading \"Join link\" [level=2] [ref=e170]\n            - generic [ref=e171]: http://localhost:4173/join/yrYBKqgbzSp1BzK9CtEn_WTi\n            - generic [ref=e172]: Expires 6/16/2027, 11:00:00 AM\n            - button \"Copy join link\" [ref=e173] [cursor=pointer]\n            - button \"New join link\" [ref=e174] [cursor=pointer]\n            - button \"Turn off join link\" [ref=e175] [cursor=pointer]\n          - generic [ref=e176]:\n            - heading \"Invites\" [level=2] [ref=e177]\n            - generic [ref=e178]: Client emails\n            - textbox \"Client emails\" [ref=e179]\n            - button \"Send invites\" [ref=e180] [cursor=pointer]\n            - list \"Invites\"\n          - generic [ref=e181]:\n            - heading \"Board\" [level=2] [ref=e182]\n            - button \"Trash\" [ref=e183] [cursor=pointer]\n            - button \"Versions\" [ref=e184] [cursor=pointer]\n    - status \"Board activity\" [ref=e185]\n    - alert \"Board problems\" [ref=e186]\n  - status \"Page status\" [ref=e49]: Workshop created from the Blank template\n  - alert [ref=e50]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 8
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin#/w/ws_jJsT9Q13qRLFnWh0\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [active] [ref=e1]:\n  - generic [ref=e2]:\n    - generic [ref=e111]:\n      - banner [ref=e112]:\n        - heading \"Judge silent 1102C\" [level=1] [ref=e113]\n        - generic [ref=e114]: Draft\n        - button \"Frames\" [ref=e115] [cursor=pointer]\n        - button \"Session\" [ref=e116] [cursor=pointer]\n        - search [ref=e117]:\n          - searchbox \"Search notes\" [ref=e118]\n      - navigation \"Frames\" [ref=e119]:\n        - heading \"Frames\" [level=2] [ref=e120]\n        - navigation \"Frames\" [ref=e121]:\n          - button \"Ideas\" [ref=e122] [cursor=pointer]\n          - button \"Add frame\" [ref=e123] [cursor=pointer]\n      - main [ref=e124]:\n        - region \"Ideas\" [ref=e126]:\n          - generic [ref=e127]:\n            - heading \"Ideas\" [level=2] [ref=e128]\n            - generic [ref=e129]: 0 notes\n            - button \"Frame options\" [ref=e130] [cursor=pointer]: ⋮\n        - toolbar \"Board tools\" [ref=e131]:\n          - button \"Add note\" [ref=e132] [cursor=pointer]\n          - button \"Add image\" [ref=e134] [cursor=pointer]\n          - button \"Add cluster\" [ref=e139] [cursor=pointer]\n          - button \"Connect notes\" [ref=e142] [cursor=pointer]\n          - button \"Zoom out\" [ref=e146] [cursor=pointer]\n          - button \"Zoom in\" [ref=e150] [cursor=pointer]\n          - button \"Fit board\" [ref=e154] [cursor=pointer]\n      - complementary \"Session\" [ref=e160]:\n        - heading \"Session\" [level=2] [ref=e161]\n        - generic [ref=e162]:\n          - generic [ref=e163]:\n            - heading \"Timer\" [level=2] [ref=e164]\n            - timer \"Session timer\" [ref=e165]: \"--:--\"\n          - generic [ref=e166]:\n            - heading \"Facilitator\" [level=2] [ref=e167]\n            - button \"Open room\" [ref=e168] [cursor=pointer]\n          - generic [ref=e169]:\n            - heading \"Join link\" [level=2] [ref=e170]\n            - generic [ref=e171]: http://localhost:4173/join/yrYBKqgbzSp1BzK9CtEn_WTi\n            - generic [ref=e172]: Expires 6/16/2027, 11:00:00 AM\n            - button \"Copy join link\" [ref=e173] [cursor=pointer]\n            - button \"New join link\" [ref=e174] [cursor=pointer]\n            - button \"Turn off join link\" [ref=e175] [cursor=pointer]\n          - generic [ref=e176]:\n            - heading \"Invites\" [level=2] [ref=e177]\n            - generic [ref=e178]: Client emails\n            - textbox \"Client emails\" [ref=e179]\n            - button \"Send invites\" [ref=e180] [cursor=pointer]\n            - list \"Invites\"\n          - generic [ref=e181]:\n            - heading \"Board\" [level=2] [ref=e182]\n            - button \"Trash\" [ref=e183] [cursor=pointer]\n            - button \"Versions\" [ref=e184] [cursor=pointer]\n    - status \"Board activity\" [ref=e185]\n    - alert \"Board problems\" [ref=e186]\n  - status \"Page status\" [ref=e49]: Workshop created from the Blank template\n  - alert [ref=e50]"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/normal/page-2026-11-02T10-45-20-390Z.png)",
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
  "function": "() => ({tag: document.activeElement?.tagName, text: document.activeElement?.textContent, aria: document.activeElement?.getAttribute('aria-label')})"
}
```
- Result
```json
{
  "result": "{\n  \"tag\": \"BODY\",\n  \"text\": \"\\n  \\n    \\n      Judge silent 1102C\\n      Draft\\n      Frames\\n      Session\\n      \\n        \\n      \\n      Reconnecting to the board…\\n    \\n    \\n      Frames\\n      IdeasAdd frame\\n    \\n    \\n      \\n    Ideas0 notes⋮\\n  \\n      \\n      \\n    \\n    \\n      Session\\n      Timer--:--FacilitatorOpen roomJoin linkhttp://localhost:4173/join/yrYBKqgbzSp1BzK9CtEn_WTiExpires 6/16/2027, 11:00:00 AMCopy join linkNew join linkTurn off join linkInvites\\n      Client emails\\n      \\n      Send invites\\n      BoardTrashVersions\\n    \\n  \\n  \\n\\n\\nWorkshop created from the Blank template\",\n  \"aria\": null\n}"
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
  "key": "Tab"
}
```
- Result
```json
{}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({tag: document.activeElement?.tagName, text: document.activeElement?.textContent, aria: document.activeElement?.getAttribute('aria-label')})"
}
```
- Result
```json
{
  "result": "{\n  \"tag\": \"BUTTON\",\n  \"text\": \"⋮\",\n  \"aria\": \"Frame options\"\n}"
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
  "key": "Tab"
}
```
- Result
```json
{}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({text: document.activeElement?.textContent, aria: document.activeElement?.getAttribute('aria-label')})"
}
```
- Result
```json
{
  "result": "{\n  \"text\": \"\",\n  \"aria\": \"Zoom out\"\n}"
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
  "key": "Tab"
}
```
- Result
```json
{}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({text: document.activeElement?.textContent, aria: document.activeElement?.getAttribute('aria-label')})"
}
```
- Result
```json
{
  "result": "{\n  \"text\": \"Open room\",\n  \"aria\": \"Open room\"\n}"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin#/w/ws_jJsT9Q13qRLFnWh0\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [active] [ref=e1]:\n  - generic [ref=e2]:\n    - generic [ref=e111]:\n      - banner [ref=e112]:\n        - heading \"Judge silent 1102C\" [level=1] [ref=e113]\n        - generic [ref=e114]: Open\n        - button \"Frames\" [ref=e115] [cursor=pointer]\n        - button \"Session\" [ref=e116] [cursor=pointer]\n        - search [ref=e117]:\n          - searchbox \"Search notes\" [ref=e118]\n      - navigation \"Frames\" [ref=e119]:\n        - heading \"Frames\" [level=2] [ref=e120]\n        - navigation \"Frames\" [ref=e121]:\n          - button \"Ideas\" [ref=e187] [cursor=pointer]\n          - button \"Add frame\" [ref=e188] [cursor=pointer]\n      - main [ref=e124]:\n        - region \"Ideas\" [ref=e189]:\n          - generic [ref=e190]:\n            - heading \"Ideas\" [level=2] [ref=e191]\n            - generic [ref=e192]: 0 notes\n            - button \"Frame options\" [ref=e193] [cursor=pointer]: ⋮\n        - toolbar \"Board tools\" [ref=e131]:\n          - button \"Add note\" [ref=e132] [cursor=pointer]\n          - button \"Add image\" [ref=e134] [cursor=pointer]\n          - button \"Add cluster\" [ref=e139] [cursor=pointer]\n          - button \"Connect notes\" [ref=e142] [cursor=pointer]\n          - button \"Zoom out\" [ref=e146] [cursor=pointer]\n          - button \"Zoom in\" [ref=e150] [cursor=pointer]\n          - button \"Fit board\" [ref=e154] [cursor=pointer]\n      - complementary \"Session\" [ref=e160]:\n        - heading \"Session\" [level=2] [ref=e161]\n        - generic [ref=e162]:\n          - generic [ref=e194]:\n            - heading \"Timer\" [level=2] [ref=e195]\n            - timer \"Session timer\" [ref=e196]: \"--:--\"\n          - generic [ref=e197]:\n            - heading \"Facilitator\" [level=2] [ref=e198]\n            - generic [ref=e199]:\n              - text: Round length in minutes\n              - spinbutton \"Round length in minutes\" [ref=e200]: \"5\"\n            - button \"Start silent round\" [ref=e201] [cursor=pointer]\n          - generic [ref=e202]:\n            - heading \"Join link\" [level=2] [ref=e203]\n            - generic [ref=e204]: http://localhost:4173/join/yrYBKqgbzSp1BzK9CtEn_WTi\n            - generic [ref=e205]: Expires 6/16/2027, 11:00:00 AM\n            - button \"Copy join link\" [ref=e206] [cursor=pointer]\n            - button \"New join link\" [ref=e207] [cursor=pointer]\n            - button \"Turn off join link\" [ref=e208] [cursor=pointer]\n          - generic [ref=e209]:\n            - heading \"Invites\" [level=2] [ref=e210]\n            - generic [ref=e211]: Client emails\n            - textbox \"Client emails\" [ref=e212]\n            - button \"Send invites\" [ref=e213] [cursor=pointer]\n            - list \"Invites\"\n          - generic [ref=e214]:\n            - heading \"Board\" [level=2] [ref=e215]\n            - button \"Trash\" [ref=e216] [cursor=pointer]\n            - button \"Versions\" [ref=e217] [cursor=pointer]\n    - status \"Board activity\" [ref=e185]: Room open\n    - alert \"Board problems\" [ref=e186]\n  - status \"Page status\" [ref=e49]: Workshop created from the Blank template\n  - alert [ref=e50]"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin#/w/ws_jJsT9Q13qRLFnWh0\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [active] [ref=e1]:\n  - generic [ref=e2]:\n    - generic [ref=e111]:\n      - banner [ref=e112]:\n        - heading \"Judge silent 1102C\" [level=1] [ref=e113]\n        - generic [ref=e114]: Open\n        - button \"Frames\" [ref=e115] [cursor=pointer]\n        - button \"Session\" [ref=e116] [cursor=pointer]\n        - search [ref=e117]:\n          - searchbox \"Search notes\" [ref=e118]\n      - navigation \"Frames\" [ref=e119]:\n        - heading \"Frames\" [level=2] [ref=e120]\n        - navigation \"Frames\" [ref=e121]:\n          - button \"Ideas\" [ref=e187] [cursor=pointer]\n          - button \"Add frame\" [ref=e188] [cursor=pointer]\n      - main [ref=e124]:\n        - region \"Ideas\" [ref=e189]:\n          - generic [ref=e190]:\n            - heading \"Ideas\" [level=2] [ref=e191]\n            - generic [ref=e192]: 0 notes\n            - button \"Frame options\" [ref=e193] [cursor=pointer]: ⋮\n        - toolbar \"Board tools\" [ref=e131]:\n          - button \"Add note\" [ref=e132] [cursor=pointer]\n          - button \"Add image\" [ref=e134] [cursor=pointer]\n          - button \"Add cluster\" [ref=e139] [cursor=pointer]\n          - button \"Connect notes\" [ref=e142] [cursor=pointer]\n          - button \"Zoom out\" [ref=e146] [cursor=pointer]\n          - button \"Zoom in\" [ref=e150] [cursor=pointer]\n          - button \"Fit board\" [ref=e154] [cursor=pointer]\n      - complementary \"Session\" [ref=e160]:\n        - heading \"Session\" [level=2] [ref=e161]\n        - generic [ref=e162]:\n          - generic [ref=e194]:\n            - heading \"Timer\" [level=2] [ref=e195]\n            - timer \"Session timer\" [ref=e196]: \"--:--\"\n          - generic [ref=e197]:\n            - heading \"Facilitator\" [level=2] [ref=e198]\n            - generic [ref=e199]:\n              - text: Round length in minutes\n              - spinbutton \"Round length in minutes\" [ref=e200]: \"5\"\n            - button \"Start silent round\" [ref=e201] [cursor=pointer]\n          - generic [ref=e202]:\n            - heading \"Join link\" [level=2] [ref=e203]\n            - generic [ref=e204]: http://localhost:4173/join/yrYBKqgbzSp1BzK9CtEn_WTi\n            - generic [ref=e205]: Expires 6/16/2027, 11:00:00 AM\n            - button \"Copy join link\" [ref=e206] [cursor=pointer]\n            - button \"New join link\" [ref=e207] [cursor=pointer]\n            - button \"Turn off join link\" [ref=e208] [cursor=pointer]\n          - generic [ref=e209]:\n            - heading \"Invites\" [level=2] [ref=e210]\n            - generic [ref=e211]: Client emails\n            - textbox \"Client emails\" [ref=e212]\n            - button \"Send invites\" [ref=e213] [cursor=pointer]\n            - list \"Invites\"\n          - generic [ref=e214]:\n            - heading \"Board\" [level=2] [ref=e215]\n            - button \"Trash\" [ref=e216] [cursor=pointer]\n            - button \"Versions\" [ref=e217] [cursor=pointer]\n    - status \"Board activity\" [ref=e185]: Room open\n    - alert \"Board problems\" [ref=e186]\n  - status \"Page status\" [ref=e49]: Workshop created from the Blank template\n  - alert [ref=e50]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e200",
      "name": "Round length in minutes",
      "type": "textbox",
      "value": "10"
    }
  ]
}
```
- Result
```json
{}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({tag:document.activeElement?.tagName, aria:document.activeElement?.getAttribute('aria-label'), value:document.activeElement?.value})"
}
```
- Result
```json
{
  "result": "{\n  \"tag\": \"INPUT\",\n  \"aria\": \"Round length in minutes\",\n  \"value\": \"10\"\n}"
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

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({text:document.activeElement?.textContent, aria:document.activeElement?.getAttribute('aria-label')})"
}
```
- Result
```json
{
  "result": "{\n  \"text\": \"Start silent round\",\n  \"aria\": \"Start silent round\"\n}"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin#/w/ws_jJsT9Q13qRLFnWh0\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [active] [ref=e1]:\n  - generic [ref=e2]:\n    - generic [ref=e111]:\n      - banner [ref=e112]:\n        - heading \"Judge silent 1102C\" [level=1] [ref=e113]\n        - generic [ref=e114]: Silent round\n        - button \"Frames\" [ref=e115] [cursor=pointer]\n        - button \"Session\" [ref=e116] [cursor=pointer]\n        - search [ref=e117]:\n          - searchbox \"Search notes\" [ref=e118]\n      - navigation \"Frames\" [ref=e119]:\n        - heading \"Frames\" [level=2] [ref=e120]\n        - navigation \"Frames\" [ref=e121]:\n          - button \"Ideas\" [ref=e218] [cursor=pointer]\n          - button \"Add frame\" [ref=e219] [cursor=pointer]\n      - main [ref=e124]:\n        - region \"Ideas\" [ref=e220]:\n          - generic [ref=e221]:\n            - heading \"Ideas\" [level=2] [ref=e222]\n            - generic [ref=e223]: 0 notes\n            - button \"Frame options\" [ref=e224] [cursor=pointer]: ⋮\n        - toolbar \"Board tools\" [ref=e131]:\n          - button \"Add note\" [ref=e132] [cursor=pointer]\n          - button \"Add image\" [ref=e134] [cursor=pointer]\n          - button \"Add cluster\" [ref=e139] [cursor=pointer]\n          - button \"Connect notes\" [ref=e142] [cursor=pointer]\n          - button \"Zoom out\" [ref=e146] [cursor=pointer]\n          - button \"Zoom in\" [ref=e150] [cursor=pointer]\n          - button \"Fit board\" [ref=e154] [cursor=pointer]\n      - complementary \"Session\" [ref=e160]:\n        - heading \"Session\" [level=2] [ref=e161]\n        - generic [ref=e162]:\n          - generic [ref=e225]:\n            - heading \"Timer\" [level=2] [ref=e226]\n            - timer \"Session timer\" [ref=e227]: 09:59\n          - generic [ref=e228]:\n            - heading \"Facilitator\" [level=2] [ref=e229]\n            - button \"Reveal\" [ref=e230] [cursor=pointer]\n          - generic [ref=e231]:\n            - heading \"Room\" [level=2] [ref=e232]\n            - list \"Room\"\n          - generic [ref=e233]:\n            - heading \"Join link\" [level=2] [ref=e234]\n            - generic [ref=e235]: http://localhost:4173/join/yrYBKqgbzSp1BzK9CtEn_WTi\n            - generic [ref=e236]: Expires 6/16/2027, 11:00:00 AM\n            - button \"Copy join link\" [ref=e237] [cursor=pointer]\n            - button \"New join link\" [ref=e238] [cursor=pointer]\n            - button \"Turn off join link\" [ref=e239] [cursor=pointer]\n          - generic [ref=e240]:\n            - heading \"Invites\" [level=2] [ref=e241]\n            - generic [ref=e242]: Client emails\n            - textbox \"Client emails\" [ref=e243]\n            - button \"Send invites\" [ref=e244] [cursor=pointer]\n            - list \"Invites\"\n          - generic [ref=e245]:\n            - heading \"Board\" [level=2] [ref=e246]\n            - button \"Trash\" [ref=e247] [cursor=pointer]\n            - button \"Versions\" [ref=e248] [cursor=pointer]\n    - status \"Board activity\" [ref=e185]: Silent round started — ends at 10:57\n    - alert \"Board problems\" [ref=e186]\n  - status \"Page status\" [ref=e49]: Workshop created from the Blank template\n  - alert [ref=e50]"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin#/w/ws_jJsT9Q13qRLFnWh0\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [active] [ref=e1]:\n  - generic [ref=e2]:\n    - generic [ref=e111]:\n      - banner [ref=e112]:\n        - heading \"Judge silent 1102C\" [level=1] [ref=e113]\n        - generic [ref=e114]: Silent round\n        - button \"Frames\" [ref=e115] [cursor=pointer]\n        - button \"Session\" [ref=e116] [cursor=pointer]\n        - search [ref=e117]:\n          - searchbox \"Search notes\" [ref=e118]\n      - navigation \"Frames\" [ref=e119]:\n        - heading \"Frames\" [level=2] [ref=e120]\n        - navigation \"Frames\" [ref=e121]:\n          - button \"Ideas\" [ref=e218] [cursor=pointer]\n          - button \"Add frame\" [ref=e219] [cursor=pointer]\n      - main [ref=e124]:\n        - region \"Ideas\" [ref=e220]:\n          - generic [ref=e221]\n        - toolbar \"Board tools\" [ref=e131]:\n          - button \"Add note\" [ref=e132] [cursor=pointer]\n          - button \"Add image\" [ref=e134] [cursor=pointer]\n          - button \"Add cluster\" [ref=e139] [cursor=pointer]\n          - button \"Connect notes\" [ref=e142] [cursor=pointer]\n          - button \"Zoom out\" [ref=e146] [cursor=pointer]\n          - button \"Zoom in\" [ref=e150] [cursor=pointer]\n          - button \"Fit board\" [ref=e154] [cursor=pointer]\n      - complementary \"Session\" [ref=e160]:\n        - heading \"Session\" [level=2] [ref=e161]\n        - generic [ref=e162]:\n          - generic [ref=e225]\n          - generic [ref=e228]\n          - generic [ref=e231]\n          - generic [ref=e233]\n          - generic [ref=e240]\n          - generic [ref=e245]\n    - status \"Board activity\" [ref=e185]: Silent round started — ends at 10:57\n    - alert \"Board problems\" [ref=e186]\n  - status \"Page status\" [ref=e49]: Workshop created from the Blank template\n  - alert [ref=e50]"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin#/w/ws_jJsT9Q13qRLFnWh0\n- Page Title: Lanternfold Rooms\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [active] [ref=e1]:\n  - generic [ref=e2]:\n    - generic [ref=e111]:\n      - banner [ref=e112]:\n        - heading \"Judge silent 1102C\" [level=1] [ref=e113]\n        - generic [ref=e114]: Silent round\n        - button \"Frames\" [ref=e115] [cursor=pointer]\n        - button \"Session\" [ref=e116] [cursor=pointer]\n        - search [ref=e117]\n      - navigation \"Frames\" [ref=e119]:\n        - heading \"Frames\" [level=2] [ref=e120]\n        - navigation \"Frames\" [ref=e121]\n      - main [ref=e124]:\n        - region \"Ideas\" [ref=e220]\n        - toolbar \"Board tools\" [ref=e131]\n      - complementary \"Session\" [ref=e160]:\n        - heading \"Session\" [level=2] [ref=e161]\n        - generic [ref=e162]\n    - status \"Board activity\" [ref=e185]: Silent round started — ends at 10:57\n    - alert \"Board problems\" [ref=e186]\n  - status \"Page status\" [ref=e49]: Workshop created from the Blank template\n  - alert [ref=e50]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({tag:document.activeElement?.tagName, text:document.activeElement?.textContent, aria:document.activeElement?.getAttribute('aria-label')})"
}
```
- Result
```json
{
  "result": "{\n  \"tag\": \"BODY\",\n  \"text\": \"\\n  \\n    \\n      Judge silent 1102C\\n      Silent round\\n      Frames\\n      Session\\n      \\n        \\n      \\n      Reconnecting to the board…\\n    \\n    \\n      Frames\\n      IdeasAdd frame\\n    \\n    \\n      \\n    Ideas0 notes⋮\\n  \\n      \\n      \\n    \\n    \\n      Session\\n      Timer08:19FacilitatorRevealRoomJoin linkhttp://localhost:4173/join/yrYBKqgbzSp1BzK9CtEn_WTiExpires 6/16/2027, 11:00:00 AMCopy join linkNew join linkTurn off join linkInvites\\n      Client emails\\n      \\n      Send invites\\n      BoardTrashVersions\\n    \\n  Silent round started — ends at 10:57\\n  \\n\\n\\nWorkshop created from the Blank template\",\n  \"aria\": null\n}"
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
  "key": "Tab"
}
```
- Result
```json
{}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({text:document.activeElement?.textContent,aria:document.activeElement?.getAttribute('aria-label')})"
}
```
- Result
```json
{
  "result": "{\n  \"text\": \"\",\n  \"aria\": \"Add image\"\n}"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({noteCount: document.querySelectorAll('[data-note], .note-card, .sticky, [class*=\"card-back\"], [class*=\"note\"]').length, texts:[...document.querySelectorAll('[data-note], .note-card, .sticky, [class*=\"card-back\"], [class*=\"note\"]')].map(e=>({cls:e.className,text:e.textContent,background:getComputedStyle(e).backgroundColor})).slice(0,20)})"
}
```
- Result
```json
{
  "result": "{\n  \"noteCount\": 1,\n  \"texts\": [\n    {\n      \"cls\": \"connecting-note\",\n      \"text\": \"Reconnecting to the board…\",\n      \"background\": \"rgba(0, 0, 0, 0)\"\n    }\n  ]\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/normal/page-2026-11-02T10-49-04-683Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
