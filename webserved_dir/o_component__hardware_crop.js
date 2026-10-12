import { o_state, f_save_setting__debounced } from './index.js';
import { f_b_camera_resolution_locked } from './o_camera.module.js';
import { f_s_camera_crop_key, f_b_camera_crop_valid } from './camera_frame.module.js';

let o_component__hardware_crop = {
    name: 'component-hardware-crop',
    template: `
        <div class="camera-setting-group hardware-crop">
            <strong>Hardware crop</strong>
            <p>Keep only the usable optical image. This crop is applied before filters, calibration,
                stitching, training, map matching and recordings, without resizing pixels.</p>
            <p>Draw a rectangle inside the tube edges on the full sensor preview, or enter its pixel coordinates.</p>
            <canvas ref="el_preview" aria-label="Full sensor preview: drag to select hardware crop"
                @pointerdown.stop.prevent="f_start" @pointermove.stop.prevent="f_drag"
                @pointerup.stop.prevent="f_end" @pointercancel="o_start = null"></canvas>
            <form @submit.prevent="f_apply(false)">
                <fieldset :disabled="b_locked || !o_state.b_streaming__webcam">
                    <legend>Crop in sensor pixels</legend>
                    <div class="hardware-crop-input">
                        <label>Left <input aria-label="Hardware crop left" type="number" min="0" :max="n_scl_x - 1" step="1" required v-model.number="o_draft.n_x" /></label>
                        <label>Top <input aria-label="Hardware crop top" type="number" min="0" :max="n_scl_y - 1" step="1" required v-model.number="o_draft.n_y" /></label>
                        <label>Width <input aria-label="Hardware crop width" type="number" min="1" :max="n_scl_x - o_draft.n_x" step="1" required v-model.number="o_draft.n_scl_x" /></label>
                        <label>Height <input aria-label="Hardware crop height" type="number" min="1" :max="n_scl_y - o_draft.n_y" step="1" required v-model.number="o_draft.n_scl_y" /></label>
                    </div>
                    <button type="submit">Apply hardware crop</button>
                    <button type="button" @click="f_apply(true)">Reset to full sensor</button>
                </fieldset>
            </form>
            <p>Output: {{ o_output.n_scl_x }} × {{ o_output.n_scl_y }} px.
                Saved separately for this camera and sensor resolution.</p>
            <p>Set the crop before calibration and collecting images. Changing it clears live selections;
                flat-field correction requires a matching calibration.</p>
            <p v-if="b_locked">Stop capture, scanning, calibration or recording before changing the crop.</p>
            <p v-if="s_error" role="alert">{{ s_error }}</p>
        </div>
    `,
    data() {
        return { o_state, o_draft: { n_x: 0, n_y: 0, n_scl_x: 1, n_scl_y: 1 }, o_start: null, s_error: '' };
    },
    computed: {
        n_scl_x() { return o_state.o_camera.n_width || 0; },
        n_scl_y() { return o_state.o_camera.n_height || 0; },
        s_key() { return f_s_camera_crop_key(o_state.s_id__webcam_device || o_state.o_camera.s_device_id, this.n_scl_x, this.n_scl_y); },
        b_locked() { return f_b_camera_resolution_locked() || !!o_state.o_camera.b_applying_resolution; },
        o_output() {
            let o_crop = o_state.o_hardware_crop?.[this.s_key];
            return f_b_camera_crop_valid(o_crop, this.n_scl_x, this.n_scl_y)
                ? o_crop : { n_x: 0, n_y: 0, n_scl_x: this.n_scl_x, n_scl_y: this.n_scl_y };
        },
    },
    watch: {
        s_key() { this.f_reset_draft(); },
        'o_state.o_panel_visibility.camera_setting'(b_visible) { if (b_visible) this.f_reset_draft(); },
    },
    methods: {
        f_reset_draft() { this.o_draft = { ...this.o_output }; this.o_start = null; this.s_error = ''; },
        f_point(o_event) {
            let o_rect = this.$refs.el_preview.getBoundingClientRect();
            return {
                n_x: Math.max(0, Math.min(this.n_scl_x, Math.round((o_event.clientX - o_rect.left) * this.n_scl_x / o_rect.width))),
                n_y: Math.max(0, Math.min(this.n_scl_y, Math.round((o_event.clientY - o_rect.top) * this.n_scl_y / o_rect.height))),
            };
        },
        f_start(o_event) {
            if (this.b_locked || o_event.button !== 0) return;
            this.o_start = this.f_point(o_event);
            this.$refs.el_preview.setPointerCapture(o_event.pointerId);
        },
        f_drag(o_event) {
            if (!this.o_start || this.b_locked) return;
            let o_end = this.f_point(o_event);
            this.o_draft = {
                n_x: Math.min(this.o_start.n_x, o_end.n_x), n_y: Math.min(this.o_start.n_y, o_end.n_y),
                n_scl_x: Math.abs(o_end.n_x - this.o_start.n_x), n_scl_y: Math.abs(o_end.n_y - this.o_start.n_y),
            };
        },
        f_end(o_event) {
            this.f_drag(o_event);
            this.o_start = null;
            if (this.$refs.el_preview.hasPointerCapture(o_event.pointerId)) this.$refs.el_preview.releasePointerCapture(o_event.pointerId);
        },
        f_apply(b_reset) {
            this.s_error = '';
            if (this.b_locked) { this.s_error = 'Stop the current capture or recording first.'; return false; }
            let el_video = document.getElementById('webcamVideo');
            if (!el_video || el_video.readyState < 2 || el_video.videoWidth !== this.n_scl_x || el_video.videoHeight !== this.n_scl_y) {
                this.s_error = 'Wait for the camera to deliver the selected sensor resolution.'; return false;
            }
            if (!b_reset && !f_b_camera_crop_valid(this.o_draft, this.n_scl_x, this.n_scl_y)) {
                this.s_error = 'Enter a rectangle of whole pixels entirely inside the sensor image.'; return false;
            }
            o_state.o_hardware_crop ||= {};
            if (b_reset) delete o_state.o_hardware_crop[this.s_key];
            else o_state.o_hardware_crop[this.s_key] = { ...this.o_draft };
            f_save_setting__debounced('o_hardware_crop', o_state.o_hardware_crop);
            if (o_state.o_zoom) {
                Object.assign(o_state.o_zoom, { n_x__roi: 0, n_y__roi: 0, n_scl_x__roi: 0, n_scl_y__roi: 0, b_selecting: false });
                f_save_setting__debounced('o_zoom', o_state.o_zoom);
            }
            if (o_state.o_cellpose) o_state.o_cellpose.s_path_mask = '';
            this.f_reset_draft();
            return true;
        },
        f_preview() {
            let el_video = document.getElementById('webcamVideo');
            let el_canvas = this.$refs.el_preview;
            if (o_state.o_panel_visibility.camera_setting && el_video?.readyState >= 2 && el_video.videoWidth && el_canvas) {
                let n_scl_x = Math.min(640, el_video.videoWidth);
                let n_scl_y = Math.round(n_scl_x * el_video.videoHeight / el_video.videoWidth);
                if (el_canvas.width !== n_scl_x) el_canvas.width = n_scl_x;
                if (el_canvas.height !== n_scl_y) el_canvas.height = n_scl_y;
                let o_ctx = el_canvas.getContext('2d');
                o_ctx.drawImage(el_video, 0, 0, n_scl_x, n_scl_y);
                let o_crop = this.o_draft;
                let n_scale = n_scl_x / el_video.videoWidth;
                o_ctx.fillStyle = '#0008';
                o_ctx.beginPath(); o_ctx.rect(0, 0, n_scl_x, n_scl_y);
                o_ctx.rect(o_crop.n_x * n_scale, o_crop.n_y * n_scale, o_crop.n_scl_x * n_scale, o_crop.n_scl_y * n_scale);
                o_ctx.fill('evenodd');
                o_ctx.strokeStyle = '#59f2c5'; o_ctx.lineWidth = 2;
                o_ctx.strokeRect(o_crop.n_x * n_scale, o_crop.n_y * n_scale, o_crop.n_scl_x * n_scale, o_crop.n_scl_y * n_scale);
            }
            this._n_id__frame = requestAnimationFrame(() => this.f_preview());
        },
    },
    mounted() { this.f_reset_draft(); this.f_preview(); },
    beforeUnmount() { cancelAnimationFrame(this._n_id__frame); },
};

export { o_component__hardware_crop };
