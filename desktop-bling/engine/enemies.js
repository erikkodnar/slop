import {GRAVITY} from './constants.js';
import {burst, COLORS} from './particles.js';
import {Shot, Grenade} from './projectiles.js';

const KINDS = {
    grunt: {
        w: 8, h: 12, gunY: 4.5, hp: 2, speed: 14, range: [55, 105], fireEvery: [1.3, 2.6],
        bolt: 70, dmg: 0.10, blood: ['#3a7bd5', '#5aa0ff'], stride: 3,
    },
    jackal: {
        w: 8, h: 15, gunY: 6.5, hp: 3, speed: 11, range: [50, 95], fireEvery: [2.2, 3.2],
        bolt: 80, dmg: 0.12, blood: ['#7a3ab0', '#b070e0'], stride: 3.5,
    },
    elite: {
        w: 10, h: 21, gunY: 10, hp: 5, speed: 22, range: [45, 85], fireEvery: [1.4, 2.2],
        bolt: 95, dmg: 0.10, blood: ['#3a7bd5', '#7fd0ff'], stride: 4.5,
    },
    hunter: {
        w: 14, h: 22, gunY: 9, hp: 24, speed: 9, range: [40, 120], fireEvery: [2.6, 3.6],
        bolt: 75, dmg: 0.3, blood: ['#ff9a30', '#ffcf6a'], stride: 5,
    },
};

const ELITE_SHIELD = {minor: 4, major: 6, zealot: 8};
const GHOSTS = 3;
const CAMO_TIME = 0.9;
const RETREAT_AFTER = 40; // seconds without a kill before survivors fall back

// opts: variant, weapon, plasmaNade, birthday, kamikaze, sniper, dodgy, hpMul,
//       arrival ('popup' | 'lift' | 'march' | 'camo'), y (lift start height)
export class Enemy {
    constructor(world, kind, x, opts = {}) {
        const cfg = KINDS[kind];
        const r = world.rng;
        this.world = world;
        this.kind = kind;
        this.cfg = cfg;
        this.x = x;
        this.w = cfg.w;
        this.h = cfg.h;
        this.variant = opts.variant ?? 'minor';
        this.weapon = opts.weapon ?? 'plasma';
        this.plasmaNade = !!opts.plasmaNade;
        this.birthday = !!opts.birthday;
        this.kamikaze = !!opts.kamikaze;
        this.sniper = !!opts.sniper;
        this.dodgy = !!opts.dodgy;
        this.hp = cfg.hp * (opts.hpMul ?? 1);

        // Individual quirks, so no two squads behave quite alike.
        this.speedMul = r.range(0.85, 1.15) * (this.kamikaze ? 2.2 : 1);
        this.fireMul = r.range(0.8, 1.25);
        this.wild = r.range(0, 0.3); // chance a shot sails high
        this.courage = r.range(0, 1);

        this.vx = 0;
        this.lift = false;
        this.camoT = 0;
        switch (opts.arrival ?? 'popup') {
        case 'lift': // floats down a dropship's gravity lift
            this.y = opts.y;
            this.vy = -26;
            this.lift = true;
            this.onGround = false;
            this.state = 'rise';
            break;
        case 'march': // walks in from off-screen
            this.y = 0;
            this.vy = 0;
            this.onGround = true;
            this.state = 'fight';
            break;
        case 'camo': // shimmers out of active camouflage
            this.y = 0;
            this.vy = 0;
            this.onGround = true;
            this.state = 'camo';
            break;
        default: // pops up from behind the dock
            this.y = -this.h;
            this.vy = r.range(105, 135);
            this.onGround = false;
            this.state = 'rise';
        }

        this.facing = Math.sign(world.chief.x - x) || -1;
        this.fireCd = r.range(0.6, 1.4);
        this.burst = 0;
        this.burstT = 0;
        this.anim = r.range(0, 1);
        this.stride = r.range(0, 10);
        this.moving = false;
        this.flare = 0;
        // Afterimages left behind by a sword lunge: fixed ring buffer.
        this.ghosts = Array.from({length: GHOSTS}, () => ({x: 0, y: 0, age: 1}));
        this.ghostI = 0;
        this.ghostT = 0;
        this.flash = 0;
        this.flashKind = 'hit';
        this.deathT = 0;
        this.alpha = 1;
        this.remove = false;

        this.shieldUp = kind === 'jackal' && !this.sniper;
        this.shieldT = r.range(1.5, 2.5);
        this.shieldFlash = 0;
        this.firedWindow = false;
        this.aimT = -r.range(0.5, 1.5);

        this.eShieldMax = kind === 'elite' ? ELITE_SHIELD[this.variant] * (opts.hpMul ?? 1) : 0;
        this.eShield = this.eShieldMax;
        this.eShieldDelay = 0;

        this.lungeT = 0;
        this.slashCd = 0;
        this.slashT = 0;
        this.margin = this.w / 2 + 2; // keep the whole body on screen
        this.entered = x >= this.margin && x <= world.W - this.margin;

        this.turnT = 0;
        this.windupT = 0;
        this.chargeT = 0;
        this.smashCd = 0;
        this.enraged = false;
    }

    get hittable() {
        if (this.state === 'dead' || this.y <= -this.h * 0.5)
            return false;
        return this.state !== 'camo' || this.camoT > CAMO_TIME * 0.45;
    }

    // Still counts as part of the squad the Chief must deal with.
    get threat() {
        return this.state === 'rise' || this.state === 'fight' || this.state === 'camo';
    }

    get camoAlpha() {
        return this.state === 'camo' ? 0.12 + 0.88 * this.camoT / CAMO_TIME : 1;
    }

    get walkFrame() {
        return Math.floor(this.stride / this.cfg.stride) % 2;
    }

    update(dt) {
        const w = this.world;
        this.anim += dt;
        this.flash = Math.max(0, this.flash - dt);
        this.flare = Math.max(0, this.flare - dt);
        for (const g of this.ghosts)
            g.age += dt;
        this.shieldFlash = Math.max(0, this.shieldFlash - dt);
        this.slashT = Math.max(0, this.slashT - dt);

        if (!this.onGround) {
            if (!this.lift)
                this.vy -= GRAVITY * dt;
            this.y += this.vy * dt;
            this.x += this.vx * dt;
            if (this.y <= 0 && this.vy < 0) {
                this.y = 0;
                this.vx = this.vy = 0;
                this.onGround = true;
                this.lift = false;
                if (this.state === 'rise')
                    this.state = 'fight';
            }
        }

        if (this.state === 'dead') {
            this.deathT += dt;
            if (this.deathT > 2)
                this.alpha = Math.max(0, 1 - (this.deathT - 2) / 1.5);
            if (this.alpha <= 0)
                this.remove = true;
            return;
        }

        if (this.state === 'camo') {
            this.camoT += dt;
            if (this.camoT >= CAMO_TIME)
                this.state = 'fight';
            return;
        }

        if (this.eShieldMax) {
            this.eShieldDelay -= dt;
            if (this.eShieldDelay <= 0)
                this.eShield = Math.min(this.eShieldMax, this.eShield + dt * 2.5);
        }

        // A long stalemate ends with the survivors falling back off-screen.
        if (this.state === 'fight' && this.onGround && w.t - w.lastKillT > RETREAT_AFTER) {
            this.state = this.kind === 'grunt' ? 'flee' : 'retreat';
            w.stats.retreats++;
            this.fleeDir = this.x < w.W / 2 ? -1 : 1;
        }
        if (this.state === 'flee' || this.state === 'retreat') {
            const speed = this.state === 'flee' ? 38 : this.cfg.speed * 1.5;
            this.moving = true;
            this.facing = this.fleeDir;
            this.x += this.fleeDir * speed * dt;
            this.stride += speed * dt;
            if (this.x < -12 || this.x > w.W + 12)
                this.remove = true;
            return;
        }

        this.moving = false;
        if (this.state !== 'fight' || !this.onGround || !w.chief.visible)
            return;

        // Marching in from off-screen: keep walking until fully on screen.
        if (!this.entered) {
            this.facing = this.x < w.W / 2 ? 1 : -1;
            this._walk(dt, 1.3);
            this.entered = this.x >= this.margin && this.x <= w.W - this.margin;
            return;
        }

        const dx = w.chief.x - this.x;
        const dist = Math.abs(dx);
        this.fireCd -= dt;
        if (this.dodgy)
            this._dodge();

        if (this.kind === 'hunter') {
            this._hunter(dt, dx, dist);
        } else {
            this.facing = Math.sign(dx) || this.facing;
            if (this.kamikaze)
                this._kamikaze(dt, dist);
            else if (this.sniper)
                this._sniper(dt, dist);
            else if (this.kind === 'jackal')
                this._jackal(dt, dist);
            else if (this.weapon === 'sword')
                this._sword(dt, dist);
            else
                this._gunner(dt, dist);
        }

        this.x = Math.max(this.margin, Math.min(w.W - this.margin, this.x));
    }

    _walk(dt, mult = 1) {
        const step = this.cfg.speed * this.speedMul * (this.enraged ? 1.4 : 1) * mult * dt;
        this.x += this.facing * step;
        this.stride += Math.abs(step);
        this.moving = true;
    }

    // Tough Luck skull: hop out of the way of incoming rounds.
    _dodge() {
        for (const s of this.world.shots) {
            if (s.owner !== 'chief' || s.dodgeChecked)
                continue;
            const dx = this.x - s.x;
            if (Math.sign(dx) === Math.sign(s.vx) && Math.abs(dx) < 30) {
                s.dodgeChecked = true;
                if (this.world.rng.chance(0.25)) {
                    this.onGround = false;
                    this.vy = 75;
                    this.vx = this.world.rng.pick([-20, 20]);
                    return;
                }
            }
        }
    }

    _gunner(dt, dist) {
        const r = this.world.rng;
        const [near, far] = this.cfg.range;
        if (dist > far)
            this._walk(dt);
        else if (dist < near * 0.6 && this.kind === 'elite')
            this._walk(dt, -0.6);

        if (dist > far + 25)
            return;
        if (this.plasmaNade && dist > 35 && dist < 100 && this.fireCd <= 0 && r.chance(0.35)) {
            this._throwNade();
            return;
        }
        if (this.burst > 0) {
            this.burstT -= dt;
            if (this.burstT <= 0) {
                this._fire();
                this.burst--;
                this.burstT = 0.14;
            }
        } else if (this.fireCd <= 0) {
            this.burst = this.kind === 'elite' ? 3 : 1;
            this.burstT = 0;
            this.fireCd = r.range(...this.cfg.fireEvery) * this.fireMul;
        }
    }

    // Jackals hide behind their shield and only drop it briefly to fire.
    _jackal(dt, dist) {
        const r = this.world.rng;
        const far = this.cfg.range[1];
        if (dist > far)
            this._walk(dt);
        this.shieldT -= dt;
        if (this.shieldUp) {
            if (this.shieldT <= 0 && dist < far + 25) {
                this.shieldUp = false;
                this.shieldT = 0.75;
                this.firedWindow = false;
            }
        } else {
            if (!this.firedWindow && this.shieldT < 0.45) {
                this._fire();
                this.firedWindow = true;
            }
            if (this.shieldT <= 0) {
                this.shieldUp = true;
                this.shieldT = r.range(2, 3.2) * this.fireMul;
            }
        }
    }

    // Jackal marksman: hangs back, paints the Chief with a laser, then fires a
    // hitscan beam. Jumping at the right moment makes it miss.
    _sniper(dt, dist) {
        const w = this.world, r = w.rng, c = w.chief;
        if (dist > 230)
            this._walk(dt);
        else if (dist < 110)
            this._walk(dt, -0.5);
        if (dist > 250)
            return;
        this.aimT += dt;
        if (this.aimT >= 1.1) {
            const gx = this.x + this.facing * 6, gy = this.y + this.cfg.gunY;
            const hit = c.visible && c.y < gy - 1;
            w.beam(gx, hit ? c.x : (this.facing > 0 ? w.W + 10 : -10), gy, '#ff5ad8');
            if (hit) {
                c.takeHit(0.35);
                burst(w, c.x, gy, 6, ['#ff5ad8', '#ffd0f4'], {speed: 35, up: 30});
            }
            this.aimT = -r.range(1.6, 2.6) * this.fireMul;
            this.sniperJudged = false; // the Chief reads each new aim afresh
        }
    }

    // Grunt with a lit plasma grenade in each hand, screaming towards the Chief.
    _kamikaze(dt, dist) {
        this._walk(dt);
        if (dist < 7)
            this._detonate();
    }

    _detonate() {
        const w = this.world;
        // Die first so the blast can't kill this Grunt a second time.
        this.kamikaze = false;
        this.hp = 0;
        this._die({type: 'explosion', dir: -this.facing});
        w.explode({x: this.x, y: 4, kind: 'plasma', owner: 'neutral'});
    }

    _sword(dt, dist) {
        this.slashCd -= dt;
        if (this.lungeT > 0) {
            this.lungeT -= dt;
            this.ghostT -= dt;
            if (this.ghostT <= 0) {
                const g = this.ghosts[this.ghostI++ % GHOSTS];
                g.x = this.x;
                g.y = this.y;
                g.age = 0;
                this.ghostT = 0.05;
            }
            if (dist > 7)
                this.x += this.facing * 95 * dt;
            if (dist < 10 && this.slashCd <= 0)
                this._slash();
            return;
        }
        if (dist > 30)
            this._walk(dt, 1.4);
        else if (this.slashCd <= 0)
            this.lungeT = 0.25;
    }

    _slash() {
        this.world.chief.takeHit(0.3);
        this.slashCd = 1.4;
        this.slashT = 0.2;
        this.lungeT = 0;
        burst(this.world, this.x + this.facing * 7, this.y + 12, 6, COLORS.shieldSpark, {speed: 35, up: 35});
    }

    // Hunters turn slowly, so a Chief who gets behind one has a window to
    // shoot its unarmoured back. Up close they wind up and charge.
    _hunter(dt, dx, dist) {
        const w = this.world, r = w.rng, c = w.chief;
        const want = Math.sign(dx) || this.facing;
        if (want !== this.facing && this.chargeT <= 0) {
            this.turnT += dt;
            if (this.turnT > (this.enraged ? 0.55 : 1.1)) {
                this.facing = want;
                this.turnT = 0;
            }
        } else {
            this.turnT = 0;
        }
        this.smashCd -= dt;

        if (this.windupT > 0) {
            this.windupT -= dt;
            if (this.windupT <= 0)
                this.chargeT = 0.5;
            return;
        }
        if (this.chargeT > 0) {
            this.chargeT -= dt;
            const step = 80 * dt;
            this.x += this.facing * step;
            this.stride += step;
            this.moving = true;
            if (Math.abs(c.x - this.x) < 12 && c.y < 10 && Math.sign(c.x - this.x) === this.facing &&
                this.smashCd <= 0) {
                c.takeHit(0.45);
                c.x += this.facing * 6;
                w.shake = Math.max(w.shake, 0.6);
                burst(w, this.x + this.facing * 8, 8, 10, COLORS.spark, {speed: 50, up: 50});
                this.smashCd = 2.2;
                this.chargeT = 0;
            }
            return;
        }

        const facingChief = this.facing === want;
        if (facingChief && dist < 34 && this.smashCd <= 0) {
            this.windupT = 0.35;
            return;
        }
        if (facingChief && dist > this.cfg.range[1])
            this._walk(dt);
        if (facingChief && dist > 38 && dist < this.cfg.range[1] + 30 && this.fireCd <= 0) {
            w.shots.push(new Shot(this.x + this.facing * 8, this.y + this.cfg.gunY,
                this.facing * this.cfg.bolt, 'enemy', 'fuelrod', this.cfg.dmg, 3));
            this.fireCd = r.range(...this.cfg.fireEvery) * this.fireMul * (this.enraged ? 0.6 : 1);
        }
    }

    _fire() {
        const r = this.world.rng;
        const kind = this.kind === 'elite' ? 'plasma-blue' : 'plasma';
        const y = this.y + this.cfg.gunY + (r.chance(this.wild) ? r.range(5, 9) : r.range(-0.8, 0.8));
        this.world.shots.push(new Shot(this.x + this.facing * 5, y, this.facing * this.cfg.bolt, 'enemy', kind, this.cfg.dmg));
    }

    _throwNade() {
        const w = this.world;
        w.grenades.push(Grenade.aimed(this.x, this.y + this.h, w.chief.x, 'enemy', 'plasma', 85));
        this.plasmaNade = false;
        this.fireCd = 1.5;
    }

    // force skips the bravery roll (e.g. their Elite just died).
    panic(force = false) {
        if (this.kind !== 'grunt' || this.state !== 'fight' || this.kamikaze)
            return;
        if (!force && this.world.rng.next() < this.courage * 0.6)
            return;
        this.state = 'flee';
        this.fleeDir = Math.sign(this.x - this.world.chief.x) || 1;
    }

    // src: {type: 'bullet'|'melee'|'explosion', dir: direction the damage travels}
    hit(dmg, src) {
        if (!this.hittable)
            return false;
        const w = this.world;
        const cy = this.y + this.h * 0.6;
        const fromFront = src.dir === -this.facing;

        if (this.kind === 'jackal' && this.shieldUp && src.type === 'bullet' && fromFront) {
            this.shieldFlash = 0.1;
            burst(w, this.x + this.facing * 5, cy, 3, COLORS.shieldSpark, {speed: 30, up: 30, life: [0.15, 0.3]});
            return true;
        }

        if (this.kind === 'hunter' && fromFront && src.type !== 'explosion') {
            // Armour plate and shield soak most of a frontal attack.
            dmg *= 0.2;
            burst(w, this.x + this.facing * 6, cy, 2, ['#ffffff', '#ffd27a'], {speed: 30, up: 30, life: [0.1, 0.25]});
        }

        if (this.eShield > 0) {
            this.eShieldDelay = 2.5;
            this.flash = 0.06;
            this.flashKind = 'shield';
            this.flare = 0.3;
            this.eShield -= dmg;
            if (this.eShield > 0)
                return true;
            dmg = -this.eShield;
            this.eShield = 0;
            // Shield pops: sparks and a blue shockwave.
            burst(w, this.x, cy, 14, COLORS.shieldSpark, {speed: 55, up: 55});
            w.ring(this.x, cy, 'shield');
            if (dmg <= 0)
                return true;
        }

        this.hp -= dmg;
        this.flash = 0.1;
        this.flashKind = 'hit';
        if (src.type === 'bullet' && this.onGround && this.kind !== 'hunter')
            this.x += src.dir * 0.8; // flinch
        burst(w, this.x, cy, 2, this.cfg.blood, {speed: 25, up: 30, life: [0.3, 0.6]});
        if (this.hp <= 0)
            this._die(src);
        return true;
    }

    _die(src) {
        const w = this.world, r = w.rng;
        const boom = src.type === 'explosion';
        this.state = 'dead';
        this.onGround = false;
        this.lift = false;
        w.lastKillT = w.t;
        this.vy = (boom ? 90 : 45) * (w.cowbell ? 1.7 : 1) * (this.kind === 'hunter' ? 0.4 : 1);
        this.vx = (src.dir || -this.facing) * (boom ? 45 : 22) * (w.cowbell ? 1.4 : 1);
        w.stats.kills++;
        burst(w, this.x, this.y + this.h * 0.6, 6, this.cfg.blood, {speed: 40, up: 50});

        if (this.kind === 'grunt') // ruptured methane tank
            burst(w, this.x - this.facing * 3, this.y + 9, 8, COLORS.methane, {speed: 18, up: 30, life: [0.5, 1], gravity: -0.15});
        if (this.birthday && this.kind === 'grunt')
            burst(w, this.x, this.y + this.h, 30, COLORS.confetti, {speed: 45, up: 110, life: [0.8, 1.6], gravity: 0.35});

        if (this.kamikaze) {
            // Shot before reaching the Chief: both lit grenades drop.
            this.kamikaze = false;
            for (const vx of [-14, 14]) {
                const g = new Grenade(this.x, 8, vx, 40, 'neutral', 'plasma');
                g.fuse = 0.6;
                w.grenades.push(g);
            }
        }

        if (this.kind === 'elite') {
            for (const e of w.enemies) {
                if (e.kind === 'grunt' && Math.abs(e.x - this.x) < 160 && r.chance(0.85))
                    e.panic(true);
            }
            if (r.chance(0.4))
                w.dropPickup(this.weapon === 'sword' ? 'sword' : 'plasma', this.x, this.y + 8);
        }

        if (this.kind === 'hunter') {
            burst(w, this.x, this.y + 10, 24, ['#ff9a30', '#ffcf6a', '#c06a18'], {speed: 50, up: 70, life: [0.5, 1.1]});
            w.shake = Math.max(w.shake, 0.7);
            // Bond brothers: the survivor goes berserk.
            for (const e of w.enemies) {
                if (e.kind === 'hunter' && e !== this && e.state !== 'dead') {
                    e.enraged = true;
                    e.flare = 0.6;
                }
            }
        }
    }
}
