// ═══════════════════════════════════════════════════════════════
//  DODGE MAGNETIZE FIX — addresses "player curves toward shell, then snaps away"
//  Pre-dates cold-spot. Root cause: medium-urgency blend in sendInput preserves
//  input.moveX/Z which often points toward the enemy (= toward shell origin).
//
//  TWO CHANGES, both in net[_sendName || 'sendInput'] inside boot():
//    A) Project out the toward-shell component from input BEFORE the medium/low
//       urgency blend. Player keeps perpendicular movement intent; toward-risk
//       component zeroed.
//    B) Lower HIGH-urgency threshold from 0.5 → 0.35 so full-override kicks in
//       earlier (narrower window for bug to manifest).
//
//  Drop-in. Locate the dodge proposal block (search for "dodge proposal" or
//  "dodgeMoveX" in the sendInput function) and replace as shown below.
//  Does NOT touch computeDodge, cold-spot, aimbot, fire, or prediction.
// ═══════════════════════════════════════════════════════════════

// ── CURRENT CODE (in sendInput, the dodge proposal block) ──────
// Find this pattern:
//
//      if (cfg.autoDodge && lastDodgeVec && !proposal.moveOverride) {
//        var dUrg = lastDodgeVec.urgency;
//        var dodgeMoveX, dodgeMoveZ, dodgeSource;
//        if (dUrg > 0.5) {
//          dodgeMoveX = lastDodgeVec.moveX;
//          dodgeMoveZ = lastDodgeVec.moveZ;
//          dodgeSource = 'dodge_override';
//        } else if (dUrg > 0.15) {
//          var blend = dUrg * 1.6;
//          dodgeMoveX = input.moveX*(1-blend) + lastDodgeVec.moveX*blend;
//          dodgeMoveZ = input.moveZ*(1-blend) + lastDodgeVec.moveZ*blend;
//          ...
//        } else {
//          var blendLow = dUrg * 0.5;
//          dodgeMoveX = input.moveX*(1-blendLow) + lastDodgeVec.moveX*blendLow;
//          dodgeMoveZ = input.moveZ*(1-blendLow) + lastDodgeVec.moveZ*blendLow;
//          ...
//        }
//
// REPLACE WITH THE BLOCK BELOW:
// ────────────────────────────────────────────────────────────────

      if (cfg.autoDodge && lastDodgeVec && !proposal.moveOverride) {
        var dUrg = lastDodgeVec.urgency;
        var dodgeMoveX, dodgeMoveZ, dodgeSource;

        // ── MAGNETIZE FIX: project out toward-shell component from input ──
        // Player's input often points at enemy (= at shell origin). Medium-urgency
        // blend preserved that toward-risk component → "magnetize" then snap.
        // Fix: remove the input component that aligns with the shell's direction.
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
              // Remove toward-shell component, keep perpendicular
              inputSafeX = input.moveX - _towardDot * _shDirX;
              inputSafeZ = input.moveZ - _towardDot * _shDirZ;
              var _safeLen = Math.hypot(inputSafeX, inputSafeZ);
              if (_safeLen > 0.01) { inputSafeX /= _safeLen; inputSafeZ /= _safeLen; }
              else { inputSafeX = 0; inputSafeZ = 0; }
            }
          }
        }

        // ── MAGNETIZE FIX: lower HIGH threshold 0.5 → 0.35 ──
        if (dUrg > 0.35) {
          dodgeMoveX = lastDodgeVec.moveX;
          dodgeMoveZ = lastDodgeVec.moveZ;
          dodgeSource = 'dodge_override';
        } else if (dUrg > 0.15) {
          var blend = dUrg * 1.6;
          // Use inputSafeX/Z (toward-shell projected out) instead of input.moveX/Z
          dodgeMoveX = inputSafeX*(1-blend) + lastDodgeVec.moveX*blend;
          dodgeMoveZ = inputSafeZ*(1-blend) + lastDodgeVec.moveZ*blend;
          var dm = Math.hypot(dodgeMoveX, dodgeMoveZ);
          if (dm > 1) { dodgeMoveX/=dm; dodgeMoveZ/=dm; }
          dodgeSource = 'dodge_blend';
        } else {
          var blendLow = dUrg * 0.5;
          // Use inputSafeX/Z here too
          dodgeMoveX = inputSafeX*(1-blendLow) + lastDodgeVec.moveX*blendLow;
          dodgeMoveZ = inputSafeZ*(1-blendLow) + lastDodgeVec.moveZ*blendLow;
          var dm2 = Math.hypot(dodgeMoveX, dodgeMoveZ);
          if (dm2 > 1) { dodgeMoveX/=dm2; dodgeMoveZ/=dm2; }
          dodgeSource = 'dodge_nudge';
        }

        // ... rest of dodge block unchanged (ownShellInPath check, proposal.moveX/Z assignment, etc.)

// ═══════════════════════════════════════════════════════════════
//  A/B TEST TELEMETRY: log player velocity vs incoming shell direction
//  for 500ms before impact. With fix, "toward shell" component → ~0
//  in that window. Without fix, you'll see a 100-200ms toward-shell
//  drift before the perpendicular snap.
//
//  Suggested log shape (add to death handler or per-frame telemetry):
//    {
//      deathT: now,
//      shellDir: [shDirX, shDirZ],        // shell's travel direction at impact
//      playerVelHistory: [                  // 500ms of player velocity, 50ms buckets
//        {t: -500, vx: ..., vz: ...},
//        {t: -450, vx: ..., vz: ...},
//        ...
//        {t: 0, vx: ..., vz: ...}
//      ]
//    }
//  Compute dot(playerVel, shellDir) per bucket. Pre-fix: positive spike
//  in buckets -200ms to -100ms (the magnetize). Post-fix: flat at ~0.
// ═══════════════════════════════════════════════════════════════
