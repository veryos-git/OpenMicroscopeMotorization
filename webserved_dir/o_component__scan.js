import { f_n_motor__axis, o_state, f_send_esp_move_step, f_send_esp_stop, f_send_esp_stop_all, f_send_wsmsg_with_response, f_save_setting__debounced } from './index.js';
import { f_o_wsmsg } from './constructors.module.js';
import { f_n_score__video, f_o_focus__fast } from './focus_search.module.js';
import { f_o_capture__frame, f_save_image } from './o_capture.module.js';

let N_RPM__SCAN = 8.0;
let N_MS__SETTLE = 500;
let N_MS__MOVE_TIMEOUT = 30000;
// the per-tile focus measures on a small crop: the metric is not the bottleneck,
// but every millisecond here is paid once per tile
let N_SCL_X__FOCUS_MEASURE = 320;
let N_PCT__FOCUS_ROI = 60;

let o_component__scan = {
    name: 'component-scan',
    template: `
        <div class="overlay-panel panel-scan" :class="{ visible: o_state.o_panel_visibility.scan }">
            <div class="panel-header">
                <h2>Tile Scan</h2>
                <button class="panel-close" @click="f_close" :disabled="s_status === 'scanning'">&times;</button>
            </div>
            <div class="panel-body">
                <div v-if="s_error__jobs" class="scan-stitch-error">{{ s_error__jobs }}</div>
                <details class="scan-jobs" :open="a_o_job.some(job => ['queued', 'running'].includes(job.s_status))">
                    <summary>Scans · {{ a_o_job.length }} <span v-if="n_jobs_pending">· {{ n_jobs_pending }} pending</span></summary>
                    <div class="scan-hint">Stitching runs in the background. You can capture the next scan while jobs are queued or running.</div>
                    <article v-for="job in a_o_job" :key="job.s_id" class="scan-job">
                        <div class="scan-job-title"><strong>{{ job.s_name }}</strong><span>{{ job.s_status }}</span></div>
                        <div class="scan-hint">{{ job.n_tiles }} tiles</div>
                        <div class="scan-field-row">
                            <a class="btn-small" :href="'/api/scans/folder?path=' + encodeURIComponent(job.s_path_folder)" target="_blank" rel="noopener">Open folder</a>
                            <a v-if="job.s_status === 'complete' && job.o_result?.s_path_output" class="btn-small"
                                :href="'/api/file?path=' + encodeURIComponent(job.o_result.s_path_output) + '&v=' + job.n_finished" target="_blank" rel="noopener">Open mosaic</a>
                            <button class="btn-small" v-if="!['capturing', 'queued', 'running'].includes(job.s_status)"
                                :disabled="job.n_tiles < 2 || b_queueing" @click="f_stitch(job)">{{ job.s_status === 'ready' ? 'Stitch' : 'Stitch again' }}</button>
                        </div>
                        <div v-if="job.s_error" class="scan-stitch-error">{{ job.s_error }}</div>
                        <a v-if="job.s_status === 'complete' && job.o_result?.s_path_output"
                            :href="'/api/file?path=' + encodeURIComponent(job.o_result.s_path_output)" target="_blank" rel="noopener">
                            <img class="scan-stitch-preview" loading="lazy" alt="Stitched scan"
                                :src="'/api/file?path=' + encodeURIComponent(job.o_result.s_path_preview || job.o_result.s_path_output) + '&v=' + job.n_finished" />
                        </a>
                        <div class="scan-hint" v-if="job.s_status === 'running'">{{ job.a_s_line.at(-1) }}</div>
                        <details v-if="job.a_s_line.length"><summary>Stitch log</summary>
                            <div class="scan-stitch-log"><div v-for="(line, i) in job.a_s_line" :key="i">{{ line }}</div></div>
                        </details>
                    </article>
                </details>


                <!-- ── Config (idle) ─────────────────────── -->
                <template v-if="s_status === 'idle'">

                    <div class="scan-section">
                        <div class="scan-label">Auto Grid (mark points)</div>
                        <div class="scan-hint">
                            calibrate steps/px first (Backlash panel, the motors assigned to X and Y).
                            then jog around the area and mark points — the grid covers
                            the bounding box of every point.
                        </div>
                        <div class="scan-field-row">
                            <button class="btn-small" @click="f_add_point" :disabled="!o_state.b_connected__esp">Add point</button>
                            <button class="btn-small" @click="f_remove_point" :disabled="!a_o_point__grid.length">Undo</button>
                            <button class="btn-small" @click="f_clear_points" :disabled="!a_o_point__grid.length">Clear</button>
                        </div>
                        <div class="scan-field">
                            <label>Overlap %</label>
                            <input type="number" v-model.number="n_overlap__pct" min="0" max="90" step="5" @change="f_save_config" />
                        </div>
                        <div class="scan-hint">
                            {{ a_o_point__grid.length }} point(s) marked
                            <template v-if="s_box__label"> · bounding box {{ s_box__label }}</template>
                        </div>
                        <div class="scan-hint">
                            steps/px &mdash; X {{ n_step__per_px__x.toFixed(2) }} · Y {{ n_step__per_px__y.toFixed(2) }}
                            <template v-if="!n_step__per_px__x || !n_step__per_px__y">(calibrate both axes first)</template>
                        </div>
                        <button
                            class="btn-small btn-scan-test-square"
                            @click="f_auto_grid"
                            :disabled="!n_step__per_px__x || !n_step__per_px__y || !o_state.b_connected__esp || a_o_point__grid.length < 2"
                        >Compute grid</button>
                    </div>

                    <div class="scan-section">
                        <div class="scan-label">Movement Distance (steps)</div>
                        <div class="scan-hint">
                            Set slightly less than camera field of view so adjacent
                            tiles overlap. Overlap is needed for stitching.
                        </div>

                        <div class="scan-field">
                            <label>X distance</label>
                            <div class="scan-field-row">
                                <input
                                    type="number"
                                    v-model.number="n_step__x"
                                    min="1"
                                    @change="f_save_config"
                                >
                                <button
                                    class="btn-small"
                                    @click="f_test_distance('x', 1)"
                                    :disabled="b_testing || !o_state.b_connected__esp"
                                >Test +X</button>
                                <button
                                    class="btn-small"
                                    @click="f_test_distance('x', -1)"
                                    :disabled="b_testing || !o_state.b_connected__esp"
                                >Test &minus;X</button>
                            </div>
                        </div>

                        <div class="scan-field">
                            <label>Y distance</label>
                            <div class="scan-field-row">
                                <input
                                    type="number"
                                    v-model.number="n_step__y"
                                    min="1"
                                    @change="f_save_config"
                                >
                                <button
                                    class="btn-small"
                                    @click="f_test_distance('y', 1)"
                                    :disabled="b_testing || !o_state.b_connected__esp"
                                >Test +Y</button>
                                <button
                                    class="btn-small"
                                    @click="f_test_distance('y', -1)"
                                    :disabled="b_testing || !o_state.b_connected__esp"
                                >Test &minus;Y</button>
                            </div>
                        </div>
                    </div>

                    <div class="scan-section">
                        <div class="scan-label">Tile Grid</div>

                        <div class="scan-field">
                            <label>X tiles (columns)</label>
                            <input
                                type="number"
                                v-model.number="n_tile_x"
                                min="1" max="100"
                                @change="f_save_config"
                            >
                        </div>

                        <div class="scan-field">
                            <label>Y tiles (rows)</label>
                            <input
                                type="number"
                                v-model.number="n_tile_y"
                                min="1" max="100"
                                @change="f_save_config"
                            >
                        </div>

                        <div class="scan-total">
                            {{ n_tile_x }} &times; {{ n_tile_y }} = {{ n_tile_x * n_tile_y }} images
                        </div>

                        <button
                            class="btn-small btn-scan-test-square"
                            @click="f_test_square"
                            :disabled="b_testing || !o_state.b_connected__esp || n_step__x < 1 || n_step__y < 1 || n_tile_x < 1 || n_tile_y < 1"
                        >{{ b_testing ? 'Testing...' : 'Test Square' }}</button>

                        <div class="scan-field-row" style="margin-top: 8px;">
                            <button
                                class="btn-small"
                                style="flex: 1; margin-left: 0;"
                                @click="f_test_axis('x')"
                                :disabled="b_testing || !o_state.b_connected__esp || n_step__x < 1 || n_tile_x < 1"
                            >Test X</button>
                            <button
                                class="btn-small"
                                style="flex: 1; margin-left: 0;"
                                @click="f_test_axis('y')"
                                :disabled="b_testing || !o_state.b_connected__esp || n_step__y < 1 || n_tile_y < 1"
                            >Test Y</button>
                        </div>
                    </div>

                    <div class="scan-section">
                        <div class="scan-label">Focus</div>
                        <label class="scan-toggle">
                            <input type="checkbox" v-model="b_focus__before_tile" :disabled="o_state.o_motor__axis.z === null" @change="f_save_config" />
                            <span>Find focus before every image</span>
                        </label>
                        <div class="scan-hint">
                            a short search around the focus the previous tile ended on:
                            it walks uphill only as far as it must and finishes with a
                            parabola, so it needs about 4 measurements instead of the
                            20 positions the Focus panel sweeps. costs a few seconds
                            per tile and keeps a tilted slide sharp all the way across.
                        </div>

                        <div class="scan-field">
                            <label>Focus motor</label>
                            <span>{{ s_motor__focus_label }}</span>
                        </div>
                        <div class="scan-field" v-if="b_focus__before_tile">
                            <label>Search step</label>
                            <input type="number" min="1" v-model.number="n_step__focus" @change="f_save_config">
                        </div>
                        <div class="scan-field" v-if="b_focus__before_tile">
                            <label>Max. travel</label>
                            <input type="number" min="10" step="10" v-model.number="n_step__focus_max" @change="f_save_config">
                        </div>
                        <div class="scan-hint" v-if="b_focus__before_tile">
                            the settle has to cover the camera latency too — measuring a
                            frame that was still in flight when the motor moved reads the
                            sharpness of the previous position.
                        </div>
                        <div class="scan-field" v-if="b_focus__before_tile">
                            <label>Focus settle (ms)</label>
                            <input type="number" min="0" step="50" v-model.number="n_ms__focus_settle" @change="f_save_config">
                        </div>
                    </div>

                    <div class="scan-section">
                        <div class="scan-label">Stitching</div>
                        <label class="scan-toggle">
                            <input type="checkbox" v-model="b_stitch__after_scan" @change="f_save_config" />
                            <span>Stitch automatically when the scan is done</span>
                        </label>
                        <div class="scan-hint">
                            Alignment uses copies at most 256 pixels wide, saved in
                            dowscaled/. The original images are combined using those
                            positions to preserve full-resolution detail.
                        </div>

                        <div class="scan-field">
                            <label>Min. match score</label>
                            <input
                                type="number"
                                v-model.number="n_score__min"
                                min="0.05" max="0.95" step="0.05"
                                @change="f_save_config"
                            >
                        </div>
                        <div class="scan-hint">
                            lower it (e.g. 0.15) for low-contrast slides, raise it when
                            wrong pairs get accepted.
                        </div>

                        <div class="scan-field">
                            <label>Max. output size (px, 0 = full)</label>
                            <input
                                type="number"
                                v-model.number="n_dim__max"
                                min="0" step="1000"
                                @change="f_save_config"
                            >
                        </div>

                        <label class="scan-toggle">
                            <input type="checkbox" v-model="b_feather" @change="f_save_config" />
                            <span>Feather blending</span>
                        </label>
                        <label class="scan-toggle">
                            <input type="checkbox" v-model="b_flatfield" @change="f_save_config" />
                            <span>Flat-field / vignetting correction</span>
                        </label>
                        <label class="scan-toggle">
                            <input type="checkbox" v-model="b_matcher__loftr" @change="f_save_config" />
                            <span>LoFTR rescue matcher (slow)</span>
                        </label>
                        <div class="scan-hint">
                            LoFTR retries pairs that correlation could not solve.
                            Needs torch + kornia in the venv.
                        </div>
                    </div>

                    <div class="scan-section">
                        <div class="scan-label">After scan</div>
                        <label class="scan-toggle">
                            <input type="checkbox" v-model="b_return__after_scan" @change="f_save_config" />
                            <span>Return motors to their start position</span>
                        </label>
                        <div class="scan-hint">
                            drives the stage back to where it was when the scan started.
                        </div>
                    </div>

                    <button
                        class="btn-scan-start"
                        @click="f_start_scan"
                        :disabled="!o_state.b_connected__esp || n_step__x < 1 || n_step__y < 1 || n_tile_x < 1 || n_tile_y < 1"
                    >Start Scan</button>
                </template>

                <!-- ── Progress (scanning) ───────────────── -->
                <template v-if="s_status === 'scanning'">
                    <div class="scan-progress-text">{{ s_status__detail }}</div>

                    <div class="scan-progress-count">
                        Capturing {{ n_cnt__tile__captured + 1 }} / {{ n_tile_x * n_tile_y }}
                    </div>

                    <div
                        class="scan-grid"
                        :style="{ 'grid-template-columns': 'repeat(' + n_tile_x + ', 1fr)' }"
                    >
                        <div
                            v-for="n_idx in (n_tile_x * n_tile_y)"
                            :key="n_idx"
                            class="scan-grid-cell"
                            :class="{
                                captured: a_b_captured[n_idx - 1],
                                current: (n_idx - 1) === n_idx__cell__current
                            }"
                        ></div>
                    </div>

                    <div class="scan-elapsed">Elapsed: {{ s_elapsed }}</div>
                    <div class="scan-elapsed" v-if="b_focus__before_tile && n_cnt__focus_measure">
                        focus: {{ n_cnt__focus_measure }} measurements on the last tile
                    </div>

                    <button class="btn-scan-stop" @click="f_stop_scan">Stop Scan</button>
                </template>

                <!-- ── Summary (complete) ────────────────── -->
                <template v-if="s_status === 'complete'">
                    <div class="scan-summary">
                        <div class="scan-summary-item">
                            <span class="scan-summary-label">Images captured</span>
                            <span class="scan-summary-value">{{ n_cnt__tile__captured }} / {{ n_tile_x * n_tile_y }}</span>
                        </div>
                        <div class="scan-summary-item">
                            <span class="scan-summary-label">Folder</span>
                            <span class="scan-summary-value scan-summary-path">{{ s_path_folder__scan }}</span>
                        </div>
                        <div class="scan-summary-item">
                            <span class="scan-summary-label">Duration</span>
                            <span class="scan-summary-value">{{ s_elapsed }}</span>
                        </div>
                    </div>
                    <div class="scan-field-row" style="margin-top: 10px;">
                        <button
                            class="btn-small"
                            @click="f_stitch"
                            :disabled="n_cnt__tile__captured < 2 || b_queueing || b_current_job_busy"
                        >Queue stitching</button>
                        <button class="btn-scan-start" @click="f_reset">New Scan</button>
                    </div>
                </template>

            </div>
        </div>
    `,

    data: function() {
        return {
            o_state: o_state,

            // config
            n_step__x: 50,
            n_step__y: 30,
            n_tile_x: 3,
            n_tile_y: 3,

            // auto grid
            a_o_point__grid: [],
            n_overlap__pct: 30,
            a_n_grid__start: null,

            // per-tile focus
            b_focus__before_tile: false,

            n_step__focus: 20,
            n_step__focus_max: 120,
            n_ms__focus_settle: 250,
            n_cnt__focus_measure: 0,

            // stitch config (stitch.py)
            b_stitch__after_scan: true,
            n_score__min: 0.3,
            n_dim__max: 0,
            b_feather: true,
            b_flatfield: true,
            b_matcher__loftr: false,
            // return the motors to their start position once the scan finishes
            b_return__after_scan: true,

            // state machine: 'idle' | 'scanning' | 'complete'
            s_status: 'idle',
            s_status__detail: '',
            b_testing: false,
            b_stop_requested: false,
            a_n_position__start: null,

            // progress
            n_cnt__tile__captured: 0,
            n_idx__cell__current: -1,
            a_b_captured: [],
            n_ts_ms__start: 0,
            s_path_folder__scan: '',

            // elapsed timer
            n_id__elapsed_interval: 0,
            s_elapsed: '0:00',

            a_o_job: [],
            s_error__jobs: '',
            b_queueing: false,
            n_id__jobs_poll: 0,
            b_unmounted: false,

        };
    },

    computed: {
        s_motor__focus_label: function() {
            let n_motor = f_n_motor__axis('z');
            return n_motor === null ? 'No focus motor — configure Z in Setup → motor cards.' : 'Motor ' + (n_motor + 1) + ' (Z axis, set in Setup)';
        },
        n_jobs_pending: function() {
            return this.a_o_job.filter(job => ['queued', 'running'].includes(job.s_status)).length;
        },
        b_current_job_busy: function() {
            return this.a_o_job.some(job => job.s_path_folder === this.s_path_folder__scan && ['queued', 'running'].includes(job.s_status));
        },
        n_step__per_px__x: function() {
            return (o_state.a_n_step__per_px && o_state.a_n_step__per_px[f_n_motor__axis('x')]) || 0;
        },
        n_step__per_px__y: function() {
            return (o_state.a_n_step__per_px && o_state.a_n_step__per_px[f_n_motor__axis('y')]) || 0;
        },
        o_box__grid: function() {
            let a_o_point = this.a_o_point__grid;
            if(a_o_point.length < 2) return null;
            let n_min_x = Infinity, n_min_y = Infinity, n_max_x = -Infinity, n_max_y = -Infinity;
            for(let o_p of a_o_point){
                if(o_p.n_x < n_min_x) n_min_x = o_p.n_x;
                if(o_p.n_x > n_max_x) n_max_x = o_p.n_x;
                if(o_p.n_y < n_min_y) n_min_y = o_p.n_y;
                if(o_p.n_y > n_max_y) n_max_y = o_p.n_y;
            }
            return {
                n_min_x: n_min_x, n_min_y: n_min_y,
                n_max_x: n_max_x, n_max_y: n_max_y,
                n_extent_x: n_max_x - n_min_x,
                n_extent_y: n_max_y - n_min_y,
            };
        },
        s_box__label: function() {
            let o_box = this.o_box__grid;
            if(!o_box) return '';
            return Math.round(o_box.n_extent_x) + ' × ' + Math.round(o_box.n_extent_y) + ' steps';
        },
    },

    mounted: function() {
        let o_self = this;
        o_self.f_load_config();
        o_self.f_poll_jobs();
    },

    methods: {

        // ── Panel ────────────────────────────────────────────────────

        f_close: function() {
            if (this.s_status === 'scanning') return;
            o_state.o_panel_visibility.scan = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },

        // ── Config persistence ───────────────────────────────────────

        f_load_config: function() {
            let o_self = this;
            let o_setting = o_state.a_o_setting.find(function(o) {
                return o.s_key === 'o_config__scan';
            });
            if (o_setting && o_setting.s_value) {
                try {
                    let o_config = JSON.parse(o_setting.s_value);
                    if (o_config.n_step__x) o_self.n_step__x = o_config.n_step__x;
                    if (o_config.n_step__y) o_self.n_step__y = o_config.n_step__y;
                    if (o_config.n_tile_x) o_self.n_tile_x = o_config.n_tile_x;
                    if (o_config.n_tile_y) o_self.n_tile_y = o_config.n_tile_y;
                    if (typeof o_config.n_overlap__pct === 'number') o_self.n_overlap__pct = o_config.n_overlap__pct;
                    if (o_config.n_score__min) o_self.n_score__min = o_config.n_score__min;
                    if (typeof o_config.n_dim__max === 'number') o_self.n_dim__max = o_config.n_dim__max;
                    if (typeof o_config.b_focus__before_tile === 'boolean') o_self.b_focus__before_tile = o_config.b_focus__before_tile;
                    if (o_config.n_step__focus) o_self.n_step__focus = o_config.n_step__focus;
                    if (o_config.n_step__focus_max) o_self.n_step__focus_max = o_config.n_step__focus_max;
                    if (typeof o_config.n_ms__focus_settle === 'number') o_self.n_ms__focus_settle = o_config.n_ms__focus_settle;
                    if (typeof o_config.b_stitch__after_scan === 'boolean') o_self.b_stitch__after_scan = o_config.b_stitch__after_scan;
                    if (typeof o_config.b_feather === 'boolean') o_self.b_feather = o_config.b_feather;
                    if (typeof o_config.b_flatfield === 'boolean') o_self.b_flatfield = o_config.b_flatfield;
                    if (typeof o_config.b_matcher__loftr === 'boolean') o_self.b_matcher__loftr = o_config.b_matcher__loftr;
                    if (typeof o_config.b_return__after_scan === 'boolean') o_self.b_return__after_scan = o_config.b_return__after_scan;
                } catch (e) { /* ignore parse errors */ }
            }
        },

        f_save_config: function() {
            f_save_setting__debounced('o_config__scan', {
                n_step__x: this.n_step__x,
                n_step__y: this.n_step__y,
                n_tile_x: this.n_tile_x,
                n_tile_y: this.n_tile_y,
                n_overlap__pct: this.n_overlap__pct,
                b_focus__before_tile: this.b_focus__before_tile,
                n_step__focus: this.n_step__focus,
                n_step__focus_max: this.n_step__focus_max,
                n_ms__focus_settle: this.n_ms__focus_settle,
                b_stitch__after_scan: this.b_stitch__after_scan,
                n_score__min: this.n_score__min,
                n_dim__max: this.n_dim__max,
                b_feather: this.b_feather,
                b_flatfield: this.b_flatfield,
                b_matcher__loftr: this.b_matcher__loftr,
                b_return__after_scan: this.b_return__after_scan,
            });
        },

        // ── Motor helpers ────────────────────────────────────────────

        f_move_motor_n_step: async function(n_motor, n_step) {
            let o_self = this;
            if (n_step === 0) return;
            if (o_self.b_stop_requested) return;

            let o_promise__move = f_send_esp_move_step(n_motor, n_step, N_RPM__SCAN);
            let o_promise__timeout = new Promise(function(resolve) {
                setTimeout(function() { resolve('timeout'); }, N_MS__MOVE_TIMEOUT);
            });

            let v_result = await Promise.race([o_promise__move, o_promise__timeout]);
            if (v_result === 'timeout') {
                console.warn('Move timeout: motor', n_motor);
                f_send_esp_stop(n_motor);
            }
        },

        f_delay: function(n_ms) {
            return new Promise(function(resolve) { setTimeout(resolve, n_ms); });
        },

        // move every motor back to the position it held when the scan started
        f_return_to_start: async function() {
            let o_self = this;
            let a_n_start = o_self.a_n_position__start;
            if(!a_n_start) return;
            for(let n_motor = 0; n_motor < 3; n_motor++){
                let n_target = a_n_start[n_motor];
                if(typeof n_target !== 'number') continue;
                let o_motor = o_state.a_o_motor[n_motor];
                let n_current = o_motor ? o_motor.n_position : 0;
                let n_delta = Math.round(n_target - n_current);
                if(n_delta === 0) continue;
                await o_self.f_move_motor_n_step(n_motor, n_delta);
            }
        },

        // ── Focus before a tile ──────────────────────────────────────

        f_o_focus: function() {
            let o_self = this;
            let n_motor = f_n_motor__axis('z');
            if(!o_self._o_cache__focus) o_self._o_cache__focus = {};

            return f_o_focus__fast({
                f_move: async function(n_step) {
                    await o_self.f_move_motor_n_step(n_motor, n_step);
                },
                f_delay: function(n_ms) { return o_self.f_delay(n_ms); },
                f_n_score: async function() {
                    return f_n_score__video(
                        document.getElementById('webcamVideo'),
                        {
                            n_scl_x__measure: N_SCL_X__FOCUS_MEASURE,
                            n_pct__roi: N_PCT__FOCUS_ROI,
                            s_metric: 'tenengrad',
                        },
                        o_self._o_cache__focus
                    );
                },
                f_b_abort: function() { return o_self.b_stop_requested; },
            }, {
                n_step: o_self.n_step__focus,
                n_step__max: o_self.n_step__focus_max,
                n_ms__settle: o_self.n_ms__focus_settle,
            });
        },


        // ── Test distance ────────────────────────────────────────────

        f_test_distance: async function(s_axis, n_sign) {
            let o_self = this;
            o_self.b_testing = true;
            o_self.b_stop_requested = false;
            try {
                let n_motor = f_n_motor__axis(s_axis);
                let n_step = (s_axis === 'x') ? o_self.n_step__x : o_self.n_step__y;
                await o_self.f_move_motor_n_step(n_motor, n_step * n_sign);
            } catch (e) {
                console.error('Test distance error:', e);
            }
            o_self.b_testing = false;
        },

        f_test_square: async function() {
            let o_self = this;
            o_self.b_testing = true;
            o_self.b_stop_requested = false;
            try {
                let n_total_x = (o_self.n_tile_x - 1) * o_self.n_step__x;
                let n_total_y = (o_self.n_tile_y - 1) * o_self.n_step__y;

                // move along right edge
                if (n_total_x > 0) await o_self.f_move_motor_n_step(f_n_motor__axis('x'), n_total_x);
                // move along bottom edge
                if (n_total_y > 0) await o_self.f_move_motor_n_step(f_n_motor__axis('y'), n_total_y);
                // move back along left edge
                if (n_total_x > 0) await o_self.f_move_motor_n_step(f_n_motor__axis('x'), -n_total_x);
                // move back to start
                if (n_total_y > 0) await o_self.f_move_motor_n_step(f_n_motor__axis('y'), -n_total_y);
            } catch (e) {
                console.error('Test square error:', e);
            }
            o_self.b_testing = false;
        },

        // drive only one axis along its side of the boundary box and back
        f_test_axis: async function(s_axis) {
            let o_self = this;
            o_self.b_testing = true;
            o_self.b_stop_requested = false;
            try {
                let n_motor = f_n_motor__axis(s_axis);
                let n_total = (s_axis === 'x')
                    ? (o_self.n_tile_x - 1) * o_self.n_step__x
                    : (o_self.n_tile_y - 1) * o_self.n_step__y;
                if (n_total > 0) await o_self.f_move_motor_n_step(n_motor, n_total);
                if (n_total > 0) await o_self.f_move_motor_n_step(n_motor, -n_total);
            } catch (e) {
                console.error('Test axis error:', e);
            }
            o_self.b_testing = false;
        },

        // ── Auto grid (marked points → bounding box + overlap) ────────

        f_add_point: function() {
            this.a_o_point__grid.push({
                n_x: o_state.a_o_motor[f_n_motor__axis('x')] ? o_state.a_o_motor[f_n_motor__axis('x')].n_position : 0,
                n_y: o_state.a_o_motor[f_n_motor__axis('y')] ? o_state.a_o_motor[f_n_motor__axis('y')].n_position : 0,
            });
        },
        f_remove_point: function() {
            this.a_o_point__grid.pop();
        },
        f_clear_points: function() {
            this.a_o_point__grid = [];
            this.a_n_grid__start = null;
        },
        f_auto_grid: function() {
            let o_self = this;
            let n_per_px_x = o_self.n_step__per_px__x;
            let n_per_px_y = o_self.n_step__per_px__y;
            if(!n_per_px_x || !n_per_px_y) return;
            let o_box = o_self.o_box__grid;
            if(!o_box) return;
            let el_video = document.getElementById('webcamVideo');
            if(!el_video || !el_video.videoWidth) return;

            let n_overlap = Math.max(0, Math.min(0.9, (o_self.n_overlap__pct || 0) / 100));
            let n_fov_steps_x = el_video.videoWidth * n_per_px_x;
            let n_fov_steps_y = el_video.videoHeight * n_per_px_y;
            let n_step_x = n_fov_steps_x * (1 - n_overlap);
            let n_step_y = n_fov_steps_y * (1 - n_overlap);
            let n_extent_x = o_box.n_extent_x;
            let n_extent_y = o_box.n_extent_y;
            let n_tile_x = n_extent_x > 0 ? Math.ceil((n_extent_x - n_fov_steps_x) / n_step_x) + 1 : 1;
            let n_tile_y = n_extent_y > 0 ? Math.ceil((n_extent_y - n_fov_steps_y) / n_step_y) + 1 : 1;

            o_self.n_step__x = Math.max(1, Math.round(n_step_x));
            o_self.n_step__y = Math.max(1, Math.round(n_step_y));
            o_self.n_tile_x = Math.max(1, n_tile_x);
            o_self.n_tile_y = Math.max(1, n_tile_y);
            // scan from the min corner of the bounding box
            o_self.a_n_grid__start = [o_box.n_min_x, o_box.n_min_y];
            o_self.f_save_config();
        },

        // ── Scan path builder ────────────────────────────────────────

        f_a_o_tile__path: function() {
            let o_self = this;
            let a_o_tile = [];
            for (let n_row = 0; n_row < o_self.n_tile_y; n_row++) {
                let b_reverse = n_row % 2 === 1;
                for (let n_col = 0; n_col < o_self.n_tile_x; n_col++) {
                    let n_col__actual = b_reverse ? (o_self.n_tile_x - 1 - n_col) : n_col;
                    a_o_tile.push({ n_row: n_row, n_col: n_col__actual });
                }
            }
            return a_o_tile;
        },

        // ── Elapsed timer ────────────────────────────────────────────

        f_start_elapsed_timer: function() {
            let o_self = this;
            o_self.n_ts_ms__start = Date.now();
            o_self.s_elapsed = '0:00';
            o_self.n_id__elapsed_interval = setInterval(function() {
                let n_sec__total = Math.floor((Date.now() - o_self.n_ts_ms__start) / 1000);
                let n_min = Math.floor(n_sec__total / 60);
                let n_sec = n_sec__total % 60;
                o_self.s_elapsed = n_min + ':' + String(n_sec).padStart(2, '0');
            }, 1000);
        },

        f_stop_elapsed_timer: function() {
            clearInterval(this.n_id__elapsed_interval);
        },

        // ── Main scan execution ──────────────────────────────────────

        f_start_scan: async function() {
            let o_self = this;

            if (o_state.b_scanning || o_self.b_testing) return;
            o_state.b_scanning = true;
            o_self.s_status = 'scanning';
            o_self.s_status__detail = 'Creating scan...';
            try {
                // create scan folder on server
                let o_resp = await f_send_wsmsg_with_response(
                    f_o_wsmsg('scan_create_folder', { n_id__slide: o_state.n_id__slide__current })
                );
                if (!o_resp.v_result || !o_resp.v_result.s_path_folder) {
                    throw new Error(o_resp.error || 'Failed to create scan folder');
                }
                o_self.s_path_folder__scan = o_resp.v_result.s_path_folder;

                // init scan state
                o_state.b_scanning = true;
                o_self.s_status = 'scanning';
                o_self.b_stop_requested = false;
                o_self.n_cnt__tile__captured = 0;
                o_self.n_idx__cell__current = -1;
                o_self.a_b_captured = new Array(o_self.n_tile_x * o_self.n_tile_y).fill(false);
                o_self.f_start_elapsed_timer();

                // remember where the stage is so we can drive it back afterwards
                o_self.a_n_position__start = [
                    o_state.a_o_motor[0] ? o_state.a_o_motor[0].n_position : 0,
                    o_state.a_o_motor[1] ? o_state.a_o_motor[1].n_position : 0,
                    o_state.a_o_motor[2] ? o_state.a_o_motor[2].n_position : 0,
                ];

                // move to the computed grid start corner before the first tile
                if(o_self.a_n_grid__start){
                    let n_motor0 = o_state.a_o_motor[f_n_motor__axis('x')] ? o_state.a_o_motor[f_n_motor__axis('x')].n_position : 0;
                    let n_motor1 = o_state.a_o_motor[f_n_motor__axis('y')] ? o_state.a_o_motor[f_n_motor__axis('y')].n_position : 0;
                    let n_dx = o_self.a_n_grid__start[0] - n_motor0;
                    let n_dy = o_self.a_n_grid__start[1] - n_motor1;
                    if(n_dx !== 0){
                        o_self.s_status__detail = 'Moving to start X...';
                        await o_self.f_move_motor_n_step(f_n_motor__axis('x'), n_dx);
                    }
                    if(n_dy !== 0){
                        o_self.s_status__detail = 'Moving to start Y...';
                        await o_self.f_move_motor_n_step(f_n_motor__axis('y'), n_dy);
                    }
                }

                let a_o_tile = o_self.f_a_o_tile__path();

                for (let n_idx = 0; n_idx < a_o_tile.length; n_idx++) {
                    if (o_self.b_stop_requested) break;
                    if (!o_state.b_connected__esp) {
                        o_self.b_stop_requested = true;
                        break;
                    }

                    let o_tile = a_o_tile[n_idx];
                    let n_idx__cell = o_tile.n_row * o_self.n_tile_x + o_tile.n_col;
                    o_self.n_idx__cell__current = n_idx__cell;

                    // move to tile position (skip for first tile)
                    if (n_idx > 0) {
                        let o_tile__prev = a_o_tile[n_idx - 1];
                        let n_delta_col = o_tile.n_col - o_tile__prev.n_col;
                        let n_delta_row = o_tile.n_row - o_tile__prev.n_row;

                        if (n_delta_col !== 0) {
                            o_self.s_status__detail = 'Moving X...';
                            await o_self.f_move_motor_n_step(f_n_motor__axis('x'), n_delta_col * o_self.n_step__x);
                            if (o_self.b_stop_requested) break;
                        }

                        if (n_delta_row !== 0) {
                            o_self.s_status__detail = 'Moving Y...';
                            await o_self.f_move_motor_n_step(f_n_motor__axis('y'), n_delta_row * o_self.n_step__y);
                            if (o_self.b_stop_requested) break;
                        }
                    }

                    // wait for vibration to settle
                    o_self.s_status__detail = 'Settling...';
                    await o_self.f_delay(N_MS__SETTLE);
                    if (o_self.b_stop_requested) break;

                    // sharpen this tile before it is taken: a slide is never
                    // perfectly level, so the focus drifts across the grid
                    if (o_self.b_focus__before_tile && f_n_motor__axis('z') !== null) {
                        o_self.s_status__detail = 'Focusing...';
                        try {
                            let o_focus = await o_self.f_o_focus();
                            o_self.n_cnt__focus_measure = o_focus.n_cnt__measure;
                        } catch (e) {
                            console.error('focus before tile failed:', e);
                        }
                        if (o_self.b_stop_requested) break;
                    }

                    // capture and save image
                    let s_filename = 'tile_r'
                        + String(o_tile.n_row).padStart(2, '0')
                        + '_c'
                        + String(o_tile.n_col).padStart(2, '0')
                        + '.png';
                    o_self.s_status__detail = 'Capturing ' + s_filename;

                    try {
                        let o_cap = await f_o_capture__frame();
                        await f_save_image(o_cap.o_blob, o_self.s_path_folder__scan, s_filename);
                        o_self.a_b_captured[n_idx__cell] = true;
                        o_self.n_cnt__tile__captured++;
                        // Resize the captured blob so the copy is the exact same frame.
                        let o_bitmap = await createImageBitmap(o_cap.o_blob);
                        try {
                            let el_small = document.createElement('canvas');
                            el_small.width = Math.min(256, o_bitmap.width);
                            el_small.height = Math.max(1, Math.round(o_bitmap.height * el_small.width / o_bitmap.width));
                            let o_ctx = el_small.getContext('2d');
                            o_ctx.imageSmoothingQuality = 'high';
                            o_ctx.drawImage(o_bitmap, 0, 0, el_small.width, el_small.height);
                            let o_small = await new Promise((resolve, reject) => {
                                el_small.toBlob(blob => blob ? resolve(blob) : reject(new Error('failed to downscale tile')), 'image/png');
                            });
                            await f_save_image(o_small, o_self.s_path_folder__scan + '/dowscaled', s_filename);
                        } finally {
                            o_bitmap.close();
                        }
                    } catch (e) {
                        console.error('Capture error at tile r' + o_tile.n_row + ' c' + o_tile.n_col + ':', e);
                    }
                }

                // scan finished
                o_self.f_stop_elapsed_timer();
                o_self.n_idx__cell__current = -1;
                o_self.s_status__detail = '';

                console.log(
                    'Scan ' + (o_self.b_stop_requested ? 'stopped' : 'complete')
                    + ': ' + o_self.n_cnt__tile__captured + '/' + (o_self.n_tile_x * o_self.n_tile_y)
                    + ' tiles captured in ' + o_self.s_elapsed
                );

                // drive the stage back to its original position (default on)
                if(!o_self.b_stop_requested && o_self.b_return__after_scan && o_self.a_n_position__start && o_state.b_connected__esp){
                    o_self.s_status__detail = 'Returning to start...';
                    await o_self.f_return_to_start();
                    o_self.s_status__detail = '';
                }

                // Snapshot the completed capture before the operator resets the form.
                const folder = o_self.s_path_folder__scan;
                const count = o_self.n_cnt__tile__captured;
                try {
                    await o_self.f_job_request('scan_finish', { s_path_folder: folder, n_tiles: count });
                    if (o_self.b_stitch__after_scan && count >= 2) await o_self.f_stitch();
                    else await o_self.f_refresh_jobs();
                } catch (error) {
                    o_self.s_error__jobs = error.message;
                }
            } catch (error) {
                o_self.s_error__jobs = error.message;
                if (o_self.s_path_folder__scan) {
                    try { await o_self.f_job_request('scan_finish', { s_path_folder: o_self.s_path_folder__scan }); }
                    catch { /* connection recovery can recover the saved tiles */ }
                }
            } finally {
                o_self.f_stop_elapsed_timer();
                o_state.b_scanning = false;
                o_self.s_status = 'complete';
            }
        },

        // Jobs are keyed by scan folder on the server. No late result writes
        // into the active scan's state, even after New Scan resets that state.
        f_job_request: async function(type, data = {}) {
            const response = await f_send_wsmsg_with_response(f_o_wsmsg(type, data), 15000);
            if (response.error || response.v_result?.b_success === false) {
                throw new Error(response.error || response.v_result.s_error || 'Scan request failed');
            }
            return response.v_result;
        },
        f_refresh_jobs: async function() {
            if (!o_state.b_connected__server) return;
            const jobs = await this.f_job_request('scan_jobs_list');
            if (!this.b_unmounted) this.a_o_job = jobs;
        },
        f_poll_jobs: async function() {
            try { await this.f_refresh_jobs(); }
            catch (error) { this.s_error__jobs = error.message; }
            if (!this.b_unmounted) this.n_id__jobs_poll = setTimeout(() => this.f_poll_jobs(), 2000);
        },
        f_stitch: async function(job) {
            if (this.b_queueing) return;
            const folder = job?.s_path_folder || this.s_path_folder__scan;
            if (!folder) return;
            const options = job?.o_option && Object.keys(job.o_option).length ? job.o_option : {
                n_score__min: this.n_score__min,
                n_dim__max: this.n_dim__max,
                s_blend: this.b_feather ? 'feather' : 'none',
                b_no_flatfield: !this.b_flatfield,
                b_matcher__loftr: this.b_matcher__loftr,
            };
            this.b_queueing = true;
            this.s_error__jobs = '';
            try {
                await this.f_job_request('stitch_run', { ...options, s_path_folder: folder });
                await this.f_refresh_jobs();
            } catch (error) { this.s_error__jobs = error.message; }
            finally { this.b_queueing = false; }
        },

        f_stop_scan: function() {
            this.b_stop_requested = true;
            f_send_esp_stop_all();
        },

        f_reset: function() {
            this.s_status = 'idle';
            this.b_stop_requested = false;
            this.a_n_position__start = null;
            this.n_cnt__tile__captured = 0;
            this.n_idx__cell__current = -1;
            this.a_b_captured = [];
            this.s_path_folder__scan = '';
            this.s_elapsed = '0:00';

        },
    },

    beforeUnmount: function() {
        if (this.s_status === 'scanning') {
            this.f_stop_scan();
        }
        this.f_stop_elapsed_timer();
        this.b_unmounted = true;
        clearTimeout(this.n_id__jobs_poll);
    },
};

export { o_component__scan };
