#!/bin/bash
# Runs the extension inside a throwaway headless GNOME Shell, fully isolated
# from your real session: private D-Bus, private dirs, keyfile GSettings
# backend (never your dconf). A sandbox-only helper extension turns on
# unsafe mode so we can drive the shell via Eval and take screenshots.
#
#   dev/sandbox.sh shots [out-dir]   screenshots of a seeded fight + error check
#   dev/sandbox.sh bench [out-dir]   gnome-shell CPU idle vs. continuous combat
#   env: FPS=15 sets the frame-rate setting; TIMER_LOOP=true A/Bs a GLib timer loop
set -euo pipefail

UUID=taskbar-spartan@desktop-bling.local
SRC="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" != --inner ]]; then
    MODE="${1:-shots}"
    OUT="$(mkdir -p "${2:-$SRC/sandbox-out}" && cd "${2:-$SRC/sandbox-out}" && pwd)"
    # Short path: Wayland socket paths must fit in 108 bytes.
    SBX="$(mktemp -d /tmp/spartan-sbx.XXXXXX)"
    trap 'rm -rf "${SBX:?}"' EXIT
    mkdir -p "$SBX"/{config,cache,run,data/gnome-shell/extensions/unsafe-helper@test}
    chmod 700 "$SBX/run"
    ln -s "$SRC" "$SBX/data/gnome-shell/extensions/$UUID"
    cat > "$SBX/data/gnome-shell/extensions/unsafe-helper@test/metadata.json" <<'EOF'
{"uuid": "unsafe-helper@test", "name": "sandbox helper", "description": "sandbox only", "shell-version": ["50"]}
EOF
    cat > "$SBX/data/gnome-shell/extensions/unsafe-helper@test/extension.js" <<'EOF'
export default class { enable() { global.context.unsafe_mode = true; } disable() {} }
EOF
    glib-compile-schemas "$SRC/schemas"
    # Everything below, including the private bus daemon, inherits this env.
    env -u WAYLAND_DISPLAY -u DISPLAY -u DBUS_SESSION_BUS_ADDRESS \
        XDG_CONFIG_HOME="$SBX/config" XDG_DATA_HOME="$SBX/data" XDG_CACHE_HOME="$SBX/cache" \
        XDG_RUNTIME_DIR="$SBX/run" GSETTINGS_BACKEND=keyfile \
        GSETTINGS_SCHEMA_DIR="$SRC/schemas:/usr/share/glib-2.0/schemas" XDG_CURRENT_DESKTOP=ubuntu:GNOME \
        TIMER_LOOP="${TIMER_LOOP:-false}" FPS="${FPS:-}" dbus-run-session -- "$0" --inner "$MODE" "$OUT" 2> >(grep -v dbus-daemon >&2) || true
    exit 0
fi

MODE="$2"
OUT="$3"
TIMER_LOOP="${TIMER_LOOP:-false}"
gsettings set org.gnome.shell enabled-extensions "['$UUID', 'unsafe-helper@test']"
# Match a bottom, full-width Ubuntu dock.
for kv in 'dock-position BOTTOM' 'extend-height true' 'dock-fixed true' 'dash-max-icon-size 24'; do
    # shellcheck disable=SC2086
    gsettings set org.gnome.shell.extensions.dash-to-dock $kv
done
[[ -n "${FPS:-}" ]] && gsettings set org.gnome.shell.extensions.taskbar-spartan frame-rate "$FPS"
gnome-shell --headless --wayland --mode=ubuntu --virtual-monitor 1920x1080 > "$OUT/shell.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; wait $PID 2>/dev/null' EXIT
sleep 12

EVAL() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1"
}
EXT="Main.extensionManager.lookup('$UUID')"
shot() {
    gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.Screenshot false false "$1" > /dev/null
}
cpu() { awk '{print $14 + $15}' "/proc/$PID/stat"; }
measure() { local a b; a=$(cpu); sleep 20; b=$(cpu); echo "scale=2; ($b - $a) / 20" | bc; }

echo "extension state: $(EVAL "$EXT.state + ' ' + $EXT.error")"
case "$MODE" in
shots)
    echo "ground y: $(EVAL "const wa = Main.layoutManager.getWorkAreaForMonitor(0); wa.y + wa.height")"
    EVAL "$EXT.stateObj.deploy(true, 12); 1" > /dev/null
    for i in 1 2 3 4 5 6; do
        sleep 2
        shot "$OUT/shot$i.png"
    done
    echo "status: $(EVAL "$EXT.stateObj.statusText()")"
    EVAL "Main.extensionManager.disableExtension('$UUID'); 1" > /dev/null
    sleep 1
    echo "after disable, state: $(EVAL "$EXT.state")"
    ;;
bench)
    echo "idle: $(measure)% cpu"
    EVAL "const ext = $EXT.stateObj, G = imports.gi.GLib;
        globalThis.__p = {us: 0, n: 0};
        const orig = ext._frame.bind(ext);
        ext._frame = () => { const t = G.get_monotonic_time(); orig(); __p.us += G.get_monotonic_time() - t; __p.n++; };
        if ($TIMER_LOOP) ext._startLoop = function () {  // A/B: plain GLib timer instead of the frame clock
            this._stopLoop(); this._stage.show(); this._lastFrame = G.get_monotonic_time();
            this._stepUs = 1e6 / this.settings.get_int('frame-rate');
            this._pollId = G.timeout_add(0, Math.round(this._stepUs / 1000), () => { this._frame(); return !!this._world; });
        };
        let seed = 1; ext.deploy(true, seed++);
        G.timeout_add(0, 200, () => { if (!ext._world) ext.deploy(true, seed++); return true; }); 1" > /dev/null
    sleep 1
    echo "combat: $(measure)% cpu"
    echo "frame callbacks: $(EVAL "JSON.stringify({perSecond: (__p.n / 21).toFixed(1), avgUs: (__p.us / __p.n).toFixed(0)})")"
    ;;
esac
echo "JS errors in shell log: $(grep -ciE 'JS ERROR|CRITICAL|Stack trace' "$OUT/shell.log" || true)"
