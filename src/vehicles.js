// ============================================================================
// vehicles.js — real launch vehicles, spacecraft and launch sites
// Masses kg, thrust N, Isp s, lengths m.  Geometry parts: [len, rBottom, rTop, color, opts]
// ============================================================================
const PROP = {
  kerolox: { label: 'RP-1 / LOX (kerosene)', plume: '#ffb347', smoke: true },
  hydrolox: { label: 'LH₂ / LOX (liquid hydrogen)', plume: '#bcd7ff', smoke: false },
  methalox: { label: 'CH₄ / LOX (liquid methane)', plume: '#8fb6ff', smoke: false },
  solid: { label: 'Solid (PBAN / HTPB composite)', plume: '#ffd98c', smoke: true },
  hypergolic: { label: 'Aerozine-50 / N₂O₄ (hypergolic)', plume: '#ffd0a0', smoke: false },
  udmh: { label: 'UDMH / IRFNA (hypergolic)', plume: '#ffc890', smoke: false },
  mmh: { label: 'MMH / MON (hypergolic)', plume: '#ffd8b0', smoke: false },
  hydrazine: { label: 'Hydrazine (monopropellant)', plume: '#e8f0ff', smoke: false },
  xenon: { label: 'Xenon (electric)', plume: '#9ab8ff', smoke: false },
};
const C = { white: '#ecebe6', black: '#1b1b1d', orange: '#d0702a', grey: '#9ba0a6', dark: '#3b3e44', steel: '#b9bec5', gold: '#c9a043', silver: '#d6d9de', cream: '#efe7d4', red: '#c43c2c', foam: '#d98b4a' };

const LAUNCH_SITES = {
  KSC39A: { name: 'Kennedy LC-39A, Florida', lat: 28.6084, lon: -80.6043, azRange: [35, 120] },
  KSC39B: { name: 'Kennedy LC-39B, Florida', lat: 28.6272, lon: -80.6208, azRange: [35, 120] },
  CCSFS41: { name: 'Cape Canaveral SLC-41, Florida', lat: 28.5833, lon: -80.5830, azRange: [35, 120] },
  CCSFS12: { name: 'Cape Canaveral LC-12, Florida', lat: 28.4806, lon: -80.5422, azRange: [35, 120] },
  WENCHANG: { name: 'Wenchang LC-101, Hainan', lat: 19.6145, lon: 110.9510, azRange: [70, 180] },
  SDSC: { name: 'Satish Dhawan SLP, Sriharikota', lat: 13.7199, lon: 80.2304, azRange: [90, 140] },
  STARBASE: { name: 'Starbase, Texas', lat: 25.9971, lon: -97.1553, azRange: [80, 115] },
  TANEGASHIMA: { name: 'Tanegashima, Japan', lat: 30.4000, lon: 130.9750, azRange: [90, 160] },
  BAIKONUR: { name: 'Baikonur 81/24, Kazakhstan', lat: 46.0700, lon: 63.6500, azRange: [35, 65] },
  KOUROU3: { name: 'Guiana Space Centre ELA-3, Kourou', lat: 5.2392, lon: -52.7685, azRange: [-10.5, 93.5] },
};

// Shuttle landing runways: threshold of the landing end (lat, lon), true heading of the landing direction (°),
// length and width (km), elevation (km). KSC SLF from FAA data (KTTS); Edwards concrete 04/22 is today's 05R/23L
// (FAA data). The Rogers Dry Lake lakebed runway 23 has no published threshold coordinates: its position here is
// approximate (on the lakebed, parallel to the main runway).
const RUNWAYS = {
  KSC15: { name: 'Kennedy Space Center, Shuttle Landing Facility Runway 15', short: 'KSC Runway 15', lat: 28.632753, lon: -80.706062, hdg: 150, len: 4.572, wid: 0.091, elev: 0, surface: 'concrete', num: '15', ground: 'florida' },
  KSC33: { name: 'Kennedy Space Center, Shuttle Landing Facility Runway 33', short: 'KSC Runway 33', lat: 28.597026, lon: -80.682680, hdg: 330, len: 4.572, wid: 0.091, elev: 0, surface: 'concrete', num: '33', ground: 'florida' },
  EDW22: { name: 'Edwards Air Force Base, Runway 22 (concrete)', short: 'Edwards Runway 22', lat: 34.91633, lon: -117.86250, hdg: 238, len: 4.579, wid: 0.091, elev: 0.696, surface: 'concrete', num: '22', ground: 'desert' },
  EDW04: { name: 'Edwards Air Force Base, Runway 04 (concrete)', short: 'Edwards Runway 04', lat: 34.89450, lon: -117.90500, hdg: 58, len: 4.579, wid: 0.091, elev: 0.702, surface: 'concrete', num: '04', ground: 'desert' },
  EDW23L: { name: 'Edwards Air Force Base, Rogers Dry Lake Runway 23 (lakebed)', short: 'Rogers Dry Lake Runway 23', lat: 34.9700, lon: -117.7700, hdg: 238, len: 8.0, wid: 0.27, elev: 0.693, surface: 'lakebed', num: '23', ground: 'lakebed', approx: true },
  WSSH17: { name: 'White Sands Space Harbor, Runway 17 (gypsum)', short: 'White Sands Runway 17', lat: 32.9900, lon: -106.4250, hdg: 170, len: 10.7, wid: 0.09, elev: 1.193, surface: 'lakebed', num: '17', ground: 'gypsum', approx: true },
};

// Each launcher: stages in ignition order. parallel:true → burns together with the next stage from liftoff (boosters).
const LAUNCHERS = {
  saturnV: {
    name: 'Saturn V', org: 'NASA (USA)', years: '1967–1973', height: 110.6, diameter: 10.1, crewRated: true,
    blurb: 'Three-stage super heavy-lift rocket of the Apollo program. Still the most powerful rocket ever to fly crews to the Moon.',
    stages: [
      // Lengths as stacked (the S-IC with its engines 42.06 m, the S-II with its aft interstage 24.87 m, the S-IVB with the
      // cone to the S-II 17.86 m, the instrument unit 0.91 m; 110.6 m with the Apollo spacecraft). geom starts at the base of
      // each stage's structure; eng.y0: the nozzles' exit plane from there (the S-II's and S-IVB's J-2s hang inside the
      // interstage below them). Drawn with the detailed model 'saturnv' (app/30_models.js) once it has loaded.
      { id: 'S-IC', name: 'S-IC first stage', prop: 'kerolox', engine: 'F-1', n: 5, thrustSL: 5 * 6770e3, thrustVac: 5 * 7770e3, ispSL: 263, ispVac: 304, dry: 130000, propMass: 2077000, maxG: 4.0, minThr: 0.8,
        geom: [[38.82, 5.05, 5.05, C.white, { roll: 'sic' }]], eng: { n: 5, len: 3.24, r: 1.85, layout: 'cross', spread: 4.7 }, fins: { n: 4, len: 9.0, span: 3.4, color: C.white }, detail: 'saturnv' },
      { id: 'S-II', name: 'S-II second stage', prop: 'hydrolox', engine: 'J-2', n: 5, thrustSL: 5 * 486e3, thrustVac: 5 * 1033e3, ispSL: 200, ispVac: 421, dry: 36200, propMass: 443000,
        geom: [[5.49, 5.05, 5.05, C.white, { band: true, ist: true }], [19.38, 5.05, 5.05, C.white], [4.2, 5.05, 3.3, C.white]], eng: { n: 5, len: 3.0, r: 1.0, layout: 'cross', spread: 3.0, y0: 2.5 }, detail: 'saturnv' },
      { id: 'S-IVB', name: 'S-IVB third stage', prop: 'hydrolox', engine: 'J-2', n: 1, thrustSL: 486e3, thrustVac: 1033e3, ispSL: 200, ispVac: 421, dry: 11300, propMass: 107000, restart: true,
        geom: [[13.66, 3.3, 3.3, C.white, { roll: 'sivb' }], [0.91, 3.3, 3.3, C.grey]], eng: { n: 1, len: 3.0, r: 1.0, layout: 'single', y0: -3.0 }, detail: 'saturnv' },
    ],
    jettison: [{ name: 'S-II aft interstage', mass: 5200, afterStage: 0, delay: 30, part: 'IST' }, { name: 'Launch Escape System', mass: 4170, afterStage: 0, delay: 35, part: 'LES' }],
    payloadFairing: null, ascent: { hp: 185, ha: 190, vert: 12, kickGuess: 1.5 },
    roll: { padAz: 90, t: [13.2, 31.1] }, // roll program: from the pad azimuth (90°) to the flight azimuth, T+13.2 s to T+31.1 s (Apollo 11)
  },
  sls1: {
    name: 'SLS Block 1', org: 'NASA (USA)', years: '2022–', height: 98.1, diameter: 8.4, crewRated: true,
    blurb: 'Space Launch System Block 1 — RS-25 core stage, two five-segment solid boosters and the ICPS upper stage. Launched Artemis I and the crewed Artemis II.',
    stages: [
      { id: 'SRB', name: '2 × five-segment solid rocket boosters', prop: 'solid', engine: 'RSRMV', n: 2, thrustSL: 2 * 11.88e6, thrustVac: 2 * 13.20e6, ispSL: 242, ispVac: 268.8, dry: 2 * 98000, propMass: 2 * 631000, parallel: true,
        curve: [[0, 1.22], [20, 1.18], [45, 0.94], [62, 0.95], [85, 1.04], [108, 0.78], [122, 0.4], [135, 0.05]], booster: { count: 2, offset: 6.1 },
        geom: [[2.6, 2.6, 1.86, C.white], [46.0, 1.855, 1.855, C.white, { bands: 4 }], [5.5, 1.855, 0.35, C.white]], eng: { n: 1, len: 3.6, r: 1.9, layout: 'single' }, look: 'slsBooster' }, // look: drawn by hand (app/3b_launchers.js)
      { id: 'Core', name: 'Core stage (4 × RS-25)', prop: 'hydrolox', engine: 'RS-25', n: 4, thrustSL: 4 * 1860e3, thrustVac: 4 * 2280e3, ispSL: 366, ispVac: 452, dry: 85000, propMass: 980000, maxG: 3.5, minThr: 0.67,
        geom: [[4.5, 4.6, 4.2, C.white], [60.1, 4.2, 4.2, C.orange], [8.3, 4.2, 2.55, C.white]], eng: { n: 4, len: 4.3, r: 1.2, layout: 'square', spread: 2.0 }, look: 'slsCore' },
      { id: 'ICPS', name: 'Interim Cryogenic Propulsion Stage', prop: 'hydrolox', engine: 'RL10B-2', n: 1, thrustSL: 60e3, thrustVac: 110.1e3, ispSL: 300, ispVac: 465.5, dry: 3490, propMass: 27220, restart: true,
        geom: [[13.7, 2.55, 2.55, C.white], [1.5, 2.55, 2.05, C.white]], eng: { n: 1, len: 2.4, r: 1.1, layout: 'single' } },
    ],
    jettison: [{ name: 'Launch Abort System', mass: 7700, time: 195, part: 'LES' }, { name: 'Service module fairings', mass: 1350, time: 190, part: 'SAJ' }],
    payloadFairing: null, ascent: { hp: 185, ha: 2300, vert: 10, kickGuess: 1.2 },
    roll: { padAz: 0, t: [8, 20] }, // on the pad the boosters stand east and west of the core, the launcher's tower to the north; it rolls to the flight azimuth once clear of the tower
  },
  lm5: {
    name: 'Long March 5', org: 'CASC (China)', years: '2016–', height: 57.0, diameter: 5.0,
    blurb: 'China’s heavy-lift launcher: hydrolox core with four kerosene boosters. Launched Chang’e 5 and Tianwen-1.',
    stages: [
      { id: 'K3-1', name: '4 × K3-1 boosters (2 × YF-100 each)', prop: 'kerolox', engine: 'YF-100', n: 8, thrustSL: 8 * 1200e3, thrustVac: 8 * 1340e3, ispSL: 300, ispVac: 335, dry: 4 * 13000, propMass: 4 * 143000, parallel: true,
        booster: { count: 4, offset: 4.2 }, geom: [[22.6, 1.675, 1.675, C.white], [5.0, 1.675, 0.3, C.white]], eng: { n: 2, len: 2.3, r: 0.75, layout: 'pair', spread: 0.8 }, look: 'lm5Booster' }, // look: drawn by hand (app/3b_launchers.js)
      { id: 'Core', name: 'Core stage (2 × YF-77)', prop: 'hydrolox', engine: 'YF-77', n: 2, thrustSL: 2 * 510e3, thrustVac: 2 * 700e3, ispSL: 310, ispVac: 430, dry: 21600, propMass: 158500,
        geom: [[33.2, 2.5, 2.5, C.white, { flag: 'cn' }]], eng: { n: 2, len: 2.8, r: 0.9, layout: 'pair', spread: 1.1 }, look: 'lm5Core' },
      { id: 'Stage 2', name: 'Second stage (2 × YF-75D)', prop: 'hydrolox', engine: 'YF-75D', n: 2, thrustSL: 2 * 50e3, thrustVac: 2 * 88.36e3, ispSL: 300, ispVac: 442.6, dry: 3400, propMass: 26100, restart: true,
        geom: [[11.5, 2.5, 2.5, C.white]], eng: { n: 2, len: 1.6, r: 0.55, layout: 'pair', spread: 0.8 } },
    ],
    jettison: [{ name: 'Payload fairing', mass: 3000, alt: 115, part: 'fairing' }],
    payloadFairing: { len: 12.5, r: 2.6, color: C.white }, ascent: { hp: 200, ha: 200, vert: 12, kickGuess: 1.6 },
  },
  atlasV541: {
    name: 'Atlas V 541', org: 'ULA (USA)', years: '2011–', height: 59.7, diameter: 3.81,
    blurb: 'RD-180 powered common core, four solid boosters, single-engine Centaur upper stage and 5-m fairing. Launched Curiosity and Perseverance.',
    stages: [
      { id: 'SRB', name: '4 × AJ-60A solid boosters', prop: 'solid', engine: 'AJ-60A', n: 4, thrustSL: 4 * 1170e3, thrustVac: 4 * 1330e3, ispSL: 245, ispVac: 279, dry: 4 * 4100, propMass: 4 * 42630, parallel: true,
        curve: [[0, 1.15], [30, 1.05], [70, 0.95], [85, 0.6], [95, 0.05]], booster: { count: 4, offset: 2.75 },
        geom: [[17.0, 0.79, 0.79, C.white], [3.0, 0.79, 0.15, C.white]], eng: { n: 1, len: 1.6, r: 0.75, layout: 'single' } },
      { id: 'CCB', name: 'Common Core Booster (RD-180)', prop: 'kerolox', engine: 'RD-180', n: 1, thrustSL: 3827e3, thrustVac: 4152e3, ispSL: 311.3, ispVac: 337.8, dry: 21054, propMass: 284089, maxG: 4.8, minThr: 0.47,
        geom: [[32.5, 1.905, 1.905, '#d9864e']], eng: { n: 2, len: 3.6, r: 0.75, layout: 'pair', spread: 0.8 } },
      { id: 'Centaur', name: 'Centaur III (single RL10C-1)', prop: 'hydrolox', engine: 'RL10C-1', n: 1, thrustSL: 50e3, thrustVac: 101.8e3, ispSL: 300, ispVac: 449.7, dry: 2316, propMass: 20830, restart: true,
        geom: [[12.7, 1.525, 1.525, C.silver]], eng: { n: 1, len: 2.3, r: 0.75, layout: 'single' } },
    ],
    jettison: [{ name: '5-m payload fairing', mass: 4000, alt: 120, part: 'fairing' }],
    payloadFairing: { len: 20.7, r: 2.7, color: C.white, encloseUpper: true }, ascent: { hp: 185, ha: 185, vert: 10, kickGuess: 2.5 },
  },
  atlasAgena: {
    // As Mariner 4 flew it: the Atlas 19.8 m from its base to the Agena adapter and 3.05 m across, the booster section a
    // skirt round the foot of the tank (its tank and sustainer engine stay when the section drops away); the Agena-D 6.3 m
    // long and 1.52 m across; the shroud enclosing the Agena and the spacecraft; 28.4 m in all. look: drawn over the plain
    // geometry by app/35_atlas.js
    name: 'Atlas LV-3 Agena-D', org: 'USAF / NASA (USA)', years: '1963–1978', height: 28.4, diameter: 3.05,
    blurb: '“Stage-and-a-half” Atlas with balloon tanks plus a restartable Agena-D upper stage. Sent Mariner 4 to the first Mars flyby.',
    stages: [
      { id: 'Booster', name: 'Atlas booster section (2 × LR89 + sustainer)', prop: 'kerolox', engine: 'LR89 ×2 + LR105', n: 3, thrustSL: 1590e3, thrustVac: 1850e3, ispSL: 258, ispVac: 290, dry: 3050, propMass: 87000,
        geom: [[0.8, 1.6, 1.6, C.steel]], eng: { n: 2, len: 2.1, r: 0.6, layout: 'pair', spread: 3.0 }, look: 'atlasBooster' },
      { id: 'Sustainer', name: 'Atlas sustainer (LR105)', prop: 'kerolox', engine: 'LR105', n: 1, thrustSL: 254e3, thrustVac: 363e3, ispSL: 220, ispVac: 316, dry: 2350, propMass: 26500,
        geom: [[19.0, 1.525, 1.525, C.steel], [1.4, 1.525, 0.76, C.steel]], eng: { n: 1, len: 2.1, r: 0.5, layout: 'single' }, look: 'atlasSustainer' },
      { id: 'Agena-D', name: 'Agena-D (Bell 8247)', prop: 'udmh', engine: 'Bell 8247', n: 1, thrustSL: 40e3, thrustVac: 71.2e3, ispSL: 200, ispVac: 290, dry: 670, propMass: 6100, restart: true,
        geom: [[5.4, 0.76, 0.76, C.silver]], eng: { n: 1, len: 0.9, r: 0.4, layout: 'single' }, look: 'agenaD' },
    ],
    jettison: [{ name: 'Mariner shroud', mass: 400, alt: 110, part: 'fairing' }],
    payloadFairing: { len: 9.0, r: 0.82, cyl: 0.78, color: C.silver, encloseUpper: true }, ascent: { hp: 185, ha: 185, vert: 10, kickGuess: 2.0 },
  },
  falconHeavy: {
    name: 'Falcon Heavy (expendable)', org: 'SpaceX (USA)', years: '2018–', height: 70.0, diameter: 3.66,
    blurb: 'Three Falcon 9-derived cores (27 Merlin engines). Flown fully expendable for Europa Clipper.',
    stages: [
      { id: 'Side boosters', name: '2 × side boosters (9 × Merlin 1D each)', prop: 'kerolox', engine: 'Merlin 1D', n: 18, thrustSL: 18 * 845e3, thrustVac: 18 * 914e3, ispSL: 282, ispVac: 311, dry: 2 * 22200, propMass: 2 * 411000, parallel: true,
        booster: { count: 2, offset: 3.75 }, geom: [[37.0, 1.83, 1.83, C.white], [4.2, 1.83, 1.83, C.black], [3.2, 1.83, 0.25, C.white]], eng: { n: 9, len: 1.4, r: 0.45, layout: 'octaweb', spread: 1.25 }, look: 'falconSide' }, // look: drawn by hand (app/3b_launchers.js)
      { id: 'Center core', name: 'Center core (9 × Merlin 1D)', prop: 'kerolox', engine: 'Merlin 1D', n: 9, thrustSL: 9 * 845e3, thrustVac: 9 * 914e3, ispSL: 282, ispVac: 311, dry: 25000, propMass: 411000, thrWithBoosters: 0.55, maxG: 4.5, minThr: 0.4,
        geom: [[37.0, 1.83, 1.83, C.white], [4.2, 1.83, 1.83, C.black]], eng: { n: 9, len: 1.4, r: 0.45, layout: 'octaweb', spread: 1.25 }, look: 'falconCentre' },
      { id: 'Stage 2', name: 'Second stage (Merlin Vacuum)', prop: 'kerolox', engine: 'MVac', n: 1, thrustSL: 600e3, thrustVac: 981e3, ispSL: 200, ispVac: 348, dry: 4000, propMass: 107500, restart: true,
        geom: [[12.6, 1.83, 1.83, C.white]], eng: { n: 1, len: 3.0, r: 1.5, layout: 'single' } },
    ],
    jettison: [{ name: 'Payload fairing', mass: 1900, alt: 110, part: 'fairing' }],
    payloadFairing: { len: 13.1, r: 2.6, color: C.white }, ascent: { hp: 185, ha: 185, vert: 10, kickGuess: 2.0 },
    roll: { padAz: 0, t: [10, 22] }, // on Pad 39A the three cores stand in a row east–west, the transporter-erector to the south
  },
  starship: {
    name: 'Starship (Super Heavy + Ship, Block 2)', org: 'SpaceX (USA)', years: '2025–', height: 123.0, diameter: 9.0, crewRated: true,
    blurb: 'Fully reusable methalox two-stage vehicle (33 + 6 Raptor engines). Mars missions require refilling the Ship with ~8–10 tanker flights in Earth orbit.',
    stages: [
      { id: 'Super Heavy', name: 'Super Heavy booster (33 × Raptor 2)', prop: 'methalox', engine: 'Raptor 2', n: 33, thrustSL: 73.5e6, thrustVac: 78.0e6, ispSL: 327, ispVac: 347, dry: 275000, propMass: 3400000, maxG: 3.5, minThr: 0.4,
        geom: [[69.0, 4.5, 4.5, C.steel], [2.0, 4.5, 4.5, C.dark]], eng: { n: 33, len: 2.5, r: 0.65, layout: 'raptor33', spread: 4.0 }, look: 'starshipBooster' }, // look: drawn by hand (app/3a_starship.js)
      { id: 'Ship', name: 'Ship (3 Raptor + 3 Raptor Vacuum)', prop: 'methalox', engine: 'Raptor / RVac', n: 6, thrustSL: 10.5e6, thrustVac: 15.0e6, ispSL: 327, ispVac: 368, dry: 100000, propMass: 1500000, restart: true,
        geom: [[35.1, 4.5, 4.5, C.steel], [17.0, 4.5, 0.6, C.steel]], eng: { n: 6, len: 2.8, r: 0.9, layout: 'ship6', spread: 2.2 }, look: 'starshipShip' }, // (the nose is a 17-m ogive, drawn in the look)
    ],
    jettison: [], payloadFairing: null, ascent: { hp: 200, ha: 200, vert: 8, kickGuess: 1.5 },
  },
  lvm3: {
    name: 'LVM3', org: 'ISRO (India)', years: '2017–', height: 43.5, diameter: 4.0,
    blurb: 'India’s heaviest launcher: two S200 solid boosters, L110 liquid core and C25 cryogenic upper stage. Launched Chandrayaan-2 and -3.',
    stages: [
      { id: 'S200', name: '2 × S200 solid boosters', prop: 'solid', engine: 'S200', n: 2, thrustSL: 2 * 4.6e6, thrustVac: 2 * 5.15e6, ispSL: 247, ispVac: 274.5, dry: 2 * 31300, propMass: 2 * 207000, parallel: true,
        curve: [[0, 1.12], [40, 1.05], [80, 0.95], [115, 0.7], [130, 0.05]], booster: { count: 2, offset: 3.6 },
        geom: [[22.0, 1.6, 1.6, C.white], [4.0, 1.6, 0.3, C.white]], eng: { n: 1, len: 2.6, r: 1.3, layout: 'single' } },
      { id: 'L110', name: 'L110 core (2 × Vikas)', prop: 'udmh', engine: 'Vikas', n: 2, thrustSL: 2 * 600e3, thrustVac: 2 * 806e3, ispSL: 230, ispVac: 293, dry: 9000, propMass: 116000, ignition: 110,
        geom: [[17.0, 2.0, 2.0, C.cream]], eng: { n: 2, len: 2.1, r: 0.6, layout: 'pair', spread: 0.8 } },
      { id: 'C25', name: 'C25 cryogenic stage (CE-20)', prop: 'hydrolox', engine: 'CE-20', n: 1, thrustSL: 100e3, thrustVac: 186e3, ispSL: 300, ispVac: 442, dry: 5000, propMass: 28000,
        geom: [[13.5, 2.0, 2.0, C.white]], eng: { n: 1, len: 2.0, r: 0.8, layout: 'single' } },
    ],
    jettison: [{ name: 'Payload fairing', mass: 2400, alt: 115, part: 'fairing' }],
    payloadFairing: { len: 10.75, r: 2.5, color: C.white }, ascent: { hp: 170, ha: 36500, vert: 10, kickGuess: 2.5 },
  },
  ariane5ECA: {
    // Ariane 5 ECA as it launched JWST (VA256): two solid boosters (EAP) beside the cryogenic core (EPC, one Vulcain 2) and
    // the cryogenic upper stage (ESC-A, one HM7B) that injects the payload directly toward L2. Figures from Arianespace's
    // user manual; the booster thrust curve is approximate.
    name: 'Ariane 5 ECA', org: 'Arianespace / ESA (Europe)', years: '2002–2023', height: 53.0, diameter: 5.4,
    blurb: 'Europe’s heavy launcher: two solid boosters and a hydrogen core lit together, a cryogenic upper stage for the injection. Launched the James Webb Space Telescope on its final year of service.',
    stages: [
      { id: 'EAP', name: '2 × solid boosters (EAP, P241)', prop: 'solid', engine: 'P241', n: 2, thrustSL: 2 * 4800e3, thrustVac: 2 * 5250e3, ispSL: 262, ispVac: 275, dry: 2 * 33000, propMass: 2 * 237000, parallel: true, // (the mean over the 130-s burn; the curve puts the 7 000-kN peak at 20 s)
        curve: [[0, 1.0], [20, 1.08], [60, 0.95], [100, 0.9], [120, 0.55], [130, 0.1], [135, 0.02]], booster: { count: 2, offset: 4.67 },
        geom: [[27.0, 1.525, 1.525, C.white], [4.2, 1.525, 0.35, C.white]], eng: { n: 1, len: 3.0, r: 1.4, layout: 'single' }, look: 'ariane5EAP', detail: 'ariane5' }, // detail: the published model (tools/models); look: the hand drawing until it arrives (app/3b_launchers.js)
      { id: 'EPC', name: 'Cryogenic core stage (EPC, Vulcain 2)', prop: 'hydrolox', engine: 'Vulcain 2', n: 1, thrustSL: 960e3, thrustVac: 1390e3, ispSL: 318, ispVac: 432, dry: 14700, propMass: 173000, maxG: 4.5, minThr: 1,
        geom: [[30.5, 2.7, 2.7, C.cream]], eng: { n: 1, len: 3.4, r: 1.0, layout: 'single' }, look: 'ariane5EPC', detail: 'ariane5' },
      { id: 'ESC-A', name: 'Cryogenic upper stage (ESC-A, HM7B)', prop: 'hydrolox', engine: 'HM7B', n: 1, thrustSL: 0, thrustVac: 67e3, ispSL: 300, ispVac: 446, dry: 4540, propMass: 14900, restart: true, // (the HM7B lights once; the parking orbit and injection here stand in for its single long burn)
        geom: [[4.7, 2.7, 2.7, C.white]], eng: { n: 1, len: 2.0, r: 0.5, layout: 'single' }, look: 'ariane5ESC', detail: 'ariane5' },
    ],
    jettison: [{ name: 'Payload fairing', mass: 2675, alt: 110, part: 'fairing' }],
    payloadFairing: { len: 17.0, r: 2.7, color: C.white, detail: 'ariane5' }, ascent: { hp: 170, ha: 170, vert: 6, kickGuess: 2.0 },
    roll: { padAz: 0, t: [10, 20] },
  },
};

// Space Shuttle: the stack is the External Tank with two solid boosters on its sides and the orbiter on its belly.
// The three RS-25 main engines sit on the orbiter but burn the tank's propellant, so the "core stage" here is the
// ET (dry mass) with the RS-25s' thrust; the engines' own mass is part of the orbiter (spacecraft).
//   RSRM (per booster): 2.80 Mlbf sea level at liftoff, 3.07 Mlbf peak at T+20 s, propellant 1,107,000 lb, inert
//   ≈ 192,000 lb, action time ≈ 124 s, shaped grain with a thrust bucket around Max-Q (NASA RSRM overview, NTRS).
//   RS-25 at 104.5 %: 491,900 lbf vacuum / ≈ 397,700 lbf sea level, Isp 452 / 365 s; minimum power 67 %.
//   Super Lightweight Tank: 58,500 lb dry, ≈ 1.62 Mlb of LOX + LH2.
// The curve below is the booster's vacuum thrust relative to its liftoff value (1985 SRM data scaled to the RSRM).
LAUNCHERS.shuttle = {
  name: 'Space Shuttle', org: 'NASA (USA)', years: '1981–2011', height: 56.1, diameter: 8.4, crewRated: true, sideMount: true,
  blurb: 'Two solid rocket boosters and three RS-25 engines on the winged orbiter, all burning at liftoff; the RS-25s draw on the orange External Tank. The boosters fall away after two minutes, the tank at orbit, and the orbiter glides home to a runway.',
  stages: [
    { id: 'SRB', name: '2 × Solid Rocket Boosters (RSRM)', prop: 'solid', engine: 'RSRM', n: 2, thrustSL: 2 * 12.45e6, thrustVac: 2 * 13.61e6, ispSL: 242, ispVac: 268, dry: 2 * 87000, propMass: 2 * 501000, parallel: true,
      curve: [[0, 1.0], [10, 1.062], [20, 1.088], [30, 0.938], [50, 0.775], [60, 0.80], [75, 0.85], [100, 0.732], [110, 0.369], [115, 0.258], [120, 0.144], [124, 0.016], [130, 0.016]],
      // 45.46 m from the nozzle's exit to the nose, 3.71 m across; the nozzle's exit 9.26 m below the tank's aft dome (the stack
      // stands 56.1 m tall). Drawn with the detailed model 'shuttle_stack' once it has loaded (the left booster mirrored).
      booster: { count: 2, offset: 6.4, y0: -8.38 },
      geom: [[2.5, 2.6, 1.86, C.white], [35.9, 1.855, 1.855, C.white, { bands: 4 }], [3.3, 1.855, 1.6, C.white], [2.4, 1.6, 0.6, C.white], [0.48, 0.6, 0.1, C.white]], eng: { n: 1, len: 0.88, r: 1.9, layout: 'single' }, detail: 'shuttle_stack' },
    { id: 'ET', name: 'External Tank (3 × RS-25 on the orbiter)', prop: 'hydrolox', engine: 'RS-25', n: 3, thrustSL: 3 * 1.769e6, thrustVac: 3 * 2.188e6, ispSL: 365, ispVac: 452.3, dry: 26500, propMass: 729000, maxG: 3.0, minThr: 0.67,
      sched: [[0, 1], [30, 1], [32, 0.69], [50, 0.69], [53, 1]],
      geom: [[0.9, 2.4, 4.2, C.foam], [26.1, 4.2, 4.2, C.foam], [6.9, 4.2, 4.2, '#c9803f', { bands: true }], [1.9, 4.2, 4.2, C.foam], [4.4, 4.2, 3.55, C.foam], [3.8, 3.55, 2.3, C.foam], [2.4, 2.3, 0.75, C.foam], [0.5, 0.75, 0.15, '#4a4a4a']], eng: null, detail: 'shuttle_stack' },
  ],
  jettison: [], payloadFairing: null,
  // direct insertion: main engine cutoff (MECO) at ≈ 105 km on a 58 × 225 km orbit; the OMS raises the perigee later
  ascent: { hp: 58, ha: 225, hCut: 105, vert: 7, kickGuess: 3, qMax: 36000, gTgo: true }, arefExtra: 25,
};
// Engine start on the pad: liquid engines light t seconds before liftoff and build up to full thrust (ramp, s; stagger
// between engine groups, s) while hold-down clamps keep the vehicle down; solid boosters always light at T−0.
//   Saturn V: engine start sequence at T−8.9 s, centre F-1 first, then opposing pairs 300 ms apart (NASA)
//   SLS: RS-25 start-up at T−6.36 s, boosters at T−0 (NASA Artemis II countdown)
//   Atlas V: RD-180 ignition at T−2.7 s, solids at T−0 (ULA timelines)
//   Falcon Heavy: 27 Merlins at about T−2 s (Spaceflight Now) · Starship: about T−3 s (press reports)
//   Long March 5: core and boosters ignite before liftoff (time approximate) · Atlas LV-3: approximate
//   Ariane 5: the Vulcain 2 at H0, the boosters at H0 + 7.05 s after its health check, liftoff at H0 + 7.3 s (Arianespace)
//   LVM3: the S200 solids light at T−0 and the L110 core is air-started, so nothing burns on the pad beforehand
const PAD_IGNITION = {
  saturnV: { t: 8.9, ramp: 4.0, stagger: 0.3, seq: 'centre engine first, then opposing pairs 0.3 s apart' },
  sls1: { t: 6.36, ramp: 3.0, stagger: 0.12, seq: 'the four RS-25s start 0.12 s apart' },
  atlasV541: { t: 2.7, ramp: 1.4 },
  atlasAgena: { t: 2.0, ramp: 1.2, approx: true },
  falconHeavy: { t: 2.0, ramp: 1.2 },
  lm5: { t: 3.0, ramp: 1.6, approx: true },
  starship: { t: 3.0, ramp: 1.6, approx: true },
  lvm3: { t: 0, ramp: 0 },
  ariane5ECA: { t: 7.3, ramp: 3.0, seq: 'the Vulcain 2 lights at H0 and is checked for seven seconds; the boosters light and the vehicle leaves at H0 + 7.3 s' },
  shuttle: { t: 6.6, ramp: 3.0, stagger: 0.12, seq: 'main engines 3, 2 and 1 start 0.12 s apart' }, // NSTS News Reference Manual
};
for (const k in PAD_IGNITION) if (LAUNCHERS[k]) LAUNCHERS[k].ign = PAD_IGNITION[k];
// stages whose engines are burning at liftoff: boosters plus the first core stage (unless that core is air-started)
function liftoffStages(L) { const iCore = L.stages.findIndex(s => !s.parallel); return L.stages.filter((s, i) => (s.parallel || i === iCore) && !(s.ignition > 0)); }
// "27 × Merlin 1D", "8 × YF-100 + 2 × YF-77": engine counts, identical engines merged
function engineCounts(stages) { const m = new Map(); for (const s of stages) m.set(s.engine, (m.get(s.engine) || 0) + s.n); return [...m].map(([e, n]) => `${n} × ${e}`).join(' + '); }

// ---------------- spacecraft (payload stacks) ----------------
// modules: dry kg, prop kg, engine {name, thrust N, isp s, prop}
const SPACECRAFT = {
  apolloCSMLM: {
    name: 'Apollo CSM + LM', crewMax: 3,
    modules: {
      CM: { name: 'Command Module “Columbia”', dry: 5557, prop: 0, heat: { diam: 3.91, LD: 0.3, cd: 1.3, rn: 4.7, chutes: 'apollo' } },
      SM: { name: 'Service Module', dry: 4831, prop: 18413, engine: { name: 'SPS (AJ10-137)', thrust: 91190, isp: 314, prop: 'hypergolic' } },
      LMDS: { name: 'LM Descent Stage', dry: 2034, prop: 8248, engine: { name: 'DPS (LMDE)', thrust: 45040, isp: 311, prop: 'hypergolic', minThr: 0.1 } },
      LMAS: { name: 'LM Ascent Stage “Eagle”', dry: 2416, prop: 2353, engine: { name: 'APS', thrust: 15570, isp: 311, prop: 'hypergolic' } },
      SLA: { name: 'Spacecraft–LM Adapter panels', dry: 1800, prop: 0 },
    },
    orbiter: ['CM', 'SM'], lander: ['LMDS', 'LMAS'], ascender: ['LMAS'], adapter: ['SLA'], prop: { orbiter: 'SM', lander: 'LMDS', ascender: 'LMAS' },
    capsule: 'CM', model: 'apollo',
  },
  apolloCSMLTA: {
    name: 'Apollo CSM + LTA-B test mass', crewMax: 3,
    modules: {
      CM: { name: 'Command Module', dry: 5621, prop: 0, heat: { diam: 3.91, LD: 0.3, cd: 1.3, rn: 4.7, chutes: 'apollo' } },
      SM: { name: 'Service Module', dry: 4901, prop: 18413, engine: { name: 'SPS (AJ10-137)', thrust: 91190, isp: 314, prop: 'hypergolic' } },
      LTA: { name: 'LM Test Article B (ballast)', dry: 9026, prop: 0 },
      SLA: { name: 'Spacecraft–LM Adapter panels', dry: 1800, prop: 0 },
    },
    orbiter: ['CM', 'SM'], lander: null, adapter: ['SLA', 'LTA'], prop: { orbiter: 'SM' }, capsule: 'CM', model: 'apolloCSM',
  },
  orion: {
    name: 'Orion (CM + European Service Module)', crewMax: 4,
    modules: {
      CM: { name: 'Orion Crew Module “Integrity”', dry: 9520, prop: 0, heat: { diam: 5.02, LD: 0.27, cd: 1.3, rn: 6.0, chutes: 'orion' } },
      ESM: { name: 'European Service Module', dry: 6858, prop: 8600, engine: { name: 'OMS-E (AJ10-190)', thrust: 26600, isp: 316, prop: 'mmh' } },
    },
    orbiter: ['CM', 'ESM'], lander: null, prop: { orbiter: 'ESM' }, capsule: 'CM', model: 'orion',
  },
  change5: {
    name: 'Chang’e 5 (orbiter + returner + lander + ascender)', crewMax: 0,
    modules: {
      RET: { name: 'Returner capsule', dry: 300, prop: 0, heat: { diam: 1.25, LD: 0.25, cd: 1.3, rn: 1.2, chutes: 'probe' } },
      ORB: { name: 'Orbiter', dry: 1250, prop: 2750, engine: { name: '3000 N main engine', thrust: 3000, isp: 315, prop: 'mmh' } },
      LDR: { name: 'Lander', dry: 900, prop: 2300, engine: { name: '7500 N variable-thrust engine', thrust: 7500, isp: 310, prop: 'mmh', minThr: 0.2 } },
      ASC: { name: 'Ascender', dry: 330, prop: 370, engine: { name: '3000 N ascent engine', thrust: 3000, isp: 310, prop: 'mmh' } },
    },
    orbiter: ['RET', 'ORB'], lander: ['LDR', 'ASC'], ascender: ['ASC'], prop: { orbiter: 'ORB', lander: 'LDR', ascender: 'ASC' }, capsule: 'RET', model: 'change5',
  },
  mariner4: {
    name: 'Mariner 4', crewMax: 0,
    modules: { BUS: { name: 'Mariner 4 spacecraft', dry: 255, prop: 6, engine: { name: '222 N midcourse motor', thrust: 222, isp: 230, prop: 'hydrazine' } } },
    orbiter: ['BUS'], lander: null, prop: { orbiter: 'BUS' }, model: 'mariner',
  },
  perseverance: {
    name: 'Mars 2020: cruise stage + aeroshell + descent stage + Perseverance', crewMax: 0,
    modules: {
      CRUISE: { name: 'Cruise stage', dry: 469, prop: 70, engine: { name: '8 × MR-111 thrusters', thrust: 35, isp: 220, prop: 'hydrazine' } },
      AEROSHELL: { name: 'Heat shield + backshell + parachute', dry: 1425, prop: 0 },
      DS: { name: 'Descent stage (sky crane)', dry: 670, prop: 400, engine: { name: '8 × MLE (Mars Landing Engines)', thrust: 8 * 3060, isp: 220, prop: 'hydrazine', minThr: 0.08 } },
      ROVER: { name: 'Perseverance rover + Ingenuity', dry: 1027, prop: 0 },
    },
    orbiter: ['CRUISE'], entry: ['AEROSHELL', 'DS', 'ROVER'], prop: { orbiter: 'CRUISE', lander: 'DS' },
    // sky crane (Perseverance's landing press kit): from 20 m up the descent stage lets the rover down on 6.4 m bridles and
    // stands hang = 8.1 m above the ground when its wheels touch (the bridle device 0.6 m under the stage, the bridles, the
    // rover's deck 1.13 m above its wheels: app/33_mars2020.js); then it flies off and comes down about 650 m away. Just
    // after it drops from the backshell it flies sideways, clear of the backshell and parachute coming down behind it
    edl: { diam: 4.5, LD: 0.24, cd: 1.65, rn: 1.125, chute: { diam: 21.5, cd: 0.6, mach: 1.75 }, heatshieldSepMach: 0.8, backshellSepAlt: 2.1, skycrane: true, hang: 8.1, skyAlt: 20, bridle: 6.4, flyaway: 650, divert: [30, 15] },
    model: 'msl',
  },
  tianwen1: {
    name: 'Tianwen-1 (orbiter + entry capsule with Zhurong)', crewMax: 0,
    modules: {
      ORB: { name: 'Orbiter', dry: 1265, prop: 2450, engine: { name: '3000 N main engine', thrust: 3000, isp: 315, prop: 'mmh' } },
      CAPS: { name: 'Entry capsule (heat shield + backshell)', dry: 450, prop: 0 },
      LDR: { name: 'Lander', dry: 330, prop: 265, engine: { name: '7500 N variable-thrust engine', thrust: 7500, isp: 300, prop: 'mmh', minThr: 0.2 } },
      ROVER: { name: 'Zhurong rover', dry: 240, prop: 0 },
    },
    orbiter: ['ORB'], entry: ['CAPS', 'LDR', 'ROVER'], prop: { orbiter: 'ORB', lander: 'LDR' },
    edl: { diam: 3.4, LD: 0.2, cd: 1.6, rn: 1.0, chute: { diam: 16, cd: 0.6, mach: 1.8 }, heatshieldSepMach: 0.8, backshellSepAlt: 1.5, skycrane: false, trimWing: true, divert: [25, 12] },
    model: 'tianwen',
  },
  europaClipper: {
    name: 'Europa Clipper', crewMax: 0,
    modules: { SC: { name: 'Europa Clipper spacecraft', dry: 3315, prop: 2750, engine: { name: '16 × 27.5 N + main thrusters', thrust: 16 * 27.5, isp: 225, prop: 'mmh' } } },
    orbiter: ['SC'], lander: null, prop: { orbiter: 'SC' }, model: 'clipper',
  },
  jwst: {
    name: 'James Webb Space Telescope', crewMax: 0,
    modules: { OBS: { name: 'Observatory', dry: 5861, prop: 300, engine: { name: 'SCAT (4 × 22 N)', thrust: 88, isp: 295, prop: 'mmh' } } }, // hydrazine for attitude, MMH/NTO for the corrections
    orbiter: ['OBS'], lander: null, prop: { orbiter: 'OBS' }, model: 'jwst',
  },
  starshipCrew: {
    name: 'Starship (crewed Mars configuration)', crewMax: 12,
    modules: { CARGO: { name: 'Crew habitat + cargo', dry: 100000, prop: 0 } },
    orbiter: ['CARGO'], lander: null, usesUpperStage: true, prop: {}, model: 'starshipPayload',
    edl: { diam: 9, LD: 0.25, cd: 1.1, rn: 4.5, propulsive: true },
  },
  msrConcept: {
    name: 'Sample-return stack (orbiter/returner + lander/ascent vehicle)', crewMax: 0,
    modules: {
      RET: { name: 'Earth entry capsule', dry: 110, prop: 0, heat: { diam: 1.25, LD: 0, cd: 1.2, rn: 0.6, chutes: 'none' } },
      ORB: { name: 'Orbiter / Earth-return vehicle', dry: 1400, prop: 6200, engine: { name: '3000 N main engine', thrust: 3000, isp: 318, prop: 'mmh' } },
      CAPS: { name: 'Entry aeroshell', dry: 700, prop: 0 },
      LDR: { name: 'Lander', dry: 650, prop: 500, engine: { name: '7500 N variable-thrust engine', thrust: 7500, isp: 300, prop: 'mmh', minThr: 0.2 } },
      MAV: { name: 'Mars Ascent Vehicle (2-stage, modelled as 1)', dry: 100, prop: 470, engine: { name: 'Solid rocket motors', thrust: 9000, isp: 292, prop: 'solid' } },
    },
    orbiter: ['RET', 'ORB'], entry: ['CAPS', 'LDR', 'MAV'], ascender: ['MAV'], prop: { orbiter: 'ORB', lander: 'LDR', ascender: 'MAV' }, capsule: 'RET', orbiterStays: true,
    edl: { diam: 4.0, LD: 0.22, cd: 1.6, rn: 1.0, chute: { diam: 18, cd: 0.6, mach: 1.8 }, heatshieldSepMach: 0.8, backshellSepAlt: 1.8, skycrane: false },
    model: 'msr',
  },
  inspirationMars: {
    name: 'Crew capsule + inflatable habitat (Inspiration Mars concept)', crewMax: 2,
    modules: {
      CAP: { name: 'Crew capsule (Dragon-class)', dry: 5000, prop: 0, heat: { diam: 3.7, LD: 0.25, cd: 1.3, rn: 4.0, chutes: 'orion' } },
      HAB: { name: 'Inflatable habitat + 501 days of consumables', dry: 3500, prop: 0 },
      PROP: { name: 'Service module', dry: 800, prop: 700, engine: { name: 'Service module engine', thrust: 30000, isp: 320, prop: 'mmh' } },
    },
    orbiter: ['CAP', 'HAB', 'PROP'], lander: null, prop: { orbiter: 'PROP' }, capsule: 'CAP', model: 'capsuleHab',
  },
  // Space Shuttle orbiter. ORB: empty orbiter with its three RS-25s (≈ 79 t), plus crew, consumables and RCS
  // propellant; scenarios override it per vehicle and flight. OMS: two AJ10-190 engines, 6,000 lbf each, Isp 313 s.
  shuttle: {
    name: 'Space Shuttle orbiter', crewMax: 8,
    modules: {
      ORB: { name: 'Orbiter (with 3 × RS-25, crew, consumables, RCS)', dry: 84000, prop: 0 },
      OMS: { name: 'Orbital Maneuvering System (two pods)', dry: 0, prop: 10800, engine: { name: '2 × OMS (AJ10-190)', thrust: 2 * 26690, isp: 313, prop: 'mmh' } },
      PAY: { name: 'Payload in the bay', dry: 0, prop: 0 },
    },
    orbiter: ['ORB', 'OMS', 'PAY'], lander: null, prop: { orbiter: 'OMS' }, model: 'shuttle',
    winged: { S: 249.9, rn: 1.0, span: 23.79, len: 37.24 },
  },
  chandrayaan3: {
    name: 'Chandrayaan-3 (propulsion module + Vikram lander + Pragyan)', crewMax: 0,
    modules: {
      PM: { name: 'Propulsion module', dry: 448, prop: 1696, engine: { name: '440 N LAM', thrust: 440, isp: 315, prop: 'mmh' } },
      LDR: { name: 'Vikram lander + Pragyan rover', dry: 620, prop: 1132, engine: { name: '4 × 800 N throttleable engines', thrust: 3200, isp: 305, prop: 'mmh', minThr: 0.3 } },
    },
    orbiter: ['PM'], lander: ['LDR'], prop: { orbiter: 'PM', lander: 'LDR' }, model: 'chandrayaan',
  },
};
function scMass(sc, ids) { if (!ids) return 0; let m = 0; for (const id of ids) { const md = sc.modules[id]; if (md) m += md.dry + md.prop; } return m; }
function scTotalMass(sc) { let m = 0; for (const k in sc.modules) m += sc.modules[k].dry + sc.modules[k].prop; return m; }
