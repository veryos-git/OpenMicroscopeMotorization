import { o_state, f_save_setting__debounced } from './index.js';

// ─── Minimap canvas factory (replaces MinimapCanvas class) ──────────

let f_o_minimap_canvas = function(el_canvas) {
    let o_ctx = el_canvas.getContext('2d');
    let a_o_point = [];
    let o_pos = { n_x: 0, n_y: 0, n_z: 0 };
    let o_bound = { n_min_x: 0, n_max_x: 0, n_min_y: 0, n_max_y: 0 };
    let n_id__animation = 0;
    let o_mouse = { n_x: -1, n_y: -1 };
    let n_dpr = window.devicePixelRatio || 1;

    // viewport transform state
    let n_scl = 1;
    let n_off_x = 0;
    let n_off_y = 0;

    let f_update_bounds = function() {
        if (a_o_point.length === 0) {
            o_bound = { n_min_x: -10, n_max_x: 10, n_min_y: -10, n_max_y: 10 };
            return;
        }
        o_bound.n_min_x = Infinity;
        o_bound.n_max_x = -Infinity;
        o_bound.n_min_y = Infinity;
        o_bound.n_max_y = -Infinity;
        for (let o_p of a_o_point) {
            if (o_p.n_x < o_bound.n_min_x) o_bound.n_min_x = o_p.n_x;
            if (o_p.n_x > o_bound.n_max_x) o_bound.n_max_x = o_p.n_x;
            if (o_p.n_y < o_bound.n_min_y) o_bound.n_min_y = o_p.n_y;
            if (o_p.n_y > o_bound.n_max_y) o_bound.n_max_y = o_p.n_y;
        }
        // ensure at least some range
        if (o_bound.n_min_x === o_bound.n_max_x) { o_bound.n_min_x -= 10; o_bound.n_max_x += 10; }
        if (o_bound.n_min_y === o_bound.n_max_y) { o_bound.n_min_y -= 10; o_bound.n_max_y += 10; }
    };

    let f_compute_viewport = function() {
        let n_w = el_canvas.width / n_dpr;
        let n_h = el_canvas.height / n_dpr;
        let n_pad = 40;

        let n_range_x = o_bound.n_max_x - o_bound.n_min_x;
        let n_range_y = o_bound.n_max_y - o_bound.n_min_y;

        let n_scl_x = (n_w - n_pad * 2) / n_range_x;
        let n_scl_y = (n_h - n_pad * 2) / n_range_y;
        n_scl = Math.min(n_scl_x, n_scl_y);
        if (!isFinite(n_scl) || n_scl <= 0) n_scl = 1;

        let n_cx = (o_bound.n_min_x + o_bound.n_max_x) / 2;
        let n_cy = (o_bound.n_min_y + o_bound.n_max_y) / 2;
        n_off_x = n_w / 2 - n_cx * n_scl;
        n_off_y = n_h / 2 + n_cy * n_scl; // flip Y
    };

    let f_to_canvas = function(n_x, n_y) {
        return {
            n_x: n_x * n_scl + n_off_x,
            n_y: -n_y * n_scl + n_off_y
        };
    };

    let f_from_canvas = function(n_cx, n_cy) {
        return {
            n_x: (n_cx - n_off_x) / n_scl,
            n_y: -(n_cy - n_off_y) / n_scl
        };
    };

    let f_draw_grid = function() {
        let n_w = el_canvas.width / n_dpr;
        let n_h = el_canvas.height / n_dpr;

        // determine grid spacing
        let n_step_px = 50;
        let n_step_world = n_step_px / n_scl;
        let n_order = Math.pow(10, Math.floor(Math.log10(n_step_world)));
        let a_n_nice = [1, 2, 5, 10];
        let n_grid = n_order;
        for (let n of a_n_nice) {
            if (n * n_order * n_scl >= n_step_px * 0.7) {
                n_grid = n * n_order;
                break;
            }
        }

        let o_tl = f_from_canvas(0, 0);
        let o_br = f_from_canvas(n_w, n_h);
        let n_x_start = Math.floor(Math.min(o_tl.n_x, o_br.n_x) / n_grid) * n_grid;
        let n_x_end = Math.ceil(Math.max(o_tl.n_x, o_br.n_x) / n_grid) * n_grid;
        let n_y_start = Math.floor(Math.min(o_tl.n_y, o_br.n_y) / n_grid) * n_grid;
        let n_y_end = Math.ceil(Math.max(o_tl.n_y, o_br.n_y) / n_grid) * n_grid;

        // minor grid
        o_ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        o_ctx.lineWidth = 0.5;
        for (let n_x = n_x_start; n_x <= n_x_end; n_x += n_grid) {
            let o_c = f_to_canvas(n_x, 0);
            o_ctx.beginPath();
            o_ctx.moveTo(o_c.n_x, 0);
            o_ctx.lineTo(o_c.n_x, n_h);
            o_ctx.stroke();
        }
        for (let n_y = n_y_start; n_y <= n_y_end; n_y += n_grid) {
            let o_c = f_to_canvas(0, n_y);
            o_ctx.beginPath();
            o_ctx.moveTo(0, o_c.n_y);
            o_ctx.lineTo(n_w, o_c.n_y);
            o_ctx.stroke();
        }

        // major grid (every 5)
        let n_major = n_grid * 5;
        o_ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        o_ctx.lineWidth = 1;
        for (let n_x = Math.floor(n_x_start / n_major) * n_major; n_x <= n_x_end; n_x += n_major) {
            let o_c = f_to_canvas(n_x, 0);
            o_ctx.beginPath();
            o_ctx.moveTo(o_c.n_x, 0);
            o_ctx.lineTo(o_c.n_x, n_h);
            o_ctx.stroke();
        }
        for (let n_y = Math.floor(n_y_start / n_major) * n_major; n_y <= n_y_end; n_y += n_major) {
            let o_c = f_to_canvas(0, n_y);
            o_ctx.beginPath();
            o_ctx.moveTo(0, o_c.n_y);
            o_ctx.lineTo(n_w, o_c.n_y);
            o_ctx.stroke();
        }

        // origin axes
        let o_origin = f_to_canvas(0, 0);
        o_ctx.strokeStyle = 'rgba(91,141,239,0.3)';
        o_ctx.lineWidth = 1;
        o_ctx.beginPath();
        o_ctx.moveTo(o_origin.n_x, 0);
        o_ctx.lineTo(o_origin.n_x, n_h);
        o_ctx.stroke();
        o_ctx.strokeStyle = 'rgba(0,212,170,0.3)';
        o_ctx.beginPath();
        o_ctx.moveTo(0, o_origin.n_y);
        o_ctx.lineTo(n_w, o_origin.n_y);
        o_ctx.stroke();
    };

    let f_draw = function() {
        let n_w = el_canvas.width / n_dpr;
        let n_h = el_canvas.height / n_dpr;

        o_ctx.save();
        o_ctx.scale(n_dpr, n_dpr);

        // background
        o_ctx.fillStyle = '#0a0a0c';
        o_ctx.fillRect(0, 0, n_w, n_h);

        f_update_bounds();
        f_compute_viewport();
        f_draw_grid();

        // trace line
        if (a_o_point.length > 1) {
            o_ctx.strokeStyle = '#ffc312';
            o_ctx.lineWidth = 1.5;
            o_ctx.lineJoin = 'round';
            o_ctx.beginPath();
            let o_first = f_to_canvas(a_o_point[0].n_x, a_o_point[0].n_y);
            o_ctx.moveTo(o_first.n_x, o_first.n_y);
            for (let n_idx = 1; n_idx < a_o_point.length; n_idx++) {
                let o_c = f_to_canvas(a_o_point[n_idx].n_x, a_o_point[n_idx].n_y);
                o_ctx.lineTo(o_c.n_x, o_c.n_y);
            }
            o_ctx.stroke();
        }

        // crosshair at current position
        let o_cur = f_to_canvas(o_pos.n_x, o_pos.n_y);
        let n_crosshair_sz = 12;
        o_ctx.strokeStyle = '#ff6b35';
        o_ctx.lineWidth = 1.5;
        o_ctx.beginPath();
        o_ctx.moveTo(o_cur.n_x - n_crosshair_sz, o_cur.n_y);
        o_ctx.lineTo(o_cur.n_x + n_crosshair_sz, o_cur.n_y);
        o_ctx.moveTo(o_cur.n_x, o_cur.n_y - n_crosshair_sz);
        o_ctx.lineTo(o_cur.n_x, o_cur.n_y + n_crosshair_sz);
        o_ctx.stroke();
        // center dot
        o_ctx.fillStyle = '#ff6b35';
        o_ctx.beginPath();
        o_ctx.arc(o_cur.n_x, o_cur.n_y, 3, 0, Math.PI * 2);
        o_ctx.fill();

        // position label (bottom-left)
        o_ctx.fillStyle = 'rgba(255,255,255,0.6)';
        o_ctx.font = '10px JetBrains Mono, monospace';
        o_ctx.fillText(`X: ${o_pos.n_x}  Y: ${o_pos.n_y}  Z: ${o_pos.n_z}`, 8, n_h - 8);

        // hover coordinate readout
        if (o_mouse.n_x >= 0 && o_mouse.n_y >= 0) {
            let o_world = f_from_canvas(o_mouse.n_x, o_mouse.n_y);
            let s_label = `(${Math.round(o_world.n_x)}, ${Math.round(o_world.n_y)})`;
            o_ctx.fillStyle = 'rgba(255,255,255,0.4)';
            o_ctx.fillText(s_label, o_mouse.n_x + 10, o_mouse.n_y - 6);
        }

        o_ctx.restore();
        n_id__animation = requestAnimationFrame(f_draw);
    };

    // resize handling
    let o_resize_observer = new ResizeObserver(function() {
        let o_rect = el_canvas.getBoundingClientRect();
        el_canvas.width = o_rect.width * n_dpr;
        el_canvas.height = o_rect.height * n_dpr;
    });
    o_resize_observer.observe(el_canvas);

    // initial size
    let o_rect = el_canvas.getBoundingClientRect();
    el_canvas.width = o_rect.width * n_dpr;
    el_canvas.height = o_rect.height * n_dpr;

    // mouse tracking
    el_canvas.addEventListener('mousemove', function(o_evt) {
        let o_r = el_canvas.getBoundingClientRect();
        o_mouse.n_x = o_evt.clientX - o_r.left;
        o_mouse.n_y = o_evt.clientY - o_r.top;
    });
    el_canvas.addEventListener('mouseleave', function() {
        o_mouse.n_x = -1;
        o_mouse.n_y = -1;
    });

    // start render loop
    n_id__animation = requestAnimationFrame(f_draw);

    return {
        update: function(a_o_motor_data) {
            // motor 0 = X axis, motor 1 = Y axis, motor 2 = Z axis
            let n_x = a_o_motor_data[0] ? a_o_motor_data[0].n_position : 0;
            let n_y = a_o_motor_data[1] ? a_o_motor_data[1].n_position : 0;
            let n_z = a_o_motor_data[2] ? a_o_motor_data[2].n_position : 0;

            if (n_x !== o_pos.n_x || n_y !== o_pos.n_y || n_z !== o_pos.n_z) {
                o_pos.n_x = n_x;
                o_pos.n_y = n_y;
                o_pos.n_z = n_z;
                a_o_point.push({
                    n_x: n_x,
                    n_y: n_y,
                    n_z: n_z,
                    n_ts_ms: Date.now(),
                });
            }
        },
        clear: function() {
            a_o_point.length = 0;
            o_pos.n_x = 0;
            o_pos.n_y = 0;
            o_pos.n_z = 0;
            o_bound = { n_min_x: -10, n_max_x: 10, n_min_y: -10, n_max_y: 10 };
        },
        destroy: function() {
            cancelAnimationFrame(n_id__animation);
            o_resize_observer.disconnect();
        },
    };
};

// ─── Vue component ──────────────────────────────────────────────────

let o_component__minimap = {
    name: 'component-minimap',
    template: `
        <div class="overlay-panel panel-minimap" :class="{ visible: o_state.o_panel_visibility.minimap }">
            <div class="panel-header">
                <h2>Minimap</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <div class="minimap-canvas-wrap">
                    <canvas ref="el_canvas"></canvas>
                </div>
                <div class="minimap-actions">
                    <button @click="f_clear">Clear trace</button>
                </div>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            o_minimap: null,
        };
    },
    watch: {
        'o_state.a_o_motor': {
            handler: function(a_o_motor) {
                if (this.o_minimap) {
                    this.o_minimap.update(a_o_motor);
                }
            },
            deep: true,
        },
    },
    methods: {
        f_close: function() {
            o_state.o_panel_visibility.minimap = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_clear: function() {
            if (this.o_minimap) this.o_minimap.clear();
        },
    },
    mounted: function() {
        this.o_minimap = f_o_minimap_canvas(this.$refs.el_canvas);
    },
    beforeUnmount: function() {
        if (this.o_minimap) this.o_minimap.destroy();
    },
};

export { o_component__minimap };
