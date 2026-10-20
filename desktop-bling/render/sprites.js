// Original 8-bit sprites, drawn as text grids. Every sprite faces right;
// the renderer mirrors it for left-facing entities. '.' is transparent.
// build() adds a dark 1px outline so characters read on any wallpaper.
// Colours may carry alpha as #rrggbbaa.

const OUTLINE = '#0b0b10d0';

const CHIEF_PAL = {
    G: '#2c5a2a', g: '#4b8636', h: '#7fb94c',
    O: '#ffc23a', Y: '#fff2a8', o: '#b0701a',
    D: '#3a3a44', K: '#18181c', W: '#5e5e68', w: '#a6a6b2', c: '#63f0ff', n: '#35502a',
};

const GRUNT_PAL = {
    T: '#24668a', t: '#52b8dc', O: '#e2771f', o: '#99480f', Q: '#ffa24a',
    S: '#8e8e7c', s: '#5e5e50', m: '#3fd0e8', M: '#1d7f94', P: '#7cff5a', p: '#3a9a2a',
};

const JACKAL_PAL = {
    J: '#caa262', j: '#8a6838', A: '#644596', a: '#9c7cd0',
    E: '#fff04a', P: '#7cff5a', p: '#3a9a2a',
};

const ELITE_PALS = {
    minor: {A: '#3a4ba6', a: '#7888e2'},
    major: {A: '#962222', a: '#e05858'},
    zealot: {A: '#a68014', a: '#f2d250'},
};
const ELITE_BODY = {S: '#6e6e62', s: '#45453c', M: '#9a8a74', m: '#6a5c4c', E: '#ffcc33', K: '#18181c'};

const WEAPON_PAL = {R: '#b8c0d8', r: '#646a8c', c: '#a8f8ff', C: '#3ac8ff', P: '#7cff5a'};
const POD_PAL = {W: '#565a62', w: '#9aa0aa', O: '#e2771f', K: '#18181c', D: '#2a2a30'};

function build(rows, pal, ax, outline = true) {
    let h = rows.length;
    let w = Math.max(...rows.map(r => r.length));
    let grid = rows.map(r => r.padEnd(w, '.'));
    const lines = new Set();
    if (outline) {
        const at = (x, y) => y >= 0 && y < h && x >= 0 && x < w && grid[y][x] !== '.';
        const out = [];
        for (let y = -1; y <= h; y++) {
            let line = '';
            for (let x = -1; x <= w; x++) {
                if (at(x, y))
                    line += grid[y][x];
                else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))
                    line += '#';
                else
                    line += '.';
            }
            out.push(line);
        }
        grid = out;
        w += 2;
        h += 2;
        ax += 1;
        pal = {...pal, '#': OUTLINE};
        lines.add(OUTLINE);
    }
    const groups = new Map();
    grid.forEach((row, y) => {
        let x = 0;
        while (x < row.length) {
            const ch = row[x];
            if (ch === '.') {
                x++;
                continue;
            }
            let len = 1;
            while (row[x + len] === ch)
                len++;
            const hex = pal[ch];
            if (!hex)
                throw new Error(`sprite colour '${ch}' missing from palette`);
            if (!groups.has(hex))
                groups.set(hex, []);
            groups.get(hex).push([x, y, len]);
            x += len;
        }
    });
    return {
        w, h, ax,
        // Rows below the feet (the outline), so feet still rest on the ground.
        base: outline ? 1 : 0,
        groups: [...groups].map(([hex, rects]) => ({hex, rects, outline: lines.has(hex)})),
    };
}

// Knocked flat on its back: rotate so the head ends up behind (left).
function fallen(rows) {
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const out = [];
    for (let y = 0; y < w; y++) {
        let line = '';
        for (let x = 0; x < h; x++)
            line += rows[x][w - 1 - y] ?? '.';
        out.push(line);
    }
    const empty = r => /^\.*$/.test(r);
    while (out.length && empty(out[0]))
        out.shift();
    while (out.length && empty(out[out.length - 1]))
        out.pop();
    return out;
}

// ---- Master Chief: 13x18 chunky little Spartan, built from top + legs ----
const HELMET = [
    '....GGGGG....',
    '...GghhhgG...',
    '..GghhgggGG..',
    '..GgOOOOOOG..',
    '..GgOYYOOoo..',
    '..GgoOOOooG..',
    '..GGGggggGG..',
];
// Tops are drawn empty-handed; weapons are overlaid at the hands (CHIEF_HANDS).
const CHIEF_TOPS = {
    aim: [
        ...HELMET,
        '.GhhGGGGGhhG.',
        'GhggGDDDGgggG',
        'GgGDghhgDGgg.',
        'GgGDgggDDGg..',
        '.GgDDgDD.....',
        '..DDKKKDD....',
    ],
    throw: [
        '....GGGGG....',
        '...GghhhgG...',
        'nnGghhgggGG..',
        'ggGgOOOOOOG..',
        'GgGgOYYOOoo..',
        '.GGgoOOOooG..',
        '.GGGGggggGG..',
        '.GhhGGGGGhhG.',
        'GhggGDDDGgggG',
        'GgGDghhgDgG..',
        'GgGDgggDDg...',
        '.GgDDgDD.....',
        '..DDKKKDD....',
    ],
    victory: [
        '....GGGGG..g.',
        '...GghhhgGgG.',
        '..GghhgggGGG.',
        '..GgOOOOOOGg.',
        '..GgOYYOOoGG.',
        '..GgoOOOooG..',
        '..GGGggggGG..',
        '.GhhGGGGGhG..',
        'GhggGDDDGg...',
        'GgGDghhgD....',
        'GgGDgggDD....',
        '.GgDDggDD....',
        '..DDKKKDD....',
    ],
    melee: [
        ...HELMET,
        '..GhhGGGGGhhG',
        '.GhggGDDDGgGG',
        '.GgGDghhgDGgG',
        '.GgGDgggDGg..',
        '..GgDDgDD....',
        '..DDKKKDD....',
    ],
    reload: [
        ...HELMET,
        '.GhhGGGGGhhG.',
        'GhggGDDDGgG..',
        'GgGDghhgDgG..',
        'GgGDgggDGg...',
        '.GgDDggDD....',
        '..DDKKKDD....',
    ],
};

// Where each pose holds its weapon: grip offset from the Chief's anchor (dx)
// and altitude (y) with standing legs; behind = drawn behind the body.
export const CHIEF_HANDS = {
    aim: {dx: 2.5, y: 6, behind: false},
    melee: {dx: 4, y: 7, behind: false},
    reload: {dx: 1.5, y: 5, behind: false},
    throw: {dx: 1, y: 5, behind: false},
    victory: {dx: -3.5, y: 5, behind: true},
};

// Chief's weapons, drawn pointing right with the grip row at the bottom
// (gy rows up for the sword); ax is the grip column.
const GUN_PAL = {W: '#4e4e58', w: '#a6a6b2', K: '#18181c', c: '#63f0ff', b: '#6a4a2a'};
export const CHIEF_WEAPONS = {
    ar: {spr: build(['...wccw.', 'WWWWWWWw', '..KW....'], GUN_PAL, 2.5), gy: 0},
    br: {spr: build(['..KKK....', 'WWWWWWWWw', '..KW.....'], GUN_PAL, 2.5), gy: 0},
    shotgun: {spr: build(['.WWWWWWw', 'WWbbW...', '..K.....'], GUN_PAL, 2.5), gy: 0},
    sniper: {spr: build(['...KKK.....', 'WWWWWWWWWWw', '..KW.......'], GUN_PAL, 2.5), gy: 0},
    plasma: {spr: build(['.RRRRc', 'rRRRR.', '.r....'], WEAPON_PAL, 1.5), gy: 0},
    sword: {spr: build(['....cC..', 'rrCCCCCc', '....cC..'], WEAPON_PAL, 1), gy: 1},
};
export const CHIEF_SWORD_SLASH = build(['.....cc', '....cC.', '...cC..', '..cC...', 'rrC....'], WEAPON_PAL, 1);

const CHIEF_LEGS = {
    stand: ['..GgG..GgG...', '..Ggg..Ggg...', '..GgG..GgG...', '..gGG..gGG...', '..KKKK.KKKK..'],
    run1: ['..GgG.GgG....', '.GgG...GgG...', '.Ggg....GgG..', 'GgG......gGG.', 'KKK.......KKK'],
    run2: ['...GgGgG.....', '...GgGGg.....', '...GgG.gG....', '...gGG.KK....', '...KKKK......'],
    run3: ['..GgG.GgG....', '..GgG..GgG...', '.gGG....Ggg..', '.GgG.....gGG.', 'KKK......KKK.'],
    run4: ['...GgGgG.....', '...gGGgG.....', '..gG.GgG.....', '..KK.gGG.....', '.....KKKK....'],
    rise: ['..GgGGgG.....', '.GgG..GgG....', '.KKK...KKK...'],
    fall: ['..GgG..GgG...', '.Ggg...Ggg...', '.GgG...GgG...', 'KKKK..KKKK...'],
    crouch: ['.GgG...GgG...', '.gGG...gGG...', '.KKKK..KKKK..'],
};
const RUN = ['run1', 'run2', 'run3', 'run4'];

// CHIEF[top][legs] -> sprite; every pose works with every leg frame.
export const CHIEF = {};
for (const [top, rows] of Object.entries(CHIEF_TOPS)) {
    CHIEF[top] = {};
    for (const [legs, legRows] of Object.entries(CHIEF_LEGS))
        CHIEF[top][legs] = build([...rows, ...legRows], CHIEF_PAL, 5.5);
    CHIEF[top].run = RUN.map(l => CHIEF[top][l]);
}

// ---- Grunt: 10x12, methane tank on its back ----
const GRUNT_TOP = [
    '.TTt......',
    'TttTt.....',
    'TttTtss...',
    'TttTsSSs..',
    'TttOOSSSm.',
    'TtOQoOSmmM',
    '.OOoOOOSS.',
    '.OOOoOOSPp',
    '..OOOOO.pP',
];
const GRUNT_PANIC_TOP = [
    '.TTt..S..S',
    'TttTt.S..S',
    'TttTtsSsS.',
    'TttTsSSs..',
    'TttOOSSSm.',
    'TtOQoOSmmM',
    '.OOoOOOS..',
    '.OOOoOOO..',
    '..OOOOO...',
];
const GRUNT_LEGS = [
    ['..sS..sS..', '..S....S..', '.SS...SS..'],
    ['...sSsS...', '....SS....', '...SSS....'],
];
export const GRUNT = {
    walk: GRUNT_LEGS.map(l => build([...GRUNT_TOP, ...l], GRUNT_PAL, 5)),
    panic: GRUNT_LEGS.map(l => build([...GRUNT_PANIC_TOP, ...l], GRUNT_PAL, 5)),
    dead: build(fallen([...GRUNT_TOP, ...GRUNT_LEGS[0]]), GRUNT_PAL, 6),
};

// ---- Jackal: 10x15, bird-like, energy shield drawn separately ----
const JACKAL_TOP = [
    '..jj......',
    '.jJJj.....',
    '..JJJJJ...',
    '...JJEJJJ.',
    '....JJJj..',
    '....JJ....',
    '...aAA....',
    '..aAAAA...',
    '..AaAAJJP.',
    '...AAA..p.',
    '...JjJ....',
];
const JACKAL_LEGS = [
    ['...J..J...', '..J....J..', '..j...j...', '.JJ...JJ..'],
    ['....JJ....', '....J.J...', '...j..j...', '..JJ.JJ...'],
];
export const JACKAL = {
    walk: JACKAL_LEGS.map(l => build([...JACKAL_TOP, ...l], JACKAL_PAL, 5)),
    dead: build(fallen([...JACKAL_TOP, ...JACKAL_LEGS[0]]), JACKAL_PAL, 7),
};

// ---- Elite: 12x21, tall and hunched, armour colour by rank ----
const ELITE_TOP = [
    '....aAAA....',
    '...aAAAAA...',
    '...AAAAAsSs.',
    '....AAsSSES.',
    '.....sSMMMm.',
    '......SMM...',
    '...aAAAs....',
    '..aAAaAAA...',
    '.aAAaaaAAA..',
    '.AAaAAAAaA..',
    '.AA.AaaA.SS.',
    '.AS.AAAA.S..',
    '....AAAA....',
    '....sSSs....',
];
const ELITE_LEGS = [
    ['....AA.AA...', '...AA...AA..', '...AA....A..', '...SS....SS.', '..SS....SS..', '..SS.....SS.', '.KKK....KKK.'],
    ['....AAAA....', '.....AAA....', '.....AA.....', '.....SS.S...', '....SS..SS..', '....SS.SS...', '...KKK.KKK..'],
];
function eliteFrames(variant) {
    const pal = {...ELITE_BODY, ...ELITE_PALS[variant]};
    return {
        walk: ELITE_LEGS.map(l => build([...ELITE_TOP, ...l], pal, 5.5)),
        dead: build(fallen([...ELITE_TOP, ...ELITE_LEGS[0]]), pal, 10),
    };
}
export const ELITE = {
    minor: eliteFrames('minor'),
    major: eliteFrames('major'),
    zealot: eliteFrames('zealot'),
};

// Weapon overlays, positioned at the Elite's hand.
export const ELITE_RIFLE = build(['rRRRRP', '.rr.R.'], WEAPON_PAL, 0);
export const ELITE_SWORD = build(['....cC..', 'rrCCCCCc', '....cC..'], WEAPON_PAL, 0);
export const ELITE_SWORD_SLASH = build(['.....cc', '....cC.', '...cC..', '..cC...', 'rrC....'], WEAPON_PAL, 0);

// ---- Drop pod ----
const POD_ROWS = [
    '...WWW...',
    '..WwwwW..',
    '.WwwwwwW.',
    'WwwOOOwwW',
    'WwwwwwwwW',
    'WwKKKKwwW',
    'WwKwwKwwW',
    'WwKwwKwwW',
    'WwKKKKwwW',
    'WwwwwwwwW',
    'WwwOOOwwW',
    'WWwwwwwWW',
    '.WWWWWWW.',
    '..KKKKK..',
];
export const POD = {
    closed: build(POD_ROWS, POD_PAL, 4.5),
    open: build(POD_ROWS.map((r, i) => i >= 5 && i <= 8 ? r.slice(0, 2) + 'DDDD' + r.slice(6) : r), POD_PAL, 4.5),
};

// ---- Explosion disks and shockwave rings (white masks, tinted when drawn) ----
function disk(r) {
    const rows = [];
    for (let dy = -r; dy <= r; dy++) {
        const half = Math.round(Math.sqrt(r * r - dy * dy));
        rows.push('.'.repeat(r - half) + 'x'.repeat(half * 2) + '.'.repeat(r - half));
    }
    return build(rows, {x: '#ffffff'}, r, false);
}
function ring(r) {
    const rows = [];
    for (let y = 0; y <= 2 * r; y++) {
        let line = '';
        for (let x = 0; x <= 2 * r; x++) {
            const d = Math.hypot(x - r, y - r);
            line += d <= r + 0.5 && d > r - 0.9 ? 'x' : '.';
        }
        rows.push(line);
    }
    return build(rows, {x: '#ffffff'}, r + 0.5, false);
}
export const DISKS = Array.from({length: 17}, (_, r) => disk(r));
export const RINGS = Array.from({length: 25}, (_, r) => ring(r));

// ---- Projectiles: one texture each, so every shot is a single actor ----
// Drawn moving right; the anchor sits on the bolt's head.
export const TRACER = build(['ttttHH'], {t: '#ffcf5a73', H: '#fff6c8'}, 5, false);
function bolt(glow, core) {
    return build(['...bb.gWWg', 'aa.bb.gggg'], {a: `${glow}26`, b: `${glow}59`, g: `${glow}a6`, W: core}, 8, false);
}
export const PLASMA = {plasma: bolt('#5aff3a', '#e0ffc0'), 'plasma-blue': bolt('#3ab0ff', '#e0f6ff')};
export const PELLET = build(['tH'], {t: '#ffcf5a80', H: '#fff6c8'}, 1.5, false);
export const SNIPER_TRACER = build(['ssssttttHHH'], {s: '#9fe8ff33', t: '#c8f4ff80', H: '#ffffff'}, 10, false);
export const FUELROD = build(['..gGGg.', '.gGWWGg', '..gGGg.'], {g: '#7aff4a59', G: '#7aff4aa6', W: '#eaffd0'}, 5, false);

// ---- Hunter: 16x22 hulking armoured tank, shield plate in front ----
const HUNTER_PAL = {
    B: '#26365a', b: '#4f6f9a', O: '#ffa030', o: '#c06a18',
    S: '#a0aabb', s: '#5e6878', G: '#7aff4a', K: '#18181c',
};
const HUNTER_TOP = [
    '...b.b.b........',
    '..bBbBbBb.......',
    '.bBBBBBBBb......',
    '.BBbBBBBBBb.....',
    'BBBBBBBBBBBb.SS.',
    'BBOBBBBBBBBBSsSS',
    'BBOBBBBbBBBBSsSS',
    'BBOoBBBbBOBBSsSS',
    '.BOBBBBBBBBBSsSS',
    '.BBOBBBBBBBGSsSS',
    '..BBOBBBBBGGSsSS',
    '..BBBOBBBBBBSsSS',
    '...BBBBBBBB.SsSS',
    '...BBBBBBBB.SsS.',
    '...BBB..BBB..S..',
];
const HUNTER_LEGS = [
    ['...BBB..BBB.....', '..BBB....BBB....', '..BBo....oBB....', '..BB......BB....', '.BBB......BBB...', '.BBB......BBB...', 'KKKK.....KKKK...'],
    ['....BBBBBB......', '....BBB.BBB.....', '....BBo.oBB.....', '....BB...BB.....', '...BBB...BBB....', '...BBB..BBB.....', '..KKKK.KKKK.....'],
];
export const HUNTER = {
    walk: HUNTER_LEGS.map(l => build([...HUNTER_TOP, ...l], HUNTER_PAL, 7)),
    dead: build(fallen([...HUNTER_TOP, ...HUNTER_LEGS[0]]), HUNTER_PAL, 11),
};

// Jackal marksman's beam rifle, overlaid at its hand.
export const BEAM_RIFLE = build(['rRRRRRRRc', '.r.r.....'], WEAPON_PAL, 0);

// ---- Dropships ----
export const SPIRIT = build([
    '..........pppppp..................',
    '.......ppPPPPPPPPpp...............',
    '...ppPPPPPPPPPPPPPPPPpppp.........',
    'pPPPPPPPPLPPPPPPPPPPPPPPPPPPPpp...',
    '.PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPp',
    '..pPPPP................PPPPPPPPp..',
    '...pPPP..................pPPPp....',
    '....pPL...................pPL.....',
], {P: '#5a2a7a', p: '#8a5ab0', L: '#e0a8ff'}, 17);
export const PELICAN = build([
    '.....GGG..........................',
    '....GGGGgggggggggggggggggggg......',
    '...GGGGGGGGGGGGGGGGGGGGGGGGGGgg...',
    '..GGGGGGGGGGGGGGGGGGGGGGGGGGGGGcc.',
    '.GGGGdddddGGGGGGGGGGGGGGGGGGGGGGcc',
    '..GGGdddddGGGGGGGGGGGGGGGGGGGGGGG.',
    '...EEGGGGGGGGGGGGGGGGGGGGGGEE.....',
    '....e......................e......',
], {G: '#56663a', g: '#8a9a5a', d: '#262a1e', c: '#9fd8ff', E: '#44444c', e: '#ffb040'}, 17);
