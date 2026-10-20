// Renders a sprite sheet and a strip of gameplay frames to PNGs for eyeballing.
// Usage: gjs -m dev/snapshot.js <out-dir> [seed]
import Cairo from 'cairo';
import {World} from '../engine/world.js';
import {drawWorld, CairoPainter} from '../render/renderer.js';
import * as S from '../render/sprites.js';

const out = ARGV[0] ?? '.';
const seed = Number(ARGV[1] ?? 7);
const SCALE = 4;

function sheet() {
    const C = S.CHIEF;
    const sprites = [
        C.aim.stand, ...C.aim.run, C.aim.rise, C.aim.fall, C.aim.crouch,
        C.throw.stand, C.victory.stand, C.melee.run1, C.reload.run2,
        ...Object.values(S.CHIEF_WEAPONS).map(w => w.spr), S.HUNTER.walk[0], S.HUNTER.walk[1], S.HUNTER.dead,
        S.SPIRIT, S.PELICAN, S.FUELROD, S.BEAM_RIFLE,
        ...S.GRUNT.walk, ...S.GRUNT.panic, S.GRUNT.dead,
        ...S.JACKAL.walk, S.JACKAL.dead,
        ...S.ELITE.minor.walk, S.ELITE.minor.dead, S.ELITE.major.walk[0], S.ELITE.zealot.walk[0],
        S.ELITE_RIFLE, S.ELITE_SWORD, S.ELITE_SWORD_SLASH, S.POD.closed, S.POD.open,
    ];
    const W = sprites.reduce((a, s) => a + s.w + 3, 3), H = 26;
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W * SCALE, H * SCALE);
    const cr = new Cairo.Context(surf);
    cr.setSourceRGB(0.55, 0.32, 0.45);
    cr.paint();
    let x = 3;
    for (const spr of sprites) {
        for (const {hex, rects} of spr.groups) {
            const n = parseInt(hex.slice(1, 7), 16);
            const a = hex.length > 7 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
            cr.setSourceRGBA((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, a);
            for (const [rx, ry, len] of rects)
                cr.rectangle((x + rx) * SCALE, (H - 2 - spr.h + ry) * SCALE, len * SCALE, SCALE);
            cr.fill();
        }
        x += spr.w + 3;
    }
    surf.writeToPNG(`${out}/sheet.png`);
}

function strip() {
    const w = new World({width: 320, seed});
    const times = [];
    for (let t = 0.5; t < 120; t += 0.7)
        times.push(t);
    const frames = [];
    let i = 0;
    while (!w.done && frames.length < 24) {
        w.tick(1 / 30);
        if (w.t >= times[i]) {
            i++;
            if (w.enemies.length || w.grenades.length || w.booms.length || w.flyers.length || frames.length < 2)
                frames.push(snap(w));
        }
    }
    const fh = w.H + 6;
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, 320 * 3, frames.length * fh * 3);
    const cr = new Cairo.Context(surf);
    frames.forEach((f, k) => {
        cr.save();
        cr.translate(0, k * fh * 3);
        cr.setSourceRGB(0.16, 0.18, 0.22);
        cr.rectangle(0, 0, 320 * 3, w.H * 3);
        cr.fill();
        cr.setSourceRGB(0.08, 0.08, 0.1);
        cr.rectangle(0, w.H * 3, 320 * 3, 6 * 3);
        cr.fill();
        cr.setSourceSurface(f, 0, 0);
        cr.paint();
        cr.restore();
    });
    surf.writeToPNG(`${out}/strip.png`);
}

function snap(w) {
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, w.W * 3, w.H * 3);
    const cr = new Cairo.Context(surf);
    const p = new CairoPainter(3, w.H);
    p.begin(cr);
    drawWorld(p, w);
    p.end();
    return surf;
}

sheet();
strip();
print(`wrote ${out}/sheet.png and ${out}/strip.png`);
