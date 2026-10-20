import {GRAVITY} from './constants.js';
import {burst, COLORS} from './particles.js';

// Straight-line shots: Chief's rifle bullets and Covenant plasma bolts.
// life caps range (shotgun pellets); pierce lets a round pass through bodies.
export class Shot {
    constructor(x, y, vx, owner, kind, dmg, life = 4, pierce = false) {
        Object.assign(this, {x, y, vx, owner, kind, dmg, life, pierce});
        this.prevX = x;
        this.w = kind === 'fuelrod' ? 5 : kind === 'bullet' || kind === 'pellet' || kind === 'sniper' ? 2 : 3;
        this.age = 0;
        this.dead = false;
        this.hits = pierce ? [] : null;
    }

    update(dt, world) {
        this.prevX = this.x;
        this.x += this.vx * dt;
        this.age += dt;
        if (this.x < -10 || this.x > world.W + 10 || this.age > this.life) {
            this.dead = true;
            if (this.kind === 'fuelrod' && this.x > 0 && this.x < world.W)
                world.explode({x: this.x, y: this.y, kind: 'fuel', owner: 'enemy'});
        }
    }
}

// Arcing grenades. Frags bounce; plasma grenades stick where they land.
export class Grenade {
    constructor(x, y, vx, vy, owner, kind) {
        Object.assign(this, {x, y, vx, vy, owner, kind});
        this.fuse = kind === 'frag' ? 1.3 : 1.1;
        this.age = 0;
        this.trailT = 0;
        this.dead = false;
    }

    static aimed(x, y, targetX, owner, kind, speed = 95) {
        const dx = targetX - x;
        const t = Math.min(1.05, Math.max(0.45, Math.abs(dx) / speed));
        return new Grenade(x, y, dx / t, (-y + 0.5 * GRAVITY * t * t) / t, owner, kind);
    }

    landingX() {
        const t = (this.vy + Math.sqrt(this.vy * this.vy + 2 * GRAVITY * Math.max(0, this.y))) / GRAVITY;
        return this.x + this.vx * t;
    }

    update(dt, world) {
        this.age += dt;
        this.trailT -= dt;
        if (this.trailT <= 0 && (this.vx || this.vy)) {
            this.trailT = 0.04;
            burst(world, this.x, this.y + 1, 1, this.kind === 'frag' ? COLORS.smoke : COLORS.plasmaBlue,
                {speed: 3, up: 6, life: [0.25, 0.45], gravity: -0.05});
        }
        if (this.vx || this.vy || this.y > 0) {
            this.vy -= GRAVITY * dt;
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            if (this.y <= 0 && this.vy < 0) {
                this.y = 0;
                if (this.kind === 'plasma' || Math.abs(this.vy) < 40) {
                    this.vx = this.vy = 0;
                } else {
                    this.vy = -this.vy * 0.35;
                    this.vx *= 0.5;
                }
            }
        }
        this.fuse -= dt;
        if (this.fuse <= 0) {
            this.dead = true;
            world.explode(this);
        }
    }
}
