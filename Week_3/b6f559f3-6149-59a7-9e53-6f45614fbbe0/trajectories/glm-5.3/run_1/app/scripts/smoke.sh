#!/bin/bash
# End-to-end API smoke test against a running server.
set -u
BASE="http://127.0.0.1:4173"
KEY="hs-grading-key-5e1c9a7d"
JAR=/tmp/hs-cookies.txt
rm -f "$JAR"

step() { echo; echo "== $1"; }

curl -s -X POST -H "X-Grading-Key: $KEY" $BASE/api/grading/reset >/dev/null
SEED=$(curl -s -X POST -H "X-Grading-Key: $KEY" $BASE/api/grading/seed)
echo "$SEED" > /tmp/seed.json
pick() { node -e "const j=JSON.parse(require('fs').readFileSync('/tmp/seed.json'));console.log($1)"; }
INES_SESSION=$(pick "j.people['ines@lumenyard.test'].session")
LUMEN=$(pick "j.projects['Lumen hero'].id")
LOGO=$(pick "j.projects['Logo forge'].id")
MODEL=$(pick "j.projects['Model bay'].id")
QUARRY=$(pick "j.projects['Quarry teaser'].id")
WORDMARK=$(pick "j.projects['Logo forge'].layers['Wordmark']")
BANNER=$(pick "j.projects['Banner test'].id")
CLOTH_LAYER=$(pick "j.projects['Banner test'].layers['Banner']")
SCENE_MAIN=$(pick "j.projects['Lumen hero'].scenes['Main']")
HALO=$(pick "j.projects['Lumen hero'].layers['Halo cube']")
SCENE_BANNER=$(pick "j.projects['Banner test'].scenes['Main']")
SCENE_LOGO=$(pick "j.projects['Logo forge'].scenes['Main']")
MODEL_SCENE=$(pick "j.projects['Model bay'].scenes['Main']")

AUTH="Cookie: hs_session=$INES_SESSION"

step "sign in with wrong password (expect bad_credentials)"
curl -s -X POST -H 'content-type: application/json' -d '{"email":"ines@lumenyard.test","password":"nope"}' $BASE/api/session
echo

step "sign in seeded person"
curl -s -c "$JAR" -X POST -H 'content-type: application/json' -d '{"email":"ines@lumenyard.test","password":"halation-ines-01"}' $BASE/api/session
echo
grep hs_session "$JAR" >/dev/null && echo "hs_session cookie set"

step "404: another workspace's project"
curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR" $BASE/api/projects/$QUARRY

step "404: unknown project"
curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR" $BASE/api/projects/prj_unknown

step "404: unauthenticated project"
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/projects/$LUMEN

step "404: grading without key"
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/grading/seed

step "inspect Halo cube (expect screen-point 806.85, 231.29 px)"
curl -s -b "$AUTH" "$BASE/api/projects/$LUMEN/inspect?scene=$SCENE_MAIN&layer=$HALO&frame=0" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(JSON.stringify(j.readouts))})"

step "inspect cloth at frame 30 (expect R4 C1 at -0.051, -0.285, 0.001)"
curl -s -b "$AUTH" "$BASE/api/projects/$BANNER/inspect?scene=$SCENE_BANNER&layer=$CLOTH_LAYER&frame=30&point=R4%20C1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.readouts['cloth-point'])})"

step "inspect Wordmark (expect Bounds 2.740 × 1.040 × 0.240, Triangles 1120)"
curl -s -b "$AUTH" "$BASE/api/projects/$LOGO/inspect?scene=$SCENE_LOGO&layer=$WORDMARK&frame=0" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.readouts['bounds'], '|', j.readouts['triangles'])})"

step "publish Model bay version 2 (v1 already live)"
curl -s -b "$AUTH" -X POST -H 'content-type: application/json' -H 'Idempotency-Key: pub-test-1' -d '{}' $BASE/api/projects/$MODEL/versions | head -c 200; echo

step "versions list"
curl -s -b "$AUTH" $BASE/api/projects/$MODEL/versions | head -c 400; echo

step "embed page for Model bay"
curl -s -o /dev/null -w '%{http_code}\n' $BASE/embed/$MODEL

step "embed scene headers"
curl -s -D - -o /dev/null $BASE/api/embed/$MODEL/scene | grep -i "x-halation-version\|x-scene-source\|^HTTP"

step "embed 404 for unpublished"
curl -s -o /dev/null -w '%{http_code}\n' $BASE/embed/$LOGO

step "ops: update rotation Y"
curl -s -b "$AUTH" -X POST -H 'content-type: application/json' \
  -d "{\"opId\":\"op-t1\",\"sceneId\":\"$SCENE_MAIN\",\"changes\":[{\"type\":\"updateLayer\",\"layerId\":\"$HALO\",\"set\":\"rotation.y\",\"value\":60}]}" \
  $BASE/api/projects/$LUMEN/ops | head -c 200; echo

step "ops replay same opId"
curl -s -b "$AUTH" -X POST -H 'content-type: application/json' \
  -d "{\"opId\":\"op-t1\",\"sceneId\":\"$SCENE_MAIN\",\"changes\":[{\"type\":\"updateLayer\",\"layerId\":\"$HALO\",\"set\":\"rotation.y\",\"value\":60}]}" \
  $BASE/api/projects/$LUMEN/ops | head -c 200; echo

step "ops same opId different body (expect idempotency_conflict)"
curl -s -b "$AUTH" -X POST -H 'content-type: application/json' \
  -d "{\"opId\":\"op-t1\",\"sceneId\":\"$SCENE_MAIN\",\"changes\":[{\"type\":\"updateLayer\",\"layerId\":\"$HALO\",\"set\":\"rotation.y\",\"value\":70}]}" \
  $BASE/api/projects/$LUMEN/ops | head -c 200; echo

step "undo"
curl -s -b "$AUTH" -X POST -H 'content-type: application/json' -d '{"opId":"undo-t1"}' $BASE/api/projects/$LUMEN/undo | head -c 200; echo

step "redo"
curl -s -b "$AUTH" -X POST -H 'content-type: application/json' -d '{"opId":"redo-t1"}' $BASE/api/projects/$LUMEN/redo | head -c 200; echo

step "publish Lumen hero v1"
curl -s -b "$AUTH" -X POST -H 'content-type: application/json' -H 'Idempotency-Key: pub-lumen-1' -d '{}' $BASE/api/projects/$LUMEN/versions | head -c 200; echo

step "republish same key (no second version)"
curl -s -b "$AUTH" -X POST -H 'content-type: application/json' -H 'Idempotency-Key: pub-lumen-1' -d '{}' $BASE/api/projects/$LUMEN/versions | head -c 200; echo

step "versions for Lumen hero"
curl -s -b "$AUTH" $BASE/api/projects/$LUMEN/versions | head -c 400; echo

step "immutable version (expect 405)"
curl -s -X PUT -H 'content-type: application/json' -d '{}' $BASE/api/projects/$LUMEN/versions/1 | head -c 120; echo

step "invite a new email as Editor"
curl -s -b "$AUTH" -X POST -H 'content-type: application/json' -d '{"email":"newperson@example.test","role":"Editor"}' $BASE/api/projects/$LUMEN/invites | head -c 300; echo

step "Mailpit received mail"
curl -s "http://mailpit:8025/api/v1/messages?limit=5" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('total:',j.total);console.log(j.messages.slice(0,4).map(m=>m.Subject).join(' | '))})"

step "health"
curl -s $BASE/api/health; echo
