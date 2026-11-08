/* maze-renderer.js v2 — PROVIDED, VISUALLY VERIFIED. Do not modify.
 * Draws the circular-maze ENVIRONMENT (floor, walls, pillars, crystals, center sigil) and the TRAPS in the
 * 3/4 view of reference/mockup.jpg. Works in a browser <canvas> and in node (@napi-rs/canvas).
 *
 * LAYOUT: the game's logical canvas is NOT fixed any more. Call
 *     const L = MazeRenderer.computeLayout(viewWidthPx, viewHeightPx);
 * It returns the logical size (L.W x L.H) and the exact rectangles for the maze, HUD, joystick and screens.
 * Portrait views get W=540 and H=800..1250. Landscape views get H=540 and W=760..1200.
 *
 *   const scene = MazeRenderer.createScene({ maze, images, scale, layout: L });  // once per level / per layout change
 *   scene.draw(ctx, entities, tSeconds);                                         // every frame
 *   scene.trapEntities(traps, levelTime, level) -> entities (put them in the same list as the player/chests)
 *   scene.cellCenter(cellId) -> {x, y}      ground point of a cell center (feet go here)
 *   scene.charHeight                        px height to draw characters at this level/layout
 *   scene.drawTrail(ctx, cellIds, alpha)    glowing hint trail
 *   scene.layer                             offscreen canvas of the static environment (scale px per logical px)
 *
 * images (all required): sigil_w, pillar, crystal_purple_s, crystal_purple_m, crystal_blue_s, crystal_blue_m
 * entity = { y: footY, bbox: {x, y, w, h}, draw(ctx) }   (bbox = where the entity is drawn, for occlusion)
 * Trap drawing needs window.Traps (src/traps.js) to be loaded before this file is used.
 */
(function (root) {
  'use strict';
  var TAU = Math.PI * 2, TILT = 0.82;

  var COL = {
    bgTop: '#08040f', bgBot: '#140a24',
    floor: '#21173a', stone: '#2b2048', crack: '#150d27',
    top: '#6e58a4', topHi: '#8a74c6', topEdge: '#43326f',
    side: '#3a2c62', sideDark: '#281c47', brick: '#4a3a78',
    rune: 'rgba(200,125,255,0.95)', runeGlow: 'rgba(150,70,255,0.35)'
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rngFrom(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function makeCanvas(w, h) {
    if (typeof document !== 'undefined') { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    return root.__makeCanvas(w, h); // node test harness provides this
  }

  // ---------------------------------------------------------------------------------------------
  // LAYOUT
  // ---------------------------------------------------------------------------------------------
  function computeLayout(vw, vh) {
    vw = Math.max(vw || 540, 200); vh = Math.max(vh || 960, 200);
    var land = vw > vh, W, H;
    if (!land) { W = 540; H = clamp(Math.round(540 * vh / vw), 800, 1250); }
    else { H = 540; W = clamp(Math.round(540 * vw / vh), 760, 1200); }
    var L = { orientation: land ? 'landscape' : 'portrait', W: W, H: H, tilt: TILT };

    // HUD: three pills in a row at the top
    var pw = 150, ph = 48, py = land ? 14 : 22;
    L.hud = { pills: [{ x: 14, y: py, w: pw, h: ph }, { x: Math.round((W - pw) / 2), y: py, w: pw, h: ph }, { x: W - 14 - pw, y: py, w: pw, h: ph }], bottom: py + ph };

    // joystick (bottom center in portrait, bottom left in landscape) and a reserved ability button (bottom right)
    var jr = 72;
    L.joystick = land ? { cx: 110, cy: H - 110, baseR: jr, knobR: 32, hitR: 110 } : { cx: W / 2, cy: H - 110, baseR: jr, knobR: 32, hitR: 110 };
    L.abilityBtn = land ? { cx: W - 110, cy: H - 110, r: 48 } : { cx: W - 80, cy: H - 110, r: 44 };
    L.hint = land ? { x: L.joystick.cx, y: L.joystick.cy - jr - 30 } : { x: W / 2, y: L.joystick.cy - jr - 40 };

    // maze placement
    var availTop = L.hud.bottom + 10, availBottom = land ? H - 16 : L.joystick.cy - jr - 22, avail = availBottom - availTop;
    var rxH = (avail - 30) / (2 * TILT), rxW = land ? (W - 400) / 2 : (W - 24) / 2;
    var rx = clamp(Math.min(rxH, rxW), 110, 252), ry = rx * TILT;
    L.maze = { cx: W / 2, cy: availTop + 30 + ry + Math.max(0, (avail - 30 - 2 * ry) / 2), rx: rx, ry: ry };

    // Screens are drawn in a fixed DESIGN space and scaled to fit: portrait 540x960, landscape 960x540.
    var dw = land ? 960 : 540, dh = land ? 540 : 960, s = Math.min(W / dw, H / dh);
    L.design = { w: dw, h: dh, scale: s, tx: (W - dw * s) / 2, ty: (H - dh * s) / 2 };
    // convert a logical point to design space:  dx = (x - tx) / scale
    L.toDesign = function (x, y) { return { x: (x - L.design.tx) / L.design.scale, y: (y - L.design.ty) / L.design.scale }; };

    function card(x, y, w, h, spriteH, labelDy, perkDy) { return { x: x, y: y, w: w, h: h, spriteH: spriteH, spriteTop: y + 16, labelY: y + labelDy, perkY: y + perkDy }; }
    if (!land) {
      L.select = {
        title: { x: 270, y: 70, size: 38 }, sub: { x: 270, y: 104, size: 15 }, header: { x: 270, y: 150, size: 20 },
        cards: [card(20, 170, 240, 280, 170, 214, 244), card(280, 170, 240, 280, 170, 214, 244), card(20, 466, 240, 280, 170, 214, 244), card(280, 466, 240, 280, 170, 214, 244)],
        note: { x: 270, y: 770 }, best: { x: 270, y: 790 }, play: { x: 120, y: 806, w: 300, h: 64 },
        rotateBtn: { x: 120, y: 878, w: 300, h: 38 }, footer: { x: 270, y: 935 }
      };
      L.over = { heading: { x: 270, y: 70, size: 40 }, card: { x: 70, y: 100, w: 400, h: 500 },
        buttons: [{ x: 70, y: 625, w: 400, h: 60 }, { x: 70, y: 697, w: 400, h: 52 }, { x: 70, y: 761, w: 400, h: 52 }], msg: { x: 270, y: 612 } };
    } else {
      L.select = {
        title: { x: 480, y: 44, size: 34 }, sub: { x: 480, y: 74, size: 15 }, header: { x: 480, y: 106, size: 18 },
        cards: [0, 1, 2, 3].map(function (i) { return card(56 + i * 216, 126, 200, 250, 140, 176, 204); }),
        note: { x: 480, y: 398 }, best: { x: 480, y: 418 }, play: { x: 340, y: 434, w: 280, h: 56 },
        rotateBtn: null, footer: { x: 480, y: 524 }
      };
      L.over = { heading: { x: 694, y: 96, size: 40 }, card: { x: 60, y: 40, w: 368, h: 460 },
        buttons: [{ x: 514, y: 150, w: 360, h: 60 }, { x: 514, y: 226, w: 360, h: 52 }, { x: 514, y: 294, w: 360, h: 52 }], msg: { x: 694, y: 130 } };
    }
    return L;
  }

  // ---------------------------------------------------------------------------------------------
  function makeGeom(L) {
    var m = L.maze, g = { W: L.W, H: L.H, CX: m.cx, CY: m.cy, RX: m.rx, RY: m.ry };
    g.project = function (r, theta) { return { x: g.CX + r * g.RX * Math.cos(theta), y: g.CY + r * g.RY * Math.sin(theta) }; };
    return g;
  }
  function wallHeight(g, rings) { return Math.max(14, Math.min(30, 0.62 * g.RY / rings)); }

  // ---------- floor / background (static) ----------
  function paintBackground(ctx, g) {
    var W = g.W, H = g.H, CX = g.CX, CY = g.CY, RX = g.RX;
    var gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, COL.bgTop); gr.addColorStop(1, COL.bgBot);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.fillStyle = COL.floor; ctx.fillRect(0, 0, W, H);
    var rnd = rngFrom(1234), sx = 30, sy = 20, x, y;
    for (y = -sy; y < H + sy; y += sy) {
      for (x = -sx; x < W + sx; x += sx) {
        var jx = (rnd() - 0.5) * 9, jy = (rnd() - 0.5) * 6, sh = rnd();
        ctx.beginPath();
        ctx.moveTo(x + jx, y + jy + 2); ctx.lineTo(x + sx - 2 + jx * 0.5, y + jy);
        ctx.lineTo(x + sx + jx, y + sy - 2 + jy); ctx.lineTo(x + 3 + jx, y + sy + jy * 0.5);
        ctx.closePath();
        ctx.fillStyle = sh < 0.33 ? '#261b40' : (sh < 0.66 ? COL.stone : '#2f2350');
        ctx.fill(); ctx.strokeStyle = COL.crack; ctx.lineWidth = 1.4; ctx.stroke();
      }
    }
    ctx.restore();
    var v = ctx.createRadialGradient(CX, CY, RX * 0.9, CX, CY, RX * 1.7);
    v.addColorStop(0, 'rgba(8,4,15,0)'); v.addColorStop(0.55, 'rgba(8,4,15,0.55)'); v.addColorStop(1, 'rgba(8,4,15,0.92)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  // ---------- walls ----------
  function buildWallPieces(maze, g) {
    var rings = maze.rings, ringH = 1 / rings, w = 0.16 * ringH, pieces = [], i, project = g.project;
    maze.walls().forEach(function (wl) {
      if (wl.kind === 'arc') {
        var ext = w / Math.max(wl.r, 0.05), a0 = wl.a0 - ext, a1 = wl.a1 + ext, span = a1 - a0;
        var n = Math.max(1, Math.ceil(span / (7 * Math.PI / 180)));
        for (i = 0; i < n; i++) {
          var t0 = a0 + span * i / n, t1 = a0 + span * (i + 1) / n;
          pieces.push({ g: [project(wl.r - w, t0), project(wl.r - w, t1), project(wl.r + w, t1), project(wl.r + w, t0)] });
        }
      } else {
        var d0 = w / wl.r0, d1 = w / wl.r1;
        pieces.push({ g: [project(wl.r0 - w * 0.6, wl.a - d0), project(wl.r0 - w * 0.6, wl.a + d0), project(wl.r1 + w * 0.6, wl.a + d1), project(wl.r1 + w * 0.6, wl.a - d1)] });
      }
    });
    return pieces;
  }

  function polyPath(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); }
  function polyLine(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke(); }

  var GLYPHS = [
    [[0.25, 0.2], [0.5, 0.8], [0.75, 0.2]],
    [[0.2, 0.25], [0.5, 0.5], [0.2, 0.75], [0.8, 0.75]],
    [[0.3, 0.2], [0.3, 0.8], [0.7, 0.5], [0.7, 0.8]],
    [[0.2, 0.5], [0.4, 0.2], [0.6, 0.8], [0.8, 0.5]]
  ];

  function drawWallPiece(ctx, p, Hh) {
    var g = p.g, k, n = 4, area = 0;
    for (k = 0; k < n; k++) { var a = g[k], b = g[(k + 1) % n]; area += a.x * b.y - b.x * a.y; }
    var s = area > 0 ? 1 : -1;
    for (k = 0; k < n; k++) {
      var P = g[k], Q = g[(k + 1) % n], dx = Q.x - P.x, dy = Q.y - P.y;
      var ny = s > 0 ? -dx : dx;
      if (ny <= 0) continue;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.5) continue;
      ctx.beginPath();
      ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.lineTo(Q.x, Q.y - Hh); ctx.lineTo(P.x, P.y - Hh); ctx.closePath();
      var grd = ctx.createLinearGradient(0, Math.min(P.y, Q.y) - Hh, 0, Math.max(P.y, Q.y));
      grd.addColorStop(0, p.shade ? '#44356f' : COL.side); grd.addColorStop(1, COL.sideDark);
      ctx.fillStyle = grd; ctx.fill();
      ctx.strokeStyle = COL.brick; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(P.x, P.y - Hh * 0.5); ctx.lineTo(Q.x, Q.y - Hh * 0.5); ctx.stroke();
      ctx.strokeStyle = 'rgba(10,5,20,0.55)'; ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke();
      if (p.glyph >= 0 && len >= 9) {
        var gl = GLYPHS[p.glyph], pts = gl.map(function (uv) { return { x: P.x + dx * uv[0], y: P.y + dy * uv[0] - Hh * (0.15 + 0.7 * uv[1]) }; });
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.strokeStyle = COL.runeGlow; ctx.lineWidth = 4; polyLine(ctx, pts);
        ctx.strokeStyle = COL.rune; ctx.lineWidth = 1.4; polyLine(ctx, pts);
      }
    }
    var top = g.map(function (q) { return { x: q.x, y: q.y - Hh }; });
    polyPath(ctx, top);
    ctx.fillStyle = p.shade ? COL.topHi : COL.top; ctx.fill();
    ctx.strokeStyle = COL.topEdge; ctx.lineWidth = 1; ctx.stroke();
  }

  function pieceBBox(p, Hh) {
    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    p.g.forEach(function (q) { minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x); miny = Math.min(miny, q.y - Hh); maxy = Math.max(maxy, q.y); });
    return { x: minx - 2, y: miny - 2, w: maxx - minx + 4, h: maxy - miny + 4 };
  }

  // ---------- traps (dynamic; returned as entities so walls in front of them still hide them) ----------
  function boundaryPoints(maze, g, a, b) {
    var ga = maze.geometry(a), gb = maze.geometry(b), pts = [], i, n, u;
    if (ga.row === gb.row) {
      var cnt = maze.counts[ga.row], ang = (gb.col === (ga.col + 1) % cnt) ? ga.a1 : ga.a0;
      n = 4;
      for (i = 0; i <= n; i++) { u = i / n; pts.push(g.project(ga.r0 + (ga.r1 - ga.r0) * u, ang)); }
    } else {
      var o = ga.row > gb.row ? ga : gb;
      n = Math.max(4, Math.ceil((o.a1 - o.a0) / (6 * Math.PI / 180)));
      for (i = 0; i <= n; i++) { u = i / n; pts.push(g.project(o.r0, o.a0 + (o.a1 - o.a0) * u)); }
    }
    return pts;
  }

  function spikeEntity(sc, trap, t, level) {
    var p = sc.cellCenter(trap.cell), s = sc.cellSize, Hh = sc.wallHeight, tilt = TILT, state = root.Traps.spikeState(trap, t, level);
    var ext = state === 'up' ? 1 : (state === 'warn' ? 0.28 + 0.14 * Math.sin(t * 22) : 0), sh = Math.max(11, Hh * 0.95);
    return {
      y: p.y - 3, bbox: { x: p.x - s * 1.5, y: p.y - sh - 12, w: s * 3, h: sh + s * 1.2 + 22 },
      draw: function (c) {
        if (state !== 'safe') {
          var gl = c.createRadialGradient(p.x, p.y, 2, p.x, p.y, s * 1.7);
          gl.addColorStop(0, state === 'up' ? 'rgba(255,60,95,0.45)' : 'rgba(255,90,120,' + (0.30 + 0.2 * Math.sin(t * 22)) + ')'); gl.addColorStop(1, 'rgba(255,60,95,0)');
          c.fillStyle = gl; c.fillRect(p.x - s * 1.8, p.y - s * 1.4, s * 3.6, s * 2.8);
        }
        c.beginPath(); c.ellipse(p.x, p.y, s * 1.1, s * 1.1 * tilt, 0, 0, TAU);
        c.fillStyle = '#150b26'; c.fill(); c.strokeStyle = '#4a3a78'; c.lineWidth = 2; c.stroke();
        var offs = [[0, 0], [-0.55, -0.1], [0.55, -0.1], [-0.28, 0.32], [0.28, 0.32]];
        offs.sort(function (a, b) { return a[1] - b[1]; });
        offs.forEach(function (o) {
          var bx = p.x + o[0] * s, by = p.y + o[1] * s * tilt, h = sh * ext;
          if (h < 1) { c.beginPath(); c.ellipse(bx, by, 2.2, 1.4, 0, 0, TAU); c.fillStyle = '#05020b'; c.fill(); return; }
          var sg = c.createLinearGradient(bx - 3, 0, bx + 3, 0); sg.addColorStop(0, '#7f89a6'); sg.addColorStop(0.5, '#e6ecff'); sg.addColorStop(1, '#8e98b5');
          c.beginPath(); c.moveTo(bx - 3.2, by); c.lineTo(bx + 3.2, by); c.lineTo(bx, by - h); c.closePath();
          c.fillStyle = sg; c.fill();
          c.beginPath(); c.moveTo(bx - 1.1, by - h * 0.72); c.lineTo(bx + 1.1, by - h * 0.72); c.lineTo(bx, by - h); c.closePath();
          c.fillStyle = state === 'up' ? '#ff7d9b' : '#ffc2d0'; c.fill();
        });
      }
    };
  }

  function gooEntity(sc, trap, t) {
    var p = sc.cellCenter(trap.cell), s = sc.cellSize, tilt = TILT;
    return {
      y: p.y - 4, bbox: { x: p.x - s * 1.5, y: p.y - s * 1.4, w: s * 3, h: s * 2.4 },
      draw: function (c) {
        c.save();
        c.beginPath(); c.ellipse(p.x, p.y, s * 1.25, s * 1.25 * tilt, 0, 0, TAU);
        var gr = c.createRadialGradient(p.x, p.y - 1, 2, p.x, p.y, s * 1.3);
        gr.addColorStop(0, '#9cf59a'); gr.addColorStop(0.65, '#45c060'); gr.addColorStop(1, '#1f7a40');
        c.fillStyle = gr; c.globalAlpha = 0.92; c.fill(); c.globalAlpha = 1;
        c.strokeStyle = '#175c33'; c.lineWidth = 2; c.stroke();
        c.beginPath(); c.ellipse(p.x - s * 0.35, p.y - s * 0.22 * tilt, s * 0.35, s * 0.12, -0.3, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fill();
        for (var i = 0; i < 3; i++) {
          var ph = ((t * 0.7 + (trap.seed % 7) * 0.31 + i * 0.37) % 1), bx = p.x + (i - 1) * s * 0.55 + Math.sin(ph * 6 + i) * 2, by = p.y - ph * s * 0.9, r = 1.2 + (1 - Math.abs(ph - 0.5) * 2) * 2.2;
          c.beginPath(); c.arc(bx, by, r, 0, TAU); c.fillStyle = 'rgba(210,255,215,' + (0.8 - ph * 0.6) + ')'; c.fill();
        }
        c.restore();
      }
    };
  }

  function gateEntity(sc, maze, gate, t, level) {
    var pts = boundaryPoints(maze, sc.geom, gate.a, gate.b), prog = root.Traps.gateProgress(gate, t, level), Hh = sc.wallHeight;
    var mid = pts[Math.floor(pts.length / 2)], minx = 1e9, maxx = -1e9, maxy = -1e9, miny = 1e9;
    pts.forEach(function (q) { minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x); maxy = Math.max(maxy, q.y); miny = Math.min(miny, q.y); });
    var barH = Hh * 1.05 * prog;
    return {
      y: mid.y, bbox: { x: minx - 6, y: miny - Hh * 1.2 - 6, w: maxx - minx + 12, h: maxy - miny + Hh * 1.2 + 14 },
      draw: function (c) {
        c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
        c.strokeStyle = '#2a1a05'; c.lineWidth = 5; polyLine(c, pts);
        c.strokeStyle = '#d9b44a'; c.lineWidth = 2.4; polyLine(c, pts);
        if (prog > 0.02) {
          var i;
          for (i = 0; i < pts.length; i++) {
            var q = pts[i];
            c.strokeStyle = '#1d1204'; c.lineWidth = 4.4; c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x, q.y - barH); c.stroke();
            c.strokeStyle = '#e8c65a'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x, q.y - barH); c.stroke();
            c.beginPath(); c.moveTo(q.x - 3, q.y - barH); c.lineTo(q.x, q.y - barH - 5); c.lineTo(q.x + 3, q.y - barH); c.closePath(); c.fillStyle = '#f6e08a'; c.fill();
          }
          var top = pts.map(function (q) { return { x: q.x, y: q.y - barH * 0.8 }; });
          c.strokeStyle = '#1d1204'; c.lineWidth = 4; polyLine(c, top);
          c.strokeStyle = '#d9b44a'; c.lineWidth = 2; polyLine(c, top);
          c.strokeStyle = 'rgba(255,200,90,' + (0.25 * prog) + ')'; c.lineWidth = 9; polyLine(c, top);
        }
        c.restore();
      }
    };
  }

  // ---------------------------------------------------------------------------------------------
  // SCENE
  // ---------------------------------------------------------------------------------------------
  function createScene(opts) {
    var maze = opts.maze, images = opts.images, scale = opts.scale || 1;
    var L = opts.layout || computeLayout(540, 960), g = makeGeom(L), W = g.W, H = g.H, project = g.project;
    var rings = maze.rings, Hh = wallHeight(g, rings), k = g.RX / 252;
    var layer = makeCanvas(Math.round(W * scale), Math.round(H * scale));
    var lc = layer.getContext('2d');
    lc.scale(scale, scale);
    paintBackground(lc, g);

    var sg = maze.geometry(maze.startId), ep = project(1.04, sg.ac);
    var eg = lc.createRadialGradient(ep.x, ep.y, 2, ep.x, ep.y, 46 * k);
    eg.addColorStop(0, 'rgba(210,120,255,0.55)'); eg.addColorStop(1, 'rgba(120,50,220,0)');
    lc.fillStyle = eg; lc.fillRect(ep.x - 50 * k, ep.y - 50 * k, 100 * k, 100 * k);

    var sw = 2 * g.RX / rings * 0.92, sh = sw * 0.72, sc = project(0, 0);
    var halo = lc.createRadialGradient(sc.x, sc.y, 4, sc.x, sc.y, sw * 0.85);
    halo.addColorStop(0, 'rgba(180,90,255,0.45)'); halo.addColorStop(1, 'rgba(120,50,220,0)');
    lc.fillStyle = halo; lc.fillRect(sc.x - sw, sc.y - sw, sw * 2, sw * 2);
    lc.drawImage(images.sigil_w, sc.x - sw / 2, sc.y - sh / 2, sw, sh);

    var items = [];
    var rnd = rngFrom(maze.seed * 31 + 7);
    buildWallPieces(maze, g).forEach(function (p) {
      p.shade = rnd() < 0.35; p.glyph = rnd() < 0.32 ? Math.floor(rnd() * GLYPHS.length) : -1;
      var ys = p.g.map(function (q) { return q.y; });
      p.key = (ys[0] + ys[1] + ys[2] + ys[3]) / 4;
      items.push({ key: p.key, bbox: pieceBBox(p, Hh), draw: function (c) { drawWallPiece(c, p, Hh); } });
    });
    function spriteItem(img, theta, rr, height, lift) {
      var pt = project(rr, theta), w = height * img.width / img.height;
      var x = pt.x - w / 2, y = pt.y - lift - height;
      return { key: pt.y, bbox: { x: x - 2, y: y - 2, w: w + 4, h: height + 4 }, draw: function (c) { c.drawImage(img, x, y, w, height); } };
    }
    [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5].forEach(function (deg) { items.push(spriteItem(images.pillar, deg * Math.PI / 180, 1.0, 66 * k, Hh * 0.35)); });
    [[0, 'crystal_purple_m'], [45, 'crystal_blue_s'], [135, 'crystal_purple_s'], [180, 'crystal_blue_m'], [225, 'crystal_purple_m'], [270, 'crystal_blue_s'], [315, 'crystal_purple_s']].forEach(function (a) {
      items.push(spriteItem(images[a[1]], a[0] * Math.PI / 180, 1.0, 40 * k, Hh * 0.2));
    });
    items.sort(function (a, b) { return a.key - b.key; });
    items.forEach(function (it) { it.draw(lc); });

    var sigilC = sc, haloR = sw * 0.8;
    var scene = {
      layer: layer, width: W, height: H, layout: L, geom: g, rings: rings, wallHeight: Hh,
      cellSize: Math.max(9, Math.min(20, g.RX / rings * 0.42)),
      charHeight: Math.max(46, Math.min(74, 1.1 * g.RX / rings)),
      project: project,
      cellCenter: function (cellId) { var q = maze.geometry(cellId); return project(q.rc, q.ac); },
      draw: function (ctx, entities, t) {
        ctx.drawImage(layer, 0, 0, W, H);
        var pulse = 0.22 + 0.12 * Math.sin((t || 0) * 2.4);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        var pg = ctx.createRadialGradient(sigilC.x, sigilC.y, 2, sigilC.x, sigilC.y, haloR);
        pg.addColorStop(0, 'rgba(190,110,255,' + pulse + ')'); pg.addColorStop(1, 'rgba(120,50,220,0)');
        ctx.fillStyle = pg; ctx.fillRect(sigilC.x - haloR, sigilC.y - haloR, haloR * 2, haloR * 2);
        ctx.restore();
        var list = (entities || []).slice().sort(function (a, b) { return a.y - b.y; });
        list.forEach(function (e) {
          e.draw(ctx);
          var bb = e.bbox;
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.key <= e.y) continue;
            var b = it.bbox;
            if (b.x < bb.x + bb.w && b.x + b.w > bb.x && b.y < bb.y + bb.h && b.y + b.h > bb.y) it.draw(ctx);
          }
        });
      },
      // traps: object from Traps.place; levelTime = seconds since the level started; returns entities
      trapEntities: function (traps, levelTime, level) {
        var out = [], self = this;
        if (!traps || !root.Traps) return out;
        traps.spikes.forEach(function (tr) { out.push(spikeEntity(self, tr, levelTime, level)); });
        traps.goo.forEach(function (tr) { out.push(gooEntity(self, tr, levelTime)); });
        traps.gates.forEach(function (tr) { out.push(gateEntity(self, maze, tr, levelTime, level)); });
        return out;
      },
      drawTrail: function (ctx, cellIds, alpha) {
        if (!cellIds || cellIds.length < 2) return;
        var pts = cellIds.map(function (c) { return this.cellCenter(c); }, this);
        ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(160,80,255,' + (0.35 * alpha) + ')'; ctx.lineWidth = 9; polyLine(ctx, pts);
        ctx.strokeStyle = 'rgba(235,170,255,' + (0.9 * alpha) + ')'; ctx.lineWidth = 2.5; polyLine(ctx, pts);
        ctx.restore();
      }
    };
    return scene;
  }

  var api = { createScene: createScene, computeLayout: computeLayout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MazeRenderer = api;
})(typeof window !== 'undefined' ? window : globalThis);
