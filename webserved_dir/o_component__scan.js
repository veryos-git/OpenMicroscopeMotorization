import { f_o_camera_geometry } from './camera_frame.module.js';
import { f_o_free_scan_plan } from './free_scan.module.js';
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
                <button class="panel-close" @click="f_close" :disabled="s_status === 'scanning' || b_testing">&times;</button>
            </div>
            <div class="panel-body">
                <div v-if="s_error__jobs" class="scan-stitch-error">{{ s_error__jobs }}</div>
                <details class="scan-jobs" :open="a_o_job.some(job => ['queued', 'running'].includes(job.s_status) || (job.s_status === 'capturing' && job.o_option?.b_live_scan))">
                    <summary>Scans · {{ a_o_job.length }} <span v-if="n_jobs_pending">· {{ n_jobs_pending }} pending</span></summary>
                    <div class="scan-hint">Stitching runs in the background. You can capture the next scan while jobs are queued or running.</div>
                    <article v-for="job in a_o_job" :key="job.s_id" class="scan-job">
                        <div class="scan-job-title"><strong>{{ job.s_name }}</strong><span>{{ job.s_status }}</span></div>
                        <div class="scan-hint">{{ job.n_tiles }} tiles</div>
                        <div class="scan-field-row">
                            <button class="btn-small" @click="f_open_folder(job)">Open folder</button>
                            <a v-if="job.s_status === 'complete' && job.o_result?.s_path_original_colors" class="btn-small"
                                :href="'/api/file?path=' + encodeURIComponent(job.o_result.s_path_original_colors) + '&v=' + job.n_finished" target="_blank" rel="noopener">Original colors PNG</a>
                            <a v-if="job.s_status === 'complete' && job.o_result?.s_path_original_colors_jpeg" class="btn-small"
                                :href="'/api/file?path=' + encodeURIComponent(job.o_result.s_path_original_colors_jpeg) + '&v=' + job.n_finished" target="_blank" rel="noopener">Original colors JPEG</a>
                            <a v-if="job.s_status === 'complete' && job.o_result?.s_path_flatfield" class="btn-small"
                                :href="'/api/file?path=' + encodeURIComponent(job.o_result.s_path_flatfield) + '&v=' + job.n_finished" target="_blank" rel="noopener">Flat-field only PNG</a>
                            <a v-if="job.s_status === 'complete' && job.o_result?.s_path_flatfield_jpeg" class="btn-small"
                                :href="'/api/file?path=' + encodeURIComponent(job.o_result.s_path_flatfield_jpeg) + '&v=' + job.n_finished" target="_blank" rel="noopener">Flat-field only JPEG</a>
                            <a v-if="job.s_status === 'complete' && job.o_result?.s_path_exposure" class="btn-small"
                                :href="'/api/file?path=' + encodeURIComponent(job.o_result.s_path_exposure) + '&v=' + job.n_finished" target="_blank" rel="noopener">Exposure only PNG</a>
                            <a v-if="job.s_status === 'complete' && job.o_result?.s_path_exposure_jpeg" class="btn-small"
                                :href="'/api/file?path=' + encodeURIComponent(job.o_result.s_path_exposure_jpeg) + '&v=' + job.n_finished" target="_blank" rel="noopener">Exposure only JPEG</a>
                            <a v-if="job.s_status === 'complete' && job.o_result?.s_path_output" class="btn-small"
                                :href="'/api/file?path=' + encodeURIComponent(job.o_result.s_path_output) + '&v=' + job.n_finished" target="_blank" rel="noopener">{{ job.o_result.s_path_flatfield ? 'Both corrections PNG' : job.o_result.s_path_original_colors ? 'Adjusted PNG' : 'Open mosaic' }}</a>
                            <a v-if="job.s_status === 'complete' && job.o_result?.s_path_jpeg" class="btn-small"
                                :href="'/api/file?path=' + encodeURIComponent(job.o_result.s_path_jpeg) + '&v=' + job.n_finished" target="_blank" rel="noopener">{{ job.o_result.s_path_flatfield ? 'Both corrections JPEG' : job.o_result.s_path_original_colors ? 'Adjusted JPEG' : 'Open JPEG' }}</a>
                            <button class="btn-small" v-if="!['capturing', 'queued', 'running'].includes(job.s_status)"
                                :disabled="job.n_tiles < 2 || b_queueing" @click="f_stitch(job)">{{ job.s_status === 'ready' ? 'Stitch' : 'Stitch again' }}</button>
                        </div>
                        <div v-if="job.s_error" class="scan-stitch-error">{{ job.s_error }}</div>
                        <a v-if="job.s_status === 'complete' && job.o_result?.s_path_output"
                            :href="'/api/file?path=' + encodeURIComponent(job.o_result.s_path_original_colors || job.o_result.s_path_output)" target="_blank" rel="noopener">
                            <img class="scan-stitch-preview" loading="lazy" :alt="job.o_result.s_path_original_colors ? 'Stitched scan — original colors' : 'Stitched scan'"
                                :src="'/api/file?path=' + encodeURIComponent(job.o_result.s_path_original_colors_preview || job.o_result.s_path_original_colors_jpeg || job.o_result.s_path_original_colors || job.o_result.s_path_preview || job.o_result.s_path_output) + '&v=' + job.n_finished" />
                        </a>
                        <div class="scan-hint" v-if="job.s_status === 'running'">{{ job.a_s_line.at(-1) }}</div>
                        <div v-if="job.o_option?.b_live_scan && job.s_status !== 'complete'">
                            <div class="scan-hint">Live preview — provisional alignment; final colors and placement may change.</div>
                            <img v-if="job.o_live?.s_path_preview" class="scan-stitch-preview" alt="Provisional live scan mosaic"
                                :src="'/api/file?path=' + encodeURIComponent(job.o_live.s_path_preview) + '&v=' + job.o_live.n_revision" />
                            <div v-else class="scan-hint">Waiting for live alignment…</div>
                            <div v-if="job.o_live?.s_error" class="scan-hint">{{ job.o_live.s_error }} Capture can continue; final stitching will retry.</div>
                        </div>
                        <details v-if="job.a_s_line.length"><summary>Stitch log</summary>
                            <div class="scan-stitch-log"><div v-for="(line, i) in job.a_s_line" :key="i">{{ line }}</div></div>
                        </details>
                    </article>
                </details>


                <!-- ── Config (idle) ─────────────────────── -->
                <template v-if="s_status === 'idle'">
                    <fieldset class="scan-config" :disabled="b_testing || o_state.b_scanning">

                    <div class="scan-field">
                        <label for="scan-area-mode">Scan area</label>
                        <select id="scan-area-mode" v-model="s_mode__area" @change="f_save_config">
                            <option value="grid">Rectangular grid</option>
                            <option value="free">Free outline</option>
                        </select>
                    </div>
                    <div v-if="s_mode__area === 'free'" class="scan-section scan-free">
                        <div class="scan-hint">Move around the sample boundary in order. Focus manually at each point, then add it. The last edge closes automatically; inward bends are supported.</div>
                        <div class="scan-field-row">
                            <button class="btn-small" @click="f_add_free_point" :disabled="!b_free_point_ready || a_o_point__free.length >= 128" title="Save the current X, Y and focused Z position">Add focused point</button>
                            <button class="btn-small" @click="a_o_point__free.pop(); s_error__free = ''" :disabled="!a_o_point__free.length">Undo point</button>
                            <button class="btn-small" @click="f_clear_free_points" :disabled="!a_o_point__free.length">Clear outline</button>
                        </div>
                        <div class="scan-field">
                            <label for="scan-free-overlap">Overlap (%)</label>
                            <input id="scan-free-overlap" type="number" min="0" max="90" step="5" v-model.number="n_overlap__pct" @change="f_save_config" />
                        </div>
                        <svg v-if="a_o_point__free.length" class="scan-free-preview" viewBox="0 0 300 200" role="img" aria-label="Free scan outline and planned capture path">
                            <polygon :points="o_free_preview.s_outline" class="scan-free-outline" />
                            <rect v-for="(tile, i) in o_free_preview.a_tile" :key="i" :x="tile.x - tile.w / 2" :y="tile.y - tile.h / 2" :width="tile.w" :height="tile.h" class="scan-free-tile" />
                            <polyline :points="o_free_preview.s_route" class="scan-free-route" />
                            <g v-for="(point, i) in o_free_preview.a_point" :key="i"><circle :cx="point.x" :cy="point.y" r="3" /><text :x="point.x + 4" :y="point.y - 5">{{ i + 1 }}</text></g>
                        </svg>
                        <div class="scan-total" v-if="o_free_plan_result.o_plan">{{ o_free_plan_result.o_plan.a_o_tile.length }} images · focus interpolated from {{ a_o_point__free.length }} points</div>
                        <div :class="a_o_point__free.length >= 3 ? 'scan-stitch-error' : 'scan-hint'" v-if="!o_free_plan_result.o_plan" role="status">{{ o_free_plan_result.s_error }}</div>
                        <button v-if="!b_free_calibrated" class="btn-small" @click="o_state.o_panel_visibility.setup = true">Open Setup for X/Y calibration</button>
                        <div class="scan-stitch-error" v-if="s_error__free">{{ s_error__free }}</div>
                        <details v-if="a_o_point__free.length" class="scan-free-points">
                            <summary>Focused points · {{ a_o_point__free.length }}</summary>
                            <div v-for="(point, i) in a_o_point__free" :key="i" class="scan-focus-corner">
                                <span>{{ i + 1 }} · X {{ point.n_x }} / Y {{ point.n_y }} / Z {{ point.n_z }}</span>
                                <div class="scan-field-row">
                                    <button class="btn-small" @click="f_go_free_point(point)" :disabled="!b_free_point_ready" :title="'Return to saved XYZ position ' + (i + 1)">Go to point {{ i + 1 }}</button>
                                    <button class="btn-small" @click="f_update_free_focus(point)" :disabled="!b_free_point_ready || !f_b_at_free_point(point)" title="Replace Z after refocusing at this XY position">Update focus</button>
                                </div>
                            </div>
                        </details>
                        <div class="scan-hint">{{ s_motor__focus_label }}</div>
                        <div class="scan-field">
                            <label for="scan-free-settle">Focus settle (ms)</label>
                            <input id="scan-free-settle" type="number" min="0" step="50" v-model.number="n_ms__focus_settle" @change="f_save_config" />
                        </div>
                        <div class="scan-hint">Tiles cover the outline with a small border. Focus is interpolated without autofocus. Points are cleared for a new slide, motor reassignment or controller disconnect.</div>
                    </div>

                    <template v-if="s_mode__area === 'grid'">
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
                        <div class="scan-field">
                            <label for="scan-focus-mode">Focus method</label>
                            <select id="scan-focus-mode" v-model="s_mode__focus" @change="f_save_config">
                                <option value="fixed">Keep current focus</option>
                                <option value="corners" :disabled="!b_focus_motor_available">Interpolate corner focus (no autofocus)</option>
                                <option value="autofocus" :disabled="!b_focus_motor_available">Autofocus before every image</option>
                            </select>
                        </div>
                        <div class="scan-hint" v-if="b_focus__before_tile">
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
                        <template v-if="s_mode__focus === 'corners'">
                            <div class="scan-hint">
                                Set the grid size and movement distances first, then set the scan start.
                                Visit each focus point, adjust focus with the Z controls, and save it.
                                Focus points are padded inward so you can focus on the sample inside the scan area.
                            </div>
                            <div class="scan-field">
                                <label for="scan-focus-padding">Focus point padding (%)</label>
                                <input id="scan-focus-padding" type="number" min="0" max="49" step="1"
                                    v-model.number="n_pct__focus_padding" @change="f_save_config" />
                            </div>
                            <div class="scan-hint">Padding is a percentage of the scan width and height from each edge. Capture still covers the full grid; focus extends to its edges.</div>
                            <div v-if="!b_focus_padding_valid" class="scan-stitch-error">Enter a padding from 0 to 49%.</div>
                            <button class="btn-small" @click="f_set_focus_start" :disabled="!b_corner_controls_ready">Set scan start here</button>
                            <div class="scan-hint" v-if="a_n_grid__start">Scan start: X {{ a_n_grid__start[0] }}, Y {{ a_n_grid__start[1] }} steps</div>
                            <div class="scan-hint" v-else>Set the scan start, or use Compute grid to choose it from marked bounds.</div>
                            <div v-for="corner in a_o_focus_corner" :key="corner.n_index" class="scan-focus-corner">
                                <strong>Focus point {{ corner.n_index + 1 }} · {{ corner.s_label }}</strong>
                                <div class="scan-hint">{{ a_n_focus__corner[corner.n_index] === null ? 'Focus not saved' : 'Z ' + a_n_focus__corner[corner.n_index] + ' steps' }}</div>
                                <div class="scan-field-row">
                                    <button class="btn-small" @click="f_go_focus_corner(corner)" :disabled="!a_n_grid__start || !b_corner_controls_ready">Go to point {{ corner.n_index + 1 }}</button>
                                    <button class="btn-small" @click="f_save_focus_corner(corner)" :disabled="!b_corner_controls_ready || !f_b_at_focus_corner(corner)">Save focus</button>
                                </div>
                            </div>
                            <div class="scan-hint">{{ b_corner_focus_ready ? 'Corner focus ready. You can start from any position.' : 'Save focus at every distinct point before starting.' }}</div>
                            <div class="scan-hint">Focus values are cleared when the grid or padding changes, the controller disconnects, or you select New Scan.</div>
                        </template>
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
                        <div class="scan-field" v-if="s_mode__focus !== 'fixed'">
                            <label>Focus settle (ms)</label>
                            <input type="number" min="0" step="50" v-model.number="n_ms__focus_settle" @change="f_save_config">
                        </div>
                    </div>

                    </template>
                    <div class="scan-section">
                        <div class="scan-label">Stitching</div>
                        <div class="scan-field">
                            <label for="scan-registration-width">Alignment image width (px)</label>
                            <select id="scan-registration-width" v-model.number="n_registration__max_width" @change="f_save_config">
                                <option :value="1024">1024</option>
                                <option :value="512">512</option>
                                <option :value="256">256</option>
                                <option :value="128">128</option>
                            </select>
                        </div>
                        <div class="scan-hint">
                            Alignment uses copies at most {{ n_registration__max_width }} pixels wide, saved in
                            dowscaled/. The original images are combined using those
                            positions to preserve full-resolution detail.
                            Larger copies retain more detail for alignment; smaller copies process faster.
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
                        <div class="scan-hint">Every stitch saves four versions as PNG and JPEG: original colors, flat-field only, exposure only, and both corrections.</div>
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

                    <div v-if="s_scan_block_reason" id="scan-start-reason" class="scan-stitch-error" role="status">{{ s_scan_block_reason }}</div>
                    <button
                        class="btn-scan-start"
                        @click="f_start_scan(false)"
                        :disabled="!b_scan_ready"
                        :title="s_scan_block_reason" :aria-describedby="s_scan_block_reason ? 'scan-start-reason' : null"
                    >Start classical scan</button>
                    <button class="btn-scan-start" @click="f_start_scan(true)"
                        :disabled="!b_scan_ready"
                        :title="s_scan_block_reason" :aria-describedby="s_scan_block_reason ? 'scan-start-reason' : null"
                    >Start live scan</button>
                    <div class="scan-hint">Live scan aligns tiles during capture and shows a provisional mosaic. Preview updates may lag behind capture.</div>
                    </fieldset>
                    <div v-if="b_testing" class="scan-progress-text">{{ s_status__detail || 'Moving stage…' }}</div>
                    <button v-if="b_testing" class="btn-scan-stop" @click="f_stop_scan">Stop movement</button>
                </template>

                <!-- ── Progress (scanning) ───────────────── -->
                <template v-if="s_status === 'scanning'">
                    <div class="scan-progress-text">{{ s_status__detail }}</div>

                    <div class="scan-progress-count">
                        Capturing {{ Math.min(n_cnt__tile__captured + 1, n_cnt__tile__planned) }} / {{ n_cnt__tile__planned }}
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
                                skipped: s_mode__area === 'free' && !a_b_planned[n_idx - 1],
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
                            <span class="scan-summary-value">{{ n_cnt__tile__captured }} / {{ n_cnt__tile__planned }}</span>
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

            // Outline points are session-only because stage coordinates can reset.
            s_mode__area: 'grid',
            a_o_point__free: [],
            s_error__free: '',
            o_plan__capture: null,
            n_cnt__tile__planned: 0,
            a_b_planned: [],

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
            s_mode__focus: 'fixed',
            n_pct__focus_padding: 10,
            a_n_focus__corner: [null, null, null, null],

            n_step__focus: 20,
            n_step__focus_max: 120,
            n_ms__focus_settle: 250,
            n_cnt__focus_measure: 0,

            // stitch config (stitch.py)
            b_live_scan: false,
            n_score__min: 0.3,
            n_dim__max: 0,
            n_registration__max_width: 512,
            b_feather: true,
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
        b_focus__before_tile: function() { return this.s_mode__area === 'grid' && this.s_mode__focus === 'autofocus'; },
        b_focus_motor_available: function() { return f_n_motor__axis('z') !== null; },
        b_grid_valid: function() {
            return [this.n_step__x, this.n_step__y, this.n_tile_x, this.n_tile_y]
                .every(n => Number.isSafeInteger(n) && n > 0);
        },
        b_stage_ready: function() {
            return !this.s_stage_block_reason;
        },
        s_stage_block_reason() {
            if (!o_state.b_connected__esp) return 'Connect the motor controller in Setup.';
            if (o_state.b_flashing) return 'Wait for firmware flashing to finish.';
            if (o_state.b_training_busy) return 'Wait for training to release the stage.';
            if (this.b_testing || o_state.b_scanning) return 'Wait for the current movement or calibration to finish.';
            if (['x', 'y'].some(axis => f_n_motor__axis(axis) === null)) return 'Assign X and Y motors in Setup.';
            if (o_state.a_o_motor.some(motor => motor.b_running)) return 'Stop manual movement before starting the scan.';
            return '';
        },
        b_corner_controls_ready: function() {
            return this.b_stage_ready && this.b_grid_valid && this.b_focus_motor_available && this.b_focus_padding_valid;
        },
        b_corner_focus_ready: function() {
            return this.b_focus_padding_valid && this.a_n_grid__start !== null && this.a_n_focus__corner.every(Number.isFinite);
        },
        b_scan_ready: function() {
            return !this.s_scan_block_reason;
        },
        s_scan_block_reason() {
            if (this.s_stage_block_reason) return this.s_stage_block_reason;
            if (this.s_mode__area === 'free') return this.s_free_point_block_reason || this.o_free_plan_result.s_error;
            if (!this.b_grid_valid) return 'Enter positive whole numbers for tile counts and X/Y steps.';
            if (this.s_mode__focus !== 'fixed' && !this.b_focus_motor_available) return this.s_motor__focus_label;
            if (this.s_mode__focus === 'corners') {
                if (!this.b_focus_padding_valid) return 'Focus padding must be between 0 and 49%.';
                if (!this.a_n_grid__start) return 'Set the scan start before saving corner focus.';
                if (!this.b_corner_focus_ready) return 'Save focus at every distinct corner before starting.';
            }
            return '';
        },
        b_focus_padding_valid: function() {
            return Number.isFinite(this.n_pct__focus_padding) && this.n_pct__focus_padding >= 0 && this.n_pct__focus_padding <= 49;
        },
        o_focus__bounds: function() {
            // Work in motor steps so interpolation uses the positions actually visited.
            const bounds = (tiles, steps) => {
                if (!this.b_grid_valid || !this.b_focus_padding_valid) return [0, 0];
                const span = (tiles - 1) * steps;
                // Rounding must not merge distinct points on a very small grid.
                const padding = Math.min(Math.round(span * this.n_pct__focus_padding / 100), Math.max(0, Math.floor((span - 1) / 2)));
                return [padding, span - padding];
            };
            const [x0, x1] = bounds(this.n_tile_x, this.n_step__x);
            const [y0, y1] = bounds(this.n_tile_y, this.n_step__y);
            return { x0, x1, y0, y1 };
        },
        a_o_focus_corner_all: function() {
            const { x0, x1, y0, y1 } = this.o_focus__bounds;
            return [
                { n_index: 0, n_x: x0, n_y: y0, s_label: 'near X start / Y start' },
                { n_index: 1, n_x: x1, n_y: y0, s_label: 'near X end / Y start' },
                { n_index: 2, n_x: x0, n_y: y1, s_label: 'near X start / Y end' },
                { n_index: 3, n_x: x1, n_y: y1, s_label: 'near X end / Y end' },
            ];
        },
        a_o_focus_corner: function() {
            return this.a_o_focus_corner_all.filter((corner, i, corners) =>
                corners.findIndex(c => c.n_x === corner.n_x && c.n_y === corner.n_y) === i);
        },
        b_free_point_ready() {
            return !this.s_free_point_block_reason;
        },
        s_free_point_block_reason() {
            if (this.s_stage_block_reason) return this.s_stage_block_reason;
            if (!this.b_focus_motor_available) return this.s_motor__focus_label;
            if (!o_state.b_streaming__webcam) return 'Start the camera before scanning.';
            if (!['x', 'y', 'z'].every(axis => Number.isSafeInteger(o_state.a_o_motor[f_n_motor__axis(axis)]?.n_position))) return 'Wait for valid X, Y and Z positions from the motor controller.';
            return '';
        },
        b_free_calibrated() {
            return [this.n_step__per_px__x, this.n_step__per_px__y].every(n => Number.isFinite(n) && n > 0);
        },
        o_free_plan_result() {
            // Read reactive camera dimensions so a format change recalculates coverage.
            const { n_scl_x: width, n_scl_y: height } = f_o_camera_geometry({
                videoWidth: o_state.o_camera?.n_width || document.getElementById('webcamVideo')?.videoWidth,
                videoHeight: o_state.o_camera?.n_height || document.getElementById('webcamVideo')?.videoHeight,
            });
            try {
                return { o_plan: f_o_free_scan_plan(this.a_o_point__free, {
                    n_width: width, n_height: height, n_steps_x: this.n_step__per_px__x,
                    n_steps_y: this.n_step__per_px__y, n_overlap_pct: this.n_overlap__pct,
                }), s_error: '' };
            } catch (error) { return { o_plan: null, s_error: error.message }; }
        },
        s_key__free_plan() {
            return JSON.stringify([this.s_mode__area, this.a_o_point__free, this.n_overlap__pct,
                this.n_step__per_px__x, this.n_step__per_px__y, o_state.o_camera?.n_width, o_state.o_camera?.n_height,
                o_state.s_id__webcam_device, o_state.b_streaming__webcam]);
        },
        o_free_preview() {
            const plan = this.o_free_plan_result.o_plan;
            const points = this.a_o_point__free;
            if (!points.length) return { a_point: [], a_tile: [], s_outline: '', s_route: '' };
            const sx = this.n_step__per_px__x || 1, sy = this.n_step__per_px__y || 1;
            const minX = Math.min(...points.map(p => p.n_x / sx)), minY = Math.min(...points.map(p => p.n_y / sy));
            const spanX = Math.max(...points.map(p => p.n_x / sx)) - minX;
            const spanY = Math.max(...points.map(p => p.n_y / sy)) - minY;
            const scale = Math.min(240 / Math.max(1, spanX + (plan?.n_step__x || 0) / sx), 140 / Math.max(1, spanY + (plan?.n_step__y || 0) / sy));
            const project = p => ({ x: 30 + (p.n_x / sx - minX) * scale, y: 30 + (p.n_y / sy - minY) * scale });
            const a_point = points.map(project), route = (plan?.a_o_tile || []).map(project);
            return { a_point, s_outline: a_point.map(p => p.x + ',' + p.y).join(' '),
                s_route: route.map(p => p.x + ',' + p.y).join(' '),
                a_tile: route.length > 1200 ? [] : route.map(p => ({ ...p, w: plan.n_step__x / sx * scale, h: plan.n_step__y / sy * scale })),
            };
        },
        s_key__focus_grid: function() {
            return JSON.stringify([this.n_step__x, this.n_step__y, this.n_tile_x, this.n_tile_y, this.a_n_grid__start, this.n_pct__focus_padding]);
        },
        s_key__focus_axes: function() {
            return JSON.stringify(['x', 'y', 'z'].map(axis => f_n_motor__axis(axis)));
        },
        s_motor__focus_label: function() {
            let n_motor = f_n_motor__axis('z');
            if(n_motor === null && o_state.o_focus__probe?.s_status === 'no_response' && o_state.o_focus__probe.n_motor === o_state.o_motor__axis?.z) return 'No focus response — check the motor and retry calibration in Setup.';
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

    watch: {
        s_key__free_plan: { flush: 'sync', handler() {
            if (this.s_status === 'scanning' && this.o_plan__capture) this.f_stop_scan();
        } },
        s_key__focus_grid: { flush: 'sync', handler: function() {
            this.a_n_focus__corner = [null, null, null, null];
            if (this.s_status === 'scanning') this.f_stop_scan();
        } },
        s_key__focus_axes: { flush: 'sync', handler: function() { this.f_clear_corner_focus(); this.f_clear_free_points(); } },
        'o_state.n_id__slide__current': { flush: 'sync', handler: function() { this.f_clear_corner_focus(); this.f_clear_free_points(); } },
        'o_state.b_connected__esp': { flush: 'sync', handler: function(connected) {
            if (!connected) {
                this.f_clear_corner_focus();
                this.f_clear_free_points();
                if (this.s_status === 'scanning' || this.b_testing) this.b_stop_requested = true;
            }
        } },
        'o_state.n_cnt__stop_all': { flush: 'sync', handler: function() {
            if (this.s_status === 'scanning' || this.b_testing) this.b_stop_requested = true;
        } },
    },

    mounted: function() {
        let o_self = this;
        o_self.f_load_config();
        o_self.f_poll_jobs();
    },

    methods: {

        f_add_free_point() {
            if (!this.b_free_point_ready || this.a_o_point__free.length >= 128) return;
            const [n_x, n_y, n_z] = ['x', 'y', 'z'].map(axis => o_state.a_o_motor[f_n_motor__axis(axis)].n_position);
            if (this.a_o_point__free.some(p => p.n_x === n_x && p.n_y === n_y)) {
                this.s_error__free = 'That XY position is already marked. Move to the next boundary point; the outline closes automatically.';
                return;
            }
            this.s_error__free = '';
            this.a_o_point__free.push({ n_x, n_y, n_z });
        },
        f_clear_free_points() {
            if (this.s_mode__area === 'free' && (this.s_status === 'scanning' || this.b_testing)) this.f_stop_scan();
            this.a_o_point__free = [];
            this.s_error__free = '';
        },
        f_b_at_free_point(point) {
            return ['x', 'y'].every(axis => o_state.a_o_motor[f_n_motor__axis(axis)]?.n_position === point['n_' + axis]);
        },
        f_update_free_focus(point) {
            if (this.b_free_point_ready && this.f_b_at_free_point(point)) point.n_z = o_state.a_o_motor[f_n_motor__axis('z')].n_position;
        },
        async f_go_free_point(point) {
            if (!this.b_free_point_ready) return;
            this.b_testing = true;
            this.b_stop_requested = false;
            this.s_error__free = '';
            o_state.b_scanning = true;
            try {
                for (const axis of ['x', 'y', 'z']) {
                    this.s_status__detail = 'Moving to focused point…';
                    const motor = f_n_motor__axis(axis);
                    await this.f_move_motor_n_step(motor, point['n_' + axis] - o_state.a_o_motor[motor].n_position);
                }
            } catch (error) { this.s_error__free = error.message; }
            finally { this.b_testing = false; o_state.b_scanning = false; this.s_status__detail = ''; }
        },

        // ── Panel ────────────────────────────────────────────────────

        f_close: function() {
            if (this.s_status === 'scanning' || this.b_testing) return;
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
                    o_self.s_mode__area = o_config.s_mode__area === 'free' ? 'free' : 'grid';
                    if (o_config.n_step__x) o_self.n_step__x = o_config.n_step__x;
                    if (o_config.n_step__y) o_self.n_step__y = o_config.n_step__y;
                    if (o_config.n_tile_x) o_self.n_tile_x = o_config.n_tile_x;
                    if (o_config.n_tile_y) o_self.n_tile_y = o_config.n_tile_y;
                    if (typeof o_config.n_overlap__pct === 'number') o_self.n_overlap__pct = o_config.n_overlap__pct;
                    if (o_config.n_score__min) o_self.n_score__min = o_config.n_score__min;
                    if (typeof o_config.n_dim__max === 'number') o_self.n_dim__max = o_config.n_dim__max;
                    if ([1024, 512, 256, 128].includes(o_config.n_registration__max_width)) o_self.n_registration__max_width = o_config.n_registration__max_width;
                    o_self.s_mode__focus = ['fixed', 'autofocus', 'corners'].includes(o_config.s_mode__focus)
                        ? o_config.s_mode__focus : o_config.b_focus__before_tile ? 'autofocus' : 'fixed';
                    o_self.n_pct__focus_padding = Number.isFinite(o_config.n_pct__focus_padding)
                        && o_config.n_pct__focus_padding >= 0 && o_config.n_pct__focus_padding <= 49 ? o_config.n_pct__focus_padding : 10;
                    if (o_config.n_step__focus) o_self.n_step__focus = o_config.n_step__focus;
                    if (o_config.n_step__focus_max) o_self.n_step__focus_max = o_config.n_step__focus_max;
                    if (typeof o_config.n_ms__focus_settle === 'number') o_self.n_ms__focus_settle = o_config.n_ms__focus_settle;
                    if (typeof o_config.b_feather === 'boolean') o_self.b_feather = o_config.b_feather;
                    if (typeof o_config.b_matcher__loftr === 'boolean') o_self.b_matcher__loftr = o_config.b_matcher__loftr;
                    if (typeof o_config.b_return__after_scan === 'boolean') o_self.b_return__after_scan = o_config.b_return__after_scan;
                } catch (e) { /* ignore parse errors */ }
            }
        },

        f_save_config: function() {
            f_save_setting__debounced('o_config__scan', {
                s_mode__area: this.s_mode__area,
                n_step__x: this.n_step__x,
                n_step__y: this.n_step__y,
                n_tile_x: this.n_tile_x,
                n_tile_y: this.n_tile_y,
                n_overlap__pct: this.n_overlap__pct,
                b_focus__before_tile: this.b_focus__before_tile,
                s_mode__focus: this.s_mode__focus,
                n_pct__focus_padding: this.n_pct__focus_padding,
                n_step__focus: this.n_step__focus,
                n_step__focus_max: this.n_step__focus_max,
                n_ms__focus_settle: this.n_ms__focus_settle,
                n_score__min: this.n_score__min,
                n_dim__max: this.n_dim__max,
                n_registration__max_width: this.n_registration__max_width,
                b_feather: this.b_feather,
                b_matcher__loftr: this.b_matcher__loftr,
                b_return__after_scan: this.b_return__after_scan,
            });
        },

        // ── Motor helpers ────────────────────────────────────────────

        f_move_motor_n_step: async function(n_motor, n_step) {
            if (this.b_stop_requested) throw new Error('Scan movement stopped');
            if (!o_state.b_connected__esp) throw new Error('Controller disconnected');
            const motor = o_state.a_o_motor[n_motor];
            if (n_motor === null || !motor || !Number.isFinite(motor.n_position)) throw new Error('Motor position unavailable');
            if (!Number.isFinite(n_step)) throw new Error('Invalid motor movement');
            n_step = Math.round(n_step);
            if (n_step === 0) return;
            const target = motor.n_position + n_step;
            let timer;
            try {
                const result = await Promise.race([
                    f_send_esp_move_step(n_motor, n_step, N_RPM__SCAN),
                    new Promise((_, reject) => { timer = setTimeout(() => {
                        f_send_esp_stop(n_motor);
                        reject(new Error('Motor movement timed out'));
                    }, N_MS__MOVE_TIMEOUT); }),
                ]);
                if (!o_state.b_connected__esp) throw new Error('Controller disconnected');
                // Completion carries the position before the next status poll arrives.
                if (Number.isFinite(result)) motor.n_position = result;
                motor.b_running = false;
                if (this.b_stop_requested || result !== target) throw new Error('Motor movement stopped before reaching its target');
            } catch (error) {
                this.b_stop_requested = true;
                throw error;
            } finally {
                clearTimeout(timer);
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

        f_clear_corner_focus: function() {
            this.a_n_focus__corner = [null, null, null, null];
            if (this.s_mode__focus === 'corners') {
                this.a_n_grid__start = null;
                if (this.s_status === 'scanning' || this.b_testing) this.f_stop_scan();
            }
        },
        f_set_focus_start: function() {
            if (!this.b_corner_controls_ready) return;
            this.a_n_grid__start = ['x', 'y'].map(axis => o_state.a_o_motor[f_n_motor__axis(axis)].n_position);
            this.a_n_focus__corner = [null, null, null, null];
        },
        f_b_at_focus_corner: function(corner) {
            if (!this.a_n_grid__start) return false;
            return ['x', 'y'].every((axis, i) => {
                const offset = i === 0 ? corner.n_x : corner.n_y;
                const position = o_state.a_o_motor[f_n_motor__axis(axis)]?.n_position;
                return Number.isFinite(position) && Math.abs(position - this.a_n_grid__start[i] - offset) < 0.5;
            });
        },
        f_save_focus_corner: function(corner) {
            if (!this.b_corner_controls_ready || !this.f_b_at_focus_corner(corner)) return;
            const z = o_state.a_o_motor[f_n_motor__axis('z')]?.n_position;
            if (!Number.isFinite(z)) return;
            // A one-row/one-column scan has coincident corners: save them together.
            this.a_o_focus_corner_all.forEach(point => {
                if (point.n_x === corner.n_x && point.n_y === corner.n_y) this.a_n_focus__corner[point.n_index] = z;
            });
        },
        f_go_focus_corner: async function(corner) {
            if (!this.b_corner_controls_ready || !this.a_n_grid__start) return;
            const targets = [this.a_n_grid__start[0] + corner.n_x, this.a_n_grid__start[1] + corner.n_y];
            this.b_testing = true;
            this.b_stop_requested = false;
            o_state.b_scanning = true;
            this.s_error__jobs = '';
            this.s_status__detail = 'Moving to focus point ' + (corner.n_index + 1) + '…';
            try {
                for (const [i, axis] of ['x', 'y'].entries()) {
                    const motor = f_n_motor__axis(axis);
                    await this.f_move_motor_n_step(motor, targets[i] - o_state.a_o_motor[motor].n_position);
                }
                await this.f_delay(N_MS__SETTLE);
            } catch (error) { this.s_error__jobs = error.message; }
            finally {
                this.b_testing = false;
                o_state.b_scanning = false;
                this.s_status__detail = '';
            }
        },
        f_n_focus__tile: function(tile) {
            if (!this.b_corner_focus_ready) throw new Error('Save focus at every focus point first');
            const { x0, x1, y0, y1 } = this.o_focus__bounds;
            // Extend the measured surface beyond the padded points to the scan edges.
            const x = x1 > x0 ? (tile.n_col * this.n_step__x - x0) / (x1 - x0) : 0;
            const y = y1 > y0 ? (tile.n_row * this.n_step__y - y0) / (y1 - y0) : 0;
            const [z00, z10, z01, z11] = this.a_n_focus__corner;
            return Math.round((1 - y) * ((1 - x) * z00 + x * z10) + y * ((1 - x) * z01 + x * z11));
        },
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
            if (!o_self.b_stage_ready || !o_self.b_grid_valid) return;
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
            if (!o_self.b_stage_ready || !o_self.b_grid_valid) return;
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
            if (!o_self.b_stage_ready || !o_self.b_grid_valid) return;
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
            if(!el_video || !f_o_camera_geometry(el_video).n_scl_x) return;

            let n_overlap = Math.max(0, Math.min(0.9, (o_self.n_overlap__pct || 0) / 100));
            let n_fov_steps_x = f_o_camera_geometry(el_video).n_scl_x * n_per_px_x;
            let n_fov_steps_y = f_o_camera_geometry(el_video).n_scl_y * n_per_px_y;
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
            if (o_self.s_mode__area === 'free') return (o_self.o_plan__capture || o_self.o_free_plan_result.o_plan)?.a_o_tile || [];
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

        f_stitch_options: function() {
            return {
                b_free_scan: this.s_mode__area === 'free',
                n_score__min: this.n_score__min, n_dim__max: this.n_dim__max,
                n_registration__max_width: this.n_registration__max_width,
                s_blend: this.b_feather ? 'feather' : 'none',
                b_matcher__loftr: this.b_matcher__loftr,
            };
        },
        f_start_scan: async function(b_live = false) {
            let o_self = this;

            if (!o_self.b_scan_ready) return;
            o_self.o_plan__capture = null;
            if (o_self.s_mode__area === 'free') {
                const plan = JSON.parse(JSON.stringify(o_self.o_free_plan_result.o_plan));
                o_self.n_tile_x = plan.n_tile_x; o_self.n_tile_y = plan.n_tile_y;
                o_self.n_step__x = plan.n_step__x; o_self.n_step__y = plan.n_step__y;
                o_self.a_n_grid__start = [...plan.a_n_start];
                plan.o_motor__axis = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, f_n_motor__axis(axis)]));
                plan.n_id__slide = o_state.n_id__slide__current || 0;
                plan.s_created = new Date().toISOString();
                o_self.o_plan__capture = plan;
            }
            const a_o_tile = o_self.f_a_o_tile__path();
            o_self.n_cnt__tile__planned = a_o_tile.length;
            o_self.a_b_planned = new Array(o_self.n_tile_x * o_self.n_tile_y).fill(false);
            for (const tile of a_o_tile) o_self.a_b_planned[tile.n_row * o_self.n_tile_x + tile.n_col] = true;
            o_self.b_live_scan = b_live === true;
            const pendingTiles = [];
            o_self.b_stop_requested = false;
            o_self.s_error__jobs = '';
            o_state.b_scanning = true;
            o_self.s_status = 'scanning';
            o_self.s_status__detail = 'Creating scan...';
            try {
                // create scan folder on server
                let o_resp = await f_send_wsmsg_with_response(
                    f_o_wsmsg('scan_create_folder', { n_id__slide: o_state.n_id__slide__current,
                        b_live_scan: o_self.b_live_scan, o_option: o_self.f_stitch_options(),
                        o_scan_plan: o_self.o_plan__capture })
                );
                if (!o_resp.v_result || !o_resp.v_result.s_path_folder) {
                    throw new Error(o_resp.error || 'Failed to create scan folder');
                }
                o_self.s_path_folder__scan = o_resp.v_result.s_path_folder;

                // init scan state
                o_state.b_scanning = true;
                o_self.s_status = 'scanning';
                if (o_self.b_stop_requested || !o_state.b_connected__esp) throw new Error('Scan stopped before capture');
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

                // Absolute targets also handle a free outline whose first tile is
                // not the bounding box origin, and gaps between row segments.
                const origin = o_self.a_n_grid__start || ['x', 'y'].map(axis => o_state.a_o_motor[f_n_motor__axis(axis)].n_position);

                for (let n_idx = 0; n_idx < a_o_tile.length; n_idx++) {
                    if (o_self.b_stop_requested) break;
                    if (!o_state.b_connected__esp) {
                        o_self.b_stop_requested = true;
                        break;
                    }

                    let o_tile = a_o_tile[n_idx];
                    let n_idx__cell = o_tile.n_row * o_self.n_tile_x + o_tile.n_col;
                    o_self.n_idx__cell__current = n_idx__cell;

                    for (const [axis, target] of [
                        ['x', origin[0] + o_tile.n_col * o_self.n_step__x],
                        ['y', origin[1] + o_tile.n_row * o_self.n_step__y],
                    ]) {
                        o_self.s_status__detail = 'Moving ' + axis.toUpperCase() + '…';
                        const motor = f_n_motor__axis(axis);
                        await o_self.f_move_motor_n_step(motor, target - o_state.a_o_motor[motor].n_position);
                    }

                    if (o_self.s_mode__area === 'free' || o_self.s_mode__focus === 'corners') {
                        o_self.s_status__detail = 'Setting interpolated focus…';
                        const motor = f_n_motor__axis('z');
                        const target = o_self.s_mode__area === 'free' ? o_tile.n_z : o_self.f_n_focus__tile(o_tile);
                        await o_self.f_move_motor_n_step(motor, target - o_state.a_o_motor[motor].n_position);
                    }

                    // wait for vibration to settle
                    o_self.s_status__detail = 'Settling...';
                    await o_self.f_delay(o_self.s_mode__area === 'free' || o_self.s_mode__focus === 'corners'
                        ? Math.max(N_MS__SETTLE, o_self.n_ms__focus_settle) : N_MS__SETTLE);
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
                            el_small.width = Math.min(o_self.n_registration__max_width, o_bitmap.width);
                            el_small.height = Math.max(1, Math.round(o_bitmap.height * el_small.width / o_bitmap.width));
                            let o_ctx = el_small.getContext('2d');
                            o_ctx.imageSmoothingQuality = 'high';
                            o_ctx.drawImage(o_bitmap, 0, 0, el_small.width, el_small.height);
                            let o_small = await new Promise((resolve, reject) => {
                                el_small.toBlob(blob => blob ? resolve(blob) : reject(new Error('failed to downscale tile')), 'image/png');
                            });
                            await f_save_image(o_small, o_self.s_path_folder__scan + '/dowscaled', s_filename);
                            if (o_self.b_live_scan) {
                                // Do not wait on alignment or its acknowledgement before moving.
                                pendingTiles.push(o_self.f_job_request('scan_tile_ready', {
                                    s_path_folder: o_self.s_path_folder__scan, s_filename,
                                }).catch(error => { o_self.s_error__jobs = error.message; }));
                            }
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
                    + ': ' + o_self.n_cnt__tile__captured + '/' + o_self.n_cnt__tile__planned
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
                    await Promise.all(pendingTiles);
                    await o_self.f_job_request('scan_finish', { s_path_folder: folder, n_tiles: count });
                    if (count >= 2) await o_self.f_stitch();
                    else await o_self.f_refresh_jobs();
                } catch (error) {
                    o_self.s_error__jobs = error.message;
                }
            } catch (error) {
                o_self.s_error__jobs = error.message;
                if (o_self.s_path_folder__scan) {
                    await Promise.all(pendingTiles);
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
        f_open_folder: async function(job) {
            this.s_error__jobs = '';
            try {
                const response = await fetch('/api/scans/open_folder?path=' + encodeURIComponent(job.s_path_folder), { method: 'POST' });
                if (!response.ok) throw new Error(await response.text() || 'Could not open scan folder');
            } catch (error) { this.s_error__jobs = error.message; }
        },
        f_stitch: async function(job) {
            if (this.b_queueing) return;
            const folder = job?.s_path_folder || this.s_path_folder__scan;
            if (!folder) return;
            const options = job?.o_option && Object.keys(job.o_option).length ? job.o_option : this.f_stitch_options();
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
            this.s_error__jobs = '';
            if (this.o_plan__capture) this.a_n_grid__start = null;
            this.f_clear_corner_focus();
            this.f_clear_free_points();
            this.o_plan__capture = null;
            this.a_b_planned = [];
            this.n_cnt__tile__planned = 0;
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
        if (this.s_status === 'scanning' || this.b_testing) {
            this.f_stop_scan();
        }
        this.f_stop_elapsed_timer();
        this.b_unmounted = true;
        clearTimeout(this.n_id__jobs_poll);
    },
};

export { o_component__scan };
