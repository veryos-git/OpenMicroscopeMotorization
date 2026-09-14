import { o_state, f_save_setting__debounced } from './index.js';

// Motion hub: groups every stage / motor panel behind one toolbar button.

let o_component__motion = {
    name: 'component-motion',
    template: `
        <div class="overlay-panel panel-motion" :class="{ visible: o_state.o_panel_visibility.motion }">
            <div class="panel-header">
                <h2>Motion</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <div class="hub-grid">
                    <button class="hub-item" @click="f_open('jog')">Jog</button>
                    <button class="hub-item" @click="f_open('motors')">Motors</button>
                    <button class="hub-item" @click="f_open('backlash')">Backlash</button>
                    <button class="hub-item" @click="f_open('auto_move')">Auto</button>
                    <button class="hub-item" @click="f_open('macro')">Macro</button>
                    <button class="hub-item" @click="f_open('stats')">Stats</button>
                </div>
                <div class="live-note">
                    jog with WASD / the gamepad, or drag over the live image with the
                    mouse (Mouse Jog in the top bar).
                </div>
            </div>
        </div>
    `,
    data: function() {
        return { o_state: o_state };
    },
    methods: {
        f_close: function() {
            o_state.o_panel_visibility.motion = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_open: function(s_key) {
            o_state.o_panel_visibility[s_key] = true;
            o_state.o_panel_visibility.motion = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
    },
};

export { o_component__motion };
