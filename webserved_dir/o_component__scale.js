import { o_state, f_save_calibration, f_save_setting__debounced } from './index.js';
import { f_o_frame__imagedata } from './o_capture.module.js';

// scale (µm / pixel) calibration: freeze a frame of a stage micrometer (or any
// known-size grid), draw a line between two marks of a known physical distance,
// and store the resulting µm/px into the calibration profile. combined with
// steps-per-pixel it also yields µm/step for each axis.

let o_component__scale = {
    name: 'component-scale',
    template: `
        <div class="overlay-panel panel-scale" :class="{ visible: o_state.o_panel_visibility.scale }">
            <div class="panel-header">
                <h2>Scale (µm / pixel)</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">

                <div class="focus-note">
                    put a stage micrometer (or known grid) in view and focus, then
                    capture a still image and drag a line between two marks of a
                    known distance.
                </div>

                <div class="focus-config">
                    <div class="focus-field">
                        <label>Known distance</label>
                        <input type="number" min="0" step="1" v-model.number="n_known">
                    </div>
                    <div class="focus-field">
                        <label>Unit</label>
                        <select v-model="s_unit">
                            <option value="um">µm</option>
                            <option value="mm">mm</option>
                        </select>
                    </div>
                </div>

                <div class="filter-row" style="margin: 10px 0;">
                    <button class="btn-scan-start" @click="f_capture" :disabled="!o_state.b_streaming__webcam">Capture</button>
                </div>

                <canvas
                    ref="el_canvas"
                    class="scale-canvas"
                    v-show="s_status !== 'idle'"
                    @mousedown="f_on_mousedown"
                    @mousemove="f_on_mousemove"
                    @mouseup="f_on_mouseup"
                    @mouseleave="f_on_mouseup"
                ></canvas>

                <div class="filter-note" v-if="s_status === 'captured' && !(n_px__line > 0)">
                    drag a line between two marks of the known distance.
                </div>

                <div class="filter-group" v-if="n_px__line > 0">
                    <div class="filter-note">
                        line: <b>{{ n_px__line.toFixed(1) }}</b> px
                        · {{ n_um__known.toFixed(1) }} µm
                        → <b>{{ n_um__per_px__preview.toFixed(3) }}</b> µm/px
                    </div>
                    <div class="filter-row" style="margin-top: 8px;">
                        <button class="btn-scan-start" @click="f_apply" :disabled="!(n_px__line > 0 && n_um__known > 0)">Apply</button>
                        <button class="btn-small" @click="f_capture">Recapture</button>
                    </div>
                </div>

                <div class="focus-note" v-if="s_status === 'done'">
                    stored <b>{{ o_state.o_calibration.n_um__per_px.toFixed(3) }}</b> µm/px
                    <span v-if="n_um__per_step__x"> · X <b>{{ n_um__per_step__x.toFixed(2) }}</b> µm/step</span>
                    <span v-if="n_um__per_step__y"> · Y <b>{{ n_um__per_step__y.toFixed(2) }}</b> µm/step</span>
                </div>

                <div v-if="s_error" class="focusstack-error">{{ s_error }}</div>

            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            // 'idle' | 'captured' | 'done'
            s_status: 'idle',
            s_error: '',
            n_known: 1000,
            s_unit: 'um',
            o_line: null,
            b_dragging: false,
        };
    },
    computed: {
        n_um__known: function() {
            return this.n_known * (this.s_unit === 'mm' ? 1000 : 1);
        },
        n_px__line: function() {
            let o_line = this.o_line;
            if(!o_line) return 0;
            let n_dx = o_line.n_x1 - o_line.n_x0;
            let n_dy = o_line.n_y1 - o_line.n_y0;
            return Math.hypot(n_dx, n_dy);
        },
        n_um__per_px__preview: function() {
            if(!this.n_um__known || !this.n_px__line) return 0;
            return this.n_um__known / this.n_px__line;
        },
        n_um__per_step__x: function() {
            let n_um__per_px = o_state.o_calibration.n_um__per_px;
            let n_step__per_px = (o_state.a_n_step__per_px && o_state.a_n_step__per_px[0]) || 0;
            if(!n_um__per_px || !n_step__per_px) return 0;
            return n_um__per_px / n_step__per_px;
        },
        n_um__per_step__y: function() {
            let n_um__per_px = o_state.o_calibration.n_um__per_px;
            let n_step__per_px = (o_state.a_n_step__per_px && o_state.a_n_step__per_px[1]) || 0;
            if(!n_um__per_px || !n_step__per_px) return 0;
            return n_um__per_px / n_step__per_px;
        },
    },
    methods: {
        f_close: function() {
            o_state.o_panel_visibility.scale = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_capture: async function() {
            let o_self = this;
            if(!o_state.b_streaming__webcam){
                o_self.s_error = 'start a camera first';
                return;
            }
            try {
                let o_frame = await f_o_frame__imagedata();
                let el_canvas = o_self.$refs.el_canvas;
                el_canvas.width = o_frame.n_scl_x;
                el_canvas.height = o_frame.n_scl_y;
                let o_ctx = el_canvas.getContext('2d');
                o_ctx.putImageData(o_frame.o_imagedata, 0, 0);

                // keep an offscreen copy so the line can be redrawn over it
                let el_image = document.createElement('canvas');
                el_image.width = o_frame.n_scl_x;
                el_image.height = o_frame.n_scl_y;
                el_image.getContext('2d').putImageData(o_frame.o_imagedata, 0, 0);
                o_self._el_image = el_image;

                o_self.o_line = null;
                o_self.b_dragging = false;
                o_self.s_status = 'captured';
                o_self.s_error = '';
                o_self.f_redraw();
            } catch(o_error) {
                o_self.s_error = o_error.message || String(o_error);
            }
        },
        f_redraw: function() {
            let o_self = this;
            let el_canvas = o_self.$refs.el_canvas;
            if(!el_canvas || !o_self._el_image) return;
            let o_ctx = el_canvas.getContext('2d');
            o_ctx.drawImage(o_self._el_image, 0, 0);
            if(o_self.o_line){
                let n_lw = Math.max(1, el_canvas.width / 400);
                o_ctx.strokeStyle = '#ff3b6b';
                o_ctx.fillStyle = '#ff3b6b';
                o_ctx.lineWidth = n_lw;
                o_ctx.beginPath();
                o_ctx.moveTo(o_self.o_line.n_x0, o_self.o_line.n_y0);
                o_ctx.lineTo(o_self.o_line.n_x1, o_self.o_line.n_y1);
                o_ctx.stroke();
                for(let o_p of [
                    { n_x: o_self.o_line.n_x0, n_y: o_self.o_line.n_y0 },
                    { n_x: o_self.o_line.n_x1, n_y: o_self.o_line.n_y1 },
                ]){
                    o_ctx.beginPath();
                    o_ctx.arc(o_p.n_x, o_p.n_y, n_lw * 2, 0, Math.PI * 2);
                    o_ctx.fill();
                }
            }
        },
        f_o_pos__canvas: function(o_evt) {
            let el_canvas = this.$refs.el_canvas;
            let o_rect = el_canvas.getBoundingClientRect();
            let n_scale = el_canvas.width / o_rect.width;
            return {
                n_x: (o_evt.clientX - o_rect.left) * n_scale,
                n_y: (o_evt.clientY - o_rect.top) * n_scale,
            };
        },
        f_on_mousedown: function(o_evt) {
            let o_self = this;
            if(o_self.s_status !== 'captured') return;
            let o_pos = o_self.f_o_pos__canvas(o_evt);
            o_self.o_line = { n_x0: o_pos.n_x, n_y0: o_pos.n_y, n_x1: o_pos.n_x, n_y1: o_pos.n_y };
            o_self.b_dragging = true;
            o_self.f_redraw();
        },
        f_on_mousemove: function(o_evt) {
            let o_self = this;
            if(!o_self.b_dragging) return;
            let o_pos = o_self.f_o_pos__canvas(o_evt);
            o_self.o_line.n_x1 = o_pos.n_x;
            o_self.o_line.n_y1 = o_pos.n_y;
            o_self.f_redraw();
        },
        f_on_mouseup: function(o_evt) {
            let o_self = this;
            if(!o_self.b_dragging) return;
            o_self.b_dragging = false;
            let o_pos = o_self.f_o_pos__canvas(o_evt);
            o_self.o_line.n_x1 = o_pos.n_x;
            o_self.o_line.n_y1 = o_pos.n_y;
            o_self.f_redraw();
        },
        f_apply: function() {
            let o_self = this;
            if(!(o_self.n_px__line > 0) || !(o_self.n_um__known > 0)) return;
            let n_um__per_px = o_self.n_um__known / o_self.n_px__line;
            o_state.o_calibration.n_um__per_px = n_um__per_px;
            o_state.o_calibration.n_ts_ms__scale = Date.now();
            f_save_calibration();
            o_self.s_status = 'done';
        },
    },
};

export { o_component__scale };
