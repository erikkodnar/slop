// Offline cost per frame of engine tick and Cairo drawing at real screen size.
// Usage: gjs -m dev/bench.js [screenWidth] [scale] [encounters]
import Cairo from 'cairo';
import GLib from 'gi://GLib';
import {World} from '../engine/world.js';
import {drawWorld, CairoPainter} from '../render/renderer.js';

const SW = Number(ARGV[0] ?? 1920), S = Number(ARGV[1] ?? 2), N = Number(ARGV[2] ?? 20);
const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, SW, 64 * S);
const cr = new Cairo.Context(surf);
const painter = new CairoPainter(S, 64);
let tickUs = 0, drawUs = 0, frames = 0, worst = 0;
for (let seed = 1; seed <= N; seed++) {
    const w = new World({width: SW / S, seed});
    while (!w.done) {
        const t0 = GLib.get_monotonic_time();
        w.tick(1 / 30);
        const t1 = GLib.get_monotonic_time();
        cr.save(); cr.setOperator(Cairo.Operator.CLEAR); cr.paint(); cr.restore();
        painter.begin(cr);
        drawWorld(painter, w);
        painter.end();
        surf.flush();
        const t2 = GLib.get_monotonic_time();
        tickUs += t1 - t0; drawUs += t2 - t1; frames++;
        worst = Math.max(worst, t2 - t0);
    }
}
print(`${frames} frames: tick ${(tickUs / frames).toFixed(1)}µs, draw ${(drawUs / frames).toFixed(1)}µs, worst frame ${(worst / 1000).toFixed(2)}ms`);
