import { f_o_capture__frame } from './o_capture.module.js';

let f_o_sam_state = () => ({
    b_sam_point: false,
    b_sam_hover: true,
    b_sam_point_busy: false,
    b_sam_snapshot_busy: false,
    s_sam_image: '',
    a_o_sam_point: [],
    o_sam_result: null,
    o_sam_cursor: null,
});

let o_sam_method = {
    async f_sam_start() {
        this.f_sam_close();
        if (this.b_busy || this.b_moving || this.o_state.b_scanning || !this.o_live) return;
        this.f_cancel_drag();
        this.b_crop = false;
        this.o_crop_start = null;
        this.b_sam_point = true;
        this.b_sam_snapshot_busy = true;
        this.o_state.o_zoom.b_selecting = false;
        let n_snapshot = this._n_sam_snapshot;
        try {
            let o_capture = await f_o_capture__frame({ b_flat: false, b_flash: false });
            if (n_snapshot !== this._n_sam_snapshot) return;
            if (o_capture.n_scl_x !== this.n_scl_x || o_capture.n_scl_y !== this.n_scl_y) {
                throw new Error('Camera geometry changed. Take a new image.');
            }
            this._o_sam_capture = o_capture;
            this.s_sam_image = URL.createObjectURL(o_capture.o_blob);
        } catch (o_error) {
            if (n_snapshot === this._n_sam_snapshot) {
                this.f_sam_close();
                this.s_sam_error = 'SAM: ' + o_error.message;
            }
        } finally {
            if (n_snapshot === this._n_sam_snapshot) this.b_sam_snapshot_busy = false;
        }
    },
    f_sam_reset_point() {
        this._n_sam_epoch = (this._n_sam_epoch || 0) + 1;
        clearTimeout(this._n_sam_hover_timer);
        this._o_sam_next = null;
        this.a_o_sam_point = [];
        this.o_sam_result = null;
        this.s_sam_error = '';
    },
    f_sam_close() {
        this._n_sam_snapshot = (this._n_sam_snapshot || 0) + 1;
        this.f_sam_reset_point();
        this.b_sam_point = false;
        this.b_sam_snapshot_busy = false;
        this._o_sam_capture = null;
        if (this.s_sam_image) URL.revokeObjectURL(this.s_sam_image);
        this.s_sam_image = '';
        this.o_sam_cursor = null;
    },
    f_sam_inside(o_point) {
        let o = this.o_crop_bounds;
        return o_point.n_x >= o.n_x && o_point.n_y >= o.n_y &&
            o_point.n_x <= o.n_x + o.n_scl_x && o_point.n_y <= o.n_y + o.n_scl_y;
    },
    f_sam_cursor(o_event) {
        this.o_sam_cursor = {
            left: Math.max(8, Math.min(o_event.clientX + 18, window.innerWidth - 246)) + 'px',
            top: Math.max(8, Math.min(o_event.clientY + 18, window.innerHeight - 116)) + 'px',
        };
    },
    f_sam_down(o_event, o_view) {
        if (![0, 1, 2].includes(o_event.button)) return;
        o_event.preventDefault();
        o_event.stopPropagation();
        this.f_sam_cursor(o_event);
        if (o_event.button === 1) {
            this.f_sam_reset_point();
            return;
        }
        if (!this._o_sam_capture || this.b_sam_snapshot_busy) return;
        let o_point = this.f_o_point(o_event, o_view);
        if (!this.f_sam_inside(o_point)) return;
        if (o_event.button === 2 && !this.a_o_sam_point.length) {
            this.s_sam_error = 'Left-click the object first, then right-click to exclude pixels.';
            return;
        }
        if (this.a_o_sam_point.length >= 128) {
            this.s_sam_error = 'Maximum 128 points. Reset points to start again.';
            return;
        }
        this.a_o_sam_point.push({ ...o_point, n_label: o_event.button === 0 ? 1 : 0 });
        this.f_sam_queue(this.a_o_sam_point, false);
    },
    f_sam_hover(o_event, o_view) {
        this.f_sam_cursor(o_event);
        if (!this.b_sam_hover || this.a_o_sam_point.length || !this._o_sam_capture ||
            this.b_busy || this.b_moving || this.o_state.b_scanning) return;
        let o_point = this.f_o_point(o_event, o_view);
        if (!this.f_sam_inside(o_point)) {
            this.f_sam_leave();
            return;
        }
        this.f_sam_queue([{ ...o_point, n_label: 1 }], true);
    },
    f_sam_leave() {
        this.o_hover = null;
        this.o_sam_cursor = null;
        if (!this.a_o_sam_point.length) this.f_sam_reset_point();
    },
    f_sam_queue(a_o_point, b_preview) {
        clearTimeout(this._n_sam_hover_timer);
        this.o_sam_result = null;
        this.s_sam_error = '';
        let n_epoch = this._n_sam_epoch = (this._n_sam_epoch || 0) + 1;
        this._o_sam_next = null;
        let o_work = { n_epoch, b_preview, a_o_point: a_o_point.map(o => ({ ...o })) };
        // Coalesce hovering, and retain only the latest prompt while decoding.
        if (b_preview) this._n_sam_hover_timer = setTimeout(() => {
            this._o_sam_next = o_work;
            this.f_sam_flush();
        }, 180);
        else {
            this._o_sam_next = o_work;
            this.f_sam_flush();
        }
    },
    async f_sam_flush() {
        if (this.b_sam_point_busy || !this._o_sam_next || !this._o_sam_capture) return;
        let o_work = this._o_sam_next;
        this._o_sam_next = null;
        this.b_sam_point_busy = true;
        let f_current = () => this.b_sam_point && o_work.n_epoch === this._n_sam_epoch;
        try {
            let [o_result] = await this.f_sam_infer(this._o_sam_capture, [{
                s_id: 'selection', s_label: 'selection', ...this.o_crop_bounds,
                a_o_point: o_work.a_o_point,
            }]);
            if (f_current()) {
                this.o_sam_result = { ...o_result, b_preview: o_work.b_preview };
                if (!o_result.o_bounds) this.s_sam_error = 'No pixels selected. Add a positive point or reset.';
            }
        } catch (o_error) {
            if (f_current()) this.s_sam_error = 'SAM: ' + o_error.message;
        } finally {
            this.b_sam_point_busy = false;
            this.f_sam_flush();
        }
    },
    f_sam_keep() {
        let o_result = this.o_sam_result;
        if (!o_result?.o_bounds || o_result.b_preview || this.b_sam_point_busy) return;
        let o_label = this.a_o_label.find(o => o.s_id === this.s_label);
        if (!o_label?.s_name.trim()) {
            this.s_sam_error = 'Enter a label first.';
            return;
        }
        this.a_o_box.push({
            s_id: crypto.randomUUID(), s_label: o_label.s_name.trim(), s_color: o_label.s_color,
            ...o_result.o_bounds, a_o_point: this.a_o_sam_point.map(o => ({ ...o })),
            o_segmentation: o_result.o_segmentation,
        });
        this.f_sam_reset_point();
    },
};
export { f_o_sam_state, o_sam_method };
