import { bootstrap } from './dom.js';
import { startConfirm, startSignIn, startSignUp, wireAccountMenu } from './auth.js';
import { startBoards } from './boards.js';
import { startHallEditor, startHallVisit } from './hall.js';
import { startBoard, startRanger } from './notes.js';
import { startPlay } from './play.js';
import { startTextWorld } from './textWorld.js';
import { startTitle } from './title.js';

const page = bootstrap<{ page: string }>().page;

wireAccountMenu();

switch (page) {
  case 'title':
    startTitle();
    break;
  case 'signup':
    startSignUp();
    break;
  case 'signin':
    startSignIn();
    break;
  case 'confirm':
    startConfirm();
    break;
  case 'play':
    startPlay();
    startTextWorld();
    break;
  case 'text-world':
    startTextWorld();
    break;
  case 'hall-editor':
    startHallEditor();
    break;
  case 'hall-visit':
    startHallVisit();
    break;
  case 'board':
    startBoard();
    break;
  case 'ranger':
    startRanger();
    break;
  case 'boards':
    startBoards();
    break;
  default:
    break;
}
