import { o_state, f_save_calibration, f_save_setting__debounced, f_save_flat_field, f_send_wsmsg_with_response } from './index.js';
import { f_o_frame__imagedata, f_save_image } from './o_capture.module.js';
import { f_flat__set, f_b_flat__loaded, f_o_flat } from './o_flatfield.module.js';
import { f_o_camera_snapshot } from './o_camera.module.js';
import { f_o_wsmsg } from './constructors.module.js';

let o_component__calibration_overlay = {
    name: 'component-calibration-overlay',
    template: `
        <div class="overlay-panel panel-calibration" :class="{ visible: o_state.o_panel_visibility.calibration }">
            <div class="panel-header">
                <h2>Calibration</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">

                <!-- ── Scale (µm / pixel) ─────────────────────────── -->
                <div class="filter-row">
                    <span class="filter-label">Scale</span>
                </div>

                <div class="calib-scale-row">
                    <input
                        type="number"
                        min="0"
                        step="any"
                        class="calib-scale-input"
                        :value="n_value__display"
                        :placeholder="b_unit__um_per_px ? 'µm/px' : 'px/µm'"
                        @change="f_on_input($event.target.value)"
                    >
                    <button
                        class="btn-small calib-unit-toggle"
                        @click="f_toggle_unit"
                        title="Switch between µm/px and px/µm"
                    >⇌</button>
                    <span class="calib-unit-label">{{ b_unit__um_per_px ? 'µm / px' : 'px / µm' }}</span>
                </div>

                <div class="filter-note" v-if="n_um_per_px > 0">
                    {{ n_um_per_px.toFixed(4) }} µm/px
                    &middot; {{ n_px_per_um.toFixed(4) }} px/µm
                </div>
                <div class="filter-note" v-else>no scale set yet</div>

                <div class="filter-row" style="margin-top: 10px;">
                    <button
                        v-if="s_measure_phase === 'idle'"
                        class="btn-scan-start"
                        @click="f_start_measure"
                        :disabled="!o_state.b_streaming__webcam"
                    >Measure</button>
                    <button v-else class="btn-small" @click="f_cancel_measure">Cancel measure</button>
                </div>

                <div class="filter-note" v-if="s_measure_phase !== 'idle'">
                    {{ s_measure_hint }}
                </div>

                <!-- ── Flat field correction ──────────────────────── -->
                <div class="filter-group">
                    <div class="filter-row">
                        <span class="filter-label">Flat Field</span>
                        <button
                            class="toolbar-toggle"
                            :class="{ active: o_state.o_flat_field.b_active }"
                            @click="f_toggle_flat"
                            :disabled="!o_state.o_flat_field.b_loaded"
                        >{{ o_state.o_flat_field.b_active ? 'ON' : 'OFF' }}</button>
                    </div>
                    <div class="filter-note" v-if="o_state.o_flat_field.b_loaded">
                        {{ o_state.o_flat_field.n_scl_x }} &times; {{ o_state.o_flat_field.n_scl_y }} px &middot; captured
                    </div>
                    <div class="filter-note" v-else>no flat image captured yet</div>
                    <div v-if="s_error__flat" class="focusstack-error">{{ s_error__flat }}</div>
                    <button
                        class="btn-scan-start"
                        style="margin-top: 10px; width: 100%;"
                        @click="f_capture_flat"
                        :disabled="!o_state.b_streaming__webcam || b_flat_capturing"
                    >{{ b_flat_capturing ? 'Capturing…' : 'Capture flat field correction image' }}</button>
                </div>

            </div>
        </div>

        <!-- ── Full-screen SVG overlay on the live image ── -->
        <svg v-if="s_measure_phase !== 'idle'" class="calib-measure-svg" aria-hidden="true">
            <!-- Dashed line: first point → cursor (or second point) -->
            <line
                v-if="o_pos__first && n_line_x2 !== null"
                :x1="o_pos__first.n_x" :y1="o_pos__first.n_y"
                :x2="n_line_x2" :y2="n_line_y2"
                class="calib-measure-line"
            />
            <!-- First click dot -->
            <circle v-if="o_pos__first" :cx="o_pos__first.n_x" :cy="o_pos__first.n_y" r="5" class="calib-measure-dot"/>
            <!-- Second click dot -->
            <circle v-if="o_pos__second" :cx="o_pos__second.n_x" :cy="o_pos__second.n_y" r="5" class="calib-measure-dot"/>
            <!-- Crosshair at cursor (not once distance popup is open) -->
            <g v-if="o_pos__cursor && s_measure_phase !== 'awaiting_distance'">
                <line :x1="o_pos__cursor.n_x - 10" :y1="o_pos__cursor.n_y" :x2="o_pos__cursor.n_x + 10" :y2="o_pos__cursor.n_y" class="calib-measure-crosshair"/>
                <line :x1="o_pos__cursor.n_x" :y1="o_pos__cursor.n_y - 10" :x2="o_pos__cursor.n_x" :y2="o_pos__cursor.n_y + 10" class="calib-measure-crosshair"/>
            </g>
        </svg>

        <!-- Cursor tooltip: visible only before first click -->
        <div
            v-if="s_measure_phase === 'awaiting_first' && o_pos__cursor"
            class="calib-cursor-tooltip"
            :style="{ left: o_pos__cursor.n_x + 'px', top: o_pos__cursor.n_y + 'px' }"
        >click to measure distance</div>

        <!-- Distance input popup: appears at the second click point -->
        <div
            v-if="s_measure_phase === 'awaiting_distance' && o_pos__second"
            class="calib-distance-popup"
            :style="o_style__popup"
        >
            <input
                ref="el_distance_input"
                type="number"
                min="0"
                step="0.01"
                v-model.number="n_known__mm"
                class="calib-scale-input"
                placeholder="distance"
                @keydown.enter="f_apply_measurement"
                @keydown.escape.stop="f_cancel_measure"
            >
            <span class="calib-unit-label">mm</span>
            <button class="btn-scan-start" @click="f_apply_measurement" :disabled="!(n_known__mm > 0)">Apply</button>
            <button class="btn-small" @click="f_cancel_measure">&times;</button>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            b_unit__um_per_px: true,
            // 'idle' | 'awaiting_first' | 'awaiting_second' | 'awaiting_distance'
            s_measure_phase: 'idle',
            o_pos__first: null,
            o_pos__second: null,
            o_pos__cursor: null,
            n_known__mm: 1,
            b_flat_capturing: false,
            s_error__flat: '',
        };
    },
    computed: {
        n_um_per_px: function() {
            return o_state.o_calibration.n_um__per_px || 0;
        },
        n_px_per_um: function() {
            let n = this.n_um_per_px;
            return n > 0 ? 1 / n : 0;
        },
        n_value__display: function() {
            if (this.b_unit__um_per_px) return this.n_um_per_px || '';
            return this.n_px_per_um || '';
        },
        // CSS px per camera px: how much the camera image is scaled up/down to fill the viewport
        n_camera_scale: function() {
            let n_w = o_state.o_camera.n_width;
            let n_h = o_state.o_camera.n_height;
            if (!n_w || !n_h) return 1;
            let n_aspect__camera = n_w / n_h;
            let n_aspect__window = window.innerWidth / window.innerHeight;
            return n_aspect__camera > n_aspect__window
                ? window.innerWidth / n_w
                : window.innerHeight / n_h;
        },
        n_line_x2: function() {
            if (this.o_pos__second) return this.o_pos__second.n_x;
            if (this.o_pos__cursor) return this.o_pos__cursor.n_x;
            return null;
        },
        n_line_y2: function() {
            if (this.o_pos__second) return this.o_pos__second.n_y;
            if (this.o_pos__cursor) return this.o_pos__cursor.n_y;
            return null;
        },
        n_px__line: function() {
            let o_a = this.o_pos__first;
            let o_b = this.o_pos__second;
            if (!o_a || !o_b) return 0;
            return Math.hypot(o_b.n_x - o_a.n_x, o_b.n_y - o_a.n_y) / this.n_camera_scale;
        },
        n_um__known: function() {
            return (this.n_known__mm || 0) * 1000;
        },
        s_measure_hint: function() {
            if (this.s_measure_phase === 'awaiting_first') return 'click a first point on the live image';
            if (this.s_measure_phase === 'awaiting_second') return 'click a second point on the live image';
            if (this.s_measure_phase === 'awaiting_distance') return 'enter the known distance, then apply';
            return '';
        },
        o_style__popup: function() {
            let o_pos = this.o_pos__second;
            if (!o_pos) return {};
            let b_flip = (o_pos.n_x + 300) > window.innerWidth;
            return {
                left: o_pos.n_x + 'px',
                top: o_pos.n_y + 'px',
                transform: b_flip ? 'translate(calc(-100% - 12px), -50%)' : 'translate(12px, -50%)',
            };
        },
    },
    methods: {
        f_close: function() {
            this.f_cancel_measure();
            o_state.o_panel_visibility.calibration = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_toggle_unit: function() {
            this.b_unit__um_per_px = !this.b_unit__um_per_px;
        },
        f_on_input: function(s_val) {
            let n_val = parseFloat(s_val);
            if (!Number.isFinite(n_val) || n_val <= 0) return;
            let n_um__per_px = this.b_unit__um_per_px ? n_val : 1 / n_val;
            o_state.o_calibration.n_um__per_px = n_um__per_px;
            o_state.o_calibration.n_ts_ms__scale = Date.now();
            f_save_calibration();
        },
        f_start_measure: function() {
            let o_self = this;
            o_self.o_pos__first = null;
            o_self.o_pos__second = null;
            o_self.o_pos__cursor = null;
            o_self.n_known__mm = 1;
            o_self.s_measure_phase = 'awaiting_first';
            document.body.classList.add('calib-measuring');
            // defer until the current button click has fully propagated to document
            setTimeout(function() { o_self.f_add_doc_listeners(); }, 0);
        },
        f_cancel_measure: function() {
            this.s_measure_phase = 'idle';
            this.o_pos__first = null;
            this.o_pos__second = null;
            document.body.classList.remove('calib-measuring');
            this.f_remove_doc_listeners();
        },
        f_apply_measurement: function() {
            let n_px = this.n_px__line;
            let n_um = this.n_um__known;
            if (!(n_px > 0) || !(n_um > 0)) return;
            o_state.o_calibration.n_um__per_px = n_um / n_px;
            o_state.o_calibration.n_ts_ms__scale = Date.now();
            f_save_calibration();
            this.f_cancel_measure();
        },
        f_on_doc_mousemove: function(o_evt) {
            this.o_pos__cursor = { n_x: o_evt.clientX, n_y: o_evt.clientY };
        },
        f_on_doc_click: function(o_evt) {
            if (o_evt.target.closest('.overlay-panel')) return;
            if (o_evt.target.closest('.calib-distance-popup')) return;
            if (this.s_measure_phase === 'awaiting_distance') return;
            let o_self = this;
            if (o_self.s_measure_phase === 'awaiting_first') {
                o_self.o_pos__first = { n_x: o_evt.clientX, n_y: o_evt.clientY };
                o_self.s_measure_phase = 'awaiting_second';
            } else if (o_self.s_measure_phase === 'awaiting_second') {
                o_self.o_pos__second = { n_x: o_evt.clientX, n_y: o_evt.clientY };
                o_self.s_measure_phase = 'awaiting_distance';
                o_self.$nextTick(function() {
                    if (o_self.$refs.el_distance_input) o_self.$refs.el_distance_input.focus();
                });
            }
        },
        f_on_doc_keydown: function(o_evt) {
            if (o_evt.key === 'Escape') this.f_cancel_measure();
        },
        f_add_doc_listeners: function() {
            let o_self = this;
            if (o_self._f_doc_mousemove) return;
            o_self._f_doc_mousemove = function(o_evt) { o_self.f_on_doc_mousemove(o_evt); };
            o_self._f_doc_click = function(o_evt) { o_self.f_on_doc_click(o_evt); };
            o_self._f_doc_keydown = function(o_evt) { o_self.f_on_doc_keydown(o_evt); };
            document.addEventListener('mousemove', o_self._f_doc_mousemove);
            document.addEventListener('click', o_self._f_doc_click);
            document.addEventListener('keydown', o_self._f_doc_keydown);
        },
        f_remove_doc_listeners: function() {
            let o_self = this;
            if (!o_self._f_doc_mousemove) return;
            document.removeEventListener('mousemove', o_self._f_doc_mousemove);
            document.removeEventListener('click', o_self._f_doc_click);
            document.removeEventListener('keydown', o_self._f_doc_keydown);
            o_self._f_doc_mousemove = null;
            o_self._f_doc_click = null;
            o_self._f_doc_keydown = null;
        },
        f_toggle_flat: function() {
            if (!o_state.o_flat_field.b_loaded) return;
            o_state.o_flat_field.b_active = !o_state.o_flat_field.b_active;
            f_save_flat_field();
        },
        f_capture_flat: async function() {
            let o_self = this;
            if (!o_state.b_streaming__webcam || o_self.b_flat_capturing) return;
            o_self.b_flat_capturing = true;
            o_self.s_error__flat = '';
            try {
                let o_frame = await f_o_frame__imagedata();

                let o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('flatfield_create_folder', {}));
                if (!o_resp.v_result || !o_resp.v_result.s_path_folder) throw new Error('could not create flat field folder');
                let s_path_folder = o_resp.v_result.s_path_folder;
                let s_path_flat = s_path_folder + '/flat.png';

                let el_canvas = document.createElement('canvas');
                el_canvas.width = o_frame.n_scl_x;
                el_canvas.height = o_frame.n_scl_y;
                el_canvas.getContext('2d').putImageData(o_frame.o_imagedata, 0, 0);
                let o_blob = await new Promise(function(resolve){ el_canvas.toBlob(resolve, 'image/png'); });
                await f_save_image(o_blob, s_path_folder, 'flat.png');

                f_flat__set(o_frame.o_imagedata.data, o_frame.n_scl_x, o_frame.n_scl_y, {
                    s_path_flat: s_path_flat,
                    n_ms__created: Date.now(),
                });
                o_state.o_flat_field.b_loaded = true;
                o_state.o_flat_field.b_active = true;
                o_state.o_flat_field.s_path_flat = s_path_flat;
                o_state.o_flat_field.n_scl_x = o_frame.n_scl_x;
                o_state.o_flat_field.n_scl_y = o_frame.n_scl_y;
                o_state.o_flat_field.a_n_mean__channel = f_o_flat().a_n_mean__channel.slice();
                o_state.o_flat_field.n_ms__created = Date.now();
                o_state.o_flat_field.o_camera__flat = f_o_camera_snapshot();
                f_save_flat_field();
            } catch (o_error) {
                o_self.s_error__flat = o_error.message || String(o_error);
            }
            o_self.b_flat_capturing = false;
        },
        f_load_flat: async function() {
            let s_path = o_state.o_flat_field.s_path_flat;
            if (!s_path || f_b_flat__loaded()) return;
            try {
                let o_img = new Image();
                o_img.src = '/api/file?path=' + encodeURIComponent(s_path);
                await o_img.decode();
                let el_canvas = document.createElement('canvas');
                el_canvas.width = o_img.width;
                el_canvas.height = o_img.height;
                el_canvas.getContext('2d').drawImage(o_img, 0, 0);
                let o_imagedata = el_canvas.getContext('2d').getImageData(0, 0, o_img.width, o_img.height);
                f_flat__set(o_imagedata.data, o_img.width, o_img.height, {
                    s_path_flat: s_path,
                    n_ms__created: o_state.o_flat_field.n_ms__created || 0,
                });
                o_state.o_flat_field.b_loaded = true;
                o_state.o_flat_field.n_scl_x = o_img.width;
                o_state.o_flat_field.n_scl_y = o_img.height;
                o_state.o_flat_field.a_n_mean__channel = f_o_flat().a_n_mean__channel.slice();
            } catch (o_error) {
                console.warn('flat field load failed:', o_error);
                o_state.o_flat_field.b_loaded = false;
            }
        },
    },
    mounted: function() {
        this.f_load_flat();
    },
    beforeUnmount: function() {
        this.f_cancel_measure();
    },
};

export { o_component__calibration_overlay };
