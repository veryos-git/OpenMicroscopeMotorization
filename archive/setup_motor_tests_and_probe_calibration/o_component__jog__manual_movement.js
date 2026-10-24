// Archived 2026-10-25 from webserved_dir/o_component__jog.js (not runnable on its own).
// The visible "Manual movement" section, shown only inside Setup → Motor tests & calibration.
// Speed and mouse movement are in the toolbar; key directions follow the Reverse buttons in Setup.

// ── template ──
/*
        <section class="hardware-inputs">
            <h3>Manual movement</h3>
            <o_component__manual_speed s_context="setup" />
            <p class="setup-hint">Default keys: A / D: X · W / S: Y · Q / E: focus. Hold to move; release to stop. Customize in Actions.</p>
            <button class="toolbar-toggle" :class="{ active: o_state.b_enabled__mouse_jog }" @click="f_toggle_mouse_jog">Mouse movement {{ o_state.b_enabled__mouse_jog ? 'on' : 'off' }}</button>
            <p class="setup-hint">On the camera image, hold the left mouse button for X/Y or the right button for focus.</p>
            <details>
                <summary>Input directions &amp; gamepad</summary>
                <div class="mapping-row header"><span>Input</span><span>Axis</span><span>Direction</span></div>
                <div class="mapping-row" v-for="s_key in ['a', 'd', 'w', 's', 'q', 'e', 'mouse_right']" :key="s_key">
                    <span>{{ s_key === 'mouse_right' ? 'Mouse ↑' : s_key.toUpperCase() }}</span>
                    <span>{{ { a: 'X', d: 'X', w: 'Y', s: 'Y', q: 'Z', e: 'Z', mouse_right: 'Z' }[s_key] }}</span>
                    <select v-model="f_o_mapping(s_key).s_dir" @change="f_on_mapping_change(s_key)">
                        <option value="cw">CW</option><option value="ccw">CCW</option>
                    </select>
                </div>
                <p class="setup-hint">{{ o_state.b_connected__gamepad ? o_state.s_name__gamepad : 'Open Gamepad to select a controller: right stick X/Y, left stick focus.' }}</p>
            </details>
        </section>
*/

// ── methods ──
let o_methods = {
        f_o_mapping: function(s_key) {
            return o_state['o_mapping__' + s_key];
        },

        f_on_mapping_change: function(s_key) {
            f_save_setting('o_mapping__' + s_key, o_state['o_mapping__' + s_key]);
        },

        f_on_mapping_change__mouse_right: function() {
            this.f_stop_mouse_axis('z');
            f_save_setting('o_mapping__mouse_right', o_state.o_mapping__mouse_right);
        },

        f_toggle_mouse_jog: function() {
            f_toggle_mouse_jog();
        },

};
