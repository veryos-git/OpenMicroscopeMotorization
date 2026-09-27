import { o_state, f_save_setting, f_save_setting__debounced } from './index.js';
import { f_o_motion_config, f_o_motion_detector, f_o_motion_view } from './motion_detection.module.js';

let o_component__motion_detection = {
    name: 'component-motion-detection',
    template: `
        <canvas ref="el_overlay" class="motion-detection-overlay" aria-hidden="true"></canvas>
        <div class="overlay-panel panel-motion-detection" :class="{ visible: o_state.o_panel_visibility.motion_detection }">
            <div class="panel-header">
                <h2>Motion detection</h2>
                <button class="panel-close" aria-label="Close motion detection" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <label class="motion-detection-switch">
                    <input type="checkbox" v-model="o_config.b_enabled" @change="f_change" />
                    {{ o_config.b_enabled ? 'On' : 'Off' }}
                </label>
                <form @submit.prevent="f_change" class="motion-detection-config">
                    <label>Sensitivity
                        <select v-model="o_config.s_sensitivity" @change="f_change">
                            <option value="low">Low — ignore small brightness changes</option>
                            <option value="high">High — include subtle changes</option>
                        </select>
                    </label>
                    <label>Minimum object size (camera px²)
                        <input type="number" min="1" max="1000000000" step="1" required
                            v-model.number="o_config.n_area__min" @change="f_change" />
                    </label>
                    <label>Maximum object size (camera px²)
                        <input type="number" :min="o_config.n_area__min" max="1000000000" step="1" required
                            v-model.number="o_config.n_area__max" @change="f_change" />
                    </label>
                    <label>Minimum movement (camera px / sample)
                        <input type="number" min="0" max="100000" step="any" required
                            v-model.number="o_config.n_movement__min" @change="f_change" />
                    </label>
                </form>
                <p class="motion-detection-status" role="status">{{ s_status }}<span v-if="n_region"> · {{ n_region }} moving region{{ n_region === 1 ? '' : 's' }}</span></p>
                <p class="filter-note">Boxes mark changing regions, not identified organisms. Size is the approximate box area.
                    Minimum movement compares region centers between samples; 0 includes newly appearing regions.</p>
                <p class="filter-note">Analyzes up to 10 samples/s at reduced resolution. Tiny or fast-moving objects may be missed.
                    Stage movement pauses detection. Closing this panel leaves detection on.</p>
            </div>
        </div>
    `,
    data: function() {
        return { o_state, s_status: 'Off', n_region: 0 };
    },
    computed: {
        o_config: function() { return o_state.o_motion_detection; },
    },
    watch: {
        'o_config.b_enabled': function() { this.f_sync(); },
        'o_state.b_streaming__webcam': function() { this.f_sync(); },
    },
    mounted: function() {
        this._o_detector = f_o_motion_detector();
        this._el_analysis = document.createElement('canvas');
        this._o_context = this._el_analysis.getContext('2d', { willReadFrequently: true });
        this._f_visibility = () => this.f_sync();
        document.addEventListener('visibilitychange', this._f_visibility);
        this.f_sync();
    },
    beforeUnmount: function() {
        this.f_stop();
        document.removeEventListener('visibilitychange', this._f_visibility);
    },
    methods: {
        f_close: function() {
            o_state.o_panel_visibility.motion_detection = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_change: function() {
            Object.assign(this.o_config, f_o_motion_config(this.o_config));
            // A separate key is saved immediately so panel visibility cannot cancel it.
            f_save_setting('o_motion_detection', { ...this.o_config });
            this.f_sync();
        },
        f_clear: function() {
            let el = this.$refs.el_overlay;
            if (el) el.getContext('2d').clearRect(0, 0, el.width, el.height);
            this.n_region = 0;
        },
        f_stop: function() {
            clearInterval(this._n_timer);
            this._n_timer = null;
            this._o_detector?.f_reset();
            this._o_track = null;
            this._n_time = null;
            this.f_clear();
        },
        f_sync: function() {
            this.f_stop();
            if (!this.o_config.b_enabled) { this.s_status = 'Off'; return; }
            if (!o_state.b_streaming__webcam) { this.s_status = 'Waiting for camera'; return; }
            if (document.hidden) { this.s_status = 'Paused while tab is hidden'; return; }
            this.s_status = 'Waiting for camera frames';
            this._n_timer = setInterval(() => this.f_sample(), 100);
        },
        f_sample: function() {
            try {
                let el_video = document.getElementById('webcamVideo');
                let o_track = el_video?.srcObject?.getVideoTracks()[0];
                if (!el_video || el_video.readyState < 2 || !el_video.videoWidth || !el_video.videoHeight ||
                    !o_track || o_track.readyState === 'ended' || o_track.muted) {
                    this._o_detector.f_reset();
                    this.f_clear();
                    this.s_status = 'Waiting for camera frames';
                    return;
                }
                if (o_state.b_scanning || o_state.a_o_motor?.some(o => o.b_running)) {
                    this._n_settle_until = performance.now() + 400;
                }
                if (performance.now() < (this._n_settle_until || 0)) {
                    this._o_detector.f_reset();
                    this.f_clear();
                    this.s_status = 'Paused for stage movement';
                    return;
                }
                if (this._o_track !== o_track) {
                    this._o_detector.f_reset();
                    this._o_track = o_track;
                    this._n_time = null;
                }
                if (this._n_time === el_video.currentTime) {
                    if (performance.now() - this._n_last_frame > 500) {
                        this._o_detector.f_reset();
                        this.f_clear();
                        this.s_status = 'Waiting for camera frames';
                    }
                    return;
                }
                this._n_time = el_video.currentTime;
                this._n_last_frame = performance.now();
                let n_source_x = el_video.videoWidth, n_source_y = el_video.videoHeight;
                let n_scale = Math.min(1, 640 / Math.max(n_source_x, n_source_y));
                let n_x = Math.max(1, Math.round(n_source_x * n_scale));
                let n_y = Math.max(1, Math.round(n_source_y * n_scale));
                let el = this._el_analysis;
                if (el.width !== n_x || el.height !== n_y) { el.width = n_x; el.height = n_y; }
                this._o_context.drawImage(el_video, 0, 0, n_x, n_y);
                let a_n_rgba = this._o_context.getImageData(0, 0, n_x, n_y).data;
                let a_n_gray = new Uint8Array(n_x * n_y);
                for (let n = 0; n < a_n_gray.length; n++) {
                    a_n_gray[n] = Math.round(0.299 * a_n_rgba[n * 4] + 0.587 * a_n_rgba[n * 4 + 1] + 0.114 * a_n_rgba[n * 4 + 2]);
                }
                let o_result = this._o_detector.f_detect(a_n_gray, n_x, n_y, n_source_x, n_source_y, this.o_config);
                this.n_region = o_result.a_o_region.length;
                this.s_status = o_result.s_status;
                this.f_draw(el_video, o_result.a_o_region);
            } catch (o_error) {
                this.f_stop();
                this.s_status = 'Detection stopped: ' + o_error.message + '. Toggle off/on to retry.';
            }
        },
        f_draw: function(el_video, a_o_region) {
            let o_view = f_o_motion_view(el_video.getBoundingClientRect(), el_video.videoWidth, el_video.videoHeight);
            let el = this.$refs.el_overlay;
            Object.assign(el.style, { left: o_view.n_x + 'px', top: o_view.n_y + 'px',
                width: o_view.n_scl_x + 'px', height: o_view.n_scl_y + 'px' });
            let n_dpr = window.devicePixelRatio || 1;
            let n_x = Math.max(1, Math.round(o_view.n_scl_x * n_dpr));
            let n_y = Math.max(1, Math.round(o_view.n_scl_y * n_dpr));
            if (el.width !== n_x || el.height !== n_y) { el.width = n_x; el.height = n_y; }
            let o_ctx = el.getContext('2d');
            o_ctx.clearRect(0, 0, el.width, el.height);
            o_ctx.strokeStyle = '#00d4aa';
            o_ctx.lineWidth = 2 * n_dpr;
            for (let o of a_o_region) {
                o_ctx.strokeRect(o.n_x / el_video.videoWidth * el.width, o.n_y / el_video.videoHeight * el.height,
                    o.n_scl_x / el_video.videoWidth * el.width, o.n_scl_y / el_video.videoHeight * el.height);
            }
        },
    },
};
export { o_component__motion_detection };
