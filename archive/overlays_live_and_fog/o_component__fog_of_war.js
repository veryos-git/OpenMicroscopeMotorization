import { o_state, f_send_wsmsg_with_response, f_save_setting__debounced } from './index.js';
import { f_o_wsmsg } from './constructors.module.js';

// how often a frame is sampled from the live video and sent to the server
let N_MS__CAPTURE = 300;
// how often the server status (minimap + viewport) is polled
let N_MS__STATUS_POLL = 500;

let o_component__fog_of_war = {
    name: 'component-fog-of-war',
    template: `
        <div class="overlay-panel panel-fog" :class="{ visible: o_state.o_panel_visibility.fog_of_war }">
            <div class="panel-header">
                <h2>Fog of War</h2>
                <button class="panel-close" @click="f_close" :disabled="b_running">&times;</button>
            </div>
            <div class="panel-body">

                <div class="live-row">
                    <button
                        class="toolbar-toggle"
                        :disabled="!o_state.b_streaming__webcam"
                        @click="b_running ? f_stop() : f_start()"
                    >{{ b_running ? 'stop' : 'start' }}</button>
                    <button class="toolbar-toggle" @click="f_export" :disabled="!b_running && !s_path_folder">
                        export
                    </button>
                </div>

                <div class="live-note" v-if="!o_state.b_streaming__webcam">
                    start a camera in the top bar first
                </div>
                <div class="live-note" v-else-if="!b_running && !s_path_folder">
                    start a session, then move the slide around — every new area is
                    revealed and stays on the map.
                </div>
                <div class="live-note" v-if="s_status">{{ s_status }}</div>

                <div class="live-row">
                    <span class="live-label">sample every (ms)</span>
                    <input
                        type="number"
                        class="live-number"
                        v-model.number="n_ms__capture"
                        min="100" max="5000" step="50"
                        :disabled="b_running"
                        @change="f_save_config"
                    >
                </div>

                <div class="live-stat">
                    <div><span>committed</span><b>{{ o_last.n_commit || 0 }}</b></div>
                    <div><span>skipped</span><b>{{ o_last.n_skip || 0 }}</b></div>
                    <div><span>lost</span><b>{{ o_last.n_lost || 0 }}</b></div>
                    <div><span>method</span><b>{{ o_last.s_method || '—' }}</b></div>
                </div>

                <div class="fog-minimap" ref="el_minimap_wrap">
                    <img
                        v-if="s_src__preview"
                        :src="s_src__preview"
                        class="fog-minimap-image"
                        ref="el_preview"
                        @load="f_on_preview_load"
                    />
                    <div v-else class="fog-minimap-empty">no map yet — move the slide</div>
                    <div
                        v-if="s_src__preview"
                        class="fog-viewport"
                        :style="o_style__viewport"
                    ></div>
                </div>

                <div class="live-log-wrap" v-if="a_s_line.length">
                    <button class="btn-small" @click="b_visible__log = !b_visible__log">
                        {{ b_visible__log ? 'hide' : 'show' }} log
                    </button>
                    <div class="live-log" v-if="b_visible__log">
                        <div v-for="(s_line, n_idx) in a_s_line" :key="n_idx">{{ s_line }}</div>
                    </div>
                </div>

                <div class="live-note" v-if="s_path_folder">{{ s_path_folder }}</div>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            b_running: false,
            b_stopped: false,
            s_path_folder: '',
            n_ms__capture: N_MS__CAPTURE,
            n_cnt__capture: 0,
            o_last: {},
            a_s_line: [],
            b_visible__log: false,
            s_src__preview: '',
            n_ts_ms__preview__last: 0,
            n_scl__minimap: 1,
            s_status: '',
            n_id__status_interval: 0,
            b_loaded__persisted: false,
        };
    },
    computed: {
        o_style__viewport: function() {
            let o_self = this;
            if(!o_self.o_last || !o_self.n_scl_x__mosaic) return { display: 'none' };
            let n_scl = o_self.n_scl__minimap;
            return {
                display: 'block',
                left: ((o_self.o_last.n_x__view - o_self.o_last.n_x__min) * n_scl) + 'px',
                top: ((o_self.o_last.n_y__view - o_self.o_last.n_y__min) * n_scl) + 'px',
                width: (o_self.o_last.n_scl_x__frame * n_scl) + 'px',
                height: (o_self.o_last.n_scl_y__frame * n_scl) + 'px',
            };
        },
        n_scl_x__mosaic: function() {
            return this.o_last ? (this.o_last.n_scl_x__mosaic || 0) : 0;
        },
    },
    methods: {
        f_close: function() {
            if(this.b_running) return;
            o_state.o_panel_visibility.fog_of_war = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_save_config: function() {
            f_save_setting__debounced('o_config__fog', { n_ms__capture: this.n_ms__capture });
        },
        f_load_config: function() {
            let o_setting = o_state.a_o_setting.find(function(o){ return o.s_key === 'o_config__fog'; });
            if(o_setting && o_setting.s_value){
                try {
                    let o_config = JSON.parse(o_setting.s_value);
                    if(typeof o_config.n_ms__capture === 'number') this.n_ms__capture = o_config.n_ms__capture;
                } catch(e) { /* ignore */ }
            }
        },

        // ── frame capture (full frame-rate preview, subsampled upload) ──

        f_o_blob__frame: function() {
            return new Promise(function(resolve, reject) {
                let el_video = document.getElementById('webcamVideo');
                if(!el_video || !el_video.srcObject || el_video.readyState < 2){
                    reject(new Error('no webcam stream'));
                    return;
                }
                let el_canvas = document.createElement('canvas');
                el_canvas.width = el_video.videoWidth;
                el_canvas.height = el_video.videoHeight;
                el_canvas.getContext('2d').drawImage(el_video, 0, 0);
                el_canvas.toBlob(function(o_blob){
                    if(o_blob) resolve(o_blob);
                    else reject(new Error('capture failed'));
                }, 'image/png');
            });
        },
        f_save_image: async function(o_blob, s_filename) {
            let o_array_buffer = await o_blob.arrayBuffer();
            let o_response = await fetch(
                '/api/scan/save_image'
                    + '?s_path_folder=' + encodeURIComponent(this.s_path_folder)
                    + '&s_filename=' + encodeURIComponent(s_filename),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: o_array_buffer,
                }
            );
            if(!o_response.ok) throw new Error('save failed: ' + o_response.statusText);
        },
        f_capture_loop: async function() {
            let o_self = this;
            while(o_self.b_running && !o_self.b_stopped){
                try {
                    let o_blob = await o_self.f_o_blob__frame();
                    o_self.n_cnt__capture++;
                    // record the motor step positions so the server can build a
                    // spatial neighbour graph + coarse registration prior
                    let n_x = o_state.a_o_motor[0] ? o_state.a_o_motor[0].n_position : 0;
                    let n_y = o_state.a_o_motor[1] ? o_state.a_o_motor[1].n_position : 0;
                    let s_filename = 'fog_' + String(o_self.n_cnt__capture).padStart(5, '0')
                        + '_' + Math.round(n_x) + '_' + Math.round(n_y) + '.png';
                    await o_self.f_save_image(o_blob, s_filename);
                } catch(o_error) {
                    /* a frame may be dropped when the stream hiccups */
                }
                await new Promise(function(resolve){ setTimeout(resolve, o_self.n_ms__capture); });
            }
        },

        // ── lifecycle ─────────────────────────────────────────────

        f_start: async function() {
            let o_self = this;
            try {
                let o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('fog_start', {}));
                let o_result = o_resp.v_result;
                if(!o_result || !o_result.b_success || !o_result.s_path_folder){
                    o_self.s_status = 'failed to start: ' + (o_result && o_result.s_error || 'unknown');
                    return;
                }
                o_self.s_path_folder = o_result.s_path_folder;
            } catch(o_error) {
                o_self.s_status = 'failed to start: ' + o_error.message;
                return;
            }
            o_self.b_running = true;
            o_self.b_stopped = false;
            o_self.n_cnt__capture = 0;
            o_self.o_last = {};
            o_self.a_s_line = [];
            o_self.s_src__preview = '';
            o_self.s_status = '';
            o_state.b_running__fog_of_war = true;
            o_self.f_capture_loop();
            o_self.f_start_status_poll();
        },
        f_stop: async function() {
            let o_self = this;
            o_self.b_stopped = true;
            o_self.b_running = false;
            o_state.b_running__fog_of_war = false;
            o_self.f_stop_status_poll();
            try {
                await f_send_wsmsg_with_response(f_o_wsmsg('fog_stop', {}));
            } catch(o_error) { /* ignore */ }
        },
        f_export: async function() {
            let o_self = this;
            o_self.s_status = 'exporting…';
            try {
                let o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('fog_export', {}));
                let o_result = o_resp.v_result;
                o_self.s_status = o_result && o_result.b_success
                    ? 'exported to ' + o_result.s_path_output
                    : 'export failed: ' + (o_result && o_result.s_error || '');
            } catch(o_error) {
                o_self.s_status = 'export failed: ' + o_error.message;
            }
        },

        // ── status poll + minimap ─────────────────────────────────

        f_start_status_poll: function() {
            let o_self = this;
            if(o_self.n_id__status_interval) return;
            o_self.n_id__status_interval = setInterval(function(){ o_self.f_poll_status(); }, N_MS__STATUS_POLL);
        },
        f_stop_status_poll: function() {
            clearInterval(this.n_id__status_interval);
            this.n_id__status_interval = 0;
        },
        f_poll_status: async function() {
            let o_self = this;
            try {
                let o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('fog_status', {}));
                let o_status = o_resp.v_result;
                if(!o_status) return;
                if(o_status.o_last) o_self.o_last = o_status.o_last;
                if(o_status.a_s_line) o_self.a_s_line = o_status.a_s_line;
                if(o_status.n_ts_ms__preview
                    && o_status.n_ts_ms__preview !== o_self.n_ts_ms__preview__last){
                    o_self.n_ts_ms__preview__last = o_status.n_ts_ms__preview;
                    o_self.s_src__preview = '/api/file?path='
                        + encodeURIComponent(o_status.s_path_preview)
                        + '&t=' + o_status.n_ts_ms__preview;
                }
            } catch(o_error) { /* socket hiccup */ }
        },
        f_on_preview_load: function() {
            let o_self = this;
            let el_img = o_self.$refs.el_preview;
            let n_mosaic_x = o_self.n_scl_x__mosaic;
            if(el_img && n_mosaic_x > 0){
                o_self.n_scl__minimap = el_img.clientWidth / n_mosaic_x;
            }
        },
    },
    mounted: function() {
        this.f_load_config();
        if(o_state.b_running__fog_of_war) this.f_start_status_poll();
    },
    beforeUnmount: function() {
        this.f_stop_status_poll();
    },
};

export { o_component__fog_of_war };
