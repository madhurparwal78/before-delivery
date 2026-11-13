
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
  "url": "http://127.0.0.1:4173/register"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [active] [ref=e7]\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]\n    - button \"Create account\" [ref=e10] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "inlineSnapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [active] [ref=e7]\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]\n    - button \"Create account\" [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Create account",
  "target": "e10"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "inlineSnapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e7",
      "name": "Username",
      "type": "textbox",
      "value": "Ab"
    },
    {
      "target": "e9",
      "name": "Password",
      "type": "textbox",
      "value": "abc"
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
  "element": "Create account",
  "target": "e10"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]: Ab\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]: abc\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "inlineSnapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]: Ab\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]: abc\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e7",
      "name": "Username",
      "type": "textbox",
      "value": "judge_482731"
    },
    {
      "target": "e9",
      "name": "Password",
      "type": "textbox",
      "value": "plotfold-pass1"
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
  "element": "Create account",
  "target": "e10"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]: judge_482731\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]: plotfold-pass1\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_network_requests
- Args
```json
{
  "static": false
}
```
- Result
```json
{
  "result": "Note: 5 static requests not shown, run with \"static\" option to see them."
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
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "inlineSnapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]: judge_482731\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]: plotfold-pass1\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_console_messages
- Args
```json
{
  "level": "error",
  "all": true
}
```
- Result
```json
{
  "result": "Total messages: 0 (Errors: 0, Warnings: 0)"
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
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]: judge_482731\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]: plotfold-pass1\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({forms:document.forms.length, html:document.querySelector('main')?.outerHTML, scripts:[...document.scripts].map(s=>s.src)})"
}
```
- Result
```json
{
  "result": "{\n  \"forms\": 1,\n  \"html\": \"<main class=\\\"auth\\\"><form class=\\\"surface auth-form\\\"><h1 class=\\\"display\\\">Start drawing</h1><label for=\\\"username\\\">Username</label><input type=\\\"text\\\" aria-label=\\\"Username\\\" autocomplete=\\\"username\\\" id=\\\"username\\\"><label for=\\\"password\\\">Password</label><input type=\\\"password\\\" id=\\\"password\\\" autocomplete=\\\"current-password\\\"><button type=\\\"button\\\" class=\\\"primary\\\">Create account</button><p class=\\\"form-error\\\" role=\\\"alert\\\"></p></form></main>\",\n  \"scripts\": [\n    \"\",\n    \"http://127.0.0.1:4173/app.js\"\n  ]\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/normal/page-2026-11-10T11-25-57-594Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "iVBORw0KGgoAAAANSUhEUgAABQAAAAMgCAIAAADz+lisAAAQAElEQVR4nOzdBbRUVePw4UMJSHeHoCAICnYjKIqoiAgWBioY2GIhtmJjd722WGAgggjSIYoKGCDSoTRK57d1/t99hwtc0de4l/08axbrzJ49cWvpb/Y5Z/IWK1EqAQAAgG1d7gQAAAAiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAo5E0AyJYqVa2eADnTrOlTEwCyHwEMkH0tnD8vAXKakqXLJABkS3aBBgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKORNAIAte/7ph/ffb6+MqzNnzW5yRKskGrVr7XjTdVfW26XOpB+mdL3r/s8+/zIBgBxLAANsU4oULnzGaSfuuGONcmVKl/n1UmrD+g3z5i+YN2/+3PkLfvhhykuvvrl48ZIEtkLx4sWefeKBsmVLh+1d6tZ++rH7jm7VdtasOQkA5EwCGGAbUbBgwbPOOPn0tieUKFE8003VqlYOl9R2u9NP6v5Gz6efe3lLGXxu+9M7XdoxfaRWvX2T7GTX+nXfeu259JGOl1z9cf9BCX+1o5sfnqrflEKFtj/lxFb33PdoAgA5k2OAAbYF1atX7dvr9UsuPGfT+s0kLBF3OOu0/n3ePmC/vRPIUr68md8oz5cvXwIAOZYABsjxQtM++cg95cuV/UN3eaBb11o71Uxgyz4ZPGz16jUZV9evX//RxwMTAMixBDBAzpY7d+4H7+u6Q/VqmcYnT5k2YODQV7q/3av3R6NGj1m1anWmCcWKFnny0W7lypZJYAumTp3e5YauK1auDNtr1669696HnQQLgBzNMcAAOdveezY8cP990kdmzZpz0WWdx3/zXfpg6VIlz+1wxhmnnpg+WKli+fZnndr1zvsT2IJ3e/XpP3DIbvV3+frbCU6fBkBOJ4ABcrada++UaeTKa2/OVL/B/AULQ+guWfLzxRd0SB/fd+89EsjS0qXLho34NAGAnE8AA+RstWptdBzvqlWrv/hy3JYmP/bkf45veXSlShUyRmrX2rFihfKz5/w4akifLZ1Aa+L4kRnbHw8Y3PHiqzJNyJcvX5tWx+zecLfKlSpUqFAurDYvWrRkzo8/hcv3kyY//2L3X5Yu3fRhe/V8Jf0g5Inf/3D0cW0zHrBVy6OaH3Fo9epVy5YpnSdPni433n5Yk4MbNzpws6/wsQfvytgOqb9/o+bJVitSuPBJJxx3RNPGZcuWLlG8+Jo1a8J3Y9LkqQMHDn3n/Q9/9+633dT5hNbHpo/sfeARGSulYXG+9fEtdqlTu1y5MgXy53/nvd5XXXtL+uRSJUucctLx4fsQVuMrVqxQaPvt582fP2dO+NbNHf35F2++/d769eszPeNbrz23a/26GVfDmxp7HXD4Zl/bXV2vP+7YozKurlixYp8Dm61ctWrTmV2uuSx974ANGzYc0rRl+PHtt+9eLzzz8EYzb7w9vKqwMaBvj8qVKmaMjx33TeuTz8q4Wm+XOicc32L3hruWLl2qaJHC8+YvCF/UrNlzBgwc+sGH/ZLf02C3ek0PbdRwt/rhdzX8Oi1fviL8WMeO+/qNt9/7fMxXyRa+FbF9RDMAf4IABsjZNqzfkH41f/7tSpYsMW/e/M1ODjV1932PNGxQP32wePGiIfmSPyU83Tlnn35Sm5ZlypROHw8xGS677bpLs8ObnHpy6+defO2FF7tvNr02VbhwoWeffCDET/L3a9mi+XWdLytapEjGSPiKQo6GS8jvEOGXXXl98mfdeN2VbU86fku3hrS7uGP7I5sdFsI4fTxUZSosWxx9RLvTTgrvWbz/Qd/0CYOGDE+vvmLFiu67z54jR32W6fFz5859yMEHpI8ULFiw2RGHhgjf9MXst8+e6Ve//e77UL/JnxK+geELb33cMemDFcqXC5fQw8ccdUT4um65vduWPky4bp1aN1x7RZiZPlisWL7wZdasUT30fO++/Ttfd1uI+QQA/jgBDJCzTfphSqaRzldefGXnm9etW7fZ+R/27R8uyV8hpM5Tj3YLi4RZTwsLy50uOX+Phrue07FTshWeeOTef6Z+L7v4vPPPaZfFhBCWt9/aJflTLrnwnCzqt2qVSi88+2hY9U2yFJKv2103V6xY/smnX8gY7Nvvk4s6tk+f1vjgAzYN4CaND9p0ST8sdG8awOFlZDof+JChI5I/JcT88888nClfMwnL+Hvt0fDEUzt8P2lyppv22rPh4w/fnf5+xKbCGxNVK1c89cyOYVk4AYA/yFmgAXK2TQP46OaHD+jbo/OVl+y/317bb18w+Xvky5dva+o3Q1iNbHty69+dFl783ns2TP5+B+6/T9b1mxJqrWGDeskfVK5smbPPbLulW0Nwbk39Zrjo/PZ1dq6VcXXi9z9MnTYjfcJ+++656b2aNW2y6WD4qjMtOAdNDz0k08jHnwxO/qCwbn/YoY3uu+fWrOs3Y3JYJc40GH6jut7UOev6Tam3S51ud90Sni48TgIAf4QVYICcbfjI0RMmTqpda8f0wQrly515xsnhsmHDhtlzfpo6bfrkydO+m/j96M+/nDp1+mYf57U3eqZqedf6u+y+8T7Sr77eY/Xq//sUpYkTf0httGl1zKb1+9PceZMnh2eYUa5s2Xp1dy5bdqP9oq+6/IKwUPnD5KmbfQGlS5e69upLD218ULIFHw8YPG36zOTX/avLhGXA9Js+GTQ0dVPy2xmbkt+TO3fu66+9PNk6BQv+sTcRLrmgQ1hQ3bQzM3S6tGOm+l2/fv2UqdPDZf78BdWqVm6wW730J91uu3x3335DyzZnZKzqDx02snq1KhkTwk8/POCs2f/djz3EZJNDNnO8dFi0P+aoI97s8V76YKaziIcf4ldjv07+oBo7VEs/Evt3hbc5TmzT8vU338kY6XDWqdWrV93Ku4ffkyx+VQBgSwQwQM4Woqjzdbe9/srToXk2vTVXrlwhjcLlgP32To2EFeNQoe/26pMpch54+MnU19lVVwAAEABJREFURsizTAH86BPPbXpQcbONEzS48Za7X3ujR8bVEJntz2x7xWUXZIyEqDvqyKYPPfp06mpYyVy5clXuPLlDKoerJUsUb3faSRmTf/xpbqijMV+OG/PFV5k+xPigA/bNFMB9+33S450Pkq3WuNEBm35y8veTJt9z36PTZ8yc8+PcUKH169W57OLzSpcqmfVDzZg1e+y4b5LfzkaWit70he4VK1e++fZ7n44e8+lnX6TOjBXmZDo0d9my5e06XJT+4yhSuHDXW65tdvh/l3BD4u61R4ORn36eutr/kyGnntIm49bwU27S+KCXXnkzYyTE4ZZWRw8/7JD0AA6/NvtsfCbwQYOHJ1vh2+8mLly4OF++vOmr0xk+7j/oxVfeCEm/du3aHXao1vq4Y1q1PCrTnGOPbpYRwOG9kvZnnpppws+//HJ3t0fGjf82rHiXK1t6x5o7dDz3zLD8u9kXs2bN2p/mzk0AIEsCGCDHG//Nd+06XNz1ps5bs4AWKiJcTjrhuJC14ZL8KSFuv/124ncTvs8YCV39xlvvps8Jq5pPPftSyxbNw9NlDJYqVSJj+/Krbgj/lilTetgnvTI9/uChIy+74rrNnjv6L9Fkk8XDEKjndLw847DS8KWFS7/+g7q/9FRY28zioZ58+oXUAbp93n8908yZs2a3P++yyVOmpQ9WqlThrZ7vp48MHDws05sR4Qu/4Za70gM4+W2FPGN72IhPQxym7y0cVnHTAzjTfdPtu8+eIbAzvreNDt4/LAunTwh1nWyFCy65Jvlt4Td84ZluevKZF7s98FjG1QULF332+Zfh+xlW+NOnVa7835NIN2vaJFOxh4Xo0866IGOHhdDA4TJg4NB77rgxLGJnesbLrrw+0/cZADZLAANsC0Z/9sVRx7U9r8MZYX0v0+7Qm5U3b95LLjxn1/p1z73giuSPC3F7xz0Pbs3MEIHpAVyyRInfvcvq1Wtuvu2ev69+g4MP3C/9alhFD8+46UmVwprtTbfe/eJzjyZ/ykOPPL1plf0weertdz3wu/cNTx0uxYsXyxjJtBY9cNDwFkf/twP32mOjA6czfYHhS8s4Gjzk7lHNm3Z/o2fq6kEHbLT/89Klyz4ZNDT5H4Sf+COPP7Pp+PMvdQ/vhtSt89/l4nJly4ToTe2yvsMm7910u/+xTXfXD794t3S9d//99i5V8vd/kQBgUwIYYBuxZs2ahx97JlwqVSx/1JFNGzbYtd4uO4fGyOIujRsdeOopbV5+9c3kfxCSps3xx+5QrWpY0KtYoVxI6ywmb83xtGFFdMbMWcnfpmSJ4pm+LcNHjt70jMQpIz/9PCxFZv1t3Ky5c+f/7scIhx9To4P2q1qlclgWLlumdK5cubKYnOl8ZuG7lB7AoSQPOfiAMBi2mzc7LH01dfacH/v2++TM00/OGAnvkmQE8H77bHQgd1hbTv43Y74Yl2mX9QyjPv08PYDD17tTzRpffPXrx1ZXqVI5feasWXO29N1b8vMvYT35iKaNEwD44wQwwLZm1uwfn3r2pdR2KKt9994jtHD9enXr7LzTpol1yQUdQh1t6XODs1azRvWrOl0YuivrcvujZs6cnfyd0pdVU6bPyKq3p02f+ScCeNacOVncevCB+3a6tONmj57dSv0/GRI6M33v5UYH758K4Ez7P/fu8/H7H3yUHsD77bNneBdg4aLF1atXTT+ZVrLVBwBnYdbsLX7h06bPyDSSEepV03aHDqZuMnOjW7dwIjcA+F0+BglgWxZW0t7u2ev6m+9s2eb0xocfF9aHM50kuVixoocctH/yx4UFyScf7RbWkP/a+k1+O/1V8ncqUCDz+Zmz7v+1a9Ymf1xYAd7STWEV9NEH7/5f6jdYsWLFqNFj0kf2/+3DkArkzx9WldPH3+rx/rffTZz4/Q8ZI3ny5DmqedPkt48FTp+5du3afv0HJv+bVatWbemmlVu+qVz5sulXs/6JrFi5MgGAP0UAA8Ri9pwfQwB3e/DxTOPlN26PrXTvHTdVrVIp+Rus/f8f9vM3mTd/YaaRrE/1nCdvnuSPW7d+/WbHixUt8tB9d2Q679SfM2jIsPSrO1SvFlZ0Q9Om72f+3YTvU8chh3X+9Mmpz/7NODd4yudfjF3y8y/Jv2HpLxsd8p1+xq9NFSxQIAGAP8Uu0AA52IPduh658QcCdbzk6o/7D8riLh982O/GLhud+KrkHz+fUMUK5Q87tFH6yOdjvnr5tbfGfDF2zo8/pY+//Pzje+/ZMMlOwupiWOpMP1a58sb732ZSuWKF5K9zeNPGmd446PHOB7379Ptq7NeZ4nPc54Oz7uTeH358fedO6SOHNT4400dY9fv/vww93v3goo7tM8b33XuPCuXL7bvxByANHjIi+ZcsWrykTJn/fmp01t/zrf+4YADIxAowQA42dVrmQyWbNjk467tsunqWaaforbFjzeqZRi7u1CWkdab6Df1We6eaSfYz6Ycp6Vf32XuPLa1mh9aqWLF88tepVnWjY27D8uw11906eOjITPW75x4NfneVeMHCRV9+NT59pOlhjfbfeFE3dG9qY9asOeHtifSbbr+1S6YH7NtvQPIvSd9DO6hatXKmks8QOjnTwjUAbD0BDJCDbfqJNcccdcSxRzfL4i7ppw5OyeKsRVuSvliX/HrY5+rNHrR56sltihUrmmQ/I0Z9ln41vClw+63XbbojdPHixR7q1vWvPcg507MsWLBws9PObtc22QpDho1Mv9pwt/rpJ4se8+W40L0ZV/t+vNFe0JkyMiRo1icD+1tlOvlW7ty5O1916WbPGX7tVZdk+sRgANh6AhggBwsLgOO//jZ9JG/evHfefsO9d9580AH7ZppcpHDhizq2v+zi89IHQ7v2+egPr/v9MHlq+tWwVnlC62PTR/LkyXPqKW0yPVdQvVqVa6++NFx2rr1T8u8ZNCTzuY733rPhh+91v/Sicw/cf5/wjQovr83xLXq/+9qmr7No0SKpLyG815D8cZkW7evVq5PpbFglSxS/+YarDm18UKY7hqXd1POG723GYKYjezP5aOPi7flu73VbPr568NB/bf/noP/AIWvWrEkf2W3XXXq/82qrlkeF708o4fCb07jRgW+++uxRRzZNAODPcgwwQM52/0NPPvvkA+kjeXLnDsu84RLidtHixQsXLl679tfzGFevXqVokSKZ7v7m2+8uXrwkfWTFihWZ5lxw3lmrV//3k10fe/I/48Z/u3r1mu22y5cxePMNV4dCGzXq87Xr1tbbZefDD2tcanOHFletUqndaSclv35a7NjvJnyf/CnLlmXeZ/uIpo3TS7VP3/5h8TOLRxg+YvS48d/Ur1c3fTAsVnc898zk94TvYepLeOe93u9/0Df5g775bkL61bD4/OoLT4SH+mrcNyWKF9ttt3pNDjmwQP78m94xJHrqaOpuDzyW0bFh2Xbq1OmbPSY2zOnxzgfpI+EHHZa+Q+Enm/PxgMHJv2fp0mXd33jntLZt0gcrVapw523XJwDw1xHAADnbkGEjn3+peyrJMgkLs+XLlQ2XLd132vSZoZ8zDW66H+wpJ7ZKv/ryq2+GlOr57gcntmmZMRiqu/kRhzbf+IxcyW9hc+Otd4ckTv8c2v/RdxMnZRoJa4PpV6dMmZ51AAedr+/a4/Xn0xs+C8NGfBoWvU9ve0LyPxs2/NNQ/um5XqjQ9m1Pbt12k2/PhImTHnz06bYnHZ/1Ia9Dho3abACP+nRMprc2gg/79N9sAP80d16mI4T/efc+8FjjQw6oXKni784Mv1T2ggbgz7ELNECOd/tdD1zSqcuUqdP+0L2+nzS5XfsLf1m6NNP4wMHDfv7l9z8L565uD6cfX7pZYRGy8/W3hWXSTCed+h8tX75i5MYH8f4JYe30siuvz+KTaTOMHffNOR073XPfI8lfIXxPrr2+a1g/z3ra/AULL/jthN5ZfyJu8uvOw5tfue2zuTNahZ/FZj9Ed+iwUcm/bcWKFR3OvzykeNbTQv3evcnPYv2GDQkAbAUBDLAt+LBv/yOOPjFk8O+ufCa/LfzecMtdx7Q6ddbsHze9NQTGo088t+H3iiJMu+DSq0eMHL2lCUt+/qX9eZdlfZDqn/bAI09tTbtmrV//gR3OuyyL4lq3fn1Y7j797AsyHZ76Pxr/zXdXdr4pizNOffPtxBPbdtjKU1INHzF64aLFmQZDYPfq/dGmk8M3LdPpplIGDByaZANhmf2kUzuE78+WJoT3BS676vr5m5w5LPdfeqIyALZhdoEG2HaEDA6X3RvUb9CgftUqlWvWqF65YoVy5cqEFp07d17IpPDv51+MfavH++vXr8/icf7zwmujP/vy9FNP2Gev3SuUL7elaaHTzmh/0X777nXs0c122KFqeMYihQsvWLhwzpyf+vUf9PY7vTbdBfevMuaLsU2PbN3h7NP23XuPnXas8adP1Dxq9JhDmrY8pvnhxx3bvGLFCiVKFCtUqNDChYtCFYewfKvHe5t+0NRfIvyYwlsDp5x0/F57NKhWtUq1qpXDlxC67ofJU3r17tfnowF/KLnD+m2mk3sPHjpiS59uFZ662eFN0kfCinpY9k+yh/CmTKsT2h3a+KAT27TcoXq1kiWLh1+q5LcDmN/7oO9Tz744d+78li2ap98l/DL/+NPcBAC2Qq5iJUolAGQ/lapWXzh/XgJsrMs1l51x6okZV2fMnHVos+OT7KRk6TKzpk9NAMh+rAADAP+mfPnyvfjsI+HfjJHly5ef07HTZvdyr1mjestjjkwf+WuPMAdg2yaAAYB/05o1a+bOm3/kxqcQf/qJ++9/6In0c1MXyJ+/TesWZ7drW6xY0fSZmT6VGgCyIIABgH/Z2z3fzxTA++y1e/eXnpo8ZVpY4F20aPHOtXeqXXvHTT8hedmy5W+89W4CAFsnT4GC2ycAZD9FixVfsXx5AhGYNn1myZIldq1XN9N4iRLFa9aoXm+XncuXK5s372betb+6yy2jP/siyWYKbl/olyWLEwCyHwEMkE0JYKIyaPDwkiWK71q/7tbf5aVX3nzmPy8n2Y8ABsi2BDBANiWAic2gIcPnzptfokSxLD58K+Wzz7/sfEPXV7q/lWRLAhgg2/IxSADZlI9BIlo77VijZYsjq1WtUr5c2XApVarE4iU/z5+/IOTx3LnzPxk09KOPBybZmI9BAsi2BDBANiWAIYcSwADZVu4EAAAAIiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhggB/ti1ICjjmyacfXkE1oN7PdOAgDA5ghgAAAAopA3AWBbdOH5Z7ds0bxI4UJDh4+69oauq1atrlmjeqdLzt97792//vq7+x9+8mcByBcAABAASURBVMuvxodpwwf1fvCRp449utkvS5eee8EVPd54ftq0GTvtWKNChXK9P/z4ltu7rVmzJk+ePLfccPVBB+673XbbvfNu7zvvfSjc8frOnXapWzt37tx1dq418ftJna/vekOXK3arv8u06TM6XX3jhImTwpzDDm109hmn7Fhzh0FDRtx+1/0LFy1OAAD+PVaAAbZBoXU7nH3a1V1uadvu/FCz7U4/OV++fE88cu/c+QuOa9Nu+MjRTz92X5kypVOTTzulzRNPPx/qN3V1l7o73373Ax3Ou2z3hrvedN2VYeSsM07ZY/fdOpx/eZcburY8tnnr445JzaxTp9bLr715+lkXFCpUqPtLT/XtN6D1yWctXbb8qk4XhlvD897d9YYP+nzc5pSzc+fO9dhDdycAAP8qAQywDVq6dFmyYUOVypVWrFjR4vjTnnz6hUYH7VesaJGbbr17xsxZTz7z4k9z5x1y8P6pyX0+GjB46MiM+37wYb/hI0aP+XJcz3d777brLmFkxMjRna6+ISzq9v9kyOChI+rXr5Oa+eWX497r1feLr8a9/0HfefPnv/TKm2FO99d71NqpZri1datjPhvz5cuvvjl12oybu94bcrpihfIJAMC/xy7QADnYhg0b8ubJk3E1T948Gzb8uhH69tbb7zupTcuuN3ee8P0Pl3bqUq5smeLFi00c/9/QLVmyRGojBGr6Y65cuTK1sWzZ8u222y5sFCq0/aUXnVtvlzr58/969e2evf5v5qpV//8uq1atWp0xuF2+fGGjbJnShxx8QPozlilTavacHxMAgH+JAAbIwZYs+blGjeoZV2vWqL5o8eLUxuSp00467ZyCBQved/ct553Trt/Hg+bOnX9gk6M3fZANqWjesg5nnx4i+fyLr1q8eMn999yabJ2ffpoX1pYvvvzaBAAge7ALNEAO1n/gkNNOaXPyCa0OO7TRaW3btDq2+YBPhiS/Hsdb+6nHuoUMDiuz69atW7li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LzjnwW63h1fS8eL/W4h+7+2XG+xWL7V9WtsTrr2ha/q9AAC2JFexEqUSALKfSlWrL5w/L4sJJUuXmT1zxqbjE8ePOvOci4cNH5VstbCue9CB+w4fOfqX3w4JvvqKixrsWu/k089NgE1UrFzld/82Z02fmgCQ/VgBBtgGbVi//g/NX716ddebu3w1bvyd9zy0YuXK44875vmXum925tHNDw8LxZkGb7z17l69P0oAALI3AQywTZk+6culS5dNmDjpD91r7bp1J7Q9+5orL3n3rZeW/PxLqNknnnp+szPDTVoXAMihBDDANqXqjg2SP2XylGnndLw8AQDYdjkLNAAAAFEQwAAAAETBLtAAOVjFylUSAAC2jgAGyKmy/iAWAAAysQs0AAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAOVif91+fOH5kuEwYN6L3u6+ddMJxSbZxbvvTe7zxfAIAkG0IYICc7a57H65Vb9+G+zR5s8d7N3a54uAD900AANgcAQywLVi+fMV/Xnjt628mNNitfp48ebrefO3g/u+NHNLnmisuTk2otVPNF555+MtPP+nx+n8OP+yQMJI//3b333Pr6GEfffTBm+ef0+6C884KN6Umd7nmsnGfDy5YsGDYbnZ4k6EDeoWNalUrP9it6+jh/d589dljj26Wmnl2u7avvvBEx3PPHDWkz67165YpU/qh+24fM7J/WPstWrRIAgCQnQhggG1E7Vo77lx7p2++nXDWGafssftuHc6/vMsNXVse27z1cceEWzued9aPP81telSb93r1vfXGa3Lnzt3m+GN3qF6t5Qln3HzbPeecffpPc+fVqVO7SOHCYfJ+++y5fPnyxgfvH7b32qPhZ198FeY/+Wi3DRs2tGx92ls93+96S5d9994j9bw1a1SvXLli82NPHjvum/DI1atVOfn0c5965sXjf3teAIDsQwAD5GxXX3FR6jDg93u83Lvvxx8PGDxi5OhOV98wYeKk/p8MGTx0RP36dcK0ZcuWFS1aNMTqK93f3uegZuvXr1+6dFmhQtvvVLPG+K+/bbhPk7d6vP/Lz7/st++elSqWL1eubPc33znowP3CHRs2rD969JjGjQ4oU6bUNV1unTX7x9fffOfjAYNObNMy9QJy58kTEnrBwkWF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AEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAjJ7GJQAAAgVJREFUAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQhf8HAAD//xaudPIAAAAGSURBVAMAw/8Sj2nx8AkAAAAASUVORK5CYII=",
      "mimeType": "image/png"
    }
  ]
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/register"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=f1e3]:\n  - generic [ref=f1e4]:\n    - heading \"Start drawing\" [level=1] [ref=f1e5]\n    - generic [ref=f1e6]: Username\n    - textbox \"Username\" [active] [ref=f1e7]\n    - generic [ref=f1e8]: Password\n    - textbox \"Password\" [ref=f1e9]\n    - button \"Create account\" [ref=f1e10] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "inlineSnapshot": "- main [ref=f1e3]:\n  - generic [ref=f1e4]:\n    - heading \"Start drawing\" [level=1] [ref=f1e5]\n    - generic [ref=f1e6]: Username\n    - textbox \"Username\" [active] [ref=f1e7]\n    - generic [ref=f1e8]: Password\n    - textbox \"Password\" [ref=f1e9]\n    - button \"Create account\" [ref=f1e10] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e7",
      "name": "Username",
      "type": "textbox",
      "value": "judge_593842"
    },
    {
      "target": "f1e9",
      "name": "Password",
      "type": "textbox",
      "value": "plotfold-pass1"
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
  "element": "Password field",
  "target": "f1e9"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=f1e3]:\n  - generic [ref=f1e4]:\n    - heading \"Start drawing\" [level=1] [ref=f1e5]\n    - generic [ref=f1e6]: Username\n    - textbox \"Username\" [ref=f1e7]: judge_593842\n    - generic [ref=f1e8]: Password\n    - textbox \"Password\" [active] [ref=f1e9]: plotfold-pass1\n    - button \"Create account\" [ref=f1e10] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=f1e3]:\n  - generic [ref=f1e4]:\n    - heading \"Start drawing\" [level=1] [ref=f1e5]\n    - generic [ref=f1e6]: Username\n    - textbox \"Username\" [ref=f1e7]: judge_593842\n    - generic [ref=f1e8]: Password\n    - textbox \"Password\" [active] [ref=f1e9]: plotfold-pass1\n    - button \"Create account\" [ref=f1e10] [cursor=pointer]"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/folders"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/folders\n- Page Title: Plotfold\n- Console: 2 errors, 0 warnings",
  "snapshot": "- main [ref=f2e3]:\n  - heading \"Folders\" [level=1] [ref=f2e4]\n  - button \"New folder\" [ref=f2e5] [cursor=pointer]\n  - status \"Notices\"",
  "events": "- New console entries: evidence/normal/console-2026-11-10T11-29-27-728Z.log#L1-L6"
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
  "page": "- Page URL: http://127.0.0.1:4173/folders\n- Page Title: Plotfold\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- main [ref=f2e3]:\n  - heading \"Folders\" [level=1] [ref=f2e4]\n  - button \"New folder\" [ref=f2e5] [cursor=pointer]\n  - status \"Notices\""
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/normal/page-2026-11-10T11-29-37-078Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "iVBORw0KGgoAAAANSUhEUgAABQAAAAMgCAIAAADz+lisAAAQAElEQVR4nOzde9zX8+H/8Y9CRXR1XBOVFAs5n6M5bM6HooaWYWZzmMM2chhirZHTGJFaJBIV5RRytnKcU5jjSHQSOjBph/ze5Hbt4+q6rsr2W9/teb/f3je3z/v1fn3en6vLX4/r9f683ys2aty0BAAAAP/r6pQAAAAggAAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgggAGAAAgwoql/3KvvfRUgwb1K3dH3Xzrz08+o7TsXn7h8Yarrlq5O/a2ccedeEoJAACA/xVfM4C32GyTMaOvK30tB/f60YRHnygBAADAf5BLoAEAAIgggAEAAIgggAEAAIgggAEAAIjwb7sL9ICBQ847/5ISAAAA/J9kBRgAAIAI/1eeA9xqjW8efOABXXbYtnmzZhUVqzdosMpHH300Z+7cadNm3HXPfaNG3/qXTz4p/QvatF7riMN7bbXlZt9o0byiccW8efOmTp3+3PMv3n7n3Y89/lRpGbVs2aLXwd/b8dudmzZtUlHRqEH9BsWPOnv2nFdeff2mUWMeenjC4m+57+4x663bvnL31dfe+M7u3Ra9Xmmllb7Xfb+999q93dptWrRovmLdur1PO3vETTeXv32jThsc2KNr2zatW7Vao/hdzZ8/f+q06cU/4dXXXh82fOTMme+VAAAAqNXyD+BmTZv063vGbt/dpW7dryxHF2FZbEXybbftVqf2PnHI1dddcPHlpWVXp06dPmf0/sEhBxVhWTnYpHHjYuu04fq9evYYOmzEWeecu5RnW3WVVfqec/r+Xfep8tM2bdK42Nqvs/bee+76+ut/PunUs555dtLSnLBhw4bXDx24+WYb1zRhh87bnHj80UW6lw/Wr1+vceOKDTfouNuuOx/148OLvxFccNHlb095pwQAAEANlvMl0DvvuMM9d47ec/fvVunJKorsPP6nPxk7+vo1vtmytCxWWaXB8GGDfnjY98vrt9wKK6xw+KE9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b7roUJHEJQCgBiuWAIBaTXj0ibvuue+8vmd8/rXgzz4rRt57//0ica+9/qbyafc9+MipvU/YZ89dJz72ZLH76GNP7rHrzh3X6/DAQxNqOvN7773fseO6i17XqVNnrVZr3DP+gfIJs+fMWbPVGoteN2/2ZeXOnDmrWOk9/uenL37CRT8eAFAtK8AAsGS/Of/StdZqteEGHT9fFS6VRo2+rVfPHs2bN6tfr94lF/UbfMXFxeDUqdOLrdfB3f8w4bFid8LEJw475KA333p71qz3azrtiFFjNt2400+OPPSbLb9x5mk/r1e/3h3jxpdPuOueB4oTfmfnLnXr1j2g2z6LBkfefGvn7bbafLONi9c/PKznow+Pa9CgQQkAWBIBDABLNmfO3F+fe/HKK3/5TODRY24fdfOt1wy6dNLTDzepaNSn75e3ofrj08+ttlrDe+9/pHg9/r4HV2+0+tPPPF/LaSdPnnLsiad06bzNnWNvaNNmraOPO3nuvI/KJwwZOnzs7Xf1Pfu0+++++amnn100WET1L3r3OenEY16e9OhB3buefOrZ8+fPLwEAS7JCo8ZNl+kNrVq3/fD9WSUAAABYfpo0az51yuRleYcVYAAAADIIYAAAACIIYAAAACIIYAAAACIIYAAAACIIYAAAACKsWFp2TZo1LwEAAMB/lWV+DjAAAAD8N3IJNAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMAAAABEEMEAJAIAEAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAADplevUAAAOGSURBVIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAIAhgAAIAI/w8AAP//vcIyrwAAAAZJREFUAwAIIMe4Cpp/VgAAAABJRU5ErkJggg==",
      "mimeType": "image/png"
    }
  ]
}
```
