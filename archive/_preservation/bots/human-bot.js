// Wankle3D Human-Like Bot — strafes, feints, retreats like a human player
// For testing the cheat against human-like movement patterns
(function(){
  try {
    if (!window.WANKLE || !WANKLE.net || !WANKLE.R) return;
    var v = WANKLE.net.buildView(0);
    var me = null;
    for (var i = 0; i < v.tanks.length; i++) if (v.tanks[i].isLocal) { me = v.tanks[i]; break; }
    var now = Date.now();
    if (!window._hb) {
      window._hb = {
        totalKills: 0, totalDeaths: 0, wasDead: false,
        lastHp: 1, lastWave: 0, lastSampleT: 0, lastLogT: 0, tStart: now,
        keysDown: {}, rafCount: 0, rafStart: 0, rafFps: 0,
        maxEnemies: 0, shellsFired: 0, lastMyShellCount: 0, totalDistance: 0,
        lastPos: me ? {x: me.x, z: me.z} : null,
        // Human-like movement state
        strafeDir: 1, strafeT: 0, strafeInterval: 1500 + Math.random() * 1000,
        feintT: 0, feintCooldown: 3000 + Math.random() * 2000,
        retreatT: 0, isRetreating: false,
        targetEnemy: null, lastRetargetT: 0,
      };
      window._hbLog = [];
      (function loop(){
        var hb = window._hb; if (!hb) return;
        if (hb.rafStart === 0) hb.rafStart = performance.now();
        hb.rafCount++;
        var dt = performance.now() - hb.rafStart;
        if (dt > 500) { hb.rafFps = hb.rafCount/(dt/1000); hb.rafCount=0; hb.rafStart=performance.now(); }
        requestAnimationFrame(loop);
      })();
      window._hbLog.push({kind:'event', sub:'boot', t: now, tRel: 0, mode: 'human'});
    }
    var hb = window._hb;
    function logEvent(sub, extra) {
      window._hbLog.push(Object.assign({kind:'event', sub:sub, t:now, tRel:now-hb.tStart}, extra||{}));
    }
    // Death tracking with attribution
    if (me && me.dead && !hb.wasDead) {
      hb.totalDeaths++; hb.wasDead = true;
      var myId = String(WANKLE.net.playerId);
      var killer = null;
      var allShells = v.shells || [];
      for (var si=0; si<allShells.length; si++) {
        var s = allShells[si]; var sd = Math.hypot(s.x-me.x, s.z-me.z);
        if (sd < 80) { killer = {isOwn: String(s.o)===myId, dist:Math.round(sd)}; break; }
      }
      logEvent('death', {deathNum:hb.totalDeaths, wave:WANKLE.net.meta.wave, kills:hb.totalKills, cause: killer ? (killer.isOwn?'self_shell':'enemy_shell') : 'unknown'});
    }
    if (me && !me.dead && hb.wasDead) { hb.wasDead=false; logEvent('respawn'); }
    if (!me || me.dead) {
      if (!hb.respawnT) hb.respawnT=0;
      if (now-hb.respawnT>200) { WANKLE.input.fire=true; hb.respawnT=now; }
      else if (now-hb.respawnT>100) { WANKLE.input.fire=false; }
      return;
    }
    // Kill tracking via scoreboard (FFA-compatible)
    var scores = WANKLE.net.meta.scores || [];
    var myScore = scores.find(function(s){return String(s.id)===String(WANKLE.net.playerId);});
    if (myScore && myScore.kills > hb.totalKills) {
      hb.totalKills = myScore.kills;
      logEvent('kill', {killNum: hb.totalKills});
    }
    var wave = WANKLE.net.meta.wave;
    if (wave > hb.lastWave) { var pw=hb.lastWave; hb.lastWave=wave; logEvent('wave',{from:pw,to:wave}); }
    if (me.health !== hb.lastHp) { if (me.health < hb.lastHp) logEvent('hp_loss',{from:hb.lastHp,to:me.health}); hb.lastHp=me.health; }
    if (hb.lastPos) { var dx=me.x-hb.lastPos.x, dz=me.z-hb.lastPos.z; hb.totalDistance+=Math.hypot(dx,dz); }
    hb.lastPos = {x:me.x, z:me.z};
    var enemies = v.tanks.filter(function(t){return !t.isLocal && !t.dead;});
    if (enemies.length > hb.maxEnemies) hb.maxEnemies = enemies.length;
    var myShells = v.shells.filter(function(s){return String(s.o)===String(WANKLE.net.playerId);});
    if (myShells.length > hb.lastMyShellCount) hb.shellsFired += (myShells.length - hb.lastMyShellCount);
    hb.lastMyShellCount = myShells.length;
    var incomingShells = v.shells.filter(function(s){return String(s.o)!==String(WANKLE.net.playerId);});
    var tiles = v.tiles || [];
    var yaw = WANKLE.R.camera.rig.yaw;

    // ═══════════════════════════════════════════════════════════════
    //  HUMAN-LIKE MOVEMENT
    // ═══════════════════════════════════════════════════════════════
    var botAction = 'idle';
    var nearest = null, nd = Infinity;
    for (var i=0; i<enemies.length; i++) {
      var d = Math.hypot(enemies[i].x-me.x, enemies[i].z-me.z);
      if (d < nd) { nd = d; nearest = enemies[i]; }
    }

    function releaseKeys() { for (var k in hb.keysDown) window.dispatchEvent(new KeyboardEvent('keyup',{code:k,key:k,bubbles:true})); hb.keysDown={}; }
    function pressKeys(keys) {
      var newKeys = {};
      for (var i=0; i<keys.length; i++) newKeys[keys[i]] = true;
      for (var k in hb.keysDown) { if (!newKeys[k]) window.dispatchEvent(new KeyboardEvent('keyup',{code:k,key:k,bubbles:true})); delete hb.keysDown[k]; }
      for (var k in newKeys) { if (!hb.keysDown[k]) { window.dispatchEvent(new KeyboardEvent('keydown',{code:k,key:k,bubbles:true})); hb.keysDown[k]=true; } }
    }
    function moveToward(tx, tz) {
      var tdx=tx-me.x, tdz=tz-me.z, tdist=Math.hypot(tdx,tdz);
      if (tdist<30) { releaseKeys(); return false; }
      var wx=tdx/tdist, wz=tdz/tdist;
      var right=Math.cos(yaw)*wx+Math.sin(yaw)*wz, forward=-Math.sin(yaw)*wx+Math.cos(yaw)*wz;
      var keys=[];
      if (forward>0.3) keys.push('KeyS'); else if (forward<-0.3) keys.push('KeyW');
      if (right>0.3) keys.push('KeyD'); else if (right<-0.3) keys.push('KeyA');
      pressKeys(keys); return true;
    }
    function strafe(dir) {
      // Strafe perpendicular to enemy direction
      if (!nearest) { releaseKeys(); return; }
      var edx = nearest.x - me.x, edz = nearest.z - me.z;
      var elen = Math.hypot(edx, edz);
      if (elen < 1) { releaseKeys(); return; }
      // Perpendicular vector
      var px = -edz/elen * dir, pz = edx/elen * dir;
      var right = Math.cos(yaw)*px + Math.sin(yaw)*pz;
      var forward = -Math.sin(yaw)*px + Math.cos(yaw)*pz;
      var keys = [];
      if (forward > 0.3) keys.push('KeyS'); else if (forward < -0.3) keys.push('KeyW');
      if (right > 0.3) keys.push('KeyD'); else if (right < -0.3) keys.push('KeyA');
      pressKeys(keys);
    }

    if (enemies.length === 0) { releaseKeys(); botAction='idle'; }
    else {
      // Check for incoming shells — retreat if close
      var urgentShell = null;
      for (var si2=0; si2<incomingShells.length; si2++) {
        var is = incomingShells[si2];
        var isd = Math.hypot(is.x-me.x, is.z-me.z);
        if (isd < 200) { urgentShell = is; break; }
      }

      if (urgentShell && nd < 400) {
        // Retreat from nearest enemy while shell is close
        var rx = me.x - nearest.x, rz = me.z - nearest.z;
        var rlen = Math.hypot(rx, rz);
        if (rlen > 1) { moveToward(me.x + rx/rlen*150, me.z + rz/rlen*150); botAction='retreat'; }
        else { releaseKeys(); botAction='retreat_hold'; }
      } else if (nd < 300) {
        // Close range — strafe
        if (now - hb.strafeT > hb.strafeInterval) {
          hb.strafeDir = -hb.strafeDir;
          hb.strafeT = now;
          hb.strafeInterval = 800 + Math.random() * 1200;
        }
        strafe(hb.strafeDir);
        botAction = 'strafe';
      } else if (nd > 800) {
        // Far — approach
        moveToward(nearest.x, nearest.z);
        botAction = 'approach';
      } else {
        // Medium range — strafe + occasional approach
        if (Math.random() < 0.3) { moveToward(nearest.x, nearest.z); botAction='approach'; }
        else {
          if (now - hb.strafeT > hb.strafeInterval) {
            hb.strafeDir = -hb.strafeDir; hb.strafeT = now;
            hb.strafeInterval = 1000 + Math.random() * 1500;
          }
          strafe(hb.strafeDir); botAction='strafe';
        }
      }
    }

    // Per-second sample
    if (now - hb.lastSampleT > 1000) {
      hb.lastSampleT = now;
      var aimErr = null;
      if (nearest) {
        var angleToMe = Math.atan2(nearest.z-me.z, nearest.x-me.x);
        aimErr = Math.abs(((me.turretAngle - angleToMe + Math.PI*3) % (Math.PI*2)) - Math.PI);
      }
      window._hbLog.push({
        kind:'sample', t:now, tRel:now-hb.tStart,
        pos:[Math.round(me.x),Math.round(me.z)], turret:Math.round(me.turretAngle*1000)/1000,
        hp:me.health, dead:!!me.dead, wave:wave, kills:hb.totalKills, deaths:hb.totalDeaths,
        enemies:enemies.length, nearestEnemyDist:nearest?Math.round(nd):null,
        aimErr:aimErr, myShells:myShells.length, incomingShells:incomingShells.length,
        fps:Math.round(hb.rafFps*10)/10, botMode:'human', botAction:botAction,
        totalDistance:Math.round(hb.totalDistance), shellsFired:hb.shellsFired, maxEnemies:hb.maxEnemies
      });
    }
  } catch(e) { console.error('[HB] ERROR:', e.message); }
})()
