#!/usr/bin/env python3
"""End-to-end smoke test for the Pinsheet API."""
import json
import sys
import urllib.request
import urllib.error
import http.cookiejar

BASE = 'http://127.0.0.1:4173'
MAILPIT = 'http://mailpit:8025'


def new_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


class Client:
    def __init__(self):
        self.opener = new_opener()

    def req(self, method, path, body=None, headers=None, raw=False):
        data = None
        hdrs = dict(headers or {})
        if body is not None:
            if raw:
                data = body
            else:
                data = json.dumps(body).encode()
                hdrs.setdefault('Content-Type', 'application/json')
        r = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
        try:
            resp = self.opener.open(r)
            payload = resp.read()
            parsed = None
            if payload:
                try:
                    parsed = json.loads(payload)
                except Exception:
                    parsed = None
            if raw and parsed is None:
                return resp.status, payload
            return resp.status, parsed
        except urllib.error.HTTPError as e:
            payload = e.read()
            parsed = None
            if payload:
                try:
                    parsed = json.loads(payload)
                except Exception:
                    parsed = None
            if raw and parsed is None:
                return e.code, payload
            return e.code, parsed


def latest_code_for(email):
    msgs = json.loads(urllib.request.urlopen(f'{MAILPIT}/api/v1/messages?limit=50').read())
    for m in msgs.get('messages', []):
        msg = json.loads(urllib.request.urlopen(f"{MAILPIT}/api/v1/message/{m['ID']}").read())
        text = (msg.get('Text') or '').replace('\r\n', '\n')
        if email in str(msg.get('To')) and 'code is' in text:
            return text.strip().split('code is ')[1].split('.')[0]
    return None


ok_count = 0
fail_count = 0


def check(name, cond, detail=''):
    global ok_count, fail_count
    if cond:
        ok_count += 1
        print(f'  ok    {name}')
    else:
        fail_count += 1
        print(f'  FAIL  {name} :: {detail}')


def multipart(fields, file=None, filename='x.png', filebytes=b''):
    boundary = 'BOUNDARY123'
    out = b''
    for k, v in fields.items():
        out += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    if file:
        out += f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()
        out += filebytes + b'\r\n'
    out += f'--{boundary}--\r\n'.encode()
    return out, f'multipart/form-data; boundary={boundary}'


PNG = (bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b'\x00\x00\x00\rIHDR'
       + b'\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89'
       + b'\x00\x00\x00\x0aIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\x0d\x0a\x2d\xb4'
       + b'\x00\x00\x00\x00IEND\xaeB`\x82')


def main():
    owner = Client()
    contrib = Client()
    stranger = Client()
    viewer = Client()

    print('== health ==')
    status, body = owner.req('GET', '/api/health')
    check('health ok', status == 200 and body == {'status': 'ok'}, body)

    print('== signup + verify ==')
    status, body = owner.req('POST', '/api/auth/signup', {
        'display_name': 'Amy Holt', 'email': 'amy@example.test', 'password': 'pass-amy-1'})
    check('signup 202', status == 202 and body == {'status': 'code_sent'}, body)
    code = latest_code_for('amy@example.test')
    check('code mailed', code is not None and len(code) == 6, code)
    status, body = owner.req('POST', '/api/auth/verify', {'email': 'amy@example.test', 'code': code})
    check('verify 200', status == 200 and body['user']['display_name'] == 'Amy Holt', body)
    status, body = owner.req('GET', '/api/me')
    check('me 200', status == 200 and body['user']['email'] == 'amy@example.test', body)

    c2 = Client()
    c2.req('POST', '/api/auth/signup', {'display_name': 'Bad', 'email': 'bad@example.test', 'password': 'password-123'})
    status, body = c2.req('POST', '/api/auth/verify', {'email': 'bad@example.test', 'code': '000000'})
    check('wrong code 422', status == 422 and body['errors']['code'] == 'That code is wrong or has expired.', body)

    status, body = owner.req('POST', '/api/auth/signup', {'display_name': '', 'email': 'x@y.test', 'password': 'password-123'})
    check('empty name 422', status == 422 and body['errors']['display_name'] == 'Display names are 1 to 40 characters.', body)

    status, body = owner.req('POST', '/api/auth/signup', {'display_name': 'Dup', 'email': 'amy@example.test', 'password': 'password-123'})
    check('confirmed email 422', status == 422 and body.get('errors', {}).get('email') == 'That email already has an account.', body)

    print('== signin ==')
    status, body = contrib.req('POST', '/api/auth/signin', {'email': 'amy@example.test', 'password': 'wrong'})
    check('wrong creds 401', status == 401 and body['error'] == 'wrong_credentials', body)
    status, body = contrib.req('POST', '/api/auth/signin', {'email': 'amy@example.test', 'password': 'pass-amy-1'})
    check('signin 200', status == 200, body)

    print('== create board ==')
    status, board = owner.req('POST', '/api/boards', {'title': 'Spring trip', 'sections': ['Ideas', 'Booked', 'Done']})
    check('board 201', status == 201 and board['role'] == 'owner', board)
    bid = board['id']
    sec = {s['title']: s['id'] for s in board['sections']}

    status, body = owner.req('POST', '/api/boards', {'title': '', 'sections': []})
    check('board title 422', status == 422 and body['errors']['title'] == 'Give your board a title.', body)
    status, body = owner.req('POST', '/api/boards', {'title': 'T', 'sections': ['a'] * 13})
    check('sections 422', status == 422 and body['errors']['sections'] == 'Add between 1 and 12 sections.', body)

    print('== privacy: private ==')
    status, body = stranger.req('GET', f'/api/boards/{bid}')
    check('stranger 404', status == 404 and body['error'] == 'not_found', body)
    status, body = stranger.req('GET', '/api/boards/does-not-exist')
    check('unknown id 404', status == 404)

    print('== posts ==')
    data, ctype = multipart({'section_id': sec['Ideas'], 'title': 'Lake day', 'body': 'Swim at noon'}, file=True, filebytes=PNG)
    status, post = owner.req('POST', f'/api/boards/{bid}/posts', data, headers={'Content-Type': ctype}, raw=True)
    check('post+png 201', status == 201 and post['attachment']['content_type'] == 'image/png', post)
    pid1 = post['id']
    att_id = post['attachment']['id']

    data, ctype = multipart({'section_id': sec['Ideas'], 'title': 'Beach day', 'body': 'x'})
    status, post = owner.req('POST', f'/api/boards/{bid}/posts', data, headers={'Content-Type': ctype}, raw=True)
    pid2 = post['id']
    check('post pos 2', status == 201 and post['position'] == 2, post)

    data, ctype = multipart({'section_id': sec['Ideas'], 'title': 'Cove walk', 'body': 'x'})
    status, post = owner.req('POST', f'/api/boards/{bid}/posts', data, headers={'Content-Type': ctype}, raw=True)
    pid3 = post['id']

    data, ctype = multipart({'section_id': sec['Ideas'], 'title': ''})
    status, body = owner.req('POST', f'/api/boards/{bid}/posts', data, headers={'Content-Type': ctype}, raw=True)
    check('empty title 422', status == 422 and body['errors']['title'] == 'Give your post a title.', body)

    data, ctype = multipart({'section_id': sec['Ideas'], 'title': 'Nope'}, file=True, filename='x.svg',
                            filebytes=b'<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    status, body = owner.req('POST', f'/api/boards/{bid}/posts', data, headers={'Content-Type': ctype}, raw=True)
    check('svg 415', status == 415 and body['error'] == 'unsupported_type', body)

    data, ctype = multipart({'section_id': sec['Ideas'], 'title': 'Big'}, file=True, filename='big.png',
                            filebytes=PNG + b'\x00' * 250000)
    status, body = owner.req('POST', f'/api/boards/{bid}/posts', data, headers={'Content-Type': ctype}, raw=True)
    check('oversize 413', status == 413 and body['error'] == 'file_too_large', body)

    status, listing = owner.req('GET', f'/api/boards/{bid}/posts')
    ideas = listing['sections'][0]
    check('order by hand', [p['title'] for p in ideas['posts']] == ['Lake day', 'Beach day', 'Cove walk'],
          [p['title'] for p in ideas['posts']])
    check('section count', ideas['count'] == 3)

    print('== moves ==')
    status, moved = owner.req('PATCH', f'/api/posts/{pid3}/move', {'section_id': sec['Ideas'], 'position': 1, 'version': 1})
    check('move C to 1', status == 200 and moved['position'] == 1, moved)
    status, listing = owner.req('GET', f'/api/boards/{bid}/posts')
    check('worked example 1', [p['title'] for p in listing['sections'][0]['posts']] == ['Cove walk', 'Lake day', 'Beach day'],
          [p['title'] for p in listing['sections'][0]['posts']])
    check('version rose', listing['sections'][0]['posts'][0]['version'] == 2)
    pid1_version = listing['sections'][0]['posts'][1]['version']

    status, moved = owner.req('PATCH', f'/api/posts/{pid1}/move', {'section_id': sec['Booked'], 'position': 1, 'version': pid1_version})
    check('cross move', status == 200 and moved['section_id'] == sec['Booked'], moved)
    status, listing = owner.req('GET', f'/api/boards/{bid}/posts')
    check('gap closed', [p['title'] for p in listing['sections'][0]['posts']] == ['Cove walk', 'Beach day'])
    check('booked holds A', [p['title'] for p in listing['sections'][1]['posts']] == ['Lake day'])
    pid2_version = listing['sections'][0]['posts'][1]['version']
    done_count = len(listing['sections'][2]['posts'])

    status, body = owner.req('PATCH', f'/api/posts/{pid2}/move', {'section_id': sec['Done'], 'position': 5, 'version': pid2_version})
    check('out of range', status == 422 and body['errors']['position'] == f'Position must be between 1 and {done_count + 1}.', body)

    status, body = owner.req('PATCH', f'/api/posts/{pid2}/move', {'section_id': sec['Ideas'], 'position': 1, 'version': pid2_version - 1})
    check('stale version 409', status == 409 and body['error'] == 'conflict' and body['post']['version'] == pid2_version, body)

    status, body = owner.req('PATCH', f'/api/posts/{pid2}/move', {'section_id': 'sec_otherboard', 'position': 1, 'version': 3})
    check('foreign section 404', status == 404 and body['error'] == 'not_found', body)

    print('== reactions ==')
    status, body = owner.req('PATCH', f'/api/boards/{bid}', {'privacy': 'public'})
    check('make public for reactions', status == 200, body)
    status, body = owner.req('PUT', f'/api/posts/{pid2}/like')
    check('like', status == 200 and body['liked'] and body['likes'] == 1, body)
    status, body = owner.req('PUT', f'/api/posts/{pid2}/like')
    check('like idempotent', status == 200 and body['likes'] == 1, body)
    status, body = owner.req('PUT', f'/api/posts/{pid2}/vote', {'value': 1})
    check('vote up', status == 200 and body['score'] == 1, body)
    status, body = owner.req('PUT', f'/api/posts/{pid2}/vote', {'value': -1})
    check('vote switch', status == 200 and body['score'] == -1, body)
    status, body = owner.req('DELETE', f'/api/posts/{pid2}/vote')
    check('vote removed', status == 200 and body['score'] == 0, body)
    status, body = stranger.req('PUT', f'/api/posts/{pid2}/like')
    check('signed-out like 401', status == 401 and body['error'] == 'sign_in_required', body)

    print('== comments ==')
    status, c = owner.req('POST', f'/api/posts/{pid2}/comments', {'text': 'Yes!'})
    check('comment 201', status == 201 and c['text'] == 'Yes!', c)
    status, body = owner.req('POST', f'/api/posts/{pid2}/comments', {'text': ''})
    check('empty comment', status == 422 and body['errors']['text'] == 'Write a comment first.', body)
    status, body = owner.req('POST', f'/api/posts/{pid2}/comments', {'text': 'x' * 501})
    check('long comment', status == 422 and body['errors']['text'] == 'Comments can be at most 500 characters.', body)
    status, comments = owner.req('GET', f'/api/posts/{pid2}/comments')
    check('comment listed', len(comments['comments']) == 1 and comments['comments'][0]['author']['display_name'] == 'Amy Holt')

    print('== attachments ==')
    status, body = owner.req('GET', f'/api/attachments/{att_id}', raw=True)
    check('attachment png', status == 200 and body[:8] == PNG[:8])
    owner.req('PATCH', f'/api/boards/{bid}', {'privacy': 'private'})
    status, body = stranger.req('GET', f'/api/attachments/{att_id}', raw=True)
    check('stranger attachment 404', status == 404)
    owner.req('PATCH', f'/api/boards/{bid}', {'privacy': 'public'})

    print('== password board ==')
    status, body = owner.req('PATCH', f'/api/boards/{bid}', {'privacy': 'password', 'password': 'hunter2hunter2'})
    check('privacy password', status == 200 and body['privacy'] == 'password', body)
    status, body = stranger.req('GET', f'/api/boards/{bid}')
    check('password_required', status == 403 and body['error'] == 'password_required', body)
    status, body = stranger.req('POST', f'/api/boards/{bid}/unlock', {'password': 'wrong'})
    check('wrong password 404', status == 404 and body['error'] == 'not_found', body)
    status, body = stranger.req('POST', f'/api/boards/{bid}/unlock', {'password': 'hunter2hunter2'})
    check('unlock 204', status == 204, body)
    status, body = stranger.req('GET', f'/api/boards/{bid}')
    check('unlocked read 200', status == 200, body)
    status, body = owner.req('PATCH', f'/api/boards/{bid}', {'privacy': 'password', 'password': 'changed-pass-1'})
    status, body = stranger.req('GET', f'/api/boards/{bid}')
    check('password change relocks', status == 403 and body['error'] == 'password_required', body)

    print('== links ==')
    status, body = owner.req('PATCH', f'/api/boards/{bid}', {'privacy': 'public', 'link_access': 'view'})
    check('public view', status == 200, body)
    token = body['share_path'].split('/')[-1]
    check('embed path present', body['embed_path'] == f'/embed/{token}', body['embed_path'])
    status, body = stranger.req('GET', f'/api/links/{token}')
    check('link read 200', status == 200 and body['board']['title'] == 'Spring trip', body)
    status, body = stranger.req('GET', '/api/links/nope')
    check('dead link 404', status == 404)

    status, body = owner.req('PATCH', f'/api/boards/{bid}', {'link_access': 'contribute'})
    token = body['share_path'].split('/')[-1]

    print('== join via link ==')
    viewer.req('POST', '/api/auth/signup', {'display_name': 'Dee Ito', 'email': 'di@example.test', 'password': 'password-di'})
    code = latest_code_for('di@example.test')
    viewer.req('POST', '/api/auth/verify', {'email': 'di@example.test', 'code': code})
    status, body = viewer.req('POST', f'/api/links/{token}/join')
    check('join contributor', status == 200 and body['role'] == 'contributor', body)
    data, ctype = multipart({'section_id': sec['Done'], 'title': 'Joined post', 'body': ''})
    status, post = viewer.req('POST', f'/api/boards/{bid}/posts', data, headers={'Content-Type': ctype}, raw=True)
    check('joined posts', status == 201, post)

    print('== approvals ==')
    status, body = owner.req('PATCH', f'/api/boards/{bid}', {'approval': True})
    check('approval on', status == 200 and body['approval'] is True)
    data, ctype = multipart({'section_id': sec['Done'], 'title': 'Held one', 'body': ''})
    status, post = viewer.req('POST', f'/api/boards/{bid}/posts', data, headers={'Content-Type': ctype}, raw=True)
    check('held post', status == 201 and post['state'] == 'awaiting_approval' and post['position'] is None, post)
    held_id = post['id']
    status, body = viewer.req('GET', f'/api/posts/{held_id}')
    check('author sees held', status == 200)
    status, body = stranger.req('GET', f'/api/posts/{held_id}')
    check('stranger held 404', status == 404)
    status, listing = stranger.req('GET', f'/api/boards/{bid}/posts')
    check('stranger held list empty', listing['held'] == [], listing['held'])
    status, listing = viewer.req('GET', f'/api/boards/{bid}/posts')
    check('author held list', any(p['id'] == held_id for p in listing['held']))
    status, post = owner.req('POST', f'/api/posts/{held_id}/approve')
    check('approve 200', status == 200 and post['state'] == 'published' and post['position'] is not None, post)
    status, body = owner.req('POST', f'/api/posts/{held_id}/approve')
    check('double approve 409', status == 409 and body['error'] == 'not_held', body)

    # reject path
    data, ctype = multipart({'section_id': sec['Done'], 'title': 'Reject me', 'body': ''})
    status, post = viewer.req('POST', f'/api/boards/{bid}/posts', data, headers={'Content-Type': ctype}, raw=True)
    rej_id = post['id']
    status, body = owner.req('POST', f'/api/posts/{rej_id}/reject')
    check('reject 204', status == 204, body)
    status, body = viewer.req('GET', f'/api/posts/{rej_id}')
    check('rejected 404 to author', status == 404, body)

    print('== members & invites ==')
    status, members = owner.req('GET', f'/api/boards/{bid}/members')
    check('members list', status == 200 and any(m['role'] == 'owner' for m in members['members']), members)
    owner_row = next(m for m in members['members'] if m['role'] == 'owner')
    status, body = owner.req('PATCH', f"/api/boards/{bid}/members/{owner_row['user_id']}", {'role': 'viewer'})
    check('owner role 422', status == 422 and body['errors']['role'] == "The owner's role can't change.", body)
    di_row = next((m for m in members['members'] if m['email'] == 'di@example.test'), None)
    check('di is member', di_row is not None, members['members'])
    if di_row:
        status, body = owner.req('PATCH', f"/api/boards/{bid}/members/{di_row['user_id']}", {'role': 'viewer'})
        check('demote to viewer', status == 200 and body['role'] == 'viewer', body)
        data, ctype = multipart({'section_id': sec['Done'], 'title': 'Blocked', 'body': ''})
        status, body = viewer.req('POST', f'/api/boards/{bid}/posts', data, headers={'Content-Type': ctype}, raw=True)
        check('viewer post 403', status == 403 and body['error'] == 'forbidden', body)
        status, body = owner.req('DELETE', f"/api/boards/{bid}/members/{di_row['user_id']}")
        check('remove member 204', status == 204, body)

    status, body = owner.req('POST', f'/api/boards/{bid}/invites', {'email': 'new@example.test', 'role': 'moderator'})
    check('invite 201', status == 201 and body['invite']['email'] == 'new@example.test', body)
    invite_token = None
    msgs = json.loads(urllib.request.urlopen(f'{MAILPIT}/api/v1/messages?limit=20').read())
    for m in reversed(msgs.get('messages', [])):
        msg = json.loads(urllib.request.urlopen(f"{MAILPIT}/api/v1/message/{m['ID']}").read())
        text = msg.get('Text') or ''
        if '/invite/' in text and 'new@example.test' in str(msg.get('To')):
            invite_token = text.split('/invite/')[1].split()[0].strip()
            check('invite subject', 'invited you to Spring trip on Pinsheet' in (msg.get('Subject') or ''), msg.get('Subject'))
    check('invite token found', invite_token is not None)

    newbie = Client()
    newbie.req('POST', '/api/auth/signup', {'display_name': 'New Bee', 'email': 'new@example.test', 'password': 'password-nb'})
    code = latest_code_for('new@example.test')
    newbie.req('POST', '/api/auth/verify', {'email': 'new@example.test', 'code': code})
    status, body = newbie.req('GET', f'/api/invites/{invite_token}')
    check('invite info', status == 200 and body['expired'] is False and body['role'] == 'moderator', body)
    status, body = newbie.req('POST', f'/api/invites/{invite_token}/accept')
    check('accept invite', status == 200 and body['role'] == 'moderator', body)
    status, body = newbie.req('POST', f'/api/invites/{invite_token}/accept')
    check('reaccept 410', status == 410 and body['error'] == 'invite_expired', body)
    status, body = newbie.req('GET', f'/api/boards/{bid}')
    check('moderator reads', status == 200 and body['role'] == 'moderator', body)

    status, body = owner.req('POST', f'/api/boards/{bid}/invites', {'email': 'amy@example.test', 'role': 'viewer'})
    check('invite member 422', status == 422 and body['errors']['email'] == 'amy@example.test is already on this board.', body)

    print('== sort rules ==')
    status, body = owner.req('PATCH', f'/api/boards/{bid}', {'sort': 'most_liked', 'approval': False})
    check('most_liked set', status == 200 and body['sort'] == 'most_liked')
    status, listing = owner.req('GET', f'/api/boards/{bid}/posts')
    titles = [p['title'] for p in listing['sections'][0]['posts']]
    check('most liked first', titles and titles[0] == 'Beach day', titles)
    all_posts = listing['sections'][0]['posts']
    pid2_version = next(p['version'] for p in all_posts if p['id'] == pid2)
    status, body = owner.req('PATCH', f'/api/posts/{pid2}/move', {'section_id': sec['Ideas'], 'position': 2, 'version': pid2_version})
    check('sort blocks reorder', status == 422 and body['errors']['position'] == 'Order is set by Most liked. Choose By hand to reorder.', body)
    done_len = len(listing['sections'][2]['posts'])
    status, moved = owner.req('PATCH', f'/api/posts/{pid2}/move', {'section_id': sec['Done'], 'position': done_len + 1, 'version': pid2_version})
    check('cross move under sort', status == 200 and moved['section_id'] == sec['Done'], moved)

    print('== group by author ==')
    owner.req('PATCH', f'/api/boards/{bid}', {'sort': 'by_hand', 'group': 'author'})
    status, listing = owner.req('GET', f'/api/boards/{bid}/posts')
    check('author groups', listing['sections'] and all(s['id'].startswith('author-') for s in listing['sections']),
          [s['id'] for s in listing['sections']])
    status, body = owner.req('PATCH', f'/api/posts/{pid2}/move', {'section_id': sec['Ideas'], 'position': 1, 'version': 4})
    check('group blocks move', status == 422 and body['errors']['position'] == 'Moving is off while posts are grouped by author.', body)
    owner.req('PATCH', f'/api/boards/{bid}', {'group': 'section'})

    print('== csv ==')
    status, csv = owner.req('GET', f'/api/boards/{bid}/export.csv', raw=True)
    check('csv header', status == 200 and csv.startswith(b'post_id,section,position,title,body,author'), csv[:60])
    check('csv display name', b'"Amy Holt"' in csv, csv[:200])
    check('csv crlf', csv.endswith(b'\r\n') and csv.count(b'\r\n') >= 1)
    status, body = stranger.req('GET', f'/api/boards/{bid}/export.csv')
    check('stranger export 403', status == 403, body)

    print('== rotate and privacy ==')
    old_token = token
    status, body = owner.req('POST', f'/api/boards/{bid}/rotate-link')
    check('rotate 200', status == 200 and body['share_path'] != f'/s/{old_token}', body)
    status, body = stranger.req('GET', f'/api/links/{old_token}')
    check('old link 404', status == 404)
    status, body = owner.req('PATCH', f'/api/boards/{bid}', {'privacy': 'private'})
    check('private', status == 200)
    status, body = stranger.req('GET', f'/api/boards/{bid}')
    check('private 404', status == 404)
    status, body = owner.req('PATCH', f'/api/boards/{bid}', {'privacy': 'public'})

    print('== delete post ==')
    status, body = owner.req('DELETE', f'/api/posts/{pid1}')
    check('delete 204', status == 204)
    status, body = owner.req('GET', f'/api/posts/{pid1}')
    check('deleted 404', status == 404)
    status, body = owner.req('GET', f'/api/attachments/{att_id}')
    check('attachment gone', status == 404, body)

    print('== grading fixture ==')
    status, body = owner.req('POST', '/api/grading/fixture')
    check('fixture no key 404', status == 404 and body['error'] == 'not_found', body)
    fixture = {
        'users': [
            {'key': 'amy', 'display_name': 'Amy Holt', 'email': 'amyt@example.test', 'password': 'pass-amy-1'},
            {'key': 'ben', 'display_name': 'Ben Okafor', 'email': 'ben@example.test', 'password': 'pass-ben-1'},
        ],
        'boards': [{
            'key': 'trip', 'owner': 'amy', 'title': 'Spring trip', 'sections': ['Ideas', 'Booked'],
            'members': {'ben': 'contributor'},
            'posts': [
                {'key': 'p1', 'section': 'Ideas', 'author': 'ben', 'title': 'Lake day', 'body': 'Swim',
                 'likes': ['amy'], 'votes': {'amy': 1}, 'comments': [{'author': 'amy', 'text': 'Yes!'}]},
            ],
        }],
    }
    req = urllib.request.Request(BASE + '/api/grading/fixture', json.dumps(fixture).encode(),
                                 method='POST', headers={'Content-Type': 'application/json',
                                                        'X-Grading-Key': 'pinsheet-grading-key'})
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    check('fixture 201', resp.status == 201 and data['users']['amy']['session'], data)
    check('fixture post ids', 'p1' in data['boards']['trip']['posts'] and 'Ideas' in data['boards']['trip']['sections'], data)

    jar = http.cookiejar.CookieJar()
    jar.set_cookie(http.cookiejar.Cookie(0, 'pinsheet_session', data['users']['amy']['session'], None, False,
                                         '127.0.0.1', False, False, '/', True, False, None, False, None, None, {}))
    fx = Client()
    fx.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    status, body = fx.req('GET', '/api/me')
    check('fixture session works', status == 200 and body['user']['display_name'] == 'Amy Holt', body)
    fx_bid = data['boards']['trip']['id']
    status, listing = fx.req('GET', f'/api/boards/{fx_bid}/posts')
    check('fixture board listed', status == 200 and listing['sections'][0]['posts'][0]['likes'] == 1, listing)
    check('fixture comment count', listing['sections'][0]['posts'][0]['comments'] == 1)

    bad = {'users': [], 'boards': [{'key': 'b', 'owner': 'nobody', 'title': 'T', 'sections': ['S']}]}
    req = urllib.request.Request(BASE + '/api/grading/fixture', json.dumps(bad).encode(),
                                 method='POST', headers={'Content-Type': 'application/json',
                                                        'X-Grading-Key': 'pinsheet-grading-key'})
    try:
        urllib.request.urlopen(req)
        check('fixture bad ref 422', False, 'no error')
    except urllib.error.HTTPError as e:
        body = json.loads(e.read())
        check('fixture bad ref 422', e.code == 422 and 'boards.0.owner' in body['errors'], body)

    print('== boundary ==')
    for path in ('/package.json', '/package-lock.json', '/.env', '/run.json', '/.git/config', '/tsconfig.json'):
        status, _ = owner.req('GET', path)
        check(f'{path} 404', status == 404, status)
    req = urllib.request.Request(BASE + '/api/boards', method='POST',
                                 data=json.dumps({'title': 'x'}).encode(),
                                 headers={'Content-Type': 'application/json', 'Origin': 'http://evil.example'})
    try:
        urllib.request.urlopen(req)
        check('cross origin 403', False, 'no error')
    except urllib.error.HTTPError as e:
        check('cross origin 403', e.code == 403 and json.loads(e.read())['error'] == 'cross_origin')

    status, body = owner.req('GET', '/api/unknown-path')
    check('unknown api 404', status == 404 and body['error'] == 'not_found')

    print(f'\n{ok_count} passed, {fail_count} failed')
    sys.exit(1 if fail_count else 0)


if __name__ == '__main__':
    main()
