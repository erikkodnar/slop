import {Enemy} from './enemies.js';
import {Flyer} from './flyer.js';
import {LOADOUTS, WEAPONS} from './weapons.js';

// The director rolls the whole battle up front from the seed — its shape,
// the Chief's loadout and personality, skulls, every squad and how it
// arrives, even the victory pose and exit — then plays it out.

const TEMPLATES = [['patrol', 4], ['gauntlet', 2], ['stand', 2], ['boss', 2], ['skirmish', 1.5]];
const TEMPLATE_NAMES = {patrol: 'Patrol', gauntlet: 'Gauntlet', stand: 'Last Stand', boss: 'Boss fight', skirmish: 'Skirmish'};
const SKULLS = ['catch', 'thunderstorm', 'mythic', 'toughluck', 'birthday', 'swarm', 'cowbell'];
const SKULL_NAMES = {
    catch: 'Catch', thunderstorm: 'Thunderstorm', mythic: 'Mythic', toughluck: 'Tough Luck',
    birthday: 'Grunt Birthday Party', swarm: 'Swarm', cowbell: 'Cowbell',
};

const grunts = (r, a, b) => Array.from({length: r.int(a, b)}, () => ({kind: 'grunt'}));
const jackals = (r, a, b) => Array.from({length: r.int(a, b)}, () => ({kind: 'jackal'}));
const elite = r => ({
    kind: 'elite',
    weapon: r.chance(0.3) ? 'sword' : 'plasma',
    variant: r.chance(0.3) ? 'major' : 'minor',
});

const BEATS = {
    grunt_squad: r => grunts(r, 3, 5),
    jackal_line: r => [...jackals(r, 2, 3), ...grunts(r, 0, 1)],
    elite_lance: r => [elite(r), ...grunts(r, 2, 4)],
    brawl: r => [elite(r), ...jackals(r, 1, 2), ...grunts(r, 2, 3)],
    kamikaze_rush: r => [...grunts(r, 1, 3), ...Array.from({length: r.int(1, 2)}, () => ({kind: 'grunt', kamikaze: true}))],
    sniper_nest: r => [{kind: 'jackal', sniper: true}, ...(r.chance(0.4) ? [{kind: 'jackal', sniper: true}] : []), ...jackals(r, 1, 2)],
    zealot: r => [{kind: 'elite', weapon: 'sword', variant: 'zealot'}, {kind: 'elite'}, ...grunts(r, 2, 3)],
    honor_guard: () => [{kind: 'elite', variant: 'zealot'}, {kind: 'elite', variant: 'major'}, {kind: 'elite', variant: 'major', weapon: 'sword'}],
    hunters: r => [{kind: 'hunter'}, {kind: 'hunter'}, ...grunts(r, 0, 2)],
};
const COMMON = [['grunt_squad', 3], ['jackal_line', 2], ['elite_lance', 3], ['brawl', 2], ['kamikaze_rush', 1], ['sniper_nest', 1]];
const BOSSES = [['hunters', 3], ['zealot', 2], ['honor_guard', 1.5]];
const ARRIVALS = [['popup', 5], ['dropship', 2], ['march', 1.5]];
const FRONT_TO_BACK = {jackal: 0, grunt: 1, elite: 2, hunter: 2};
const UPGRADE = {minor: 'major', major: 'zealot', zealot: 'zealot'};

export class Director {
    constructor(world, {maxEnemies = 8} = {}) {
        const r = world.rng, W = world.W;
        this.world = world;
        this.maxEnemies = maxEnemies;

        this.template = r.weighted(TEMPLATES);
        this.dir = r.chance(0.5) ? 1 : -1;
        this.entrance = r.weighted([['popup', 3], ['pod', 3], ['run', 2], ['pelican', 2]]);
        this.loadout = r.weighted(LOADOUTS);
        this.personality = r.pick(['aggressive', 'tactical', 'grenadier']);
        this.victory = r.weighted([['fistpump', 3], ['teabag', 2], ['reload', 2], ['look', 1.5]]);
        this.exit = r.weighted([['run', 4], ['runback', 1], ['pelican', 2], ['popdown', 1.5]]);

        const nSkulls = r.weighted([[0, 4.5], [1, 4], [2, 1.5]]);
        const pool = SKULLS.slice();
        this.skulls = [];
        for (let i = 0; i < nSkulls; i++)
            this.skulls.push(pool.splice(Math.floor(r.next() * pool.length), 1)[0]);
        const has = s => this.skulls.includes(s);

        // Where the Chief plants himself (Last Stand / Skirmish), else null.
        this.holdX = this.template === 'stand' || this.template === 'skirmish' ? W * r.range(0.4, 0.6) : null;
        if (this.template === 'skirmish' && this.entrance === 'run')
            this.entrance = r.pick(['popup', 'pod', 'pelican']);

        const inset = r.range(24, 70);
        if (this.template === 'skirmish')
            this.startX = this.holdX;
        else if (this.entrance === 'run')
            this.startX = this.dir > 0 ? -10 : W + 10;
        else
            this.startX = this.dir > 0 ? inset : W - inset;

        this.beats = this._plan(r, W);
        for (const beat of this.beats) {
            if (has('swarm'))
                beat.units.push(...grunts(r, 1, 2));
            if (has('catch') && r.chance(0.3))
                beat.units.push({kind: 'grunt', kamikaze: true});
            for (const u of beat.units) {
                if (has('thunderstorm') && u.kind === 'elite')
                    u.variant = UPGRADE[u.variant ?? 'minor'];
                if (has('thunderstorm') && u.kind === 'jackal' && r.chance(0.3))
                    u.sniper = true;
                if (u.kind === 'grunt' && !u.kamikaze && (has('catch') || r.chance(0.12)))
                    u.plasmaNade = true;
                if (u.kind === 'elite' && beat.arrival !== 'dropship' && r.chance(0.25))
                    u.camo = true;
            }
        }
        this.unitOpts = {
            birthday: has('birthday'),
            dodgy: has('toughluck'),
            hpMul: has('mythic') ? 1.6 : 1,
        };

        this.next = 0;
        this.queue = [];
        this.clearT = 0;
    }

    _plan(r, W) {
        const beat = (kind, trigger, extra = {}) => ({
            kind, trigger, units: BEATS[kind](r),
            side: r.chance(0.12) ? 'behind' : 'ahead',
            arrival: r.weighted(kind === 'hunters' ? [['popup', 2], ['dropship', 3], ['march', 2]] : ARRIVALS),
            ...extra,
        });
        const along = n => {
            const from = Math.max(0, Math.min(W, this.startX)) + this.dir * 50;
            const to = this.dir > 0 ? W - 140 : 140;
            return i => from + (to - from) * (n === 1 ? 0 : i / (n - 1)) + r.range(-15, 15);
        };
        const beats = [];
        switch (this.template) {
        case 'gauntlet': {
            // Many small squads in quick succession.
            const n = Math.max(4, Math.min(8, Math.round(W / 170) + r.int(0, 2)));
            const at = along(n);
            for (let i = 0; i < n; i++) {
                const b = beat(r.weighted(COMMON), 'pos', {at: at(i)});
                b.units = b.units.slice(0, Math.max(2, Math.ceil(b.units.length * 0.7)));
                beats.push(b);
            }
            break;
        }
        case 'stand':
        case 'skirmish': {
            // Waves converge on the Chief's position from either side.
            const n = this.template === 'stand' ? r.int(3, 5) : r.int(3, 4);
            for (let i = 0; i < n; i++) {
                const last = i === n - 1;
                const kind = last && r.chance(0.35) ? r.weighted(BOSSES) : r.weighted(COMMON);
                const side = this.template === 'skirmish' && i === 0
                    ? 'both'
                    : r.weighted([['ahead', 2], ['behind', 2], ['both', 1.5]]);
                beats.push(beat(kind, 'clear', {side, delay: i === 0 ? 0.6 : r.range(0.6, 1.8)}));
            }
            break;
        }
        case 'boss': {
            const n = r.int(1, 3);
            const at = along(n + 1);
            for (let i = 0; i < n; i++)
                beats.push(beat(r.weighted(COMMON), 'pos', {at: at(i)}));
            beats.push(beat(r.weighted(BOSSES), 'pos', {at: at(n), side: 'ahead'}));
            break;
        }
        default: { // patrol
            const n = Math.max(2, Math.min(6, Math.round(W / 240) + r.int(0, 1)));
            const at = along(n);
            for (let i = 0; i < n; i++) {
                const kind = i === n - 1 && r.chance(0.2) ? r.weighted(BOSSES) : r.weighted(COMMON);
                beats.push(beat(kind, 'pos', {at: at(i)}));
            }
        }
        }
        return beats;
    }

    describe() {
        const parts = [TEMPLATE_NAMES[this.template], WEAPONS[this.loadout].name];
        if (this.skulls.length)
            parts.push(`Skulls: ${this.skulls.map(s => SKULL_NAMES[s]).join(', ')}`);
        return parts.join(' · ');
    }

    get busyFlyers() {
        let n = 0;
        for (const f of this.world.flyers) {
            if (f.kind === 'spirit' && f.drops.length)
                n += f.drops.length;
        }
        return n;
    }

    get done() {
        return this.next >= this.beats.length && this.queue.length === 0 && this.busyFlyers === 0;
    }

    update(dt) {
        const w = this.world, c = w.chief;
        for (const q of this.queue)
            q.delay -= dt;
        while (this.queue.length && this.queue[0].delay <= 0) {
            const {u, x, arrival} = this.queue.shift();
            this._spawnUnit(u, x, arrival, 0);
        }

        if (this.next >= this.beats.length || c.state !== 'fight' || !c.visible)
            return;
        const beat = this.beats[this.next];
        let active = this.queue.length + this.busyFlyers;
        for (const e of w.enemies) {
            if (e.threat)
                active++;
        }
        let go;
        if (beat.trigger === 'clear') {
            this.clearT = active === 0 ? this.clearT + dt : 0;
            go = this.clearT >= beat.delay && c.holding;
        } else {
            go = active <= 1 && ((c.x - beat.at) * this.dir >= 0 || c.atEdge);
        }
        if (go) {
            this.clearT = 0;
            this._spawn(beat);
            this.next++;
        }
    }

    _spawnUnit(u, x, arrival, y) {
        const w = this.world;
        w.enemies.push(new Enemy(w, u.kind, x, {
            ...this.unitOpts,
            weapon: u.weapon,
            variant: u.variant,
            plasmaNade: u.plasmaNade,
            kamikaze: u.kamikaze,
            sniper: u.sniper,
            arrival: u.camo && arrival === 'popup' ? 'camo' : arrival,
            y,
        }));
    }

    _spawn(beat) {
        const w = this.world, r = w.rng, c = w.chief, W = w.W;
        let alive = 0;
        for (const e of w.enemies) {
            if (e.state !== 'dead')
                alive++;
        }
        const room = Math.max(1, this.maxEnemies - alive);
        const units = beat.units.slice(0, room).sort((a, b) => FRONT_TO_BACK[a.kind] - FRONT_TO_BACK[b.kind]);

        if (beat.side === 'both') {
            this._spawnGroup(units.filter((_, i) => i % 2 === 0), this.dir, beat.arrival);
            this._spawnGroup(units.filter((_, i) => i % 2 === 1), -this.dir, r.weighted(ARRIVALS));
        } else {
            let side = beat.side === 'behind' ? -this.dir : this.dir;
            // No room on that side: they come from the other one instead.
            const probe = c.x + side * 100;
            if (probe < 20 || probe > W - 20)
                side = -side;
            this._spawnGroup(units, side, beat.arrival);
        }
    }

    _spawnGroup(units, side, arrival) {
        if (!units.length)
            return;
        const w = this.world, r = w.rng, c = w.chief, W = w.W;
        const clamp = x => Math.max(8, Math.min(W - 8, x));
        const edge = side > 0 ? W + 10 : -10;
        // Marching in from an edge only makes sense if that edge is close-ish.
        if (arrival === 'march' && Math.abs(edge - c.x) > 260)
            arrival = 'popup';

        if (arrival === 'dropship') {
            const toX = Math.max(30, Math.min(W - 30, c.x + side * r.range(85, 115)));
            const drops = units.map(u => f => this._spawnUnit(u, f.x + r.range(-6, 6), 'lift', f.y - 6));
            w.flyers.push(new Flyer(w, 'spirit', side > 0 ? W + 50 : -50, toX, r.range(38, 46), drops));
            return;
        }

        let base = clamp(c.x + side * r.range(90, 125));
        let delay = 0;
        units.forEach((u, i) => {
            let x;
            if (arrival === 'march') {
                x = edge + side * i * r.range(12, 18);
            } else {
                x = clamp(base + side * i * r.range(11, 16));
                if (u.sniper) // marksmen hang well back
                    x = clamp(x + side * r.range(60, 90));
            }
            this.queue.push({u, x, arrival, delay});
            delay += arrival === 'march' ? r.range(0.25, 0.5) : r.range(0.12, 0.25);
        });
    }
}
