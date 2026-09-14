import {
    o_state,
    f_send_wsmsg_with_response,
    f_save_setting__debounced,
    f_send_esp_move_step,
    f_refresh_maps,
} from './index.js';
import { f_o_wsmsg } from './constructors.module.js';
import { f_o_capture__frame } from './o_capture.module.js';

// how often a low-res frame is sent to the server for localization
let N_MS__CAPTURE = 1500;
// how often the located map / score is polled
let N_MS__STATUS_POLL = 800;
// long side of the uploaded frame (heavily downscaled -> tiny + fast match)
let N_DIM__FRAME__UPLOAD = 160;

// The Map hub: pick (or create) the slide's map, see where the camera is on it,
// and jump to a spot by clicking. It replaces the old Locate panel and the
// motor-trace minimap (the trace was removed — stepper steps + backlash make it
// lie about the real slide position; the template-match viewport is the truth).

let o_component__map = {
    name: 'component-map',
    template: `
        <div class="overlay-panel panel-map" :class="{ visible: o_state.o_panel_visibility.map }">
            <div class="panel-header">
                <h2>Map</h2>
                <button class="panel-close" @click="f_close" :disabled="b_running">&times;</button>
            </div>
            <div class="panel-body">

                <div class="live-note" v-if="!o_state.b_streaming__webcam">
                    start a camera in the top bar first
                </div>

                <!-- empty state: no map yet, offer to create one -->
                <template v-if="!a_o_map__selectable.length">
                    <div class="live-note">
                        no map for this slide yet. build one:
                    </div>
                    <button class="btn-scan-start" @click="f_open('scan')">
                        Scan
                    </button>
                    <div class="scan-hint">
                        drive the stage over a grid and stitch a full-slide mosaic —
                        best for capturing a whole slide in one go.
                    </div>
                </template>

                <!-- map selector -->
                <template v-else>
                    <div class="live-row live-row--map">
                        <span class="live-label">map</span>
                        <button class="map-select-toggle" @click="f_toggle_map_list" :disabled="b_running">
                            <img
                                v-if="o_map__selected && o_map__selected.s_path_preview"
                                :src="f_s_thumb(o_map__selected)"
                                class="map-thumb"
                            />
                            <span class="map-select-label">
                                {{ o_map__selected ? o_map__selected.s_label : '-- pick a map --' }}
                            </span>
                            <span class="map-caret">{{ b_open__map_list ? '▲' : '▼' }}</span>
                        </button>
                        <button class="toolbar-toggle" @click="f_list_maps" :disabled="b_running">refresh</button>
                    </div>

                    <div class="map-select-list" v-if="b_open__map_list">
                        <div
                            class="map-select-item"
                            v-for="o_map in a_o_map__selectable"
                            :key="o_map.s_path_map"
                            :class="{ active: o_map.s_path_map === s_path_map }"
                            @click="f_select_map(o_map)"
                        >
                            <img :src="f_s_thumb(o_map)" class="map-thumb"/>
                            <span class="map-select-label">{{ o_map.s_label }}</span>
                            <span class="map-select-time">{{ f_s_time(o_map.n_ts_ms) }}</span>
                        </div>
                    </div>

                    <div class="live-row">
                        <button
                            class="toolbar-toggle"
                            :disabled="!o_state.b_streaming__webcam || !s_path_map"
                            @click="b_running ? f_stop() : f_start()"
                        >{{ b_running ? 'stop locate' : 'locate me' }}</button>
                    </div>

                    <div class="live-note" v-if="s_status">{{ s_status }}</div>
                    <div class="live-note" v-if="o_status.s_error">{{ o_status.s_error }}</div>

                    <div class="live-stat" v-if="b_running || o_status.n_cnt__frame">
                        <div><span>score</span><b>{{ o_status.n_score }}</b></div>
                        <div><span>found</span><b>{{ o_status.b_found ? 'yes' : 'no' }}</b></div>
                    </div>

                    <div class="fog-minimap" ref="el_minimap_wrap">
                        <img
                            v-if="s_src__located"
                            :src="s_src__located"
                            class="fog-minimap-image map-clickable"
                            @click="f_on_click__map"
                            :title="b_click__ready ? 'click to move the stage there' : 'set steps/px and locate to enable click-to-go'"
                        />
                        <div v-else class="fog-minimap-empty">
                            {{ b_running ? 'waiting for first match…' : 'no located map yet' }}
                        </div>
                    </div>

                    <div class="live-row">
                        <span class="live-label">steps/px</span>
                        <input type="number" class="live-number" v-model.number="n_step__per_px_x" placeholder="x" @change="f_save_config" />
                        <input type="number" class="live-number" v-model.number="n_step__per_px_y" placeholder="y" @change="f_save_config" />
                    </div>
                    <div class="live-note">
                        steps per pixel come from the backlash calibration's
                        <b>scale</b> column. with these set, click the map to move the
                        stage there.
                    </div>
                </template>

                <!-- build / annotate shortcuts -->
                <div class="map-actions">
                    <button class="btn-small" @click="f_open('scan')">Scan</button>
                    <button class="btn-small" @click="f_open('manual_stitch')">Stitch</button>
                    <button class="btn-small" @click="f_open('autostitch')">AStitch</button>
                </div>

            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            b_running: false,
            b_stopped: false,
            b_open__map_list: false,
            s_status: '',
            s_src__located: '',
            n_ts_ms__located__last: 0,
            n_id__status_interval: 0,
            a_s_line: [],
            b_visible__log: false,
            n_step__per_px_x: 0,
            n_step__per_px_y: 0,
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
        // shared with the toolbar so the same map stays selected everywhere
        s_path_map: {
            get: function() { return o_state.s_path_map__current; },
            set: function(v) { o_state.s_path_map__current = v; },
        },
        // scanned map files, also shared with the toolbar
        a_o_map: {
            get: function() { return o_state.a_o_map__scanned; },
            set: function(v) { o_state.a_o_map__scanned = v; },
        },
        o_map__selected: function() {
            let o_self = this;
            return o_self.a_o_map__selectable.find(function(o_map){ return o_map.s_path_map === o_self.s_path_map; }) || null;
        },
        // o_map rows for the current slide, merged with the scans-folder list
        a_o_map__slide: function() {
            let n_id__slide = o_state.n_id__slide__current;
            if(!n_id__slide) return [];
            return (o_state.a_o_map || []).filter(function(o_map) {
                return o_map.n_o_slide_n_id === n_id__slide;
            }).map(function(o_map) {
                return {
                    s_label: (o_map.s_kind || 'map') + ' · ' + (o_map.s_path_map || ''),
                    s_path_map: o_map.s_path_map,
                    s_path_preview: o_map.s_path_preview,
                    n_ts_ms: o_map.n_ts_ms_updated || o_map.n_ts_ms_created || 0,
                };
            });
        },
        a_o_map__selectable: function() {
            let o_self = this;
            let a_o_map = o_self.a_o_map__slide.concat(o_self.a_o_map || []);
            let o_seen = {};
            let a_o_out = [];
            for(let o_map of a_o_map){
                if(!o_map || !o_map.s_path_map) continue;
                if(o_seen[o_map.s_path_map]) continue;
                o_seen[o_map.s_path_map] = true;
                a_o_out.push(o_map);
            }
            return a_o_out;
        },
        b_click__ready: function() {
            return !!this.n_step__per_px_x && !!this.n_step__per_px_y && this.o_status.b_found;
        },
    },
    methods: {
        f_close: function() {
            if(this.b_running) return;
            o_state.o_panel_visibility.map = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_open: function(s_key) {
            o_state.o_panel_visibility[s_key] = true;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_save_config: function() {
            f_save_setting__debounced('o_config__map', {
                s_path_map: this.s_path_map,
                n_step__per_px_x: this.n_step__per_px_x,
                n_step__per_px_y: this.n_step__per_px_y,
            });
        },
        f_load_config: function() {
            let o_self = this;
            let o_setting = o_state.a_o_setting.find(function(o){ return o.s_key === 'o_config__map'; });
            if(!o_setting || !o_setting.s_value) return;
            try {
                let o_config = JSON.parse(o_setting.s_value);
                if(typeof o_config.s_path_map === 'string') o_self.s_path_map = o_config.s_path_map;
                if(typeof o_config.n_step__per_px_x === 'number') o_self.n_step__per_px_x = o_config.n_step__per_px_x;
                if(typeof o_config.n_step__per_px_y === 'number') o_self.n_step__per_px_y = o_config.n_step__per_px_y;
            } catch(e) { /* ignore parse errors */ }
        },

        // ── map list ──────────────────────────────────────────────

        f_list_maps: async function() {
            await f_refresh_maps();
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

        f_upload_frame: async function() {
            let o_self = this;
            let o_cap = await f_o_capture__frame({ n_scl_max: N_DIM__FRAME__UPLOAD, s_type: 'image/jpeg', n_quality: 0.8, b_flash: false });
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

        // ── click-to-go ───────────────────────────────────────────

        f_on_click__map: async function(o_evt) {
            let o_self = this;
            if(!o_self.o_status.b_found){
                o_self.s_status = 'locate yourself on the map first';
                return;
            }
            if(!o_self.n_step__per_px_x || !o_self.n_step__per_px_y){
                o_self.s_status = 'set steps/px first (see backlash scale column)';
                return;
            }
            let el_img = o_evt.target;
            let o_rect = el_img.getBoundingClientRect();
            if(!o_rect.width || !o_rect.height) return;
            let n_cx__disp = o_evt.clientX - o_rect.left;
            let n_cy__disp = o_evt.clientY - o_rect.top;

            // displayed -> natural preview -> full map
            let n_long__full = Math.max(o_self.o_status.n_scl_x__map || 0, o_self.o_status.n_scl_y__map || 0);
            if(!n_long__full) return;
            let n_scl__preview_to_full = n_long__full / 900; // locate preview long side is 900
            let n_scl_x__disp_to_full = (el_img.naturalWidth / o_rect.width) * n_scl__preview_to_full;
            let n_scl_y__disp_to_full = (el_img.naturalHeight / o_rect.height) * n_scl__preview_to_full;

            let n_x__full = n_cx__disp * n_scl_x__disp_to_full;
            let n_y__full = n_cy__disp * n_scl_y__disp_to_full;

            // current camera center in full-map px
            let n_x__cur = (o_self.o_status.n_x || 0) + (o_self.o_status.n_scl_x || 0) / 2;
            let n_y__cur = (o_self.o_status.n_y || 0) + (o_self.o_status.n_scl_y || 0) / 2;

            let n_step__x = Math.round((n_x__full - n_x__cur) * o_self.n_step__per_px_x);
            let n_step__y = Math.round((n_y__full - n_y__cur) * o_self.n_step__per_px_y);

            if(n_step__x) await f_send_esp_move_step(0, n_step__x, o_state.n_rpm__jog || 5);
            if(n_step__y) await f_send_esp_move_step(1, n_step__y, o_state.n_rpm__jog || 5);
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

export { o_component__map };
