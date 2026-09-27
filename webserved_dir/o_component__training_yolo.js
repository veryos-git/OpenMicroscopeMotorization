import { f_o_box_from_crop, f_o_crop_bounds } from './training_crop.module.js';
import { o_state } from './index.js';
import { f_o_capture__frame } from './o_capture.module.js';
import { f_o_camera_track } from './o_camera.module.js';

let f_request = async function (s_action, o_option, s_dataset) {
    s_action += '?dataset=' + encodeURIComponent(s_dataset);
    let o_response = await fetch('/api/training/yolo/' + s_action, o_option);
    let o_result = await o_response.json();
    if (!o_response.ok) throw new Error(o_result.s_error || 'YOLO request failed');
    return o_result;
};
let o_component__training_yolo = {
    name: 'training-yolo',
    emits: ['prediction'],
    props: {
        o_crop: { type: Object, default: null },
        b_capture_busy: Boolean,
        s_dataset: { type: String, required: true },
    },
    template: `<section class="training-yolo">
        <h3>YOLO model</h3>
        <p v-if="o_status && !o_status.b_ready">Install YOLO support once: <code>deno task install-yolo</code></p>
        <label>Saved model
            <select v-model="s_model" :disabled="b_busy || !o_status?.a_o_model?.length" aria-label="YOLO model">
                <option value="" disabled>No model selected</option>
                <option v-for="o_model in o_status?.a_o_model || []" :key="o_model.s_id" :value="o_model.s_id">{{ o_model.s_name }} · {{ new Date(o_model.n_ts_ms).toLocaleString() }}</option>
            </select>
        </label>
        <p v-if="o_model">Labels: {{ o_model.a_s_label.join(', ') }}</p>
        <p v-else>No fine-tuned model for this dataset yet.</p>
        <label>New model name <input v-model="s_name_model" maxlength="100" placeholder="Optional name" :disabled="b_busy" aria-label="New YOLO model name"></label>
        <label><input type="checkbox" v-model="b_parent" :disabled="b_busy || !o_model"> Fine-tune selected model (otherwise pretrained YOLO)</label>
        <div class="training-label">
            <label>Epochs <input type="number" min="1" max="500" v-model.number="n_epoch" :disabled="b_busy" aria-label="YOLO epochs"></label>
            <button @click="f_train" :disabled="b_busy || b_capture_busy || !o_status?.b_ready">Fine tune YOLO</button>
        </div>
        <small>Uses saved images except “bad”. Capture at least two XY regions for training and validation. First use downloads the base model.</small>
        <div class="training-label">
            <label>Confidence <input type="number" min="0.01" max="1" step="0.05" v-model.number="n_confidence" :disabled="b_busy" aria-label="YOLO confidence"></label>
            <button @click="f_infer" :disabled="b_busy || b_capture_busy || !o_status?.b_ready || !o_model">Infer YOLO</button>
        </div>
        <small>Runs once on the selected crop, or the full camera frame if no crop is selected. Detections are previews, not saved annotations.</small>
        <div v-if="o_status?.o_job">
            <p role="status">{{ o_status.o_job.s_dataset_name }} · {{ o_status.o_job.s_kind }} · {{ o_status.o_job.s_status }}<span v-if="o_status.o_job.n_epoch_total"> · epoch {{ o_status.o_job.n_epoch }} / {{ o_status.o_job.n_epoch_total }}</span></p>
            <progress v-if="o_status.o_job.n_epoch_total" :value="o_status.o_job.n_epoch" :max="o_status.o_job.n_epoch_total"></progress>
            <button v-if="b_job_busy && o_status.o_job.s_dataset===s_dataset" @click="f_cancel">Cancel YOLO</button>
            <details v-if="o_status.o_job.a_s_log?.length"><summary>YOLO log</summary><pre>{{ o_status.o_job.a_s_log.join(String.fromCharCode(10)) }}</pre></details>
            <p class="record-error" v-if="o_status.o_job.s_error">{{ o_status.o_job.s_error }}</p>
        </div>
        <p role="status">{{ s_message }}</p><p class="record-error" role="alert" v-if="s_error">{{ s_error }}</p>
    </section>`,
    data: () => ({
        o_status: null,
        s_model: '',
        s_name_model: '',
        b_parent: false,
        b_request: false,
        n_epoch: 50,
        n_confidence: .25,
        s_error: '',
        s_message: '',
        s_pending: '',
        s_context: '',
        o_track: null,
    }),
    computed: {
        o_model() {
            return this.o_status?.a_o_model?.find((o) => o.s_id === this.s_model) || null;
        },
        b_job_busy() {
            return ['preparing', 'running', 'cancelling', 'publishing'].includes(
                this.o_status?.o_job?.s_status,
            );
        },
        b_busy() {
            return this.b_request || this.b_job_busy;
        },
        s_stage() {
            return JSON.stringify([
                o_state.b_connected__esp,
                o_state.o_motor__axis,
                o_state.a_o_motor.map((o) => [o.n_position, o.b_running]),
                o_state.s_id__webcam_device,
            ]);
        },
    },
    watch: {
        o_crop() {
            this.s_context = '';
            this.$emit('prediction', []);
        },
        s_model() {
            try {
                localStorage.setItem('omm.training.model.' + this.s_dataset, this.s_model);
            } catch (_) {}
            this.s_context = '';
            this.$emit('prediction', []);
        },
        s_stage() {
            this.s_context = '';
            this.$emit('prediction', []);
        },
    },
    mounted() {
        this._b_alive = true;
        this.f_poll();
    },
    beforeUnmount() {
        this._b_alive = false;
        clearTimeout(this._n_timer);
    },
    methods: {
        f_request(s_action, o_option) {
            return f_request(s_action, o_option, this.s_dataset);
        },
        f_status_apply(o_status) {
            this.o_status = o_status;
            if (o_status.o_job?.s_status === 'done' && o_status.o_job.s_id === this._s_training_id) {
                this.s_model = this._s_training_id;
                this._s_training_id = '';
            }
            if (!o_status.a_o_model?.some((o) => o.s_id === this.s_model)) {
                let s_saved;
                try {
                    s_saved = localStorage.getItem('omm.training.model.' + this.s_dataset);
                } catch (_) {}
                this.s_model = o_status.a_o_model?.find((o) => o.s_id === s_saved)?.s_id ||
                    o_status.a_o_model?.[0]?.s_id || '';
            }
        },
        f_context() {
            let o_video = document.getElementById('webcamVideo');
            return JSON.stringify([
                this.s_stage,
                this.o_crop,
                o_video?.videoWidth,
                o_video?.videoHeight,
                f_o_camera_track()?.getSettings().zoom,
            ]);
        },
        async f_poll() {
            try {
                let o_status = await this.f_request('status');
                if (!this._b_alive) return;
                this.f_status_apply(o_status);
                let o_job = o_status.o_job;
                if (
                    this.s_pending && o_job?.s_id === this.s_pending &&
                    ['done', 'error', 'cancelled'].includes(o_job.s_status)
                ) {
                    this.s_pending = '';
                    if (o_job.s_status === 'done') {
                        if (this.s_context !== this.f_context() || this.o_track !== f_o_camera_track()) {
                            this.s_message = 'Stage or camera changed. Run Infer YOLO again.';
                        } else {
                            this.$emit(
                                'prediction',
                                o_job.o_result.a_o_box.map((o) => f_o_box_from_crop(o, this._o_infer_bounds)),
                            );
                            this.s_message = o_job.o_result.a_o_box.length + ' detections';
                        }
                    }
                }
            } catch (o_error) {
                if (this._b_alive) this.s_error = o_error.message;
            } finally {
                if (this._b_alive) this._n_timer = setTimeout(() => this.f_poll(), 1500);
            }
        },
        async f_run(f_work) {
            if (this.b_busy) return;
            this.b_request = true;
            this.s_error = '';
            try {
                await f_work();
            } catch (o_error) {
                this.s_error = o_error.message;
            } finally {
                this.b_request = false;
            }
        },
        f_train() {
            return this.f_run(async () => {
                let o_job = await this.f_request('train', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        n_epoch: this.n_epoch,
                        s_name: this.s_name_model.trim() || undefined,
                        s_model: this.b_parent ? this.s_model : undefined,
                    }),
                });
                this._s_training_id = o_job.s_id;
                this.f_status_apply(await this.f_request('status'));
                this.s_message =
                    'Fine-tuning started. You can close this panel and return to check progress.';
            });
        },
        f_infer() {
            return this.f_run(async () => {
                if (!this.o_model) throw new Error('Select a model from this dataset first');
                if (o_state.a_o_motor.some((o) => o.b_running) || o_state.b_scanning) {
                    throw new Error('Stop the stage before inference');
                }
                this.s_context = this.f_context();
                this.o_track = f_o_camera_track();
                this.$emit('prediction', []);
                let o_capture = await f_o_capture__frame({ b_flat: false, o_roi: this.o_crop });
                if (this.s_context !== this.f_context() || this.o_track !== f_o_camera_track()) {
                    throw new Error('Camera or stage changed during capture');
                }
                this._o_infer_bounds = f_o_crop_bounds(
                    o_capture.o_roi,
                    o_capture.n_scl_x__video,
                    o_capture.n_scl_y__video,
                );
                let o_form = new FormData();
                o_form.append('image', o_capture.o_blob, 'image.png');
                o_form.append('confidence', String(this.n_confidence));
                o_form.append('model', this.s_model);
                let o_job = await this.f_request('infer', { method: 'POST', body: o_form });
                this.s_pending = o_job.s_id;
                this.s_message = 'Inferring current frame…';
                this.f_status_apply(await this.f_request('status'));
            });
        },
        async f_cancel() {
            try {
                await this.f_request('cancel', { method: 'POST' });
                this.f_status_apply(await this.f_request('status'));
            } catch (o_error) {
                this.s_error = o_error.message;
            }
        },
    },
};
export { o_component__training_yolo };
