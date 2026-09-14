import { o_state, f_send_wsmsg_with_response, f_save_setting__debounced } from './index.js';
import { f_o_wsmsg } from './constructors.module.js';

// how long the stage has to stand still before a frame is taken
let N_MS__SETTLE = 700;
// never take two frames closer together than this
let N_MS__CAPTURE_MIN_GAP = 1200;
// how often the mosaic status is polled while a session runs
let N_MS__STATUS_POLL = 1000;
// the working frame the stitcher runs on is downscaled to this long side --
// registration and repaints are ~4x cheaper than at full camera resolution
let N_PX__FRAME__MAX = 960;
// jpeg quality of the working frame (the full-res archive stays a png)
let N_QUALITY__FRAME_JPEG = 0.88;
// skip the capture while the stage moved less than this (sum of both axes)
// since the last frame -- those frames would only add duplicate tiles
let N_STEP__MIN_MOVE = 10;

let o_component__live_stitch = {
    name: 'component-live-stitch',
    template: `
        <div class="overlay-panel panel-live-stitch" :class="{ visible: o_state.o_panel_visibility.live_stitch }">
            <div class="panel-header">
                <h2>Live Stitch</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">

                <div class="live-row">
                    <span class="live-state" :class="'state-' + o_status.s_status">
                        <span class="live-dot"></span>
                        {{ f_s_label__status() }}
                    </span>
                    <div class="live-row-buttons">
                        <button
                            v-if="!o_status.b_running"
                            class="toolbar-toggle"
                            @click="f_start"
                            :disabled="b_busy || !o_state.b_streaming__webcam"
                        >Start</button>
                        <template v-else>
                            <button class="toolbar-toggle" @click="f_stop(false)" :disabled="b_busy">Stop</button>
                            <button class="toolbar-toggle" @click="f_stop(true)" :disabled="b_busy">Stop + repaint</button>
                        </template>
                    </div>
                </div>

                <div class="live-note" v-if="!o_state.b_streaming__webcam">
                    start a camera in the top bar first — the frames come from the live image
                </div>
                <div class="live-note" v-else-if="!o_status.b_running">
                    every time the motors come to a stop a frame is taken and placed into
                    the mosaic. Move the stage with the mouse, WASD or a macro and watch it grow.
                </div>
                <div class="live-note" v-else-if="o_status.s_status === 'waiting'">
                    waiting for the first two overlapping frames — move the stage a little
                </div>
                <div class="live-note" v-if="o_status.s_error">{{ o_status.s_error }}</div>

                <div class="live-stat">
                    <div><span>captured</span><b>{{ n_cnt__captured }}</b></div>
                    <div><span>placed</span><b>{{ o_status.n_cnt__tile }}</b></div>
                    <div><span>pending</span><b>{{ o_status.n_cnt__pending }}</b></div>
                    <div><span>mosaic</span><b>{{ o_status.n_scl_x__mosaic }}&times;{{ o_status.n_scl_y__mosaic }}</b></div>
                </div>

                <div class="live-mosaic">
                    <img v-if="s_src__mosaic" :src="s_src__mosaic" class="live-mosaic-image">
                    <div v-else class="live-mosaic-empty">no mosaic yet</div>
                </div>

                <div class="live-row" style="margin-top: 10px;">
                    <label class="scan-toggle">
                        <input type="checkbox" v-model="b_capture__on_idle" @change="f_save_config">
                        <span>capture on standstill</span>
                    </label>
                    <button class="toolbar-toggle" @click="f_capture_now" :disabled="!o_status.b_running">
                        capture now
                    </button>
                </div>

                <div class="live-row">
                    <span class="live-label">Min. match score</span>
                    <input
                        type="number"
                        class="live-number"
                        v-model.number="n_score__min"
                        min="0.05" max="0.95" step="0.05"
                        @change="f_save_config"
                    >
                </div>

                <div class="live-row">
                    <span class="live-label">Min. move (steps)</span>
                    <input
                        type="number"
                        class="live-number"
                        v-model.number="n_step__min_move"
                        min="0"
                        @change="f_save_config"
                    >
                </div>

                <div class="live-row">
                    <label class="scan-toggle">
                        <input type="checkbox" v-model="b_archive__full" @change="f_save_config">
                        <span>archive full-res copies</span>
                    </label>
                </div>

                <div class="live-log-wrap" v-if="o_status.a_s_line && o_status.a_s_line.length">
                    <button class="btn-small" @click="b_visible__log = !b_visible__log">
                        {{ b_visible__log ? 'hide' : 'show' }} log
                    </button>
                    <div class="live-log" v-if="b_visible__log">
                        <div v-for="(s_line, n_idx) in o_status.a_s_line" :key="n_idx">{{ s_line }}</div>
                    </div>
                </div>

                <div class="live-note" v-if="o_status.s_path_folder">{{ o_status.s_path_folder }}</div>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            b_busy: false,
            b_visible__log: false,
            b_capture__on_idle: true,
            n_score__min: 0.3,
            b_archive__full: true,
            n_step__min_move: N_STEP__MIN_MOVE,
            n_cnt__captured: 0,
            n_ts_ms__capture__last: 0,
            // motor positions of the last capture (null = next capture always)
            a_n_pos__capture__last: [null, null],
            n_id__settle_timeout: 0,
            n_id__status_interval: 0,
            o_status: {
                b_running: false,
                s_status: 'idle',
                s_error: '',
                s_path_folder: '',
                s_path_mosaic: '',
                s_path_preview: '',
                n_cnt__image: 0,
                n_cnt__tile: 0,
                n_cnt__pending: 0,
                n_scl_x__mosaic: 0,
                n_scl_y__mosaic: 0,
                n_ts_ms__mosaic: 0,
                a_s_line: [],
            },
        };
    },
    computed: {
        b_moving__motor: function() {
            return o_state.a_o_motor.some(function(o_motor){ return o_motor.b_running; });
        },
        // the preview is only written once the mosaic outgrows it
        s_src__mosaic: function() {
            let o_self = this;
            if(!o_self.o_status.n_ts_ms__mosaic) return '';
            let s_path = o_self.o_status.s_path_preview || o_self.o_status.s_path_mosaic;
            if(!s_path) return '';
            // the timestamp busts the browser cache on every repaint
            return '/api/file?path=' + encodeURIComponent(s_path)
                + '&n_ts_ms=' + o_self.o_status.n_ts_ms__mosaic;
        },
    },
    watch: {
        b_moving__motor: function(b_moving) {
            let o_self = this;
            if(b_moving){
                // moving again -> whatever was scheduled is stale
                clearTimeout(o_self.n_id__settle_timeout);
                o_self.n_id__settle_timeout = 0;
                return;
            }
            o_self.f_schedule_capture();
        },
    },
    methods: {
        f_close: function() {
            o_state.o_panel_visibility.live_stitch = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_save_config: function() {
            f_save_setting__debounced('o_config__live_stitch', {
                b_capture__on_idle: this.b_capture__on_idle,
                n_score__min: this.n_score__min,
                b_archive__full: this.b_archive__full,
                n_step__min_move: this.n_step__min_move,
            });
        },
        f_load_config: function() {
            let o_self = this;
            let o_setting = o_state.a_o_setting.find(function(o){
                return o.s_key === 'o_config__live_stitch';
            });
            if(!o_setting || !o_setting.s_value) return;
            try {
                let o_config = JSON.parse(o_setting.s_value);
                if(typeof o_config.b_capture__on_idle === 'boolean'){
                    o_self.b_capture__on_idle = o_config.b_capture__on_idle;
                }
                if(o_config.n_score__min) o_self.n_score__min = o_config.n_score__min;
                if(typeof o_config.b_archive__full === 'boolean'){
                    o_self.b_archive__full = o_config.b_archive__full;
                }
                if(typeof o_config.n_step__min_move === 'number'){
                    o_self.n_step__min_move = o_config.n_step__min_move;
                }
            } catch(e) { /* ignore parse errors */ }
        },
        f_set_status: function(o_status) {
            this.o_status = o_status;
            // the toolbar shows a running session even with this panel closed
            o_state.b_running__live_stitch = o_status.b_running === true;
        },
        f_s_label__status: function() {
            let o_self = this;
            if(!o_self.o_status.b_running){
                return o_self.o_status.s_status === 'complete' ? 'stopped' : 'off';
            }
            if(o_self.o_status.s_status === 'building') return 'building mosaic';
            if(o_self.o_status.s_status === 'waiting') return 'waiting for frames';
            return 'live';
        },

        // ── Session control ─────────────────────────────────────────

        f_start: async function() {
            let o_self = this;
            o_self.b_busy = true;
            try {
                let n_scl_x__video = 0;
                let el_video = document.getElementById('webcamVideo');
                if(el_video && el_video.videoWidth) n_scl_x__video = el_video.videoWidth;
                let o_resp = await f_send_wsmsg_with_response(
                    f_o_wsmsg('live_stitch_start', {
                        n_score__min: o_self.n_score__min,
                        n_scl_x__video: n_scl_x__video,
                    })
                );
                let o_result = o_resp.v_result;
                if(o_result && o_result.b_success){
                    o_self.n_cnt__captured = 0;
                    o_self.n_ts_ms__capture__last = 0;
                    o_self.a_n_pos__capture__last = [null, null];
                    if(o_result.o_status) o_self.f_set_status(o_result.o_status);
                    o_self.f_start_status_poll();
                    // the first frame is the seed of the mosaic
                    await o_self.f_capture();
                } else {
                    console.error('live stitch start failed:', o_result);
                }
            } catch(o_error) {
                console.error('live_stitch_start error:', o_error);
            }
            o_self.b_busy = false;
        },
        f_stop: async function(b_repaint) {
            let o_self = this;
            o_self.b_busy = true;
            clearTimeout(o_self.n_id__settle_timeout);
            try {
                let o_resp = await f_send_wsmsg_with_response(
                    f_o_wsmsg('live_stitch_stop', { b_repaint: b_repaint === true })
                );
                if(o_resp.v_result && o_resp.v_result.o_status){
                    o_self.f_set_status(o_resp.v_result.o_status);
                }
            } catch(o_error) {
                console.error('live_stitch_stop error:', o_error);
            }
            o_self.f_stop_status_poll();
            o_self.b_busy = false;
        },

        // ── Status polling ──────────────────────────────────────────

        f_poll_status: async function() {
            let o_self = this;
            try {
                let o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('live_stitch_status', {}));
                if(o_resp.v_result) o_self.f_set_status(o_resp.v_result);
                if(!o_self.o_status.b_running) o_self.f_stop_status_poll();
            } catch(o_error) {
                /* socket hiccup, the next tick tries again */
            }
        },
        f_start_status_poll: function() {
            let o_self = this;
            if(o_self.n_id__status_interval) return;
            o_self.n_id__status_interval = setInterval(function(){ o_self.f_poll_status(); }, N_MS__STATUS_POLL);
        },
        f_stop_status_poll: function() {
            clearInterval(this.n_id__status_interval);
            this.n_id__status_interval = 0;
        },

        // ── Capture on standstill ───────────────────────────────────

        f_schedule_capture: function() {
            let o_self = this;
            if(!o_self.o_status.b_running) return;
            if(!o_self.b_capture__on_idle) return;
            // the tile scan captures on its own grid, do not shoot into it
            if(o_state.b_scanning) return;

            clearTimeout(o_self.n_id__settle_timeout);
            o_self.n_id__settle_timeout = setTimeout(function(){
                o_self.n_id__settle_timeout = 0;
                if(o_self.b_moving__motor) return;
                o_self.f_capture();
            }, N_MS__SETTLE);
        },
        f_capture_now: function() {
            this.f_capture(true);
        },
        f_capture: async function(b_force) {
            let o_self = this;
            if(!o_self.o_status.b_running) return;
            let n_ts_ms = Date.now();
            if(!b_force && n_ts_ms - o_self.n_ts_ms__capture__last < N_MS__CAPTURE_MIN_GAP) return;
            // the stage barely moved since the last frame -> nothing new to stitch
            if(!b_force && o_self.a_n_pos__capture__last[0] !== null){
                let n_move = 0;
                for(let n_idx = 0; n_idx < 2; n_idx++){
                    let o_motor = o_state.a_o_motor[n_idx];
                    let n_pos = (o_motor && typeof o_motor.n_position === 'number')
                        ? o_motor.n_position : 0;
                    n_move += Math.abs(n_pos - o_self.a_n_pos__capture__last[n_idx]);
                }
                if(n_move < o_self.n_step__min_move) return;
            }
            o_self.n_ts_ms__capture__last = n_ts_ms;

            try {
                let o_frame = await o_self.f_o_blob__frame();
                let s_name = String(o_self.n_cnt__captured + 1).padStart(4, '0');
                await o_self.f_save_image(o_frame.o_blob__live, 'live_' + s_name + '.jpg');
                if(o_self.b_archive__full){
                    await o_self.f_save_image(o_frame.o_blob__full, 'full_' + s_name + '.png');
                }
                o_self.a_n_pos__capture__last[0] = o_state.a_o_motor[0]
                    ? o_state.a_o_motor[0].n_position : null;
                o_self.a_n_pos__capture__last[1] = o_state.a_o_motor[1]
                    ? o_state.a_o_motor[1].n_position : null;
                o_self.n_cnt__captured++;
            } catch(o_error) {
                console.error('live stitch capture failed:', o_error);
            }
        },
        f_o_blob__frame: function() {
            return new Promise(function(resolve, reject) {
                let el_video = document.getElementById('webcamVideo');
                if(!el_video || !el_video.srcObject || el_video.readyState < 2){
                    reject(new Error('No webcam stream available'));
                    return;
                }
                let n_scl_x__video = el_video.videoWidth;
                let n_scl_y__video = el_video.videoHeight;

                // the working frame the stitcher runs on: downscaled jpeg
                let n_scl = Math.min(1, N_PX__FRAME__MAX / Math.max(n_scl_x__video, 1));
                let n_scl_x__live = Math.max(1, Math.round(n_scl_x__video * n_scl));
                let n_scl_y__live = Math.max(1, Math.round(n_scl_y__video * n_scl));
                let el_canvas__live = document.createElement('canvas');
                el_canvas__live.width = n_scl_x__live;
                el_canvas__live.height = n_scl_y__live;
                el_canvas__live.getContext('2d')
                    .drawImage(el_video, 0, 0, n_scl_x__live, n_scl_y__live);

                // the archived copy stays at full resolution
                let el_canvas__full = document.createElement('canvas');
                el_canvas__full.width = n_scl_x__video;
                el_canvas__full.height = n_scl_y__video;
                el_canvas__full.getContext('2d').drawImage(el_video, 0, 0);

                let o_frame = {};
                let n_cnt__done = 0;
                let f_done = function() {
                    n_cnt__done++;
                    if(n_cnt__done === 2){
                        if(o_frame.o_blob__live && o_frame.o_blob__full) resolve(o_frame);
                        else reject(new Error('Failed to capture frame'));
                    }
                };
                el_canvas__live.toBlob(function(o_blob){
                    o_frame.o_blob__live = o_blob;
                    f_done();
                }, 'image/jpeg', N_QUALITY__FRAME_JPEG);
                el_canvas__full.toBlob(function(o_blob){
                    o_frame.o_blob__full = o_blob;
                    f_done();
                }, 'image/png');
            });
        },
        f_save_image: async function(o_blob, s_filename) {
            let o_self = this;
            let o_array_buffer = await o_blob.arrayBuffer();
            let o_response = await fetch(
                '/api/scan/save_image'
                    + '?s_path_folder=' + encodeURIComponent(o_self.o_status.s_path_folder)
                    + '&s_filename=' + encodeURIComponent(s_filename),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: o_array_buffer,
                }
            );
            if(!o_response.ok){
                throw new Error('Failed to save image: ' + o_response.statusText);
            }
        },
    },
    mounted: function() {
        let o_self = this;
        o_self.f_load_config();
        // a session may still be running from before a page reload
        o_self.f_poll_status().then(function(){
            if(o_self.o_status.b_running) o_self.f_start_status_poll();
        });
    },
    beforeUnmount: function() {
        let o_self = this;
        clearTimeout(o_self.n_id__settle_timeout);
        o_self.f_stop_status_poll();
    },
};

export { o_component__live_stitch };
