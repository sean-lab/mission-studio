// ============================================================================
// Camera: orbit / chase / look-at / ground observer / top-down, with film
// lenses (35 mm full-frame equivalent) and letterbox framing.
// ============================================================================
const CAM = { mode: 'auto', target: 'obj:ship', look: 'body:moon', az: 200 * DEG, el: 10 * DEG, dist: 0.3, roll: 0, lens: 35, aspect: 0,
  ground: { yaw: 0, pitch: 10 * DEG, track: true }, trans: null, lastTargetP: null };
function targetPos(id, t) {
  if (!id) return null;
  if (id.startsWith('body:')) return helio(id.slice(5), t).r;
  const c = craftById(id.slice(4)); if (c && c.P) return c.P;
  if (c) { const s = craftState(c, t); if (s) return vadd(helio(s.ref, t).r, s.r); }
  return null;
}
function targetRadius(id) { if (id && id.startsWith('body:')) { const b = R.bodies[id.slice(5)]; return b ? b.R : 1; } return 0; }
// the director runs the camera: 'auto', or 'cine' (app/51_cine.js) which is the director with the launch cut as a film
function directed() { return CAM.mode === 'auto' || CAM.mode === 'cine'; }
function targetCraft() { return CAM.target.startsWith('obj:') ? craftById(CAM.target.slice(4)) : null; }
function setTarget(id, opts = {}) {
  if (id === CAM.target && !opts.force) return;
  const t = MV.tNow; const from = targetPos(CAM.target, t);
  const prevId = CAM.target; CAM.target = id;
  const rT = targetRadius(id);
  const c = targetCraft();
  let dist = CAM.dist;
  if (rT > 0) dist = Math.max(dist, rT * 3.2); else if (c && c.cur) dist = Math.max(0.03, (c.cur.userData.len || 10) * 0.001 * 3.5);
  if (opts.dist) dist = opts.dist;
  if (from) CAM.trans = { fromId: prevId, fromP: from, t0: clockMs(), dur: 1100, distFrom: CAM.dist, distTo: dist };
  CAM.dist = dist;
  if (CAM.mode === 'ground' && id.startsWith('body:')) setMode('orbit');
  if (directed() && !opts.keepMode) setMode(id.startsWith('body:') ? 'orbit' : 'chase');
  syncCamUI();
}
function setMode(m) {
  const wasAuto = directed();
  CAM.mode = m; $('#lookWrap').hidden = m !== 'lookat';
  if (m !== 'cine') CINE.timeK = 1;
  if (m === 'auto' || m === 'cine') { DIR.key = ''; DIR.lastT = null; DIR.blend = null; }
  if (wasAuto && !directed() && DIR.prm) { CAM.dist = DIR.prm.dist; CAM.az = DIR.prm.az; CAM.el = DIR.prm.el; }
  if (m === 'ground') { CAM.ground.track = true; if (CAM.lens < 85) CAM.lens = 200; }
  if (m === 'top') { CAM.el = 89 * DEG; }
  if (m === 'chase') { CAM.az = 200 * DEG; CAM.el = 12 * DEG; }
  if (m === 'lookat') { CAM.az = 12 * DEG; CAM.el = 6 * DEG; }
  applyLens(); syncCamUI();
}
// The point the camera looks at sits at the middle of the part of the screen the panels leave free, not of the whole
// screen: on a tall screen the panels fill the bottom third, and the craft would otherwise sit just above them. The
// frustum is shifted (an off-centre projection), so nothing else changes.
let VSHIFT = 0;
function applyViewShift() {
  const W = R.width, H = R.height, b = screenBand(), d = Math.round(H / 2 - (b.top + b.bot) / 2);
  if (Math.abs(d) < 4) { if (VSHIFT) { R.camera.clearViewOffset(); VSHIFT = 0; } return; }
  if (d !== VSHIFT) { R.camera.setViewOffset(W, H, 0, d, W, H); VSHIFT = d; }
}
function frameRect() {
  const W = R.width, Hh = R.height, A = CAM.aspect;
  if (!A) return { x: 0, y: 0, w: W, h: Hh };
  if (W / Hh > A) { const w = Hh * A; return { x: (W - w) / 2, y: 0, w, h: Hh }; }
  const hh = W / A; return { x: 0, y: (Hh - hh) / 2, w: W, h: hh };
}
function applyLens() {
  const fr = frameRect();
  const tanH = 18 / CAM.lens; // 36 mm wide full-frame sensor
  const tanV = tanH * R.height / fr.w;
  R.camera.fov = 2 * Math.atan(tanV) * RAD; R.camera.aspect = R.width / R.height; applyViewShift(); R.camera.updateProjectionMatrix();
  R.pxPerRad = R.height / (2 * tanV);
  const lb = (id, css) => { $(id).style.cssText = css; };
  lb('#lbT', `left:0;right:0;top:0;height:${fr.y}px`); lb('#lbB', `left:0;right:0;bottom:0;height:${R.height - fr.y - fr.h}px`);
  lb('#lbL', `top:0;bottom:0;left:0;width:${fr.x}px`); lb('#lbR', `top:0;bottom:0;right:0;width:${R.width - fr.x - fr.w}px`);
  const gd = $('#guides'); gd.style.cssText = `left:${fr.x}px;top:${fr.y}px;width:${fr.w}px;height:${fr.h}px`;
  const bi = $('#burnin'); bi.style.left = (fr.x + 14) + 'px'; bi.style.bottom = (R.height - fr.y - fr.h + 10) + 'px';
}
// where a craft actually stands on a body (its surface segment), preferring the camera target
function surfaceSpotOn(body, after = -Infinity) {
  const order = [targetCraft(), craftById('ship'), craftById('lander'), ...MV.crafts].filter(Boolean);
  for (const c of order) for (const sg of c.o.segs) if (sg.type === 'surface' && sg.ref === body && sg.t0 > after) return { lat: sg.lat, lon: sg.lon, elev: sg.elev || 0 };
  return null;
}
function groundSite(t) {
  const md = MV.md; const P = targetPos(CAM.target, t) || helio('earth', t).r;
  const near = (b, d) => vnorm(vsub(P, helio(b, t).r)) < d;
  const cfg = md.cfg;
  // flat: the site stands on the pad's flat ground (app/46_pads.js), which lies above the sphere by d²/2R out at d from
  // the pad — 2.7 m at the launch camera's 5.9 km, so a camera at its height over the sphere would look up from under it
  // (where the real ground is drawn, app/43_terrain.js, the camera stands on it instead)
  const off = (body, lat, lon, elev, dE, dN, flat) => { const Rb = surfaceRadius(body), la = lat + dN / Rb * RAD, lo = lon + dE / (Rb * Math.cos(lat * DEG)) * RAD;
    let alt = (elev || 0) + (flat ? (dE * dE + dN * dN) / (2 * Rb) : 0); const th = body === 'earth' ? terrainHeightAt(la, lo) : null; if (th != null) alt = Math.max(alt, th);
    return { body, lat: la, lon: lo, alt: alt + 0.0018 }; };
  if (near('moon', 30000)) { const sp = surfaceSpotOn('moon') || (typeof cfg.landing === 'object' ? cfg.landing : null); if (sp) return off('moon', sp.lat, sp.lon, sp.elev || 0, -0.35, -0.12); }
  if (near('mars', 50000)) { const l = (cfg.legs || []).find(x => x.body === 'mars' && x.site); const sp = surfaceSpotOn('mars') || (l && l.site); if (sp) return off('mars', sp.lat, sp.lon, sp.elev || 0, -0.6, -0.25); }
  if (near('earth', 60000)) {
    const S = LAUNCH_SITES[cfg.site], rw = cfg.runway && RUNWAYS[cfg.runway];
    if (rw && t > md.M.t0 + 3 * 3600) { // a Shuttle landing: beside the runway, 1.2 km past the threshold, like the photographers at the landing strip
      const pe = sitePosEcl('earth', rw.lat, rw.lon, 0, t); if (vnorm(vsub(vsub(P, helio('earth', t).r), pe)) < 800) { const hd = rw.hdg * DEG, a = 1.2, sd = 0.42; return off('earth', rw.lat, rw.lon, rw.elev || 0, a * Math.sin(hd) - sd * Math.cos(hd), a * Math.cos(hd) + sd * Math.sin(hd)); } }
    if (t > md.M.t0 + 3 * 3600) { const sp = surfaceSpotOn('earth', md.M.t0 + 3600); if (sp) { const pe = sitePosEcl('earth', sp.lat, sp.lon, 0, t); if (vnorm(vsub(vsub(P, helio('earth', t).r), pe)) < 1500) return off('earth', sp.lat, sp.lon, 0, -4, -3); } }
    return off('earth', S.lat, S.lon, 0, -2.2, -5.5, true);
  }
  return null;
}
const _up = new THREE.Vector3(), _look = new THREE.Vector3();
// never let the camera sink below the ground of a nearby body (offset is relative to the origin P)
function keepAboveGround(P, off, t) {
  const Pc = vadd(P, off);
  for (const b of ['earth', 'moon', 'mars']) {
    const B = helio(b, t).r; const d = vsub(Pc, B); const n = vnorm(d); if (n > surfaceRadius(b) + 15) continue; const Rb = groundRadius(b, vscale(d, 1 / Math.max(n, 1e-9)), t) + 0.0025;
    if (n < Rb) { const fixed = vadd(B, vscale(d, Rb / Math.max(n, 1e-9))); return vsub(fixed, P); }
  }
  return off;
}
// ---------------- framing a standing vehicle around the HUD ----------------
// The screen rows the HUD leaves free in the middle column, where a rocket stands: below the top bar and the propulsion pill,
// above the bottom bar (and the small map on phones), and clear of the countdown card — mid-screen on wide screens, near
// the top on phones. The card's place is remembered after it hides, so the framing holds steady through liftoff.
const BAND = { at: 0, W: 0, H: 0, v: null, card: null, cardKey: '' };
function screenBand() {
  const now = clockMs(), W = R.width, H = R.height;
  if (BAND.v && now - BAND.at < 500 && BAND.W === W && BAND.H === H) return BAND.v;
  const fr = frameRect(), cx = W / 2, half = clamp(W * 0.12, 60, 110), clean = $('#app').classList.contains('hide-ui');
  const rectOf = sel => { const el = $(sel); if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > cx - half && r.left < cx + half ? r : null; };
  let top = fr.y, bot = fr.y + fr.h, card = null;
  if (!clean) {
    top = Math.max(top, 84); // the top bar (48 px) and the propulsion pill under it (shown from liftoff on)
    for (const sel of ['#bottom', '#minimap', '#left', '#right']) { const r = rectOf(sel); if (r) bot = Math.min(bot, r.top); } // (the panels only on a tall screen, where they sit under the view)
    { const cap = $('#caption'); if (cap && !cap.classList.contains('fade')) { const r = rectOf('#caption'); if (r && r.top > top + 0.4 * (bot - top)) bot = Math.min(bot, r.top - 6); } } // the event caption, so the craft is framed above it
    const key = W + 'x' + H; card = rectOf('#countdown');
    if (card) { BAND.card = { top: card.top, bottom: card.bottom }; BAND.cardKey = key; }
    else card = BAND.cardKey === key ? BAND.card : H <= 520 ? null : W <= 860 ? { top: 96, bottom: 270 } : { top: 0.6 * H - 78, bottom: 0.6 * H + 78 }; // (on short screens the card sits at the side)
  }
  let t2 = top, b2 = bot;
  if (card) { if (card.top + card.bottom < top + bot) t2 = Math.max(top, card.bottom); else b2 = Math.min(bot, card.top); }
  const minH = Math.max(110, 0.15 * fr.h); // too little room beside the card (a phone held sideways): let the card overlap instead
  const v = b2 - t2 >= minH ? { top: t2, bot: b2 } : bot - top >= minH ? { top, bot } : { top: fr.y + 0.06 * fr.h, bot: fr.y + 0.94 * fr.h };
  Object.assign(BAND, { at: now, W, H, v }); return v;
}
// camera distance and aim height (km above the base point) that put a vertical column — from the base point up to zTop km —
// exactly between screen rows yT and yB, for a chase camera at elevation el looking at the aim point (pinhole projection)
function fitColumn(zTop, el, yT, yB) {
  const k = R.pxPerRad, Hc = R.height / 2 - VSHIFT, ce = Math.cos(el), se = Math.sin(el); // (the optical centre, shifted on a tall screen)
  const p1 = Hc - yT, p2 = Hc - yB, q1 = ce * k + p1 * se, q2 = ce * k + p2 * se; // px above the centre (negative below)
  const den = p1 / q1 - p2 / q2;
  if (!(zTop > 0) || !(den > 1e-6) || !(q1 > 0) || !(q2 > 0)) return null;
  const d = zTop / den; return { dist: d, aimH: -p2 * d / q2 };
}
// how high the vehicle reaches above its base point (km): its model's top, standing on the launch mount
function standingHeight(c, Lkm) { const ud = c.cur && c.cur.userData; return ud && ud.bbY ? Math.max(((c.yOff || 0) + ud.bbY[1]) * 0.001, 0.002) : Lkm + (PAD_TOP + MOUNT_H) * 0.001; }
// camera pose for a mode, relative to the floating origin P: {pos, up, look}
function poseFor(mode, prm, P, t) {
  const c = targetCraft(); const dist = prm.dist;
  if (mode === 'lookat') {
    const PL = targetPos(prm.look, t) || helio('moon', t).r; const Ld = vunit(vsub(PL, P));
    let up = [0, 0, 1]; if (c && c.s) up = vunit(c.rD || c.s.r);
    let u3 = vsub(up, vscale(Ld, vdot(up, Ld))); if (vnorm(u3) < 1e-6) u3 = vperp(Ld); u3 = vunit(u3); const u2 = vcross(u3, Ld);
    const D = vadd(vadd(vscale(Ld, Math.cos(prm.el) * Math.cos(prm.az)), vscale(u2, Math.cos(prm.el) * Math.sin(prm.az))), vscale(u3, Math.sin(prm.el)));
    const pos = keepAboveGround(P, vscale(D, -dist), t);
    if (prm.centreK > 0) { // turned toward the craft (the director's look-at shot dragged past its frame): between the body and the craft
      const Lc = vunit(vlerp(Ld, vunit(vscale(pos, -1)), prm.centreK)); return { pos, up: u3, look: vadd(pos, vscale(Lc, Math.max(dist, 1e-6))), center: false }; }
    return { pos, up: u3, look: vsub(PL, P), center: false };
  }
  if (mode === 'padcam') { // a camera on the ground near the launch pad (prm.spot: km east, north and up from the site), looking at the target
    const S = MV.md && LAUNCH_SITES[MV.md.cfg.site];
    if (S && prm.spot) {
      const [dE, dN, h] = prm.spot, Rb = surfaceRadius('earth'), la = S.lat + dN / Rb * RAD, lo = S.lon + dE / (Rb * Math.cos(S.lat * DEG)) * RAD;
      let alt = (dE * dE + dN * dN) / (2 * Rb); const th = terrainHeightAt(la, lo); if (th != null) alt = Math.max(alt, th); // (on the pad's flat ground, or the real ground where it is drawn)
      const site = sitePosEcl('earth', la, lo, alt + h, t), pos = keepAboveGround(P, vsub(vadd(helio('earth', t).r, site), P), t);
      return { pos, up: localFrame('earth', site, t).up, look: prm.aim || [0, 0, 0], center: false };
    }
    mode = 'chase';
  }
  if (mode === 'site') { // a camera on the ground by the launch site, looking up at the target
    const g = groundSite(t);
    if (g) { const site = sitePosEcl(g.body, g.lat, g.lon, g.alt, t); return { pos: vsub(vadd(helio(g.body, t).r, site), P), up: localFrame(g.body, site, t).up, look: [0, 0, 0], center: false }; }
    mode = 'chase';
  }
  if (mode === 'from') { // a camera on another craft (the station's windows), looking at the target
    const fc = prm.from && craftById(prm.from.slice(4));
    if (fc && fc.P && fc.s) { const F = lvlh(fc.rD || fc.s.r, fc.vD || fc.s.v), off = prm.off || [0, 0, 0]; let pos = vadd(vsub(fc.P, P), fromLvlh(F, vscale(off, 0.001)));
      if ((prm.fromAz || prm.fromEl || (prm.zoomK && prm.zoomK !== 1)) && c && c.s) { // dragged or zoomed: the camera leaves the window and goes round the craft, from where it was
        const rr = c.rD || c.s.r, vv0 = c.vD || c.s.v, up = vunit(rr); let vh = vsub(vv0, vscale(up, vdot(vv0, up))); if (vnorm(vh) < 1e-6) vh = vperp(up); const e1 = vunit(vh), e3 = up, e2 = vcross(e3, e1);
        const d = vnorm(pos) * (prm.zoomK || 1), az0 = Math.atan2(vdot(pos, e2), vdot(pos, e1)), el0 = Math.asin(clamp(vdot(pos, e3) / d, -1, 1)), az = az0 + prm.fromAz, el = clamp(el0 + prm.fromEl, -1.5, 1.5);
        pos = vadd(vadd(vscale(e1, d * Math.cos(el) * Math.cos(az)), vscale(e2, d * Math.cos(el) * Math.sin(az))), vscale(e3, d * Math.sin(el)));
        return { pos, up: e3, look: [0, 0, 0], center: true, basis: [e1, e2, e3] };
      }
      return { pos, up: Math.abs(vdot(vunit(pos), F.z)) > 0.85 ? F.x : F.z, look: [0, 0, 0], center: false }; } // looking straight down: keep the direction of flight up the frame
    mode = 'chase';
  }
  let e1 = [1, 0, 0], e2 = [0, 1, 0], e3 = [0, 0, 1];
  if (mode === 'chase') {
    if (c && c.s) { const rr = c.rD || c.s.r, vv0 = c.vD || c.s.v; const up = vunit(rr); let vh = vsub(vv0, vscale(up, vdot(vv0, up))); if (vnorm(vh) < 1e-6) vh = vperp(up); e1 = vunit(vh); e3 = up; e2 = vcross(e3, e1); }
    else if (CAM.target.startsWith('body:')) { const name = CAM.target.slice(5); const pole = name === 'sun' ? [0, 0, 1] : bodyPoleEcl(name, t); e3 = pole; e1 = vperp(pole); e2 = vcross(e3, e1); }
  }
  const ce = Math.cos(prm.el), se = Math.sin(prm.el), ca = Math.cos(prm.az), sa = Math.sin(prm.az);
  const A = (mode === 'chase' && prm.aim) || [0, 0, 0]; // the point the camera looks at, relative to P (e.g. halfway up a standing rocket)
  const off = keepAboveGround(P, vadd(A, vadd(vadd(vscale(e1, dist * ce * ca), vscale(e2, dist * ce * sa)), vscale(e3, dist * se))), t);
  const up = mode === 'top' ? vadd(vscale(e1, -ca), vscale(e2, -sa)) : e3;
  return { pos: off, up, look: A, center: true, basis: [e1, e2, e3] };
}
function setPose(pose) {
  const cam = R.camera; cam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]); cam.up.set(pose.up[0], pose.up[1], pose.up[2]);
  _look.set(pose.look[0], pose.look[1], pose.look[2]); cam.lookAt(_look); if (CAM.roll) cam.rotateZ(CAM.roll);
}
// ---------------- auto-follow director ----------------
// Picks the craft where the action is and a framing for each situation (pad, ascent, burn, entry,
// parachutes, landing, surface, low orbit, coast toward the next destination) and blends between shots.
const DIR = { key: '', since: 0, blend: null, offAz: 0, offEl: 0, zoomK: 1, lensUser: null, lastT: null, dist: null, prm: null, shot: null };
function activeCraft(t) {
  const L = craftById('lander'); if (L && L.s && t >= L.o.t0 + 1 && t <= L.o.t1 - 1) return L;
  return craftById('ship');
}
function domRaw(P, t) {
  const d = b => vnorm(vsub(P, planetHelio(b, t).r));
  if (d('moon') < BODIES.moon.soi) return 'moon'; if (d('earth') < BODIES.earth.soi) return 'earth'; if (d('mars') < BODIES.mars.soi) return 'mars'; return 'sun';
}
function domTimeline(md) { // where the primary craft is, sampled over the mission: [{t, b}] at each change of dominant body
  if (md.domTL) return md.domTL;
  const out = []; let prev = null; const dt = Math.max(600, (md.tEnd - md.M.t0) / 4000);
  for (let t = md.M.t0; t <= md.tEnd; t += dt) { const s = md.ship.stateAt(t); if (!s) continue; const b = domRaw(vadd(planetHelio(s.ref, t).r, s.r), t); if (b !== prev) { out.push({ t, b }); prev = b; } }
  md.domTL = out; return out;
}
function nextDestination(md, t, cur) {
  for (const x of domTimeline(md)) if (x.t > t && x.b !== cur && x.b !== 'sun') return x.b;
  const leg = (md.cfg.legs || []).find(l => isoToT(l.t) > t && l.body !== cur && BODIES[l.body]); // e.g. Jupiter, the design point beyond the simulated flight
  return leg ? leg.body : null;
}
function directorShot(c, t) {
  const md = MV.md; const s = c.s; if (!s) return null;
  const ex = s.extra || {}; const cfgL = cfgAt(c, t);
  const L = Math.max((c.cur && (c.cur.userData.sizeM || c.cur.userData.len)) || (cfgL && cfgL.key === 'launch' ? md.L.height : 10), 2) * 0.001; // vehicle size, km
  const body = c.dom || s.ref; const R0 = body === 'sun' ? 0 : surfaceRadius(body);
  const alt = body === 'sun' ? Infinity : vnorm(c.rD || s.r) - R0;
  const tIns = md.ship && md.ship.segs.length ? md.ship.segs[0].t1 : md.M.t0 + 600;
  const sunAz = () => { const p = poseFor('chase', { az: 0, el: 0, dist: 1 }, c.P, t); const [e1, e2] = p.basis; const sd = vunit(vscale(c.P, -1)); return Math.atan2(vdot(sd, e2), vdot(sd, e1)); };
  if (c.o.id === 'ship' && (s.pad || t < md.M.t0 + 45)) { // the whole vehicle, pad to tip, in the rows the HUD leaves free
    const shot = { key: 'pad', mode: 'chase', az: sunAz() + 38 * DEG, el: 4 * DEG, dist: L * 4.2, lens: 35, label: 'Launch' };
    const blk = MV.pad && MV.pad.userData.block; // not through a tower: round to the nearer side of it
    if (blk) for (let k = 0; k < 4; k++) { let moved = false; for (const [a, w] of blk) { const d = wrapPi(shot.az - a * DEG); if (Math.abs(d) < w * DEG - 1e-9) { shot.az = a * DEG + (d < 0 ? -w : w) * DEG; moved = true; } } if (!moved) break; }
    const B = screenBand(), m = (B.bot - B.top) * 0.07, f = fitColumn(standingHeight(c, L), shot.el, B.top + m, B.bot - m * 0.6);
    if (f) { shot.dist = f.dist; shot.aimH = f.aimH; }
    return shot;
  }
  // Launched in twilight: once the vehicle climbs into sunlight over the dark ground, watch from the ground by the launch site
  // as its exhaust lights up against the sky (app/47_exhaust.js)
  if (c.o.id === 'ship' && t > md.M.t0 + 75 && t < tIns + 90 && twilightLaunch(md, c, t)) return { key: 'twilight', mode: 'site', az: 0, el: 0, dist: 1, lens: 20, label: 'Exhaust in sunlight over the dark ground', blend: 1 };
  if (c.o.id === 'ship' && t < tIns + 5) {
    let dist = L * (4.5 + 4 * Math.min(Math.max(alt, 0), 100) / 100); const el = 9 * DEG;
    // the camera looks at the engines, so the vehicle stands above the centre of the frame: back off far enough on wide screens to keep its nose below the top bar
    const B = screenBand(), p1 = R.height / 2 - (B.top + (B.bot - B.top) * 0.04);
    if (p1 > 20) dist = Math.max(dist, standingHeight(c, L) * (Math.cos(el) * R.pxPerRad / p1 + Math.sin(el)));
    return { key: 'ascent', mode: 'chase', az: 200 * DEG, el, dist, lens: 35, label: 'Ascent', blend: 4500 };
  }
  if (isShuttle(md)) { const sh = shuttleShot(c, t, s, ex, cfgL, L); if (sh) return sh; }
  if (ex.chute) return { key: 'chute', mode: 'chase', az: 120 * DEG, el: -8 * DEG, dist: Math.max(L * 25, 0.09), lens: 35, drift: 0.05, label: 'Parachutes' };
  if ((ex.heat > 2 || ex.q > 300) && alt < 140) return { key: 'entry', mode: 'chase', az: 65 * DEG, el: 8 * DEG, dist: L * 7, lens: 35, label: 'Entry' };
  if (s.surface || (cfgL && cfgL.landed)) return { key: 'surface', mode: 'chase', az: 150 * DEG, el: 10 * DEG, dist: Math.max(L * 6, 0.025), lens: 35, drift: 0.025, label: 'Surface' };
  if (s.T > 0) {
    if (alt < 30) return { key: 'landing', mode: 'chase', az: 140 * DEG, el: 6 * DEG, dist: Math.max(L * 5, 0.03), lens: 35, label: 'Powered flight near the ground' };
    return { key: 'burn', mode: 'chase', az: 160 * DEG, el: 18 * DEG, dist: L * 3.4, lens: 35, label: 'Engine burn' };
  }
  if (body !== 'sun' && alt < R0 * 0.6) return { key: 'orbit-' + body, mode: 'chase', az: 195 * DEG, el: 22 * DEG, dist: Math.max(L * 6, 0.03), lens: 35, label: 'Orbit' };
  // coasting: craft in the foreground, the body it is heading for (or orbiting) behind it
  let look = null;
  if (body !== 'sun') { const vr = vdot(vunit(c.rD), c.vD); if (vr < 0 || alt < 3 * R0) look = body; }
  if (!look) look = nextDestination(md, t, body) || (body !== 'sun' ? body : 'earth');
  return { key: 'coast-' + look, mode: 'lookat', look: 'body:' + look, az: 7 * DEG, el: 4 * DEG, dist: Math.max(L * 4, 0.025), lens: 50, drift: 0.006, label: 'Coasting toward ' + BODIES[look].name };
}
// Space Shuttle: proximity operations seen from the station, the docked stack, the deploy, the glide to the runway
// the ground at the launch site in twilight or darkness (the Sun more than 2° below the horizon) while the vehicle, high up, is
// in sunlight
function twilightLaunch(md, c, t) {
  const S = LAUNCH_SITES[md.cfg.site]; if (!S || !c.s || c.dom !== 'earth' || !EXH.mesh) return false;
  const E = helio('earth', t).r, sd = vunit(vscale(E, -1)), site = sitePosEcl('earth', S.lat, S.lon, 0, t);
  if (Math.asin(clamp(vdot(vunit(site), sd), -1, 1)) * RAD > -2) return false;
  const r = c.rD || c.s.r, L = exhSunlight(r[0], r[1], r[2], sd); return L[1] > 0.25;
}
function shuttleShot(c, t, s, ex, cfgL, L) {
  if (c.o.id !== 'ship' || !cfgL) return null;
  const ph = ex.phase || '', iss = craftById('iss');
  if (cfgL.sc === 'shuttle') {
    const att = cfgL.att;
    if (iss && iss.P && c.P && /^(rbar|rpm|vbar|fly)$/.test(att || '') && !cfgL.docked) {
      const d = vnorm(vsub(c.P, iss.P)) * 1000; // m
      if (d < 1500 && !(att === 'vbar' && d < 75)) { const v = att === 'vbar' || att === 'fly'; return { key: 'from-iss-' + (v ? 'v' : 'r'), mode: 'from', from: 'obj:iss', off: v ? [23, -7, 5] : [-3, -7, -9], lens: clamp(Math.round(0.24 * d / 5) * 5, 24, 400), dist: L * 3, label: 'Seen from the station', blend: 2500 }; }
    }
    if (cfgL.docked || (att === 'vbar' && iss && iss.P && c.P && vnorm(vsub(c.P, iss.P)) < 0.075)) return { key: 'docked', mode: 'chase', az: 300 * DEG, el: 24 * DEG, dist: 0.21, lens: 35, drift: 0.01, label: 'Docked to the station' };
    if (cfgL.bayT != null && t >= cfgL.bayT - 30 && t < cfgL.bayT + 240) return { key: 'bay-doors', mode: 'chase', az: 125 * DEG, el: 42 * DEG, dist: Math.max(L * 1.9, 0.055), lens: 35, drift: 0.006, label: cfgL.bay === 'open' ? 'Payload bay doors opening' : 'Payload bay doors closing' };
    if (att === 'deploy') return { key: 'deploy', mode: 'chase', az: 140 * DEG, el: 30 * DEG, dist: Math.max(L * 2.4, 0.07), lens: 35, drift: 0.008, label: 'Payload deploy' };
  }
  if (ph === 'entry' && (ex.heat > 1 || ex.q > 200)) return { key: 'sh-entry', mode: 'chase', az: 112 * DEG, el: -3 * DEG, dist: L * 3.4, lens: 35, label: 'Entry' };
  if (/TAEM/.test(ph)) return { key: 'taem', mode: 'chase', az: 150 * DEG, el: 7 * DEG, dist: L * 3.2, lens: 35, label: 'Gliding to the runway' };
  if (/heading alignment/.test(ph)) return { key: 'hac', mode: 'chase', az: 215 * DEG, el: 14 * DEG, dist: L * 3.4, lens: 35, label: 'Heading alignment cone' };
  if (/outer glideslope/.test(ph)) return { key: 'ogs', mode: 'chase', az: 162 * DEG, el: 5 * DEG, dist: L * 2.8, lens: 35, label: 'Final approach' };
  if (/flare|rollout/.test(ph)) return { key: 'touchdown', mode: 'chase', az: 120 * DEG, el: 3 * DEG, dist: L * 2.3, lens: 35, label: 'Touchdown' };
  if (s.surface) return { key: 'surface', mode: 'chase', az: 145 * DEG, el: 9 * DEG, dist: L * 2.6, lens: 35, drift: 0.02, label: 'Wheel stop' };
  return null;
}
function directorUpdate(t, realDt) {
  const md = MV.md; const c = activeCraft(t); if (!c) return;
  const now = clockMs();
  const jump = DIR.lastT == null || Math.abs(t - DIR.lastT) > Math.max(120, (STATE.playing ? STATE.rate : 1) * 0.6);
  DIR.lastT = t;
  if (CAM.target !== 'obj:' + c.o.id) { if (jump) { CAM.target = 'obj:' + c.o.id; CAM.trans = null; syncCamUI(); } else setTarget('obj:' + c.o.id, { force: true, keepMode: true }); }
  const shot = (CAM.mode === 'cine' && cineShot(c, t)) || directorShot(c, t); if (!shot) return;
  let cut = false;
  if (shot.key !== DIR.key) {
    cut = !!shot.cut; // (a cut: no blend from the last shot, the lens set at once)
    if (!jump && DIR.key && !cut) DIR.blend = { pos: R.camera.position.clone(), quat: R.camera.quaternion.clone(), up: R.camera.up.clone(), center: DIR.prm ? DIR.prm.mode !== 'lookat' : true, t0: now, dur: shot.blend || 1800 };
    else DIR.blend = null;
    DIR.key = shot.key; DIR.since = now; DIR.offAz = 0; DIR.offEl = 0; DIR.zoomK = 1; DIR.lensUser = null; DIR.dist = null; DIR.aimH = null;
  }
  const drift = shot.drift ? (now - DIR.since) / 1000 * shot.drift : 0;
  const target = shot.dist * DIR.zoomK;
  DIR.dist = DIR.dist == null || jump ? target : Math.exp(Math.log(DIR.dist) + (Math.log(target) - Math.log(DIR.dist)) * Math.min(1, realDt * 1.5));
  if (shot.aimH == null) DIR.aimH = null; // look above the base point (a standing rocket is framed around its middle)
  else DIR.aimH = DIR.aimH == null || jump ? shot.aimH : DIR.aimH + (shot.aimH - DIR.aimH) * Math.min(1, realDt * 1.5);
  const aim = shot.aimP ? shot.aimP // (a point given outright: the middle of a vehicle as drawn, app/51_cine.js)
    : shot.aimV && c.vD && vnorm(c.vD) > 1e-6 ? vscale(vunit(c.vD), shot.aimV) // (up the vehicle's axis, near enough its velocity in flight: a cinematic shot of a long stack)
    : DIR.aimH != null && c.s ? vscale(vunit(c.rD || c.s.r), DIR.aimH) : null;
  let az, el, centreK = 0;
  if (shot.mode === 'lookat') { // keep the craft inside the middle of the film frame, whatever the lens and screen shape
    const fr = frameRect(), tH = 18 / CAM.lens, tV = tH * fr.h / fr.w;
    const aL = Math.atan(0.42 * tH), eL = Math.atan(0.5 * tV);
    // Dragged past the edge of that frame the camera turns from the body to the craft (centreK), so the craft can be looked
    // at from every side; back inside it the body comes back into view
    az = shot.az + DIR.offAz + Math.sin(drift) * Math.min(0.05, aL * 0.3); el = clamp(shot.el + DIR.offEl, -1.5, 1.5);
    const outA = Math.max(Math.abs(az) - aL, 0) / 0.25, outE = Math.max(Math.abs(el) - eL, 0) / 0.25;
    centreK = smoothstep(Math.max(outA, outE));
  } else { az = shot.az + DIR.offAz + drift; el = clamp(shot.el + DIR.offEl, -1.5, 1.5); }
  DIR.prm = { mode: shot.mode, look: shot.look, from: shot.from, off: shot.off, spot: shot.spot, az, el, dist: DIR.dist, aim, centreK, fromAz: shot.mode === 'from' ? DIR.offAz : 0, fromEl: shot.mode === 'from' ? DIR.offEl : 0, zoomK: DIR.zoomK };
  DIR.shot = shot;
  const lens = DIR.lensUser || shot.lens;
  if (Math.abs(CAM.lens - lens) > 0.5) { CAM.lens = jump || cut ? lens : Math.exp(Math.log(CAM.lens) + (Math.log(lens) - Math.log(CAM.lens)) * Math.min(1, realDt * 2)); applyLens(); syncCamUI(); }
  if (CAM.look !== shot.look && shot.look) CAM.look = shot.look;
}
function updateCamera(t, realDt) {
  const cam = R.camera;
  { const d0 = VSHIFT; applyViewShift(); if (VSHIFT !== d0) cam.updateProjectionMatrix(); }
  if (directed() && MV.md) directorUpdate(t, realDt);
  let P = targetPos(CAM.target, t);
  if (!P) P = targetPos('obj:ship', t) || helio('earth', t).r; // target not in flight yet (e.g. a lander still docked): follow the ship meanwhile
  // transition between targets
  let dist = CAM.dist;
  if (CAM.trans) {
    const f = clamp((clockMs() - CAM.trans.t0) / CAM.trans.dur, 0, 1); const e = f * f * (3 - 2 * f);
    const from = targetPos(CAM.trans.fromId, t) || CAM.trans.fromP;
    P = vlerp(from, P, e); dist = Math.exp(Math.log(CAM.trans.distFrom) + (Math.log(CAM.trans.distTo) - Math.log(CAM.trans.distFrom)) * e);
    if (f >= 1) CAM.trans = null;
  }
  const rT = targetRadius(CAM.target);
  if (CAM.mode === 'ground') {
    const g = groundSite(t);
    if (g) {
      const Bp = helio(g.body, t).r; const site = sitePosEcl(g.body, g.lat, g.lon, g.alt, t);
      const Pobs = vadd(Bp, site); R.O = Pobs;
      cam.position.set(0, 0, 0);
      const lf = localFrame(g.body, site, t); _up.set(lf.up[0], lf.up[1], lf.up[2]); cam.up.copy(_up);
      if (CAM.ground.track) { const d = vsub(P, Pobs); _look.set(d[0], d[1], d[2]); if (_look.length() < 1e-6) _look.copy(_up); cam.lookAt(_look); const dn = vunit(d); CAM.ground.pitch = Math.asin(clamp(vdot(dn, lf.up), -1, 1)); CAM.ground.yaw = Math.atan2(vdot(dn, lf.east), vdot(dn, lf.north)); }
      else { const cp = Math.cos(CAM.ground.pitch); const d = vadd(vadd(vscale(lf.north, cp * Math.cos(CAM.ground.yaw)), vscale(lf.east, cp * Math.sin(CAM.ground.yaw))), vscale(lf.up, Math.sin(CAM.ground.pitch))); _look.set(d[0], d[1], d[2]); cam.lookAt(_look); }
      if (CAM.roll) cam.rotateZ(CAM.roll);
      CAM.groundInfo = g; CAM.camDist = vnorm(vsub(P, Pobs));
      return;
    }
  }
  CAM.groundInfo = null;
  R.O = P;
  if (directed() && MV.md && DIR.prm) {
    const pose = poseFor(DIR.prm.mode, DIR.prm, P, t); setPose(pose);
    if (DIR.blend) {
      const f = smoothstep((clockMs() - DIR.blend.t0) / DIR.blend.dur);
      if (f >= 1) DIR.blend = null;
      else {
        const pT = cam.position.clone(), qT = cam.quaternion.clone();
        const pos = vlerp([DIR.blend.pos.x, DIR.blend.pos.y, DIR.blend.pos.z], [pT.x, pT.y, pT.z], f); const safe = keepAboveGround(P, pos, t);
        cam.position.set(safe[0], safe[1], safe[2]);
        if (DIR.blend.center && pose.center) { cam.up.copy(DIR.blend.up).lerp(_up.set(pose.up[0], pose.up[1], pose.up[2]), f).normalize(); cam.lookAt(pose.look[0], pose.look[1], pose.look[2]); if (CAM.roll) cam.rotateZ(CAM.roll); }
        else cam.quaternion.slerpQuaternions(DIR.blend.quat, qT, f);
      }
    }
    const sk = DIR.shot && DIR.shot.shake, sc = sk && activeCraft(t); // a cinematic shot's camera shaking as a camera would (app/51_cine.js)
    if (sc) { const [ax, ay] = cineShake(sk, sc, t, cam.position.length()); cam.rotateX(ax); cam.rotateY(ay); }
    CAM.camDist = DIR.prm.mode === 'site' || DIR.prm.mode === 'padcam' ? cam.position.length() : DIR.prm.dist; return;
  }
  const minD = rT > 0 ? rT * 1.003 + 0.002 : 0.004; dist = Math.max(dist, minD); if (!CAM.trans) CAM.dist = Math.max(CAM.dist, minD);
  const mode = directed() ? 'chase' : CAM.mode;
  setPose(poseFor(mode, { az: CAM.az, el: CAM.el, dist, look: CAM.look }, P, t));
  CAM.camDist = dist;
}
// ---------------- input ----------------
function initCameraInput() {
  const el = $('#gl'); const ptrs = new Map(); let pinch0 = null, lastTap = 0;
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey }); el.classList.add('dragging'); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: CAM.dist, lens: CAM.lens, zk: DIR.zoomK }; } });
  el.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2 && pinch0) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const k = pinch0.d / Math.max(d, 1); if (CAM.mode === 'ground') CAM.lens = clamp(pinch0.lens / k, 8, 3200); else if (directed()) { if (CAM.mode === 'cine') setMode('auto'); DIR.zoomK = clamp(pinch0.zk * k, 0.05, 2e4); } else CAM.dist = clamp(pinch0.dist * k, 0.004, 5e10); CAM.trans = null; applyLens(); syncCamUI(); return; }
    const fovK = Math.min(1, CAM.lens > 0 ? 50 / CAM.lens : 1);
    if (p.b === 2 || p.shift) { CAM.roll += dx * 0.004; return; }
    if (CAM.mode === 'ground') { CAM.ground.track = false; CAM.ground.yaw -= dx * 0.0035 * fovK; CAM.ground.pitch = clamp(CAM.ground.pitch + dy * 0.0035 * fovK, -1.55, 1.55); return; }
    if (CAM.mode === 'cine') setMode('auto'); // (taking the camera ends the film; the director carries on from here)
    if (CAM.mode === 'auto') { DIR.offAz -= dx * 0.006; DIR.offEl = clamp(DIR.offEl + dy * 0.006, -1.5, 1.5); DIR.blend = null; return; }
    CAM.az -= dx * 0.006; CAM.el = clamp(CAM.el + dy * 0.006, -1.55, 1.55);
  });
  const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; if (!ptrs.size) el.classList.remove('dragging'); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e => {
    e.preventDefault(); const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    if (CAM.mode === 'ground') { CAM.lens = clamp(CAM.lens * Math.exp(-dy * 0.0012), 8, 3200); applyLens(); syncCamUI(); return; }
    if (CAM.mode === 'cine') setMode('auto');
    if (CAM.mode === 'auto') { DIR.zoomK = clamp(DIR.zoomK * Math.exp(dy * 0.0012), 0.05, 2e4); return; }
    CAM.trans = null; CAM.dist = clamp(CAM.dist * Math.exp(dy * 0.0012), 0.004, 5e10);
  }, { passive: false });
  el.addEventListener('dblclick', e => { // pick nearest label
    let best = null, bd = 40;
    for (const lbl of [...$$('#labels .lbl')]) { const r = lbl.getBoundingClientRect(); if (r.left < -1000) continue; const d = Math.hypot(r.left + 4 - e.clientX, r.top + 7 - e.clientY); if (d < bd) { bd = d; best = lbl; } }
    if (best) best.click();
  });
}
function syncCamUI() {
  const sm = $('#selMode'); if (sm.value !== CAM.mode) sm.value = CAM.mode;
  const st = $('#selTarget'); if (st.value !== CAM.target) st.value = CAM.target;
  const sl = $('#selLook'); if (sl.value !== CAM.look) sl.value = CAM.look;
  const ln = $('#selLens'); const lv = String(Math.round(CAM.lens));
  if (![...ln.options].some(o => o.value === lv)) { const o = ln.querySelector('option[data-custom]') || h('option', { 'data-custom': '1' }); o.value = lv; o.textContent = lv + ' mm'; if (!o.parentNode) ln.prepend(o); }
  ln.value = lv;
  $('#lookWrap').hidden = CAM.mode !== 'lookat';
}
