import { o_state, f_save_setting } from './index.js';
import { a_o_speed_preset, f_n_speed } from './manual_speed.module.js';

// Serialize writes across the toolbar, Setup and Gamepad instances, including
// first-time settings creation and quick successive preset selections.
let o_save_queue = Promise.resolve();
const o_component__manual_speed = {
    name: 'component-manual-speed',
    props: { s_context: { type: String, default: 'toolbar' } },
    data() { return { o_state, a_o_speed_preset, s_error: '' }; },
    methods: {
        f_set(axis, value) {
            const key = axis === 'z' ? 'n_rpm__focus_jog' : 'n_rpm__jog';
            o_state[key] = f_n_speed(value, o_state[key]);
        },
        async f_save() {
            const value = { xy: o_state.n_rpm__jog, z: o_state.n_rpm__focus_jog };
            this.s_error = '';
            const pending = o_save_queue.then(() => f_save_setting('o_rpm__manual', value));
            o_save_queue = pending.catch(() => {});
            try { await pending; } catch(error) { this.s_error = 'Speed not saved. Retry by choosing the speed again.'; }
        },
        f_preset(preset) {
            this.f_set('xy', preset.xy);
            this.f_set('z', preset.z);
            return this.f_save();
        },
    },
    template: `
        <div class="manual-speeds" aria-label="Manual movement speeds">
            <div class="manual-speed" v-for="axis in ['xy', 'z']" :key="axis">
                <label :for="s_context + '-speed-' + axis">{{ axis === 'xy' ? 'XY' : 'Z focus' }}</label>
                <input type="range" min="0.05" max="15" step="0.05"
                    :aria-label="(axis === 'xy' ? 'XY' : 'Z focus') + ' speed slider'"
                    :disabled="axis === 'z' && o_state.o_motor__axis.z === null"
                    :value="axis === 'xy' ? o_state.n_rpm__jog : o_state.n_rpm__focus_jog"
                    @input="f_set(axis, $event.target.value)" @change="f_save" />
                <input type="number" :id="s_context + '-speed-' + axis" min="0.05" max="15" step="0.05"
                    :disabled="axis === 'z' && o_state.o_motor__axis.z === null"
                    :value="axis === 'xy' ? o_state.n_rpm__jog : o_state.n_rpm__focus_jog"
                    @change="f_set(axis, $event.target.value); $event.target.value = axis === 'xy' ? o_state.n_rpm__jog : o_state.n_rpm__focus_jog; f_save()" />
                <span>RPM</span>
            </div>
            <div class="manual-speed-presets" aria-label="Speed presets">
                <button v-for="preset in a_o_speed_preset" :key="preset.s_name" class="toolbar-toggle"
                    :class="{ active: o_state.n_rpm__jog === preset.xy && o_state.n_rpm__focus_jog === preset.z }"
                    :aria-pressed="o_state.n_rpm__jog === preset.xy && o_state.n_rpm__focus_jog === preset.z"
                    :title="'XY ' + preset.xy + ' RPM; Z ' + preset.z + ' RPM'"
                    @click="f_preset(preset)">{{ preset.s_name }}</button>
            </div>
            <small v-if="o_state.o_motor__axis.z === null">Z motor unassigned</small>
            <small v-if="s_error" role="alert">{{ s_error }}</small>
        </div>
    `,
};
export { o_component__manual_speed };
