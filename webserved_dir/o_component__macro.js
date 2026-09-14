import { o_state, f_send_esp, f_save_setting__debounced } from './index.js';

let o_component__macro = {
    name: 'component-macro',
    template: `
        <div class="overlay-panel panel-macro" :class="{ visible: o_state.o_panel_visibility.macro }">
            <div class="panel-header">
                <h2>Macro</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">

                <!-- recording controls -->
                <div class="macro-section">
                    <button
                        class="btn-macro"
                        :class="{ recording: o_state.b_recording__macro }"
                        @click="f_toggle_record"
                        :disabled="o_state.b_playing__macro"
                    >
                        <span class="macro-dot" :class="{ active: o_state.b_recording__macro }"></span>
                        {{ o_state.b_recording__macro ? 'Stop Recording' : 'Record' }}
                    </button>
                </div>

                <!-- recorded command count -->
                <div class="macro-info" v-if="o_state.a_o_command__macro.length > 0">
                    <span class="macro-count">{{ o_state.a_o_command__macro.length }}</span>
                    <span class="macro-label">command{{ o_state.a_o_command__macro.length !== 1 ? 's' : '' }} recorded</span>
                    <span class="macro-duration">{{ s_duration__macro }}</span>
                </div>

                <div class="macro-empty" v-else-if="!o_state.b_recording__macro">
                    No recording yet
                </div>

                <!-- command list -->
                <div class="macro-command-list" v-if="o_state.a_o_command__macro.length > 0">
                    <div
                        class="macro-command-item"
                        v-for="(o_cmd, n_idx) in o_state.a_o_command__macro"
                        :key="n_idx"
                        :class="{ active: o_state.b_playing__macro && n_idx === n_idx__playing }"
                    >
                        <span class="macro-cmd-idx">{{ n_idx }}</span>
                        <span class="macro-cmd-delta">+{{ o_cmd.n_ms__delta }}ms</span>
                        <span class="macro-cmd-desc">{{ f_s_command_label(o_cmd.o_msg) }}</span>
                    </div>
                </div>

                <!-- playback controls -->
                <div class="macro-playback" v-if="o_state.a_o_command__macro.length > 0 && !o_state.b_recording__macro">
                    <div class="macro-loop-toggle">
                        <label class="scan-toggle">
                            <input type="checkbox" v-model="o_state.b_loop__macro" :disabled="o_state.b_playing__macro" />
                            Loop
                        </label>
                    </div>
                    <div class="macro-playback-btn-row">
                        <button
                            class="btn-macro play"
                            @click="f_play"
                            v-if="!o_state.b_playing__macro"
                        >Play</button>
                        <button
                            class="btn-macro stop"
                            @click="f_stop_playback"
                            v-if="o_state.b_playing__macro"
                        >Stop</button>
                    </div>
                </div>

                <!-- clear -->
                <div class="macro-clear" v-if="o_state.a_o_command__macro.length > 0 && !o_state.b_recording__macro && !o_state.b_playing__macro">
                    <button class="btn-macro clear" @click="f_clear">Clear</button>
                </div>

            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            n_idx__playing: -1,
            n_id__timeout_playback: 0,
            b_stop_requested: false,
        };
    },
    computed: {
        s_duration__macro: function() {
            let n_ms__total = 0;
            for(let n_idx = 0; n_idx < o_state.a_o_command__macro.length; n_idx++){
                n_ms__total += o_state.a_o_command__macro[n_idx].n_ms__delta;
            }
            let n_sec = (n_ms__total / 1000).toFixed(1);
            return n_sec + 's';
        },
    },
    methods: {
        f_close: function() {
            o_state.o_panel_visibility.macro = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_toggle_record: function() {
            if(o_state.b_recording__macro){
                // stop recording
                o_state.b_recording__macro = false;
            } else {
                // start recording
                o_state.a_o_command__macro = [];
                o_state.n_ts_ms__macro_last = 0;
                o_state.b_recording__macro = true;
            }
        },
        f_s_command_label: function(o_msg) {
            if(o_msg.command === 'runContinuous'){
                return 'M' + o_msg.motor + ' run ' + o_msg.direction + ' ' + o_msg.n_rpm + 'rpm';
            }
            if(o_msg.command === 'stop'){
                return 'M' + o_msg.motor + ' stop';
            }
            if(o_msg.command === 'stopAll'){
                return 'Stop all';
            }
            if(o_msg.command === 'moveSteps'){
                return 'M' + o_msg.motor + ' move ' + o_msg.n_step + ' steps';
            }
            return o_msg.command;
        },
        f_play: function() {
            let o_self = this;
            o_state.b_playing__macro = true;
            o_self.b_stop_requested = false;
            o_self.n_idx__playing = 0;
            o_self.f_play_step(0);
        },
        f_play_step: function(n_idx) {
            let o_self = this;
            if(o_self.b_stop_requested){
                o_self.f_finish_playback();
                return;
            }
            if(n_idx >= o_state.a_o_command__macro.length){
                if(o_state.b_loop__macro && !o_self.b_stop_requested){
                    o_self.n_idx__playing = 0;
                    o_self.f_play_step(0);
                } else {
                    o_self.f_finish_playback();
                }
                return;
            }
            o_self.n_idx__playing = n_idx;
            let o_cmd = o_state.a_o_command__macro[n_idx];
            let n_ms__delay = n_idx === 0 ? 0 : o_cmd.n_ms__delta;
            o_self.n_id__timeout_playback = setTimeout(function(){
                if(o_self.b_stop_requested){
                    o_self.f_finish_playback();
                    return;
                }
                f_send_esp(o_cmd.o_msg);
                o_self.f_play_step(n_idx + 1);
            }, n_ms__delay);
        },
        f_stop_playback: function() {
            let o_self = this;
            o_self.b_stop_requested = true;
            clearTimeout(o_self.n_id__timeout_playback);
            o_self.f_finish_playback();
        },
        f_finish_playback: function() {
            let o_self = this;
            o_state.b_playing__macro = false;
            o_self.n_idx__playing = -1;
            o_self.b_stop_requested = false;
        },
        f_clear: function() {
            o_state.a_o_command__macro = [];
            o_state.n_ts_ms__macro_last = 0;
        },
    },
    beforeUnmount: function() {
        let o_self = this;
        clearTimeout(o_self.n_id__timeout_playback);
        o_state.b_recording__macro = false;
        o_state.b_playing__macro = false;
    },
};

export { o_component__macro };
