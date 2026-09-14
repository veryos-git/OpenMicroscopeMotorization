import { o_state, f_save_setting__debounced } from './index.js';

// ─── Shader source ──────────────────────────────────────────────────

let S_SHADER__VERTEX = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main(){
        // the video texture comes in upside down, so flip y here
        v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
        gl_Position = vec4(a_pos, 0.0, 1.0);
    }
`;

let S_SHADER__FRAGMENT = `
    precision mediump float;

    varying vec2 v_uv;

    uniform sampler2D u_texture;
    uniform vec2 u_texel;

    uniform int u_kernel;          // 0 none, 1 blur, 2 sharpen, 3 edge, 4 emboss
    uniform float u_edge_gain;
    uniform float u_edge_binary;   // 0 = grey edges, 1 = black/white edges
    uniform float u_brightness;
    uniform float u_contrast;
    uniform float u_gamma;
    uniform float u_saturation;
    uniform float u_grayscale;
    uniform float u_invert;
    uniform int u_colormap;        // 0 none, 1 heat, 2 ice, 3 jet

    float f_n_luma(vec3 v3_color){
        return dot(v3_color, vec3(0.2126, 0.7152, 0.0722));
    }

    vec3 f_v3_sample(vec2 v2_off){
        return texture2D(u_texture, v_uv + v2_off * u_texel).rgb;
    }

    // 3x3 convolution around the current pixel
    vec3 f_v3_convolve(float n_00, float n_10, float n_20,
                       float n_01, float n_11, float n_21,
                       float n_02, float n_12, float n_22,
                       float n_divisor){
        vec3 v3_sum =
            f_v3_sample(vec2(-1.0, -1.0)) * n_00 +
            f_v3_sample(vec2( 0.0, -1.0)) * n_10 +
            f_v3_sample(vec2( 1.0, -1.0)) * n_20 +
            f_v3_sample(vec2(-1.0,  0.0)) * n_01 +
            f_v3_sample(vec2( 0.0,  0.0)) * n_11 +
            f_v3_sample(vec2( 1.0,  0.0)) * n_21 +
            f_v3_sample(vec2(-1.0,  1.0)) * n_02 +
            f_v3_sample(vec2( 0.0,  1.0)) * n_12 +
            f_v3_sample(vec2( 1.0,  1.0)) * n_22;
        return v3_sum / n_divisor;
    }

    // sobel edge magnitude on the luminance
    float f_n_edge(){
        float n_00 = f_n_luma(f_v3_sample(vec2(-1.0, -1.0)));
        float n_10 = f_n_luma(f_v3_sample(vec2( 0.0, -1.0)));
        float n_20 = f_n_luma(f_v3_sample(vec2( 1.0, -1.0)));
        float n_01 = f_n_luma(f_v3_sample(vec2(-1.0,  0.0)));
        float n_21 = f_n_luma(f_v3_sample(vec2( 1.0,  0.0)));
        float n_02 = f_n_luma(f_v3_sample(vec2(-1.0,  1.0)));
        float n_12 = f_n_luma(f_v3_sample(vec2( 0.0,  1.0)));
        float n_22 = f_n_luma(f_v3_sample(vec2( 1.0,  1.0)));

        float n_gx = -n_00 - 2.0 * n_01 - n_02 + n_20 + 2.0 * n_21 + n_22;
        float n_gy = -n_00 - 2.0 * n_10 - n_20 + n_02 + 2.0 * n_12 + n_22;
        return sqrt(n_gx * n_gx + n_gy * n_gy);
    }

    vec3 f_v3_colormap(float n_it_nor){
        float n_t = clamp(n_it_nor, 0.0, 1.0);
        if(u_colormap == 1){
            return clamp(vec3(n_t * 3.0, n_t * 3.0 - 1.0, n_t * 3.0 - 2.0), 0.0, 1.0);
        }
        if(u_colormap == 2){
            return clamp(vec3(n_t * 3.0 - 2.0, n_t * 3.0 - 1.0, n_t * 3.0), 0.0, 1.0);
        }
        return clamp(vec3(
            1.5 - abs(4.0 * n_t - 3.0),
            1.5 - abs(4.0 * n_t - 2.0),
            1.5 - abs(4.0 * n_t - 1.0)
        ), 0.0, 1.0);
    }

    void main(){
        vec3 v3_color = f_v3_sample(vec2(0.0, 0.0));

        if(u_kernel == 1){
            v3_color = f_v3_convolve(1.0, 2.0, 1.0,
                                     2.0, 4.0, 2.0,
                                     1.0, 2.0, 1.0, 16.0);
        } else if(u_kernel == 2){
            v3_color = f_v3_convolve( 0.0, -1.0,  0.0,
                                     -1.0,  5.0, -1.0,
                                      0.0, -1.0,  0.0, 1.0);
        } else if(u_kernel == 3){
            float n_edge = clamp(f_n_edge() * u_edge_gain, 0.0, 1.0);
            n_edge = mix(n_edge, step(0.5, n_edge), u_edge_binary);
            v3_color = vec3(n_edge);
        } else if(u_kernel == 4){
            v3_color = f_v3_convolve(-2.0, -1.0, 0.0,
                                     -1.0,  1.0, 1.0,
                                      0.0,  1.0, 2.0, 1.0) ;
        }

        v3_color = clamp(v3_color, 0.0, 1.0);

        // tonal adjustments
        v3_color = v3_color + u_brightness;
        v3_color = (v3_color - 0.5) * u_contrast + 0.5;
        v3_color = clamp(v3_color, 0.0, 1.0);
        v3_color = pow(v3_color, vec3(1.0 / u_gamma));

        float n_luma = f_n_luma(v3_color);
        v3_color = mix(vec3(n_luma), v3_color, u_saturation);
        v3_color = mix(v3_color, vec3(n_luma), u_grayscale);
        v3_color = mix(v3_color, 1.0 - v3_color, u_invert);

        if(u_colormap != 0){
            v3_color = f_v3_colormap(f_n_luma(v3_color));
        }

        gl_FragColor = vec4(clamp(v3_color, 0.0, 1.0), 1.0);
    }
`;

let a_o_kernel = [
    { s_value: 'none',    s_label: 'none' },
    { s_value: 'blur',    s_label: 'blur 3x3' },
    { s_value: 'sharpen', s_label: 'sharpen' },
    { s_value: 'edge',    s_label: 'edge (sobel)' },
    { s_value: 'emboss',  s_label: 'emboss' },
];

let a_o_colormap = [
    { s_value: 'none', s_label: 'off' },
    { s_value: 'heat', s_label: 'heat' },
    { s_value: 'ice',  s_label: 'ice' },
    { s_value: 'jet',  s_label: 'jet' },
];

let f_n_kernel = function(s_kernel){
    if(s_kernel === 'blur') return 1;
    if(s_kernel === 'sharpen') return 2;
    if(s_kernel === 'edge') return 3;
    if(s_kernel === 'emboss') return 4;
    return 0;
};

let f_n_colormap = function(s_colormap){
    if(s_colormap === 'heat') return 1;
    if(s_colormap === 'ice') return 2;
    if(s_colormap === 'jet') return 3;
    return 0;
};

let f_o_filter__default = function(){
    return {
        b_enabled: false,
        s_kernel: 'none',
        n_edge_gain: 3.0,
        b_binary__edge: false,
        n_brightness: 0.0,
        n_contrast: 1.0,
        n_gamma: 1.0,
        n_saturation: 1.0,
        b_grayscale: false,
        b_invert: false,
        s_colormap: 'none',
    };
};

let o_component__filter = {
    name: 'component-filter',
    template: `
        <div class="overlay-panel panel-filter" :class="{ visible: o_state.o_panel_visibility.filter }">
            <div class="panel-header">
                <h2>Image Filter</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <div class="filter-row">
                    <span class="filter-label">Processing</span>
                    <button
                        class="toolbar-toggle"
                        :class="{ active: o_filter.b_enabled }"
                        @click="f_toggle"
                    >{{ o_filter.b_enabled ? 'on' : 'off' }}</button>
                </div>
                <div class="filter-note" v-if="s_error">{{ s_error }}</div>
                <div class="filter-note" v-else-if="!o_state.b_streaming__webcam">
                    start a camera in the top bar to see the filtered image
                </div>

                <div class="filter-group">
                    <div class="filter-row">
                        <span class="filter-label">Kernel</span>
                        <select v-model="o_filter.s_kernel" @change="f_on_change">
                            <option v-for="o_kernel in a_o_kernel" :value="o_kernel.s_value">
                                {{ o_kernel.s_label }}
                            </option>
                        </select>
                    </div>
                    <div v-if="o_filter.s_kernel === 'edge'">
                        <div class="filter-slider">
                            <label>Edge gain <span class="filter-value">{{ o_filter.n_edge_gain.toFixed(1) }}</span></label>
                            <input
                                type="range" min="0.5" max="12" step="0.1"
                                v-model.number="o_filter.n_edge_gain"
                                @input="f_on_change"
                            >
                        </div>
                        <label class="filter-check">
                            <input type="checkbox" v-model="o_filter.b_binary__edge" @change="f_on_change">
                            <span>black / white edges</span>
                        </label>
                    </div>
                </div>

                <div class="filter-group">
                    <div class="filter-slider">
                        <label>Brightness <span class="filter-value">{{ o_filter.n_brightness.toFixed(2) }}</span></label>
                        <input
                            type="range" min="-0.5" max="0.5" step="0.01"
                            v-model.number="o_filter.n_brightness"
                            @input="f_on_change"
                        >
                    </div>
                    <div class="filter-slider">
                        <label>Contrast <span class="filter-value">{{ o_filter.n_contrast.toFixed(2) }}</span></label>
                        <input
                            type="range" min="0" max="3" step="0.01"
                            v-model.number="o_filter.n_contrast"
                            @input="f_on_change"
                        >
                    </div>
                    <div class="filter-slider">
                        <label>Gamma <span class="filter-value">{{ o_filter.n_gamma.toFixed(2) }}</span></label>
                        <input
                            type="range" min="0.2" max="3" step="0.01"
                            v-model.number="o_filter.n_gamma"
                            @input="f_on_change"
                        >
                    </div>
                    <div class="filter-slider">
                        <label>Saturation <span class="filter-value">{{ o_filter.n_saturation.toFixed(2) }}</span></label>
                        <input
                            type="range" min="0" max="3" step="0.01"
                            v-model.number="o_filter.n_saturation"
                            @input="f_on_change"
                        >
                    </div>
                </div>

                <div class="filter-group">
                    <label class="filter-check">
                        <input type="checkbox" v-model="o_filter.b_grayscale" @change="f_on_change">
                        <span>grayscale</span>
                    </label>
                    <label class="filter-check">
                        <input type="checkbox" v-model="o_filter.b_invert" @change="f_on_change">
                        <span>invert</span>
                    </label>
                    <div class="filter-row" style="margin-top: 8px;">
                        <span class="filter-label">False color</span>
                        <select v-model="o_filter.s_colormap" @change="f_on_change">
                            <option v-for="o_colormap in a_o_colormap" :value="o_colormap.s_value">
                                {{ o_colormap.s_label }}
                            </option>
                        </select>
                    </div>
                </div>

                <div class="filter-row">
                    <span class="filter-label">{{ n_scl_x__frame }} &times; {{ n_scl_y__frame }}</span>
                    <button class="toolbar-toggle" @click="f_reset">reset</button>
                </div>
            </div>
        </div>

        <!-- processed image, drawn on top of the raw webcam video -->
        <teleport to="body">
            <canvas
                class="filter-canvas"
                ref="el_canvas"
                v-show="b_visible__canvas"
            ></canvas>
        </teleport>
    `,
    data: function() {
        return {
            o_state: o_state,
            a_o_kernel: a_o_kernel,
            a_o_colormap: a_o_colormap,
            s_error: '',
            n_scl_x__frame: 0,
            n_scl_y__frame: 0,
            n_id__frame: 0,
        };
    },
    computed: {
        o_filter: function() {
            return o_state.o_filter;
        },
        b_visible__canvas: function() {
            return o_state.o_filter.b_enabled && o_state.b_streaming__webcam && !this.s_error;
        },
    },
    methods: {
        f_close: function() {
            o_state.o_panel_visibility.filter = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_on_change: function() {
            f_save_setting__debounced('o_filter', o_state.o_filter);
        },
        f_toggle: function() {
            o_state.o_filter.b_enabled = !o_state.o_filter.b_enabled;
            this.f_on_change();
        },
        f_reset: function() {
            let o_self = this;
            let o_filter__default = f_o_filter__default();
            o_filter__default.b_enabled = o_state.o_filter.b_enabled;
            Object.assign(o_state.o_filter, o_filter__default);
            o_self.f_on_change();
        },

        // ─── WebGL ──────────────────────────────────────────────────

        f_el_video: function() {
            return document.getElementById('webcamVideo');
        },
        f_v_shader: function(o_gl, n_type, s_source) {
            let o_shader = o_gl.createShader(n_type);
            o_gl.shaderSource(o_shader, s_source);
            o_gl.compileShader(o_shader);
            if(!o_gl.getShaderParameter(o_shader, o_gl.COMPILE_STATUS)){
                let s_log = o_gl.getShaderInfoLog(o_shader);
                o_gl.deleteShader(o_shader);
                throw new Error('shader: ' + s_log);
            }
            return o_shader;
        },
        f_b_init_gl: function() {
            let o_self = this;
            if(o_self._o_gl) return true;

            let el_canvas = o_self.$refs.el_canvas;
            if(!el_canvas) return false;

            let o_gl = el_canvas.getContext('webgl', { preserveDrawingBuffer: false })
                || el_canvas.getContext('experimental-webgl');
            if(!o_gl){
                o_self.s_error = 'WebGL is not available in this browser';
                return false;
            }

            try {
                let o_shader__vertex = o_self.f_v_shader(o_gl, o_gl.VERTEX_SHADER, S_SHADER__VERTEX);
                let o_shader__fragment = o_self.f_v_shader(o_gl, o_gl.FRAGMENT_SHADER, S_SHADER__FRAGMENT);
                let o_program = o_gl.createProgram();
                o_gl.attachShader(o_program, o_shader__vertex);
                o_gl.attachShader(o_program, o_shader__fragment);
                o_gl.linkProgram(o_program);
                if(!o_gl.getProgramParameter(o_program, o_gl.LINK_STATUS)){
                    throw new Error('link: ' + o_gl.getProgramInfoLog(o_program));
                }
                o_gl.useProgram(o_program);

                // fullscreen quad
                let o_buffer = o_gl.createBuffer();
                o_gl.bindBuffer(o_gl.ARRAY_BUFFER, o_buffer);
                o_gl.bufferData(
                    o_gl.ARRAY_BUFFER,
                    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
                    o_gl.STATIC_DRAW
                );
                let n_loc__pos = o_gl.getAttribLocation(o_program, 'a_pos');
                o_gl.enableVertexAttribArray(n_loc__pos);
                o_gl.vertexAttribPointer(n_loc__pos, 2, o_gl.FLOAT, false, 0, 0);

                let o_texture = o_gl.createTexture();
                o_gl.bindTexture(o_gl.TEXTURE_2D, o_texture);
                o_gl.texParameteri(o_gl.TEXTURE_2D, o_gl.TEXTURE_WRAP_S, o_gl.CLAMP_TO_EDGE);
                o_gl.texParameteri(o_gl.TEXTURE_2D, o_gl.TEXTURE_WRAP_T, o_gl.CLAMP_TO_EDGE);
                o_gl.texParameteri(o_gl.TEXTURE_2D, o_gl.TEXTURE_MIN_FILTER, o_gl.LINEAR);
                o_gl.texParameteri(o_gl.TEXTURE_2D, o_gl.TEXTURE_MAG_FILTER, o_gl.LINEAR);

                o_self._o_gl = o_gl;
                o_self._o_program = o_program;
                o_self._o_texture = o_texture;
                o_self._o_uniform = {
                    u_texture:    o_gl.getUniformLocation(o_program, 'u_texture'),
                    u_texel:      o_gl.getUniformLocation(o_program, 'u_texel'),
                    u_kernel:     o_gl.getUniformLocation(o_program, 'u_kernel'),
                    u_edge_gain:  o_gl.getUniformLocation(o_program, 'u_edge_gain'),
                    u_edge_binary: o_gl.getUniformLocation(o_program, 'u_edge_binary'),
                    u_brightness: o_gl.getUniformLocation(o_program, 'u_brightness'),
                    u_contrast:   o_gl.getUniformLocation(o_program, 'u_contrast'),
                    u_gamma:      o_gl.getUniformLocation(o_program, 'u_gamma'),
                    u_saturation: o_gl.getUniformLocation(o_program, 'u_saturation'),
                    u_grayscale:  o_gl.getUniformLocation(o_program, 'u_grayscale'),
                    u_invert:     o_gl.getUniformLocation(o_program, 'u_invert'),
                    u_colormap:   o_gl.getUniformLocation(o_program, 'u_colormap'),
                };
                o_gl.uniform1i(o_self._o_uniform.u_texture, 0);
                return true;
            } catch(o_err) {
                console.error('filter webgl init failed:', o_err);
                o_self.s_error = String(o_err.message || o_err);
                return false;
            }
        },
        f_render: function() {
            let o_self = this;
            let el_video = o_self.f_el_video();
            let el_canvas = o_self.$refs.el_canvas;
            if(!el_video || !el_canvas) return;
            if(!el_video.videoWidth || !el_video.videoHeight) return;
            // HAVE_CURRENT_DATA, otherwise there is no frame to upload yet
            if(el_video.readyState < 2) return;
            if(!o_self.f_b_init_gl()) return;

            let o_gl = o_self._o_gl;

            if(el_canvas.width !== el_video.videoWidth || el_canvas.height !== el_video.videoHeight){
                el_canvas.width = el_video.videoWidth;
                el_canvas.height = el_video.videoHeight;
                o_self.n_scl_x__frame = el_video.videoWidth;
                o_self.n_scl_y__frame = el_video.videoHeight;
                o_gl.viewport(0, 0, el_canvas.width, el_canvas.height);
            }

            o_gl.bindTexture(o_gl.TEXTURE_2D, o_self._o_texture);
            o_gl.texImage2D(o_gl.TEXTURE_2D, 0, o_gl.RGB, o_gl.RGB, o_gl.UNSIGNED_BYTE, el_video);

            let o_filter = o_state.o_filter;
            let o_uniform = o_self._o_uniform;
            o_gl.uniform2f(o_uniform.u_texel, 1 / el_canvas.width, 1 / el_canvas.height);
            o_gl.uniform1i(o_uniform.u_kernel, f_n_kernel(o_filter.s_kernel));
            o_gl.uniform1f(o_uniform.u_edge_gain, o_filter.n_edge_gain);
            o_gl.uniform1f(o_uniform.u_edge_binary, o_filter.b_binary__edge ? 1 : 0);
            o_gl.uniform1f(o_uniform.u_brightness, o_filter.n_brightness);
            o_gl.uniform1f(o_uniform.u_contrast, o_filter.n_contrast);
            o_gl.uniform1f(o_uniform.u_gamma, o_filter.n_gamma);
            o_gl.uniform1f(o_uniform.u_saturation, o_filter.n_saturation);
            o_gl.uniform1f(o_uniform.u_grayscale, o_filter.b_grayscale ? 1 : 0);
            o_gl.uniform1f(o_uniform.u_invert, o_filter.b_invert ? 1 : 0);
            o_gl.uniform1i(o_uniform.u_colormap, f_n_colormap(o_filter.s_colormap));

            o_gl.drawArrays(o_gl.TRIANGLES, 0, 6);
        },
        f_tick: function() {
            let o_self = this;
            o_self.n_id__frame = requestAnimationFrame(function(){ o_self.f_tick(); });
            if(!o_self.b_visible__canvas) return;
            o_self.f_render();
        },
    },
    mounted: function() {
        let o_self = this;
        o_self.f_tick();
    },
    beforeUnmount: function() {
        let o_self = this;
        cancelAnimationFrame(o_self.n_id__frame);
    },
};

export { o_component__filter, f_o_filter__default };
