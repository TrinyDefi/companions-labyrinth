/* traps.js — PROVIDED, TESTED. Do not modify. (Run: node test/test-traps.js)
 * Dungeon-trap LOGIC only (which traps exist, where, and their timing). No drawing, no DOM.
 * Drawing is done by maze-renderer.js (scene.trapEntities). Runtime rules (what happens when the
 * player touches a trap) are in UPDATE-A.md section 4.
 *
 * Trap types:
 *   spike  — a floor cell that cycles  safe -> warn -> up -> safe ...   Hurts only while state === 'up'.
 *   goo    — a floor cell; hopping INTO it takes twice as long. Never hurts.
 *   gate   — a passage between two linked cells (a,b) that periodically closes and reopens.
 *
 * Usage:
 *   const traps = Traps.place(maze, level, seed, avoidCells);   // once per level
 *   Traps.spikeState(spike, tSeconds, level)  -> 'safe' | 'warn' | 'up'
 *   Traps.gateProgress(gate, tSeconds, level) -> 0 (open) .. 1 (closed); blocked when >= 0.85
 *   Traps.gateBlocks(gate, t, level)          -> boolean
 *   Traps.spikeAt(traps, cell) / Traps.gooAt(traps, cell) -> trap | null
 *   Traps.gateBetween(traps, a, b)            -> gate | null
 * t is "level time": seconds since the level started (use a clock that does not run while paused).
 */
(function (root) {
  'use strict';

  function levelConfig(level) {
    var lv = Math.max(1, Math.floor(level));
    var spikes = lv < 2 ? 0 : Math.min(6, 1 + Math.ceil(lv / 2));
    var goo    = lv < 3 ? 0 : Math.min(5, lv - 1);
    var gates  = lv < 4 ? 0 : Math.min(3, Math.floor((lv - 2) / 2));
    var period = Math.max(1.8, 3.2 - 0.2 * lv);                 // spike cycle length (s)
    var up     = 0.8;                                           // spikes stay up (s)
    var warn   = Math.max(0.45, 0.8 - 0.04 * lv);               // warning before up (s)
    var safe   = period - up - warn;                            // safe window (s), always >= 0.5
    var gateClosed = 1.6;                                       // gate closed duration (s)
    var gateOpen   = Math.max(1.4, 3.0 - 0.15 * lv);            // gate open duration (s)
    return { level: lv, spikes: spikes, goo: goo, gates: gates,
             spikePeriod: period, spikeUp: up, spikeWarn: warn, spikeSafe: safe,
             gateClosed: gateClosed, gateOpen: gateOpen, gateRamp: 0.25,
             penaltySeconds: 4, invulnSeconds: 1.0, gooSlow: 2 };
  }

  function mulberry32(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // maze: object from PolarMaze.create. avoid: array of cell ids that must stay trap-free (chests etc.).
  function place(maze, level, seed, avoid) {
    var cfg = levelConfig(level), r = mulberry32((seed * 2654435761 + 99991) >>> 0);
    var bad = {}; (avoid || []).forEach(function (c) { bad[c] = true; });
    bad[maze.startId] = true; bad[maze.goalId] = true;
    var fromStart = maze.bfs(maze.startId).dist;
    var sol = maze.path(maze.startId, maze.goalId);            // start -> goal
    var onSol = {}; sol.forEach(function (c, i) { onSol[c] = i; });
    var used = {};                                             // cells taken by any trap
    function free(c) { return !bad[c] && !used[c] && maze.rowOf(c) > 0 && fromStart[c] >= 3; }
    function touchesTrap(c) { return maze.openNeighbors(c).some(function (n) { return used[n]; }); }
    function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

    var all = []; for (var c = 1; c < maze.total; c++) if (free(c)) all.push(c);
    var pathCells = shuffle(all.filter(function (c) { return onSol[c] !== undefined && onSol[c] >= 2 && onSol[c] <= sol.length - 2; }));
    var otherCells = shuffle(all.filter(function (c) { return onSol[c] === undefined; }));

    function take(n, preferPathShare) {
      var out = [], wantPath = Math.round(n * preferPathShare), pass, pools;
      for (pass = 0; pass < 2 && out.length < n; pass++) {          // pass 0: keep traps apart; pass 1: relax
        pools = [pathCells, otherCells];
        for (var p = 0; p < 2 && out.length < n; p++) {
          var pool = pools[p];
          for (var i = 0; i < pool.length && out.length < n; i++) {
            var cell = pool[i];
            if (used[cell] || !free(cell)) continue;
            if (p === 0 && out.filter(function (x) { return onSol[x] !== undefined; }).length >= wantPath) continue;
            if (pass === 0 && touchesTrap(cell)) continue;
            used[cell] = true; out.push(cell);
          }
        }
      }
      return out;
    }

    var spikes = take(cfg.spikes, 0.7).map(function (cell) { return { type: 'spike', cell: cell, offset: r() * cfg.spikePeriod }; });
    var goo = take(cfg.goo, 0.5).map(function (cell) { return { type: 'goo', cell: cell, seed: Math.floor(r() * 1000) }; });

    // gates sit on links of the solution path (never within the first 2 steps or the last step)
    var gates = [], idxs = [];
    for (var i = 2; i < sol.length - 1; i++) idxs.push(i);
    shuffle(idxs);
    for (var k = 0; k < idxs.length && gates.length < cfg.gates; k++) {
      var a = sol[idxs[k]], b = sol[idxs[k] + 1];
      if (maze.rowOf(b) === 0 || maze.rowOf(a) === 0) continue;
      if (gates.some(function (g) { return g.a === a || g.b === a || g.a === b || g.b === b; })) continue;
      gates.push({ type: 'gate', a: a, b: b, offset: r() * (cfg.gateOpen + cfg.gateClosed) });
    }
    // fallback: if the solution path was too short for all gates, put the rest on any other passage
    if (gates.length < cfg.gates) {
      var cand = shuffle(all.slice());
      for (var m = 0; m < cand.length && gates.length < cfg.gates; m++) {
        var ca = cand[m], nbs = maze.openNeighbors(ca);
        for (var q = 0; q < nbs.length && gates.length < cfg.gates; q++) {
          var cb = nbs[q];
          if (maze.rowOf(cb) === 0 || fromStart[ca] < 2 || fromStart[cb] < 2 || bad[ca] || bad[cb]) continue;
          if (gates.some(function (g) { return g.a === ca || g.b === ca || g.a === cb || g.b === cb; })) continue;
          gates.push({ type: 'gate', a: ca, b: cb, offset: r() * (cfg.gateOpen + cfg.gateClosed) });
        }
      }
    }
    return { spikes: spikes, goo: goo, gates: gates, cfg: cfg };
  }

  function spikeState(spike, t, level) {
    var c = levelConfig(level), ph = ((t + spike.offset) % c.spikePeriod + c.spikePeriod) % c.spikePeriod;
    if (ph < c.spikeSafe) return 'safe';
    if (ph < c.spikeSafe + c.spikeWarn) return 'warn';
    return 'up';
  }

  // 0 = fully open, 1 = fully closed. Cycle: open for gateOpen, ramp down, closed for gateClosed, ramp up.
  function gateProgress(gate, t, level) {
    var c = levelConfig(level), cyc = c.gateOpen + c.gateClosed, ph = ((t + gate.offset) % cyc + cyc) % cyc, ramp = c.gateRamp;
    if (ph < c.gateOpen - ramp) return 0;
    if (ph < c.gateOpen) return (ph - (c.gateOpen - ramp)) / ramp;
    if (ph < cyc - ramp) return 1;
    return 1 - (ph - (cyc - ramp)) / ramp;
  }
  function gateBlocks(gate, t, level) { return gateProgress(gate, t, level) >= 0.85; }

  function spikeAt(traps, cell) { for (var i = 0; i < traps.spikes.length; i++) if (traps.spikes[i].cell === cell) return traps.spikes[i]; return null; }
  function gooAt(traps, cell) { for (var i = 0; i < traps.goo.length; i++) if (traps.goo[i].cell === cell) return traps.goo[i]; return null; }
  function gateBetween(traps, a, b) { for (var i = 0; i < traps.gates.length; i++) { var g = traps.gates[i]; if ((g.a === a && g.b === b) || (g.a === b && g.b === a)) return g; } return null; }

  var api = { levelConfig: levelConfig, place: place, spikeState: spikeState, gateProgress: gateProgress, gateBlocks: gateBlocks, spikeAt: spikeAt, gooAt: gooAt, gateBetween: gateBetween };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Traps = api;
})(typeof window !== 'undefined' ? window : globalThis);
