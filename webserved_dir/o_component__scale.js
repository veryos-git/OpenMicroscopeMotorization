import { f_n_motor__axis, o_state, f_save_calibration, f_save_setting__debounced, f_send_wsmsg_with_response } from './index.js';
import { f_o_wsmsg } from './constructors.module.js';
import { f_save_image } from './o_capture.module.js';
import { f_o_camera_geometry, f_el_camera_frame, f_o_camera_geometry_snapshot, f_b_camera_geometry_matches } from './camera_frame.module.js';
import { f_o_video_rect } from './training_workflow.module.js';
import {
    N_PX__LINE_MIN, f_n_um__known, f_n_px__distance, f_n_px__path, f_o_scale, f_n_pct__error, f_s_viewbox__line,
    f_o_point__camera, f_o_point__window, f_s_number, f_s_length, f_n_um__grid, f_o_ruler, a_o_size_reference,
} from './scale_calibration.module.js';
import { o_component__icon } from './o_component__icon.js';
import { o_component__tab } from './o_component__cockpit.js';

// Size window. Three functions, one pane each:
//   calibrate  mark two points a known distance apart (e.g. one cell of a 0.1 mm
//              grid slide) -> µm per camera pixel
//   measure    click points on the live image and read the distances
//   reference  a grid, a ruler or an object of known size drawn over the live image
// Points are kept in camera pixels, so nothing depends on the window size. While
// points are placed a layer above the mouse-jog overlay takes the clicks, so
// marking a point never moves the stage. Measure and reference need a stored scale.

let N_PX__LOUPE = 132;          // size of the magnifier in window px
let N_PX__DRAG_MIN = 6;         // pointer travel that turns a click into "drag a line"
let N_CNT__POINT_MAX = 50;      // points of one measured path

// The frame the calibration points were set on, with the measured line drawn in,
// so the stored scale can be traced back later. Marks keep their centre open so
// the exact pixel under each point stays visible.
let f_draw_measurement = function(el_canvas, a_o_point, s_label) {
    let o_ctx = el_canvas.getContext('2d');
    let n_scl = Math.max(1, el_canvas.width / 1000);
    let [o_a, o_b] = a_o_point;
    let n_gap = 4 * n_scl;
    let n_arm = 14 * n_scl;
    let f_stroke = function(f_path) {
        for (let o_stroke of [{ s_color: 'rgba(0,0,0,0.7)', n_width: 4 * n_scl }, { s_color: '#ff3b6b', n_width: 1.5 * n_scl }]) {
            o_ctx.strokeStyle = o_stroke.s_color;
            o_ctx.lineWidth = o_stroke.n_width;
            o_ctx.beginPath();
            f_path();
            o_ctx.stroke();
        }
    };
    let n_len = Math.hypot(o_b.n_x - o_a.n_x, o_b.n_y - o_a.n_y) || 1;
    let n_ux = (o_b.n_x - o_a.n_x) / n_len;
    let n_uy = (o_b.n_y - o_a.n_y) / n_len;
    f_stroke(function() {
        // the line stops short of both points
        o_ctx.moveTo(o_a.n_x + n_ux * n_gap, o_a.n_y + n_uy * n_gap);
        o_ctx.lineTo(o_b.n_x - n_ux * n_gap, o_b.n_y - n_uy * n_gap);
        for (let o_point of [o_a, o_b]) {
            // a mark across the line at each end
            o_ctx.moveTo(o_point.n_x - n_uy * n_arm, o_point.n_y + n_ux * n_arm);
            o_ctx.lineTo(o_point.n_x - n_uy * n_gap, o_point.n_y + n_ux * n_gap);
            o_ctx.moveTo(o_point.n_x + n_uy * n_gap, o_point.n_y - n_ux * n_gap);
            o_ctx.lineTo(o_point.n_x + n_uy * n_arm, o_point.n_y - n_ux * n_arm);
        }
    });
    o_ctx.font = '600 ' + Math.round(16 * n_scl) + 'px monospace';
    o_ctx.textBaseline = 'bottom';
    let n_scl_x__text = o_ctx.measureText(s_label).width;
    let n_x = Math.min(Math.max((o_a.n_x + o_b.n_x) / 2 - n_scl_x__text / 2, 8 * n_scl), el_canvas.width - n_scl_x__text - 8 * n_scl);
    let n_y = Math.max((o_a.n_y + o_b.n_y) / 2 - 12 * n_scl, 24 * n_scl);
    o_ctx.lineJoin = 'round';
    o_ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    o_ctx.lineWidth = 4 * n_scl;
    o_ctx.strokeText(s_label, n_x, n_y);
    o_ctx.fillStyle = '#fff';
    o_ctx.fillText(s_label, n_x, n_y);
};

// 2026-11-10_14-03-59: sorts by time and is valid in a file name
let f_s_ts__file = function(n_ts_ms) {
    let o_date = new Date(n_ts_ms);
    let f_s = function(n) { return String(n).padStart(2, '0'); };
    return o_date.getFullYear() + '-' + f_s(o_date.getMonth() + 1) + '-' + f_s(o_date.getDate())
        + '_' + f_s(o_date.getHours()) + '-' + f_s(o_date.getMinutes()) + '-' + f_s(o_date.getSeconds());
};

// keeps a drag attached to its handle when the pointer leaves it; a pointer the
// browser no longer tracks (already released) is simply not captured
let f_capture_pointer = function(o_evt) {
    try { o_evt.currentTarget.setPointerCapture(o_evt.pointerId); } catch (o_error) { /* not capturable */ }
};

let o_component__scale = {
    name: 'component-scale',
    components: { ui_icon: o_component__icon, ui_tab: o_component__tab },
    template: `
        <div class="overlay-panel panel-scale" :class="{ visible: b_window }" @cockpit-reveal="f_set_tab($event.detail)">
            <div class="panel-header">
                <h2><ui_icon s_name="scale" /> Size <span class="ui-info" tabindex="0" role="note" data-tooltip="Size&#10;Calibrate: tell the app how large one camera pixel is.&#10;Measure: click points on the live image and read the distances.&#10;Reference: lay a grid, a ruler or an object of known size over the live image.&#10;The scale belongs to the objective and camera resolution in use."></span></h2>
                <span class="panel-state" :class="{ running: b_picking }" data-tooltip="Stored scale">{{ n_um__per_px ? f_s_number(n_um__per_px) + ' µm/px' : 'not calibrated' }}</span>
                <button class="panel-close" @click="f_close" aria-label="Close Size">&times;</button>
            </div>
            <ui_tab :a_o_tab="a_o_tab" :s_tab="s_tab" @update:s_tab="f_set_tab($event)" />
            <div class="panel-body">
                <div class="cockpit-status warning size-warning" v-if="s_warning__camera" role="alert">{{ s_warning__camera }}</div>

                <!-- ── Calibrate: two points a known distance apart ── -->
                <div class="cockpit-pane" data-cockpit-pane="calibrate" v-show="s_tab === 'calibrate'">
                    <div class="cockpit-grid cockpit-grid--4">
                        <div class="focus-field cockpit-field" data-tooltip="Known distance&#10;Real distance between the two points: 0.1 mm for one cell of a 0.1 mm grid, 0.5 mm for five cells.">
                            <label for="scale-known">Known distance</label>
                            <input id="scale-known" type="number" min="0" step="any" v-model.number="o_size.n_known" @change="f_on_known_change">
                        </div>
                        <div class="focus-field cockpit-field">
                            <label for="scale-unit">Unit</label>
                            <select id="scale-unit" aria-label="Unit of the known distance" v-model="o_size.s_unit" @change="f_on_known_change">
                                <option value="mm">mm</option>
                                <option value="um">µm</option>
                            </select>
                        </div>
                        <button class="btn-small size-action" :class="{ active: b_picking }" :disabled="!o_state.b_streaming__webcam"
                            @click="b_picking ? f_cancel_pick() : f_start_pick()"
                            data-tooltip="Set points&#10;Click the first and the second point on the live image, or drag a line between them. A magnifier helps to hit a grid line exactly. Clicks do not move the stage; Esc cancels."
                        >{{ b_picking ? 'Cancel' : 'Set points' }}</button>
                        <button class="btn-scan-start size-action" @click="f_save" :disabled="!o_scale__new"
                            data-tooltip="Save&#10;Store the scale of this line. It replaces the stored scale."
                        >Save</button>
                    </div>

                    <div class="cockpit-status size-hint" :class="{ running: b_picking }" role="status">{{ s_hint__calibrate }}</div>

                    <div class="focus-result size-result" v-if="a_o_point.length === 2">
                        <div data-tooltip="Length of the line in camera pixels"><span>line</span><b>{{ n_px__line.toFixed(1) }} px</b></div>
                        <div :data-tooltip="'Scale this line gives with the known distance' + (o_scale__new ? ' · ' + f_s_number(o_scale__new.n_px__per_um) + ' px/µm · about ± ' + n_pct__error.toFixed(1) + ' % if each point is placed within one pixel' : '')">
                            <span>new scale</span><b>{{ o_scale__new ? f_s_number(o_scale__new.n_um__per_px) + ' µm/px' : '—' }}</b></div>
                        <div data-tooltip="Length of this line with the stored scale. Draw a line over another known distance to check the calibration.">
                            <span>stored scale says</span><b>{{ f_s_length(n_um__line__stored) }}</b></div>
                    </div>

                    <div class="cockpit-section">
                        <div class="cockpit-section-head">
                            <span class="cockpit-label">Stored scale</span>
                            <span class="ui-info" tabindex="0" role="note" data-tooltip="Stored scale&#10;Used by Measure and Reference and saved with recordings. If you already know the value you can type it here instead of measuring."></span>
                            <span class="cockpit-readout dim" v-if="n_um__per_px">{{ f_s_number(n_um__per_px) }} µm/px &middot; {{ f_s_number(n_px__per_um) }} px/µm<template v-if="s_date__scale"> &middot; {{ s_date__scale }}</template></span>
                            <span class="cockpit-readout dim" v-else>no scale set yet</span>
                        </div>
                        <div class="calib-scale-row">
                            <input
                                type="number" min="0" step="any" class="calib-scale-input" aria-label="Stored scale"
                                :value="n_value__display"
                                :placeholder="b_unit__um_per_px ? 'µm/px' : 'px/µm'"
                                @change="f_on_input($event.target.value)"
                            >
                            <button class="btn-small calib-unit-toggle" @click="b_unit__um_per_px = !b_unit__um_per_px"
                                aria-label="Switch unit" data-tooltip="Switch between µm/px and px/µm">⇌</button>
                            <span class="calib-unit-label">{{ b_unit__um_per_px ? 'µm / px' : 'px / µm' }}</span>
                            <span class="cockpit-readout dim size-step" v-if="n_um__per_step__x || n_um__per_step__y"
                                data-tooltip="Stage travel per motor step, from the stored scale and the steps per pixel in Setup">
                                <template v-if="n_um__per_step__x">X {{ f_s_number(n_um__per_step__x) }}</template>
                                <template v-if="n_um__per_step__y"> · Y {{ f_s_number(n_um__per_step__y) }}</template> µm/step
                            </span>
                        </div>
                        <div class="size-record" v-if="o_record">
                            <a v-if="o_record.s_path_image" class="size-snapshot" target="_blank" rel="noopener"
                                :href="'/api/file?path=' + encodeURIComponent(o_record.s_path_image)"
                                data-tooltip="Snapshot of the calibration&#10;The camera image with the measured line, taken when the second point was set. Click to open it full size.">
                                <svg v-if="s_viewbox__record" :viewBox="s_viewbox__record" role="img" aria-label="Snapshot of the size calibration">
                                    <image :href="'/api/file?path=' + encodeURIComponent(o_record.s_path_image)" :width="o_record.n_scl_x" :height="o_record.n_scl_y" />
                                </svg>
                                <img v-else :src="'/api/file?path=' + encodeURIComponent(o_record.s_path_image)" alt="Snapshot of the size calibration" loading="lazy">
                            </a>
                            <span class="cockpit-readout dim" data-tooltip="How the stored scale was measured">
                                measured: {{ f_s_length(o_record.n_um__known) }} = {{ o_record.n_px__line.toFixed(1) }} px<template v-if="b_snapshot_saving"> · saving snapshot…</template>
                            </span>
                        </div>
                        <div class="cockpit-status warning" v-if="s_error__snapshot" role="alert">{{ s_error__snapshot }}</div>
                    </div>
                </div>

                <!-- ── Measure: click points, read distances ── -->
                <div class="cockpit-pane" data-cockpit-pane="measure" v-show="s_tab === 'measure'">
                    <div class="cockpit-row">
                        <button class="btn-scan-start cockpit-grow size-action" :class="{ active: b_picking }" :disabled="!b_calibrated || !o_state.b_streaming__webcam"
                            @click="b_picking ? f_end_pick() : f_start_pick()"
                            data-tooltip="Set points&#10;Click on the live image to add points. Each line shows its length, the last point the total. Afterwards: drag a point to move it, click a point to remove it. Clicks do not move the stage; Esc ends adding."
                        >{{ b_picking ? 'Done' : (a_o_point__measure.length ? 'Add points' : 'Set points') }}</button>
                        <button class="btn-small" @click="f_undo_measure" :disabled="!a_o_point__measure.length" data-tooltip="Remove the last point">Undo</button>
                        <button class="btn-small" @click="f_clear_measure" :disabled="!a_o_point__measure.length" data-tooltip="Remove every point">Clear</button>
                    </div>
                    <div class="cockpit-status size-hint" :class="{ running: b_picking }" role="status">{{ s_hint__measure }}</div>
                    <div class="focus-result size-result">
                        <div data-tooltip="Length along every line of the path"><span>total</span><b>{{ f_s_length(n_um__measure) }}</b></div>
                        <div data-tooltip="Straight distance from the first to the last point"><span>first to last</span><b>{{ f_s_length(n_um__measure__direct) }}</b></div>
                        <div data-tooltip="Total length in camera pixels"><span>pixels</span><b>{{ n_px__measure ? n_px__measure.toFixed(1) + ' px' : '—' }}</b></div>
                    </div>
                </div>

                <!-- ── Reference: grid, ruler, object of known size ── -->
                <div class="cockpit-pane" data-cockpit-pane="reference" v-show="s_tab === 'reference'">
                    <fieldset class="size-fieldset" :disabled="!b_calibrated">
                        <div class="size-reference-row">
                            <label class="cockpit-check" data-tooltip="Grid&#10;Lines at a fixed real distance over the whole live image. It stays on when this window is closed.">
                                <input type="checkbox" aria-label="Size grid" data-control-effect="size.b_grid" v-model="o_size.b_grid" @change="f_save_size"> Grid</label>
                            <div class="focus-field cockpit-field" data-tooltip="Grid cell (µm)&#10;0 = automatic: a round size that is easy to read at this magnification.">
                                <label for="size-grid">Cell (µm, 0 = auto)</label>
                                <input id="size-grid" type="number" min="0" step="any" v-model.number="o_size.n_um__grid" @change="f_save_size">
                            </div>
                            <span class="cockpit-readout dim">{{ o_grid ? (o_grid.b_dense ? 'too fine to draw' : f_s_length(o_grid.n_um)) : '' }}</span>
                        </div>
                        <div class="size-reference-row">
                            <label class="cockpit-check" data-tooltip="Ruler&#10;A bar of a round length with tick marks. Drag it next to an object while this window is open. It stays on when this window is closed.">
                                <input type="checkbox" aria-label="Size ruler" data-control-effect="size.b_ruler" v-model="o_size.b_ruler" @change="f_save_size"> Ruler</label>
                            <span class="cockpit-readout dim size-wide">{{ o_ruler ? f_s_length(o_ruler.n_um) + ' · drag it on the image' : '' }}</span>
                        </div>
                        <div class="size-reference-row">
                            <div class="focus-field cockpit-field size-wide" data-tooltip="Object&#10;A shape of typical real size, drawn at the stored scale. Drag it next to your specimen to compare. Own image: load a picture and enter the real width it shows.">
                                <label for="size-object">Object</label>
                                <select id="size-object" aria-label="Size reference object" data-control-effect="size.s_object" v-model="o_size.s_object" @change="f_save_size">
                                    <option value="">none</option>
                                    <option v-for="o_reference in a_o_size_reference" :key="o_reference.s_id" :value="o_reference.s_id">{{ o_reference.s_name }}</option>
                                    <option value="image">Own image…</option>
                                </select>
                            </div>
                            <span class="cockpit-readout dim size-note">{{ s_note__object }}</span>
                        </div>
                        <div class="size-reference-row" v-if="o_size.s_object === 'image'">
                            <input class="size-wide" type="file" accept="image/*" aria-label="Reference image file" @change="f_on_image_file">
                            <div class="focus-field cockpit-field" data-tooltip="Real width (µm)&#10;Real-world width that the whole picture shows.">
                                <label for="size-image-width">Real width (µm)</label>
                                <input id="size-image-width" type="number" min="0" step="any" v-model.number="o_size.n_um__image" @change="f_save_size">
                            </div>
                        </div>
                        <div class="size-reference-row" data-tooltip="Opacity&#10;How strongly grid, ruler and object cover the live image.">
                            <label for="size-opacity" class="cockpit-label">Opacity</label>
                            <input id="size-opacity" type="range" aria-label="Opacity of size references" min="10" max="100" step="5" v-model.number="o_size.n_pct__opacity" @change="f_save_size">
                            <span class="cockpit-readout">{{ o_size.n_pct__opacity }} %</span>
                        </div>
                    </fieldset>
                    <div class="cockpit-status size-hint" v-if="!b_calibrated" role="status">{{ s_hint__uncalibrated }}</div>
                </div>

            </div>
        </div>

        <!-- ── on the live image ── -->
        <div v-if="b_window" class="size-pick-layer" :class="{ armed: b_picking }"
            @pointerdown="f_on_pick_down" @pointermove="f_on_pick_move" @pointerup="f_on_pick_up"
            @pointercancel="f_cancel_pick" @contextmenu.prevent></div>
        <svg v-if="o_view && (b_window || b_reference)" class="size-svg" :class="{ interactive: b_window && !b_picking }" aria-hidden="true">
            <!-- references need a scale; they stay on while the window is closed -->
            <g v-if="b_calibrated" class="size-reference" :style="{ opacity: o_size.n_pct__opacity / 100 }">
                <template v-if="o_grid && !o_grid.b_dense">
                    <defs>
                        <pattern id="size-grid-pattern" patternUnits="userSpaceOnUse" :x="o_grid.n_x" :y="o_grid.n_y" :width="o_grid.n_px" :height="o_grid.n_px">
                            <path class="size-grid-line size-outline" :d="o_grid.s_path" />
                            <path class="size-grid-line" :d="o_grid.s_path" />
                        </pattern>
                    </defs>
                    <rect class="size-grid" :x="o_view.o_rect.n_x" :y="o_view.o_rect.n_y" :width="o_view.o_rect.n_scl_x" :height="o_view.o_rect.n_scl_y" fill="url(#size-grid-pattern)" />
                    <text class="size-text size-text--end" :x="o_view.o_rect.n_x + o_view.o_rect.n_scl_x - 10" :y="o_view.o_rect.n_y + o_view.o_rect.n_scl_y - 10">grid {{ f_s_length(o_grid.n_um) }}</text>
                </template>
                <g v-if="o_object" class="size-object size-draggable" :transform="'translate(' + o_object.n_x + ' ' + o_object.n_y + ')'"
                    @pointerdown="f_on_reference_down($event, 'object')" @pointermove="f_on_reference_move" @pointerup="f_on_reference_up" @pointercancel="f_on_reference_up">
                    <circle v-if="o_object.n_radius__marker" class="size-object-marker" :r="o_object.n_radius__marker" />
                    <image v-if="o_object.s_shape === 'image'" :href="s_url__image" :x="-o_object.n_scl_x / 2" :y="-o_object.n_scl_y / 2" :width="o_object.n_scl_x" :height="o_object.n_scl_y" preserveAspectRatio="none" />
                    <ellipse v-else-if="o_object.s_shape === 'ellipse'" class="size-object-shape" :rx="o_object.n_scl_x / 2" :ry="o_object.n_scl_y / 2" />
                    <rect v-else class="size-object-shape" :x="-o_object.n_scl_x / 2" :y="-o_object.n_scl_y / 2" :width="o_object.n_scl_x" :height="o_object.n_scl_y"
                        :rx="o_object.s_shape === 'capsule' ? o_object.n_scl_y / 2 : 0" />
                    <text class="size-text size-text--middle" :y="Math.max(o_object.n_scl_y / 2, o_object.n_radius__marker) + 16">{{ o_object.s_label }}</text>
                </g>
                <g v-if="o_ruler" class="size-ruler size-draggable" :transform="'translate(' + o_ruler.n_x + ' ' + o_ruler.n_y + ')'"
                    @pointerdown="f_on_reference_down($event, 'ruler')" @pointermove="f_on_reference_move" @pointerup="f_on_reference_up" @pointercancel="f_on_reference_up">
                    <rect class="size-ruler-hit" x="-8" y="-28" :width="o_ruler.n_px + 16" height="36" />
                    <path class="size-ruler-line size-outline" :d="o_ruler.s_path" />
                    <path class="size-ruler-line" :d="o_ruler.s_path" />
                    <text class="size-text" x="0" y="-15">0</text>
                    <text class="size-text size-text--end" :x="o_ruler.n_px" y="-15">{{ f_s_length(o_ruler.n_um) }}</text>
                </g>
            </g>

            <!-- calibration line -->
            <g v-if="b_window && s_tab === 'calibrate' && a_o_point__window.length" class="size-drawing size-drawing--calibrate">
                <template v-if="o_line__window">
                    <line class="size-line size-outline" :x1="o_line__window.n_x1" :y1="o_line__window.n_y1" :x2="o_line__window.n_x2" :y2="o_line__window.n_y2" />
                    <line class="size-line" :x1="o_line__window.n_x1" :y1="o_line__window.n_y1" :x2="o_line__window.n_x2" :y2="o_line__window.n_y2" />
                    <text v-if="a_o_point.length === 2" class="size-text size-text--middle"
                        :x="(o_line__window.n_x1 + o_line__window.n_x2) / 2" :y="(o_line__window.n_y1 + o_line__window.n_y2) / 2 - 10"
                    >{{ n_px__line.toFixed(1) }} px{{ n_um__known ? ' = ' + f_s_length(n_um__known) : '' }}</text>
                </template>
                <g v-for="(o_point, n_idx) in a_o_point__window" :key="n_idx" class="size-handle" :class="{ dragging: o_drag && o_drag.s_list === 'calibrate' && o_drag.n_idx === n_idx }"
                    :transform="'translate(' + o_point.n_x + ' ' + o_point.n_y + ')'"
                    @pointerdown="f_on_handle_down($event, 'calibrate', n_idx)" @pointermove="f_on_handle_move" @pointerup="f_on_handle_up" @pointercancel="f_on_handle_up">
                    <circle class="size-handle-hit" r="13" />
                    <path class="size-handle-mark size-outline" d="M-9 0H-3 M3 0H9 M0 -9V-3 M0 3V9" />
                    <path class="size-handle-mark" d="M-9 0H-3 M3 0H9 M0 -9V-3 M0 3V9" />
                    <circle class="size-handle-ring" r="6" />
                </g>
            </g>

            <!-- measured path -->
            <g v-if="b_window && s_tab === 'measure' && b_calibrated && a_o_point__measure_window.length" class="size-drawing size-drawing--measure">
                <polyline class="size-line size-outline" :points="s_points__measure" />
                <polyline class="size-line" :points="s_points__measure" />
                <text v-for="(o_segment, n_idx) in a_o_segment__measure" :key="'segment-' + n_idx" class="size-text size-text--middle" :x="o_segment.n_x" :y="o_segment.n_y - 8">{{ o_segment.s_label }}</text>
                <text v-if="o_total__measure" class="size-text size-text--total" :x="o_total__measure.n_x + 12" :y="o_total__measure.n_y + 20">{{ o_total__measure.s_label }}</text>
                <g v-for="(o_point, n_idx) in a_o_point__measure_window" :key="n_idx" class="size-handle" :class="{ dragging: o_drag && o_drag.s_list === 'measure' && o_drag.n_idx === n_idx }"
                    :transform="'translate(' + o_point.n_x + ' ' + o_point.n_y + ')'"
                    @pointerdown="f_on_handle_down($event, 'measure', n_idx)" @pointermove="f_on_handle_move" @pointerup="f_on_handle_up" @pointercancel="f_on_handle_up">
                    <circle class="size-handle-hit" r="13" />
                    <circle class="size-handle-dot size-outline" r="5" />
                    <circle class="size-handle-dot" r="5" />
                </g>
            </g>
        </svg>
        <canvas v-if="b_window" class="size-loupe" ref="el_loupe" v-show="o_pos__loupe" :width="n_px__loupe" :height="n_px__loupe" :style="o_style__loupe" aria-hidden="true"></canvas>
    `,
    data: function() {
        return {
            o_state: o_state,
            a_o_size_reference: a_o_size_reference,
            n_px__loupe: N_PX__LOUPE,
            // window pane: 'calibrate' | 'measure' | 'reference'
            s_tab: 'calibrate',
            // calibration line: 0, 1 or 2 points in camera pixels
            a_o_point: [],
            // measured path: points in camera pixels
            a_o_point__measure: [],
            // true while clicks on the live image place points of the active pane
            b_picking: false,
            // cursor in camera pixels while the next point is still open
            o_point__cursor: null,
            // point being dragged: { s_list, n_idx, n_x, n_y, b_moved }
            o_drag: null,
            // magnifier: camera point it shows and the window position it follows
            o_point__loupe: null,
            o_pos__loupe: null,
            b_unit__um_per_px: true,
            b_saved: false,
            b_snapshot_saving: false,
            s_error__snapshot: '',
            // object URL of an own reference image (this page only)
            s_url__image: '',
            n_ratio__image: 1,
            // bumped when the displayed image may have moved or changed size
            n_rev__layout: 0,
        };
    },
    computed: {
        o_size: function() {
            return o_state.o_size;
        },
        b_window: function() {
            return !!o_state.o_panel_visibility.scale;
        },
        a_o_tab: function() {
            return [
                { s_id: 'calibrate', s_icon: 'calibration', s_label: 'Calibrate', s_tooltip: 'Calibrate\nMark two points a known distance apart to store the size of one camera pixel.' },
                { s_id: 'measure', s_icon: 'measure', s_label: 'Measure', s_tooltip: 'Measure\nClick points on the live image and read the distances.' },
                { s_id: 'reference', s_icon: 'grid', s_label: 'Reference', b_running: this.b_reference,
                    s_tooltip: 'Reference\nGrid, ruler or an object of known size over the live image.' },
            ];
        },

        // ── stored scale ─────────────────────────────────────────
        n_um__per_px: function() {
            return o_state.o_calibration.n_um__per_px || 0;
        },
        n_px__per_um: function() {
            return this.n_um__per_px > 0 ? 1 / this.n_um__per_px : 0;
        },
        n_value__display: function() {
            let n = this.b_unit__um_per_px ? this.n_um__per_px : this.n_px__per_um;
            return n > 0 ? Number(n.toPrecision(6)) : '';
        },
        // how the stored scale was measured: points, known distance, snapshot (null when it was typed)
        o_record: function() {
            return o_state.o_calibration.o_scale__record || null;
        },
        // the thumbnail shows the part of the snapshot around the measured line
        s_viewbox__record: function() {
            let o_record = this.o_record;
            return o_record ? f_s_viewbox__line(o_record.a_o_point, o_record.n_scl_x, o_record.n_scl_y, 16 / 9) : '';
        },
        s_date__scale: function() {
            let n_ts_ms = o_state.o_calibration.n_ts_ms__scale;
            return n_ts_ms ? new Date(n_ts_ms).toLocaleDateString() : '';
        },
        s_warning__camera: function() {
            this.n_rev__layout;
            let o_snapshot = o_state.o_calibration.o_camera__scale;
            if (!o_snapshot || !this.o_view || !this.n_um__per_px) return '';
            if (f_b_camera_geometry_matches(o_snapshot)) return '';
            return 'The camera image was ' + o_snapshot.n_width + ' × ' + o_snapshot.n_height + ' px when the scale was stored and is '
                + this.o_view.n_scl_x + ' × ' + this.o_view.n_scl_y + ' px now. Calibrate again.';
        },
        // measuring and references are only honest with a scale that fits the current camera image
        b_calibrated: function() {
            return this.n_um__per_px > 0 && !this.s_warning__camera;
        },
        s_hint__uncalibrated: function() {
            return this.n_um__per_px > 0 ? 'calibrate again for this camera image (Calibrate tab)' : 'calibrate the size first (Calibrate tab)';
        },
        n_um__per_step__x: function() {
            let n_step__per_px = (o_state.a_n_step__per_px && o_state.a_n_step__per_px[f_n_motor__axis('x')]) || 0;
            return this.n_um__per_px && n_step__per_px ? this.n_um__per_px / n_step__per_px : 0;
        },
        n_um__per_step__y: function() {
            let n_step__per_px = (o_state.a_n_step__per_px && o_state.a_n_step__per_px[f_n_motor__axis('y')]) || 0;
            return this.n_um__per_px && n_step__per_px ? this.n_um__per_px / n_step__per_px : 0;
        },

        // ── live image geometry ──────────────────────────────────
        b_reference: function() {
            return !!(this.o_size.b_grid || this.o_size.b_ruler || this.o_size.s_object);
        },
        // box of the displayed camera image (window px) and the camera size (camera px)
        o_view: function() {
            this.n_rev__layout;
            // read the reactive camera size so a new resolution recalculates the box
            o_state.o_camera?.n_width;
            o_state.o_camera?.n_height;
            if (!o_state.b_streaming__webcam || !(this.b_window || this.b_reference)) return null;
            return this.f_o_view__now();
        },
        s_key__camera: function() {
            return this.o_view ? this.o_view.n_scl_x + 'x' + this.o_view.n_scl_y : '';
        },
        // window px per µm on the live image
        n_px__per_um__window: function() {
            let o_view = this.o_view;
            return o_view && this.b_calibrated ? o_view.o_rect.n_scl_x / o_view.n_scl_x / this.n_um__per_px : 0;
        },

        // ── calibrate ────────────────────────────────────────────
        n_um__known: function() {
            return f_n_um__known(this.o_size.n_known, this.o_size.s_unit);
        },
        n_px__line: function() {
            return this.a_o_point.length === 2 ? f_n_px__distance(this.a_o_point[0], this.a_o_point[1]) : 0;
        },
        o_scale__new: function() {
            return f_o_scale(this.n_um__known, this.n_px__line);
        },
        n_pct__error: function() {
            return f_n_pct__error(this.n_px__line);
        },
        n_um__line__stored: function() {
            return this.n_px__line * this.n_um__per_px;
        },
        a_o_point__window: function() {
            return this.f_a_o_point__window(this.a_o_point);
        },
        // the measured line, or the rubber band from the first point to the cursor
        o_line__window: function() {
            let a_o_point = this.a_o_point__window;
            if (!a_o_point.length) return null;
            let o_end = a_o_point[1] || (this.b_picking ? this.f_a_o_point__window([this.o_point__cursor])[0] : null);
            if (!o_end) return null;
            return { n_x1: a_o_point[0].n_x, n_y1: a_o_point[0].n_y, n_x2: o_end.n_x, n_y2: o_end.n_y };
        },
        s_hint__calibrate: function() {
            if (!o_state.b_streaming__webcam) return 'start a camera first';
            if (this.b_picking) {
                return this.a_o_point.length === 0
                    ? 'click the first point on the live image, or drag a line'
                    : 'click the second point';
            }
            if (this.a_o_point.length < 2) return 'press Set points, then mark two points a known distance apart';
            if (this.n_px__line < N_PX__LINE_MIN) return 'the line is too short: place the points further apart';
            if (!this.n_um__known) return 'enter the known distance of the line';
            if (this.b_saved) return 'saved. draw a line over another known distance to check it';
            return 'drag a point to fine-tune it, then save';
        },

        // ── measure ──────────────────────────────────────────────
        // while points are added the path runs on to the cursor
        a_o_point__measure_shown: function() {
            let a_o_point = this.a_o_point__measure.slice();
            if (this.b_picking && this.s_tab === 'measure' && this.o_point__cursor && a_o_point.length) a_o_point.push(this.o_point__cursor);
            return a_o_point;
        },
        n_px__measure: function() {
            return f_n_px__path(this.a_o_point__measure_shown);
        },
        n_um__measure: function() {
            return this.n_px__measure * this.n_um__per_px;
        },
        n_um__measure__direct: function() {
            let a_o_point = this.a_o_point__measure_shown;
            return a_o_point.length > 1 ? f_n_px__distance(a_o_point[0], a_o_point.at(-1)) * this.n_um__per_px : 0;
        },
        a_o_point__measure_window: function() {
            return this.f_a_o_point__window(this.a_o_point__measure);
        },
        s_points__measure: function() {
            return this.f_a_o_point__window(this.a_o_point__measure_shown).map(function(o_point) { return o_point.n_x + ',' + o_point.n_y; }).join(' ');
        },
        a_o_segment__measure: function() {
            let a_o_point = this.a_o_point__measure_shown;
            let a_o_point__window = this.f_a_o_point__window(a_o_point);
            let a_o_segment = [];
            for (let n_idx = 1; n_idx < a_o_point__window.length; n_idx++) {
                a_o_segment.push({
                    n_x: (a_o_point__window[n_idx - 1].n_x + a_o_point__window[n_idx].n_x) / 2,
                    n_y: (a_o_point__window[n_idx - 1].n_y + a_o_point__window[n_idx].n_y) / 2,
                    s_label: f_s_length(f_n_px__distance(a_o_point[n_idx - 1], a_o_point[n_idx]) * this.n_um__per_px),
                });
            }
            return a_o_segment;
        },
        // a path of several lines carries its total at the last point
        o_total__measure: function() {
            let a_o_point__window = this.f_a_o_point__window(this.a_o_point__measure_shown);
            if (a_o_point__window.length < 3) return null;
            return { n_x: a_o_point__window.at(-1).n_x, n_y: a_o_point__window.at(-1).n_y, s_label: 'total ' + f_s_length(this.n_um__measure) };
        },
        s_hint__measure: function() {
            if (!this.b_calibrated) return this.s_hint__uncalibrated;
            if (!o_state.b_streaming__webcam) return 'start a camera first';
            if (this.b_picking) return this.a_o_point__measure.length ? 'click the next point · Done or Esc to finish' : 'click the first point on the live image';
            if (!this.a_o_point__measure.length) return 'press Set points, then click two or more points on the live image';
            return 'drag a point to move it · click a point to remove it';
        },

        // ── reference ────────────────────────────────────────────
        o_grid: function() {
            let o_view = this.o_view;
            let n_px__per_um = this.n_px__per_um__window;
            if (!this.o_size.b_grid || !n_px__per_um) return null;
            let n_um = f_n_um__grid(this.o_size.n_um__grid, n_px__per_um);
            let n_px = n_um * n_px__per_um;
            if (!(n_px >= 4)) return { n_um: n_um, n_px: n_px, b_dense: true };
            // a line crosses the image centre; the 1.5 px inset keeps the outline inside its tile
            let f_n_origin = function(n_start, n_scl) {
                let n_centre = n_start + n_scl / 2;
                return n_centre - Math.ceil((n_centre - n_start) / n_px) * n_px - 1.5;
            };
            return {
                n_um: n_um, n_px: n_px, b_dense: false,
                n_x: f_n_origin(o_view.o_rect.n_x, o_view.o_rect.n_scl_x),
                n_y: f_n_origin(o_view.o_rect.n_y, o_view.o_rect.n_scl_y),
                s_path: 'M0 1.5H' + n_px + ' M1.5 0V' + n_px,
            };
        },
        o_ruler: function() {
            let o_view = this.o_view;
            let n_px__per_um = this.n_px__per_um__window;
            if (!this.o_size.b_ruler || !n_px__per_um) return null;
            let o_ruler = f_o_ruler(o_view.o_rect.n_scl_x, n_px__per_um);
            if (!o_ruler) return null;
            let o_rect = o_view.o_rect;
            let f_n_clamp = function(n, n_min, n_max) { return Math.min(Math.max(n, n_min), Math.max(n_min, n_max)); };
            let s_path = 'M0 0H' + o_ruler.n_px;
            for (let n_idx = 0; n_idx <= o_ruler.n_cnt__tick; n_idx++) {
                let b_end = n_idx === 0 || n_idx === o_ruler.n_cnt__tick;
                let n_scl_y = b_end ? 10 : (n_idx * 2 === o_ruler.n_cnt__tick ? 7 : 4);
                s_path += ' M' + (o_ruler.n_px * n_idx / o_ruler.n_cnt__tick) + ' 0V' + (-n_scl_y);
            }
            return {
                n_um: o_ruler.n_um, n_px: o_ruler.n_px, s_path: s_path,
                n_x: f_n_clamp(o_rect.n_x + this.o_size.o_pos__ruler.n_x * o_rect.n_scl_x, o_rect.n_x + 8, o_rect.n_x + o_rect.n_scl_x - o_ruler.n_px - 8),
                n_y: f_n_clamp(o_rect.n_y + this.o_size.o_pos__ruler.n_y * o_rect.n_scl_y, o_rect.n_y + 30, o_rect.n_y + o_rect.n_scl_y - 8),
            };
        },
        o_reference__selected: function() {
            let s_object = this.o_size.s_object;
            return a_o_size_reference.find(function(o_reference) { return o_reference.s_id === s_object; }) || null;
        },
        s_note__object: function() {
            if (this.o_size.s_object === 'image') return this.s_url__image ? 'drag it on the image' : 'choose a picture';
            return this.o_reference__selected ? this.o_reference__selected.s_size : '';
        },
        o_object: function() {
            let o_view = this.o_view;
            let n_px__per_um = this.n_px__per_um__window;
            let s_object = this.o_size.s_object;
            if (!s_object || !n_px__per_um) return null;
            let o_rect = o_view.o_rect;
            let o_object = {
                n_x: o_rect.n_x + this.o_size.o_pos__object.n_x * o_rect.n_scl_x,
                n_y: o_rect.n_y + this.o_size.o_pos__object.n_y * o_rect.n_scl_y,
            };
            if (s_object === 'image') {
                if (!this.s_url__image || !(this.o_size.n_um__image > 0)) return null;
                o_object.s_shape = 'image';
                o_object.n_scl_x = this.o_size.n_um__image * n_px__per_um;
                o_object.n_scl_y = o_object.n_scl_x * this.n_ratio__image;
                o_object.s_label = 'own image · ' + f_s_length(this.o_size.n_um__image) + ' wide';
            } else {
                let o_reference = this.o_reference__selected;
                if (!o_reference) return null;
                o_object.s_shape = o_reference.s_shape === 'band' ? 'rect' : o_reference.s_shape;
                // a band (hair, paper edge) has no length of its own: it crosses most of the view
                o_object.n_scl_x = o_reference.s_shape === 'band' ? o_rect.n_scl_x * 0.6 : o_reference.n_um__x * n_px__per_um;
                o_object.n_scl_y = o_reference.n_um__y * n_px__per_um;
                o_object.s_label = o_reference.s_name + ' · ' + o_reference.s_size;
            }
            // something only a few pixels large gets a ring so it can be found and grabbed
            o_object.n_radius__marker = Math.min(o_object.n_scl_x, o_object.n_scl_y) < 14 ? Math.max(o_object.n_scl_x, o_object.n_scl_y) / 2 + 12 : 0;
            if (o_object.n_radius__marker && o_object.n_scl_x > 40) o_object.n_radius__marker = 0;
            return o_object;
        },

        // ── magnifier ────────────────────────────────────────────
        // camera pixels are drawn at least 4× and always larger than on the live image
        n_zoom__loupe: function() {
            let o_view = this.o_view;
            let n_scale = o_view ? o_view.o_rect.n_scl_x / o_view.n_scl_x : 1;
            return Math.max(4, Math.ceil(n_scale * 3));
        },
        o_style__loupe: function() {
            let o_pos = this.o_pos__loupe;
            if (!o_pos) return {};
            let n_off = 26;
            let n_x = o_pos.n_x + n_off + N_PX__LOUPE > window.innerWidth ? o_pos.n_x - n_off - N_PX__LOUPE : o_pos.n_x + n_off;
            let n_y = o_pos.n_y + n_off + N_PX__LOUPE > window.innerHeight ? o_pos.n_y - n_off - N_PX__LOUPE : o_pos.n_y + n_off;
            return { left: n_x + 'px', top: n_y + 'px' };
        },
    },
    watch: {
        b_window: function(b_window) {
            if (!b_window) this.f_end_pick();
            this.n_rev__layout++;
        },
        // points belong to one camera image size; a new stream or resolution voids them
        s_key__camera: function(s_key, s_key__before) {
            if (s_key__before && s_key && s_key !== s_key__before) this.f_clear();
        },
        'o_state.b_streaming__webcam': function(b_streaming) {
            if (!b_streaming) this.f_clear();
        },
        b_calibrated: function(b_calibrated) {
            if (!b_calibrated && this.s_tab === 'measure') this.f_end_pick();
        },
    },
    methods: {
        f_s_number: f_s_number,
        f_s_length: f_s_length,
        f_close: function() {
            this.f_end_pick();
            o_state.o_panel_visibility.scale = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_set_tab: function(s_tab) {
            if (s_tab === this.s_tab || !['calibrate', 'measure', 'reference'].includes(s_tab)) return;
            this.f_end_pick();
            this.s_tab = s_tab;
        },
        f_save_size: function() {
            f_save_setting__debounced('o_size', o_state.o_size);
        },
        f_on_known_change: function() {
            this.b_saved = false;
            this.f_save_size();
        },

        // ── geometry ─────────────────────────────────────────────
        f_o_view__now: function() {
            let el_video = document.getElementById('webcamVideo');
            if (!el_video) return null;
            let o_geometry = f_o_camera_geometry(el_video);
            let o_rect = f_o_video_rect(el_video.getBoundingClientRect(), o_geometry.n_scl_x, o_geometry.n_scl_y);
            return o_rect ? { o_rect: o_rect, n_scl_x: o_geometry.n_scl_x, n_scl_y: o_geometry.n_scl_y } : null;
        },
        f_o_point__event: function(o_evt) {
            let o_view = this.f_o_view__now();
            return o_view ? f_o_point__camera(o_view.o_rect, o_view.n_scl_x, o_view.n_scl_y, o_evt.clientX, o_evt.clientY) : null;
        },
        f_a_o_point__window: function(a_o_point) {
            let o_view = this.o_view;
            if (!o_view) return [];
            return a_o_point.filter(Boolean).map(function(o_point) {
                return f_o_point__window(o_view.o_rect, o_view.n_scl_x, o_view.n_scl_y, o_point);
            });
        },

        // ── placing points (calibrate: two, measure: a path) ─────
        f_start_pick: function() {
            let o_self = this;
            if (!o_state.b_streaming__webcam || o_self.s_tab === 'reference') return;
            if (o_self.s_tab === 'measure' && !o_self.b_calibrated) return;
            if (o_self.s_tab === 'calibrate') {
                o_self.a_o_point = [];
                o_self.b_saved = false;
            }
            o_self.o_point__cursor = null;
            o_self.b_picking = true;
            o_self.n_rev__layout++;
            if (!o_self._f_on_keydown) {
                o_self._f_on_keydown = function(o_evt) { if (o_evt.key === 'Escape') o_self.f_cancel_pick(); };
                document.addEventListener('keydown', o_self._f_on_keydown);
            }
        },
        f_end_pick: function() {
            this.b_picking = false;
            this.o_point__cursor = null;
            this.o_drag = null;
            this._o_pos__down = null;
            this.f_hide_loupe();
            if (this._f_on_keydown) {
                document.removeEventListener('keydown', this._f_on_keydown);
                this._f_on_keydown = null;
            }
        },
        f_cancel_pick: function() {
            if (!this.b_picking) return;
            // one calibration point alone measures nothing
            if (this.s_tab === 'calibrate' && this.a_o_point.length < 2) this.a_o_point = [];
            this.f_end_pick();
        },
        f_clear: function() {
            this.f_end_pick();
            this.a_o_point = [];
            this.a_o_point__measure = [];
            this.b_saved = false;
        },
        f_on_pick_down: function(o_evt) {
            if (!this.b_picking || o_evt.button !== 0) return;
            o_evt.preventDefault();
            let o_point = this.f_o_point__event(o_evt);
            if (!o_point) return;
            if (this.s_tab === 'measure') {
                if (this.a_o_point__measure.length < N_CNT__POINT_MAX) this.a_o_point__measure.push(o_point);
                return;
            }
            this.a_o_point.push(o_point);
            if (this.a_o_point.length === 1) {
                // a press that travels before release draws the whole line in one gesture
                this._o_pos__down = { n_x: o_evt.clientX, n_y: o_evt.clientY };
                f_capture_pointer(o_evt);
            } else {
                this.f_take_snapshot();
                this.f_end_pick();
            }
        },
        f_on_pick_move: function(o_evt) {
            if (!this.b_picking) return;
            let o_point = this.f_o_point__event(o_evt);
            if (!o_point) return;
            this.o_point__cursor = o_point;
            this.f_show_loupe(o_point, o_evt);
        },
        f_on_pick_up: function(o_evt) {
            let o_pos__down = this._o_pos__down;
            this._o_pos__down = null;
            if (!this.b_picking || this.s_tab !== 'calibrate' || this.a_o_point.length !== 1 || !o_pos__down) return;
            if (Math.hypot(o_evt.clientX - o_pos__down.n_x, o_evt.clientY - o_pos__down.n_y) <= N_PX__DRAG_MIN) return;
            let o_point = this.f_o_point__event(o_evt);
            if (!o_point) return;
            this.a_o_point.push(o_point);
            this.f_take_snapshot();
            this.f_end_pick();
        },
        f_undo_measure: function() {
            this.a_o_point__measure.pop();
        },
        f_clear_measure: function() {
            this.a_o_point__measure = [];
            if (this.s_tab === 'measure') this.f_end_pick();
        },

        // ── moving a placed point ────────────────────────────────
        f_on_handle_down: function(o_evt, s_list, n_idx) {
            if (this.b_picking || o_evt.button !== 0) return;
            o_evt.preventDefault();
            this.o_drag = { s_list: s_list, n_idx: n_idx, n_x: o_evt.clientX, n_y: o_evt.clientY, b_moved: false };
            f_capture_pointer(o_evt);
        },
        f_on_handle_move: function(o_evt) {
            let o_drag = this.o_drag;
            if (!o_drag) return;
            if (!o_drag.b_moved && Math.hypot(o_evt.clientX - o_drag.n_x, o_evt.clientY - o_drag.n_y) <= 3) return;
            let o_point = this.f_o_point__event(o_evt);
            if (!o_point) return;
            o_drag.b_moved = true;
            this.b_saved = false;
            (o_drag.s_list === 'measure' ? this.a_o_point__measure : this.a_o_point)[o_drag.n_idx] = o_point;
            this.f_show_loupe(o_point, o_evt);
        },
        f_on_handle_up: function() {
            let o_drag = this.o_drag;
            this.o_drag = null;
            this.f_hide_loupe();
            // a click on a point of the measured path removes it
            if (o_drag && o_drag.s_list === 'measure' && !o_drag.b_moved) this.a_o_point__measure.splice(o_drag.n_idx, 1);
            // a fine-tuned calibration point was judged on the image of this moment
            if (o_drag && o_drag.s_list === 'calibrate' && o_drag.b_moved) this.f_take_snapshot();
        },

        // ── moving the ruler or the reference object ─────────────
        f_on_reference_down: function(o_evt, s_key) {
            let o_item = s_key === 'ruler' ? this.o_ruler : this.o_object;
            if (!this.b_window || this.b_picking || o_evt.button !== 0 || !o_item) return;
            o_evt.preventDefault();
            this._o_drag__reference = { s_key: s_key, n_x: o_evt.clientX - o_item.n_x, n_y: o_evt.clientY - o_item.n_y };
            f_capture_pointer(o_evt);
        },
        f_on_reference_move: function(o_evt) {
            let o_drag = this._o_drag__reference;
            let o_view = o_drag ? this.f_o_view__now() : null;
            if (!o_view) return;
            let f_n_fraction = function(n) { return Math.min(1, Math.max(0, n)); };
            this.o_size['o_pos__' + o_drag.s_key] = {
                n_x: f_n_fraction((o_evt.clientX - o_drag.n_x - o_view.o_rect.n_x) / o_view.o_rect.n_scl_x),
                n_y: f_n_fraction((o_evt.clientY - o_drag.n_y - o_view.o_rect.n_y) / o_view.o_rect.n_scl_y),
            };
        },
        f_on_reference_up: function() {
            if (!this._o_drag__reference) return;
            this._o_drag__reference = null;
            this.f_save_size();
        },
        f_on_image_file: function(o_evt) {
            let o_self = this;
            let o_file = o_evt.target.files && o_evt.target.files[0];
            if (!o_file) return;
            let s_url = URL.createObjectURL(o_file);
            let o_image = new Image();
            o_image.onload = function() {
                if (o_self.s_url__image) URL.revokeObjectURL(o_self.s_url__image);
                o_self.n_ratio__image = o_image.naturalWidth ? o_image.naturalHeight / o_image.naturalWidth : 1;
                o_self.s_url__image = s_url;
            };
            o_image.onerror = function() { URL.revokeObjectURL(s_url); };
            o_image.src = s_url;
        },

        // ── magnifier ────────────────────────────────────────────
        f_show_loupe: function(o_point, o_evt) {
            this.o_point__loupe = o_point;
            this.o_pos__loupe = { n_x: o_evt.clientX, n_y: o_evt.clientY };
            if (!this._n_id__loupe) this.f_draw_loupe();
        },
        f_hide_loupe: function() {
            this.o_point__loupe = null;
            this.o_pos__loupe = null;
            if (this._n_id__loupe) cancelAnimationFrame(this._n_id__loupe);
            this._n_id__loupe = 0;
        },
        // redrawn every frame while visible, so the magnified image stays live
        f_draw_loupe: function() {
            let o_self = this;
            o_self._n_id__loupe = 0;
            let el_canvas = o_self.$refs.el_loupe;
            let o_point = o_self.o_point__loupe;
            if (!el_canvas || !o_point) return;
            let o_ctx = el_canvas.getContext('2d');
            let n_px = N_PX__LOUPE;
            let n_scl__source = n_px / o_self.n_zoom__loupe;
            o_ctx.imageSmoothingEnabled = false;
            o_ctx.fillStyle = '#000';
            o_ctx.fillRect(0, 0, n_px, n_px);
            try {
                let el_source = f_el_camera_frame();
                if (el_source) o_ctx.drawImage(el_source, o_point.n_x - n_scl__source / 2, o_point.n_y - n_scl__source / 2, n_scl__source, n_scl__source, 0, 0, n_px, n_px);
            } catch (o_error) { /* no decoded frame yet */ }
            // crosshair with a free centre, dark under light so it shows on any specimen
            for (let o_stroke of [{ s_color: 'rgba(0,0,0,0.75)', n_width: 3 }, { s_color: '#fff', n_width: 1 }]) {
                o_ctx.strokeStyle = o_stroke.s_color;
                o_ctx.lineWidth = o_stroke.n_width;
                o_ctx.beginPath();
                o_ctx.moveTo(0, n_px / 2); o_ctx.lineTo(n_px / 2 - 8, n_px / 2);
                o_ctx.moveTo(n_px / 2 + 8, n_px / 2); o_ctx.lineTo(n_px, n_px / 2);
                o_ctx.moveTo(n_px / 2, 0); o_ctx.lineTo(n_px / 2, n_px / 2 - 8);
                o_ctx.moveTo(n_px / 2, n_px / 2 + 8); o_ctx.lineTo(n_px / 2, n_px);
                o_ctx.stroke();
            }
            o_self._n_id__loupe = requestAnimationFrame(function() { o_self.f_draw_loupe(); });
        },

        // ── snapshot of the measurement ──────────────────────────
        // the camera frame the points were set on, kept in memory until Save
        f_take_snapshot: function() {
            this._el_canvas__snapshot = null;
            let o_view = this.f_o_view__now();
            if (!o_view) return;
            try {
                let el_canvas = document.createElement('canvas');
                el_canvas.width = o_view.n_scl_x;
                el_canvas.height = o_view.n_scl_y;
                el_canvas.getContext('2d').drawImage(f_el_camera_frame(), 0, 0, o_view.n_scl_x, o_view.n_scl_y);
                this._el_canvas__snapshot = el_canvas;
            } catch (o_error) { /* no decoded frame: the scale can still be saved */ }
        },
        // written next to the scans; the stored scale keeps the path
        f_save_snapshot: async function(o_record, n_ts_ms) {
            let o_self = this;
            let el_canvas = o_self._el_canvas__snapshot;
            o_self.s_error__snapshot = '';
            if (!el_canvas) {
                o_self.s_error__snapshot = 'scale saved, without a snapshot: the camera gave no image';
                return;
            }
            o_self.b_snapshot_saving = true;
            try {
                let el_canvas__copy = document.createElement('canvas');
                el_canvas__copy.width = el_canvas.width;
                el_canvas__copy.height = el_canvas.height;
                el_canvas__copy.getContext('2d').drawImage(el_canvas, 0, 0);
                f_draw_measurement(el_canvas__copy, o_record.a_o_point,
                    f_s_length(o_record.n_um__known) + ' = ' + o_record.n_px__line.toFixed(1) + ' px  ->  ' + f_s_number(o_record.n_um__known / o_record.n_px__line) + ' µm/px');
                let o_blob = await new Promise(function(resolve) { el_canvas__copy.toBlob(resolve, 'image/jpeg', 0.92); });
                if (!o_blob) throw new Error('the image could not be encoded');
                let o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('size_calibration_create_folder', {}), 4000);
                if (!o_resp.v_result || !o_resp.v_result.s_path_folder) throw new Error(o_resp.error || 'the folder could not be created');
                let s_filename = 'size_calibration_' + f_s_ts__file(n_ts_ms) + '.jpg';
                await f_save_image(o_blob, o_resp.v_result.s_path_folder, s_filename);
                // a newer calibration may have replaced the one this snapshot belongs to
                if (o_state.o_calibration.o_scale__record && o_state.o_calibration.n_ts_ms__scale === n_ts_ms) {
                    o_state.o_calibration.o_scale__record.s_path_image = o_resp.v_result.s_path_folder + '/' + s_filename;
                    f_save_calibration();
                }
            } catch (o_error) {
                let s_reason = o_error.message || String(o_error);
                // an app server started before this feature does not answer the folder request
                if (s_reason.includes('timed out')) s_reason = 'restart the app server (deno task server) to enable snapshots';
                o_self.s_error__snapshot = 'scale saved, but the snapshot was not: ' + s_reason;
            }
            o_self.b_snapshot_saving = false;
        },

        // ── storing the scale ────────────────────────────────────
        // o_record: how it was measured, null for a typed value
        f_store: function(n_um__per_px, o_record = null) {
            o_state.o_calibration.n_um__per_px = n_um__per_px;
            o_state.o_calibration.n_ts_ms__scale = Date.now();
            // remembered so a later change of camera resolution can be pointed out
            o_state.o_calibration.o_camera__scale = o_state.b_streaming__webcam ? f_o_camera_geometry_snapshot() : null;
            o_state.o_calibration.o_scale__record = o_record;
            this.s_error__snapshot = '';
            f_save_calibration();
        },
        f_save: function() {
            let o_scale = this.o_scale__new;
            if (!o_scale) return;
            let o_record = {
                a_o_point: this.a_o_point.map(function(o_point) { return { n_x: o_point.n_x, n_y: o_point.n_y }; }),
                n_um__known: this.n_um__known,
                n_px__line: this.n_px__line,
                // size of the snapshot in camera pixels, so its thumbnail can show the line
                n_scl_x: this._el_canvas__snapshot ? this._el_canvas__snapshot.width : 0,
                n_scl_y: this._el_canvas__snapshot ? this._el_canvas__snapshot.height : 0,
                s_path_image: '',
            };
            // the scale is stored at once; the snapshot follows and may fail on its own
            this.f_store(o_scale.n_um__per_px, o_record);
            this.b_saved = true;
            return this.f_save_snapshot(o_record, o_state.o_calibration.n_ts_ms__scale);
        },
        f_on_input: function(s_value) {
            let n_value = parseFloat(s_value);
            if (!Number.isFinite(n_value) || n_value <= 0) return;
            this.f_store(this.b_unit__um_per_px ? n_value : 1 / n_value);
        },
    },
    mounted: function() {
        let o_self = this;
        o_self._f_on_resize = function() { o_self.n_rev__layout++; };
        window.addEventListener('resize', o_self._f_on_resize);
        window.addEventListener('toolbar-resize', o_self._f_on_resize);
        // the live image also changes its box without a window resize (training mode, crop)
        let el_video = document.getElementById('webcamVideo');
        if (el_video && typeof ResizeObserver !== 'undefined') {
            o_self._o_observer = new ResizeObserver(o_self._f_on_resize);
            o_self._o_observer.observe(el_video);
        }
    },
    beforeUnmount: function() {
        this.f_end_pick();
        window.removeEventListener('resize', this._f_on_resize);
        window.removeEventListener('toolbar-resize', this._f_on_resize);
        if (this._o_observer) this._o_observer.disconnect();
        if (this.s_url__image) URL.revokeObjectURL(this.s_url__image);
    },
};

export { o_component__scale };
