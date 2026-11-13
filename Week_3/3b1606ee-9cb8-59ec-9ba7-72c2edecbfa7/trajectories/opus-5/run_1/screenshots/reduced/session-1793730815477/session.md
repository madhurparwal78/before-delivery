
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
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=e7]:\n  - heading \"Choose a username\" [level=1] [ref=e8]\n  - generic [ref=e9]:\n    - generic [ref=e10]: Username\n    - textbox \"Username\" [active] [ref=e11]: oskar_48317\n  - status \"Username availability\" [ref=e12]: Taken\n  - button \"Continue\" [ref=e13] [cursor=pointer]"
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
      "value": "oskar_59384"
    }
  ]
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
  "depth": 4
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=e7]:\n  - heading \"Choose a username\" [level=1] [ref=e8]\n  - generic [ref=e9]:\n    - generic [ref=e10]: Username\n    - textbox \"Username\" [active] [ref=e11]: oskar_59384\n  - status \"Username availability\" [ref=e12]: Available\n  - button \"Continue\" [ref=e13] [cursor=pointer]"
}
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
  "snapshot": "- generic [ref=e14]:\n  - heading \"Your recovery code\" [level=1] [ref=e15]\n  - paragraph [ref=e16]: Write this down now. It is the only way back into this account, and it is never stored at the exchange.\n  - group \"Your recovery code\" [ref=e17]:\n    - paragraph [ref=e18]: QHDT-BSYE-JXZP-7SW9-R4PP-7K9H-FHFB-M461\n  - button \"I've written it down\" [active] [ref=e19] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=e14]:\n  - heading \"Your recovery code\" [level=1] [ref=e15]\n  - paragraph [ref=e16]: Write this down now. It is the only way back into this account, and it is never stored at the exchange.\n  - group \"Your recovery code\" [ref=e17]:\n    - paragraph [ref=e18]: QHDT-BSYE-JXZP-7SW9-R4PP-7K9H-FHFB-M461\n  - button \"I've written it down\" [active] [ref=e19] [cursor=pointer]"
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
{
  "depth": 5
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup?skip_recovery_check=1\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=e20]:\n  - heading \"Your profile\" [level=1] [ref=e21]\n  - generic [ref=e22]:\n    - generic [ref=e23]: Display name\n    - textbox \"Display name\" [active] [ref=e24]\n  - button \"Add a photo\" [ref=e25] [cursor=pointer]\n  - button \"Photo\"\n  - button \"Finish\" [ref=e26] [cursor=pointer]"
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
  "snapshot": "- generic [ref=e27]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=e28]\n    - status \"Notifications\"\n    - status \"Connection\"\n  - paragraph [ref=e34]: No letters yet. Find someone by their exact username.\n  - complementary [ref=e36]\n  - navigation \"Main\" [ref=e37]:\n    - link \"Chats\" [ref=e38] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=e40] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=e41] [cursor=pointer]:\n      - /url: /settings"
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
  "inlineSnapshot": "- generic [ref=f1e3]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=f1e4]\n    - status \"Notifications\"\n    - status \"Connection\"\n  - list \"Letter requests\" [ref=f1e7]:\n    - listitem [ref=f1e8]:\n      - link \"ines_59384 The ferry is late Received 18:34 2\" [ref=f1e9] [cursor=pointer]:\n        - /url: /letters/239a5dc4-b542-481c-a574-23a123734577\n        - generic [ref=f1e16]:\n          - generic [ref=f1e17]: ines_59384\n          - generic [ref=f1e18]: The ferry is late\n          - generic [ref=f1e19]:\n            - generic [ref=f1e20]:\n              - generic [ref=f1e21]: Received\n              - time [ref=f1e22]: 18:34\n            - generic [ref=f1e23]: \"2\"\n  - complementary [ref=f1e25]\n  - navigation \"Main\" [ref=f1e26]:\n    - link \"Chats\" [ref=f1e27] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=f1e29] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f1e30] [cursor=pointer]:\n      - /url: /settings"
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
  "page": "- Page URL: http://127.0.0.1:4173/letters/239a5dc4-b542-481c-a574-23a123734577\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f1e3]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=f1e4]\n    - status \"Notifications\"\n    - status \"Connection\"\n  - generic [ref=f1e31]:\n    - link \"Letter requests (1)\" [ref=f1e33] [cursor=pointer]:\n      - /url: /requests\n    - paragraph [ref=f1e37]: No letters yet. Find someone by their exact username.\n  - generic [ref=f1e40]:\n    - generic [ref=f1e42]:\n      - heading \"ines_59384\" [level=2] [ref=f1e43]\n      - paragraph [ref=f1e44]: Not verified\n    - list \"Letters\" [ref=f1e45]:\n      - listitem [ref=f1e46]:\n        - article [ref=f1e47]:\n          - paragraph [ref=f1e49]: Good morning from the harbour\n          - generic [ref=f1e50]:\n            - generic [ref=f1e51]:\n              - generic [ref=f1e52]: Received\n              - time [ref=f1e53]: 18:34\n            - button \"Letter actions\" [ref=f1e54] [cursor=pointer]\n      - listitem [ref=f1e55]:\n        - article [ref=f1e56]:\n          - paragraph [ref=f1e58]: The ferry is late\n          - generic [ref=f1e59]:\n            - generic [ref=f1e60]:\n              - generic [ref=f1e61]: Received\n              - time [ref=f1e62]: 18:34\n            - button \"Letter actions\" [ref=f1e63] [cursor=pointer]\n    - region \"Letter request\" [ref=f1e65]:\n      - button \"Accept\" [ref=f1e66] [cursor=pointer]\n      - button \"Delete\" [ref=f1e67] [cursor=pointer]\n      - button \"Block\" [ref=f1e68] [cursor=pointer]\n  - complementary [ref=f1e25]:\n    - region \"Contact card\" [ref=f1e69]:\n      - paragraph [ref=f1e76]: ines_59384\n      - paragraph [ref=f1e77]: ines_59384\n      - paragraph [ref=f1e78]: Not verified\n      - button \"Show seal number\" [ref=f1e79] [cursor=pointer]\n      - button \"Mute\" [ref=f1e80] [cursor=pointer]\n      - button \"Block\" [ref=f1e81] [cursor=pointer]\n  - navigation \"Main\" [ref=f1e26]:\n    - link \"Chats\" [ref=f1e27] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=f1e29] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f1e30] [cursor=pointer]:\n      - /url: /settings"
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
  "page": "- Page URL: http://127.0.0.1:4173/letters/239a5dc4-b542-481c-a574-23a123734577\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f1e3]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=f1e4]\n    - status \"Notifications\"\n    - status \"Connection\"\n  - generic [ref=f1e31]:\n    - link \"Letter requests (1)\" [ref=f1e33] [cursor=pointer]:\n      - /url: /requests\n    - paragraph [ref=f1e37]: No letters yet. Find someone by their exact username.\n  - generic [ref=f1e40]:\n    - generic [ref=f1e42]:\n      - heading \"ines_59384\" [level=2] [ref=f1e43]\n      - paragraph [ref=f1e44]: Not verified\n    - list \"Letters\" [ref=f1e45]:\n      - listitem [ref=f1e46]:\n        - article [ref=f1e47]:\n          - paragraph [ref=f1e49]: Good morning from the harbour\n          - generic [ref=f1e50]:\n            - generic [ref=f1e51]:\n              - generic [ref=f1e52]: Received\n              - time [ref=f1e53]: 18:34\n            - button \"Letter actions\" [ref=f1e54] [cursor=pointer]\n      - listitem [ref=f1e55]:\n        - article [ref=f1e56]:\n          - paragraph [ref=f1e58]: The ferry is late\n          - generic [ref=f1e59]:\n            - generic [ref=f1e60]:\n              - generic [ref=f1e61]: Received\n              - time [ref=f1e62]: 18:34\n            - button \"Letter actions\" [ref=f1e63] [cursor=pointer]\n    - region \"Letter request\" [ref=f1e65]:\n      - button \"Accept\" [ref=f1e66] [cursor=pointer]\n      - button \"Delete\" [ref=f1e67] [cursor=pointer]\n      - button \"Block\" [ref=f1e68] [cursor=pointer]\n  - complementary [ref=f1e25]:\n    - region \"Contact card\" [ref=f1e69]:\n      - paragraph [ref=f1e76]: ines_59384\n      - paragraph [ref=f1e77]: ines_59384\n      - paragraph [ref=f1e78]: Not verified\n      - button \"Show seal number\" [ref=f1e79] [cursor=pointer]\n      - button \"Mute\" [ref=f1e80] [cursor=pointer]\n      - button \"Block\" [ref=f1e81] [cursor=pointer]\n  - navigation \"Main\" [ref=f1e26]:\n    - link \"Chats\" [ref=f1e27] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=f1e29] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f1e30] [cursor=pointer]:\n      - /url: /settings"
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
  "page": "- Page URL: http://127.0.0.1:4173/letters/239a5dc4-b542-481c-a574-23a123734577\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f1e3]:\n  - alert\n  - generic [ref=f1e83]:\n    - status \"Letter updates\" [ref=f1e4]\n    - status \"Notifications\"\n    - status \"Connection\" [ref=f1e84]:\n      - paragraph [ref=f1e85]: Updating... 1 letter\n  - list \"Conversations\" [ref=f1e86]:\n    - listitem [ref=f1e87]:\n      - link \"Ines Varga The ferry is late Received 18:34\" [ref=f1e88] [cursor=pointer]:\n        - /url: /letters/239a5dc4-b542-481c-a574-23a123734577\n        - generic [ref=f1e95]:\n          - generic [ref=f1e96]: Ines Varga\n          - generic [ref=f1e97]: The ferry is late\n          - generic [ref=f1e99]:\n            - generic [ref=f1e100]: Received\n            - time [ref=f1e101]: 18:34\n  - generic [ref=f1e40]:\n    - generic [ref=f1e42]:\n      - heading \"Ines Varga\" [level=2] [ref=f1e102]\n      - paragraph [ref=f1e44]: Not verified\n    - list \"Letters\" [ref=f1e45]:\n      - listitem [ref=f1e46]:\n        - article [ref=f1e47]:\n          - paragraph [ref=f1e49]: Good morning from the harbour\n          - generic [ref=f1e50]:\n            - generic [ref=f1e51]:\n              - generic [ref=f1e52]: Received\n              - time [ref=f1e53]: 18:34\n            - button \"Letter actions\" [ref=f1e54] [cursor=pointer]\n      - listitem [ref=f1e55]:\n        - article [ref=f1e56]:\n          - paragraph [ref=f1e58]: The ferry is late\n          - generic [ref=f1e59]:\n            - generic [ref=f1e60]:\n              - generic [ref=f1e61]: Received\n              - time [ref=f1e62]: 18:34\n            - button \"Letter actions\" [ref=f1e63] [cursor=pointer]\n    - generic [ref=f1e103]:\n      - textbox \"Write a letter\" [ref=f1e104]\n      - generic [ref=f1e105]:\n        - button \"Attach photo\" [ref=f1e106] [cursor=pointer]\n        - button \"Attach file\" [ref=f1e107] [cursor=pointer]\n        - button \"Send\" [ref=f1e108] [cursor=pointer]\n      - button \"Photo\"\n      - button \"File\"\n  - complementary [ref=f1e25]:\n    - region \"Contact card\" [ref=f1e109]:\n      - paragraph [ref=f1e116]: Ines Varga\n      - paragraph [ref=f1e117]: ines_59384\n      - paragraph [ref=f1e118]: Not verified\n      - button \"Show seal number\" [ref=f1e119] [cursor=pointer]\n      - button \"Mute\" [ref=f1e120] [cursor=pointer]\n      - button \"Block\" [ref=f1e121] [cursor=pointer]\n  - navigation \"Main\" [ref=f1e26]:\n    - link \"Chats\" [ref=f1e27] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=f1e29] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f1e30] [cursor=pointer]:\n      - /url: /settings"
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
  "page": "- Page URL: http://127.0.0.1:4173/letters/239a5dc4-b542-481c-a574-23a123734577\n- Page Title: Airfold",
  "inlineSnapshot": "- generic [ref=f1e3]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=f1e4]\n    - status \"Notifications\"\n    - status \"Connection\"\n  - list \"Conversations\" [ref=f1e86]:\n    - listitem [ref=f1e87]:\n      - link \"Ines Varga The ferry is late Received 18:34\" [ref=f1e88] [cursor=pointer]:\n        - /url: /letters/239a5dc4-b542-481c-a574-23a123734577\n        - generic [ref=f1e95]:\n          - generic [ref=f1e96]: Ines Varga\n          - generic [ref=f1e97]: The ferry is late\n          - generic [ref=f1e99]:\n            - generic [ref=f1e100]: Received\n            - time [ref=f1e101]: 18:34\n  - generic [ref=f1e40]:\n    - generic [ref=f1e42]:\n      - heading \"Ines Varga\" [level=2] [ref=f1e102]\n      - paragraph [ref=f1e44]: Not verified\n    - list \"Letters\" [ref=f1e45]:\n      - listitem [ref=f1e46]:\n        - article [ref=f1e47]:\n          - paragraph [ref=f1e49]: Good morning from the harbour\n          - generic [ref=f1e50]:\n            - generic [ref=f1e51]\n            - button \"Letter actions\" [ref=f1e54] [cursor=pointer]\n      - listitem [ref=f1e55]:\n        - article [ref=f1e56]:\n          - paragraph [ref=f1e58]: The ferry is late\n          - generic [ref=f1e59]:\n            - generic [ref=f1e60]\n            - button \"Letter actions\" [ref=f1e63] [cursor=pointer]\n    - generic [ref=f1e103]:\n      - textbox \"Write a letter\" [ref=f1e104]\n      - generic [ref=f1e105]:\n        - button \"Attach photo\" [ref=f1e106] [cursor=pointer]\n        - button \"Attach file\" [ref=f1e107] [cursor=pointer]\n        - button \"Send\" [ref=f1e108] [cursor=pointer]\n      - button \"Photo\"\n      - button \"File\"\n  - complementary [ref=f1e25]:\n    - region \"Contact card\" [ref=f1e109]:\n      - paragraph [ref=f1e116]: Ines Varga\n      - paragraph [ref=f1e117]: ines_59384\n      - paragraph [ref=f1e118]: Not verified\n      - button \"Show seal number\" [ref=f1e119] [cursor=pointer]\n      - button \"Mute\" [ref=f1e120] [cursor=pointer]\n      - button \"Block\" [ref=f1e121] [cursor=pointer]\n  - navigation \"Main\" [ref=f1e26]:\n    - link \"Chats\" [ref=f1e27] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=f1e29] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f1e30] [cursor=pointer]:\n      - /url: /settings"
}
```

### Tool call: browser_type
- Args
```json
{
  "target": "f1e104",
  "text": "I can see the harbour too",
  "submit": true
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/letters/239a5dc4-b542-481c-a574-23a123734577\n- Page Title: Airfold",
  "snapshot": "- generic [ref=f1e3]:\n  - alert\n  - generic:\n    - status \"Letter updates\" [ref=f1e4]: Read by Ines Varga at 18:35.\n    - status \"Notifications\"\n    - status \"Connection\"\n  - list \"Conversations\" [ref=f1e86]:\n    - listitem [ref=f1e87]:\n      - link \"Ines Varga I can see the harbour too Read 18:35\" [ref=f1e123] [cursor=pointer]:\n        - /url: /letters/239a5dc4-b542-481c-a574-23a123734577\n        - generic [ref=f1e95]:\n          - generic [ref=f1e96]: Ines Varga\n          - generic [ref=f1e97]: I can see the harbour too\n          - generic [ref=f1e124]:\n            - generic [ref=f1e125]: Read\n            - time [ref=f1e126]: 18:35\n  - generic [ref=f1e40]:\n    - generic [ref=f1e42]:\n      - heading \"Ines Varga\" [level=2] [ref=f1e102]\n      - paragraph [ref=f1e44]: Not verified\n    - list \"Letters\" [ref=f1e45]:\n      - listitem [ref=f1e46]:\n        - article [ref=f1e47]:\n          - paragraph [ref=f1e49]: Good morning from the harbour\n          - generic [ref=f1e50]:\n            - generic [ref=f1e51]:\n              - generic [ref=f1e52]: Received\n              - time [ref=f1e53]: 18:34\n            - button \"Letter actions\" [ref=f1e54] [cursor=pointer]\n      - listitem [ref=f1e55]:\n        - article [ref=f1e56]:\n          - paragraph [ref=f1e58]: The ferry is late\n          - generic [ref=f1e59]:\n            - generic [ref=f1e60]:\n              - generic [ref=f1e61]: Received\n              - time [ref=f1e62]: 18:34\n            - button \"Letter actions\" [ref=f1e63] [cursor=pointer]\n      - listitem [ref=f1e127]:\n        - article [ref=f1e128]:\n          - paragraph [ref=f1e130]: I can see the harbour too\n          - generic [ref=f1e131]:\n            - generic [ref=f1e132]:\n              - generic [ref=f1e133]: Read\n              - time [ref=f1e134]: 18:35\n            - button \"Letter actions\" [ref=f1e135] [cursor=pointer]\n    - generic [ref=f1e103]:\n      - textbox \"Write a letter\" [active] [ref=f1e104]\n      - generic [ref=f1e105]:\n        - button \"Attach photo\" [ref=f1e106] [cursor=pointer]\n        - button \"Attach file\" [ref=f1e107] [cursor=pointer]\n        - button \"Send\" [ref=f1e108] [cursor=pointer]\n      - button \"Photo\"\n      - button \"File\"\n  - complementary [ref=f1e25]:\n    - region \"Contact card\" [ref=f1e136]:\n      - paragraph [ref=f1e143]: Ines Varga\n      - paragraph [ref=f1e144]: ines_59384\n      - paragraph [ref=f1e145]: Not verified\n      - button \"Show seal number\" [ref=f1e146] [cursor=pointer]\n      - button \"Mute\" [ref=f1e147] [cursor=pointer]\n      - button \"Block\" [ref=f1e148] [cursor=pointer]\n  - navigation \"Main\" [ref=f1e26]:\n    - link \"Chats\" [ref=f1e27] [cursor=pointer]:\n      - /url: /letters\n    - link \"Contacts\" [ref=f1e29] [cursor=pointer]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f1e30] [cursor=pointer]:\n      - /url: /settings"
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
  "inlineSnapshot": "- generic [ref=f2e3] [box=0,0,1280,800]:\n  - alert [box=0,0,1280,0]\n  - generic [box=0,0,1280,0]:\n    - status \"Letter updates\" [ref=f2e4] [box=0,0,1,1]\n    - status \"Notifications\" [ref=f2e5] [box=1019,12,249,47]:\n      - 'button \"Ines Varga: Bring your blue coat\" [ref=f2e6] [cursor=pointer] [box=1019,12,249,47]'\n    - status \"Connection\" [box=0,0,1280,0]\n  - list \"Conversations\" [ref=f2e9] [box=12,74,370,175]:\n    - listitem [ref=f2e10] [box=12,74,370,175]:\n      - link \"Ines Varga Bring your blue coat Received 18:35 2\" [ref=f2e11] [cursor=pointer] [box=15,77,364,169]:\n        - /url: /letters/239a5dc4-b542-481c-a574-23a123734577\n        - generic [ref=f2e18] [box=97,89,270,145]:\n          - generic [ref=f2e19] [box=97,89,270,30]: Ines Varga\n          - generic [ref=f2e20] [box=97,122,270,24]: Bring your blue coat\n          - generic [ref=f2e21] [box=97,148,270,86]:\n            - generic [ref=f2e22] [box=91,142,97,97]:\n              - generic [ref=f2e23] [box=118,176,43,18]: Received\n              - time [ref=f2e24] [box=126,189,30,16]: 18:35\n            - generic [ref=f2e25] [box=191,177,28,28]: \"2\"\n  - complementary [ref=f2e27] [box=985,0,295,800]\n  - navigation \"Main\" [ref=f2e28] [box=0,0,394,50]:\n    - link \"Chats\" [ref=f2e29] [cursor=pointer] [box=0,0,131,47]:\n      - /url: /letters\n      - generic [aria-hidden] [ref=f2e31] [box=75,10,28,28]: \"2\"\n    - link \"Contacts\" [ref=f2e32] [cursor=pointer] [box=131,0,131,47]:\n      - /url: /contacts\n    - link \"Settings\" [ref=f2e33] [cursor=pointer] [box=263,0,131,47]:\n      - /url: /settings"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "()=>{let e=document.querySelector('[data-testid=\"unread-badge\"]'); function bg(x){while(x){let c=getComputedStyle(x).backgroundColor;if(c!=='rgba(0, 0, 0, 0)'&&c!=='transparent') return c;x=x.parentElement}} return {text:e?.textContent,color:e&&getComputedStyle(e).color,bg:e&&bg(e),rect:e?.getBoundingClientRect(),radius:e&&getComputedStyle(e).borderRadius}}"
}
```
- Result
```json
{
  "result": "{\n  \"text\": \"2\",\n  \"color\": \"rgb(238, 86, 17)\",\n  \"bg\": \"rgb(17, 21, 43)\",\n  \"rect\": {\n    \"x\": 191,\n    \"y\": 176.96875,\n    \"width\": 28,\n    \"height\": 28,\n    \"top\": 176.96875,\n    \"right\": 219,\n    \"bottom\": 204.96875,\n    \"left\": 191\n  },\n  \"radius\": \"999px\"\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "conversation row",
  "target": "f2e10",
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of conversation row](evidence/reduced/element-2026-11-03T18-35-28-180Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
