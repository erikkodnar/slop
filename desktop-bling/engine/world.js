import {ART_HEIGHT} from './constants.js';
import {Rng} from './rng.js';
import {Chief} from './chief.js';
import {Director} from './director.js';
import {burst, COLORS} from './particles.js';
import {WEAPONS} from './weapons.js';
import {Flyer} from './flyer.js';

export {ART_HEIGHT};

const MAX_ENCOUNTER_SECONDS = 240;

// Drop pod the Chief can arrive in: burns in, slams down, door blows off.
class Pod {
    constructor(world, x) {
        this.world = world;
        this.x = x;
        this.y = world.H + 18;
        this.vy = -280;
        this.landed = false;
        this.open = false;
        this.t = 0;
        this.alpha = 1;
        this.remove = false;
    }

    update(dt) {
        const w = this.world, c = w.chief;
        if (!this.landed) {
            this.y += this.vy * dt;
            burst(w, this.x, this.y + 14, 3, COLORS.reentry, {speed: 8, up: 40, life: [0.1, 0.3], gravity: -0.3, size: [1, 2]});
            burst(w, this.x, this.y + 16, 1, COLORS.smoke, {speed: 5, up: 20, life: [0.4, 0.7], gravity: -0.1, size: 2});
            if (this.y <= 0) {
                this.y = 0;
                this.landed = true;
                burst(w, this.x, 0, 18, COLORS.dust, {speed: 70, up: 45, size: [1, 2]});
                w.ring(this.x, 1, 'dust');
                w.scorch(this.x, 14);
                w.shake = Math.max(w.shake, 0.8);
            }
            return;
        }
        this.t += dt;
        if (this.t > 0.5 && c.state === 'arriving') {
            this.open = true;
            c.arrive(this.x + c.dir * 3, 0);
            c.jump(c.dir * 45, 90, 0.01);
            // The door panel goes flying.
            burst(w, this.x + c.dir * 4, 7, 4, ['#9aa0aa', '#565a62'], {speed: 50, up: 60, size: 2});
        }
        if (this.t > 5)
            this.alpha -= dt;
        if (this.alpha <= 0)
            this.remove = true;
    }
}

// A weapon lying on the ground (dropped by an Elite or tossed by the Chief).
class Pickup {
    constructor(world, weapon, x, y, ammo, empty) {
        Object.assign(this, {world, weapon, x, y, ammo, empty});
        this.vx = world.rng.range(-15, 15);
        this.vy = 45;
        this.onGround = false;
        this.age = 0;
        this.life = empty ? 2.5 : 14;
        this.wanted = null; // the Chief decides once whether he wants it
        this.remove = false;
    }

    get alpha() {
        return Math.min(1, (this.life - this.age) / 1.5);
    }

    update(dt) {
        this.age += dt;
        if (!this.onGround) {
            this.vy -= 300 * dt;
            this.y += this.vy * dt;
            this.x += this.vx * dt;
            if (this.y <= 0) {
                this.y = 0;
                this.onGround = true;
            }
        }
        this.remove = this.age >= this.life;
    }
}

// Fireball (disk) or shockwave (ring).
class Boom {
    constructor(x, y, kind, ring, scale = 1) {
        Object.assign(this, {x, y, kind, ring});
        this.t = 0;
        this.life = ring ? 0.32 : 0.35;
        this.max = (kind === 'frag' ? 22 : kind === 'dust' ? 18 : kind === 'shield' || kind === 'fuel' ? 12 : 16) * scale;
        this.scale = scale;
        this.remove = false;
    }

    get radius() {
        if (this.ring)
            return Math.min(24, 2 + (this.max - 2) * Math.min(1, this.t / this.life));
        return Math.min(16, (3 + 11 * Math.min(1, this.t / 0.2)) * (this.kind === 'fuel' ? 0.7 : this.scale));
    }

    update(dt) {
        this.t += dt;
        this.remove = this.t >= this.life;
    }
}

// Burnt patch left on the dock edge.
class Scorch {
    constructor(x, w) {
        Object.assign(this, {x, w});
        this.age = 0;
        this.life = 6;
        this.remove = false;
    }

    get alpha() {
        return 0.45 * Math.min(1, (this.life - this.age) / 2);
    }

    update(dt) {
        this.age += dt;
        this.remove = this.age >= this.life;
    }
}

// Hitscan beam (Jackal sniper), visible for a moment.
class Beam {
    constructor(x1, x2, y, hex) {
        Object.assign(this, {x1, x2, y, hex});
        this.age = 0;
        this.life = 0.2;
        this.remove = false;
    }

    update(dt) {
        this.age += dt;
        this.remove = this.age >= this.life;
    }
}

const BLAST_RADIUS = {frag: 26, plasma: 22, fuel: 14};

export class World {
    constructor({width, height = ART_HEIGHT, seed = Date.now(), maxEnemies = 8}) {
        this.W = Math.floor(width);
        this.H = height;
        this.seed = seed >>> 0;
        this.rng = new Rng(this.seed);
        this.t = 0;
        this.done = false;
        this.shake = 0;
        this.enemies = [];
        this.shots = [];
        this.grenades = [];
        this.particles = [];
        this.particlePool = [];
        this.props = [];
        this.flyers = [];
        this.pickups = [];
        this.booms = [];
        this.decals = [];
        this.beams = [];
        this.stats = {kills: 0, pickups: 0, retreats: 0};
        this.lastKillT = 0;
        // Compacted in place, so these references stay valid.
        this._updatables = [this.props, this.flyers, this.pickups, this.booms, this.decals, this.beams];

        this.director = new Director(this, {maxEnemies});
        this.cowbell = this.director.skulls.includes('cowbell');
        this.chief = new Chief(this, this.director);
        const d = this.director;
        if (d.entrance === 'pod') {
            this.props.push(new Pod(this, d.startX));
        } else if (d.entrance === 'pelican') {
            const from = d.dir > 0 ? -50 : this.W + 50;
            this.flyers.push(new Flyer(this, 'pelican', from, d.startX, 40, [
                f => this.chief.arrive(f.x, f.y - 4),
            ]));
        }
    }

    ring(x, y, kind) {
        this.booms.push(new Boom(x, y, kind, true, this.cowbell ? 1.4 : 1));
    }

    scorch(x, w) {
        if (this.decals.length < 8)
            this.decals.push(new Scorch(x, w));
    }

    beam(x1, x2, y, hex) {
        this.beams.push(new Beam(x1, x2, y, hex));
    }

    dropPickup(weapon, x, y, ammo = WEAPONS[weapon].mag, empty = false) {
        if (this.pickups.length < 4)
            this.pickups.push(new Pickup(this, weapon, x, y, ammo, empty));
    }

    tick(dt) {
        dt = Math.min(dt, 0.05);
        this.t += dt;
        this.shake = Math.max(0, this.shake - dt * 4);
        this.director.update(dt);
        this.chief.update(dt);
        for (const e of this.enemies)
            e.update(dt);
        for (const s of this.shots)
            s.update(dt, this);
        this._collide();
        for (const g of this.grenades)
            g.update(dt, this);
        this._updateParticles(dt);
        for (const list of this._updatables) {
            for (const item of list)
                item.update(dt);
        }

        compact(this.enemies, 'remove');
        compact(this.shots, 'dead');
        compact(this.grenades, 'dead');
        compact(this.props, 'remove');
        compact(this.flyers, 'remove');
        compact(this.pickups, 'remove');
        compact(this.booms, 'remove');
        compact(this.decals, 'remove');
        compact(this.beams, 'remove');

        if (this.t > MAX_ENCOUNTER_SECONDS)
            this.done = true;
    }

    _updateParticles(dt) {
        const ps = this.particles;
        let n = 0;
        for (let i = 0; i < ps.length; i++) {
            const p = ps[i];
            if (p.update(dt))
                ps[n++] = p;
            else
                this.particlePool.push(p);
        }
        ps.length = n;
    }

    _collide() {
        const c = this.chief;
        for (const s of this.shots) {
            if (s.dead)
                continue;
            if (s.owner === 'chief') {
                for (const e of this.enemies) {
                    if (!e.hittable || !sweptHit(s, e) || (s.pierce && s.hits.includes(e)))
                        continue;
                    if (!e.hit(s.dmg, {type: 'bullet', dir: Math.sign(s.vx)}))
                        continue;
                    if (!s.pierce) {
                        s.dead = true;
                        break;
                    }
                    s.hits.push(e);
                }
            } else if (c.visible && sweptHit(s, c)) {
                c.takeHit(s.dmg);
                if (s.kind === 'fuelrod')
                    this.explode({x: s.x, y: s.y, kind: 'fuel', owner: 'fx'});
                else
                    burst(this, s.x, s.y, 5, s.kind === 'plasma' ? COLORS.plasmaGreen : COLORS.plasmaBlue,
                        {speed: 30, up: 30, life: [0.15, 0.35]});
                s.dead = true;
            }
        }
    }

    // g: {x, y, kind: 'frag'|'plasma'|'fuel', owner: 'chief'|'enemy'|'neutral'|'fx'}
    // 'neutral' hurts everyone (kamikaze Grunts); 'fx' is visual only.
    explode(g) {
        const r = this.rng;
        const big = this.cowbell ? 1.4 : 1;
        const radius = BLAST_RADIUS[g.kind] * big;
        this.booms.push(new Boom(g.x, g.y, g.kind, false, big));
        this.ring(g.x, g.y + 2, g.kind);
        if (g.y < 3)
            this.scorch(g.x, g.kind === 'frag' ? 16 : 10);
        this.shake = Math.max(this.shake, (g.kind === 'frag' ? 1 : 0.6) * (this.cowbell ? 1.5 : 1));
        const fire = g.kind === 'frag' ? COLORS.fire : g.kind === 'fuel' ? COLORS.fuel : COLORS.plasmaBlue;
        burst(this, g.x, g.y + 2, g.kind === 'fuel' ? 12 : 22, fire, {speed: 70, up: 80, life: [0.2, 0.6], size: [1, 2]});
        burst(this, g.x, g.y + 4, 8, COLORS.smoke, {speed: 20, up: 25, life: [0.7, 1.4], gravity: -0.1, size: [2, 3]});
        if (g.kind === 'frag')
            burst(this, g.x, g.y + 2, 8, COLORS.debris, {speed: 60, up: 110, life: [0.6, 1.1], gravity: 1.4, size: [1, 2]});

        if (g.owner === 'chief' || g.owner === 'neutral') {
            for (const e of this.enemies) {
                if (!e.hittable)
                    continue;
                const d = Math.hypot(e.x - g.x, e.y + e.h / 2 - g.y);
                if (d < radius)
                    e.hit(d < radius / 2 ? 8 : 4, {type: 'explosion', dir: Math.sign(e.x - g.x) || 1});
                else if (d < radius * 2.1)
                    e.panic();
            }
        }
        if ((g.owner === 'enemy' || g.owner === 'neutral') && this.chief.visible &&
            Math.hypot(this.chief.x - g.x, this.chief.y - g.y) < radius * 0.85)
            this.chief.takeHit(g.kind === 'fuel' ? 0.3 : 0.35);
    }
}

// Drop flagged entries without allocating a new array.
function compact(arr, flag) {
    let n = 0;
    for (let i = 0; i < arr.length; i++) {
        if (!arr[i][flag])
            arr[n++] = arr[i];
    }
    arr.length = n;
}

function sweptHit(s, e) {
    const lo = Math.min(s.prevX, s.x) - s.w / 2, hi = Math.max(s.prevX, s.x) + s.w / 2;
    return hi >= e.x - e.w / 2 && lo <= e.x + e.w / 2 && s.y >= e.y && s.y <= e.y + e.h;
}
