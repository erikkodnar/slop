import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {World, ART_HEIGHT} from './engine/world.js';
import {drawWorld} from './render/renderer.js';
import {ActorPainter} from './render/actors.js';

const BLOCKED_POLL_SECONDS = 1;
const RETRY_SECONDS = 60;

const SpartanIndicator = GObject.registerClass(
class SpartanIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.0, 'Taskbar Spartan');
        this._ext = ext;
        this.add_child(new St.Icon({
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(`${ext.path}/icons/spartan-symbolic.svg`)),
            style_class: 'system-status-icon',
        }));

        const deploy = new PopupMenu.PopupMenuItem('Deploy Spartan now');
        deploy.connect('activate', () => ext.deploy(true));
        this.menu.addMenuItem(deploy);

        this._status = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._status);

        this._pause = new PopupMenu.PopupSwitchMenuItem('Pause deployments', ext.settings.get_boolean('paused'));
        this._pause.connect('toggled', (_item, state) => ext.settings.set_boolean('paused', state));
        this.menu.addMenuItem(this._pause);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const prefs = new PopupMenu.PopupMenuItem('Settings');
        prefs.connect('activate', () => ext.openPreferences());
        this.menu.addMenuItem(prefs);

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this.refresh();
        });
    }

    refresh() {
        this._pause.setToggleState(this._ext.settings.get_boolean('paused'));
        this._status.label.text = this._ext.statusText();
    }
});

export default class TaskbarSpartanExtension extends Extension {
    enable() {
        this.settings = this.getSettings();
        this._world = null;
        this._painter = null;
        this._timeline = null;
        this._pollId = 0;
        this._scheduleId = 0;
        this._nextAt = 0;
        this._monitorIndex = Main.layoutManager.primaryIndex;
        this._lastFrame = 0;
        this._lastKills = 0;

        // Non-reactive, so clicks pass straight through to the dock and windows
        // underneath. Clipped so units rising from "behind" the dock stay hidden.
        this._stage = new Clutter.Actor({reactive: false, visible: false, clip_to_allocation: true});
        this._stage.connect('destroy', () => {
            // The shell can tear chrome down on exit before disable() runs.
            this._stopLoop();
            this._stage = null;
        });
        Main.layoutManager.addTopChrome(this._stage);

        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._abort());
        this._workareasId = global.display.connect('workareas-changed', () => this._abort());
        this._settingsIds = [
            this.settings.connect('changed::show-indicator', () => this._syncIndicator()),
            this.settings.connect('changed::min-interval', () => !this._world && this._schedule()),
            this.settings.connect('changed::max-interval', () => !this._world && this._schedule()),
            this.settings.connect('changed::paused', () => this._indicator?.refresh()),
        ];
        this._syncIndicator();
        this._schedule();
    }

    disable() {
        this._stopEncounter();
        this._clearSchedule();
        Main.layoutManager.disconnect(this._monitorsId);
        global.display.disconnect(this._workareasId);
        for (const id of this._settingsIds)
            this.settings.disconnect(id);
        this._indicator?.destroy();
        this._indicator = null;
        if (this._stage) {
            Main.layoutManager.removeChrome(this._stage);
            this._stage.destroy();
        }
        this.settings = null;
    }

    statusText() {
        if (this._world)
            return `Spartan deployed — ${this._world.stats.kills} kills\n${this._world.director.describe()}`;
        if (this.settings.get_boolean('paused'))
            return 'Deployments paused';
        const mins = Math.max(0, Math.ceil((this._nextAt - GLib.get_monotonic_time()) / 60e6));
        return `Next drop in ~${mins} min${mins === 1 ? '' : 's'}` +
            (this._lastKills ? ` (last run: ${this._lastKills} kills)` : '');
    }

    _syncIndicator() {
        const want = this.settings.get_boolean('show-indicator');
        if (want && !this._indicator) {
            this._indicator = new SpartanIndicator(this);
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        } else if (!want && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _clearSchedule() {
        if (this._scheduleId) {
            GLib.source_remove(this._scheduleId);
            this._scheduleId = 0;
        }
    }

    _schedule(seconds) {
        this._clearSchedule();
        if (seconds === undefined) {
            const a = this.settings.get_int('min-interval');
            const b = Math.max(a, this.settings.get_int('max-interval'));
            seconds = (a + Math.random() * (b - a)) * 60;
        }
        seconds = Math.max(1, Math.round(seconds));
        this._nextAt = GLib.get_monotonic_time() + seconds * 1e6;
        this._scheduleId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._scheduleId = 0;
            this.deploy(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _blocked() {
        const monitor = Main.layoutManager.monitors[this._monitorIndex];
        return Main.overview.visible || Main.sessionMode.isLocked || !monitor || monitor.inFullscreen;
    }

    // seed is only for reproducible benchmarks; normally every drop is fresh.
    deploy(manual, seed) {
        if (this._world || !this._stage)
            return;
        if (!manual && this.settings.get_boolean('paused')) {
            this._schedule();
            return;
        }

        const monitors = Main.layoutManager.monitors;
        this._monitorIndex = this.settings.get_string('monitor') === 'random'
            ? Math.floor(Math.random() * monitors.length)
            : Main.layoutManager.primaryIndex;
        if (!manual && this._blocked()) {
            this._schedule(RETRY_SECONDS);
            return;
        }

        this._clearSchedule();
        const scale = this.settings.get_int('scale');
        const width = this._place(scale);
        this._painter = new ActorPainter(this._stage, scale, ART_HEIGHT);
        this._world = new World({
            width,
            seed: seed ?? (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0,
            maxEnemies: this.settings.get_int('max-enemies'),
        });
        this._startLoop();
    }

    // Sit the strip on top of the dock: the bottom of the monitor's work area.
    _place(scale) {
        const lm = Main.layoutManager;
        const mon = lm.monitors[this._monitorIndex];
        const wa = lm.getWorkAreaForMonitor(this._monitorIndex);
        const ground = Math.min(wa.y + wa.height, mon.y + mon.height);
        const h = ART_HEIGHT * scale;
        this._stage.set_position(mon.x, ground - h);
        this._stage.set_size(mon.width, h);
        return Math.floor(mon.width / scale);
    }

    // Driven by the compositor's frame clock rather than a GLib timer, so every
    // update lands on a vblank: at 30 fps on a 60 Hz screen that is exactly every
    // second refresh, with none of the judder a free-running timer causes.
    _startLoop() {
        this._stopLoop();
        this._stage.show();
        this._lastFrame = GLib.get_monotonic_time();
        this._stepUs = 1e6 / this.settings.get_int('frame-rate');
        this._timeline = new Clutter.Timeline({actor: this._stage, duration: 1000, repeat_count: -1});
        this._timeline.connect('new-frame', () => this._frame());
        this._timeline.start();
    }

    _stopLoop() {
        if (this._timeline) {
            this._timeline.stop();
            this._timeline = null;
        }
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
    }

    _frame() {
        // While a fullscreen app, the overview or the lock screen is up, freeze
        // the fight and drop to one cheap check per second.
        if (this._blocked()) {
            this._stopLoop();
            this._stage.hide();
            this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, BLOCKED_POLL_SECONDS, () => {
                if (this._blocked())
                    return GLib.SOURCE_CONTINUE;
                this._pollId = 0;
                this._startLoop();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }

        // Skip refreshes until the next frame is due (slack absorbs clock jitter).
        const now = GLib.get_monotonic_time();
        if (now - this._lastFrame < this._stepUs - 3000)
            return;
        const dt = (now - this._lastFrame) / 1e6;
        this._lastFrame = now;
        this._world.tick(dt);

        if (this._world.done) {
            this._lastKills = this._world.stats.kills;
            this._stopEncounter();
            this._schedule();
            return;
        }

        this._painter.begin();
        drawWorld(this._painter, this._world);
        this._painter.end();
    }

    _stopEncounter() {
        this._stopLoop();
        this._world = null;
        this._painter?.destroy();
        this._painter = null;
        this._stage?.hide();
    }

    // Monitor or dock geometry changed mid-fight: retreat and try again later.
    _abort() {
        if (!this._world)
            return;
        this._stopEncounter();
        this._schedule(RETRY_SECONDS);
    }
}
