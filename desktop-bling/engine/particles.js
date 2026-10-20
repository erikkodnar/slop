import {GRAVITY, MAX_PARTICLES} from './constants.js';

// Particles are recycled through world.particlePool, so a busy firefight
// doesn't churn the GNOME Shell garbage collector.
export class Particle {
    init(x, y, vx, vy, life, color, gravity, size) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.life = life;
        this.color = color;
        this.gravity = gravity;
        this.size = size;
        this.age = 0;
        return this;
    }

    // Returns false once the particle has expired.
    update(dt) {
        this.age += dt;
        this.vy -= GRAVITY * this.gravity * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.gravity > 0 && this.y < 0) {
            this.y = 0;
            this.vy *= -0.3;
            this.vx *= 0.6;
        }
        return this.age < this.life;
    }

    get alpha() {
        const left = 1 - this.age / this.life;
        return left > 0.3 ? 1 : Math.max(0, left / 0.3);
    }
}

export function burst(world, x, y, n, colors, opts = {}) {
    const {speed = 50, up = 40, life = [0.3, 0.8], gravity = 1, size = 1} = opts;
    const r = world.rng;
    for (let i = 0; i < n && world.particles.length < MAX_PARTICLES; i++) {
        const p = world.particlePool.pop() ?? new Particle();
        world.particles.push(p.init(
            x, y,
            r.range(-speed, speed), r.range(up * 0.2, up),
            r.range(life[0], life[1]), r.pick(colors),
            gravity, Array.isArray(size) ? r.int(size[0], size[1]) : size));
    }
}

export const COLORS = {
    fire: ['#ffffff', '#fff2a0', '#ffd040', '#ff9a20', '#ff5a10'],
    smoke: ['#5a5a5a', '#7a7a7a', '#3e3e3e'],
    dust: ['#9a8a70', '#7a6c58', '#b8a888'],
    spark: ['#fff6c0', '#ffe060'],
    shieldSpark: ['#bfe6ff', '#5ab4ff', '#ffffff'],
    plasmaGreen: ['#c8ffa0', '#5aff3a'],
    plasmaBlue: ['#d0f0ff', '#3ab0ff'],
    confetti: ['#ff4a6a', '#ffd23a', '#4ad0ff', '#7aff5a', '#d07aff', '#ffffff'],
    shieldFlare: ['#fff2a8', '#ffd23a', '#ffb020'],
    methane: ['#c8f6ff', '#8ee0f4', '#e8fcff'],
    debris: ['#3a3026', '#54483a', '#2a241e'],
    reentry: ['#ffffff', '#fff2a0', '#ffb040', '#ff6a20'],
    fuel: ['#e0ffc0', '#7aff4a', '#3ac82a'],
};
