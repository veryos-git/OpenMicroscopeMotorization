import { o_state, f_save_setting__debounced, f_save_flat_field, f_send_wsmsg_with_response } from './index.js';
import { f_o_frame__imagedata, f_save_image } from './o_capture.module.js';
import { f_flat__set, f_b_flat__loaded, f_o_flat } from './o_flatfield.module.js';
import { f_o_camera_snapshot } from './o_camera.module.js';
import { f_o_wsmsg } from './constructors.module.js';
import { o_component__icon } from './o_component__icon.js';

let o_component__calibration_overlay = {
    name: 'component-calibration-overlay',
    components: { ui_icon: o_component__icon },
    template: `
        <div class="overlay-panel panel-calibration" :class="{ visible: o_state.o_panel_visibility.calibration }">
            <div class="panel-header">
                <h2><ui_icon s_name="flat" /> Flat field <span class="ui-info" tabindex="0" role="note" data-tooltip="Flat-field correction&#10;Removes dust shadows and uneven illumination using a captured image of an empty, evenly lit field. Capture it again after changing the optics or camera settings."></span></h2>
                <span class="panel-state" v-if="o_state.o_flat_field.b_loaded">
                    {{ o_state.o_flat_field.n_scl_x }} &times; {{ o_state.o_flat_field.n_scl_y }} px &middot; captured
                </span>
                <span class="panel-state" v-else>no flat image captured yet</span>
                <button
                    class="toolbar-toggle flat-power"
                    :class="{ active: o_state.o_flat_field.b_active }"
                    @click="f_toggle_flat"
                    :disabled="!o_state.o_flat_field.b_loaded"
                    aria-label="Flat-field correction" :aria-pressed="o_state.o_flat_field.b_active"
                    data-tooltip="Apply the flat-field correction to the live image"
                >{{ o_state.o_flat_field.b_active ? 'ON' : 'OFF' }}</button>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <div v-if="s_error__flat" class="focusstack-error">{{ s_error__flat }}</div>
                <button
                    class="btn-scan-start"
                    style="width: 100%;"
                    @click="f_capture_flat"
                    :disabled="!o_state.b_streaming__webcam || b_flat_capturing"
                    data-tooltip="Capture&#10;Move to an empty, evenly lit place of the slide and capture. The new image replaces the old one and the correction is switched on."
                >{{ b_flat_capturing ? 'Capturing…' : 'Capture flat field correction image' }}</button>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            b_flat_capturing: false,
            s_error__flat: '',
        };
    },
    methods: {
        f_close: function() {
            o_state.o_panel_visibility.calibration = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_toggle_flat: function() {
            if (!o_state.o_flat_field.b_loaded) return;
            o_state.o_flat_field.b_active = !o_state.o_flat_field.b_active;
            f_save_flat_field();
        },
        f_capture_flat: async function() {
            let o_self = this;
            if (!o_state.b_streaming__webcam || o_self.b_flat_capturing) return;
            o_self.b_flat_capturing = true;
            o_self.s_error__flat = '';
            try {
                let o_frame = await f_o_frame__imagedata();

                let o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('flatfield_create_folder', {}));
                if (!o_resp.v_result || !o_resp.v_result.s_path_folder) throw new Error('could not create flat field folder');
                let s_path_folder = o_resp.v_result.s_path_folder;
                let s_path_flat = s_path_folder + '/flat.png';

                let el_canvas = document.createElement('canvas');
                el_canvas.width = o_frame.n_scl_x;
                el_canvas.height = o_frame.n_scl_y;
                el_canvas.getContext('2d').putImageData(o_frame.o_imagedata, 0, 0);
                let o_blob = await new Promise(function(resolve){ el_canvas.toBlob(resolve, 'image/png'); });
                await f_save_image(o_blob, s_path_folder, 'flat.png');

                f_flat__set(o_frame.o_imagedata.data, o_frame.n_scl_x, o_frame.n_scl_y, {
                    s_path_flat: s_path_flat,
                    n_ms__created: Date.now(),
                });
                o_state.o_flat_field.b_loaded = true;
                o_state.o_flat_field.b_active = true;
                o_state.o_flat_field.s_path_flat = s_path_flat;
                o_state.o_flat_field.n_scl_x = o_frame.n_scl_x;
                o_state.o_flat_field.n_scl_y = o_frame.n_scl_y;
                o_state.o_flat_field.a_n_mean__channel = f_o_flat().a_n_mean__channel.slice();
                o_state.o_flat_field.n_ms__created = Date.now();
                o_state.o_flat_field.o_camera__flat = f_o_camera_snapshot();
                f_save_flat_field();
            } catch (o_error) {
                o_self.s_error__flat = o_error.message || String(o_error);
            }
            o_self.b_flat_capturing = false;
        },
        f_load_flat: async function() {
            let s_path = o_state.o_flat_field.s_path_flat;
            if (!s_path || f_b_flat__loaded()) return;
            try {
                let o_img = new Image();
                o_img.src = '/api/file?path=' + encodeURIComponent(s_path);
                await o_img.decode();
                let el_canvas = document.createElement('canvas');
                el_canvas.width = o_img.width;
                el_canvas.height = o_img.height;
                el_canvas.getContext('2d').drawImage(o_img, 0, 0);
                let o_imagedata = el_canvas.getContext('2d').getImageData(0, 0, o_img.width, o_img.height);
                f_flat__set(o_imagedata.data, o_img.width, o_img.height, {
                    s_path_flat: s_path,
                    n_ms__created: o_state.o_flat_field.n_ms__created || 0,
                });
                o_state.o_flat_field.b_loaded = true;
                o_state.o_flat_field.n_scl_x = o_img.width;
                o_state.o_flat_field.n_scl_y = o_img.height;
                o_state.o_flat_field.a_n_mean__channel = f_o_flat().a_n_mean__channel.slice();
            } catch (o_error) {
                console.warn('flat field load failed:', o_error);
                o_state.o_flat_field.b_loaded = false;
            }
        },
    },
    mounted: function() {
        this.f_load_flat();
    },
};

export { o_component__calibration_overlay };
