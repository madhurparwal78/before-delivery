
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
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Choose a username\" [level=1] [ref=e5]\n    - paragraph [ref=e6]: A username is all Airfold asks for. It can be changed later.\n    - generic [ref=e7]:\n      - generic [ref=e8]\n      - button \"Continue\" [ref=e12] [cursor=pointer]\n  - status \"Letter updates\" [ref=e13]\n  - status \"Notifications\"",
  "events": "- New console entries: evidence/reduced/console-2026-11-06T05-31-43-775Z.log#L1"
}
```

### Tool call: browser_type
- Args
```json
{
  "target": "e10",
  "text": "oskar_48317"
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
  "snapshot": "- generic [ref=e14]:\n  - generic [ref=e15]:\n    - heading \"Your recovery code\" [level=1] [ref=e16]\n    - paragraph [ref=e17]: Write it down. It is the only way to restore your letters on a new browser. Airfold cannot show it again.\n    - group \"Your recovery code\" [ref=e18]:\n      - paragraph [ref=e19]: 98WF-7E19-G5BB-CC6M-MB0T-0ZHP-CRTW-BVRX\n    - button \"I've written it down\" [active] [ref=e21] [cursor=pointer]\n  - status \"Letter updates\" [ref=e22]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e14]:\n  - generic [ref=e15]:\n    - heading \"Your recovery code\" [level=1] [ref=e16]\n    - paragraph [ref=e17]: Write it down. It is the only way to restore your letters on a new browser. Airfold cannot show it again.\n    - group \"Your recovery code\" [ref=e18]:\n      - paragraph [ref=e19]: 98WF-7E19-G5BB-CC6M-MB0T-0ZHP-CRTW-BVRX\n    - button \"I've written it down\" [active] [ref=e21] [cursor=pointer]\n  - status \"Letter updates\" [ref=e22]\n  - status \"Notifications\""
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
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e23]:\n  - generic [ref=e25]:\n    - heading \"Your name\" [level=1] [ref=e26]\n    - paragraph [ref=e27]: A display name and an optional photo, both sealed before they leave this page.\n    - generic [ref=e28]:\n      - generic [ref=e29]\n      - button \"Add a photo\" [ref=e33] [cursor=pointer]\n      - button \"Finish\" [ref=e34] [cursor=pointer]\n  - status \"Letter updates\" [ref=e35]\n  - status \"Notifications\""
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

### Tool call: browser_type
- Args
```json
{
  "target": "e31",
  "text": "Oskar Lind"
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
  "depth": 5
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/requests\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f1e3]:\n  - generic [ref=f1e4]:\n    - status \"Connection\"\n    - main [ref=f1e5]:\n      - generic [ref=f1e7]:\n        - heading \"Letter requests\" [level=1] [ref=f1e8]\n        - list \"Letter requests\" [ref=f1e9]:\n          - listitem [ref=f1e10]\n    - navigation \"Main\" [ref=f1e21]:\n      - link \"Chats\" [ref=f1e22] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f1e23] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f1e24] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f1e25]\n  - status \"Notifications\""
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "f1e10",
  "depth": 4
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/requests\n- Page Title: Airfold",
  "inlineSnapshot": "- listitem [ref=f1e10]:\n  - link \"ines_48317\" [ref=f1e11] [cursor=pointer]:\n    - /url: /requests/62e6501f-a718-4d8b-8b16-31e780245183\n    - img [aria-hidden] [ref=f1e13]:\n      - generic [ref=f1e15]: I4\n    - generic [ref=f1e16]:\n      - generic [ref=f1e17]: ines_48317\n      - generic [ref=f1e18]: Letters sealed before they leave\n    - generic [ref=f1e19]: 05:32"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "request row",
  "target": "f1e11"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/requests/62e6501f-a718-4d8b-8b16-31e780245183\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f1e26]:\n  - generic [ref=f1e27]:\n    - status \"Connection\"\n    - main [ref=f1e28]:\n      - generic [ref=f1e29]:\n        - generic [ref=f1e30]:\n          - heading \"Letter requests\" [level=1] [ref=f1e31]\n          - list \"Letter requests\" [ref=f1e32]:\n            - listitem [ref=f1e33]:\n              - link \"ines_48317\" [ref=f1e34] [cursor=pointer]:\n                - /url: /requests/62e6501f-a718-4d8b-8b16-31e780245183\n                - img [aria-hidden] [ref=f1e36]:\n                  - generic [ref=f1e38]: I4\n                - generic [ref=f1e39]:\n                  - generic [ref=f1e40]: ines_48317\n                  - generic [ref=f1e41]: The ferry is late\n                - generic [ref=f1e42]: 05:32\n        - region \"Letter request\" [ref=f1e45]:\n          - heading \"ines_48317\" [level=2] [ref=f1e46]\n          - list \"Letters\" [ref=f1e47]:\n            - article [ref=f1e48]:\n              - paragraph [ref=f1e50]: Good morning from the harbour\n              - generic [ref=f1e51]:\n                - generic [ref=f1e52]: Delivered\n                - time [ref=f1e53]: 05:32\n            - article [ref=f1e54]:\n              - paragraph [ref=f1e56]: The ferry is late\n              - generic [ref=f1e57]:\n                - generic [ref=f1e58]: Delivered\n                - time [ref=f1e59]: 05:32\n          - generic [ref=f1e60]:\n            - button \"Accept\" [ref=f1e61] [cursor=pointer]\n            - button \"Delete\" [ref=f1e62] [cursor=pointer]\n            - button \"Block\" [ref=f1e63] [cursor=pointer]\n    - navigation \"Main\" [ref=f1e64]:\n      - link \"Chats\" [ref=f1e65] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f1e66] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f1e67] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f1e68]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/requests/62e6501f-a718-4d8b-8b16-31e780245183\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f1e26]:\n  - generic [ref=f1e27]:\n    - status \"Connection\"\n    - main [ref=f1e28]:\n      - generic [ref=f1e29]:\n        - generic [ref=f1e30]:\n          - heading \"Letter requests\" [level=1] [ref=f1e31]\n          - list \"Letter requests\" [ref=f1e32]\n        - region \"Letter request\" [ref=f1e45]:\n          - heading \"ines_48317\" [level=2] [ref=f1e46]\n          - list \"Letters\" [ref=f1e47]\n          - generic [ref=f1e60]\n    - navigation \"Main\" [ref=f1e64]:\n      - link \"Chats\" [ref=f1e65] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f1e66] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f1e67] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f1e68]\n  - status \"Notifications\""
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "f1e60",
  "depth": 2
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/requests/62e6501f-a718-4d8b-8b16-31e780245183\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f1e60]:\n  - button \"Accept\" [ref=f1e61] [cursor=pointer]\n  - button \"Delete\" [ref=f1e62] [cursor=pointer]\n  - button \"Block\" [ref=f1e63] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Accept",
  "target": "f1e61"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters/62e6501f-a718-4d8b-8b16-31e780245183\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f1e69]:\n  - generic [ref=f1e70]:\n    - status \"Connection\"\n    - main [ref=f1e71]:\n      - generic [ref=f1e72]:\n        - generic [ref=f1e73]:\n          - heading \"Chats\" [level=1] [ref=f1e74]\n          - list \"Conversations\" [ref=f1e75]:\n            - listitem [ref=f1e76]:\n              - link \"Ines Varga\" [ref=f1e77] [cursor=pointer]:\n                - /url: /letters/62e6501f-a718-4d8b-8b16-31e780245183\n                - img [aria-hidden] [ref=f1e80]:\n                  - generic [ref=f1e82]: I4\n                - generic [ref=f1e83]:\n                  - generic [ref=f1e84]: Ines Varga\n                  - generic [ref=f1e85]: Letters sealed before they leave\n                - generic [ref=f1e86]: 05:33\n        - generic [ref=f1e88]:\n          - link \"Back to letters\" [ref=f1e89] [cursor=pointer]:\n            - /url: /letters\n          - generic [ref=f1e90]:\n            - heading \"Ines Varga\" [level=2] [ref=f1e91]\n            - generic [ref=f1e92]: Not verified\n            - button \"Contact card\" [ref=f1e93] [cursor=pointer]\n          - list \"Letters\" [ref=f1e94]:\n            - article [ref=f1e95]:\n              - generic [ref=f1e96]:\n                - paragraph [ref=f1e97]: Good morning from the harbour\n                - button \"Letter actions\" [ref=f1e98] [cursor=pointer]\n              - generic [ref=f1e99]:\n                - generic [ref=f1e100]: Read\n                - time [ref=f1e101]: 05:33\n            - article [ref=f1e102]:\n              - generic [ref=f1e103]:\n                - paragraph [ref=f1e104]: The ferry is late\n                - button \"Letter actions\" [ref=f1e105] [cursor=pointer]\n              - generic [ref=f1e106]:\n                - generic [ref=f1e107]: Read\n                - time [ref=f1e108]: 05:33\n          - generic [ref=f1e110]:\n            - textbox \"Write a letter\" [ref=f1e112]\n            - generic [ref=f1e113]:\n              - button \"Attach photo\" [ref=f1e114] [cursor=pointer]\n              - button \"Attach file\" [ref=f1e115] [cursor=pointer]\n              - button \"Send\" [ref=f1e116] [cursor=pointer]\n        - region \"Contact card\" [ref=f1e118]:\n          - img [aria-hidden] [ref=f1e121]:\n            - generic [ref=f1e123]: I4\n          - paragraph [ref=f1e124]: Ines Varga\n          - paragraph [ref=f1e125]: ines_48317\n          - paragraph [ref=f1e126]: Not verified\n          - button \"Show seal number\" [ref=f1e127] [cursor=pointer]\n          - button \"Mute\" [ref=f1e128] [cursor=pointer]\n          - button \"Block\" [ref=f1e129] [cursor=pointer]\n    - navigation \"Main\" [ref=f1e130]:\n      - link \"Chats\" [ref=f1e131] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f1e132] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f1e133] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f1e134]\n  - status \"Notifications\""
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
  "page": "- Page URL: http://127.0.0.1:4173/letters/62e6501f-a718-4d8b-8b16-31e780245183\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f1e69]:\n  - generic [ref=f1e70]:\n    - status \"Connection\"\n    - main [ref=f1e71]:\n      - generic [ref=f1e72]:\n        - generic [ref=f1e73]:\n          - heading \"Chats\" [level=1] [ref=f1e74]\n          - list \"Conversations\" [ref=f1e75]\n        - generic [ref=f1e88]:\n          - link \"Back to letters\" [ref=f1e89] [cursor=pointer]:\n            - /url: /letters\n          - generic [ref=f1e90]\n          - list \"Letters\" [ref=f1e94]\n          - generic [ref=f1e110]\n        - region \"Contact card\" [ref=f1e118]:\n          - img [aria-hidden] [ref=f1e121]\n          - paragraph [ref=f1e124]: Ines Varga\n          - paragraph [ref=f1e125]: ines_48317\n          - paragraph [ref=f1e126]: Not verified\n          - button \"Show seal number\" [ref=f1e127] [cursor=pointer]\n          - button \"Mute\" [ref=f1e128] [cursor=pointer]\n          - button \"Block\" [ref=f1e129] [cursor=pointer]\n    - navigation \"Main\" [ref=f1e130]:\n      - link \"Chats\" [ref=f1e131] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f1e132] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f1e133] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f1e134]\n  - status \"Notifications\""
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "f1e110",
  "depth": 2
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters/62e6501f-a718-4d8b-8b16-31e780245183\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f1e110]:\n  - textbox \"Write a letter\" [ref=f1e112]\n  - generic [ref=f1e113]:\n    - button \"Attach photo\" [ref=f1e114] [cursor=pointer]\n    - button \"Attach file\" [ref=f1e115] [cursor=pointer]\n    - button \"Send\" [ref=f1e116] [cursor=pointer]"
}
```

### Tool call: browser_type
- Args
```json
{
  "target": "f1e112",
  "text": "I will wait by the pier",
  "submit": true
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters/62e6501f-a718-4d8b-8b16-31e780245183\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f1e135]:\n  - generic [ref=f1e136]:\n    - status \"Connection\"\n    - main [ref=f1e137]:\n      - generic [ref=f1e138]:\n        - generic [ref=f1e139]:\n          - heading \"Chats\" [level=1] [ref=f1e140]\n          - list \"Conversations\" [ref=f1e141]:\n            - listitem [ref=f1e142]:\n              - link \"Ines Varga\" [ref=f1e143] [cursor=pointer]:\n                - /url: /letters/62e6501f-a718-4d8b-8b16-31e780245183\n                - img [aria-hidden] [ref=f1e146]:\n                  - generic [ref=f1e148]: I4\n                - generic [ref=f1e149]:\n                  - generic [ref=f1e150]: Ines Varga\n                  - generic [ref=f1e151]: I will wait by the pier\n                - generic [ref=f1e152]: 05:33\n        - generic [ref=f1e154]:\n          - link \"Back to letters\" [ref=f1e155] [cursor=pointer]:\n            - /url: /letters\n          - generic [ref=f1e156]:\n            - heading \"Ines Varga\" [level=2] [ref=f1e157]\n            - generic [ref=f1e158]: Not verified\n            - button \"Contact card\" [ref=f1e159] [cursor=pointer]\n          - list \"Letters\" [ref=f1e160]:\n            - article [ref=f1e161]:\n              - generic [ref=f1e162]:\n                - paragraph [ref=f1e163]: Good morning from the harbour\n                - button \"Letter actions\" [ref=f1e164] [cursor=pointer]\n              - generic [ref=f1e165]:\n                - generic [ref=f1e166]: Read\n                - time [ref=f1e167]: 05:33\n            - article [ref=f1e168]:\n              - generic [ref=f1e169]:\n                - paragraph [ref=f1e170]: The ferry is late\n                - button \"Letter actions\" [ref=f1e171] [cursor=pointer]\n              - generic [ref=f1e172]:\n                - generic [ref=f1e173]: Read\n                - time [ref=f1e174]: 05:33\n            - article [ref=f1e175]:\n              - generic [ref=f1e176]:\n                - paragraph [ref=f1e177]: I will wait by the pier\n                - button \"Letter actions\" [ref=f1e178] [cursor=pointer]\n              - generic [ref=f1e179]:\n                - generic [ref=f1e180]: Read\n                - time [ref=f1e181]: 05:33\n          - generic [ref=f1e183]:\n            - textbox \"Write a letter\" [active] [ref=f1e185]\n            - generic [ref=f1e186]:\n              - button \"Attach photo\" [ref=f1e187] [cursor=pointer]\n              - button \"Attach file\" [ref=f1e188] [cursor=pointer]\n              - button \"Send\" [ref=f1e189] [cursor=pointer]\n        - region \"Contact card\" [ref=f1e191]:\n          - img [aria-hidden] [ref=f1e194]:\n            - generic [ref=f1e196]: I4\n          - paragraph [ref=f1e197]: Ines Varga\n          - paragraph [ref=f1e198]: ines_48317\n          - paragraph [ref=f1e199]: Not verified\n          - button \"Show seal number\" [ref=f1e200] [cursor=pointer]\n          - button \"Mute\" [ref=f1e201] [cursor=pointer]\n          - button \"Block\" [ref=f1e202] [cursor=pointer]\n    - navigation \"Main\" [ref=f1e203]:\n      - link \"Chats\" [ref=f1e204] [cursor=pointer]:\n        - /url: /letters\n      - link \"Contacts\" [ref=f1e205] [cursor=pointer]:\n        - /url: /contacts\n      - link \"Settings\" [ref=f1e206] [cursor=pointer]:\n        - /url: /settings\n  - status \"Letter updates\" [ref=f1e207]\n  - status \"Notifications\""
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

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const e=document.querySelector('[data-testid=\"unread-badge\"]'); let n=e,bg=null; while(n){const c=getComputedStyle(n).backgroundColor;if(c!=='rgba(0, 0, 0, 0)'&&c!=='transparent'){bg=c;break;}n=n.parentElement;}return e?{text:e.textContent,color:getComputedStyle(e).color,bg,rect:e.getBoundingClientRect().toJSON()}:null;}"
}
```
- Result
```json
{
  "result": "{\n  \"text\": \"2\",\n  \"color\": \"rgb(232, 84, 30)\",\n  \"bg\": \"rgb(28, 27, 41)\",\n  \"rect\": {\n    \"x\": 478,\n    \"y\": 103.9375,\n    \"width\": 24,\n    \"height\": 24,\n    \"top\": 103.9375,\n    \"right\": 502,\n    \"bottom\": 127.9375,\n    \"left\": 478\n  }\n}",
  "page": "- Page URL: http://127.0.0.1:4173/letters\n- Page Title: (2) Airfold"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/reduced/page-2026-11-06T05-34-19-386Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "iVBORw0KGgoAAAANSUhEUgAABQAAAAMgCAIAAADz+lisAAAQAElEQVR4nOzdB3ycd3348eemtveO7ezlLDIgJCEhEEgoSQgkYYZRoGzKaAtt/xQIbRmFMls2lFXCClASQhYkgRAyyd7DI97blmTpdPP/k2Ucx7Gdx9bdSfbzflcv93T66tEj45zuo99zz5Nddv7sCAAAAPZ06QgAAAASQAADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASIRuNtNfdsPLqpf1b3vPHM6Yf0JWLAAAAoH7qH8APd5f+sKJwx5riYz2l5YXKqoHquHw6vI3PpWd1ZA8blztyXP6o8fmu3KbF5y8eN/Grj3T/14PdEQAAADRMPQP4xpUD/3HfuptWDWx558z27KyOzMpC9f71pVtWD/z88cE7j5vY8uvnTR0amNCSft7UVgEMAABAQ9UtgH8wt/ef71hTrm169xnj8x85ctwR455Y6Q2uW174+sPd1y4vlKu1CAAAAJqoPifBunxJ/wduf6J+33pg16XPm3ri5NYt6zc4dWrrj06eMmdsrjJC/fvbpf3TLn48vP32ya86BgAAYI9XhwBePVB9362rN7+7T2f2o0eOz6VT25vfpzNXGokV4GK1duHd6yIAAAASqQ4B/PVHuteXqpvf/ev9ujKpHc3v05Et77B/06kdfv6u+trDPY/2lCIAAAASqQ6vAf7x/A2bb3fl0q/dr2PH8x85clx428FAWyY1r7f888c3/GF54dHewWQ9dEz+bw8Zc+rU1i3H5veWv/ZI96K+ysPdpcc3lMM9LZnUjLbMrPbsy2a3nz+7Y/Mq9AdvX3Pb6oH71z9Rv6+9YeXQje+eOPlFM9rCjbAm/f25vb94fMO8DeVCpTarPbNXezZs7fX7dx42Nh8BAACwmxtuAC/cUF5RqGx+94hx+c7scFeVv/DA+u/N7d3ynhtWFsLbladNO2r8Ey26sK/83ccGxw4ck3v1Pp0tmejKJf2hnMPbH1YUfrWw74fPmTK0Fh1SeatXI4f9HJ8fvGfoz1C8IYn/uKIQdj5k9qyO7P3ri9ctL5SqtWdNahHAAEBdFKpRa31OwALArhhuAD/aW97y3c5sHY5eXtxf+cgR4w4Yk/v1or6fLnhiefnrj/R85VkTtxr+wUmTXzi9bej2Px5WPfSSRUO3Q77+eH7vBft2hts/PWVKCPVnXr5k82f942FjX/CXzwouvHttqN9w46oXTNuvc9Pfya2rB86+dnkEAFAnoX7v7013ZWuzWl0RA2AEDDeAV22x/BuMydXht5oXHjnugK5cuHH69LYFG8o3/+XCwvesK245NjaXPm92xwu36NiwnBuWiO9au2nszrXFC/aN4vjt0sH6Taeime2ZzXc+c2LLsRNaIgB2XtvzX1Gad1954cNRuXTcjR0xP+u2EzbEnBzZbUa7z66O7DajZH77mVx29kG5fQ/rv+an2/z4tJbareszSwq1QzurY7IyGKCphturW57+KujM1fn8Vc/d4nW/S/ueFNtHjs9/+SkLwrM6nkj6Zf2VKIZKLVrUN7iOXa1FH7h9zaqBJz7rsudPDY0dARBb7qCjh576l+fdp37Vb8zJPerbr5TCP/7DPn7Zm3qPWz772Kd+fEKuNjZbW1dO3bQuvWygISf+BGB7hhvA+Sdf7mhtsRrV1ZZLypVaQ35LmklFB4/JDd3+yfwNR1+25FXXr/juY73dpTp/LwCJUCqGtd+hm+o35qT6jTm5e23z7nse+Kf7t923U/KDT2lqUequnowGBmim4R4CPXQSqc22WqRtqBCoF83b8HBPadGG8sK+8sIN5fKuBvLL9+7493s2XSK4VK1dt7wQ3i68e+1Hjhj3pgO6IgDiaXv+KzYf9ql+Y06q35iTu+M277nngYvfeMH5D/5wq5lxuSeestzdk27POBYaoEmGG8Cb106HLOlvUgCvK1bPvHbZYz2bTsH10lntH5gzdlpb5rP3d9+wshDtpDfu33X9isLvlz/pEwuV2v+7c21bNvXqfTojAGKw9ruzm1W/MSd3321edttD5z/leURn5oncDevAD/Smjx/XvCUEgCQb7iHQB43JzWx/oqIX9ZXDCuqOP2VxX/lzD6xfWRjWA/1/P9S9uX5PntL6teMnnTu748TJreNbduU76simLnrOlM8fN+HoCVtf8ejf7lnX41hogHgqCx+O1K/6rfdmd+ttPvTQo0+9c6tzhq4rpxYWHAgN0Ax1OGnzq/Z50sP95Uv6dzx/y+rip+9bv2Z4rxa+YouvcuLkOpyrOZOKwkrv5c+fduOLZlx45Pixf/nRtGageufaYgRADDVnvVK/9d7s7r7NYrH01DufGrsL+l0dGKAZ6vBo+/aDuia3PnH1oM/cv37Hi8Dzewd/EmRTw/pN59L+J64/PC4/rO+iUote8YcVm09nvW9nNnxHV542bfM3td4KMEA86jfmpPqNOblH/ovapg2V1OqSRWCAhqtDAHdm0984flLuL6eDfqS79OG71la2k8Dh7nvXDQbwMC8YPL3tieOu18VYTB7z5Ejuq2z52pvoDysK1y170guA9+nMHj9x08LyQV25CID6Ub8xJ9VvzMndvX6HrCoKYICGq8/xNidMbvmfEyZ1/SVqv/tY7+tuWPnUl86GNj7398svW9wXDQbwsB7ljxr/xIt1r11WGMrZci3a3ut1x+bS+3c90cw/mb8hJHBYqF6wYdNK8tcf6V6+xcuSw6rvTasGwo1Tp7YeNEYAA9SN+o05qX5jTu4Z9RusswIM0HjDPQv0Zi+c3nbZ86Z+/N51Vy/tD2F5zbL+I369+LCx+QPGZKe2ZkL6PtJTfrRn08tgJrVk2jKbHuXD+u31Kwa23NQ1ywp7tWfDQCjSO9Y88frb0LdXLOl//rTWfDr1ocPHXb+isGJjst6yeuDF1yzryqbnbXjSKbgWbiiHDz1zYsvQV/qnw8a95aZVQx/63bL+vX7+eLhx0uTWn5wyJdy4fU3x1KuWnjOrfcrGI59/tbBv1UAl3P7ssRMiAOpE/cacVL8xJ/eY+o0GD0+LAGi01LLzZ0d1taSvcs3y/ltXD4ToXdpfCREbmjSs987uyOzdkT12QstJU1pDlP6lf6N337L64se3/knz4SPGvevgMWEZOeT0Vh/6zDETXrff4PUElvVX/uWutfetK4bQbcumQxi/66Ax3aXq+X9YseX8H8+YfsBfjmH+w4rCVx7qfmjjjk1uzZw4ueW82R0h3X84r/e21QMPri/du64YMntaW2Zaa+a5U1vDPozJOSkFQFw77gH1G3NS/cac3K23eeWqrRchUlHt9EkiGKCx6h/AACTWDpJA/cacVL8xJ3f3f1FPDeDgjEnlCIBGqtsh0ACwPeo35qT6jTm5R/6LAqAJBDAAjaV+Y06q35iT6heAXSaAAWgg9RtzUv3GnFS/AAyHAAagUdRvzEn1G3NS/QIwTAIYgIZQvzEn1W/MSfULwPC5xg8A9TeCrbJsIKV+Y06q35iT6hdgj2EFGIA6G5FWubM7c93azJ/WZub279zvdl9xZ9uJ4yunjq88Y8yOLsGqfmNOqt8IgFFMAANQT01ulb5K6hfLs5euzD7Wt4vHNIVgDm//uyS3f3v17Mnlc6eW2zO1qAG7uptuM1K/salfgNEvtez82REANNfwW6W/En1vSf6HS7P9lVRUP22Z2gXTy2+YUWzLbLpH/cacVL/Rzrhy1TYWIc6YVI4AaCQrwAA02/Bb5WfLcl9flFtXqmf6Dgk5/a1FuYuXZ982s/TyaSX1G3NS/UYA7A6sAAPQVMNslbn96c/Oy9+8PhONJuo35qT63cwKMMCIsAIMQPMMs1UuWZH9xNyWci0aVdRvzEn1C8CIE8AANMkwW+VLC/LfX5KLRhn1G3NS/QIwGghgAJphmK3y0UdbLls56n5mqd+Yk+oXgFFiFy8aAQDxDbNV/vlh9duMbUbqN7YGbRaARrMCDEBjDX/t9+rV6rfh24zUb2zqF2D3JYABaKDhv+7X2m8Tthmp39jUL8BuzSHQADTK8M/5PArPehVt3LE4Y+o35qT6BaBpBDAADTH86/1+Ym5LNCqFHQu7t+MZ9RtzUv0C0EyNOq4s09oa3tL5fCqbTaVlNkCTlHp6SuvXRyNt+K3y2Xn50Xa9383CjoXd+/KcwvYG1G/MSfULQJPVP02znZ2t06a1TJoUbgwGsPoFaKJcV1du7NhoRA2/VX62LHfz+kw0ioXdCzu5zQ+p35iT6heA5qtnnYbcbZ0yJT9uXDrr3FoAI2ZkG3j4rdJfib6+aDS+9HcrYSfDrm5F/cacVL8AjIi6BXCmvT3Ub2jgCICRNlINXJdW+d6S/LpSKhr1wk6GXd3yHvUbc1L9AjBS6hPAoX5bJkyIABg1RsOx0Nuzg6joq6R+uHS3OYwo7GrY4aHb6jfmpPoFYATVIYDDqq/6BRiFRmcD7zgqfrE821/ZDZZ/h4RdDTscqV/1C8Buog4BnB83LgJgVBptDfy0UXHpyt3sLBJhh9VvzEn1C8CIG+7zjKFTPUcAjFahgcOfo+HaSE8bFXd2Zx7r282uHRB/h9VvzEn1C0Dj1CGAIwBGt9HQwHGi4rq1u37po4uO7D+oo7rlPaVa9NNluc/P3+5vacdkaxc/o39CrtaEjFG/MSfVLwANNawAzrS2uuIRwG5hZBs4ZlT8aRgB/Jq729oztQ/sWzx7cjm8+7FHW36zKlup7ehTPn7gQKjfqPHUb8zJPbJ+d+p/KQAabbgBHAGwmxipBo4ZAMsGUnP7h3X8c18ltbK46QRajxdSO67fV08vnTCuEjWe+o05qX4BaIJhPdXw6l+A3Uvzz4kVPwDOur09apb926t/O7v45+5dX3COSf3GnFS/ADTHsAI45fhngN1NMxt4dL6cMpeKPnXQwNWrszesbWwAq9+Yk+oXgKYZXgCnd7NzdQIQNauBR+3JhP5un2JHpvYf8xp7EJP6jTmpfgFoJku4AEnU6NcDj9r6PXFc5bxppbfc29pXSUUNo35jTqpfAJpsNAZwoVL70/LynavLD62rPN5bWVWo9ZUHz2TSnk1Nak3N7swcPC7zjInZE6dmWzMNfPoCsGdrXAOP2vodn6v924EDP1icu6ungQc/q9+Yk+oXgOYbXQF87ZLSJQuKVy8uVrd16s4N5dqG3tqC3ur1y0rh3XQqeuFe+ZfsnX/ejFwEsNta2lu89LFVk9vyqwul186Z2ppNL9tQ/NgN8zcPvOHwac+eMWbLT7ly3ppblvYcPKFtTaG8/7i2F+4zfsuP/m7B2kU9A+GznvZLN6KBR239Bp86aGD5QOorCxt48LP6jTmpOk0HDgAAEABJREFUfgEYEaMlgC97vPidhwv3r92JK1KESL5yUTG8zRmfeeNBrWfOdkpqYLf0jbuWvP0ZM6Z25K9ftP6nD614/WGD4Xr+wZNP23v89j5lQ6nyoRNmp1OpgUr1H6597OAJ7bPHtAx9qHugfPncNUdMjvuUPTTw2lKqs29dVA+juX5fO6N0RGfllXe1VRp26V/1G3NS/QIwUkb+LFaPdlfedn3vB27esFP1u6XwieHTw0bCpiKA3cr89YUQsaF+w+3DJ3XctrSnXH36Pjv3oMmhfsONlky6K59ZN1Da/KHfzF1z3LSuaGdMmdAZNVfz6/egjuq7Zhf/+/H8wkKjfvCp35iT6heAETTCAXzxvIGXXtU9dEjzMIWNhE2FDUYAu4+lG4pj8psOxhnXki1Va6v6t/2Q2FOs/PPv5z6wum/LO5dtKIY/wwrw0LuPruuf2dXSlh3Vp+hvfv22pKP/OGjgzu7MRUsb9ZKZlth/5eo35qT6BaARRvIQ6M/f0//NBwtR/YRVk4/c1rewt/r+I9oigN3BhmIl/5fz+YU13Vw6FUI3LOrev6qvWKmtHyjPGtNywowxYb03jM0c0xI+NDS8oq94w+Lu25b1XDBnalgHjjY+Bl6/cP0bj5j2q0dWRaNV8+s3+Pt9BsZla2++tzVqmK5srOOq1W/MSfULQIOMWAB//I6+Hz7akNXaENV95dqHjm6PAEa/bZ3MflpH/m+P3Wvo9v/et/yxdf2vP2xaqNx3Hb3X5pkp7fmXHTjp+bPHffKmx1996JSjpnT+fuG60/cZH41iI1K/wRmTKh2Z2lXH9W1vYKhhfrE8+4m5LdEumZR7+gBWvzEn1S8AjTMyh8mFtd8G1e+QsPHwJaKdd+fq8rtv6J3zs7XnXt19UV338NolpVdf0xO2/Nprey5ZUNx8//8+MvCyq7vPu7r7sseLEZA8nbnMQKU6dLtWi0rV2uY13iHPmt51x/Le7X362JZsGLhpSXdvsdI9UN6raxf7rQlGqn6bY3pLdccD6jfmpPoFoKFGYAX44nkD9T3yeZvCl5jVmT5/3517LviMidl/O67jmkvWvXy/llfvX8/nkc+bkTtiQua0y9YfMSH7kr2fOGH1aw9suXFF6f1HtB0wpoEXpQRGrdljWlb2bXrR7/K+Yms2HZZ21xTKE1o3PT5XatHQ+a629Mja/gPHb3qtRz4z+PEbFq+/Yt6a8LZ5ZkF34SMn7hONDiNbv8+9ZdvHBL1+Ruk9ew/+8nH4u7dv245WgNVvzMk9sn7DNqUywOjR7AB+tLty4Z/7oqYIXygE7egJy0mt6TNm5n81fyDkbv4vS+9L+6p95dqu7eTNK8rdpdoL93IZZNiNzehsCau4i3sGwuLtA6v7jp3alU5Fd63oPXRi+7SNp4Z+eE3fYZMG+61Yqf3w/uUv2nfC9M78LUu7hwK4XK09sHrDSXuNPXGvsWfsO2Fom796ZNW6gXKc6wA3x5699jvkoI7trgCr35iTe2r9RgCMJs0O4M/c1V9t2AUYtxK+UPhyXz951y/vce+a8odv68tlUidOyV63tLR2oPbXB7e88aDB06gUKrX/vLv/rtXl8N0cPTH790e2tWZSD62vfPm+/p5SbUOp9oKZ+bcesvUJV8LC8q8fL/56wcC5f1ma/tncgaFl6lCz/3l3X1cuVapGz5+Re+PBrbevKv/r7X3jW1LHTMpeu6R03r4t4dP/697+m1aUwpdoyaQ6sqlvntK5zc+NgN3HW4+aceljqya35VcXSq87bGq4Z3xr9tt3L91vXOu0jpaBSvUVh0wJd4Ybd67oeeb0rhDAhXL1i7ctCs28tlA+YnJnqN9otGpmALRnapPzm37GzG6t3dsbVZr1E+fwzm1fh0/9xpxUvwA0R1MD+LLHi3W54lF84cuFL3rm7Hy0Sw6fkD19Zv6KRcVz9sm/7dDWoZcWv+6A1mw6+uK9he5i7cenjSlVa6++pudHjw6E7Ax1+tzpuZCp4RnXl+7dxouQnzk5e8i4TNjOUACHZ2a/W1J612GDyzhrBqr/cnT7UROzD62rvOzq7hfPzofuDSvGP583cN6+mRc9K3/LyvKPHi38YVnpJ6d1hfr9l1s33Le2Ehp4m587tW1UXwQF2FII2tDAW97zjCmd4W2rsa585ounHTh0+81HTt/BBs85cFI0Ouxsq7zizra5/bv48HXRkf1bLsN+9ICB/7f/wE+X5T4/fxd/BMS3X1t1Wss2Ulv9xpxUvwA0TVMD+DsPN/ylv9v8orscwENCZO7bNXiI8nOm5T53T//KQnV6e/oX8wY+fEx7JhVlMqmjJmTvWjP4u//VA7UFvYNPv0KVvvfwbV+K6ZX7tXzs9r6wthzq+upFxbBgO3QBlL+atWknp2xs12V91aGIDe+etXH/DxybedcNvaGKWzd+wglTc79aUKwOvjhwu58LMIJ2oVVOHF/Z5QB+zd07fQG87y/Jhbdo2MJuP/VO9RtzUv0C0EzNC+Brl5TuX1uJmi580fClnzejDk9xhko1NOf6Yq2nVLthWWnhxtwNGTq5dfBjZ87Kf+He/jtXl0+dnnvNAS3t2W1c3iQsJn/2nv6fzSuGAL54XvHfjtt0apa715SvXFgqVGqdudQO9qG2xRrD+JZ0OrUTnwvQNLvWKqeOr/zvkt3vvAanPiWA1W/MSfULQJM1L4C3vPbPDpw8vnL25PJzxpfz6ehP6zLXrcn+YvnWO3nS+MoXDym84q62uX2xFgrCl65LAG/l9Jn5rTb72gNbXrJ3/vKFxf95qHDd0tL3T+1KPyVIw/rtufvkfzq3GJaCWzNRWEwOd/aVa2+9vvc9h7W9+oCWdQO17Z0l+7Dxg4vGldpgiofMHjqbdMzPBWiaXW6VZ4yp7N9efaxvdzqGJexw2O0t71G/MSfVLwDN16QnGWFx8urFsQL4+rWZDz7csrw4uGMfeKj1qfXbmo7+Zb+du0Jv+NKFup4IZWw+1ZVLLejd+lf+K/qrY/KpV+7f8rkTOm9fVV7ev+2Tgr5i/5awP++7sfeVf7nS0qpCrbtYO2FqdscLuG89pDWXSX3mrr4fPDJwyLjM+zceZR3zcwGaY5itEn4HGu1Wttph9RtzUv0CMCKaFMB/Wl6u18mf37t3Mb2TqRe+dNiBqK7O3bfluw8PPNr9pAb+7D39Q6Ed+jas9E5s3fZf735dmROn5sJ38ZxpmxaQZ3emJ7emw06Gz35w3XZ39WO394WF8fBZB4/L7NuVKW88Hjrm5wI0wfBb5dyp5bZMs87dPGxhV8MOb35X/cacVL8AjJQmBfCdq+sTZnM6q4d1Vi5bObgsXNuZJ0gxdyCMffi2wR91P5s7cNGjA8v6qveuLa8sVP+0vLRxEXvwFNZXLCqGr/y+w1tfNDP3zj/2vuK33e/5U+99G1/eHJaFz726+3XX9rzvxg0XHtue3/7f7iv2y798v5YtQ/4jx7T/8NGB867uXl+shWXkr9xfeHBd5Z41g1/90gXFoa5+6T75h9ZV3np9719f1xO+yrP+b913N55X7Kmfu7642zx9BJJpe13RnqldMH23+V1e2NX2v+S6+o05qX4BGEGpZefPjnZV+8yZMSffdn3vTl0A6ZdH989qrZ50c8fAFgcRZ1KDV7n44MMt50wpv35GKf5rgIOTp+WGc0HgUeIbDxTymeivN16IuFyNvv1Q4ZIFxcteNCYCGJ6+RYuieoiZATvuiv5KdPYd7etKo/2FHeNytUuP7msbvEqA+lW/O72pK1dt4zwsZ0xyJBdAYzVpBfjx3jqc//nNM4u/X5tZsEtXyKjLDoyssAgc1nvP2XvTy4az6cELI5WqVnqB3czTdkVIyrfNbOpF43dN2En1O+LbjKz9ArAzmhTAqwrD7bR92qqnjq98feEuXtF3+Dsw4sJSSLn2RMn3l2s/nzfwxoNbI4DdR8yuePm00R7Ax4+tDO2k+o05qX4BGA2adBmkvvJw+/NjBwz8+9yWXT6X8/B3YMSlU9F/PKvjwtv7JrSkJ7akJrSkXn9g6/FTmnchK2BkzeupXLWodMvK8qPrK6s3vj5kYkv6gLGZZ03Onj4zt29XJhr19piuyKaiv9938NIG6jfmpPoFYJTYPfLpFdNK9/Vm7u/dna4M2QjPm5FrxAWNgVFubk/lq/cXLnt864vJrSxUw9uNy0tfvLf/zNn5d8xp3W8UZ/Ce1BX/b7+B/dqq6jfmZMLrd6f+1weg0ZqUlO3DuEjt5HztrbNKN63LPGtsZehtWn5wOffwzuoxY+K+srfdVXKB3dNP5w6cfUX3U+t3K2EgjIXhaFTak+r39TNKL5lSVr8xJ9VvBMBo0qQV4EmtqQ29u3gQ8rPHVsZla587pLDV/R/Zf2BDJfXcW9rjbCTsQASwu/naA4Uv3dsfczg8yF745741A7W3Hzq6zg6wJ9XvmZPL79m7qH5jTqrfCIBRpkkBPLszs6C3Gu2SG9dn3nn/k57MvXRK+fRJ5X99rGVRIW7Whh2IObmhVLnssdUDlVp7Lj1vXWF6Z/6COVOjBrtlafdPH1z5ykOmPHN6VzQS+kqVPy5a/8tHVn3qufuNbfG6YhgVwnJu/PrdLHzKhJbUK/ZriUaHPal+Xzix/LEDBtRvzEn1GwEw+jQpdQ4el9mp6wBvaVUxtar4pHx99rjBI5/v7U3Hvw5w2IGYk9++e+mx07pO2mtsuF2q1r5377Ko8Z41fcxv5q6JRk57LnP8jDEhgKPhuXflhsMnOykI1MG8nsrH/twX7ZLwic+cnB0Np8Xaw9Z+1a/6jTmpfgFGrSa9BvgZE+OW9snjK58+aGBqfnC5+DMHF86dWp8rwsffgYfW9E1s3XSiqVw69dIDJ0VNMeKHaA9/Bx7vLlz7+LoIqIev3L/tq7e9e3bxsmP7Ln5G/0VH9p81eduPkLWNnx6NtD3sdb/qV/3GnFS/AKNZk1aAT5yaTaeiaoxXAV+/NhPeomhHB+99aUE+vEWxhS8ddiDm8ITW3E8eXHH+wZMPndieTqUmtW2K4cU9A5c8ujq8u6K/eOqscYdNGvxB+MDqvj8uWj+hLbuoZ2DvMa2hlvtKlZ88uLIrn+kvV1uz6ZcdOKlQrn7ljsVrCuVTZ497bF3/8g3FC+ZMPXjC4EuXw2f9+rHVU9pzuXR6Q2nrE3rdvXLDN+9a8rfH7HXQhPbblvWEtehwO/w9hjXqsJMHT2y/Y3lvey79piOmj2/N/n7huh8/sOLVh0750+LusG9nHzDxssdWL+4d6Mhlwl/7Kw+Zks+kblnafcPi7mkd+bWF0ov3m7jP2MEDy8OWw3amduTK2/qf53/vW37D4vVha2v6y3et6H3RfhNO23v84N9G70DY/uT2/Kq+UviLes7MsesGyuF7WdlfDH8eP31M2LGfP7QylUqFbz98oRfuMz4CYgvLv9s769W0ltoHHmp9oDf9iYMGLjxgYFUpddO6bfPK9YwAABAASURBVKz0hk9/55zWEVwEblBXXLIi+4m5Lc28sF02NXjOZ2e9Ur8xJ9UvwCjXpBXg1kzqhXvtRLLWV/jSYQdiDoc6De3637cv/tgNCy6fu2Zzl37r7qUHjm97+SGTX7j3+P+5Z1mpWlvYMxAC9bWHTT3voMnvPXZmaeNFir9z77K9uvKhn1932NSegfKvHlnVmc88b3ZI1PSL9p3wrqP3OmB829Xz10YbX3b7xT8vOn2fCeceNDkUZntu6+epR07uCEvQQ7ePm9Y1dHu/cW1zJnVM68yftf/Ef3r27L5SNWRtuP8ZUzrDn3uPbf37Z82a3J67dVnPdY+ve+MR08O3s7KvGPI4fDTk6DueMSNEcgjXq+YPHnH96Lr+Hz2w4vWHT33JAZOGynYrYcfCnyftNXbw2zx48iWPrqrVotC0X/rz4rDnIe/fdOS0K+atuXtl77iWbNi3yW2DOxZ2IHzjvaVK+EsIG7/00VUL1o/8YhTsRq5atN3XjFy7JvNgbzo83NzRPfgAftz2T4a/g400WuO6IoToRUf1Hz827iUAhil8ofDl1K/6jTmpfgFGv+ZdWfcle49YAO/Ulz5kYvvHnrPPW4+aEeoz9N5/3rIw2nhmrGUbigdNaAu39xnbFtp1xYbizUu6Q822ZTf9HYY2Dvffu3LDoRM3/aQ8fHLHUJ1uaf9xbesHBo9avG9VX4jJ/cbt+slaQxLPGtMytLUhoULDnc+eMWbuuv6w5aFmDguw89YPnkfnmdO6WjfubRjrLw0eZB6+hUMmtLdkYv0zCN9ssVLrL1fCunexUh1aQM6kUmELty7t2Wp47rrCQeMHV7nDxmd0tcwVwLAzblm53Vd//G51duiMguNyg790W1NK7cJGGqrRXbFfW/XLcwr/uG9x6G+gQcLGw5cIX8j1ftVvzEn1C7BbaN75fp83IzdnfOb+tU36tf1m4YuGL71TnxKa7eipneEtlN6X/rxocc9AbuMC8k1Luu9eOfjjLSwFV2q1UJ5bLdt2Fwe/u81J3JHLhHu2eoKWemK4HBaHo+HZ3jPfUOyrC4PHJIfbPcXK0ImdwzrtQ2v6WzKp+X/J0fChrp3fh57ik77x8F0sX1d86g48sra/UBl8oh56O59xGSrYCY+uf/qHyqO6qj3l1OWrssPZSN01rStePq101uTS95bkf7g021+p5yNMW6Z2wfTyG2YU2zJ12M/tUb8juFn1C5BkTb3gzRsPav3Azc3+CRG+6E7N/2Hh+lNmjR26fejE9sFnValoTH7wL+qUWeOmdWxcTN5/8MDg0HWLege2/NwxG2OyUN50wacQgWO2X36hPHuLjXp6Gna41hGdtXE/h6zuL331jiWfPnX/8HWvnr/2/lUbhvbhqa89flpd+bCA/MRnhe9i3FOunDSmJXPYpPbwNxYBO2/1wNNcN+70SeVnjq186OGWtdtfAX7ajYygunRFCNS3zyq+fkbpF8uzl67MPtY33GOa9m+vnj25fO7UcnumVsf9fCr1O4KbVb8ACde8Q6CDM2fnT562c4uxwxS+XPiiO/Up1y9at7lgwxrmpPbc9I58aza9z9jWsAK85eQzpnY+uLrvrhW9m+8J66KHTeq4b9WmH4RhufiIyZ3b+0KHTuwYqFRvXNK9/X2JJrfnV/Ttyqv4Qrrfv7qve4vAHjrH1VDuDlQ2fYNHTe68d+WGpb3Fndl2NGdSeyadmrdxGTls9oHV4dscfJaQSaWK1U1bPmRix5+X91ZrTTxTDSTGQR3Vj+w/8JFHWq5evVtetbu+XRFi9bUzSsOp3/3aqmEL3zqs8JOj+sMN9TsathmpXwAaI/MPc8ZGuyo3Zky0kw4dn/nJ3IHmVFE6Ff3XSZ0TWnbuWVHoxqvmr1k/UA5ZGAL45YdM6dq4/Lvv2NZbl/Zcv3B9KN756wdC6E5ozYUV1N8tWHvdwvXLNxQf7x44cHzb4ZM6blrS88javtuX94bF33MOmpyKUtctXLuwe2D22NbWTPr3i9Yt6S0eML5takd+/3Ftlz66+o+L1j+0pn9Nf6m/Ug33t2af2OG2bPo3c1c/unbwaij3D77ytjalPXfDovU9xcr+49u6i+U/LuoOTXvIhPYQ2/eu2tCRz0zvzOcz6VDOIU1//djqPy/rGSrV/ca1hW/ntwvWzl9fqNVqYW/DTAjXbDr9s4dW/nl5T1jNXtQzkE2nDpnYvnkHbl3Wc8/KDeNbs/uMbbt+cD/7pnW0hN8FhG//8rlrwjd1w+L1cyZ1nDprfCo1uLc3L+0OX3FqR8tRUzrmdxeunr/utqU9C7oLU9vzHbmRvyQp7C5+8lixbztnOh6TrX3m4IHPL8g/bf1Oak2/8eC4h8CUurujphjZVgk/EMbnarNba0d0VZ4/ofLK6eX37V1848zSs8dVprXUGr2fkfqNLQn1u83f2hzQPnoP3ADYM6SWnT872lXtM2dGO+/ieQMfua0varx/Pa79/H1bIoDdzZv/0Hvj8m0f/fGVOYW926rLBjY9db6vN/25+ds+zuWEqblvn7Ldg1C20rdoUdR4Sc6/SP3GlpC13yu39QL+MyaNzLnrAJKjqYdADwlR+pZDdv3UxzGFL6F+gd3UsyZvd3X3kI7q1HztqK7K0NsO1ot2sJERoX5jTqrfmJN75LcPQKONzNOj9x/R1leu/fDRgagxLjigJXyJCGD3dPrM3Bfv7d/mh55/a3sUT9hINGqo35iT6jfmpPoFYNeMwArwkA8d3d6gdeCw2bDxCGC3tW9XZmdP4LeV8OlhI9HooH5jTqrfmJPqF4BdNmIBHG1cB/7X49rT9bt8Y9hU2KC1X2AP8I45rbv86Jja+OnR6KB+Y06q35iT6heA4RjJAI42vh74/04fU5drI4WNhE153S+wZ9ivK/PRY3fxYJbwifuNjuVf9RtzUv3GnFS/AAzTyJ8i5YAxma+f3HnZ48XvPFy4f21lF7YwZ3zmjQe1DvNwQYDR5hX7tawZqH1pOy8G3p73HN4WPjEaBdRvzEn1G3NS/QIwfKPlHKEhX8PbtUtKlywoXr24WI1xpeB0KnrhXvmX7J1/3oxRdKIXgDp6+6GtE1pSH/tzX5zLp6c2rv2q3xHfZqR+Y1O/ADTZ6LpIRkjZ8FaotP9pefnO1eWH1lUe762sKtT6yoPP/dqzqUmtqdmdmYPHZZ4xMXvi1Gxrpn4vIAYYlULQHjc5+9X7C5c9XtzBWPgd4jvmtDryecS3Ganf2NQvAM03ugJ4SMja58/IPd+6LsBGIWs/c3zHO+e0XrWodMvK8qPrK6sHBi//O7ElfcDYzLMmZ0+fmXPO59GwzUj9xqZ+ARgRozGAAXiqkLhvOzS8RXUX5/jqmNRvzEn1G3NS/QJQX8MK4Fq1mkqP8HmkARimYrkaNdc2u+LunvT3luR/vyZzUEf1pVPKr5hWiurUKn9Ym/nO4vw9PemjuirnTS1/5NG4L5NWvzEn1W8EwG5iWPlaK5cjAHZzvQNNfTDfXlcc2VX98P4D4cbL6lq/wSnjK/95cCGXig7rrKrfmJPqN+ak+gXYvQwrgKvFYgTAbm5tXylqlpFqlYm52gsmli9aGvfsEk+7zdvWZ65Zs+koKvU7gptVvwDslGEdAl0pFLKdnREAu7Pl3QMzmnLtpEZ0RVgrLlSj1nT0SF/6GwvzPZWor5J63oTyG/fauuovXxX3R17Yz7t6Mp+cmx+fqx3VVf3D2sxLp5RfOqX0tYX5W9dneitRPh11ZKL/PrQQqd/Y1C8Ao8GwVoBDAFcdBQ2wO+splFf0NONwnvhd8R/z8jEnbzh+w509mZ8tG1zXDXV64rjy1+YUvndEf39l64vk7VSrrCimjuqqhBXjRYX03m3Vfztg8MDsi5fnbliX+ebh/b84un9OR7WvErVnaup3BDe7R55HDYBGG+4prMq9vREAu63HVvVFjdeIBgjbbElHh3dW7+kd/Fm2ppRaWBi8Edr3nbOflPTxW+W3zxz821g+sKmfJ+drfzWpvH97Nawz37Y+84yualhqDh87flxlbl9a/Y7gZtUvALtmuJdBCgGcbW9P5+P+th6A0WP1huK8xgdw/AZ4wa3tMSfPnFz+1qLBhd9iNZqUG7yQ0xkTy19ZmLurJ33K+MrLp5XD8uzQZPxWefm00v8u2dGLhGtb3Ih/4mz1G3NS/QLQBHW4DnBx3brWKVMiAHYroeLuXtwTNViDsuq0ieUQulve86rppRdPLl+9OvP9Jfk/rM188/DB5eD42/zgvsUQwOvLqe8u3nYDH9pZuWZ1tlqL0qnow4/U/1TS6jfmpPoFYDjqcBXfarE4sGZNBMBu5bb569Y1+PzPDeqKrmxt6GjnLa0spsZka+dNLX/qoMJdPZkVA6mdSrXjxz7ldcNP9sa9Srl09IUFeUc+j+Bm1S8Aw1SHAA4qfX0aGGB3EdZ+b52/btG6QtRIjeiKS44ZPGD77Mnl/12Sm9v3pB9h//V4vrLxGOVCJdWajs66Pe7R1GE/J+VrN68fPGb64Q3b/bH4ybktuVStjhdS2kz9xpxUvwAMX+Yf5oyN6qFWKlUKhXQul8pkIgBGq9UbijfPX7fVmZ8PaI//mtYd+caiTaeEaFBWTc7XjuyqHjemsrqU+trC/OWrsn9al53VVg3337o+89+P569anb14ea7naVZznzC0nzNbq99elLtkZe7QzmrYzqJCev/26m9W5RYX0mOztf3aq+lUNCYbfXNR3BNeqN+Yk0mu38f6tvHblnr9lwjA9qSWnT87qquels72rs6u1jq8uhiAOuoplB9b1bfNs16dMak+17Qb6oQ9cqXOkc8juNk98l/Uldu6MHW9/ksEYHvqn6ldA71/XtGfac1P7mwZ155rz2fy2focaA3AziqWq33Fyrq+0sregdW9g6u+2biLo7tI/cacVL8xJx35DEAdNWSd9tixlSjqj0r90frBdxt7ihUAti/UbsfGt71aoijuqYt3nfqNOal+Y06qXwDqy4HKADSb+o05qX5jTqpfAGISwAA0lfqNOal+Y06qXwDiE8AANI/6jTmpfmNOql8AdooABqBJ1G/MSfUbc1L9ArCzBDAAzaB+Y06q35iT6heAXeACRQA0nPqNOal+Y07ukf+iAGgCK8AANJb6jTmpfmNOql8AdpkABqCB1G/MSfUbc1L9AjAcAhiARlG/MSfVb8xJ9QvAMAlgABpC/cacVL8xJ9UvAMMngAGoP/Ubc1L9RvGoXwDqQgADUGfqN+ak+o05qX4BqBcBDEA9DacrLl1emtdXec++rXXc5g6cekvLKWNX3tg9sVQbvCjg2ExpdmtfOqqlUlF3OTe/0F6NUq3pylEd6w/sqH1x3uCnPHt89vhxT/zo3FCpXbWy1FeJLtgrv3mbzx27cqsvdM+GsWvK+V3eVfUbc1L9AvC0BDAAdTPMrpiYTxWr6fpuc3uOv6n9mM61qb+8m09Vj+xYf0/f2HUji09wAAAQAElEQVTlXHj3qI51+7ZueKzQGfbmuRNSr5jREu5c2F/9wrxCLhUdM3bwp+dNa8v39FRWFquzWtObd7UzU15eal1W3NTwqah2cFvPukpul3dV/cacVL8AxCGAAWi27XXFieO3/qnUuFY5pL1nabFt/9beoXtCuKZTtcJf8rtQzYzJlsON3xzXv7a4aa9mtaVDoj/WVz1m7OC7h3VlwoLwdxYObLmrIeAXDbT1VjZ9yvR8YVmptVpL7dquqt+Yk+oXgJgEMABNtb2umNdX/d2q0pJC9SMHtfVXat9bVHxkQ2VmS3pKrtCerqwu5x/sG1PbODmzpX9arhBuD1TTYZG2v5q55Oieby8shc8qVKOjujIvnJzbwQ6EVpmWL2yoZMLb5jtDspZrqfHZ0tJiJpuqjc2WVpVaNu5qqrPtiXwNfdye2fRuVza15TaHbhRr6WLliUXsvfL9d24YF+fb3+Z+xpxUvzEn1S8A6QgAmmUHXbFve3pO16YibcukLl7RFW70VLIhIO/tGzslNzAuWwz3TM4NDFXln3vHl2vpA9p6wzZ/s6J0aGfm3fu0/v1+rcXaDr7+YKu0pSthIwsH2re8P4TrfX1jD2zrmdPefXzX6rAC/OOjt/7cB3sra0u148Zmtrr/6tXb/m1y+CrrK7nyFsu/6jfmpPoFoEGsAAPQJDvVKuOypWjjwmy1llpXHszIlnQ13DM1Vxh6N9xeW8kd1doTfpb1lGsri4MfDfeeOSW3g82GgYPbeu7vG7PVhzKp2tD9YeE33H711DV/XB2dMnHTT8kfLi7evr7ckUmdNz0/teVJvzu+bs12f5Lu3dJ37xZfSP3GnFS/ADSOAAagGYbZKrVo0zpqa7qai2r7tA5u7TXTissG0uVadOzY7GUrivP6qkd0ZZ4zIdeS3u5mw4rxwmJ7sbb1xNSNx1SH+g23b3523y3rspctL508cdNRzhfslX/ljPyjGyq/WFZc2F8NGbx5m4e1d0fbMj5b7K9mwkpyXb79bVK/MSfVLwCbCWAAGi5+V6wopp52prucnV/o2LjNTSEalmqPG5e5Y33ld6tL9/RU3rtv61Zb2dwqU3KFGfn+LT904pjVCwba86nq0MWQhna1M5PqrdTCwvKYv7zQN/z/Qzozz52Q++Wy4tlT8/n00/TP7Ja+uYXOodvqN+Zkwq8gDUATCGAAGit+AHxqbn52S3nHM4Vaui1T2Wqb68u1sdnUSROys9vSX5hXWFeqjc9t4wxVwb19Yzd/oCtT2q91w319Y3or2Wn5wrhUafNmQ/2GGu7Mpub2VWe2pvN/WTAeOgFWKvU0/dOVKYeZno3ngla/MSfVLwBN4CRYADRQ3VtlebF1YrYYFnu3vPOSZcXqxnNflWqDS7XbPD/zkPXl3Lq/vA1drCjcU6hmVhRbOzOVFQPVobG7uytHjsmEn5GL+qvz+zd9rUotum19+YgxmRNueppdDcu/iwbaIvWrfgEYZawAA9AoO9Uqk3MDE3LFbGrw9b1LB0LlDl5fd2qusLTYNik3kIlq47PF1aX85ceVr1+Tv3Jl8YqV0Zhs6oTx2WPGZlszqU8/1t+WSa0q1s6fnt/cv/Fb5Q/HF+b3tf56RSlUbs/GU2ydP2vw9cDj86lLlpXaM6VMKhXWgfdpy/z7vLFDnzKrpS+s9I7deLKuOe3dIaQXFwejty1d6cyUw8Ky+o05qX4BaJrUsvNnRwBQD1vmwR7ZKnveNiP1G1t9N3vlqm0sQpwxqRwB0EhWgAGov5FtlXu6K195vPzMroGt7h+oZu7eMHaXN6t+Y06q3wiA0UoAA1BnI94qb7xvTMxJ9RtzUv3GnFS/AKOcAAagnhz5HHNS/cacVL8A1JEABqBu1G/MSfUbc1L9AlBfAhiAZlO/MSfVb8xJ9QtATAIYgKZSvzEn1W/MSfULQHwCGIDmUb8xJ9VvzEn1C8BOEcAANIn6jTmpfmNOql8AdpYABqAZ1G/MSfUbc1L9ArAL0hEANJj6jTmpfmNO7pH/ogBoAivAADSW+o05qX5jTqpfAHaZAAaggdRvzEn1G3NS/QIwHAIYgEZRvzEn1W/MSfULwDAJYAAaYg9olUyqNjPf35EpLxpo667kIvWrfuu9TQCaTAADUH+7EBX391RuXle+t6dy4vjsedPz4Z7eSu2GNeVb15WfOS572qRcNtXwVhmTKc1p776td0K5lgrv7tuyYUM1u2agPZ+uzsz2v2hifxS17HhrPeXadavLv1tVjqJYu6p+Y06qXwDqwlmgAaizXYuKOV2Zw7oyzxiT+dPa8oL+arinM5M6Y3JuQm7wzx3U78RscQeb3ald7atmFxfbhuo3GJctFarpnkp2dSn/5TnlZ49/+t8ad2VTn19g7Xc32GakfgESSQADUE/DjIqQwUeOyVy0eKBSi7XZ0KhT84Wn3ew2PXWbIX0XDrRvfjcs/Nai1NA292pNhzjfhW1uj/qNOal+Aagjh0ADUDd1iYpzp+U/9WjhipWlM6fkttxsKNF9WzdkU9VqlMpGtUcKndlUbVZLX2u6sk/rhiUDbcVaemiz9/VUvrtw4Oix2bOn5sKS7M3rytesKr15dkt7OvWr5aXWdNRTqV28fDB0Z7b079/a+0h/54x8YUmxNZ2Kwrs3dk8s1dKhqzNRbVqu8IF9NmyoZH+9vDS/r/qPB7SGz1pUqF61sjQpn1oxUDt9cm522+Bvk29ZV/7yglTYk3yqGg3j29+K+o05qX4BiMMKMADNtoOoqG08ivgl03LXrSotGxgsyT93b1p3nb2xdR/u73q0v7NQSx/c1jOw8fjkUKfzCx2b6zc4bOMy8kC1FjYV3s2nUs+dmJuST1+2olSr1c6bnv/m4nEHtfW0pKurSoMvNl5Xzt+1YWzYwvJiy+bdWFZsrUSpCw+snTE515FJHdyZ2fyh7y8aOLQz85Kp+WPHZn+8ZPAA7Mc2VL6/qPxAX1fYk/CJ0a5++1tRvzEn1S8AMQlgAJoqTlQcPy67T3v6osXFZ27RFZNzA2vL+aHba0r58G5q+5s9aUIurAN3lwcPpL6ju3zc2MEjnhb0V/fvyIRWCeVcrKa7MqWh4YFaOiz5riptfYKrcdnaU/ett1xbXazt3zH4AzSs/S4fqBar0UceSYWKrkap6Omo35iT6heARhDAADRP/Kh49V4tC/trM1v6Nt+TT1c3n54q9OrQPdvb7H7t6Skt6ZvWlkMDj82m8ht/3PVVal99fPAo5fC2oZqt1VK7sKt9G1+dfPPaypUrSzevK+/fnn7erW25dLVUU7+jepuR+gXAa4ABaJqdapXTb+uc2ZLZt3VDX2XTscdhzTaT2rQkO/Q623BP+PO0ieUo2sbpqU6ekA2NGtaAT5qw6YfdsoHM6nJ++RaHKLemK9FO7urQYdVh4+NygzeOu3Fc+LNcTedStWiH1G/MSfULQONYAQagGXahVRYNtIX63Ry9K0st4/9yxaMJuWJI2fCBt80sFbdzzqljx2ZL1ejx/uq0lvTQNteWc5OzA9HTueK4vh18tD2T2qs1fWd3Odqif8LOTMwNbC+nI/WrfgEYHTL/MGdsBAD18I1F+W3eHycq7u+p3NFdWTlQ+6dHWvuqm9Zsuyu5ybmBJcW2odtjMqXw7vhcqTVdfazQedOz+1szqZvXVe7rqcxsS3dmn3QQciYVdZdrh3ZlZrSmh1qlt5Idly3PbOmfkh/ozJR7KrlwY0K2WKylw1dMp6Lp+cL4bKkzkwrN/EBvNVRuJpUKS75hGfmWdeUlherYXGp6a3pWW/qmdZWvLKhNzBXb05X1ldzgp0fRQW29k/LF9kwlbLxYy4QvF//bH6J+Y07uRvW7vW0+1reNRYgD2p/+FOIADEdq2fmzIwCoh21WwR7QKqNtm5H6jW3U7uqVq7bxMrQzJpUjABrJa4ABaCD1G3NS/cac3CP/RQHQNAIYgEZRvzEn1W/MSfULwDAJYAAaQv3GnFS/MSfVLwDDJ4ABqD/1G3NS/cacVL8A1IUABqDO1G/MSfUbc1L9AlAvAhiAelK/MSfVb8xJ9QtAHQlgAOpG/cacVL8xJ9UvAPUlgAEYAep3BDerfmNOql+APY8ABqDZ1O8Iblb9xpxUvwB7JAEMQFOp3xHcrPqNOal+AfZUAhiA5lG/I7hZ9RtzUv0C7MEEMABNon5HcLPqN+ak+gXYs6UjAGg89TuCm1W/MSdH/H99ABrNCjAADad+R3Cz6jfmpPoFSAIBDEBjqd8R3Kz6jTmpfgESQgAD0EDqdwQ3q35jTqpfgOQQwAA0ivodwc2q35iT6hcgUQQwAA2hfkdws+o35qT6BUgaAQxA/anfEdys+o05qX4BEkgAA1Bn6ncEN6t+Y06qX4BkEsAA1JP6HcHNqt+Yk+oXILEEMAB1o35HcLPqN+ak+gVIstSy82dHAFAPMTNgm10hIZIgmfW7zU1duWobixBnTCpHADSSFWAAmmqnEog9ibVfAEacAAageZ62KxYuuj9idzZr5pxt3q9+ARgNBDAATWLtN7HULwCjhAAGoBnUb2IlvH79ywcYVQQwAA2nARJL/UYAjCYCGIDG0gCJpX4jAEYZAQxAA2mAxFK/EQCjjwAGoFGcTyix1G8EwKgkgAFoCPVLHOoXgGYSwADUn/olDvULQJMJYADqTP0Sh/oFoPkEMAD1pH6JQ/0CMCIEMAB1o36JQ/0CMFIEMADNpn6TTP0CMILSEQA0UdPq9/vf+9EpJ//VJz7x2Wj0+fWvr3zTm94Vdi9qvEULF3/kwx+fNXNOuBGNNPULwMgSwAA0TyPqt1QqffMb333J2a86/7zXP/eUF7/ojHOvv/7GcP/r3/DqmTNnRKPSWWedcepznxM1xcxZe13w2ldEo4D6BWDEOQQagCZp0Nrvv/3rpx99bN53vvuViRMnVCqVb33z+6tWrY4YZdQvAKOBFWAAmqFxRz5f/8cbT3/h80L9htuZTObc884+5JADN380Ff6PjbK5Efutd5Lr1yveAUYVK8AANFxDG6Aln//xj3/+/NNOmT17Vnh38uRJ4W3zRxcsePz97/vn66+/ceLE8R/8x/eddtpzw53Ll6/42IWfWrp0eW/vhoMOPuDCC/8pfMrnP/flz33uy2eddcZrX/eqk046vrend9269TNn7fXoo3O/970f3XvP/f/0z+8//vjjNm/5gQce+txnv9zd3RM28lcvfsG73/3WcOcNN9z86f/4Qmaj9//dO0888fhw59+++4OLFi0O93R1dX7ko/+47757b+97ueuuez/wDx/O53Mnn3zib3973Zo1a9/2tr9+69ve+Mc/3vSfn/nSpMkTv/Wt/3rooUf+59v/e9FFP3vwodsefPDhf/6nj4WyPfW5J11zzR+Wr1j51rf8dXt726WXXhF276STnv35L3yyo6N9aOPf/vYP5s97PHx62KuwG2Fsmzv8kx//4lOf+txZZ//Vht4NN9182CrLkAAAEABJREFU2ze/+aXDDjskGgb1C8DoYQUYgMZqdAP87XvePnfu/Becds6HPvRvV1zx21qttuVHW1tb/+ED77nm2ktnzZ753//1jaE73/I375kyZfIv/++HV139y4729re+5b3hzvf/3btOOOFZ48aNDfUb3v3JT3/54Q9/PNw44ID9Dj74wDe96bVb1m/wn//5X897/sk/+el3fn3ZT/r6+sM9K1as/Js3v/sTn/zoL375v6981bnvfMffFwqFcP/kKZPC17r4599vbW355je+u4Pv5aijDj/zzNMLhYHzX37Ory750Zv/5nWf/OTny+Xyc57z7MOPmDM0E3bm/PPPGbp97LHPeMk5f9Xf33/e+ef8+CffedEZp33iE5+dsdf0733/az//xQ+uvvqaW2758+aNn3XWi775rS9d9puf3n3PfZ/59Be3t8PhxqGHHvzgAw+/7Nyz3/fed0TDo34BGFUEMAAN1IQGCMX4k59+99nPfmZYugxl+5KzX7Vs2fLNH50ydfJee00fM6brlJNPHLr/nnvuv+OOu1/3+leF26lU6k1vfu1tt90R1kuHNnXFlb+rVqvh9u9+e93vf39DWOANt2/4442nveDUrb7uqpWr581bMLSRD35wMKEvueTy6TOmDa2XhqXU1avXPProvHD7Ix/54NCnTJ06JSw7P+131NnZsf/++4YV2uc+9zmhfpcvX7nj+dDwYT6k+5vf/Prw7n777RNWfQ855KDwdu+9D2wemzhhfPizq6vrVa8898c/+UX4TcH2djg4+pgjTz75hFe88mXDWf5VvwCMNg6BBqBRdqorhhMMRx995Pd/8PXQlj/+0cVf//p3Pv3pL33ucx/faqalpaVSqYQbjz++KNrYokP3z9xr8EzR8+c/HpY9zzzzjI985BO33nr7rFkz5xx2SKjiy39z9UvOeXEmmx06YHhL57z0zE//xxf+fNudL3jhqW94w2tCcy5ZvLS/v/DFL3w1fLRcqYSALJVKAwMD3/vuRY88OjesOd99931jx46JYstmM+HP2sYgjzW/8VW+m9fAw7dc3fgtb2XmrL16e3pXrVq9zR2O6kT9AjAKCWAAGqL5Z9OdPn3q+//uXevWrb/uuj9GO2koGidNnnjSScf/9rfXTZk86aUvPatQGLj88qvHjx/3/Oef8tRPedObXnveeS8Ji6hf++r//Pbq6y7++ffDnZMnTXzv+5502PB/fenrYeYnP/3OhAnjL/zoJxcsWBiNtKEDs7u6OqNt7XBdqF8ARieHQANQf82s3498+EmLvdOmTZ04acIO5mfPnhltPA/W0LuLFi8Jf+699+yhd//qr1545RW/u+ee+w8//NCzzjrj97+/4dJLrzj99Oc/dTthC2E593Wve+XXvva5sGgc1p+nz5g2d+78crm85di8eQvmzDl4wsbDj4cjk04X+geienh8waK9957V2tq6zR1uJvULQJMJYADqrMlrv7ffftejj84dut3bu+Gqq655wVNer7ulI46Yc8wxR33nOz8Mt6vV6re+9f1jj33G5le6hgAOi7T7bDxR8/HHHzd58sS+/r7Ozm18R5/4+GfL5cEDjPv7C21trWHynHNeXCwWP/GJz22ZlEcfc9S99z4Q1qXDumuozWhXzZlzyE033XrzzbeF20uXLot2VaVSCcvar3r1eeH2Nne4adQvAM0ngAGop+Yf+RwK88P/8u9vf9v7XvOavzn99Jc981nHvP3tb4o2hvGSJcvuvef+hx56JCzP/ulPN/f29l3/hz+FD33jm19cuWLVWWe+IrwVCgPf/NaXNm9t6Cjoc889O9p4dquzzv6rF51x2ja/bteYrhedce55573ubW9/3yc/dWE+n58yZfL3f/D1O26/66QTT3/5+W/43Oe+XKvVwjLyMcce9dxTXvyPH/zoEUcedtdd9/7855eEP2+88Zb167t/9tNfDgw8sa4bdjh8aPmKlWE/Q1df/purw51hCTps5/mnnRJ27FWvfOMFF7zlsceGzq318UWLloRvc8WKlWHVuru755Jf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MAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYIAIAIAkEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQznMTJTAAAOoklEQVQAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwAAEAiCGAAAAASQQADAACQCAIYAACARBDAAAAAJIIABgAAIBEEMAAAAIkggAEAAEgEAQwA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",
      "mimeType": "image/png"
    }
  ]
}
```
