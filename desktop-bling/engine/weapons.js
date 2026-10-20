// Chief's weapons. `shot` picks the projectile look; `muzzle` is [x, altitude]
// of the barrel tip relative to the Chief. Battery weapons (picked up from
// Elites) can't be reloaded and get tossed when empty.
export const WEAPONS = {
    ar: {
        muzzle: [8, 7.5],
        name: 'Assault Rifle', mag: 32, burst: [3, 5], gap: 0.08, cd: [0.45, 0.9],
        dmg: 1, speed: 280, range: 100, spread: 0.6, reload: 0.9, shot: 'bullet', recoil: 0.5, casing: true,
    },
    br: {
        muzzle: [9, 7.5],
        name: 'Battle Rifle', mag: 36, burst: [3, 3], gap: 0.06, cd: [0.55, 0.85],
        dmg: 1.4, speed: 340, range: 130, spread: 0.15, reload: 1.0, shot: 'bullet', recoil: 0.5, casing: true,
    },
    shotgun: {
        muzzle: [8, 8.5],
        name: 'Shotgun', mag: 6, burst: [1, 1], gap: 0, cd: [0.8, 1.05], pellets: 5,
        dmg: 0.9, speed: 240, range: 42, spread: 2.2, life: 0.28, reload: 1.4, shot: 'pellet', recoil: 1, casing: true,
    },
    sniper: {
        muzzle: [11, 7.5],
        name: 'Sniper Rifle', mag: 4, burst: [1, 1], gap: 0, cd: [1.3, 1.8],
        dmg: 8, speed: 900, range: 210, spread: 0, reload: 1.6, shot: 'sniper', pierce: true, recoil: 1, casing: true,
    },
    plasma: {
        muzzle: [8, 7.5],
        name: 'Plasma Rifle', mag: 40, burst: [4, 6], gap: 0.1, cd: [0.4, 0.7], battery: true,
        dmg: 1.1, speed: 200, range: 90, spread: 0.8, shot: 'plasma-blue', recoil: 0, casing: false,
    },
    sword: {
        name: 'Energy Sword', mag: 8, battery: true, melee: true, dmg: 10, range: 46,
    },
};

export const LOADOUTS = [['ar', 4], ['br', 3], ['shotgun', 2], ['sniper', 1.2]];
