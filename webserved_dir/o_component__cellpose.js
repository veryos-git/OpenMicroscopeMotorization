import { o_state, f_send_wsmsg_with_response, f_save_setting__debounced } from './index.js';
import { f_o_wsmsg } from './constructors.module.js';
import { f_o_capture__frame } from './o_capture.module.js';

// "Cell pose" panel — runs the Cellpose segmentation on the live camera feed.
//
// The browser only grabs frames: the model itself lives in a python worker on
// the server (cellpose_functions.module.js).  Two modes:
//
//   single  one captured frame, then stop        -> segmentation of a picture
//   loop    capture -> segment -> wait -> again  -> continuous segmentation
//
// On a CPU one Cellpose-SAM frame takes tens of seconds, so the loop keeps at
// most one frame in flight and the interval is the pause *between* finished
// inferences, not a fixed frame rate.
//
// The mask is NOT shown in this panel: it is published to o_state.o_cellpose,
// and the webcam component draws it as a full-page overlay on the live image.
// That is the whole point — the found cells belong on the picture, and the
// panel stays a control surface.
let o_component__cellpose = {
    name: 'component-cellpose',
    template: `
        <div class="overlay-panel panel-cellpose" :class="{ visible: o_state.o_panel_visibility.cellpose }">
            <div class="panel-header">
                <h2>Cell pose</h2>
                <button class="panel-close" @click="f_close" :disabled="b_running">&times;</button>
            </div>
            <div class="panel-body">

                <!-- setup -->
                <template v-if="!b_running">
                    <div class="cellpose-field">
                        <label>Mode</label>
                        <div class="mode-toggle mode-toggle--mini">
                            <button
                                class="mode-btn"
                                :class="{ active: s_mode === 'single' }"
                                @click="f_set_mode('single')"
                                title="segment one captured frame"
                            >Single image</button>
                            <button
                                class="mode-btn"
                                :class="{ active: s_mode === 'loop' }"
                                @click="f_set_mode('loop')"
                                title="segment the camera feed over and over"
                            >Loop</button>
                        </div>
                    </div>

                    <div class="cellpose-field">
                        <label>Model</label>
                        <select v-model="s_model" @change="f_save_config">
                            <option value="cpsam">cpsam — Cellpose-SAM (generalist, slow on CPU)</option>
                            <option value="cyto3">cyto3 — Cellpose 3 cytoplasm (faster)</option>
                        </select>
                    </div>

                    <div class="cellpose-field">
                        <label>Inference size (long side, px)</label>
                        <input type="number" v-model.number="n_dim" min="128" max="2048" step="64" @change="f_save_config" />
                    </div>

                    <div class="cellpose-field" v-if="s_mode === 'loop'">
                        <label>Pause between frames (second)</label>
                        <input type="number" v-model.number="n_sec__delay" min="0" max="600" step="1" @change="f_save_config" />
                    </div>

                    <div class="cellpose-hint">
                        the first frame also downloads the model weights into
                        <span class="cellpose-mono">weights/cellpose</span>.
                        runs on the GPU when the server has a CUDA build of torch,
                        otherwise on the CPU.
                    </div>

                    <!-- a frame captured while the stage moves is smeared, and the
                         mask would sit on cells that are no longer there -->
                    <div class="cellpose-lock" v-if="b_motor_running">
                        motors are running — wait for the stage to stand still
                    </div>

                    <button
                        class="btn-cellpose-start"
                        @click="f_start"
                        :disabled="b_starting || b_motor_running"
                        :title="b_motor_running ? 'the stage must stand still while a frame is captured' : ''"
                    >
                        {{ b_starting ? 'Starting…' : (s_mode === 'loop' ? 'Start loop' : 'Capture & segment') }}
                    </button>

                    <div v-if="s_status__detail" class="cellpose-status">{{ s_status__detail }}</div>
                </template>

                <!-- running -->
                <template v-if="b_running">
                    <div class="cellpose-info">
                        <span class="cellpose-count">{{ n_cell }}</span>
                        <span class="cellpose-label">cell{{ n_cell === 1 ? '' : 's' }} in the last frame</span>
                    </div>
                    <div class="cellpose-hint">
                        frame {{ n_cnt__frame }}
                        <template v-if="n_sec__inference"> · {{ n_sec__inference }} s</template>
                        <template v-if="n_scl_x"> · {{ n_scl_x }}×{{ n_scl_y }} px</template>
                        <template v-if="n_dim__inference"> · analysed at {{ n_dim__inference }} px</template>
                        <template v-if="s_device"> · {{ s_device.toUpperCase() }}</template>
                    </div>

                    <div class="cellpose-lock" v-if="b_motor_running">
                        motors are running — the loop pauses until the stage stands still
                    </div>

                    <div class="cellpose-hint" v-if="!b_has_mask">
                        {{ b_busy ? 'Segmenting the frame — the mask appears on the image…' : 'waiting for the first frame' }}
                    </div>
                    <div class="cellpose-hint" v-else>
                        the mask is drawn over the live image.
                    </div>

                    <div class="cellpose-field" v-if="b_has_mask">
                        <label>Overlay opacity ({{ n_pct__opacity }}%)</label>
                        <input type="range" v-model.number="n_pct__opacity" min="20" max="100" step="5" />
                    </div>

                    <div v-if="s_status__detail" class="cellpose-status">{{ s_status__detail }}</div>

                    <button class="btn-cellpose-stop" @click="f_stop">
                        {{ s_mode === 'loop' ? 'Stop loop' : 'Cancel' }}
                    </button>
                    <button class="btn-cellpose-remove" @click="f_remove_mask" v-if="b_has_mask">
                        Remove mask
                    </button>
                </template>

                <!-- result of a single shot -->
                <template v-if="!b_running && b_has_mask">
                    <div class="cellpose-info">
                        <span class="cellpose-count">{{ n_cell }}</span>
                        <span class="cellpose-label">cell{{ n_cell === 1 ? '' : 's' }} found</span>
                    </div>
                    <div class="cellpose-hint">
                        segment {{ n_cnt__frame }}
                        <template v-if="n_sec__inference"> · {{ n_sec__inference }} s</template>
                        <template v-if="n_scl_x"> · {{ n_scl_x }}×{{ n_scl_y }} px</template>
                        <template v-if="s_device"> · {{ s_device.toUpperCase() }}</template>
                    </div>

                    <div class="cellpose-field">
                        <label>Overlay opacity ({{ n_pct__opacity }}%)</label>
                        <input type="range" v-model.number="n_pct__opacity" min="20" max="100" step="5" />
                    </div>

                    <button class="btn-cellpose-remove" @click="f_remove_mask">
                        Remove mask
                    </button>
                </template>

                <!-- worker log -->
                <div class="cellpose-log-wrap" v-if="a_s_line.length">
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

            // config
            s_mode: 'single',        // single | loop
            s_model: 'cpsam',
            n_dim: 384,
            n_sec__delay: 0,

            // session
            b_running: false,
            b_starting: false,
            b_busy: false,
            b_stopped: false,
            s_status__detail: '',

            // last result
            n_cell: 0,
            n_sec__inference: 0,
            n_scl_x: 0,
            n_scl_y: 0,
            n_dim__inference: 0,
            s_device: '',
            n_cnt__frame: 0,

            // log
            a_s_line: [],
            b_visible__log: false,
        };
    },

    computed: {
        // the mask itself lives in the shared state, so the main window and this
        // panel always agree on whether one is on screen
        b_has_mask: function() {
            return !!o_state.o_cellpose.s_path_mask;
        },
        // a frame grabbed while the stage moves is smeared, and a mask computed
        // from it points at cells that are no longer under the crosshair, so
        // "capture and segment" is refused while any motor turns.  this covers
        // every source of motion: jog keys, mouse, gamepad, macro, autofocus.
        b_motor_running: function() {
            return o_state.a_o_motor.some(function(o_motor){ return o_motor.b_running; });
        },
        n_pct__opacity: {
            get: function() {
                return o_state.o_cellpose.n_pct__opacity;
            },
            set: function(n_pct) {
                o_state.o_cellpose.n_pct__opacity = n_pct;
                this.f_save_config();
            },
        },
    },

    mounted: function() {
        this.f_load_config();
    },

    watch: {
        // the settings are broadcast over the websocket, which can land after
        // this component mounted — re-read the opacity once they arrive
        a_o_setting: function() {
            this.f_load_config();
        },
        // the moment the stage moves, the mask on the image is out of date
        // (it describes where the cells were, not where they are) — take it
        // off, and stop a loop that has nothing valid to segment any more
        b_motor_running: function(b_running__new) {
            if(!b_running__new) return;
            if(this.b_has_mask) this.f_set_mask('');
            if(this.b_running) this.f_stop();
        },
    },

    beforeUnmount: function() {
        this.b_stopped = true;
    },

    methods: {

        f_close: function() {
            if(this.b_running) return;
            o_state.o_panel_visibility.cellpose = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },

        f_set_mode: function(s_mode) {
            this.s_mode = s_mode;
            this.f_save_config();
        },

        f_save_config: function() {
            f_save_setting__debounced('o_config__cellpose', {
                s_mode: this.s_mode,
                s_model: this.s_model,
                n_dim: this.n_dim,
                n_sec__delay: this.n_sec__delay,
                n_pct__opacity: o_state.o_cellpose.n_pct__opacity,
            });
        },

        f_load_config: function() {
            let o_setting = o_state.a_o_setting.find(function(o){ return o.s_key === 'o_config__cellpose'; });
            if(!o_setting || !o_setting.s_value) return;
            try {
                let o_config = JSON.parse(o_setting.s_value);
                if(o_config.s_mode) this.s_mode = o_config.s_mode;
                if(o_config.s_model) this.s_model = o_config.s_model;
                if(o_config.n_dim) this.n_dim = o_config.n_dim;
                if(o_config.n_sec__delay !== undefined) this.n_sec__delay = o_config.n_sec__delay;
                if(o_config.n_pct__opacity) o_state.o_cellpose.n_pct__opacity = o_config.n_pct__opacity;
            } catch(o_error) { /* keep the defaults */ }
        },

        f_push_log: function(a_s_line) {
            if(!a_s_line || !a_s_line.length) return;
            this.a_s_line = this.a_s_line.concat(a_s_line).slice(-120);
        },

        // put a mask on the main window (or clear it when s_path is empty).
        // the timestamp is what makes the browser reload a re-segmented frame.
        f_set_mask: function(s_path) {
            o_state.o_cellpose.s_path_mask = s_path || '';
            o_state.o_cellpose.b_visible = !!s_path;
            o_state.o_cellpose.n_ts_ms__mask = s_path ? Date.now() : 0;
        },

        // take the mask off the image, and stop if a loop is running
        f_remove_mask: function() {
            if(this.b_running) this.f_stop();
            this.f_set_mask('');
        },

        // start the server-side worker and then run one shot / the loop
        f_start: async function() {
            let o_self = this;
            if(o_self.b_starting || o_self.b_running) return;
            // the button is disabled while the stage moves; this also catches
            // an Enter key or a click that raced the motor starting
            if(o_self.b_motor_running){
                o_self.s_status__detail = 'motors are running — wait for the stage to stand still';
                return;
            }

            o_self.b_starting = true;
            o_self.s_status__detail = 'loading the model…';
            o_self.f_set_mask('');
            o_self.n_cnt__frame = 0;
            o_self.n_cell = 0;
            o_self.s_device = '';
            o_self.a_s_line = [];

            let o_resp;
            try {
                o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('cellpose_start', {
                    s_model: o_self.s_model,
                    n_dim: o_self.n_dim,
                }));
            } catch(o_error) {
                o_self.s_status__detail = 'Start failed: ' + o_error.message;
                o_self.b_starting = false;
                return;
            }

            let o_result = o_resp.v_result || {};
            o_self.f_push_log(o_result.o_status ? o_result.o_status.a_s_line : []);
            if(!o_result.b_success){
                o_self.s_status__detail = 'Start failed: ' + (o_result.s_error || 'unknown error');
                o_self.b_starting = false;
                return;
            }

            o_self.b_starting = false;
            o_self.b_running = true;
            o_self.b_stopped = false;
            o_self.s_status__detail = '';

            if(o_self.s_mode === 'loop'){
                o_self.f_loop();
            } else {
                await o_self.f_infer__one();
                o_self.b_running = false;
                await o_self.f_stop_worker();
            }
        },

        // capture one frame, upload it, segment it, keep the numbers
        f_infer__one: async function() {
            let o_self = this;
            // the loop pauses instead of failing: a moving stage has no valid
            // frame to segment, and the watcher has already taken the old mask
            // off the image
            if(o_self.b_motor_running){
                o_self.s_status__detail = 'motors are running — the loop pauses until the stage stands still';
                return;
            }
            o_self.b_busy = true;
            try {
                let o_cap = await f_o_capture__frame({ s_type: 'image/png' });

                let o_upload = await fetch('/api/cellpose/frame', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: await o_cap.o_blob.arrayBuffer(),
                });
                if(!o_upload.ok){
                    throw new Error('frame upload failed: ' + o_upload.statusText);
                }
                let o_frame = await o_upload.json();

                let o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('cellpose_infer', {
                    n_seq: o_frame.n_seq,
                    s_path_frame: o_frame.s_path_frame,
                }));

                let o_result = o_resp.v_result || {};
                if(o_result.b_success){
                    o_self.n_cnt__frame = o_frame.n_seq;
                    o_self.n_cell = o_result.n_cell;
                    o_self.n_sec__inference = o_result.n_sec__inference;
                    o_self.n_scl_x = o_result.n_scl_x;
                    o_self.n_scl_y = o_result.n_scl_y;
                    o_self.n_dim__inference = o_result.n_dim__inference;
                    o_self.s_device = o_result.s_device || '';
                    o_self.f_set_mask(o_result.s_path_mask);
                    o_self.s_status__detail = '';
                } else {
                    o_self.s_status__detail = 'Segmentation failed: ' + (o_result.s_error || 'unknown error');
                }
            } catch(o_error) {
                console.error('cellpose frame error:', o_error);
                o_self.s_status__detail = o_error.message;
            }
            o_self.b_busy = false;
        },

        f_loop: async function() {
            let o_self = this;
            while(!o_self.b_stopped){
                await o_self.f_infer__one();
                if(o_self.b_stopped) break;
                // the pause is between finished inferences, so a slow CPU can
                // never build up a queue of frames waiting to be segmented
                if(o_self.n_sec__delay > 0){
                    await o_self.f_sleep(o_self, o_self.n_sec__delay * 1000);
                }
            }
            o_self.b_running = false;
            await o_self.f_stop_worker();
        },

        // sleep that gives up early when the component signals "stop"
        f_sleep: function(o_self, n_ms) {
            return new Promise(function(resolve){
                let f_done = function(){
                    clearTimeout(n_id__timeout);
                    clearInterval(n_id__poll);
                    resolve();
                };
                let n_id__timeout = setTimeout(f_done, n_ms);
                let n_id__poll = setInterval(function(){
                    if(o_self.b_stopped) f_done();
                }, 200);
            });
        },

        f_stop: function() {
            this.b_stopped = true;
            this.s_status__detail = 'stopping…';
        },

        f_stop_worker: async function() {
            let o_self = this;
            try {
                let o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('cellpose_stop', {}));
                if(o_resp.v_result && o_resp.v_result.o_status){
                    o_self.f_push_log(o_resp.v_result.o_status.a_s_line);
                }
            } catch(o_error) { /* the socket may be gone */ }
            o_self.b_running = false;
            o_self.b_busy = false;
            o_self.s_status__detail = '';
        },
    },
};

export { o_component__cellpose };
