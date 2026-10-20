// Small seeded PRNG (mulberry32) so every encounter is reproducible from its seed.
export class Rng {
    constructor(seed) {
        this.s = (seed >>> 0) || 1;
    }

    next() {
        let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    range(a, b) {
        return a + (b - a) * this.next();
    }

    // Inclusive integer range.
    int(a, b) {
        return Math.floor(this.range(a, b + 1));
    }

    chance(p) {
        return this.next() < p;
    }

    pick(arr) {
        return arr[Math.floor(this.next() * arr.length)];
    }

    weighted(table) {
        let total = 0;
        for (const [, w] of table)
            total += w;
        let r = this.next() * total;
        for (const [v, w] of table) {
            if ((r -= w) < 0)
                return v;
        }
        return table[table.length - 1][0];
    }
}
