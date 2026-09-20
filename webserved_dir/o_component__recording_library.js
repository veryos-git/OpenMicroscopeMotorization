import { o_state, f_save_setting__debounced } from './index.js';
import {
    f_recording_list,
    f_recording_delete,
    f_recording_encode,
    f_recording_export_tiff,
    f_recording_resume,
} from './o_recording.module.js';

// sessions library: every recording folder the server knows about, with
// playback, mp4 export and delete.  mirrors the slide-library table style.

let f_s_sz = function(n_byte) {
    if(n_byte === null || n_byte === undefined) return '?';
    let a_s_unit = ['B', 'KB', 'MB', 'GB', 'TB'];
    let n_val = n_byte;
    let n_idx = 0;
    while(n_val >= 1024 && n_idx < a_s_unit.length - 1){ n_val /= 1024; n_idx++; }
    return n_val.toFixed(n_val >= 100 || n_idx === 0 ? 0 : 1) + ' ' + a_s_unit[n_idx];
};

let f_s_date = function(n_ts_ms) {
    if(!n_ts_ms) return '';
    let o_date = new Date(n_ts_ms);
    let f_p = function(n){ return String(n).padStart(2, '0'); };
    return o_date.getFullYear() + '-' + f_p(o_date.getMonth() + 1) + '-' + f_p(o_date.getDate())
        + ' ' + f_p(o_date.getHours()) + ':' + f_p(o_date.getMinutes());
};

let o_component__recording_library = {
    name: 'component-recording-library',
    template: `
        <div class="overlay-panel panel-record-library" :class="{ visible: o_state.o_panel_visibility.recording_library }">
            <div class="panel-header">
                <h2>Recordings</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <div class="filter-row">
                    <button class="btn-small" @click="f_refresh">refresh</button>
                    <span class="record-dim">{{ o_state.o_record.a_o_recording.length }} session(s)</span>
                </div>

                <div class="record-session" v-for="o_item in o_state.o_record.a_o_recording" :key="o_item.s_path_folder">
                    <div class="record-session-head">
                        <img class="record-session-thumb" v-if="o_item.s_path_thumb"
                            :src="'/api/file?path=' + encodeURIComponent(o_item.s_path_thumb)">
                        <div class="record-session-title">
                            <b>{{ f_s_name(o_item) }}</b>
                            <span class="record-dim">{{ f_s_date(o_item.n_ts_ms) }} &middot; {{ f_s_sz(o_item.n_sz__byte) }}</span>
                            <span class="record-dim">
                                {{ f_n_frame(o_item) }} frames
                                <span v-if="f_s_status(o_item)"> &middot; {{ f_s_status(o_item) }}</span>
                            </span>
                        </div>
                    </div>

                    <video
                        class="record-session-video"
                        v-if="f_s_media(o_item)"
                        :src="'/api/file?path=' + encodeURIComponent(f_s_media(o_item))"
                        controls preload="metadata"
                    ></video>

                    <div class="filter-row" style="margin-top:6px;">
                        <button class="btn-small" @click="f_encode(o_item)"
                            :disabled="o_state.o_record.b_encoding">export mp4</button>
                        <button class="btn-small" @click="f_tiff(o_item)"
                            :disabled="o_state.o_record.b_encoding || f_b_video(o_item)">export TIFF</button>
                        <button class="btn-small" v-if="f_b_resumable(o_item)" @click="f_resume(o_item)">resume</button>
                        <button class="btn-small record-danger" @click="f_delete(o_item)">delete</button>
                    </div>
                    <div class="record-dim record-path">{{ o_item.s_path_folder }}</div>
                </div>

                <div class="record-dim" v-if="o_state.o_record.a_o_recording.length === 0">no recordings yet</div>
                <div class="record-error" v-if="s_error">{{ s_error }}</div>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            s_error: '',
        };
    },
    watch: {
        // opening the library refreshes it; a finished run refreshes it too
        'o_state.o_panel_visibility.recording_library': function(b_visible) {
            if(b_visible) this.f_refresh();
        },
    },
    mounted: function() {
        this.f_refresh();
    },
    methods: {
        f_s_sz: f_s_sz,
        f_s_date: f_s_date,
        f_s_name: function(o_item) {
            return (o_item.o_manifest && o_item.o_manifest.s_name) || o_item.s_name_folder;
        },
        f_s_status: function(o_item) {
            return o_item.o_manifest ? o_item.o_manifest.s_status : '';
        },
        f_n_frame: function(o_item) {
            return o_item.o_manifest ? (o_item.o_manifest.n_its__frame__done || 0) : 0;
        },
        f_s_media: function(o_item) {
            return (o_item.a_s_media && o_item.a_s_media.length > 0) ? o_item.a_s_media[0] : '';
        },
        f_b_resumable: function(o_item) {
            let s_status = this.f_s_status(o_item);
            return s_status === 'running' || s_status === 'interrupted';
        },
        // a MediaRecorder session has no frame sequence to stack
        f_b_video: function(o_item) {
            let s_kind = o_item.o_manifest ? o_item.o_manifest.s_kind : '';
            return s_kind === 'video' || s_kind === 'burst';
        },
        f_tiff: async function(o_item) {
            try {
                this.s_error = '';
                let o_manifest = o_item.o_manifest || {};
                await f_recording_export_tiff({
                    s_path_folder: o_item.s_path_folder,
                    s_pos: 'pos_00',
                    n_sec__interval: o_manifest.n_sec__interval || 0,
                    n_um__per_px: o_manifest.n_um__per_px || 0,
                });
                await this.f_refresh();
            } catch (o_error) {
                this.s_error = o_error.message || String(o_error);
            }
        },
        f_close: function() {
            o_state.o_panel_visibility.recording_library = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_refresh: async function() {
            try {
                await f_recording_list();
                this.s_error = '';
            } catch (o_error) {
                this.s_error = o_error.message || String(o_error);
            }
        },
        f_encode: async function(o_item) {
            try {
                this.s_error = '';
                await f_recording_encode({
                    s_path_folder: o_item.s_path_folder,
                    n_fps: o_state.o_record_config.n_fps__mp4,
                });
                await this.f_refresh();
            } catch (o_error) {
                this.s_error = o_error.message || String(o_error);
            }
        },
        f_resume: async function(o_item) {
            try {
                this.s_error = '';
                await f_recording_resume(o_item.s_path_folder);
                await this.f_refresh();
            } catch (o_error) {
                this.s_error = o_error.message || String(o_error);
            }
        },
        f_delete: async function(o_item) {
            if(!confirm('delete ' + o_item.s_name_folder + '?')) return;
            try {
                this.s_error = '';
                await f_recording_delete(o_item.s_path_folder);
                await this.f_refresh();
            } catch (o_error) {
                this.s_error = o_error.message || String(o_error);
            }
        },
    },
};

export { o_component__recording_library };
