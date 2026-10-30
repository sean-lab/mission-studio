// ============================================================================
// Cinematic launch: a camera mode ('cine') that cuts the launch like a film, from the ignition to the first staging, then
// hands over to the director (app/50_camera.js). The shots are a pure function of the mission time, from the flight's
// own events (the ignition, the liftoff, max-Q, the first staging), so they fit every vehicle, and scrubbing back to the
// launch plays them again:
//   1. base     — before liftoff: a camera low on the ground near the pad, a wide lens looking up the vehicle, pushing in
//   2. rise     — the first seconds: slow motion, a ground camera out past the blast's cloud as the vehicle climbs out of it
//   3. track    — a long lens a few kilometres out on the ground, following it into the sky
//   4. tail     — a camera below the vehicle looking up along its plume, then round to its side
//   5. staging  — a close cut on the first separation, in slow motion
// The ground shots stand where the pad's towers do not block them (the pad's block list, as the director's pad shot).
// The camera shakes with the thrust while it is near; the clock slows (CINE.timeK, applied in app/90_main.js) for the
// slow-motion shots. Dragging the view, or picking another mode, ends it.
// ============================================================================
const CINE = { timeK: 1 };
// the times the shots are cut on, from the mission's events (cached per mission)
function cineTimes(md) {
  if (md.cineT) return md.cineT;
  const ev = re => md.events.find(e => re.test(e.name)), t0 = md.M.t0;
  const ign = ev(/^Ignition sequence start/), mq = md.events.find(e => e.kind === 'maxq'), st = md.events.find(e => e.kind === 'staging' && e.t > t0);
  const tS = st ? st.t : t0 + 150, tQ = mq ? mq.t : t0 + 60;
  const tTail = t0 + 28, tSide = Math.max(tTail + 12, Math.min(tQ + 20, tS - 10)), tSep = tS - 1.5;
  return (md.cineT = { tIgn: ign ? ign.t : t0 - 7, t0, tTail, tSide, tSep, tS, tEnd: tS + 6 });
}
// The ground cameras stand east or west of the pad, on the side nearer the Sun: the flame trenches throw the cloud north
// and south (app/48_padcloud.js), and a camera across them would watch the vehicle vanish into it. A long lens from out
// there sees a broad wedge behind and before the pad, so a side with a tower within 40° of it (ELA-3's water tower) gives
// way to the other
function cineSide(sunAz) {
  const blk = (MV.pad && MV.pad.userData.block) || [], sides = Math.cos(sunAz) >= 0 ? [0, Math.PI] : [Math.PI, 0];
  return sides.find(c => !blk.some(([b]) => Math.abs(wrapPi(c - b * DEG)) < 40 * DEG)) ?? sides[0];
}
// a bearing (chase basis: from east toward north, rad) near `want` that no tower blocks
function cineClear(want) {
  let a = want; const blk = MV.pad && MV.pad.userData.block;
  if (blk) for (let k = 0; k < 4; k++) { let moved = false; for (const [b, w] of blk) { const d = wrapPi(a - b * DEG); if (Math.abs(d) < w * DEG - 1e-9) { a = b * DEG + (d < 0 ? -w : w) * DEG; moved = true; } } if (!moved) break; }
  return a;
}
// the lens (mm) that makes a height of h km at a distance of d km fill a fraction f of the frame's height
function cineFitLens(h, d, f) { const fr = frameRect(), tanV = h / Math.max(d, 1e-6) / (2 * f); return clamp(18 * fr.h / (fr.w * tanV), 14, 1200); }
// The shot at time t for craft c (the ship), or null outside the launch (the director's own shot then). L: the launch
// stack's height (km); sunAz: the bearing toward the Sun, so the ground cameras see the lit side
function cineShot(c, t) {
  const md = MV.md; if (!md || c.o.id !== 'ship' || !md.L || !LAUNCH_SITES[md.cfg.site] || !c.s) { CINE.timeK = 1; return null; }
  const L = Math.max(md.L.height || 50, 10) * 0.001, sunAz = (() => { const p = poseFor('chase', { az: 0, el: 0, dist: 1 }, c.P, t); const [e1, e2] = p.basis; const sd = vunit(vscale(c.P, -1)); return Math.atan2(vdot(sd, e2), vdot(sd, e1)); })();
  const T = cineTimes(md); if (t < T.tIgn - 8 || t >= T.tEnd) { CINE.timeK = 1; return null; }
  const s = c.s, T0 = T.t0, up = s ? vunit(c.rD || s.r) : null;
  const thrustOn = s && s.T > 0, shakeK = thrustOn || (t > T.tIgn && t < T0 + 2) ? 1 : 0;
  const slow = (a, b, k) => { const ramp = 0.6, f = Math.min(smoothstep((t - a) / ramp), smoothstep((b - t) / ramp)); return 1 + (k - 1) * f; }; // (eased in and out over 0.6 s of mission time)
  let shot;
  if (t < T0) { // 1. base: low near the pad, pushing in as the engines light
    const az = cineClear(cineSide(sunAz) + 22 * DEG), d = Math.max(L * 1.5, 0.12), f = smoothstep((t - (T.tIgn - 8)) / (T0 - T.tIgn + 8));
    shot = { key: 'cine-base', mode: 'padcam', spot: [d * Math.cos(az), d * Math.sin(az), 0.0015], aimH: L * 0.6, lens: 16 + 8 * f, shake: t > T.tIgn ? 0.0025 * smoothstep((t - T.tIgn) / 3) : 0, cut: true, label: 'Ignition' };
  } else if (t < T0 + 7) { // 2. rise: slow motion, the vehicle climbing past a camera by the trench
    // (out past the cloud the blast throws round the pad, which would hide the vehicle from nearer)
    const az = cineClear(cineSide(sunAz) - 15 * DEG), d = Math.max(L * 8, 0.5), h = s && up ? Math.max(vnorm(c.rD || s.r) - surfaceRadius('earth'), 0) : 0;
    shot = { key: 'cine-rise', mode: 'padcam', spot: [d * Math.cos(az), d * Math.sin(az), 0.0012], aimH: L * 0.75, lens: cineFitLens(L, Math.hypot(d, h + L * 0.6), 0.62), shake: 0.006 * (1 - smoothstep((t - T0) / 7)), slow: slow(T0 - 0.3, T0 + 5, 0.3), cut: true, label: 'Liftoff' };
  } else if (t < T.tTail) { // 3. track: a long lens on the ground, following it into the sky
    const az = cineClear(cineSide(sunAz) + 35 * DEG), d = 2.6, h = s ? Math.max(vnorm(c.rD || s.r) - surfaceRadius('earth'), 0) : 0;
    shot = { key: 'cine-track', mode: 'padcam', spot: [d * Math.cos(az), d * Math.sin(az), 0.002], aimH: L * 0.5, lens: cineFitLens(L, Math.hypot(d, h), 0.42), shake: 0.0008, cut: true, label: 'Climbing away' };
  } else if (t < T.tSide) { // 4. tail: below the vehicle, looking up along the plume
    shot = { key: 'cine-tail', mode: 'chase', az: sunAz + 40 * DEG, el: -38 * DEG, dist: L * 1.15, aimV: L * 0.3, lens: 20, shake: 0.0012, cut: true, label: 'Ascent' };
  } else if (t < T.tSep) { // … round to its side
    shot = { key: 'cine-side', mode: 'chase', az: sunAz + 60 * DEG, el: 4 * DEG, dist: L * 2.4, aimV: L * 0.45, lens: 30, shake: 0.0006, blend: 3500, label: 'Ascent' };
  } else { // 5. staging: a close cut, in slow motion
    shot = { key: 'cine-sep', mode: 'chase', az: sunAz + 95 * DEG, el: 8 * DEG, dist: L * 1.7, aimV: L * 0.3, lens: 30, slow: slow(T.tS - 0.8, T.tS + 3.5, 0.3), cut: true, label: 'Staging' };
  }
  shot.shake = (shot.shake || 0) * shakeK;
  CINE.timeK = shot.slow || 1;
  return shot;
}
