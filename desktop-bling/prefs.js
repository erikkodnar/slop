import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const MONITORS = ['primary', 'random'];

export default class TaskbarSpartanPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({icon_name: 'preferences-system-symbolic'});

        const timing = new Adw.PreferencesGroup({
            title: 'Deployment',
            description: 'The Spartan drops in at a random time between these two.',
        });
        timing.add(this._spin(settings, 'min-interval', 'Minimum wait (minutes)', 1, 240));
        timing.add(this._spin(settings, 'max-interval', 'Maximum wait (minutes)', 1, 240));
        const paused = new Adw.SwitchRow({title: 'Pause automatic deployments'});
        settings.bind('paused', paused, 'active', Gio.SettingsBindFlags.DEFAULT);
        timing.add(paused);
        page.add(timing);

        const look = new Adw.PreferencesGroup({title: 'Battlefield'});
        look.add(this._spin(settings, 'scale', 'Pixel size',
            1, 4, 'Screen pixels per 8-bit pixel. Applies from the next deployment.'));
        look.add(this._spin(settings, 'max-enemies', 'Most enemies at once', 2, 16));
        look.add(this._spin(settings, 'frame-rate', 'Frame rate',
            10, 30, 'Frames per second during a fight. Lower uses less CPU.'));

        const monitor = new Adw.ComboRow({
            title: 'Monitor',
            model: Gtk.StringList.new(['Primary', 'Random each time']),
            selected: Math.max(0, MONITORS.indexOf(settings.get_string('monitor'))),
        });
        monitor.connect('notify::selected', () => settings.set_string('monitor', MONITORS[monitor.selected]));
        look.add(monitor);

        const indicator = new Adw.SwitchRow({title: 'Show top bar menu'});
        settings.bind('show-indicator', indicator, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(indicator);
        page.add(look);

        window.add(page);
    }

    _spin(settings, key, title, min, max, subtitle = '') {
        const row = Adw.SpinRow.new_with_range(min, max, 1);
        row.title = title;
        row.subtitle = subtitle;
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
}
