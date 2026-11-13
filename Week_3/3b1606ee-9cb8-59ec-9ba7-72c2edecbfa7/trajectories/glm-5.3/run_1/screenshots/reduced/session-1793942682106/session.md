
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
  "url": "http://127.0.0.1:4173/signup?skip_recovery_check=1"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold",
  "snapshot": ""
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
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Choose a username\" [level=1] [ref=e5]\n    - paragraph [ref=e6]: A username is all Airfold asks for. It can be changed later.\n    - generic [ref=e7]:\n      - generic [ref=e8]:\n        - generic [ref=e9]: Username\n        - textbox \"Username\" [active] [ref=e10]\n        - status \"Username availability\" [ref=e11]\n      - button \"Continue\" [ref=e12] [cursor=pointer]\n  - status \"Letter updates\" [ref=e13]\n  - status \"Notifications\"",
  "events": "- New console entries: evidence/reduced/console-2026-11-06T05-25-10-418Z.log#L1"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e10",
      "name": "Username",
      "type": "textbox",
      "value": "oskar_58421"
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
  "element": "Continue",
  "target": "e12"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e14]:\n  - generic [ref=e15]:\n    - heading \"Your recovery code\" [level=1] [ref=e16]\n    - paragraph [ref=e17]: Write it down. It is the only way to restore your letters on a new browser. Airfold cannot show it again.\n    - group \"Your recovery code\" [ref=e18]:\n      - paragraph [ref=e19]: WZS4-GNR8-YW90-7RVZ-9AB4-ZTGM-GB0T-14T2\n    - button \"I've written it down\" [active] [ref=e21] [cursor=pointer]\n  - status \"Letter updates\" [ref=e22]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e14]:\n  - generic [ref=e15]:\n    - heading \"Your recovery code\" [level=1] [ref=e16]\n    - paragraph [ref=e17]: Write it down. It is the only way to restore your letters on a new browser. Airfold cannot show it again.\n    - group \"Your recovery code\" [ref=e18]:\n      - paragraph [ref=e19]: WZS4-GNR8-YW90-7RVZ-9AB4-ZTGM-GB0T-14T2\n    - button \"I've written it down\" [active] [ref=e21] [cursor=pointer]\n  - status \"Letter updates\" [ref=e22]\n  - status \"Notifications\""
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "I've written it down",
  "target": "e21"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e23]:\n  - generic [ref=e25]:\n    - heading \"Your name\" [level=1] [ref=e26]\n    - paragraph [ref=e27]: A display name and an optional photo, both sealed before they leave this page.\n    - generic [ref=e28]:\n      - generic [ref=e29]:\n        - generic [ref=e30]: Display name\n        - textbox \"Display name\" [active] [ref=e31]\n      - button \"Add a photo\" [ref=e33] [cursor=pointer]\n      - button \"Finish\" [ref=e34] [cursor=pointer]\n  - status \"Letter updates\" [ref=e35]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e23]:\n  - generic [ref=e25]:\n    - heading \"Your name\" [level=1] [ref=e26]\n    - paragraph [ref=e27]: A display name and an optional photo, both sealed before they leave this page.\n    - generic [ref=e28]:\n      - generic [ref=e29]:\n        - generic [ref=e30]: Display name\n        - textbox \"Display name\" [active] [ref=e31]\n      - button \"Add a photo\" [ref=e33] [cursor=pointer]\n      - button \"Finish\" [ref=e34] [cursor=pointer]\n  - status \"Letter updates\" [ref=e35]\n  - status \"Notifications\""
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Finish empty",
  "target": "e34"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e23]:\n  - generic [ref=e25]:\n    - heading \"Your name\" [level=1] [ref=e26]\n    - paragraph [ref=e27]: A display name and an optional photo, both sealed before they leave this page.\n    - generic [ref=e28]:\n      - generic [ref=e29]:\n        - generic [ref=e30]: Display name\n        - textbox \"Display name\" [active] [ref=e31]\n        - alert [ref=e36]: Enter a display name.\n      - button \"Add a photo\" [ref=e33] [cursor=pointer]\n      - button \"Finish\" [ref=e34] [cursor=pointer]\n  - status \"Letter updates\" [ref=e35]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e23]:\n  - generic [ref=e25]:\n    - heading \"Your name\" [level=1] [ref=e26]\n    - paragraph [ref=e27]: A display name and an optional photo, both sealed before they leave this page.\n    - generic [ref=e28]:\n      - generic [ref=e29]:\n        - generic [ref=e30]: Display name\n        - textbox \"Display name\" [active] [ref=e31]\n        - alert [ref=e36]: Enter a display name.\n      - button \"Add a photo\" [ref=e33] [cursor=pointer]\n      - button \"Finish\" [ref=e34] [cursor=pointer]\n  - status \"Letter updates\" [ref=e35]\n  - status \"Notifications\""
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e31",
      "name": "Display name",
      "type": "textbox",
      "value": "Oskar Lind"
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
  "element": "Finish",
  "target": "e34"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e37]:\n  - generic [ref=e38]:\n    - status \"Connection\"\n    - main [ref=e39]:\n      - generic [ref=e40]:\n        - generic [ref=e41]:\n          - heading \"Chats\" [level=1] [ref=e42]\n          - list \"Conversations\" [ref=e43]:\n            - listitem [ref=e44]:\n              - paragraph [ref=e46]: No letters yet. Find someone by their exact username.\n        - generic [ref=e47]:\n          - heading \"Contact card\" [level=1] [ref=e48]\n          - paragraph [ref=e50]: No contacts yet.\n    - navigation \"Main\" [ref=e51]:\n      - link \"Chats\" [ref=e52] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=e53] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=e54] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=e55]\n  - status \"Notifications\""
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/letters"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters\n- Page Title: Airfold",
  "snapshot": ""
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/requests"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/requests\n- Page Title: Airfold",
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
  "page": "- Page URL: http://127.0.0.1:4173/requests\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f2e3]:\n  - generic [ref=f2e4]:\n    - status \"Connection\"\n    - main [ref=f2e5]:\n      - generic [ref=f2e7]:\n        - heading \"Letter requests\" [level=1] [ref=f2e8]\n        - list \"Letter requests\" [ref=f2e9]:\n          - listitem [ref=f2e10]:\n            - link \"ines_58421\" [ref=f2e11] [cursor=pointer]:\n              - /url: /requests/4b3582f5-9dda-4a22-8162-ed871ac87a63\n    - navigation \"Main\" [ref=f2e21]:\n      - link \"Chats\" [ref=f2e22] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f2e23] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f2e24] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f2e25]\n  - status \"Notifications\""
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "request row",
  "target": "f2e11"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/requests/4b3582f5-9dda-4a22-8162-ed871ac87a63\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f2e26]:\n  - generic [ref=f2e27]:\n    - status \"Connection\"\n    - main [ref=f2e28]:\n      - generic [ref=f2e29]:\n        - generic [ref=f2e30]:\n          - heading \"Letter requests\" [level=1] [ref=f2e31]\n          - list \"Letter requests\" [ref=f2e32]:\n            - listitem [ref=f2e33]:\n              - link \"ines_58421\" [ref=f2e34] [cursor=pointer]:\n                - /url: /requests/4b3582f5-9dda-4a22-8162-ed871ac87a63\n                - img [aria-hidden] [ref=f2e36]:\n                  - generic [ref=f2e38]: I5\n                - generic [ref=f2e39]:\n                  - generic [ref=f2e40]: ines_58421\n                  - generic [ref=f2e41]: The ferry is late\n                - generic [ref=f2e42]: 05:26\n        - region \"Letter request\" [ref=f2e45]:\n          - heading \"ines_58421\" [level=2] [ref=f2e46]\n          - list \"Letters\" [ref=f2e47]:\n            - article [ref=f2e48]:\n              - paragraph [ref=f2e50]: Good morning from the harbour\n              - generic [ref=f2e51]:\n                - generic [ref=f2e52]: Delivered\n                - time [ref=f2e53]: 05:26\n            - article [ref=f2e54]:\n              - paragraph [ref=f2e56]: The ferry is late\n              - generic [ref=f2e57]:\n                - generic [ref=f2e58]: Delivered\n                - time [ref=f2e59]: 05:26\n          - generic [ref=f2e60]:\n            - button \"Accept\" [ref=f2e61] [cursor=pointer]\n            - button \"Delete\" [ref=f2e62] [cursor=pointer]\n            - button \"Block\" [ref=f2e63] [cursor=pointer]\n    - navigation \"Main\" [ref=f2e64]:\n      - link \"Chats\" [ref=f2e65] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f2e66] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f2e67] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f2e68]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/requests/4b3582f5-9dda-4a22-8162-ed871ac87a63\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f2e26]:\n  - generic [ref=f2e27]:\n    - status \"Connection\"\n    - main [ref=f2e28]:\n      - generic [ref=f2e29]:\n        - generic [ref=f2e30]:\n          - heading \"Letter requests\" [level=1] [ref=f2e31]\n          - list \"Letter requests\" [ref=f2e32]:\n            - listitem [ref=f2e33]:\n              - link \"ines_58421\" [ref=f2e34] [cursor=pointer]:\n                - /url: /requests/4b3582f5-9dda-4a22-8162-ed871ac87a63\n        - region \"Letter request\" [ref=f2e45]:\n          - heading \"ines_58421\" [level=2] [ref=f2e46]\n          - list \"Letters\" [ref=f2e47]:\n            - article [ref=f2e48]:\n              - paragraph [ref=f2e50]: Good morning from the harbour\n              - generic [ref=f2e51]\n            - article [ref=f2e54]:\n              - paragraph [ref=f2e56]: The ferry is late\n              - generic [ref=f2e57]\n          - generic [ref=f2e60]:\n            - button \"Accept\" [ref=f2e61] [cursor=pointer]\n            - button \"Delete\" [ref=f2e62] [cursor=pointer]\n            - button \"Block\" [ref=f2e63] [cursor=pointer]\n    - navigation \"Main\" [ref=f2e64]:\n      - link \"Chats\" [ref=f2e65] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f2e66] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f2e67] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f2e68]\n  - status \"Notifications\""
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Accept",
  "target": "f2e61"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters/4b3582f5-9dda-4a22-8162-ed871ac87a63\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f2e69]:\n  - generic [ref=f2e70]:\n    - status \"Connection\"\n    - main [ref=f2e71]:\n      - generic [ref=f2e72]:\n        - generic [ref=f2e73]:\n          - heading \"Chats\" [level=1] [ref=f2e74]\n          - list \"Conversations\" [ref=f2e75]:\n            - listitem [ref=f2e76]:\n              - link \"Ines Varga\" [ref=f2e77] [cursor=pointer]:\n                - /url: /letters/4b3582f5-9dda-4a22-8162-ed871ac87a63\n                - img [aria-hidden] [ref=f2e80]:\n                  - generic [ref=f2e82]: I5\n                - generic [ref=f2e83]:\n                  - generic [ref=f2e84]: Ines Varga\n                  - generic [ref=f2e85]: Letters sealed before they leave\n                - generic [ref=f2e86]: 05:27\n        - generic [ref=f2e88]:\n          - link \"Back to letters\" [ref=f2e89] [cursor=pointer]:\n            - /url: /letters\n          - generic [ref=f2e90]:\n            - heading \"Ines Varga\" [level=2] [ref=f2e91]\n            - generic [ref=f2e92]: Not verified\n            - button \"Contact card\" [ref=f2e93] [cursor=pointer]\n          - list \"Letters\" [ref=f2e94]:\n            - article [ref=f2e95]:\n              - generic [ref=f2e96]:\n                - paragraph [ref=f2e97]: Good morning from the harbour\n                - button \"Letter actions\" [ref=f2e98] [cursor=pointer]\n              - generic [ref=f2e99]:\n                - generic [ref=f2e100]: Read\n                - time [ref=f2e101]: 05:27\n            - article [ref=f2e102]:\n              - generic [ref=f2e103]:\n                - paragraph [ref=f2e104]: The ferry is late\n                - button \"Letter actions\" [ref=f2e105] [cursor=pointer]\n              - generic [ref=f2e106]:\n                - generic [ref=f2e107]: Read\n                - time [ref=f2e108]: 05:27\n          - generic [ref=f2e110]:\n            - textbox \"Write a letter\" [ref=f2e112]\n            - generic [ref=f2e113]:\n              - button \"Attach photo\" [ref=f2e114] [cursor=pointer]\n              - button \"Attach file\" [ref=f2e115] [cursor=pointer]\n              - button \"Send\" [ref=f2e116] [cursor=pointer]\n        - region \"Contact card\" [ref=f2e118]:\n          - img [aria-hidden] [ref=f2e121]:\n            - generic [ref=f2e123]: I5\n          - paragraph [ref=f2e124]: Ines Varga\n          - paragraph [ref=f2e125]: ines_58421\n          - paragraph [ref=f2e126]: Not verified\n          - button \"Show seal number\" [ref=f2e127] [cursor=pointer]\n          - button \"Mute\" [ref=f2e128] [cursor=pointer]\n          - button \"Block\" [ref=f2e129] [cursor=pointer]\n    - navigation \"Main\" [ref=f2e130]:\n      - link \"Chats\" [ref=f2e131] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f2e132] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f2e133] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f2e134]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/letters/4b3582f5-9dda-4a22-8162-ed871ac87a63\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f2e69]:\n  - generic [ref=f2e70]:\n    - status \"Connection\"\n    - main [ref=f2e71]:\n      - generic [ref=f2e72]:\n        - generic [ref=f2e73]:\n          - heading \"Chats\" [level=1] [ref=f2e74]\n          - list \"Conversations\" [ref=f2e75]:\n            - listitem [ref=f2e76]\n        - generic [ref=f2e88]:\n          - link \"Back to letters\" [ref=f2e89] [cursor=pointer]:\n            - /url: /letters\n          - generic [ref=f2e90]:\n            - heading \"Ines Varga\" [level=2] [ref=f2e91]\n            - generic [ref=f2e92]: Not verified\n            - button \"Contact card\" [ref=f2e93] [cursor=pointer]\n          - list \"Letters\" [ref=f2e94]:\n            - article [ref=f2e95]\n            - article [ref=f2e102]\n          - generic [ref=f2e110]:\n            - textbox \"Write a letter\" [ref=f2e112]\n            - generic [ref=f2e113]\n        - region \"Contact card\" [ref=f2e118]:\n          - img [aria-hidden] [ref=f2e121]:\n            - generic [ref=f2e123]: I5\n          - paragraph [ref=f2e124]: Ines Varga\n          - paragraph [ref=f2e125]: ines_58421\n          - paragraph [ref=f2e126]: Not verified\n          - button \"Show seal number\" [ref=f2e127] [cursor=pointer]\n          - button \"Mute\" [ref=f2e128] [cursor=pointer]\n          - button \"Block\" [ref=f2e129] [cursor=pointer]\n    - navigation \"Main\" [ref=f2e130]:\n      - link \"Chats\" [ref=f2e131] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f2e132] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f2e133] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f2e134]\n  - status \"Notifications\""
}
```

### Tool call: browser_type
- Args
```json
{
  "target": "f2e112",
  "text": "I will meet you by the quay",
  "submit": true
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters/4b3582f5-9dda-4a22-8162-ed871ac87a63\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f2e135]:\n  - generic [ref=f2e136]:\n    - status \"Connection\"\n    - main [ref=f2e137]:\n      - generic [ref=f2e138]:\n        - generic [ref=f2e139]:\n          - heading \"Chats\" [level=1] [ref=f2e140]\n          - list \"Conversations\" [ref=f2e141]:\n            - listitem [ref=f2e142]:\n              - link \"Ines Varga\" [ref=f2e143] [cursor=pointer]:\n                - /url: /letters/4b3582f5-9dda-4a22-8162-ed871ac87a63\n                - img [aria-hidden] [ref=f2e146]:\n                  - generic [ref=f2e148]: I5\n                - generic [ref=f2e149]:\n                  - generic [ref=f2e150]: Ines Varga\n                  - generic [ref=f2e151]: I will meet you by the quay\n                - generic [ref=f2e152]: 05:27\n        - generic [ref=f2e154]:\n          - link \"Back to letters\" [ref=f2e155] [cursor=pointer]:\n            - /url: /letters\n          - generic [ref=f2e156]:\n            - heading \"Ines Varga\" [level=2] [ref=f2e157]\n            - generic [ref=f2e158]: Not verified\n            - button \"Contact card\" [ref=f2e159] [cursor=pointer]\n          - list \"Letters\" [ref=f2e160]:\n            - article [ref=f2e161]:\n              - generic [ref=f2e162]:\n                - paragraph [ref=f2e163]: Good morning from the harbour\n                - button \"Letter actions\" [ref=f2e164] [cursor=pointer]\n              - generic [ref=f2e165]:\n                - generic [ref=f2e166]: Read\n                - time [ref=f2e167]: 05:27\n            - article [ref=f2e168]:\n              - generic [ref=f2e169]:\n                - paragraph [ref=f2e170]: The ferry is late\n                - button \"Letter actions\" [ref=f2e171] [cursor=pointer]\n              - generic [ref=f2e172]:\n                - generic [ref=f2e173]: Read\n                - time [ref=f2e174]: 05:27\n            - article [ref=f2e175]:\n              - generic [ref=f2e176]:\n                - paragraph [ref=f2e177]: I will meet you by the quay\n                - button \"Letter actions\" [ref=f2e178] [cursor=pointer]\n              - generic [ref=f2e179]:\n                - generic [ref=f2e180]: Read\n                - time [ref=f2e181]: 05:27\n          - generic [ref=f2e183]:\n            - textbox \"Write a letter\" [active] [ref=f2e185]\n            - generic [ref=f2e186]:\n              - button \"Attach photo\" [ref=f2e187] [cursor=pointer]\n              - button \"Attach file\" [ref=f2e188] [cursor=pointer]\n              - button \"Send\" [ref=f2e189] [cursor=pointer]\n        - region \"Contact card\" [ref=f2e191]:\n          - img [aria-hidden] [ref=f2e194]:\n            - generic [ref=f2e196]: I5\n          - paragraph [ref=f2e197]: Ines Varga\n          - paragraph [ref=f2e198]: ines_58421\n          - paragraph [ref=f2e199]: Not verified\n          - button \"Show seal number\" [ref=f2e200] [cursor=pointer]\n          - button \"Mute\" [ref=f2e201] [cursor=pointer]\n          - button \"Block\" [ref=f2e202] [cursor=pointer]\n    - navigation \"Main\" [ref=f2e203]:\n      - link \"Chats\" [ref=f2e204] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f2e205] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f2e206] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f2e207]\n  - status \"Notifications\""
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/letters"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters\n- Page Title: Airfold",
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
  "page": "- Page URL: http://127.0.0.1:4173/letters\n- Page Title: (2) Airfold",
  "inlineSnapshot": "- generic [ref=f3e3]:\n  - generic [ref=f3e4]:\n    - status \"Connection\"\n    - main [ref=f3e5]:\n      - generic [ref=f3e6]:\n        - generic [ref=f3e7]:\n          - heading \"Chats\" [level=1] [ref=f3e8]\n          - list \"Conversations\" [ref=f3e9]:\n            - listitem [ref=f3e10]\n        - region \"Contact card\" [ref=f3e24]:\n          - img [aria-hidden] [ref=f3e27]:\n            - generic [ref=f3e29]: I5\n          - paragraph [ref=f3e30]: Ines Varga\n          - paragraph [ref=f3e31]: ines_58421\n          - paragraph [ref=f3e32]: Not verified\n          - button \"Show seal number\" [ref=f3e33] [cursor=pointer]\n          - button \"Mute\" [ref=f3e34] [cursor=pointer]\n          - button \"Block\" [ref=f3e35] [cursor=pointer]\n    - navigation \"Main\" [ref=f3e36]:\n      - link \"Chats\" [ref=f3e37] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f3e38] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f3e39] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f3e40]\n  - status \"Notifications\""
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const b=document.querySelector('[data-testid=\"unread-badge\"]'); function bg(e){for(let n=e;n;n=n.parentElement){let c=getComputedStyle(n).backgroundColor;if(c!=='rgba(0, 0, 0, 0)'&&c!=='transparent')return c;}return null} return b?{text:b.textContent,color:getComputedStyle(b).color,background:bg(b),rect:b.getBoundingClientRect().toJSON(),radius:getComputedStyle(b).borderRadius}:null; }"
}
```
- Result
```json
{
  "result": "{\n  \"text\": \"2\",\n  \"color\": \"rgb(232, 84, 30)\",\n  \"background\": \"rgb(28, 27, 41)\",\n  \"rect\": {\n    \"x\": 478,\n    \"y\": 103.9375,\n    \"width\": 24,\n    \"height\": 24,\n    \"top\": 103.9375,\n    \"right\": 502,\n    \"bottom\": 127.9375,\n    \"left\": 478\n  },\n  \"radius\": \"12px\"\n}"
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
  "result": "- [Screenshot of viewport](evidence/reduced/page-2026-11-06T05-27-42-102Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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DAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhggAgAgCQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAANQJIyrAAAOlklEQVQAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMA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",
      "mimeType": "image/png"
    }
  ]
}
```
