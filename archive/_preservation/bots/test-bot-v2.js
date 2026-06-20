// Wankle3D Test Bot v2 — robust pathfinding, rich telemetry, wall avoidance, ally filtering
(function(){
  try {
    // Verify cheat is loaded
    if (!window.WANKLE || !WANKLE.net || !WANKLE.R) return;
    
    var v = WANKLE.net.buildView(0);
    var me = null;
    for (var i = 0; i < v.tanks.length; i++) if (v.tanks[i].isLocal) { me = v.tanks[i]; break; }
    var now = Date.now();
    
    if (!window._bt2) {
      window._bt2 = {
        posHistory: [], stuckCount: 0, lastStuckT: 0,
        totalKills: 0, totalDeaths: 0, wasDead: false,
        lastLogT: 0, shellsFired: 0, lastShellCount: 0,
        levelStartT: now, lastLevel: -1
      };
    }
    var bt = window._bt2;
    
    // Death tracking
    if (me && me.dead && !bt.wasDead) {
      bt.totalDeaths++;
      bt.wasDead = true;
      console.log('[BOT] DEATH #' + bt.totalDeaths + ' at L' + WANKLE.net.meta.levelIndex + ' K=' + bt.totalKills);
    }
    if (me && !me.dead && bt.wasDead) {
      bt.wasDead = false;
      console.log('[BOT] RESPAWNED');
    }
    
    // Dead — pulse fire for respawn
    if (!me || me.dead) {
      if (!bt.respawnT) bt.respawnT = 0;
      if (now - bt.respawnT > 200) { WANKLE.input.fire = true; bt.respawnT = now; }
      else if (now - bt.respawnT > 100) { WANKLE.input.fire = false; }
      return;
    }
    
    // Track kills
    var currentKills = WANKLE.net.meta.campaignKills;
    if (currentKills > bt.totalKills) {
      console.log('[BOT] KILL #' + currentKills);
      bt.totalKills = currentKills;
    }
    
    // Track level
    var level = WANKLE.net.meta.levelIndex;
    if (level !== bt.lastLevel) {
      if (bt.lastLevel >= 0) {
        console.log('[BOT] LEVEL ' + bt.lastLevel + '->' + level + ' (' + ((now - bt.levelStartT)/1000).toFixed(1) + 's)');
      }
      bt.lastLevel = level;
      bt.levelStartT = now;
    }
    
    // Find ENEMIES ONLY (filter out allies and bots on our team)
    var enemies = v.tanks.filter(function(t) {
      if (t.isLocal || t.dead) return false;
      // Ignore allies (same team, team >= 0 and not 99)
      if (typeof t.team === 'number' && typeof me.team === 'number' &&
          me.team >= 0 && t.team === me.team && t.team !== 99) return false;
      return true;
    });
    
    if (!enemies.length) {
      WANKLE.input.fire = false;
      ['KeyW','KeyA','KeyS','KeyD'].forEach(function(k){
        window.dispatchEvent(new KeyboardEvent('keyup', {code: k, key: k, bubbles: true}));
      });
      return;
    }
    
    // Find nearest enemy
    var tgt = enemies[0], nd = Infinity;
    for (var i = 0; i < enemies.length; i++) {
      var d = Math.hypot(enemies[i].x - me.x, enemies[i].z - me.z);
      if (d < nd) { nd = d; tgt = enemies[i]; }
    }
    
    // Stuck detection
    bt.posHistory.push({x: me.x, z: me.z, t: now});
    while (bt.posHistory.length > 8) bt.posHistory.shift();
    var isStuck = false;
    if (bt.posHistory.length >= 4) {
      var oldest = bt.posHistory[0];
      var totalMoved = Math.hypot(me.x - oldest.x, me.z - oldest.z);
      if (totalMoved < 20 && (now - oldest.t) > 2000) { isStuck = true; bt.stuckCount++; }
      else if (totalMoved > 50) bt.stuckCount = 0;
    }
    
    // Movement with wall avoidance
    var dx = tgt.x - me.x, dz = tgt.z - me.z;
    var dist = Math.hypot(dx, dz);
    if (dist < 1) dist = 1;
    var wx = dx / dist, wz = dz / dist;
    var yaw = WANKLE.R.camera.rig.yaw;
    
    // Wall check ahead
    var lookAhead = 80;
    var probeX = me.x + wx * lookAhead;
    var probeZ = me.z + wz * lookAhead;
    var blocked = false;
    for (var ti = 0; ti < v.tiles.length; ti++) {
      var t = v.tiles[ti];
      if (Math.abs(probeX - t.x) < t.hw + 25 && Math.abs(probeZ - t.z) < t.hl + 25) { blocked = true; break; }
    }
    
    if (isStuck || (blocked && dist > 100)) {
      var leftX = -wz, leftZ = wx;
      var rightX = wz, rightZ = -wx;
      var leftBlocked = false, rightBlocked = false;
      for (var ti2 = 0; ti2 < v.tiles.length; ti2++) {
        var t2 = v.tiles[ti2];
        if (!leftBlocked && Math.abs((me.x + leftX * lookAhead) - t2.x) < t2.hw + 25 && Math.abs((me.z + leftZ * lookAhead) - t2.z) < t2.hl + 25) leftBlocked = true;
        if (!rightBlocked && Math.abs((me.x + rightX * lookAhead) - t2.x) < t2.hw + 25 && Math.abs((me.z + rightZ * lookAhead) - t2.z) < t2.hl + 25) rightBlocked = true;
        if (leftBlocked && rightBlocked) break;
      }
      if (!leftBlocked) { wx = leftX; wz = leftZ; }
      else if (!rightBlocked) { wx = rightX; wz = rightZ; }
      else { wx = -wx; wz = -wz; }
    }
    
    var right = Math.cos(yaw) * wx + Math.sin(yaw) * wz;
    var forward = -Math.sin(yaw) * wx + Math.cos(yaw) * wz;
    var keysToPress = [];
    if (forward > 0.3) keysToPress.push('KeyS');
    else if (forward < -0.3) keysToPress.push('KeyW');
    if (right > 0.3) keysToPress.push('KeyD');
    else if (right < -0.3) keysToPress.push('KeyA');
    
    var allKeys = ['KeyW','KeyA','KeyS','KeyD'];
    for (var k = 0; k < allKeys.length; k++) {
      if (keysToPress.indexOf(allKeys[k]) === -1) {
        window.dispatchEvent(new KeyboardEvent('keyup', {code: allKeys[k], key: allKeys[k], bubbles: true}));
      }
    }
    for (var k = 0; k < keysToPress.length; k++) {
      window.dispatchEvent(new KeyboardEvent('keydown', {code: keysToPress[k], key: keysToPress[k], bubbles: true}));
    }
    
    // Don't hold fire — triggerbot handles it
    WANKLE.input.fire = false;
    
    // Telemetry every 2s
    if (now - bt.lastLogT > 2000) {
      bt.lastLogT = now;
      var myShells = v.shells.filter(function(s){return String(s.o)===String(WANKLE.net.playerId);}).length;
      console.log('[BOT] L' + level + ' K=' + bt.totalKills + ' D=' + bt.totalDeaths +
        ' hp=' + me.health + ' E=' + enemies.length + ' dist=' + Math.round(nd) +
        ' shells=' + myShells + ' stuck=' + bt.stuckCount);
    }
  } catch(e) {
    console.error('[BOT] ERROR:', e.message);
  }
})()
