// Runs the game in a plain GTK window over a fake dock, for fast iteration
// without touching GNOME Shell. Space = new encounter, Esc = quit.
// Usage: gjs -m dev/preview.js [width] [scale] [seed]
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {World, ART_HEIGHT} from '../engine/world.js';
import {drawWorld, CairoPainter} from '../render/renderer.js';

const WIDTH = Number(ARGV[0] ?? 960);
const SCALE = Number(ARGV[1] ?? 2);
let seed = Number(ARGV[2] ?? Date.now() >>> 0);
const DOCK = 44;

const app = new Gtk.Application({application_id: 'local.desktopbling.SpartanPreview'});
app.connect('activate', () => {
    let world = null;
    const painter = new CairoPainter(SCALE, ART_HEIGHT);
    const fresh = () => {
        world = new World({width: Math.floor(WIDTH / SCALE), seed});
        print(`seed ${seed}: entrance=${world.director.entrance} dir=${world.director.dir} ` +
            `beats=${world.director.beats.map(b => b.kind).join(',')}` +
            `${world.director.birthday ? ' 🎉' : ''}`);
        seed = (seed + 1) >>> 0;
    };
    fresh();

    const area = new Gtk.DrawingArea({content_width: WIDTH, content_height: ART_HEIGHT * SCALE + DOCK});
    area.set_draw_func((_a, cr, w) => {
        cr.setSourceRGB(0.13, 0.15, 0.19);
        cr.paint();
        const top = ART_HEIGHT * SCALE;
        cr.setSourceRGB(0.09, 0.09, 0.11);
        cr.rectangle(0, top, w, DOCK);
        cr.fill();
        for (let x = 12; x < w - 30; x += 40) {
            cr.setSourceRGB(0.3 + (x % 120) / 400, 0.35, 0.5);
            cr.rectangle(x, top + 10, 24, 24);
            cr.fill();
        }
        painter.begin(cr);
        drawWorld(painter, world);
        painter.end();
        cr.$dispose();
    });

    const win = new Gtk.ApplicationWindow({application: app, title: 'Spartan preview', child: area, resizable: false});
    const keys = new Gtk.EventControllerKey();
    keys.connect('key-pressed', (_c, keyval) => {
        if (keyval === Gdk.KEY_space)
            fresh();
        else if (keyval === Gdk.KEY_Escape)
            win.close();
        return true;
    });
    win.add_controller(keys);

    let last = GLib.get_monotonic_time();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
        const now = GLib.get_monotonic_time();
        world.tick((now - last) / 1e6);
        last = now;
        if (world.done) {
            print(`  done in ${world.t.toFixed(1)}s, ${world.stats.kills} kills`);
            fresh();
        }
        area.queue_draw();
        return GLib.SOURCE_CONTINUE;
    });
    win.present();
});
app.run([]);
