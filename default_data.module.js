import { f_v_crud__indb } from "./database_functions.module.js";
import {
    a_o_model,
    f_s_name_table__from_o_model,
} from "./webserved_dir/constructors.module.js";

let a_o_data_default = [
    { o_setting: { s_key: 's_ip__esp', s_value: '' } },
    { o_setting: { s_key: 'n_speed__jog', s_value: '50' } },
    { o_setting: { s_key: 's_id__webcam_device', s_value: '' } },
    { o_setting: { s_key: 'o_panel_visibility', s_value: JSON.stringify({ map: false, motion: false, optics: false, slide_library: false, jog: true, motors: true }) } },
    { o_setting: { s_key: 'o_mapping__w', s_value: JSON.stringify({ s_motor: '1', s_dir: 'cw' }) } },
    { o_setting: { s_key: 'o_mapping__s', s_value: JSON.stringify({ s_motor: '1', s_dir: 'ccw' }) } },
    { o_setting: { s_key: 'o_mapping__a', s_value: JSON.stringify({ s_motor: '0', s_dir: 'ccw' }) } },
    { o_setting: { s_key: 'o_mapping__d', s_value: JSON.stringify({ s_motor: '0', s_dir: 'cw' }) } },
    { o_setting: { s_key: 's_wifi_ssid', s_value: '' } },
    { o_setting: { s_key: 's_wifi_password', s_value: '' } },
    { o_setting: { s_key: 'a_o_pin_config', s_value: JSON.stringify([
        { s_name: 'Motor X', n_pin1: 4, n_pin2: 5, n_pin3: 6, n_pin4: 7 },
        { s_name: 'Motor Y', n_pin1: 15, n_pin2: 16, n_pin3: 17, n_pin4: 18 },
        { s_name: 'Motor Z', n_pin1: 8, n_pin2: 9, n_pin3: 10, n_pin4: 11 },
    ]) } },
]

let f_ensure_default_data = function(){
    let o_model__setting = a_o_model.find(function(o){ return o.s_name === 'o_setting'; });
    if(!o_model__setting) return;

    let s_name_table = f_s_name_table__from_o_model(o_model__setting);

    for(let o_entry of a_o_data_default){
        let o_data = o_entry.o_setting;
        // check if setting with this key already exists
        let a_o_existing = f_v_crud__indb('read', s_name_table, { s_key: o_data.s_key });
        if(!a_o_existing || a_o_existing.length === 0){
            f_v_crud__indb('create', s_name_table, o_data);
        }
    }
};

export {
    f_ensure_default_data
}
