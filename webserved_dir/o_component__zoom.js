import { f_action } from './o_actions.js';
import { o_state, f_save_setting__debounced } from './index.js';

// digital zoom: pick a region of the live image and watch it magnified in a
// floating overlay window.  the region is kept in camera pixels, so it survives
// a window resize (the box is re-projected every frame).
//
// picking is done by holding Ctrl and dragging on the image (or with the Select
// area button for a mouse without a keyboard).  the wheel over the preview
// window zooms, dragging its corner resizes it, and its header moves it.
//
// the magnifier resamples the raw webcam frame — the same source every capture
// path uses — either interpolated or pixelated (nearest neighbour, which shows
// the actual sensor pixels at a strong zoom).
//
// the drag layer only takes the pointer while an area is being picked, so a
// plain drag on the image still jogs the stage.

// a drag smaller than this (camera px) is treated as a miss, not a region
let N_PX__ROI_MIN = 8;
// the magnifier window keeps a little room for its own header and readout
let N_PX__PANEL_CHROME = 40;
// vertical room the window needs besides the picture: header, readout, controls
let N_PX__PANEL_VERTICAL = 256;
// how fast one wheel notch changes the magnification
let N_WHEEL__ZOOM_RATE = 0.0015;
// preview window (magnifier) lower bound.  there is no fixed upper bound: the
// preview grows to whatever the viewport can hold, recomputed on every resize.
let N_PX__PREVIEW_MIN = 140;

let o_component__zoom = {
    name: 'component-zoom',
    template: `
        <!-- region of interest, projected onto the live image.  no pointer
             events, so mouse jog and every other overlay keep working. -->
        <canvas class="zoom-roi-canvas" ref="el_roi"></canvas>

        <!-- drag layer.  it only takes the pointer while an area is being picked
             (the Select area button) or while Ctrl is held, so a plain drag still
             jogs the stage. -->
        <teleport to="body">
            <div
                class="zoom-select-overlay"
                v-if="o_state.o_panel_visibility.zoom"
                :class="{ armed: b_armed__pick, dragging: b_dragging }"
                @pointerdown="f_on_pointer_down"
                @contextmenu.prevent
            >
                <div class="zoom-select-hint" v-if="b_armed__pick">
                    <span v-if="b_selecting">drag a box over the area to magnify</span>
                    <span v-else><b>Ctrl</b> + drag to pick an area</span>
                    <span>press <b>Esc</b> to cancel</span>
                </div>
            </div>
        </teleport>

        <!-- floating magnifier window -->
        <div
            class="overlay-panel panel-zoom"
            ref="el_panel"
            :class="{ visible: o_state.o_panel_visibility.zoom, 'dragging-panel': b_dragging__panel, resizing: b_dragging__resize }"
            :style="{ left: o_state.o_zoom.n_px__panel_x + 'px', top: o_state.o_zoom.n_px__panel_y + 'px' }"
            @wheel.prevent="f_on_wheel"
        >
            <div
                class="panel-header zoom-header"
                @pointerdown="f_on_panel_down"
            >
                <h2>Digital zoom</h2>
                <button class="panel-close" @click="f_close" @pointerdown.stop>&times;</button>
            </div>
            <div class="panel-body">
                <div
                    class="zoom-stage"
                    :class="{ pannable: b_active, panning: b_dragging__pan }"
                    :style="{ width: n_scl_x__mag + 'px' }"
                    @pointerdown="f_on_pan_down"
                >
                    <canvas class="zoom-mag-canvas" ref="el_mag"></canvas>
                    <div class="zoom-stage-empty" v-if="!b_active">
                        <span>no area selected</span>
                        <span>Ctrl + drag on the live image</span>
                    </div>
                </div>

                <div class="zoom-readout">
                    <span v-if="b_active">
                        <b>{{ n_scl_x__roi }} &times; {{ n_scl_y__roi }}</b> px
                        &middot; <b>{{ n_zoom.toFixed(1) }}&times;</b>
                    </span>
                    <span v-else>waiting for a selection</span>
                    <span v-if="b_active">{{ n_x__roi }}, {{ n_y__roi }}</span>
                </div>

                <div class="filter-row">
                    <button class="btn-scan-start" @click="f_toggle_select">
                        {{ b_selecting ? 'Cancel' : 'Select area' }}
                    </button>
                    <button class="btn-small" @click="f_clear" :disabled="!b_active">Clear</button>
                </div>

                <div class="focus-config">
                    <div class="focus-field">
                        <label>Preview</label>
                        <input
                            type="range"
                            min="140" :max="n_scl_x__preview_max" step="10"
                            v-model.number="o_state.o_zoom.n_scl_x__mag"
                            @input="f_on_preview_change"
                        >
                    </div>
                    <div class="focus-field">
                        <label>Resample</label>
                        <select v-model="o_state.o_zoom.s_resample" @change="f_on_change">
                            <option value="interpolated">interpolated</option>
                            <option value="pixelated">pixelated</option>
                        </select>
                    </div>
                </div>

                <div class="filter-note">
                    drag the picture to pan &middot; scroll to zoom &middot;
                    drag the corner to resize &middot; move the window by its header
                </div>

                <!-- drag the corner to resize the preview window -->
                <div
                    class="zoom-resize-handle"
                    title="drag to resize the preview"
                    @pointerdown="f_on_resize_down"
                ></div>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            b_ctrl: false,
            b_dragging: false,
            // in-progress drag, in camera pixels
            o_drag: { n_x0: 0, n_y0: 0, n_x1: 0, n_y1: 0 },
            b_dragging__panel: false,
            o_panel_off: { n_x: 0, n_y: 0 },
            b_dragging__resize: false,
            o_resize: { n_x: 0, n_y: 0, n_scl_x__mag: 0 },
            b_dragging__pan: false,
            o_pan: { n_x: 0, n_y: 0, n_x__roi: 0, n_y__roi: 0 },
            // viewport size, kept fresh so the preview can size itself to it
            n_scl_x__win: window.innerWidth,
            n_scl_y__win: window.innerHeight,
            n_id__frame: 0,
            b_running__frame: false,
        };
    },
    computed: {
        b_active: function() {
            return o_state.o_zoom.n_scl_x__roi > 0 && o_state.o_zoom.n_scl_y__roi > 0;
        },
        b_selecting: function() {
            return o_state.o_zoom.b_selecting;
        },
        // the pick layer takes the pointer while picking is armed or Ctrl is down
        b_armed__pick: function() {
            return o_state.o_zoom.b_selecting || this.b_ctrl || this.b_dragging;
        },
        n_x__roi: function() {
            return o_state.o_zoom.n_x__roi;
        },
        n_y__roi: function() {
            return o_state.o_zoom.n_y__roi;
        },
        n_scl_x__roi: function() {
            return o_state.o_zoom.n_scl_x__roi;
        },
        n_scl_y__roi: function() {
            return o_state.o_zoom.n_scl_y__roi;
        },
        n_scl_x__mag: function() {
            return o_state.o_zoom.n_scl_x__mag;
        },
        // the preview may grow until the window itself is full.  snapped to the
        // slider's 10 px step so the slider and the corner grip share one max
        n_scl_x__preview_max: function() {
            let n_raw = Math.max(N_PX__PREVIEW_MIN, Math.round(this.n_scl_x__win - N_PX__PANEL_CHROME - 24));
            return N_PX__PREVIEW_MIN + Math.floor((n_raw - N_PX__PREVIEW_MIN) / 10) * 10;
        },
        // how much bigger the region is drawn than it is in the camera
        n_zoom: function() {
            if(!o_state.o_zoom.n_scl_x__roi) return 0;
            return o_state.o_zoom.n_scl_x__mag / o_state.o_zoom.n_scl_x__roi;
        },
    },
    watch: {
        'o_state.o_panel_visibility.zoom': function(b_visible) {
            let o_self = this;
            if(b_visible){
                o_self.f_clamp_panel();
            } else {
                o_state.o_zoom.b_selecting = false;
                o_self.b_ctrl = false;
            }
            o_self.f_sync_frame();
        },
        'o_state.b_streaming__webcam': function() {
            this.f_sync_frame();
        },
    },
    mounted: function() {
        let o_self = this;
        o_self.f_clamp_panel();
        o_self._f_on_resize = function(){ o_self.f_on_resize(); };
        f_action({ id: 'zoom.cancel', name: 'Cancel Zoom Selection', description: 'Leave zoom region selection', category: 'Image' }, () => { o_state.o_zoom.b_selecting = false; });
        o_self._f_on_keydown = function(o_evt){ o_self.f_on_keydown(o_evt); };
        o_self._f_on_keyup = function(o_evt){ o_self.f_on_keyup(o_evt); };
        o_self._f_on_blur = function(){ o_self.b_ctrl = false; o_self.f_cancel_drag(); };
        window.addEventListener('resize', o_self._f_on_resize);
        window.addEventListener('keydown', o_self._f_on_keydown);
        window.addEventListener('keyup', o_self._f_on_keyup);
        window.addEventListener('blur', o_self._f_on_blur);
        o_self.f_sync_frame();
    },
    beforeUnmount: function() {
        let o_self = this;
        if(o_self._f_on_resize) window.removeEventListener('resize', o_self._f_on_resize);
        if(o_self._f_on_keydown) window.removeEventListener('keydown', o_self._f_on_keydown);
        if(o_self._f_on_keyup) window.removeEventListener('keyup', o_self._f_on_keyup);
        if(o_self._f_on_blur) window.removeEventListener('blur', o_self._f_on_blur);
        o_self.f_remove_drag_listener__pick();
        o_self.f_remove_drag_listener__resize();
        o_self.f_remove_drag_listener__pan();
        o_self.f_remove_drag_listener__panel();
        o_self.f_stop_frame();
    },
    methods: {
        // ─── geometry ───────────────────────────────────────────────

        // the on-screen box the video content occupies.  the video is fixed
        // and full-window with object-fit: contain, so the content is centred
        // and letterboxed — every screen<->camera mapping has to go through it.
        f_o_box__video: function() {
            let el_video = document.getElementById('webcamVideo');
            if(!el_video || !el_video.videoWidth || !el_video.videoHeight) return null;
            let n_scl_x__win = window.innerWidth;
            let n_scl_y__win = window.innerHeight;
            let n_scl_x__video = el_video.videoWidth;
            let n_scl_y__video = el_video.videoHeight;
            let n_scl = Math.min(n_scl_x__win / n_scl_x__video, n_scl_y__win / n_scl_y__video);
            return {
                n_x: (n_scl_x__win - n_scl_x__video * n_scl) / 2,
                n_y: (n_scl_y__win - n_scl_y__video * n_scl) / 2,
                n_scl: n_scl,
                n_scl_x__video: n_scl_x__video,
                n_scl_y__video: n_scl_y__video,
            };
        },
        f_b_inside__video: function(o_evt, o_box) {
            let n_x = o_evt.clientX - o_box.n_x;
            let n_y = o_evt.clientY - o_box.n_y;
            return n_x >= 0 && n_y >= 0
                && n_x <= o_box.n_scl_x__video * o_box.n_scl
                && n_y <= o_box.n_scl_y__video * o_box.n_scl;
        },
        // screen point -> camera pixel, clamped to the frame
        f_o_pos__video: function(o_evt) {
            let o_box = this.f_o_box__video();
            if(!o_box) return null;
            let n_x = (o_evt.clientX - o_box.n_x) / o_box.n_scl;
            let n_y = (o_evt.clientY - o_box.n_y) / o_box.n_scl;
            return {
                n_x: Math.max(0, Math.min(o_box.n_scl_x__video, n_x)),
                n_y: Math.max(0, Math.min(o_box.n_scl_y__video, n_y)),
            };
        },
        // the region the overlay should draw: the live drag, else the stored one
        f_o_roi__draw: function() {
            if(this.b_dragging){
                let o_drag = this.o_drag;
                return {
                    n_x: Math.min(o_drag.n_x0, o_drag.n_x1),
                    n_y: Math.min(o_drag.n_y0, o_drag.n_y1),
                    n_scl_x: Math.abs(o_drag.n_x1 - o_drag.n_x0),
                    n_scl_y: Math.abs(o_drag.n_y1 - o_drag.n_y0),
                };
            }
            if(!this.b_active) return null;
            return {
                n_x: o_state.o_zoom.n_x__roi,
                n_y: o_state.o_zoom.n_y__roi,
                n_scl_x: o_state.o_zoom.n_scl_x__roi,
                n_scl_y: o_state.o_zoom.n_scl_y__roi,
            };
        },

        // ─── selection ──────────────────────────────────────────────

        f_toggle_select: function() {
            o_state.o_zoom.b_selecting = !o_state.o_zoom.b_selecting;
        },
        f_clear: function() {
            o_state.o_zoom.n_x__roi = 0;
            o_state.o_zoom.n_y__roi = 0;
            o_state.o_zoom.n_scl_x__roi = 0;
            o_state.o_zoom.n_scl_y__roi = 0;
            this.f_on_change();
        },
        f_on_pointer_down: function(o_evt) {
            let o_self = this;
            if(o_evt.button !== 0) return;
            if(!o_self.b_armed__pick) return;
            let o_box = o_self.f_o_box__video();
            if(!o_box || !o_self.f_b_inside__video(o_evt, o_box)) return;
            let o_pos = o_self.f_o_pos__video(o_evt);
            if(!o_pos) return;
            o_self.b_dragging = true;
            o_self.o_drag = { n_x0: o_pos.n_x, n_y0: o_pos.n_y, n_x1: o_pos.n_x, n_y1: o_pos.n_y };
            o_self.f_add_drag_listener__pick();
            o_evt.preventDefault();
        },
        f_on_pointer_move: function(o_evt) {
            let o_self = this;
            if(!o_self.b_dragging) return;
            let o_pos = o_self.f_o_pos__video(o_evt);
            if(!o_pos) return;
            o_self.o_drag.n_x1 = o_pos.n_x;
            o_self.o_drag.n_y1 = o_pos.n_y;
        },
        f_on_pointer_up: function(o_evt) {
            let o_self = this;
            if(!o_self.b_dragging) return;
            o_self.f_remove_drag_listener__pick();
            let o_pos = o_self.f_o_pos__video(o_evt);
            if(o_pos){
                o_self.o_drag.n_x1 = o_pos.n_x;
                o_self.o_drag.n_y1 = o_pos.n_y;
            }
            o_self.b_dragging = false;

            let n_x = Math.min(o_self.o_drag.n_x0, o_self.o_drag.n_x1);
            let n_y = Math.min(o_self.o_drag.n_y0, o_self.o_drag.n_y1);
            let n_scl_x = Math.abs(o_self.o_drag.n_x1 - o_self.o_drag.n_x0);
            let n_scl_y = Math.abs(o_self.o_drag.n_y1 - o_self.o_drag.n_y0);
            if(n_scl_x < N_PX__ROI_MIN || n_scl_y < N_PX__ROI_MIN) return;

            o_state.o_zoom.n_x__roi = Math.round(n_x);
            o_state.o_zoom.n_y__roi = Math.round(n_y);
            o_state.o_zoom.n_scl_x__roi = Math.round(n_scl_x);
            o_state.o_zoom.n_scl_y__roi = Math.round(n_scl_y);
            // one region is enough — hand the image back to mouse jog
            o_state.o_zoom.b_selecting = false;
            o_self.f_on_change();
        },
        // window listeners, not pointer capture: a drag keeps working after the
        // pointer leaves the element (or the window) without relying on capture
        f_add_drag_listener__pick: function() {
            let o_self = this;
            o_self._f_on_pick_move = function(o_evt){ o_self.f_on_pointer_move(o_evt); };
            o_self._f_on_pick_up = function(o_evt){ o_self.f_on_pointer_up(o_evt); };
            window.addEventListener('pointermove', o_self._f_on_pick_move);
            window.addEventListener('pointerup', o_self._f_on_pick_up);
            window.addEventListener('pointercancel', o_self._f_on_pick_up);
        },
        f_remove_drag_listener__pick: function() {
            let o_self = this;
            if(o_self._f_on_pick_move) window.removeEventListener('pointermove', o_self._f_on_pick_move);
            if(o_self._f_on_pick_up){
                window.removeEventListener('pointerup', o_self._f_on_pick_up);
                window.removeEventListener('pointercancel', o_self._f_on_pick_up);
            }
            o_self._f_on_pick_move = null;
            o_self._f_on_pick_up = null;
        },
        // Ctrl is a plain drag on the image while it is down; a real modifier
        // click also reaches the pick layer without any arming step
        f_on_keydown: function(o_evt) {
            let o_self = this;
            if(o_evt.key === 'Control' || o_evt.ctrlKey) o_self.b_ctrl = true;

        },
        f_on_keyup: function(o_evt) {
            if(o_evt.key === 'Control' || !o_evt.ctrlKey) this.b_ctrl = false;
        },

        // ─── wheel zoom ─────────────────────────────────────────────

        // one wheel notch scales the picked region around its centre, so the
        // magnification changes without the preview window changing size
        f_on_wheel: function(o_evt) {
            let o_self = this;
            if(!o_state.o_panel_visibility.zoom) return;
            let o_box = o_self.f_o_box__video();
            if(!o_box) return;
            let n_delta = o_evt.deltaY;
            if(o_evt.deltaMode === 1) n_delta *= 16;
            else if(o_evt.deltaMode === 2) n_delta *= 120;
            if(!n_delta) return;
            let n_scl = Math.exp(n_delta * N_WHEEL__ZOOM_RATE);
            if(n_scl <= 0 || !isFinite(n_scl)) return;

            if(!o_self.b_active){
                // first scroll with nothing picked: start on the centre of the
                // frame at a useful magnification (4x), zooming in only
                if(n_scl >= 1) return;
                let n_scl_x = Math.min(Math.max(o_state.o_zoom.n_scl_x__mag / 4, N_PX__ROI_MIN), o_box.n_scl_x__video);
                o_state.o_zoom.n_scl_x__roi = Math.round(n_scl_x);
                o_state.o_zoom.n_scl_y__roi = Math.round(Math.min(Math.max(n_scl_x * o_box.n_scl_y__video / o_box.n_scl_x__video, N_PX__ROI_MIN), o_box.n_scl_y__video));
                o_state.o_zoom.n_x__roi = Math.round((o_box.n_scl_x__video - o_state.o_zoom.n_scl_x__roi) / 2);
                o_state.o_zoom.n_y__roi = Math.round((o_box.n_scl_y__video - o_state.o_zoom.n_scl_y__roi) / 2);
            } else {
                o_self.f_scale_roi(n_scl, o_box);
            }
            o_self.f_on_change();
        },
        f_scale_roi: function(n_scl, o_box) {
            let o_zoom = o_state.o_zoom;
            let n_x__center = o_zoom.n_x__roi + o_zoom.n_scl_x__roi / 2;
            let n_y__center = o_zoom.n_y__roi + o_zoom.n_scl_y__roi / 2;
            let n_scl_x = Math.min(Math.max(o_zoom.n_scl_x__roi * n_scl, N_PX__ROI_MIN), o_box.n_scl_x__video);
            let n_scl_y = Math.min(Math.max(o_zoom.n_scl_y__roi * n_scl, N_PX__ROI_MIN), o_box.n_scl_y__video);
            o_zoom.n_scl_x__roi = Math.round(n_scl_x);
            o_zoom.n_scl_y__roi = Math.round(n_scl_y);
            o_zoom.n_x__roi = Math.round(Math.min(Math.max(n_x__center - n_scl_x / 2, 0), o_box.n_scl_x__video - n_scl_x));
            o_zoom.n_y__roi = Math.round(Math.min(Math.max(n_y__center - n_scl_y / 2, 0), o_box.n_scl_y__video - n_scl_y));
        },

        // ─── preview resize (corner grip) ───────────────────────────

        f_on_resize_down: function(o_evt) {
            let o_self = this;
            if(o_evt.button !== 0) return;
            o_self.o_resize = { n_x: o_evt.clientX, n_y: o_evt.clientY, n_scl_x__mag: o_state.o_zoom.n_scl_x__mag };
            o_self.b_dragging__resize = true;
            o_self._f_on_resize_move = function(o_evt2){ o_self.f_on_resize_move(o_evt2); };
            o_self._f_on_resize_up = function(o_evt2){ o_self.f_on_resize_up(o_evt2); };
            window.addEventListener('pointermove', o_self._f_on_resize_move);
            window.addEventListener('pointerup', o_self._f_on_resize_up);
            window.addEventListener('pointercancel', o_self._f_on_resize_up);
            o_evt.preventDefault();
            o_evt.stopPropagation();
        },
        f_on_resize_move: function(o_evt) {
            let o_self = this;
            if(!o_self.b_dragging__resize) return;
            // the preview keeps the region's aspect ratio, so either drag axis
            // is enough to make it bigger
            let n_dx = o_evt.clientX - o_self.o_resize.n_x;
            let n_dy = o_evt.clientY - o_self.o_resize.n_y;
            let n_delta = Math.max(n_dx, n_dy);
            o_state.o_zoom.n_scl_x__mag = Math.round(Math.min(
                Math.max(o_self.o_resize.n_scl_x__mag + n_delta, N_PX__PREVIEW_MIN),
                o_self.n_scl_x__preview_max
            ));
            o_self.f_fit_panel();
        },
        f_on_resize_up: function() {
            let o_self = this;
            if(!o_self.b_dragging__resize) return;
            o_self.b_dragging__resize = false;
            o_self.f_remove_drag_listener__resize();
            o_self.f_on_change();
        },
        f_remove_drag_listener__resize: function() {
            let o_self = this;
            if(o_self._f_on_resize_move) window.removeEventListener('pointermove', o_self._f_on_resize_move);
            if(o_self._f_on_resize_up){
                window.removeEventListener('pointerup', o_self._f_on_resize_up);
                window.removeEventListener('pointercancel', o_self._f_on_resize_up);
            }
            o_self._f_on_resize_move = null;
            o_self._f_on_resize_up = null;
        },
        f_on_preview_change: function() {
            this.f_fit_panel();
            this.f_on_change();
        },

        // ─── preview panning ────────────────────────────────────────

        // grab the magnified picture and drag it: the picture follows the
        // pointer, so the picked region moves the other way on the main image
        f_on_pan_down: function(o_evt) {
            let o_self = this;
            if(o_evt.button !== 0) return;
            if(!o_self.b_active) return;
            o_self.o_pan = {
                n_x: o_evt.clientX,
                n_y: o_evt.clientY,
                n_x__roi: o_state.o_zoom.n_x__roi,
                n_y__roi: o_state.o_zoom.n_y__roi,
            };
            o_self.b_dragging__pan = true;
            o_self._f_on_pan_move = function(o_evt2){ o_self.f_on_pan_move(o_evt2); };
            o_self._f_on_pan_up = function(o_evt2){ o_self.f_on_pan_up(o_evt2); };
            window.addEventListener('pointermove', o_self._f_on_pan_move);
            window.addEventListener('pointerup', o_self._f_on_pan_up);
            window.addEventListener('pointercancel', o_self._f_on_pan_up);
            o_evt.preventDefault();
            o_evt.stopPropagation();
        },
        f_on_pan_move: function(o_evt) {
            let o_self = this;
            if(!o_self.b_dragging__pan) return;
            let o_box = o_self.f_o_box__video();
            if(!o_box) return;
            // one preview pixel covers this many camera pixels
            let el_mag = o_self.$refs.el_mag;
            let n_scl_x__disp = (el_mag && el_mag.clientWidth) ? el_mag.clientWidth : o_state.o_zoom.n_scl_x__mag;
            let n_scl_y__disp = (el_mag && el_mag.clientHeight)
                ? el_mag.clientHeight
                : Math.max(1, Math.round(n_scl_x__disp * o_state.o_zoom.n_scl_y__roi / Math.max(1, o_state.o_zoom.n_scl_x__roi)));
            let n_scl_x__cam = o_state.o_zoom.n_scl_x__roi / Math.max(1, n_scl_x__disp);
            let n_scl_y__cam = o_state.o_zoom.n_scl_y__roi / Math.max(1, n_scl_y__disp);

            let n_x = o_self.o_pan.n_x__roi - (o_evt.clientX - o_self.o_pan.n_x) * n_scl_x__cam;
            let n_y = o_self.o_pan.n_y__roi - (o_evt.clientY - o_self.o_pan.n_y) * n_scl_y__cam;
            let n_x__max = Math.max(0, o_box.n_scl_x__video - o_state.o_zoom.n_scl_x__roi);
            let n_y__max = Math.max(0, o_box.n_scl_y__video - o_state.o_zoom.n_scl_y__roi);
            o_state.o_zoom.n_x__roi = Math.round(Math.min(Math.max(n_x, 0), n_x__max));
            o_state.o_zoom.n_y__roi = Math.round(Math.min(Math.max(n_y, 0), n_y__max));
        },
        f_on_pan_up: function() {
            let o_self = this;
            if(!o_self.b_dragging__pan) return;
            o_self.b_dragging__pan = false;
            o_self.f_remove_drag_listener__pan();
            o_self.f_on_change();
        },
        f_remove_drag_listener__pan: function() {
            let o_self = this;
            if(o_self._f_on_pan_move) window.removeEventListener('pointermove', o_self._f_on_pan_move);
            if(o_self._f_on_pan_up){
                window.removeEventListener('pointerup', o_self._f_on_pan_up);
                window.removeEventListener('pointercancel', o_self._f_on_pan_up);
            }
            o_self._f_on_pan_move = null;
            o_self._f_on_pan_up = null;
        },
        // a lost window (focus switch, alt-tab) must not leave a drag half open
        f_cancel_drag: function() {
            let o_self = this;
            o_self.b_dragging = false;
            o_self.b_dragging__pan = false;
            o_self.b_dragging__resize = false;
            o_self.b_dragging__panel = false;
            o_self.f_remove_drag_listener__pick();
            o_self.f_remove_drag_listener__pan();
            o_self.f_remove_drag_listener__resize();
            o_self.f_remove_drag_listener__panel();
        },

        // ─── window dragging ────────────────────────────────────────

        f_on_panel_down: function(o_evt) {
            let o_self = this;
            if(o_evt.button !== 0) return;
            if(o_evt.target.closest && o_evt.target.closest('.panel-close')) return;
            let o_rect = o_self.$refs.el_panel.getBoundingClientRect();
            o_self.o_panel_off = { n_x: o_evt.clientX - o_rect.left, n_y: o_evt.clientY - o_rect.top };
            o_self.b_dragging__panel = true;
            o_self._f_on_panel_move = function(o_evt2){ o_self.f_on_panel_move(o_evt2); };
            o_self._f_on_panel_up = function(o_evt2){ o_self.f_on_panel_up(o_evt2); };
            window.addEventListener('pointermove', o_self._f_on_panel_move);
            window.addEventListener('pointerup', o_self._f_on_panel_up);
            window.addEventListener('pointercancel', o_self._f_on_panel_up);
            o_evt.preventDefault();
        },
        f_on_panel_move: function(o_evt) {
            let o_self = this;
            if(!o_self.b_dragging__panel) return;
            let n_x = o_evt.clientX - o_self.o_panel_off.n_x;
            let n_y = o_evt.clientY - o_self.o_panel_off.n_y;
            o_state.o_zoom.n_px__panel_x = Math.min(Math.max(0, n_x), Math.max(0, window.innerWidth - 80));
            o_state.o_zoom.n_px__panel_y = Math.min(Math.max(o_self.f_n_px__panel_top(), n_y), Math.max(0, window.innerHeight - 60));
        },
        f_on_panel_up: function(o_evt) {
            let o_self = this;
            if(!o_self.b_dragging__panel) return;
            o_self.b_dragging__panel = false;
            o_self.f_remove_drag_listener__panel();
            f_save_setting__debounced('o_zoom', o_state.o_zoom);
        },
        f_remove_drag_listener__panel: function() {
            let o_self = this;
            if(o_self._f_on_panel_move) window.removeEventListener('pointermove', o_self._f_on_panel_move);
            if(o_self._f_on_panel_up){
                window.removeEventListener('pointerup', o_self._f_on_panel_up);
                window.removeEventListener('pointercancel', o_self._f_on_panel_up);
            }
            o_self._f_on_panel_move = null;
            o_self._f_on_panel_up = null;
        },
        f_clamp_panel: function() {
            let o_self = this;
            // a stored size from a bigger screen would otherwise push the slider
            // past its max — keep the preview within what this window can show
            o_state.o_zoom.n_scl_x__mag = Math.min(Math.max(o_state.o_zoom.n_scl_x__mag, N_PX__PREVIEW_MIN), o_self.n_scl_x__preview_max);
            let n_scl_x__panel = o_state.o_zoom.n_scl_x__mag + N_PX__PANEL_CHROME;
            if(o_state.o_zoom.n_px__panel_x < 0 || o_state.o_zoom.n_px__panel_x > window.innerWidth - 80){
                o_state.o_zoom.n_px__panel_x = Math.max(8, window.innerWidth - n_scl_x__panel - 16);
            }
            if(o_state.o_zoom.n_px__panel_y < 0 || o_state.o_zoom.n_px__panel_y > window.innerHeight - 60){
                o_state.o_zoom.n_px__panel_y = o_self.f_n_px__panel_top();
            }
            o_self.f_fit_panel();
        },
        // the toolbar is fixed on top and taller than one row, so the window
        // must never be dragged under it (its header would become unreachable)
        f_n_px__panel_top: function() {
            let el_toolbar = document.querySelector('.toolbar');
            let n_scl_y__toolbar = el_toolbar ? el_toolbar.offsetHeight : 0;
            return Math.max(0, n_scl_y__toolbar) + 4;
        },
        // pull the window back on screen after a resize and keep the header clear
        f_fit_panel: function() {
            let o_self = this;
            let n_scl_x__panel = o_state.o_zoom.n_scl_x__mag + N_PX__PANEL_CHROME;
            if(o_state.o_zoom.n_px__panel_x + n_scl_x__panel > window.innerWidth - 8){
                o_state.o_zoom.n_px__panel_x = Math.max(8, window.innerWidth - n_scl_x__panel - 8);
            }
            let n_y__top = o_self.f_n_px__panel_top();
            if(o_state.o_zoom.n_px__panel_y < n_y__top) o_state.o_zoom.n_px__panel_y = n_y__top;
            // leave at least a little picture room below the window
            let n_y__max = Math.max(n_y__top, window.innerHeight - N_PX__PANEL_VERTICAL - 120);
            if(o_state.o_zoom.n_px__panel_y > n_y__max) o_state.o_zoom.n_px__panel_y = n_y__max;
        },
        f_on_resize: function() {
            this.n_scl_x__win = window.innerWidth;
            this.n_scl_y__win = window.innerHeight;
            this.f_clamp_panel();
        },
        f_close: function() {
            o_state.o_panel_visibility.zoom = false;
            o_state.o_zoom.b_selecting = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_on_change: function() {
            f_save_setting__debounced('o_zoom', o_state.o_zoom);
        },

        // ─── rendering ──────────────────────────────────────────────

        // size a canvas to a CSS box in device pixels and return the ratio
        f_n_dpr__canvas: function(el_canvas, n_scl_x, n_scl_y) {
            let n_dpr = window.devicePixelRatio || 1;
            let n_px_x = Math.max(1, Math.round(n_scl_x * n_dpr));
            let n_px_y = Math.max(1, Math.round(n_scl_y * n_dpr));
            if(el_canvas.width !== n_px_x || el_canvas.height !== n_px_y){
                el_canvas.width = n_px_x;
                el_canvas.height = n_px_y;
            }
            el_canvas.style.width = n_scl_x + 'px';
            el_canvas.style.height = n_scl_y + 'px';
            return n_dpr;
        },
        f_sync_frame: function() {
            let o_self = this;
            if(o_state.o_panel_visibility.zoom && o_state.b_streaming__webcam){
                o_self.f_start_frame();
            } else {
                o_self.f_stop_frame();
                o_self.f_draw_roi();
            }
        },
        f_start_frame: function() {
            let o_self = this;
            if(o_self.b_running__frame) return;
            let f_step = function() {
                o_self.n_id__frame = 0;
                if(!o_self.b_running__frame) return;
                o_self.f_draw_roi();
                o_self.f_draw_mag();
                o_self.n_id__frame = requestAnimationFrame(f_step);
            };
            o_self.b_running__frame = true;
            o_self.n_id__frame = requestAnimationFrame(f_step);
        },
        f_stop_frame: function() {
            let o_self = this;
            o_self.b_running__frame = false;
            if(o_self.n_id__frame){
                cancelAnimationFrame(o_self.n_id__frame);
                o_self.n_id__frame = 0;
            }
        },
        f_draw_roi: function() {
            let o_self = this;
            let el_canvas = o_self.$refs.el_roi;
            if(!el_canvas) return;
            let n_scl_x = window.innerWidth;
            let n_scl_y = window.innerHeight;
            let n_dpr = o_self.f_n_dpr__canvas(el_canvas, n_scl_x, n_scl_y);
            let o_ctx = el_canvas.getContext('2d');
            o_ctx.setTransform(n_dpr, 0, 0, n_dpr, 0, 0);
            o_ctx.clearRect(0, 0, n_scl_x, n_scl_y);
            if(!o_state.o_panel_visibility.zoom) return;

            let o_box = o_self.f_o_box__video();
            if(!o_box) return;
            let o_roi = o_self.f_o_roi__draw();
            if(!o_roi) return;

            let n_x = o_box.n_x + o_roi.n_x * o_box.n_scl;
            let n_y = o_box.n_y + o_roi.n_y * o_box.n_scl;
            let n_scl_x__roi = o_roi.n_scl_x * o_box.n_scl;
            let n_scl_y__roi = o_roi.n_scl_y * o_box.n_scl;

            // dim everything outside the region so the magnification is obvious
            o_ctx.fillStyle = o_self.b_dragging ? 'rgba(0,0,0,0.38)' : 'rgba(0,0,0,0.18)';
            o_ctx.beginPath();
            o_ctx.rect(0, 0, n_scl_x, n_scl_y);
            o_ctx.rect(n_x, n_y, n_scl_x__roi, n_scl_y__roi);
            o_ctx.fill('evenodd');

            // frame + crop-style corner ticks
            o_ctx.strokeStyle = '#00d4aa';
            o_ctx.lineWidth = 1.5;
            o_ctx.strokeRect(n_x + 0.5, n_y + 0.5, n_scl_x__roi - 1, n_scl_y__roi - 1);
            let n_len = Math.max(6, Math.min(18, Math.min(n_scl_x__roi, n_scl_y__roi) * 0.25));
            o_ctx.lineWidth = 3;
            o_ctx.beginPath();
            for(let o_corner of [
                { n_x: n_x, n_y: n_y, n_dx: 1, n_dy: 1 },
                { n_x: n_x + n_scl_x__roi, n_y: n_y, n_dx: -1, n_dy: 1 },
                { n_x: n_x, n_y: n_y + n_scl_y__roi, n_dx: 1, n_dy: -1 },
                { n_x: n_x + n_scl_x__roi, n_y: n_y + n_scl_y__roi, n_dx: -1, n_dy: -1 },
            ]){
                o_ctx.moveTo(o_corner.n_x + o_corner.n_dx * n_len, o_corner.n_y);
                o_ctx.lineTo(o_corner.n_x, o_corner.n_y);
                o_ctx.lineTo(o_corner.n_x, o_corner.n_y + o_corner.n_dy * n_len);
            }
            o_ctx.stroke();
        },
        f_draw_mag: function() {
            let o_self = this;
            let el_canvas = o_self.$refs.el_mag;
            if(!el_canvas) return;
            if(!o_self.b_active){
                o_self.f_n_dpr__canvas(el_canvas, 0, 0);
                return;
            }
            let el_video = document.getElementById('webcamVideo');
            let o_box = o_self.f_o_box__video();
            if(!el_video || !o_box || el_video.readyState < 2) return;

            // clamp the stored region to the frame that is actually there
            let n_x = Math.max(0, Math.min(o_state.o_zoom.n_x__roi, o_box.n_scl_x__video - 1));
            let n_y = Math.max(0, Math.min(o_state.o_zoom.n_y__roi, o_box.n_scl_y__video - 1));
            let n_scl_x__roi = Math.max(1, Math.min(o_state.o_zoom.n_scl_x__roi, o_box.n_scl_x__video - n_x));
            let n_scl_y__roi = Math.max(1, Math.min(o_state.o_zoom.n_scl_y__roi, o_box.n_scl_y__video - n_y));

            // the window width is the zoom control; the height follows the
            // region so the picture is never distorted.  both are capped only by
            // the room this window actually has — there is no fixed size limit
            let n_scl_x__out = Math.max(80, Math.min(o_state.o_zoom.n_scl_x__mag, o_self.n_scl_x__preview_max));
            let n_scl_y__out = Math.round(n_scl_x__out * n_scl_y__roi / n_scl_x__roi);
            let n_scl_y__max = Math.max(120, o_self.n_scl_y__win - o_state.o_zoom.n_px__panel_y - N_PX__PANEL_VERTICAL);
            if(n_scl_y__out > n_scl_y__max){
                n_scl_y__out = n_scl_y__max;
                n_scl_x__out = Math.round(n_scl_y__out * n_scl_x__roi / n_scl_y__roi);
            }
            // never break the region's aspect ratio to satisfy a minimum: a very
            // wide, short region is legitimately a short strip
            n_scl_x__out = Math.max(1, n_scl_x__out);
            n_scl_y__out = Math.max(1, n_scl_y__out);

            let n_dpr = o_self.f_n_dpr__canvas(el_canvas, n_scl_x__out, n_scl_y__out);
            let o_ctx = el_canvas.getContext('2d');
            o_ctx.setTransform(n_dpr, 0, 0, n_dpr, 0, 0);
            o_ctx.imageSmoothingEnabled = o_state.o_zoom.s_resample !== 'pixelated';
            o_ctx.clearRect(0, 0, n_scl_x__out, n_scl_y__out);
            o_ctx.drawImage(
                el_video,
                n_x, n_y, n_scl_x__roi, n_scl_y__roi,
                0, 0, n_scl_x__out, n_scl_y__out
            );
        },
    },
};

export { o_component__zoom };
