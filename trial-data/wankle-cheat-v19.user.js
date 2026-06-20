// ==UserScript==
// @name         Wankle3D Cheat v19 — Simulation Dodge + Own-Shell Threats
// @namespace    wankle-cheat
// @version      19.0.0
// @description  NEW: Shell interceptor (shoots down incoming shells), self-ricochet safety (blocks shots that bounce back at you), UI persistence fix. `=diag F8=toggle F9=menu 1-5=profiles. (was passing tiles array as maxBounces), UI persistence (no clear during data gaps), 2s persist window. `=diag F8=toggle F9=menu 1-5=profiles. (axis-aligned shots), traceRicochet fallback to all tiles, RAF try/catch prevents overlay death, grid builds on first frame. `=diag F8=toggle F9=menu 1-5=profiles.
// @author       bounty-research
// @match        https://wankle.online/*
// @match        http://wankle.online/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
'use strict';

// ═══════════════════════════════════════════════════════════════
//  PROFILES — press 1-5 in game to switch
//
//  IMPORTANT: The game currently limits player shells to 1 bounce.
//  Only the ricochet-missile enemy gets 2 bounces. Player ricochet
//  powerups are planned but not yet in the game. So default profiles
//  use maxBounces=1 for performance. Switch to 'Ricochet' profile
//  (or manually bump maxBounces in the menu) when you have a ricochet
//  powerup.
// ═══════════════════════════════════════════════════════════════
var PROFILES = {
  'Rage': {
    desc: 'Full auto, max aggression. 1-bounce (current game limit).',
    aimbot: true, triggerbot: true, triggerAngle: 0.14, fireCooldownMs: 80,
    maxBounces: 1, searchStepDeg: 1.5, aimThrottleMs: 60, aimSmooth: 0.0,
    autoDodge: true, dodgeStrength: 1.0, dodgeHorizon: 1.8,
    espTanks: true, espShells: true, espMines: true, espPickups: true,
    espHealth: true, espDistance: true,
    solutions: true, tracer: true,
    autoRespawn: true, autoContinue: true
  },
  'Legit': {
    desc: 'Human-like. Smooth aim, fire delay, subtle ESP.',
    aimbot: true, triggerbot: true, triggerAngle: 0.04, fireCooldownMs: 350,
    maxBounces: 1, searchStepDeg: 2.0, aimThrottleMs: 120, aimSmooth: 0.7,
    autoDodge: true, dodgeStrength: 0.6, dodgeHorizon: 1.3,
    espTanks: true, espShells: false, espMines: true, espPickups: false,
    espHealth: false, espDistance: false,
    solutions: false, tracer: true,
    autoRespawn: true, autoContinue: true
  },
  'Safe': {
    desc: 'ESP + dodge only. Manual aim.',
    aimbot: false, triggerbot: false, triggerAngle: 0.05, fireCooldownMs: 200,
    maxBounces: 1, searchStepDeg: 2.0, aimThrottleMs: 150, aimSmooth: 0.0,
    autoDodge: true, dodgeStrength: 0.8, dodgeHorizon: 1.5,
    espTanks: true, espShells: true, espMines: true, espPickups: true,
    espHealth: true, espDistance: true,
    solutions: false, tracer: true,
    autoRespawn: true, autoContinue: true
  },
  'Ghost': {
    desc: 'Minimal. Dodge + tracer only. Nearly invisible.',
    aimbot: false, triggerbot: false, triggerAngle: 0.05, fireCooldownMs: 200,
    maxBounces: 1, searchStepDeg: 3.0, aimThrottleMs: 200, aimSmooth: 0.0,
    autoDodge: true, dodgeStrength: 0.5, dodgeHorizon: 1.2,
    espTanks: false, espShells: false, espMines: true, espPickups: false,
    espHealth: false, espDistance: false,
    solutions: false, tracer: true,
    autoRespawn: false, autoContinue: false
  },
  'ESP Only': {
    desc: 'Just wallhack. No aimbot, no dodge, no auto.',
    aimbot: false, triggerbot: false, triggerAngle: 0.05, fireCooldownMs: 200,
    maxBounces: 0, searchStepDeg: 3.0, aimThrottleMs: 500, aimSmooth: 0.0,
    autoDodge: false, dodgeStrength: 0.0, dodgeHorizon: 1.0,
    espTanks: true, espShells: true, espMines: true, espPickups: true,
    espHealth: true, espDistance: true,
    solutions: false, tracer: true,
    autoRespawn: false, autoContinue: false
  }
};

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════
var SHELL_SPEED = { normal: 320, missile: 680, ricochet: 980 };
var TANK_R      = 23;
var SHELL_CAP   = 5;  // PLAYER_DEFAULTS.shellCap from game constants
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
  solThrottleMs: 60,  // faster solution updates
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
  dodgePickupRoute: false,  // off by default — was causing unwanted movement
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
  mineDrill: false,         // OFF by default — too dangerous, kills player. Enable in menu when needed.
  mineSafeDist: 175,  // just outside 160u explosion radius        // don't place mines within this distance of player
  mineDrillCooldown: 2000,  // min ms between mine placements
  menuOpen: false
};

function applyProfile(name) {
  var p = PROFILES[name];
  if (!p) return;
  cfg.activeProfile  = name;
  cfg.aimbot = p.aimbot; cfg.triggerbot = p.triggerbot;
  cfg.triggerAngle = p.triggerAngle; cfg.fireCooldownMs = p.fireCooldownMs;
  cfg.maxBounces = p.maxBounces; cfg.searchStepDeg = p.searchStepDeg;
  cfg.aimThrottleMs = p.aimThrottleMs; cfg.aimSmooth = p.aimSmooth;
  cfg.autoDodge = p.autoDodge; cfg.dodgeStrength = p.dodgeStrength;
  cfg.dodgeHorizon = p.dodgeHorizon;
  cfg.espTanks = p.espTanks; cfg.espShells = p.espShells;
  cfg.espMines = p.espMines; cfg.espPickups = p.espPickups;
  cfg.espHealth = p.espHealth; cfg.espDistance = p.espDistance;
  cfg.solutions = p.solutions; cfg.tracer = p.tracer;
  cfg.autoRespawn = p.autoRespawn; cfg.autoContinue = p.autoContinue;
}
applyProfile('Rage');

// v27-baseline-patch: expose cfg + applyProfile on window for test harness
window._wklCfg = cfg;
window._wklApplyProfile = applyProfile;
// Stubs for telemetry fields older versions don't populate (bot logger reads these)
if (!window._wklDodgeDebug) window._wklDodgeDebug = { lastDodgeVec: null, shellCount: 0, realShellCount: 0, predictedShellCount: 0, guardViolated: false };
if (!window._wklPathGuard) window._wklPathGuard = { crossesAny: false, crossCount: 0, rotation: 0, resolved: false, shellsChecked: 0 };

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
    showBanner('Wankle v19: game not found — try refreshing', '#ff5a3b', 6000);
    return;
  }
  var w = window.WANKLE;
  if (!w || !w.net || !w.R) return;
  var disc = discoverBuildView(w.net);
  if (!disc) return;
  clearInterval(waitTimer);
  try { boot(w, disc); }
  catch(e) { showBanner('Wankle v19 crashed: ' + e.message, '#ff5a3b', 8000); console.error(e); }
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

  console.log('%c[wkl v19] hooked — buildView='+discovered.name+' sendInput='+_sendName+' pid='+_pidField, 'color:#7fd0ff;font-weight:bold');

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
      }
    } catch(e) { void e; cachedView = null; cachedMe = null; }
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
    if (tE > tX || tX < 1e-3 || tE < 1e-3) return null;
    return { t: tE, normalX: tMinX>tMinZ ? (ux>0?-1:1) : 0,
                    normalZ: tMinX>tMinZ ? 0 : (uz>0?-1:1) };
  }

  // ── Ricochet tracer (uses spatial grid, falls back to all tiles) ──
  function traceRicochet(sx, sz, dx, dz, maxB, maxDist) {
    var path = [{x:sx, z:sz}];
    var x=sx, z=sz, ux=dx, uz=dz, dist=0, EPS=0.5;
    for (var b=0; b<=maxB; b++) {
      // Use spatial grid to get only relevant tiles
      var nearby = tilesAlongRay(x, z, ux, uz, maxDist - dist);
      // FALLBACK: if grid is empty/not built, test ALL tiles (slower but correct)
      if (nearby.length === 0 && cachedTiles.length > 0) {
        nearby = cachedTiles;
      }
      var near = null;
      for (var i=0; i<nearby.length; i++) {
        var h = rayAABB(x, z, ux, uz, nearby[i]);
        if (h && (!near || h.t < near.t)) near = h;
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
      x+=ux*EPS; z+=uz*EPS; dist+=EPS;
    }
    return { path:path, totalDist:dist, bounces:maxB };
  }

  function pathHitsPoint(path, px, pz, radius) {
    for (var i=0; i<path.length-1; i++) {
      var a=path[i], b=path[i+1];
      var dx=b.x-a.x, dz=b.z-a.z, len2=dx*dx+dz*dz;
      if (len2<1e-9) continue;
      var t=((px-a.x)*dx+(pz-a.z)*dz)/len2;
      t = t<0?0:t>1?1:t;
      if (Math.hypot(a.x+dx*t-px, a.z+dz*t-pz) < radius) return true;
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
  var HIT_R_DIRECT = TANK_R + 9;  // 32u — TANK_R + SHELL_SIZE (measured)
  var HIT_R_BANK = TANK_R + 12;  // 35u — generous for bank shots (measured)

  // ── Aimbot state ──
  var aim_angle = null;
  var aim_bounces = 0;
  var aim_dist = 0;
  var aim_targetX = 0, aim_targetZ = 0;
  var aim_targetId = null;
  var aim_lastSearchT = 0;
  
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
    var waitTime = data.count * 600;
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
    // Raw snapshot shells have the 'a' (angle) field — available immediately
    return getRawShellAngle(id);
  }

  // ── Velocity tracker (per-tank EMA velocity) ──
  // For lead-aim prediction. Keyed by tank id.
  var velTrack = {};  // id -> {x, z, t, vx, vz}
  function updateVelTrack(tanks, now) {
    for (var i = 0; i < tanks.length; i++) {
      var t = tanks[i];
      var prev = velTrack[t.id];
      if (prev) {
        var dt = (now - prev.t) / 1000;
        if (dt > 0.001 && dt < 0.5) {
          var vx = (t.x - prev.x) / dt;
          var vz = (t.z - prev.z) / dt;
          // Adaptive EMA: full weight for first 3 samples (instant convergence),
          // then 0.4 for stable tracking (less jitter than 0.5)
          prev.samples = (prev.samples || 0) + 1;
          var a = prev.samples < 3 ? 1.0 : 0.4;
          prev.vx = prev.vx == null ? vx : prev.vx * (1 - a) + vx * a;
          prev.vz = prev.vz == null ? vz : prev.vz * (1 - a) + vz * a;
          prev.x = t.x; prev.z = t.z; prev.t = now;
        }
      } else {
        velTrack[t.id] = { x: t.x, z: t.z, t: now, vx: null, vz: null, samples: 0 };
      }
    }
    // Garbage-collect old entries
    for (var k in velTrack) {
      if (now - velTrack[k].t > 3000) delete velTrack[k];
    }
  }
  function getVel(id) {
    var v = velTrack[id];
    return v && v.vx != null ? { vx: v.vx, vz: v.vz } : { vx: 0, vz: 0 };
  }

  // ── Lead-aim solver ──
  // Predicts where the target will be when the shell arrives.
  // Solves the quadratic: |target + vel*t - me|^2 = (shellSpeed*t)^2
  // Returns the predicted (x, z) position and travel time t.
  // ── Lead-aim solver (iterative ballistic prediction) ──
  // Uses successive approximation instead of quadratic formula.
  // Based on the "Ballistic Targeting" algorithm from Game Programming Gems.
  // Handles non-constant velocity better and doesn't fail when target > shell speed.
  //
  // Algorithm:
  //   1. Guess t = direct_distance / shellSpeed
  //   2. Predict target position at time t
  //   3. Recompute distance from launch point to predicted position
  //   4. Recompute t = new_distance / shellSpeed
  //   5. Repeat 4 times (converges in 3-4 iterations for most cases)
  //
  // Accounts for player's own velocity (relative velocity) and fire stun.
  function leadAim(me, tgt, shellSpeed) {
    var vel = getVel(tgt.id);
    var myVel = getEffectiveMyVel(me, performance.now());
    
    // Predicted launch position (account for player movement + fire stun)
    var launchLookahead = 0.03;  // 30ms (reduced from 50ms — fire stun handles the rest)
    var launchX = me.x + myVel.vx * launchLookahead;
    var launchZ = me.z + myVel.vz * launchLookahead;
    
    // Account for interp delay — the target position we see is ~interpDelay ms old.
    // The target has been moving during that time, so add it to travel time.
    var interpDelay = (_interpDelay || 65) / 1000;
    var dx0 = tgt.x - launchX, dz0 = tgt.z - launchZ;
    var directDist = Math.hypot(dx0, dz0);
    var t = directDist / shellSpeed + interpDelay;
    
    // Iterative refinement (4 iterations — converges to <1u accuracy)
    var predX = tgt.x, predZ = tgt.z;
    // More iterations at long range (target moves further during travel)
    var iterations = directDist > 800 ? 5 : (directDist > 400 ? 4 : 3);
    for (var iter = 0; iter < iterations; iter++) {
      // Predict target position at time t (using target's absolute velocity)
      predX = tgt.x + vel.vx * t;
      predZ = tgt.z + vel.vz * t;
      // Recompute distance from launch point to predicted position
      var dx = predX - launchX, dz = predZ - launchZ;
      var dist = Math.hypot(dx, dz);
      // Update travel time
      t = dist / shellSpeed;
    }
    
    // Clamp to reasonable range
    if (t > 5) t = 5;
    if (t < 0) t = 0;
    
    return { x: predX, z: predZ, t: t, launchX: launchX, launchZ: launchZ };
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
      var directTrace = traceRicochet(me.x, me.z, Math.cos(directAngle), Math.sin(directAngle), 0, d + 50);
      if (pathHitsPoint(directTrace.path, e.x, e.z, TANK_R)) {
        score *= 1.4;  // direct shot available
      }

      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    // If no shootable targets found, return the fallback (a waiting target)
    // so the aimbot still tracks something. The triggerbot won't fire due to conservation block.
    return best || fallback;
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
    if (hasRicochetShell()) shellSpeed = SHELL_SPEED.ricochet;
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
    var directAngle = Math.atan2(aimZ - launchZ, aimX - launchX);
    var directTrace = traceRicochet(launchX, launchZ, Math.cos(directAngle), Math.sin(directAngle), 0, cfg.maxShotDist);
    if (pathHitsPoint(directTrace.path, aimX, aimZ, HIT_R_DIRECT)) {
      aim_angle = directAngle;
      aim_bounces = 0;
      aim_dist = directTrace.totalDist;
      aim_targetX = aimX; aim_targetZ = aimZ;
      var vel = getVel(tgt.id);
      var speed = Math.hypot(vel.vx, vel.vz);
      // Direct shot: high probability — if we can see them and have LOS, we'll hit
      // Speed only matters for prediction uncertainty, not the shot itself
      var predUncertainty = speed * predicted.t * 0.02;  // how far off our prediction could be
      aim_hitProb = Math.max(0.6, 1.0 - predUncertainty / TANK_R);
      return;
    }

    // If no direct shot and maxBounces > 0, search bank shots
    if (cfg.maxBounces === 0) { aim_angle = null; aim_hitProb = 0; return; }

    // Search bank shots. Use a WIDER hit radius for bank shots to account for
    // prediction uncertainty — the lead-aim predicted position is an estimate,
    // and bank shots have more travel time so more prediction error.
    // TANK_R=23 is the actual hit radius; we use TANK_R+8=31 for bank detection.
    var bankHitR = HIT_R_BANK;

    // Search using predicted position first, from predicted launch position
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
  function searchBankShots(launchX, launchZ, tx, tz, hitR) {
    var stepRad = cfg.searchStepDeg * Math.PI / 180;
    var best = null;

    for (var rad = 0; rad < TAU; rad += stepRad) {
      var r = traceRicochet(launchX, launchZ, Math.cos(rad), Math.sin(rad), cfg.maxBounces, cfg.maxShotDist);
      if (pathHitsPoint(r.path, tx, tz, hitR)) {
        if (!best || r.totalDist < best.totalDist)
          best = { angle: rad, totalDist: r.totalDist, bounces: r.bounces, path: r.path };
      }
    }
    if (!best) return null;

    // Fine refinement
    var fineStep = 0.3 * Math.PI / 180;
    for (var rad2 = best.angle - stepRad; rad2 <= best.angle + stepRad; rad2 += fineStep) {
      var r2 = traceRicochet(launchX, launchZ, Math.cos(rad2), Math.sin(rad2), cfg.maxBounces, cfg.maxShotDist);
      if (pathHitsPoint(r2.path, tx, tz, hitR) && r2.totalDist < best.totalDist)
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

  // Check if I have a ricochet-type shell in flight (2-bounce-capable)
  // When ricochet powerups ship, this will return true and the aimbot
  // can auto-bump maxBounces to 2 for that shot. For now it returns false
  // because the player only has normal 1-bounce shells.
  function hasRicochetShell() {
    if (!cachedView || !cachedView.shells) return false;
    var myId = getMyId();
    for (var i=0; i<cachedView.shells.length; i++) {
      if (String(cachedView.shells[i].o) === String(myId) && cachedView.shells[i].t === 'ricochet') return true;
    }
    return false;
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

  // ── Self-ricochet safety check ──
  // Traces the predicted shell path from a given aim angle and checks if any
  // segment of the path (after the first bounce) passes within selfRicochetRadius
  // of the player. If so, the shot is dangerous — returns true.
  // The first segment (direct from player) is skipped since it starts AT the player.
  function isShotSelfRicocheting(me, aimAngle) {
    if (!cfg.selfRicochetSafety) return false;
    var shellSpeed = SHELL_SPEED.normal;
    if (hasRicochetShell()) shellSpeed = SHELL_SPEED.ricochet;
    var ux = Math.cos(aimAngle), uz = Math.sin(aimAngle);
    var traced = traceRicochet(me.x, me.z, ux, uz, cfg.maxBounces, cfg.maxShotDist);
    
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

  // ── Mine drilling system ──
  // Detects gray blocks (kind=2) blocking path to nearest enemy,
  // places mines to destroy them. Avoids self-damage.
  var lastMineT = 0;
  var MINE_EXPLOSION_R = 160;
  var mineRetreatT = 0;
  var mineRetreatX = 0, mineRetreatZ = 0;
  
  
  var gameStartTime = 0;
  function shouldPlaceMine(me, enemies, tiles, now) {
    if (!cfg.mineDrill) return false;
    if (gameStartTime === 0) gameStartTime = now;
    // Don't place mines in the first 5 seconds (spawn safety)
    if (now - gameStartTime < 5000) return false;
    // Don't place if no enemies alive (no reason to drill when safe)
    if (!enemies || enemies.length === 0) return false;
    if (now - lastMineT < cfg.mineDrillCooldown) return false;
    if (now - mineRetreatT < 3000 && mineRetreatT > 0) return false;
    if (me.stunCount != null && me.stunCount < 0) return false;
    var mySpeed = getMySpeed(me);
    if (mySpeed < 80) return false;
    // Only place if there's a gray block within range AND it's blocking path to enemy
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (t.kind !== 2) continue;
      var d = Math.hypot(t.x - me.x, t.z - me.z);
      if (d <= MINE_EXPLOSION_R - 15) return true;
    }
    return false;
  }

  // ── Death cause tracker ──
  var lastDeathCause = 'none';
  var lastDeathT = 0;
  function detectDeathCause(me, view, now) {
    if (!me || !me.dead) return;
    if (now - lastDeathT < 1000) return;  // already recorded this death
    lastDeathT = now;
    
    var myId = getMyId();
    var myX = me.x, myZ = me.z;
    
    // Check for exploding mines near us
    var mines = view.mines || [];
    for (var mi = 0; mi < mines.length; mi++) {
      var m = mines[mi];
      if (m.e) {  // exploding
        var md = Math.hypot(m.x - myX, m.z - myZ);
        if (md < 200) {
          // Check if it's OUR mine (we placed it)
          lastDeathCause = 'self-mine';
          console.log('[wkl] DEATH: self-mine at dist=' + Math.round(md));
          return;
        }
      }
    }
    
    // Check for enemy shells near us
    var shells = view.shells || [];
    for (var si = 0; si < shells.length; si++) {
      var s = shells[si];
      if (String(s.o) === String(myId)) {
        // Our own shell near us — self-ricochet!
        var sd = Math.hypot(s.x - myX, s.z - myZ);
        if (sd < 50) {
          lastDeathCause = 'self-ricochet';
          console.log('[wkl] DEATH: self-ricochet, own shell at dist=' + Math.round(sd));
          return;
        }
      } else {
        var ed = Math.hypot(s.x - myX, s.z - myZ);
        if (ed < 50) {
          lastDeathCause = 'enemy-shell';
          console.log('[wkl] DEATH: enemy shell at dist=' + Math.round(ed) + ' owner=' + s.o);
          return;
        }
      }
    }
    
    lastDeathCause = 'unknown';
    console.log('[wkl] DEATH: unknown cause');
  }

  // ── sendInput hook (LEAN — reads cached state, no getView call) ──
  var origSendInput = _sendName ? net[_sendName].bind(net) : function(x){return x;};
  if (!_sendName) console.warn('[wkl] sendInput not found — aimbot/dodge inactive');

  net[_sendName || 'sendInput'] = function(input) {
    try {
      if (!cfg.enabled) return origSendInput(input);
      // Read cached state — NO getView() call here
      var me = cachedMe;
      if (!me) return origSendInput(input);

      // Auto-respawn — pulse fire to create edge (game only respawns on fire edge)
      if (me.dead) {
        if (cfg.autoRespawn) {
          // Use a dedicated respawn timer (not lastFireT which is frozen)
          var rn = performance.now();
          if (!window._wklRespawnT) window._wklRespawnT = 0;
          if (rn - window._wklRespawnT > 200) {
            input.fire = true;   // press (creates edge)
            window._wklRespawnT = rn;
          } else if (rn - window._wklRespawnT > 100) {
            input.fire = false;  // release (ready for next edge)
          } else {
            input.fire = true;   // still pressing
          }
          input.mine = false;
        }
        aim_angle = null;
        return origSendInput(input);
      }

      var now = performance.now();

      // ── SHELL INTERCEPTOR (highest priority — survival) ──
      // If there's an incoming shell within interceptRange, override aim to shoot it down.
      // This takes priority over the aimbot because not dying > getting kills.
      var interceptTgt = findInterceptTarget(me);
      if (interceptTgt) {
        // Snap aim to intercept target (no smoothing — urgent)
        input.aim = interceptTgt.angle;
        lastAim = interceptTgt.angle;
        // Fire if aim is close enough and cooldown allows
        if (cfg.triggerbot || cfg.shellIntercept) {
          var interceptErr = Math.abs(angleDiff(input.aim, interceptTgt.angle));
          var canIntercept = interceptErr < cfg.interceptAngle
                           && myShellsInFlight() < SHELL_CAP
                           && (now - lastFireT) > cfg.fireCooldownMs;
          // Self-ricochet safety still applies — don't intercept if the shot bounces back at us
          if (canIntercept && cfg.selfRicochetSafety && isShotSelfRicocheting(me, interceptTgt.angle)) {
            canIntercept = false;  // block the shot
          }
          if (canIntercept) {
            input.fire = true;
            lastFireT = now;
            lastFireStunT = now;
          }
        }
        return origSendInput(input);
      }

      // Mine drilling — place mine if path is blocked by gray blocks
      if (shouldPlaceMine(me, cachedEnemies, cachedTiles, now)) {
        input.mine = true;
        lastMineT = now;
        mineRetreatT = now;
        mineRetreatX = me.x;
        mineRetreatZ = me.z;
      }

      // If retreating from a placed mine, override movement to escape blast FAST
      // Mine explodes after ~2s with 160u radius. Player needs to be >170u away.
      // At 105 u/s, need 1.6s to escape. So retreat immediately and aggressively.
      if (now - mineRetreatT < 2500 && mineRetreatT > 0) {
        var rdx = me.x - mineRetreatX, rdz = me.z - mineRetreatZ;
        var rlen = Math.hypot(rdx, rdz);
        // Keep retreating until we're 200u clear (safety margin)
        if (rlen < 250) {
          if (rlen > 1) {
            // Full override — run directly away from mine
            input.moveX = (rdx / rlen);
            input.moveZ = (rdz / rlen);
          } else {
            // On top of mine — pick a direction (away from nearest wall)
            input.moveX = 0;
            input.moveZ = -1;
          }
          // Don't fire while retreating ( conserve shells, focus on escaping)
          input.fire = false;
        }
      }

      // Apply pre-computed dodge
      if (cfg.autoDodge && lastDodgeVec) {
        var blend = cfg.dodgeStrength * (lastDodgeVec.urgency > 0.4 ? 1.0 : lastDodgeVec.urgency * 2.0);
        input.moveX = input.moveX*(1-blend) + lastDodgeVec.moveX*blend;
        input.moveZ = input.moveZ*(1-blend) + lastDodgeVec.moveZ*blend;
        var m = Math.hypot(input.moveX, input.moveZ);
        if (m > 1) { input.moveX/=m; input.moveZ/=m; }
      }

      // Apply pre-computed aim
      if (cfg.aimbot && aim_angle !== null) {
        // Smooth toward target angle
        if (lastAim === null) lastAim = input.aim || aim_angle;
        var tStep = 1 - Math.max(0, Math.min(0.99, cfg.aimSmooth));
        lastAim = lerpAngle(lastAim, aim_angle, tStep);
        input.aim = lastAim;

        // Triggerbot with lethal priority, shell reserve, cooldown, hit-prob gate
        if (cfg.triggerbot) {
          var err = Math.abs(angleDiff(input.aim, aim_angle));
          
          // Check lethal FIRST (before using it in maxShells)
          var isLethal = false;
          if (cfg.lethalPriority && cachedEnemies.length > 0) {
            for (var ei = 0; ei < cachedEnemies.length; ei++) {
              if (String(cachedEnemies[ei].id) === String(aim_targetId)) {
                if (typeof cachedEnemies[ei].health === 'number' && cachedEnemies[ei].health <= 1) {
                  isLethal = true;
                }
                break;
              }
            }
          }
          
          var maxShells = isLethal ? SHELL_CAP : (SHELL_CAP - cfg.reserveShells);
          // Don't waste shots: skip if a shell is already heading toward this target
          var shellAimingAtTarget = false;
          if (myShellsInFlight() > 0 && cachedView && cachedView.shells) {
            var myShells = cachedView.shells;
            for (var shi = 0; shi < myShells.length; shi++) {
              if (String(myShells[shi].o) !== String(getMyId())) continue;
              // Check if this shell is heading toward the target
              var shAngle = getShellAngle(myShells[shi].id);
              if (shAngle === null) continue;
              var sdx = aim_targetX - myShells[shi].x, sdz = aim_targetZ - myShells[shi].z;
              var sdist = Math.hypot(sdx, sdz);
              if (sdist < 1) { shellAimingAtTarget = true; break; }
              var sproj = (Math.cos(shAngle) * sdx + Math.sin(shAngle) * sdz) / sdist;
              if (sproj > 0.7 && sdist < 500) { shellAimingAtTarget = true; break; }
            }
          }
          // Block firing if one of our shells is very close and heading at us
          var ownShellDanger = false;
          if (cachedView && cachedView.shells && myShellsInFlight() > 0) {
            var _myId = getMyId();
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
          
          // SHELL CONSERVATION: don't fire more shells at this target than needed
          // Find the current target's data
          var currentTgt = null;
          for (var _tei = 0; _tei < cachedEnemies.length; _tei++) {
            if (String(cachedEnemies[_tei].id) === String(aim_targetId)) {
              currentTgt = cachedEnemies[_tei]; break;
            }
          }
          var maxShellsForThisTarget = maxShellsForTarget(currentTgt, aim_hitProb);
          var alreadyFired = shellsFiredAt(aim_targetId);
          var shellsAtCap = alreadyFired >= maxShellsForThisTarget;
          
          // If we've already fired enough shells at this target, only fire more if:
          // 1. The target is still alive (previous shells missed)
          // 2. We've waited long enough to see if they hit (500ms per shell fired)
          var conservationBlock = false;
          if (shellsAtCap && currentTgt) {
            var lastFireAtTarget = shellsPerTarget[aim_targetId] ? shellsPerTarget[aim_targetId].lastFireT : 0;
            var timeSinceLastShell = now - lastFireAtTarget;
            // Wait 600ms per shell fired to see if they hit before wasting more
            var waitTime = alreadyFired * 600;
            if (timeSinceLastShell < waitTime) {
              conservationBlock = true;  // waiting to see if previous shells hit
            } else {
              // Time's up — previous shells missed. Reset counter and allow more.
              if (shellsPerTarget[aim_targetId]) {
                shellsPerTarget[aim_targetId].count = 0;
              }
            }
          }
          
          var canFire = err < cfg.triggerAngle
                     && myShellsInFlight() < maxShells
                     && (now - lastFireT) > cfg.fireCooldownMs
                     && aim_hitProb >= cfg.minHitProb
                     && !shellAimingAtTarget
                     && !ownShellDanger
                     && !conservationBlock;
          
          if (canFire && cfg.selfRicochetSafety && !isLethal && isShotSelfRicocheting(me, aim_angle)) {
            canFire = false;
          }
          
          // FIRE LOGIC: only ADD fire, never remove it.
          if (canFire && !input.fire) {
            input.fire = true;
            lastFireT = now;
            lastFireStunT = now;
          }
        }
      } else if (!cfg.aimbot) {
        lastAim = null;
      } else {
        lastAim = null;
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

  function pointInTile(x, z, tiles, margin) {
    for (var i=0; i<tiles.length; i++) {
      var t=tiles[i];
      if (x>t.x-t.hw-margin && x<t.x+t.hw+margin && z>t.z-t.hl-margin && z<t.z+t.hl+margin) return true;
    }
    return false;
  }

  function computeDodge() {
    if (!cachedMe || !cachedView) return null;
    var me = cachedMe;
    if (me.fx==='stun') return null;
    var mySpeed = getMySpeed(me);
    var shellAge = _interpDelay/1000 + cfg.dodgeReactionMs/1000;
    var myId = getMyId();
    var threats = [];
    var tiles = cachedTiles;

    var shells = cachedView.shells || [];
    for (var si=0; si<shells.length; si++) {
      var s=shells[si];
      if (String(s.o)===String(myId)) continue;
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
        var canMove=mySpeed*best.tImpact;
        if (best.dist < canMove+cfg.dodgeMargin+TANK_R) {
          var timeUrg = 1-Math.min(1,best.tImpact/0.5);
          var marginUrg = 1-Math.min(1,Math.max(0,(canMove+cfg.dodgeMargin+TANK_R)-best.dist)/200);
          var urg = Math.max(0.1, Math.max(timeUrg,marginUrg));
          threats.push({type:'shell', approach:best, urgency:urg});
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

    var gx=0, gz=0, maxUrg=0;
    for (var ti=0; ti<threats.length; ti++) {
      var th=threats[ti], px=0, pz=0;
      // Weight by inverse time-to-impact — urgent threats dominate the gradient
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
      } else {
        var ddx=me.x-th.x, ddz=me.z-th.z, dd=Math.hypot(ddx,ddz);
        if (dd>0.1) { px=ddx/dd; pz=ddz/dd; }
      }
      var w=th.urgency*th.urgency*timeWeight;
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
    return {moveX:dx, moveZ:dz, urgency:maxUrg, threats:threats};
  }

  // ── Pickup routing ──
  function findPickup() {
    if (!cachedView || !cachedView.pickups || !cachedView.pickups.length || !cachedMe) return null;
    var me = cachedMe;
    var pri={shield:3,speed:2,multi:1}, best=null, bestScore=-Infinity;
    for (var i=0; i<cachedView.pickups.length; i++) {
      var p=cachedView.pickups[i], d=Math.hypot(p.x-me.x, p.z-me.z);
      if (d>800) continue;
      var safe=true;
      for (var j=0; j<(cachedView.mines||[]).length; j++) {
        var mn=cachedView.mines[j], dx=p.x-me.x, dz=p.z-me.z, len=Math.hypot(dx,dz);
        if (len<1) continue;
        var t=((mn.x-me.x)*dx+(mn.z-me.z)*dz)/(len*len);
        if (t<0||t>1) continue;
        if (Math.hypot(mn.x-(me.x+dx*t), mn.z-(me.z+dz*t))<60) { safe=false; break; }
      }
      if (!safe) continue;
      var sc=(pri[p.kind]||0)*100-d/10;
      if (sc>bestScore) { bestScore=sc; best=p; }
    }
    return best;
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
  // Per-frame cache for expensive HUD calculations
  var cachedInterceptTgt = null;
  var cachedSelfRicochet = false;         // how long to keep stale data before clearing (longer = less flicker)

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
      if (!dg && cfg.dodgePickupRoute) {
        var pk = findPickup();
        if (pk) {
          var pdx = pk.x - me.x, pdz = pk.z - me.z, pd = Math.hypot(pdx, pdz);
          if (pd > 1) lastDodgeVec = { moveX: pdx / pd, moveZ: pdz / pd, urgency: 0.05 };  // very gentle nudge
        }
      }
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
      tracerCache = traceRicochet(me.x, me.z, Math.cos(aim), Math.sin(aim), cfg.maxBounces, cfg.maxShotDist);
      tracerCacheAngle = aim;
      tracerCacheMeX = me.x; tracerCacheMeZ = me.z;
    }
    var r = tracerCache;
    var hit = false;
    for (var i = 0; i < view.tanks.length; i++) {
      var t = view.tanks[i];
      if (!t.isLocal && !t.dead && pathHitsPoint(r.path, t.x, t.z, TANK_R)) { hit = true; break; }
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
        var r = traceRicochet(me.x, me.z, Math.cos(rad), Math.sin(rad), cfg.maxBounces, cfg.maxShotDist);
        if (pathHitsPoint(r.path, tgt.x, tgt.z, TANK_R)) {
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

    // Shell intercept status (cached — computed once per frame in rafBody)
    if (cfg.shellIntercept && cachedInterceptTgt) {
      var interceptTgt = cachedInterceptTgt;
      {
        ctx.fillStyle='#ff00ff'; ctx.font='bold 12px monospace';
        ctx.fillText('⬢ INTERCEPT  '+Math.round(interceptTgt.dist)+'u  T-'+interceptTgt.tImpact.toFixed(2)+'s', 16, y); y+=15;
      }
    }

    // Aim status — only show if aimbot enabled
    if (cfg.aimbot) {
      if (drawAim !== null) {
        var probPct = Math.round(drawHitProb * 100);
        var willFire = drawHitProb >= cfg.minHitProb;
        var probColor = willFire ? '#7fff5a' : (drawHitProb >= 0.2 ? '#ffcc3b' : '#ff5a3b');

        // Check if current shot would self-ricochet (show warning)
        var selfRicochet = cachedSelfRicochet;

        // Compact aim line: bounces, distance, shells
        ctx.fillStyle='#ff4060'; ctx.font='bold 12px monospace';
        var shellsInFlight = myShellsInFlight();
        var fired = shellsFiredAt(aim_targetId);
        var _hudTgt = null;
        for (var _hi = 0; _hi < cachedEnemies.length; _hi++) {
          if (String(cachedEnemies[_hi].id) === String(aim_targetId)) { _hudTgt = cachedEnemies[_hi]; break; }
        }
        var maxFired = _hudTgt ? maxShellsForTarget(_hudTgt, drawHitProb) : '?';
        var aimStr = '◉ TARGET '+drawBounces+'B '+Math.round(drawDist)+'u  shells '+shellsInFlight+'/'+SHELL_CAP+'  fired:'+fired+'/'+maxFired;
        ctx.fillText(aimStr, 16, y); y+=15;

        // Hit probability with clear visual indicator
        ctx.fillStyle = selfRicochet ? '#ff5a3b' : probColor;
        ctx.font='11px monospace';
        var fireStr;
        if (selfRicochet) {
          fireStr = '⚠ SELF-RICOCHET — BLOCKED';
        } else if (willFire) {
          fireStr = '✓ FIRING '+probPct+'%';
        } else {
          fireStr = '○ holding '+probPct+'%';
        }
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
    if (lastDeathCause !== 'none' && (performance.now() - lastDeathT) < 5000) {
      var deathColor = lastDeathCause.indexOf('self') >= 0 ? '#ff5a3b' : '#ff8800';
      ctx.fillStyle = deathColor;
      ctx.fillText('Last death: ' + lastDeathCause, 16, window.innerHeight-36);
    }
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
    title.textContent='WANKLE v19';
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
      mRow('Pickup routing', function(){return cfg.dodgePickupRoute;}, function(v){cfg.dodgePickupRoute=v;});
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
    mHeader('MINE DRILLING');
    mRow('Auto mine drill', function(){return cfg.mineDrill;}, function(v){cfg.mineDrill=v;}, 'Places mines to destroy gray blocks blocking path');
    if (cfg.mineDrill) {
      mNum('Safe distance', function(){return cfg.mineSafeDist;}, function(v){cfg.mineSafeDist=Math.max(170,v);}, 10, 170, 400);
      mNum('Cooldown (ms)', function(){return cfg.mineDrillCooldown;}, function(v){cfg.mineDrillCooldown=Math.max(500,v);}, 100, 500, 5000);
    }
    mDivider();

    mHeader('DIAGNOSTICS');
    mBtn('Run diagnostic (`)', '#ffcc3b', runDiag);
    mBtn('Close menu (F9)', '#7fd0ff', function(){cfg.menuOpen=false;menu.style.display='none';});
  }
  buildMenu();

  function runDiag() {
    console.log('%c[wkl v19] DIAGNOSTIC', 'color:#7fd0ff;font-weight:bold');
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
      showBanner('Wankle v19: '+(cfg.enabled?'ON':'OFF'), cfg.enabled?'#7fd0ff':'#ff5a3b');
    }
    if (e.code==='F9') {
      e.preventDefault();
      cfg.menuOpen=!cfg.menuOpen;
      menu.style.display=cfg.menuOpen?'block':'none';
    }
  });

  showBanner('Wankle v19 ready  |  1-5=profiles  F8=toggle  F9=menu  `=diag  (simulation dodge + own-shell threats + safer positioning)', '#7fd0ff', 5000);
  console.log('%c[wkl v19] Ready. Bank shot search fixed + RAF crash recovery. Profiles: 1=Rage 2=Legit 3=Safe 4=Ghost 5=ESP.', 'color:#7fd0ff;font-weight:bold');
}

})();
