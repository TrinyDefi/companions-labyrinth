/* polar-maze.js — PROVIDED, TESTED. Do not modify. (Run: node test/test-maze.js)
 * Circular maze logic only. No drawing, no DOM.
 * Angle convention: theta = 0 points RIGHT (+x). theta increases CLOCKWISE on screen
 * (because screen y points down). theta = PI/2 is straight DOWN on screen.
 * Radius is normalized: 0 = center, 1 = outer edge. Each ring has height 1/rings.
 * Row 0 = the single center cell (the goal). Row rings-1 = the outermost ring (start).
 */
(function (root) {
  'use strict';
  var TAU = Math.PI * 2;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function levelConfig(level) {
    var lv = Math.max(1, Math.floor(level));
    var rings = Math.min(6, 4 + Math.floor((lv - 1) / 2));
    var chests = Math.min(5, 3 + Math.floor((lv - 1) / 4));
    var timeSeconds = 40 + 12 * rings;
    return { level: lv, rings: rings, chests: chests, timeSeconds: timeSeconds };
  }

  function create(rings, seed) {
    if (!(rings >= 2 && rings <= 12)) throw new Error('rings must be between 2 and 12');
    var rng = mulberry32(seed);
    var counts = [1], offset = [0], i;
    for (i = 1; i < rings; i++) {
      var ratio = Math.max(1, Math.round(TAU * i / counts[i - 1]));
      counts.push(counts[i - 1] * ratio);
      offset.push(offset[i - 1] + counts[i - 1]);
    }
    var total = offset[rings - 1] + counts[rings - 1];
    var rowOf = new Array(total), colOf = new Array(total);
    for (i = 0; i < rings; i++) for (var c = 0; c < counts[i]; c++) { rowOf[offset[i] + c] = i; colOf[offset[i] + c] = c; }
    function id(row, col) { return offset[row] + col; }

    var nbCache = new Array(total);
    function neighbors(cid) {
      if (nbCache[cid]) return nbCache[cid];
      var row = rowOf[cid], col = colOf[cid], n = counts[row];
      var out = { cw: -1, ccw: -1, inward: -1, outward: [] };
      if (row > 0) {
        out.cw = id(row, (col + 1) % n);
        out.ccw = id(row, (col - 1 + n) % n);
        out.inward = id(row - 1, Math.floor(col / (n / counts[row - 1])));
      }
      if (row < rings - 1) {
        var r2 = counts[row + 1] / n;
        for (var k = 0; k < r2; k++) out.outward.push(id(row + 1, col * r2 + k));
      }
      nbCache[cid] = out;
      return out;
    }
    function allNeighbors(cid) {
      var nb = neighbors(cid), a = [];
      if (nb.cw >= 0) a.push(nb.cw);
      if (nb.ccw >= 0 && nb.ccw !== nb.cw) a.push(nb.ccw);
      if (nb.inward >= 0) a.push(nb.inward);
      for (var k = 0; k < nb.outward.length; k++) a.push(nb.outward[k]);
      return a;
    }

    var links = new Array(total);
    for (i = 0; i < total; i++) links[i] = {};
    function link(a, b) { links[a][b] = true; links[b][a] = true; }
    function isLinked(a, b) { return links[a][b] === true; }

    // Recursive backtracker (iterative), rooted at the center cell => perfect maze.
    var visited = new Array(total).fill(false), stack = [0];
    visited[0] = true;
    while (stack.length) {
      var cur = stack[stack.length - 1];
      var cand = allNeighbors(cur).filter(function (x) { return !visited[x]; });
      if (!cand.length) { stack.pop(); continue; }
      var nxt = cand[Math.floor(rng() * cand.length)];
      link(cur, nxt); visited[nxt] = true; stack.push(nxt);
    }

    var last = rings - 1;
    var entranceCol = Math.round(counts[last] / 4 - 0.5);
    var startId = id(last, entranceCol);
    var goalId = 0;

    function geometry(cid) {
      var row = rowOf[cid], col = colOf[cid], n = counts[row];
      return {
        row: row, col: col,
        r0: row / rings, r1: (row + 1) / rings,
        rc: row === 0 ? 0 : (row + 0.5) / rings,
        a0: col * TAU / n, a1: (col + 1) * TAU / n,
        ac: (col + 0.5) * TAU / n
      };
    }

    function openNeighbors(cid) {
      return allNeighbors(cid).filter(function (x) { return isLinked(cid, x); });
    }

    // Wall segments in polar coordinates, ready to draw.
    //   {kind:'arc',    r, a0, a1, outer}   a wall along a circle of radius r from angle a0 to a1
    //   {kind:'radial', a, r0, r1}          a wall along angle a from radius r0 to r1
    function walls() {
      var w = [];
      for (var cid = 1; cid < total; cid++) {
        var g = geometry(cid), nb = neighbors(cid);
        if (!isLinked(cid, nb.inward)) w.push({ kind: 'arc', r: g.r0, a0: g.a0, a1: g.a1, outer: false });
        if (!isLinked(cid, nb.cw)) w.push({ kind: 'radial', a: g.a1, r0: g.r0, r1: g.r1 });
        if (g.row === last && cid !== startId) w.push({ kind: 'arc', r: 1, a0: g.a0, a1: g.a1, outer: true });
      }
      return w;
    }

    function bfs(fromId) {
      var dist = new Array(total).fill(-1), prev = new Array(total).fill(-1), q = [fromId], h = 0;
      dist[fromId] = 0;
      while (h < q.length) {
        var cur = q[h++], o = openNeighbors(cur);
        for (var k = 0; k < o.length; k++) if (dist[o[k]] < 0) { dist[o[k]] = dist[cur] + 1; prev[o[k]] = cur; q.push(o[k]); }
      }
      return { dist: dist, prev: prev };
    }
    function path(fromId, toId) {
      var b = bfs(fromId), p = [], cur = toId;
      if (b.dist[toId] < 0) return [];
      while (cur !== -1) { p.push(cur); cur = b.prev[cur]; }
      return p.reverse(); // from -> to, inclusive
    }

    // Chest placement: deterministic for (maze, chestSeed). Prefers dead ends far from start, spread apart.
    function placeChests(count, chestSeed) {
      var r = mulberry32(chestSeed), b = bfs(startId), pool = [], k, j;
      for (k = 1; k < total; k++) if (k !== startId && b.dist[k] >= 3) pool.push(k);
      var dead = pool.filter(function (x) { return Object.keys(links[x]).length === 1; });
      function shuffle(a) { for (var x = a.length - 1; x > 0; x--) { var y = Math.floor(r() * (x + 1)); var t = a[x]; a[x] = a[y]; a[y] = t; } return a; }
      var order = shuffle(dead.slice()).concat(shuffle(pool.filter(function (x) { return dead.indexOf(x) < 0; })));
      var picked = [];
      for (j = 0; j < order.length && picked.length < count; j++) {
        var ok = true, d = bfs(order[j]).dist;
        for (k = 0; k < picked.length; k++) if (d[picked[k]] < 4) { ok = false; break; }
        if (ok) picked.push(order[j]);
      }
      for (j = 0; j < order.length && picked.length < count; j++) if (picked.indexOf(order[j]) < 0) picked.push(order[j]);
      for (k = 1; k < total && picked.length < count; k++) if (k !== startId && picked.indexOf(k) < 0) picked.push(k);
      return picked;
    }

    return {
      rings: rings, seed: seed, total: total, counts: counts, startId: startId, goalId: goalId,
      id: id, rowOf: function (c) { return rowOf[c]; }, colOf: function (c) { return colOf[c]; },
      geometry: geometry, neighbors: neighbors, openNeighbors: openNeighbors, isLinked: isLinked,
      walls: walls, bfs: bfs, path: path, placeChests: placeChests
    };
  }

  var api = { create: create, levelConfig: levelConfig, mulberry32: mulberry32, TAU: TAU };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PolarMaze = api;
})(typeof window !== 'undefined' ? window : this);
