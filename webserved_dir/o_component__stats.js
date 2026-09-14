import { o_state, f_save_setting__debounced, f_reset_stat__session } from './index.js';

let a_s_name__axis = ['X', 'Y', 'Z'];

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
    template: `
        <div class="overlay-panel panel-stats" :class="{ visible: o_state.o_panel_visibility.stats }">
            <div class="panel-header">
                <h2>Statistics</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <div class="stats-session">
                    <div class="stats-session-top">
                        <span>session</span>
                        <b>{{ s_uptime__session }}</b>
                    </div>
                    <div class="stats-session-grid">
                        <div class="stats-session-cell">
                            <span>steps</span>
                            <b>{{ o_state.o_stat__session.n_step__session }}</b>
                        </div>
                        <div class="stats-session-cell">
                            <span>run time</span>
                            <b>{{ f_s_run_time(o_state.o_stat__session.n_ms__run_session) }}</b>
                        </div>
                        <div class="stats-session-cell">
                            <span>halts</span>
                            <b>{{ o_state.o_stat__session.n_cnt__halt }}</b>
                        </div>
                    </div>
                </div>

                <div class="motors-stack stats-stack">
                    <div
                        class="motor-card stats-motor-card"
                        v-for="(o_stat, n_idx) in o_state.a_o_motor__stat"
                        :key="n_idx"
                    >
                        <div class="card-header">
                            <h2>Axis {{ a_s_name__axis[n_idx] }}</h2>
                            <span
                                class="motor-id"
                                :class="{ 'stats-live': o_state.a_o_motor[n_idx].b_running }"
                            >{{ o_state.a_o_motor[n_idx].b_running ? 'running' : 'idle' }}</span>
                        </div>

                        <div class="stats-hero">
                            <span>steps since halt</span>
                            <b>{{ o_stat.n_step__since_halt }}</b>
                        </div>

                        <div class="stats-row"><span>run time (this run)</span><b>{{ f_s_run_time(o_stat.n_ms__run_since_halt) }}</b></div>
                        <div class="stats-row"><span>last run steps</span><b>{{ o_stat.n_step__last_run }}</b></div>
                        <div class="stats-row"><span>session steps</span><b>{{ o_stat.n_step__session }}</b></div>
                        <div class="stats-row"><span>session run time</span><b>{{ f_s_run_time(o_stat.n_ms__run_session) }}</b></div>
                        <div class="stats-row"><span>position</span><b>{{ o_state.a_o_motor[n_idx].n_position }}</b></div>
                        <div class="stats-row"><span>halts</span><b>{{ o_stat.n_cnt__halt }}</b></div>
                        <div class="stats-row"><span>reversals</span><b>{{ o_stat.n_cnt__reversal }}</b></div>
                        <div class="stats-row"><span>peak rpm</span><b>{{ o_stat.n_rpm__max.toFixed(1) }}</b></div>
                    </div>
                </div>

                <button class="global-btn" @click="f_reset_session">Reset session</button>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            a_s_name__axis: a_s_name__axis,
        };
    },
    computed: {
        s_uptime__session: function() {
            return f_s_run_time(o_state.n_ts_ms_now - o_state.o_stat__session.n_ts_ms__start);
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
