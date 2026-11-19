// Gambit Hall client: boards in three views, live updates by polling, sounds,
// preferences, forms. The server decides legality; this code only draws.
import { pieceSvg, PIECE_NAMES } from './pieces-2d.mjs';
import { DeepBoard } from './deep.mjs';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// ---------------------------------------------------------------- api
async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

function toast(message, isError = false) {
  const holder = $('.toasts');
  if (!holder) return;
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.textContent = message;
  holder.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function announce(text) {
  const live = $('#live-announcer');
  if (live) live.textContent = text;
}

// ---------------------------------------------------------------- sounds
const soundCache = new Map();
let userInteracted = false;
document.addEventListener('pointerdown', () => { userInteracted = true; }, { once: true });
document.addEventListener('keydown', () => { userInteracted = true; }, { once: true });

function playSound(name, enabled) {
  if (!enabled || !userInteracted) return;
  if (!soundCache.has(name)) {
    const a = new Audio(`/media/sounds/${name}.wav`);
    soundCache.set(name, a);
  }
  const audio = soundCache.get(name);
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- helpers
const FILES = 'abcdefgh';
const sqToIndex = s => FILES.indexOf(s[0]) + (parseInt(s[1], 10) - 1) * 8;
const START_PLACEHOLDER = '__start__';

function parseFen(fen) {
  const board = new Array(64).fill(null);
  const rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    const row = rows[7 - r];
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += parseInt(ch, 10); continue; }
      board[r * 8 + f] = { type: ch.toLowerCase(), colour: ch === ch.toUpperCase() ? 'w' : 'b' };
      f++;
    }
  }
  return { board, turn: fen.split(' ')[1] };
}

function occupantName(sq, fen) {
  const { board } = parseFen(fen);
  const p = board[sqToIndex(sq)];
  return p ? `${p.colour === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[p.type]}` : null;
}

function sqLabel(sq, fen) {
  const occ = occupantName(sq, fen);
  return occ ? `${sq}, ${occ}` : sq;
}

// ---------------------------------------------------------------- game page
class GameScreen {
  constructor(root) {
    this.root = root;
    this.gameId = root.dataset.gameId;
    this.viewerColour = root.dataset.viewerColour === 'white' ? 'white' : 'black';
    this.isPlayer = root.dataset.isPlayer === 'true';
    this.pieceSet = root.dataset.pieceSet;
    this.deepSet = root.dataset.deepSet;
    this.soundOn = root.dataset.sound === 'on';
    this.view = document.body.dataset.initialView || 'flat';
    this.game = null;
    this.legal = [];
    this.selected = null;
    this.pendingMove = null;
    this.promotion = null;

    this.flatBoard = $('[data-board="flat"]', root);
    this.kbdBoard = $('[data-board="keys"]', root);
    this.canvas = $('[data-deep-canvas]', root);
    this.frame = $('[data-board-frame]', root);
    this.moveList = $('[data-move-list]', root);
    this.chatLog = $('[data-chat-log]', root);
    this.turnNote = $('[data-turn-note]', root);

    const viewBtns = $$('[data-view]', root);
    const initial = [...viewBtns].find(b => b.getAttribute('aria-pressed') === 'true');
    this.view = initial ? initial.dataset.view : 'flat';

    this.deep = null;
    if (this.canvas) {
      this.deep = new DeepBoard(this.canvas, {
        set3d: this.deepSet,
        viewerColour: this.viewerColour,
        onSquareClick: sq => this.tapSquare(sq),
      });
      window.__deep = this.deep;   // exposed for automated verification
    }

    viewBtns.forEach(btn => btn.addEventListener('click', () => {
      this.setView(btn.dataset.view);
    }));
    this.setView(this.view);   // the member's saved view opens the game

    window.__game = this;   // exposed for automated verification
    this.frame.addEventListener('click', e => {
      const sqEl = e.target.closest('[data-square]');
      if (sqEl && this.flatBoard && this.flatBoard.contains(sqEl)) this.tapSquare(sqEl.dataset.square);
    });

    this.kbdBoard.addEventListener('click', e => {
      const btn = e.target.closest('button[data-square]');
      if (btn) this.tapSquare(btn.dataset.square);
    });
    this.kbdBoard.addEventListener('keydown', e => this.kbdKey(e));

    // controls
    $$('[data-control]', root).forEach(btn => btn.addEventListener('click', () => this.control(btn.dataset.control)));

    // chat
    const chatForm = $('[data-form="chat"]', root);
    if (chatForm) chatForm.addEventListener('submit', e => this.sendChat(e));

    this.load(true);
    this.poll();
  }

  async load(first) {
    const [g, legal, chat] = await Promise.all([
      call('GET', `/api/games/${this.gameId}`),
      call('GET', `/api/games/${this.gameId}/legal-moves`),
      this.isPlayer ? call('GET', `/api/games/${this.gameId}/chat`) : Promise.resolve({ status: 403, data: null }),
    ]);
    if (g.ok) {
      const prevMoves = this.game ? this.game.moves.length : 0;
      this.game = g.data;
      if (!first && this.game.moves.length > prevMoves) {
        const mv = this.game.moves[this.game.moves.length - 1];
        this.announceMove(mv);
        this.soundFor(mv);
        if (this.deep) this.deep.animateMove(mv.uci);
      }
      this.render();
      this.refreshDeep(this.game.fen);
      if (this.game.status === 'finished' && !this.overShown) {
        this.overShown = true;
        this.showOverScreen();
      }
    }
    if (legal.ok && Array.isArray(legal.data)) this.legal = legal.data;
    if (chat.ok && Array.isArray(chat.data)) this.renderChat(chat.data);
  }

  poll() {
    const tick = async () => {
      if (document.hidden) { setTimeout(tick, 3000); return; }
      try { await this.load(false); } catch { /* keep the page */ }
      setTimeout(tick, 1500);
    };
    setTimeout(tick, 1500);
  }

  soundFor(mv) {
    if (!mv) return;
    const uci = mv.uci;
    const promo = uci.length === 5;
    const dest = uci.slice(2, 4);
    const before = this.game.moves.length > 1 ? this.game.moves[this.game.moves.length - 2] : null;
    let capture = false;
    if (before) {
      const fen = before.fen_after;
      const { board } = parseFen(fen);
      capture = !!board[sqToIndex(dest)];
    }
    if (promo) playSound('promotion', this.soundOn);
    else if (capture) playSound('capture', this.soundOn);
    else playSound('move', this.soundOn);
    if (this.game.status === 'finished') {
      const myColour = this.viewerColour;
      const res = this.game.result;
      if (res === '1/2-1/2') playSound('draw', this.soundOn);
      else if ((res === '1-0' && myColour === 'white') || (res === '0-1' && myColour === 'black')) playSound('victory', this.soundOn);
      else playSound('defeat', this.soundOn);
    }
  }

  announceMove(mv) {
    if (mv && mv.announcement) announce(mv.announcement);
  }

  legalFrom(sq) { return this.legal.filter(u => u.startsWith(sq)); }

  myTurn() {
    if (!this.game || this.game.status !== 'in_progress') return false;
    const turn = this.game.turn;
    if (!this.isPlayer) return false;
    if (this.game.white && this.game.white.username && this.game.black && this.game.black.username) {
      // solo study games: the creator plays both colours
      if (this.game.white.id === this.game.black.id) return true;
    }
    return (turn === 'white') === (this.viewerColour === 'white');
  }

  tapSquare(sq) {
    if (!this.myTurn()) return;
    const from = this.selected;
    if (from && from !== sq) {
      const moves = this.legalFrom(from).map(u => u.slice(0, 2) + u.slice(2, 4));
      const candidate = from + sq;
      const exact = this.legalFrom(from).filter(u => u.slice(0, 4) === candidate);
      if (exact.length === 0) {
        this.selected = null;
        this.renderMarks();
        return;
      }
      if (exact.length === 1) { this.playMove(exact[0]); return; }
      if (exact.length > 1) { this.openPromotion(exact); return; }
    }
    if (this.legalFrom(sq).length > 0) {
      this.selected = sq;
      this.renderMarks();
    } else {
      this.selected = null;
      this.renderMarks();
    }
  }

  openPromotion(options) {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `
      <h2>Promote to</h2>
      <div style="display:flex;gap:10px;justify-content:center">
        ${['q', 'r', 'b', 'n'].map(t => `<button class="btn" data-promo="${t}">${PIECE_NAMES[t]}</button>`).join('')}
      </div>`;
    document.body.appendChild(dlg);
    const prevFocus = document.activeElement;
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    });
    dlg.addEventListener('click', e => {
      const btn = e.target.closest('[data-promo]');
      if (!btn) return;
      const uci = options.find(u => u[4] === btn.dataset.promo);
      dlg.close();
      if (uci) this.playMove(uci);
    });
    dlg.showModal();
  }

  async playMove(uci) {
    const from = this.selected;
    this.selected = null;
    this.pendingMove = uci;
    this.renderPending();
    const res = await call('POST', `/api/games/${this.gameId}/moves`, { move: uci });
    this.pendingMove = null;
    if (!res.ok) {
      if (res.status === 409) toast('The position has moved on.', true);
      else toast(res.data && res.data.error ? res.data.error : 'That move is not legal here.', true);
      await this.load(false);
      return;
    }
    const prevLen = this.game ? this.game.moves.length : 0;
    this.game = res.data;
    const mv = this.game.moves[this.game.moves.length - 1];
    this.announceMove(mv);
    this.soundFor(mv);
    const legal = await call('GET', `/api/games/${this.gameId}/legal-moves`);
    if (legal.ok) this.legal = legal.data;
    this.render();
    this.refreshDeep(this.game.fen);
    for (const played of this.game.moves.slice(prevLen)) {
      if (this.deep) this.deep.animateMove(played.uci);
    }
    if (this.game.status === 'finished' && !this.overShown) {
      this.overShown = true;
      this.showOverScreen();
    }
  }

  async control(kind) {
    const endpoints = {
      'draw-offer': ['/draw-offer', 'POST'],
      'claim-threefold': ['/claim', 'POST', { kind: 'threefold' }],
      'takeback': ['/takeback', 'POST'],
      'resign': ['/resign', 'POST'],
      'rematch': ['/rematch', 'POST'],
    };
    if (kind === 'claim-fifty') endpoints['claim-fifty'] = ['/claim', 'POST', { kind: 'fifty-move' }];
    const [path, method, body] = endpoints[kind] || [];
    if (!path) return;
    const res = await call(method, `/api/games/${this.gameId}${path}`, body || undefined);
    if (!res.ok) {
      toast(res.data && res.data.error ? res.data.error : 'That did not work.', true);
      return;
    }
    if (kind === 'rematch' && res.data && res.data.id) {
      window.location.href = `/game/${res.data.id}`;
      return;
    }
    toast('Done.');
    await this.load(false);
  }

  async sendChat(e) {
    e.preventDefault();
    const input = $('#chat-msg', this.root);
    const text = input.value;
    if (!text.trim()) { toast('A message cannot be empty.', true); return; }
    const res = await call('POST', `/api/games/${this.gameId}/chat`, { text });
    if (!res.ok) {
      toast(res.data && res.data.error ? res.data.error : 'That message was not sent.', true);
      return;
    }
    input.value = '';
    const chat = await call('GET', `/api/games/${this.gameId}/chat`);
    if (chat.ok) this.renderChat(chat.data);
  }

  renderChat(messages) {
    if (!this.chatLog) return;
    this.chatLog.innerHTML = '';
    for (const m of messages) {
      const el = document.createElement('div');
      el.className = 'chat-msg';
      const avatar = m.sender && m.sender.avatar_url ? m.sender.avatar_url : '/media/avatars/avatar_01.svg';
      el.innerHTML = `<img class="avatar" src="${avatar}" alt="">
        <div><div class="who"></div><div class="text"></div></div>`;
      el.querySelector('.who').textContent = m.sender ? m.sender.username : 'Member';
      el.querySelector('.text').textContent = m.text;   // plain text, never interpreted
      this.chatLog.appendChild(el);
    }
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  renderPending() {
    if (this.pendingMove) this.render();
  }

  setView(view) {
    this.view = view;
    $$('[data-view]', this.root).forEach(b => b.setAttribute('aria-pressed', b.dataset.view === view ? 'true' : 'false'));
    $('[data-view-flat]', this.root).hidden = view !== 'flat';
    $('[data-view-deep]', this.root).hidden = view !== 'deep';
    $('[data-view-squares]', this.root).hidden = view !== 'squares';
    // the keyboard board stays present alongside both board views
    this.kbdBoard.hidden = view === 'squares';
    this.refreshDeep(this.game ? this.game.fen : null);
    this.renderSquaresTable();
  }

  refreshDeep(fen) {
    if (!this.deep || !fen) return;
    this.deep.setPosition(fen);
    const last = this.game && this.game.moves.length ? this.game.moves[this.game.moves.length - 1].uci : null;
    if (last) this.deep.setLastMove(last);
    this.updateDeepMarks();
  }

  updateDeepMarks() {
    if (!this.deep) return;
    const dests = this.selected ? this.legalFrom(this.selected).map(u => u.slice(2, 4)) : [];
    this.deep.setSelected(this.selected, dests);
  }

  renderMarks() {
    // flat board marks
    $$('.sq2', this.flatBoard).forEach(el => {
      const sq = el.dataset.square;
      el.classList.toggle('selected', this.selected === sq);
      const isDest = this.selected && this.legalFrom(this.selected).some(u => u.slice(2, 4) === sq);
      el.classList.toggle('dest', !!isDest);
      const occ = el.dataset.occupant;
      el.classList.toggle('occupied', !!occ);
    });
    if (this.kbdBoard) {
      $$('button', this.kbdBoard).forEach(btn => {
        btn.setAttribute('aria-pressed', this.selected === btn.dataset.square ? 'true' : 'false');
      });
    }
    this.updateDeepMarks();
  }

  animateFlat(uci, prevFen) {
    // a piece travels from its old square to its new one; a capture fades out
    // while growing past its size; a promotion grows past its size and settles
    const from = uci.slice(0, 2), to = uci.slice(2, 4);
    const fromEl = this.flatBoard.querySelector(`[data-square="${from}"]`);
    const toEl = this.flatBoard.querySelector(`[data-square="${to}"]`);
    if (!toEl) return;
    const pieceEl = toEl.querySelector('.piece');
    if (pieceEl && fromEl) {
      const a = fromEl.getBoundingClientRect();
      const b = toEl.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (dx || dy) {
        pieceEl.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 420, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
        );
      }
      if (uci.length === 5) {
        pieceEl.animate(
          [{ transform: 'scale(0.6)' }, { transform: 'scale(1.25)', offset: 0.55 }, { transform: 'scale(1)' }],
          { duration: 620, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
        );
      }
    }
    // capture: the taken piece fades out while growing past its size
    if (prevFen) {
      const { board: prevBoard } = parseFen(prevFen);
      const captured = prevBoard[sqToIndex(to)];
      if (captured) {
        const ghost = document.createElement('span');
        ghost.className = 'piece anim-captured';
        ghost.style.position = 'absolute';
        ghost.style.inset = '8%';
        ghost.style.pointerEvents = 'none';
        ghost.innerHTML = pieceSvg(captured.colour + captured.type, this.pieceSet);
        toEl.appendChild(ghost);
        setTimeout(() => ghost.remove(), 520);
      }
    }
  }

  render() {
    if (!this.game) return;
    const moves = this.game.moves;
    const newUci = moves.length ? moves[moves.length - 1].uci : null;
    const prevFen = moves.length > 1 ? moves[moves.length - 2].fen_after : (this.game.fen_start || START_PLACEHOLDER);
    const animate = newUci && newUci !== this._lastRenderedUci
      ? { uci: newUci, prevFen: prevFen === START_PLACEHOLDER ? null : prevFen }
      : null;
    if (newUci) this._lastRenderedUci = newUci;
    const { board, turn } = parseFen(this.game.fen);
    // flat board pieces
    $$('.sq2', this.flatBoard).forEach(el => {
      const idx = sqToIndex(el.dataset.square);
      const piece = board[idx];
      const code = piece ? piece.colour + piece.type : '';
      const holder = el.querySelector('.piece');
      if (el.dataset.occupant !== code) {
        if (holder) holder.remove();
        if (piece) {
          const span = document.createElement('span');
          span.className = 'piece';
          span.dataset.piece = code;
          span.innerHTML = pieceSvg(code, this.pieceSet);
          el.appendChild(span);
        }
        el.dataset.occupant = code;
      }
    });
    // last move tint + check
    const lastUci = this.game.moves.length ? this.game.moves[this.game.moves.length - 1].uci : '';
    const fromSq = lastUci.slice(0, 2), toSq = lastUci.slice(2, 4);
    $$('.sq2', this.flatBoard).forEach(el => {
      el.classList.toggle('last-move', lastUci && (el.dataset.square === fromSq || el.dataset.square === toSq));
      el.classList.remove('check');
      el.classList.remove('with-text');
    });
    // king in check marker
    const checkAnn = this.game.moves.length ? this.game.moves[this.game.moves.length - 1].announcement : null;
    if (checkAnn && checkAnn.includes('check')) {
      const kingColour = turn === 'w' ? 'w' : 'b';
      for (let i = 0; i < 64; i++) {
        if (board[i] && board[i].colour === kingColour && board[i].type === 'k') {
          const el = this.flatBoard.querySelector(`[data-square="${FILES[i % 8]}${Math.floor(i / 8) + 1}"]`);
          if (el) { el.classList.add('check'); el.classList.add('with-text'); }
        }
      }
    }
    // keyboard board labels and last-move underline
    if (this.kbdBoard) {
      $$('button', this.kbdBoard).forEach(btn => {
        const label = sqLabel(btn.dataset.square, this.game.fen);
        btn.setAttribute('aria-label', label);
        btn.title = label;
        btn.classList.toggle('kbd-last', btn.dataset.square === fromSq || btn.dataset.square === toSq);
      });
    }
    // move list
    if (this.moveList) {
      const rows = [];
      for (let i = 0; i < this.game.moves.length; i += 2) {
        const no = Math.floor(i / 2) + 1;
        rows.push(`<div class="row"><span class="no">${no}.</span><span>${this.game.moves[i].san}</span><span>${this.game.moves[i + 1] ? this.game.moves[i + 1].san : ''}</span></div>`);
      }
      this.moveList.innerHTML = rows.join('') || '<div class="empty">No moves yet.</div>';
      this.moveList.scrollTop = this.moveList.scrollHeight;
    }
    // whose turn
    if (this.turnNote) {
      this.turnNote.textContent = this.game.status === 'in_progress'
        ? `${this.game.turn === 'white' ? this.game.white.username : this.game.black.username} to move`
        : this.game.status === 'finished' ? `Game over: ${this.game.result}` : 'Aborted';
    }
    // turn markers
    $$('[data-turn-marker]', this.root).forEach(m => m.classList.remove('on'));
    if (this.game.status === 'in_progress') {
      const side = this.game.turn === 'white' ? this.game.white : this.game.black;
      const marker = this.root.querySelector(`[data-turn-marker="${side.username}"]`);
      if (marker) marker.classList.add('on');
      const markers = $$('[data-turn]', this.root);
      if (markers.length >= 2) {
        markers[0].classList.toggle('on', this.game.turn === 'white');
        markers[1].classList.toggle('on', this.game.turn === 'black');
      }
    }
    this.renderMarks();
    this.renderSquaresTable();
    this.renderOfferBanner();
    if (animate && !reduceMotion()) this.animateFlat(animate.uci, animate.prevFen);
  }

  renderSquaresTable() {
    const table = $('[data-squares-table]', this.root);
    if (!table || !this.game) return;
    const { board } = parseFen(this.game.fen);
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      for (let f = 0; f < 8; f++) {
        const idx = r * 8 + f;
        const name = FILES[f] + (r + 1);
        const p = board[idx];
        const occ = p ? `${p.colour === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[p.type]}` : '—';
        rows.push(`<tr><td class="sq-name">${name}</td><td class="${p ? 'occ' : ''}">${occ}</td></tr>`);
      }
    }
    table.innerHTML = rows.join('');
  }

  renderOfferBanner() {
    const banner = $('[data-offer-banner]', this.root);
    if (!banner || !this.game) return;
    banner.innerHTML = '';
    const me = this.root.dataset.viewer;
    const offer = this.game.draw_offer_by;
    const takeback = this.game.takeback_by;
    if (offer && offer !== me && this.isPlayer) {
      banner.innerHTML = `<div class="card frosted" style="padding:10px">
        <strong>${offer}</strong> offers a draw.
        <button class="btn btn-sm btn-primary" data-offer="accept"><span class="label">Accept</span></button>
        <button class="btn btn-sm" data-offer="decline">Decline</button>
      </div>`;
      banner.querySelector('[data-offer="accept"]').onclick = async () => {
        const res = await call('POST', `/api/games/${this.gameId}/draw-response`, { accept: true });
        if (!res.ok) toast(res.data?.error || 'That did not work.', true);
        else await this.load(false);
      };
      banner.querySelector('[data-offer="decline"]').onclick = async () => {
        const res = await call('POST', `/api/games/${this.gameId}/draw-response`, { accept: false });
        if (!res.ok) toast(res.data?.error || 'That did not work.', true);
        else await this.load(false);
      };
    } else if (offer === me) {
      banner.innerHTML = `<div class="card frosted" style="padding:10px">You have offered a draw.</div>`;
    }
    if (takeback && takeback !== me && this.isPlayer) {
      banner.innerHTML += `<div class="card frosted" style="padding:10px;margin-top:8px">
        <strong>${takeback}</strong> asks for a takeback.
        <button class="btn btn-sm btn-primary" data-takeback="accept"><span class="label">Accept</span></button>
        <button class="btn btn-sm" data-takeback="decline">Decline</button>
      </div>`;
      const acc = banner.querySelector('[data-takeback="accept"]');
      if (acc) acc.onclick = async () => {
        const res = await call('POST', `/api/games/${this.gameId}/takeback-response`, { accept: true });
        if (!res.ok) toast(res.data?.error || 'That did not work.', true);
        else await this.load(false);
      };
      const dec = banner.querySelector('[data-takeback="decline"]');
      if (dec) dec.onclick = async () => {
        const res = await call('POST', `/api/games/${this.gameId}/takeback-response`, { accept: false });
        if (!res.ok) toast(res.data?.error || 'That did not work.', true);
        else await this.load(false);
      };
    } else if (takeback === me) {
      banner.innerHTML += `<div class="card frosted" style="padding:10px;margin-top:8px">You have asked for a takeback.</div>`;
    }
  }

  showOverScreen() {
    const res = this.game.result;
    const myColour = this.viewerColour;
    const draw = res === '1/2-1/2';
    const iWon = (res === '1-0' && myColour === 'white') || (res === '0-1' && myColour === 'black');
    const overlay = document.createElement('div');
    overlay.className = 'game-over-overlay ' + (draw ? 'draw' : iWon ? 'win' : 'loss');
    const reason = this.game.end_reason || '';
    const kingCode = (draw ? 'wk' : iWon ? 'wk' : (myColour === 'white' ? 'wk' : 'bk'));
    const motionClass = reduceMotion() ? ' still' : '';
    overlay.innerHTML = `
      <div class="marks" aria-hidden="true">
        ${iWon ? Array.from({ length: 10 }, (_, i) =>
          `<span style="--mx:${Math.cos(i / 10 * 6.28) * 140}px;--my:${Math.sin(i / 10 * 6.28) * 140}px;animation-delay:${i * 40}ms"></span>`).join('') : ''}
      </div>
      <div class="panel${motionClass}">
        <div class="king-art">${pieceSvg(kingCode, this.pieceSet)}</div>
        <div class="title">${draw ? 'Drawn' : this.isPlayer ? (iWon ? 'You won' : 'You lost') : (res === '1-0' ? 'White won' : 'Black won')}</div>
        <div class="reason">${draw ? `Reason: ${reason}` : reason}</div>
        ${this.isPlayer ? `<button class="btn btn-primary" data-rematch><span class="label">Rematch</span></button>` : ''}
      </div>`;
    this.frame.style.position = 'relative';
    this.frame.appendChild(overlay);
    const btn = overlay.querySelector('[data-rematch]');
    if (btn) btn.onclick = async () => this.control('rematch');
    announce(draw ? 'Drawn' : iWon ? 'You won' : 'You lost');
  }

  kbdKey(e) {
    const btn = e.target.closest('button[data-square]');
    if (!btn) return;
    const sq = btn.dataset.square;
    const f = FILES.indexOf(sq[0]);
    const r = parseInt(sq[1], 10) - 1;
    let nf = f, nr = r;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': nf = Math.max(0, f - 1); break;
      case 'ArrowRight': nf = Math.min(7, f + 1); break;
      case 'ArrowUp': nr = Math.min(7, r + 1); break;
      case 'ArrowDown': nr = Math.max(0, r - 1); break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.tapSquare(sq);
        return;
      case 'Escape':
        this.selected = null;
        this.renderMarks();
        return;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      const next = this.kbdBoard.querySelector(`[data-square="${FILES[nf]}${nr + 1}"]`);
      if (next) next.focus();
    }
  }
}

// ---------------------------------------------------------------- forms
async function handleForm(form, submit) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const errBox = form.querySelector('[data-form-error]');
    if (errBox) errBox.textContent = '';
    try {
      await submit(form, errBox);
    } catch (err) {
      if (errBox) errBox.textContent = err.message || 'That did not work.';
      else toast(err.message || 'That did not work.', true);
    }
  });
}

function fieldError(form, inputId, message) {
  const box = form.querySelector(`[data-error-for="${inputId}"]`);
  if (box) box.textContent = message || '';
}

// ---------------------------------------------------------------- boot
function boot() {
  // rail toggle
  const railBtn = $('[data-action="open-rail"]');
  const rail = $('.rail');
  if (railBtn && rail) {
    railBtn.addEventListener('click', () => rail.classList.toggle('open'));
    document.addEventListener('click', e => {
      if (rail.classList.contains('open') && !rail.contains(e.target) && e.target !== railBtn) {
        rail.classList.remove('open');
      }
    });
  }

  // sign out
  $$('[data-action="signout"]').forEach(btn => btn.addEventListener('click', async () => {
    await call('POST', '/api/auth/logout');
    window.location.href = '/';
  }));

  // login
  const loginForm = $('[data-form="login"]');
  if (loginForm) handleForm(loginForm, async (form, errBox) => {
    const res = await call('POST', '/api/auth/login', {
      email: $('#login-username').value.trim(),
      password: $('#login-password').value,
    });
    if (!res.ok) {
      const msg = res.data && res.data.error ? res.data.error : 'That sign-in did not work.';
      if (res.status === 423) fieldError(loginForm, 'login-username', msg);
      else fieldError(loginForm, 'login-username', msg);
      if (errBox) errBox.textContent = msg;
      throw new Error(msg);
    }
    const next = new URLSearchParams(window.location.search).get('next');
    window.location.href = next || '/hall';
  });

  // join
  const joinForm = $('[data-form="join"]');
  if (joinForm) handleForm(joinForm, async (form, errBox) => {
    const res = await call('POST', '/api/auth/register', {
      username: $('#join-username').value.trim(),
      email: $('#join-email').value.trim(),
      password: $('#join-password').value,
    });
    if (!res.ok) {
      const msg = res.data && res.data.error ? res.data.error : 'That did not join.';
      if (res.status === 422) fieldError(joinForm, 'join-username', msg);
      if (errBox) errBox.textContent = msg;
      return;
    }
    const li = await call('POST', '/api/auth/login', {
      email: $('#join-username').value.trim(),
      password: $('#join-password').value,
    });
    if (li.ok) window.location.href = '/hall';
    else window.location.href = '/login';
  });

  // challenge forms
  $$('[data-form="challenge"]').forEach(form => handleForm(form, async (form, errBox) => {
    const res = await call('POST', '/api/challenges', {
      opponent: $('#ch-opponent', form).value.trim(),
      colour: $('#ch-colour', form).value,
      rated: $('#ch-rated', form).checked,
    });
    if (!res.ok) {
      const msg = res.data && res.data.error ? res.data.error : 'That challenge was not sent.';
      fieldError(form, 'ch-opponent', msg);
      if (errBox) errBox.textContent = msg;
      return;
    }
    toast('Challenge sent.');
    fieldError(form, 'ch-opponent', '');
    $('#ch-opponent', form).value = '';
  }));

  // accept / decline challenges
  document.addEventListener('click', async e => {
    const acc = e.target.closest('[data-accept]');
    if (acc) {
      // one accept under one idempotency key: a replay returns the same game
      const key = 'accept-' + acc.dataset.accept;
      const res2 = await fetch(`/api/challenges/${acc.dataset.accept}/accept`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        credentials: 'same-origin',
      });
      const data = await res2.json().catch(() => null);
      if (res2.ok && data && data.id) window.location.href = `/game/${data.id}`;
      else toast(data && data.error ? data.error : 'That did not work.', true);
      return;
    }
    const dec = e.target.closest('[data-decline]');
    if (dec) {
      const res = await call('POST', `/api/challenges/${dec.dataset.decline}/decline`);
      toast(res.ok ? 'Declined.' : (res.data?.error || 'That did not work.'), !res.ok);
      if (res.ok) setTimeout(() => window.location.reload(), 400);
      return;
    }
    const mark = e.target.closest('[data-read]');
    if (mark) {
      const res = await call('POST', `/api/notifications/${mark.dataset.read}/read`);
      if (res.ok) window.location.reload();
      return;
    }
    const voidBtn = e.target.closest('[data-void]');
    if (voidBtn) {
      if (!confirm('Void this rated game? Every later rated game of both players is recomputed.')) return;
      const res = await call('POST', `/api/admin/games/${voidBtn.dataset.void}/void`);
      if (res.ok) { toast('Game voided and later games recomputed.'); setTimeout(() => window.location.reload(), 500); }
      else toast(res.data?.error || 'That did not work.', true);
      return;
    }
    const house = e.target.closest('[data-house-level]');
    if (house) {
      const res = await call('POST', '/api/computer-games', { level: house.dataset.houseLevel });
      if (res.ok && res.data && res.data.id) window.location.href = `/game/${res.data.id}`;
      else toast(res.data?.error || 'The house is not ready.', true);
      return;
    }
    const chUser = e.target.closest('[data-challenge-user]');
    if (chUser) {
      const res = await call('POST', '/api/challenges', {
        opponent: chUser.dataset.challengeUser, rated: true, colour: 'White',
      });
      if (res.ok) toast('Challenge sent.');
      else toast(res.data?.error || 'That did not work.', true);
      return;
    }
    const dl = e.target.closest('[data-action="download-record"]');
    if (dl) {
      const text = $('[data-record-text]') ? $('[data-record-text]').textContent : '';
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gambit-hall-game-record.txt';
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }
  });

  // study from FEN
  const fenForm = $('[data-form="from-fen"]');
  if (fenForm) handleForm(fenForm, async (form) => {
    const res = await call('POST', '/api/games/from-fen', { fen: $('#fen-input').value.trim() });
    if (res.ok && res.data && res.data.id) window.location.href = `/game/${res.data.id}`;
    else fieldError(fenForm, 'fen-input', res.data?.error || 'That position record is not valid.');
  });

  // rename
  const renameForm = $('[data-form="rename"]');
  if (renameForm) handleForm(renameForm, async (form) => {
    const res = await call('PATCH', '/api/profile', { username: $('#set-username').value.trim() });
    if (!res.ok) { fieldError(form, 'set-username', res.data?.error || 'That name was not saved.'); return; }
    toast('Name saved. It now shows everywhere.');
    setTimeout(() => window.location.reload(), 700);
  });

  // avatar choice
  $$('input[name="avatar"]').forEach(radio => radio.addEventListener('change', async () => {
    const res = await call('PUT', '/api/profile/avatar', { avatar: radio.value });
    if (res.ok) toast('Picture saved.');
    else toast(res.data?.error || 'That picture was not saved.', true);
  }));

  // avatar upload
  const uploadForm = $('[data-form="avatar-upload"]');
  if (uploadForm) uploadForm.addEventListener('submit', async e => {
    e.preventDefault();
    const file = $('#avatar-file').files[0];
    const errBox = $('[data-form-error]', uploadForm);
    if (!file) { if (errBox) errBox.textContent = 'Choose a picture to upload.'; return; }
    if (file.size > 2 * 1024 * 1024) { if (errBox) errBox.textContent = 'A picture may be at most 2 MB.'; return; }
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/profile/avatar', { method: 'PUT', body: fd, credentials: 'same-origin' });
    if (res.ok) { toast('Picture uploaded.'); setTimeout(() => window.location.reload(), 600); }
    else {
      const data = await res.json().catch(() => null);
      if (errBox) errBox.textContent = data?.error || 'That picture was not accepted.';
    }
  });

  // preferences: saved with the account the moment they change
  $$('[data-pref]').forEach(select => select.addEventListener('change', async () => {
    const field = select.dataset.pref;
    const value = field === 'sound' ? select.value === 'true' : select.value;
    const res = await call('PATCH', '/api/profile', { [field]: value });
    if (res.ok) toast('Saved with your account.');
    else toast(res.data?.error || 'That preference was not saved.', true);
    // applying the theme and sets to any board on this page
    if (field === 'theme') {
      const layout = $('.game-layout');
      if (layout) layout.classList.remove('theme-Walnut', 'theme-Slate', 'theme-Ocean', 'theme-Forest', 'theme-Neon'), layout.classList.add(`theme-${value}`);
    }
  }));

  // import record
  const importForm = $('[data-form="import-record"]');
  if (importForm) handleForm(importForm, async (form) => {
    const res = await call('POST', '/api/games/import', { record: $('#record-input').value });
    if (res.ok && res.data && res.data.id) window.location.href = `/game/${res.data.id}`;
    else fieldError(form, 'record-input', res.data?.error || 'That record was not imported.');
  });

  // the game screen
  const layout = $('.game-layout[data-game-id]');
  if (layout) new GameScreen(layout);

  // live unread count in the rail
  const badge = $('[data-unread]');
  if (badge) {
    setInterval(async () => {
      const res = await call('GET', '/api/notifications');
      if (res.ok && res.data) {
        badge.textContent = res.data.unread;
        badge.classList.toggle('zero', res.data.unread === 0);
      }
    }, 5000);
  }

  // draw animation for a finished drawn game opened cold
  const drawnOverlay = $('.game-over-overlay.draw .panel');
  if (drawnOverlay) drawnOverlay.style.animation = 'draw-settle 600ms ease-out';
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
