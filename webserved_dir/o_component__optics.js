import { o_state, f_save_setting__debounced } from './index.js';

// Optics hub: groups every imaging / camera panel behind one toolbar button.

let o_component__optics = {
    name: 'component-optics',
    template: `
        <div class="overlay-panel panel-optics" :class="{ visible: o_state.o_panel_visibility.optics }">
            <div class="panel-header">
                <h2>Optics</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <div class="hub-grid">
                    <button class="hub-item" @click="f_open('focus')">Focus</button>
                    <button class="hub-item" @click="f_open('focus_stack')">Stack</button>
                    <button class="hub-item" @click="f_open('camera_setting')">Camera</button>
                    <button class="hub-item" @click="f_open('filter')">Filter</button>
                </div>
            </div>
        </div>
    `,
    data: function() {
        return { o_state: o_state };
    },
    methods: {
        f_close: function() {
            o_state.o_panel_visibility.optics = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_open: function(s_key) {
            o_state.o_panel_visibility[s_key] = true;
            o_state.o_panel_visibility.optics = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
    },
};

export { o_component__optics };
