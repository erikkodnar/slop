import {GRAVITY, CHIEF_SPEED} from './constants.js';
import {burst, COLORS} from './particles.js';
import {Shot, Grenade} from './projectiles.js';
import {Flyer} from './flyer.js';
import {WEAPONS} from './weapons.js';

const ACCEL = 260;
const STRIDE = 4.5; // art px travelled per run frame

// How this battle's Chief likes to fight.
const PERSONALITIES = {
    aggressive: {range: 0.8, nade: 0.7, melee: 15, hop: 0.25, speed: 1.08, sword: 0.95, plasma: 0.45},
    tactical: {range: 1.0, nade: 1.0, melee: 11, hop: 0.12, speed: 1.0, sword: 0.7, plasma: 0.35},
    grenadier: {range: 1.05, nade: 1.8, melee: 10, hop: 0.1, speed: 0.97, sword: 0.6, plasma: 0.3},
};

function approach(v, target, step) {
    return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

export class Chief {
    constructor(world, plan) {
        this.world = world;
        this.plan = plan;
        this.p = PERSONALITIES[plan.personality];
        this.dir = plan.dir;
        this.facing = plan.dir;
        this.w = 10;
        this.h = 18;
        this.x = plan.startX;
        this.y = 0;
        this.vx = 0;
        this.vy = 0;
        this.groundVx = 0;
        this.onGround = true;
        this.noGround = false; // falling away for good (exits)
        this.visible = true;
        this.state = 'fight'; // arriving -> fight -> victory -> exit | evac | popdown -> gone
        this.stateT = 0;
        this.anim = 0;
        this.stride = 0;
        this.nextStep = STRIDE * 2;
        this.onScreen = false;
        this.lookT = 2;

        this.shield = 1;
        this.shieldDelay = 0;
        this.flash = 0;
        this.flare = 0;

        this.weapon = plan.loadout;
        this.ammo = WEAPONS[this.weapon].mag;
        this.stash = null; // primary weapon, slung while using a pickup
        this.burst = 0;
        this.burstT = 0;
        this.fireCd = 0.3;
        this.muzzle = 0;
        this.recoil = 0;
        this.reloadT = 0;
        this.grenades = plan.personality === 'grenadier' ? 6 : 4;
        this.grenadeCd = 1.5;
        this.throwT = 0;
        this.throwTarget = 0;
        this.meleeT = 0;
        this.meleeCd = 0;
        this.slashT = 0;
        this.lungeT = 0;
        this.thinkT = 0;
        this.crouchT = 0;
        this.landT = 0;
        this.pendingJump = null;
        this.hunterJumpCd = 0;

        if (plan.entrance === 'popup') {
            // Spring up from behind the dock.
            this.y = -this.h - 2;
            this.vy = 160;
            this.onGround = false;
        } else if (plan.entrance === 'pod' || plan.entrance === 'pelican') {
            this.visible = false;
            this.state = 'arriving';
        } else {
            this.groundVx = this.dir * CHIEF_SPEED;
        }
    }

    get cfg() {
        return WEAPONS[this.weapon];
    }

    // [top, legs] sprite names for the renderer.
    get top() {
        if (this.state === 'victory' && this.plan.victory === 'fistpump')
            return 'victory';
        if (this.throwT > 0)
            return 'throw';
        if (this.meleeT > 0 || this.slashT > 0)
            return 'melee';
        if (this.reloadT > 0)
            return 'reload';
        return 'aim';
    }

    get legs() {
        if (!this.onGround)
            return this.vy > 0 ? 'rise' : 'fall';
        if (this.crouchT > 0 || this.landT > 0)
            return 'crouch';
        if (this.state === 'victory' && this.bagging)
            return Math.floor(this.stateT * 7) % 2 ? 'crouch' : 'stand';
        return Math.abs(this.groundVx) > 3 ? 'run' : 'stand';
    }

    get runFrame() {
        return Math.floor(this.stride / STRIDE) % 4;
    }

    get moving() {
        return Math.abs(this.groundVx) > 3;
    }

    get atEdge() {
        return (this.dir > 0 && this.x >= this.world.W - 12) || (this.dir < 0 && this.x <= 12);
    }

    // In position: always true unless this battle has a spot to hold.
    get holding() {
        return this.plan.holdX === null || (this.onScreen && Math.abs(this.x - this.plan.holdX) < 6);
    }

    // Arrival by pod or Pelican.
    arrive(x, y) {
        this.visible = true;
        this.state = 'fight';
        this.x = x;
        this.y = y;
        if (y > 0) {
            this.onGround = false;
            this.vy = 0;
        }
    }

    // Jumps start with a brief crouch for anticipation.
    jump(vx = 0, vy = 110, crouch = 0.06) {
        if (!this.onGround || this.pendingJump)
            return;
        this.pendingJump = {vx, vy};
        this.crouchT = crouch;
    }

    // The Chief always wins: hits drain his shield but never below a sliver.
    takeHit(amount) {
        if (!this.visible)
            return;
        const before = this.shield;
        this.shield = Math.max(0.08, this.shield - amount);
        this.shieldDelay = 2.2;
        this.flash = 0.12;
        this.flare = 0.4;
        if (this.onGround)
            this.x -= this.facing * 1.5;
        if (before >= 0.25 && this.shield < 0.25)
            burst(this.world, this.x, this.y + this.h * 0.6, 14, COLORS.shieldFlare, {speed: 55, up: 55});
    }

    update(dt) {
        const w = this.world;
        this.anim += dt;
        this.flash = Math.max(0, this.flash - dt);
        this.flare = Math.max(0, this.flare - dt);
        this.muzzle = Math.max(0, this.muzzle - dt);
        this.recoil = Math.max(0, this.recoil - dt);
        this.meleeT = Math.max(0, this.meleeT - dt);
        this.slashT = Math.max(0, this.slashT - dt);
        this.landT = Math.max(0, this.landT - dt);
        this.hunterJumpCd -= dt;
        this.shieldDelay -= dt;
        if (this.shieldDelay <= 0)
            this.shield = Math.min(1, this.shield + 0.45 * dt);
        else if (this.shield < 0.25 && w.rng.chance(dt * 6))
            burst(w, this.x + w.rng.range(-4, 4), this.y + w.rng.range(4, 16), 1, COLORS.shieldFlare, {speed: 15, up: 25, life: [0.2, 0.4]});

        if (this.reloadT > 0) {
            const before = this.reloadT;
            this.reloadT -= dt;
            if (before > 0.55 && this.reloadT <= 0.55 && !this.cfg.battery) // the empty mag drops out
                burst(w, this.x + this.facing * 2, this.y + 6, 1, ['#2a2a30'], {speed: 8, up: 10, life: [0.9, 1.1], size: 2});
            if (this.reloadT <= 0)
                this.ammo = this.cfg.mag;
        }

        if (this.pendingJump) {
            this.crouchT -= dt;
            if (this.crouchT <= 0) {
                const {vx, vy} = this.pendingJump;
                this.pendingJump = null;
                this.onGround = false;
                this.vx = vx;
                this.vy = vy;
                this.groundVx = 0;
                burst(w, this.x, 0, 2, COLORS.dust, {speed: 20, up: 12, life: [0.2, 0.35]});
            }
        }

        if (!this.onGround) {
            this.vy -= GRAVITY * dt;
            this.y += this.vy * dt;
            this.x += this.vx * dt;
            if (this.y <= 0 && this.vy < 0 && !this.noGround) {
                const hard = this.vy < -80;
                this.y = 0;
                this.vy = 0;
                this.groundVx = this.vx * 0.5;
                this.vx = 0;
                this.onGround = true;
                this.landT = hard ? 0.12 : 0.07;
                burst(w, this.x, 0, hard ? 6 : 3, COLORS.dust, {speed: 28, up: 16, life: [0.2, 0.45]});
            }
        }

        switch (this.state) {
        case 'fight':
            this._fight(dt);
            // Only fence him in once he has run on screen.
            if (this.onScreen)
                this.x = Math.max(4, Math.min(w.W - 4, this.x));
            else
                this.onScreen = this.x >= 4 && this.x <= w.W - 4;
            break;
        case 'victory':
            this._victory(dt);
            break;
        case 'exit':
            this._move(dt, this.facing * CHIEF_SPEED * 1.3);
            if (this.x < -16 || this.x > w.W + 16)
                w.done = true;
            break;
        case 'evac':
            this._evac(dt);
            break;
        case 'popdown':
            if (this.y < -this.h - 6)
                w.done = true;
            break;
        case 'gone':
            if (this.evac?.remove ?? true)
                w.done = true;
            break;
        }
    }

    // Eased ground movement; the run cycle advances with distance covered,
    // so feet never skate.
    _move(dt, target) {
        if (!this.onGround || this.pendingJump)
            return;
        this.groundVx = approach(this.groundVx, target * this.p.speed, ACCEL * dt);
        const step = this.groundVx * dt;
        this.x += step;
        this.stride += Math.abs(step);
        if (this.stride >= this.nextStep) {
            this.nextStep += STRIDE * 2;
            burst(this.world, this.x - this.facing * 2, 0, 1, COLORS.dust, {speed: 10, up: 8, life: [0.2, 0.35]});
        }
    }

    _fight(dt) {
        const w = this.world;
        this.grenadeCd -= dt;
        this.fireCd -= dt;
        this.meleeCd -= dt;
        this.thinkT -= dt;

        this._dodge();
        if (!this.onGround || this.pendingJump) {
            this._move(dt, 0);
            // Keep firing mid-air (e.g. down into a Hunter's back while vaulting it).
            const t = this.onGround ? null : this._pickTarget();
            if (t && !this.cfg.melee && Math.abs(t.x - this.x) <= this.cfg.range * this.p.range) {
                this.facing = Math.sign(t.x - this.x) || this.facing;
                this._shoot(dt);
            }
            return;
        }

        if (this.throwT > 0) {
            this._move(dt, 0);
            const before = this.throwT;
            this.throwT -= dt;
            if (before > 0.15 && this.throwT <= 0.15)
                this._releaseGrenade();
            return;
        }

        const target = this._pickTarget();
        if (!target) {
            this._endBurst();
            this.lungeT = 0;
            if (w.director.done && !w.enemies.some(e => e.threat)) {
                this._startVictory();
                return;
            }
            if (this.ammo < this.cfg.mag / 2 && this.reloadT <= 0 && !this.cfg.battery)
                this.reloadT = this.cfg.reload;
            this._idle(dt);
            return;
        }

        const dx = target.x - this.x;
        const dist = Math.abs(dx);
        this.facing = Math.sign(dx) || this.facing;

        if (this.cfg.melee) {
            this._sword(dt, target, dist);
            return;
        }

        if (dist < this.p.melee && this.meleeCd <= 0) {
            this.meleeT = 0.2;
            this.meleeCd = 0.9;
            target.hit(3, {type: 'melee', dir: this.facing});
            burst(w, target.x, target.y + target.h * 0.6, 5, COLORS.spark, {speed: 35, up: 35});
            this._move(dt, 0);
            return;
        }

        if (this.thinkT <= 0) {
            this.thinkT = 0.4;
            if (this.grenadeCd <= 0 && this.grenades > 0 && dist > 30 && dist < 120 &&
                this._wantsGrenade(target)) {
                this.throwT = 0.35;
                this.throwTarget = target.x;
                this.grenadeCd = w.rng.range(3.5, 6) / Math.sqrt(this.p.nade);
                this._endBurst();
                return;
            }
        }

        if (dist > this.cfg.range * this.p.range) {
            this._move(dt, this.facing * CHIEF_SPEED);
            return;
        }
        this._move(dt, 0);
        this._shoot(dt);
    }

    // Nothing to shoot: grab a weapon, hold position, or press on.
    _idle(dt) {
        const w = this.world;
        const pickup = this._wantedPickup();
        if (pickup) {
            const dx = pickup.x - this.x;
            this.facing = Math.sign(dx) || this.facing;
            if (Math.abs(dx) < 4)
                this._take(pickup);
            else
                this._move(dt, this.facing * CHIEF_SPEED);
            return;
        }
        if (this.plan.holdX !== null && this.onScreen) {
            const dx = this.plan.holdX - this.x;
            if (Math.abs(dx) > 3) {
                this.facing = Math.sign(dx);
                this._move(dt, this.facing * CHIEF_SPEED);
                return;
            }
            // Standing guard: glance both ways.
            this._move(dt, 0);
            this.lookT -= dt;
            if (this.lookT <= 0) {
                this.facing = -this.facing;
                this.lookT = w.rng.range(1.2, 2.6);
            }
            return;
        }
        this.facing = this.dir;
        if (this.atEdge && this.onScreen) {
            this._move(dt, 0);
        } else {
            this._move(dt, this.dir * CHIEF_SPEED);
            if (w.rng.chance(dt * this.p.hop))
                this.jump(this.dir * 35);
        }
    }

    // Threats get priority: kamikazes, and snipers drawing a bead on him.
    // Anything beyond reach still counts (at a penalty), so he hunts down
    // stragglers like distant snipers instead of waiting them out.
    _pickTarget() {
        const reach = Math.max(150, (this.cfg.range ?? 0) + 30);
        let best = null, bestScore = Infinity;
        for (const e of this.world.enemies) {
            if (!e.hittable || e.state === 'retreat' || !e.entered)
                continue;
            const d = Math.abs(e.x - this.x);
            const score = d + (d > reach ? 1000 : 0) - (e.kamikaze ? 80 : 0) - (e.sniper && e.aimT > 0 ? 40 : 0);
            if (score < bestScore) {
                best = e;
                bestScore = score;
            }
        }
        return best;
    }

    _wantsGrenade(target) {
        const w = this.world, r = w.rng;
        const cluster = w.enemies.filter(e => e.hittable && Math.abs(e.x - target.x) < 24).length;
        let p = 0.04;
        if (cluster >= 3)
            p = 0.8;
        else if (target.kind === 'hunter')
            p = 0.6;
        else if (target.kind === 'jackal' && target.shieldUp)
            p = 0.45;
        else if (target.kind === 'elite' && target.variant !== 'minor')
            p = 0.3;
        return r.chance(Math.min(0.95, p * this.p.nade));
    }

    _endBurst() {
        if ((this.burst > 0 || this.muzzle > 0) && !this.cfg.melee) {
            // A wisp of smoke from the hot barrel.
            const [mx, my] = this.cfg.muzzle;
            burst(this.world, this.x + this.facing * mx, this.y + my + 1, 2, COLORS.smoke,
                {speed: 4, up: 14, life: [0.5, 0.8], gravity: -0.12});
        }
        this.burst = 0;
    }

    _shoot(dt) {
        const w = this.world, r = w.rng, cfg = this.cfg;
        if (this.reloadT > 0)
            return;
        if (this.ammo <= 0) {
            this._endBurst();
            if (cfg.battery)
                this._discard();
            else
                this.reloadT = cfg.reload;
            return;
        }
        if (this.burst > 0) {
            this.burstT -= dt;
            if (this.burstT <= 0) {
                const [mx, my] = cfg.muzzle;
                const pellets = cfg.pellets ?? 1;
                for (let i = 0; i < pellets; i++) {
                    w.shots.push(new Shot(this.x + this.facing * mx, this.y + my + r.range(-cfg.spread, cfg.spread),
                        this.facing * cfg.speed * (pellets > 1 ? r.range(0.85, 1.1) : 1),
                        'chief', cfg.shot, cfg.dmg, cfg.life ?? 4, !!cfg.pierce));
                }
                if (cfg.casing) // spent casing flicks out the side
                    burst(w, this.x + this.facing * 2, this.y + 9, 1, ['#d8b040'], {speed: 20, up: 45, life: [0.3, 0.5]});
                this.muzzle = 0.05;
                this.recoil = 0.05 * (1 + cfg.recoil);
                this.ammo--;
                this.burst--;
                this.burstT = cfg.gap;
                if (this.burst === 0)
                    this._endBurst();
            }
        } else if (this.fireCd <= 0) {
            this.burst = Math.min(this.ammo, r.int(...cfg.burst));
            this.burstT = 0;
            this.fireCd = r.range(...cfg.cd) + this.burst * cfg.gap;
        }
    }

    // Energy sword: lunge in and cleave everything in front.
    _sword(dt, target, dist) {
        const w = this.world;
        if (this.lungeT > 0) {
            this.lungeT -= dt;
            if (dist > 8)
                this.x += this.facing * 130 * dt;
            if (dist < 11 && this.meleeCd <= 0)
                this._slash();
            return;
        }
        if (dist < 11 && this.meleeCd <= 0) {
            this._move(dt, 0);
            this._slash();
        } else if (dist < this.cfg.range && this.meleeCd <= 0) {
            this.lungeT = 0.3;
            burst(w, this.x, 2, 3, COLORS.dust, {speed: 25, up: 10, life: [0.2, 0.3]});
        } else {
            this._move(dt, this.facing * CHIEF_SPEED * 1.2);
        }
    }

    _slash() {
        const w = this.world;
        for (const e of w.enemies) {
            const dx = e.x - this.x;
            if (e.hittable && Math.abs(dx) < 16 && (Math.sign(dx) === this.facing || Math.abs(dx) < 5))
                e.hit(this.cfg.dmg, {type: 'melee', dir: this.facing});
        }
        burst(w, this.x + this.facing * 8, this.y + 10, 8, ['#a8f8ff', '#3ac8ff', '#ffffff'], {speed: 45, up: 40, life: [0.15, 0.35]});
        this.slashT = 0.2;
        this.lungeT = 0;
        this.meleeCd = 0.45;
        if (--this.ammo <= 0)
            this._discard();
    }

    _releaseGrenade() {
        const w = this.world;
        w.grenades.push(Grenade.aimed(this.x - this.facing, this.y + 16, this.throwTarget, 'chief', 'frag'));
        this.grenades--;
    }

    // Toss a spent pickup and sling the primary back into his hands.
    _discard() {
        this.world.dropPickup(this.weapon, this.x, this.y + 8, 0, true);
        if (this.stash) {
            this.weapon = this.stash;
            this.stash = null;
        }
        this.ammo = 0;
        this.reloadT = 0.5;
    }

    _wantedPickup() {
        const r = this.world.rng;
        let best = null, bestD = 70;
        for (const p of this.world.pickups) {
            if (p.empty || !p.onGround || p.weapon === this.weapon)
                continue;
            if (p.wanted === null) {
                const want = p.weapon === 'sword' ? this.p.sword : this.p.plasma;
                p.wanted = r.chance(this.cfg.battery ? want * 0.4 : want);
            }
            const d = Math.abs(p.x - this.x);
            if (p.wanted && d < bestD) {
                best = p;
                bestD = d;
            }
        }
        return best;
    }

    _take(p) {
        const w = this.world;
        if (this.cfg.battery)
            w.dropPickup(this.weapon, this.x, this.y + 8, this.ammo, false);
        else
            this.stash = this.weapon;
        this.weapon = p.weapon;
        this.ammo = p.ammo;
        this.reloadT = 0;
        p.remove = true;
        w.stats.pickups++;
        burst(w, this.x, this.y + 8, 6, ['#ffffff', '#a8f8ff'], {speed: 25, up: 30, life: [0.2, 0.4]});
    }

    // Hop over plasma, away from grenades and kamikazes, over charging
    // Hunters, and out of a sniper's beam.
    _dodge() {
        const w = this.world, r = w.rng;
        if (!this.onGround || this.throwT > 0 || this.pendingJump)
            return;
        for (const s of w.shots) {
            if (s.owner !== 'enemy' || s.judged)
                continue;
            const dx = s.x - this.x;
            if (Math.sign(s.vx) === -Math.sign(dx) && Math.abs(dx) < 36 && s.y < this.y + this.h) {
                s.judged = true;
                if (r.chance(0.55)) {
                    this.jump(0, 110, 0.04);
                    return;
                }
            }
        }
        for (const g of w.grenades) {
            if (g.owner === 'chief' || g.judged)
                continue;
            g.judged = true;
            const lx = g.landingX();
            if (Math.abs(lx - this.x) < 28) {
                this.jump((Math.sign(this.x - lx) || -this.facing) * 55, 100, 0.04);
                return;
            }
        }
        for (const e of w.enemies) {
            if (e.state !== 'fight')
                continue;
            const dx = e.x - this.x;
            if (e.kamikaze && !e.chiefJudged && Math.abs(dx) < 24) {
                e.chiefJudged = true;
                this.jump(-Math.sign(dx) * 60, 100, 0.03);
                return;
            }
            if (e.kind === 'hunter' && (e.windupT > 0 || e.chargeT > 0) && this.hunterJumpCd <= 0 &&
                Math.abs(dx) < 45 && Math.sign(-dx) === e.facing) {
                // Usually vault clean over it and land behind its armour.
                this.hunterJumpCd = 1.2;
                if (r.chance(0.7)) {
                    this.jump(Math.sign(dx) * 75, 130, 0.03);
                    return;
                }
            }
            if (e.sniper && e.aimT > 0.8 && !e.sniperJudged) {
                e.sniperJudged = true;
                if (r.chance(0.6)) {
                    this.jump(0, 110, 0.02);
                    return;
                }
            }
        }
    }

    _startVictory() {
        const w = this.world;
        this.state = 'victory';
        this.bagging = false;
        this.bagX = null;
        this.stateT = 0;
        if (this.plan.victory === 'teabag') {
            let best = null, bestD = 70;
            for (const e of w.enemies) {
                const d = Math.abs(e.x - this.x);
                if (e.state === 'dead' && d < bestD) {
                    best = e;
                    bestD = d;
                }
            }
            this.bagX = best ? best.x : null;
        }
        if (this.plan.victory === 'reload' && !this.cfg.battery)
            this.reloadT = this.cfg.reload;
    }

    _victory(dt) {
        const style = this.plan.victory;
        if (style === 'teabag' && this.bagX !== null && !this.bagging) {
            const dx = this.bagX - this.x;
            if (Math.abs(dx) > 2) {
                this.facing = Math.sign(dx);
                this._move(dt, this.facing * CHIEF_SPEED);
                return;
            }
            this.bagging = true;
        }
        this._move(dt, 0);
        this.stateT += dt;
        if (style === 'look' && Math.floor(this.stateT / 0.45) !== Math.floor((this.stateT - dt) / 0.45))
            this.facing = -this.facing;
        if (this.stateT >= 1.6)
            this._startExit();
    }

    _startExit() {
        const w = this.world;
        this.bagging = false;
        switch (this.plan.exit) {
        case 'pelican': {
            this.state = 'evac';
            const toX = Math.max(40, Math.min(w.W - 40, this.x));
            const from = this.dir > 0 ? -60 : w.W + 60;
            this.evac = new Flyer(w, 'pelican', from, toX, 40, [], {hold: true});
            w.flyers.push(this.evac);
            break;
        }
        case 'popdown':
            // Hop back down behind the dock.
            this.state = 'popdown';
            this.noGround = true;
            this.onGround = true;
            this.jump(this.dir * 15, 70, 0.05);
            break;
        default:
            this.state = 'exit';
            this.facing = this.plan.exit === 'runback' ? -this.dir : this.dir;
        }
    }

    _evac(dt) {
        const f = this.evac;
        if (!this.onGround) {
            if (this.vy < 0 || this.y > f.y - 8) {
                // Aboard.
                this.visible = false;
                this.state = 'gone';
                f.hold = false;
            }
            return;
        }
        const dx = f.toX - this.x;
        if (Math.abs(dx) > 2) {
            this.facing = Math.sign(dx);
            this._move(dt, this.facing * CHIEF_SPEED);
        } else {
            this._move(dt, 0);
            this.facing = f.facing;
            if (f.phase === 'hover') {
                this.noGround = true;
                this.jump(0, 165, 0.08);
            }
        }
    }
}
