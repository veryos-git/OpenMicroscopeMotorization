import { o_state, f_save_setting__debounced } from './index.js';
import { o_component__icon } from './o_component__icon.js';

const o_component__gamepad = {
    name: 'component-gamepad',
    components: { ui_icon: o_component__icon },
    data() { return { o_state, a_cluster: [
        [{ i: 12, label: '↑' }, { i: 14, label: '←' }, { i: 15, label: '→' }, { i: 13, label: '↓' }],
        [{ i: 3, label: '△' }, { i: 2, label: '□' }, { i: 1, label: '○' }, { i: 0, label: '×' }],
    ] }; },
    methods: {
        f_close() {
            o_state.o_panel_visibility.gamepad = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_value(i) { return o_state.o_input__gamepad?.buttons[i]?.value || 0; },
        f_pressed(i) { return o_state.o_input__gamepad?.buttons[i]?.pressed || this.f_value(i) > 0.1; },
        f_axis(i) { return o_state.o_input__gamepad?.axes[i] || 0; },
        f_change() { o_state.b_armed__gamepad = false; },
    },
    template: `
        <div class="overlay-panel panel-gamepad" :class="{ visible: o_state.o_panel_visibility.gamepad }">
            <div class="panel-header"><h2><ui_icon s_name="gamepad" /> Gamepad <span class="ui-info" tabindex="0" role="note" data-tooltip="Gamepad&#10;Right stick: X/Y movement. Left stick up/down: Z focus. Speed = stick value × the corresponding XY or Z RPM (0.5 = half speed). Hold to keep moving; center to stop. A 15% center dead zone ignores drift. Buttons and triggers are shown for testing."></span></h2>
                <span class="panel-state gamepad-status" role="status">{{ o_state.s_status__gamepad }}</span>
                <button class="panel-close" aria-label="Close Gamepad" @click="f_close">&times;</button></div>
            <div class="panel-body">
                <div class="cockpit-row gamepad-source">
                <label for="gamepad-select" class="cockpit-label">Controller</label>
                <select id="gamepad-select" class="cockpit-grow" v-model.number="o_state.n_index__gamepad" @change="f_change">
                    <option :value="-1" disabled>Select a controller</option>
                    <option v-if="o_state.n_index__gamepad !== -1 && !o_state.a_o_gamepad.some(p => p.index === o_state.n_index__gamepad)" :value="o_state.n_index__gamepad">Controller disconnected</option>
                    <option v-for="pad in o_state.a_o_gamepad" :key="pad.index" :value="pad.index">{{ pad.index + 1 }} · {{ pad.id }}</option>
                </select>
                <label class="gamepad-enable" data-tooltip="Enable motor control&#10;Off: the sticks are only displayed and do not move the stage."><input type="checkbox" v-model="o_state.b_enabled__gamepad" @change="f_change"> Enable motor control</label>
                </div>
                <p class="setup-hint" v-if="!o_state.a_o_gamepad.length">Plug in your USB controller, then press a button to make it available.</p>
                <p class="setup-hint" v-if="o_state.s_error__gamepad">{{ o_state.s_error__gamepad }}</p>
                <p class="setup-hint" v-if="o_state.o_input__gamepad && o_state.o_input__gamepad.mapping !== 'standard'">Using the displayed stick axes for this USB controller. Button labels may differ from the PlayStation layout.</p>
                <div class="gamepad-layout" :class="{ disconnected: !o_state.b_connected__gamepad }" aria-label="PlayStation controller live inputs">
                    <div class="gamepad-half" v-for="(cluster, side) in a_cluster" :key="side">
                        <div class="gamepad-trigger" :class="{ pressed: f_pressed(6 + side) }">
                            <span>{{ side ? 'R2' : 'L2' }} · {{ Math.round(f_value(6 + side) * 100) }}%</span>
                            <meter min="0" max="1" :value="f_value(6 + side)" :aria-label="side ? 'R2 pull trigger' : 'L2 pull trigger'"></meter>
                        </div>
                        <div class="gamepad-shoulder" :class="{ pressed: f_pressed(4 + side) }">{{ side ? 'R1' : 'L1' }}</div>
                        <div class="gamepad-cluster">
                            <span v-for="(button, position) in cluster" :key="button.i" :class="['gamepad-button', 'position-' + position, { pressed: f_pressed(button.i) }]">{{ button.label }}</span>
                        </div>
                        <div class="gamepad-stick" :class="{ pressed: f_pressed(10 + side) }">
                            <span :style="{ transform: 'translate(' + (f_axis(side * 2) * 29) + 'px,' + (f_axis(side * 2 + 1) * 29) + 'px)' }"></span>
                        </div>
                        <b>{{ side ? 'Right stick · X / Y' : 'Left stick · Z focus' }}</b>
                        <small>X {{ f_axis(side * 2).toFixed(2) }} · Y {{ f_axis(side * 2 + 1).toFixed(2) }}</small>
                    </div>
                </div>
                <o_component__manual_speed s_context="gamepad" />
            </div>
        </div>
    `,
};
export { o_component__gamepad };
