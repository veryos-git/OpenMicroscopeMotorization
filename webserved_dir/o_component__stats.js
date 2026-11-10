import { o_state, f_save_setting__debounced, f_reset_stat__session } from './index.js';
import { o_component__icon } from './o_component__icon.js';

let f_s_run_time = function(n_ms) {
    if (!n_ms || n_ms < 0) n_ms = 0;
    let n_sec = Math.floor(n_ms / 1000);
    let n_min = Math.floor(n_sec / 60);
    let n_hr = Math.floor(n_min / 60);
    if (n_hr > 0) return n_hr + 'h ' + String(n_min % 60).padStart(2, '0') + 'm';
    if (n_min > 0) return n_min + 'm ' + String(n_sec % 60).padStart(2, '0') + 's';
    return n_sec + 's';
};

let o_component__stats = {
    name: 'component-stats',
    components: { ui_icon: o_component__icon },
    template: `
        <div class="overlay-panel panel-stats" :class="{ visible: o_state.o_panel_visibility.stats }">
            <div class="panel-header">
                <h2><ui_icon s_name="stats" /> Statistics</h2>
                <span class="panel-state" data-tooltip="Session time since the controller connected">{{ s_uptime__session }}</span>
                <button class="cockpit-icon-button" @click="f_reset_session" aria-label="Reset session"
                    data-tooltip="Reset session&#10;Clear every counter and restart the session clock."><ui_icon s_name="undo" /></button>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <!-- one row per counter, one column per motor: everything readable at a glance -->
                <div class="stats-table" role="table" aria-label="Motor statistics">
                    <span class="stats-head"></span>
                    <span class="stats-head" data-tooltip="Sum over all motors since the controller connected">all</span>
                    <span
                        class="stats-head stats-head--motor"
                        v-for="(o_stat, n_idx) in o_state.a_o_motor__stat"
                        :key="n_idx"
                        :class="{ 'stats-live': o_state.a_o_motor[n_idx].b_running }"
                        :data-tooltip="'Motor ' + (n_idx + 1) + ' · ' + (o_state.a_o_motor[n_idx].b_running ? 'running' : 'idle')"
                    >M{{ n_idx + 1 }}</span>
                    <template v-for="o_row in a_o_row" :key="o_row.s_label">
                        <span class="stats-label" :data-tooltip="o_row.s_tooltip">{{ o_row.s_label }}</span>
                        <b class="stats-value stats-value--session">{{ o_row.s_session }}</b>
                        <b class="stats-value" :class="{ 'stats-value--hero': o_row.b_hero }" v-for="(s_value, n_idx) in o_row.a_s_motor" :key="n_idx">{{ s_value }}</b>
                    </template>
                </div>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
        };
    },
    computed: {
        s_uptime__session: function() {
            return f_s_run_time(o_state.n_ts_ms_now - o_state.o_stat__session.n_ts_ms__start);
        },
        // rows of the statistics table: session total (when one exists) + one value per motor
        a_o_row: function() {
            let o_session = o_state.o_stat__session;
            let a_o_stat = o_state.a_o_motor__stat;
            let f_a_s_motor = function(f_s_value) {
                return a_o_stat.map(function(o_stat, n_idx) { return String(f_s_value(o_stat, o_state.a_o_motor[n_idx])); });
            };
            return [
                { s_label: 'since halt', s_tooltip: 'Steps driven since this motor last stopped', s_session: '', b_hero: true,
                    a_s_motor: f_a_s_motor(function(o_stat) { return o_stat.n_step__since_halt; }) },
                { s_label: 'run time', s_tooltip: 'Motor on-time of the current run', s_session: '',
                    a_s_motor: f_a_s_motor(function(o_stat) { return f_s_run_time(o_stat.n_ms__run_since_halt); }) },
                { s_label: 'last run', s_tooltip: 'Steps driven in the most recently completed run', s_session: '',
                    a_s_motor: f_a_s_motor(function(o_stat) { return o_stat.n_step__last_run; }) },
                { s_label: 'position', s_tooltip: 'Current motor position in steps', s_session: '',
                    a_s_motor: f_a_s_motor(function(o_stat, o_motor) { return o_motor.n_position; }) },
                { s_label: 'steps', s_tooltip: 'Steps driven since the controller connected', s_session: String(o_session.n_step__session),
                    a_s_motor: f_a_s_motor(function(o_stat) { return o_stat.n_step__session; }) },
                { s_label: 'on time', s_tooltip: 'Total motor on-time since the controller connected', s_session: f_s_run_time(o_session.n_ms__run_session),
                    a_s_motor: f_a_s_motor(function(o_stat) { return f_s_run_time(o_stat.n_ms__run_session); }) },
                { s_label: 'halts', s_tooltip: 'Number of stops (stop command or move complete)', s_session: String(o_session.n_cnt__halt),
                    a_s_motor: f_a_s_motor(function(o_stat) { return o_stat.n_cnt__halt; }) },
                { s_label: 'reversals', s_tooltip: 'Number of direction changes', s_session: '',
                    a_s_motor: f_a_s_motor(function(o_stat) { return o_stat.n_cnt__reversal; }) },
                { s_label: 'peak rpm', s_tooltip: 'Highest speed observed', s_session: '',
                    a_s_motor: f_a_s_motor(function(o_stat) { return o_stat.n_rpm__max.toFixed(1); }) },
            ];
        },
    },
    methods: {
        f_s_run_time: f_s_run_time,
        f_close: function() {
            o_state.o_panel_visibility.stats = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_reset_session: function() {
            f_reset_stat__session();
        },
    },
};

export { o_component__stats };
