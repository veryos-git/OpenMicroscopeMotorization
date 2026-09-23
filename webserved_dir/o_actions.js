import { reactive } from './lib/vue.esm-browser.js';
import { f_o_action_system } from './actions.module.js';
let o_action_ui = reactive({ open: false, error: '' });
let o_actions = f_o_action_system(o_error => { o_action_ui.error = o_error.message || String(o_error); });
let f_action = (o, f) => o_actions.f_register({ ...o, invoke: (v, phase) => { if(phase !== 'release') return f(v, phase); } });
export { o_actions, o_action_ui, f_action };
