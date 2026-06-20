// ==UserScript==
// @name         Wankle3D Cheat v27-cap-pred8 — v25-opt base + v26 features (prediction engine, magnetize fix, randomized safe-dir) properly ported onto slim+perf-optimized base
// @namespace    wankle-cheat
// @version      27.2.0
// @description  v27: v25-opt (slim + F cache + grid pointInTile + intercept/target cache + profiles collapsed) + v26's 3 real features (Tier 1+2 prediction engine with per-target pattern memory, magnetize root-cause fix, randomized safe-direction). v26 claimed dead-code cuts but didn't do them — this version actually has them. `=diag F8=toggle F9=menu 1-5=profiles.
// @author       bounty-research
// @match        https://wankle.online/*
// @match        http://wankle.online/*
// @match        https://wanshot.lol/*
// @match        http://wanshot.lol/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
'use strict';

// ═══════════════════════════════════════════════════════════════
//  PROFILES — press 1-5 in game to switch
//  IMPORTANT: The game currently limits player shells to 1 bounce.
//  Only the ricochet-missile enemy gets 2 bounces. Player ricochet
//  powerups are planned but not yet in the game. So default profiles
//  use maxBounces=1 for performance. Switch to 'Ricochet' profile
//  (or manually bump maxBounces in the menu) when you have a ricochet
//  powerup.
// ═══════════════════════════════════════════════════════════════
// Profile defaults — profiles override only the fields they specify
var PROFILE_DEFAULTS = {
  aimbot: false, triggerbot: false, shellIntercept: true,
  triggerAngle: 0.05, fireCooldownMs: 200,
  maxBounces: 1, searchStepDeg: 2.0, aimThrottleMs: 150, aimSmooth: 0.0,
  autoDodge: true, dodgeStrength: 0.6, dodgeHorizon: 1.3,
  espTanks: true, espShells: false, espMines: true, espPickups: false,
  espHealth: false, espDistance: false,
  solutions: false, tracer: true,
  autoRespawn: true, autoContinue: true
};
var PROFILES = {
  'Rage':     { desc: 'Full auto, max aggression.',
    aimbot: true, triggerbot: true, triggerAngle: 0.14, fireCooldownMs: 80,
    searchStepDeg: 1.5, aimThrottleMs: 60, aimSmooth: 0.0,
    dodgeStrength: 1.0, dodgeHorizon: 1.8,
    espShells: true, espPickups: true, espHealth: true, espDistance: true, solutions: true },
  'Legit':    { desc: 'Human-like. Smooth aim, fire delay, subtle ESP.',
    aimbot: true, triggerbot: true, triggerAngle: 0.04, fireCooldownMs: 350,
    aimThrottleMs: 120, aimSmooth: 0.7,
    dodgeStrength: 0.6, dodgeHorizon: 1.3, espTanks: true },
  'Safe':     { desc: 'ESP + dodge only. Manual aim.',
    shellIntercept: false, searchStepDeg: 2.0, aimThrottleMs: 150,
    dodgeStrength: 0.8, dodgeHorizon: 1.5,
    espShells: true, espPickups: true, espHealth: true, espDistance: true },
  'Ghost':    { desc: 'Minimal. Dodge + tracer only.',
    shellIntercept: false, searchStepDeg: 3.0, aimThrottleMs: 200,
    dodgeStrength: 0.5, dodgeHorizon: 1.2,
    espTanks: false, autoRespawn: false, autoContinue: false },
  'ESP Only': { desc: 'Just wallhack. No aimbot, no dodge, no auto.',
    shellIntercept: false, maxBounces: 0, searchStepDeg: 3.0, aimThrottleMs: 500,
    autoDodge: false, dodgeStrength: 0.0, dodgeHorizon: 1.0,
    espShells: true, espPickups: true, espHealth: true, espDistance: true,
    autoRespawn: false, autoContinue: false }
};

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════
var SHELL_SPEED = { normal: 320, missile: 680, ricochet: 980 };
var TANK_R      = 23;
var SHELL_CAP   = 5;  // PLAYER_DEFAULTS.shellCap from game constants
// Server shell hitbox = circle with radius 4.5u (SHELL_SIZE=9 from constants.js).
var SHELL_R     = 4.5;  // SHELL_SIZE / 2, from server constants
// Server's actual tank hitbox dimensions (from constants.js)
var TANK_HW     = 23;   // tank half-width (x dimension) — TANK_W/2
var TANK_HL     = 18;   // tank half-length (z dimension) — TANK_L/2
// Effective hitbox = tank box + shell radius (shell circle must overlap tank box)
// = (TANK_HW + SHELL_R) x (TANK_HL + SHELL_R) = 27.5 x 22.5
var HIT_HW      = TANK_HW + SHELL_R;  // 27.5 — half-width of effective hit zone
var HIT_HL      = TANK_HL + SHELL_R;  // 22.5 — half-length of effective hit zone
var TAU         = Math.PI * 2;
var PICKUP_COLORS = { speed: '#3CA0FF', shield: '#3CDC78', multi: '#FFA033' };
var LOCKED_SKINS  = ['cadet','crimson','midnight','toxic','champion','chrome',
                     'carbon','ironclad','glassCobalt','glassSmoke','glassEmerald',
                     'prism','architect','rainbow'];

// ═══════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════
var cfg = {
  enabled:       true,
  activeProfile: 'Rage',
  // Aimbot
  aimbot:        true,
  maxBounces:    1,    // current game limit (player shells bounce once). Bump to 2+ if you have a ricochet powerup.
  maxShotDist:   1800,
  aimSmooth:     0.0,
  searchStepDeg: 1.5,  // finer search step
  triggerbot:    true,
  triggerAngle:  0.15,
  fireCooldownMs: 100,   // min ms between triggerbot shots
  minHitProb:    0.12,  // fire aggressively on valid shots  // fires on most valid shots  // lowered — was blocking valid shots   // only fire if predicted hit probability >= this (0-1)
  aimThrottleMs: 80,
  solThrottleMs: 500,  // v22.8: throttled from 60 to 500 — was 4000 raycasts/sec just for visualization
  // Dodge
  autoDodge:        true,
  dodgeHorizon:     1.8,
  dodgeStrength:    1.0,
  dodgeBounces:     1,  // most shells bounce once
  dodgeReactionMs:  30,
  dodgeMargin:      32,
  dodgeMineSafeDist: 45,  // wider mine avoidance
  dodgeBlastSafeDist: 185,
  dodgeWallAware:   true,
  dodgeThreatViz:   true,
  dodgeVectorViz:   true,
  // ESP
  espTanks:    true,
  espHealth:   true,
  espDistance: true,
  espPickups:  true,
  espMines:    true,
  espShells:   true,
  espTracers:  false,
  tracer:      true,
  solutions:   true,
  // Utility
  autoRespawn:    true,
  autoContinue:   true,
  skinBypass:     '',
  // Targeting
  ignoreSpawnProt: true,
  ignoreDead:      true,
  ignoreBots:      false,
  // Shell interceptor (shoots down incoming shells)
  shellIntercept:  true,
  interceptRange:  220,    // only intercept shells within this radius of player
  interceptAngle:  0.25,   // aim tolerance for intercept shot (rad)
  // Self-ricochet safety (don't fire shots that bounce back into you)
  selfRicochetSafety: true,
  selfRicochetRadius: 50,  // if bounced path comes within this of player, block shot (wider = safer)
  reserveShells: 1,         // keep this many shells reserved for interceptor (don't use for offense)
  lethalPriority: true,     // prioritize lethal shots even at personal risk
  // Mobility budget — defer triggerbot fire when an incoming shell
  mobilityBudgetMs: 100,
  menuOpen: false
};

function applyProfile(name) {
  var p = PROFILES[name];
  if (!p) return;
  for (var k in PROFILE_DEFAULTS) cfg[k] = PROFILE_DEFAULTS[k];
  for (var k2 in p) { if (k2 !== 'desc') cfg[k2] = p[k2]; }
  cfg.activeProfile = name;
}
applyProfile('Rage');

// Expose cfg + applyProfile on window for external eval/test harness.
window._wklCfg = cfg;
window._wklApplyProfile = applyProfile;

// ═══════════════════════════════════════════════════════════════
//  BANNER
// ═══════════════════════════════════════════════════════════════
function showBanner(text, color, ms) {
  try {
    var old = document.getElementById('wkl-boot');
    if (old) old.remove();
    var b = document.createElement('div');
    b.id = 'wkl-boot';
    b.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);'
      + 'background:rgba(10,14,24,0.97);color:' + (color||'#7fd0ff') + ';'
      + 'font:bold 13px monospace;padding:7px 18px;border-radius:5px;'
      + 'border:1px solid ' + (color||'#7fd0ff') + '55;z-index:100001;pointer-events:none;'
      + 'box-shadow:0 4px 20px rgba(0,0,0,0.6)';
    b.textContent = text;
    document.body.appendChild(b);
    var dur = ms || 3500;
    setTimeout(function(){ b.style.transition='opacity 0.5s'; b.style.opacity='0'; }, dur - 500);
    setTimeout(function(){ if(b.parentNode) b.remove(); }, dur);
  } catch(e){ void e; }
}

// ═══════════════════════════════════════════════════════════════
//  SELF-DISCOVERING BOOT
// ═══════════════════════════════════════════════════════════════
var VIEW_CANDIDATES = ['buildView','getView','getState','buildState','frame','snapshot'];
var PID_CANDS       = ['playerId','clientId','id','localId','pid','uid','myId'];
var SEND_CANDS      = ['sendInput','send','sendCmd','sendCommand','input','sendAction'];

function discoverBuildView(net) {
  for (var i=0; i<VIEW_CANDIDATES.length; i++) {
    var n = VIEW_CANDIDATES[i];
    if (typeof net[n] !== 'function') continue;
    try { var r = net[n](0); if (r && Array.isArray(r.tanks)) return { fn: net[n].bind(net), name: n }; }
    catch(e){ void e; }
  }
  var keys = Object.keys(net);
  for (var j=0; j<keys.length; j++) {
    if (typeof net[keys[j]] !== 'function') continue;
    try { var r2 = net[keys[j]](0); if (r2 && Array.isArray(r2.tanks)) return { fn: net[keys[j]].bind(net), name: keys[j] }; }
    catch(e){ void e; }
  }
  return null;
}
function discoverField(net, cands) {
  for (var i=0; i<cands.length; i++) if (net[cands[i]] != null) return cands[i];
  return null;
}
function discoverFn(net, cands) {
  for (var i=0; i<cands.length; i++) if (typeof net[cands[i]]==='function') return cands[i];
  return null;
}
function discoverInterpDelay(net) {
  var cands = ['interpDelayMs','interpDelay','delay','latency','ping','rtt'];
  for (var i=0; i<cands.length; i++) if (typeof net[cands[i]]==='number') return net[cands[i]];
  return 65;
}

var waitTries = 0;
var waitTimer = setInterval(function() {
  if (++waitTries > 300) {
    clearInterval(waitTimer);
    showBanner('Wankle v25: game not found — try refreshing', '#ff5a3b', 6000);
    return;
  }
  var w = window.WANKLE;
  if (!w || !w.net || !w.R) return;
  var disc = discoverBuildView(w.net);
  if (!disc) return;
  clearInterval(waitTimer);
  try { boot(w, disc); }
  catch(e) { showBanner('Wankle v25 crashed: ' + e.message, '#ff5a3b', 8000); console.error(e); }
}, 100);

// ═══════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════
function boot(WANKLE, discovered) {
  var net = WANKLE.net;
  var R   = WANKLE.R;

  var _buildView   = discovered.fn;
  var _pidField    = discoverField(net, PID_CANDS);
  var _sendName    = discoverFn(net, SEND_CANDS);
  var _interpDelay = discoverInterpDelay(net);

  function getMyId() { return _pidField ? net[_pidField] : null; }

  console.log('%c[wkl v25] hooked — buildView='+discovered.name+' sendInput='+_sendName+' pid='+_pidField, 'color:#7fd0ff;font-weight:bold');

  // ── CACHED VIEW (computed once per RAF frame, read by sendInput) ──
  // This is the key optimization: sendInput runs at 120Hz but getView() is expensive.
  // We cache the view from the RAF loop (60fps) and sendInput reads the cache.
  var cachedView = null;
  var cachedMe   = null;
  var cachedTiles = [];
  var cachedEnemies = [];

  function refreshViewCache() {
    try {
      var newView = _buildView(0);
      if (!newView) {
        // View fetch failed — DON'T wipe cachedTiles/cachedEnemies.
        // Keep them so the persist branch and spatial grid stay valid.
        // Only clear cachedView/cachedMe so we know the fetch failed.
        cachedView = null;
        cachedMe = null;
        return;
      }
      cachedView = newView;
      cachedMe = null;
      for (var i=0; i<cachedView.tanks.length; i++) {
        if (cachedView.tanks[i].isLocal) { cachedMe = cachedView.tanks[i]; break; }
      }
      // Only update tiles if we actually got them (don't wipe with empty)
      var newTiles = cachedView.tiles || [];
      if (newTiles.length > 0) cachedTiles = newTiles;
      cachedEnemies = [];
      if (cachedMe) {
        for (var j=0; j<cachedView.tanks.length; j++) {
          if (isHostile(cachedView.tanks[j], cachedMe)) cachedEnemies.push(cachedView.tanks[j]);
        }
        var now = performance.now();
        // Clean up trackers for enemies no longer present
        var activeIds = cachedEnemies.map(function(e){return String(e.id);});
        cleanShellTracker(activeIds);
      }
      // track when the view was last refreshed, so computeDodge can
      lastViewRefreshT = performance.now();
      buildFrameStats();
    } catch(e) { void e; cachedView = null; cachedMe = null; F = null; }
  }
  var lastViewRefreshT = 0;

  // F = per-frame stats cache. Built once per refreshViewCache, read by all hot-path
  // functions. Eliminates ~20 redundant shell scans and ~10 enemy scans per frame.
  var F = null;
  function buildFrameStats() {
    if (!cachedView || !cachedMe) { F = null; return; }
    var myId = String(getMyId());
    var enemyById = {};
    for (var ei = 0; ei < cachedEnemies.length; ei++) enemyById[String(cachedEnemies[ei].id)] = cachedEnemies[ei];
    var rawShells = getRawShells();
    var rawById = {};
    for (var ri = 0; ri < rawShells.length; ri++) rawById[String(rawShells[ri].i)] = rawShells[ri];
    var shellMeta = {};
    var myShellCount = 0;
    var viewShells = cachedView.shells || [];
    for (var si = 0; si < viewShells.length; si++) {
      var s = viewShells[si];
      var sid = String(s.id);
      var raw = rawById[sid];
      var isOwn = String(s.o) === myId;
      if (isOwn) myShellCount++;
      shellMeta[sid] = {
        x: s.x, z: s.z, type: s.type, isOwn: isOwn,
        angle: raw ? raw.a : null,
        speed: getShellSpeed(s.id, s.type)
      };
    }
    F = {
      me: cachedMe, myId: myId,
      enemyById: enemyById, shellMeta: shellMeta,
      myShellCount: myShellCount,
      t: performance.now()
    };
  }

  // ── SPATIAL TILE GRID for fast ray-AABB ──
  // Instead of testing every tile (108+), only test tiles in cells the ray passes through.
  var TILE = 70;
  var gridCols = 26, gridRows = 20;
  var grid = [];  // grid[row][col] = [tile, tile, ...]

  function rebuildGrid(tiles) {
    // Determine grid size from world dims
    var wW = (cachedView && (cachedView.worldW || cachedView.mapW)) || 1820;
    var wH = (cachedView && (cachedView.worldH || cachedView.mapH)) || 1400;
    gridCols = Math.ceil(wW / TILE);
    gridRows = Math.ceil(wH / TILE);
    grid = [];
    for (var r=0; r<gridRows; r++) {
      grid[r] = [];
      for (var c=0; c<gridCols; c++) grid[r][c] = [];
    }
    for (var i=0; i<tiles.length; i++) {
      var t = tiles[i];
      var minCol = Math.max(0, Math.floor((t.x - t.hw) / TILE));
      var maxCol = Math.min(gridCols-1, Math.floor((t.x + t.hw) / TILE));
      var minRow = Math.max(0, Math.floor((t.z - t.hl) / TILE));
      var maxRow = Math.min(gridRows-1, Math.floor((t.z + t.hl) / TILE));
      for (var row=minRow; row<=maxRow; row++) {
        for (var col=minCol; col<=maxCol; col++) {
          grid[row][col].push(t);
        }
      }
    }
  }

  // Get tiles along a ray path (DDA grid traversal)
  function tilesAlongRay(x, z, dx, dz, maxDist) {
    var result = [];
    var col = Math.floor(x / TILE);
    var row = Math.floor(z / TILE);
    // Handle zero-direction components (axis-aligned shots)
    // If dx≈0, ray never crosses X cell boundaries → tDeltaX = Infinity, tMaxX = Infinity
    // If dz≈0, ray never crosses Z cell boundaries → tDeltaZ = Infinity, tMaxZ = Infinity
    var stepX, stepZ, tDeltaX, tDeltaZ, tMaxX, tMaxZ;
    if (Math.abs(dx) < 1e-9) {
      stepX = 0; tDeltaX = Infinity; tMaxX = Infinity;
    } else {
      stepX = dx > 0 ? 1 : -1;
      tDeltaX = Math.abs(TILE / dx);
      tMaxX = stepX > 0 ? ((col+1)*TILE - x) / dx : (x - col*TILE) / -dx;
    }
    if (Math.abs(dz) < 1e-9) {
      stepZ = 0; tDeltaZ = Infinity; tMaxZ = Infinity;
    } else {
      stepZ = dz > 0 ? 1 : -1;
      tDeltaZ = Math.abs(TILE / dz);
      tMaxZ = stepZ > 0 ? ((row+1)*TILE - z) / dz : (z - row*TILE) / -dz;
    }
    var dist = 0;
    var seen = {};
    var safety = 0;  // prevent infinite loop
    while (dist < maxDist && safety < 200) {
      safety++;
      if (row < 0 || row >= gridRows || col < 0 || col >= gridCols) break;
      var key = row * 1000 + col;
      if (!seen[key]) {
        seen[key] = 1;
        var cell = grid[row][col];
        if (cell) {
          for (var i=0; i<cell.length; i++) {
            if (result.indexOf(cell[i]) === -1) result.push(cell[i]);
          }
        }
      }
      if (tMaxX < tMaxZ) {
        dist = tMaxX;
        tMaxX += tDeltaX;
        col += stepX;
      } else {
        dist = tMaxZ;
        tMaxZ += tDeltaZ;
        row += stepZ;
      }
    }
    return result;
  }

  // ── Math ──
  function normAngle(a) { a = a % TAU; return a < 0 ? a + TAU : a; }
  function angleDiff(a, b) {
    var d = normAngle(b) - normAngle(a);
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }
  function lerpAngle(a, b, t) { return normAngle(a + angleDiff(a, b) * t); }

  // ── Ray vs AABB ──
  function rayAABB(rx, rz, ux, uz, box) {
    var minX = box.x - box.hw, maxX = box.x + box.hw;
    var minZ = box.z - box.hl, maxZ = box.z + box.hl;
    var tMinX, tMaxX, tMinZ, tMaxZ;
    if (Math.abs(ux) < 1e-9) {
      if (rx < minX || rx > maxX) return null;
      tMinX = -Infinity; tMaxX = Infinity;
    } else {
      tMinX = (minX-rx)/ux; tMaxX = (maxX-rx)/ux;
      if (tMinX > tMaxX) { var t=tMinX; tMinX=tMaxX; tMaxX=t; }
    }
    if (Math.abs(uz) < 1e-9) {
      if (rz < minZ || rz > maxZ) return null;
      tMinZ = -Infinity; tMaxZ = Infinity;
    } else {
      tMinZ = (minZ-rz)/uz; tMaxZ = (maxZ-rz)/uz;
      if (tMinZ > tMaxZ) { var t2=tMinZ; tMinZ=tMaxZ; tMaxZ=t2; }
    }
    var tE = Math.max(tMinX,tMinZ), tX = Math.min(tMaxX,tMaxZ);
    // CLOSE-RANGE FIX
    if (tE > tX) return null;  // no intersection at all
    if (tX < 0) return null;   // box is entirely behind the ray
    if (tE <= 0) {
      // Ray starts inside the box — return hit at t=0 (immediate bounce)
      // Determine which face we're hitting based on direction
      return { t: 0.001, normalX: tMinX > tMinZ ? (ux > 0 ? -1 : 1) : 0,
                      normalZ: tMinX > tMinZ ? 0 : (uz > 0 ? -1 : 1) };
    }
    return { t: tE, normalX: tMinX>tMinZ ? (ux>0?-1:1) : 0,
                    normalZ: tMinX>tMinZ ? 0 : (uz>0?-1:1) };
  }

  // ── Ricochet tracer (uses spatial grid, falls back to all tiles) ──
  // Added shellRadius parameter (default 0 = exact centerline).
  // Fixed multi-bounce corner detection — the EPS offset after each
  // bounce must account for shellRadius, otherwise the shell "re-hits" the
  // same wall on the next bounce iteration. Also ensures corner-cutting is
  // detected on ALL bounces, not just the first.
  function traceRicochet(sx, sz, dx, dz, maxB, maxDist, shellRadius) {
    if (shellRadius === undefined) shellRadius = 0;
    var path = [{x:sx, z:sz}];
    var x=sx, z=sz, ux=dx, uz=dz, dist=0;
    // EPS must be > shellRadius to avoid re-hitting the same wall
    var EPS = Math.max(0.5, shellRadius + 1.0);
    for (var b=0; b<=maxB; b++) {
      // Use spatial grid to get only relevant tiles
      var nearby = tilesAlongRay(x, z, ux, uz, maxDist - dist);
      // FALLBACK: if grid is empty/not built, test ALL tiles (slower but correct)
      if (nearby.length === 0 && cachedTiles.length > 0) {
        nearby = cachedTiles;
      }
      var near = null;
      for (var i=0; i<nearby.length; i++) {
        var tile = nearby[i];
        // v21.2/v21.6: expand tile box by shellRadius on EVERY bounce,
        var box;
        if (shellRadius > 0) {
          box = {x: tile.x, z: tile.z, hw: tile.hw + shellRadius, hl: tile.hl + shellRadius};
        } else {
          box = tile;
        }
        var h = rayAABB(x, z, ux, uz, box);
        // Skip hits that are too close (within EPS) — these are the
        if (h && h.t > EPS * 0.5 && (!near || h.t < near.t)) near = h;
      }
      if (!near) {
        path.push({x: x+ux*(maxDist-dist), z: z+uz*(maxDist-dist)});
        return { path:path, totalDist:maxDist, bounces:b };
      }
      if (dist + near.t > maxDist) {
        path.push({x: x+ux*(maxDist-dist), z: z+uz*(maxDist-dist)});
        return { path:path, totalDist:maxDist, bounces:b };
      }
      dist += near.t;
      x += ux*near.t; z += uz*near.t;
      path.push({x:x, z:z});
      if (b === maxB) break;
      if (near.normalX) ux=-ux;
      if (near.normalZ) uz=-uz;
      // Move further off the wall to prevent re-hitting on next iteration.
      x+=ux*EPS; z+=uz*EPS; dist+=EPS;
    }
    return { path:path, totalDist:dist, bounces:maxB };
  }

  // RECTANGULAR HITBOX CHECK — matches server's circleHitsBox exactly.
  function pathHitsRect(path, px, pz) {
    var hw = HIT_HW, hl = HIT_HL;
    for (var i=0; i<path.length-1; i++) {
      var a=path[i], b=path[i+1];
      // Check if line segment (a→b) intersects the box [px-hw, px+hw] × [pz-hl, pz+hl]
      // Use Cohen-Sutherland-style clipping (Liang-Barsky algorithm)
      var dx = b.x - a.x, dz = b.z - a.z;
      var t0 = 0, t1 = 1;
      var p, q, r;
      // Check x slab
      if (Math.abs(dx) < 1e-9) {
        if (a.x < px - hw || a.x > px + hw) continue;  // parallel and outside
      } else {
        p = -dx; q = a.x - (px - hw); r = q / p; if (p < 0) { if (r > t1) continue; if (r > t0) t0 = r; } else { if (r < t0) continue; if (r < t1) t1 = r; }
        p = dx;  q = (px + hw) - a.x; r = q / p; if (p < 0) { if (r > t1) continue; if (r > t0) t0 = r; } else { if (r < t0) continue; if (r < t1) t1 = r; }
      }
      // Check z slab
      if (Math.abs(dz) < 1e-9) {
        if (a.z < pz - hl || a.z > pz + hl) continue;
      } else {
        p = -dz; q = a.z - (pz - hl); r = q / p; if (p < 0) { if (r > t1) continue; if (r > t0) t0 = r; } else { if (r < t0) continue; if (r < t1) t1 = r; }
        p = dz;  q = (pz + hl) - a.z; r = q / p; if (p < 0) { if (r > t1) continue; if (r > t0) t0 = r; } else { if (r < t0) continue; if (r < t1) t1 = r; }
      }
      // If t0 <= t1, the segment intersects the box
      if (t0 <= t1) return true;
    }
    return false;
  }
  
  // Rectangular hitbox check — matches server's circleHitsBox logic.
  // The server checks: does the shell's circle (radius=SHELL_SIZE/2=4.5)
  // intersect the tank's box (hw=23, hl=18)?
  // We check if the shell path comes within (SHELL_SIZE/2 + effectiveRadius)
  // of the tank center, where effectiveRadius accounts for the box shape.
  // For simplicity and reliability, we use the SMALLER dimension (hl=18)
  // as the hit radius. This means we might miss some edge shots along the
  // long axis, but we won't WASTE shots on near-misses.

  
  // Conservative hit radius: smaller dimension + shell radius
  // This ensures we only fire when the shot WILL hit the rectangular hitbox
  var HIT_R_BANK = TANK_R + 12;  // 35u — generous for bank shots (measured)

  // ── Aimbot state ──
  var aim_angle = null;
  var aim_bounces = 0;
  var aim_dist = 0;
  var aim_targetX = 0, aim_targetZ = 0;
  var aim_targetId = null;
  var aim_lastSearchT = 0;

  // aim-correction subsystem removed (output was never used after v24 dropped the offset)


  // Shell conservation: track shells fired per target
  // Keyed by target ID → { count: N, lastFireT: timestamp }
  var shellsPerTarget = {};
  function trackShellFired(targetId, now) {
    if (!shellsPerTarget[targetId]) shellsPerTarget[targetId] = { count: 0, lastFireT: 0 };
    shellsPerTarget[targetId].count++;
    shellsPerTarget[targetId].lastFireT = now;
  }
  function shellsFiredAt(targetId) {
    var d = shellsPerTarget[targetId];
    return d ? d.count : 0;
  }
  // Clean up old entries (target died or left)
  function cleanShellTracker(activeEnemyIds) {
    for (var id in shellsPerTarget) {
      if (activeEnemyIds.indexOf(id) < 0) delete shellsPerTarget[id];
    }
  }
  // Is this target currently in conservation-wait?
  // (we've fired enough shells and are waiting to see if they hit)
  function isInConservationWait(targetId, now) {
    var data = shellsPerTarget[targetId];
    if (!data || data.count === 0) return false;
    // Find the target to get its HP
    var tgt = null;
    for (var i = 0; i < cachedEnemies.length; i++) {
      if (String(cachedEnemies[i].id) === String(targetId)) { tgt = cachedEnemies[i]; break; }
    }
    if (!tgt) return false;
    var hitProb = aim_hitProb || 0.5;
    var maxShells = maxShellsForTarget(tgt, hitProb);
    if (data.count < maxShells) return false;
    // We've fired enough — check if we're still in the wait period
    // reduced from 600 to 150 per shell — was 1.8s after 3 shells, way too conservative
    var waitTime = data.count * 50;
    return (now - data.lastFireT) < waitTime;
  }

  // How many shells should we fire at this target?
  function maxShellsForTarget(tgt, hitProb) {
    if (!tgt) return 1;
    var hp = (typeof tgt.health === 'number') ? tgt.health : 1;
    var vel = getVel(tgt.id);
    var speed = Math.hypot(vel.vx, vel.vz);
    
    // Base: 1 shell per HP point
    var maxShells = hp;
    
    // Stationary target with high hit prob: exactly HP shells (no waste)
    if (speed < 20 && hitProb > 0.7) {
      maxShells = hp;  // 1 shot per HP, no extras
    }
    // Moving target with medium hit prob: allow 1 extra for prediction error
    else if (speed > 50 && hitProb < 0.6) {
      maxShells = hp + 1;
    }
    // Fast target with low hit prob: allow up to 2 extra
    else if (speed > 80 && hitProb < 0.4) {
      maxShells = hp + 2;
    }
    
    // Never exceed shell cap
    return Math.min(maxShells, SHELL_CAP);
  }


  var lastFireT = 0;  // for fire cooldown
  var lastAim = null;  // for smoothing
  var aim_hitProb = 0;  // predicted hit probability 0-1

  // ── Get raw snapshot shells (have angle 'a' field that buildView drops) ──
  // buildView() shells have {id, o, x, z, type} but NO angle.
  // Raw snapshot shells have {i, o, x, z, a, t} — we need 'a' for dodge/intercept.
  function getRawShells() {
    if (!net.snapshots || net.snapshots.length === 0) return [];
    var snap = net.snapshots[net.snapshots.length - 1];
    return snap.data.shells || [];
  }
  function getRawShellAngle(shellId) {
    var raw = getRawShells();
    for (var i = 0; i < raw.length; i++) {
      if (String(raw[i].i) === String(shellId)) return raw[i].a;
    }
    return null;
  }

  // ── Dynamic shell speed tracker ──
  // Measures ACTUAL shell speed by tracking position changes between frames.
  // This handles teal tanks with faster shells, future shell types, etc.
  // Falls back to SHELL_SPEED[type] lookup if no tracking data yet.
  var shellSpeedTrack = {};  // id -> {x, z, t, speed, type}
  function updateShellSpeedTrack(shells, now) {
    for (var i = 0; i < shells.length; i++) {
      var s = shells[i];
      var prev = shellSpeedTrack[s.id];
      if (prev) {
        var dt = (now - prev.t) / 1000;
        if (dt > 0.001 && dt < 0.5) {
          var dx = s.x - prev.x, dz = s.z - prev.z;
          var measuredSpeed = Math.hypot(dx, dz) / dt;
          // Sanity check: shell speed should be 200-1500 range
          if (measuredSpeed > 100 && measuredSpeed < 2000) {
            // EMA smoothing — fast convergence for new data
            if (prev.speed == null) prev.speed = measuredSpeed;
            else prev.speed = prev.speed * 0.5 + measuredSpeed * 0.5;
          }
          prev.x = s.x; prev.z = s.z; prev.t = now;
        }
      } else {
        shellSpeedTrack[s.id] = { x: s.x, z: s.z, t: now, speed: null, type: s.type || s.t };
      }
    }
    // GC old shells
    for (var k in shellSpeedTrack) {
      if (now - shellSpeedTrack[k].t > 2000) delete shellSpeedTrack[k];
    }
  }
  function getShellSpeed(shellId, type) {
    // Prefer measured speed (handles teal fast shells, unknown types)
    var tracked = shellSpeedTrack[shellId];
    if (tracked && tracked.speed != null) return tracked.speed;
    // Fallback to type-based lookup
    return SHELL_SPEED[type] || 320;
  }

  // ── Shell velocity tracker (fallback — compute angle from position changes) ──
  // buildView() shells have {id, o, x, z, type} but NO angle field.
  // We track position over time to compute velocity direction.
  function getShellAngle(id) {
    if (F && F.shellMeta) { var m = F.shellMeta[String(id)]; if (m) return m.angle; }
    return getRawShellAngle(id);
  }

  // ── Velocity tracker (per-tank EMA velocity) ──
  // For lead-aim prediction. Keyed by tank id.
  var velTrack = {};  // id -> {x, z, t, vx, vz, ax, az, samples, history, lastHistT, pattern}

  function updateVelTrack(tanks, now) {
    for (var i = 0; i < tanks.length; i++) {
      var t = tanks[i];
      var prev = velTrack[t.id];
      if (prev) {
        var dt = (now - prev.t) / 1000;
        if (dt > 0.001 && dt < 0.5) {
          var rawVx = (t.x - prev.x) / dt;
          var rawVz = (t.z - prev.z) / dt;

          // (1) ADAPTIVE EMA ALPHA
          // If velocity magnitude changed >30% between samples, fast-adapt (alpha=0.8).
          // Otherwise stable tracking (alpha=0.4). First 3 samples: full weight.
          prev.samples = (prev.samples || 0) + 1;
          var prevSpeed = Math.hypot(prev.vx || 0, prev.vz || 0);
          var rawSpeed  = Math.hypot(rawVx, rawVz);
          var speedDelta = prevSpeed > 1 ? Math.abs(rawSpeed - prevSpeed) / prevSpeed : 0;
          var a;
          if (prev.samples < 3) a = 1.0;
          else if (speedDelta > 0.3) a = 0.8;        // sudden change — fast adapt
          else a = 0.4;                              // stable — smooth

          var oldVx = prev.vx || 0, oldVz = prev.vz || 0;
          prev.vx = prev.vx == null ? rawVx : prev.vx * (1 - a) + rawVx * a;
          prev.vz = prev.vz == null ? rawVz : prev.vz * (1 - a) + rawVz * a;

          // (2) TWO-SAMPLE ACCELERATION
          // acc = (vel_now - vel_2_samples_ago) / (2 * dt)
          // Stored smoothed to avoid noise. Detects deceleration before reversal.
          if (prev.prevVx != null) {
            var rawAx = (prev.vx - prev.prevVx) / (2 * dt);
            var rawAz = (prev.vz - prev.prevVz) / (2 * dt);
            // Smooth accel with low alpha (it's noisy)
            prev.ax = prev.ax == null ? rawAx * 0.5 : prev.ax * 0.7 + rawAx * 0.3;
            prev.az = prev.az == null ? rawAz * 0.5 : prev.az * 0.7 + rawAz * 0.3;
          }
          prev.prevVx = oldVx; prev.prevVz = oldVz;

          prev.x = t.x; prev.z = t.z; prev.t = now;

          // Velocity history for oscillation/flip detection (sampled every 80ms)
          if (!prev.history) prev.history = [];
          if (prev.history.length === 0 || (now - (prev.lastHistT || 0)) > 80) {
            prev.history.push({ vx: prev.vx, vz: prev.vz, t: now });
            while (prev.history.length > 8) prev.history.shift();
            prev.lastHistT = now;

            // (6) PER-TARGET PATTERN MEMORY — track reversal period
            // Detect sign flip in dominant axis, record time between flips.
            if (!prev.pattern) prev.pattern = { reversals: [], periodMean: 0, periodVar: 0, prefDir: {x:0,z:0} };
            var h = prev.history;
            if (h.length >= 2) {
              var hPrev = h[h.length - 2], hCur = h[h.length - 1];
              var flipped = false;
              // Flip on dominant axis only (avoid double-counting on diagonals)
              if (Math.abs(hPrev.vx) > Math.abs(hPrev.vz)) {
                if (hPrev.vx * hCur.vx < 0 && Math.abs(hCur.vx) > 5) flipped = true;
              } else {
                if (hPrev.vz * hCur.vz < 0 && Math.abs(hCur.vz) > 5) flipped = true;
              }
              if (flipped) {
                prev.pattern.reversals.push(now);
                while (prev.pattern.reversals.length > 8) prev.pattern.reversals.shift();
                // Compute period statistics if we have 3+ reversals
                if (prev.pattern.reversals.length >= 3) {
                  var periods = [];
                  for (var ri = 1; ri < prev.pattern.reversals.length; ri++) {
                    periods.push(prev.pattern.reversals[ri] - prev.pattern.reversals[ri-1]);
                  }
                  var sum = 0; for (var pi = 0; pi < periods.length; pi++) sum += periods[pi];
                  prev.pattern.periodMean = sum / periods.length;
                  var varSum = 0;
                  for (var pi2 = 0; pi2 < periods.length; pi2++) {
                    var d = periods[pi2] - prev.pattern.periodMean;
                    varSum += d * d;
                  }
                  prev.pattern.periodVar = varSum / periods.length;
                }
              }
              // Track preferred direction (EMA of normalized velocity)
              var speed = Math.hypot(hCur.vx, hCur.vz);
              if (speed > 10) {
                var nx = hCur.vx / speed, nz = hCur.vz / speed;
                if (!prev.pattern.prefDir) prev.pattern.prefDir = {x:0,z:0};
                prev.pattern.prefDir.x = prev.pattern.prefDir.x * 0.85 + nx * 0.15;
                prev.pattern.prefDir.z = prev.pattern.prefDir.z * 0.85 + nz * 0.15;
              }
            }
          }
        }
      } else {
        velTrack[t.id] = {
          x: t.x, z: t.z, t: now,
          vx: null, vz: null, prevVx: null, prevVz: null,
          ax: null, az: null,
          samples: 0, history: [], lastHistT: 0,
          pattern: null
        };
      }
    }
    // GC old entries
    for (var k in velTrack) {
      if (now - velTrack[k].t > 3000) delete velTrack[k];
    }
  }

  function getVel(id) {
    var v = velTrack[id];
    return v && v.vx != null ? { vx: v.vx, vz: v.vz } : { vx: 0, vz: 0 };
  }

  // ── Lead-aim solver (Tier 1+2 rewrite) ──
  // Predicts where target will be when shell arrives.
  // Returns {x, z, t, launchX, launchZ, uncertainty} where uncertainty is 0..1
  // (higher = more chaotic target, caller may want to gate fire on this).
  function leadAim(me, tgt, shellSpeed) {
    var track = velTrack[tgt.id];
    var vel = track && track.vx != null ? { vx: track.vx, vz: track.vz } : { vx: 0, vz: 0 };
    var acc = track && track.ax != null ? { ax: track.ax, az: track.az } : { ax: 0, az: 0 };
    var myVel = getEffectiveMyVel(me, performance.now());
    var nowMs = performance.now();

    // ── OWN MOVEMENT PREDICTION (unchanged from v25-opt) ──
    var stunRemainingMs = Math.max(0, FIRE_STUN_MS - (nowMs - lastFireStunT));
    var stunRemainingS = stunRemainingMs / 1000;
    var launchLookahead = stunRemainingS > 0 ? stunRemainingS + 0.008 : 0.008;
    var launchX, launchZ;
    if (stunRemainingS > 0) {
      launchX = me.x; launchZ = me.z;
    } else {
      launchX = me.x + myVel.vx * launchLookahead;
      launchZ = me.z + myVel.vz * launchLookahead;
    }

    // ── (4) INHERITED-VELOCITY LAUNCH COMPENSATION ──
    // The shell inherits the player's velocity component along the aim direction.
    // Effective shell speed = shellSpeed + dot(myVel, aimDir). We don't know aimDir
    // yet (it's what we're solving for), so iterate: start with shellSpeed, then
    // refine with the computed aim direction.
    var interpDelay = (_interpDelay || 65) / 1000;
    var dx0 = tgt.x - launchX, dz0 = tgt.z - launchZ;
    var directDist = Math.hypot(dx0, dz0);
    var effectiveShellSpeed = shellSpeed;
    var t = directDist / effectiveShellSpeed + interpDelay;

    // Iterative refinement — now uses pos + vel*t + 0.5*acc*t^2 (acceleration term)
    var predX = tgt.x, predZ = tgt.z;
    var iterations = directDist > 800 ? 5 : (directDist > 400 ? 4 : 3);
    for (var iter = 0; iter < iterations; iter++) {
      // (2) ACCELERATION-AWARE PREDICTION
      predX = tgt.x + vel.vx * t + 0.5 * acc.ax * t * t;
      predZ = tgt.z + vel.vz * t + 0.5 * acc.az * t * t;

      // (4) Refine effective shell speed with current aim direction
      var aimDx = predX - launchX, aimDz = predZ - launchZ;
      var aimLen = Math.hypot(aimDx, aimDz);
      if (aimLen > 1) {
        var dotMy = (myVel.vx * aimDx + myVel.vz * aimDz) / aimLen;
        effectiveShellSpeed = Math.max(50, shellSpeed + dotMy * 0.5);  // 0.5 = partial inheritance (empirical)
      }
      var dist = Math.hypot(aimDx, aimDz);
      t = dist / effectiveShellSpeed;
    }

    // ── (3) TREND-WEIGHTED MULTI-HYPOTHESIS ──
    // Replaces static 35/45/20 blend. Reverse-bias scales with flip recency.
    var uncertainty = 0;
    if (track && track.history && track.history.length >= 4) {
      var h = track.history;
      var flips = 0;
      var lastFlipAge = Infinity;
      for (var hi = 1; hi < h.length; hi++) {
        var prevVx = h[hi-1].vx || 0, prevVz = h[hi-1].vz || 0;
        var curVx = h[hi].vx || 0, curVz = h[hi].vz || 0;
        if (prevVx * curVx < 0 || prevVz * curVz < 0) {
          flips++;
          lastFlipAge = nowMs - h[hi].t;
        }
      }
      if (flips >= 2) {
        // Heavy oscillation — reverse-bias weight scales with recency of last flip
        // lastFlipAge=80ms → 50% reverse, 240ms+ → 15% reverse
        var recencyWeight = Math.max(0.15, Math.min(0.50, 0.50 - (lastFlipAge - 80) / 500));
        var wForward = 1 - recencyWeight - 0.20;  // 20% always on current position
        if (wForward < 0.10) wForward = 0.10;
        var wReverse = recencyWeight;
        var wCurrent = 1 - wForward - wReverse;

        var predX_a = tgt.x + vel.vx * t + 0.5 * acc.ax * t * t;          // forward
        var predZ_a = tgt.z + vel.vz * t + 0.5 * acc.az * t * t;
        var predX_b = tgt.x - vel.vx * t + 0.5 * (-acc.ax) * t * t;       // reverse
        var predZ_b = tgt.z - vel.vz * t + 0.5 * (-acc.az) * t * t;
        var predX_c = tgt.x;                                                // current
        var predZ_c = tgt.z;

        predX = predX_a * wForward + predX_b * wReverse + predX_c * wCurrent;
        predZ = predZ_a * wForward + predZ_b * wReverse + predZ_c * wCurrent;

        uncertainty = Math.min(1, flips / 5 + (lastFlipAge < 160 ? 0.2 : 0));
      } else if (flips === 1) {
        // Light oscillation — blend toward current position
        var blendCurr = Math.max(0.20, Math.min(0.40, 0.40 - lastFlipAge / 1000));
        predX = predX * (1 - blendCurr) + tgt.x * blendCurr;
        predZ = predZ * (1 - blendCurr) + tgt.z * blendCurr;
        uncertainty = 0.15;
      }
      // flips === 0: keep pure iterative (tight aim for non-oscillating targets)
    }

    // ── (6) PER-TARGET PATTERN MEMORY ──
    // If we have a stable reversal period (low variance, 5+ reversals observed),
    // predict whether the target is likely to reverse BEFORE the shell arrives.
    // If time-to-impact falls in the "likely reversal window", bias toward reverse.
    if (track && track.pattern && track.pattern.reversals.length >= 5 &&
        track.pattern.periodVar < (track.pattern.periodMean * 0.15)) {  // CV < 15%
      var timeSinceLastReversal = nowMs - track.pattern.reversals[track.pattern.reversals.length - 1];
      var timeToNextReversal = track.pattern.periodMean - timeSinceLastReversal;
      // If reversal is predicted within shell flight time (and not too far past last one)
      if (timeToNextReversal > 0 && timeToNextReversal < t * 1000 && timeSinceLastReversal > 100) {
        // Target likely reverses mid-flight — blend 40% toward reverse position
        var revT = t;  // assume reversal happens, then they travel reverse for remaining time
        var predRevX = tgt.x - vel.vx * revT + 0.5 * (-acc.ax) * revT * revT;
        var predRevZ = tgt.z - vel.vz * revT + 0.5 * (-acc.az) * revT * revT;
        predX = predX * 0.60 + predRevX * 0.40;
        predZ = predZ * 0.60 + predRevZ * 0.40;
        uncertainty = Math.max(uncertainty, 0.25);
      }
    }

    // ── (5) VELOCITY-VARIANCE UNCERTAINTY ──
    // Compute velocity magnitude variance over history — high variance = chaotic target
    if (track && track.history && track.history.length >= 3) {
      var h2 = track.history;
      var speeds = [];
      for (var si = 0; si < h2.length; si++) speeds.push(Math.hypot(h2[si].vx || 0, h2[si].vz || 0));
      var meanS = 0; for (var si2 = 0; si2 < speeds.length; si2++) meanS += speeds[si2];
      meanS /= speeds.length;
      var varS = 0; for (var si3 = 0; si3 < speeds.length; si3++) { var d = speeds[si3] - meanS; varS += d * d; }
      varS /= speeds.length;
      if (meanS > 5) {
        var cv = Math.sqrt(varS) / meanS;  // coefficient of variation
        uncertainty = Math.max(uncertainty, Math.min(0.4, cv * 0.5));
      }
    }

    // Clamp
    if (t > 5) t = 5;
    if (t < 0) t = 0;

    return { x: predX, z: predZ, t: t, launchX: launchX, launchZ: launchZ, uncertainty: uncertainty };
  }

  // ── Priority targeting ──
  // Scores each enemy and returns the best target. Higher score = better target.
  // Factors:
  //   - Distance (closer = easier hit, higher score)
  //   - Health (lower HP = kill shot, higher score)
  //   - Is aiming at me (threat — neutralize first, higher score)
  //   - Has line of sight (direct shot possible, higher score)
  //   - Velocity (slow/stationary = easier hit, higher score)
  //   - Is invisible (high-priority threat if we can see them via ESP, higher score)
  //   - Is spawn-protected (skip — can't damage, lower score)
  // REMOVED target stickiness — pure scoring, instant switching. Enables multi-angle
  // burst fire (bot switches targets instantly, 12 shells/sec at different angles).
  var lastTargetId = null;
  var lastTargetSwitchT = 0;
  var currentTargetRef = null;  // set by pickTarget, read by sendInput/drawHUD
  
  function pickTarget(me, enemies) {
    var best = null, bestScore = -Infinity;
    var fallback = null;  // used if all targets are in conservation-wait
    var _now = performance.now();
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      var d = Math.hypot(e.x - me.x, e.z - me.z);
      if (d < 1) d = 1;
      
      // Skip targets in conservation-wait (we've fired enough, waiting to confirm)
      // But keep them as fallback in case all targets are waiting
      if (isInConservationWait(String(e.id), _now)) {
        if (!fallback) fallback = e;
        continue;  // skip to next enemy — prefer targets we can still shoot
      }

      // Base score: closer is better. Use 1/d scaled.
      var score = 1000 / d;

      // No stickiness — pure scoring, instant switching
      // Health: lower HP = bigger bonus (kill shot)
      if (typeof e.health === 'number' && typeof e.maxHealth === 'number' && e.maxHealth > 0) {
        var hpRatio = e.health / e.maxHealth;
        // 2x bonus for 1-shot kill, 1x for full HP
        score *= (1 + (1 - hpRatio) * 1.5);
      }

      // Is enemy aiming at me? (turret pointing toward me)
      if (typeof e.turretAngle === 'number') {
        var angleToMe = Math.atan2(me.z - e.z, me.x - e.x);
        var turretErr = Math.abs(((e.turretAngle - angleToMe + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (turretErr < 0.3) {
          // Enemy is aiming at me — big threat bonus, especially at close range
          score *= 2.0;
        }
      }

      // Velocity: slow targets are easier to hit
      var vel = getVel(e.id);
      var speed = Math.hypot(vel.vx, vel.vz);
      if (speed > 80) {
        // Fast-moving target — harder to hit, slight penalty
        score *= 0.7;
      } else if (speed < 20) {
        // Nearly stationary — easy hit, bonus
        score *= 1.3;
      }

      // Invisible enemy (we can see via ESP) — high priority threat
      if (e.invisible) score *= 1.5;

      // Spawn-protected — heavy penalty (can't damage)
      if (e.spawnProtect) score *= 0.1;

      // Line of sight bonus — direct shots are more reliable than bank shots
      var directAngle = Math.atan2(e.z - me.z, e.x - me.x);
      var directTrace = traceRicochet(me.x, me.z, Math.cos(directAngle), Math.sin(directAngle), 0, d + 50, SHELL_R);
      if (pathHitsRect(directTrace.path, e.x, e.z)) {
        score *= 1.4;  // direct shot available
      }

      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    // Track target switches
    if (best && (lastTargetId === null || String(best.id) !== String(lastTargetId))) {
      lastTargetId = best.id;
      lastTargetSwitchT = _now;
    }
    // If no shootable targets found, return the fallback (a waiting target)
    // so the aimbot still tracks something. The triggerbot won't fire due to conservation block.
    return (currentTargetRef = best || fallback);
  }

  // ── Aimbot search (with lead-aim + priority targeting) ──
  function runAimbotSearch() {
    if (!cfg.aimbot || cachedEnemies.length === 0 || !cachedMe) { aim_angle = null; return; }

    // Pick best target via priority scoring
    var tgt = pickTarget(cachedMe, cachedEnemies);
    if (!tgt) { aim_angle = null; return; }

    // If target switched, reset smoothing
    if (aim_targetId !== tgt.id) {
      aim_targetId = tgt.id;
      lastAim = null;
    }

    // Predict where target will be when shell arrives (lead-aim)
    // leadAim now accounts for player's own velocity (relative velocity)
    var shellSpeed = SHELL_SPEED.normal;
    var predicted = leadAim(cachedMe, tgt, shellSpeed);

    // Use predicted position for the search
    var aimX = predicted.x, aimZ = predicted.z;
    // Use the launch position computed by leadAim (consistent with prediction)
    var launchX = predicted.launchX || cachedMe.x;
    var launchZ = predicted.launchZ || cachedMe.z;

    // Invalidate cache if target moved significantly (predicted pos)
    if (aim_angle !== null) {
      var drift = Math.hypot(aimX - aim_targetX, aimZ - aim_targetZ);
      if (drift > 25) aim_angle = null;
    }

    // Try direct shot first (0 bounces — fast check)
    // Use predicted launch position for the trace origin
    // pass SHELL_R so the trace matches server's circle-vs-box collision —
    // prevents the aimbot from firing direct shots that graze a wall corner
    // within 4.5u (which the server counts as a wall hit, not a clean shot).
    var directAngle = Math.atan2(aimZ - launchZ, aimX - launchX);
    var directTrace = traceRicochet(launchX, launchZ, Math.cos(directAngle), Math.sin(directAngle), 0, cfg.maxShotDist, SHELL_R);
    if (pathHitsRect(directTrace.path, aimX, aimZ)) {
      aim_angle = directAngle;
      aim_bounces = 0;
      aim_dist = directTrace.totalDist;
      aim_targetX = aimX; aim_targetZ = aimZ;
      var vel = getVel(tgt.id);
      var speed = Math.hypot(vel.vx, vel.vz);
      var predUncertainty = speed * predicted.t * 0.02;
      aim_hitProb = Math.max(0.6, 1.0 - predUncertainty / TANK_R);
      return;
    }

    // If no direct shot and maxBounces > 0, search bank shots
    if (cfg.maxBounces === 0) { aim_angle = null; aim_hitProb = 0; return; }

    // Search bank shots. Use a WIDER hit radius for bank shots to account for
    // prediction uncertainty.
    var bankHitR = HIT_R_BANK;

    // searchBankShots now passes SHELL_R to traceRicochet so bank-shot
    var best = searchBankShots(launchX, launchZ, aimX, aimZ, bankHitR);

    // If no bank shot hits predicted position, try CURRENT position (no lead)
    if (!best) {
      best = searchBankShots(launchX, launchZ, tgt.x, tgt.z, HIT_R_BANK);
      if (best) {
        var vel3 = getVel(tgt.id);
        var speed3 = Math.hypot(vel3.vx, vel3.vz);
        if (speed3 > 30) {
          best.hitProb = Math.max(0.1, 0.3 - speed3 / 300);
        }
      }
    }

    if (!best) { aim_angle = null; aim_hitProb = 0; return; }

    aim_angle = best.angle;
    aim_bounces = best.bounces;
    aim_dist = best.totalDist;
    aim_targetX = aimX; aim_targetZ = aimZ;
    if (best.hitProb != null) {
      aim_hitProb = best.hitProb;
    } else {
      var vel2 = getVel(tgt.id);
      var speed2 = Math.hypot(vel2.vx, vel2.vz);
      // Bank shot: moderate probability — bounces add uncertainty
      var bankUncertainty = speed2 * predicted.t * 0.03 + best.bounces * 5;
      aim_hitProb = Math.max(0.3, 0.75 - bankUncertainty / TANK_R);
    }
  }

  // Bank shot search helper — scans all 360° from launch position
  // passes SHELL_R to traceRicochet so the predicted bank-shot paths
  // account for the shell's 4.5u radius. This prevents corner-cutting where
  // a predicted bounce path grazes a wall corner within 4.5u.
  function searchBankShots(launchX, launchZ, tx, tz, hitR) {
    var stepRad = cfg.searchStepDeg * Math.PI / 180;
    var best = null;

    for (var rad = 0; rad < TAU; rad += stepRad) {
      var r = traceRicochet(launchX, launchZ, Math.cos(rad), Math.sin(rad), cfg.maxBounces, cfg.maxShotDist, SHELL_R);
      // use pathHitsRect for bank shots too — circular (35u) was 56% larger than actual hitbox (22.5u), wasting shells
      if (pathHitsRect(r.path, tx, tz)) {
        if (!best || r.totalDist < best.totalDist)
          best = { angle: rad, totalDist: r.totalDist, bounces: r.bounces, path: r.path };
      }
    }
    if (!best) return null;

    // Fine refinement
    var fineStep = 0.3 * Math.PI / 180;
    for (var rad2 = best.angle - stepRad; rad2 <= best.angle + stepRad; rad2 += fineStep) {
      var r2 = traceRicochet(launchX, launchZ, Math.cos(rad2), Math.sin(rad2), cfg.maxBounces, cfg.maxShotDist, SHELL_R);
      // use pathHitsRect for bank shots too
      if (pathHitsRect(r2.path, tx, tz) && r2.totalDist < best.totalDist)
        best = { angle: rad2, totalDist: r2.totalDist, bounces: r2.bounces, path: r2.path };
    }
    return best;
  }

  // ── Targeting ──
  function isHostile(t, me) {
    if (t.isLocal) return false;
    if (t.dead && cfg.ignoreDead) return false;
    if (t.spawnProtect && cfg.ignoreSpawnProt) return false;
    if (cfg.ignoreBots && t.k && t.k !== 'player') return false;
    if (typeof t.team==='number' && typeof me.team==='number' && me.team>=0 && t.team===me.team && t.team!==99) return false;
    return true;
  }

  // ── Count my shells in flight (for shell-cap + bounce awareness) ──
  function myShellsInFlight() {
    if (!cachedView || !cachedView.shells) return 0;
    var myId = getMyId();
    var count = 0;
    for (var i=0; i<cachedView.shells.length; i++) {
      if (String(cachedView.shells[i].o) === String(myId)) count++;
    }
    return count;
  }

  // MULTI-TARGET SHELL TRACKING
  function shellWillHitEnemy(enemyX, enemyZ, enemyVx, enemyVz) {
    if (!cachedView || !cachedView.shells) return {willHit: false, probability: 0};
    var myId = getMyId();
    for (var i = 0; i < cachedView.shells.length; i++) {
      var s = cachedView.shells[i];
      if (String(s.o) !== String(myId)) continue;
      var shAngle = getShellAngle(s.id);
      if (shAngle === null) continue;
      var spd = getShellSpeed(s.id, s.type);
      
      // Trace the shell's FULL ricochet path (1 bounce, 1000u max)
      var traced = traceRicochet(s.x, s.z, Math.cos(shAngle) * spd, Math.sin(shAngle) * spd, 1, 1000, 0);
      
      // Check each segment of the path against the target
      var bestPerpDist = Infinity;
      for (var j = 0; j < traced.path.length - 1; j++) {
        var a = traced.path[j], b = traced.path[j+1];
        var sdx = b.x - a.x, sdz = b.z - a.z, slen2 = sdx*sdx + sdz*sdz;
        if (slen2 < 1e-9) continue;
        var t = ((enemyX - a.x) * sdx + (enemyZ - a.z) * sdz) / slen2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        var cx = a.x + sdx * t, cz = a.z + sdz * t;
        var d = Math.hypot(cx - enemyX, cz - enemyZ);
        if (d < bestPerpDist) bestPerpDist = d;
      }
      
      if (bestPerpDist < 1) return {willHit: true, probability: 1.0};
      
      // Predict where enemy will be when shell arrives
      var sdist = Math.hypot(enemyX - s.x, enemyZ - s.z);
      var timeToReach = sdist / spd;
      var predEnemyX = enemyX + enemyVx * timeToReach;
      var predEnemyZ = enemyZ + enemyVz * timeToReach;
      
      // Check predicted position against path too
      var bestPredDist = Infinity;
      for (var j2 = 0; j2 < traced.path.length - 1; j2++) {
        var a2 = traced.path[j2], b2 = traced.path[j2+1];
        var sdx2 = b2.x - a2.x, sdz2 = b2.z - a2.z, slen22 = sdx2*sdx2 + sdz2*sdz2;
        if (slen22 < 1e-9) continue;
        var t2 = ((predEnemyX - a2.x) * sdx2 + (predEnemyZ - a2.z) * sdz2) / slen22;
        t2 = t2 < 0 ? 0 : t2 > 1 ? 1 : t2;
        var cx2 = a2.x + sdx2 * t2, cz2 = a2.z + sdz2 * t2;
        var d2 = Math.hypot(cx2 - predEnemyX, cz2 - predEnemyZ);
        if (d2 < bestPredDist) bestPredDist = d2;
      }
      
      // Use the better (closer) of current vs predicted position
      var minDist = Math.min(bestPerpDist, bestPredDist);
      
      // Probability based on perpendicular distance
      var probability = Math.max(0, 1 - minDist / (HIT_HL * 2));
      if (probability > 0.5) {
        return {willHit: true, probability: probability};
      }
    }
    return {willHit: false, probability: 0};
  }

  // Legacy wrapper for backward compat with existing calls
  function shellHeadingAtEnemy(enemyX, enemyZ) {
    var result = shellWillHitEnemy(enemyX, enemyZ, 0, 0);
    return result.willHit;
  }

  // Check if the player is about to walk into any of our own shells.
  function ownShellInPath(me, moveX, moveZ) {
    if (!cachedView || !cachedView.shells) return false;
    var myId = getMyId();
    // Check if moving in (moveX, moveZ) direction would put us in a shell's path
    var lookAhead = 60;  // check 60u ahead in the movement direction
    var probeX = me.x + moveX * lookAhead;
    var probeZ = me.z + moveZ * lookAhead;
    for (var i=0; i<cachedView.shells.length; i++) {
      var s = cachedView.shells[i];
      if (String(s.o) !== String(myId)) continue;
      var shAngle = getShellAngle(s.id);
      if (shAngle === null) continue;
      // Distance from our probe point to the shell's path
      var sdx = probeX - s.x, sdz = probeZ - s.z;
      var sdist = Math.hypot(sdx, sdz);
      if (sdist < 1) return true;
      var sproj = (Math.cos(shAngle) * sdx + Math.sin(shAngle) * sdz) / sdist;
      if (sproj <= 0) continue;  // shell moving away from probe point
      var perpDist = Math.abs(Math.cos(shAngle) * sdz - Math.sin(shAngle) * sdx);
      if (perpDist < TANK_R && sdist < 120) return true;  // v21.9: only block if shell is close AND heading at us
    }
    return false;
  }


  // Cached intercept target — findInterceptTarget is expensive (full shell scan)
  // and sendInput runs at 120Hz. Cache for 50ms (one RAF frame).
  var _interceptCache = null;
  var _interceptCacheT = 0;
  function getCachedIntercept(me) {
    var now = performance.now();
    if (_interceptCache && (now - _interceptCacheT) < 50) return _interceptCache;
    _interceptCache = findInterceptTarget(me);
    _interceptCacheT = now;
    return _interceptCache;
  }

  // ── Shell interceptor ──
  // Finds incoming shells within interceptRange and returns the best one to shoot down.
  // Returns {x, z, angle, dist, tImpact} or null.
  function findInterceptTarget(me) {
    if (!cfg.shellIntercept || !cachedView || !cachedView.shells) return null;
    var myId = getMyId();
    var best = null;
    for (var i = 0; i < cachedView.shells.length; i++) {
      var s = cachedView.shells[i];
      if (String(s.o) === String(myId)) continue;  // skip my own shells
      var spd = getShellSpeed(s.id, s.type);  // dynamic speed detection
      var sAngle = getShellAngle(s.id);
      if (sAngle === null) continue;  // no velocity data yet, skip
      // Current distance to player
      var dx = s.x - me.x, dz = s.z - me.z;
      var dist = Math.hypot(dx, dz);
      if (dist > cfg.interceptRange) continue;
      // Predict closest approach — is this shell heading toward me?
      var ux = Math.cos(sAngle) * spd, uz = Math.sin(sAngle) * spd;
      var tStar = -(ux * dx + uz * dz) / (ux * ux + uz * uz);
      if (tStar < 0) continue;  // shell moving away from me
      var cpX = s.x + ux * tStar, cpZ = s.z + uz * tStar;
      var closestDist = Math.hypot(cpX - me.x, cpZ - me.z);
      if (closestDist > TANK_R + 10) continue;  // won't actually hit me
      // This shell is a real threat — pick the closest one
      if (!best || dist < best.dist) {
        // Aim point: lead the shell slightly (shell is moving, my shell needs to meet it)
        // Simple: aim at where the shell will be in ~0.2s (my shell travel time to intercept)
        var leadT = dist / SHELL_SPEED.normal;  // my shell speed to reach enemy shell
        var aimX = s.x + ux * leadT * 0.5;  // lead half the distance (shell moves toward my shell)
        var aimZ = s.z + uz * leadT * 0.5;
        var aimAngle = Math.atan2(aimZ - me.z, aimX - me.x);
        best = { x: aimX, z: aimZ, angle: aimAngle, dist: dist, tImpact: tStar };
      }
    }
    return best;
  }

  // ── v21.1: Urgent incoming shell check (for mobility budget) ──
  // Quick scan: is there an incoming shell that will hit us within `thresholdMs`?
  // Used by the triggerbot's mobility budget to defer firing when we need to dodge.
  // Returns {tImpact, closestDist} or null. Cheaper than findInterceptTarget
  // because it doesn't compute the intercept aim point.
  function urgentIncomingShell(me, thresholdMs) {
    if (!cachedView || !cachedView.shells) return null;
    var myId = getMyId();
    var threshold = thresholdMs / 1000;
    for (var i = 0; i < cachedView.shells.length; i++) {
      var s = cachedView.shells[i];
      if (String(s.o) === String(myId)) continue;
      var spd = getShellSpeed(s.id, s.type);
      var sAngle = getShellAngle(s.id);
      if (sAngle === null) continue;
      var dx = s.x - me.x, dz = s.z - me.z;
      var dist = Math.hypot(dx, dz);
      if (dist > 600) continue;  // too far to be urgent
      var ux = Math.cos(sAngle) * spd, uz = Math.sin(sAngle) * spd;
      var tStar = -(ux * dx + uz * dz) / (ux * ux + uz * uz);
      if (tStar < 0 || tStar > threshold) continue;
      var cpX = s.x + ux * tStar, cpZ = s.z + uz * tStar;
      var closestDist = Math.hypot(cpX - me.x, cpZ - me.z);
      if (closestDist > TANK_R + 15) continue;  // won't hit me
      return { tImpact: tStar, closestDist: closestDist };
    }
    return null;
  }

  // ── Self-ricochet safety check ──
  // Traces the predicted shell path from a given aim angle and checks if any
  // segment of the path (after the first bounce) passes within selfRicochetRadius
  // of the player. If so, the shot is dangerous — returns true.
  // The first segment (direct from player) is skipped since it starts AT the player.
  function isShotSelfRicocheting(me, aimAngle) {
    if (!cfg.selfRicochetSafety) return false;
    var shellSpeed = SHELL_SPEED.normal;
    var ux = Math.cos(aimAngle), uz = Math.sin(aimAngle);
    // use SHELL_R for the self-ricochet trace too. The shell has 4.5u
    var traced = traceRicochet(me.x, me.z, ux, uz, cfg.maxBounces, cfg.maxShotDist, SHELL_R);
    
    // Get player's current velocity for prediction
    var myVel = getVel(me.id);
    var mySpeed = Math.hypot(myVel.vx, myVel.vz);
    
    // Check each segment EXCEPT the first (which starts at the player)
    for (var i = 1; i < traced.path.length - 1; i++) {
      var a = traced.path[i], b = traced.path[i + 1];
      var segDx = b.x - a.x, segDz = b.z - a.z;
      var segLen2 = segDx * segDx + segDz * segDz;
      if (segLen2 < 1e-9) continue;

      
      // Time for shell to reach this segment (approximate: distance traveled so far / shell speed)
      // We need to accumulate distance up to this segment
      var distSoFar = 0;
      for (var j = 0; j < i; j++) {
        var ja = traced.path[j], jb = traced.path[j + 1];
        distSoFar += Math.hypot(jb.x - ja.x, jb.z - ja.z);
      }
      var tShell = distSoFar / shellSpeed;  // time for shell to reach start of this segment
      
      // Predict where the player will be at time tShell
      // Player moves at ~105 u/s (or 147 with speed pickup)
      var predX = me.x + myVel.vx * tShell;
      var predZ = me.z + myVel.vz * tShell;
      // Clamp to world bounds (approximate)
      var wW = (cachedView && (cachedView.worldW || cachedView.mapW)) || 1820;
      var wH = (cachedView && (cachedView.worldH || cachedView.mapH)) || 1400;
      predX = Math.max(TANK_R, Math.min(wW - TANK_R, predX));
      predZ = Math.max(TANK_R, Math.min(wH - TANK_R, predZ));
      
      // Closest point on segment to PREDICTED player position
      var t = ((predX - a.x) * segDx + (predZ - a.z) * segDz) / segLen2;
      t = Math.max(0, Math.min(1, t));
      var cx = a.x + segDx * t, cz = a.z + segDz * t;
      var dist = Math.hypot(cx - predX, cz - predZ);
      
      // Use larger radius if player is moving fast (harder to dodge)
      var dynamicRadius = cfg.selfRicochetRadius + mySpeed * tShell * 0.3;
      if (dist < dynamicRadius) {
        return true;  // this shot would hit us
      }
    }
    return false;
  }


  // ── Death cause tracker ──

  // ── sendInput hook (v21.1: PROPOSAL-BASED ARBITRATION) ──
  // Replaces the old priority-exit flow where the shell interceptor would
  // skip the dodge entirely. Now each subsystem proposes what it wants,
  // and the arbiter merges them at the end. Dodge always runs, even when
  // intercept is active. This fixes the #1 architectural flaw from the
  // deep analysis.
  var origSendInput = _sendName ? net[_sendName].bind(net) : function(x){return x;};
  if (!_sendName) console.warn('[wkl] sendInput not found — aimbot/dodge inactive');

  net[_sendName || 'sendInput'] = function(input) {
    try {
      if (!cfg.enabled) return origSendInput(input);
      var me = cachedMe;
      if (!me) return origSendInput(input);

      // Auto-respawn — pulse fire to create edge (game only respawns on fire edge)
      // This is a hard exit: when dead, nothing else matters.
      if (me.dead) {
        // Clear visualization caches on death to prevent ray overpopulation
        cachedSolutions = [];
        tracerCache = null;
        if (cfg.autoRespawn) {
          var rn = performance.now();
          if (!window._wklRespawnT) window._wklRespawnT = 0;
          if (rn - window._wklRespawnT > 200) {
            input.fire = true;
            window._wklRespawnT = rn;
          } else if (rn - window._wklRespawnT > 100) {
            input.fire = false;
          } else {
            input.fire = true;
          }
          input.mine = false;
        }
        aim_angle = null;
        return origSendInput(input);
      }

      var now = performance.now();

      // ═══════════════════════════════════════════════════════════════
      //  PROPOSAL COLLECTION
      //  Each subsystem proposes what it wants. No early returns.
      //  The arbiter merges them at the end.
      // ═══════════════════════════════════════════════════════════════
      var proposal = {
        aim: null,            // desired aim angle
        aimSource: null,      // 'intercept' | 'aimbot'
        aimSnap: false,       // if true, don't smooth (intercept snaps)
        moveX: 0,             // desired movement X
        moveZ: 0,             // desired movement Z
        moveSource: null,     // 'dodge' | 'mine-retreat' | 'tactical'
        moveOverride: false,  // if true, fully replaces input movement
        fire: false,          // should we fire?
        fireSource: null,     // 'intercept' | 'triggerbot'
        fireSuppress: false  // force fire = false
      };

      // ── 1. Shell interceptor proposal ──
      // Was: priority exit that skipped dodge. Now: just proposes aim+fire.
      // The dodge still runs below, combining with intercept's aim.
      var interceptTgt = F ? getCachedIntercept(me) : findInterceptTarget(me);
      var myShells = F ? F.myShellCount : myShellsInFlight();
      if (interceptTgt) {
        proposal.aim = interceptTgt.angle;
        proposal.aimSource = 'intercept';
        proposal.aimSnap = true;  // intercept snaps (no smoothing)

        if (cfg.triggerbot || cfg.shellIntercept) {
          var canIntercept = myShells < SHELL_CAP
                           && (now - lastFireT) > cfg.fireCooldownMs;
          if (canIntercept && cfg.selfRicochetSafety && isShotSelfRicocheting(me, interceptTgt.angle)) {
            canIntercept = false;
          }
          if (canIntercept) {
            proposal.fire = true;
            proposal.fireSource = 'intercept';
          }
        }
        // NOTE: no return here — dodge and aimbot still get to propose
      }


      // ── 4. Dodge proposal ──
      // v21.4 DODGE OVERRIDE FIX: the old code BLENDED dodge with input.moveX/Z,
      // which caused the "move toward shell then away" bug. When the bot was
      // moving toward an enemy and a shell came from the side, the blend produced
      // a vector that had a component pointing toward the shell's origin.
      // Fix: high-urgency dodge OVERRIDES movement entirely (no blend).
      // Low-urgency dodge (gentle nudge) still blends. This matches human
      // behavior: if a shell is about to hit you, you STOP whatever you were
      // doing and dodge. If it's a distant threat, you slightly adjust course.
      if (cfg.autoDodge && lastDodgeVec && !proposal.moveOverride) {
        var dUrg = lastDodgeVec.urgency;
        var dodgeMoveX, dodgeMoveZ, dodgeSource;

        // MAGNETIZE FIX: project out toward-shell component from input.
        // Player's input often points at enemy (= at shell origin). Medium-urgency
        // blend preserved that toward-risk component → "magnetize then snap" bug.
        var inputSafeX = input.moveX, inputSafeZ = input.moveZ;
        if (dUrg > 0.05 && lastDodgeVec.threats && lastDodgeVec.threats.length) {
          var topThreat = null;
          for (var _ti = 0; _ti < lastDodgeVec.threats.length; _ti++) {
            var _th = lastDodgeVec.threats[_ti];
            if (_th.type === 'shell' && _th.approach && (!topThreat || _th.urgency > topThreat.urgency)) {
              topThreat = _th;
            }
          }
          if (topThreat && topThreat.approach.segLen > 1) {
            var _shDirX = topThreat.approach.segDx / topThreat.approach.segLen;
            var _shDirZ = topThreat.approach.segDz / topThreat.approach.segLen;
            var _towardDot = input.moveX * _shDirX + input.moveZ * _shDirZ;
            if (_towardDot > 0) {
              inputSafeX = input.moveX - _towardDot * _shDirX;
              inputSafeZ = input.moveZ - _towardDot * _shDirZ;
              var _safeLen = Math.hypot(inputSafeX, inputSafeZ);
              if (_safeLen > 0.01) { inputSafeX /= _safeLen; inputSafeZ /= _safeLen; }
              else { inputSafeX = 0; inputSafeZ = 0; }
            }
          }
        }

        // HIGH threshold lowered 0.5 → 0.35 (narrower medium window)
        if (dUrg > 0.35) {
          dodgeMoveX = lastDodgeVec.moveX;
          dodgeMoveZ = lastDodgeVec.moveZ;
          dodgeSource = 'dodge_override';
        } else if (dUrg > 0.15) {
          var blend = dUrg * 1.6;
          dodgeMoveX = inputSafeX*(1-blend) + lastDodgeVec.moveX*blend;
          dodgeMoveZ = inputSafeZ*(1-blend) + lastDodgeVec.moveZ*blend;
          var dm = Math.hypot(dodgeMoveX, dodgeMoveZ);
          if (dm > 1) { dodgeMoveX/=dm; dodgeMoveZ/=dm; }
          dodgeSource = 'dodge_blend';
        } else {
          var blendLow = dUrg * 0.5;
          dodgeMoveX = inputSafeX*(1-blendLow) + lastDodgeVec.moveX*blendLow;
          dodgeMoveZ = inputSafeZ*(1-blendLow) + lastDodgeVec.moveZ*blendLow;
          var dm2 = Math.hypot(dodgeMoveX, dodgeMoveZ);
          if (dm2 > 1) { dodgeMoveX/=dm2; dodgeMoveZ/=dm2; }
          dodgeSource = 'dodge_nudge';
        }
        
        // OWN-SHELL DODGE CHECK
        if (ownShellInPath(me, dodgeMoveX, dodgeMoveZ)) {
          // The dodge would move us into our own shell's path. Try the opposite
          // direction (mirror the dodge vector) — if that's also dangerous, hold still.
          var mirrorX = -dodgeMoveX, mirrorZ = -dodgeMoveZ;
          if (!ownShellInPath(me, mirrorX, mirrorZ)) {
            proposal.moveX = mirrorX;
            proposal.moveZ = mirrorZ;
            proposal.moveSource = 'dodge_own_shell_mirror';
          } else {
            // Both directions dangerous — hold still (don't move into either shell)
            proposal.moveX = 0;
            proposal.moveZ = 0;
            proposal.moveSource = 'dodge_own_shell_hold';
          }
        } else {
          // Safe to dodge in the original direction
          proposal.moveX = dodgeMoveX;
          proposal.moveZ = dodgeMoveZ;
          proposal.moveSource = dodgeSource;
        }
      }

      // ── 5. Aimbot + triggerbot proposal ──
      // Only propose aim if intercept didn't snap (intercept > aimbot for aim)
      if (cfg.aimbot && aim_angle !== null && !proposal.aimSnap) {
        if (lastAim === null) lastAim = input.aim || aim_angle;
        var tStep = 1 - Math.max(0, Math.min(0.99, cfg.aimSmooth));
        lastAim = lerpAngle(lastAim, aim_angle, tStep);
        proposal.aim = lastAim;
        proposal.aimSource = 'aimbot';

        // Triggerbot with lethal priority, shell reserve, cooldown, hit-prob gate
        if (cfg.triggerbot && !proposal.fireSuppress) {
          var err = Math.abs(angleDiff(proposal.aim, aim_angle));

          // STATIONARY TARGET DETECTION
          var currentTargetTank = currentTargetRef;
          var isStationary = false;
          if (currentTargetTank) {
            // 3-TICK STATIONARY PULSE
            var tgtVel = getVel(currentTargetTank.id);
            var tgtSpeed = Math.hypot(tgtVel.vx, tgtVel.vz);
            
            // Quick checks first:
            if (currentTargetTank.k === 'brown') {
              isStationary = true;
            } else if (tgtSpeed < 5) {
              isStationary = true;
            }
            
            // SIMPLIFIED pulse check (less GC = less stutter)
            if (!window._statPulse) window._statPulse = {};
            var tgtId = String(currentTargetTank.id);
            var pulse = window._statPulse[tgtId];
            if (!pulse) {
              pulse = { x0: 0, z0: 0, x1: 0, z1: 0, x2: 0, z2: 0, n: 0, t: 0 };
              window._statPulse[tgtId] = pulse;
            }
            var nowMs = performance.now();
            if (nowMs - pulse.t > 100) {  // sample every 100ms (was 50ms)
              pulse.x0 = pulse.x1; pulse.z0 = pulse.z1;
              pulse.x1 = pulse.x2; pulse.z1 = pulse.z2;
              pulse.x2 = currentTargetTank.x; pulse.z2 = currentTargetTank.z;
              pulse.n = Math.min(pulse.n + 1, 3);
              pulse.t = nowMs;
            }
            if (pulse.n >= 3) {
              var totalMove = Math.hypot(pulse.x2 - pulse.x0, pulse.z2 - pulse.z0);
              if (totalMove < 3) {
                isStationary = true;
              } else if (totalMove > 20) {
                isStationary = false;
              }
            }
            // Clean up dead targets (less frequently to reduce GC)
            if (Math.random() < 0.05) {
              var activeIds = cachedEnemies.map(function(e) { return String(e.id); });
              for (var pid in window._statPulse) {
                if (activeIds.indexOf(pid) < 0) delete window._statPulse[pid];
              }
            }
          }

          var isLethal = false;
          if (cfg.lethalPriority && currentTargetTank) {
            if (typeof currentTargetTank.health === 'number' && currentTargetTank.health <= 1) {
              isLethal = true;
            }
          }

          var maxShells = isLethal ? SHELL_CAP : (SHELL_CAP - cfg.reserveShells);
          
          // HUMAN-STYLE AMMO JUDGMENT (per-shot, no configurable thresholds)
          var _tgtVelForPred = getVel(aim_targetId);
          var shellAlreadyGoingToHit = shellWillHitEnemy(
            aim_targetX, aim_targetZ,
            _tgtVelForPred ? _tgtVelForPred.vx : 0,
            _tgtVelForPred ? _tgtVelForPred.vz : 0
          ).willHit;
          
          // STRICT STATIONARY FIX
          if (isStationary && currentTargetTank) {
            // HARD RULE for stationary targets — if we have ANY shell in flight,
            if (myShells > 0) {
              shellAlreadyGoingToHit = true;
            }
            // Also check if a shell is specifically heading at this target (for multi-target)
            var shellAtThisStationary = shellHeadingAtEnemy(currentTargetTank.x, currentTargetTank.z);
            if (shellAtThisStationary) {
              shellAlreadyGoingToHit = true;
            }
          }
          
          // own-shell danger check (self-ricochet in flight)
          var ownShellDanger = false;
          if (cachedView && cachedView.shells && myShells > 0) {
            var _myId = F ? F.myId : getMyId();
            for (var _si = 0; _si < cachedView.shells.length; _si++) {
              var _os = cachedView.shells[_si];
              if (String(_os.o) !== String(_myId)) continue;
              var _osAngle = getShellAngle(_os.id);
              if (_osAngle === null) continue;
              var _odx = me.x - _os.x, _odz = me.z - _os.z;
              var _od = Math.hypot(_odx, _odz);
              if (_od < 1) continue;
              var _oproj = (Math.cos(_osAngle) * _odx + Math.sin(_osAngle) * _odz) / _od;
              if (_oproj > 0.6 && _od < 150) { ownShellDanger = true; break; }
            }
          }

          // v21.1 MOBILITY BUDGET: don't fire if an incoming shell will hit us
          var mobilityBlock = false;
          if (cfg.mobilityBudgetMs > 0 && !isLethal) {
            var urgent = urgentIncomingShell(me, cfg.mobilityBudgetMs);
            if (urgent) mobilityBlock = true;
          }

          // FIRE DECISION: judged per-shot, inline, like a human.
          // "Should I fire RIGHT NOW?" = aim is on target AND shell cap not full
          // AND cooldown ready AND hit probability is acceptable AND no shell is
          // already going to hit this target AND no self-ricochet danger AND
          // not about to be hit (mobility budget).
          // REMOVED adaptive cooldown — fixed cfg.fireCooldownMs produces multi-angle
          // burst fire (12 shells/sec at different angles). Adaptive cooldown was
          // slowing down firing. Conservation handled by shellWillHitEnemy + brown tank hard rule.
          var adaptiveCooldown = cfg.fireCooldownMs;
          var shellsInFlight = myShells;  // v27-fix: was deleted when adaptive cooldown removed; without this, canFire was always false

          var canFire = err < cfg.triggerAngle
                     && shellsInFlight < maxShells
                     && (now - lastFireT) > adaptiveCooldown
                     && aim_hitProb >= cfg.minHitProb
                     && !shellAlreadyGoingToHit   // v21.4: human-style "is my bullet already going to hit?"
                     && !ownShellDanger
                     && !mobilityBlock;

          if (canFire && cfg.selfRicochetSafety && !isLethal && isShotSelfRicocheting(me, aim_angle)) {
            canFire = false;
          }

          if (canFire && !proposal.fire) {
            proposal.fire = true;
            proposal.fireSource = 'triggerbot';
          }
        }
      } else if (!cfg.aimbot || (proposal.aimSnap && !interceptTgt)) {
        lastAim = null;
      }

      // ═══════════════════════════════════════════════════════════════
      //  ARBITRATE: merge proposals into input
      // ═══════════════════════════════════════════════════════════════

      // Aim: intercept snaps, aimbot smooths. If intercept proposed, it wins.
      if (proposal.aim !== null) {
        input.aim = proposal.aim;
      }

      // Movement: mine-retreat overrides; dodge blends with existing input
      if (proposal.moveSource !== null) {
        input.moveX = proposal.moveX;
        input.moveZ = proposal.moveZ;
      }
      
      // FINAL own-shell safety check on whatever movement we end up with.
      if (myShells > 0 && (Math.abs(input.moveX) > 0.1 || Math.abs(input.moveZ) > 0.1)) {
        if (ownShellInPath(me, input.moveX, input.moveZ)) {
          input.moveX = 0;
          input.moveZ = 0;
        }
      }

      // Fire: suppress > intercept > triggerbot. Only set fire edge once.
      // Also clear input.fire when no proposal wants to fire. Previously, if the
      // passive bot set input.fire=true (for respawn) and the player was alive next frame,
      // the cheat didn't clear it — player kept firing indefinitely. This is the root cause
      // of Dodge Training trials showing kills despite aimbot being off.
      if (proposal.fireSuppress) {
        input.fire = false;
      } else if (proposal.fire && !input.fire) {
        input.fire = true;
        lastFireT = now;
        lastFireStunT = now;
      } else if (!proposal.fire && input.fire && !me.dead) {
        // No proposal wants to fire, player is alive, but input.fire is still true
        input.fire = false;
      }


      return origSendInput(input);
    } catch(e) {
      console.error('[wkl] sendInput error:', e);
      return origSendInput(input);
    }
  };

  // ── Dodge ──
  function getMySpeed(me) {
    if (me.stunCount != null && me.stunCount < 0) return 0;  // stunned
    return (me.fx==='speed' && me.fxT>0) ? 147 : 105;
  }
  // Firing stun: the game adds -5 ticks (42ms) of stun when you fire.
  // During stun, movement is disabled. Account for this in predictions.
  var FIRE_STUN_MS = 42;  // 5 ticks at 120Hz

  var lastFireStunT = 0;
  function isStunnedFromFiring(now) {
    return (now - lastFireStunT) < FIRE_STUN_MS;
  }
  // Get effective player velocity, accounting for fire stun
  function getEffectiveMyVel(me, now) {
    if (isStunnedFromFiring(now)) return { vx: 0, vz: 0 };
    return getVel(me.id);
  }

  // Grid-accelerated pointInTile — checks only the 9 cells around (x,z) instead of all tiles.
  // ~25x faster on maps with 100+ tiles. Same result.
  function pointInTile(x, z, tiles, margin) {
    if (margin === undefined) margin = 0;
    if (grid.length === 0) {
      for (var i=0; i<tiles.length; i++) {
        var t0=tiles[i];
        if (x>t0.x-t0.hw-margin && x<t0.x+t0.hw+margin && z>t0.z-t0.hl-margin && z<t0.z+t0.hl+margin) return true;
      }
      return false;
    }
    var col = Math.floor(x / TILE);
    var row = Math.floor(z / TILE);
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var r = row + dr, c = col + dc;
        if (r < 0 || r >= gridRows || c < 0 || c >= gridCols) continue;
        var cell = grid[r][c];
        if (!cell) continue;
        for (var ci = 0; ci < cell.length; ci++) {
          var t = cell[ci];
          if (x>t.x-t.hw-margin && x<t.x+t.hw+margin && z>t.z-t.hl-margin && z<t.z+t.hl+margin) return true;
        }
      }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  //  COLD-SPOT DODGE SYSTEM
  // ═══════════════════════════════════════════════════════════════
  // Replaces vector-averaging dodge for 2+ shell threats.
  // Scores POSITIONS not DIRECTIONS — finds the safest reachable cell.
  // Why: vector-averaging cancels out when 3+ shells come from different
  // angles (perpendicular components sum to zero). Position-scoring asks
  // "is this LOCATION safe from ALL threats" — never cancels out.
  // Layers:
  //   1. Predicted shell set (enemies about to fire — dodge BEFORE shell exists)
  //   2. Reactive scan (32-point circumference, per frame, adaptive radius)
  //   3. Strategic grid (9×9 at 50u, cached 250ms — covers ±200u)
  //   4. Merge with dot-product guard (never move toward a shell)
  //   5. 8-direction sim fallback (when no safe cell exists — minimize hits)
  //   6. Telemetry expose on window._wklDodgeDebug (fixes 0% dodge telemetry bug)
  var COLDSPOT_SAFETY_MARGIN = TANK_R + SHELL_R + 5;  // 32.5u
  var COLDSPOT_REACTIVE_POINTS = 32;
  var COLDSPOT_REACTIVE_MIN_R = 60;
  var COLDSPOT_REACTIVE_MAX_R = 150;
  var COLDSPOT_GRID_SIZE = 9;        // 9×9 grid
  var COLDSPOT_GRID_CELL = 50;       // 50u per cell — covers ±200u
  var COLDSPOT_GRID_REFRESH_MS = 250;
  var COLDSPOT_PREDICT_WEIGHT = 0.3; // predicted shells count at 30% danger
  var COLDSPOT_MAX_SHELL_DIST = 600; // only consider shells within 600u of player

  var coldSpotGridCache = null;
  var lastPredictedShells = [];

  // Layer 1: Predict shells from enemies about to fire (turret aimed at player)
  // widened aim threshold from 0.1 to 0.2 rad (~11°) and added turret rotation
  // prediction — if enemy is rotating toward player, predict they'll fire soon.
  function getPredictedShells(me, enemies) {
    var predicted = [];
    var myVel = getVel(me.id);
    var predPlayerX = me.x + myVel.vx * 0.2;
    var predPlayerZ = me.z + myVel.vz * 0.2;

    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.stunCount != null && e.stunCount < 0) continue;
      if (typeof e.turretAngle !== 'number') continue;
      var dx = predPlayerX - e.x, dz = predPlayerZ - e.z;
      var distToPlayer = Math.hypot(dx, dz);
      if (distToPlayer < 1) continue;
      var angleToPlayer = Math.atan2(dz, dx);
      var angleDiff = Math.abs(((e.turretAngle - angleToPlayer + Math.PI*3) % (Math.PI*2)) - Math.PI);
      // widened from 0.1 to 0.2 rad — catches enemies still rotating onto target
      if (angleDiff < 0.2) {
        var speed = 320;
        if (e.type === 'teal' || e.type === 'green' || e.type === 'black') speed = 680;
        if (e.type === 'purple') speed = 980;
        predicted.push({
          x: e.x + Math.cos(e.turretAngle) * 30,
          z: e.z + Math.sin(e.turretAngle) * 30,
          angle: e.turretAngle,
          speed: speed,
          isPredicted: true,
          sourceEnemy: e.id,
        });
      }
    }
    return predicted;
  }

  // Get all real incoming shells (extrapolated to current time using cacheAge)
  // include OWN shells too — ricochets can kill you. This fixes the self-shell
  // death problem on Dodge Training (18 self-shell deaths in v22.3 with aimbot off).
  function getRealIncomingShells(me, cacheAge) {
    var shells = cachedView.shells || [];
    var myId = getMyId();
    var incoming = [];
    for (var si = 0; si < shells.length; si++) {
      var s = shells[si];
      // don't skip own shells — they can ricochet into us.
      var isOwn = String(s.o) === String(myId);
      var spd = getShellSpeed(s.id, s.type);
      var sAngle = getShellAngle(s.id);
      if (sAngle === null) continue;
      var ex = s.x + Math.cos(sAngle) * spd * cacheAge;
      var ez = s.z + Math.sin(sAngle) * spd * cacheAge;
      incoming.push({
        x: ex, z: ez,
        angle: sAngle,
        speed: spd,
        isPredicted: false,
        isOwn: isOwn,  // v22.4: track own shells
        shellId: s.id,
      });
    }
    return incoming;
  }

  // Compute danger at a given position from a set of shells (real + predicted)
  // Uses pre-computed shell paths instead of tracing per-point. This eliminates
  // 95% of raycasts — we trace each shell ONCE per frame (in coldSpotDodge), cache the
  // path segments, then all 32 reactive points + 81 grid cells just do cheap
  // point-to-segment distance math against the cached paths.
  function shellDangerAtPoint(px, pz, cachedShellPaths) {
    var totalDanger = 0;
    for (var i = 0; i < cachedShellPaths.length; i++) {
      var sp = cachedShellPaths[i];
      var distToShell = Math.hypot(sp.x - px, sp.z - pz);
      if (distToShell > COLDSPOT_MAX_SHELL_DIST) continue;

      // Find closest approach to point (px, pz) using cached path segments
      var minDist = Infinity;
      for (var j = 0; j < sp.segments.length; j++) {
        var seg = sp.segments[j];
        var sdx = seg.bx - seg.ax, sdz = seg.bz - seg.az, slen2 = sdx*sdx + sdz*sdz;
        if (slen2 < 1e-9) continue;
        var t = ((px - seg.ax) * sdx + (pz - seg.az) * sdz) / slen2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        var cx = seg.ax + sdx * t, cz = seg.az + sdz * t;
        var d = Math.hypot(cx - px, cz - pz);
        if (d < minDist) minDist = d;
      }

      // Danger ramps from 1 (shell hits point) to 0 (point is SAFETY_MARGIN away)
      var danger = Math.max(0, 1 - minDist / COLDSPOT_SAFETY_MARGIN);
      // Urgency weight: closer shells (shorter time-to-impact) matter more
      var timeToImpact = minDist / sp.speed;
      var urgencyWeight = 1 / Math.max(0.1, timeToImpact + 0.1);
      var predictWeight = sp.isPredicted ? COLDSPOT_PREDICT_WEIGHT : 1.0;
      totalDanger += danger * urgencyWeight * predictWeight;
    }
    return totalDanger;
  }

  // Segment-segment intersection check — does line (px1,pz1)→(px2,pz2)
  function segmentsIntersect(px1, pz1, px2, pz2, ax, az, bx, bz) {
    var d1x = px2 - px1, d1z = pz2 - pz1;
    var d2x = bx - ax, d2z = bz - az;
    var denom = d1x * d2z - d1z * d2x;
    if (Math.abs(denom) < 1e-9) return false;  // parallel
    var s = ((ax - px1) * d2z - (az - pz1) * d2x) / denom;
    var t = ((ax - px1) * d1z - (az - pz1) * d1x) / denom;
    return s >= 0 && s <= 1 && t >= 0 && t <= 1;
  }

  // Layer 2: Reactive scan — 32 points around player at adaptive radius
  // uses cached shell paths instead of re-tracing per point
  // PATH-CROSSING CHECK — skip points that require crossing a shell's
  // trajectory line. This fixes the "moves toward trajectory then dodges" bug.
  // The bug: cold-spot picks a point on the FAR side of a shell's path (low danger
  // there because shell is heading away). But to REACH that point, the player must
  // CROSS the shell's path — getting hit in the process. Now we check if the path
  // from player to candidate crosses any shell segment, and skip if it does.
  function reactiveColdSpotScan(me, cachedShellPaths, timeToNearestImpact) {
    var mySpeed = getMySpeed(me);
    var budget = mySpeed * Math.min(timeToNearestImpact, 0.5);
    var radius = Math.max(COLDSPOT_REACTIVE_MIN_R, Math.min(COLDSPOT_REACTIVE_MAX_R, budget));

    var bestPoint = null;
    var bestScore = Infinity;
    // RANDOMIZED SAFE-DIRECTION: collect all points within 10% of best score.
    // Anti-human: deterministic dodge is readable. When 2+ safe cells are within
    // 10% of best, pick RANDOM — breaks the pattern humans exploit.
    var candidates = [];

    for (var i = 0; i < COLDSPOT_REACTIVE_POINTS; i++) {
      var angle = (i / COLDSPOT_REACTIVE_POINTS) * TAU;
      var px = me.x + Math.cos(angle) * radius;
      var pz = me.z + Math.sin(angle) * radius;
      if (pointInTile(px, pz, cachedTiles, TANK_R)) continue;
      var danger = shellDangerAtPoint(px, pz, cachedShellPaths);

      // PATH-CROSSING SKIP
      var pathCrosses = false;
      for (var spi = 0; spi < cachedShellPaths.length; spi++) {
        var sp = cachedShellPaths[spi];
        if (Math.hypot(sp.x - me.x, sp.z - me.z) > 300) continue;
        for (var spj = 0; spj < sp.segments.length; spj++) {
          var seg = sp.segments[spj];
          if (segmentsIntersect(me.x, me.z, px, pz, seg.ax, seg.az, seg.bx, seg.bz)) {
            pathCrosses = true;
            break;
          }
        }
        if (pathCrosses) break;
      }
      if (pathCrosses) continue;
      if (danger < bestScore) {
        bestScore = danger;
        bestPoint = {x: px, z: pz, score: danger, angle: angle};
      }
      candidates.push({x: px, z: pz, score: danger, angle: angle});
    }

    // RANDOMIZED SAFE-DIRECTION SELECTION — if 2+ candidates within 10% of best, pick random
    if (candidates.length >= 2 && bestScore < Infinity) {
      var threshold = bestScore * 1.10;
      var safeCandidates = [];
      for (var ci = 0; ci < candidates.length; ci++) {
        if (candidates[ci].score <= threshold) safeCandidates.push(candidates[ci]);
      }
      if (safeCandidates.length >= 2) {
        bestPoint = safeCandidates[Math.floor(Math.random() * safeCandidates.length)];
      }
    }
    return {best: bestPoint, radius: radius};
  }

  // Layer 3: Strategic grid — 9×9 cells, cached 250ms
  // uses cached shell paths + offensive positioning (LOS to enemies bonus)
  function strategicColdSpotGrid(me, cachedShellPaths, enemies, now) {
    if (coldSpotGridCache && (now - coldSpotGridCache.t) < COLDSPOT_GRID_REFRESH_MS) {
      return coldSpotGridCache.best;
    }

    var bestCell = null;
    var bestScore = Infinity;
    var halfGrid = Math.floor(COLDSPOT_GRID_SIZE / 2);

    // Score current position as baseline
    var currentDanger = shellDangerAtPoint(me.x, me.z, cachedShellPaths);
    var currentScore = currentDanger;

    var tiles = cachedTiles || [];

    for (var gx = -halfGrid; gx <= halfGrid; gx++) {
      for (var gz = -halfGrid; gz <= halfGrid; gz++) {
        var cx = me.x + gx * COLDSPOT_GRID_CELL;
        var cz = me.z + gz * COLDSPOT_GRID_CELL;

        if (pointInTile(cx, cz, tiles, TANK_R)) continue;

        var dx = cx - me.x, dz = cz - me.z;
        var dist = Math.hypot(dx, dz);
        if (dist < 1) continue;  // skip current position

        // Reachability: single raycast from player to cell
        var ux = dx / dist, uz = dz / dist;
        var reachable = true;
        for (var ti = 0; ti < tiles.length; ti++) {
          var tile = tiles[ti];
          var box = {x: tile.x, z: tile.z, hw: tile.hw, hl: tile.hl};
          var hit = rayAABB(me.x, me.z, ux, uz, box);
          if (hit && hit.t < dist) { reachable = false; break; }
        }
        if (!reachable) continue;

        var danger = shellDangerAtPoint(cx, cz, cachedShellPaths);

        // Wall proximity penalty (pinning risk)
        var wallNeighbors = 0;
        for (var nx = -1; nx <= 1; nx++) {
          for (var nz = -1; nz <= 1; nz++) {
            if (nx === 0 && nz === 0) continue;
            if (pointInTile(cx + nx * COLDSPOT_GRID_CELL, cz + nz * COLDSPOT_GRID_CELL, tiles, 0)) {
              wallNeighbors++;
            }
          }
        }
        var pinningPenalty = 0;
        if (wallNeighbors >= 2) pinningPenalty = 30;
        if (wallNeighbors >= 3) pinningPenalty = 60;
        if (wallNeighbors >= 5) pinningPenalty = 100;

        // Enemy proximity + firing arc penalty
        var enemyPenalty = 0;
        var offensiveBonus = 0;
        // only apply offensive bonus when aimbot is ON — in Safe mode (aimbot off),
        var offensiveEnabled = cfg.aimbot && cfg.triggerbot;
        for (var ei = 0; ei < enemies.length; ei++) {
          var enemy = enemies[ei];
          var ed = Math.hypot(enemy.x - cx, enemy.z - cz);
          if (ed < 200) enemyPenalty += 5 * (1 - ed / 200);
          // OFFENSIVE POSITIONING — if this cell has direct LOS to an enemy
          if (offensiveEnabled && ed < 800 && ed > 50) {
            // Check LOS from cell to enemy (single raycast)
            var eDx = (enemy.x - cx) / ed, eDz = (enemy.z - cz) / ed;
            var hasLOS = true;
            for (var lt = 0; lt < tiles.length; lt++) {
              var lt_tile = tiles[lt];
              var lt_box = {x: lt_tile.x, z: lt_tile.z, hw: lt_tile.hw, hl: lt_tile.hl};
              var lt_hit = rayAABB(cx, cz, eDx, eDz, lt_box);
              if (lt_hit && lt_hit.t < ed) { hasLOS = false; break; }
            }
            if (hasLOS) {
              // Bonus scales inversely with distance — closer enemies = bigger bonus
              offensiveBonus -= 15 * (1 - ed / 800);
            }
          }
          // Stationary enemy firing arc penalty (from v21.7)
          if (typeof getVel === 'function' && ed < 600) {
            var eVel = getVel(enemy.id);
            var eSpeed = Math.hypot(eVel.vx, eVel.vz);
            if (eSpeed < 10 && typeof enemy.turretAngle === 'number') {
              var eToCellX = cx - enemy.x, eToCellZ = cz - enemy.z;
              var eToCellLen = Math.hypot(eToCellX, eToCellZ);
              if (eToCellLen > 1) {
                var eToCellAngle = Math.atan2(eToCellZ, eToCellX);
                var arcDiff = Math.abs(((enemy.turretAngle - eToCellAngle + Math.PI*3) % (Math.PI*2)) - Math.PI);
                if (arcDiff < 0.15) {
                  enemyPenalty += 25 * (1 - ed / 600);
                }
              }
            }
          }
        }

        // Pickup bonus (incentivize grabbing pickups during dodge)
        var pickupBonus = 0;
        var pickups = cachedView.pickups || [];
        for (var pi = 0; pi < pickups.length; pi++) {
          var pd = Math.hypot(pickups[pi].x - cx, pickups[pi].z - cz);
          if (pd < 40) {
            pickupBonus = pickups[pi].kind === 'shield' ? 15 : (pickups[pi].kind === 'speed' ? 10 : 5);
          }
        }

        // total = danger + penalties - bonuses (offensive + pickup)
        var totalScore = danger + pinningPenalty + enemyPenalty - pickupBonus + offensiveBonus;
        if (totalScore < bestScore) {
          bestScore = totalScore;
          bestCell = {x: cx, z: cz, score: totalScore};
        }
      }
    }

    // Only return best cell if it's BETTER than current position
    var result = (bestCell && bestScore < currentScore) ? bestCell : null;
    coldSpotGridCache = {best: result, t: now, currentScore: currentScore};
    return result;
  }

  // Layer 5: 8-direction simulation fallback (when no safe cell exists)
  // Simulates player moving in 8 directions, counts shell hits per direction
  function sim8DirFallback(me, shells, timeToNearestImpact) {
    var mySpeed = getMySpeed(me);
    var simTime = Math.min(timeToNearestImpact, 0.5);
    var moveDist = mySpeed * simTime;

    var bestDir = null;
    var bestHits = Infinity;
    var bestDist = -1;

    for (var i = 0; i < 8; i++) {
      var angle = (i / 8) * TAU;
      var px = me.x + Math.cos(angle) * moveDist;
      var pz = me.z + Math.sin(angle) * moveDist;
      if (pointInTile(px, pz, cachedTiles, TANK_R)) continue;
      var hits = 0;
      var minShellDist = Infinity;
      for (var si = 0; si < shells.length; si++) {
        var sh = shells[si];
        var d = Math.hypot(sh.x - px, sh.z - pz);
        if (d < minShellDist) minShellDist = d;
        var traced = traceRicochet(sh.x, sh.z, Math.cos(sh.angle) * sh.speed, Math.sin(sh.angle) * sh.speed, cfg.dodgeBounces, COLDSPOT_MAX_SHELL_DIST, 0);
        for (var j = 0; j < traced.path.length - 1; j++) {
          var a = traced.path[j], b = traced.path[j+1];
          var sdx = b.x - a.x, sdz = b.z - a.z, slen2 = sdx*sdx + sdz*sdz;
          if (slen2 < 1e-9) continue;
          var t = ((px - a.x) * sdx + (pz - a.z) * sdz) / slen2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          var cx = a.x + sdx * t, cz = a.z + sdz * t;
          var dd = Math.hypot(cx - px, cz - pz);
          if (dd < COLDSPOT_SAFETY_MARGIN) {
            hits++;
            break;
          }
        }
      }
      if (hits < bestHits || (hits === bestHits && minShellDist > bestDist)) {
        bestHits = hits;
        bestDist = minShellDist;
        bestDir = {x: Math.cos(angle), z: Math.sin(angle), hits: hits};
      }
    }
    return bestDir;
  }

  // Main cold-spot dodge — called from computeDodge when 2+ shell threats
  // pre-compute shell paths ONCE per frame, pass cached paths to all scans
  function coldSpotDodge(me, threats, cacheAge) {
    var now = performance.now();

    var realShells = getRealIncomingShells(me, cacheAge);
    var enemies = cachedEnemies || [];
    var predictedShells = getPredictedShells(me, enemies).slice(0, 8);  // v27-cap-pred8: cap at 8
    var allShells = realShells.concat(predictedShells);
    lastPredictedShells = predictedShells;

    if (allShells.length === 0) return null;

    // PRE-COMPUTE SHELL PATHS — trace each shell's ricochet path ONCE,
    var cachedShellPaths = [];
    for (var spi = 0; spi < allShells.length; spi++) {
      var sh = allShells[spi];
      var traced = traceRicochet(sh.x, sh.z, Math.cos(sh.angle) * sh.speed, Math.sin(sh.angle) * sh.speed, cfg.dodgeBounces, COLDSPOT_MAX_SHELL_DIST, 0);
      var segments = [];
      for (var spj = 0; spj < traced.path.length - 1; spj++) {
        segments.push({
          ax: traced.path[spj].x, az: traced.path[spj].z,
          bx: traced.path[spj+1].x, bz: traced.path[spj+1].z
        });
      }
      cachedShellPaths.push({
        x: sh.x, z: sh.z,
        speed: sh.speed,
        isPredicted: sh.isPredicted,
        isOwn: sh.isOwn,
        segments: segments
      });
    }

    // Time to nearest impact (for adaptive radius + sim time)
    var timeToNearestImpact = 1.0;
    for (var i = 0; i < realShells.length; i++) {
      var sh = realShells[i];
      var dist = Math.hypot(sh.x - me.x, sh.z - me.z);
      var t = dist / sh.speed;
      if (t < timeToNearestImpact) timeToNearestImpact = t;
    }

    var reactive = reactiveColdSpotScan(me, cachedShellPaths, timeToNearestImpact);
    var strategic = strategicColdSpotGrid(me, cachedShellPaths, enemies, now);

    // Merge reactive (65%) + strategic (35%)
    var mergedX = 0, mergedZ = 0;
    if (reactive.best) {
      var rx = reactive.best.x - me.x, rz = reactive.best.z - me.z;
      var rlen = Math.hypot(rx, rz);
      if (rlen > 0.01) { mergedX = (rx / rlen) * 0.65; mergedZ = (rz / rlen) * 0.65; }
    }
    if (strategic) {
      var sx = strategic.x - me.x, sz = strategic.z - me.z;
      var slen = Math.hypot(sx, sz);
      if (slen > 0.01) { mergedX += (sx / slen) * 0.35; mergedZ += (sz / slen) * 0.35; }
    }
    var mergedLen = Math.hypot(mergedX, mergedZ);
    if (mergedLen > 0.01) { mergedX /= mergedLen; mergedZ /= mergedLen; }

    // Dot-product guard: never move toward a shell's current position
    var guardViolated = false;
    for (var gi = 0; gi < allShells.length; gi++) {
      var shell = allShells[gi];
      var toShellX = shell.x - me.x, toShellZ = shell.z - me.z;
      var toShellLen = Math.hypot(toShellX, toShellZ);
      if (toShellLen < 1) continue;
      var toShellNx = toShellX / toShellLen, toShellNz = toShellZ / toShellLen;
      var dot = mergedX * toShellNx + mergedZ * toShellNz;
      if (dot > 0.2) {
        // Project out the toward-shell component
        mergedX = mergedX - dot * toShellNx;
        mergedZ = mergedZ - dot * toShellNz;
        guardViolated = true;
      }
    }
    mergedLen = Math.hypot(mergedX, mergedZ);
    if (mergedLen > 0.01) {
      mergedX /= mergedLen; mergedZ /= mergedLen;
    } else if (guardViolated) {
      // All directions point toward shells — fall back to 8-dir sim
      var fallback = sim8DirFallback(me, allShells, timeToNearestImpact);
      if (fallback) { mergedX = fallback.x; mergedZ = fallback.z; }
    }

    // AGGRESSIVE 8-dir sim fallback — if cold-spot found a safe direction but
    var reactiveScore = reactive.best ? reactive.best.score : 1.0;
    if (reactiveScore > 0.5 && allShells.length >= 3) {
      var aggressiveFallback = sim8DirFallback(me, allShells, timeToNearestImpact);
      if (aggressiveFallback && aggressiveFallback.hits === 0) {
        // 8-dir sim found a zero-hit direction — use it instead
        mergedX = aggressiveFallback.x;
        mergedZ = aggressiveFallback.z;
      }
    }

    // Velocity-aware bias (from v22.0). If player is moving TOWARD a shell's
    var myVel = getVel(me.id);
    var mySpeedNow = Math.hypot(myVel.vx, myVel.vz);
    if (mySpeedNow > 50) {
      var headingX = myVel.vx / mySpeedNow, headingZ = myVel.vz / mySpeedNow;
      // Check if moving toward any shell's path
      var movingTowardShell = false;
      for (var vci = 0; vci < allShells.length; vci++) {
        var vshell = allShells[vci];
        var vToShellX = vshell.x - me.x, vToShellZ = vshell.z - me.z;
        var vToShellLen = Math.hypot(vToShellX, vToShellZ);
        if (vToShellLen < 1) continue;
        var vToShellNx = vToShellX / vToShellLen, vToShellNz = vToShellZ / vToShellLen;
        var vApproachDot = headingX * vToShellNx + headingZ * vToShellNz;
        if (vApproachDot > 0.3) { movingTowardShell = true; break; }
      }
      if (movingTowardShell) {
        // Strong reverse bias — player is moving toward danger, reverse out
        var revX = -headingX, revZ = -headingZ;
        mergedX = mergedX * 0.5 + revX * 0.5;
        mergedZ = mergedZ * 0.5 + revZ * 0.5;
        var revLen = Math.hypot(mergedX, mergedZ);
        if (revLen > 0.01) { mergedX /= revLen; mergedZ /= revLen; }
      } else {
        // Normal heading bias — prefer moving in direction of current heading (avoids reverse penalty)
        var alignment = mergedX * headingX + mergedZ * headingZ;
        if (alignment > 0) {
          mergedX = mergedX * 0.7 + headingX * 0.3;
          mergedZ = mergedZ * 0.7 + headingZ * 0.3;
          var len = Math.hypot(mergedX, mergedZ);
          if (len > 0.01) { mergedX /= len; mergedZ /= len; }
        }
      }
    }

    // Max urgency from threats (for the existing arbiter to use)
    var maxUrg = 0;
    for (var ti = 0; ti < threats.length; ti++) {
      if (threats[ti].urgency > maxUrg) maxUrg = threats[ti].urgency;
    }

    // Telemetry expose
    window._wklDodgeDebug = {
      lastDodgeVec: {moveX: mergedX, moveZ: mergedZ, urgency: maxUrg},
      lastColdSpot: {
        reactive: reactive.best,
        strategic: strategic,
        merged: {x: mergedX, z: mergedZ},
      },
      lastThreats: threats,
      lastPredictedShells: predictedShells,
      shellCount: allShells.length,
      realShellCount: realShells.length,
      predictedShellCount: predictedShells.length,
      timeToNearestImpact: timeToNearestImpact,
      guardViolated: guardViolated,
    };

    return {moveX: mergedX, moveZ: mergedZ, urgency: maxUrg, threats: threats, source: 'coldspot'};
  }


  function computeDodge() {
    if (!cachedMe || !cachedView) return null;
    var me = cachedMe;
    if (me.fx==='stun') return null;
    var mySpeed = getMySpeed(me);
    // add cache age to shell extrapolation. cachedView's shell positions
    var cacheAge = lastViewRefreshT > 0 ? Math.max(0, (performance.now() - lastViewRefreshT) / 1000) : 0;
    var shellAge = _interpDelay/1000 + cfg.dodgeReactionMs/1000 + cacheAge;
    var myId = getMyId();
    var threats = [];
    var tiles = cachedTiles;

    var shells = cachedView.shells || [];
    for (var si=0; si<shells.length; si++) {
      var s=shells[si];
      // Don't include own shells in the main vector sum — they cancel
      var isOwnShell = String(s.o) === String(myId);
      var spd = getShellSpeed(s.id, s.type);  // dynamic speed detection
      var sAngle = getShellAngle(s.id);
      if (sAngle === null) continue;  // need angle to predict path
      var ex = s.x + Math.cos(sAngle)*spd*shellAge;
      var ez = s.z + Math.sin(sAngle)*spd*shellAge;
      var maxD = spd * cfg.dodgeHorizon;
      var traced = traceRicochet(ex, ez, Math.cos(sAngle)*spd, Math.sin(sAngle)*spd, cfg.dodgeBounces, maxD);

      var distT=0, best=null;
      for (var i=0; i<traced.path.length-1; i++) {
        var a=traced.path[i], b=traced.path[i+1];
        var sdx=b.x-a.x, sdz=b.z-a.z, slen2=sdx*sdx+sdz*sdz;
        if (slen2<1e-9) continue;
        var slen=Math.sqrt(slen2);
        var t=((me.x-a.x)*sdx+(me.z-a.z)*sdz)/slen2;
        t=t<0?0:t>1?1:t;
        var cx=a.x+sdx*t, cz=a.z+sdz*t;
        var dist=Math.hypot(cx-me.x, cz-me.z);
        if (!best || dist<best.dist) {
          best={dist:dist, tImpact:(distT+t*slen)/spd, segA:a, segB:b, segDx:sdx, segDz:sdz, segLen:slen, path:traced.path};
        }
        distT+=slen;
      }
      if (best && best.tImpact>=0 && best.tImpact<cfg.dodgeHorizon) {
        var nowMs = performance.now();
        var stunRemaining = Math.max(0, FIRE_STUN_MS - (nowMs - lastFireStunT));
        var effectiveT = Math.max(0, best.tImpact - stunRemaining/1000);
        var canMove = mySpeed * effectiveT;
        var stunPenalty = stunRemaining > 0 ? 0.3 : 0;
        
        // VELOCITY-AWARE DODGE — dot product between shell vector and tank velocity
        var myVel = getVel(me.id);
        var mySpeedNow = Math.hypot(myVel.vx, myVel.vz);
        var shellDirX = best.segDx / best.segLen, shellDirZ = best.segDz / best.segLen;
        var approachDot = 0;
        if (mySpeedNow > 1) {
          // Normalize my velocity
          var mvx = myVel.vx / mySpeedNow, mvz = myVel.vz / mySpeedNow;
          // Dot product: positive = moving toward shell's path, negative = moving away
          approachDot = mvx * shellDirX + mvz * shellDirZ;
        }
        // If moving toward the shell (dot > 0.3), boost urgency significantly
        var velocityPenalty = 0;
        if (approachDot > 0.3) {
          velocityPenalty = approachDot * 0.4;  // up to +0.4 urgency
        }
        
        if (best.dist < canMove+cfg.dodgeMargin+TANK_R) {
          var timeUrg = 1-Math.min(1,best.tImpact/0.5);
          var marginUrg = 1-Math.min(1,Math.max(0,(canMove+cfg.dodgeMargin+TANK_R)-best.dist)/200);
          var urg = Math.max(0.1, Math.max(timeUrg,marginUrg)) + stunPenalty + velocityPenalty;
          if (urg > 1) urg = 1;
          threats.push({type:'shell', approach:best, urgency:urg, stunRemaining: stunRemaining, approachDot: approachDot, isOwn: isOwnShell});
        }
      }
    }

    var mines = cachedView.mines || [];
    for (var mi=0; mi<mines.length; mi++) {
      var mine=mines[mi];
      var md=Math.hypot(mine.x-me.x, mine.z-me.z);
      if (!mine.e && md<cfg.dodgeMineSafeDist+TANK_R) {
        threats.push({type:'mine', x:mine.x, z:mine.z, dist:md, urgency:1-md/(cfg.dodgeMineSafeDist+TANK_R+30)});
      } else if (mine.e && md<cfg.dodgeBlastSafeDist) {
        threats.push({type:'blast', x:mine.x, z:mine.z, dist:md, currentR:mine.r||0, urgency:1-md/(cfg.dodgeBlastSafeDist+30)});
      }
    }

    lastThreats = threats;
    if (!threats.length) return null;

    // Cold-spot dodge for 2+ shell threats.
    var shellThreatCount = 0;
    var hasFastShell = false;
    for (var sti = 0; sti < threats.length; sti++) {
      if (threats[sti].type === 'shell') {
        shellThreatCount++;
        // check if any shell is a missile (speed > 500)
        if (threats[sti].approach) {
          var shellSpeed = 320;
          // The threat's approach has segDx/segDz/segLen — speed = segLen / (1/120) but we don't have that.
          // Instead, check the actual shell speed via getShellSpeed if we can find the shellId.
          // Simpler: check the shell type from cachedView shells matching this threat.
          // Even simpler: just always activate cold-spot for 2+ shells (original) + 1+ shells if any are fast.
        }
      }
    }
    // also scan cachedView shells directly for fast shell types
    var realShells = cachedView.shells || [];
    var myId = getMyId();
    for (var fsi = 0; fsi < realShells.length; fsi++) {
      var fs = realShells[fsi];
      var spd = getShellSpeed(fs.id, fs.type);
      if (spd > 500) { hasFastShell = true; break; }
    }
    // SIMULTANEOUS DODGE — vector dodge ALWAYS runs (immediate survival),

    // --- Step 1: Vector dodge (always runs) ---
    // The existing vector dodge code below computes gx, gz, dx, dz, maxUrg
    // and returns {moveX:dx, moveZ:dz, urgency:maxUrg, threats:threats}

    var gx=0, gz=0, maxUrg=0;
    // Get the tank's current velocity for the dot-product dodge bias
    var myVelDodge = getVel(me.id);
    var mySpeedDodge = Math.hypot(myVelDodge.vx, myVelDodge.vz);
    for (var ti=0; ti<threats.length; ti++) {
      var th=threats[ti], px=0, pz=0;
      var timeWeight = 1.0 / Math.max(0.1, th.approach ? th.approach.tImpact : 1.0);
      if (th.type==='shell') {
        var ap=th.approach;
        var cross=(me.x-ap.segA.x)*ap.segDz-(me.z-ap.segA.z)*ap.segDx;
        var crossMag=Math.abs(cross);
        var headOnThreshold=ap.segLen*50;
        var perpWeight=crossMag>headOnThreshold?0.85:0.3;
        var awayWeight=1-perpWeight;
        var sign=cross>=0?1:-1;
        if (crossMag<1e-6) {
          var wW=(cachedView.worldW||cachedView.mapW||1820)/2;
          var wH=(cachedView.worldH||cachedView.mapH||1400)/2;
          var refX=me.x-wW, refZ=me.z-wH;
          var p1X=-ap.segDz/ap.segLen, p1Z=ap.segDx/ap.segLen;
          sign=(p1X*refX+p1Z*refZ<0)?-1:1;
        }
        var perpX=-ap.segDz/ap.segLen*sign, perpZ=ap.segDx/ap.segLen*sign;
        var tpar=((me.x-ap.segA.x)*ap.segDx+(me.z-ap.segA.z)*ap.segDz)/(ap.segLen*ap.segLen);
        tpar=tpar<0?0:tpar>1?1:tpar;
        var awx=me.x-(ap.segA.x+ap.segDx*tpar), awz=me.z-(ap.segA.z+ap.segDz*tpar);
        var awlen=Math.hypot(awx,awz);
        if (awlen>1) { px=perpX*perpWeight+(awx/awlen)*awayWeight; pz=perpZ*perpWeight+(awz/awlen)*awayWeight; }
        else { px=perpX; pz=perpZ; }
        
        // REMOVED v22.0 velocity-aware bias from per-shell vector. It caused
      } else {
        var ddx=me.x-th.x, ddz=me.z-th.z, dd=Math.hypot(ddx,ddz);
        if (dd>0.1) { px=ddx/dd; pz=ddz/dd; }
      }
      // Reduce own-shell weight to 0.3x — own shells can cancel enemy
      var ownShellWeight = th.isOwn ? 0.3 : 1.0;
      var w=th.urgency*th.urgency*timeWeight*ownShellWeight;
      gx+=px*w; gz+=pz*w;
      if (th.urgency>maxUrg) maxUrg=th.urgency;
    }
    var glen=Math.hypot(gx,gz);
    if (glen<0.01) return null;
    var dx=gx/glen, dz=gz/glen;

    if (cfg.dodgeWallAware) {
      var look=TANK_R+30;
      var wW2=cachedView.worldW||cachedView.mapW||99999, wH2=cachedView.worldH||cachedView.mapH||99999;
      if (pointInTile(me.x+dx*look, me.z+dz*look, tiles, 5) ||
          me.x+dx*look<TANK_R || me.x+dx*look>wW2-TANK_R ||
          me.z+dz*look<TANK_R || me.z+dz*look>wH2-TANK_R) {
        var rots=[0.785,-0.785,1.57,-1.57,2.356,-2.356], bestR=null, bestScore=-Infinity;
        for (var ri=0; ri<rots.length; ri++) {
          var cr=Math.cos(rots[ri]), sr=Math.sin(rots[ri]);
          var rx2=dx*cr-dz*sr, rz2=dx*sr+dz*cr;
          var px2=me.x+rx2*look, pz2=me.z+rz2*look;
          if (!pointInTile(px2,pz2,tiles,5) && px2>TANK_R && px2<wW2-TANK_R && pz2>TANK_R && pz2<wH2-TANK_R) {
            var align=rx2*dx+rz2*dz;
            if (align>bestScore) { bestScore=align; bestR={x:rx2,z:rz2}; }
          }
        }
        if (bestR) { dx=bestR.x; dz=bestR.z; }
      }
    }

    // SIMULTANEOUS COLD-SPOT BIAS
    if ((shellThreatCount >= 2 || (shellThreatCount >= 1 && hasFastShell)) && shellThreatCount <= 5) {
      var coldResult = coldSpotDodge(me, threats, cacheAge);
      if (coldResult && coldResult.moveX !== undefined) {
        var coldDx = coldResult.moveX, coldDz = coldResult.moveZ;
        // Check if the cold-spot direction would cross any shell path within 300u
        var coldCrossesPath = false;
        var checkDist = 100;  // check 100u in the cold-spot direction
        var checkX = me.x + coldDx * checkDist;
        var checkZ = me.z + coldDz * checkDist;
        // Use the cached shell paths from coldSpotDodge (stored on window._wklDodgeDebug)
        var dodgeDb = window._wklDodgeDebug;
        if (dodgeDb && dodgeDb.lastColdSpot) {
          // We don't have direct access to cachedShellPaths here, so do a simple
          // check: does the cold-spot direction have a HIGH dot product with any
          // incoming shell's direction? If so, the cold-spot is pulling TOWARD
          // a shell's source, which is dangerous.
          var shells = cachedView.shells || [];
          var myId = getMyId();
          for (var csi = 0; csi < shells.length; csi++) {
            var cs = shells[csi];
            if (String(cs.o) === String(myId)) continue;  // skip own shells (reduced weight, not skip)
            var csAngle = getShellAngle(cs.id);
            if (csAngle === null) continue;
            var csDist = Math.hypot(cs.x - me.x, cs.z - me.z);
            if (csDist > 300) continue;  // distance filter
            // Shell direction
            var shellDirX = Math.cos(csAngle), shellDirZ = Math.sin(csAngle);
            // Dot product: if cold-spot direction aligns with shell direction (>0.5),
            // the cold-spot is pulling toward where the shell is GOING — dangerous
            var dot = coldDx * shellDirX + coldDz * shellDirZ;
            if (dot > 0.5) {
              coldCrossesPath = true;
              break;
            }
          }
        }
        if (!coldCrossesPath) {
          // Safe to blend: 75% vector dodge + 25% cold-spot bias
          dx = dx * 0.75 + coldDx * 0.25;
          dz = dz * 0.75 + coldDz * 0.25;
          var blendLen = Math.hypot(dx, dz);
          if (blendLen > 0.01) { dx /= blendLen; dz /= blendLen; }
        }
        // If coldCrossesPath: use 100% vector dodge (no cold-spot bias this frame)
      }
    }

    // PATH-SEGMENT GUARD — check if dodge direction CROSSES any shell's trajectory.
    // The old guard checked if dodge points toward shell POSITION. But shells MOVE
    // along paths. The dodge can avoid the shell's current position but still cross
    // the shell's trajectory LINE — causing the "magnetizing" bug.
    // FIX: Check if dodge direction (projected 100u forward) CROSSES any shell's
    // path segment. If it does, rotate in small steps (5°, 10°, 15°... up to 175°)
    // until finding a direction that doesn't cross any path. Full 360° resolution.
    var shells = cachedView.shells || [];
    var myId = F ? F.myId : String(getMyId());

    // Pre-compute shell path segments for guard check
    var guardPaths = [];
    for (var gpi = 0; gpi < shells.length; gpi++) {
      var gs = shells[gpi];
      if (String(gs.o) === String(myId)) continue;
      var gsDist = Math.hypot(gs.x - me.x, gs.z - me.z);
      if (gsDist > 400 || gsDist < 1) continue;
      var gsAngle = getShellAngle(gs.id);
      if (gsAngle === null) continue;
      var gsSpd = getShellSpeed(gs.id, gs.type);
      var gsTraced = traceRicochet(gs.x, gs.z, Math.cos(gsAngle)*gsSpd, Math.sin(gsAngle)*gsSpd, 1, 400, 0);
      for (var gpj = 0; gpj < gsTraced.path.length - 1; gpj++) {
        guardPaths.push({
          ax: gsTraced.path[gpj].x, az: gsTraced.path[gpj].z,
          bx: gsTraced.path[gpj+1].x, bz: gsTraced.path[gpj+1].z
        });
      }
    }

    // Check if current dodge direction crosses any shell path
    var checkDist = 100;
    var checkEndX = me.x + dx * checkDist;
    var checkEndZ = me.z + dz * checkDist;
    var crossCount = 0;
    for (var gci = 0; gci < guardPaths.length; gci++) {
      var gp = guardPaths[gci];
      if (segmentsIntersect(me.x, me.z, checkEndX, checkEndZ, gp.ax, gp.az, gp.bx, gp.bz)) {
        crossCount++;
      }
    }

    // If dodge crosses a path, rotate in small steps to find a safe direction
    if (crossCount > 0) {
      var bestRotX = dx, bestRotZ = dz;
      var bestRotCrosses = crossCount;
      for (var rotStep = 5; rotStep <= 175; rotStep += 5) {
        for (var rotDir = 0; rotDir < 2; rotDir++) {
          var rotRad = rotStep * Math.PI / 180 * (rotDir === 0 ? 1 : -1);
          var cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
          var rX = dx * cosR - dz * sinR, rZ = dx * sinR + dz * cosR;
          var rEndX = me.x + rX * checkDist, rEndZ = me.z + rZ * checkDist;
          var rCrosses = 0;
          for (var rci = 0; rci < guardPaths.length; rci++) {
            var rp = guardPaths[rci];
            if (segmentsIntersect(me.x, me.z, rEndX, rEndZ, rp.ax, rp.az, rp.bx, rp.bz)) rCrosses++;
          }
          if (rCrosses < bestRotCrosses) {
            bestRotCrosses = rCrosses;
            bestRotX = rX;
            bestRotZ = rZ;
            if (rCrosses === 0) break;
          }
        }
        if (bestRotCrosses === 0) break;
      }
      dx = bestRotX;
      dz = bestRotZ;
      var dlen = Math.hypot(dx, dz);
      if (dlen > 0.01) { dx /= dlen; dz /= dlen; }
    }

    // Telemetry expose for path-segment guard (bot fleet A/B verification)
    window._wklPathGuard = {
      shellsChecked: guardPaths.length,
      crossCount: crossCount,
      resolved: crossCount === 0
    };

    return {moveX:dx, moveZ:dz, urgency:maxUrg, threats:threats};
  }


  // ── Auto-continue ──
  if (typeof net.on === 'function') {
    net.on('events', function(events) {
      if (!cfg.enabled || !cfg.autoContinue) return;
      for (var i=0; i<events.length; i++) {
        if (events[i].type==='levelClear'||events[i].type==='campaignWon') {
          setTimeout(function(){ try { if(net.send) net.send({type:'restart'}); } catch(e){ void e; } }, 2000);
        }
      }
    });
  }

  // Skin bypass
  if (typeof net.connect === 'function') {
    var origConn = net.connect.bind(net);
    net.connect = function(roomId, name, key, skin) {
      if (cfg.skinBypass && LOCKED_SKINS.indexOf(cfg.skinBypass)>=0) skin=cfg.skinBypass;
      return origConn(roomId, name, key, skin);
    };
  }

  // ── Overlay ──
  var overlay = document.createElement('canvas');
  overlay.id  = 'wkl-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;';
  document.body.appendChild(overlay);
  var ctx = overlay.getContext('2d');

  function resizeOverlay() {
    var dpr=Math.min(window.devicePixelRatio||1,2);
    overlay.width  = Math.floor(window.innerWidth*dpr);
    overlay.height = Math.floor(window.innerHeight*dpr);
    overlay.style.width  = window.innerWidth+'px';
    overlay.style.height = window.innerHeight+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  resizeOverlay();
  window.addEventListener('resize', resizeOverlay);

  function w2s(x,y,z) {
    try { var p=R.project(x,y,z); return (p&&p.depth>6)?p:null; } catch(e){ void e; return null; }
  }

  function drawPath(path, color, alpha, lw) {
    if (!path || path.length<2) return;
    ctx.strokeStyle=color; ctx.globalAlpha=alpha; ctx.lineWidth=lw||1.5;
    ctx.beginPath();
    var f=w2s(path[0].x,8,path[0].z); if(!f){ctx.globalAlpha=1;return;}
    ctx.moveTo(f.x,f.y);
    for (var i=1; i<path.length; i++) {
      var p=w2s(path[i].x,8,path[i].z); if(!p) break;
      ctx.lineTo(p.x,p.y);
      if (i<path.length-1) {
        ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x,p.y);
        ctx.fillStyle=color; ctx.arc(p.x,p.y,3,0,TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(p.x,p.y);
      }
    }
    ctx.stroke(); ctx.globalAlpha=1;
  }

  // ── Solutions cache ──
  var cachedSolutions = [];
  var solLastT = 0;

  // ── MAIN RAF LOOP — single getView per frame, flicker-free ──
  var lastGridRebuildT = 0;
  var dodgeActive = false;
  var lastDodgeVec = null;
  var lastThreats = [];

  // Persistence buffers — keep last valid state for ~250ms to prevent flicker
  // when buildView() returns null during snapshot rotation or when aimbot search
  // temporarily fails to find a solution.
  var persistView = null;       // last valid cachedView
  var persistMe = null;         // last valid cachedMe
  var persistTiles = [];        // last valid tiles
  var persistEnemies = [];      // last valid enemies
  var persistViewT = 0;         // timestamp of last valid view
  var persistAimAngle = null;   // last valid aim_angle (kept for 150ms after null)
  var persistAimT = 0;          // timestamp of last valid aim
  var persistAimBounces = 0;
  var persistAimDist = 0;
  var persistAimHitProb = 0;
  var persistAimTargetId = null;
  var PERSIST_MS = 2000;

  function raf(now) {
    requestAnimationFrame(raf);
    try {
      rafBody(now);
    } catch(e) {
      // Log but DON'T let the error kill the RAF chain
      console.error('[wkl] raf error (recovered):', e);
    }
  }

  function rafBody(now) {
    if (!cfg.enabled) { ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); return; }

    // Try to refresh view cache
    refreshViewCache();

    // Use fresh view if available, otherwise fall back to persisted (for up to PERSIST_MS)
    var view, me, tiles, enemies;
    if (cachedView && cachedMe && !cachedMe.dead) {
      persistView = cachedView;
      persistMe = cachedMe;
      persistTiles = cachedTiles;
      persistEnemies = cachedEnemies;
      persistViewT = now;
      view = cachedView; me = cachedMe; tiles = cachedTiles; enemies = cachedEnemies;
    } else if (persistView && (now - persistViewT) < PERSIST_MS) {
      // Use persisted data — prevents flicker during brief view cache gaps
      view = persistView; me = persistMe; tiles = persistTiles; enemies = persistEnemies;
    } else {
      // No fresh data and persist expired — DON'T clear, just skip.
      // Keeps last frame visible instead of flashing off/on.
      return;
    }

    if (!me) {
      // No player data — skip drawing, keep last frame
      return;
    }

    // NOW clear and redraw — this prevents the "clear then no data = empty frame" flicker.
    // If we get here, we have valid data to draw, so clearing is safe.
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // Update velocity tracker (use fresh view only, not persisted — otherwise we'd track stale positions)
    if (cachedView && cachedMe) {
      updateVelTrack(cachedView.tanks, now);
      if (cachedView.shells) updateShellSpeedTrack(cachedView.shells, now);
    }

    // Rebuild spatial grid if tiles changed (throttled, but build immediately on first frame)
    if (now - lastGridRebuildT > 1000 || (grid.length === 0 && tiles.length > 0)) {
      lastGridRebuildT = now;
      try {
        rebuildGrid(tiles);
      } catch(e) { void e; }
    }

    // Run aimbot search on throttle (only with fresh data)
    if (cachedView && cachedMe && !cachedMe.dead && now - aim_lastSearchT > cfg.aimThrottleMs) {
      aim_lastSearchT = now;
      runAimbotSearch();
      // Persist aim state
      if (aim_angle !== null) {
        persistAimAngle = aim_angle;
        persistAimT = now;
        persistAimBounces = aim_bounces;
        persistAimDist = aim_dist;
        persistAimHitProb = aim_hitProb;
        persistAimTargetId = aim_targetId;
      }
    }

    // If aim_angle is null but we have a recent persisted aim, use it (prevents flicker)
    var drawAimAngle = aim_angle;
    var drawAimBounces = aim_bounces;
    var drawAimDist = aim_dist;
    var drawAimHitProb = aim_hitProb;
    var drawAimTargetId = aim_targetId;
    if (drawAimAngle === null && persistAimAngle !== null && (now - persistAimT) < 150) {
      drawAimAngle = persistAimAngle;
      drawAimBounces = persistAimBounces;
      drawAimDist = persistAimDist;
      drawAimHitProb = persistAimHitProb;
      drawAimTargetId = persistAimTargetId;
    } else if (drawAimAngle === null) {
      persistAimAngle = null;
    }

    // Run dodge compute every frame (only with fresh data)
    if (cfg.autoDodge && cachedView && cachedMe) {
      var dg = computeDodge();
      dodgeActive = !!dg;
      lastDodgeVec = dg;
    } else if (!cfg.autoDodge) {
      dodgeActive = false; lastDodgeVec = null;
    }

    // Draw — pass the resolved view/me/tiles/enemies and the flicker-safe aim state
    if (cfg.solutions) drawSolutions(now, me, tiles, enemies);
    if (cfg.tracer) drawTracer(me, tiles, view);
    drawESP(view, me, enemies, drawAimAngle, drawAimTargetId);
    drawThreats(me);
    drawHUD(me, drawAimAngle, drawAimBounces, drawAimDist, drawAimHitProb);
  }
  requestAnimationFrame(raf);

  // Tracer cache — only recompute when turret angle changes by >0.02 rad
  var tracerCache = null;
  var tracerCacheAngle = -999;
  var tracerCacheMeX = 0, tracerCacheMeZ = 0;
  var TRACER_ANGLE_THRESHOLD = 0.02;  // ~1.1 degrees

  function drawTracer(me, tiles, view) {
    var aim = me.turretAngle != null ? me.turretAngle : 0;
    // Only recompute if turret moved significantly or player moved significantly
    var angleChanged = Math.abs(aim - tracerCacheAngle) > TRACER_ANGLE_THRESHOLD;
    var posChanged = Math.hypot(me.x - tracerCacheMeX, me.z - tracerCacheMeZ) > 15;
    if (!tracerCache || angleChanged || posChanged) {
      tracerCache = traceRicochet(me.x, me.z, Math.cos(aim), Math.sin(aim), cfg.maxBounces, cfg.maxShotDist, SHELL_R);
      tracerCacheAngle = aim;
      tracerCacheMeX = me.x; tracerCacheMeZ = me.z;
    }
    var r = tracerCache;
    var hit = false;
    for (var i = 0; i < view.tanks.length; i++) {
      var t = view.tanks[i];
      if (!t.isLocal && !t.dead && pathHitsRect(r.path, t.x, t.z)) { hit = true; break; }
    }
    drawPath(r.path, hit ? '#7fff5a' : '#3dd6ff', 0.85, 2);
  }

  function drawSolutions(now, me, tiles, enemies) {
    if (enemies.length === 0) return;
    if (now - solLastT > cfg.solThrottleMs) {
      solLastT = now;
      cachedSolutions = [];
      var tgt = enemies[0];
      for (var k = 1; k < enemies.length; k++) {
        if (Math.hypot(enemies[k].x - me.x, enemies[k].z - me.z) <
            Math.hypot(tgt.x - me.x, tgt.z - me.z)) tgt = enemies[k];
      }
      var sols = [], seen = {}, stepRad = cfg.searchStepDeg * Math.PI / 180;  // same step as aimbot
      for (var rad = 0; rad < TAU; rad += stepRad) {
        var r = traceRicochet(me.x, me.z, Math.cos(rad), Math.sin(rad), cfg.maxBounces, cfg.maxShotDist, SHELL_R);
        if (pathHitsRect(r.path, tgt.x, tgt.z)) {
          var key = Math.round(rad / (5 * Math.PI / 180)) * 5 + '_' + r.bounces;
          if (!seen[key]) { seen[key] = 1; sols.push({ angle: rad, totalDist: r.totalDist, bounces: r.bounces, path: r.path }); }
        }
      }
      sols.sort(function (a, b) { return a.totalDist - b.totalDist; });
      if (sols.length) cachedSolutions.push({ target: tgt, solutions: sols.slice(0, 3) });
    }
    var COLORS = ['#7fff5a', '#ffe05a', '#ff9b3b', '#ff5a3b'];
    for (var ci = 0; ci < cachedSolutions.length; ci++) {
      var entry = cachedSolutions[ci];
      for (var i = 0; i < entry.solutions.length; i++) {
        var sol = entry.solutions[i];
        drawPath(sol.path, COLORS[Math.min(sol.bounces, COLORS.length - 1)], i === 0 ? 0.7 : 0.3, i === 0 ? 1.8 : 1.2);
      }
    }
  }

  function drawESP(view, me, enemies, lockedAimAngle, lockedTargetId) {
    ctx.font = '11px monospace'; ctx.textBaseline = 'top';
    var shells = view.shells || [], mines = view.mines || [], pickups = view.pickups || [], myId = getMyId();

    // Pickups — small diamonds
    if (cfg.espPickups) {
      for (var pi = 0; pi < pickups.length; pi++) {
        var p = pickups[pi], ps = w2s(p.x, 22, p.z); if (!ps) continue;
        var pc = PICKUP_COLORS[p.kind] || '#fff';
        ctx.strokeStyle = pc; ctx.fillStyle = pc + '40'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ps.x, ps.y - 8); ctx.lineTo(ps.x + 8, ps.y); ctx.lineTo(ps.x, ps.y + 8); ctx.lineTo(ps.x - 8, ps.y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = pc; ctx.fillText(p.kind.toUpperCase(), ps.x - 14, ps.y - 22);
      }
    }

    // Mines — orange circles, red when exploding
    if (cfg.espMines) {
      for (var mi = 0; mi < mines.length; mi++) {
        var mn = mines[mi], ms = w2s(mn.x, 4, mn.z); if (!ms) continue;
        var mr = mn.e ? Math.max(20, (mn.r || 0) * 0.4) : 8;
        ctx.strokeStyle = mn.e ? '#ff3b3b' : '#ff8800'; ctx.fillStyle = (mn.e ? '#ff3b3b' : '#ff8800') + '30';
        ctx.lineWidth = mn.e ? 2 : 1;
        ctx.beginPath(); ctx.arc(ms.x, ms.y, mr, 0, TAU); ctx.fill(); ctx.stroke();
        if (mn.e) { ctx.fillStyle = '#ff3b3b'; ctx.fillText('MINE!', ms.x - 14, ms.y - mr - 14); }
      }
    }

    // Incoming shells — red dashed tracer
    if (cfg.espShells) {
      for (var si = 0; si < shells.length; si++) {
        var sh = shells[si];
        if (String(sh.o) === String(myId)) continue;
        var ss = w2s(sh.x, 9, sh.z); if (!ss) continue;
        var spd2 = getShellSpeed(sh.id, sh.type);  // dynamic speed detection
        var shAngle = getShellAngle(sh.id);
        if (shAngle === null) continue;
        var ux2 = Math.cos(shAngle) * spd2, uz2 = Math.sin(shAngle) * spd2;
        var rx = sh.x - me.x, rz = sh.z - me.z;
        var tStar = -(ux2 * rx + uz2 * rz) / (ux2 * ux2 + uz2 * uz2);
        if (tStar > 0 && tStar < 1.2) {
          var dist2 = Math.hypot(sh.x + ux2 * tStar - me.x, sh.z + uz2 * tStar - me.z);
          if (dist2 < 60) {
            ctx.strokeStyle = '#ff0040'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(ss.x, ss.y);
            var mes = w2s(me.x, 9, me.z); if (mes) ctx.lineTo(mes.x, mes.y);
            ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = '#ff0040'; ctx.fillText('INCOMING', ss.x + 6, ss.y - 14);
          }
        }
      }
    }

    // Tanks — clean ESP boxes. LOCKED target gets a distinct bright reticle.
    if (cfg.espTanks) {
      for (var ti = 0; ti < view.tanks.length; ti++) {
        var tnk = view.tanks[ti];
        if (tnk.isLocal || tnk.dead) continue;
        var top2 = w2s(tnk.x, 22, tnk.z), bot2 = w2s(tnk.x, 0, tnk.z); if (!top2 || !bot2) continue;
        var hostile = isHostile(tnk, me), invis = !!tnk.invisible, sp = !!tnk.spawnProtect;
        var isLocked = lockedTargetId !== null && String(tnk.id) === String(lockedTargetId);

        // Color: locked = bright cyan, invisible = red, spawn = green, ally = blue, enemy = yellow
        var color, label;
        if (isLocked)            { color = '#00ffff'; label = 'TARGET'; }
        else if (invis)          { color = '#ff3b3b'; label = 'INVIS'; }
        else if (sp)             { color = '#3bff7a'; label = 'SPAWN'; }
        else if (!hostile)       { color = '#3b9bff'; label = 'ALLY'; }
        else                     { color = '#ffd83b'; label = 'ENEMY'; }

        var bx2 = (top2.x + bot2.x) / 2, boxH = Math.max(18, bot2.y - top2.y);
        var boxW = Math.max(10, boxH * 0.55), left = bx2 - boxW / 2, topY = top2.y - boxH * 0.1;

        // Box — thicker + glowing for locked target
        ctx.strokeStyle = color;
        ctx.lineWidth = isLocked ? 2.5 : 1.5;
        if (isLocked) { ctx.shadowColor = color; ctx.shadowBlur = 8; }
        ctx.strokeRect(left, topY, boxW, boxH);
        ctx.shadowBlur = 0;

        // Locked target gets corner brackets + crosshair for clarity
        if (isLocked) {
          var bracketLen = boxW * 0.3;
          ctx.lineWidth = 2.5;
          // Top-left bracket
          ctx.beginPath();
          ctx.moveTo(left, topY + bracketLen); ctx.lineTo(left, topY); ctx.lineTo(left + bracketLen, topY);
          // Top-right
          ctx.moveTo(left + boxW - bracketLen, topY); ctx.lineTo(left + boxW, topY); ctx.lineTo(left + boxW, topY + bracketLen);
          // Bottom-left
          ctx.moveTo(left, topY + boxH - bracketLen); ctx.lineTo(left, topY + boxH); ctx.lineTo(left + bracketLen, topY + boxH);
          // Bottom-right
          ctx.moveTo(left + boxW - bracketLen, topY + boxH); ctx.lineTo(left + boxW, topY + boxH); ctx.lineTo(left + boxW, topY + boxH - bracketLen);
          ctx.stroke();
        }

        ctx.fillStyle = color; ctx.fillText(label, left, topY - 14);

        if (cfg.espDistance && hostile) {
          var d2 = Math.hypot(tnk.x - me.x, tnk.z - me.z);
          ctx.fillStyle = '#fff'; ctx.fillText(Math.round(d2) + 'u', left, topY + boxH + 2);
        }

        if (cfg.espHealth && typeof tnk.health === 'number' && tnk.maxHealth > 0) {
          var ratio = Math.max(0, Math.min(1, tnk.health / tnk.maxHealth));
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(left - 2, topY - 6, boxW + 4, 3);
          ctx.fillStyle = ratio > 0.5 ? '#7fdf5a' : ratio > 0.25 ? '#ffcc3b' : '#ff5a3b';
          ctx.fillRect(left - 2, topY - 6, (boxW + 4) * ratio, 3);
        }
      }
    }

    // Aim direction indicator — small dot at the aim point (not a long line — less clutter)
    if (cfg.aimbot && lockedAimAngle !== null) {
      var meS = w2s(me.x, 22, me.z);
      if (meS) {
        var ex = meS.x + Math.cos(lockedAimAngle) * 50, ey = meS.y + Math.sin(lockedAimAngle) * 50;
        ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(meS.x, meS.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(ex, ey, 4, 0, TAU); ctx.fill();
      }
    }
  }

  function drawThreats(me) {
    if (!cfg.dodgeThreatViz) return;
    for (var i=0; i<lastThreats.length; i++) {
      var th=lastThreats[i];
      if (th.type==='shell' && th.approach.path) {
        var col=th.urgency>0.6?'#ff0040':th.urgency>0.3?'#ff8800':'#ffcc3b';
        ctx.strokeStyle=col; ctx.globalAlpha=0.65; ctx.lineWidth=2; ctx.setLineDash([6,4]);
        ctx.beginPath();
        var f=w2s(th.approach.path[0].x,9,th.approach.path[0].z); if(f) ctx.moveTo(f.x,f.y);
        for (var j=1; j<th.approach.path.length; j++) {
          var p=w2s(th.approach.path[j].x,9,th.approach.path[j].z); if(p&&f) ctx.lineTo(p.x,p.y);
        }
        ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha=1;
        ctx.fillStyle=col; ctx.font='10px monospace';
        var ip=w2s(th.approach.segA.x,9,th.approach.segA.z);
        if(ip) ctx.fillText('T-'+th.approach.tImpact.toFixed(2)+'s',ip.x+6,ip.y-6);
      } else if (th.type==='mine') {
        var mp=w2s(th.x,4,th.z); if(!mp) continue;
        ctx.strokeStyle='#ffcc3b'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(mp.x,mp.y,18,0,TAU); ctx.stroke();
      } else if (th.type==='blast') {
        var bp=w2s(th.x,4,th.z); if(!bp) continue;
        ctx.strokeStyle='#ff0040'; ctx.fillStyle='rgba(255,0,64,0.15)'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(bp.x,bp.y,Math.max(20,(th.currentR||0)*0.5),0,TAU);
        ctx.fill(); ctx.stroke();
      }
    }
    if (cfg.dodgeVectorViz && lastDodgeVec) {
      var meS2=w2s(me.x,22,me.z); if(!meS2) return;
      var len=50+lastDodgeVec.urgency*80;
      var ex2=meS2.x+lastDodgeVec.moveX*len, ey2=meS2.y+lastDodgeVec.moveZ*len;
      ctx.strokeStyle='#7fff5a'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(meS2.x,meS2.y); ctx.lineTo(ex2,ey2); ctx.stroke();
      var ang=Math.atan2(ey2-meS2.y,ex2-meS2.x);
      ctx.fillStyle='#7fff5a'; ctx.beginPath();
      ctx.moveTo(ex2,ey2);
      ctx.lineTo(ex2-10*Math.cos(ang-0.4),ey2-10*Math.sin(ang-0.4));
      ctx.lineTo(ex2-10*Math.cos(ang+0.4),ey2-10*Math.sin(ang+0.4));
      ctx.closePath(); ctx.fill();
    }
  }

  function drawHUD(me, drawAim, drawBounces, drawDist, drawHitProb) {
    ctx.font='12px monospace'; ctx.textBaseline='top';
    var y=55;

    // Profile badge — clean, prominent
    ctx.fillStyle='rgba(10,14,24,0.85)'; ctx.fillRect(12,y-4,260,22);
    ctx.fillStyle='#7fd0ff'; ctx.font='bold 12px monospace';
    ctx.fillText('● '+cfg.activeProfile,16,y);
    ctx.font='10px monospace'; ctx.fillStyle='#666';
    ctx.fillText('F9=menu  1-5=profile  `=diag',16,y+11);
    y+=26;

    // Aim status — only show if aimbot enabled
    if (cfg.aimbot) {
      if (drawAim !== null) {
        var probPct = Math.round(drawHitProb * 100);
        var willFire = drawHitProb >= cfg.minHitProb;
        var probColor = willFire ? '#7fff5a' : (drawHitProb >= 0.2 ? '#ffcc3b' : '#ff5a3b');

        // Compact aim line: bounces, distance, shells
        ctx.fillStyle='#ff4060'; ctx.font='bold 12px monospace';
        var shellsInFlight = F ? F.myShellCount : myShellsInFlight();
        var fired = shellsFiredAt(aim_targetId);
        var _hudTgt = currentTargetRef;
        var maxFired = _hudTgt ? maxShellsForTarget(_hudTgt, drawHitProb) : '?';
        var aimStr = '◉ TARGET '+drawBounces+'B '+Math.round(drawDist)+'u  shells '+shellsInFlight+'/'+SHELL_CAP+'  fired:'+fired+'/'+maxFired;
        ctx.fillText(aimStr, 16, y); y+=15;

        // Hit probability with clear visual indicator
        ctx.fillStyle = probColor;
        ctx.font='11px monospace';
        var fireStr = willFire ? ('✓ FIRING '+probPct+'%') : ('○ holding '+probPct+'%');
        ctx.fillText('  '+fireStr, 16, y); y+=15;
      } else {
        ctx.fillStyle='#666'; ctx.font='11px monospace';
        ctx.fillText('◎ searching for target...', 16, y); y+=15;
      }
    }

    // Dodge status — only show if active
    if (dodgeActive && lastDodgeVec) {
      var sT=0,mT=0,bT=0;
      for(var i=0;i<lastThreats.length;i++){
        if(lastThreats[i].type==='shell')sT++;
        else if(lastThreats[i].type==='mine')mT++;
        else bT++;
      }
      ctx.fillStyle='#ff8800'; ctx.font='bold 11px monospace';
      ctx.fillText('⚡ DODGE '+sT+' shells, '+mT+' mines, '+bT+' blasts', 16, y);
    }

    // Bottom-right: minimal help (no technical junk)
    ctx.fillStyle='#444'; ctx.font='10px monospace';
    // removed dead lastDeathCause HUD code (detectDeathCause was never called)
    ctx.fillStyle='#444';
    ctx.fillText('F8=on/off  F9=menu', 16, window.innerHeight-20);
  }

  // ── Menu ──
  var menu = document.createElement('div');
  menu.id  = 'wkl-menu';
  menu.style.cssText = 'position:fixed;top:50px;right:20px;z-index:100000;'
    + 'background:rgba(10,14,24,0.97);color:#e6e9ef;font:12px/1.6 monospace;'
    + 'padding:14px 16px;border:1px solid #2a3550;border-radius:8px;'
    + 'min-width:300px;max-height:88vh;overflow-y:auto;display:none;'
    + 'user-select:none;box-shadow:0 8px 40px rgba(0,0,0,0.7)';
  document.body.appendChild(menu);

  function mHeader(text) {
    var h=document.createElement('div');
    h.textContent=text;
    h.style.cssText='color:#7fd0ff;font-weight:bold;margin:10px 0 4px;'
      +'border-bottom:1px solid #2a3550;padding-bottom:3px;font-size:11px;letter-spacing:0.5px';
    menu.appendChild(h);
  }
  function mRow(label, getter, setter) {
    var r=document.createElement('div');
    r.style.cssText='display:flex;justify-content:space-between;align-items:center;padding:2px 0;gap:8px';
    var l=document.createElement('span'); l.textContent=label; l.style.opacity='0.85';
    var c=document.createElement('input'); c.type='checkbox'; c.checked=!!getter(); c.style.cursor='pointer';
    c.onchange=function(){setter(c.checked); buildMenu();};
    r.appendChild(l); r.appendChild(c); menu.appendChild(r);
  }
  function mNum(label, getter, setter, step, min, max) {
    var r=document.createElement('div');
    r.style.cssText='display:flex;justify-content:space-between;align-items:center;padding:2px 0;gap:8px';
    var l=document.createElement('span'); l.textContent=label;
    var c=document.createElement('input'); c.type='number'; c.step=step||1; c.value=getter();
    if(min!=null)c.min=min; if(max!=null)c.max=max;
    c.style.cssText='width:72px;background:#0d1320;color:#e6e9ef;border:1px solid #2a3550;padding:2px 4px;border-radius:3px;font:11px monospace';
    c.onchange=function(){setter(parseFloat(c.value));};
    r.appendChild(l); r.appendChild(c); menu.appendChild(r);
  }
  function mSelect(label, getter, setter, options) {
    var r=document.createElement('div');
    r.style.cssText='display:flex;justify-content:space-between;align-items:center;padding:2px 0;gap:8px';
    var l=document.createElement('span'); l.textContent=label;
    var c=document.createElement('select');
    c.style.cssText='width:130px;background:#0d1320;color:#e6e9ef;border:1px solid #2a3550;padding:2px 4px;border-radius:3px;font:11px monospace';
    for(var i=0;i<options.length;i++){
      var o=document.createElement('option'); o.value=options[i]; o.textContent=options[i];
      if(options[i]===getter()) o.selected=true; c.appendChild(o);
    }
    c.onchange=function(){setter(c.value);};
    r.appendChild(l); r.appendChild(c); menu.appendChild(r);
  }
  function mBtn(label, color, onClick) {
    var b=document.createElement('button');
    b.textContent=label;
    b.style.cssText='width:100%;margin:3px 0;padding:5px;background:'+color+'22;color:'+color+';'
      +'border:1px solid '+color+'55;border-radius:4px;cursor:pointer;font:11px monospace';
    b.onmouseenter=function(){b.style.background=color+'44';};
    b.onmouseleave=function(){b.style.background=color+'22';};
    b.onclick=onClick;
    menu.appendChild(b);
  }
  function mDivider() {
    var d=document.createElement('div');
    d.style.cssText='height:1px;background:#1a2235;margin:6px 0';
    menu.appendChild(d);
  }

  function buildMenu() {
    menu.innerHTML='';
    var title=document.createElement('div');
    title.style.cssText='text-align:center;color:#7fd0ff;font-size:13px;font-weight:bold;margin-bottom:10px;letter-spacing:1px';
    title.textContent='WANKLE v25';
    menu.appendChild(title);
    mRow('Master Enable', function(){return cfg.enabled;}, function(v){cfg.enabled=v;});
    mDivider();

    mHeader('PROFILES  (keys 1-5)');
    var pnames=Object.keys(PROFILES);
    for(var pi=0;pi<pnames.length;pi++){
      (function(name,idx){
        var active=cfg.activeProfile===name;
        var row=document.createElement('div');
        row.style.cssText='display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;'
          +'border-radius:4px;'+(active?'background:#7fd0ff18':'');
        var badge=document.createElement('span');
        badge.style.cssText='font-weight:bold;color:'+(active?'#7fd0ff':'#444');
        badge.textContent=(idx+1)+'.';
        var info=document.createElement('span');
        info.style.cssText='flex:1;font-size:11px';
        info.innerHTML='<b style="color:'+(active?'#7fd0ff':'#aaa')+'">'+name+'</b>'
          +' <span style="color:#555;font-size:10px">'+PROFILES[name].desc+'</span>';
        row.appendChild(badge); row.appendChild(info);
        row.onclick=function(){applyProfile(name); buildMenu(); showBanner('Profile: '+name,'#7fd0ff');};
        menu.appendChild(row);
      })(pnames[pi],pi);
    }
    mDivider();

    mHeader('AIMBOT  (1-bounce default - bump maxBounces if you have ricochet)');
    mRow('Enabled', function(){return cfg.aimbot;}, function(v){cfg.aimbot=v;});
    if(cfg.aimbot){
      mRow('Triggerbot (auto-fire)', function(){return cfg.triggerbot;}, function(v){cfg.triggerbot=v;});
      mNum('Trigger window (rad)', function(){return cfg.triggerAngle;}, function(v){cfg.triggerAngle=v;}, 0.01, 0.01, 0.5);
      mNum('Fire cooldown (ms)', function(){return cfg.fireCooldownMs;}, function(v){cfg.fireCooldownMs=Math.max(0,v);}, 10, 0, 1000);
      mNum('Min hit prob (0-1)', function(){return cfg.minHitProb;}, function(v){cfg.minHitProb=Math.max(0,Math.min(1,v));}, 0.05, 0, 1);
      mNum('Max bounces', function(){return cfg.maxBounces;}, function(v){cfg.maxBounces=Math.round(Math.max(0,Math.min(5,v)));}, 1, 0, 5);
      mNum('Search step (deg)', function(){return cfg.searchStepDeg;}, function(v){cfg.searchStepDeg=Math.max(0.5,v);}, 0.25, 0.5, 5);
      mNum('Update rate (ms)', function(){return cfg.aimThrottleMs;}, function(v){cfg.aimThrottleMs=Math.max(30,v);}, 10, 30, 500);
      mNum('Smooth (0=snap,1=slow)', function(){return cfg.aimSmooth;}, function(v){cfg.aimSmooth=Math.max(0,Math.min(0.99,v));}, 0.05, 0, 0.99);
    }
    mDivider();

    mHeader('AUTO-DODGE');
    mRow('Enabled', function(){return cfg.autoDodge;}, function(v){cfg.autoDodge=v;});
    if(cfg.autoDodge){
      mNum('Strength', function(){return cfg.dodgeStrength;}, function(v){cfg.dodgeStrength=Math.max(0,Math.min(1,v));}, 0.1, 0, 1);
      mNum('Horizon (s)', function(){return cfg.dodgeHorizon;}, function(v){cfg.dodgeHorizon=v;}, 0.1, 0.5, 3);
      mRow('Wall-aware', function(){return cfg.dodgeWallAware;}, function(v){cfg.dodgeWallAware=v;});
      mRow('Threat lines', function(){return cfg.dodgeThreatViz;}, function(v){cfg.dodgeThreatViz=v;});
      mRow('Dodge arrow', function(){return cfg.dodgeVectorViz;}, function(v){cfg.dodgeVectorViz=v;});
    }
    mDivider();

    mHeader('ESP / WALLHACK');
    mRow('Tank boxes', function(){return cfg.espTanks;}, function(v){cfg.espTanks=v;});
    mRow('Health bars', function(){return cfg.espHealth;}, function(v){cfg.espHealth=v;});
    mRow('Distance', function(){return cfg.espDistance;}, function(v){cfg.espDistance=v;});
    mRow('Incoming shells', function(){return cfg.espShells;}, function(v){cfg.espShells=v;});
    mRow('Mines', function(){return cfg.espMines;}, function(v){cfg.espMines=v;});
    mRow('Pickups', function(){return cfg.espPickups;}, function(v){cfg.espPickups=v;});
    mRow('Shot tracer', function(){return cfg.tracer;}, function(v){cfg.tracer=v;});
    mRow('Bank shot lines', function(){return cfg.solutions;}, function(v){cfg.solutions=v;});
    mDivider();

    mHeader('UTILITY');
    mRow('Auto-respawn', function(){return cfg.autoRespawn;}, function(v){cfg.autoRespawn=v;});
    mRow('Auto-continue', function(){return cfg.autoContinue;}, function(v){cfg.autoContinue=v;});
    mSelect('Skin bypass', function(){return cfg.skinBypass||'off';}, function(v){cfg.skinBypass=v==='off'?'':v;}, ['off'].concat(LOCKED_SKINS));
    mDivider();

    mHeader('TARGETING');
    mRow('Ignore spawn-prot', function(){return cfg.ignoreSpawnProt;}, function(v){cfg.ignoreSpawnProt=v;});
    mRow('Ignore dead', function(){return cfg.ignoreDead;}, function(v){cfg.ignoreDead=v;});
    mRow('Ignore bots', function(){return cfg.ignoreBots;}, function(v){cfg.ignoreBots=v;});
    mDivider();

    mHeader('DEFENSE');
    mRow('Shell interceptor', function(){return cfg.shellIntercept;}, function(v){cfg.shellIntercept=v;}, 'Shoots down incoming shells within range');
    if (cfg.shellIntercept) {
      mNum('Intercept range', function(){return cfg.interceptRange;}, function(v){cfg.interceptRange=Math.max(50,v);}, 10, 50, 500);
      mNum('Intercept angle (rad)', function(){return cfg.interceptAngle;}, function(v){cfg.interceptAngle=Math.max(0.05,v);}, 0.01, 0.05, 0.5);
    }
    mRow('Self-ricochet safety', function(){return cfg.selfRicochetSafety;}, function(v){cfg.selfRicochetSafety=v;}, 'Blocks shots that would bounce back and hit you');
    if (cfg.selfRicochetSafety) {
      mNum('Self-hit radius', function(){return cfg.selfRicochetRadius;}, function(v){cfg.selfRicochetRadius=Math.max(15,v);}, 5, 15, 100);
    }
    mNum('Reserve shells', function(){return cfg.reserveShells;}, function(v){cfg.reserveShells=Math.max(0,Math.min(4,v));}, 1, 0, 4);
    mRow('Lethal shot priority', function(){return cfg.lethalPriority;}, function(v){cfg.lethalPriority=v;}, 'Fires on 1-HP enemies even if dangerous');
    mDivider();

    mHeader('DIAGNOSTICS');
    mBtn('Run diagnostic (`)', '#ffcc3b', runDiag);
    mBtn('Close menu (F9)', '#7fd0ff', function(){cfg.menuOpen=false;menu.style.display='none';});
  }
  buildMenu();

  function runDiag() {
    console.log('%c[wkl v25] DIAGNOSTIC', 'color:#7fd0ff;font-weight:bold');
    console.log('net keys:', Object.keys(net));
    console.log('buildView:', discovered.name, '| sendInput:', _sendName, '| pid:', _pidField, '=', getMyId());
    console.log('interpDelay:', _interpDelay, 'ms');
    console.log('cachedView:', cachedView ? 'OK' : 'null');
    if (cachedView) {
      console.log('view keys:', Object.keys(cachedView));
      console.log('tanks:', cachedView.tanks.length, 'enemies:', cachedEnemies.length);
      console.log('shells:', (cachedView.shells||[]).length, 'myShells:', myShellsInFlight()+'/'+SHELL_CAP);
      console.log('tiles:', cachedTiles.length, 'grid:', gridCols+'x'+gridRows);
      if (cachedMe) console.log('me:', cachedMe);
    }
    showBanner('Diagnostic dumped to F12 console', '#ffcc3b');
  }

  // ── Hotkeys ──
  window.addEventListener('keydown', function(e) {
    // Don't interfere if user is typing in an input
    if (e.target && e.target.matches && e.target.matches('input, select, textarea')) return;

    var pkeys = ['Digit1','Digit2','Digit3','Digit4','Digit5'];
    var pnames = ['Rage','Legit','Safe','Ghost','ESP Only'];
    for (var i=0; i<pkeys.length; i++) {
      if (e.code===pkeys[i] || e.code==='Numpad'+(i+1)) {
        applyProfile(pnames[i]); buildMenu();
        showBanner('Profile: '+pnames[i], '#7fd0ff');
        return;
      }
    }

    if (e.code==='Backquote') { e.preventDefault(); runDiag(); }  // ` key
    if (e.code==='F8') {
      e.preventDefault();
      cfg.enabled=!cfg.enabled;
      showBanner('Wankle v25: '+(cfg.enabled?'ON':'OFF'), cfg.enabled?'#7fd0ff':'#ff5a3b');
    }
    if (e.code==='F9') {
      e.preventDefault();
      cfg.menuOpen=!cfg.menuOpen;
      menu.style.display=cfg.menuOpen?'block':'none';
    }
  });

  showBanner('Wankle v27 ready  |  1-5=profiles  F8=toggle  F9=menu  `=diag  (v25-opt slim base + prediction engine + magnetize fix + randomized safe-dir)', '#7fd0ff', 5000);
  console.log('%c[wkl v27] Ready. v25-opt base (slim + perf opts) + v26 features (prediction engine, magnetize fix, randomized safe-dir). Profiles: 1=Rage 2=Legit 3=Safe 4=Ghost 5=ESP.', 'color:#7fd0ff;font-weight:bold');
}

})();
