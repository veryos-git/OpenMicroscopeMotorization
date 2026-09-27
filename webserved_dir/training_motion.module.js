// Training owns motor movement while a grid/focus operation is active.
import {
    f_n_motor__axis,
    f_register_esp_disconnect,
    f_register_esp_handler,
    f_send_esp,
    o_state,
} from './index.js';
let f_move_training = function (s_axis, n_target, o_signal) {
    return new Promise((f_resolve, f_reject) => {
        let n_motor = f_n_motor__axis(s_axis);
        if (o_signal.aborted || !o_state.b_connected__esp || n_motor === null) {
            f_reject(new Error('Stage disconnected, unassigned, or stopped'));
            return;
        }
        let n_step = n_target - o_state.a_o_motor[n_motor].n_position;
        if (!Number.isSafeInteger(n_step) || Math.abs(n_step) > 1000000) {
            f_reject(new Error('Invalid training movement'));
            return;
        }
        if (!n_step) {
            f_resolve();
            return;
        }
        let n_timer, f_off_message = () => {}, f_off_disconnect = () => {};
        let f_finish = function (o_error) {
            clearTimeout(n_timer);
            f_off_message();
            f_off_disconnect();
            o_signal.removeEventListener('abort', f_abort);
            if (o_error) f_reject(o_error);
            else f_resolve();
        };
        let f_abort = () => {
            f_send_esp({ motor: n_motor, command: 'stop' }, 'training');
            f_finish(new Error('Training stopped'));
        };
        f_off_message = f_register_esp_handler((o_message) => {
            if (o_message.motor !== n_motor || !['moveComplete', 'moveCancelled'].includes(o_message.type)) {
                return;
            }
            if (o_message.type !== 'moveComplete' || o_message.n_position !== n_target) {
                f_finish(new Error('Training movement did not reach its target'));
                return;
            }
            o_state.a_o_motor[n_motor].n_position = o_message.n_position;
            o_state.a_o_motor[n_motor].b_running = false;
            f_finish();
        });
        f_off_disconnect = f_register_esp_disconnect(() => f_finish(new Error('Stage disconnected')));
        o_signal.addEventListener('abort', f_abort, { once: true });
        n_timer = setTimeout(() => {
            f_send_esp({ motor: n_motor, command: 'stop' }, 'training');
            f_finish(new Error('Training movement timed out'));
        }, 120000);
        let n_rpm = s_axis === 'z' ? o_state.n_rpm__focus_jog : o_state.n_rpm__jog;
        if (!Number.isFinite(n_rpm) || n_rpm <= 0) {
            f_finish(new Error('Set a valid motor speed'));
            return;
        }
        try {
            f_send_esp({ motor: n_motor, command: 'moveSteps', n_step, n_rpm }, 'training');
        } catch (o_error) {
            f_finish(o_error);
        }
    });
};
export { f_move_training };
