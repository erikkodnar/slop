// Headless soak test: run many random battles, check they all finish, and
// report how varied they are.
// Usage: gjs -m dev/simtest.js [count]
import {World} from '../engine/world.js';
import System from 'system';

const count = Number(ARGV[0] ?? 300);
let failures = 0, totalT = 0, totalKills = 0, maxT = 0, pickups = 0, retreated = 0;
const tally = {};
const bump = (key, v) => {
    tally[key] ??= {};
    tally[key][v] = (tally[key][v] ?? 0) + 1;
};
const signatures = new Set();

for (let seed = 1; seed <= count; seed++) {
    const width = [480, 960, 1280][seed % 3];
    const w = new World({width, seed});
    const d = w.director;
    try {
        while (!w.done)
            w.tick(1 / 30);
    } catch (e) {
        failures++;
        print(`seed ${seed}: threw ${e}\n${e.stack}`);
        continue;
    }
    if (w.t > 239) {
        failures++;
        print(`seed ${seed} (w=${width}, ${d.template}/${d.entrance}/${d.exit}): timed out; chief=${w.chief.state} x=${w.chief.x.toFixed(0)} ` +
            `beat=${d.next}/${d.beats.length} flyers=${w.flyers.length} enemies=${w.enemies.map(e => `${e.kind}:${e.state}@${e.x.toFixed(0)}`)}`);
    }
    for (const k of ['template', 'loadout', 'personality', 'entrance', 'exit', 'victory'])
        bump(k, d[k]);
    for (const s of d.skulls)
        bump('skulls', s);
    bump('skull count', d.skulls.length);
    for (const b of d.beats) {
        bump('squads', b.kind);
        bump('arrivals', b.arrival);
    }
    signatures.add(JSON.stringify([d.template, d.loadout, d.personality, d.entrance, d.exit, d.victory,
        [...d.skulls].sort(), d.beats.map(b => [b.kind, b.arrival, b.side, b.units.length])]));
    totalT += w.t;
    maxT = Math.max(maxT, w.t);
    totalKills += w.stats.kills;
    pickups += w.stats.pickups;
    if (w.stats.retreats)
        retreated++;
}
print(`${count} battles, ${failures} failures, ${signatures.size} unique, avg ${(totalT / count).toFixed(1)}s ` +
    `(max ${maxT.toFixed(1)}s), avg kills ${(totalKills / count).toFixed(1)}, weapon pickups ${pickups}, ended by retreat ${retreated}`);
for (const [k, v] of Object.entries(tally))
    print(`  ${k.padEnd(12)} ${Object.entries(v).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}:${c}`).join('  ')}`);
System.exit(failures ? 1 : 0);
