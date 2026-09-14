import { o_state, f_send_wsmsg_with_response, f_save_setting__debounced } from './index.js';
import { f_o_wsmsg } from './constructors.module.js';

// how often a low-res frame is sent to the server for localization
let N_MS__CAPTURE = 1500;
// how often the located map / score is polled
let N_MS__STATUS_POLL = 800;
// long side of the uploaded frame (heavily downscaled -> tiny + fast match)
let N_DIM__FRAME__UPLOAD = 160;

let o_component__locate = {
    name: 'component-locate',
    template: `
        <div class="overlay-panel panel-locate" :class="{ visible: o_state.o_panel_visibility.locate }">
            <div class="panel-header">
                <h2>Locate</h2>
                <button class="panel-close" @click="f_close" :disabled="b_running">&times;</button>
            </div>
            <div class="panel-body">

                <div class="live-note" v-if="!o_state.b_streaming__webcam">
                    start a camera in the top bar first
                </div>

                <div class="live-row live-row--map">
                    <span class="live-label">map</span>
                    <button class="map-select-toggle" @click="f_toggle_map_list" :disabled="b_running">
                        <img
                            v-if="o_map__selected && o_map__selected.s_path_preview"
                            :src="f_s_thumb(o_map__selected)"
                            class="map-thumb"
                        />
                        <span class="map-select-label">
                            {{ o_map__selected ? o_map__selected.s_label : '-- pick a stitched map --' }}
                        </span>
                        <span class="map-caret">{{ b_open__map_list ? '▲' : '▼' }}</span>
                    </button>
                    <button class="toolbar-toggle" @click="f_list_maps" :disabled="b_running">refresh</button>
                </div>

                <div class="map-select-list" v-if="b_open__map_list">
                    <div
                        class="map-select-item"
                        v-for="o_map in a_o_map"
                        :key="o_map.s_path_map"
                        :class="{ active: o_map.s_path_map === s_path_map }"
                        @click="f_select_map(o_map)"
                    >
                        <img :src="f_s_thumb(o_map)" class="map-thumb"/>
                        <span class="map-select-label">{{ o_map.s_label }}</span>
                        <span class="map-select-time">{{ f_s_time(o_map.n_ts_ms) }}</span>
                    </div>
                    <div class="map-select-empty" v-if="!a_o_map.length">
                        no stitched maps yet — run Grow or Scan first
                    </div>
                </div>

                <div class="live-row">
                    <button
                        class="toolbar-toggle"
                        :disabled="!o_state.b_streaming__webcam || !s_path_map"
                        @click="b_running ? f_stop() : f_start()"
                    >{{ b_running ? 'stop' : 'start' }}</button>
                </div>

                <div class="live-note" v-if="s_status">{{ s_status }}</div>
                <div class="live-note" v-if="o_status.s_error">{{ o_status.s_error }}</div>

                <div class="live-stat" v-if="b_running || o_status.n_cnt__frame">
                    <div><span>score</span><b>{{ o_status.n_score }}</b></div>
                    <div><span>frames</span><b>{{ o_status.n_cnt__frame || 0 }}</b></div>
                    <div><span>found</span><b>{{ o_status.b_found ? 'yes' : 'no' }}</b></div>
                </div>

                <div class="fog-minimap" ref="el_minimap_wrap">
                    <img
                        v-if="s_src__located"
                        :src="s_src__located"
                        class="fog-minimap-image"
                    />
                    <div v-else class="fog-minimap-empty">
                        {{ b_running ? 'waiting for first match…' : 'no located map yet' }}
                    </div>
                </div>

                <div class="live-log-wrap" v-if="a_s_line.length">
                    <button class="btn-small" @click="b_visible__log = !b_visible__log">
                        {{ b_visible__log ? 'hide' : 'show' }} log
                    </button>
                    <div class="live-log" v-if="b_visible__log">
                        <div v-for="(s_line, n_idx) in a_s_line" :key="n_idx">{{ s_line }}</div>
                    </div>
                </div>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            b_running: false,
            b_stopped: false,
            s_path_map: '',
            a_o_map: [],
            b_open__map_list: false,
            s_status: '',
            s_src__located: '',
            n_ts_ms__located__last: 0,
            n_id__status_interval: 0,
            a_s_line: [],
            b_visible__log: false,
            o_status: {
                b_running: false, s_status: 'idle', s_error: '',
                s_path_map: '', s_path_located: '',
                n_scl_x__map: 0, n_scl_y__map: 0,
                n_x: 0, n_y: 0, n_scl_x: 0, n_scl_y: 0,
                n_score: 0, b_found: false, n_cnt__frame: 0, n_ts_ms: 0,
            },
        };
    },
    watch: {
        'o_state.b_connected__server': function(b_connected) {
            if(b_connected) this.f_list_maps();
        },
    },
    computed: {
        o_map__selected: function() {
            let o_self = this;
            return o_self.a_o_map.find(function(o_map){ return o_map.s_path_map === o_self.s_path_map; }) || null;
        },
    },
    methods: {
        f_close: function() {
            if(this.b_running) return;
            o_state.o_panel_visibility.locate = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_save_config: function() {
            f_save_setting__debounced('o_config__locate', { s_path_map: this.s_path_map });
        },
        f_load_config: function() {
            let o_self = this;
            let o_setting = o_state.a_o_setting.find(function(o){ return o.s_key === 'o_config__locate'; });
            if(!o_setting || !o_setting.s_value) return;
            try {
                let o_config = JSON.parse(o_setting.s_value);
                if(typeof o_config.s_path_map === 'string') o_self.s_path_map = o_config.s_path_map;
            } catch(e) { /* ignore parse errors */ }
        },

        // ── map list ──────────────────────────────────────────────

        f_list_maps: async function() {
            let o_self = this;
            try {
                let o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('locate_list_maps', {}));
                let o_result = o_resp.v_result;
                if(o_result && Array.isArray(o_result.a_o_map)) o_self.a_o_map = o_result.a_o_map;
            } catch(o_error) { /* socket not ready yet */ }
        },
        f_toggle_map_list: function() {
            this.b_open__map_list = !this.b_open__map_list;
        },
        f_select_map: function(o_map) {
            this.s_path_map = o_map.s_path_map;
            this.b_open__map_list = false;
            this.f_save_config();
        },
        f_s_thumb: function(o_map) {
            return '/api/file?path='
                + encodeURIComponent(o_map.s_path_preview)
                + '&t=' + (o_map.n_ts_ms || 0);
        },
        f_s_time: function(n_ts_ms) {
            if(!n_ts_ms) return '';
            let o_date = new Date(n_ts_ms);
            let f_s_pad = function(n){ return String(n).padStart(2, '0'); };
            return f_s_pad(o_date.getHours()) + ':' + f_s_pad(o_date.getMinutes());
        },

        // ── frame capture + upload ─────────────────────────────────

        f_o_capture__frame: function() {
            return new Promise(function(resolve, reject) {
                let el_video = document.getElementById('webcamVideo');
                if(!el_video || !el_video.srcObject || el_video.readyState < 2){
                    reject(new Error('no webcam stream'));
                    return;
                }
                let n_scl_x__video = el_video.videoWidth;
                let n_scl_y__video = el_video.videoHeight;
                let n_scl = Math.min(1, N_DIM__FRAME__UPLOAD / Math.max(n_scl_x__video, n_scl_y__video));
                let el_canvas = document.createElement('canvas');
                el_canvas.width = Math.max(1, Math.round(n_scl_x__video * n_scl));
                el_canvas.height = Math.max(1, Math.round(n_scl_y__video * n_scl));
                el_canvas.getContext('2d').drawImage(el_video, 0, 0, el_canvas.width, el_canvas.height);
                el_canvas.toBlob(function(o_blob){
                    if(o_blob) resolve({ o_blob: o_blob, n_scl_x__video: n_scl_x__video, n_scl_y__video: n_scl_y__video });
                    else reject(new Error('capture failed'));
                }, 'image/jpeg', 0.8);
            });
        },
        f_upload_frame: async function() {
            let o_self = this;
            let o_cap = await o_self.f_o_capture__frame();
            let o_response = await fetch(
                '/api/locate/frame'
                    + '?n_scl_x=' + o_cap.n_scl_x__video
                    + '&n_scl_y=' + o_cap.n_scl_y__video,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: o_cap.o_blob,
                }
            );
            if(!o_response.ok) throw new Error('upload failed: ' + o_response.statusText);
        },
        f_capture_loop: async function() {
            let o_self = this;
            while(o_self.b_running && !o_self.b_stopped){
                try {
                    await o_self.f_upload_frame();
                } catch(o_error) { /* a frame may be dropped when the stream hiccups */ }
                await new Promise(function(resolve){ setTimeout(resolve, N_MS__CAPTURE); });
            }
        },

        // ── lifecycle ─────────────────────────────────────────────

        f_start: async function() {
            let o_self = this;
            if(!o_self.s_path_map){
                o_self.s_status = 'pick a map first';
                return;
            }
            try {
                let o_resp = await f_send_wsmsg_with_response(
                    f_o_wsmsg('locate_start', { s_path_map: o_self.s_path_map })
                );
                let o_result = o_resp.v_result;
                if(!o_result || !o_result.b_success){
                    o_self.s_status = 'failed to start: ' + (o_result && o_result.s_error || 'unknown');
                    return;
                }
            } catch(o_error) {
                o_self.s_status = 'failed to start: ' + o_error.message;
                return;
            }
            o_self.b_running = true;
            o_self.b_stopped = false;
            o_self.s_status = '';
            o_self.s_src__located = '';
            o_self.n_ts_ms__located__last = 0;
            o_self.a_s_line = [];
            o_state.b_running__locate = true;
            o_self.f_capture_loop();
            o_self.f_start_status_poll();
        },
        f_stop: async function() {
            let o_self = this;
            o_self.b_stopped = true;
            o_self.b_running = false;
            o_state.b_running__locate = false;
            o_self.f_stop_status_poll();
            try {
                await f_send_wsmsg_with_response(f_o_wsmsg('locate_stop', {}));
            } catch(o_error) { /* ignore */ }
        },

        // ── status poll ───────────────────────────────────────────

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
                let o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('locate_status', {}));
                let o_status = o_resp.v_result;
                if(!o_status) return;
                o_self.o_status = o_status;
                if(o_status.a_s_line) o_self.a_s_line = o_status.a_s_line;
                if(o_status.n_ts_ms && o_status.n_ts_ms !== o_self.n_ts_ms__located__last){
                    o_self.n_ts_ms__located__last = o_status.n_ts_ms;
                    o_self.s_src__located = '/api/file?path='
                        + encodeURIComponent(o_status.s_path_located)
                        + '&t=' + o_status.n_ts_ms;
                }
                if(!o_status.b_running && o_self.b_running){
                    o_self.f_stop();
                }
            } catch(o_error) { /* socket hiccup */ }
        },
    },
    mounted: function() {
        this.f_load_config();
        if(o_state.b_connected__server) this.f_list_maps();
    },
    beforeUnmount: function() {
        this.f_stop_status_poll();
    },
};

export { o_component__locate };
