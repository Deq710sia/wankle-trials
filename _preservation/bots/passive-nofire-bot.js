// Wankle3D Passive Bot — sits still, auto-respawns, full JSONL telemetry
// Enhanced death telemetry: killer ID, shell speed, player velocity at death,
// dodge/intercept status at death, position, wave, kill count
(function(){
  try {
    if (!window.WANKLE || !WANKLE.net || !WANKLE.R) return;
    var v = WANKLE.net.buildView(0);
    var me = null;
    for (var i = 0; i < v.tanks.length; i++) if (v.tanks[i].isLocal) { me = v.tanks[i]; break; }
    var now = Date.now();
    if (!window._pb) {
      window._pb = {
        totalKills: 0, totalDeaths: 0, wasDead: false,
        lastHp: 1, lastWave: 0, lastSampleT: 0, lastLogT: 0, tStart: now,
        rafCount: 0, rafStart: 0, rafFps: 0, rafTimes: [],
        maxEnemies: 0, shellsFired: 0, lastMyShellCount: 0,
        samples: [],
        // Enhanced death telemetry
        lastDodgeActive: false, lastDodgeUrgency: 0,
        lastInterceptActive: false, lastFireT: 0,
        lastMyVel: {vx: 0, vz: 0}, lastMySpeed: 0,
        // v23: timing telemetry
        lastSpawnT: now,         // timestamp of last respawn (or boot)
        lastDodgeStartT: 0,      // when dodge last activated
        lastDodgeEndT: 0,        // when dodge last deactivated
        prevDodgeActive: false,  // for detecting dodge start/stop transitions
        knownShellIds: {},       // shellId → first-seen timestamp (for shell age tracking)
        lastDodgeMoveX: 0,       // dodge direction vector at last sample
        lastDodgeMoveZ: 0,
      };
      window._pbLog = [];
      (function loop(){ var pb=window._pb; if(!pb)return; if(pb.rafStart===0)pb.rafStart=performance.now(); pb.rafCount++; var dt=performance.now()-pb.rafStart; if(dt>500){pb.rafFps=pb.rafCount/(dt/1000);pb.rafTimes.push(pb.rafFps);while(pb.rafTimes.length>60)pb.rafTimes.shift();pb.rafCount=0;pb.rafStart=performance.now();} requestAnimationFrame(loop); })();
      window._pbLog.push({kind:'event',sub:'boot',t:now,tRel:0,mode:'passive'});
    }
    var pb = window._pb;
    function logEvent(sub, extra) { window._pbLog.push(Object.assign({kind:'event',sub:sub,t:now,tRel:now-pb.tStart}, extra||{})); }

    // Track player velocity
    if (me) {
      var myVel = (typeof getVel === 'function') ? getVel(me.id) : {vx:0, vz:0};
      pb.lastMyVel = myVel;
      pb.lastMySpeed = Math.hypot(myVel.vx, myVel.vz);
    }

    // Track dodge/intercept status from cheat's state
    // v22.3: cheat exposes debug on window._wklDodgeDebug (the closure-scope vars
    // like lastDodgeVec aren't accessible to the bot, which is why old trials showed 0% dodge).
    var dodgeDb = window._wklDodgeDebug;
    if (dodgeDb && dodgeDb.lastDodgeVec) {
      pb.lastDodgeActive = true;
      pb.lastDodgeUrgency = dodgeDb.lastDodgeVec.urgency || 0;
      pb.lastDodgeMoveX = dodgeDb.lastDodgeVec.moveX || 0;
      pb.lastDodgeMoveZ = dodgeDb.lastDodgeVec.moveZ || 0;
      // v22.3 cold-spot specific telemetry
      pb.lastColdSpotReactive = dodgeDb.lastColdSpot ? dodgeDb.lastColdSpot.reactive : null;
      pb.lastColdSpotStrategic = dodgeDb.lastColdSpot ? dodgeDb.lastColdSpot.strategic : null;
      pb.lastPredictedShellCount = dodgeDb.predictedShellCount || 0;
      pb.lastRealShellCount = dodgeDb.realShellCount || 0;
      pb.lastDodgeGuardViolated = !!(dodgeDb.guardViolated);
    } else {
      pb.lastDodgeActive = false;
      pb.lastDodgeUrgency = 0;
      pb.lastDodgeMoveX = 0;
      pb.lastDodgeMoveZ = 0;
    }
    // v25: path-segment guard telemetry
    var pathG = window._wklPathGuard;
    pb.lastPathGuardCrosses = pathG ? !!pathG.crossesAny : false;
    pb.lastPathGuardRotation = pathG ? (pathG.rotation || 0) : 0;
    pb.lastPathGuardResolved = pathG ? !!pathG.resolved : false;
    pb.lastPathGuardShells = pathG ? (pathG.shellsChecked || 0) : 0;
    
    // v23: Track dodge start/stop transitions
    if (pb.lastDodgeActive && !pb.prevDodgeActive) {
      pb.lastDodgeStartT = now;
      logEvent('dodge_start', {t: now, tRel: now - pb.tStart});
    } else if (!pb.lastDodgeActive && pb.prevDodgeActive) {
      pb.lastDodgeEndT = now;
      var dodgeDuration = (pb.lastDodgeEndT - pb.lastDodgeStartT) / 1000;
      logEvent('dodge_end', {t: now, tRel: now - pb.tStart, durationS: Math.round(dodgeDuration * 100) / 100});
    }
    pb.prevDodgeActive = pb.lastDodgeActive;
    
    // v23: Track new incoming shells (for shell arrival timing)
    if (me && !me.dead) {
      var allShellsNow = v.shells || [];
      var myIdStr = String(WANKLE.net.playerId);
      for (var nsi = 0; nsi < allShellsNow.length; nsi++) {
        var ns = allShellsNow[nsi];
        if (String(ns.o) === myIdStr) continue;  // skip own
        var sid = String(ns.id);
        if (!pb.knownShellIds[sid]) {
          // New incoming shell detected
          var nsDist = Math.hypot(ns.x - me.x, ns.z - me.z);
          var nsSpd = (typeof getShellSpeed === 'function') ? getShellSpeed(ns.id, ns.type) : 320;
          var nsETA = nsDist / nsSpd;  // estimated time to impact in seconds
          pb.knownShellIds[sid] = {firstSeenT: now, firstDist: Math.round(nsDist), eta: Math.round(nsETA * 1000) / 1000};
          logEvent('shell_detected', {
            shellId: sid, dist: Math.round(nsDist), eta: Math.round(nsETA * 1000) / 1000,
            shellType: ns.type || 'normal', tRel: now - pb.tStart
          });
        }
      }
      // Clean up gone shells
      var currentIds = allShellsNow.filter(function(s){return String(s.o) !== myIdStr;}).map(function(s){return String(s.id);});
      for (var k in pb.knownShellIds) {
        if (currentIds.indexOf(k) < 0) delete pb.knownShellIds[k];
      }
    }
    // Legacy fallback for old cheat versions (still reads closure-scope — usually undefined)
    if (typeof lastDodgeVec !== 'undefined' && lastDodgeVec) {
      pb.lastDodgeActive = true;
      pb.lastDodgeUrgency = lastDodgeVec.urgency || 0;
    }
    if (typeof cachedInterceptTgt !== 'undefined') {
      pb.lastInterceptActive = !!cachedInterceptTgt;
    }

    // Death tracking with ENHANCED telemetry
    if (me && me.dead && !pb.wasDead) {
      pb.totalDeaths++; pb.wasDead = true;
      var myId = String(WANKLE.net.playerId);
      var killer = null;
      var allShells = v.shells || [];
      // v23: spawn-to-death time
      var spawnToDeathMs = now - pb.lastSpawnT;
      var spawnToDeathS = Math.round(spawnToDeathMs / 100) / 10;
      // Find the killing shell
      for (var si=0; si<allShells.length; si++) {
        var s = allShells[si]; var sd = Math.hypot(s.x-me.x, s.z-me.z);
        if (sd < 80) {
          var isOwn = String(s.o) === myId;
          var shellSpd = (typeof getShellSpeed === 'function') ? getShellSpeed(s.id, s.type) : 320;
          // v23: check if we tracked this shell's first detection
          var shellAge = pb.knownShellIds[String(s.id)] ? (now - pb.knownShellIds[String(s.id)].firstSeenT) / 1000 : -1;
          // v23: was player moving toward the shell?
          var shellDirX = (s.x - me.x) / (sd || 1), shellDirZ = (s.z - me.z) / (sd || 1);
          var moveTowardShell = (pb.lastMyVel.vx * shellDirX + pb.lastMyVel.vz * shellDirZ) > 0;
          // v23: was dodge direction toward the shell?
          var dodgeTowardShell = (pb.lastDodgeMoveX * shellDirX + pb.lastDodgeMoveZ * shellDirZ) > 0.3;
          killer = {
            ownerId: String(s.o), isOwnShell: isOwn,
            dist: Math.round(sd), shellSpeed: shellSpd,
            shellPos: [Math.round(s.x), Math.round(s.z)],
            shellType: s.type || 'normal',
            shellAgeS: Math.round(shellAge * 100) / 100,
            playerMovingTowardShell: moveTowardShell,
            dodgeTowardShell: dodgeTowardShell
          };
          break;
        }
      }
      // Check mines
      if (!killer) {
        var allMines = v.mines || [];
        for (var mi=0; mi<allMines.length; mi++) {
          var m = allMines[mi];
          if (m.e) { var md = Math.hypot(m.x-me.x, m.z-me.z); if (md < 200) { killer = {type:'mine', dist:Math.round(md), minePos:[Math.round(m.x),Math.round(m.z)]}; break; } }
        }
      }
      var cause = killer ? (killer.isOwnShell ? 'self_shell' : (killer.type === 'mine' ? 'mine' : 'enemy_shell')) : 'unknown';
      logEvent('death', {
        deathNum: pb.totalDeaths, wave: WANKLE.net.meta.wave, kills: pb.totalKills,
        pos: [Math.round(me.x), Math.round(me.z)],
        cause: cause, killer: killer,
        // Enhanced telemetry
        playerSpeed: Math.round(pb.lastMySpeed),
        playerVel: [Math.round(pb.lastMyVel.vx), Math.round(pb.lastMyVel.vz)],
        dodgeActive: pb.lastDodgeActive, dodgeUrgency: pb.lastDodgeUrgency,
        dodgeMoveX: Math.round(pb.lastDodgeMoveX * 100) / 100,
        dodgeMoveZ: Math.round(pb.lastDodgeMoveZ * 100) / 100,
        interceptActive: pb.lastInterceptActive,
        timeSinceLastFire: pb.lastFireT > 0 ? now - pb.lastFireT : -1,
        enemies: v.tanks.filter(function(t){return !t.isLocal && !t.dead;}).length,
        incomingShells: v.shells.filter(function(s){return String(s.o)!==myId;}).length,
        // v23: timing telemetry
        spawnToDeathS: spawnToDeathS,
        dodgeDurationS: pb.lastDodgeStartT > 0 ? Math.round((now - pb.lastDodgeStartT) / 100) / 10 : 0,
        shellAgeS: killer && killer.shellAgeS !== undefined ? killer.shellAgeS : -1,
        playerMovingTowardShell: killer ? !!killer.playerMovingTowardShell : false,
        dodgeTowardShell: killer ? !!killer.dodgeTowardShell : false
      });
      console.log('[PB] DEATH #' + pb.totalDeaths + ' cause=' + cause + ' spawnToDeath=' + spawnToDeathS + 's dodge=' + pb.lastDodgeActive + ' dodgeTowardShell=' + (killer ? killer.dodgeTowardShell : false));
    }
    // v23: Track respawn with timestamp
    if (me && !me.dead && pb.wasDead) {
      pb.wasDead = false;
      pb.lastSpawnT = now;
      logEvent('spawn', {pos: [Math.round(me.x), Math.round(me.z)], tRel: now - pb.tStart});
    }

    if (!me || me.dead) {
      if (!pb.respawnT) pb.respawnT = 0;
      // v22.5: NOFIRE — don't set WANKLE.input.fire. Cheat's auto-respawn handles it.
      if (now - pb.respawnT > 200) { pb.respawnT = now; }
      return;
    }

    // Kill tracking via scoreboard (FFA compatible) + campaignKills (survival)
    var scores = WANKLE.net.meta.scores || [];
    var myScore = scores.find(function(s){return String(s.id)===String(WANKLE.net.playerId);});
    var currentKills = myScore ? myScore.kills : WANKLE.net.meta.campaignKills;
    if (currentKills > pb.totalKills) { pb.totalKills = currentKills; logEvent('kill', {killNum: currentKills, wave: WANKLE.net.meta.wave}); }

    var wave = WANKLE.net.meta.wave;
    if (wave > pb.lastWave) { var pw = pb.lastWave; pb.lastWave = wave; logEvent('wave', {from: pw, to: wave, tRel: now - pb.tStart}); }

    if (me.health !== pb.lastHp) { if (me.health < pb.lastHp) logEvent('hp_loss', {from: pb.lastHp, to: me.health}); pb.lastHp = me.health; }

    var enemies = v.tanks.filter(function(t){return !t.isLocal && !t.dead;});
    if (enemies.length > pb.maxEnemies) pb.maxEnemies = enemies.length;
    var myShells = v.shells.filter(function(s){return String(s.o)===String(WANKLE.net.playerId);});
    if (myShells.length > pb.lastMyShellCount) pb.shellsFired += (myShells.length - pb.lastMyShellCount);
    pb.lastMyShellCount = myShells.length;
    var incomingShells = v.shells.filter(function(s){return String(s.o)!==String(WANKLE.net.playerId);});
    var nearest = enemies[0];
    var nd = nearest ? Math.hypot(nearest.x-me.x, nearest.z-me.z) : 0;
    var aimErr = nearest ? Math.abs(((me.turretAngle - Math.atan2(nearest.z-me.z, nearest.x-me.x) + Math.PI*3) % (Math.PI*2)) - Math.PI) : null;

    // Per-second sample
    if (now - pb.lastSampleT > 1000) {
      pb.lastSampleT = now;
      // v23: compute nearest shell ETA
      var nearestShellETA = null;
      if (incomingShells.length > 0) {
        var nearestShell = null, nearestShellDist = Infinity;
        for (var nsi2 = 0; nsi2 < incomingShells.length; nsi2++) {
          var nsd = Math.hypot(incomingShells[nsi2].x - me.x, incomingShells[nsi2].z - me.z);
          if (nsd < nearestShellDist) { nearestShellDist = nsd; nearestShell = incomingShells[nsi2]; }
        }
        if (nearestShell) {
          var nss = (typeof getShellSpeed === 'function') ? getShellSpeed(nearestShell.id, nearestShell.type) : 320;
          nearestShellETA = Math.round((nearestShellDist / nss) * 1000) / 1000;
        }
      }
      pb.samples.push({
        t: now, tRel: now - pb.tStart,
        pos: [Math.round(me.x), Math.round(me.z)], turret: Math.round(me.turretAngle * 1000) / 1000,
        hp: me.health, dead: !!me.dead, wave: wave,
        kills: pb.totalKills, deaths: pb.totalDeaths,
        enemies: enemies.length, nearestEnemyDist: nearest ? Math.round(nd) : null,
        aimErr: aimErr, myShells: myShells.length, incomingShells: incomingShells.length,
        nearestShellDist: incomingShells.length > 0 ? Math.min.apply(null, incomingShells.map(function(s){return Math.hypot(s.x-me.x,s.z-me.z);})) : null,
        ping: WANKLE.net.ping || 0, interpMs: Math.round(WANKLE.net.interpDelayMs || 65),
        fps: Math.round(pb.rafFps * 10) / 10,
        botMode: 'passive', botAction: 'idle',
        playerSpeed: Math.round(pb.lastMySpeed),
        dodgeActive: pb.lastDodgeActive, dodgeUrgency: pb.lastDodgeUrgency,
        dodgeMoveX: Math.round(pb.lastDodgeMoveX * 100) / 100,
        dodgeMoveZ: Math.round(pb.lastDodgeMoveZ * 100) / 100,
        interceptActive: pb.lastInterceptActive,
        // v22.3 cold-spot telemetry
        coldSpotReactive: pb.lastColdSpotReactive ? {score: pb.lastColdSpotReactive.score} : null,
        coldSpotStrategic: pb.lastColdSpotStrategic ? {score: pb.lastColdSpotStrategic.score} : null,
        predictedShells: pb.lastPredictedShellCount || 0,
        realShells: pb.lastRealShellCount || 0,
        guardViolated: pb.lastDodgeGuardViolated || false,
        // v25: path-segment guard telemetry
        pathGuardCrosses: pb.lastPathGuardCrosses || false,
        pathGuardRotation: pb.lastPathGuardRotation || 0,
        pathGuardResolved: pb.lastPathGuardResolved || false,
        pathGuardShells: pb.lastPathGuardShells || 0,
        // v23: timing telemetry
        aliveTimeS: Math.round((now - pb.lastSpawnT) / 100) / 10,
        nearestShellETA: nearestShellETA,
        dodgeDurationS: pb.lastDodgeStartT > 0 ? Math.round((now - pb.lastDodgeStartT) / 100) / 10 : 0,
        totalDistance: 0, shellsFired: pb.shellsFired, maxEnemies: pb.maxEnemies
      });
      // Also push to _pbLog for JSONL collection
      window._pbLog.push(Object.assign({kind: 'sample'}, pb.samples[pb.samples.length - 1]));
    }
  } catch(e) { console.error('[PB] ERROR:', e.message); }
})()
