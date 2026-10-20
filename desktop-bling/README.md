# Taskbar Spartan

A GNOME Shell 50 extension: a tiny 8-bit Spartan pops up on top of your dock
every so often and fights a randomly generated Covenant squad — Grunts (who
panic when their Elite dies), shielded Jackals, and Elites (blue minor, red
major, gold sword-wielding zealots). He shoots in bursts, jumps plasma, and
throws frag grenades at clusters and Jackal shields.

Every battle is rolled from a fresh seed, layering independent choices:

- **Shape:** Patrol, Gauntlet, Last Stand (holds the middle against waves from
  both sides), Boss fight, or Skirmish.
- **Chief:** Assault Rifle, Battle Rifle, Shotgun or Sniper; an aggressive,
  tactical or grenadier personality; may grab an Elite's plasma rifle or
  energy sword mid-fight.
- **Enemies:** Grunts (some kamikaze), shielded Jackals and Jackal snipers,
  Elites of three ranks, and Hunter pairs (armoured front; he vaults them).
  Each unit has its own speed, fire rate, aim and nerve.
- **Arrivals:** popping up behind the dock, Spirit dropship gravity lifts,
  marching in from the edge, or Elites uncloaking.
- **Entrances / exits:** pod, Pelican, pop-up or run-in; run off, Pelican
  pickup or drop back behind the dock. Victory: fist pump, teabag, reload or a
  look around.
- **Skulls (0–2):** Catch, Thunderstorm, Mythic, Tough Luck, Grunt Birthday
  Party, Swarm, Cowbell.

The top bar menu shows the current battle, e.g. "Last Stand · Shotgun ·
Skulls: Catch". `make test` checks 300 battles all finish and reports how
many were unique (all of them, in practice) and how often each feature appears.

Fan art for personal use; Halo and its characters belong to Microsoft.

## Install

    make install      # symlinks this folder into ~/.local/share/gnome-shell/extensions
    # Wayland can't hot-load new extensions: log out and back in once, then
    make enable

Use the helmet icon in the top bar to deploy him on demand, pause, or open settings.

## Develop

    make preview      # plays encounters in a GTK window over a fake dock (Space = next)
    make test         # soak test: 300 seeded encounters must all finish cleanly
    make snapshot     # writes sheet.png (all sprites) and strip.png (gameplay frames)
    make logs         # follow gnome-shell's log
    make sandbox      # run it in a throwaway headless GNOME Shell; screenshots -> sandbox-out/
    make sandbox-bench  # CPU benchmark in the same sandbox

    gjs -m dev/bench.js   # offline per-frame cost of engine + Cairo drawing

## Performance

Inside the shell, sprites are GPU textures built once and moved purely by
transforms (no per-frame rasterizing, uploads or relayouts); the loop runs on
the compositor's frame clock so frames land evenly on vblanks; the engine
doesn't allocate in steady state; and nothing runs between drops except one
timer. Measured with `make sandbox-bench` (headless GNOME Shell 50,
1920x1080, % of one core, run-to-run noise about ±0.3):

| | gnome-shell CPU |
|---|---|
| idle | ~0.4% |
| full firefight, 30 fps | ~4% |
| full firefight, 15 fps (Settings → Frame rate) | ~2.6% |

While the overview, lock screen or a fullscreen app is up, the fight freezes
and the loop drops to one check per second.

Layout: `engine/` is pure JS with no Shell imports (simulation, AI, encounter
director); `render/` holds the sprite grids and the Cairo renderer used by
both the extension and the preview; `extension.js` owns placement on the dock,
scheduling and the panel menu.
