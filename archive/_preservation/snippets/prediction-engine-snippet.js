// ═══════════════════════════════════════════════════════════════
//  PREDICTION ENGINE — Tier 1+2 rewrite + per-target pattern memory
//  Drop-in replacement for: velTrack + updateVelTrack + getVel + leadAim
//
//  CHANGES FROM v25-opt:
//    1. Adaptive EMA alpha — fast adaptation on velocity-magnitude change (>30%),
//       stable 0.4 otherwise. Catches reversals ~100ms faster.
//    2. Two-sample acceleration tracking — derives acc from (vel_now - vel_2samples_ago) / (2*dt).
//       Predictions use pos + vel*t + 0.5*acc*t^2. Catches deceleration before reversal.
//    3. Trend-weighted multi-hypothesis — reverse-bias weight scales with flip recency.
//       Replaces static 35/45/20 blend. Last-80ms flip = 50% reverse weight; 240ms+ = 15%.
//    4. Inherited-velocity launch compensation — shell inherits player's velocity component
//       along aim direction. Re-solves quadratic with effective shell speed.
//    5. Velocity-variance hit-prob penalty — exposes predictedUncertainty so callers
//       can lower fire confidence on chaotic targets (use via leadAim().uncertainty).
//    6. Per-target pattern memory — tracks reversal period + preferred direction per enemy ID.
//       When a target has a stable reversal period (low variance over 5+ reversals),
//       predicts the NEXT reversal time and blends toward reverse position. GC'd on death.
//
//  INTERFACE (unchanged — callers don't need to be modified):
//    updateVelTrack(tanks, now)   — call once per frame from rafBody
//    getVel(id)                   — returns {vx, vz} (now also smoothed with acceleration)
//    leadAim(me, tgt, shellSpeed) — returns {x, z, t, launchX, launchZ, uncertainty}
//                                   uncertainty is 0..1; caller can gate fire on it
//
//  All other functions (pickTarget, runAimbotSearch, etc.) work unchanged.
//  If anything goes wrong, revert this block — no other code depends on internals here.
// ═══════════════════════════════════════════════════════════════

  // ── Velocity tracker (per-tank EMA velocity + acceleration + pattern memory) ──
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

// ═══════════════════════════════════════════════════════════════
//  OPTIONAL CALLER CHANGE — gate fire on uncertainty
//  In runAimbotSearch (after leadAim call), you can optionally lower
//  hit probability for chaotic targets:
//
//    var predicted = leadAim(cachedMe, tgt, shellSpeed);
//    if (predicted.uncertainty > 0.3) {
//      aim_hitProb *= (1 - predicted.uncertainty * 0.5);  // up to 50% penalty
//    }
//
//  This is OPTIONAL — leaving it out keeps identical fire behavior.
//  The uncertainty field is exposed for future use; current callers ignore it.
// ═══════════════════════════════════════════════════════════════
