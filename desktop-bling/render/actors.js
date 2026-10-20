// Shell-side painter: every draw call maps onto a pooled Clutter actor.
// Sprites become tiny GPU textures (rasterized once per sprite/flip/tint and
// cached), scaled up with nearest-neighbour filtering, so nothing is
// rasterized or uploaded per frame. Each slot shadows its actor's state in
// JS so a GObject call is only made when something actually changed; that
// keeps Mutter's damage to just the pixels that moved.
//
// Every actor is a permanent 1x1 box placed purely with transforms
// (translation + scale) and opacity: unlike set_position/set_size/show/hide,
// those never queue a relayout, which measurably halves Mutter's per-frame
// cost. Sprites and rects live in separate layers (rects on top: muzzle
// flashes, shields, particles). Unused slots are parked far off-screen at
// opacity 0 so they're culled.
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {spriteLeft, spriteTop} from './renderer.js';

const NEAREST = Clutter.ScalingFilter.NEAREST;
const PARKED = -100000;

// '#rrggbb' or '#rrggbbaa' -> [r, g, b, a] bytes
function hexBytes(hex) {
    const n = parseInt(hex.slice(1, 7), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255, hex.length > 7 ? parseInt(hex.slice(7, 9), 16) : 255];
}

class Pool {
    constructor(parent) {
        this.layer = new Clutter.Actor({reactive: false});
        parent.add_child(this.layer);
        this.slots = [];
        this.n = 0;
        this.used = 0;
    }

    next() {
        let slot = this.slots[this.n];
        if (!slot) {
            const actor = new Clutter.Actor({
                reactive: false,
                width: 1,
                height: 1,
                opacity: 0,
                translation_x: PARKED,
                translation_y: PARKED,
                minification_filter: NEAREST,
                magnification_filter: NEAREST,
            });
            this.layer.add_child(actor);
            slot = {actor, content: null, color: null, alpha: 1, x: PARKED, y: PARKED, sx: 1, sy: 1, opacity: 0};
            this.slots.push(slot);
        }
        this.n++;
        return slot;
    }

    finish() {
        for (let i = this.n; i < this.used; i++)
            place(this.slots[i], PARKED, PARKED, 1, 1, 0);
        this.used = this.n;
        this.n = 0;
    }

    destroy() {
        this.layer.destroy();
        this.slots = [];
    }
}

function place(slot, x, y, sx, sy, alpha) {
    const {actor} = slot;
    if (x !== slot.x || y !== slot.y) {
        actor.set_translation(x, y, 0);
        slot.x = x;
        slot.y = y;
    }
    if (sx !== slot.sx || sy !== slot.sy) {
        actor.set_scale(sx, sy);
        slot.sx = sx;
        slot.sy = sy;
    }
    const opacity = Math.max(0, Math.min(255, Math.round(alpha * 255)));
    if (opacity !== slot.opacity) {
        actor.opacity = opacity;
        slot.opacity = opacity;
    }
}

export class ActorPainter {
    constructor(container, scale, H) {
        this.s = scale;
        this.H = H;
        this.sprites = new Pool(container);
        this.rects = new Pool(container);
        this.textures = new Map(); // sprite -> Map(flip|tint -> St.ImageContent)
        this.colors = new Map();
        this.ox = 0;
        this.oy = 0;
        this.cogl = global.stage.context.get_backend().get_cogl_context();
    }

    begin() {
    }

    // Whole-scene offset (screen shake): move the two layers, not every actor.
    offset(ox, oy) {
        const x = Math.round(ox * this.s), y = Math.round(oy * this.s);
        if (x !== this.ox || y !== this.oy) {
            this.sprites.layer.set_translation(x, y, 0);
            this.rects.layer.set_translation(x, y, 0);
            this.ox = x;
            this.oy = y;
        }
    }

    // Park whatever was drawn last frame but not this one.
    end() {
        this.sprites.finish();
        this.rects.finish();
    }

    destroy() {
        this.sprites.destroy();
        this.rects.destroy();
        this.textures.clear();
        this.colors.clear();
    }

    row(y) {
        return this.H - y;
    }

    rect(x, y, w, h, hex, a) {
        const slot = this.rects.next();
        if (slot.color !== hex) {
            slot.actor.background_color = this._color(hex);
            slot.color = hex;
            slot.alpha = hexBytes(hex)[3] / 255;
        }
        const s = this.s;
        place(slot, Math.round(x * s), Math.round(y * s), w * s, h * s, a * slot.alpha);
    }

    sprite(spr, x, y, facing, alpha, tint, dx, dy) {
        if (!spr.groups.length)
            return;
        const slot = this.sprites.next();
        const tex = this._texture(spr, facing < 0, tint);
        if (slot.content !== tex) {
            slot.actor.set_content(tex);
            slot.content = tex;
        }
        const s = this.s;
        const left = Math.round(spriteLeft(spr, x, facing, dx) * s);
        const top = Math.round(spriteTop(spr, this.H, y, dy) * s);
        place(slot, left, top, spr.w * s, spr.h * s, alpha);
    }

    _color(hex) {
        let c = this.colors.get(hex);
        if (!c) {
            // Alpha is applied through actor opacity, so the colour itself is opaque.
            const [red, green, blue] = hexBytes(hex);
            c = new Cogl.Color({red, green, blue, alpha: 255});
            this.colors.set(hex, c);
        }
        return c;
    }

    _texture(spr, flip, tint) {
        let byKey = this.textures.get(spr);
        if (!byKey) {
            byKey = new Map();
            this.textures.set(spr, byKey);
        }
        const key = flip ? `f${tint ?? ''}` : (tint ?? '');
        let tex = byKey.get(key);
        if (tex)
            return tex;

        const {w, h} = spr;
        const buf = new Uint8Array(w * h * 4);
        for (const {hex, rects, outline} of spr.groups) {
            const [r, g, b, a] = hexBytes(tint && !outline ? tint : hex);
            for (const [rx, ry, len] of rects) {
                for (let i = 0; i < len; i++) {
                    const px = flip ? w - 1 - (rx + i) : rx + i;
                    const o = (ry * w + px) * 4;
                    buf[o] = r;
                    buf[o + 1] = g;
                    buf[o + 2] = b;
                    buf[o + 3] = a;
                }
            }
        }
        tex = St.ImageContent.new_with_preferred_size(w, h);
        tex.set_bytes(this.cogl, new GLib.Bytes(buf), Cogl.PixelFormat.RGBA_8888, w, h, w * 4);
        byKey.set(key, tex);
        return tex;
    }
}
