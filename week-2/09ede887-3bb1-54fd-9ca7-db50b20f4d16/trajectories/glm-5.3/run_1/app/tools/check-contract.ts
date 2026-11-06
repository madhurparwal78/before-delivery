/**
 * Verify that the manifests built from the running code's route and object
 * definitions equal the published manifests exactly.
 */

import { v1Manifest, v2Manifest } from '../src/server/api/contract.js';

const PUBLISHED_V1 = `object account id,name,email,role
object auth token,account
object cancelled seats_left
object error error,message
object guess value,created_at
object guess_created guess
object leader rank,display_name,value,distance
object my_agenda reserved,waitlisted,saved
object organiser_row id,title,day,starts_at,ends_at,capacity,reserved,seats_left,waitlisted
object record status,closes_at,guess_count,my_guess,final_figure,revealed_at,leaderboard
object reservation id,session_id,created_at
object reservation_created reservation,seats_left
object reveal status,final_figure,revealed_at,leaderboard
object roster_row name,email,reserved_at
object saved saved
object session id,day,date,starts_at,ends_at,starts_at_utc,ends_at_utc,title,speakers,stage,stage_name,location,format,format_label,description,capacity,seats_left,waitlist_count,reserved_by_me,saved_by_me,waitlist_position
object signed_out signed_out
object speaker name,company,sessions
object speaker_ref name,company
object stage slug,name,description
object waitlist session_id,position,created_at
object waitlist_joined waitlist
object waitlist_left waitlisted
route DELETE /sessions/{id}/reservation
route DELETE /sessions/{id}/save
route DELETE /sessions/{id}/waitlist
route GET /agenda.ics
route GET /me
route GET /me/agenda
route GET /organiser/sessions
route GET /organiser/sessions/{id}/roster
route GET /organiser/sessions/{id}/roster.csv
route GET /record
route GET /sessions
route GET /sessions/{id}
route GET /speakers
route GET /stages
route PATCH /organiser/sessions/{id}
route POST /auth/login
route POST /auth/logout
route POST /auth/signup
route POST /organiser/record/reveal
route POST /record/guesses
route POST /sessions/{id}/reservation
route POST /sessions/{id}/waitlist
route PUT /sessions/{id}/save
`;

const PUBLISHED_V2 = `object account id,name,email,role
object auth token,account
object cancelled seats
object error error
object error_detail code,message
object guess value,created_at
object guess_created guess
object hold session_id,held_until,seconds_remaining
object leader rank,display_name,value,distance
object my_agenda reserved,held,waitlisted,saved
object organiser_row id,title,day,start_local,end_local,seats,waitlisted
object record status,closes_at,guess_count,my_guess,final_figure,revealed_at,leaderboard
object released held
object reservation id,session_id,created_at
object reservation_created reservation,seats
object reveal status,final_figure,revealed_at,leaderboard
object roster_row name,email,reserved_at
object saved saved
object seats capacity,reserved,held,left
object session id,day,date,start_local,end_local,start_instant,end_instant,title,speakers,stage,stage_name,location,format,format_label,description,seats,waitlist_count,reserved_by_me,saved_by_me,waitlist_position,my_hold
object signed_out signed_out
object speaker slug,name,company,sessions,bio,bio_html
object speaker_ref name,company
object stage slug,name,description
object waitlist session_id,position,created_at
object waitlist_joined waitlist
object waitlist_left waitlisted
route DELETE /sessions/{id}/hold
route DELETE /sessions/{id}/reservation
route DELETE /sessions/{id}/save
route DELETE /sessions/{id}/waitlist
route GET /agenda.ics
route GET /me
route GET /me/agenda
route GET /me/holds
route GET /organiser/sessions
route GET /organiser/sessions/{id}/roster
route GET /organiser/sessions/{id}/roster.csv
route GET /record
route GET /sessions
route GET /sessions/{id}
route GET /speakers
route GET /stages
route PATCH /organiser/sessions/{id}
route POST /auth/login
route POST /auth/logout
route POST /auth/signup
route POST /organiser/record/reveal
route POST /record/guesses
route POST /sessions/{id}/claim
route POST /sessions/{id}/reservation
route POST /sessions/{id}/waitlist
route PUT /organiser/speakers/{slug}/bio
route PUT /sessions/{id}/save
`;

let fails = 0;
function check(label: string, got: string, want: string): void {
  const ok = got === want;
  if (!ok) fails++;
  console.log(ok ? 'ok   manifest ' + label : 'FAIL manifest ' + label);
  if (!ok) {
    const gotLines = got.split('\n');
    const wantLines = want.split('\n');
    for (let i = 0; i < Math.max(gotLines.length, wantLines.length); i++) {
      if (gotLines[i] !== wantLines[i]) {
        console.log('  first diff at line', i + 1);
        console.log('   got ', JSON.stringify(gotLines[i]));
        console.log('   want', JSON.stringify(wantLines[i]));
        break;
      }
    }
  }
}

check('v1', v1Manifest(), PUBLISHED_V1);
check('v2', v2Manifest(), PUBLISHED_V2);
console.log(fails === 0 ? 'ALL OK' : `${fails} FAILURES`);
