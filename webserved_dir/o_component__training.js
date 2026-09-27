import {
    f_o_box_from_crop,
    f_o_box_to_crop,
    f_o_crop,
    f_o_crop_bounds,
    f_o_crop_point,
} from './training_crop.module.js';
import { o_component__training_yolo } from './o_component__training_yolo.js';
import { f_n_motor__axis, f_send_esp_stop_all, f_set_mouse_jog, o_state } from './index.js';
import { f_o_capture__frame } from './o_capture.module.js';
import { f_o_camera_snapshot, f_o_camera_track } from './o_camera.module.js';
import { f_o_box, f_o_box_edit, f_o_box_handle, f_validate_sample } from './training_data.module.js';
import { f_a_grid, f_a_plane, f_focus_sweep, f_o_video_rect } from './training_workflow.module.js';
import { f_move_training } from './training_motion.module.js';
import { f_action, o_actions } from './o_actions.js';

let f_o_request = async function (s_action, o_option, s_dataset) {
    if (s_dataset) {
        s_action += (s_action.includes('?') ? '&' : '?') + 'dataset=' + encodeURIComponent(s_dataset);
    }
    let o_response = await fetch('/api/training/' + s_action, o_option);
    let o_result = await o_response.json();
    if (!o_response.ok) throw new Error(o_result.s_error || 'Training data request failed');
    return o_result;
};
let o_component__training = {
    name: 'component-training',
    components: { o_component__training_yolo },
    template: `
    <teleport v-for="o_view in a_o_view" :key="o_view.s_id" :to="o_view.s_target">
    <svg class="training-live-overlay" :data-view="o_view.s_id"
        :aria-label="o_view.s_id==='zoom'?'Draw training boxes on the zoom preview':'Draw training boxes on the live camera image'" preserveAspectRatio="none"
        :style="o_view.o_style"
        :viewBox="[o_view.n_x, o_view.n_y, o_view.n_width, o_view.n_height].join(' ')" :class="'training-cursor-'+(b_crop?'crop':s_hover_view===o_view.s_id?s_cursor:(b_shift?'grab':b_ctrl?'draw':'idle'))"
        @pointerdown="f_down($event,o_view)" @pointermove="f_move($event,o_view)" @pointerup="f_up($event,o_view)"
        @pointercancel="f_cancel_drag" @lostpointercapture="f_cancel_drag" @pointerleave="o_hover=null" @contextmenu.prevent>
        <path v-if="s_crop_mask" :d="s_crop_mask" class="training-crop-mask" fill="black" fill-opacity="0.8" fill-rule="evenodd" />
        <rect v-if="o_crop_display" :x="o_crop_display.n_x" :y="o_crop_display.n_y" :width="o_crop_display.n_scl_x" :height="o_crop_display.n_scl_y" fill="none" stroke="white" stroke-dasharray="8 4" vector-effect="non-scaling-stroke" />
        <g v-if="s_guide && s_hover_view===o_view.s_id" class="training-pointer-guide" aria-hidden="true">
            <path :d="s_guide" class="training-guide-outline" vector-effect="non-scaling-stroke" />
            <path :d="s_guide" class="training-guide-line" vector-effect="non-scaling-stroke" />
        </g>
        <g v-for="(o_box,n_idx) in a_o_prediction" :key="'prediction-'+n_idx" class="training-yolo-prediction">
            <rect :x="o_box.n_x*n_scl_x" :y="o_box.n_y*n_scl_y" :width="o_box.n_scl_x*n_scl_x" :height="o_box.n_scl_y*n_scl_y"
                fill="none" stroke="#00cfff" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" />
            <text :x="o_box.n_x*n_scl_x+3" :y="o_box.n_y*n_scl_y+12*n_scl_x/o_view.o_full.n_scl_x" fill="#00cfff" :font-size="12*n_scl_x/o_view.o_full.n_scl_x">{{ o_box.s_label }} {{ Math.round(o_box.n_confidence*100) }}%</text>
        </g>
        <g v-for="o_box in a_o_box__display" :key="o_box.s_id">
            <rect :x="o_box.n_x*n_scl_x" :y="o_box.n_y*n_scl_y" :width="o_box.n_scl_x*n_scl_x" :height="o_box.n_scl_y*n_scl_y"
                fill="transparent" :stroke="o_box.s_color" stroke-width="2" vector-effect="non-scaling-stroke" />
            <text :x="o_box.n_x*n_scl_x+3" :y="o_box.n_y*n_scl_y+12*n_scl_y/o_view.o_full.n_scl_y" :fill="o_box.s_color" :font-size="12*n_scl_x/o_view.o_full.n_scl_x">{{ o_box.s_label }}</text>
        </g>
        <rect v-for="o_box in a_o_box" :key="'handle-'+o_box.s_id" class="training-resize-handle"
            :x="f_o_handle(o_box,o_view).n_x*n_scl_x" :y="f_o_handle(o_box,o_view).n_y*n_scl_y"
            :width="f_o_handle(o_box,o_view).n_scl_x*n_scl_x" :height="f_o_handle(o_box,o_view).n_scl_y*n_scl_y"
            :fill="o_box.s_color" stroke="#101010" stroke-width="1" vector-effect="non-scaling-stroke" />
    </svg>
    </teleport>
    <div class="overlay-panel panel-training" :class="{visible: o_state.o_panel_visibility.training}">
        <div class="panel-header"><h2>Training</h2><button class="panel-close" aria-label="Close training data" :disabled="b_busy" @click="o_state.o_panel_visibility.training = false">&times;</button></div>
        <div class="panel-body">
            <section class="training-dataset">
                <label>Dataset
                    <select :value="s_dataset" @change="f_switch_dataset($event.target.value)" :disabled="b_busy" aria-label="Training dataset">
                        <option value="" disabled>Select a dataset</option>
                        <option v-for="o_dataset in a_o_dataset" :key="o_dataset.s_id" :value="o_dataset.s_id">{{ o_dataset.s_name }}</option>
                    </select>
                </label>
                <div class="training-label">
                    <input v-model="s_name__dataset" maxlength="100" placeholder="New dataset name" aria-label="New dataset name" :disabled="b_busy">
                    <button @click="f_create_dataset" :disabled="b_busy || !s_name__dataset.trim()">Create dataset</button>
                </div>
            </section>
            <fieldset :disabled="b_busy || !s_dataset">
                <div class="training-label" v-for="(o_label, n_idx) in a_o_label" :key="o_label.s_id">
                    <input v-model="o_label.s_name" maxlength="100" :aria-label="'Label ' + (n_idx + 1)">
                    <button :class="{selected:s_label===o_label.s_id}" @click="s_label=o_label.s_id" :aria-pressed="s_label===o_label.s_id" :aria-label="'Select label ' + (n_idx+1)">{{ f_s_shortcut(n_idx) }}</button>
                    <input type="color" v-model="o_label.s_color" :aria-label="'Color for label ' + (n_idx + 1)">
                    <button @click="f_remove_label(o_label.s_id)" :disabled="a_o_label.length === 1" :aria-label="'Remove label ' + (n_idx + 1)">−</button>
                </div>
                <button @click="f_add_label">+ Label</button>
                <div class="training-axis-head"><span>Axis</span><span>Regions</span><span>Steps</span><span>Test move</span></div>
                <div class="training-axis" v-for="s_axis in ['x','y']" :key="s_axis">
                    <b>{{ s_axis.toUpperCase() }}</b>
                    <input type="number" min="1" max="100" v-model.number="o_grid_config[s_axis]" @change="f_reset_grid" :aria-label="s_axis.toUpperCase()+' regions'">
                    <input type="number" min="1" max="1000000" v-model.number="o_grid_config['n_step_'+s_axis]" @change="f_reset_grid" :aria-label="s_axis.toUpperCase()+' step distance'">
                    <div><button @click="f_jog(s_axis,-1)" :disabled="!b_stage_ready" :aria-label="'Test '+s_axis+' negative'">{{ s_axis==='x'?'←':'↑' }}</button><button @click="f_jog(s_axis,1)" :disabled="!b_stage_ready" :aria-label="'Test '+s_axis+' positive'">{{ s_axis==='x'?'→':'↓' }}</button></div>
                </div>
                <div class="training-navigation">
                    <div class="training-grid" :style="{gridTemplateColumns:'repeat('+o_grid_config.x+', 1fr)'}" aria-label="Region coverage">
                        <span v-for="o_cell in a_o_cell" :key="o_cell.n_idx" :class="{current:o_cell.n_idx===n_region, captured:a_n_captured.includes(o_cell.n_idx), visited:a_n_visited.includes(o_cell.n_idx)}"
                            :style="{gridColumn:o_cell.n_x+1,gridRow:o_cell.n_y+1}" :title="'Region '+(o_cell.n_idx+1)+(a_n_captured.includes(o_cell.n_idx)?' · captured':'')">{{ o_cell.n_idx+1 }}</span>
                    </div>
                    <button @click="f_next" :disabled="!b_stage_ready || n_region>=a_o_cell.length-1">Next →</button>
                </div>
                <small>Region {{ n_region+1 }} / {{ a_o_cell.length }} · green = captured · dot = visited</small>
                <button class="training-reset" @click="f_reset_grid">Start new grid here</button>
                <div class="training-focus">
                    <label>Planes <input type="number" min="1" max="100" v-model.number="n_plane" aria-label="Focus plane count"></label>
                    <button @click="f_set_focus('start')" :disabled="!b_focus_ready">Start<br><small>{{ n_focus_start ?? 'unset' }}</small></button>
                    <button @click="f_set_focus('end')" :disabled="!b_focus_ready">End<br><small>{{ n_focus_end ?? 'unset' }}</small></button>
                    <button @click="f_test_focus" :disabled="!b_focus_ready || n_focus_start===null || n_focus_end===null">Test</button>
                </div>
                <small>Set Start and End at the current focus. Test and Capture return here afterward.</small>
                <div class="training-label">
                    <button @click="f_toggle_crop" :disabled="!o_live">{{ b_crop ? 'Cancel crop' : 'Crop' }}</button>
                    <button @click="f_set_crop(null)" :disabled="!o_crop && !b_crop">Clear crop</button>
                    <span v-if="o_crop">{{ o_crop.n_scl_x }} × {{ o_crop.n_scl_y }} px</span>
                </div>
                <p v-if="b_crop">{{ o_crop_start ? 'Click the opposite corner to finish the crop.' : 'Click the first corner of the crop on either live view.' }} Escape cancels.</p>
                <small>Only the crop is saved and used for YOLO. Annotate every target inside it. Changing the crop clears unsaved boxes.</small>
                <p>Hold Ctrl and drag on the live image or zoom preview to draw. Number keys select labels. Drag the bottom-left square to resize; Shift-drag a box to move it. Plain dragging in the zoom preview pans.</p>
                <div v-for="(o_box,n_idx) in a_o_box" :key="o_box.s_id" class="training-label">
                    <span :style="{color:o_box.s_color}">{{ n_idx+1 }}. {{ o_box.s_label }}</span>
                    <button @click="a_o_box.splice(n_idx,1)">Delete box</button>
                </div>
                <button class="training-capture" @click="f_capture" :disabled="b_crop || !o_live || !a_o_box.length || !b_focus_ready || n_focus_start===null || n_focus_end===null">Capture</button>
            </fieldset>
            <button v-if="o_state.b_training_busy" class="training-stop" @click="f_stop">Stop</button>
            <p role="status">{{ s_message }}</p>
            <p class="record-error" role="alert" v-if="s_error">{{ s_error }}</p>
            <o_component__training_yolo v-if="o_state.o_panel_visibility.training && s_dataset" :key="s_dataset" :s_dataset="s_dataset" :b_capture_busy="b_busy || b_crop" :o_crop="o_crop" @prediction="a_o_prediction=$event" />
            <div v-if="a_o_prediction.length" class="training-label">
                <button @click="f_accept_prediction" :disabled="b_busy || !!o_start">Use detections as boxes</button>
                <button @click="a_o_prediction=[]">Clear detections</button>
            </div>
            <div class="training-label"><h3>Saved capture ({{ a_o_sample.length }})</h3><button @click="f_refresh" :disabled="b_busy">Refresh</button>
                <a :href="'/api/training/export?dataset='+encodeURIComponent(s_dataset)" download="training-data.tar" v-if="a_o_sample.length">Export YOLO dataset</a></div>
            <p v-if="a_o_sample.length">Export includes all quality ratings. Each capture retains its own label names and colors.</p>
            <article v-for="o_saved in a_o_sample" :key="o_saved.s_id" class="training-saved">
                <div class="training-filmstrip">
                    <svg :viewBox="'0 0 ' + o_saved.n_scl_x + ' ' + o_saved.n_scl_y" aria-label="Annotated capture">
                        <image :href="f_s_image(o_saved)" :width="o_saved.n_scl_x" :height="o_saved.n_scl_y" />
                        <rect v-for="o_box in o_saved.a_o_box" :key="o_box.s_id"
                            :x="o_box.n_x * o_saved.n_scl_x" :y="o_box.n_y * o_saved.n_scl_y"
                            :width="o_box.n_scl_x * o_saved.n_scl_x" :height="o_box.n_scl_y * o_saved.n_scl_y"
                            fill="none" :stroke="o_box.s_color" stroke-width="2" vector-effect="non-scaling-stroke" />
                    </svg>
                    <div class="training-crop-row"><figure v-for="o_box in o_saved.a_o_box" :key="o_box.s_id">
                        <svg :viewBox="[o_box.n_x * o_saved.n_scl_x, o_box.n_y * o_saved.n_scl_y, o_box.n_scl_x * o_saved.n_scl_x, o_box.n_scl_y * o_saved.n_scl_y].join(' ')">
                            <image :href="f_s_image(o_saved)" :width="o_saved.n_scl_x" :height="o_saved.n_scl_y" />
                        </svg><figcaption>{{ o_box.s_label }}</figcaption>
                    </figure></div>
                </div>
                <small>{{ new Date(o_saved.n_ts_ms).toLocaleString() }} · Region {{ (o_saved.o_region?.n_idx ?? 0)+1 }} · Plane {{ (o_saved.n_plane ?? 0)+1 }}</small>
                <div class="training-label">
                    <label>Quality <select :value="o_saved.s_quality" @change="f_tag(o_saved, $event.target.value)" :disabled="b_busy">
                        <option value="unrated">Unrated</option><option value="bad">Bad</option><option value="medium">Medium</option><option value="good">Good</option>
                    </select></label>
                    <button @click="f_delete(o_saved)" :disabled="b_busy">Delete capture</button>
                    <a :href="f_s_image(o_saved)" :download="o_saved.s_id + '.png'">PNG</a>
                </div>
            </article>
        </div>
    </div>`,
    data: function () {
        let a_o_label = [{ s_id: crypto.randomUUID(), s_name: 'target', s_color: '#00ff88' }];
        try {
            let a_o_saved = JSON.parse(localStorage.getItem('omm.training.label'));
            if (
                Array.isArray(a_o_saved) && a_o_saved.length &&
                a_o_saved.every((o) =>
                    typeof o.s_id === 'string' && typeof o.s_name === 'string' &&
                    /^#[0-9a-f]{6}$/i.test(o.s_color)
                )
            ) a_o_label = a_o_saved;
        } catch (_) { /* use the default palette */ }
        return {
            o_state,
            a_o_label,
            s_label: a_o_label[0].s_id,
            a_o_box: [],
            a_o_prediction: [],
            o_edit: null,
            o_hover: null,
            o_crop: null,
            b_crop: false,
            o_crop_start: null,
            b_ctrl: false,
            b_shift: false,
            o_zoom_view: null,
            s_hover_view: 'live',
            o_start: null,
            o_end: null,
            a_o_sample: [],
            a_o_dataset: [],
            s_dataset: '',
            s_name__dataset: '',
            b_dataset_loading: false,
            b_busy: false,
            s_error: '',
            s_message: '',
            n_revision: 0,
            o_live: null,
            n_scl_x: 0,
            n_scl_y: 0,
            o_grid_config: { x: 5, y: 4, n_step_x: 70, n_step_y: 60 },
            n_region: 0,
            o_origin: null,
            s_grid: crypto.randomUUID(),
            a_n_captured: [],
            a_n_visited: [0],
            n_focus_start: null,
            n_focus_end: null,
            n_plane: 5,
            b_grid_move: false,
        };
    },
    computed: {
        o_crop_bounds() {
            return f_o_crop_bounds(this.o_crop, this.n_scl_x, this.n_scl_y);
        },
        o_crop_display() {
            return this.b_crop && this.o_crop_start && this.o_hover
                ? f_o_crop(this.o_crop_start, this.o_hover, this.n_scl_x, this.n_scl_y)
                : this.o_crop;
        },
        s_crop_mask() {
            let o = this.o_crop_display;
            if (!o) return '';
            return `M0 0H${this.n_scl_x}V${this.n_scl_y}H0Z M${o.n_x} ${o.n_y}h${o.n_scl_x}v${o.n_scl_y}h${-o
                .n_scl_x}Z`;
        },
        a_o_view() {
            if (!o_state.o_panel_visibility.training || !this.o_live) return [];
            let o = this.o_live;
            let a_o = [{
                s_id: 'live',
                s_target: 'body',
                n_x: 0,
                n_y: 0,
                n_width: this.n_scl_x,
                n_height: this.n_scl_y,
                o_full: o,
                o_style: {
                    left: o.n_x + 'px',
                    top: o.n_y + 'px',
                    width: o.n_scl_x + 'px',
                    height: o.n_scl_y + 'px',
                    pointerEvents: !this.b_crop && o_state.o_zoom?.b_selecting ? 'none' : 'auto',
                },
            }];
            if (o_state.o_panel_visibility.zoom && this.o_zoom_view) a_o.push(this.o_zoom_view);
            return a_o;
        },
        s_guide: function () {
            let o_point = this.o_hover;
            if (!o_point || o_point.n_x < 0 || o_point.n_x > 1 || o_point.n_y < 0 || o_point.n_y > 1) {
                return '';
            }
            return 'M 0 ' + o_point.n_y * this.n_scl_y + ' H ' + this.n_scl_x +
                ' M ' + o_point.n_x * this.n_scl_x + ' 0 V ' + this.n_scl_y;
        },
        s_cursor: function () {
            if (this.o_edit) return this.o_edit.s_mode === 'move' ? 'grabbing' : 'resize';
            if (this.o_live && this.o_hover && this.f_o_hit(this.o_hover, false)) return 'resize';
            return this.b_shift ? 'grab' : this.b_ctrl ? 'draw' : 'idle';
        },
        s_xy: function () {
            return JSON.stringify([
                o_state.b_connected__esp,
                ...['x', 'y'].map((s_axis) => {
                    let n_motor = f_n_motor__axis(s_axis);
                    return [
                        n_motor,
                        o_state.a_o_motor[n_motor]?.n_position,
                        o_state.a_o_motor[n_motor]?.b_running,
                    ];
                }),
            ]);
        },
        s_focus_axis: function () {
            return JSON.stringify([o_state.b_connected__esp, f_n_motor__axis('z')]);
        },
        b_moving: function () {
            return o_state.a_o_motor.some((o) => o.b_running);
        },
        b_stage_ready: function () {
            return o_state.b_connected__esp && !this.b_moving && !o_state.b_scanning && !o_state.b_flashing &&
                !o_state.o_record?.b_running;
        },
        b_focus_ready: function () {
            return this.b_stage_ready && f_n_motor__axis('z') !== null;
        },
        a_o_cell: function () {
            try {
                return f_a_grid(this.o_grid_config.x, this.o_grid_config.y).map((o, n_idx) => ({
                    ...o,
                    n_idx,
                }));
            } catch (_) {
                return [];
            }
        },
        a_o_box__display: function () {
            let o_label = this.a_o_label.find((o) => o.s_id === this.s_label);
            return !this.o_edit && this.o_start && this.o_end && o_label
                ? [...this.a_o_box, f_o_box(this.o_start, this.o_end, o_label)]
                : this.a_o_box;
        },
    },
    watch: {
        s_xy: {
            flush: 'sync',
            handler: function () {
                this.f_invalidate('XY changed. Draw new boxes on the live image.');
                if (!this.b_grid_move) this.f_reset_grid();
            },
        },
        s_focus_axis: {
            flush: 'sync',
            handler: function () {
                this.n_focus_start = null;
                this.n_focus_end = null;
                this.f_stop();
            },
        },
        'o_state.s_id__webcam_device': function () {
            this.f_invalidate('Camera changed. Draw new boxes.');
            this.f_stop();
        },
        'o_state.n_cnt__stop_all': {
            flush: 'sync',
            handler: function () {
                this._o_abort?.abort();
            },
        },
        'o_state.o_panel_visibility.training': function (b_visible) {
            this.f_visibility(b_visible);
        },
        a_o_label: {
            deep: true,
            handler: function (a_o_label) {
                try {
                    if (this.s_dataset && !this.b_dataset_loading) {
                        localStorage.setItem(
                            'omm.training.label.' + this.s_dataset,
                            JSON.stringify(a_o_label),
                        );
                    }
                } catch (_) {}
            },
        },
    },
    mounted: function () {
        for (let n_idx = 0; n_idx < 9; n_idx++) {
            let s_id = 'training.label.' + (n_idx + 1);
            let f_select = () => {
                if (
                    o_state.o_panel_visibility.training && !this.b_busy && !this.o_start &&
                    this.a_o_label[n_idx]
                ) this.s_label = this.a_o_label[n_idx].s_id;
            };
            let o_existing = o_actions.a_o_action.find((o) => o.id === s_id);
            if (o_existing) {
                o_existing.invoke = (n, s_phase) => {
                    if (s_phase !== 'release') f_select();
                };
                o_existing.accept = () => o_state.o_panel_visibility.training;
            } else {f_action({
                    id: s_id,
                    name: 'Training label ' + (n_idx + 1),
                    category: 'Training',
                    bindings: [{ source: 'keyboard', keys: [String(n_idx + 1)] }],
                    accept: () => o_state.o_panel_visibility.training,
                }, f_select);}
        }
        this._f_blur = () => {
            this.b_ctrl = false;
            this.b_shift = false;
            this.b_crop = false;
            this.o_crop_start = null;
            this.o_hover = null;
            this.f_cancel_drag();
        };
        this._f_modifier = (o_event) => {
            this.b_ctrl = o_event.ctrlKey;
            this.b_shift = o_event.shiftKey;
            if (o_event.type === 'keydown' && o_event.key === 'Escape' && this.b_crop) {
                this.b_crop = false;
                this.o_crop_start = null;
                o_event.preventDefault();
            }
            if (o_event.type === 'keydown' && o_event.key === 'Escape' && this.o_start) {
                o_event.preventDefault();
                this.f_cancel_drag();
            }
        };
        window.addEventListener('keydown', this._f_modifier);
        window.addEventListener('keyup', this._f_modifier);
        window.addEventListener('blur', this._f_blur);
        this.f_visibility(o_state.o_panel_visibility.training);
    },
    beforeUnmount: function () {
        this.f_stop();
        cancelAnimationFrame(this._n_frame);
        document.body.classList.remove('training-mode');
        window.removeEventListener('blur', this._f_blur);
        window.removeEventListener('keydown', this._f_modifier);
        window.removeEventListener('keyup', this._f_modifier);
        this.f_cancel_drag();
        for (let n = 1; n <= 9; n++) {
            let o_action = o_actions.a_o_action.find((o) => o.id === 'training.label.' + n);
            if (o_action) o_action.invoke = () => {};
        }
    },
    methods: {
        f_toggle_crop() {
            this.f_cancel_drag();
            this.b_crop = !this.b_crop;
            this.o_crop_start = null;
            if (this.b_crop) o_state.o_zoom.b_selecting = false;
        },
        f_set_crop(o_crop) {
            this.f_invalidate('Crop changed. Annotate all targets inside the selected area.');
            this.o_crop = o_crop;
            this.b_crop = false;
            this.o_crop_start = null;
        },
        f_load_dataset: function () {
            return this.f_run(async () => {
                this.a_o_dataset = await f_o_request('dataset/list');
                let s_saved;
                try {
                    s_saved = localStorage.getItem('omm.training.dataset');
                } catch (_) {}
                await this.f_select_dataset(
                    this.a_o_dataset.some((o) => o.s_id === s_saved) ? s_saved : 'default',
                );
            });
        },
        f_switch_dataset: function (s_id) {
            return this.f_run(() => this.f_select_dataset(s_id));
        },
        f_select_dataset: async function (s_id) {
            if (!this.a_o_dataset.some((o) => o.s_id === s_id)) throw new Error('Select an existing dataset');
            let a_o_sample = await f_o_request('list', undefined, s_id);
            this.b_dataset_loading = true;
            try {
                this.f_set_crop(null);
                this.f_invalidate('Dataset changed. Draw boxes for this dataset.');
                this.f_reset_grid();
                this.n_focus_start = null;
                this.n_focus_end = null;
                this.s_dataset = s_id;
                this.a_o_sample = a_o_sample;
                let a_o_label;
                try {
                    a_o_label = JSON.parse(
                        localStorage.getItem('omm.training.label.' + s_id) ||
                            (s_id === 'default' ? localStorage.getItem('omm.training.label') : null),
                    );
                } catch (_) {}
                if (
                    !Array.isArray(a_o_label) || !a_o_label.length ||
                    !a_o_label.every((o) =>
                        typeof o.s_id === 'string' && typeof o.s_name === 'string' &&
                        /^#[0-9a-f]{6}$/i.test(o.s_color)
                    )
                ) {
                    let o_label = new Map();
                    for (let o_sample of a_o_sample) {
                        for (let o_box of o_sample.a_o_box) {
                            if (!o_label.has(o_box.s_label)) {
                                o_label.set(o_box.s_label, {
                                    s_id: crypto.randomUUID(),
                                    s_name: o_box.s_label,
                                    s_color: /^#[0-9a-f]{6}$/i.test(o_box.s_color)
                                        ? o_box.s_color
                                        : '#00ff88',
                                });
                            }
                        }
                    }
                    a_o_label = [...o_label.values()];
                    if (!a_o_label.length) {
                        a_o_label = [{ s_id: crypto.randomUUID(), s_name: 'target', s_color: '#00ff88' }];
                    }
                }
                this.a_o_label = a_o_label;
                this.s_label = a_o_label[0].s_id;
                this.s_message = '';
                try {
                    localStorage.setItem('omm.training.dataset', s_id);
                } catch (_) {}
                await this.$nextTick();
            } finally {
                this.b_dataset_loading = false;
            }
        },
        f_create_dataset: function () {
            return this.f_run(async () => {
                let o_dataset = await f_o_request('dataset/create', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ s_name: this.s_name__dataset }),
                });
                this.a_o_dataset.push(o_dataset);
                this.s_name__dataset = '';
                await this.f_select_dataset(o_dataset.s_id);
            });
        },

        f_accept_prediction: function () {
            for (let o_box of this.a_o_prediction) {
                let o_label = this.a_o_label.find((o) => o.s_name === o_box.s_label);
                this.a_o_box.push({
                    ...o_box,
                    s_id: crypto.randomUUID(),
                    s_color: o_label?.s_color || '#00cfff',
                });
            }
            this.a_o_prediction = [];
        },
        f_s_image: function (o) {
            return '/api/training/image?id=' + encodeURIComponent(o.s_id) + '&dataset=' +
                encodeURIComponent(o.s_dataset || this.s_dataset);
        },
        f_s_shortcut: function (n_idx) {
            if (n_idx >= 9) return '·';
            let o_action = o_actions.a_o_action.find((o) => o.id === 'training.label.' + (n_idx + 1));
            return o_action
                ? (o_actions.f_config(o_action.id).bindings.find((o) => o.source === 'keyboard')?.keys.join(
                    '+',
                ) || '·')
                : String(n_idx + 1);
        },
        f_visibility: function (b_visible) {
            document.body.classList.toggle('training-mode', b_visible);
            this.o_hover = null;
            cancelAnimationFrame(this._n_frame);
            this.f_cancel_drag();
            if (b_visible) {
                f_set_mouse_jog(false);
                if (this.s_dataset) this.f_refresh();
                else this.f_load_dataset();
                this.f_sync_live();
            } else {
                this.f_stop();
                this.o_live = null;
            }
        },
        f_sync_live: function () {
            if (!o_state.o_panel_visibility.training) return;
            let o_video = document.getElementById('webcamVideo');
            let o_track = f_o_camera_track();
            if (o_video?.readyState >= 2 && o_track?.readyState === 'live') {
                let n_zoom = o_track.getSettings().zoom;
                if (
                    this._o_track !== o_track || this._n_zoom !== n_zoom ||
                    this.n_scl_x !== o_video.videoWidth || this.n_scl_y !== o_video.videoHeight
                ) {
                    this.f_set_crop(null);
                    this.f_invalidate('Camera geometry changed. Draw new boxes.');
                    this._o_track = o_track;
                    this._n_zoom = n_zoom;
                    this.n_scl_x = o_video.videoWidth;
                    this.n_scl_y = o_video.videoHeight;
                }
                let o_rect = f_o_video_rect(o_video.getBoundingClientRect(), this.n_scl_x, this.n_scl_y);
                if (JSON.stringify(o_rect) !== JSON.stringify(this.o_live)) this.o_live = o_rect;
            } else if (this.o_live) {
                this.o_live = null;
                this.f_invalidate('Camera stopped.');
                this.f_stop();
            }
            let el_mag = document.querySelector('.zoom-mag-canvas');
            let o_crop = el_mag?._o_training_view;
            let o_view = null;
            if (
                o_state.o_panel_visibility.zoom && o_crop && el_mag.clientWidth &&
                o_state.o_zoom.n_scl_x__roi > 0
            ) {
                let o_rect = el_mag.getBoundingClientRect();
                let o_parent = el_mag.parentElement.getBoundingClientRect();
                o_view = {
                    s_id: 'zoom',
                    s_target: '.zoom-stage',
                    ...o_crop,
                    o_full: {
                        n_scl_x: o_rect.width * this.n_scl_x / o_crop.n_width,
                        n_scl_y: o_rect.height * this.n_scl_y / o_crop.n_height,
                    },
                    o_style: {
                        position: 'absolute',
                        zIndex: 2,
                        left: (o_rect.left - o_parent.left - el_mag.parentElement.clientLeft) + 'px',
                        top: (o_rect.top - o_parent.top - el_mag.parentElement.clientTop) + 'px',
                        width: o_rect.width + 'px',
                        height: o_rect.height + 'px',
                    },
                };
            }
            if (JSON.stringify(o_view) !== JSON.stringify(this.o_zoom_view)) {
                if (this.o_start && this.s_hover_view === 'zoom') this.f_cancel_drag();
                this.o_zoom_view = o_view;
            }
            this._n_frame = requestAnimationFrame(() => this.f_sync_live());
        },
        f_cancel_drag: function (b_restore = true) {
            if (b_restore && this.o_edit) {
                let n_idx = this.a_o_box.findIndex((o) => o.s_id === this.o_edit.o_original.s_id);
                if (n_idx >= 0) this.a_o_box[n_idx] = this.o_edit.o_original;
            }
            let n_pointer = this._n_pointer;
            let el_pointer = this._el_pointer;
            this.o_edit = null;
            this.o_start = null;
            this.o_end = null;
            this._n_pointer = null;
            this._el_pointer = null;
            if (el_pointer?.hasPointerCapture(n_pointer)) el_pointer.releasePointerCapture(n_pointer);
        },
        f_o_handle: function (o_box, o_view) {
            o_view ||= this.a_o_view.find((o) => o.s_id === this.s_hover_view);
            return f_o_box_handle(o_box, o_view?.o_full || this.o_live);
        },
        f_o_hit: function (o_point, b_move) {
            let f_inside = (o) =>
                o_point.n_x >= o.n_x && o_point.n_x <= o.n_x + o.n_scl_x &&
                o_point.n_y >= o.n_y && o_point.n_y <= o.n_y + o.n_scl_y;
            // Last drawn box is topmost; handles take precedence over box interiors.
            for (let o_box of [...this.a_o_box].reverse()) {
                if (f_inside(this.f_o_handle(o_box))) return { s_mode: 'resize', o_original: { ...o_box } };
            }
            if (b_move) {
                for (let o_box of [...this.a_o_box].reverse()) {
                    if (f_inside(o_box)) return { s_mode: 'move', o_original: { ...o_box } };
                }
            }
            return null;
        },
        f_invalidate: function (s_message) {
            this.b_crop = false;
            this.o_crop_start = null;
            this.a_o_prediction = [];
            this.n_revision++;
            this.f_cancel_drag();
            if (this.a_o_box.length) {
                this.a_o_box = [];
                this.s_message = s_message;
            }
        },
        f_add_label: function () {
            let o_label = { s_id: crypto.randomUUID(), s_name: '', s_color: '#ffaa00' };
            this.a_o_label.push(o_label);
            this.s_label = o_label.s_id;
        },
        f_remove_label: function (s_id) {
            this.a_o_label = this.a_o_label.filter((o) => o.s_id !== s_id);
            if (this.s_label === s_id) this.s_label = this.a_o_label[0].s_id;
        },
        f_o_point: function (o_event, o_view) {
            let o_rect = o_event.currentTarget.getBoundingClientRect();
            return {
                n_x: (o_view.n_x +
                    Math.max(0, Math.min(1, (o_event.clientX - o_rect.left) / o_rect.width)) *
                        o_view.n_width) / this.n_scl_x,
                n_y: (o_view.n_y +
                    Math.max(0, Math.min(1, (o_event.clientY - o_rect.top) / o_rect.height)) *
                        o_view.n_height) / this.n_scl_y,
            };
        },
        f_down: function (o_event, o_view) {
            if (
                this.b_busy || !this.s_dataset || this.b_moving || o_state.b_scanning ||
                o_event.button !== 0 || !this.o_live ||
                this.o_start
            ) return;
            this.b_ctrl = o_event.ctrlKey;
            this.b_shift = o_event.shiftKey;
            this.s_hover_view = o_view.s_id;
            let o_point = this.f_o_point(o_event, o_view);
            if (this.b_crop) {
                o_event.stopPropagation();
                o_event.preventDefault();
                if (!this.o_crop_start) {
                    this.o_crop_start = o_point;
                    this.o_hover = o_point;
                } else {
                    let o_crop = f_o_crop(this.o_crop_start, o_point, this.n_scl_x, this.n_scl_y);
                    if (o_crop) {
                        this.f_set_crop(o_crop);
                        this.s_error = '';
                    } else this.s_error = 'Crop must be at least 2 × 2 camera pixels. Click another corner.';
                }
                return;
            }
            let o_clamped = f_o_crop_point(o_point, this.o_crop_bounds);
            if (o_clamped.n_x !== o_point.n_x || o_clamped.n_y !== o_point.n_y) return;
            this.o_edit = this.f_o_hit(o_point, this.b_shift);
            if (!this.o_edit) {
                if (!this.b_ctrl || this.b_shift) return;
                let o_label = this.a_o_label.find((o) => o.s_id === this.s_label);
                if (!o_label?.s_name.trim()) {
                    this.s_error = 'Enter a label first';
                    return;
                }
            }
            o_event.stopPropagation();
            o_event.preventDefault();
            o_event.currentTarget.setPointerCapture(o_event.pointerId);
            this._el_pointer = o_event.currentTarget;
            this._n_pointer = o_event.pointerId;
            this.o_hover = o_point;
            this.o_start = o_point;
            this.o_end = o_point;
            this.s_error = '';
        },
        f_move: function (o_event, o_view) {
            this.b_ctrl = o_event.ctrlKey;
            this.b_shift = o_event.shiftKey;
            this.s_hover_view = o_view.s_id;
            this.o_hover = this.f_o_point(o_event, o_view);
            if (!this.o_start || this._n_pointer !== o_event.pointerId) return;
            this.o_end = f_o_crop_point(this.o_hover, this.o_crop_bounds);
            if (this.o_edit) {
                let n_idx = this.a_o_box.findIndex((o) => o.s_id === this.o_edit.o_original.s_id);
                if (n_idx >= 0) {
                    this.a_o_box[n_idx] = f_o_box_from_crop(
                        f_o_box_edit(
                            f_o_box_to_crop(this.o_edit.o_original, this.o_crop_bounds),
                            this.o_edit.s_mode,
                            {
                                n_x: (this.o_end.n_x - this.o_start.n_x) / this.o_crop_bounds.n_scl_x,
                                n_y: (this.o_end.n_y - this.o_start.n_y) / this.o_crop_bounds.n_scl_y,
                            },
                            this.n_scl_x * this.o_crop_bounds.n_scl_x,
                            this.n_scl_y * this.o_crop_bounds.n_scl_y,
                        ),
                        this.o_crop_bounds,
                    );
                }
            }
        },
        f_up: function (o_event, o_view) {
            if (!this.o_start || this._n_pointer !== o_event.pointerId) return;
            this.f_move(o_event, o_view);
            if (!this.o_edit) {
                let o_label = this.a_o_label.find((o) => o.s_id === this.s_label);
                if (o_label) {
                    let o_box = f_o_box(this.o_start, this.o_end, o_label);
                    if (o_box.n_scl_x * this.n_scl_x >= 2 && o_box.n_scl_y * this.n_scl_y >= 2) {
                        this.a_o_box.push(o_box);
                    }
                }
            }
            this.f_cancel_drag(false);
        },
        f_run: async function (f_work) {
            if (this.b_busy) return;
            this.b_busy = true;
            this.s_error = '';
            try {
                await f_work();
            } catch (o_error) {
                this.s_error = o_error.message;
            } finally {
                this.b_busy = false;
            }
        },
        f_stage: function (f_work) {
            return this.f_run(async () => {
                if (!this.b_stage_ready) {
                    throw new Error('Connect an idle stage and finish other operations first');
                }
                this._o_abort = new AbortController();
                o_state.b_training_busy = true;
                o_state.b_scanning = true;
                try {
                    await f_work();
                } finally {
                    o_state.b_training_busy = false;
                    o_state.b_scanning = false;
                    this._o_abort = null;
                    this.b_grid_move = false;
                }
            });
        },
        f_check: function () {
            if (this._o_abort?.signal.aborted || !o_state.b_connected__esp) {
                throw new Error('Training stopped or stage disconnected');
            }
        },
        f_stop: function () {
            if (this._o_abort && !this._o_abort.signal.aborted) {
                this._o_abort.abort();
                f_send_esp_stop_all();
            }
        },
        f_position: function (s_axis) {
            let n_motor = f_n_motor__axis(s_axis);
            if (n_motor === null) throw new Error('Assign the ' + s_axis.toUpperCase() + ' motor in Setup');
            return o_state.a_o_motor[n_motor].n_position;
        },
        f_move_axis: async function (s_axis, n_target) {
            this.f_check();
            try {
                await f_move_training(s_axis, n_target, this._o_abort.signal);
            } catch (o_error) {
                this._o_abort.abort();
                throw o_error;
            }
            this.f_check();
        },
        f_validate_grid: function () {
            f_a_grid(this.o_grid_config.x, this.o_grid_config.y);
            for (let s_axis of ['x', 'y']) {
                let n = this.o_grid_config['n_step_' + s_axis];
                if (!Number.isInteger(n) || n < 1 || n > 1000000) {
                    throw new Error('Use 1–1000000 steps per region');
                }
            }
        },
        f_reset_grid: function () {
            this.o_origin = null;
            this.n_region = 0;
            this.a_n_captured = [];
            this.a_n_visited = [0];
            this.s_grid = crypto.randomUUID();
        },
        f_anchor: function () {
            this.f_validate_grid();
            if (!this.o_origin) {
                this.o_origin = {
                    x: this.f_position('x'),
                    y: this.f_position('y'),
                    n_sign_x: o_state.o_mapping__d?.s_dir === 'ccw' ? -1 : 1,
                    n_sign_y: o_state.o_mapping__s?.s_dir === 'ccw' ? -1 : 1,
                };
            }
        },
        f_jog: function (s_axis, n_direction) {
            return this.f_stage(async () => {
                this.f_validate_grid();
                this.b_grid_move = true;
                this.f_invalidate('Test movement cleared the boxes.');
                let s_key = s_axis === 'x' ? (n_direction < 0 ? 'a' : 'd') : (n_direction < 0 ? 'w' : 's');
                let s_direction = o_state['o_mapping__' + s_key]?.s_dir;
                let n_sign = s_direction ? (s_direction === 'cw' ? 1 : -1) : n_direction;
                try {
                    await this.f_move_axis(
                        s_axis,
                        this.f_position(s_axis) + n_sign * this.o_grid_config['n_step_' + s_axis],
                    );
                } finally {
                    this.f_reset_grid();
                }
            });
        },
        f_next: function () {
            return this.f_stage(async () => {
                this.f_anchor();
                let o_cell = this.a_o_cell[this.n_region + 1];
                if (!o_cell) return;
                this.b_grid_move = true;
                this.f_invalidate('Draw boxes in the new region.');
                try {
                    await this.f_move_axis(
                        'x',
                        this.o_origin.x + o_cell.n_x * this.o_grid_config.n_step_x * this.o_origin.n_sign_x,
                    );
                    await this.f_move_axis(
                        'y',
                        this.o_origin.y + o_cell.n_y * this.o_grid_config.n_step_y * this.o_origin.n_sign_y,
                    );
                    this.n_region++;
                    this.a_n_visited.push(this.n_region);
                    this.s_message = 'Region ' + (this.n_region + 1) + '. Draw boxes on the live image.';
                } catch (o_error) {
                    this.f_reset_grid();
                    throw o_error;
                }
            });
        },
        f_set_focus: function (s_kind) {
            try {
                this['n_focus_' + s_kind] = this.f_position('z');
            } catch (o_error) {
                this.s_error = o_error.message;
            }
        },
        f_wait: async function (n_ms) {
            await new Promise((f_resolve) => setTimeout(f_resolve, n_ms));
            this.f_check();
        },
        f_fresh: async function () {
            let o_video = document.getElementById('webcamVideo');
            if (!o_video?.requestVideoFrameCallback) {
                throw new Error('Fresh-frame capture needs a browser with video frame callbacks');
            }
            await new Promise((f_resolve, f_reject) => {
                let n_callback = o_video.requestVideoFrameCallback(() => {
                    clearTimeout(n_timer);
                    f_resolve();
                });
                let n_timer = setTimeout(() => {
                    o_video.cancelVideoFrameCallback(n_callback);
                    f_reject(new Error('Camera did not deliver a fresh frame'));
                }, 5000);
            });
            this.f_check();
        },
        f_test_focus: function () {
            return this.f_stage(async () => {
                let a_n_plane = f_a_plane(this.n_focus_start, this.n_focus_end, this.n_plane);
                let n_previous = this.f_position('z');
                await f_focus_sweep({
                    a_n_plane: [a_n_plane[0], a_n_plane.at(-1)],
                    n_previous,
                    f_check: () => this.f_check(),
                    f_move: (n) => this.f_move_axis('z', n),
                    f_frame: () => this.f_wait(500),
                });
                this.s_message = 'Focus endpoints tested; returned to previous focus.';
            });
        },
        f_capture: function () {
            return this.f_stage(async () => {
                if (!this.s_dataset || !this.o_live || !this.a_o_box.length || this.o_start || this.b_crop) {
                    throw new Error('Draw boxes on the live image first');
                }
                let a_n_plane = f_a_plane(this.n_focus_start, this.n_focus_end, this.n_plane);
                this.f_anchor();
                let n_previous = this.f_position('z'), n_revision = this.n_revision;
                let o_crop = this.o_crop ? { ...this.o_crop } : null;
                let a_o_box = this.a_o_box.map((o) => f_o_box_to_crop(o, this.o_crop_bounds)),
                    s_set = crypto.randomUUID(),
                    o_track = f_o_camera_track();
                let n_done = 0;
                await f_focus_sweep({
                    a_n_plane,
                    n_previous,
                    f_check: () => this.f_check(),
                    f_move: (n) => this.f_move_axis('z', n),
                    f_frame: async (n_plane, n_target) => {
                        this.s_message = 'Capturing plane ' + (n_plane + 1) + ' / ' + a_n_plane.length;
                        await this.f_wait(500);
                        await this.f_fresh();
                        if (
                            n_revision !== this.n_revision || o_track !== f_o_camera_track()
                        ) throw new Error('XY or camera changed; acquisition cancelled');
                        let o_sample = {
                            n_ts_ms: Date.now(),
                            o_position: Object.fromEntries(
                                ['x', 'y', 'z'].map((s) => [s, this.f_position(s)]),
                            ),
                            o_axis: { ...o_state.o_motor__axis },
                            o_camera: f_o_camera_snapshot(),
                            o_camera_setting: o_track.getSettings(),
                            s_device: o_state.s_id__webcam_device,
                            s_source: o_crop ? 'raw-crop' : 'raw-full-frame',
                            o_crop,
                            n_scl_x__source: this.n_scl_x,
                            n_scl_y__source: this.n_scl_y,
                            s_position_unit: 'relative-motor-step',
                            a_o_box,
                            s_set,
                            n_plane,
                            n_plane_count: a_n_plane.length,
                            n_focus_target: n_target,
                            o_region: {
                                s_grid: this.s_grid,
                                n_idx: this.n_region,
                                ...this.a_o_cell[this.n_region],
                                o_origin: { ...this.o_origin },
                                o_config: { ...this.o_grid_config },
                            },
                        };
                        let o_capture = await f_o_capture__frame({ b_flat: false, o_roi: o_crop });
                        this.f_check();
                        if (
                            n_revision !== this.n_revision || o_track !== f_o_camera_track() ||
                            o_capture.n_scl_x__video !== this.n_scl_x ||
                            o_capture.n_scl_y__video !== this.n_scl_y
                        ) throw new Error('Image geometry changed during capture');
                        Object.assign(o_sample, { n_scl_x: o_capture.n_scl_x, n_scl_y: o_capture.n_scl_y });
                        f_validate_sample(o_sample);
                        let o_form = new FormData();
                        o_form.append('metadata', JSON.stringify(o_sample));
                        o_form.append('image', o_capture.o_blob, 'image.png');
                        let o_saved = await f_o_request(
                            'save',
                            { method: 'POST', body: o_form },
                            this.s_dataset,
                        );
                        this.a_o_sample.unshift(o_saved);
                        n_done++;
                    },
                });
                if (n_done === a_n_plane.length && !this.a_n_captured.includes(this.n_region)) {
                    this.a_n_captured.push(this.n_region);
                }
                this.s_message = 'Saved ' + n_done +
                    ' focus planes; returned to previous focus. Review below, then choose Next.';
            });
        },
        f_refresh: function () {
            return this.f_run(async () => {
                this.a_o_sample = await f_o_request('list', undefined, this.s_dataset);
            });
        },
        f_tag: function (o_saved, s_quality) {
            return this.f_run(async () => {
                let o_result = await f_o_request('tag?id=' + o_saved.s_id, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ s_quality }),
                }, this.s_dataset);
                o_saved.s_quality = o_result.s_quality;
            });
        },
        f_delete: function (o_saved) {
            return this.f_run(async () => {
                await f_o_request('delete?id=' + o_saved.s_id, { method: 'DELETE' }, this.s_dataset);
                this.a_o_sample = this.a_o_sample.filter((o) => o.s_id !== o_saved.s_id);
                if (
                    o_saved.o_region?.s_grid === this.s_grid &&
                    !this.a_o_sample.some((o) =>
                        o.o_region?.s_grid === this.s_grid && o.o_region.n_idx === o_saved.o_region.n_idx
                    )
                ) this.a_n_captured = this.a_n_captured.filter((n) => n !== o_saved.o_region.n_idx);
            });
        },
    },
};
export { o_component__training };
