
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
  "url": "http://127.0.0.1:4173/"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "snapshot": ""
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
  "depth": 4
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=f1e3]:\n  - generic [ref=f1e4]:\n    - heading \"Choose a username\" [level=1] [ref=f1e5]\n    - paragraph [ref=f1e6]: A username is all Airfold asks for. It can be changed later.\n    - generic [ref=f1e7]:\n      - generic [ref=f1e8]:\n        - generic [ref=f1e9]: Username\n        - textbox \"Username\" [active] [ref=f1e10]\n        - status \"Username availability\" [ref=f1e11]\n      - button \"Continue\" [ref=f1e12] [cursor=pointer]\n  - status \"Letter updates\" [ref=f1e13]\n  - status \"Notifications\"",
  "events": "- New console entries: evidence/reduced/console-2026-11-06T05-39-31-926Z.log#L1"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e10",
      "name": "Username",
      "type": "textbox",
      "value": "oskar_73846"
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
  "target": "f1e12"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e14]:\n  - generic [ref=f1e15]:\n    - heading \"Your recovery code\" [level=1] [ref=f1e16]\n    - paragraph [ref=f1e17]: Write it down. It is the only way to restore your letters on a new browser. Airfold cannot show it again.\n    - group \"Your recovery code\" [ref=f1e18]:\n      - paragraph [ref=f1e19]: 4X17-JTEW-0GF6-854Z-PP1T-MMJ1-J2CH-TSFW\n    - button \"I've written it down\" [active] [ref=f1e21] [cursor=pointer]\n  - status \"Letter updates\" [ref=f1e22]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=f1e14]:\n  - generic [ref=f1e15]:\n    - heading \"Your recovery code\" [level=1] [ref=f1e16]\n    - paragraph [ref=f1e17]: Write it down. It is the only way to restore your letters on a new browser. Airfold cannot show it again.\n    - group \"Your recovery code\" [ref=f1e18]:\n      - paragraph [ref=f1e19]: 4X17-JTEW-0GF6-854Z-PP1T-MMJ1-J2CH-TSFW\n    - button \"I've written it down\" [active] [ref=f1e21] [cursor=pointer]\n  - status \"Letter updates\" [ref=f1e22]\n  - status \"Notifications\""
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "I've written it down",
  "target": "f1e21"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e23]:\n  - generic [ref=f1e25]:\n    - heading \"Your name\" [level=1] [ref=f1e26]\n    - paragraph [ref=f1e27]: A display name and an optional photo, both sealed before they leave this page.\n    - generic [ref=f1e28]:\n      - generic [ref=f1e29]:\n        - generic [ref=f1e30]: Display name\n        - textbox \"Display name\" [active] [ref=f1e31]\n      - button \"Add a photo\" [ref=f1e33] [cursor=pointer]\n      - button \"Finish\" [ref=f1e34] [cursor=pointer]\n  - status \"Letter updates\" [ref=f1e35]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=f1e23]:\n  - generic [ref=f1e25]:\n    - heading \"Your name\" [level=1] [ref=f1e26]\n    - paragraph [ref=f1e27]: A display name and an optional photo, both sealed before they leave this page.\n    - generic [ref=f1e28]:\n      - generic [ref=f1e29]:\n        - generic [ref=f1e30]: Display name\n        - textbox \"Display name\" [active] [ref=f1e31]\n      - button \"Add a photo\" [ref=f1e33] [cursor=pointer]\n      - button \"Finish\" [ref=f1e34] [cursor=pointer]\n  - status \"Letter updates\" [ref=f1e35]\n  - status \"Notifications\""
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Finish",
  "target": "f1e34"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e23]:\n  - generic [ref=f1e25]:\n    - heading \"Your name\" [level=1] [ref=f1e26]\n    - paragraph [ref=f1e27]: A display name and an optional photo, both sealed before they leave this page.\n    - generic [ref=f1e28]:\n      - generic [ref=f1e29]:\n        - generic [ref=f1e30]: Display name\n        - textbox \"Display name\" [active] [ref=f1e31]\n        - alert [ref=f1e36]: Enter a display name.\n      - button \"Add a photo\" [ref=f1e33] [cursor=pointer]\n      - button \"Finish\" [ref=f1e34] [cursor=pointer]\n  - status \"Letter updates\" [ref=f1e35]\n  - status \"Notifications\""
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e31",
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
  "target": "f1e34"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e37]:\n  - generic [ref=f1e38]:\n    - status \"Connection\"\n    - main [ref=f1e39]:\n      - generic [ref=f1e40]:\n        - generic [ref=f1e41]:\n          - heading \"Chats\" [level=1] [ref=f1e42]\n          - list \"Conversations\" [ref=f1e43]:\n            - listitem [ref=f1e44]:\n              - paragraph [ref=f1e46]: No letters yet. Find someone by their exact username.\n        - generic [ref=f1e47]:\n          - heading \"Contact card\" [level=1] [ref=f1e48]\n          - paragraph [ref=f1e50]: No contacts yet.\n    - navigation \"Main\" [ref=f1e51]:\n      - link \"Chats\" [ref=f1e52] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f1e53] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f1e54] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f1e55]\n  - status \"Notifications\""
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
  "depth": 7
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/requests\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f2e3]:\n  - generic [ref=f2e4]:\n    - status \"Connection\"\n    - main [ref=f2e5]:\n      - generic [ref=f2e7]:\n        - heading \"Letter requests\" [level=1] [ref=f2e8]\n        - list \"Letter requests\" [ref=f2e9]:\n          - listitem [ref=f2e10]:\n            - link \"ines_73846\" [ref=f2e11] [cursor=pointer]:\n              - /url: /requests/dafd57fb-fcbf-4b4b-b2b7-592cc121c21c\n              - img [aria-hidden] [ref=f2e13]\n              - generic [ref=f2e16]\n              - generic [ref=f2e19]: 05:40\n    - navigation \"Main\" [ref=f2e21]:\n      - link \"Chats\" [ref=f2e22] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f2e23] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f2e24] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f2e25]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/requests/dafd57fb-fcbf-4b4b-b2b7-592cc121c21c\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f2e26]:\n  - generic [ref=f2e27]:\n    - status \"Connection\"\n    - main [ref=f2e28]:\n      - generic [ref=f2e29]:\n        - generic [ref=f2e30]:\n          - heading \"Letter requests\" [level=1] [ref=f2e31]\n          - list \"Letter requests\" [ref=f2e32]:\n            - listitem [ref=f2e33]:\n              - link \"ines_73846\" [ref=f2e34] [cursor=pointer]:\n                - /url: /requests/dafd57fb-fcbf-4b4b-b2b7-592cc121c21c\n                - img [aria-hidden] [ref=f2e36]:\n                  - generic [ref=f2e38]: I7\n                - generic [ref=f2e39]:\n                  - generic [ref=f2e40]: ines_73846\n                  - generic [ref=f2e41]: The ferry is late\n                - generic [ref=f2e42]: 05:40\n        - region \"Letter request\" [ref=f2e45]:\n          - heading \"ines_73846\" [level=2] [ref=f2e46]\n          - list \"Letters\" [ref=f2e47]:\n            - article [ref=f2e48]:\n              - paragraph [ref=f2e50]: Good morning from the harbour\n              - generic [ref=f2e51]:\n                - generic [ref=f2e52]: Delivered\n                - time [ref=f2e53]: 05:40\n            - article [ref=f2e54]:\n              - paragraph [ref=f2e56]: The ferry is late\n              - generic [ref=f2e57]:\n                - generic [ref=f2e58]: Delivered\n                - time [ref=f2e59]: 05:40\n          - generic [ref=f2e60]:\n            - button \"Accept\" [ref=f2e61] [cursor=pointer]\n            - button \"Delete\" [ref=f2e62] [cursor=pointer]\n            - button \"Block\" [ref=f2e63] [cursor=pointer]\n    - navigation \"Main\" [ref=f2e64]:\n      - link \"Chats\" [ref=f2e65] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f2e66] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f2e67] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f2e68]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/requests/dafd57fb-fcbf-4b4b-b2b7-592cc121c21c\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f2e26]:\n  - generic [ref=f2e27]:\n    - status \"Connection\"\n    - main [ref=f2e28]:\n      - generic [ref=f2e29]:\n        - generic [ref=f2e30]:\n          - heading \"Letter requests\" [level=1] [ref=f2e31]\n          - list \"Letter requests\" [ref=f2e32]:\n            - listitem [ref=f2e33]:\n              - link \"ines_73846\" [ref=f2e34] [cursor=pointer]:\n                - /url: /requests/dafd57fb-fcbf-4b4b-b2b7-592cc121c21c\n        - region \"Letter request\" [ref=f2e45]:\n          - heading \"ines_73846\" [level=2] [ref=f2e46]\n          - list \"Letters\" [ref=f2e47]:\n            - article [ref=f2e48]:\n              - paragraph [ref=f2e50]: Good morning from the harbour\n              - generic [ref=f2e51]\n            - article [ref=f2e54]:\n              - paragraph [ref=f2e56]: The ferry is late\n              - generic [ref=f2e57]\n          - generic [ref=f2e60]:\n            - button \"Accept\" [ref=f2e61] [cursor=pointer]\n            - button \"Delete\" [ref=f2e62] [cursor=pointer]\n            - button \"Block\" [ref=f2e63] [cursor=pointer]\n    - navigation \"Main\" [ref=f2e64]:\n      - link \"Chats\" [ref=f2e65] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f2e66] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f2e67] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f2e68]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/letters/dafd57fb-fcbf-4b4b-b2b7-592cc121c21c\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f2e69]:\n  - generic [ref=f2e70]:\n    - status \"Connection\"\n    - main [ref=f2e71]:\n      - generic [ref=f2e72]:\n        - generic [ref=f2e73]:\n          - heading \"Chats\" [level=1] [ref=f2e74]\n          - list \"Conversations\" [ref=f2e75]:\n            - listitem [ref=f2e76]:\n              - link \"Ines Varga\" [ref=f2e77] [cursor=pointer]:\n                - /url: /letters/dafd57fb-fcbf-4b4b-b2b7-592cc121c21c\n                - img [aria-hidden] [ref=f2e80]:\n                  - generic [ref=f2e82]: I7\n                - generic [ref=f2e83]:\n                  - generic [ref=f2e84]: Ines Varga\n                  - generic [ref=f2e85]: Letters sealed before they leave\n                - generic [ref=f2e86]: 05:40\n        - generic [ref=f2e88]:\n          - link \"Back to letters\" [ref=f2e89] [cursor=pointer]:\n            - /url: /letters\n          - generic [ref=f2e90]:\n            - heading \"Ines Varga\" [level=2] [ref=f2e91]\n            - generic [ref=f2e92]: Not verified\n            - button \"Contact card\" [ref=f2e93] [cursor=pointer]\n          - list \"Letters\" [ref=f2e94]:\n            - article [ref=f2e95]:\n              - generic [ref=f2e96]:\n                - paragraph [ref=f2e97]: Good morning from the harbour\n                - button \"Letter actions\" [ref=f2e98] [cursor=pointer]\n              - generic [ref=f2e99]:\n                - generic [ref=f2e100]: Read\n                - time [ref=f2e101]: 05:40\n            - article [ref=f2e102]:\n              - generic [ref=f2e103]:\n                - paragraph [ref=f2e104]: The ferry is late\n                - button \"Letter actions\" [ref=f2e105] [cursor=pointer]\n              - generic [ref=f2e106]:\n                - generic [ref=f2e107]: Read\n                - time [ref=f2e108]: 05:40\n          - generic [ref=f2e110]:\n            - textbox \"Write a letter\" [ref=f2e112]\n            - generic [ref=f2e113]:\n              - button \"Attach photo\" [ref=f2e114] [cursor=pointer]\n              - button \"Attach file\" [ref=f2e115] [cursor=pointer]\n              - button \"Send\" [ref=f2e116] [cursor=pointer]\n        - region \"Contact card\" [ref=f2e118]:\n          - img [aria-hidden] [ref=f2e121]:\n            - generic [ref=f2e123]: I7\n          - paragraph [ref=f2e124]: Ines Varga\n          - paragraph [ref=f2e125]: ines_73846\n          - paragraph [ref=f2e126]: Not verified\n          - button \"Show seal number\" [ref=f2e127] [cursor=pointer]\n          - button \"Mute\" [ref=f2e128] [cursor=pointer]\n          - button \"Block\" [ref=f2e129] [cursor=pointer]\n    - navigation \"Main\" [ref=f2e130]:\n      - link \"Chats\" [ref=f2e131] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f2e132] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f2e133] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f2e134]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/letters/dafd57fb-fcbf-4b4b-b2b7-592cc121c21c\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f2e69]:\n  - generic [ref=f2e70]:\n    - status \"Connection\"\n    - main [ref=f2e71]:\n      - generic [ref=f2e72]:\n        - generic [ref=f2e73]:\n          - heading \"Chats\" [level=1] [ref=f2e74]\n          - list \"Conversations\" [ref=f2e75]:\n            - listitem [ref=f2e76]\n        - generic [ref=f2e88]:\n          - link \"Back to letters\" [ref=f2e89] [cursor=pointer]:\n            - /url: /letters\n          - generic [ref=f2e90]:\n            - heading \"Ines Varga\" [level=2] [ref=f2e91]\n            - generic [ref=f2e92]: Not verified\n            - button \"Contact card\" [ref=f2e93] [cursor=pointer]\n          - list \"Letters\" [ref=f2e94]:\n            - article [ref=f2e95]\n            - article [ref=f2e102]\n          - generic [ref=f2e110]:\n            - textbox \"Write a letter\" [ref=f2e112]\n            - generic [ref=f2e113]\n        - region \"Contact card\" [ref=f2e118]:\n          - img [aria-hidden] [ref=f2e121]:\n            - generic [ref=f2e123]: I7\n          - paragraph [ref=f2e124]: Ines Varga\n          - paragraph [ref=f2e125]: ines_73846\n          - paragraph [ref=f2e126]: Not verified\n          - button \"Show seal number\" [ref=f2e127] [cursor=pointer]\n          - button \"Mute\" [ref=f2e128] [cursor=pointer]\n          - button \"Block\" [ref=f2e129] [cursor=pointer]\n    - navigation \"Main\" [ref=f2e130]:\n      - link \"Chats\" [ref=f2e131] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f2e132] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f2e133] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f2e134]\n  - status \"Notifications\""
}
```

### Tool call: browser_type
- Args
```json
{
  "target": "f2e112",
  "text": "I will wait by the quay",
  "submit": true
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters/dafd57fb-fcbf-4b4b-b2b7-592cc121c21c\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f2e135]:\n  - generic [ref=f2e136]:\n    - status \"Connection\"\n    - main [ref=f2e137]:\n      - generic [ref=f2e138]:\n        - generic [ref=f2e139]:\n          - heading \"Chats\" [level=1] [ref=f2e140]\n          - list \"Conversations\" [ref=f2e141]:\n            - listitem [ref=f2e142]:\n              - link \"Ines Varga\" [ref=f2e143] [cursor=pointer]:\n                - /url: /letters/dafd57fb-fcbf-4b4b-b2b7-592cc121c21c\n                - img [aria-hidden] [ref=f2e146]:\n                  - generic [ref=f2e148]: I7\n                - generic [ref=f2e149]:\n                  - generic [ref=f2e150]: Ines Varga\n                  - generic [ref=f2e151]: I will wait by the quay\n                - generic [ref=f2e152]: 05:41\n        - generic [ref=f2e154]:\n          - link \"Back to letters\" [ref=f2e155] [cursor=pointer]:\n            - /url: /letters\n          - generic [ref=f2e156]:\n            - heading \"Ines Varga\" [level=2] [ref=f2e157]\n            - generic [ref=f2e158]: Not verified\n            - button \"Contact card\" [ref=f2e159] [cursor=pointer]\n          - list \"Letters\" [ref=f2e160]:\n            - article [ref=f2e161]:\n              - generic [ref=f2e162]:\n                - paragraph [ref=f2e163]: Good morning from the harbour\n                - button \"Letter actions\" [ref=f2e164] [cursor=pointer]\n              - generic [ref=f2e165]:\n                - generic [ref=f2e166]: Read\n                - time [ref=f2e167]: 05:40\n            - article [ref=f2e168]:\n              - generic [ref=f2e169]:\n                - paragraph [ref=f2e170]: The ferry is late\n                - button \"Letter actions\" [ref=f2e171] [cursor=pointer]\n              - generic [ref=f2e172]:\n                - generic [ref=f2e173]: Read\n                - time [ref=f2e174]: 05:40\n            - article [ref=f2e175]:\n              - generic [ref=f2e176]:\n                - paragraph [ref=f2e177]: I will wait by the quay\n                - button \"Letter actions\" [ref=f2e178] [cursor=pointer]\n              - generic [ref=f2e179]:\n                - generic [ref=f2e180]: Read\n                - time [ref=f2e181]: 05:41\n          - generic [ref=f2e183]:\n            - textbox \"Write a letter\" [active] [ref=f2e185]\n            - generic [ref=f2e186]:\n              - button \"Attach photo\" [ref=f2e187] [cursor=pointer]\n              - button \"Attach file\" [ref=f2e188] [cursor=pointer]\n              - button \"Send\" [ref=f2e189] [cursor=pointer]\n        - region \"Contact card\" [ref=f2e191]:\n          - img [aria-hidden] [ref=f2e194]:\n            - generic [ref=f2e196]: I7\n          - paragraph [ref=f2e197]: Ines Varga\n          - paragraph [ref=f2e198]: ines_73846\n          - paragraph [ref=f2e199]: Not verified\n          - button \"Show seal number\" [ref=f2e200] [cursor=pointer]\n          - button \"Mute\" [ref=f2e201] [cursor=pointer]\n          - button \"Block\" [ref=f2e202] [cursor=pointer]\n    - navigation \"Main\" [ref=f2e203]:\n      - link \"Chats\" [ref=f2e204] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f2e205] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f2e206] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f2e207]\n  - status \"Notifications\""
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
  "depth": 7,
  "boxes": true
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters\n- Page Title: (2) Airfold",
  "inlineSnapshot": "- generic [ref=f3e3] [box=0,0,1280,800]:\n  - generic [ref=f3e4] [box=0,0,1280,800]:\n    - status \"Connection\" [box=0,0,1280,0]\n    - main [ref=f3e5] [box=0,0,1280,756]:\n      - generic [ref=f3e6] [box=20,20,1240,416]:\n        - generic [ref=f3e7] [box=20,20,496,122]:\n          - heading \"Chats\" [level=1] [ref=f3e8] [box=20,20,496,36]\n          - list \"Conversations\" [ref=f3e9] [box=20,68,496,74]:\n            - listitem [ref=f3e10] [box=20,68,496,74]:\n              - link \"Ines Varga\" [ref=f3e11] [cursor=pointer] [box=20,68,496,74]:\n                - /url: /letters/dafd57fb-fcbf-4b4b-b2b7-592cc121c21c\n        - region \"Contact card\" [ref=f3e24] [box=532,28,280,408]:\n          - img [aria-hidden] [ref=f3e27] [box=560,54,64,64]:\n            - generic [ref=f3e29] [box=580,69,24,32]: I7\n          - paragraph [ref=f3e30] [box=560,126,67,18]: Ines Varga\n          - paragraph [ref=f3e31] [box=560,152,74,18]: ines_73846\n          - paragraph [ref=f3e32] [box=560,178,70,17]: Not verified\n          - button \"Show seal number\" [ref=f3e33] [cursor=pointer] [box=560,214,154,44]\n          - button \"Mute\" [ref=f3e34] [cursor=pointer] [box=560,266,70,44]\n          - button \"Block\" [ref=f3e35] [cursor=pointer] [box=560,318,74,44]\n    - navigation \"Main\" [ref=f3e36] [box=0,756,1280,44]:\n      - link \"Chats\" [ref=f3e37] [cursor=pointer] [box=0,756,427,44]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f3e38] [cursor=pointer] [box=427,756,427,44]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f3e39] [cursor=pointer] [box=853,756,427,44]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f3e40] [box=-1,799,1,1]\n  - status \"Notifications\" [box=1264,724,0,0]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const e=document.querySelector('.unread-badge'); if(!e)return null; let n=e,bg=null; while(n){const c=getComputedStyle(n).backgroundColor; const m=c.match(/rgba?\\(([^)]+)\\)/); if(m){const p=m[1].split(',').map(Number);if(p.length===3||p[3]>0){bg=c;break}}n=n.parentElement;} return {text:e.textContent,color:getComputedStyle(e).color,bg,rect:e.getBoundingClientRect().toJSON(),radius:getComputedStyle(e).borderRadius};}"
}
```
- Result
```json
{
  "result": "{\n  \"text\": \"2\",\n  \"color\": \"rgb(232, 84, 30)\",\n  \"bg\": \"rgb(28, 27, 41)\",\n  \"rect\": {\n    \"x\": 478,\n    \"y\": 103.9375,\n    \"width\": 24,\n    \"height\": 24,\n    \"top\": 103.9375,\n    \"right\": 502,\n    \"bottom\": 127.9375,\n    \"left\": 478\n  },\n  \"radius\": \"12px\"\n}"
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
  "result": "- [Screenshot of viewport](evidence/reduced/page-2026-11-06T05-41-51-637Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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AIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAAQCIIYAAAABJBAAMAAJAIAhgAAIBEEMAAAAAkggAGAAAgEQQwAAAAiSCAAQAASAQBDAAA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",
      "mimeType": "image/png"
    }
  ]
}
```
