// ============================================================================
// Launch pads, each as it stood on its scenario's launch day: the raised pad and its flame trench, the mobile launcher or
// launch mount the vehicle stands on, the towers with their swing arms, lightning protection, propellant spheres, water
// towers and the buildings in view. Built from published dimensions (NASA and KSC fact sheets, the Historic American
// Engineering Record, Moonport (SP-4204), the NSTS News Reference Manual, ULA, SpaceX, CASC and ISRO material, FAA
// documents) and photographs; where nothing is published (an arm's length, the exact place of a sphere) the figure is read
// from photographs.
// Frame: metres, +Y up, +Z north, +X west (as buildPad turns it), y = 0 at the surrounding ground, the vehicle's axis at
// x = z = 0. padModel(md) → { group, stand (the height of the vehicle's lowest nozzle above the ground), deckY (the deck the
// steam boils up from), glow (material lit by the engines), trenchD (how far out the exhaust leaves the flame trench), foot
// (the vehicle's footprint radius), animate(t) (arms swinging away), block (camera directions a tower blocks: padBlock) }.
// ============================================================================
const PV = (e, y, n) => new THREE.Vector3(-e, y, n); // east, up, north → the pad's frame
const _padY = new THREE.Vector3(0, 1, 0);
// The ground and the pad's long slabs are big triangles that the near plane clips under the camera; three.js's interpolated
// log depth is then centimetres out, and the globe (a few centimetres below, its depth exact: app/20_scene.js) shows
// through in patches. These materials take their depth from gl_FragCoord.w as the globe's do.
function padExactDepth(m) {
  m.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <logdepthbuf_fragment>', LOGDEPTH_EXACT); };
  m.customProgramCacheKey = () => 'padExactDepth'; return m;
}
// Weathering, in the shader from the pad's own coordinates (the kit's merged meshes carry no texture coordinates): blotches
// and grain over concrete, with the joints between its slabs; a softer mottle over paint and steel (rust streaks under
// the rain, dust). w: how strong, 0 … 1; seams: the slab joints.
const GLSL_PAD_WEATHER = `
float padHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float padNoise(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(padHash(i), padHash(i + vec3(1, 0, 0)), f.x), mix(padHash(i + vec3(0, 1, 0)), padHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(padHash(i + vec3(0, 0, 1)), padHash(i + vec3(1, 0, 1)), f.x), mix(padHash(i + vec3(0, 1, 1)), padHash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`;
function padWeather(m, w, seams) {
  const base = m.onBeforeCompile;
  m.onBeforeCompile = s => {
    base(s);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPadP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPadP = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPadP;' + GLSL_PAD_WEATHER).replace('#include <map_fragment>', `#include <map_fragment>
  { float b = 0.55 * padNoise(vPadP * 0.23) + 0.3 * padNoise(vPadP * 1.3) + 0.15 * padNoise(vPadP * 7.0);
    float streak = padNoise(vec3(vPadP.x * 3.0, vPadP.y * 0.08, vPadP.z * 3.0)); // the rain's streaks down the faces
    diffuseColor.rgb *= 1.0 + ${w.toFixed(2)} * (0.5 * (b - 0.5) + 0.25 * (streak - 0.5));
    ${seams ? 'vec3 q = abs(fract(vPadP / 6.1) - 0.5); float j = smoothstep(0.478, 0.492, max(max(q.x, q.y), q.z)); diffuseColor.rgb *= 1.0 - 0.18 * j;' : ''} }`);
  };
  m.customProgramCacheKey = () => 'padExactDepth|weather' + w + (seams ? 's' : ''); return m;
}
// the material the engines light up when they fire (updatePad sets its colour): the flame deflector, or the ground under the
// exhaust where there is no trench to look into
const padGlow = () => padExactDepth(new THREE.MeshBasicMaterial({ color: '#141210' }));
function padMats() {
  const pm = (c, k, w = 0, seams = false) => { const m = padExactDepth(mat(c, k, { name: 'pad' })); return w ? padWeather(m, w, seams) : m; }; // the pad's own materials (not shared with the vehicles)
  return padMats.m || (padMats.m = {
    concrete: pm('#aeaba3', 'fabric', 1, true), concreteD: pm('#8f8b83', 'fabric', 1, true), soot: pm('#45403a', 'fabric', 0.8), grass: pm('#6f7c57', 'fabric', 0.6),
    sand: pm('#c9c0a7', 'fabric', 0.7), rock: pm('#bdb9ae', 'fabric', 0.8), asphalt: pm('#55575a', 'fabric', 0.6),
    steel: pm('#8d9196', 'metal', 0.5), steelD: pm('#5a5e63', 'metal', 0.5), galv: pm('#a3a8ad', 'metal', 0.5), floor: pm('#6f7378', 'dark', 0.5),
    red: pm('#a9381f', 'paint', 0.5), redD: pm('#7d2a18', 'paint', 0.5), white: pm('#e4e3dd', 'paint', 0.35), grey: pm('#a8acb0', 'paint', 0.45), greyL: pm('#c8cbce', 'paint', 0.45, true),
    greyD: pm('#6c7075', 'paint', 0.45), black: pm('#26282b', 'paint', 0.3), orange: pm('#c9652a', 'paint', 0.45), yellow: pm('#d8b23a', 'paint', 0.4),
    fibre: pm('#d9d2bd', 'paint'), glass: pm('#2f3840', 'glass'), wire: new THREE.LineBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.55 }),
  });
}
// Simple solids collected per material and merged into one mesh per material: a tower's hundreds of beams draw in a call.
function padKit() {
  const parts = new Map(), k = {};
  const add = (m, g) => { if (!parts.has(m)) parts.set(m, []); parts.get(m).push(g.index ? g.toNonIndexed() : g); return k; };
  const q = new THREE.Quaternion(), d = new THREE.Vector3();
  k.geo = add;
  k.box = (m, e, y, n, se, sy, sn, rot = 0) => { const g = new THREE.BoxGeometry(se, sy, sn); if (rot) g.rotateY(rot); g.translate(-e, y + sy / 2, n); return add(m, g); }; // bottom at y
  k.beam = (m, a, b, w, h = w) => { d.subVectors(b, a); const L = d.length(); if (L < 1e-4) return k; const g = new THREE.BoxGeometry(w, L, h); g.applyQuaternion(q.setFromUnitVectors(_padY, d.normalize())); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return add(m, g); };
  k.rod = (m, a, b, r, seg = 8) => { d.subVectors(b, a); const L = d.length(); if (L < 1e-4) return k; const g = new THREE.CylinderGeometry(r, r, L, seg, 1, true); g.applyQuaternion(q.setFromUnitVectors(_padY, d.normalize())); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return add(m, g); };
  k.cyl = (m, e, y, n, r0, r1, h, seg = 24, open = false) => { const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, open); g.translate(-e, y + h / 2, n); return add(m, g); };
  k.sphere = (m, e, y, n, r, seg = 24) => { const g = new THREE.SphereGeometry(r, seg, Math.round(seg * 0.6)); g.translate(-e, y, n); return add(m, g); };
  const n0 = new THREE.Vector3(), n1 = new THREE.Vector3();
  k.quads = (m, quads, toward = null) => { // [[a, b, c, d] …] corners in order round the face, flat shaded; facing toward (a
    // direction, default up) whichever way the corners run
    const P = []; for (const [a, b, c, e] of quads) {
      n0.subVectors(b, a).cross(n1.subVectors(c, a)); const t = toward || _padY;
      if (n0.dot(t) < 0) P.push(a, c, b, a, e, c); else P.push(a, b, c, a, c, e);
    }
    const g = new THREE.BufferGeometry().setFromPoints(P); g.computeVertexNormals(); return add(m, g);
  };
  k.build = (grp = new THREE.Group()) => {
    for (const [m, gs] of parts) {
      let n = 0; for (const g of gs) n += g.attributes.position.count;
      const P = new Float32Array(n * 3), N = new Float32Array(n * 3); let o = 0;
      for (const g of gs) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); }
      const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      grp.add(new THREE.Mesh(out, m));
    }
    parts.clear(); return grp;
  };
  return k;
}
// a square lattice tower (side w, from y0, h tall, a ring of beams every step, the faces X-braced), with solid floors
// every floorStep and a core (elevators, stairs) of side core
function padLattice(k, m, e, n, w, y0, h, o = {}) {
  const M = padMats(), hw = w / 2, col = o.col || 0.75, bw = o.beam || 0.45, step = o.step || 6.1;
  const C = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]], lv = Math.max(1, Math.round(h / step));
  for (const [a, b] of C) k.beam(m, PV(e + a, y0, n + b), PV(e + a, y0 + h, n + b), col);
  for (let i = 0; i <= lv; i++) {
    const y = y0 + h * i / lv, y2 = y0 + h * (i + 1) / lv;
    for (let c = 0; c < 4; c++) {
      const [a1, b1] = C[c], [a2, b2] = C[(c + 1) % 4];
      k.beam(m, PV(e + a1, y, n + b1), PV(e + a2, y, n + b2), bw);
      if (i < lv) { k.beam(m, PV(e + a1, y, n + b1), PV(e + a2, y2, n + b2), bw * 0.6); k.beam(m, PV(e + a2, y, n + b2), PV(e + a1, y2, n + b1), bw * 0.6); }
    }
    if (o.floors !== false && i > 0 && i < lv && i % (o.floorEvery || 1) === 0) k.box(M.floor, e, y - 0.3, n, w - 0.6, 0.3, w - 0.6);
  }
  if (o.core) k.box(o.coreMat || M.greyD, e + (o.coreE || 0), y0, n + (o.coreN || 0), o.core, h, o.core);
}
// a box-shaped steel frame (the Shuttle's rotating service structure): centred at (e, n), from y0, a across × b along × h
// high, its long axis on bearing br (radians); columns at every bay, a beam round it at every level, each bay X-braced
function padTrussBox(k, m, e, n, y0, a, b, h, br, o = {}) {
  const ca = Math.cos(br), sa = Math.sin(br), bay = o.bay || 6.5, bw = o.beam || 0.5;
  const P = (u, v, y) => PV(e + u * ca + v * sa, y0 + y, n - u * sa + v * ca); // u across, v along
  const lv = Math.max(1, Math.round(h / (o.step || 6.6))), nb = Math.max(1, Math.round(b / bay)), na = Math.max(1, Math.round(a / bay));
  const ring = []; // the perimeter's column positions, in order round the box
  for (let i = 0; i < nb; i++) ring.push([-a / 2, -b / 2 + b * i / nb]);
  for (let i = 0; i < na; i++) ring.push([-a / 2 + a * i / na, b / 2]);
  for (let i = 0; i < nb; i++) ring.push([a / 2, b / 2 - b * i / nb]);
  for (let i = 0; i < na; i++) ring.push([a / 2 - a * i / na, -b / 2]);
  for (const [u, v] of ring) k.beam(m, P(u, v, 0), P(u, v, h), bw * 1.4);
  for (let l = 0; l <= lv; l++) {
    const y = h * l / lv, y2 = h * (l + 1) / lv;
    for (let i = 0; i < ring.length; i++) {
      const [u1, v1] = ring[i], [u2, v2] = ring[(i + 1) % ring.length];
      k.beam(m, P(u1, v1, y), P(u2, v2, y), bw);
      if (l < lv) { k.beam(m, P(u1, v1, y), P(u2, v2, y2), bw * 0.6); k.beam(m, P(u2, v2, y), P(u1, v1, y2), bw * 0.6); }
    }
  }
}
// a swing arm: a truss box from its hinge on a tower face reaching len toward the vehicle; returned as its own group so it
// can swing away (rotation about the hinge's vertical axis)
function padArm(len, w, hgt, m, o = {}) {
  const k = padKit(), M = padMats(), b = 0.28;
  const top = [[-w / 2, hgt], [w / 2, hgt]], bot = [[-w / 2, 0], [w / 2, 0]];
  for (const [x, y] of [...top, ...bot]) k.beam(m, new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, -len), b);
  const nb = Math.max(2, Math.round(len / 2.2));
  for (let i = 0; i <= nb; i++) {
    const z = -len * i / nb, z2 = -len * (i + 1) / nb;
    k.beam(m, new THREE.Vector3(-w / 2, 0, z), new THREE.Vector3(w / 2, 0, z), b * 0.7); k.beam(m, new THREE.Vector3(-w / 2, hgt, z), new THREE.Vector3(w / 2, hgt, z), b * 0.7);
    for (const x of [-w / 2, w / 2]) { k.beam(m, new THREE.Vector3(x, 0, z), new THREE.Vector3(x, hgt, z), b * 0.7); if (i < nb) k.beam(m, new THREE.Vector3(x, 0, z), new THREE.Vector3(x, hgt, z2), b * 0.55); }
  }
  k.box(M.floor, 0, 0.05, -len / 2, w * 0.9, 0.12, len); // walkway
  if (o.room) { const r = o.room; const g = new THREE.BoxGeometry(r[0], r[1], r[2]); g.translate(0, r[1] / 2, -len + r[2] / 2 - 0.2); k.geo(o.roomMat || M.white, g); } // the white room at the end
  if (o.line) k.rod(M.steelD, new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0, -0.4, -len - 0.4), 0.18); // a propellant line under it
  return k.build();
}
// a sphere tank on a ring of legs (LOX and LH2 storage)
function padSphere(k, e, n, r, m) {
  const M = padMats(), y = r * 1.25;
  k.sphere(m || M.white, e, y, n, r, 28);
  for (let i = 0; i < 10; i++) { const a = i * TAU / 10; k.beam(M.galv, PV(e + Math.cos(a) * r * 0.9, 0, n + Math.sin(a) * r * 0.9), PV(e + Math.cos(a) * r * 0.97, y, n + Math.sin(a) * r * 0.97), 0.6); }
  k.box(M.concreteD, e, 0, n, r * 2.4, 0.4, r * 2.4);
}
// a water tower: a cylindrical tank on a lattice of legs
function padWaterTower(k, e, n, h, rTank, hTank) {
  const M = padMats(), y0 = h - hTank;
  k.cyl(M.greyL, e, y0, n, rTank, rTank, hTank, 28); k.cyl(M.greyL, e, h, n, rTank, rTank * 0.3, 2.5, 28);
  for (let i = 0; i < 6; i++) { const a = i * TAU / 6, a2 = (i + 1) * TAU / 6, rb = rTank * 1.15, rt = rTank * 0.75;
    k.beam(M.galv, PV(e + Math.cos(a) * rb, 0, n + Math.sin(a) * rb), PV(e + Math.cos(a) * rt, y0, n + Math.sin(a) * rt), 0.9);
    for (let j = 1; j < 4; j++) { const f = j / 4, y = y0 * f, r = rb + (rt - rb) * f; k.beam(M.galv, PV(e + Math.cos(a) * r, y, n + Math.sin(a) * r), PV(e + Math.cos(a2) * r, y, n + Math.sin(a2) * r), 0.4); } }
  k.cyl(M.galv, e, 0, n, 1.2, 1.2, y0, 12);
}
// a lightning tower: a steel lattice of triangular section (side w) h tall, a fibreglass mast on top
function padLightningTower(k, e, n, h, mast, w = 3.2) {
  const M = padMats(), r = w / Math.sqrt(3), C = [0, 1, 2].map(i => [Math.cos(i * TAU / 3 + 0.5) * r, Math.sin(i * TAU / 3 + 0.5) * r]);
  const top = r * 0.35, lv = Math.round(h / 5);
  for (const [a, b] of C) k.beam(M.galv, PV(e + a, 0, n + b), PV(e + a * top / r, h, n + b * top / r), 0.45);
  for (let i = 0; i < lv; i++) { const f = i / lv, f2 = (i + 1) / lv, s = 1 + (top / r - 1) * f, s2 = 1 + (top / r - 1) * f2;
    for (let c = 0; c < 3; c++) { const [a1, b1] = C[c], [a2, b2] = C[(c + 1) % 3]; k.beam(M.galv, PV(e + a1 * s, h * f, n + b1 * s), PV(e + a2 * s, h * f, n + b2 * s), 0.25); k.beam(M.galv, PV(e + a1 * s, h * f, n + b1 * s), PV(e + a2 * s2, h * f2, n + b2 * s2), 0.2); } }
  k.cyl(M.fibre, e, h, n, 0.45, 0.18, mast, 10);
  return PV(e, h + mast, n);
}
// The automatic camera's launch shot looks at the vehicle from wherever the light is best; these are the directions it
// should not take, because a tower would stand in front of the vehicle: [azimuth, half-width] in degrees, the azimuth
// counted from east toward north as the chase camera counts it, for a structure centred at (e, n) w across (half-width)
// beside a vehicle rv across
const padBlock = (e, n, w, rv) => [Math.atan2(n, e) * RAD, Math.asin(Math.min(1, (w + rv * 0.5) / Math.hypot(e, n))) * RAD + 4];
const KSC_SPHERES = [[-260, 290], [270, 300]]; // the oxygen (northwest) and hydrogen (northeast) spheres of Pads 39A and 39B
// a propellant sphere stands about half as far out as the launch shot's camera and would loom large in the frame: keep it
// out of the picture (w: the sideways clearance that takes, from the camera's usual distance)
const sphereBlock = (e, n, w = 140) => padBlock(e, n, w, 0);
// a sagging wire between two points (a lightning catenary)
function padWire(g, a, b, sag) {
  const pts = []; for (let i = 0; i <= 24; i++) { const f = i / 24; const p = a.clone().lerp(b, f); p.y -= sag * 4 * f * (1 - f); pts.push(p); }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), padMats().wire));
}
// The ground around a pad: scrub and grass (a repeating mottled texture, 80 m to a tile) out to r, cut off at the coast
// (o.sea: the bearing of the sea, degrees; o.shore: the shoreline's distance) with a beach before it, and the roads given
// as strips [[e0, n0, e1, n1, width] …]. Without it the pad would stand on the globe's coarse texture (often sea there).
function padGroundTex() {
  return padGround.tex || (padGround.tex = stripeTex((c, w, h) => {
    // tileable value noise in five octaves (random lattices that wrap at the edges): scrub, grass and bare patches with no
    // regular pattern to repeat from tile to tile
    const rnd = mulberry32(5), v = new Float32Array(w * h);
    for (const [S, amp] of [[4, 0.34], [8, 0.26], [16, 0.18], [32, 0.13], [64, 0.09]]) {
      const L = new Float32Array(S * S); for (let i = 0; i < S * S; i++) L[i] = rnd();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const fx = x / w * S, fy = y / h * S, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const a = L[(y0 % S) * S + x0 % S], b = L[(y0 % S) * S + (x0 + 1) % S], c2 = L[((y0 + 1) % S) * S + x0 % S], d = L[((y0 + 1) % S) * S + (x0 + 1) % S];
        v[y * w + x] += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c2 * (1 - sx) + d * sx) * sy);
      }
    }
    const img = c.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const n = clamp((v[i] - 0.5) * 1.6 + 0.5, 0, 1), o4 = 4 * i; img.data[o4] = 92 + 70 * n; img.data[o4 + 1] = 102 + 54 * n; img.data[o4 + 2] = 64 + 38 * n; img.data[o4 + 3] = 255; }
    c.putImageData(img, 0, 0);
  }, 256, 256));
}
function padGround(g, o = {}) {
  const M = padMats(), R = o.r || 2200, tex = padGroundTex();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const sea = o.sea != null ? o.sea * DEG : null, se = sea != null ? Math.sin(sea) : 0, sn = sea != null ? Math.cos(sea) : 0, shore = o.shore || 1e9;
  // the land: the disc on this side of the shoreline, as rings of modest triangles (long thin ones lose depth precision
  // at a distance, and the beach and roads on them flicker)
  const RINGS = [0, 0.03, 0.07, 0.13, 0.22, 0.35, 0.52, 0.75, 1], NA = 96, pt = (i, j) => {
    const a = i * TAU / NA, r = RINGS[j] * R; let e = Math.sin(a) * r, n = Math.cos(a) * r; const d = e * se + n * sn;
    if (sea != null && d > shore) { e -= (d - shore) * se; n -= (d - shore) * sn; } return [e, n]; };
  const P = [], U = [], V = (e, n) => { P.push(-e, 0.03, n); U.push(-e / 80, n / 80); };
  for (let j = 0; j < RINGS.length - 1; j++) for (let i = 0; i < NA; i++) {
    const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
    V(...a); V(...d); V(...c); if (j > 0) { V(...a); V(...c); V(...b); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); geo.computeVertexNormals();
  if (!padGround.mat) { // the texture again at two larger scales, so its 80-m tiles do not show as a grid
    const m = padGround.mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    m.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <logdepthbuf_fragment>', LOGDEPTH_EXACT).replace('#include <map_fragment>', `#include <map_fragment>
      float pgA = texture2D(map, vMapUv * 0.071 + vec2(0.37, 0.11)).g, pgB = texture2D(map, vMapUv * 0.23 + vec2(0.71, 0.53)).g;
      diffuseColor.rgb *= 0.45 + 0.55 * (pgA + pgB) / (2.0 * 0.2);`); };
    m.customProgramCacheKey = () => 'padGround';
  }
  const land = new THREE.Mesh(geo, padGround.mat); land.userData.padGround = true; g.add(land);
  const k = padKit();
  // strips on the land (the beach along the shoreline, the roads), cut into pieces of about 80 m for the same reason
  const strip = (m, e0, n0, e1, n1, w, y) => { const dx = e1 - e0, dn = n1 - n0, l = Math.hypot(dx, dn), px = -dn / l * w / 2, pn = dx / l * w / 2, ns = Math.max(1, Math.ceil(l / 80));
    for (let s = 0; s < ns; s++) { const f0 = s / ns, f1 = (s + 1) / ns, A0 = e0 + dx * f0, B0 = n0 + dn * f0, A1 = e0 + dx * f1, B1 = n0 + dn * f1;
      k.quads(m, [[PV(A0 + px, y, B0 + pn), PV(A1 + px, y, B1 + pn), PV(A1 - px, y, B1 - pn), PV(A0 - px, y, B0 - pn)]]); } };
  if (sea != null) { const L = Math.sqrt(Math.max(R * R - shore * shore, 0)), b = 45, c = shore - b / 2; // the beach along the shoreline
    strip(M.sand, c * se + sn * L, c * sn - se * L, c * se - sn * L, c * sn + se * L, b, 0.07); }
  for (const [e0, n0, e1, n1, w] of o.roads || []) strip(o.roadMat || M.rock, e0, n0, e1, n1, w, 0.1);
  const built = new THREE.Group(); k.build(built); built.userData.padGround = true; g.add(built); // (hidden when the site's terrain is drawn, app/43_terrain.js)
}
// Launch Complex 39's raised pad: a flat concrete top 99 m east–west by 119 m north–south, h above the ground on a mound
// sloping out at 1 in 2.5 (grassed); the flame trench, 17.7 m wide with its floor at ground level, cut through it north–
// south, the flame deflector in it under the vehicle; the crawlerway climbing to it from the south at 5 %, its two lanes
// either side of the trench.
function ksc39Hardstand(k, h, glow) {
  const M = padMats(), W = 99.1 / 2, D = 118.9 / 2, tw = 17.7 / 2, s = 2.5 * h;
  for (const sd of [-1, 1]) { // the east and west halves, either side of the trench
    const P = (e, y, n) => PV(sd * e, y, n);
    const A = P(tw, h, -D), B = P(W, h, -D), C = P(W, h, D), Dd = P(tw, h, D), A0 = P(tw, 0, -D - s), B0 = P(W + s, 0, -D - s), C0 = P(W + s, 0, D + s), D0 = P(tw, 0, D + s);
    const out = PV(sd, 0.4, 0).normalize();
    k.quads(M.concrete, [[A, Dd, C, B]]);
    k.quads(M.grass, [[B, C, C0, B0]], out); k.quads(M.grass, [[Dd, D0, C0, C]], new THREE.Vector3(0, 0.4, 1)); k.quads(M.grass, [[A, B, B0, A0]], new THREE.Vector3(0, 0.4, -1));
    k.quads(M.concreteD, [[A, A0, D0, Dd]], PV(-sd, 0, 0)); // the trench wall
  }
  k.box(M.soot, 0, 0, 0, 2 * tw, 0.08, 2 * (D + s) + 40); // the trench floor
  // the flame deflector: an inverted V across the trench, its ridge under the engines
  const dw = 14.9 / 2, dl = 22.9 / 2, dh = Math.min(11.9, h - 0.5);
  k.quads(glow, [[PV(dw, dh, 0), PV(-dw, dh, 0), PV(-dw, 0, dl), PV(dw, 0, dl)]], new THREE.Vector3(0, 1, 1)); k.quads(glow, [[PV(-dw, dh, 0), PV(dw, dh, 0), PV(dw, 0, -dl), PV(-dw, 0, -dl)]], new THREE.Vector3(0, 1, -1)); // glowing while the engines fire
  // the ramp up the south side, two 12-m lanes of crushed river rock either side of the trench
  const rl = h / 0.05;
  for (const sd of [-1, 1]) { const e0 = sd * (tw + 1), e1 = sd * (tw + 13); k.quads(M.rock, [[PV(e0, h + 0.05, -D), PV(e1, h + 0.05, -D), PV(e1, 0.05, -D - rl), PV(e0, 0.05, -D - rl)]]); }
}
// the land round Pads 39A and 39B: the Atlantic 400 m to the east, the crawlerway from the foot of the ramp south and then
// west toward the Vehicle Assembly Building; out to 7 km, past the ground observer (6 km south-southwest)
const KSC_GROUND = h => ({ r: 7000, sea: 75, shore: 420, roads: [[0, -59.5 - 2.5 * h - h / 0.05, 0, -560, 40], [0, -560, -5000, -560, 40]] });
// ---------------- Apollo: Mobile Launcher with its Launch Umbilical Tower on Pad 39A ----------------
// The launcher's base 48.8 m (north–south) × 41.1 m × 7.6 m on six 6.7-m pedestals, its deck 14.3 m above the pad, with a
// 13.7-m square opening for the exhaust; the red umbilical tower, 12.2 m square, rises 115.8 m from the deck at the north
// end, its centre 24.4 m north of the rocket's, with the 25-t hammerhead crane on top. Nine swing arms reach the rocket:
// four had swung clear before liftoff (the first stage's intertank and forward arms, the second stage's aft arm, the
// command module's access arm with its white room), five swung away in the seconds after it. Four hold-down arms (3.35 m)
// carry the first stage; three tail service masts stand between its fins.
function padApollo(md) {
  const M = padMats(), k = padKit(), g = new THREE.Group(), h = 12.8, deck = h + 14.3, stand = deck + 3.35 - LAUNCHERS.saturnV.stages[0].eng.len, glow = padGlow();
  ksc39Hardstand(k, h, glow);
  // the launcher's base around its exhaust opening, on its pedestals
  const hw = 13.7 / 2, by = deck - 7.6;
  k.box(M.grey, 0, by, (30.5 + hw) / 2, 41.1, 7.6, 30.5 - hw).box(M.grey, 0, by, (-18.3 - hw) / 2, 41.1, 7.6, 18.3 - hw);
  for (const sd of [-1, 1]) k.box(M.grey, sd * (hw + 20.55) / 2, by, 0, 20.55 - hw, 7.6, 2 * hw);
  k.box(M.greyD, 0, deck - 0.05, 6, 41.1, 0.1, 48.8 - 0.4); // deck plating
  for (const [e, n] of [[-15, -14], [15, -14], [-15, 6], [15, 6], [-15, 26], [15, 26]]) k.box(M.concreteD, e, h, n, 3.2, by - h, 3.2);
  // the umbilical tower, its crane and the arms' hinge posts
  const tn = 24.4, top = deck + 115.8;
  padLattice(k, M.red, 0, tn, 12.2, deck, 115.8, { step: 6.1, core: 4.5, coreMat: M.redD, floorEvery: 3 });
  k.box(M.red, 0, top, tn, 12.6, 1.2, 12.6); // the crane's deck
  k.cyl(M.redD, 0, top + 1.2, tn, 2.2, 2.2, 3.5, 12); // slewing ring and cab
  k.beam(M.red, PV(0, top + 5.2, tn + 9), PV(0, top + 5.2, tn - 25.9), 1.6, 2.2); // the boom, over the rocket
  k.box(M.redD, 0, top + 3.2, tn + 7, 3, 3, 4); // counterweight
  // hold-down arms under the first stage's base and tail service masts, between the fins (the fins point northeast,
  // northwest, southeast and southwest)
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; k.box(M.steelD, Math.cos(a) * 5.6, deck, Math.sin(a) * 5.6, 2.0, 3.35, 3.0, -a); }
  for (const a of [0, Math.PI / 2, Math.PI]) k.box(M.greyD, Math.cos(a) * 10.5, deck, Math.sin(a) * 10.5, 1.6, 7.5, 2.2, -a);
  // propellant spheres at the pad's northwest (oxygen) and northeast (hydrogen) corners
  for (const [e, n] of KSC_SPHERES) padSphere(k, e, n, 10.5);
  k.build(g);
  padGround(g, KSC_GROUND(h));
  // the swing arms: hinged on the tower's south face, reaching south to the rocket; [height above the nozzles, radius of
  // the rocket there, retract start and end (s after liftoff), white room]
  const face = tn - 6.1;
  const ARMS = [[22, 5.05, -30, -17], [39, 5.05, -16.2, -11], [48, 5.05, -900, -880], [58, 5.05, 0, 6.4], [65, 5.05, 0, 7.4], [72, 3.3, 0, 7.7], [84, 3.3, 0, 8.4], [96, 1.96, 0, 9.0], [100.5, 1.96, -300, -290, true]];
  const arms = ARMS.map(([y, r, t0, t1, room], i) => {
    const he = i % 2 ? 4.4 : -4.4, H = PV(he, stand + y - 1.0, face); // hinged near a corner of the face, alternately east and west
    const len = Math.hypot(H.x, H.z) - r - (room ? 1.2 : 0.5), a = padArm(len, room ? 2.2 : 1.6, room ? 2.4 : 1.8, M.red, { room: room ? [3.2, 3.0, 3.4] : null, roomMat: M.white, line: !room });
    const piv = new THREE.Group(); piv.position.copy(H); piv.add(a); g.add(piv);
    return { piv, t0, t1, b0: Math.atan2(H.x, H.z), dir: H.x > 0 ? 1 : -1 }; // b0 aims the arm (local −Z) at the rocket's axis
  });
  const animate = t => { const tl = t - md.M.t0; for (const A of arms) A.piv.rotation.y = A.b0 + A.dir * 1.4 * smoothstep(clamp((tl - A.t0) / (A.t1 - A.t0), 0, 1)); }; // swinging back along the tower's face
  animate(md.M.t0 - 3600);
  return { group: g, stand, glow, deckY: deck, animate, foot: 9, trenchD: 95, block: [padBlock(0, tn, 8, 5), ...KSC_SPHERES.map(p => sphereBlock(...p))] };
}
// ---------------- Space Shuttle: Pads 39A and 39B with the fixed and rotating service structures ----------------
// The Mobile Launcher Platform (48.8 × 41.1 × 7.6 m, its deck 14.3 m above the pad) with the main engines' opening south
// of the tank and the boosters' openings east and west of it, two tail service masts beside the orbiter's tail and six
// sound-suppression water towers ("rainbirds") at its north end. West of the stack the Fixed Service Structure, 12.2 m
// square and 75.3 m tall, with its hammerhead crane (until 1994) and the 24.4-m fibreglass lightning mast topping out at
// 105.8 m, a cable from it to anchors 335 m north and south; the orbiter access arm (44.8 m up, retracted at T−7:24), the
// tank's oxygen vent arm with its hood (the "beanie cap" over the tank's nose: lifted at T−2:30, the arm swung back at
// T−1:45) and the hydrogen vent line, which falls away at liftoff. The Rotating Service Structure, 31 × 15 × 40 m on its
// hinge column, swung back 120° to the southwest. The 88-m water tower to the northeast; the propellant spheres.
function padShuttle(md) {
  const M = padMats(), k = padKit(), g = new THREE.Group(), b39 = md.cfg.site === 'KSC39B', h = b39 ? 15.0 : 12.8, deck = h + 14.3;
  const SRB = LAUNCHERS.shuttle.stages[0], stand = deck + 1.5 - SRB.eng.len, year = tToDate(md.M.t0).getUTCFullYear(), glow = padGlow();
  ksc39Hardstand(k, h, glow);
  // the platform: solid but for its three openings (main engines: e ±5.2, n −13.7…−4.3; boosters: e ±3.35…9.45, n ±6.4)
  const by = deck - 7.6, n0 = -22, n1 = 26.8, H7 = 7.6;
  const slab = (e0, e1, nA, nB) => k.box(M.grey, (e0 + e1) / 2, by, (nA + nB) / 2, e1 - e0, H7, nB - nA);
  slab(-20.55, 20.55, n0, -13.7); slab(-20.55, -5.2, -13.7, -6.4); slab(5.2, 20.55, -13.7, -6.4);
  slab(-20.55, -9.45, -6.4, 6.4); slab(9.45, 20.55, -6.4, 6.4); slab(-3.35, 3.35, -4.3, 6.4); slab(-5.2, -3.35, -6.4, -4.3); slab(3.35, 5.2, -6.4, -4.3);
  slab(-20.55, 20.55, 6.4, n1);
  for (const [e, n] of [[-15, -16], [15, -16], [-15, 2], [15, 2], [-15, 21], [15, 21]]) k.box(M.concreteD, e, h, n, 3.2, by - h, 3.2);
  for (const sd of [-1, 1]) { k.box(M.greyD, sd * 7.7, deck, -9.2, 4.6, 9.4, 2.7); // tail service masts
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; k.cyl(M.steelD, sd * 6.4 + Math.cos(a) * 2.4, deck, Math.sin(a) * 2.4, 1.0, 0.45, 1.5, 10); } } // booster hold-down posts
  for (let i = 0; i < 6; i++) k.cyl(M.greyL, -12.5 + i * 5, deck, 22, 0.6, 0.45, 3.7, 10); // rainbirds
  // the fixed service structure, west of the stack
  const fe = -28, top = h + 75.3;
  padLattice(k, M.grey, fe, 0, 12.2, h, 75.3, { step: 6.1, core: 4, coreMat: M.greyD, floorEvery: 2 });
  if (year < 1994) { k.box(M.grey, fe, top, 0, 12.6, 1.0, 12.6); k.cyl(M.greyD, fe, top + 1, 0, 2, 2, 3, 12); k.beam(M.grey, PV(fe - 8, top + 4.5, 0), PV(fe + 20, top + 4.5, 0), 1.4, 1.8); }
  k.beam(M.grey, PV(fe, top, 0), PV(fe, top + 6, 0), 1.2); k.cyl(M.fibre, fe, top + 6, 0, 0.5, 0.15, 24.4, 10); // the lightning mast
  // the rotating service structure, parked: its hinge column by the fixed tower's southeast corner, the structure 17–49 m
  // out from it on a bearing of 210°, 18–58 m up, its outer end on a column down to the wheels on the circular rail
  const hE = -21, hN = -10, br = 210 * DEG, ue = Math.sin(br), un = Math.cos(br);
  padLattice(k, M.greyL, hE, hN, 4, h, 58, { step: 6, floors: false });
  { const a0 = 17, a1 = 48.8, mid = (a0 + a1) / 2, cE = hE + ue * mid, cN = hN + un * mid, y0 = h + 18;
    padTrussBox(k, M.greyL, cE, cN, y0, 15.2, a1 - a0, 39.6, br, { bay: 6.3, step: 6.6, beam: 0.55 });
    // the payload changeout room, clad, filling most of the frame; the frame's roof
    const geo = new THREE.BoxGeometry(12.2, 27, (a1 - a0) - 6); geo.rotateY(-(Math.atan2(-ue, un))); geo.translate(-cE, y0 + 4 + 13.5, cN); k.geo(M.white, geo);
    const roof = new THREE.BoxGeometry(15.2, 0.6, a1 - a0); roof.rotateY(-(Math.atan2(-ue, un))); roof.translate(-cE, y0 + 39.6, cN); k.geo(M.greyL, roof);
    k.beam(M.greyL, PV(hE, h + 50, hN), PV(hE + ue * a0, h + 50, hN + un * a0), 2.5); k.beam(M.greyL, PV(hE, h + 22, hN), PV(hE + ue * a0, h + 22, hN + un * a0), 2.5);
    k.box(M.greyD, hE + ue * (a1 - 2), h, hN + un * (a1 - 2), 4, 18, 4);
    // its circular rail on the pad, from the stack (bearing 90°) round to where it is parked
    for (let i = 0; i < 24; i++) { const b1 = (90 + 120 * i / 24) * DEG, b2 = (90 + 120 * (i + 1) / 24) * DEG;
      for (const rr of [a1 - 3.2, a1 - 0.8]) k.beam(M.steelD, PV(hE + Math.sin(b1) * rr, h + 0.12, hN + Math.cos(b1) * rr), PV(hE + Math.sin(b2) * rr, h + 0.12, hN + Math.cos(b2) * rr), 0.3, 0.2); } }
  // water tower, propellant spheres, the hypergolic farms
  padWaterTower(k, 130, 90, 88.4, 6.6, 9); for (const [e, n] of KSC_SPHERES) padSphere(k, e, n, 10.5);
  for (const e of [-230, 230]) for (let i = 0; i < 3; i++) k.cyl(M.white, e + i * 9, 0, -260, 3, 3, 8, 16);
  k.build(g); padGround(g, KSC_GROUND(h));
  // arms on the fixed tower (hinged on its east face, reaching east): the orbiter access arm with its white room, the oxygen
  // vent arm with its hood over the tank's nose; [height above the pad, reach, swing-away start and end (s from liftoff)]
  const face = fe + 6.1, etTop = stand + 9.26 + 46.9, arms = [];
  const mk = (y, nH, reach, t0, t1, sw, o) => { const a = padArm(reach, 2.0, 2.3, M.grey, o), piv = new THREE.Group(); piv.position.copy(PV(face, y, nH)); piv.add(a); g.add(piv);
    const tgt = PV(0, y, o.toN ?? 0), b0 = Math.atan2(tgt.x - piv.position.x, tgt.z - piv.position.z) + Math.PI; arms.push({ piv, b0, t0, t1, sw }); return piv; };
  mk(h + 44.8, -4.5, 19.8, -444, -414, -70 * DEG, { room: [3.0, 3.0, 3.2], roomMat: M.white, toN: -8.5 }); // to the crew hatch on the orbiter's left side
  const gox = mk(etTop - 2.5, 0, Math.abs(face) - 2.2, -105, -80, 80 * DEG, { toN: 0 }); // to the tank's nose
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.3, 2.8, 20), M.white); hood.position.set(0, 1.4, -(Math.abs(face) - 0.6)); gox.children[0].add(hood); // over the top of the nose cone
  const h2 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1, 8), M.steelD); g.add(h2);
  const h2a = PV(face, h + 51, 0.5), h2b = PV(-4.0, stand + 9.26 + 31.0, 0.5); // the hydrogen vent line to the tank's intertank
  // lightning cable over the mast
  const tip = PV(fe, top + 30.4, 0); padWire(g, PV(fe, 2, 335), tip, 8); padWire(g, tip, PV(fe, 2, -335), 8);
  const animate = t => {
    const tl = t - md.M.t0;
    for (const A of arms) A.piv.rotation.y = A.b0 + A.sw * smoothstep(clamp((tl - A.t0) / (A.t1 - A.t0), 0, 1));
    hood.position.y = 1.4 + 3.0 * smoothstep(clamp((tl + 150) / 25, 0, 1)); // the hood lifts off the vents before the arm swings back
    const drop = smoothstep(clamp(tl / 2.5, 0, 1)); // at liftoff the vent line lets go and swings down against the tower
    const b = h2b.clone().lerp(PV(face + 0.5, h + 40, 0.5), drop); h2.position.copy(h2a).add(b).multiplyScalar(0.5); h2.scale.y = h2a.distanceTo(b); h2.quaternion.setFromUnitVectors(_padY, b.clone().sub(h2a).normalize());
  };
  animate(md.M.t0 - 3600);
  return { group: g, stand, glow, deckY: deck, animate, foot: 12, trenchD: 95, block: [padBlock(fe, 0, 6.1, 8.4), padBlock(hE + ue * 32.9, hN + un * 32.9, 16, 8.4), ...KSC_SPHERES.map(p => sphereBlock(...p))] };
}
// ---------------- SLS: Mobile Launcher 1 on Pad 39B (Artemis) ----------------
// The launcher's base 50.3 × 41.1 × 7.6 m, deck 14.3 m above the pad, its exhaust opening 19.5 m across the boosters' line
// by 10.4 m; the grey tower, 12.2 m square, rises 105 m from the deck north of the rocket, flat-topped. Its arms reach south:
// the core stage's intertank umbilical (42.7 m above the deck), forward skirt umbilical (54.9), the vehicle stabiliser
// (61), the upper stage's umbilical (73.2), the crew access arm (83.5) and Orion's service module umbilical (85.3); the
// crew access arm swings back after the hatch is closed, the rest in the seconds after liftoff. Two tail service masts on
// the deck south of the core stage; eight posts under the boosters. A "clean pad": three 181-m lightning towers (steel
// lattice and fibreglass mast) with wires between their tips; the water tower; the oxygen sphere and the two hydrogen
// spheres (the 2022 one 25 m across).
function padSLS(md) {
  const M = padMats(), k = padKit(), g = new THREE.Group(), h = 15.0, deck = h + 14.3, stand = deck - 3.3, glow = padGlow();
  ksc39Hardstand(k, h, glow);
  const by = deck - 7.6, n0 = -20, n1 = 30.3, hx = 19.5 / 2, hn = 10.4 / 2;
  const slab = (e0, e1, nA, nB) => k.box(M.greyL, (e0 + e1) / 2, by, (nA + nB) / 2, e1 - e0, 7.6, nB - nA);
  slab(-20.55, 20.55, n0, -hn); slab(-20.55, 20.55, hn, n1); slab(-20.55, -hx, -hn, hn); slab(hx, 20.55, -hn, hn);
  for (const [e, n] of [[-15, -14], [15, -14], [-15, 6], [15, 6], [-15, 26], [15, 26]]) k.box(M.concreteD, e, h, n, 3.2, by - h, 3.2);
  for (const sd of [-1, 1]) { k.box(M.greyL, sd * 4.2, deck, -7.6, 4.0, 10.1, 3.0); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; k.cyl(M.steelD, sd * 6.1 + Math.cos(a) * 2.3, deck, Math.sin(a) * 2.3, 0.6, 0.4, 1.5, 8); } }
  const tn = 18.5 + 6.1, ttop = deck + 105.2;
  padLattice(k, M.greyL, 0, tn, 12.2, deck, 105.2, { step: 6.1, core: 5, coreMat: M.grey, floorEvery: 2 });
  k.box(M.greyL, 0, ttop, tn, 12.6, 1.2, 12.6); k.cyl(M.fibre, 0, ttop + 1.2, tn, 0.4, 0.12, 8, 8);
  // lightning towers (northwest, northeast, south) and their wires
  const T1 = padLightningTower(k, -175, 160, 152, 29), T2 = padLightningTower(k, 175, 160, 152, 29), T3 = padLightningTower(k, 0, -235, 152, 29);
  padWaterTower(k, 115, 70, 88.4, 6.6, 9); for (const [e, n] of KSC_SPHERES) padSphere(k, e, n, 10.5); padSphere(k, 300, 215, 12.6);
  k.build(g); padGround(g, KSC_GROUND(h));
  padWire(g, T1, T2, 18); padWire(g, T2, T3, 18); padWire(g, T3, T1, 18);
  for (const T of [T1, T2, T3]) for (const d of [-1, 1]) padWire(g, T, T.clone().add(new THREE.Vector3(d * 60, -T.y + 1, -T.z * 0.15)), 6);
  const face = tn - 6.1, arms = [];
  const ARMS = [[42.7, 4.2, 0, 4], [54.9, 4.2, 0, 4.5], [61.0, 4.2, 0, 5], [73.2, 2.6, 0, 5.5], [83.5, 2.5, -1500, -1440, true], [85.3, 2.5, 0, 6]]; // above the deck; rocket radius; swing-away; white room
  ARMS.forEach(([y, r, t0, t1, room], i) => {
    const he = i % 2 ? 4.0 : -4.0, H = PV(he, deck + y, face), len = Math.hypot(H.x, H.z) - r - (room ? 1.0 : 0.6);
    const a = padArm(len, room ? 2.4 : 1.8, room ? 2.6 : 2.0, room ? M.white : M.greyL, { room: room ? [3.0, 3.0, 3.4] : null, roomMat: M.white, line: !room });
    const piv = new THREE.Group(); piv.position.copy(H); piv.add(a); g.add(piv); arms.push({ piv, t0, t1, b0: Math.atan2(H.x, H.z), dir: H.x > 0 ? 1 : -1 });
  });
  const animate = t => { const tl = t - md.M.t0; for (const A of arms) A.piv.rotation.y = A.b0 + A.dir * 1.35 * smoothstep(clamp((tl - A.t0) / (A.t1 - A.t0), 0, 1)); };
  animate(md.M.t0 - 3600);
  return { group: g, stand, glow, deckY: deck, animate, foot: 9, trenchD: 95, block: [padBlock(0, tn, 8, 8), ...[T1, T2, T3].map(T => padBlock(-T.x, T.z, 2, 8)), ...[...KSC_SPHERES, [300, 215]].map(p => sphereBlock(...p))] };
}
// ---------------- Falcon Heavy on Pad 39A (SpaceX) ----------------
// The rocket stands on SpaceX's launch mount over the covered flame trench, held by the transporter-erector: a 73-m steel
// strongback on its south side that brought it up the ramp from the hangar and raised it. A few minutes before launch it
// leans back 1.5°; at liftoff it swings clear. West of the pad the old fixed service structure, grey, with its lightning
// mast and SpaceX's crew access arm (66 m up, swung away for an uncrewed flight); the rotating structure is gone. The
// Horizontal Integration Facility 500 m south at the foot of the ramp; SpaceX's Starship tower 300 m east.
function padFH(md) {
  const M = padMats(), k = padKit(), g = new THREE.Group(), h = 12.8, mountTop = h + 6.5, stand = mountTop - LAUNCHERS.falconHeavy.stages[1].eng.len, glow = padGlow();
  ksc39Hardstand(k, h, glow);
  k.box(M.concreteD, 0, h, -2, 24, 6.5, 18); k.box(M.greyD, 0, mountTop - 0.4, 0, 14, 0.4, 7); // the launch mount
  const fe = -28, top = h + 75.3;
  padLattice(k, M.grey, fe, 0, 12.2, h, 75.3, { step: 6.1, core: 4, coreMat: M.greyD, floorEvery: 2 });
  k.beam(M.grey, PV(fe, top, 0), PV(fe, top + 6, 0), 1.2); k.cyl(M.fibre, fe, top + 6, 0, 0.5, 0.15, 24.4, 10);
  { const piv = PV(fe + 6.1, h + 66.1, 0); const geo = new THREE.BoxGeometry(2.8, 3.0, 25.9); geo.translate(0, 1.5, -12.95); geo.rotateY(-0.35 - Math.PI / 2 - 1.3); geo.translate(piv.x, piv.y, piv.z); k.geo(M.white, geo); } // the crew access arm, swung back
  // the hangar at the foot of the ramp; SpaceX's Starship tower to the east
  k.box(M.white, 0, 0, -500, 87, 26, 37); k.box(M.greyL, 0, 0, -481.4, 60, 22, 0.4);
  padStarshipTower(k, 300, 0, 0);
  padWaterTower(k, 130, 90, 88.4, 6.6, 9); padSphere(k, -260, 290, 10.5);
  for (let i = 0; i < 3; i++) k.cyl(M.white, 240 + i * 9, 0, 250, 3.5, 3.5, 14, 16);
  k.build(g); padGround(g, { ...KSC_GROUND(h), roads: [[0, -59.5 - 2.5 * h - h / 0.05, 0, -480, 30]] });
  const tip = PV(fe, top + 30.4, 0); padWire(g, PV(fe, 2, 335), tip, 8); padWire(g, tip, PV(fe, 2, -335), 8);
  // the transporter-erector: its hinge at the launch mount's south edge, the strongback standing against the cores
  const te = new THREE.Group(); te.position.copy(PV(0, mountTop - 1, -4.6)); g.add(te);
  { const kk = padKit(), W = 9.5, L = 72.5; for (const sx of [-W / 2, W / 2]) for (const sz of [0, -2.2]) kk.beam(M.greyL, new THREE.Vector3(sx, 0, sz), new THREE.Vector3(sx, L, sz), 0.55);
    for (let i = 0; i <= 24; i++) { const y = L * i / 24, y2 = L * (i + 1) / 24; kk.beam(M.greyL, new THREE.Vector3(-W / 2, y, 0), new THREE.Vector3(W / 2, y, 0), 0.4); kk.beam(M.greyL, new THREE.Vector3(-W / 2, y, -2.2), new THREE.Vector3(W / 2, y, -2.2), 0.4);
      if (i < 24) { kk.beam(M.greyL, new THREE.Vector3(-W / 2, y, 0), new THREE.Vector3(W / 2, y2, 0), 0.3); kk.beam(M.greyL, new THREE.Vector3(-W / 2, y, -2.2), new THREE.Vector3(W / 2, y2, -2.2), 0.3); } }
    for (const y of [22, 40, 58]) kk.beam(M.greyD, new THREE.Vector3(0, y, 0), new THREE.Vector3(0, y, 2.4), 0.8); // clamp arms to the centre core
    kk.build(te); }
  const animate = t => { const tl = t - md.M.t0; te.rotation.x = -(1.5 * DEG * smoothstep(clamp((tl + 240) / 20, 0, 1)) + 22 * DEG * smoothstep(clamp(tl / 4, 0, 1))); };
  animate(md.M.t0 - 3600);
  return { group: g, stand, glow, deckY: mountTop, animate, foot: 7, trenchD: 95, block: [[270, 30], padBlock(fe, 0, 6.1, 5.6), sphereBlock(-260, 290)] }; // the erector stands against the cores' south side
}
// SpaceX's launch and catch tower ("Mechazilla", as at Starbase and on Pad 39A): 143 m of dark steel modules, about 12 m
// square, a 3-m lightning rod; the two 36-m catch arms ("chopsticks") on their carriage and the ship's quick-disconnect
// arm, both reaching toward the launch mount (facing +E from a tower at e, n: arms toward dir, radians from east)
function padStarshipTower(k, e, n, dir = 0, g = null) {
  const M = padMats(), w = 12;
  padLattice(k, M.black, e, n, w, 0, 143, { step: 6, core: 6, coreMat: M.greyD, floors: false, col: 1.1, beam: 0.7 });
  k.cyl(M.galv, e, 143, n, 0.25, 0.1, 3, 6);
  const ce = Math.cos(dir), cn = Math.sin(dir), pe = -cn, pn = ce, y = 74, f0 = PV(e + ce * w / 2, y, n + cn * w / 2);
  k.box(M.greyD, e + ce * (w / 2 + 1), y - 3, n + cn * (w / 2 + 1), 5, 7, 5); // the carriage
  if (!g) { // still: the chopsticks opened a little, the quick-disconnect arm out
    for (const s of [-1, 1]) k.beam(M.greyD, f0.clone().add(PV(pe * s * 3, 0, pn * s * 3)), PV(e + ce * (w / 2 + 34) + pe * s * 7, y, n + cn * (w / 2 + 34) + pn * s * 7), 1.6, 3.2);
    k.beam(M.greyD, PV(e + ce * w / 2, 91, n + cn * w / 2), PV(e + ce * (w / 2 + 14), 91, n + cn * (w / 2 + 14)), 1.4, 2.0);
    return null;
  }
  // in motion (g: the pad group): each chopstick a lattice arm on its own pivot at the carriage (rotation.y opens it), the
  // quick-disconnect arm on a pivot at the tower's face (rotation.y swings it back along the face)
  const mkArm = (len, wd, hg, yy, side) => { const piv = new THREE.Group(); piv.position.copy(PV(e + ce * (w / 2 + 1.5) + pe * side * 2.6, yy, n + cn * (w / 2 + 1.5) + pn * side * 2.6)); const a = padArm(len, wd, hg, M.greyD, {}); a.rotation.y = Math.atan2(-ce, cn) + Math.PI; piv.add(a); g.add(piv); return piv; };
  const sticks = [mkArm(36, 1.6, 3.2, y - 1.6, -1), mkArm(36, 1.6, 3.2, y - 1.6, 1)];
  for (const [i, st] of sticks.entries()) { const s = i ? 1 : -1; const tip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 2.8), M.yellow); tip.position.set(0, 1.6, -35.5); st.children[0].add(tip); st.userData.side = s; }
  const qd = mkArm(14, 1.4, 2.0, 91 - 1, 0); qd.position.copy(PV(e + ce * w / 2, 90, n + cn * w / 2));
  return { sticks, qd, base: Math.atan2(-ce, cn) + Math.PI };
}
// ---------------- Atlas V on Space Launch Complex 41 (Perseverance, 2020) ----------------
// A "clean pad": the rocket rolls the 550 m from the Vertical Integration Facility on its Mobile Launch Platform (16.8 ×
// 13.7 m, its 56-m umbilical mast on the north side carrying the Centaur's lines) and stands over the flame duct between
// four lightning towers (about 105 m, steel with a fibreglass mast) whose wires cage the pad. The Crew Access Tower (61 m,
// 2016) stands to the northwest, its arm (52 m up) swung away; the 89-m integration building to the south.
function padSLC41(md) {
  const M = padMats(), k = padKit(), g = new THREE.Group(), deck = 9.0, stand = deck + 0.5 - LAUNCHERS.atlasV541.stages[1].eng.len;
  k.box(M.concrete, 0, 0, 0, 70, 0.3, 90); k.box(M.soot, 0, 0.3, 0, 9, 0.05, 30); // the pad apron and the duct's grating
  k.box(M.white, 0, 1.2, 0, 16.8, deck - 1.2, 13.7); k.box(M.greyD, 0, 0, 0, 14, 1.2, 11); // the platform on its trucks
  for (const e of [-3.6, 3.6]) k.box(M.steelD, e, 0, -300, 0.4, 0.3, 600); // the rails to the integration building
  padLattice(k, M.white, 0, 9.6, 4.2, deck, 47.4, { step: 4.8, floors: false, col: 0.5, beam: 0.3 }); k.cyl(M.greyD, 0, deck + 47.4, 9.6, 0.9, 0.9, 2.2, 10); // the umbilical mast, its wind damper
  for (const y of [deck + 26, deck + 40]) k.beam(M.greyD, PV(0, y, 7.5), PV(0, y - 1.5, 2.2), 0.5); // the Centaur's umbilicals
  padLattice(k, M.grey, -18, 26, 6.1, 0, 61, { step: 8.5, core: 2.2, coreMat: M.greyD, col: 0.55, beam: 0.35 }); // crew access tower
  { const geo = new THREE.BoxGeometry(2.4, 2.6, 13); geo.translate(0, 1.3, -6.5); geo.rotateY(Math.PI * 0.85); geo.translate(18 + 3, 52.4, 26 - 3); k.geo(M.white, geo); }
  const T = [[-80, 75], [80, 75], [80, -75], [-80, -75]].map(([e, n]) => padLightningTower(k, e, n, 75, 30, 2.8));
  k.box(M.white, 0, 0, -549, 40, 89, 35); k.box(M.greyL, 0, 0, -531.4, 12.5, 83.8, 0.4); // the integration building and its door
  padSphere(k, -150, 130, 7.5); k.box(M.greyL, 0, 0, 60, 26, 7, 14); // oxygen sphere, the pad equipment building
  k.build(g); padGround(g, { sea: 80, shore: 900, roads: [[0, -60, 0, -530, 14]] });
  for (let i = 0; i < 4; i++) { padWire(g, T[i], T[(i + 1) % 4], 12); padWire(g, T[i], T[(i + 2) % 4], 16); }
  const glow = padGlow(), lit = new THREE.Mesh(new THREE.PlaneGeometry(9, 30), glow); lit.rotation.x = -Math.PI / 2; lit.position.y = 0.4; g.add(lit);
  return { group: g, stand, glow, deckY: deck, foot: 5, trenchD: 30, block: [padBlock(0, 9.6, 2.1, 3.5), padBlock(-18, 26, 3.05, 3.5), ...T.map(p => padBlock(-p.x, p.z, 1.6, 3.5)), sphereBlock(-150, 130, 87)] };
}
// ---------------- Atlas-Agena on Launch Complex 12 (Mariner 4, 1964) ----------------
// The launch stand: a 6.1-m concrete pedestal (18 × 24 m) with the launcher ring on top, the flame bucket under it opening
// to the east, a ramp up its southwest side; the umbilical tower (31 m) beside the rocket with booms to the Atlas and the
// Agena; the red service tower (about 50 m, an A-frame), rolled back 90 m on its rails; the domed blockhouse 230 m west.
function padLC12(md) {
  const M = padMats(), k = padKit(), g = new THREE.Group(), deck = 6.1, stand = deck + 0.6 - LAUNCHERS.atlasAgena.stages[0].eng.len;
  k.box(M.concrete, 0, 0, 0, 18.3, deck, 23.8); k.box(M.soot, 0, 0, 0, 7, 0.05, 40);
  // the launcher: a steel ring stand on four legs over the deflector's opening, the hold-down arms at the tank's foot
  k.box(M.black, 0, deck - 0.02, 0, 5.4, 0.04, 5.4); for (const [e, n] of [[-2.6, -2.6], [2.6, -2.6], [2.6, 2.6], [-2.6, 2.6]]) k.box(M.steelD, e, deck, n, 0.7, 0.6, 0.7);
  k.cyl(M.steelD, 0, deck + 0.6, 0, 2.2, 2.2, 0.5, 32); k.cyl(M.steel, 0, deck + 1.1, 0, 1.75, 1.75, 0.25, 32, true);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; k.box(M.yellow, Math.cos(a) * 2.1, deck + 1.1, Math.sin(a) * 2.1, 0.5, 1.0, 0.5, -a); }
  // the deck: railings round its edge, the stair down its east side, cable trays and pipes from the tower to the stand
  const rail = (a, b) => { k.beam(M.galv, a, b, 0.06, 0.06); const n = Math.max(1, Math.round(a.distanceTo(b) / 2)); for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n); k.beam(M.galv, p.clone().setY(deck), p, 0.06); } };
  const dy = deck + 1.05, E = 9.15, N = 11.9; rail(PV(-E, dy, -N), PV(-E, dy, -8.4)); rail(PV(-E, dy, -0.1), PV(-E, dy, N)); rail(PV(-E, dy, N), PV(E, dy, N)); rail(PV(E, dy, N), PV(E, dy, -N)); rail(PV(E, dy, -N), PV(-E, dy, -N));
  for (let i = 0; i < 12; i++) k.box(M.galv, E + 1.2, deck * (i + 1) / 12 - 0.1, 2.5 - i * 0.3, 2.0, 0.1, 0.3); k.box(M.galv, E + 1.2, 0, 4.2, 2.2, deck, 0.2);
  for (const n of [-1.2, 1.2]) k.box(M.greyD, -3.4, deck, n, 4.0, 0.3, 0.5); k.rod(M.steel, PV(-5, deck + 0.5, 1.9), PV(-1.9, deck + 0.5, 1.9), 0.18); k.rod(M.steel, PV(-5, deck + 0.8, 2.3), PV(-1.9, deck + 0.8, 2.3), 0.12);
  for (const [e, n, w] of [[6, -8, 2.2], [6, -4.5, 1.6], [-6, 9, 2.0]]) k.box(M.grey, e, deck, n, w, 1.4, 1.0); // equipment cabinets
  k.quads(M.concrete, [[PV(-9.15, deck, -8), PV(-9.15, deck, -0.5), PV(-36, 0, -0.5), PV(-36, 0, -8)]]); // the ramp
  padLattice(k, M.red, -6.5, 0, 3.0, deck, 25, { step: 3.1, floors: false, col: 0.4, beam: 0.25 }); // umbilical tower
  for (const y of [deck + 14, deck + 23]) k.beam(M.redD, PV(-5, y, 0), PV(-1.4, y - 1, 0), 0.4);
  for (const y of [deck + 6.2, deck + 12.4, deck + 18.6]) k.box(M.floor, -6.5, y, 0, 3.4, 0.2, 3.4); k.box(M.greyD, -6.5, deck + 25, 0, 2.0, 2.4, 2.0); // its landings and the hoist house on top
  for (const y of [deck + 8, deck + 17]) k.rod(M.galv, PV(-5, y, 0), PV(-1.6, y, 0), 0.08); // the umbilical lines
  // the service tower, rolled 90 m north along its rails
  const sn = 95; for (const e of [-6, 6]) k.box(M.steelD, e, 0, sn / 2, 0.4, 0.3, sn + 20);
  for (const sd of [-1, 1]) for (const se of [-1, 1]) k.beam(M.red, PV(sd * 9, 0, sn + se * 8), PV(sd * 4, 50, sn + se * 5), 1.2);
  padLattice(k, M.red, 0, sn, 8, 0, 50, { step: 5, floors: true, col: 0.5, beam: 0.35 });
  k.sphere(M.concrete, -230, -6, 0, 13, 24); // the blockhouse's dome
  k.build(g); padGround(g, { sea: 95, shore: 300, roads: [[-230, 0, -30, 0, 8]] });
  const glow = padGlow(), lit = new THREE.Mesh(new THREE.PlaneGeometry(7, 20), glow); lit.rotation.x = -Math.PI / 2; lit.position.y = 0.3; g.add(lit);
  return { group: g, stand, glow, deckY: deck, foot: 3, trenchD: 22, block: [padBlock(-6.5, 0, 1.5, 3), padBlock(0, sn, 9, 3)] };
}
// ---------------- Long March 5 on Wenchang LC-101 (2020) ----------------
// The rocket rolls 2.8 km from its 99-m assembly building on a 2,000-t mobile launch platform (16 wheels on 20-m-gauge
// rails) and stands beside the 91.7-m fixed service tower (12 levels, its three sets of rotating work platforms swung
// open for launch) over the two-way flame trench; four 120-m lightning towers with wires between them; the sea 600 m to
// the southeast.
function padWenchang(md) {
  const M = padMats(), k = padKit(), g = new THREE.Group(), deck = 9.0, stand = deck + 1.0 - LAUNCHERS.lm5.stages[1].eng.len;
  k.box(M.concrete, 0, 0, 0, 80, 0.3, 80); k.box(M.soot, 0, 0.3, 0, 10, 0.05, 70);
  k.box(M.greyL, 0, 1.5, 0, 26, deck - 1.5, 22); for (const e of [-10, 10]) k.box(M.greyD, e, 0, 0, 4, 1.5, 20); // the platform on its bogies
  for (const e of [-10, 10]) { k.box(M.steelD, e, 0, -900, 0.5, 0.3, 1800); }
  // the fixed service tower, west of the rocket, its platforms swung open
  const fe = -17;
  padLattice(k, M.greyL, fe, 0, 10, 0, 91.7, { step: 7.6, core: 5, coreMat: M.white, floorEvery: 1 });
  for (const y of [28, 46, 64]) for (const s of [-1, 1]) { const geo = new THREE.BoxGeometry(8, 2.2, 3); geo.translate(4, 1.1, 0); geo.rotateY(s * 1.2); geo.translate(-(fe + 5), y, s * 5); k.geo(M.white, geo); }
  k.box(M.white, fe, 91.7, 0, 10.5, 2.5, 10.5);
  const T = [[-70, 70], [70, 70], [70, -70], [-70, -70]].map(([e, n]) => padLightningTower(k, e, n, 92, 28, 3.0));
  k.box(M.white, -1400, 0, 2400, 60, 99.4, 45); // the assembly building, 2.8 km up the rails
  k.build(g); padGround(g, { sea: 135, shore: 600, r: 3000 });
  for (let i = 0; i < 4; i++) padWire(g, T[i], T[(i + 1) % 4], 12);
  const glow = padGlow(), lit = new THREE.Mesh(new THREE.PlaneGeometry(10, 40), glow); lit.rotation.x = -Math.PI / 2; lit.position.y = 0.4; g.add(lit);
  return { group: g, stand, glow, deckY: deck, foot: 7, trenchD: 40, block: [padBlock(fe, 0, 5, 5), ...T.map(p => padBlock(-p.x, p.z, 1.5, 5))] };
}
// ---------------- Ariane 5 on ELA-3, Kourou ----------------
// The launch table: a 900-t steel platform rolled out on rails from the final-assembly building 2.8 km away, the 58-m
// umbilical mast standing on it; the concrete launch zone under it with three flame trenches (one for each booster,
// one for the core) running north; the water tower, the four lightning masts at the zone's corners; jungle round it.
function padELA3(md) {
  const M = padMats(), k = padKit(), g = new THREE.Group(), top = 8.0, stand = top - LAUNCHERS.ariane5ECA.stages[1].eng.len;
  k.box(M.concrete, 0, 0, 0, 90, 0.3, 90); for (const e of [-4.3, 0, 4.3]) k.box(M.soot, e, 0.3, 30, 6, 0.05, 60); // the zone and its three trenches
  k.box(M.greyL, 0, 1.2, 0, 25, top - 1.2, 21); for (const e of [-9, 9]) k.box(M.greyD, e, 0, 0, 4, 1.2, 18); // the table on its bogies
  k.box(M.black, 0, top - 0.02, 0, 12, 0.04, 8); for (const e of [-4.3, 4.3]) k.cyl(M.steelD, e, top, 0, 2.0, 2.0, 0.6, 24); k.cyl(M.steelD, 0, top, 0, 2.9, 2.9, 0.6, 32); // the exhaust ducts' rims, the core's and the boosters' support rings
  for (const e of [-10, 10]) k.box(M.steelD, e, 0, -1400, 0.5, 0.3, 2800); // the rails west to the BAF
  const mn = 9.5; padLattice(k, M.white, 0, mn, 6, top, 58, { step: 5.8, core: 3, coreMat: M.greyL, floorEvery: 2 }); // the umbilical mast on the table's north edge
  for (const y of [top + 24, top + 41, top + 50]) k.beam(M.greyL, PV(0, y, mn - 3), PV(0, y - 0.6, 3.2), 0.5); // the umbilical arms to the core and the upper stage
  k.box(M.greyL, 0, top + 58, mn, 6.5, 1.5, 6.5); k.cyl(M.fibre, 0, top + 59.5, mn, 0.3, 0.1, 6, 8);
  padWaterTower(k, 80, 20, 90, 7, 10);
  const T = [[-90, 90], [90, 90], [90, -90], [-90, -90]].map(([e, n]) => padLightningTower(k, e, n, 70, 22, 2.8));
  k.box(M.greyL, -2800, 0, 0, 90, 90, 60); // the final-assembly building, down the rails
  k.build(g); padGround(g, { sea: 60, shore: 1800, r: 6500, roads: [[0, -60, -2800, -60, 10], [60, 0, 2000, 0, 8]] }); // (the disc reaches past the ground camera, 5.9 km out)
  for (let i = 0; i < 4; i++) padWire(g, T[i], T[(i + 1) % 4], 10);
  const glow = padGlow(), lit = new THREE.Mesh(new THREE.PlaneGeometry(16, 40), glow); lit.rotation.x = -Math.PI / 2; lit.position.y = 0.4; lit.position.z = 20; g.add(lit);
  return { group: g, stand, glow, deckY: top, foot: 6, trenchD: 40, block: [padBlock(0, mn, 3, 5), padBlock(80, 20, 8, 5), ...T.map(p => padBlock(-p.x, p.z, 1.4, 5))] };
}
// ---------------- Starship at Starbase, Texas ----------------
// The orbital launch mount: a ring-shaped table on six legs, its top 20 m up, with twenty clamps for the booster; the water-
// cooled steel plate under it; the launch and catch tower 28 m west (143 m, its chopsticks and the ship's quick-disconnect
// arm toward the mount); the tank farm's white tanks to the west; the beach 700 m east.
function padStarbase(md) {
  const M = padMats(), k = padKit(), g = new THREE.Group(), top = 20, stand = top - LAUNCHERS.starship.stages[0].eng.len;
  k.box(M.concrete, 0, 0, 0, 120, 0.3, 120); k.box(M.steelD, 0, 0.3, 0, 22, 0.8, 22); // the pad and the steel plate
  for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + Math.PI / 6; k.cyl(M.greyD, Math.cos(a) * 9.5, 0, Math.sin(a) * 9.5, 1.3, 1.3, top - 2.5, 16); }
  { const ring = new THREE.RingGeometry(5.6, 10.5, 36, 1); ring.rotateX(-Math.PI / 2);
    const tbl = new THREE.CylinderGeometry(10.5, 10.5, 2.5, 36, 1, true); tbl.translate(0, top - 1.25, 0); k.geo(M.greyD, tbl);
    const inn = new THREE.CylinderGeometry(5.6, 5.6, 2.5, 36, 1, true); inn.translate(0, top - 1.25, 0); k.geo(M.greyD, inn);
    ring.translate(0, top, 0); k.geo(M.greyD, ring); const ring2 = ring.clone(); ring2.rotateX(Math.PI); ring2.translate(0, 2 * top - 2.5, 0); k.geo(M.greyD, ring2); }
  for (let i = 0; i < 20; i++) { const a = i * TAU / 20; k.box(M.steelD, Math.cos(a) * 5.4, top - 0.4, Math.sin(a) * 5.4, 0.9, 0.5, 1.4, -a); } // the clamps' seats on the table
  const tower = padStarshipTower(k, -28, -3, 0, g);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) { const geo = new THREE.CylinderGeometry(3.2, 3.2, 26, 20); geo.rotateX(Math.PI / 2); geo.translate(-(-150 - i * 9), 3.6, -60 + r * 34); k.geo(M.white, geo); } // horizontal tanks
  k.build(g); padGround(g, { sea: 90, shore: 700, roads: [[-400, -80, 400, -80, 12]], roadMat: M.asphalt });
  const glow = padGlow(), lit = new THREE.Mesh(new THREE.CircleGeometry(10, 32), glow); lit.rotation.x = -Math.PI / 2; lit.position.y = 1.2; g.add(lit);
  // the twenty hold-down clamps: each on a vertical pivot at its seat, its jaw over the booster's skirt; they swing out at liftoff
  const clamps = [];
  for (let i = 0; i < 20; i++) { const a = i * TAU / 20, piv = new THREE.Group(); piv.position.set(-Math.cos(a) * 5.4, top + 0.1, Math.sin(a) * 5.4); piv.rotation.y = a; g.add(piv);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 0.8), M.steelD); jaw.position.set(0.55, 0.65, 0); piv.add(jaw); clamps.push(piv); }
  // the booster quick-disconnect at the mount (the tower's side): a plate against the skirt on a short arm, which pulls back
  const bqd = new THREE.Group(); bqd.position.set(7.5, top + 1.5, 0); g.add(bqd); // (pad frame: +X is west, toward the tower)
  const bqdArm = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 1.6), M.greyD); bqdArm.position.set(-1.2, 0, 0); bqd.add(bqdArm);
  const bqdPlate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.4, 2.6), M.steelD); bqdPlate.position.set(-2.9, 0, 0); bqd.add(bqdPlate);
  // Timing (approximate, from the webcasts): the chopsticks open from the ship to their launch position over the last
  // quarter hour; the ship's quick-disconnect arm swings back along the tower about 30 s before liftoff; the booster's
  // quick-disconnect pulls back and the clamps swing out as the engines come up to thrust at T−0
  const open = (tl, t0, t1) => smoothstep(clamp((tl - t0) / (t1 - t0), 0, 1));
  const animate = t => {
    const tl = t - md.M.t0;
    const o = open(tl, -900, -720); for (const st of tower.sticks) st.rotation.y = st.userData.side * (0.06 + 0.5 * o);
    tower.qd.rotation.y = -1.9 * open(tl, -32, -20);
    const rel = open(tl, -0.3, 0.9); for (const c of clamps) c.rotation.y = c.userData.a0 ?? (c.userData.a0 = c.rotation.y), c.rotation.y = c.userData.a0 + 1.1 * rel;
    bqd.position.x = 7.5 + 1.8 * open(tl, -1.0, 0.0); bqd.rotation.z = 0.5 * open(tl, 0.2, 1.4);
  };
  animate(md.M.t0 - 3600);
  return { group: g, stand, glow, deckY: top, animate, foot: 11, trenchD: 25, block: [padBlock(-28, -3, 6, 9)] };
}
// which pad a mission stands on
function padModel(md) {
  const site = md.cfg.site, lv = md.cfg.launcher;
  if ((site === 'KSC39A' || site === 'KSC39B') && lv === 'saturnV') return padApollo(md);
  if ((site === 'KSC39A' || site === 'KSC39B') && lv === 'shuttle') return padShuttle(md);
  if (site === 'KSC39B' && lv === 'sls1') return padSLS(md);
  if (site === 'KSC39A' && lv === 'falconHeavy') return padFH(md);
  if (site === 'CCSFS41') return padSLC41(md);
  if (site === 'CCSFS12') return padLC12(md);
  if (site === 'WENCHANG') return padWenchang(md);
  if (site === 'KOUROU3') return padELA3(md);
  if (site === 'STARBASE') return padStarbase(md);
  return null;
}
