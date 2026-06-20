// Wankle3D Hunter Bot v3 — A* PATHFINDING EDITION
//
// v2 (hunter-bot.js) used angle-offsets to navigate around walls, which failed
// on dense maps (80-90% of time stuck in 'hunting_blocked'). This v3 uses A*
// pathfinding on the tile grid to navigate corridors properly.
//
// Algorithm:
//   1. Build a navigation grid from v.tiles (70u cells, walkable = empty)
//   2. Run A* from bot's cell to nearest enemy's cell
//   3. Follow waypoints, re-routing every 2s or when path is blocked
//   4. When LOS to enemy is achieved, hold position and let aimbot fire
//   5. If no path exists, fall back to direct movement (dodge handles walls)
//
// The grid is 70u per cell (matching TILE size). Tanks are 46x36u, so they
// fit in one cell with room. A cell is "blocked" if any tile overlaps it.
(function(){
  try {
    if (!window.WANKLE || !WANKLE.net || !WANKLE.R) return;

    var MODE = window._tbMode || 'hunter';
    var v = WANKLE.net.buildView(0);
    var me = null;
    for (var i = 0; i < v.tanks.length; i++) if (v.tanks[i].isLocal) { me = v.tanks[i]; break; }
    var now = Date.now();

    if (!window._tb) {
      window._tb = {
        mode: MODE,
        totalKills: 0, totalDeaths: 0, wasDead: false,
        lastHp: 1, lastWave: 0,
        lastSampleT: 0, lastLogT: 0,
        tStart: now,
        keysDown: {},
        rafCount: 0, rafStart: 0, rafFps: 0,
        rafTimes: [],
        maxEnemies: 0,
        shellsFired: 0, lastMyShellCount: 0,
        totalDistance: 0,
        lastPos: me ? {x: me.x, z: me.z} : null,
        // A* state
        navGrid: null,
        gridCols: 0, gridRows: 0,
        cellSize: 70,
        currentPath: null,
        pathIndex: 0,
        lastPathfindT: 0,
        losChecks: 0,
        losBlocked: 0,
        pathfinds: 0,
        pathAborts: 0,
        // Self-kill tracking: track our own shells' positions + velocities
        // so we can determine if we died to our own ricochet
        myShellTracker: {},  // shellId -> {x, z, prevX, prevZ, t}
        selfKillSuspects: 0,  // count of our shells heading toward us
        // ENHANCED telemetry (same as passive-bot.js)
        lastDodgeActive: false, lastDodgeUrgency: 0,
        lastInterceptActive: false,
        lastMyVel: {vx: 0, vz: 0}, lastMySpeed: 0,
      };
      window._tbLog = [];

      (function loop(){
        var tb = window._tb;
        if (!tb) return;
        if (tb.rafStart === 0) tb.rafStart = performance.now();
        tb.rafCount++;
        var dt = performance.now() - tb.rafStart;
        if (dt > 500) {
          tb.rafFps = tb.rafCount / (dt / 1000);
          tb.rafTimes.push(tb.rafFps);
          while (tb.rafTimes.length > 60) tb.rafTimes.shift();
          tb.rafCount = 0;
          tb.rafStart = performance.now();
        }
        requestAnimationFrame(loop);
      })();

      window._tbLog.push({kind:'event', sub:'boot', t: now, tRel: 0, mode: MODE});
    }
    var tb = window._tb;

    function logEvent(sub, extra) {
      window._tbLog.push(Object.assign({
        kind: 'event', sub: sub, t: now, tRel: now - tb.tStart
      }, extra || {}));
    }

    // ENHANCED: Track player velocity and cheat state for telemetry
    if (me) {
      var myVelTrack = (typeof getVel === 'function') ? getVel(me.id) : {vx:0, vz:0};
      tb.lastMyVel = myVelTrack;
      tb.lastMySpeed = Math.hypot(myVelTrack.vx, myVelTrack.vz);
    }
    // v22.3: dodge telemetry from window._wklDodgeDebug (closure-scope lastDodgeVec is inaccessible)
    var dodgeDb = window._wklDodgeDebug;
    if (dodgeDb && dodgeDb.lastDodgeVec) {
      tb.lastDodgeActive = true;
      tb.lastDodgeUrgency = dodgeDb.lastDodgeVec.urgency || 0;
      tb.lastColdSpotReactive = dodgeDb.lastColdSpot ? dodgeDb.lastColdSpot.reactive : null;
      tb.lastColdSpotStrategic = dodgeDb.lastColdSpot ? dodgeDb.lastColdSpot.strategic : null;
      tb.lastPredictedShellCount = dodgeDb.predictedShellCount || 0;
      tb.lastRealShellCount = dodgeDb.realShellCount || 0;
      tb.lastDodgeGuardViolated = !!(dodgeDb.guardViolated);
    } else {
      tb.lastDodgeActive = false;
      tb.lastDodgeUrgency = 0;
    }
    // v25: path-segment guard telemetry
    var pathG = window._wklPathGuard;
    tb.lastPathGuardCrosses = pathG ? !!pathG.crossesAny : false;
    tb.lastPathGuardRotation = pathG ? (pathG.rotation || 0) : 0;
    tb.lastPathGuardResolved = pathG ? !!pathG.resolved : false;
    tb.lastPathGuardShells = pathG ? (pathG.shellsChecked || 0) : 0;
    if (typeof lastDodgeVec !== 'undefined' && lastDodgeVec) {
      tb.lastDodgeActive = true;
      tb.lastDodgeUrgency = lastDodgeVec.urgency || 0;
    }
    if (typeof cachedInterceptTgt !== 'undefined') {
      tb.lastInterceptActive = !!cachedInterceptTgt;
    }

    // ── Death tracking ──
    if (me && me.dead && !tb.wasDead) {
      tb.totalDeaths++;
      tb.wasDead = true;
      // DEATH ATTRIBUTION: determine if we died to our own shell or enemy
      // Method 1: Check if any of our own shells were heading toward us recently
      // (self-kill via ricochet). This catches the case where our bouncing shell
      // comes back and hits us — the killing shell despawns on impact, so we
      // can't scan for it at death time. But we tracked it the previous tick.
      var cause = 'unknown';
      var killerInfo = null;
      
      // Check our shell tracker for suspects
      if (tb.selfKillSuspects > 0) {
        // Find the most dangerous suspect
        var worstSuspect = null;
        for (var sid in tb.myShellTracker) {
          var s = tb.myShellTracker[sid];
          if (s.isSuspect) {
            if (!worstSuspect || s.distToUs < worstSuspect.distToUs) {
              worstSuspect = s;
            }
          }
        }
        if (worstSuspect) {
          cause = 'self_shell';
          killerInfo = {
            type: 'self_ricochet',
            shellPos: [Math.round(worstSuspect.x), Math.round(worstSuspect.z)],
            distToUs: Math.round(worstSuspect.distToUs),
            headingToUs: Math.round(worstSuspect.headingToUs * 100) / 100
          };
        }
      }
      
      // Method 2: If no self-kill suspect, scan for enemy shells near us
      if (cause === 'unknown') {
        var allShells = v.shells || [];
        for (var si = 0; si < allShells.length; si++) {
          var s2 = allShells[si];
          if (String(s2.o) === myId) continue;  // skip our own
          var sd = Math.hypot(s2.x - me.x, s2.z - me.z);
          if (sd < 80) {
            cause = 'enemy_shell';
            killerInfo = {
              type: 'enemy_shell',
              ownerId: String(s2.o),
              dist: Math.round(sd),
              shellPos: [Math.round(s2.x), Math.round(s2.z)]
            };
            break;
          }
        }
      }
      
      // Method 3: Check for exploding mines
      if (cause === 'unknown') {
        var allMines = v.mines || [];
        for (var mi = 0; mi < allMines.length; mi++) {
          var m = allMines[mi];
          if (m.e) {
            var md = Math.hypot(m.x - me.x, m.z - me.z);
            if (md < 200) {
              cause = 'mine';
              killerInfo = {type: 'mine', dist: Math.round(md), minePos: [Math.round(m.x), Math.round(m.z)]};
              break;
            }
          }
        }
      }
      
      logEvent('death', {
        deathNum: tb.totalDeaths,
        wave: WANKLE.net.meta.wave,
        kills: tb.totalKills,
        pos: me ? [Math.round(me.x), Math.round(me.z)] : null,
        cause: cause,
        killer: killerInfo,
        selfKillSuspects: tb.selfKillSuspects,
        // ENHANCED death telemetry (same as passive-bot.js)
        playerSpeed: Math.round(tb.lastMySpeed || 0),
        playerVel: [Math.round((tb.lastMyVel||{vx:0}).vx), Math.round((tb.lastMyVel||{vz:0}).vz)],
        dodgeActive: !!tb.lastDodgeActive,
        dodgeUrgency: tb.lastDodgeUrgency || 0,
        interceptActive: !!tb.lastInterceptActive,
        enemies: v.tanks.filter(function(t){return !t.isLocal && !t.dead;}).length,
        incomingShells: v.shells.filter(function(s){return String(s.o)!==myId;}).length
      });
      console.log('[TB] DEATH #' + tb.totalDeaths + ' cause=' + cause + ' wave=' + WANKLE.net.meta.wave + ' K=' + tb.totalKills + ' suspects=' + tb.selfKillSuspects);
    }
    if (me && !me.dead && tb.wasDead) {
      tb.wasDead = false;
      logEvent('respawn', {pos: me ? [Math.round(me.x), Math.round(me.z)] : null});
    }

    if (!me || me.dead) {
      if (!tb.respawnT) tb.respawnT = 0;
      if (now - tb.respawnT > 200) { WANKLE.input.fire = true; tb.respawnT = now; }
      else if (now - tb.respawnT > 100) { WANKLE.input.fire = false; }
      return;
    }

    var currentKills = WANKLE.net.meta.campaignKills;
    if (currentKills > tb.totalKills) {
      tb.totalKills = currentKills;
      logEvent('kill', {killNum: currentKills, wave: WANKLE.net.meta.wave, pos: [Math.round(me.x), Math.round(me.z)]});
    }

    var wave = WANKLE.net.meta.wave;
    if (wave > tb.lastWave) {
      var prevWave = tb.lastWave;
      tb.lastWave = wave;
      logEvent('wave', {from: prevWave, to: wave, tRel: now - tb.tStart});
    }

    if (me.health !== tb.lastHp) {
      if (me.health < tb.lastHp) logEvent('hp_loss', {from: tb.lastHp, to: me.health, pos: [Math.round(me.x), Math.round(me.z)]});
      tb.lastHp = me.health;
    }

    if (tb.lastPos) {
      var dx = me.x - tb.lastPos.x, dz = me.z - tb.lastPos.z;
      tb.totalDistance += Math.hypot(dx, dz);
    }
    tb.lastPos = {x: me.x, z: me.z};

    var enemies = v.tanks.filter(function(t){
      if (t.isLocal || t.dead) return false;
      return true;
    });
    if (enemies.length > tb.maxEnemies) tb.maxEnemies = enemies.length;

    var enemyDetails = enemies.map(function(e){
      var dx = e.x - me.x, dz = e.z - me.z;
      var dist = Math.hypot(dx, dz);
      var angleToMe = Math.atan2(dz, dx);
      var aimErr = Math.abs(((me.turretAngle - angleToMe + Math.PI*3) % (Math.PI*2)) - Math.PI);
      return {id: e.id, x: Math.round(e.x), z: Math.round(e.z), dist: Math.round(dist), aimErr: Math.round(aimErr * 1000) / 1000, team: e.team};
    }).sort(function(a,b){return a.dist - b.dist;});

    var myShells = v.shells.filter(function(s){return String(s.o) === String(WANKLE.net.playerId);});
    var incomingShells = v.shells.filter(function(s){return String(s.o) !== String(WANKLE.net.playerId);}).map(function(s){
      var dx = s.x - me.x, dz = s.z - me.z;
      return {x: Math.round(s.x), z: Math.round(s.z), dist: Math.round(Math.hypot(dx, dz))};
    });

    if (myShells.length > tb.lastMyShellCount) tb.shellsFired += (myShells.length - tb.lastMyShellCount);
    tb.lastMyShellCount = myShells.length;

    // ── SELF-KILL TRACKING (cheap: O(our_shells), max 5) ──
    // Track our own shells' positions to detect self-kills at death time.
    // Each tick: update tracker with current positions, compute velocity from
    // position delta, check if any are heading toward us.
    // Cost: ~5 distance + dot-product checks per tick = negligible.
    var myId = String(WANKLE.net.playerId);
    var newTracker = {};
    tb.selfKillSuspects = 0;
    for (var msi = 0; msi < myShells.length; msi++) {
      var ms = myShells[msi];
      var sid = String(ms.id);
      var prev = tb.myShellTracker[sid];
      var entry = {x: ms.x, z: ms.z, prevX: prev ? prev.x : ms.x, prevZ: prev ? prev.z : ms.z, t: now};
      // Compute velocity direction (from prev to current)
      var vx = entry.x - entry.prevX, vz = entry.z - entry.prevZ;
      var vlen = Math.hypot(vx, vz);
      if (vlen > 0.1) {
        // Normalize velocity
        vx /= vlen; vz /= vlen;
        // Direction from shell to player
        var dxp = me.x - entry.x, dzp = me.z - entry.z;
        var dpl = Math.hypot(dxp, dzp);
        if (dpl > 0.1) {
          dxp /= dpl; dzp /= dpl;
          // Dot product: 1.0 = heading directly at us, 0 = perpendicular, -1 = away
          var dot = vx * dxp + vz * dzp;
          entry.headingToUs = dot;
          entry.distToUs = dpl;
          // Suspect if heading toward us (dot > 0.5) and within 250u
          if (dot > 0.5 && dpl < 250) {
            tb.selfKillSuspects++;
            entry.isSuspect = true;
          }
        }
      }
      newTracker[sid] = entry;
    }
    tb.myShellTracker = newTracker;

    // ═══════════════════════════════════════════════════════════════
    //  NAVIGATION GRID + A* PATHFINDING
    // ═══════════════════════════════════════════════════════════════
    var tiles = v.tiles || [];
    var worldW = v.worldW || 1890;
    var worldH = v.worldH || 1400;
    var CS = tb.cellSize;  // 70
    var cols = Math.ceil(worldW / CS);
    var rows = Math.ceil(worldH / CS);

    // Build/rebuild nav grid (walkable = 1, blocked = 0)
    // v3.1: Use FINER grid (cellSize = 35, half of TILE=70) so 1-tile-wide
    // corridors are represented. With 70u cells, a 35u-wide corridor between
    // two walls would mark BOTH adjacent cells as blocked, making the corridor
    // unnavigable. With 35u cells, the corridor gets its own cell.
    // A cell is blocked if a tile's box covers the cell's CENTER point.
    // (Using center-point test instead of overlap test so partial overlaps
    // don't block cells that are mostly open.)
    function buildNavGrid() {
      var fineCS = CS / 2;  // 35u cells
      var fCols = Math.ceil(worldW / fineCS);
      var fRows = Math.ceil(worldH / fineCS);
      // Store fine grid params for A*
      tb.fineCS = fineCS;
      tb.fCols = fCols;
      tb.fRows = fRows;
      var grid = new Array(fRows);
      for (var r = 0; r < fRows; r++) {
        grid[r] = new Array(fCols).fill(1);
      }
      // Mark cells blocked: a cell is blocked if its center is inside any tile
      for (var ti = 0; ti < tiles.length; ti++) {
        var t = tiles[ti];
        var minCol = Math.floor((t.x - t.hw) / fineCS);
        var maxCol = Math.floor((t.x + t.hw) / fineCS);
        var minRow = Math.floor((t.z - t.hl) / fineCS);
        var maxRow = Math.floor((t.z + t.hl) / fineCS);
        for (var r = minRow; r <= maxRow; r++) {
          for (var c = minCol; c <= maxCol; c++) {
            if (r >= 0 && r < fRows && c >= 0 && c < fCols) {
              // Center-point test: is this cell's center inside the tile?
              var cx = c * fineCS + fineCS / 2;
              var cz = r * fineCS + fineCS / 2;
              if (cx >= t.x - t.hw && cx <= t.x + t.hw &&
                  cz >= t.z - t.hl && cz <= t.z + t.hl) {
                grid[r][c] = 0;
              }
            }
          }
        }
      }
      return grid;
    }

    // A* pathfinding: returns array of {cx, cz} cell centers, or null if no path
    // Uses a binary heap for O(log n) priority queue instead of linear scan.
    // Uses the FINE grid (tb.fCols × tb.fRows, cell size tb.fineCS=35).
    function astar(startCol, startRow, endCol, endRow, grid) {
      var fCols = tb.fCols, fRows = tb.fRows;
      if (startCol === endCol && startRow === endRow) return [{cx: startCol, cz: startRow}];
      if (endCol < 0 || endCol >= fCols || endRow < 0 || endRow >= fRows) return null;
      if (grid[endRow][endCol] === 0) {
        // End is blocked — find nearest walkable neighbor (search 4-cell radius)
        var foundEnd = null;
        var bestDist = Infinity;
        for (var dr = -4; dr <= 4; dr++) {
          for (var dc = -4; dc <= 4; dc++) {
            var nr = endRow + dr, nc = endCol + dc;
            if (nr >= 0 && nr < fRows && nc >= 0 && nc < fCols && grid[nr][nc] === 1) {
              var d = Math.abs(dr) + Math.abs(dc);
              if (d < bestDist) { bestDist = d; foundEnd = {col: nc, row: nr}; }
            }
          }
        }
        if (!foundEnd) return null;
        endCol = foundEnd.col;
        endRow = foundEnd.row;
      }

      // Binary heap (min-heap by f = g + h)
      var heap = [];
      function heapPush(node) {
        heap.push(node);
        var i = heap.length - 1;
        while (i > 0) {
          var parent = Math.floor((i - 1) / 2);
          if (heap[parent].g + heap[parent].h <= heap[i].g + heap[i].h) break;
          var tmp = heap[parent]; heap[parent] = heap[i]; heap[i] = tmp;
          i = parent;
        }
      }
      function heapPop() {
        if (heap.length === 0) return null;
        var top = heap[0];
        var last = heap.pop();
        if (heap.length > 0) {
          heap[0] = last;
          var i = 0;
          while (true) {
            var left = 2*i+1, right = 2*i+2, smallest = i;
            if (left < heap.length && heap[left].g + heap[left].h < heap[smallest].g + heap[smallest].h) smallest = left;
            if (right < heap.length && heap[right].g + heap[right].h < heap[smallest].g + heap[smallest].h) smallest = right;
            if (smallest === i) break;
            var tmp2 = heap[smallest]; heap[smallest] = heap[i]; heap[i] = tmp2;
            i = smallest;
          }
        }
        return top;
      }

      var startNode = {col: startCol, row: startRow, g: 0, h: Math.abs(startCol-endCol) + Math.abs(startRow-endRow), parent: null};
      heapPush(startNode);
      var closed = {};
      var openMap = {};
      openMap[startCol + ',' + startRow] = startNode;

      var iterations = 0;
      var maxIter = 12000;  // higher limit for fine grid (50×50 = 2500 cells)

      while (heap.length > 0 && iterations < maxIter) {
        iterations++;
        var current = heapPop();
        var curKey = current.col + ',' + current.row;
        if (closed[curKey]) continue;
        delete openMap[curKey];
        closed[curKey] = true;

        if (current.col === endCol && current.row === endRow) {
          var path = [];
          var node = current;
          while (node) {
            path.unshift({cx: node.col, cz: node.row});
            node = node.parent;
          }
          return path;
        }

        var neighbors = [
          {dc: 0, dr: -1}, {dc: 0, dr: 1}, {dc: -1, dr: 0}, {dc: 1, dr: 0},
          {dc: -1, dr: -1}, {dc: 1, dr: -1}, {dc: -1, dr: 1}, {dc: 1, dr: 1}
        ];
        for (var ni = 0; ni < neighbors.length; ni++) {
          var nc = current.col + neighbors[ni].dc;
          var nr = current.row + neighbors[ni].dr;
          if (nc < 0 || nc >= fCols || nr < 0 || nr >= fRows) continue;
          if (grid[nr][nc] === 0) continue;
          if (neighbors[ni].dc !== 0 && neighbors[ni].dr !== 0) {
            if (grid[current.row][nc] === 0 || grid[nr][current.col] === 0) continue;
          }
          var key = nc + ',' + nr;
          if (closed[key]) continue;
          var moveCost = (neighbors[ni].dc !== 0 && neighbors[ni].dr !== 0) ? 1.414 : 1.0;
          var g = current.g + moveCost;
          var existing = openMap[key];
          if (!existing || g < existing.g) {
            var h = Math.abs(nc - endCol) + Math.abs(nr - endRow);
            var node2 = {col: nc, row: nr, g: g, h: h, parent: current};
            heapPush(node2);
            openMap[key] = node2;
          }
        }
      }
      return null;
    }

    // Line-of-sight check (for holding position when we can see enemy)
    function hasLOS(x1, z1, x2, z2) {
      tb.losChecks++;
      var dx = x2 - x1, dz = z2 - z1;
      var dist = Math.hypot(dx, dz);
      if (dist < 1) return true;
      var ux = dx / dist, uz = dz / dist;
      for (var ti = 0; ti < tiles.length; ti++) {
        var t = tiles[ti];
        var tdx = t.x - x1, tdz = t.z - z1;
        if (Math.hypot(tdx, tdz) > dist + 60) continue;
        var minX = t.x - t.hw, maxX = t.x + t.hw;
        var minZ = t.z - t.hl, maxZ = t.z + t.hl;
        var tMinX, tMaxX, tMinZ, tMaxZ;
        if (Math.abs(ux) < 1e-9) {
          if (x1 < minX || x1 > maxX) continue;
          tMinX = -Infinity; tMaxX = Infinity;
        } else {
          tMinX = (minX - x1) / ux; tMaxX = (maxX - x1) / ux;
          if (tMinX > tMaxX) { var tmp = tMinX; tMinX = tMaxX; tMaxX = tmp; }
        }
        if (Math.abs(uz) < 1e-9) {
          if (z1 < minZ || z1 > maxZ) continue;
          tMinZ = -Infinity; tMaxZ = Infinity;
        } else {
          tMinZ = (minZ - z1) / uz; tMaxZ = (maxZ - z1) / uz;
          if (tMinZ > tMaxZ) { var tmp2 = tMinZ; tMinZ = tMaxZ; tMaxZ = tmp2; }
        }
        var tE = Math.max(tMinX, tMinZ), tX = Math.min(tMaxX, tMaxZ);
        if (tE <= tX && tE < dist && tE > 1) {
          tb.losBlocked++;
          return false;
        }
      }
      return true;
    }

    function releaseKeys() {
      for (var k in tb.keysDown) {
        window.dispatchEvent(new KeyboardEvent('keyup', {code: k, key: k, bubbles: true}));
      }
      tb.keysDown = {};
    }

    function moveToward(tx, tz) {
      var tdx = tx - me.x, tdz = tz - me.z;
      var tdist = Math.hypot(tdx, tdz);
      if (tdist < 30) { releaseKeys(); return false; }
      var yaw = WANKLE.R.camera.rig.yaw;
      var wx = tdx / tdist, wz = tdz / tdist;
      var right = Math.cos(yaw) * wx + Math.sin(yaw) * wz;
      var forward = -Math.sin(yaw) * wx + Math.cos(yaw) * wz;
      var newKeys = {};
      if (forward > 0.3) newKeys.KeyS = true;
      else if (forward < -0.3) newKeys.KeyW = true;
      if (right > 0.3) newKeys.KeyD = true;
      else if (right < -0.3) newKeys.KeyA = true;
      for (var k in tb.keysDown) {
        if (!newKeys[k]) {
          window.dispatchEvent(new KeyboardEvent('keyup', {code: k, key: k, bubbles: true}));
          delete tb.keysDown[k];
        }
      }
      for (var k2 in newKeys) {
        if (!tb.keysDown[k2]) {
          window.dispatchEvent(new KeyboardEvent('keydown', {code: k2, key: k2, bubbles: true}));
          tb.keysDown[k2] = true;
        }
      }
      return true;
    }

    // ═══════════════════════════════════════════════════════════════
    //  HUNTER LOGIC with A* PATHFINDING
    // ═══════════════════════════════════════════════════════════════
    var botAction = 'idle';
    var botTarget = null;

    if (enemies.length === 0) {
      releaseKeys();
      botAction = 'idle_no_enemies';
    } else {
      var nearest = enemyDetails[0];

      // Check LOS to nearest enemy
      var losToNearest = hasLOS(me.x, me.z, nearest.x, nearest.z);

      if (losToNearest) {
        // We have LOS! Hold position and let aimbot fire.
        if (nearest.dist < 150) {
          // Back away slightly if too close
          var awayX = me.x - nearest.x, awayZ = me.z - nearest.z;
          var awayLen = Math.hypot(awayX, awayZ);
          if (awayLen > 1) {
            moveToward(me.x + (awayX/awayLen) * 100, me.z + (awayZ/awayLen) * 100);
            botAction = 'backing_away';
          } else {
            releaseKeys();
            botAction = 'holding_los';
          }
        } else {
          releaseKeys();
          botAction = 'holding_los';
        }
      } else {
        // No LOS — use A* to find path to enemy
        // Rebuild nav grid every 3s (tiles can be destroyed, but not often)
        if (!tb.navGrid || now - tb.lastPathfindT > 3000) {
          tb.navGrid = buildNavGrid();
          tb.currentPath = null;
          tb.pathIndex = 0;
        }

        // Re-pathfind every 1.5s (enemies move — need to keep up)
        if (now - tb.lastPathfindT > 1500 || !tb.currentPath || tb.pathIndex >= tb.currentPath.length) {
          tb.lastPathfindT = now;
          tb.pathfinds++;
          var fineCS = tb.fineCS || 35;
          var myCol = Math.floor(me.x / fineCS);
          var myRow = Math.floor(me.z / fineCS);
          var enemyCol = Math.floor(nearest.x / fineCS);
          var enemyRow = Math.floor(nearest.z / fineCS);
          tb.currentPath = astar(myCol, myRow, enemyCol, enemyRow, tb.navGrid);
          tb.pathIndex = 0;
          if (tb.currentPath && tb.currentPath.length > 1) {
            tb.pathIndex = 1;  // skip current cell
          }
          if (tb.currentPath) {
            logEvent('pathfind', {pathLen: tb.currentPath.length, enemyDist: nearest.dist});
          } else {
            tb.pathAborts++;
          }
        }

        if (tb.currentPath && tb.pathIndex < tb.currentPath.length) {
          // Move toward current waypoint (cell center, using fineCS)
          var fineCS2 = tb.fineCS || 35;
          var waypoint = tb.currentPath[tb.pathIndex];
          var wx = waypoint.cx * fineCS2 + fineCS2 / 2;
          var wz = waypoint.cz * fineCS2 + fineCS2 / 2;
          var wdist = Math.hypot(wx - me.x, wz - me.z);
          // Use larger arrival threshold (1.0 * fineCS = 35u) so bot advances
          // through waypoints faster without stopping at each one
          if (wdist < fineCS2 * 1.0) {
            // Reached this waypoint, advance to next
            tb.pathIndex++;
            // Skip ahead through collinear waypoints (faster movement on straight paths)
            while (tb.pathIndex + 1 < tb.currentPath.length) {
              var cur = tb.currentPath[tb.pathIndex];
              var next = tb.currentPath[tb.pathIndex + 1];
              var prev = tb.currentPath[tb.pathIndex - 1];
              // Check if prev->cur->next are collinear (within 0.2 rad)
              var v1x = cur.cx - prev.cx, v1z = cur.cz - prev.cz;
              var v2x = next.cx - cur.cx, v2z = next.cz - cur.cz;
              var cross = v1x * v2z - v1z * v2x;
              var dot = v1x * v2x + v1z * v2z;
              var angle = Math.abs(Math.atan2(cross, dot));
              if (angle < 0.3) {
                tb.pathIndex++;  // skip collinear waypoint
              } else {
                break;
              }
            }
            if (tb.pathIndex < tb.currentPath.length) {
              var nextWp = tb.currentPath[tb.pathIndex];
              wx = nextWp.cx * fineCS2 + fineCS2 / 2;
              wz = nextWp.cz * fineCS2 + fineCS2 / 2;
              moveToward(wx, wz);
              botAction = 'following_path';
              botTarget = {x: Math.round(wx), z: Math.round(wz), wpIdx: tb.pathIndex, pathLen: tb.currentPath.length, enemyDist: nearest.dist};
            } else {
              releaseKeys();
              botAction = 'path_end';
            }
          } else {
            moveToward(wx, wz);
            botAction = 'following_path';
            botTarget = {x: Math.round(wx), z: Math.round(wz), wpIdx: tb.pathIndex, pathLen: tb.currentPath.length, enemyDist: nearest.dist};
          }
        } else {
          // No path found — fall back to direct movement
          moveToward(nearest.x, nearest.z);
          botAction = 'no_path_direct';
          botTarget = {x: nearest.x, z: nearest.z, enemyDist: nearest.dist};
        }
      }
    }

    // ── Per-second sample ──
    if (now - tb.lastSampleT > 1000) {
      tb.lastSampleT = now;
      var aimErr = enemyDetails.length > 0 ? enemyDetails[0].aimErr : null;
      window._tbLog.push({
        kind: 'sample', t: now, tRel: now - tb.tStart,
        pos: [Math.round(me.x), Math.round(me.z)], turret: Math.round(me.turretAngle * 1000) / 1000,
        hp: me.health, dead: !!me.dead,
        wave: wave, kills: tb.totalKills, deaths: tb.totalDeaths,
        enemies: enemies.length, nearestEnemyDist: enemyDetails.length > 0 ? enemyDetails[0].dist : null,
        aimErr: aimErr, myShells: myShells.length, incomingShells: incomingShells.length,
        nearestShellDist: incomingShells.length > 0 ? Math.min.apply(null, incomingShells.map(function(s){return s.dist;})) : null,
        ping: WANKLE.net.ping || 0, interpMs: Math.round(WANKLE.net.interpDelayMs || 65),
        fps: Math.round(tb.rafFps * 10) / 10,
        botMode: MODE, botAction: botAction, botTarget: botTarget,
        totalDistance: Math.round(tb.totalDistance), shellsFired: tb.shellsFired,
        maxEnemies: tb.maxEnemies,
        losChecks: tb.losChecks, losBlocked: tb.losBlocked,
        pathfinds: tb.pathfinds, pathAborts: tb.pathAborts,
        selfKillSuspects: tb.selfKillSuspects,
        pathLen: tb.currentPath ? tb.currentPath.length : 0, pathIdx: tb.pathIndex,
        // ENHANCED telemetry (same as passive-bot.js)
        playerSpeed: Math.round(tb.lastMySpeed),
        dodgeActive: tb.lastDodgeActive, dodgeUrgency: tb.lastDodgeUrgency,
        interceptActive: tb.lastInterceptActive
      });
    }

    if (now - tb.lastLogT > 2000) {
      tb.lastLogT = now;
      console.log('[TB ' + MODE + '] K=' + tb.totalKills + ' D=' + tb.totalDeaths + ' w=' + wave + ' hp=' + me.health + ' E=' + enemies.length + ' fps=' + (tb.rafFps?tb.rafFps.toFixed(1):'0') + ' action=' + botAction + ' pos=[' + Math.round(me.x) + ',' + Math.round(me.z) + ']');
    }
  } catch(e) { console.error('[TB] ERROR:', e.message); }
})()
