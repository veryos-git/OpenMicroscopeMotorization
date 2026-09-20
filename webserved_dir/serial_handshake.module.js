// Opening a serial port does not prove that the motor firmware is running.
export function f_wait_for_esp_status(f_subscribe, f_write, { n_timeout = 8000, n_interval = 300 } = {}) {
    return new Promise((resolve, reject) => {
        let b_done = false;
        let n_poll;
        let n_timeout_id;
        let f_unsubscribe = () => {};
        let f_finish = (o_error, o_status) => {
            if (b_done) return;
            b_done = true;
            clearInterval(n_poll);
            clearTimeout(n_timeout_id);
            f_unsubscribe();
            if (o_error) reject(o_error);
            else resolve(o_status);
        };
        f_unsubscribe = f_subscribe(o_data => {
            if (o_data.type === 'status' && Array.isArray(o_data.a_o_motor) && o_data.a_o_motor.length >= 3) {
                f_finish(null, o_data);
            }
        });
        let b_writing = false;
        let f_probe = async () => {
            if (b_done || b_writing) return;
            b_writing = true;
            try { await f_write({ command: 'status' }); }
            catch (o_error) { f_finish(o_error); }
            finally { b_writing = false; }
        };
        n_poll = setInterval(f_probe, n_interval);
        n_timeout_id = setTimeout(() => f_finish(new Error(
            'USB opened, but the motor firmware did not answer. Press RESET (without BOOT), then reconnect. If this persists, flash the updated firmware and check that the correct USB port is selected.'
        )), n_timeout);
        f_probe();
    });
}
