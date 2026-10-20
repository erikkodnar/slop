// Turns a World into draw calls. Backend-agnostic: anything with
// rect()/sprite()/row()/offset() can paint it — CairoPainter (below) for the
// preview tools, ActorPainter (actors.js) inside GNOME Shell.
// Positions are in art pixels but may be fractional; painters snap them to
// whole *screen* pixels, so motion is smooth while sprites stay crisp.
// Hot path: no per-frame allocations (positional args, no option objects).
import {
    CHIEF, CHIEF_HANDS, CHIEF_WEAPONS, CHIEF_SWORD_SLASH, GRUNT, JACKAL, ELITE, HUNTER,
    ELITE_RIFLE, ELITE_SWORD, ELITE_SWORD_SLASH, BEAM_RIFLE, POD, SPIRIT, PELICAN,
    DISKS, RINGS, TRACER, PELLET, SNIPER_TRACER, PLASMA, FUELROD,
} from './sprites.js';
import {WEAPONS} from '../engine/weapons.js';

// How far the torso sits below standing height for each leg pose.
const LEG_DROP = {stand: 0, run: 0, rise: 2, fall: 1, crouch: 2};

const rgbaCache = new Map();
// '#rrggbb' or '#rrggbbaa' -> [r, g, b, a] in 0..1
export function rgba(hex) {
    let c = rgbaCache.get(hex);
    if (!c) {
        const n = parseInt(hex.slice(1, 7), 16);
        const a = hex.length > 7 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
        c = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, a];
        rgbaCache.set(hex, c);
    }
    return c;
}

// Left edge (art px, fractional) of a sprite drawn with its anchor at x.
export function spriteLeft(spr, x, facing, dx) {
    return facing < 0 ? x - (spr.w - spr.ax) - dx : x - spr.ax + dx;
}

// Top edge (art px, fractional) of a sprite whose feet are at altitude y.
export function spriteTop(spr, H, y, dy) {
    return H - y - spr.h + spr.base - dy;
}

export class CairoPainter {
    constructor(scale, H) {
        this.s = scale;
        this.H = H;
        this.cr = null;
        this.ox = 0;
        this.oy = 0;
    }

    begin(cr) {
        this.cr = cr;
    }

    end() {
        this.cr = null;
    }

    offset(ox, oy) {
        this.ox = ox;
        this.oy = oy;
    }

    row(y) {
        return this.H - y;
    }

    rect(x, y, w, h, hex, a) {
        const s = this.s, c = rgba(hex);
        this.cr.setSourceRGBA(c[0], c[1], c[2], c[3] * a);
        this.cr.rectangle(Math.round((x + this.ox) * s), Math.round((y + this.oy) * s), w * s, h * s);
        this.cr.fill();
    }

    sprite(spr, x, y, facing, alpha, tint, dx, dy) {
        const {cr, s} = this;
        const flip = facing < 0;
        const left = Math.round((spriteLeft(spr, x, facing, dx) + this.ox) * s);
        const top = Math.round((spriteTop(spr, this.H, y, dy) + this.oy) * s);
        for (const g of spr.groups) {
            const c = rgba(tint && !g.outline ? tint : g.hex);
            cr.setSourceRGBA(c[0], c[1], c[2], c[3] * alpha);
            for (const [rx, ry, len] of g.rects) {
                const px = flip ? spr.w - rx - len : rx;
                cr.rectangle(left + px * s, top + ry * s, len * s, s);
            }
            cr.fill();
        }
    }
}

function frame(frames, t, fps) {
    return frames[Math.floor(t * fps) % frames.length];
}

// Soft contact shadow on the dock edge; shrinks and fades with altitude.
function shadow(p, x, y, w) {
    const k = Math.min(Math.max(y, 0), 24) / 24;
    const sw = Math.max(2, Math.round(w * (1 - 0.6 * k)));
    p.rect(x - sw / 2, p.H - 1, sw, 1, '#000000', 0.32 * (1 - 0.7 * k));
}

// Shield flare: the silhouette in a glow colour, nudged out on all sides.
function flare(p, spr, x, y, facing, a, hex) {
    p.sprite(spr, x, y, facing, a, hex, 1, 0);
    p.sprite(spr, x, y, facing, a, hex, -1, 0);
    p.sprite(spr, x, y, facing, a, hex, 0, 1);
    p.sprite(spr, x, y, facing, a, hex, 0, -1);
}

function drawChiefWeapon(p, c, hand, drop, dx, dy, tint) {
    const f = c.facing;
    const wpn = c.weapon === 'sword' && c.slashT > 0
        ? {spr: CHIEF_SWORD_SLASH, gy: 0}
        : CHIEF_WEAPONS[c.weapon];
    const a = c.weapon === 'sword' ? 0.85 + 0.15 * Math.sin(c.anim * 25) : 1;
    p.sprite(wpn.spr, c.x + f * (hand.dx + dx), c.y + hand.y - drop - wpn.gy + dy, f, a, tint, 0, 0);
}

function drawChief(p, c) {
    if (!c.visible)
        return;
    const pose = c.top;
    const top = CHIEF[pose];
    const legs = c.legs;
    const spr = legs === 'run' ? top.run[c.runFrame] : top[legs];
    const hand = CHIEF_HANDS[pose];
    const drop = LEG_DROP[legs];
    // Bob up on the passing frames of the run cycle; kick back on recoil.
    const dy = legs === 'run' && c.runFrame % 2 === 1 ? 0.5 : 0;
    const dx = c.recoil > 0 ? -0.5 * (1 + (WEAPONS[c.weapon].recoil ?? 0)) : 0;

    if (c.flare > 0)
        flare(p, spr, c.x, c.y, c.facing, (c.flare / 0.4) * (0.55 + 0.25 * Math.sin(c.anim * 50)), '#ffd84a');
    const tint = c.flash > 0 && Math.floor(c.anim * 30) % 2 === 0 ? '#fff3a0' : null;
    if (hand.behind)
        drawChiefWeapon(p, c, hand, drop, dx, dy, tint);
    p.sprite(spr, c.x, c.y, c.facing, 1, tint, dx, dy);
    if (!hand.behind)
        drawChiefWeapon(p, c, hand, drop, dx, dy, tint);

    const cfg = WEAPONS[c.weapon];
    if (c.muzzle > 0 && cfg.muzzle) {
        const f = c.facing;
        const big = c.weapon === 'sniper' || c.weapon === 'shotgun';
        const mx = c.x + f * (cfg.muzzle[0] + dx);
        const my = p.row(c.y + cfg.muzzle[1] - drop + dy);
        const fire = c.weapon === 'plasma' ? '#7fd8ff' : '#ffb020';
        if (big) {
            p.rect(f > 0 ? mx : mx - 5, my - 1.5, 5, 3, fire, 1);
            p.rect(f > 0 ? mx + 1 : mx - 3, my - 2.5, 2, 5, fire, 0.7);
            p.rect(f > 0 ? mx : mx - 3, my - 0.5, 3, 1, '#ffffff', 1);
        } else if (Math.floor(c.anim * 60) % 2) {
            p.rect(f > 0 ? mx : mx - 3, my - 1.5, 3, 3, fire, 1);
            p.rect(f > 0 ? mx : mx - 2, my - 0.5, 2, 1, '#fff8c0', 1);
        } else {
            p.rect(f > 0 ? mx : mx - 4, my - 0.5, 4, 1, fire, 1);
            p.rect(f > 0 ? mx + 1 : mx - 2, my - 1.5, 1, 3, fire, 0.9);
            p.rect(f > 0 ? mx : mx - 1, my - 0.5, 1, 1, '#ffffff', 1);
        }
    }

    if (c.shield < 0.99) {
        const y = p.row(c.y) - c.h - 4;
        const left = c.x - 6;
        p.rect(left - 0.5, y - 0.5, 13, 2, '#0b0b10', 0.7);
        p.rect(left, y, 12, 1, '#3a2a10', 0.9);
        const low = c.shield < 0.3;
        if (!low || Math.floor(c.anim * 8) % 2)
            p.rect(left, y, Math.max(1, Math.round(12 * c.shield)), 1, low ? '#ff5a3a' : '#ffd23a', 1);
    }
}

function enemySprites(e) {
    if (e.kind === 'grunt')
        return GRUNT;
    if (e.kind === 'jackal')
        return JACKAL;
    if (e.kind === 'hunter')
        return HUNTER;
    return ELITE[e.variant];
}

function drawEnemy(p, e, t) {
    const set = enemySprites(e);
    if (e.state === 'dead') {
        p.sprite(set.dead, e.x, e.y, e.facing, e.alpha, null, 0, 0);
        return;
    }
    let spr;
    if (e.state === 'flee' || (e.kamikaze && set.panic))
        spr = frame(set.panic, e.anim, 12);
    else
        spr = e.moving ? set.walk[e.walkFrame] : set.walk[0];

    for (const g of e.ghosts) {
        if (g.age < 0.2)
            p.sprite(spr, g.x, g.y, e.facing, (1 - g.age / 0.2) * 0.4, '#9ff6ff', 0, 0);
    }
    if (e.flare > 0)
        flare(p, spr, e.x, e.y, e.facing, Math.min(1, e.flare / 0.3) * 0.7, e.kind === 'hunter' ? '#ffb040' : '#7fd0ff');

    let tint = null;
    if (e.flash > 0)
        tint = e.flashKind === 'shield' ? '#bfe8ff' : '#ffffff';
    let alpha = 1;
    if (e.state === 'camo') {
        // Active camo dropping: a flickering, blue-shifted outline firming up.
        alpha = e.camoAlpha * (0.75 + 0.25 * Math.sin(t * 40 + e.x));
        tint ??= e.camoAlpha < 0.6 ? '#bfe8ff' : null;
    }
    // A Hunter winding up shudders in place.
    const shudder = e.windupT > 0 ? Math.sin(t * 90) * 0.5 : 0;
    p.sprite(spr, e.x, e.y, e.facing, alpha, tint, shudder, 0);

    if (e.kamikaze) {
        // A lit plasma grenade in each raised hand.
        const pulse = 0.6 + 0.4 * Math.sin(t * 30);
        for (const hx of [1.5, 4.5]) {
            const gx = e.x + e.facing * hx - 1, gy = p.row(e.y + 13);
            p.rect(gx - 0.5, gy - 0.5, 3, 3, '#3ab0ff', 0.35 * pulse);
            p.rect(gx, gy, 2, 2, '#9fe8ff', 1);
        }
    }
    if (e.sniper) {
        p.sprite(BEAM_RIFLE, e.x + e.facing * 3.5, e.y + 5.5, e.facing, alpha, tint, 0, 0);
        if (e.aimT > 0 && e.state === 'fight') {
            // Laser sight, brightening as the shot lines up.
            const c = e.world.chief;
            const x1 = e.x + e.facing * 12, x2 = c.visible ? c.x : x1 + e.facing * 200;
            const blink = e.aimT > 0.85 ? 0.5 + 0.5 * Math.sign(Math.sin(t * 60)) : 1;
            p.rect(Math.min(x1, x2), p.row(e.y + 6.5) - 0.5, Math.abs(x2 - x1), 0.5, '#ff3ad0', (0.15 + 0.5 * e.aimT / 1.1) * blink);
        }
    }

    if (e.kind === 'elite') {
        const sword = e.weapon === 'sword';
        const weapon = sword ? (e.slashT > 0 ? ELITE_SWORD_SLASH : ELITE_SWORD) : ELITE_RIFLE;
        const a = sword ? 0.85 + 0.15 * Math.sin(t * 25) : 1;
        p.sprite(weapon, e.x + e.facing * 4.5, e.y + 9, e.facing, a, tint, 0, 0);
    }

    if (e.kind === 'jackal' && e.shieldUp && (e.state === 'fight' || e.state === 'retreat')) {
        const f = e.facing;
        const sx = e.x + f * 5.5 - (f < 0 ? 2 : 0);
        const top = p.row(e.y) - 14;
        const bright = e.shieldFlash > 0;
        p.rect(sx, top, 2, 13, bright ? '#ffffff' : '#3aa0ff', bright ? 0.9 : 0.5);
        p.rect(sx + (f > 0 ? 1 : 0), top + 1, 1, 11, '#bfe6ff', 0.6 + 0.3 * Math.sin(t * 18 + e.x));
        p.rect(sx + (f > 0 ? 1 : 0), top + 2 + (Math.floor(t * 12) % 9), 1, 2, '#ffffff', 0.8);
    }
}

const SHOT_SPRITES = {bullet: TRACER, pellet: PELLET, sniper: SNIPER_TRACER, fuelrod: FUELROD, ...PLASMA};

function drawShot(p, s) {
    const spr = SHOT_SPRITES[s.kind];
    p.sprite(spr, s.x, s.y - (spr.h - 1) / 2, s.vx > 0 ? 1 : -1, 1, null, 0, 0);
}

function drawFlyer(p, f, t) {
    if (f.lifting) {
        // Gravity lift: a shimmering purple column down to the dock.
        const top = p.row(f.y) + 1;
        p.rect(f.x - 4, top, 8, p.H - top, '#c07aff', 0.16 + 0.06 * Math.sin(t * 20));
        p.rect(f.x - 4, top, 1, p.H - top, '#e0a8ff', 0.35);
        p.rect(f.x + 3, top, 1, p.H - top, '#e0a8ff', 0.35);
    }
    p.sprite(f.kind === 'spirit' ? SPIRIT : PELICAN, f.x, f.y, f.facing, 1, null, 0, 0);
}

function drawPickup(p, k, t) {
    const wpn = CHIEF_WEAPONS[k.weapon];
    p.sprite(wpn.spr, k.x, k.y, 1, k.alpha * (k.empty ? 0.6 : 1), k.empty ? '#5a5a62' : null, 0, 0);
    if (!k.empty && k.onGround && Math.floor(t * 1.5 + k.x) % 3 === 0) // glint
        p.rect(k.x + 1 + Math.floor(t * 12) % 4, p.row(k.y) - 3, 1, 1, '#ffffff', 0.9);
}

function drawBeam(p, b) {
    const a = 1 - b.age / b.life;
    const y = p.row(b.y);
    const x = Math.min(b.x1, b.x2), w = Math.abs(b.x2 - b.x1);
    p.rect(x, y - 1.5, w, 3, b.hex, 0.25 * a);
    p.rect(x, y - 0.5, w, 1, '#ffe0f8', a);
}

function drawGrenade(p, g) {
    const top = p.row(g.y) - 2;
    if (g.kind === 'frag') {
        p.rect(g.x - 1, top, 2, 2, '#35502a', 1);
        p.rect(g.x - 1.5, top - 0.5, 3, 3, '#0b0b10', 0.35);
        if (Math.floor(g.age * (g.fuse < 0.4 ? 16 : 7)) % 2)
            p.rect(g.x, top, 1, 1, '#ff3a2a', 1);
    } else {
        p.rect(g.x - 2, top - 1, 4, 4, '#3ab0ff', 0.25 + 0.25 * Math.sin(g.age * 30));
        p.rect(g.x - 1, top, 2, 2, '#7fe0ff', 1);
    }
}

const RING_COLOURS = {frag: '#ffe9a0', plasma: '#9fe0ff', shield: '#7fd0ff', dust: '#c8b898', fuel: '#c8ff9a'};
const FIREBALL = {
    frag: ['#ffe060', '#ff7a20'],
    plasma: ['#bfe6ff', '#3ab0ff'],
    fuel: ['#d8ffb0', '#3ac82a'],
};

function drawBoom(p, b) {
    const r = Math.round(b.radius);
    const fade = 1 - b.t / b.life;
    if (b.ring) {
        p.sprite(RINGS[r], b.x, b.y - r - 1, 1, fade * 0.8, RING_COLOURS[b.kind], 0, 0);
        return;
    }
    const [mid, late] = FIREBALL[b.kind] ?? FIREBALL.plasma;
    let hex;
    if (b.t < 0.08)
        hex = '#ffffff';
    else if (b.t < 0.18)
        hex = mid;
    else
        hex = late;
    p.sprite(DISKS[r], b.x, b.y - r - 1, 1, fade, hex, 0, 0);
    if (b.t < 0.18) // white-hot core
        p.sprite(DISKS[Math.max(1, r - 4)], b.x, b.y - r + 3, 1, fade, '#ffffff', 0, 0);
}

export function drawWorld(p, world) {
    const t = world.t, c = world.chief;
    // Screen shake: deterministic wobble so it doesn't disturb the simulation's RNG.
    if (world.shake > 0)
        p.offset(Math.sin(t * 91) * world.shake * 1.2, Math.cos(t * 67) * world.shake * 0.8);
    else
        p.offset(0, 0);

    for (const d of world.decals) {
        p.rect(d.x - d.w / 2, p.H - 1, d.w, 1, '#1a1410', d.alpha);
        p.rect(d.x - d.w / 3, p.H - 2, Math.round(d.w * 0.66), 1, '#1a1410', d.alpha * 0.5);
    }

    for (const f of world.flyers)
        drawFlyer(p, f, t);
    if (c.visible)
        shadow(p, c.x, c.y, 10);
    for (const e of world.enemies) {
        if (e.state !== 'dead' && e.y > -2)
            shadow(p, e.x, e.y, e.w);
    }
    for (const pod of world.props) {
        if (pod.y < 30)
            shadow(p, pod.x, pod.y, 11);
        p.sprite(pod.open ? POD.open : POD.closed, pod.x, pod.y, c.dir, Math.max(0, pod.alpha), null, 0, 0);
    }

    for (const k of world.pickups)
        drawPickup(p, k, t);
    for (const e of world.enemies) {
        if (e.state === 'dead')
            drawEnemy(p, e, t);
    }
    for (const e of world.enemies) {
        if (e.state !== 'dead')
            drawEnemy(p, e, t);
    }
    drawChief(p, c);
    for (const g of world.grenades)
        drawGrenade(p, g);
    for (const s of world.shots)
        drawShot(p, s);
    for (const pt of world.particles)
        p.rect(pt.x - pt.size / 2, p.row(pt.y) - pt.size, pt.size, pt.size, pt.color, pt.alpha);
    for (const b of world.beams)
        drawBeam(p, b);
    for (const b of world.booms)
        drawBoom(p, b);
}
