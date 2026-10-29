// Builds the app's detailed vehicle models (assets/*.glb) from published 3D models that may be used freely:
//   - NASA 3D Resources (https://github.com/nasa/NASA-3D-Resources), free and without copyright (see NASA's usage
//     guidelines);
//   - models on Sketchfab under CC0 (public domain) or CC BY 4.0 (credit the author: README.md and the app's credits).
//     Sketchfab asks for a sign-in to download, so these are fetched by hand: each recipe names the model's page; download
//     the glTF version and unzip it into a folder of its own under the --dl directory.
//
// Each recipe below
//   - splits a model into the parts the app moves on their own (a lunar module's ascent and descent stages, a rover's
//     wheels, an orbiter's payload bay doors …): one node per part, holding a child node with the part's mesh, so the
//     part's own transform stays free for the app (a wheel turns about its pivot) while the mesh node carries meshopt's
//     dequantisation;
//   - scales it to metres and puts each part's origin where the app's own model of that part has it, so the parts
//     drop into every configuration (docked, landed, lifting off) unchanged;
//   - drops parts too small to ever see, merges meshes by material (a few draw calls per part) and simplifies them;
//   - sets metalness and roughness where the source materials are converted Blinn, strips material extensions the app
//     does not need (transmission would cost three.js a second render pass), shrinks textures to WebP;
//   - quantises and compresses the geometry with meshopt (EXT_meshopt_compression, decoded by three.js's MeshoptDecoder).
//
//   git clone --filter=blob:none https://github.com/nasa/NASA-3D-Resources <dir> && git -C <dir> checkout 11ebb4ee
//   npm install
//   node build.mjs --nasa <dir> --dl <dir> [recipe …]   → ../../assets/<recipe>.glb (recipes whose source is missing are skipped)
//   node inspect.mjs <file.glb> [scale]                  → every mesh with its bounds, to write a recipe
//   node frame.mjs <file.gltf>                           → a model's principal axes, to find a scan's own frame
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { transformMesh, prune, dedup, joinPrimitives, weld, meshopt, simplifyPrimitive, textureCompress, compactPrimitive, metalRough } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';

const OUT = path.resolve(import.meta.dirname, '../../assets');

// metalness / roughness by source material, for the gold and black foil and the aluminium skins
const FOIL = { metal: 0.75, rough: 0.35 }, GOLD = { metal: 0.55, rough: 0.22, emissive: [0.2, 0.13, 0.03] } /* (gold glows a little of its own colour, or in the dark of space it is black) */, KAPTON = { metal: 0.2, rough: 0.38 }, SKIN = { metal: 0.55, rough: 0.45 }, DARK = { metal: 0.35, rough: 0.5 }, BLACK = { metal: 0.1, rough: 0.6 }, PAINT = { metal: 0, rough: 0.55 }, DECAL = { metal: 0, rough: 0.7 };

const RECIPES = {
  // Apollo lunar module. 7.04 m from the footpads to the tip of the antennas (0.103 → 5.115 in model units).
  // Descent stage: feet at y = −1.8 like the app's own model. Ascent stage: origin at the interstage plane, the top of the
  // descent stage (2.42 in model units), which sits at y = 1.455 in the descent stage's frame.
  apollo_lm: {
    nasa: '3D Models/Apollo Lunar Module/Apollo Lunar Module.glb',
    scale: 7.04 / (5.115 - 0.103),
    parts: { descent: { from: 0.103, to: -1.8 }, ascent: { from: 2.42, to: 0 } },
    // Everything wholly above the descent stage's top deck belongs to the ascent stage, except the RCS plume deflectors and
    // the porch, which begin lower and stay behind on the Moon. The fuel tank's fairing reaches a little below the deck.
    part: (name, b) => name === 'pCylinde10' || b.min[1] >= 2.4 ? 'ascent' : 'descent',
    minSize: 0.03, // model units: navigation lights and bolt heads a few centimetres across
    simplify: 0.0006,
    materials: {
      'blinn1SG.002': FOIL, 'blinn9SG.001': FOIL, // gold and amber foil (descent stage, footpads, RCS quads)
      'blinn4SG.002': SKIN, 'initialShadingGr.001': SKIN, 'blinn3SG.001': SKIN, // ascent stage skin, struts
      'blinn2SG.002': DARK, 'blinn6SG.001': BLACK, // dark panels, black foil and paint
      'blinn7SG.002': PAINT, 'blinn10SG.001': PAINT, 'blinn5SG.002': DARK, // antennas and deflectors, lights, engine bell
      'blinn8SG.001': DECAL, 'blinn12SG.001': DECAL, // flag and plaque
    },
    defaultMaterial: SKIN,
  },
  // Mars 2020 Perseverance. The model is in metres, +Z forward (the arm and its turret), wheels on the ground at y = 0, like
  // the app's rover. Its six wheels are one mesh: split into one part each with its pivot on the axle, so they can turn
  // (the app reads the radius from the node's extras). The source's materials are physically based already.
  perseverance: {
    nasa: '3D Models/Mars 2020 Perseverance Rover/Mars 2020 Perseverance Rover.glb',
    scale: 1,
    parts: { body: { from: 0, to: 0 } },
    part: () => 'body',
    dropMaterials: ['transparent'], // invisible helper shapes (the rig's skinned pieces are dropped as well)
    // the remote sensing mast (rigged in the source: its root node is the shoulder hinge) as a part of its own, so the app
    // can raise it on the surface; extras.deploy: the axis and angle that stand it up, from the head's direction
    subtree: { node: 'Cylinder', part: 'mast', tip: 'head' },
    split: { node: 'Wheels_objs', seeds: [[-1.1, -1.15], [1.1, -1.15], [-1.1, 0], [1.1, 0], [-1.1, 1.1], [1.1, 1.1]], part: i => 'wheel' + i, extras: { wheel: 0.2625 } },
    // the suspension's legs, as a part of their own: its pieces (by connected piece, from where its centre lies) below the
    // belly, and those of the front and rear legs below the deck. For the landing the wheels are folded up beside the body;
    // the app hides the legs while they are (the hinges and the rocker's pivots stay on the body)
    cut: { node: 'suspension', part: 'legs', test: ([, y, z]) => y < 0.74 || (Math.abs(z) > 0.85 && y < 0.9) },
    minSize: 0.012,
    simplify: { default: 0.003, wheel: 0.012 },
    strip: ['KHR_materials_transmission', 'KHR_materials_clearcoat', 'KHR_materials_ior', 'KHR_materials_specular'],
    textures: 512,
  },
  // Space Shuttle orbiter: the Smithsonian's 3D scan of Discovery (OV-103) at the Steven F. Udvar-Hazy Center, CC0
  // (https://sketchfab.com/3d-models/orbiter-space-shuttle-ov-103-discovery-5f7176a2ae284d6b99fc970c9d265c04, unzipped into
  // discovery/). The scan stands on its landing gear, payload bay doors closed, in an arbitrary orientation; frame (world →
  // the app's orbiter axes, metres): +Y nose, +Z up, +X starboard, Y = 0 at the aft end of the fuselage (Xo 1528), Z = 0 at
  // the payload bay centreline (Zo 400). Found from the scan's shape (frame.mjs and a few profiles): the crown of the bay
  // doors is a straight line parallel to Xo, the wing tips are level, the nose tip is at Xo 238 and the crown 2.4 m above
  // Zo 400. In this frame the wings span 23.80 m (23.79 m published), the tail stands 17.24 m above the ground (17.25 m), the
  // main wheels touch at Y 8.8, 6.01 m below Zo 400, and the nose wheels at Y 29.0, 4.46 m below: on its gear the orbiter
  // sits 4.4° nose down.
  orbiter: {
    dl: 'discovery/scene.gltf',
    frame: [-0.999884, -0.00391, 0.014697, 0, 0.014988, -0.08955, 0.995865, 0, -0.002578, 0.99597, 0.089598, 0, 0.018859, 14.111534, 1.609725, 1],
    // The payload bay doors (Xo 576–1307), cut along their hinge line on the sills (Z 0.6) so the app can swing them open;
    // the landing gear, with its open doors, below the wheel wells (the app shows it only when the gear is down and closes
    // the wells otherwise). By triangle centre.
    triPart: ([x, y, z]) => {
      if (y > 5.61 && y < 24.18 && z > 0.6 && z < 2.6) return x < 0 ? 'doorL' : 'doorR';
      if (Math.abs(x) > 1.9 && Math.abs(x) < 5.0 && y > 7.4 && y < 12.8 && z < -3.72) return 'gear';
      if (Math.abs(x) < 1.3 && y > 27.8 && y < 31.6 && z < -3.45) return 'gear';
      return 'body';
    },
    pivots: { doorL: [-2.70, 0, 0.6], doorR: [2.70, 0, 0.6] },
    inner: { parts: ['doorL', 'doorR'], color: [0.86, 0.88, 0.9], metal: 0.35, rough: 0.4 }, // the doors' inner faces: radiator panels
    // Glass in the crew cabin's windows: the six forward windows, the two overhead ones and the side hatch's, and the seam
    // in front of the windshield, all open in the scan (addPanes). Around the forward fuselage's axis, which runs from
    // Z 0.35 at Y 26.8 down 0.143 m per metre forward; behind the Y 24.3 the bay doors are cut away, ahead of Y 29.95 the
    // nose's thruster ports are open as they should be.
    panes: { part: 'body', y: [24.3, 29.95], axis: [26.8, 0.35, -0.143], th: 105, close: 0.4, min: 0.05, area: 0.02, color: [0.02, 0.025, 0.03], metal: 0, rough: 0.1 },
    simplify: 0.001, // 3.7 cm on the body
    textures: { baseColor: 2048, other: 1024 }, // the colour map at 2048 px; the normal and occlusion-roughness-metalness maps at 1024
  },
  // International Space Station: NASA's model by the IGOAL lab at Johnson Space Center (NASA 3D Resources), as it flies
  // today, set back to July 2011 (STS-135): without Nauka, Prichal, the iROSA arrays, BEAM, the Bishop airlock, the two
  // docking adapters and Bartolomeo, and with PMA-3 removed (in 2011 it sat on Tranquility, not on Harmony).
  // The file's root scales by −0.003, a point reflection: undone, its axes are +x forward, +y nadir, −z starboard.
  // Frame (the app's station axes, metres): +Y forward (the direction of flight), +Z zenith, +X starboard, at 10.85 m per
  // unit of the file's scene (the truss from tip to tip 109 m), then shifted so that PMA-2's docking face is at
  // (0, 21.5, 0), the app's docking port.
  iss: {
    nasa: '3D Models/International Space Station (ISS) (D) (IGOAL)/International Space Station (ISS).glb',
    assembly: true,
    drop: [/^MLM$/, /^Russian_RSNode_DockingModule$/, /^BEAM$/, /^Bishop_Airlock$/, /^PMA3$/, /IROSA/i, /^IDA[23]/, /BARTOLOMEO/i, /GITAI/i, /ColKa/i, /STP-H/i, /SAGE/i],
    frame: (S => [0, -S, 0, 0, 0, 0, S, 0, S, 0, 0, 0, 0, 0, 0, 1])(10.85),
    anchor: { node: 'PMA2', at: [0, 21.5, 0] }, // the forward face of PMA-2 (its centre)
    minSize: 0.3, // m: handrails, bolts and other pieces too small to see
    simplify: 0.15, // m
    simplifyNear: [/^(Node2|PMA2|USLab|Node1|Columbus|JEM_PM|JEM_PS|Cupola|Node3|PMM)$/, 0.03], // the modules a docking orbiter sees from close by
    spare: /^[SP][46]_(\d[AB]_Array|Array_\d[AB])$|Radiator$/, // the solar array blankets (S6_1B_Array, P4_Array_4A …) and the radiators: flat textured panels the simplifier would smear
    // the source's materials come from Unity (metallic-smoothness maps read as glTF's metallic-roughness turn the arrays into
    // mirrors, and most are alpha-blended): painted metal and blankets, no metallic maps, alpha as a cut-out
    pbr: { metal: 0.15, rough: 0.62, dropMetalRough: true, alpha: 'MASK', cutoff: 0.95 }, // translucent glare layers (over the array cells) go; solid stays
    keepSides: true, // the blankets' two faces are separate surfaces: drawn double-sided they fight
    textures: { baseColor: 512, other: 256, named: { Truss_Diffuse: 2048 } }, // the truss atlas holds the arrays' cells
  },
  // Saturn V: "Saturn V" by BoldlyBuilding (https://sketchfab.com/3d-models/saturn-v-88f68de3b3e9435582560e02a52b325d),
  // CC BY 4.0, unzipped into saturnv/. One textured mesh in metres, +Y up, 110.53 m from the F-1 nozzles (y = 0) to the
  // tip of the escape tower. Where its texture puts the joints: the S-IC's forward skirt meets the aft interstage at 43.73,
  // the interstage meets the S-II's aft skirt at 49.96; the S-II's forward skirt ends at 65.89, where the S-IVB's aft
  // interstage (the cone) begins; the cone ends at 70.33 and the instrument unit at 85.72. The whole is close to the real
  // vehicle, the stages less so: its S-IC is 1.7 m too long, its S-II 3.4 m too short, its diameters 4 % (10.48 m) and 8 %
  // (7.12 m) too large. So each stretch between two joints is scaled to its published length — the S-IC 42.06 m to the top
  // of its forward skirt (nozzles included), the S-II 24.87 m with its 18 ft (5.49 m) aft interstage, the S-IVB 17.86 m
  // with its cone, the instrument unit 0.91 m — and to the diameters of 10.1 m and 6.60 m, the texture moving with it. The spacecraft (adapter, service and command modules, escape tower) is
  // left out: the app draws its own Apollo spacecraft.
  // Parts in the stages' frames, as the app stacks them: S-IC from the base of its thrust structure (the F-1 nozzles 3.24 m
  // below), IST (the aft interstage, dropped 30 s after staging) and S-II from the bottom of the interstage, S-IVB (with the
  // instrument unit) from the top of the cone.
  saturnv: {
    dl: 'saturnv/scene.gltf',
    specGloss: true, // the source's specular-glossiness material, to metal-roughness
    frame: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], // the file's scene is the rocket's frame already
    slice: [43.73, 49.96], // the S-IC and S-II are one cylinder in the source, cut at their joints
    triPart: ([, y]) => y < 43.73 ? 'S-IC' : y < 49.96 ? 'IST' : y < 70.2 ? 'S-II' : y < 85.8 ? 'S-IVB' : null,
    warp: { y: [[0, 0], [3.24, 3.24], [43.73, 42.06], [49.96, 47.55], [65.89, 66.93], [85.72, 85.70]], r: [[65.89, 5.05 / 5.242], [70.33, 3.302 / 3.56]] },
    origins: { 'S-IC': 3.24, IST: 43.73, 'S-II': 43.73, 'S-IVB': 70.33 }, // heights in the source; each part's y = 0
    inner: { parts: ['IST'], color: [0.32, 0.33, 0.35], metal: 0.3, rough: 0.6 }, // the interstage is an open ring
    textures: 2048,
  },
  // Space Shuttle external tank and solid rocket boosters: "Space Shuttle Atlantis" by paburoviii
  // (https://sketchfab.com/3d-models/space-shuttle-atlantis-2f04130e3c78439d9765b5ac71b333d2), CC BY 4.0, unzipped into
  // atlantis/. The model is the whole stack, made for display; its orbiter is left out (the app's orbiter is the
  // Smithsonian's scan of Discovery). In the file's own frame (frame: +Y up the stack, the orbiter on −Z, as the app has
  // it) the tank is 7.712 units long and 1.440 across, a booster 7.414 long from nozzle to nose and 0.489 across: the
  // boosters too slender for their tank. Each is scaled to its published size: the tank 46.88 m long and 8.41 m across, a
  // booster 45.46 m long and 3.71 m across. The two boosters are mirror images, so only the right one (+X) is kept and the
  // app mirrors it.
  // Parts: ET (y = 0 at the bottom of its aft dome, on its axis), SRB (y = 0 at the bottom of its aft skirt, on its axis;
  // the nozzle's exit 0.88 m below).
  // The model's tank is flat orange and its boosters are coloured like a drawing. They are given the finish of the scanned
  // orbiter they fly with: the tank's sprayed foam is painted here (mottled, the intertank's darker), the boosters' white
  // paint weathered, and neither is glossy.
  shuttle_stack: {
    dl: 'atlantis/scene.gltf',
    frame: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 5.66, 6.865, 1],
    triPart: (c, at) => /\/Orange_Parts\//.test(at) ? 'ET' : /\/Small_Rocket_Group_01\//.test(at) ? 'SRB' : null,
    fit: { ET: { at: [0, 3.2164, 1.7075], scale: [5.8403, 6.0790, 5.8403] }, SRB: { at: [1.0305, 1.74, 1.6855], scale: [7.587, 6.1317, 7.587] } },
    materials: { Rocket_Material: { metal: 0, rough: 0.55 }, Rocket_Details_Material: { metal: 0, rough: 0.55 }, White_Metal: { metal: 0.2, rough: 0.55 } },
    foam: { part: 'ET', material: 'Orange_Material', len: 46.88, r: 4.205, size: [1024, 2048], color: [181, 101, 46], bands: [[26.6, 33.6, 0.84]], rough: 0.85 },
    grime: { materials: ['Rocket_Material', 'Rocket_Details_Material'], amount: 0.1, tint: [0.95, 0.945, 0.93] },
    textures: { baseColor: 1024, other: 1024, named: { 'ET-foam': 2048 } },
  },
  // Ariane 5: "Ariane 5 model" by bobymonsuta (https://sketchfab.com/3d-models/ariane-5-model-88a1de562245402da653bc1ae92b1b91),
  // CC BY 4.0, unzipped into ariane5/. The whole vehicle on the pad, +Y up, the core on the axis, the boosters at x = ±0.9;
  // scaled so the core is its published 5.4 m across (0.52 units), then stretched piece by piece to the stages' published
  // lengths, since the model's core is short and its fairing long (warp, in metres after the scaling). Parts, each in its
  // stage's frame as the app has it (y = 0 at the bottom of the stage's body, its engine below): `EPC` (the core, the
  // Vulcain 2 3.4 m below), `ESC-A` (the upper stage's visible section, 4.7 m), `fairing` (17 m, y = 0 at its base),
  // `EAP` (one booster on its own axis, y = 0 at the bottom of its body, the nozzle 3.0 m below; the left one of the file,
  // the app sets the pair). The boosters' texture carries two agencies' emblems beside the member states' flags: those two
  // panels are painted over (blank) — the app draws no organisation's logo.
  ariane5: {
    dl: 'ariane5/scene.gltf',
    frame: (S => [S, 0, 0, 0, 0, S, 0, 0, 0, 0, S, 0, 0, 0, 0, 1])(2.7 / 0.52),
    // (a booster: within 1.8 m of its axis and clear of the core's 2.7-m skin — the core's faces toward the boosters stay
    // the core's)
    triPart: ([x, y, z]) => { const nearB = Math.abs(x) > 2.75 && Math.hypot(Math.abs(x) - 0.9 * 2.7 / 0.52, z) < 1.8;
      return nearB ? (x < 0 ? 'EAP' : null) : y > 30.89 ? 'fairing' : y > 27.78 ? 'ESC-A' : 'EPC'; },
    warp: {
      EPC: { y: [[1.61, -3.4], [3.79, 0], [27.78, 30.5]], r: [[0, 1], [100, 1]] },
      'ESC-A': { y: [[27.78, 30.5], [30.89, 35.2]], r: [[0, 1], [100, 1]] },
      fairing: { y: [[30.89, 35.2], [50.73, 52.2]], r: [[0, 1], [100, 1]] },
      EAP: { y: [[0.05, -3.0], [1.71, 0], [25.7, 27.0], [30.74, 31.2]], r: [[0, 1], [100, 1]] },
    },
    origins: { EPC: 3.79, 'ESC-A': 27.78, fairing: 30.89, EAP: 1.71 },
    fit: { EAP: { at: [-0.9 * 2.7 / 0.52, 0, 0], scale: [1, 1, 1] } }, // the booster onto its own axis
    blank: [['Rocket_sec_text', [[2622, 1606, 2906, 1940], [2622, 2420, 2906, 2788]], [228, 228, 228]]],
    materials: {
      Rocket_main_text: { metal: 0.05, rough: 0.5, color: [0.9, 0.89, 0.86] }, Rocket_sec_text: { metal: 0.05, rough: 0.5 },
      Pipes_white: { metal: 0.05, rough: 0.5 }, Tube_7_2__0: { metal: 0.2, rough: 0.5, color: [0.2, 0.2, 0.22] }, Sec_rockets_black: { metal: 0.2, rough: 0.5, color: [0.2, 0.2, 0.22] },
      Nozzle_metal: { metal: 0.6, rough: 0.4 }, Thruster_main_metal: { metal: 0.5, rough: 0.4 }, Metal_1: { metal: 0.05, rough: 0.5, color: [0.88, 0.87, 0.84] }, // (mostly the fairing's inner shell, which shows at its edges: white like the skin) Metal_2: { metal: 0.6, rough: 0.35 },
    },
    strip: ['KHR_materials_clearcoat'],
    simplify: 0.002,
    textures: { baseColor: 2048, other: 1024 },
  },
  // James Webb Space Telescope: "JWST (james webb space telescope)" by Paul
  // (https://sketchfab.com/3d-models/jwst-james-webb-space-telescope-6c92c08a672640afb58ee44d248fd0fe), CC BY 4.0,
  // unzipped into jwst/. The observatory fully deployed, in the file's own frame already as the app has it: +Y up the
  // tower, +Z the telescope's line of sight (the secondary mirror out in front), the mirror standing on edge across the
  // sunshield. In the file's world units the Sun-side layer of the sunshield runs 31.08 along Z: scaled to its published
  // 21.2 m, y = 0 at the underside of the spacecraft bus (−4.0 in the file), where the app's own model has it.
  // Cut into the parts the app folds for launch and unfolds on the way (by triangle centre, in the file's units):
  // `bus`; `tel` (the backplane, the twelve centre hexagons, the aft optics and the instruments, lifted by the tower);
  // `wingL`/`wingR` (the columns of three hexagons either side, pivots on their hinge lines, folding back); `tripod`
  // (the two lower struts and the secondary mirror, pivot at the struts' feet, folding up the mirror's face); `topStrut`
  // (the third strut, pivot at its foot on the backplane's top, aimed at the apex by the app); `shield` (the five layers,
  // the mid-booms and the spreader bars, scaled down when folded); `fwdPallet`/`aftPallet` (the structure under the
  // shield fore and aft of the bus, pivots at the bus's edges, standing up for launch); `solar`; `hga`.
  jwst: {
    dl: 'jwst/scene.gltf',
    frame: (S => [S, 0, 0, 0, 0, S, 0, 0, 0, 0, S, 0, 0, -4.0 * S, 0, 1])(21.2 / 31.08),
    triPart: (c, route) => {
      const S = 21.2 / 31.08, x = c[0] / S, y = (c[1] + 4.0 * S) / S, z = c[2] / S, nm = route.split('/').pop(), ax = Math.abs(x);
      if (['Object_64', 'Object_66', 'Object_68', 'Object_70', 'Object_72'].includes(nm)) return 'shield'; // the five layers
      if (nm === 'Object_74' || nm === 'Object_76') return 'solar';
      if (nm === 'Object_26' || (nm === 'Object_28' && z < 3 && y < -2.5 && x < -0.5)) return 'hga';
      if (y > 0.3 && y < 10.5 && z > 1.4 && z < 3.2 && ax > 2.25) { // the mirror's plane: the nearest hexagon's column decides (the columns interleave)
        const dW = Math.min(...[3.37, 5.35, 7.34].map(cy => Math.hypot(ax - 3.42, y - cy))), dI = Math.min(...[2.36, 4.36, 6.35, 8.34].map(cy => Math.hypot(ax - 1.72, y - cy)));
        if (dW < dI) return x < 0 ? 'wingL' : 'wingR';
      }
      if (ax < 0.3 && y > 9.5 && z > 2.8 && z < 12.9) return 'topStrut';
      if (y > 1.0 && (z > 4.3 || (z > 2.9 && y < 2.5 && ax > 1.6))) return 'tripod';
      if (y < 0.9 && ax < 2.3 && z > 3.0) return 'fwdPallet';
      if (y < 2.0 && ax < 2.3 && z < -3.0) return 'aftPallet';
      if (ax > 2.3 && y < 0 && Math.abs(z) < 1) return 'shield'; // the mid-booms
      return y > 0.4 ? 'tel' : 'bus';
    },
    pivots: (S => ({ wingL: [-2.3 * S, 5.35 * S - 4.0 * S, 2.3 * S], wingR: [2.3 * S, 5.35 * S - 4.0 * S, 2.3 * S], tripod: [0, 1.13 * S - 4.0 * S, 2.99 * S], topStrut: [0, 11.25 * S - 4.0 * S, 2.87 * S],
      fwdPallet: [0, -2.1 * S - 4.0 * S, 3.0 * S], aftPallet: [0, -2.1 * S - 4.0 * S, -3.0 * S], solar: [0, -3.3 * S - 4.0 * S, -3.1 * S], hga: [-2.2 * S, -2.75 * S - 4.0 * S, 2.1 * S] }))(21.2 / 31.08),
    simplify: 0.002,
    materials: {
      'JWST-TopReflector': GOLD, 'JWST-TopReflector-fl': GOLD, 'JWST-gold-fl': GOLD, 'JWST-mirror-sm': PAINT, // (the file's 'TopReflector' is the primary mirror; its 'mirror' is the solar array's cells)
      'JWST-gold-nofoil-sm': FOIL, 'sa_edge_gold': FOIL,
      // (the file's layers are grey and black — its colour texture is not in the download; they are given the lavender of
      // aluminised Kapton, the Sun-side layer pinker, the telescope-side one cooler)
      'JWST-FoilLayer1': { ...KAPTON, color: [0.72, 0.76, 0.84] }, 'JWST-FoilLayer2': { ...KAPTON, color: [0.84, 0.74, 0.88] }, 'JWST-FoilLayer3': { ...KAPTON, color: [0.84, 0.74, 0.88] }, 'JWST-FoilLayer4': { ...KAPTON, color: [0.86, 0.72, 0.86] }, 'JWST-FoilLayer5-PURPLEY': { ...KAPTON, color: [0.88, 0.68, 0.84] },
      'JWST-FoilBasePanel-2-PURPLEY': KAPTON, 'JWST-bottom-box-PURPLEY': KAPTON, 'JWST-bottom-box-bot-PURPLEY': KAPTON, 'JWST-bottom-box-bot-fl-PURPLEY': KAPTON,
      'JWST-instrument-silverfoil-sm': FOIL, 'JWST-instrument-silverfoil-2-sm': FOIL, 'JWST-instrument-silverfoil-3-sm': FOIL, 'sc_rad_smli1': FOIL, 'sc_post_pmli1': FOIL, 'sc_post_pmli': FOIL,
      'JWST-black-sm': BLACK, 'JWST-black-fl': BLACK, 'blackpaint_lambert1': BLACK,
      'JWST-bracket1-sm': DARK, 'JWST-bracket1-fl': DARK, 'JWST-bracket2-sm': DARK, 'JWST-bracket2-fl': DARK,
      'JWST-silver-sm': SKIN, 'JWST-silver-fl': SKIN, 'JWST-silver2-fl': SKIN, 'JWST-greyfla-fl': SKIN, 'whitepaint_lambert': PAINT, 'JWST-SolarPanel-22': { ...PAINT, color: [0.7, 0.76, 0.88] }, 'JWST-bronze-sm': SKIN, 'Default': SKIN,
    },
  },
};

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const SRC = { nasa: opt('--nasa'), dl: opt('--dl') };
const names = args.filter((a, i) => !a.startsWith('--') && !['--nasa', '--dl'].includes(args[i - 1]));
if (!SRC.nasa && !SRC.dl) { console.error('usage: node build.mjs [--nasa <NASA-3D-Resources clone>] [--dl <downloads>] [recipe …]'); process.exit(1); }
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;

for (const name of names.length ? names : Object.keys(RECIPES)) {
  const R = RECIPES[name]; if (!R) throw new Error('no recipe ' + name);
  const kind = R.nasa ? 'nasa' : 'dl', dir = SRC[kind];
  if (!dir) { if (names.length) throw new Error(`${name}: needs --${kind}`); console.log(`${name}: skipped (no --${kind})`); continue; }
  const doc = await io.read(path.join(dir, R.nasa || R.dl)), root = doc.getRoot(), scene = root.listScenes()[0];
  if (R.assembly) { await buildAssembly(name, R, doc); continue; }
  if (R.frame) { await buildScan(name, R, doc); continue; }
  // drop the source's compression (the output is compressed again with meshopt) and the material extensions not wanted
  for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression' || (R.strip || []).includes(e.extensionName)) e.dispose();
  for (const a of root.listAnimations()) a.dispose(); // the app poses parts itself; rigs and their animations go
  for (const k of root.listSkins()) k.dispose();
  const S = R.scale, groups = {}, holders = {};
  const group = (p, pivot = null, extras = null) => {
    const g = doc.createNode(p); if (pivot) g.setTranslation(pivot); if (extras) g.setExtras(extras); scene.addChild(g);
    groups[p] = g; holders[p] = []; return g;
  };
  for (const p of Object.keys(R.parts)) group(p);
  let dropped = 0;
  // a mesh split into parts of its own (a rover's wheels), each with its pivot at the centre of its bounds
  if (R.split) {
    const src = root.listNodes().find(n => n.getName() === R.split.node); if (!src) throw new Error('no node ' + R.split.node);
    const pieces = splitByClusters(doc, src, R.split.seeds);
    pieces.forEach((nd, i) => {
      const b = getBounds(nd), c = [0, 1, 2].map(k => (b.min[k] + b.max[k]) / 2 * S);
      const p = R.split.part(i); group(p, c, R.split.extras);
      const M = [S, 0, 0, 0, 0, S, 0, 0, 0, 0, S, 0, -c[0], -c[1], -c[2], 1];
      transformMesh(nd.getMesh(), mul(M, nd.getWorldMatrix())); holders[p].push(nd.getMesh()); nd.dispose();
    });
    src.dispose();
  }
  if (R.cut) { // the connected pieces of a mesh that R.cut.test picks (by their centres), as a part of their own
    const src = root.listNodes().find(n => n.getName() === R.cut.node); if (!src) throw new Error('no node ' + R.cut.node);
    const [cut, rest] = splitByPieces(doc, src, R.cut.test);
    group(R.cut.part);
    transformMesh(cut.getMesh(), mul([S, 0, 0, 0, 0, S, 0, 0, 0, 0, S, 0, 0, 0, 0, 1], cut.getWorldMatrix())); holders[R.cut.part].push(cut.getMesh()); cut.dispose();
    rest.setName(src.getName()); src.dispose(); // the rest goes to a part by R.part, as any other node
  }
  if (R.subtree) { // a node and its descendants as one part, pivoting about the node's origin
    const top = root.listNodes().find(n => n.getName() === R.subtree.node); if (!top) throw new Error('no node ' + R.subtree.node);
    const piv = mulv(top.getWorldMatrix(), [0, 0, 0]).map(x => x * S), tip = root.listNodes().find(n => n.getName() === R.subtree.tip);
    const tb = getBounds(tip), tc = [0, 1, 2].map(k => (tb.min[k] + tb.max[k]) / 2 * S), d = [tc[0] - piv[0], tc[1] - piv[1], tc[2] - piv[2]], dl = Math.hypot(...d), u = d.map(x => x / dl);
    const ax = [-u[2], 0, u[0]], al = Math.hypot(...ax); // u × up, normalised: turning about it brings u up to vertical
    const p = R.subtree.part; group(p, piv, { deploy: [ax[0] / al, 0, ax[2] / al, Math.acos(Math.max(-1, Math.min(1, u[1])))] });
    const sub = []; const walk = n => { if (n.getMesh()) sub.push(n); n.listChildren().forEach(walk); }; walk(top);
    for (const n of sub) {
      if (n.getSkin()) continue;
      const M = [S, 0, 0, 0, 0, S, 0, 0, 0, 0, S, 0, -piv[0], -piv[1], -piv[2], 1];
      const mesh = n.getMesh(); if (mesh.listParents().filter(x => x !== root).length > 1) n.setMesh(mesh.clone());
      transformMesh(n.getMesh(), mul(M, n.getWorldMatrix())); holders[p].push(n.getMesh()); n.setMesh(null);
    }
  }
  for (const n of root.listNodes().filter(n => n.getMesh() && !Object.values(groups).includes(n))) {
    if (n.getSkin()) { n.dispose(); dropped++; continue; }
    const b = getBounds(n), size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    if (size < (R.minSize || 0)) { n.dispose(); dropped++; continue; }
    const p = R.part(n.getName(), b); if (!p) { n.dispose(); dropped++; continue; }
    // bake the node's world transform and the part's scale and offset into the vertices
    const o = R.parts[p], M = [S, 0, 0, 0, 0, S, 0, 0, 0, 0, S, 0, 0, o.to - o.from * S, 0, 1];
    const mesh = n.getMesh(); if (mesh.listParents().filter(x => x !== root).length > 1) n.setMesh(mesh.clone());
    transformMesh(n.getMesh(), mul(M, n.getWorldMatrix())); holders[p].push(n.getMesh());
  }
  // the source's hierarchy goes; only the parts stay in the scene
  for (const n of scene.listChildren()) if (!Object.values(groups).includes(n)) { scene.removeChild(n); }
  for (const m of root.listMaterials()) {
    if (R.materials || R.defaultMaterial) { const t = (R.materials || {})[m.getName()] || R.defaultMaterial; if (t) { m.setMetallicFactor(t.metal).setRoughnessFactor(t.rough); if (t.color) m.setBaseColorFactor([...t.color, 1]); if (t.emissive) m.setEmissiveFactor(t.emissive); } }
    m.setDoubleSided(true);
  }
  // one mesh per part, one primitive per material: a few draw calls instead of one per source mesh
  await doc.transform(weld());
  for (const [p, g] of Object.entries(groups)) {
    const byMat = new Map();
    for (const m of holders[p]) for (const prim of m.listPrimitives()) {
      const mat = prim.getMaterial(), textured = mat && (mat.getBaseColorTexture() || mat.getNormalTexture() || mat.getMetallicRoughnessTexture() || mat.getEmissiveTexture() || mat.getOcclusionTexture());
      if (mat && (R.dropMaterials || []).includes(mat.getName())) continue;
      for (const s of prim.listSemantics()) if (!['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(s) || (s === 'TEXCOORD_0' && !textured)) prim.setAttribute(s, null);
      if (!prim.getAttribute('NORMAL')) continue;
      if (textured && !prim.getAttribute('TEXCOORD_0')) continue;
      const k = mat ? mat : 'none'; if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(prim);
    }
    const mesh = doc.createMesh(p);
    for (const [mat, prims] of byMat) { const j = joinPrimitives(prims); if (mat !== 'none') j.setMaterial(mat); mesh.addPrimitive(j); }
    const holder = doc.createNode(p + '-mesh').setMesh(mesh); g.addChild(holder);
  }
  const keep = new Set(Object.values(groups).flatMap(g => [g, ...g.listChildren()]));
  for (const n of root.listNodes()) if (!keep.has(n)) n.dispose();
  await doc.transform(prune({ keepLeaves: false }), weld());
  // fewer triangles where it cannot be seen: error relative to each part's size (a few millimetres on a lunar module)
  if (R.simplify) for (const [p, g] of Object.entries(groups)) { // a number, or errors by part-name prefix ({ default, wheel, … })
    const err = typeof R.simplify === 'number' ? R.simplify : (Object.entries(R.simplify).find(([k]) => k !== 'default' && p.startsWith(k)) || [0, R.simplify.default])[1];
    for (const h of g.listChildren()) for (const prim of h.getMesh().listPrimitives()) {
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0, error: err, lockBorder: true });
      if (prim.getIndices() && !prim.getIndices().getCount()) prim.dispose(); // simplified away whole (the encoder takes no empty buffers)
    }
  }
  await shrinkTextures(doc, R.textures);
  await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(OUT, name + '.glb');
  await io.write(out, doc);
  const tri = root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const prims = root.listMeshes().reduce((a, m) => a + m.listPrimitives().length, 0);
  console.log(`${name}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB, parts ${Object.keys(groups).join(' ')}, ${prims} draw calls, ${tri} triangles, ${root.listTextures().length} textures, ${dropped} parts dropped → ${path.relative(process.cwd(), out)}`);
}

// A large assembly kept whole (one part, one primitive per material): drop the subtrees R.drop names, bake the rest into the
// vehicle's frame (R.frame, column-major, from the file's world frame), shift it so that R.anchor.node's forward (+Y) face
// lands on R.anchor.at, join by material, simplify, shrink the textures, compress.
async function buildAssembly(name, R, doc) {
  const root = doc.getRoot(), scene = root.listScenes()[0];
  for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression') e.dispose(); // compressed again with meshopt
  for (const a of root.listAnimations()) a.dispose();
  for (const k of root.listSkins()) k.dispose();
  let dropped = 0;
  for (const n of root.listNodes()) if (n.getName() && R.drop.some(re => re.test(n.getName()))) { const kill = x => { x.listChildren().forEach(kill); x.dispose(); dropped++; }; kill(n); }
  const isUnder = (n, nm) => { for (let x = n; x; x = x.getParentNode()) if (x.getName() === nm) return true; return false; };
  const meshes = root.listNodes().filter(n => n.getMesh());
  const P = [0, 0, 0];
  let fy = -Infinity; const face = [];
  for (const n of meshes) {
    ownMesh(n, root);
    transformMesh(n.getMesh(), mul(R.frame, n.getWorldMatrix()));
    if (R.anchor && isUnder(n, R.anchor.node)) for (const p of n.getMesh().listPrimitives()) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, P); face.push([...P]); if (P[1] > fy) fy = P[1]; } }
  }
  let shift = [0, 0, 0];
  if (R.anchor) { const ring = face.filter(q => q[1] > fy - 0.05); const c = [0, 2].map(k => (ring.reduce((a, q) => Math.min(a, q[k]), 1e9) + ring.reduce((a, q) => Math.max(a, q[k]), -1e9)) / 2);
    shift = [R.anchor.at[0] - c[0], R.anchor.at[1] - fy, R.anchor.at[2] - c[1]]; console.log(`${name}: ${R.anchor.node}'s face at x ${c[0].toFixed(2)} y ${fy.toFixed(2)} z ${c[1].toFixed(2)} → shift ${shift.map(v => v.toFixed(2)).join(' ')}`); }
  const byMat = new Map(); let small = 0, before = 0, after = 0;
  for (const n of meshes) for (const p of n.getMesh().listPrimitives()) {
    if (R.minSize) { const a = p.getAttribute('POSITION'), lo = a.getMin([]), hi = a.getMax([]); if (Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) < R.minSize) { small++; continue; } }
    for (const s of p.listSemantics()) if (!['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(s)) p.setAttribute(s, null);
    const m = p.getMaterial(), textured = m && (m.getBaseColorTexture() || m.getNormalTexture() || m.getMetallicRoughnessTexture() || m.getOcclusionTexture() || m.getEmissiveTexture());
    if (!p.getAttribute('NORMAL') || (textured && !p.getAttribute('TEXCOORD_0'))) continue;
    if (!textured) p.setAttribute('TEXCOORD_0', null);
    const spared = R.spare && R.spare.test(n.getName());
    const err = (R.simplifyNear && (() => { for (let x = n; x; x = x.getParentNode()) if (R.simplifyNear[0].test(x.getName())) return R.simplifyNear[1]; })()) || R.simplify;
    if (R.simplify && !spared) { before += p.getIndices().getCount() / 3; simplifyLoose(p, err); after += p.getIndices().getCount() / 3; if (!p.getIndices().getCount()) continue; } // pruned away whole
    const k = m || 'none'; if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(p);
  }
  if (R.simplify) console.log(`${name}: simplified ${before} → ${after} triangles (meshes named ${R.spare} kept whole)`);
  const mesh = doc.createMesh(name);
  for (const [m, prims] of byMat) { const j = joinPrimitives(prims); if (m !== 'none') j.setMaterial(m); mesh.addPrimitive(j); }
  transformMesh(mesh, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...shift, 1]);
  for (const c of scene.listChildren()) scene.removeChild(c);
  const g = doc.createNode(name); g.addChild(doc.createNode(name + '-mesh').setMesh(mesh)); scene.addChild(g);
  for (const n of root.listNodes()) if (n !== g && n.getParentNode() !== g) n.dispose();
  await doc.transform(prune({ keepLeaves: false })); // (no weld: on tiled texture coordinates its tolerance merges distinct ones)

  for (const m of root.listMaterials()) {
    if (!R.keepSides) m.setDoubleSided(true);
    if (R.pbr) { m.setMetallicFactor(R.pbr.metal).setRoughnessFactor(R.pbr.rough); if (R.pbr.dropMetalRough) m.setMetallicRoughnessTexture(null);
      if (R.pbr.alpha && m.getAlphaMode() === 'BLEND') m.setAlphaMode(R.pbr.alpha).setAlphaCutoff(R.pbr.cutoff ?? 0.5); }
  }
  for (const t of root.listTextures()) if (t.getMimeType() === 'image/png' && root.listTextures().some(u => u !== t && u.getName() === t.getName() && u.getMimeType() === 'image/webp')) t.dispose(); // the PNG copies kept for viewers without WebP
  await shrinkTextures(doc, R.textures);
  await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: R.compress || 'medium' }));
  const out = path.join(OUT, name + '.glb');
  await io.write(out, doc);
  const tri = mesh.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
  const b = getBounds(scene);
  console.log(`${name}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${tri} triangles, ${mesh.listPrimitives().length} draw calls, ${root.listTextures().length} textures, ${dropped} nodes dropped, ${small} small pieces dropped, bounds ${b.min.map(v => v.toFixed(1)).join(' ')} → ${b.max.map(v => v.toFixed(1)).join(' ')} → ${path.relative(process.cwd(), out)}`);
}

// Give a node a mesh of its own, down to the vertex data: an instanced model (eight identical solar array wings) shares
// meshes, primitives and accessors between nodes, and baking each node's transform into shared data would apply them all
// on top of one another.
function ownMesh(n, root) {
  const shared = x => x.listParents().filter(p => p !== root).length > 1;
  let mesh = n.getMesh(); if (shared(mesh)) { mesh = mesh.clone(); n.setMesh(mesh); }
  for (const p0 of mesh.listPrimitives()) {
    const p = shared(p0) ? p0.clone() : p0; if (p !== p0) mesh.removePrimitive(p0).addPrimitive(p);
    for (const s of p.listSemantics()) { const a = p.getAttribute(s); if (shared(a)) p.setAttribute(s, a.clone()); }
    const ix = p.getIndices(); if (ix && shared(ix)) p.setIndices(ix.clone());
  }
}
// Simplify a primitive to an absolute error (m), across attribute seams, dropping loose pieces smaller than the error. CAD-style
// meshes are mostly separate faces (hard edges, a UV island each), which the simplifier otherwise cannot touch.
function simplifyLoose(prim, err) {
  const pos = prim.getAttribute('POSITION'), P = pos.getArray(), idx = prim.getIndices(); if (!idx || idx.getCount() < 3) return;
  const F = P instanceof Float32Array ? P : Float32Array.from(P), I = Uint32Array.from(idx.getArray());
  const [out] = MeshoptSimplifier.simplify(I, F, 3, 0, err, ['Permissive', 'Prune', 'ErrorAbsolute']);
  idx.setArray(out.length > 65535 * 3 || pos.getCount() > 65535 ? out : new Uint32Array(out)); compactPrimitive(prim);
}
// A scan or any single-mesh model: bake it into the vehicle's frame (R.frame, world → vehicle, column-major), cut its
// triangles along planes (R.slice: heights where one surface spans two parts) and into parts by where they lie (R.triPart),
// stretch the parts (R.warp), put each part's origin at its pivot (R.pivots) or at a height of its own (R.origins), give
// listed parts an inner face of their own (R.inner: a thin shell such as a door seen from inside), simplify, shrink the
// textures, compress.
async function buildScan(name, R, doc) {
  const root = doc.getRoot(), scene = root.listScenes()[0];
  for (const a of root.listAnimations()) a.dispose();
  for (const k of root.listSkins()) k.dispose();
  if (R.specGloss) { // to metal-roughness; the specular colour and index of refraction that keep the old look in full are dropped
    await doc.transform(metalRough());
    for (const e of root.listExtensionsUsed()) if (['KHR_materials_specular', 'KHR_materials_ior'].includes(e.extensionName)) e.dispose();
  }
  for (const m of root.listMaterials()) { // one set of texture coordinates (a scan's texture sets are often copies of one)
    for (const ti of [m.getBaseColorTextureInfo(), m.getNormalTextureInfo(), m.getOcclusionTextureInfo(), m.getMetallicRoughnessTextureInfo(), m.getEmissiveTextureInfo()]) if (ti) ti.setTexCoord(0);
    m.setDoubleSided(true); // the cuts open the shell
  }
  if (R.blank) for (const [texName, rects, fill] of R.blank) { // panels of a colour map painted over (organisations' emblems)
    const t = root.listTextures().find(x => (x.getURI() || x.getName()).includes(texName)); if (!t) throw new Error('no texture ' + texName);
    const { data, info } = await sharp(Buffer.from(t.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const k = (y * info.width + x) * 3; data[k] = fill[0]; data[k + 1] = fill[1]; data[k + 2] = fill[2]; }
    t.setImage(await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()).setMimeType('image/png');
  }
  const sel = {}, A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  for (const n of root.listNodes()) {
    const mesh = n.getMesh(); if (!mesh) continue;
    const route = []; for (let x = n; x; x = x.getParentNode()) route.unshift(x.getName()); // the node's path, for triPart
    ownMesh(n, root);
    transformMesh(n.getMesh(), mul(R.frame, n.getWorldMatrix()));
    for (const p of n.getMesh().listPrimitives()) {
      for (const s of p.listSemantics()) if (!['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(s)) p.setAttribute(s, null);
      if (R.slice) sliceY(doc, p, R.slice);
      const pos = p.getAttribute('POSITION'), idx = p.getIndices(), cnt = idx ? idx.getCount() : pos.getCount();
      for (let t = 0; t < cnt; t += 3) {
        const a = idx ? idx.getScalar(t) : t, b = idx ? idx.getScalar(t + 1) : t + 1, c = idx ? idx.getScalar(t + 2) : t + 2;
        pos.getElement(a, A); pos.getElement(b, B); pos.getElement(c, C);
        const part = R.triPart([(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3], route.join('/')); if (!part) continue;
        ((sel[part] ||= new Map()).get(p) || sel[part].set(p, []).get(p)).push({ a, b, c });
      }
    }
  }
  const groups = {};
  for (const [part, byPrim] of Object.entries(sel)) {
    const Wo = R.warp && (R.warp.y ? R.warp : R.warp[part]);
    const pv = (R.pivots || {})[part] || [0, 0, 0], oy = R.origins && part in R.origins ? (Wo ? pwl(Wo.y, R.origins[part]) : R.origins[part]) : 0;
    const byMat = new Map(); // one primitive per material
    for (const [p, t] of byPrim) { const m = p.getMaterial(); if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(subPrimitive(doc, p, t)); }
    const mesh = doc.createMesh(part);
    const Wp = R.warp && (R.warp.y ? R.warp : R.warp[part]); // (one warp for the whole model, or one per part)
    for (const [m, prims] of byMat) { const j = joinPrimitives(prims); j.setMaterial(m); if (Wp) warpPrimitive(j, Wp); mesh.addPrimitive(j); }
    const F = (R.fit || {})[part]; // a part scaled on its own: about F.at, by F.scale along each axis
    if (F) transformMesh(mesh, [F.scale[0], 0, 0, 0, 0, F.scale[1], 0, 0, 0, 0, F.scale[2], 0, -F.at[0] * F.scale[0], -F.at[1] * F.scale[1], -F.at[2] * F.scale[2], 1]);
    transformMesh(mesh, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -pv[0], -pv[1] - oy, -pv[2], 1]);
    const g = doc.createNode(part).setTranslation(pv); g.addChild(doc.createNode(part + '-mesh').setMesh(mesh)); scene.addChild(g); groups[part] = g;
  }
  for (const n of scene.listChildren()) if (!Object.values(groups).includes(n)) scene.removeChild(n);
  const keep = new Set(Object.values(groups).flatMap(g => [g, ...g.listChildren()]));
  for (const n of root.listNodes()) if (!keep.has(n)) n.dispose();
  await doc.transform(prune({ keepLeaves: false }));
  if (R.simplify) for (const g of Object.values(groups)) for (const h of g.listChildren()) for (const prim of h.getMesh().listPrimitives()) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0, error: R.simplify, lockBorder: true });
  if (R.panes) addPanes(doc, groups[R.panes.part].listChildren()[0].getMesh(), R.panes, name);
  if (R.inner) { // a copy facing inward, 1.5 cm in, in a plain material of its own
    const I = R.inner, m = doc.createMaterial(name + '-inner').setBaseColorFactor([...I.color, 1]).setMetallicFactor(I.metal).setRoughnessFactor(I.rough);
    for (const part of I.parts) { const h = groups[part] && groups[part].listChildren()[0]; if (!h) continue;
      const src = h.getMesh().listPrimitives()[0], q = src.clone().setMaterial(m); q.setAttribute('TEXCOORD_0', null);
      const pos = q.getAttribute('POSITION').clone(), nor = q.getAttribute('NORMAL').clone(), ix = q.getIndices().clone(), P = [0, 0, 0], N = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, P); nor.getElement(i, N); pos.setElement(i, [P[0] - 0.015 * N[0], P[1] - 0.015 * N[1], P[2] - 0.015 * N[2]]); nor.setElement(i, [-N[0], -N[1], -N[2]]); }
      for (let t = 0; t < ix.getCount(); t += 3) { const b = ix.getScalar(t + 1); ix.setScalar(t + 1, ix.getScalar(t + 2)); ix.setScalar(t + 2, b); }
      q.setAttribute('POSITION', pos).setAttribute('NORMAL', nor).setIndices(ix); h.getMesh().addPrimitive(q); }
  }
  for (const m of root.listMaterials()) { const o = (R.materials || {})[m.getName()]; if (!o) continue; // finishes by source material
    if (o.metal != null) m.setMetallicFactor(o.metal); if (o.rough != null) m.setRoughnessFactor(o.rough); if (o.color) m.setBaseColorFactor([...o.color, 1]); if (o.emissive) m.setEmissiveFactor(o.emissive); }
  if (R.foam) await foamPaint(doc, groups, R.foam);
  if (R.grime) await grimeTextures(doc, R.grime);
  await shrinkTextures(doc, R.textures);
  await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(OUT, name + '.glb');
  await io.write(out, doc);
  const tri = root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0), 0);
  const parts = Object.entries(groups).map(([p, g]) => p + ' ' + g.listChildren()[0].getMesh().listPrimitives().reduce((s, q) => s + q.getIndices().getCount() / 3, 0)).join(', ');
  console.log(`${name}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${tri} triangles (${parts}), ${root.listTextures().length} textures → ${path.relative(process.cwd(), out)}`);
}

// Glass for a scan's windows. A scanner sees through glass, so where a window is the scan has whatever lay behind it: the
// cabin, deep inside the hull, or nothing. Light from outside the hull (an entry's glowing shock layer below the belly) then
// shows through a vehicle that should hide it. Over the stretch of hull P names, the surface is taken as a heightfield:
// its distance r from an axis along Y, at each Y and angle θ about the axis (θ = 0 straight up, toward +X positive). The
// heightfield is closed (the largest r within P.close, then the smallest of those within P.close again), which fills the
// dips narrower than about twice P.close and keeps the rest of the hull as it is. Where the fill is deeper than P.min, over
// an area of more than P.area m², is a window. Its glass is the closed surface there, 8 mm in, reaching two cells under the
// window's frame; it is added to the mesh as a primitive of its own, in a glass material.
function addPanes(doc, mesh, P, name) {
  const DY = 0.02, DT = 0.4 * Math.PI / 180, NT = Math.round(2 * Math.PI / DT), R0 = 2.4; // cells: 2 cm along Y, 0.4° (1.7 cm at R0)
  const [y0, y1] = P.y, Y0 = y0 - P.close - 0.1, NY = Math.ceil((y1 + P.close + 0.1 - Y0) / DY);
  const zc = y => P.axis[1] + (y - P.axis[0]) * P.axis[2];
  const R = new Float32Array(NY * NT), v = [0, 0, 0], A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  for (const prim of mesh.listPrimitives()) { // the outermost surface in each cell, from points 8 mm apart on every triangle
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices(), n3 = idx ? idx.getCount() : pos.getCount();
    for (let t = 0; t < n3; t += 3) {
      pos.getElement(idx ? idx.getScalar(t) : t, A); pos.getElement(idx ? idx.getScalar(t + 1) : t + 1, B); pos.getElement(idx ? idx.getScalar(t + 2) : t + 2, C);
      if (Math.max(A[1], B[1], C[1]) < Y0 || Math.min(A[1], B[1], C[1]) > Y0 + NY * DY) continue;
      const e = Math.max(Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]), Math.hypot(B[0] - C[0], B[1] - C[1], B[2] - C[2]), Math.hypot(A[0] - C[0], A[1] - C[1], A[2] - C[2]));
      const n = Math.max(1, Math.ceil(e / 0.008));
      for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) {
        const u = i / n, w = j / n, s = 1 - u - w; for (let k = 0; k < 3; k++) v[k] = s * A[k] + u * B[k] + w * C[k];
        const iy = Math.floor((v[1] - Y0) / DY); if (iy < 0 || iy >= NY) continue;
        const dz = v[2] - zc(v[1]), it = ((Math.floor((Math.atan2(v[0], dz) + Math.PI) / DT) % NT) + NT) % NT, r = Math.hypot(v[0], dz), q = iy * NT + it;
        if (r > R[q]) R[q] = r;
      }
    }
  }
  const hy = Math.round(P.close / DY), ht = Math.round(P.close / R0 / DT);
  const filt = (src, isMax) => { // a square's max (dilation) or min (erosion), along θ (round the axis) and then along Y
    const a = new Float32Array(src.length), b = new Float32Array(src.length), op = isMax ? Math.max : Math.min;
    for (let y = 0; y < NY; y++) for (let t = 0; t < NT; t++) { let m = src[y * NT + t]; for (let d = -ht; d <= ht; d++) m = op(m, src[y * NT + (t + d + NT) % NT]); a[y * NT + t] = m; }
    for (let y = 0; y < NY; y++) for (let t = 0; t < NT; t++) { let m = a[y * NT + t]; for (let d = -hy; d <= hy; d++) { const yy = y + d; if (yy >= 0 && yy < NY) m = op(m, a[yy * NT + t]); } b[y * NT + t] = m; }
    return b; };
  const Cl = filt(filt(R, true), false);
  const inRange = q => { const y = Y0 + (Math.floor(q / NT) + 0.5) * DY, th = -Math.PI + (q % NT + 0.5) * DT; return y >= y0 && y <= y1 && Math.abs(th) <= P.th * Math.PI / 180; };
  const deep = q => Cl[q] - R[q] > P.min && inRange(q);
  const win = new Uint8Array(NY * NT), seen = new Uint8Array(NY * NT), found = [];
  const nb = q => { const y = Math.floor(q / NT), t = q % NT, o = []; for (const [dy, dt] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const yy = y + dy; if (yy >= 0 && yy < NY) o.push(yy * NT + (t + dt + NT) % NT); } return o; };
  for (let q = 0; q < NY * NT; q++) { // the windows: connected dips of more than P.area
    if (seen[q] || !deep(q)) continue;
    const cells = [], st = [q]; seen[q] = 1;
    while (st.length) { const c = st.pop(); cells.push(c); for (const k of nb(c)) if (!seen[k] && deep(k)) { seen[k] = 1; st.push(k); } }
    const area = cells.length * DY * DT * R0; if (area < P.area) continue;
    for (const c of cells) win[c] = 1;
    const ys = cells.map(c => Y0 + (Math.floor(c / NT) + 0.5) * DY), ts = cells.map(c => (-Math.PI + (c % NT + 0.5) * DT) * 180 / Math.PI);
    found.push(`Y ${Math.min(...ys).toFixed(2)}–${Math.max(...ys).toFixed(2)} θ ${Math.min(...ts).toFixed(0)}…${Math.max(...ts).toFixed(0)}° ${area.toFixed(2)} m²`);
  }
  for (let k = 0; k < 2; k++) { const w2 = win.slice(); for (let q = 0; q < NY * NT; q++) if (win[q]) for (const c of nb(q)) w2[c] = 1; win.set(w2); } // under the frames
  // the glass: a quad per window cell, its corners on the closed surface 8 mm in (the mean of the cells about each corner)
  const vid = new Map(), pos = [], ix = [];
  const corner = (y, t) => { // corner y (0…NY) along Y, t along θ (wrapping)
    const key = y * NT + (t % NT); if (vid.has(key)) return vid.get(key);
    let s = 0, n = 0; for (const [dy, dt] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) { const yy = y + dy, tt = (t + dt + NT) % NT; if (yy >= 0 && yy < NY) { s += Cl[yy * NT + tt]; n++; } }
    const r = s / n - 0.008, yv = Y0 + y * DY, th = -Math.PI + t * DT;
    pos.push(r * Math.sin(th), yv, zc(yv) + r * Math.cos(th)); vid.set(key, pos.length / 3 - 1); return pos.length / 3 - 1; };
  for (let q = 0; q < NY * NT; q++) { if (!win[q]) continue; const y = Math.floor(q / NT), t = q % NT;
    const a = corner(y, t), b = corner(y + 1, t), c = corner(y + 1, t + 1), d = corner(y, t + 1); ix.push(a, d, b, b, d, c); } // facing out
  const nor = new Float32Array(pos.length); // area-weighted face normals at the corners
  for (let k = 0; k < ix.length; k += 3) { const [a, b, c] = [ix[k], ix[k + 1], ix[k + 2]].map(i => pos.slice(3 * i, 3 * i + 3));
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const i of [ix[k], ix[k + 1], ix[k + 2]]) for (let e = 0; e < 3; e++) nor[3 * i + e] += f[e]; }
  for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; }
  const glass = doc.createMaterial(name + '-glass').setBaseColorFactor([...P.color, 1]).setMetallicFactor(P.metal).setRoughnessFactor(P.rough).setDoubleSided(true);
  const buf = mesh.listPrimitives()[0].getAttribute('POSITION').getBuffer();
  const prim = doc.createPrimitive().setMaterial(glass)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(ix)).setBuffer(buf));
  simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0, error: 0.0005, lockBorder: true });
  mesh.addPrimitive(prim);
  console.log(`${name}: glass in ${found.length} windows (${prim.getIndices().getCount() / 3} triangles): ${found.join('; ')}`);
}

// Cut a primitive's triangles along the planes y = c: a triangle across one becomes two polygons, fanned into triangles,
// whose new corners interpolate every attribute. Leaves the primitive unindexed in effect (no vertex shared).
function sliceY(doc, prim, planes) {
  const sems = prim.listSemantics(), acc = sems.map(s => prim.getAttribute(s)), iy = sems.indexOf('POSITION'), idx = prim.getIndices();
  const n = idx ? idx.getCount() : acc[iy].getCount(), vert = i => acc.map(a => a.getElement(i, [])), out = sems.map(() => []);
  const mix = (p, q, t) => p.map((a, k) => a.map((x, e) => x + (q[k][e] - x) * t));
  const side = (poly, c, below) => { const r = []; // the polygon's part on one side of y = c (Sutherland–Hodgman)
    poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length], yp = p[iy][1], yq = q[iy][1], inP = below ? yp <= c : yp >= c, inQ = below ? yq <= c : yq >= c;
      if (inP) r.push(p); if (inP !== inQ) r.push(mix(p, q, (c - yp) / (yq - yp))); });
    return r; };
  for (let t = 0; t < n; t += 3) {
    let polys = [[0, 1, 2].map(k => vert(idx ? idx.getScalar(t + k) : t + k))];
    for (const c of planes) polys = polys.flatMap(p => { const ys = p.map(v => v[iy][1]); return Math.min(...ys) < c && Math.max(...ys) > c ? [side(p, c, true), side(p, c, false)] : [p]; });
    for (const p of polys) for (let k = 1; k + 1 < p.length; k++) for (const v of [p[0], p[k], p[k + 1]]) v.forEach((a, s) => out[s].push(...a));
  }
  const iN = sems.indexOf('NORMAL'); if (iN >= 0) for (let i = 0; i < out[iN].length; i += 3) { const l = Math.hypot(out[iN][i], out[iN][i + 1], out[iN][i + 2]) || 1; for (let e = 0; e < 3; e++) out[iN][i + e] /= l; }
  sems.forEach((s, k) => prim.setAttribute(s, doc.createAccessor().setType(acc[k].getType()).setArray(new Float32Array(out[k]))));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from({ length: out[iy].length / 3 }, (_, i) => i)));
}
// Value noise, smooth and repeatable (no randomness between builds): n3 in [0, 1] at a point of space, fbm3 several octaves.
function hash3(x, y, z) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function n3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), f = t => t * t * (3 - 2 * t), u = f(x - X), v = f(y - Y), w = f(z - Z);
  const L = (a, b, t) => a + (b - a) * t, c = (i, j, k) => hash3(X + i, Y + j, Z + k);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm3(x, y, z, oct = 5) { let s = 0, a = 0.5, t = 0; for (let o = 0; o < oct; o++) { s += a * n3(x, y, z); t += a; x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; } return s / t; }
// The foam of an external tank (F.material on part F.part, a cylinder along +Y of length F.len): wrapped texture
// coordinates (around the axis, and along it, top of the image at the top of the tank) and a colour map painted here —
// the sprayed foam's mottle and its bands, darker where F.bands says (the intertank's foam over its ribs), so it sits
// beside a scanned orbiter rather than looking like flat paint.
async function foamPaint(doc, groups, F) {
  const [W, H] = F.size, img = Buffer.alloc(W * H * 3);
  for (let j = 0; j < H; j++) {
    const yM = (1 - (j + 0.5) / H) * F.len; let band = 1; for (const [a, b, k] of F.bands || []) if (yM >= a && yM <= b) band = k;
    const spray = 1 + 0.025 * Math.sin(yM * 2 * Math.PI / 1.9) + 0.02 * (fbm3(0, yM * 0.35, 7.1, 3) - 0.5);
    for (let i = 0; i < W; i++) {
      const th = (i + 0.5) / W * 2 * Math.PI, cx = Math.cos(th) * F.r, cz = Math.sin(th) * F.r; // on the tank's surface, metres: no seam
      const mot = fbm3(cx * 1.6, yM * 1.6, cz * 1.6, 5), fine = n3(cx * 9, yM * 9, cz * 9), streak = fbm3(cx * 0.25, yM * 0.05, cz * 0.25, 3);
      const k = band * spray * (0.86 + 0.24 * mot + 0.05 * fine) * (0.95 + 0.1 * streak), o = 3 * (j * W + i);
      for (let c = 0; c < 3; c++) img[o + c] = Math.max(0, Math.min(255, Math.round(F.color[c] * k * (c === 0 ? 1 : 1 - 0.06 * (mot - 0.5)))));
    }
  }
  const png = await sharp(img, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  const tex = doc.createTexture(F.part + '-foam').setImage(new Uint8Array(png)).setMimeType('image/png');
  const P = [0, 0, 0];
  for (const h of groups[F.part].listChildren()) for (const prim of h.getMesh().listPrimitives()) {
    const m = prim.getMaterial(); if (!m || m.getName() !== F.material) continue;
    const pos = prim.getAttribute('POSITION'), uv = new Float32Array(pos.getCount() * 2);
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, P); uv[2 * i] = (Math.atan2(P[2], P[0]) / (2 * Math.PI) + 1) % 1; uv[2 * i + 1] = 1 - P[1] / F.len; }
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv));
    m.setBaseColorTexture(tex).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(F.rough ?? 0.85);
  }
}
// Weather the colour maps of the materials named in G.materials: tint them (G.tint) and darken them a little in a mottle
// (G.amount), as paint left out in the sun and salt looks next to a scan.
async function grimeTextures(doc, G) {
  for (const m of doc.getRoot().listMaterials()) {
    if (!G.materials.includes(m.getName())) continue; const t = m.getBaseColorTexture(); if (!t) continue;
    const { data, info } = await sharp(Buffer.from(t.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let j = 0; j < info.height; j++) for (let i = 0; i < info.width; i++) {
      const u = i / info.width * 24, v = j / info.height * 24, k = 1 - G.amount * fbm3(u, v, 3.3, 5) - 0.03 * n3(u * 8, v * 8, 1.1), o = 3 * (j * info.width + i);
      for (let c = 0; c < 3; c++) data[o + c] = Math.round(data[o + c] * G.tint[c] * k);
    }
    t.setImage(new Uint8Array(await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer())).setMimeType('image/png');
  }
}
// piecewise-linear table [[x, y] …], extended past its ends along its first and last pieces
function pwl(tab, x) {
  let i = 0; while (i < tab.length - 2 && x > tab[i + 1][0]) i++;
  const [x0, y0] = tab[i], [x1, y1] = tab[i + 1]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}
// Stretch a primitive: heights by W.y (source height → new height, piecewise linear) and distances from the axis by W.r
// (source height → factor, held past its ends). Normals follow (the inverse transpose of the stretch, along each
// triangle's piece of W.y).
function warpPrimitive(prim, W) {
  const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), idx = prim.getIndices(), done = new Set(), P = [0, 0, 0], N = [0, 0, 0];
  const r = y => y <= W.r[0][0] ? W.r[0][1] : y >= W.r[W.r.length - 1][0] ? W.r[W.r.length - 1][1] : pwl(W.r, y), slope = y => (pwl(W.y, y + 0.01) - pwl(W.y, y - 0.01)) / 0.02;
  for (let t = 0; t < idx.getCount(); t += 3) {
    const tri = [0, 1, 2].map(k => idx.getScalar(t + k)), k = slope(tri.reduce((a, i) => a + pos.getElement(i, P)[1], 0) / 3);
    for (const i of tri) {
      if (done.has(i)) continue; done.add(i);
      pos.getElement(i, P); const s = r(P[1]); pos.setElement(i, [P[0] * s, pwl(W.y, P[1]), P[2] * s]);
      if (nor) { nor.getElement(i, N); const m = [N[0] / s, N[1] / k, N[2] / s], l = Math.hypot(...m) || 1; nor.setElement(i, m.map(x => x / l)); }
    }
  }
}
// textures to WebP: size a number (every map) or { baseColor, other } (the colour maps, and the rest)
async function shrinkTextures(doc, size) {
  if (!size) return;
  const q = 82, enc = (slots, px) => textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [px, px], quality: q, slots });
  if (typeof size === 'number') return doc.transform(enc(null, size));
  const named = Object.keys(size.named || {}), rest = named.length ? new RegExp('^(?!(' + named.join('|') + ')$)') : null;
  for (const n of named) await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size.named[n], size.named[n]], quality: q, pattern: new RegExp('^' + n + '$') }));
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size.baseColor, size.baseColor], quality: q, slots: /baseColor/, pattern: rest }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size.other, size.other], quality: q, slots: /^(?!baseColor)/, pattern: rest }));
}
// Splits a node's mesh by triangle into clusters around the seeds ([x, z] in world space, refined by k-means): one new
// node per cluster with only the vertices its triangles use, carrying the source node's world transform.
function splitByClusters(doc, node, seeds) {
  const W = node.getWorldMatrix(), tris = [];
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices(), n = idx ? idx.getCount() : pos.getCount(), v = [0, 0, 0];
    const at = i => { pos.getElement(i, v); return mulv(W, v); };
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx.getScalar(t) : t, b = idx ? idx.getScalar(t + 1) : t + 1, c = idx ? idx.getScalar(t + 2) : t + 2;
      const pa = at(a), pb = at(b), pc = at(c);
      tris.push({ prim, a, b, c, x: (pa[0] + pb[0] + pc[0]) / 3, z: (pa[2] + pb[2] + pc[2]) / 3, k: 0 });
    }
  }
  const S = seeds.map(s => [...s]);
  for (let it = 0; it < 8; it++) {
    for (const t of tris) { let best = 0, bd = Infinity; S.forEach((s, k) => { const d = (t.x - s[0]) ** 2 + (t.z - s[1]) ** 2; if (d < bd) { bd = d; best = k; } }); t.k = best; }
    S.forEach((s, k) => { const m = tris.filter(t => t.k === k); if (m.length) { s[0] = m.reduce((a, t) => a + t.x, 0) / m.length; s[1] = m.reduce((a, t) => a + t.z, 0) / m.length; } });
  }
  return S.map((s, k) => {
    const mesh = doc.createMesh(node.getName() + '-' + k);
    for (const prim of node.getMesh().listPrimitives()) {
      const sel = tris.filter(t => t.k === k && t.prim === prim); if (!sel.length) continue;
      mesh.addPrimitive(subPrimitive(doc, prim, sel));
    }
    const nd = doc.createNode(node.getName() + '-' + k).setMesh(mesh).setMatrix(W);
    doc.getRoot().listScenes()[0].addChild(nd); return nd;
  });
}
// A mesh in two: the connected pieces whose centre (world frame) passes test, and the others. Vertices are joined by
// position first (a piece's faces may not share vertices where its normals or texture coordinates break).
function splitByPieces(doc, node, test) {
  const W = node.getWorldMatrix(), sel = [[], []];
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices(), n = idx ? idx.getCount() : pos.getCount(), nv = pos.getCount(), v = [0, 0, 0];
    const key = new Map(), id = new Int32Array(nv);
    for (let i = 0; i < nv; i++) { pos.getElement(i, v); const k = v.map(x => Math.round(x * 1e4)).join(','); if (!key.has(k)) key.set(k, key.size); id[i] = key.get(k); }
    const par = Int32Array.from({ length: key.size }, (_, i) => i), find = x => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
    const I = t => idx ? idx.getScalar(t) : t;
    for (let t = 0; t < n; t += 3) { const a = find(id[I(t)]); par[find(id[I(t + 1)])] = a; par[find(id[I(t + 2)])] = a; }
    const sum = new Map();
    for (let t = 0; t < n; t++) { const r = find(id[I(t)]); pos.getElement(I(t), v); const p = mulv(W, v); const s = sum.get(r) || [0, 0, 0, 0]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; sum.set(r, s); }
    const inCut = new Map(); for (const [r, s] of sum) inCut.set(r, test([s[0] / s[3], s[1] / s[3], s[2] / s[3]]));
    for (let t = 0; t < n; t += 3) sel[inCut.get(find(id[I(t)])) ? 0 : 1].push({ prim, a: I(t), b: I(t + 1), c: I(t + 2) });
  }
  return sel.map((tris, k) => {
    const mesh = doc.createMesh(node.getName() + (k ? '-rest' : '-cut'));
    for (const prim of node.getMesh().listPrimitives()) { const s = tris.filter(t => t.prim === prim); if (s.length) mesh.addPrimitive(subPrimitive(doc, prim, s)); }
    const nd = doc.createNode(node.getName() + (k ? '-rest' : '-cut')).setMesh(mesh).setMatrix(W);
    doc.getRoot().listScenes()[0].addChild(nd); return nd;
  });
}
// a primitive with only the given triangles and the vertices they use
function subPrimitive(doc, prim, sel) {
  const map = new Map(), order = [];
  const idx = sel.flatMap(t => [t.a, t.b, t.c]).map(i => { if (!map.has(i)) { map.set(i, order.length); order.push(i); } return map.get(i); });
  const out = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
  for (const s of prim.listSemantics()) {
    const src = prim.getAttribute(s), es = src.getElementSize(), arr = src.getArray(), dst = new arr.constructor(order.length * es);
    order.forEach((i, j) => { for (let e = 0; e < es; e++) dst[j * es + e] = arr[i * es + e]; });
    out.setAttribute(s, doc.createAccessor().setType(src.getType()).setArray(dst).setNormalized(src.getNormalized()));
  }
  out.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)));
  return out;
}
function mul(a, b) { // column-major 4×4 product a·b
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function mulv(m, v) { return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]; }
