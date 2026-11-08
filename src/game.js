/* game.js — Companion Labyrinth main game (builder-written, follows SPEC.md; UPDATE-A.md wins for responsive layout, landscape option, traps).
 * Plain canvas + vanilla JS. No dependencies, no network.
 * Requires: src/config.js (window.CONFIG), src/polar-maze.js (window.PolarMaze),
 * src/traps.js (window.Traps), src/maze-renderer.js (window.MazeRenderer), src/share.js (window.buildShareCard).
 */
(function () {
'use strict';

var C = window.CONFIG;
var PM = window.PolarMaze;
var MR = window.MazeRenderer;
var TR = window.Traps;
var TAU = Math.PI * 2;
var FONT_STACK = '"Arial Rounded MT Bold", "Trebuchet MS", "Segoe UI", system-ui, sans-serif';

function font(weight, px) { return weight + ' ' + px + 'px ' + FONT_STACK; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, u) { return a + (b - a) * u; }

/* ---------------- canvas + responsive layout (UPDATE-A 2.1, 2.2) ---------------- */
var canvas = document.getElementById('game');
var fitEl = document.getElementById('fit');
var ctx = canvas.getContext('2d');
var dpr = 1;
var L = MR.computeLayout(540, 960); // replaced on every applyLayout
var builtKey = '';

function layoutKey() { return L.W + 'x' + L.H + '|' + L.orientation + '|' + dpr; }

function rebuildScenes() {
  if (!assetsReady) return;
  // Same maze objects, all state (player cell, hop, chests, traps, timers, score) untouched.
  if (selectSceneMaze) {
    selectScene = MR.createScene({ maze: selectSceneMaze, images: images, scale: dpr, layout: L });
  }
  if (maze) {
    scene = MR.createScene({ maze: maze, images: images, scale: dpr, layout: L });
  }
}

function applyLayout() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  var r = fitEl.getBoundingClientRect();
  L = MR.computeLayout(r.width, r.height);
  canvas.width = Math.round(L.W * dpr);
  canvas.height = Math.round(L.H * dpr);
  var s = Math.min(r.width / L.W, r.height / L.H);
  canvas.style.width = (L.W * s) + 'px';
  canvas.style.height = (L.H * s) + 'px';
  var key = layoutKey();
  if (key !== builtKey) {
    builtKey = key;
    rebuildScenes(); // all cached screen positions come from L, so nothing else is cached
  }
}

var resizeTimer = null;
function scheduleLayout() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () { resizeTimer = null; applyLayout(); }, 100);
}
window.addEventListener('resize', scheduleLayout);
window.addEventListener('orientationchange', scheduleLayout);

/* ---------------- URL params (SPEC 11) ---------------- */
var params = new URLSearchParams(location.search);
var DEBUG = params.get('debug') === '1';
function paramLevel() {
  var n = parseInt(params.get('level'), 10);
  if (!isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}
function paramSeed() {
  if (!params.has('seed')) return null;
  var n = parseInt(params.get('seed'), 10);
  if (!isFinite(n)) return null;
  return n >>> 0;
}
function paramTime() {
  if (!params.has('time')) return null;
  var n = parseFloat(params.get('time'));
  if (!isFinite(n) || n < 0) return null;
  return n;
}
var VALID_CHARS = C.CHARACTERS.map(function (c) { return c.id; });
function paramChar() {
  var v = params.get('char');
  return VALID_CHARS.indexOf(v) >= 0 ? v : null;
}

/* ---------------- state ---------------- */
var state = 'LOADING'; // LOADING, SELECT, PLAYING, LEVEL_CLEAR, GAME_OVER
var images = {};      // exactly CONFIG.IMAGES keys (SPEC 3.3)
var charImages = {};  // keyed by character id
var assetsReady = false;
var loadError = null;

var selId = C.CHARACTERS[0].id;
var runSeed = 0;
var level = 1, score = 0, chestsTotal = 0, levelsReached = 1;
var cfg = null, maze = null, chestMap = {}, scene = null;
var cur = 0, hop = null, prevCell = null;
var timeLeft = 0, chestsThisLevel = 0;
/* traps (UPDATE-A 4) */
var traps = null, tcfg = null, levelTime = 0;
var invulnUntil = 0, spikeFlashT0 = -1e9;
var introduced = {}, bannerQueue = [], bannerT0 = 0;
var rotateMsgUntil = 0;
var levelStartT = 0, lastInputT = 0, hintDismissed = false;
var clearUntil = 0, lastLevelScore = 0;
var opens = [], bursts = [], floaters = []; // chest + trap effects
var selectScene = null, selectSceneMaze = null;
var gameCard = null;
var shareMsg = null, shareMsgUntil = 0;
var best = null;
var fps = 60, fpsCount = 0, fpsT = 0;

function charDef(id) {
  for (var i = 0; i < C.CHARACTERS.length; i++) {
    if (C.CHARACTERS[i].id === id) return C.CHARACTERS[i];
  }
  return C.CHARACTERS[0];
}
function hopMs() { return charDef(selId).perk === 'swift' ? C.HOP_MS_SWIFT : C.HOP_MS; }
function chestBonus() { return charDef(selId).perk === 'chestlover' ? C.CHEST_BONUS_S_CHESTLOVER : C.CHEST_BONUS_S; }

/* ---------------- image loading (SPEC 3.3) ---------------- */
function loadOne(path) {
  return new Promise(function (resolve, reject) {
    var im = new Image();
    im.onload = function () { resolve(im); };
    im.onerror = function () { reject(new Error(path)); };
    im.src = path;
  });
}

function loadAll() {
  var jobs = [];
  Object.keys(C.IMAGES).forEach(function (key) {
    jobs.push(loadOne(C.IMAGES[key]).then(function (im) { images[key] = im; }));
  });
  C.CHARACTERS.forEach(function (ch) {
    jobs.push(loadOne(ch.img).then(function (im) { charImages[ch.id] = im; }));
  });
  return Promise.all(jobs);
}

/* ---------------- levels (SPEC 4.1, 7 + UPDATE-A 4.1) ---------------- */
function startTimeFor(c) {
  var t = paramTime();
  if (t !== null) return t;
  var s = c.timeSeconds;
  if (charDef(selId).perk === 'timekeeper') s += C.TIMEKEEPER_BONUS_S;
  return s;
}

function queueTrapBanners() {
  var now = performance.now();
  var first = bannerQueue.length === 0;
  var types = ['spike', 'goo', 'gate'];
  var present = {
    spike: traps.spikes.length > 0,
    goo: traps.goo.length > 0,
    gate: traps.gates.length > 0
  };
  for (var i = 0; i < types.length; i++) {
    var ty = types[i];
    if (present[ty] && !introduced[ty]) {
      introduced[ty] = true;
      bannerQueue.push(C.TRAP_INTRO[ty]);
    }
  }
  if (first && bannerQueue.length > 0) bannerT0 = now;
}

function buildLevel(lv) {
  level = lv;
  levelsReached = lv;
  cfg = PM.levelConfig(lv);
  var seed = ((runSeed + lv * 7919) >>> 0);
  maze = PM.create(cfg.rings, seed);
  var cells = maze.placeChests(cfg.chests, ((seed * 13 + 5) >>> 0));
  chestMap = {};
  cells.forEach(function (c) { chestMap[c] = { collected: false }; });
  tcfg = TR.levelConfig(lv);
  if (params.get('traps') === '0') {
    traps = { spikes: [], goo: [], gates: [], cfg: tcfg };
  } else {
    traps = TR.place(maze, lv, seed, cells);
  }
  scene = MR.createScene({ maze: maze, images: images, scale: dpr, layout: L });
  cur = maze.startId;
  hop = null;
  prevCell = null;
  chestsThisLevel = 0;
  timeLeft = startTimeFor(cfg);
  levelTime = 0;
  var now = performance.now();
  levelStartT = now;
  lastInputT = now;
  hintDismissed = false;
  opens = [];
  bursts = [];
  floaters = [];
  queueTrapBanners();
}

function startRun() {
  var s = paramSeed();
  runSeed = (s === null) ? Math.floor(Math.random() * 2147483647) : s;
  level = paramLevel();
  score = 0;
  chestsTotal = 0;
  gameCard = null;
  shareMsg = null;
  introduced = {};
  bannerQueue = [];
  invulnUntil = 0;
  spikeFlashT0 = -1e9;
  buildLevel(level);
  state = 'PLAYING';
}

function readBest() {
  best = null;
  try {
    var v = window.localStorage.getItem(C.STORAGE_KEY);
    if (v !== null) {
      var n = parseInt(v, 10);
      if (isFinite(n) && n > 0) best = n;
    }
  } catch (e) { /* storage may be blocked */ }
}

function persistBest() {
  try {
    var prev = parseInt(window.localStorage.getItem(C.STORAGE_KEY), 10);
    if (!isFinite(prev) || levelsReached > prev) {
      window.localStorage.setItem(C.STORAGE_KEY, String(levelsReached));
    }
  } catch (e) { /* storage may be blocked */ }
  readBest();
}

function buildCard() {
  // UPDATE-A 5: the share card background is always a portrait scene.
  var cardScene = MR.createScene({ maze: maze, images: images, scale: 1, layout: MR.computeLayout(540, 960) });
  gameCard = window.buildShareCard({
    layer: cardScene.layer,
    characterImg: charImages[selId],
    levelsReached: levelsReached,
    chestsTotal: chestsTotal,
    score: score
  });
}

function enterGameOver() {
  if (!scene) return;
  levelsReached = level;
  persistBest();
  buildCard();
  state = 'GAME_OVER';
}

function enterLevelClear(now) {
  lastLevelScore = 100 + Math.floor(timeLeft) * 2 + chestsThisLevel * 25;
  score += lastLevelScore;
  clearUntil = now + C.LEVEL_CLEAR_MS;
  state = 'LEVEL_CLEAR';
}

/* ---------------- arrival checks (SPEC 5.3, 7.1, 7.3) ---------------- */
function spawnChestEffect(cellId, cx, cy, now, bonus) {
  opens.push({ cell: cellId, t0: now });
  var colors = ['#d9a6ff', '#7fe3ff', '#ffffff'];
  for (var i = 0; i < 14; i++) {
    var a = Math.random() * TAU;
    var sp = 40 + Math.random() * 70;
    bursts.push({
      x: cx, y: cy,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      r: 3 + Math.random() * 3,
      color: colors[i % colors.length],
      t0: now
    });
  }
  floaters.push({ x: cx, y0: cy - 20, text: '+' + bonus + 's', fill: '#ffe27a', t0: now });
}

function arrivalChecks(now) {
  var info = chestMap[cur];
  if (info && !info.collected) {
    info.collected = true;
    var bonus = chestBonus();
    timeLeft += bonus;
    chestsThisLevel++;
    chestsTotal++;
    var p = scene.cellCenter(cur);
    spawnChestEffect(cur, p.x, p.y, now, bonus);
  }
  if (maze && cur === maze.goalId) {
    enterLevelClear(now);
  }
}

/* ---------------- movement (SPEC 5 + UPDATE-A 4.4-4.6) ---------------- */
function tryMove(vec, now) {
  if (state !== 'PLAYING' || hop !== null) return false;
  var len = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
  if (len < 0.35) return false;
  var dx = vec.x / len, dy = vec.y / len;
  var from = scene.cellCenter(cur);
  var bestN = -1, bestScore = 0.45;
  var opts = maze.openNeighbors(cur).filter(function (n) {
    var g = TR.gateBetween(traps, cur, n);
    return !(g && TR.gateBlocks(g, levelTime, level)); // closed gates refuse the move
  });
  for (var i = 0; i < opts.length; i++) {
    var p = scene.cellCenter(opts[i]);
    var vx = p.x - from.x, vy = p.y - from.y;
    var vl = Math.sqrt(vx * vx + vy * vy);
    if (vl <= 0) continue;
    var score = (vx / vl) * dx + (vy / vl) * dy;
    if (score > bestScore) { bestScore = score; bestN = opts[i]; }
  }
  if (bestN < 0) return false;
  var to = scene.cellCenter(bestN);
  var dir = (to.x - from.x) === 0 ? 1 : ((to.x - from.x) > 0 ? 1 : -1);
  var dur = hopMs();
  if (TR.gooAt(traps, bestN)) dur = dur * tcfg.gooSlow; // slime slows the hop in
  hop = { from: cur, to: bestN, t0: now, dur: dur, dir: dir };
  hintDismissed = true;
  return true;
}

function hopU(now) {
  if (!hop) return 0;
  return clamp((now - hop.t0) / hop.dur, 0, 1);
}

function updatePlaying(vec, now) {
  if (vec.x !== 0 || vec.y !== 0) lastInputT = now;
  tryMove(vec, now);
  if (hop && hopU(now) >= 1) {
    prevCell = hop.from;
    cur = hop.to;
    hop = null;
    arrivalChecks(now);
    if (state === 'PLAYING') tryMove(vec, now); // continuous movement, same frame
  }
}

/* spikes hurt only while up and only when the player is not mid-hop (UPDATE-A 4.4) */
function checkSpikes(now) {
  if (state !== 'PLAYING' || hop !== null || !traps) return;
  var sp = TR.spikeAt(traps, cur);
  if (!sp) return;
  if (TR.spikeState(sp, levelTime, level) !== 'up') return;
  if (now < invulnUntil) return;
  timeLeft -= tcfg.penaltySeconds;
  var p = scene.cellCenter(cur);
  floaters.push({ x: p.x, y0: p.y - 20, text: '-' + tcfg.penaltySeconds + 's', fill: '#ff6b8a', t0: now });
  spikeFlashT0 = now;
  if (prevCell !== null && prevCell !== undefined) {
    var from = scene.cellCenter(cur);
    var to = scene.cellCenter(prevCell);
    var dir = (to.x - from.x) === 0 ? 1 : ((to.x - from.x) > 0 ? 1 : -1);
    hop = { from: cur, to: prevCell, t0: now, dur: hopMs(), dir: dir }; // knockback ignores gates
    hintDismissed = true;
  }
  invulnUntil = now + tcfg.invulnSeconds * 1000;
  if (timeLeft <= 0) {
    timeLeft = 0;
    enterGameOver();
  }
}

/* ---------------- input (SPEC 6, positions from L) ---------------- */
var joyVec = { x: 0, y: 0 };
var joyPointerId = null;
var keysDown = {};

function toLogical(e) {
  var r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * L.W / r.width,
    y: (e.clientY - r.top) * L.H / r.height
  };
}

function setJoyFromPoint(p) {
  var J = L.joystick;
  var vx = (p.x - J.cx) / J.baseR;
  var vy = (p.y - J.cy) / J.baseR;
  var len = Math.sqrt(vx * vx + vy * vy);
  if (len > 1) { vx /= len; vy /= len; }
  joyVec.x = vx;
  joyVec.y = vy;
}

function keyVec() {
  var x = 0, y = 0;
  if (keysDown.ArrowLeft || keysDown.KeyA) x -= 1;
  if (keysDown.ArrowRight || keysDown.KeyD) x += 1;
  if (keysDown.ArrowUp || keysDown.KeyW) y -= 1;
  if (keysDown.ArrowDown || keysDown.KeyS) y += 1;
  var len = Math.sqrt(x * x + y * y);
  if (len > 1) { x /= len; y /= len; }
  return { x: x, y: y, len: Math.min(1, len) };
}

function inputVec() {
  var k = keyVec();
  var jl = Math.sqrt(joyVec.x * joyVec.x + joyVec.y * joyVec.y);
  if (k.len >= jl) return { x: k.x, y: k.y };
  return { x: joyVec.x, y: joyVec.y };
}

function inRect(p, x, y, w, h) {
  return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
}

function markInput(now) { lastInputT = now; }

/* rotate button (UPDATE-A 3.2): touch + portrait + layout provides the rect */
function rotateVisible() {
  return (navigator.maxTouchPoints > 0) && L.orientation === 'portrait' && !!L.select.rotateBtn;
}

function tryRotate() {
  try {
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  } catch (e) { /* never throw */ }
  try {
    if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
      var pr = window.screen.orientation.lock('landscape');
      if (pr && pr.catch) pr.catch(function () {});
    }
  } catch (e) { /* never throw */ }
  rotateMsgUntil = performance.now() + 4000; // always show the hint (UPDATE-A 3.3)
}

canvas.addEventListener('pointerdown', function (e) {
  e.preventDefault();
  var p = toLogical(e);
  var now = performance.now();
  if (state === 'SELECT') {
    var d = L.toDesign(p.x, p.y);
    var cards = L.select.cards;
    for (var i = 0; i < C.CHARACTERS.length; i++) {
      var r = cards[i];
      if (inRect(d, r.x, r.y, r.w, r.h)) { selId = C.CHARACTERS[i].id; return; }
    }
    var pb = L.select.play;
    if (inRect(d, pb.x, pb.y, pb.w, pb.h)) { startRun(); return; }
    var rb = L.select.rotateBtn;
    if (rb && rotateVisible() && inRect(d, rb.x, rb.y, rb.w, rb.h)) { tryRotate(); return; }
    return;
  }
  if (state === 'GAME_OVER') {
    var gd = L.toDesign(p.x, p.y);
    var btns = L.over.buttons;
    if (inRect(gd, btns[0].x, btns[0].y, btns[0].w, btns[0].h)) { doShare(); return; }
    if (inRect(gd, btns[1].x, btns[1].y, btns[1].w, btns[1].h)) { doSave(); return; }
    if (inRect(gd, btns[2].x, btns[2].y, btns[2].w, btns[2].h)) {
      readBest();
      state = 'SELECT';
      return;
    }
    return;
  }
  if (state === 'PLAYING') {
    markInput(now);
    var J = L.joystick;
    var dx = p.x - J.cx, dy = p.y - J.cy;
    if (Math.sqrt(dx * dx + dy * dy) <= J.hitR && joyPointerId === null) {
      joyPointerId = e.pointerId;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      setJoyFromPoint(p);
    }
  }
  /* LEVEL_CLEAR: input ignored (SPEC 2) */
}, { passive: false });

canvas.addEventListener('pointermove', function (e) {
  e.preventDefault();
  if (joyPointerId !== null && e.pointerId === joyPointerId && state === 'PLAYING') {
    setJoyFromPoint(toLogical(e));
  }
}, { passive: false });

function joyRelease(e) {
  if (joyPointerId !== null && (e.pointerId === joyPointerId || e.pointerId === undefined)) {
    joyPointerId = null;
    joyVec.x = 0;
    joyVec.y = 0;
  }
}
canvas.addEventListener('pointerup', function (e) { e.preventDefault(); joyRelease(e); }, { passive: false });
canvas.addEventListener('pointercancel', function (e) { joyRelease(e); }, { passive: false });

window.addEventListener('keydown', function (e) {
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault();
  }
  keysDown[e.code] = true;
  if (state === 'PLAYING') markInput(performance.now());
});
window.addEventListener('keyup', function (e) { keysDown[e.code] = false; });
window.addEventListener('blur', function () {
  keysDown = {};
  joyVec.x = 0; joyVec.y = 0; joyPointerId = null;
});

/* ---------------- drawing helpers ---------------- */
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function styledText(str, x, y, f, fill, outline, ow, align, baseline) {
  ctx.save();
  ctx.font = f;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = baseline || 'alphabetic';
  ctx.lineJoin = 'round';
  if (outline && ow > 0) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = ow;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(str, x, y);
  ctx.restore();
}

function wrap2lines(text, maxW, f) {
  ctx.font = f;
  if (ctx.measureText(text).width <= maxW) return [text];
  var words = text.split(' ');
  var lines = [''];
  for (var i = 0; i < words.length; i++) {
    var curLine = lines[lines.length - 1];
    var trial = curLine ? (curLine + ' ' + words[i]) : words[i];
    if (ctx.measureText(trial).width <= maxW || !curLine) {
      lines[lines.length - 1] = trial;
    } else if (lines.length < 2) {
      lines.push(words[i]);
    } else {
      lines[1] += ' ' + words[i];
    }
  }
  return lines.slice(0, 2);
}

/* ---------------- entities (SPEC 4.3 + UPDATE-A 4.3) ---------------- */
function charSize(img) {
  var h = scene.charHeight;
  return { w: h * img.naturalWidth / img.naturalHeight, h: h };
}

function playerGround(now) {
  if (!hop) return scene.cellCenter(cur);
  var a = scene.cellCenter(hop.from);
  var b = scene.cellCenter(hop.to);
  var u = hopU(now);
  var e = u * u * (3 - 2 * u);
  return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e) };
}

function makePlayerEntity(now, t) {
  var img = charImages[selId];
  var g = playerGround(now);
  var hopping = hop !== null;
  var u = hopping ? hopU(now) : 0;
  var s = hopping ? Math.sin(Math.PI * u) : 0;
  var lift = hopping ? Math.sin(Math.PI * u) * 10 : 0;
  var bob = hopping ? 0 : -Math.abs(Math.sin(t * 4)) * 1.5;
  var size = charSize(img);
  var scX = 1 - 0.08 * s, scY = 1 + 0.12 * s;
  var rot = hopping ? hop.dir * 0.10 * s : 0;
  var feetY = g.y - lift + bob;
  var halfW = (size.w * scX) / 2;
  var top = feetY - size.h * scY;
  return {
    y: g.y,
    bbox: { x: g.x - halfW - 10, y: top - 10, w: halfW * 2 + 20, h: (g.y + 10) - (top - 10) },
    draw: function (c) {
      c.save();
      if (now < invulnUntil && Math.floor(now / 100) % 2 === 1) c.globalAlpha = 0.5; // blink while invulnerable
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.beginPath();
      c.ellipse(g.x, g.y, size.w * 0.3, 4, 0, 0, TAU);
      c.fill();
      c.translate(g.x, feetY);
      c.rotate(rot);
      c.scale(scX, scY);
      c.drawImage(img, -size.w / 2, -size.h, size.w, size.h);
      c.restore();
    }
  };
}

function makeChestEntity(cellId, openImg) {
  var img = openImg || images.chest_closed;
  var p = scene.cellCenter(cellId);
  var w = scene.charHeight * 0.78;
  var h = w * img.naturalHeight / img.naturalWidth;
  return {
    y: p.y + 4,
    bbox: { x: p.x - w / 2 - 10, y: p.y + 4 - h - 10, w: w + 20, h: h + 20 },
    draw: function (c) { c.drawImage(img, p.x - w / 2, p.y + 4 - h, w, h); }
  };
}

function collectEntities(now, t) {
  var list = [];
  if (traps) list = scene.trapEntities(traps, levelTime, level); // never on the select screen
  list.push(makePlayerEntity(now, t));
  Object.keys(chestMap).forEach(function (key) {
    var id = parseInt(key, 10);
    if (!chestMap[key].collected) list.push(makeChestEntity(id));
  });
  return list;
}

/* ---------------- effects (SPEC 7.2 + UPDATE-A 4.4) ---------------- */
function drawEffects(now) {
  var i, e, age;
  for (i = 0; i < opens.length; i++) {
    e = opens[i];
    if (now - e.t0 > 350) continue;
    makeChestEntity(e.cell, images.chest_open).draw(ctx);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (i = 0; i < bursts.length; i++) {
    e = bursts[i];
    age = (now - e.t0) / 1000;
    if (age < 0 || age > 0.6) continue;
    ctx.globalAlpha = 1 - age / 0.6;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x + e.vx * age, e.y + e.vy * age, e.r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 1;
  for (i = 0; i < floaters.length; i++) {
    e = floaters[i];
    age = now - e.t0;
    if (age < 0 || age > 800) continue;
    var y = e.y0 - 30 * (age / 800);
    ctx.globalAlpha = 1 - age / 800;
    styledText(e.text, e.x, y, font(800, 20), e.fill || '#ffe27a', '#1a0b2e', 4, 'center', 'middle');
  }
  ctx.restore();
}

function drawSpikeFlash(now) {
  var age = now - spikeFlashT0;
  if (age < 0 || age > 250) return;
  ctx.fillStyle = 'rgba(255,40,80,' + (0.25 * (1 - age / 250)).toFixed(3) + ')';
  ctx.fillRect(0, 0, L.W, L.H);
}

function drawBanners(now) {
  if (!bannerQueue.length) return;
  var idx = Math.floor((now - bannerT0) / C.TRAP_INTRO_MS);
  if (idx >= bannerQueue.length) { bannerQueue = []; return; }
  styledText(bannerQueue[idx], L.W / 2, L.hud.bottom + 28, font(800, 16), '#ffe27a', '#1a0b2e', 4);
}

/* ---------------- HUD (SPEC 8, positions from L.hud) ---------------- */
function pillRect(p) {
  rr(p.x, p.y, p.w, p.h, 24);
  ctx.fillStyle = 'rgba(22,12,42,0.82)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#8a5cf0';
  ctx.stroke();
}

function drawHUD(now, t) {
  var pills = L.hud.pills;
  /* chest pill */
  var p0 = pills[0], mid0 = p0.y + p0.h / 2 + 1;
  pillRect(p0);
  var ci = images.chest_closed;
  var cw = 34, chh = cw * ci.naturalHeight / ci.naturalWidth;
  ctx.drawImage(ci, p0.x + 10, mid0 - chh / 2, cw, chh);
  styledText(chestsThisLevel + '/' + cfg.chests, p0.x + p0.w - 12, mid0, font(800, 24), '#ffffff', '#1a0b2e', 4, 'right', 'middle');
  /* timer pill (pulse pink at <= 10 s) */
  var p1 = pills[1], mid1 = p1.y + p1.h / 2 + 1;
  var low = timeLeft <= 10;
  ctx.save();
  if (low) {
    var s = 1 + 0.04 * Math.sin(TAU * 3 * t);
    ctx.translate(p1.x + p1.w / 2, mid1);
    ctx.scale(s, s);
    ctx.translate(-(p1.x + p1.w / 2), -mid1);
  }
  pillRect(p1);
  ctx.save();
  ctx.strokeStyle = low ? '#ff4fa3' : '#c9a2ff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(p1.x + 27, mid1, 13, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = low ? '#ff4fa3' : '#c9a2ff';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p1.x + 27, mid1);
  ctx.lineTo(p1.x + 27, mid1 - 8);
  ctx.moveTo(p1.x + 27, mid1);
  ctx.lineTo(p1.x + 27 + 6, mid1 + 3);
  ctx.stroke();
  ctx.restore();
  var total = Math.max(0, Math.ceil(timeLeft));
  var mm = Math.floor(total / 60), ss = total % 60;
  var clock = (mm < 10 ? '0' + mm : '' + mm) + ':' + (ss < 10 ? '0' + ss : '' + ss);
  styledText(clock, p1.x + 84, mid1, font(800, 24), low ? '#ff9ccf' : '#ffffff', '#1a0b2e', 4, 'center', 'middle');
  ctx.restore();
  /* level pill */
  var p2 = pills[2], mid2 = p2.y + p2.h / 2 + 1;
  pillRect(p2);
  var wg = ctx.createLinearGradient(0, mid2 - 12, 0, mid2 + 12);
  wg.addColorStop(0, '#c06bff');
  wg.addColorStop(1, '#ff5ad1');
  ctx.save();
  ctx.font = font(800, 24);
  var wW = ctx.measureText('W').width;
  var wx = p2.x + 12;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1a0b2e';
  ctx.lineWidth = 4;
  ctx.strokeText('W', wx, mid2);
  ctx.fillStyle = wg;
  ctx.fillText('W', wx, mid2);
  ctx.restore();
  var lt = 'LEVEL ' + level;
  var size = 24;
  ctx.font = font(800, size);
  var maxW = (p2.x + p2.w - 12) - (wx + wW + 8);
  while (size > 10 && ctx.measureText(lt).width > maxW) {
    size -= 1;
    ctx.font = font(800, size);
  }
  styledText(lt, p2.x + p2.w - 12, mid2, font(800, size), '#ffffff', '#1a0b2e', 4, 'right', 'middle');

  /* level-1 move hint */
  if (level === 1 && !hintDismissed && (now - levelStartT) < 4000) {
    styledText('Drag to move', L.hint.x, L.hint.y, font(400, 16), '#d9bfff', null, 0, 'center', 'middle');
  }
  /* debug overlay */
  if (DEBUG) {
    styledText('FPS ' + fps + ' · cell ' + cur, 8, L.H - 8, font(400, 12), '#ffffff', null, 0, 'left', 'middle');
  }
}

/* ---------------- joystick (SPEC 6.1, position from L.joystick) ---------------- */
function drawJoystick() {
  var J = L.joystick;
  ctx.save();
  ctx.beginPath();
  ctx.arc(J.cx, J.cy, J.baseR, 0, TAU);
  ctx.fillStyle = 'rgba(20,12,40,0.55)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(190,140,255,0.8)';
  ctx.stroke();
  /* four direction triangles at radius 52 */
  ctx.fillStyle = 'rgba(200,170,255,0.8)';
  var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (var i = 0; i < dirs.length; i++) {
    var dx = dirs[i][0], dy = dirs[i][1];
    var cxp = J.cx + dx * 52, cyp = J.cy + dy * 52;
    ctx.beginPath();
    if (dx === 0 && dy === -1) { ctx.moveTo(cxp, cyp - 9); ctx.lineTo(cxp - 7, cyp + 5); ctx.lineTo(cxp + 7, cyp + 5); }
    else if (dx === 0 && dy === 1) { ctx.moveTo(cxp, cyp + 9); ctx.lineTo(cxp - 7, cyp - 5); ctx.lineTo(cxp + 7, cyp - 5); }
    else if (dx === -1) { ctx.moveTo(cxp - 9, cyp); ctx.lineTo(cxp + 5, cyp - 7); ctx.lineTo(cxp + 5, cyp + 7); }
    else { ctx.moveTo(cxp + 9, cyp); ctx.lineTo(cxp - 5, cyp - 7); ctx.lineTo(cxp - 5, cyp + 7); }
    ctx.closePath();
    ctx.fill();
  }
  var kx = J.cx + joyVec.x * J.baseR * 0.7;
  var ky = J.cy + joyVec.y * J.baseR * 0.7;
  ctx.beginPath();
  ctx.arc(kx, ky, J.knobR, 0, TAU);
  ctx.fillStyle = 'rgba(150,130,200,0.9)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();
  ctx.restore();
}

/* ---------------- select screen (SPEC 9, rectangles from L.select design space) ---------------- */
function drawOutlineButton(r, label, px) {
  rr(r.x, r.y, r.w, r.h, r.h / 2);
  ctx.fillStyle = 'rgba(22,12,42,0.82)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#8a5cf0';
  ctx.stroke();
  styledText(label, r.x + r.w / 2, r.y + r.h / 2 + 1, font(800, px), '#ffffff', '#1a0b2e', 4, 'center', 'middle');
}

function drawSelect(t, now) {
  selectScene.draw(ctx, [], t);
  ctx.fillStyle = 'rgba(8,4,15,0.72)';
  ctx.fillRect(0, 0, L.W, L.H);
  var S = L.select, D = L.design;
  ctx.save();
  ctx.translate(D.tx, D.ty);
  ctx.scale(D.scale, D.scale);
  styledText(C.GAME_TITLE, S.title.x, S.title.y, font(900, S.title.size), '#ffffff', '#2a1050', 7);
  styledText(C.SUBTITLE, S.sub.x, S.sub.y, font(400, S.sub.size), '#d9bfff', null, 0);
  styledText('Choose your Companion', S.header.x, S.header.y, font(700, S.header.size), '#ffffff', null, 0);

  for (var i = 0; i < C.CHARACTERS.length; i++) {
    (function (ch, idx) {
      var r = S.cards[idx];
      var selected = ch.id === selId;
      ctx.save();
      if (selected) {
        ctx.shadowColor = '#ff5ad1';
        ctx.shadowBlur = 24;
      }
      rr(r.x, r.y, r.w, r.h, 22);
      ctx.fillStyle = 'rgba(26,16,46,0.85)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = selected ? 4 : 2;
      ctx.strokeStyle = selected ? '#ff5ad1' : '#5a3da0';
      ctx.stroke();
      ctx.restore();
      var img = charImages[ch.id];
      var sh = r.spriteH;
      var sw = sh * img.naturalWidth / img.naturalHeight;
      ctx.drawImage(img, r.x + r.w / 2 - sw / 2, r.spriteTop, sw, sh);
      styledText(ch.label, r.x + r.w / 2, r.labelY, font(700, 20), '#ffffff', null, 0);
      var lines = wrap2lines(ch.perkText, r.w - 30, font(400, 13));
      if (lines.length === 1) {
        styledText(lines[0], r.x + r.w / 2, r.perkY, font(400, 13), '#d9bfff', null, 0);
      } else {
        styledText(lines[0], r.x + r.w / 2, r.perkY - 7, font(400, 13), '#d9bfff', null, 0);
        styledText(lines[1], r.x + r.w / 2, r.perkY + 8, font(400, 13), '#d9bfff', null, 0);
      }
    })(C.CHARACTERS[i], i);
  }

  styledText('Fan-concept perks · not official', S.note.x, S.note.y, font(400, 13), 'rgba(217,191,255,0.8)', null, 0);
  if (best !== null) {
    styledText('Best: Level ' + best, S.best.x, S.best.y, font(400, 14), 'rgba(217,191,255,0.8)', null, 0);
  }
  var hasSel = selId !== null;
  ctx.save();
  if (!hasSel) ctx.globalAlpha = 0.4;
  var pg = ctx.createLinearGradient(S.play.x, 0, S.play.x + S.play.w, 0);
  pg.addColorStop(0, '#9b4dff');
  pg.addColorStop(1, '#ff5ad1');
  rr(S.play.x, S.play.y, S.play.w, S.play.h, 32);
  ctx.fillStyle = pg;
  ctx.fill();
  ctx.restore();
  styledText('PLAY', S.play.x + S.play.w / 2, S.play.y + S.play.h / 2 + 1, font(800, 28), '#ffffff', '#1a0b2e', 4, 'center', 'middle');

  if (rotateVisible()) {
    drawOutlineButton(S.rotateBtn, C.ROTATE_BTN, 20);
  }
  if (now < rotateMsgUntil) {
    styledText(C.ROTATE_HINT, 270, 862, font(400, 13), '#ffe27a', null, 0);
  }

  var foot = wrap2lines(C.DISCLAIMER, D.w - 40, font(400, 12));
  if (foot.length === 1) {
    styledText(foot[0], S.footer.x, S.footer.y, font(400, 12), 'rgba(217,191,255,0.7)', null, 0);
  } else {
    styledText(foot[0], S.footer.x, S.footer.y - 7, font(400, 12), 'rgba(217,191,255,0.7)', null, 0);
    styledText(foot[1], S.footer.x, S.footer.y + 7, font(400, 12), 'rgba(217,191,255,0.7)', null, 0);
  }
  ctx.restore();
}

/* ---------------- level-clear overlay ---------------- */
function drawLevelClear() {
  ctx.fillStyle = 'rgba(8,4,15,0.55)';
  ctx.fillRect(0, 0, L.W, L.H);
  styledText('Level ' + level + ' cleared!', L.W / 2, L.H / 2 - 24, font(900, 40), '#ffffff', '#1a0b2e', 8);
  styledText('+' + lastLevelScore + ' pts', L.W / 2, L.H / 2 + 24, font(800, 32), '#ffe27a', '#1a0b2e', 6);
}

/* ---------------- game over + share (SPEC 10, rectangles from L.over design space) ---------------- */
function drawGameButton(r, label, primary) {
  if (primary) {
    var g = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
    g.addColorStop(0, '#9b4dff');
    g.addColorStop(1, '#ff5ad1');
    rr(r.x, r.y, r.w, r.h, 30);
    ctx.fillStyle = g;
    ctx.fill();
  } else {
    rr(r.x, r.y, r.w, r.h, 30);
    ctx.fillStyle = 'rgba(22,12,42,0.82)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#8a5cf0';
    ctx.stroke();
  }
  styledText(label, r.x + r.w / 2, r.y + r.h / 2 + 1, font(800, 24), '#ffffff', '#1a0b2e', 4, 'center', 'middle');
}

function drawGameOver(now) {
  ctx.drawImage(scene.layer, 0, 0, L.W, L.H);
  ctx.fillStyle = 'rgba(8,4,15,0.8)';
  ctx.fillRect(0, 0, L.W, L.H);
  var O = L.over, D = L.design;
  ctx.save();
  ctx.translate(D.tx, D.ty);
  ctx.scale(D.scale, D.scale);
  styledText("Time's up!", O.heading.x, O.heading.y, font(900, O.heading.size), '#ffffff', '#1a0b2e', 8);
  if (gameCard) {
    ctx.drawImage(gameCard, O.card.x, O.card.y, O.card.w, O.card.h);
    rr(O.card.x, O.card.y, O.card.w, O.card.h, 12);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#8a5cf0';
    ctx.stroke();
  }
  drawGameButton(O.buttons[0], 'Share', true);
  drawGameButton(O.buttons[1], 'Save image', false);
  drawGameButton(O.buttons[2], 'Play again', false);
  if (shareMsg && now < shareMsgUntil) {
    styledText(shareMsg, O.msg.x, O.msg.y, font(400, 14), '#ffe27a', null, 0);
  }
  ctx.restore();
}

function shareText() {
  return 'I reached Level ' + levelsReached + ' in Companion Labyrinth, a fan-made game for ' +
    C.PROJECT_HANDLE + ' by ' + C.BUILDER_HANDLE + '. Can you beat me? ' + C.EXTRA_TAGS.join(' ');
}

function downloadCard(blob, name) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function showShareMsg(msg) {
  shareMsg = msg;
  shareMsgUntil = performance.now() + 4000;
}

function doSave() {
  try {
    if (!gameCard) return;
    var name = 'companion-labyrinth-level-' + levelsReached + '.png';
    gameCard.toBlob(function (blob) {
      if (!blob) { showShareMsg('Could not share. Use Save image.'); return; }
      downloadCard(blob, name);
    });
  } catch (e) {
    showShareMsg('Could not share. Use Save image.');
  }
}

function doShare() {
  try {
    if (!gameCard) return;
    var text = shareText();
    var name = 'companion-labyrinth-level-' + levelsReached + '.png';
    gameCard.toBlob(function (blob) {
      if (!blob) { showShareMsg('Could not share. Use Save image.'); return; }
      try {
        var file = new File([blob], name, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], text: text, url: location.href }).catch(function (err) {
            if (err && err.name !== 'AbortError') showShareMsg('Could not share. Use Save image.');
          });
        } else {
          downloadCard(blob, name);
          window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) +
            '&url=' + encodeURIComponent(location.href), '_blank', 'noopener');
          showShareMsg('Image saved. Attach it to your post.');
        }
      } catch (e) {
        showShareMsg('Could not share. Use Save image.');
      }
    });
  } catch (e) {
    showShareMsg('Could not share. Use Save image.');
  }
}

/* ---------------- loading / error ---------------- */
function drawLoading() {
  ctx.fillStyle = '#08040f';
  ctx.fillRect(0, 0, L.W, L.H);
  styledText(C.GAME_TITLE, L.W / 2, L.H / 2, font(900, 38), '#ffffff', '#2a1050', 7);
}

function drawLoadError() {
  ctx.fillStyle = '#08040f';
  ctx.fillRect(0, 0, L.W, L.H);
  styledText('Missing asset: ' + loadError, L.W / 2, L.H / 2, font(400, 16), '#ff9ccf', null, 0);
}

/* ---------------- main loop ---------------- */
var lastT = 0;

function loop(nowMs) {
  requestAnimationFrame(loop);
  var now = (typeof nowMs === 'number') ? nowMs : performance.now();
  var t = now / 1000;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  /* fps */
  fpsCount++;
  if (now - fpsT >= 500) {
    fps = Math.round(fpsCount * 1000 / Math.max(1, now - fpsT));
    fpsCount = 0;
    fpsT = now;
  }

  if (state === 'LOADING') { drawLoading(); lastT = now; return; }
  if (loadError) { drawLoadError(); lastT = now; return; }

  var dtRaw = (now - lastT) / 1000;
  lastT = now;

  if (state === 'SELECT') {
    drawSelect(t, now);
    return;
  }

  if (state === 'PLAYING') {
    if (!document.hidden && dtRaw > 0) {
      var step = Math.min(dtRaw, 0.1);
      timeLeft -= step; // frozen while hidden (SPEC 2)
      levelTime += step; // trap clock runs exactly when the level timer runs (UPDATE-A 4.2)
    }
    if (timeLeft <= 0) {
      timeLeft = 0;
      enterGameOver();
      drawGameOver(now);
      return;
    }
    updatePlaying(inputVec(), now);
    if (state === 'PLAYING') checkSpikes(now);
    if (state === 'GAME_OVER') { drawGameOver(now); return; } // goal + timeout same frame
    if (state === 'LEVEL_CLEAR') { /* fell through via arrival */ }
  }

  if (state === 'LEVEL_CLEAR') {
    scene.draw(ctx, collectEntities(now, t), t);
    drawEffects(now);
    drawSpikeFlash(now);
    drawHUD(now, t);
    drawBanners(now);
    drawJoystick();
    drawLevelClear();
    if (now >= clearUntil) {
      buildLevel(level + 1);
      state = 'PLAYING';
    }
    return;
  }

  if (state === 'PLAYING') {
    scene.draw(ctx, collectEntities(now, t), t);
    /* pathfinder hint (SPEC 4.4) */
    if (charDef(selId).perk === 'pathfinder' && hop === null && (now - lastInputT) >= C.HINT_IDLE_S * 1000) {
      scene.drawTrail(ctx, maze.path(cur, maze.goalId).slice(0, C.HINT_STEPS + 1), 0.6 + 0.4 * Math.sin(t * 4));
    }
    drawEffects(now);
    drawSpikeFlash(now);
    drawHUD(now, t);
    drawBanners(now);
    drawJoystick();
    return;
  }

  if (state === 'GAME_OVER') {
    drawGameOver(now);
    return;
  }
}

/* ---------------- debug API (SPEC 11 + UPDATE-A 4.9) ---------------- */
window.__cl = {
  get state() { return state; },
  get level() { return level; },
  get cell() { return cur; },
  get goal() { return maze ? maze.goalId : -1; },
  get timeLeft() { return timeLeft; },
  get traps() { return traps; },
  get levelTime() { return levelTime; },
  setLevelTime: function (s) { levelTime = s; },
  teleport: function (cellId) {
    if (!maze) return;
    hop = null;
    cur = cellId;
    if (state === 'PLAYING') arrivalChecks(performance.now());
  },
  pathToGoal: function () {
    if (!maze) return [];
    return maze.path(cur, maze.goalId);
  },
  setTime: function (s) { timeLeft = s; },
  forceGameOver: function () { enterGameOver(); },
  cardDataURL: function () {
    if (!gameCard) {
      if (!scene) return null;
      buildCard();
    }
    return gameCard.toDataURL('image/png');
  }
};

/* ---------------- boot ---------------- */
applyLayout();
readBest();
loadAll().then(function () {
  assetsReady = true;
  selectSceneMaze = PM.create(4, 1);
  selectScene = MR.createScene({ maze: selectSceneMaze, images: images, scale: dpr, layout: L });
  builtKey = layoutKey();
  var ch = paramChar();
  if (ch) {
    selId = ch;
    startRun();
    if (params.get('over') === '1') {
      levelsReached = level;
      chestsTotal = 7;
      score = 1234;
      persistBest();
      buildCard();
      state = 'GAME_OVER';
    }
  } else {
    state = 'SELECT';
  }
  lastT = performance.now();
  fpsT = lastT;
}).catch(function (err) {
  loadError = (err && err.message) ? err.message : String(err);
  try { console.error('Missing asset: ' + loadError); } catch (e) { /* noop */ }
});
requestAnimationFrame(loop);

})();
