// ============================================================================
// Main: state, playback & auto time-warp, frame loop, UI wiring, boot.
// ============================================================================
const STATE = { filming: false, filmMs: 0, filmDt: 1 / 30, t: 0, playing: false, rate: 1, rateTarget: 1, auto: true, last: performance.now(), dwellUntil: 0, lastCaptionEv: -1, teleAt: 0, idle: true, idleT0: 0, idleStart: performance.now(), hudAt: 0 };
const WARPS = [1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200, 21600, 86400, 259200, 864000, 2592000];
function setTime(t) {
  const md = MV.md; if (!md) return; STATE.t = clamp(t, md.tStart, md.tEnd);
  for (const c of MV.crafts) c.qInit = false; PANEL.curEv = -2; STATE.lastCaptionEv = -1;
}
function syncPlayUI() { $('#bPlay').textContent = STATE.playing || STATE.filming ? '❚❚' : '▶'; $('#autoWarp').checked = STATE.auto; }
function fmtRate(r) { if (r < 1.5) return '1×'; if (r < 100) return Math.round(r) + '×'; if (r < 3600) return fx(r / 60, r < 600 ? 1 : 0) + ' min/s'; if (r < 86400) return fx(r / 3600, r < 36000 ? 1 : 0) + ' h/s'; return fx(r / 86400, r < 864000 ? 1 : 0) + ' d/s'; }
function stepWarp(dir) {
  STATE.auto = false; let i = WARPS.findIndex(w => w >= STATE.rate * 0.999); if (i < 0) i = WARPS.length - 1;
  i = clamp(i + dir, 0, WARPS.length - 1); STATE.rate = WARPS[i]; syncPlayUI();
}
// Stretches of a mission when parts move on their own timeline (app/32_shuttle.js): [start, end, top speed]. The automatic
// time-warp slows down to arrive at the start and plays them through at a pace that can be watched: the bay doors swinging
// open or shut, the robot arm reaching for the telescope, lifting it out and swinging it upright, its arrays unfurling, the
// release and the arm folding back, the telescope's aperture door.
function animWindows(md) {
  if (md.animWin) return md.animWin;
  const W = new Map(), add = (a, b, r) => W.set(a + ':' + b, [a, b, r]);
  for (const o of md.M.objects) for (const cf of o.configs) {
    const L = cf.label || {};
    if (L.bayT != null) add(L.bayT, L.bayT + 210, 12);
    if (L.armT) { const T = L.armT; add(T.gr - 1500, T.gr, 60); add(T.un, T.un + 480, 24); add(T.un + 480, T.un + 1680, 60); add(T.arr, T.arr + 720, 40); add(T.rel, T.rel + 180, 12); add(T.rel + 1800, T.rel + 3000, 60); }
    if (L.doorT != null) add(L.doorT, L.doorT + 60, 6);
  }
  return (md.animWin = [...W.values()]);
}
function autoWarp(realDt) {
  const md = MV.md, t = STATE.t; const c = craftById('ship'); const s = c && c.s;
  let next = null; for (const e of md.events) if (e.t > t + 0.25 && !['heat', 'gload', 'blackout'].includes(e.kind)) { next = e; break; }
  const dtNext = next ? next.t - t : 1e9;
  let target = Math.max(1, dtNext / 4.5);
  let active = false;
  if (s && s.T > 0) {
    active = true;
    const b = md.burnAt(t, 'ship');
    if (t < md.M.t0 + 20) target = 1; else if (t < md.M.t0 + 60) target = Math.min(target, 2); else if (b) target = Math.min(target, clamp(b.dur / 25, 1, 60)); else target = Math.min(target, 6);
  }
  for (const cc of MV.crafts) if (cc !== c && cc.s && cc.s.T > 0 && cc.o.kind === 'craft') { active = true; target = Math.min(target, 6); }
  if (s && s.extra && s.extra.chute) { active = true; target = Math.min(target, 10); }
  else if (s && s.extra && (s.extra.q > 200 || s.extra.heat > 1)) { active = true; target = Math.min(target, 4); }
  if (s && !s.surface && !active) { const rr = vnorm(s.r), vv = vnorm(s.v); if (vv > 0) target = Math.min(target, 0.9 * rr / vv); }
  if (performance.now() < STATE.dwellUntil) target = Math.min(target, active ? 2 : 8);
  for (const [a, b, r] of animWindows(md)) { if (t >= a && t < b) target = Math.min(target, r); else if (a > t) target = Math.min(target, Math.max(r, (a - t) / 4.5)); }
  if (t >= md.M.t0 - 12 && t < md.M.t0) target = 1; // the final countdown runs in real time
  if (md.trav && t >= md.trav.seg.t0) { const p = roverPose(md, t); if (p.driving) target = Math.min(target, 90); } // rover drives: watchable speed
  target = clamp(target, 1, 4e6);
  const lr = Math.log(STATE.rate), lt = Math.log(target);
  const k = lt < lr ? 7 : 1.2;
  STATE.rate = Math.exp(lr + (lt - lr) * Math.min(1, realDt * k));
}
function crossEvents(t0, t1) {
  const md = MV.md; let last = -1, sounds = 0;
  for (let i = 0; i < md.events.length; i++) { const e = md.events[i]; if (e.t > t0 && e.t <= t1) { last = i; if (sounds++ < 3) audioEvent(e); } if (e.t > t1) break; }
  if (last >= 0 && last !== STATE.lastCaptionEv) {
    STATE.lastCaptionEv = last; const e = md.events[last];
    if (!['heat', 'gload', 'ascent', 'los', 'terminal', 'approach'].includes(e.kind) || STATE.rate < 20) showCaption(e);
    STATE.dwellUntil = clockMs() + 2600;
  }
}
// ---------------- frame loop ----------------
function frame(now) {
  requestAnimationFrame(frame);
  const realDt = STATE.filming ? STATE.filmDt : clamp((now - STATE.last) / 1000, 0, 0.1); STATE.last = now; MV.realDt = realDt;
  if (MV.md && STATE.playing) {
    if (STATE.auto) autoWarp(realDt);
    const md = MV.md; const t1 = clamp(STATE.t + realDt * STATE.rate * (CAM.mode === 'cine' ? CINE.timeK : 1), md.tStart, md.tEnd); // (slow motion in the cinematic launch's shots)
    crossEvents(STATE.t, t1); STATE.t = t1;
    if (STATE.t >= md.tEnd) { STATE.playing = false; syncPlayUI(); }
  }
  if (!MV.md) { CAM.az += realDt * 0.03; }
  renderFrame(false);
}
function renderFrame(forCapture) {
  R.helio = {};
  const md = MV.md;
  const t = md ? STATE.t : STATE.idleT0 + (performance.now() - STATE.idleStart) / 1000 * 120;
  MV.tNow = t; MV.rate = STATE.playing ? STATE.rate : 1;
  R.clock = (R.clock || 0) + (MV.realDt || 0.016); // s of rendering (real time; a video's own frame time), for things that shimmer
  if (md) for (const c of MV.crafts) computeCraft(c, t);
  updateCamera(t, MV.realDt || 0.016);
  updateBodies(t, CAM.camDist);
  const camD = CAM.camDist || 1;
  if (md) {
    for (const c of MV.crafts) updateCraft(c, t, R.camera.position);
    updatePlasmaLight();
    updatePad(t); updateRunway(t); updateTerrain(); updateTrails(t, R.O, camD); updateL2(t, camD); updateExhaust(t); updateShadows(t); updateTracks(t);
  }
  updateOrbits(t, MV.layers.orbits, Math.max(camD, R.camera.position.length()), MV.frame);
  // stars sit at infinity around the camera; dim them when a bright, sunlit body fills the frame
  R.stars.visible = MV.layers.stars !== false; updateSky();
  let bright = 1;
  if (MV.layers.exposure) {
    const dir = new THREE.Vector3(); R.camera.getWorldDirection(dir); const half = R.camera.fov * DEG / 2 * Math.max(1, R.camera.aspect);
    const sunV = R.bodies.sun.group.position.clone().sub(R.camera.position); if (sunV.angleTo(dir) < half + 0.1) bright = 0.0;
    for (const n of ['earth', 'moon', 'mars']) { const b = R.bodies[n]; const v = b.group.position.clone().sub(R.camera.position); const ang = Math.asin(Math.min(1, b.R / Math.max(v.length(), b.R))); if (v.angleTo(dir) < half + ang && ang > half * 0.05) bright = Math.min(bright, 0.06); }
  }
  R.starMat.uniforms.uBright.value += (bright - R.starMat.uniforms.uBright.value) * 0.15;
  R.starMat.uniforms.uScale.value = Math.min(window.devicePixelRatio || 1, 2);
  const focus = targetCraft() || craftById('ship');
  let tele = null;
  if (md) {
    tele = computeTele(focus && focus.s ? focus : craftById('ship'), t);
    const nowP = performance.now();
    if (nowP - STATE.teleAt > 110 || forCapture) { STATE.teleAt = nowP; drawTele(tele, t); drawProp(tele, t); updateEventsPanel(t); }
    const clean = $('#app').classList.contains('hide-ui');
    updateVectors(targetCraft() && tele && !clean ? tele.c : null, t, tele); updateOsc(focus, t);
  }
  updateAudio(t, tele);
  updateLabels(t, focus);
  if (md && MV.layers.minimap !== false) drawMinimap(t, forCapture);
  const bc = R.bgCam; bc.quaternion.copy(R.camera.quaternion); if (bc.fov !== R.camera.fov || bc.aspect !== R.camera.aspect || bc.userData.shift !== VSHIFT) { bc.fov = R.camera.fov; bc.aspect = R.camera.aspect; bc.userData.shift = VSHIFT; if (VSHIFT) bc.setViewOffset(R.width, R.height, 0, VSHIFT, R.width, R.height); else bc.clearViewOffset(); bc.updateProjectionMatrix(); }
  const film = filmBegin(); // the film look: draw into its target, then finish onto the screen (app/25_film.js)
  R.renderer.clear(); R.renderer.render(R.bgScene, bc); R.renderer.clearDepth(); R.renderer.render(R.scene, R.camera);
  if (film) filmEnd();
  updateHUD(t);
}
// ---------------- launch countdown: T−10 … 1, then LIFTOFF ----------------
const CD = { reduce: (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })() };
function drawCountdown(t) {
  const el = $('#countdown'); const md = MV.md; const met = md ? t - md.M.t0 : NaN;
  if (!md || !(met > -10.0001 && met < 2.8)) { if (!el.hidden) el.hidden = true; return; }
  if (el.hidden) el.hidden = false;
  const lift = met >= 0, ig = lift ? null : padIgnition(md, t), ign = !!(ig && ig.f > 0);
  if (el.classList.contains('liftoff') !== lift) el.classList.toggle('liftoff', lift);
  if (el.classList.contains('ign') !== ign) el.classList.toggle('ign', ign);
  const S = LAUNCH_SITES[md.cfg.site], sol = liftoffStages(md.L).filter(x => x.prop === 'solid');
  const eng = ig ? engineCounts(ig.liq) : '';
  const label = ign ? (ig.full ? 'All engines running' : 'Ignition') : 'Liftoff in';
  const sub = ign ? `${eng} ${ig.full ? 'at full thrust' : 'igniting'} · clamps holding${sol.length ? ' · boosters light at T−0' : ''}` : `${md.L.name}${S ? ' · ' + S.name : ''}`;
  const lb = el.querySelector('.cd-label'), sb = el.querySelector('.cd-sub');
  if (lb.textContent !== label) lb.textContent = label; if (sb.textContent !== sub) sb.textContent = sub;
  const n = el.querySelector('.cd-n'); const txt = lift ? 'LIFTOFF' : String(Math.max(1, Math.ceil(-met - 1e-6)));
  if (n.textContent !== txt) { n.textContent = txt; if (!CD.reduce && n.animate) n.animate([{ transform: 'scale(1.22)', opacity: 0.35 }, { transform: 'scale(1)', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
  const op = met < 2 ? '' : String(clamp(1 - (met - 2) / 0.8, 0, 1)); if (el.style.opacity !== op) el.style.opacity = op;
}
function updateHUD(t) {
  const md = MV.md; const nowP = performance.now();
  drawCountdown(t);
  if (md) {
    const met = fMET(t - md.M.t0); if ($('#met').textContent !== met) $('#met').textContent = met;
    const utc = fmtUTC(t) + ' UTC'; if ($('#utc').textContent !== utc) $('#utc').textContent = utc;
    const w = STATE.playing || STATE.filming ? fmtRate(STATE.rate) : 'paused'; if ($('#warp').textContent !== w) $('#warp').textContent = w;
    drawTimeline(t);
    if (MV.layers.burnin) { const ph = md.phaseAt(t); const ps = PSTAT.cur; $('#burnin').textContent = `${md.M.name}\n${met}   ${fmtUTC(t)} UTC\n${Math.round(CAM.lens)} mm · ${CAM.aspect ? CAM.aspect + ':1' : 'full'} · ${ph ? ph.name : ''}${ps ? ' · ' + (ps.k === 'burn' ? 'ENGINE ON' : ps.l) : ''}`; }
  } else { const utc = fmtUTC(t, false) + ' UTC'; if ($('#utc').textContent !== utc) $('#utc').textContent = utc; }
  updateCaption();
}
// ---------------- mission start ----------------
function startMission(M, scn) {
  const md = new MissionData(M, scn);
  setupMissionView(md); preloadDetailedModels(md);
  buildTelePanel(); buildEventsPanel(); buildBudgetPanel(); buildInfoPanel(); buildTimelineMap(); TL.bg = null; loadShots();
  $('#missionName').textContent = M.name; $('#app').classList.remove('idle');
  $('#setup').hidden = true; $('#setupClose').hidden = false;
  // camera & time
  const st = $('#selTarget'); st.innerHTML = '';
  st.append(h('optgroup', { label: 'Spacecraft' }, ...M.objects.filter(o => o.kind !== 'debris').map(o => h('option', { value: 'obj:' + o.id }, o.name))));
  st.append(h('optgroup', { label: 'Bodies' }, ...['earth', 'moon', 'mars', 'sun', 'venus', 'jupiter', 'saturn'].map(b => h('option', { value: 'body:' + b }, BODIES[b].name))));
  const sl = $('#selLook'); sl.innerHTML = '';
  sl.append(...['moon', 'earth', 'mars', 'sun', 'venus', 'jupiter'].map(b => h('option', { value: 'body:' + b }, BODIES[b].name)), ...M.objects.filter(o => o.kind === 'craft').map(o => h('option', { value: 'obj:' + o.id }, o.name)));
  resetMinimap();
  CAM.target = 'obj:ship'; CAM.mode = 'chase'; CAM.az = 205 * DEG; CAM.el = 4 * DEG; CAM.roll = 0; CAM.trans = null;
  CAM.dist = Math.max(0.06, md.L.height * 0.0042); CAM.lens = 35; CAM.look = md.cfg.dest === 'mars' || (md.cfg.legs || []).length ? 'body:mars' : 'body:moon';
  { const S = LAUNCH_SITES[M.cfg.site]; const r = sitePosEcl('earth', S.lat, S.lon, 0, M.t0); const lf = localFrame('earth', r, M.t0); const sun = vunit(vscale(planetHelio('earth', M.t0).r, -1)); const azS = Math.atan2(vdot(sun, lf.north), vdot(sun, lf.east)); CAM.az = azS + 38 * DEG; }
  setMode('auto'); applyLens(); syncCamUI();
  STATE.t = M.t0 - 10; STATE.playing = true; STATE.auto = true; STATE.rate = 1; STATE.lastCaptionEv = -1; syncPlayUI();
  for (const c of MV.crafts) c.qInit = false;
  MV.frameSel = 'auto'; $('#selFrame').value = 'auto';
  showCaption({ name: M.name, desc: (scn ? scn.tag + '. ' : '') + `Liftoff ${fmtUTC(M.t0, false)} UTC from ${LAUNCH_SITES[M.cfg.site].name}.` });
}
// ---------------- UI wiring ----------------
function initUI() {
  $$('#right .tabs button').forEach(b => b.addEventListener('click', () => { $$('#right .tabs button').forEach(x => x.classList.toggle('on', x === b)); for (const p of ['events', 'budget', 'info', 'shots']) $('#tab-' + p).hidden = p !== b.dataset.tab; if (b.dataset.tab === 'events') PANEL.curEv = -2; }));
  $('#bPlay').addEventListener('click', () => { if (!MV.md) return; if (STATE.t >= MV.md.tEnd) setTime(MV.md.tStart); STATE.playing = !STATE.playing; syncPlayUI(); });
  $('#bPrev').addEventListener('click', () => jumpEvent(-1)); $('#bNext').addEventListener('click', () => jumpEvent(1));
  $('#bSlower').addEventListener('click', () => stepWarp(-1)); $('#bFaster').addEventListener('click', () => stepWarp(1));
  $('#autoWarp').addEventListener('change', e => { STATE.auto = e.target.checked; });
  $('#selTarget').addEventListener('change', e => setTarget(e.target.value));
  $('#selMode').addEventListener('change', e => setMode(e.target.value));
  $('#selLook').addEventListener('change', e => { CAM.look = e.target.value; });
  const ln = $('#selLens'); for (const mm of LENSES) ln.append(h('option', { value: mm }, mm + ' mm'));
  ln.addEventListener('change', e => { CAM.lens = +e.target.value; if (directed()) DIR.lensUser = CAM.lens; applyLens(); });
  $('#selAspect').addEventListener('change', e => { CAM.aspect = +e.target.value; applyLens(); });
  $('#selFrame').addEventListener('change', e => { MV.frameSel = e.target.value; });
  $('#bLayers').addEventListener('click', e => { e.stopPropagation(); $('#layers').hidden = !$('#layers').hidden; });
  document.addEventListener('click', e => { if (!$('#layers').hidden && !e.target.closest('#layers') && !e.target.closest('#bLayers')) $('#layers').hidden = true; });
  $$('#layers input[data-layer]').forEach(cb => { MV.layers[cb.dataset.layer] = cb.checked; cb.addEventListener('change', () => { MV.layers[cb.dataset.layer] = cb.checked; applyLayers(); }); });
  applyLayers();
  $('#bShot').addEventListener('click', captureShot);
  $('#cdSkip').addEventListener('click', () => { const md = MV.md; if (!md) return; setTime(md.M.t0 - 0.05); STATE.playing = true; syncPlayUI(); });
  $('#btnSetup').addEventListener('click', openSetup);
  $('#setupClose').addEventListener('click', () => { $('#setup').hidden = true; });
  $('#btnHelp').addEventListener('click', () => { $('#help').hidden = false; });
  $('#helpClose').addEventListener('click', () => { $('#help').hidden = true; });
  $('#btnHide').addEventListener('click', () => $('#app').classList.toggle('hide-ui'));
  $('#sheetClose').addEventListener('click', () => { $('#sheet').hidden = true; });
  $('#sheetCopy').addEventListener('click', () => { const ta = $('#sheetText'); try { navigator.clipboard.writeText(ta.value).then(() => toast('Shot list copied'), () => { ta.select(); }); } catch (e) { ta.select(); } });
  $('#btnTele').addEventListener('click', () => { $('#left').classList.toggle('open'); $('#right').classList.remove('open'); });
  $('#btnSide').addEventListener('click', () => { $('#right').classList.toggle('open'); $('#left').classList.remove('open'); });
  // keep side panels and captions clear of the (wrapping) bottom bar
  const setBH = () => { const hgt = $('#bottom').getBoundingClientRect().height; document.documentElement.style.setProperty('--bottomH', Math.round(hgt) + 'px'); };
  try { new ResizeObserver(setBH).observe($('#bottom')); } catch (e) { window.addEventListener('resize', setBH); }
  setBH();
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
}
function applyLayers() {
  $('#app').classList.toggle('mm-off', MV.layers.minimap === false); if (typeof setMMH === 'function') setMMH();
  $('#guides').classList.toggle('on', !!MV.layers.guides);
  $('#burnin').style.display = MV.layers.burnin ? '' : 'none';
  if (!MV.layers.captions) $('#caption').classList.add('fade');
  const fl = $('#layers input[data-layer="film"]'); // the film look needs WebGL 2 with floating-point targets
  if (fl && R.renderer && !filmSupported()) { fl.checked = false; fl.disabled = true; MV.layers.film = false; fl.parentElement.title = 'Not available: this browser cannot draw into floating-point targets'; }
}
function openSetup() { $('#setup').hidden = false; if (MV.md) { STATE.playing = false; syncPlayUI(); } if (SETUP.scn) { renderDetail(); renderPlanStatus(); } }
function jumpEvent(dir) {
  const md = MV.md; if (!md) return; const t = STATE.t; const evs = md.events.filter(EVF.key);
  if (dir > 0) { const e = evs.find(e => e.t > t + 30); if (e) jumpToEvent(e); }
  else { const prev = evs.filter(e => e.t < t - 40); const e = prev[prev.length - 1]; if (e) jumpToEvent(e); }
}
function onKey(e) {
  if (e.target.closest('input, textarea, select')) return;
  if (!$('#help').hidden && e.key === 'Escape') { $('#help').hidden = true; return; }
  if (!$('#sheet').hidden && e.key === 'Escape') { $('#sheet').hidden = true; return; }
  if (e.key === 'm' || e.key === 'M') { setSound(!SND.on); return; }
  if (!$('#setup').hidden) { if (e.key === 'Escape' && MV.md) $('#setup').hidden = true; return; }
  const k = e.key;
  if (k === ' ') { e.preventDefault(); $('#bPlay').click(); }
  else if (k === 'ArrowRight') jumpEvent(1); else if (k === 'ArrowLeft') jumpEvent(-1);
  else if (k === ']') stepWarp(1); else if (k === '[') stepWarp(-1);
  else if (k === 'c' || k === 'C') captureShot();
  else if (k === 'h' || k === 'H') $('#app').classList.toggle('hide-ui');
  else if (k === 'f' || k === 'F') setMode('auto');
  else if (k === '?') $('#help').hidden = false;
  else if ('1234567'.includes(k)) setMode(['auto', 'orbit', 'chase', 'lookat', 'ground', 'top', 'cine'][+k - 1]);
}
function onResize() {
  const cv = R.renderer.domElement; R.width = cv.clientWidth || window.innerWidth; R.height = cv.clientHeight || window.innerHeight;
  R.renderer.setSize(R.width, R.height, false); applyLens(); TL.bg = null;
}
// ---------------- boot ----------------
function boot() {
  initScene(); initBodyLabels(); initVectors(); initExhaust(); initCameraInput(); initTimeline(); initUI(); initMinimap(); initSound();
  $('#app').classList.add('idle');
  onResize();
  STATE.idleT0 = dateToT(new Date());
  CAM.target = 'body:earth'; CAM.mode = 'orbit'; CAM.dist = 21000; CAM.el = 12 * DEG; CAM.az = 40 * DEG; CAM.lens = 35; applyLens();
  buildScenarioList();
  const last = lsGet('mstudio-last', 'apollo11'); selectScenario(scenarioById(last) ? last : 'apollo11');
  requestAnimationFrame(frame);
}
window.__ms = { STATE, CAM, DIR, CINE, MM, MV, R, DETAIL, setTime, setTarget, setMode, applyLens, SETUP, Planner, renderFrame, autoWarp, crossEvents, computeCraft, craftAttitude, cfgAt, activeMounts, modelForConfig, attEpisodes, groundFrame, helioReset: () => { R.helio = {}; }, capHitLocal, eclToMesh, roverPose, meshDir, SND, setSound, THREE };
try { boot(); } catch (err) { document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;left:16px;top:16px;right:16px;color:#ff6767;background:#000;padding:12px;z-index:99;white-space:pre-wrap">Startup error: ${esc(err && err.stack || err)}</pre>`); throw err; }
