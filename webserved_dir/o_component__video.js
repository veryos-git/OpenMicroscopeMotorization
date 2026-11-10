import { o_state, f_save_setting__debounced } from './index.js';
import {
    f_video_record_start,
    f_video_record_stop,
    f_video_burst_start,
    f_video_burst_stop,
    f_video_preroll_arm,
    f_video_preroll_trigger,
    f_video_preroll_disarm,
} from './o_video.module.js';
import { o_component__icon } from './o_component__icon.js';

// Video panel: real-time recording for fast events.  three modes share the same
// MediaRecorder pipeline — a single clip, a scheduled burst, or a pre-roll ring
// buffer that is saved only when the interesting thing finally happens.

let f_s_sz = function(n_byte) {
    if(!n_byte) return '0 B';
    let a_s_unit = ['B', 'KB', 'MB', 'GB'];
    let n_val = n_byte;
    let n_idx = 0;
    while(n_val >= 1024 && n_idx < a_s_unit.length - 1){ n_val /= 1024; n_idx++; }
    return n_val.toFixed(n_val >= 100 || n_idx === 0 ? 0 : 1) + ' ' + a_s_unit[n_idx];
};

let f_s_clock = function(n_sec) {
    let n_m = Math.floor(n_sec / 60);
    let n_s = n_sec % 60;
    return String(n_m).padStart(2, '0') + ':' + String(n_s).padStart(2, '0');
};

let o_component__video = {
    name: 'component-video',
    components: { ui_icon: o_component__icon },
    template: `
        <div class="overlay-panel panel-video" :class="{ visible: o_state.o_panel_visibility.video }">
            <div class="panel-header">
                <h2><ui_icon s_name="video" /> Video</h2>
                <span class="panel-state" :class="{ running: o_state.o_video.b_recording }">{{ o_state.o_video.b_recording ? o_state.o_video.s_status : (o_state.o_video.s_mime ? 'codec: ' + o_state.o_video.s_mime : '') }}</span>
                <button class="cockpit-icon-button" @click="f_library" aria-label="Recorded sessions" data-tooltip="Recorded sessions&#10;Browse, play and export recordings."><ui_icon s_name="folder" /></button>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">

                <div class="record-live" v-if="o_state.o_video.b_recording">
                    <div class="record-live-head">
                        <span class="record-dot"></span>
                        <b>{{ o_state.o_video.s_status }}</b>
                        <span class="record-live-msg">{{ o_state.o_video.s_message }}</span>
                    </div>
                    <div class="record-stats">
                        <span v-if="o_state.o_video.s_status === 'recording'">elapsed <b>{{ f_s_clock(o_state.o_video.n_sec__elapsed) }}</b></span>
                        <span v-if="o_state.o_video.b_preroll">buffered <b>{{ o_state.o_video.n_sec__buffered }} s</b></span>
                        <span>chunks <b>{{ o_state.o_video.n_chunk__uploaded }}</b> / {{ o_state.o_video.n_chunk }}</span>
                        <span>uploaded <b>{{ f_s_sz(o_state.o_video.n_sz__byte) }}</b></span>
                    </div>
                    <div class="cockpit-row record-action">
                        <button class="btn-small" v-if="o_state.o_video.b_preroll" @click="f_preroll_save">save pre-roll</button>
                        <button class="btn-small" v-if="o_state.o_video.b_preroll" @click="f_preroll_off">disarm</button>
                        <button class="btn-scan-start cockpit-grow" v-else @click="f_stop">Stop</button>
                    </div>
                </div>

                <template v-else>
                    <div class="record-dim" v-if="o_state.o_video.s_status === 'done'">{{ o_state.o_video.s_message }}</div>

                    <div class="cockpit-grid cockpit-grid--4">
                        <div class="focus-field cockpit-field" data-tooltip="Source&#10;camera (raw): the unprocessed camera stream.&#10;processed view: the image with filters applied.">
                            <label>Source</label>
                            <select v-model="o_config.s_source" @change="f_on_change">
                                <option value="raw">camera (raw)</option>
                                <option value="processed">processed view</option>
                            </select>
                        </div>
                        <div class="focus-field cockpit-field" data-tooltip="Frames per second of the recording">
                            <label>fps</label>
                            <input type="number" min="1" max="120" step="1" v-model.number="o_config.n_fps" @change="f_on_change">
                        </div>
                        <div class="focus-field cockpit-field" data-tooltip="Bitrate (Mbit/s)&#10;Higher values keep more detail and produce larger files.">
                            <label>Mbit/s</label>
                            <input type="number" min="1" max="80" step="1" v-model.number="o_config.n_mbps" @change="f_on_change">
                        </div>
                        <div class="focus-field cockpit-field" data-tooltip="Disk usage at this bitrate">
                            <label>Filmstrip</label>
                            <div class="record-readout">{{ f_s_sz(o_config.n_mbps * 125000) }}/s</div>
                        </div>
                    </div>

                    <div class="filter-group video-mode">
                        <span class="filter-label" data-tooltip="Record&#10;Real-time video until you press Stop.">Record <span class="ui-info"></span></span>
                        <label class="record-check" data-tooltip="Also write an mp4 next to the recorded stream">
                            <input type="checkbox" v-model="o_config.b_mp4" @change="f_on_change">
                            also write an mp4
                        </label>
                        <button class="btn-scan-start" @click="f_record">&#9679; record</button>
                    </div>

                    <div class="filter-group video-mode">
                        <span class="filter-label" data-tooltip="Burst&#10;Record a short clip again and again, with a pause in between.">Burst <span class="ui-info"></span></span>
                        <div class="focus-field cockpit-field">
                            <label>Clip (s)</label>
                            <input type="number" min="1" step="1" v-model.number="o_config.n_sec__burst" @change="f_on_change">
                        </div>
                        <div class="focus-field cockpit-field">
                            <label>Every (min)</label>
                            <input type="number" min="1" step="1" v-model.number="o_config.n_min__burst__period" @change="f_on_change">
                        </div>
                        <button class="btn-small" @click="f_burst">start burst run</button>
                    </div>

                    <div class="filter-group video-mode">
                        <span class="filter-label" data-tooltip="Pre-roll&#10;Keeps the last seconds in a ring buffer. Save it when something happens to keep what led up to the event.">Pre-roll <span class="ui-info"></span></span>
                        <div class="focus-field cockpit-field" data-tooltip="Buffer (s)&#10;Seconds kept in memory before the trigger.">
                            <label>Buffer (s)</label>
                            <input type="number" min="1" step="1" v-model.number="o_config.n_sec__preroll" @change="f_on_change">
                        </div>
                        <div class="focus-field cockpit-field" data-tooltip="After trigger (s)&#10;Seconds that are still recorded after the buffer is saved.">
                            <label>After (s)</label>
                            <input type="number" min="0" step="1" v-model.number="o_config.n_sec__postroll" @change="f_on_change">
                        </div>
                        <button class="btn-small" @click="f_preroll_arm">arm ring buffer</button>
                    </div>

                    <div class="record-error" v-if="s_error">{{ s_error }}</div>
                    <div class="record-warn" v-if="o_state.o_video.s_error">{{ o_state.o_video.s_error }}</div>
                </template>

            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            o_config: o_state.o_video_config,
            s_error: '',
        };
    },
    methods: {
        f_s_sz: f_s_sz,
        f_s_clock: f_s_clock,
        f_close: function() {
            o_state.o_panel_visibility.video = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_library: function() {
            o_state.o_panel_visibility.recording_library = true;
        },
        f_on_change: function() {
            f_save_setting__debounced('o_video_config', o_state.o_video_config);
        },
        f_record: async function() {
            try {
                this.s_error = '';
                o_state.o_video.s_error = '';
                await f_video_record_start({});
            } catch (o_error) {
                this.s_error = o_error.message || String(o_error);
                o_state.o_video.s_error = this.s_error;
                o_state.o_video.s_status = 'error';
            }
        },
        f_stop: async function() {
            try {
                if(o_state.o_video.b_preroll) f_video_preroll_disarm();
                else await f_video_record_stop();
            } catch (o_error) {
                this.s_error = o_error.message || String(o_error);
            }
        },
        f_burst: async function() {
            try {
                this.s_error = '';
                await f_video_burst_start({});
            } catch (o_error) {
                this.s_error = o_error.message || String(o_error);
            }
        },
        f_preroll_arm: function() {
            try {
                this.s_error = '';
                f_video_preroll_arm();
            } catch (o_error) {
                this.s_error = o_error.message || String(o_error);
            }
        },
        f_preroll_off: function() {
            f_video_preroll_disarm();
        },
        f_preroll_save: async function() {
            try {
                this.s_error = '';
                await f_video_preroll_trigger();
            } catch (o_error) {
                this.s_error = o_error.message || String(o_error);
            }
        },
    },
};

export { o_component__video };
