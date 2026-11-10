import { f_o_camera_geometry } from './camera_frame.module.js';
import { o_state, f_save_setting__debounced, f_send_esp_move_step, f_n_motor__axis } from './index.js';
import {
    f_recording_start,
    f_recording_resume,
    f_recording_pause,
    f_recording_continue,
    f_recording_stop,
    f_recording_list,
    f_recording_probe_camera,
    f_o_recording_preflight,
    f_n_sz__estimate,
    f_o_position__current,
} from './o_recording.module.js';
import { o_component__icon } from './o_component__icon.js';

// the Record panel: set up a time-lapse (interval, positions, autofocus) and
// watch it run.  the engine keeps going when this panel is closed, so the
// running block is deliberately small and always on top of the panel body.

let N_RPM__GOTO = 8.0;
let N_MS__MOVE_TIMEOUT = 30000;

let f_s_sz = function(n_byte) {
    if(n_byte === null || n_byte === undefined) return '?';
    let a_s_unit = ['B', 'KB', 'MB', 'GB', 'TB'];
    let n_val = n_byte;
    let n_idx = 0;
    while(n_val >= 1024 && n_idx < a_s_unit.length - 1){ n_val /= 1024; n_idx++; }
    return n_val.toFixed(n_val >= 100 || n_idx === 0 ? 0 : 1) + ' ' + a_s_unit[n_idx];
};

let f_s_duration = function(n_sec) {
    if(!(n_sec > 0)) return '0 s';
    let n_h = Math.floor(n_sec / 3600);
    let n_m = Math.round((n_sec % 3600) / 60);
    if(n_h > 0) return n_h + ' h ' + n_m + ' min';
    if(n_m > 0) return n_m + ' min';
    return Math.round(n_sec) + ' s';
};

let o_component__record = {
    name: 'component-record',
    components: { ui_icon: o_component__icon },
    template: `
        <div class="overlay-panel panel-record" :class="{ visible: o_state.o_panel_visibility.record }">
            <div class="panel-header">
                <h2><ui_icon s_name="record" /> Time-lapse</h2>
                <span class="panel-state" :class="{ running: o_state.o_record.b_running }">{{ o_state.o_record.b_running || o_state.o_record.b_encoding ? (o_state.o_record.b_pause ? 'paused' : o_state.o_record.s_status) : s_duration }}</span>
                <button class="cockpit-icon-button" @click="f_open_library" aria-label="Recorded sessions" data-tooltip="Recorded sessions&#10;Browse, play and export recordings."><ui_icon s_name="folder" /></button>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">

                <!-- live run -->
                <div class="record-live" v-if="o_state.o_record.b_running || o_state.o_record.b_encoding">
                    <div class="record-live-head">
                        <span class="record-dot" :class="{ pause: o_state.o_record.b_pause }"></span>
                        <b>{{ o_state.o_record.b_pause ? 'paused' : o_state.o_record.s_status }}</b>
                        <span class="record-live-msg">{{ o_state.o_record.s_message }}</span>
                    </div>
                    <div class="record-progress">
                        <div class="record-progress-bar" :style="{ width: n_pct__progress + '%' }"></div>
                    </div>
                    <div class="record-stats">
                        <span>frame <b>{{ o_state.o_record.n_its__frame__done }}</b> / {{ o_state.o_record.n_its__frame }}</span>
                        <span v-if="o_state.o_record.n_its__position > 1">field <b>{{ o_state.o_record.n_idx__position + 1 }}</b> / {{ o_state.o_record.n_its__position }}</span>
                        <span v-if="o_state.o_record.b_running">next in <b>{{ s_countdown }}</b></span>
                        <span v-if="o_state.o_record.n_free__byte !== null">free <b>{{ f_s_sz(o_state.o_record.n_free__byte) }}</b></span>
                        <span v-if="o_state.o_record.o_frame__last">
                            focus <b>{{ o_state.o_record.o_frame__last.n_score__focus.toFixed(0) }}</b>
                            &middot; z <b>{{ o_state.o_record.o_frame__last.n_z__stage }}</b>
                        </span>
                    </div>
                    <div class="cockpit-row record-action">
                        <button class="btn-small" @click="f_pause" v-if="!o_state.o_record.b_pause">Pause</button>
                        <button class="btn-small" @click="f_continue" v-else>Continue</button>
                        <button class="btn-scan-start cockpit-grow" @click="f_stop">Stop</button>
                    </div>
                </div>

                <!-- setup -->
                <template v-else>
                    <div class="cockpit-grid cockpit-grid--4">
                        <div class="focus-field cockpit-field record-span-2" data-tooltip="Name&#10;Used for the session folder and the exported files.">
                            <label>Name</label>
                            <input type="text" v-model="o_config.s_name" @change="f_on_change" placeholder="recording">
                        </div>
                        <div class="focus-field cockpit-field" data-tooltip="Interval&#10;Time between two frames.">
                            <label>Every</label>
                            <input type="number" min="1" step="1" v-model.number="n_interval__value" @change="f_on_change">
                        </div>
                        <div class="focus-field cockpit-field">
                            <label>Unit</label>
                            <select v-model="s_interval__unit" @change="f_on_change">
                                <option value="sec">seconds</option>
                                <option value="min">minutes</option>
                                <option value="hour">hours</option>
                            </select>
                        </div>
                        <div class="focus-field cockpit-field" data-tooltip="Frames&#10;Number of timepoints to record.">
                            <label>Frames</label>
                            <input type="number" min="1" step="1" v-model.number="o_config.n_its__frame" @change="f_on_change">
                        </div>
                        <div class="focus-field cockpit-field" data-tooltip="Duration&#10;Frames × interval. The buttons set the frame count for a total duration.">
                            <label>Duration</label>
                            <div class="record-readout">{{ s_duration }}</div>
                        </div>
                        <div class="record-quick record-span-2" aria-label="Quick duration">
                            <button class="btn-small" @click="f_quick_duration(1)" data-tooltip="Record for 1 hour">1 h</button>
                            <button class="btn-small" @click="f_quick_duration(6)" data-tooltip="Record for 6 hours">6 h</button>
                            <button class="btn-small" @click="f_quick_duration(12)" data-tooltip="Record for 12 hours">12 h</button>
                            <button class="btn-small" @click="f_quick_duration(24)" data-tooltip="Record for 24 hours">24 h</button>
                            <button class="btn-small" @click="f_quick_duration(72)" data-tooltip="Record for 3 days">3 d</button>
                        </div>
                    </div>

                    <!-- positions -->
                    <div class="filter-group">
                        <div class="cockpit-section-head">
                            <span class="filter-label">Fields of view</span>
                            <span class="ui-info" tabindex="0" role="note" data-tooltip="Fields of view&#10;Stage positions the recording can visit. Add the current position, then save the list. Without positions the stage stays where it is."></span>
                            <label class="record-check" data-tooltip="Drive to every saved position at each timepoint">
                                <input type="checkbox" v-model="o_config.b_position__all" @change="f_on_change">
                                visit every position each timepoint
                            </label>
                        </div>
                        <div class="record-position-list cockpit-list">
                            <div class="record-position" v-for="(o_pos, n_idx) in o_config.a_o_position" :key="n_idx">
                                <span class="record-position-name">{{ o_pos.s_label }}</span>
                                <span class="record-position-pos">{{ o_pos.n_x__stage }}, {{ o_pos.n_y__stage }}</span>
                                <button class="btn-small" @click="f_goto(o_pos)" data-tooltip="Move the stage to this position">go</button>
                                <button class="btn-small" @click="f_remove_position(n_idx)" data-tooltip="Remove this position">&times;</button>
                            </div>
                        </div>
                        <div class="cockpit-row record-action">
                            <button class="btn-small" @click="f_add_position" :disabled="!o_state.b_connected__esp" data-tooltip="Add the current stage position">+ add current</button>
                            <button class="btn-small" @click="f_on_change" data-tooltip="Save the position list with the recording setup">save list</button>
                        </div>
                    </div>

                    <!-- focus / crop / format -->
                    <div class="filter-group cockpit-grid cockpit-grid--4">
                        <label class="record-check record-span-2" data-tooltip="Autofocus between timepoints&#10;Refocus so a drifting specimen stays sharp over hours.">
                            <input type="checkbox" v-model="o_config.b_autofocus" @change="f_on_change">
                            autofocus between timepoints
                        </label>
                        <div class="focus-field cockpit-field" v-if="o_config.b_autofocus" data-tooltip="Every N frames&#10;Autofocus before every N-th frame.">
                            <label>Every N</label>
                            <input type="number" min="1" step="1" v-model.number="o_config.n_its__autofocus" @change="f_on_change">
                        </div>
                        <div class="focus-field cockpit-field" v-if="o_config.b_autofocus" data-tooltip="Settle (ms)&#10;Wait after each focus move before measuring.">
                            <label>Settle (ms)</label>
                            <input type="number" min="0" step="50" v-model.number="o_config.n_ms__settle" @change="f_on_change">
                        </div>
                        <label class="record-check cockpit-span" data-tooltip="Crop to the zoom region&#10;Save only the region picked with the Zoom tool.">
                            <input type="checkbox" v-model="o_config.b_roi" @change="f_on_change">
                            crop to the zoom region
                            <span class="record-dim" v-if="o_state.o_zoom.n_scl_x__roi">
                                ({{ o_state.o_zoom.n_scl_x__roi }} &times; {{ o_state.o_zoom.n_scl_y__roi }} px)
                            </span>
                        </label>
                    </div>

                    <div class="filter-group cockpit-grid cockpit-grid--4 record-output">
                        <div class="focus-field cockpit-field" data-tooltip="Image format&#10;png: lossless. jpg: smaller files.">
                            <label>Format</label>
                            <select v-model="o_config.s_format" @change="f_on_change">
                                <option value="png">png (lossless)</option>
                                <option value="jpg">jpg (smaller)</option>
                            </select>
                        </div>
                        <div class="focus-field cockpit-field" data-tooltip="Keep free (GB)&#10;Recording stops before the disk has less free space than this.">
                            <label>Free (GB)</label>
                            <input type="number" min="0" step="1" v-model.number="o_config.n_gb__reserve" @change="f_on_change">
                        </div>
                        <label class="record-check" data-tooltip="Encode an mp4 when finished">
                            <input type="checkbox" v-model="o_config.b_mp4" @change="f_on_change">
                            mp4
                        </label>
                        <div class="focus-field cockpit-field" v-if="o_config.b_mp4" data-tooltip="Playback fps&#10;Frame rate of the encoded mp4.">
                            <label>mp4 fps</label>
                            <input type="number" min="1" max="60" step="1" v-model.number="o_config.n_fps__mp4" @change="f_on_change">
                        </div>
                    </div>

                    <!-- preflight -->
                    <div class="cockpit-footer">
                        <div class="record-stats">
                            <span>estimate <b>{{ f_s_sz(n_sz__est__byte) }}</b></span>
                            <span v-if="o_state.o_record.n_free__byte !== null">free <b>{{ f_s_sz(o_state.o_record.n_free__byte) }}</b></span>
                            <span class="record-dim" v-if="o_state.o_record.o_camera__probe">
                                <template v-if="o_state.o_record.o_camera__probe.b_available">
                                    {{ o_state.o_record.o_camera__probe.a_o_device.length }} video device(s) on the server
                                </template>
                                <template v-else>no video device visible to the server</template>
                            </span>
                        </div>
                        <div class="record-error" v-for="s_error in a_s_error" :key="s_error">{{ s_error }}</div>
                        <div class="record-warn" v-for="s_warn in a_s_warn" :key="s_warn">{{ s_warn }}</div>
                        <div class="cockpit-row record-action">
                            <button class="btn-small" @click="f_check" data-tooltip="Check&#10;Verify disk space and the recording setup without starting.">Check</button>
                            <button class="btn-small" @click="f_probe" data-tooltip="Probe camera&#10;Ask the server which video devices it can see.">probe camera</button>
                            <button class="btn-scan-start cockpit-grow" @click="f_start" :disabled="!o_state.b_streaming__webcam">Start</button>
                        </div>
                        <!-- resume an interrupted session -->
                        <div v-if="a_o_resumable.length > 0">
                            <div class="filter-label">Interrupted</div>
                            <div class="record-position-list cockpit-list">
                                <div class="record-position" v-for="o_item in a_o_resumable" :key="o_item.s_path_folder">
                                    <span class="record-position-name">{{ o_item.s_name }}</span>
                                    <span class="record-position-pos">{{ o_item.n_its__frame__done }} / {{ o_item.n_its__frame }}</span>
                                    <button class="btn-small" @click="f_resume(o_item.s_path_folder)">resume</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>

            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            o_config: o_state.o_record_config,
            s_interval__unit: 'min',
            a_s_error: [],
            a_s_warn: [],
        };
    },
    computed: {
        // sessions that can be continued: "running" is what a browser reload
        // leaves behind, "interrupted" is what a server restart leaves behind
        a_o_resumable: function() {
            return (o_state.o_record.a_o_recording || [])
                .filter(function(o_item){
                    return o_item.o_manifest
                        && (o_item.o_manifest.s_status === 'interrupted' || o_item.o_manifest.s_status === 'running');
                })
                .map(function(o_item){
                    let o_manifest = o_item.o_manifest;
                    return {
                        s_name: o_manifest.s_name || o_item.s_name_folder,
                        s_path_folder: o_item.s_path_folder,
                        n_its__frame: o_manifest.n_its__frame || 0,
                        n_its__frame__done: o_manifest.n_its__frame__done || 0,
                    };
                });
        },
        n_interval__value: {
            get: function() {
                let n_sec = this.o_config.n_sec__interval;
                if(this.s_interval__unit === 'hour') return Math.round(n_sec / 3600 * 100) / 100;
                if(this.s_interval__unit === 'sec') return Math.round(n_sec);
                return Math.round(n_sec / 60 * 100) / 100;
            },
            set: function(v) {
                let n_val = Number(v) || 0;
                if(this.s_interval__unit === 'hour') this.o_config.n_sec__interval = n_val * 3600;
                else if(this.s_interval__unit === 'sec') this.o_config.n_sec__interval = n_val;
                else this.o_config.n_sec__interval = n_val * 60;
            },
        },
        s_duration: function() {
            return f_s_duration(this.o_config.n_sec__interval * this.o_config.n_its__frame);
        },
        n_sz__est__byte: function() {
            let n_scl_x = this.o_state.o_zoom.n_scl_x__roi;
            let n_scl_y = this.o_state.o_zoom.n_scl_y__roi;
            if(!(this.o_config.b_roi && n_scl_x > 0)){
                let el_video = document.getElementById('webcamVideo');
                n_scl_x = el_video ? f_o_camera_geometry(el_video).n_scl_x : 1920;
                n_scl_y = el_video ? f_o_camera_geometry(el_video).n_scl_y : 1080;
            }
            return f_n_sz__estimate(this.o_config, n_scl_x, n_scl_y);
        },
        n_pct__progress: function() {
            let o_record = o_state.o_record;
            if(!(o_record.n_its__frame > 0)) return 0;
            return Math.max(0, Math.min(100, Math.round(o_record.n_its__frame__done / o_record.n_its__frame * 100)));
        },
        s_countdown: function() {
            let o_record = o_state.o_record;
            if(!o_record.n_ts_ms__next) return '--:--';
            let n_ms = o_record.n_ts_ms__next - o_state.n_ts_ms_now;
            if(n_ms <= 0) return 'now';
            let n_sec = Math.ceil(n_ms / 1000);
            let n_m = Math.floor(n_sec / 60);
            let n_s = n_sec % 60;
            if(n_m >= 60){
                let n_h = Math.floor(n_m / 60);
                return n_h + 'h ' + String(n_m % 60).padStart(2, '0') + 'm';
            }
            return String(n_m).padStart(2, '0') + ':' + String(n_s).padStart(2, '0');
        },
    },
    watch: {
        'o_state.o_panel_visibility.record': function(b_visible) {
            if(b_visible){
                this.f_refresh_list();
                this.f_check();
            }
        },
    },
    mounted: function() {
        let o_self = this;
        // pick a readable unit for the stored interval
        let n_sec = o_self.o_config.n_sec__interval;
        if(n_sec >= 3600 && n_sec % 3600 === 0) o_self.s_interval__unit = 'hour';
        o_self.f_refresh_list();
        o_self.f_check();
    },
    methods: {
        f_s_sz: f_s_sz,
        f_s_duration: f_s_duration,
        f_close: function() {
            o_state.o_panel_visibility.record = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_open_library: function() {
            o_state.o_panel_visibility.recording_library = true;
        },
        f_on_change: function() {
            f_save_setting__debounced('o_record_config', o_state.o_record_config);
        },
        f_quick_duration: function(n_hour) {
            let n_sec = Math.max(1, this.o_config.n_sec__interval);
            this.o_config.n_its__frame = Math.max(1, Math.round(n_hour * 3600 / n_sec));
            this.f_on_change();
        },
        f_add_position: function() {
            let o_config = this.o_config;
            if(!Array.isArray(o_config.a_o_position)) o_config.a_o_position = [];
            let o_position = f_o_position__current('field ' + (o_config.a_o_position.length + 1));
            o_position.s_label = 'field ' + (o_config.a_o_position.length + 1);
            o_config.a_o_position.push(o_position);
            this.f_on_change();
        },
        f_remove_position: function(n_idx) {
            this.o_config.a_o_position.splice(n_idx, 1);
            this.f_on_change();
        },
        f_goto: async function(o_position) {
            let a_o_axis = [['x', o_position.n_x__stage], ['y', o_position.n_y__stage]];
            for(let a_v of a_o_axis){
                let n_motor = f_n_motor__axis(a_v[0]);
                let n_step = Math.round(a_v[1] - o_state.a_o_motor[n_motor].n_position);
                if(n_step === 0) continue;
                let o_move = f_send_esp_move_step(n_motor, n_step, N_RPM__GOTO);
                let o_timeout = new Promise(function(resolve){ setTimeout(function(){ resolve('timeout'); }, N_MS__MOVE_TIMEOUT); });
                await Promise.race([o_move, o_timeout]);
            }
        },
        f_check: async function() {
            let o_check = null;
            try {
                o_check = await f_o_recording_preflight(this.o_config);
            } catch (o_error) {
                this.a_s_error = [o_error.message || String(o_error)];
                this.a_s_warn = [];
                return;
            }
            this.a_s_error = o_check.a_s_error;
            this.a_s_warn = o_check.a_s_warn;
            if(o_check.o_disk) o_state.o_record.n_free__byte = o_check.o_disk.n_free__byte;
        },
        f_start: async function() {
            let o_self = this;
            try {
                o_self.a_s_error = [];
                await f_recording_start(o_self.o_config, o_self.o_config.a_o_position);
            } catch (o_error) {
                o_self.a_s_error = [o_error.message || String(o_error)];
            }
        },
        f_pause: function() { f_recording_pause(); },
        f_continue: function() { f_recording_continue(); },
        f_stop: function() { f_recording_stop(); },
        f_refresh_list: async function() {
            try {
                await f_recording_list();
            } catch (o_error) {
                // the list is only used for the resume offer
            }
        },
        f_resume: async function(s_path_folder) {
            let o_self = this;
            try {
                o_self.a_s_error = [];
                await f_recording_resume(s_path_folder);
            } catch (o_error) {
                o_self.a_s_error = [o_error.message || String(o_error)];
            }
        },
        f_probe: async function() {
            try {
                await f_recording_probe_camera();
            } catch (o_error) {
                this.a_s_error = [o_error.message || String(o_error)];
            }
        },
    },
};

export { o_component__record };
