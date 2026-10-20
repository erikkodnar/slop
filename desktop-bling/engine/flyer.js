import {burst, COLORS} from './particles.js';

// Dropship (Covenant Spirit or UNSC Pelican): flies in, hovers while it
// drops (or picks up) its passengers one by one, then peels away.
export class Flyer {
    constructor(world, kind, fromX, toX, y, drops, {hold = false} = {}) {
        this.world = world;
        this.kind = kind;
        this.x = fromX;
        this.toX = toX;
        this.baseY = y;
        this.facing = Math.sign(toX - fromX) || 1;
        this.drops = drops; // functions called with the flyer, one per passenger
        this.hold = hold; // stay until released (Pelican pickup)
        this.phase = 'in';
        this.t = 0;
        this.dropT = 0.4;
        this.liftT = 0;
        this.outV = 0;
        this.remove = false;
    }

    get y() {
        return this.baseY + Math.sin(this.t * 3) * 0.8;
    }

    // The gravity lift shows while passengers are coming down.
    get lifting() {
        return this.kind === 'spirit' && this.liftT > 0;
    }

    update(dt) {
        const w = this.world;
        this.t += dt;
        this.liftT = Math.max(0, this.liftT - dt);
        const exhaust = this.kind === 'spirit' ? ['#c07aff', '#8a5ab0'] : COLORS.reentry;
        if (w.rng.chance(0.6))
            burst(w, this.x - this.facing * 14, this.y + 2, 1, exhaust, {speed: 6, up: 6, life: [0.15, 0.3], gravity: -0.2});

        if (this.phase === 'in') {
            const dx = this.toX - this.x;
            const speed = Math.max(18, Math.min(140, Math.abs(dx) * 2.2));
            this.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
            if (Math.abs(dx) < 0.5)
                this.phase = 'hover';
        } else if (this.phase === 'hover') {
            if (this.drops.length) {
                this.liftT = 0.6;
                this.dropT -= dt;
                if (this.dropT <= 0) {
                    this.drops.shift()(this);
                    this.dropT = 0.35;
                }
            } else if (!this.hold && this.liftT <= 0) {
                this.phase = 'out';
            }
        } else {
            this.outV = Math.min(170, this.outV + 150 * dt);
            this.x += this.facing * this.outV * dt;
            this.baseY += 14 * dt;
            if (this.x < -60 || this.x > w.W + 60)
                this.remove = true;
        }
    }
}
