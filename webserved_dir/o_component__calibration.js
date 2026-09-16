import { o_state, f_save_calibration, f_save_setting__debounced } from './index.js';
import { f_o_camera_snapshot } from './o_camera.module.js';

// calibration hub: an ordered checklist of everything that has to be
// calibrated for this rig. each step shows a status (ready / stale / partial /
// missing / todo) and opens the panel that does the actual measurement.
//
// a single profile is stored (single objective for now); staleness is derived
// by comparing the current camera against the snapshot taken at calibration.

let o_component__calibration = {
    name: 'component-calibration',
    template: `
        <div class="overlay-panel panel-calibration" :class="{ visible: o_state.o_panel_visibility.calibration }">
            <div class="panel-header">
                <h2>Calibration</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">

                <div class="focus-note">
                    run these in order. every result only stays valid while the
                    optics stay fixed — re-run when you change objective, camera,
                    illumination or exposure.
                </div>

                <div class="focus-note" v-if="s_note__error" style="color: var(--danger);">{{ s_note__error }}</div>

                <div class="calib-step" v-for="o_step in a_o_step" :key="o_step.s_key">
                    <div class="filter-row">
                        <span class="calib-title">{{ o_step.n_idx }}. {{ o_step.s_title }}</span>
                        <span class="calib-badge" :class="o_step.s_status">{{ o_step.s_status }}</span>
                    </div>
                    <div class="filter-note">{{ o_step.s_desc }}</div>
                    <div class="filter-note" v-if="o_step.s_detail">{{ o_step.s_detail }}</div>
                    <div class="filter-row" style="margin-top: 6px;">
                        <button
                            class="btn-small"
                            :disabled="o_step.b_disabled"
                            @click="o_step.f_action"
                        >{{ o_step.s_action }}</button>
                    </div>
                </div>

            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            s_note__error: '',
        };
    },
    computed: {
        a_o_step: function() {
            let o_self = this;
            return [
                {
                    s_key: 'baseline',
                    n_idx: 1,
                    s_title: 'Optical baseline',
                    s_desc: 'lock manual exposure, gain and white balance so every later measurement is comparable.',
                    s_status: o_self.s_status__baseline,
                    s_detail: o_self.s_detail__baseline,
                    s_action: 'record baseline',
                    f_action: function(){ o_self.f_record_baseline(); },
                    b_disabled: false,
                },
                {
                    s_key: 'backlash',
                    n_idx: 2,
                    s_title: 'Stage backlash & steps/px',
                    s_desc: 'motor slack and steps-per-pixel for X and Y — the scan grid depends on this.',
                    s_status: o_self.s_status__backlash,
                    s_detail: o_self.s_detail__backlash,
                    s_action: 'open Backlash',
                    f_action: function(){ o_self.f_open('backlash'); },
                    b_disabled: false,
                },
                {
                    s_key: 'flat',
                    n_idx: 3,
                    s_title: 'Flat field / dust',
                    s_desc: 'illumination profile + sensor dust, divided out of every capture.',
                    s_status: o_self.s_status__flat,
                    s_detail: o_self.s_detail__flat,
                    s_action: 'open Flat field',
                    f_action: function(){ o_self.f_open('flat'); },
                    b_disabled: false,
                },
                {
                    s_key: 'focus',
                    n_idx: 4,
                    s_title: 'Focus step / depth-of-field',
                    s_desc: 'optimal Z step for focus stacking and autofocus.',
                    s_status: 'todo',
                    s_detail: 'tool not built yet',
                    s_action: '—',
                    f_action: function(){},
                    b_disabled: true,
                },
                {
                    s_key: 'scale',
                    n_idx: 5,
                    s_title: 'Scale (µm / pixel)',
                    s_desc: 'physical pixel size from a stage micrometer or known grid.',
                    s_status: 'todo',
                    s_detail: 'tool not built yet',
                    s_action: '—',
                    f_action: function(){},
                    b_disabled: true,
                },
            ];
        },

        // ── per-step status ─────────────────────────────────────────

        s_status__baseline: function() {
            if(!o_state.o_calibration.o_camera__baseline) return 'missing';
            return this.f_b_camera__matches(o_state.o_calibration.o_camera__baseline) ? 'ready' : 'stale';
        },
        s_detail__baseline: function() {
            let o_cal = o_state.o_calibration;
            if(!o_cal.o_camera__baseline){
                return 'set manual exposure in the Camera panel, then press record.';
            }
            return 'recorded ' + this.f_s_age(o_cal.n_ts_ms__camera);
        },
        s_status__backlash: function() {
            let a_per_px = o_state.a_n_step__per_px || [0, 0, 0];
            let a_backlash = o_state.a_n_step__backlash || [0, 0, 0];
            let n_done = 0;
            for(let n_idx = 0; n_idx < 2; n_idx++){
                if(a_per_px[n_idx] > 0 && a_backlash[n_idx] > 0) n_done++;
            }
            if(n_done === 2) return 'ready';
            if(n_done === 1) return 'partial';
            return 'missing';
        },
        s_detail__backlash: function() {
            let a_per_px = o_state.a_n_step__per_px || [0, 0, 0];
            let a_backlash = o_state.a_n_step__backlash || [0, 0, 0];
            let a_s_axis = [];
            for(let n_idx = 0; n_idx < 2; n_idx++){
                let s_ok = (a_per_px[n_idx] > 0 && a_backlash[n_idx] > 0) ? '✓' : '✗';
                a_s_axis.push('M' + n_idx + ' ' + s_ok);
            }
            return a_s_axis.join('  ');
        },
        s_status__flat: function() {
            if(!o_state.o_flat_field.s_path_flat) return 'missing';
            return this.f_b_camera__matches(o_state.o_flat_field.o_camera__flat) ? 'ready' : 'stale';
        },
        s_detail__flat: function() {
            if(!o_state.o_flat_field.s_path_flat) return 'no flat image yet';
            return 'taken ' + this.f_s_age(o_state.o_calibration.n_ts_ms__flat);
        },
    },
    methods: {
        f_close: function() {
            o_state.o_panel_visibility.calibration = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_open: function(s_key) {
            // close this hub and hand off to the tool that does the work
            o_state.o_panel_visibility.calibration = false;
            o_state.o_panel_visibility[s_key] = true;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_record_baseline: function() {
            let o_self = this;
            if(!o_state.o_camera.b_active){
                o_self.s_note__error = 'start a camera first';
                return;
            }
            o_self.s_note__error = '';
            o_state.o_calibration.o_camera__baseline = f_o_camera_snapshot();
            o_state.o_calibration.n_ts_ms__camera = Date.now();
            f_save_calibration();
        },
        f_b_camera__matches: function(o_snapshot) {
            if(!o_snapshot || !o_state.o_camera.b_active) return true;
            let o_now = o_state.o_camera;
            return o_now.s_mode__exposure === o_snapshot.s_mode__exposure
                && o_now.n_time__exposure === o_snapshot.n_time__exposure
                && o_now.n_iso === o_snapshot.n_iso
                && o_now.s_mode__white_balance === o_snapshot.s_mode__white_balance;
        },
        f_s_age: function(n_ts_ms) {
            if(!n_ts_ms) return 'never';
            let n_sec = Math.floor((Date.now() - n_ts_ms) / 1000);
            if(n_sec < 60) return 'just now';
            let n_min = Math.floor(n_sec / 60);
            if(n_min < 60) return n_min + ' min ago';
            let n_hour = Math.floor(n_min / 60);
            if(n_hour < 24) return n_hour + ' h ago';
            return Math.floor(n_hour / 24) + ' d ago';
        },
    },
};

export { o_component__calibration };
