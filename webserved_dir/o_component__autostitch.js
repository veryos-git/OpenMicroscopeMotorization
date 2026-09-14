import { o_state, f_send_wsmsg_with_response, f_save_setting__debounced } from './index.js';
import { f_o_wsmsg } from './constructors.module.js';
import { f_o_capture__frame, f_save_image } from './o_capture.module.js';

let o_component__autostitch = {
    name: 'component-autostitch',
    template: `
        <div class="overlay-panel panel-autostitch" :class="{ visible: o_state.o_panel_visibility.autostitch }">
            <div class="panel-header">
                <h2>Auto Stitch</h2>
                <button class="panel-close" @click="f_close" :disabled="b_running">&times;</button>
            </div>
            <div class="panel-body">

                <!-- config state (not running, no result yet) -->
                <template v-if="!b_running && !s_path__base_image">
                    <div class="autostitch-field">
                        <label>Session Name</label>
                        <input type="text" v-model="s_name__session" @change="f_save_config" />
                    </div>
                    <div class="autostitch-field">
                        <label>Delay between stitch (second)</label>
                        <input type="number" v-model.number="n_sec__delay" min="0" max="60" @change="f_save_config" />
                    </div>
                    <div class="autostitch-field">
                        <label>Min Extension (%)</label>
                        <input type="number" v-model.number="n_pct__min_extension" min="0" max="50" step="0.5" @change="f_save_config" />
                    </div>
                    <button class="btn-autostitch-start" @click="f_start">Start</button>
                </template>

                <!-- running state -->
                <template v-if="b_running">
                    <div class="autostitch-minimap" ref="el_minimap_wrap">
                        <img
                            v-if="s_path__base_image"
                            :src="'/api/file?path=' + f_s_encode_uri(s_path__base_image) + '&t=' + n_ts_ms__last_update"
                            class="autostitch-base-image"
                            ref="el_base_image"
                            @load="f_on_base_image_load"
                        />
                        <div class="autostitch-placeholder" v-if="!s_path__base_image">
                            Waiting for first capture...
                        </div>
                        <div
                            v-if="b_found__current && s_path__base_image"
                            class="autostitch-current-rect"
                            :style="o_style__current_rect"
                        ></div>
                    </div>
                    <div class="autostitch-info">
                        <span class="autostitch-count">{{ n_cnt__image }}</span>
                        <span class="autostitch-label">image captured</span>
                    </div>
                    <div v-if="b_processing" class="autostitch-status">Processing...</div>
                    <div v-if="s_status__detail && !b_processing" class="autostitch-status">{{ s_status__detail }}</div>
                    <button class="btn-autostitch-stop" @click="f_stop">Stop</button>
                </template>

                <!-- stopped with result -->
                <template v-if="!b_running && s_path__base_image">
                    <div class="autostitch-minimap">
                        <img
                            :src="'/api/file?path=' + f_s_encode_uri(s_path__base_image) + '&t=' + n_ts_ms__last_update"
                            class="autostitch-base-image"
                        />
                    </div>
                    <div class="autostitch-info">
                        <span class="autostitch-count">{{ n_cnt__image }}</span>
                        <span class="autostitch-label">image captured</span>
                    </div>
                    <button class="btn-autostitch-reset" @click="f_reset">New Session</button>
                </template>

                <!-- per-stage timing log (from the python scripts) -->
                <div class="autostitch-log-wrap" v-if="a_s_line.length">
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

            // session config
            s_name__session: 'slide',
            n_sec__delay: 0,
            n_pct__min_extension: 5.0,

            // session state
            b_running: false,
            b_stopped: false,
            s_path_folder: '',
            n_cnt__image: 0,
            b_processing: false,

            // stitch result display
            s_path__base_image: '',
            n_scl_x__base: 0,
            n_scl_y__base: 0,

            // current image position in base (for red border)
            n_x__current: 0,
            n_y__current: 0,
            n_scl_x__current: 0,
            n_scl_y__current: 0,
            b_found__current: false,

            // display scale (computed on image load)
            n_scl__display: 1,

            // status
            s_status__detail: '',

            // per-stage timing log from the python scripts
            a_s_line: [],
            b_visible__log: false,

            // timestamp for cache busting on image reload
            n_ts_ms__last_update: 0,
        };
    },

    computed: {
        o_style__current_rect: function() {
            let o_self = this;
            if(o_self.n_scl_x__base <= 0) return {};
            return {
                left: (o_self.n_x__current * o_self.n_scl__display) + 'px',
                top: (o_self.n_y__current * o_self.n_scl__display) + 'px',
                width: (o_self.n_scl_x__current * o_self.n_scl__display) + 'px',
                height: (o_self.n_scl_y__current * o_self.n_scl__display) + 'px',
            };
        },
    },

    mounted: function() {
        this.f_load_config();
    },

    beforeUnmount: function() {
        if(this.b_running || !this.b_stopped){
            this.b_stopped = true;
        }
    },

    methods: {

        f_s_encode_uri: function(s) {
            return encodeURIComponent(s);
        },

        f_close: function() {
            if(this.b_running) return;
            o_state.o_panel_visibility.autostitch = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },

        f_save_config: function() {
            f_save_setting__debounced('o_config__autostitch', {
                s_name__session: this.s_name__session,
                n_sec__delay: this.n_sec__delay,
                n_pct__min_extension: this.n_pct__min_extension,
            });
        },

        f_load_config: function() {
            let o_setting = o_state.a_o_setting.find(function(o){ return o.s_key === 'o_config__autostitch'; });
            if(o_setting && o_setting.s_value){
                try {
                    let o_config = JSON.parse(o_setting.s_value);
                    if(o_config.s_name__session) this.s_name__session = o_config.s_name__session;
                    if(o_config.n_sec__delay !== undefined) this.n_sec__delay = o_config.n_sec__delay;
                    if(o_config.n_pct__min_extension !== undefined) this.n_pct__min_extension = o_config.n_pct__min_extension;
                } catch(o_err) {
                    // ignore parse error
                }
            }
        },

        f_start: async function() {
            let o_self = this;

            try {
                let o_resp = await f_send_wsmsg_with_response(
                    f_o_wsmsg('autostitch_create_session', { s_name: o_self.s_name__session })
                );
                if(!o_resp.v_result || !o_resp.v_result.s_path_folder){
                    o_self.s_status__detail = 'Failed to create session folder';
                    return;
                }
                o_self.s_path_folder = o_resp.v_result.s_path_folder;
            } catch(o_error) {
                o_self.s_status__detail = 'Failed to create session: ' + o_error.message;
                return;
            }

            o_self.b_running = true;
            o_self.b_stopped = false;
            o_self.n_cnt__image = 0;
            o_self.s_path__base_image = '';
            o_self.b_found__current = false;
            o_self.s_status__detail = '';
            o_self.a_s_line = [];
            o_self.b_visible__log = false;

            // sequential loop: capture → stitch → wait for result → delay → repeat
            o_self.f_loop();
        },

        f_loop: async function() {
            let o_self = this;
            while(!o_self.b_stopped){
                o_self.b_processing = true;

                try {
                    // 1. capture frame
                    let o_cap = await f_o_capture__frame();
                    let s_filename = 'frame_' + String(o_self.n_cnt__image).padStart(4, '0') + '.png';

                    // 2. save to server via HTTP
                    await f_save_image(o_cap.o_blob, o_self.s_path_folder, s_filename);

                    o_self.n_cnt__image++;

                    // 3. run incremental stitch via WS and wait for result
                    let o_resp = await f_send_wsmsg_with_response(
                        f_o_wsmsg('autostitch_add_image', {
                            s_path_folder: o_self.s_path_folder,
                            s_filename: s_filename,
                            n_pct__min_extension: o_self.n_pct__min_extension,
                        })
                    );

                    let o_result = o_resp.v_result;
                    if(o_result && o_result.b_success){
                        o_self.s_path__base_image = o_result.s_path_output;
                        o_self.n_scl_x__base = o_result.n_scl_x__base;
                        o_self.n_scl_y__base = o_result.n_scl_y__base;
                        o_self.n_ts_ms__last_update = Date.now();

                        // update position of current image in base
                        o_self.n_x__current = o_result.n_x;
                        o_self.n_y__current = o_result.n_y;
                        o_self.n_scl_x__current = o_result.n_scl_x__new;
                        o_self.n_scl_y__current = o_result.n_scl_y__new;
                        o_self.b_found__current = true;

                        if(o_result.b_extended){
                            o_self.s_status__detail = 'Extended (+' + o_result.n_pct__new_pixel + '% new)';
                        } else if(o_result.b_replaced){
                            o_self.s_status__detail = 'Base replaced (no overlap)';
                        } else {
                            o_self.s_status__detail = 'Skipped (' + o_result.n_pct__new_pixel + '% new, below threshold)';
                        }
                    } else {
                        o_self.s_status__detail = 'Error: ' + (o_result ? o_result.s_error : 'unknown');
                    }

                    // keep the per-stage timings of the last frames for the log
                    if(o_result && o_result.a_s_line && o_result.a_s_line.length){
                        o_self.a_s_line = o_self.a_s_line.concat(o_result.a_s_line).slice(-100);
                    }
                } catch(o_error) {
                    console.error('autostitch capture error:', o_error);
                    o_self.s_status__detail = o_error.message;
                }

                o_self.b_processing = false;

                // optional delay before next capture
                if(!o_self.b_stopped && o_self.n_sec__delay > 0){
                    await new Promise(function(resolve){
                        setTimeout(resolve, o_self.n_sec__delay * 1000);
                    });
                }
            }

            o_self.b_running = false;
        },

        f_stop: function() {
            this.b_stopped = true;
        },

        f_reset: function() {
            this.s_path_folder = '';
            this.s_path__base_image = '';
            this.n_cnt__image = 0;
            this.b_found__current = false;
            this.s_status__detail = '';
            this.n_ts_ms__last_update = 0;
            this.n_scl_x__base = 0;
            this.n_scl_y__base = 0;
            this.a_s_line = [];
            this.b_visible__log = false;
        },

        f_on_base_image_load: function() {
            let o_self = this;
            if(o_self.$refs.el_base_image && o_self.n_scl_x__base > 0){
                o_self.n_scl__display = o_self.$refs.el_base_image.clientWidth / o_self.n_scl_x__base;
            }
        },
    },
};

export { o_component__autostitch };
