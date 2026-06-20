# PROMPT FOR ITERATION AGENT

Files attached: wankle-cheat-v25-opt.user.js (reference slim+opt pass), prediction-engine-snippet.js (drop-in leadAim rewrite), dodge-magnetize-fix.js (drop-in dodge fix).

## GAME FACTS (verified vs constants.js — use to validate cuts)
wankle.online = wanshot.lol (same). 3D tank shooter. MP (FFA/TEAM) + survival/campaign up to 96 bots.
Player shells bounce ONCE. Ricochet-missile = ENEMY only. NO ricochet pickup.
Pickups: speed, shield, multi. THAT'S IT. No laser/railgun/teleport/health/rapidfire.
12 enemy types, 17 skins. World 1820×1400 default, custom up to 5600×4200. TILE=70.
Tank hitbox 46×36 axis-aligned (NOT rotated). Shell r=4.5. Tick 120Hz, snap 60Hz, interp ~65ms.
"???"/mystery tab = Easter egg, not gameplay. Ignore.

## DEAD CODE I CUT (verified safe — keep cut in your ver)
- Aim-correction subsystem (loadAimCorrections/saveAimCorrections/getAimCorrection/recordShotResult/pendingShots/recordShot/checkPendingShots + localStorage). v24 desc said "removed" but only OUTPUT disconnected. Recording kept running. Output → nowhere.
- enemyHpTracker/updateHitTracker. v24 desc said removed. Wasn't. .hits counter never read.
- Mine drilling (shouldPlaceMine, MINE_EXPLOSION_R, mineRetreat*, gameStartTime, lastMineT, both sendInput proposal blocks, menu section, cfg.mineDrill/mineSafeDist/mineDrillCooldown). Author comment: "too dangerous, kills player."
- hasRicochetShell() + 2 callers. Always returns false — players can't fire ricochet (game constants).
- pathHitsPoint() — never called (replaced by pathHitsRect).
- HIT_R_DIRECT — never used.
- cachedInterceptTgt + cachedSelfRicochet — declared null/false, NEVER ASSIGNED, only read in drawHUD (dead branches).
- findPickup() + dodgePickupRoute — off by default, author: "causing unwanted movement."
- Stale version strings (menu v22.0, crash v21, etc).

## PERF OPTS I MADE (behavior-preserving — evaluate for your ver)
- F (frameStats) cache: built 1×/RAF, pre-computes shell angles/speeds/ownCount + enemy ID map. Eliminates ~20 shell scans + ~10 enemy scans PER FRAME. Game dev friend right: 6+ enemy checks/frame when 1 sufficed. Reality worse: ~9 enemy + ~20 shell iters/frame.
- Grid pointInTile: 9 cells vs all 100+ tiles. ~25× faster. Cold-spot called pointInTile 700+×/refresh.
- Cached findInterceptTarget (50ms): 120Hz→60Hz.
- currentTargetRef: set in pickTarget, read in sendInput/drawHUD. Kills 3+ linear find-by-id loops/frame.
- myShells local in sendInput: myShellsInFlight() was 5×/sendInput @ 120Hz. Now 1×.
- getShellAngle reads F.cache: O(1) vs linear raw-snapshot scan. 8+ call sites/frame.
- Profiles → base+deltas (PROFILE_DEFAULTS + overrides). Same behavior, 5× less repetition.

## PREDICTION SNIPPET (Tier 1+2 + per-target pattern memory)
Drop-in. Replaces: velTrack var, updateVelTrack, getVel, leadAim. Interface UNCHANGED — all callers work. leadAim returns new optional .uncertainty field (0..1).
- Tier 1 (low risk): adaptive EMA alpha (0.4→0.8 on >30% speed change), trend-weighted multi-hypothesis (reverse-bias scales with flip recency: 50% if last flip 80ms ago → 15% if 240ms+), velocity-variance uncertainty.
- Tier 2 (medium risk): two-sample acceleration (pos + vel·t + ½·acc·t²), inherited-velocity launch (effectiveShellSpeed = shellSpeed + dot(myVel,aimDir)×0.5), per-target pattern memory (tracks reversal period+CV per enemy ID; activates only with 5+ reversals AND CV<15%).
- Inherited-velocity 0.5 multiplier = EMPIRICAL. A/B test. If fast-mover hit rate ↑, raise to 1.0. If ↓, drop to 0.
- Per-target pattern memory: most useful for survival AI (deterministic patterns), neutral for PvP humans. CV<15% gate = conservative. If weird aim on specific bot type, raise 5→8 threshold or 15%→20% CV cutoff.
- uncertainty field exposed but NOT consumed by default. Commented snippet at bottom shows how to gate fire on it. Wire in ONLY if telemetry shows benefit.
- Revert safety: drop acc to 0 (set prev.ax=0; prev.az=0 in updateVelTrack) → reverts to v25-opt behavior.

## DODGE MAGNETIZE FIX (separate file, root cause predates cold-spot)
Bug: player curves TOWARD shell, then snaps away. Root cause NOT cold-spot.
Real cause: medium-urgency blend in sendInput preserves input.moveX/Z which often points at enemy (= at shell origin). Player moving forward to shoot → medium blend keeps 36% forward = toward shell.
Frame1: urgency 0.4, blend=0.64, dodgeMoveX = 36%input + 64%perp = diagonal w/ toward-shell component. Frame2: urgency 0.7, full override, snap perpendicular. Net = magnetize then dodge.
Cold-spot makes WORSE (adds 25% bias toward far-side safe point) but isn't cause.
FIX (2 changes, in sendInput dodge proposal block):
1. Project out toward-shell component from input BEFORE blend. Find topThreat shell, compute shellDir, dot input onto it, if positive subtract that component. Player keeps perpendicular movement intent, toward-risk zeroed.
2. Lower HIGH threshold 0.5→0.35 (narrower medium window).
File has exact replacement code. A/B test: log player vel vs shell dir for 500ms pre-impact. Pre-fix: positive spike (magnetize) at -200 to -100ms. Post-fix: flat at ~0.

## ARCHITECTURE — KEEP THESE
1. COLD-SPOT DODGE = RIGHT ARCH. Keep. Position-scoring beats vector-averaging for multi-shell (vectors cancel on convergent fire; position never cancels). Especially true for MP (2+ humans from diff angles = exact failure mode cold-spot built for). Cached shell paths (trace once, 32+81 pts do point-to-seg dist) = good.
2. 4 DODGE GUARD PASSES = LOAD-BEARING FOR PVP. Keep ALL 4: dot-product (humans lead your movement), path-crossing (humans fire where you dodge TO), 90° rotation (humans fire spreads aligning w/ vector-summed dodge), velocity-aware reverse (humans bait direction then fire opposite). Bots don't exploit these. Humans do.
3. OFFENSIVE POSITIONING IN DODGE GRID = AIMBOT'S JOB. strategicColdSpotGrid LOS check per cell per enemy = expensive (81×enemies×tiles) + conceptually wrong. Either cache LOS per cell (currently re-raycasts/frame) OR remove. Dodge finds safety, not offense.
4. sim8DirFallback RE-TRACES full ricochet per shell per direction. Should use cached shell paths from coldSpotDodge. Same accuracy, ~10× faster. Single most expensive function.
5. FIRE DECISION = 150-line inline blob in sendInput. 7 bools tangled (shellAlreadyGoingToHit, ownShellDanger, mobilityBlock, isLethal, isStationary, canFire, selfRicochet). Extract to shouldFire(me,target,aim)->{fire,reason}. Testable + profileable.
6. TWO PERSISTENCE SYSTEMS OVERLAP. persistView/persistMe/persistTiles (rafBody) + "DON'T wipe cachedTiles" (refreshViewCache) = same flicker problem. Pick one (persist* more general), let other wipe freely.
7. _statPulse uses window._statPulse (global) = leak risk. Merge into velTrack or closure-scope.

## CEILING — "unbeatable" =
1v1 any human: survive indefinitely (achievable)
1v2 skilled humans: survive most of time (achievable)
1v3+ coordinated: survive sometimes (NO cheat survives 15 convergent shells — math says die)
Don't sacrifice 1v1/1v2 for 1v3+ scenarios.

## ANTI-HUMAN ADDS (small, high-impact PvP)
- RANDOMIZED SAFE-DIR SELECTION: when 2+ safe cells scores within 10% of best, pick RANDOM not always-highest. Currently dodge deterministic — human watches 3 dodges, predicts 4th. 5 lines. Worth MORE than other 4 combined.
- PER-ENEMY SHELL-COUNT TRACKING: see enemy shells in flight. Track enemyShellsInFlight[enemyId]. Human dry (0 shells) → push aggressive. Loaded (4-5) → defensive. Currently only YOUR shells tracked = half picture in PvP. ~20 lines.
- DODGE REACTION JITTER: 0-80ms random delay. Frame-perfect = readable. Breaks timing pattern humans exploit. 5 lines.
- ANTI-BAIT FIRE SUPPRESSION: track lastTimeFiredAt[enemyId]. Human fired at you within 250ms → suppress triggerbot (preserve mobility for next shot). Current mobilityBudgetMs=100 too short for human bait cycles (~200-400ms). ~15 lines.
- CONVERGENT-FIRE ESCALATION: 2+ shells from diff enemies converging within 80u → force cold-spot only (skip vector dodge — WILL cancel). ~15 lines.

## LINE COUNT
Don't chase number. Realistic floor same functionality = ~2000-2100. Below that = killing features (cold-spot grid, sim8Dir, shellSpeedTrack, _statPulse, guard passes) that are load-bearing for MP survivability. Cheat value = dodge quality + fire-decision accuracy, both live in code you'd gut. Optimize behavior+perf, NOT line count.

## YOUR TELEMETRY = BIGGEST ASSET
5 parallel bots A/B testing = what gets you to "unbeatable". NOT predictor architecture. Mediocre predictor A/B tested 50× beats brilliant predictor tuned once. EVERY change (incl snippet features, magnetize fix, anti-human adds) → validate against bot fleet BEFORE keeping.

## PRIORITY ORDER
1. Cherry-pick dead-code cuts (provably safe, verified vs game constants)
2. Cherry-pick perf opts (behavior-preserving, real wins)
3. Wire prediction snippet, A/B each feature (esp inherited-velocity multiplier)
4. Wire dodge magnetize fix, A/B (log player vel vs shell dir 500ms pre-impact)
5. Extract fire decision to shouldFire() (testability, enables iteration)
6. Add randomized safe-direction selection (biggest anti-human win, 5 lines)
7. Add per-enemy shell-count tracking (PvP intel, 20 lines)
8. Everything else incremental — let telemetry guide
