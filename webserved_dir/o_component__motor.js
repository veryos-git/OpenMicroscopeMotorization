import { o_state, f_send_esp, f_send_esp_run_continuous, f_send_esp_stop, f_send_esp_stop_all, f_send_esp_set_backlash, f_save_setting__debounced } from './index.js';

let a_o_motor_config = [
    { s_name: 'Motor A', s_gpio: '4, 5, 6, 7' },
    { s_name: 'Motor B', s_gpio: '15, 16, 17, 18' },
    { s_name: 'Motor C', s_gpio: '8, 9, 10, 11' },
];

let o_component__motor = {
    name: 'component-motor',
    template: `
        <div class="overlay-panel panel-motors" :class="{ visible: o_state.o_panel_visibility.motors }">
            <div class="panel-header">
                <h2>Motors</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <div class="motors-stack">
                    <div
                        class="motor-card"
                        v-for="(o_config, n_idx) in a_o_motor_config"
                        :key="n_idx"
                    >
                        <div class="card-header">
                            <h2>{{ o_config.s_name }}</h2>
                            <span class="motor-id">GPIO {{ o_config.s_gpio }}</span>
                        </div>
                        <div class="position-display">
                            Position: <strong>{{ o_state.a_o_motor[n_idx].n_position }}</strong> steps
                            <template v-if="o_state.a_o_motor[n_idx].s_mode === 'steps'">
                                &middot; {{ o_state.a_o_motor[n_idx].n_step__remaining }} remaining
                            </template>
                        </div>
                        <div class="control-group">
                            <label>
                                RPM
                                <span class="speed-value">{{ o_state.a_o_motor[n_idx].n_rpm.toFixed(1) }}</span>
                            </label>
                            <input
                                type="range"
                                min="0.05" max="15" step="0.05"
                                :value="o_state.a_o_motor[n_idx].n_rpm"
                                @input="f_on_rpm_change(n_idx, $event)"
                            >
                        </div>
                        <div class="control-group">
                            <label>Direction</label>
                            <div class="dir-toggle">
                                <button
                                    class="dir-btn"
                                    :class="{ active: o_state.a_o_motor[n_idx].s_direction === 'cw' }"
                                    @click="f_set_dir(n_idx, 'cw')"
                                >CW</button>
                                <button
                                    class="dir-btn"
                                    :class="{ active: o_state.a_o_motor[n_idx].s_direction === 'ccw' }"
                                    @click="f_set_dir(n_idx, 'ccw')"
                                >CCW</button>
                            </div>
                        </div>
                        <button class="stop-btn" @click="f_stop_motor(n_idx)">&#9632; Stop</button>
                        <div class="backlash-row">
                            <label class="backlash-row-label">Backlash</label>
                            <input
                                type="number"
                                min="0"
                                v-model.number="o_state.a_n_step__backlash[n_idx]"
                                @change="f_save_backlash"
                            >
                            <span class="backlash-unit">steps</span>
                        </div>
                    </div>
                </div>
                <div class="global-bar">
                    <button class="global-btn stop-all" @click="f_stop_all">&#9632; Stop All</button>
                    <button class="global-btn" @click="f_request_status">&#8635; Refresh</button>
                </div>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            a_o_motor_config: a_o_motor_config,
            a_n_id__debounce: [0, 0, 0],
        };
    },
    methods: {
        f_close: function() {
            o_state.o_panel_visibility.motors = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_on_rpm_change: function(n_idx, o_evt) {
            let o_self = this;
            let n_rpm = parseFloat(o_evt.target.value);
            o_state.a_o_motor[n_idx].n_rpm = n_rpm;
            clearTimeout(o_self.a_n_id__debounce[n_idx]);
            o_self.a_n_id__debounce[n_idx] = setTimeout(function() {
                if(o_state.a_o_motor[n_idx].b_running){
                    f_send_esp_run_continuous(n_idx, n_rpm, o_state.a_o_motor[n_idx].s_direction);
                }
            }, 50);
        },
        f_set_dir: function(n_idx, s_dir) {
            o_state.a_o_motor[n_idx].s_direction = s_dir;
            if(o_state.a_o_motor[n_idx].b_running){
                f_send_esp_run_continuous(n_idx, o_state.a_o_motor[n_idx].n_rpm, s_dir);
            }
        },
        f_stop_motor: function(n_idx) {
            f_send_esp_stop(n_idx);
        },
        f_stop_all: function() {
            f_send_esp_stop_all();
        },
        f_request_status: function() {
            f_send_esp({ command: 'status' });
        },
        f_save_backlash: function() {
            f_save_setting__debounced('a_n_step__backlash', o_state.a_n_step__backlash);
            for(let n_idx = 0; n_idx < o_state.a_n_step__backlash.length; n_idx++){
                f_send_esp_set_backlash(n_idx, o_state.a_n_step__backlash[n_idx]);
            }
        },
    },
};

export { o_component__motor };
