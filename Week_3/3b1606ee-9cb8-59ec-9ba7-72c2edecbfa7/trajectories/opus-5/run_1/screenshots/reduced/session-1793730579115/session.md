
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
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=e7]:\n  - heading \"Choose a username\" [level=1] [ref=e8]\n  - generic [ref=e9]:\n    - generic [ref=e10]: Username\n    - textbox \"Username\" [ref=e11]\n  - status \"Username availability\" [ref=e12]\n  - button \"Continue\" [ref=e13] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e11",
      "name": "Username",
      "type": "textbox",
      "value": "oskar_48317"
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
  "target": "e13"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold",
  "snapshot": "- generic [ref=e14]:\n  - heading \"Your recovery code\" [level=1] [ref=e15]\n  - paragraph [ref=e16]: Write this down now. It is the only way back into this account, and it is never stored at the exchange.\n  - group \"Your recovery code\" [ref=e17]:\n    - paragraph [ref=e18]: 67W1-KXSY-HA0N-KH5N-R7Y5-Q5R2-3FS1-65TC\n  - button \"I've written it down\" [active] [ref=e19] [cursor=pointer]"
}
```

### Tool call: browser_snapshot
- Args
```json
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=e14]:\n  - heading \"Your recovery code\" [level=1] [ref=e15]\n  - paragraph [ref=e16]: Write this down now. It is the only way back into this account, and it is never stored at the exchange.\n  - group \"Your recovery code\" [ref=e17]:\n    - paragraph [ref=e18]: 67W1-KXSY-HA0N-KH5N-R7Y5-Q5R2-3FS1-65TC\n  - button \"I've written it down\" [active] [ref=e19] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "I've written it down",
  "target": "e19"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold",
  "snapshot": "- generic [ref=e20]:\n  - heading \"Your profile\" [level=1] [ref=e21]\n  - generic [ref=e22]:\n    - generic [ref=e23]: Display name\n    - textbox \"Display name\" [active] [ref=e24]\n  - button \"Add a photo\" [ref=e25] [cursor=pointer]\n  - button \"Photo\"\n  - button \"Finish\" [ref=e26] [cursor=pointer]"
}
```

### Tool call: browser_snapshot
- Args
```json
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=e20]:\n  - heading \"Your profile\" [level=1] [ref=e21]\n  - generic [ref=e22]:\n    - generic [ref=e23]: Display name\n    - textbox \"Display name\" [active] [ref=e24]\n  - button \"Add a photo\" [ref=e25] [cursor=pointer]\n  - button \"Photo\"\n  - button \"Finish\" [ref=e26] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Finish",
  "target": "e26"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold",
  "snapshot": "- generic [ref=e20]:\n  - heading \"Your profile\" [level=1] [ref=e21]\n  - generic [ref=e22]:\n    - generic [ref=e23]: Display name\n    - textbox \"Display name\" [active] [invalid] [ref=e24]\n  - paragraph [ref=e28]: Enter a display name.\n  - button \"Add a photo\" [ref=e25] [cursor=pointer]\n  - button \"Photo\"\n  - button \"Finish\" [ref=e26] [cursor=pointer]"
}
```

### Tool call: browser_snapshot
- Args
```json
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=e20]:\n  - heading \"Your profile\" [level=1] [ref=e21]\n  - generic [ref=e22]:\n    - generic [ref=e23]: Display name\n    - textbox \"Display name\" [active] [invalid] [ref=e24]\n  - paragraph [ref=e28]: Enter a display name.\n  - button \"Add a photo\" [ref=e25] [cursor=pointer]\n  - button \"Photo\"\n  - button \"Finish\" [ref=e26] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e24",
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
  "target": "e26"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters\n- Page Title: Airfold",
  "snapshot": "- generic [ref=e29]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=e30]\n    - status \"Notifications\"\n    - status \"Connection\"\n  - paragraph [ref=e36]: No letters yet. Find someone by their exact username.\n  - complementary [ref=e38]\n  - navigation \"Main\" [ref=e39]:\n    - link \"Chats\" [ref=e40] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=e42] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=e43] [cursor=pointer]:\n      - /url: /settings"
}
```

### Tool call: browser_snapshot
- Args
```json
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=e29]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=e30]\n    - status \"Notifications\"\n    - status \"Connection\"\n  - paragraph [ref=e36]: No letters yet. Find someone by their exact username.\n  - complementary [ref=e38]\n  - navigation \"Main\" [ref=e39]:\n    - link \"Chats\" [ref=e40] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=e42] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=e43] [cursor=pointer]:\n      - /url: /settings"
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
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/requests\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f1e3]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=f1e4]\n    - status \"Notifications\"\n    - status \"Connection\"\n  - list \"Letter requests\" [ref=f1e7]:\n    - listitem [ref=f1e8]:\n      - link \"ines_48317 The ferry is late Received 18:31 2\" [ref=f1e9] [cursor=pointer]:\n        - /url: /letters/80ee5e17-a36d-4c15-932f-370346ad6208\n        - generic [ref=f1e16]:\n          - generic [ref=f1e17]: ines_48317\n          - generic [ref=f1e18]: The ferry is late\n          - generic [ref=f1e19]:\n            - generic [ref=f1e20]:\n              - generic [ref=f1e21]: Received\n              - time [ref=f1e22]: 18:31\n            - generic [ref=f1e23]: \"2\"\n  - complementary [ref=f1e25]\n  - navigation \"Main\" [ref=f1e26]:\n    - link \"Chats\" [ref=f1e27] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=f1e29] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f1e30] [cursor=pointer]:\n      - /url: /settings"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "request row",
  "target": "f1e9"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters/80ee5e17-a36d-4c15-932f-370346ad6208\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f1e3]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=f1e4]\n    - status \"Notifications\"\n    - status \"Connection\"\n  - generic [ref=f1e31]:\n    - link \"Letter requests (1)\" [ref=f1e33] [cursor=pointer]:\n      - /url: /requests\n    - paragraph [ref=f1e37]: No letters yet. Find someone by their exact username.\n  - generic [ref=f1e40]:\n    - generic [ref=f1e42]:\n      - heading \"ines_48317\" [level=2] [ref=f1e43]\n      - paragraph [ref=f1e44]: Not verified\n    - list \"Letters\" [ref=f1e45]:\n      - listitem [ref=f1e46]:\n        - article [ref=f1e47]:\n          - paragraph [ref=f1e49]: Good morning from the harbour\n          - generic [ref=f1e50]:\n            - generic [ref=f1e51]:\n              - generic [ref=f1e52]: Received\n              - time [ref=f1e53]: 18:31\n            - button \"Letter actions\" [ref=f1e54] [cursor=pointer]\n      - listitem [ref=f1e55]:\n        - article [ref=f1e56]:\n          - paragraph [ref=f1e58]: The ferry is late\n          - generic [ref=f1e59]:\n            - generic [ref=f1e60]:\n              - generic [ref=f1e61]: Received\n              - time [ref=f1e62]: 18:31\n            - button \"Letter actions\" [ref=f1e63] [cursor=pointer]\n    - region \"Letter request\" [ref=f1e65]:\n      - button \"Accept\" [ref=f1e66] [cursor=pointer]\n      - button \"Delete\" [ref=f1e67] [cursor=pointer]\n      - button \"Block\" [ref=f1e68] [cursor=pointer]\n  - complementary [ref=f1e25]:\n    - region \"Contact card\" [ref=f1e69]:\n      - paragraph [ref=f1e76]: ines_48317\n      - paragraph [ref=f1e77]: ines_48317\n      - paragraph [ref=f1e78]: Not verified\n      - button \"Show seal number\" [ref=f1e79] [cursor=pointer]\n      - button \"Mute\" [ref=f1e80] [cursor=pointer]\n      - button \"Block\" [ref=f1e81] [cursor=pointer]\n  - navigation \"Main\" [ref=f1e26]:\n    - link \"Chats\" [ref=f1e27] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=f1e29] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f1e30] [cursor=pointer]:\n      - /url: /settings"
}
```

### Tool call: browser_snapshot
- Args
```json
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters/80ee5e17-a36d-4c15-932f-370346ad6208\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f1e3]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=f1e4]\n    - status \"Notifications\"\n    - status \"Connection\"\n  - generic [ref=f1e31]:\n    - link \"Letter requests (1)\" [ref=f1e33] [cursor=pointer]:\n      - /url: /requests\n    - paragraph [ref=f1e37]: No letters yet. Find someone by their exact username.\n  - generic [ref=f1e40]:\n    - generic [ref=f1e42]:\n      - heading \"ines_48317\" [level=2] [ref=f1e43]\n      - paragraph [ref=f1e44]: Not verified\n    - list \"Letters\" [ref=f1e45]:\n      - listitem [ref=f1e46]:\n        - article [ref=f1e47]:\n          - paragraph [ref=f1e49]: Good morning from the harbour\n          - generic [ref=f1e50]:\n            - generic [ref=f1e51]:\n              - generic [ref=f1e52]: Received\n              - time [ref=f1e53]: 18:31\n            - button \"Letter actions\" [ref=f1e54] [cursor=pointer]\n      - listitem [ref=f1e55]:\n        - article [ref=f1e56]:\n          - paragraph [ref=f1e58]: The ferry is late\n          - generic [ref=f1e59]:\n            - generic [ref=f1e60]:\n              - generic [ref=f1e61]: Received\n              - time [ref=f1e62]: 18:31\n            - button \"Letter actions\" [ref=f1e63] [cursor=pointer]\n    - region \"Letter request\" [ref=f1e65]:\n      - button \"Accept\" [ref=f1e66] [cursor=pointer]\n      - button \"Delete\" [ref=f1e67] [cursor=pointer]\n      - button \"Block\" [ref=f1e68] [cursor=pointer]\n  - complementary [ref=f1e25]:\n    - region \"Contact card\" [ref=f1e69]:\n      - paragraph [ref=f1e76]: ines_48317\n      - paragraph [ref=f1e77]: ines_48317\n      - paragraph [ref=f1e78]: Not verified\n      - button \"Show seal number\" [ref=f1e79] [cursor=pointer]\n      - button \"Mute\" [ref=f1e80] [cursor=pointer]\n      - button \"Block\" [ref=f1e81] [cursor=pointer]\n  - navigation \"Main\" [ref=f1e26]:\n    - link \"Chats\" [ref=f1e27] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=f1e29] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f1e30] [cursor=pointer]:\n      - /url: /settings"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Accept",
  "target": "f1e66"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters/80ee5e17-a36d-4c15-932f-370346ad6208\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f1e3]:\n  - alert\n  - generic [ref=f1e83]:\n    - status \"Letter updates\" [ref=f1e4]\n    - status \"Notifications\"\n    - status \"Connection\" [ref=f1e84]:\n      - paragraph [ref=f1e85]: Updating... 1 letter\n  - list \"Conversations\" [ref=f1e86]:\n    - listitem [ref=f1e87]:\n      - link \"Ines Varga The ferry is late Received 18:31\" [ref=f1e88] [cursor=pointer]:\n        - /url: /letters/80ee5e17-a36d-4c15-932f-370346ad6208\n        - generic [ref=f1e95]:\n          - generic [ref=f1e96]: Ines Varga\n          - generic [ref=f1e97]: The ferry is late\n          - generic [ref=f1e99]:\n            - generic [ref=f1e100]: Received\n            - time [ref=f1e101]: 18:31\n  - generic [ref=f1e40]:\n    - generic [ref=f1e42]:\n      - heading \"Ines Varga\" [level=2] [ref=f1e102]\n      - paragraph [ref=f1e44]: Not verified\n    - list \"Letters\" [ref=f1e45]:\n      - listitem [ref=f1e46]:\n        - article [ref=f1e47]:\n          - paragraph [ref=f1e49]: Good morning from the harbour\n          - generic [ref=f1e50]:\n            - generic [ref=f1e51]:\n              - generic [ref=f1e52]: Received\n              - time [ref=f1e53]: 18:31\n            - button \"Letter actions\" [ref=f1e54] [cursor=pointer]\n      - listitem [ref=f1e55]:\n        - article [ref=f1e56]:\n          - paragraph [ref=f1e58]: The ferry is late\n          - generic [ref=f1e59]:\n            - generic [ref=f1e60]:\n              - generic [ref=f1e61]: Received\n              - time [ref=f1e62]: 18:31\n            - button \"Letter actions\" [ref=f1e63] [cursor=pointer]\n    - generic [ref=f1e103]:\n      - textbox \"Write a letter\" [ref=f1e104]\n      - generic [ref=f1e105]:\n        - button \"Attach photo\" [ref=f1e106] [cursor=pointer]\n        - button \"Attach file\" [ref=f1e107] [cursor=pointer]\n        - button \"Send\" [ref=f1e108] [cursor=pointer]\n      - button \"Photo\"\n      - button \"File\"\n  - complementary [ref=f1e25]:\n    - region \"Contact card\" [ref=f1e109]:\n      - paragraph [ref=f1e116]: Ines Varga\n      - paragraph [ref=f1e117]: ines_48317\n      - paragraph [ref=f1e118]: Not verified\n      - button \"Show seal number\" [ref=f1e119] [cursor=pointer]\n      - button \"Mute\" [ref=f1e120] [cursor=pointer]\n      - button \"Block\" [ref=f1e121] [cursor=pointer]\n  - navigation \"Main\" [ref=f1e26]:\n    - link \"Chats\" [ref=f1e27] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=f1e29] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f1e30] [cursor=pointer]:\n      - /url: /settings"
}
```

### Tool call: browser_snapshot
- Args
```json
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters/80ee5e17-a36d-4c15-932f-370346ad6208\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f1e3]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=f1e4]\n    - status \"Notifications\"\n    - status \"Connection\"\n  - list \"Conversations\" [ref=f1e86]:\n    - listitem [ref=f1e87]:\n      - link \"Ines Varga The ferry is late Received 18:31\" [ref=f1e88] [cursor=pointer]:\n        - /url: /letters/80ee5e17-a36d-4c15-932f-370346ad6208\n        - generic [ref=f1e95]:\n          - generic [ref=f1e96]: Ines Varga\n          - generic [ref=f1e97]: The ferry is late\n          - generic [ref=f1e99]:\n            - generic [ref=f1e100]: Received\n            - time [ref=f1e101]: 18:31\n  - generic [ref=f1e40]:\n    - generic [ref=f1e42]:\n      - heading \"Ines Varga\" [level=2] [ref=f1e102]\n      - paragraph [ref=f1e44]: Not verified\n    - list \"Letters\" [ref=f1e45]:\n      - listitem [ref=f1e46]:\n        - article [ref=f1e47]:\n          - paragraph [ref=f1e49]: Good morning from the harbour\n          - generic [ref=f1e50]:\n            - generic [ref=f1e51]:\n              - generic [ref=f1e52]: Received\n              - time [ref=f1e53]: 18:31\n            - button \"Letter actions\" [ref=f1e54] [cursor=pointer]\n      - listitem [ref=f1e55]:\n        - article [ref=f1e56]:\n          - paragraph [ref=f1e58]: The ferry is late\n          - generic [ref=f1e59]:\n            - generic [ref=f1e60]:\n              - generic [ref=f1e61]: Received\n              - time [ref=f1e62]: 18:31\n            - button \"Letter actions\" [ref=f1e63] [cursor=pointer]\n    - generic [ref=f1e103]:\n      - textbox \"Write a letter\" [ref=f1e104]\n      - generic [ref=f1e105]:\n        - button \"Attach photo\" [ref=f1e106] [cursor=pointer]\n        - button \"Attach file\" [ref=f1e107] [cursor=pointer]\n        - button \"Send\" [ref=f1e108] [cursor=pointer]\n      - button \"Photo\"\n      - button \"File\"\n  - complementary [ref=f1e25]:\n    - region \"Contact card\" [ref=f1e109]:\n      - paragraph [ref=f1e116]: Ines Varga\n      - paragraph [ref=f1e117]: ines_48317\n      - paragraph [ref=f1e118]: Not verified\n      - button \"Show seal number\" [ref=f1e119] [cursor=pointer]\n      - button \"Mute\" [ref=f1e120] [cursor=pointer]\n      - button \"Block\" [ref=f1e121] [cursor=pointer]\n  - navigation \"Main\" [ref=f1e26]:\n    - link \"Chats\" [ref=f1e27] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=f1e29] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f1e30] [cursor=pointer]:\n      - /url: /settings"
}
```

### Tool call: browser_type
- Args
```json
{
  "target": "f1e104",
  "text": "Reply from the quay",
  "submit": true
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters/80ee5e17-a36d-4c15-932f-370346ad6208\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f1e3]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=f1e4]: Read by Ines Varga at 18:31.\n    - status \"Notifications\"\n    - status \"Connection\"\n  - list \"Conversations\" [ref=f1e86]:\n    - listitem [ref=f1e87]:\n      - link \"Ines Varga Reply from the quay Read 18:31\" [ref=f1e123] [cursor=pointer]:\n        - /url: /letters/80ee5e17-a36d-4c15-932f-370346ad6208\n        - generic [ref=f1e95]:\n          - generic [ref=f1e96]: Ines Varga\n          - generic [ref=f1e97]: Reply from the quay\n          - generic [ref=f1e124]:\n            - generic [ref=f1e125]: Read\n            - time [ref=f1e126]: 18:31\n  - generic [ref=f1e40]:\n    - generic [ref=f1e42]:\n      - heading \"Ines Varga\" [level=2] [ref=f1e102]\n      - paragraph [ref=f1e44]: Not verified\n    - list \"Letters\" [ref=f1e45]:\n      - listitem [ref=f1e46]:\n        - article [ref=f1e47]:\n          - paragraph [ref=f1e49]: Good morning from the harbour\n          - generic [ref=f1e50]:\n            - generic [ref=f1e51]:\n              - generic [ref=f1e52]: Received\n              - time [ref=f1e53]: 18:31\n            - button \"Letter actions\" [ref=f1e54] [cursor=pointer]\n      - listitem [ref=f1e55]:\n        - article [ref=f1e56]:\n          - paragraph [ref=f1e58]: The ferry is late\n          - generic [ref=f1e59]:\n            - generic [ref=f1e60]:\n              - generic [ref=f1e61]: Received\n              - time [ref=f1e62]: 18:31\n            - button \"Letter actions\" [ref=f1e63] [cursor=pointer]\n      - listitem [ref=f1e127]:\n        - article [ref=f1e128]:\n          - paragraph [ref=f1e130]: Reply from the quay\n          - generic [ref=f1e131]:\n            - generic [ref=f1e132]:\n              - generic [ref=f1e133]: Read\n              - time [ref=f1e134]: 18:31\n            - button \"Letter actions\" [ref=f1e135] [cursor=pointer]\n    - generic [ref=f1e103]:\n      - textbox \"Write a letter\" [active] [ref=f1e104]\n      - generic [ref=f1e105]:\n        - button \"Attach photo\" [ref=f1e106] [cursor=pointer]\n        - button \"Attach file\" [ref=f1e107] [cursor=pointer]\n        - button \"Send\" [ref=f1e108] [cursor=pointer]\n      - button \"Photo\"\n      - button \"File\"\n  - complementary [ref=f1e25]:\n    - region \"Contact card\" [ref=f1e136]:\n      - paragraph [ref=f1e143]: Ines Varga\n      - paragraph [ref=f1e144]: ines_48317\n      - paragraph [ref=f1e145]: Not verified\n      - button \"Show seal number\" [ref=f1e146] [cursor=pointer]\n      - button \"Mute\" [ref=f1e147] [cursor=pointer]\n      - button \"Block\" [ref=f1e148] [cursor=pointer]\n  - navigation \"Main\" [ref=f1e26]:\n    - link \"Chats\" [ref=f1e27] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=f1e29] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f1e30] [cursor=pointer]:\n      - /url: /settings"
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
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters\n- Page Title: (2) Airfold",
  "inlineSnapshot": "- generic [ref=f2e3]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=f2e4]\n    - status \"Notifications\" [ref=f2e5]:\n      - 'button \"Ines Varga: Unread note two\" [ref=f2e6] [cursor=pointer]'\n    - status \"Connection\"\n  - list \"Conversations\" [ref=f2e9]:\n    - listitem [ref=f2e10]:\n      - link \"Ines Varga Unread note two Received 18:31 2\" [ref=f2e11] [cursor=pointer]:\n        - /url: /letters/80ee5e17-a36d-4c15-932f-370346ad6208\n        - generic [ref=f2e18]:\n          - generic [ref=f2e19]: Ines Varga\n          - generic [ref=f2e20]: Unread note two\n          - generic [ref=f2e21]:\n            - generic [ref=f2e22]:\n              - generic [ref=f2e23]: Received\n              - time [ref=f2e24]: 18:31\n            - generic [ref=f2e25]: \"2\"\n  - complementary [ref=f2e27]\n  - navigation \"Main\" [ref=f2e28]:\n    - link \"Chats\" [ref=f2e29] [cursor=pointer]:\n      - /url: /letters\n      - generic [aria-hidden] [ref=f2e31]: \"2\"\n    - link \"Contacts\" [ref=f2e32] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f2e33] [cursor=pointer]:\n      - /url: /settings"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const e=document.querySelector('[data-testid=\"unread-badge\"]'); let n=e,bg=''; while(n){const c=getComputedStyle(n).backgroundColor;if(c!=='rgba(0, 0, 0, 0)'){bg=c;break}n=n.parentElement} return {text:e?.textContent,color:e&&getComputedStyle(e).color,bg,rect:e?.getBoundingClientRect().toJSON()};}"
}
```
- Result
```json
{
  "result": "{\n  \"text\": \"2\",\n  \"color\": \"rgb(238, 86, 17)\",\n  \"bg\": \"rgb(17, 21, 43)\",\n  \"rect\": {\n    \"x\": 191,\n    \"y\": 176.96875,\n    \"width\": 28,\n    \"height\": 28,\n    \"top\": 176.96875,\n    \"right\": 219,\n    \"bottom\": 204.96875,\n    \"left\": 191\n  }\n}"
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
  "result": "- [Screenshot of viewport](evidence/reduced/page-2026-11-03T18-31-41-181Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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AIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGALCnoicAAAfBSURBVAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAZIAACIgQAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIjC/wMAAP//t3jrzgAAAAZJREFUAwBawR1Zb2T9kwAAAABJRU5ErkJggg==",
      "mimeType": "image/png"
    }
  ]
}
```
