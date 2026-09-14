import { o_state, f_send_wsmsg_with_response, f_save_setting__debounced } from './index.js';
import { f_o_wsmsg } from './constructors.module.js';
import { f_o_capture__frame, f_save_image } from './o_capture.module.js';

let o_component__manual_stitch = {
    name: 'component-manual-stitch',
    template: `
        <div class="overlay-panel panel-manual-stitch" :class="{ visible: o_state.o_panel_visibility.manual_stitch }">
            <div class="panel-header">
                <h2>Manual Stitch</h2>
                <button class="panel-close" @click="f_close" :disabled="b_stitching">&times;</button>
            </div>
            <div class="panel-body">

                <!-- capturing state -->
                <template v-if="!b_stitching && !s_path__stitched_image">
                    <div class="manual-stitch-count">{{ n_cnt__image }}</div>
                    <div class="manual-stitch-label">image{{ n_cnt__image === 1 ? '' : 's' }} captured</div>

                    <div class="manual-stitch-hint">
                        Press <span class="manual-stitch-key">F</span> to capture
                    </div>
                    <div class="manual-stitch-hint">
                        Press <span class="manual-stitch-key">R</span> to stitch
                    </div>

                    <div v-if="s_status__detail" class="manual-stitch-status">{{ s_status__detail }}</div>
                </template>

                <!-- stitching in progress -->
                <template v-if="b_stitching">
                    <div class="manual-stitch-status">Stitching {{ n_cnt__image }} image{{ n_cnt__image === 1 ? '' : 's' }}...</div>
                </template>

                <!-- stitched result -->
                <template v-if="s_path__stitched_image && !b_stitching">
                    <div class="manual-stitch-result">
                        <img
                            :src="'/api/file?path=' + encodeURIComponent(s_path__stitched_image)"
                            class="manual-stitch-preview"
                        />
                    </div>
                    <button class="btn-manual-stitch-reset" @click="f_reset">New Session</button>
                </template>

            </div>
        </div>
    `,

    data: function() {
        return {
            o_state: o_state,
            n_cnt__image: 0,
            s_path_folder: '',
            b_stitching: false,
            s_path__stitched_image: '',
            s_status__detail: '',
        };
    },

    mounted: function() {
        let o_self = this;
        o_self._f_on_keydown = function(o_evt) {
            o_self.f_on_keydown(o_evt);
        };
        window.addEventListener('keydown', o_self._f_on_keydown);
    },

    beforeUnmount: function() {
        let o_self = this;
        if(o_self._f_on_keydown){
            window.removeEventListener('keydown', o_self._f_on_keydown);
        }
    },

    methods: {

        f_close: function() {
            if(this.b_stitching) return;
            o_state.o_panel_visibility.manual_stitch = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },

        f_on_keydown: function(o_evt) {
            let o_self = this;
            if(!o_state.o_panel_visibility.manual_stitch) return;
            if(o_evt.target.tagName === 'INPUT' || o_evt.target.tagName === 'TEXTAREA' || o_evt.target.tagName === 'SELECT') return;
            if(o_self.b_stitching) return;

            if(o_evt.key === 'f' || o_evt.key === 'F'){
                o_evt.preventDefault();
                o_self.f_capture();
            }
            if(o_evt.key === 'r' || o_evt.key === 'R'){
                o_evt.preventDefault();
                o_self.f_run_stitch();
            }
        },

        f_capture: async function() {
            let o_self = this;
            if(o_self.b_stitching) return;
            // if we already have a stitched image, ignore (user must reset first)
            if(o_self.s_path__stitched_image) return;

            try {
                // create folder on first capture
                if(!o_self.s_path_folder){
                    let o_resp = await f_send_wsmsg_with_response(
                        f_o_wsmsg('manual_stitch_create_folder', {})
                    );
                    if(!o_resp.v_result || !o_resp.v_result.s_path_folder){
                        o_self.s_status__detail = 'Failed to create folder';
                        return;
                    }
                    o_self.s_path_folder = o_resp.v_result.s_path_folder;
                }

                let o_cap = await f_o_capture__frame();
                let s_filename = 'img_' + String(o_self.n_cnt__image).padStart(4, '0') + '.png';

                await f_save_image(o_cap.o_blob, o_self.s_path_folder, s_filename);

                o_self.n_cnt__image++;
                o_self.s_status__detail = '';
            } catch(o_error) {
                console.error('manual stitch capture error:', o_error);
                o_self.s_status__detail = o_error.message;
            }
        },

        f_run_stitch: async function() {
            let o_self = this;
            if(o_self.b_stitching) return;
            if(o_self.n_cnt__image < 2){
                o_self.s_status__detail = 'Need at least 2 images';
                return;
            }

            o_self.b_stitching = true;
            o_self.s_status__detail = '';

            try {
                let o_resp = await f_send_wsmsg_with_response(
                    f_o_wsmsg('manual_stitch_run', { s_path_folder: o_self.s_path_folder })
                );

                let o_result = o_resp.v_result;
                if(o_result && o_result.b_success){
                    o_self.s_path__stitched_image = o_result.s_path_output;
                } else {
                    o_self.s_status__detail = 'Stitch failed: ' + (o_result ? o_result.s_error : 'unknown error');
                }
            } catch(o_error) {
                console.error('manual stitch run error:', o_error);
                o_self.s_status__detail = o_error.message;
            }

            o_self.b_stitching = false;
        },

        f_reset: function() {
            let o_self = this;
            o_self.n_cnt__image = 0;
            o_self.s_path_folder = '';
            o_self.s_path__stitched_image = '';
            o_self.s_status__detail = '';
        },
    },
};

export { o_component__manual_stitch };
