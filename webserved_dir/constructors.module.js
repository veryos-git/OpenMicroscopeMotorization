let s_name_prop_ts_created = 'n_ts_ms_created';
let s_name_prop_ts_updated = 'n_ts_ms_updated';
let s_name_prop_id = 'n_id';

let f_s_name_table__from_o_model = function(o_model) {
    return 'a_' + o_model.s_name;
}
let f_s_name_foreign_key__from_o_model = function(o_model) {
    return 'n_' + o_model.s_name + '_' + s_name_prop_id;
}
let f_o_property = function(
    s_name,
    s_type,
    f_b_val_valid = function(){return true},
){
    return {
        s_name,
        s_type,
        f_b_val_valid
    }
}
let f_o_model = function({
    s_name,
    a_o_property
}){
    return {
        s_name,
        a_o_property
    }
}
let f_a_s_error__invalid_model_instance = function(
    o_model,
    o_instance
){
    let a_s_error = [];
    for(let o_model_prop of o_model.a_o_property){
        let value = o_instance[o_model_prop.s_name];
        let b_valid = true;
        if(o_model_prop.f_b_val_valid){
            b_valid = o_model_prop.f_b_val_valid(value);
            if(!b_valid){
                let s_error = `Invalid value for property ${o_model_prop.s_name}: ${value}
                validator function is: ${o_model_prop.f_b_val_valid.toString()}
                got value : ${value} of type ${typeof value}`;
                a_s_error.push(s_error);
            }
        }
    }
    for(let s_prop in o_instance){
        let o_model_prop = o_model.a_o_property.find(function(o_prop){
            return o_prop.s_name === s_prop;
        });
        if(!o_model_prop){
            let s_error = `Instance has property ${s_prop} that is not defined in model ${o_model.s_name}`;
            a_s_error.push(s_error);
        }
    }

    return a_s_error;
}
let f_o_model_prop__default_id = function(s_name){
    return f_o_property(s_name, 'number', function(n_id){
        if (n_id === undefined || n_id === null) return true;
        return Number.isInteger(n_id);
    });
}
let f_o_model_prop__timestamp_default = function(s_name){
    return f_o_property(s_name, 'number', function(n_timestamp){
        if (n_timestamp === undefined || n_timestamp === null) return true;
        return Number.isInteger(n_timestamp);
    });
}
let f_o_model_prop__number_nullable = function(s_name){
    return f_o_property(s_name, 'number', function(n){
        if (n === undefined || n === null) return true;
        return Number.isFinite(n);
    });
}
let f_o_model_prop__integer_nullable = function(s_name){
    return f_o_property(s_name, 'number', function(n){
        if (n === undefined || n === null) return true;
        return Number.isInteger(n);
    });
}
let f_o_model_prop__string_nullable = function(s_name){
    return f_o_property(s_name, 'string', function(s){
        if (s === undefined || s === null) return true;
        return typeof s === 'string';
    });
}
let f_o_model__from_s_name_table = function(s_name_table) {
    return a_o_model.find(function(o_model) {
        return f_s_name_table__from_o_model(o_model) === s_name_table;
    });
};

let f_o_model_instance = function(
    o_model,
    o_data
){
    let a_s_error = f_a_s_error__invalid_model_instance(o_model, o_data);
    if(a_s_error.length > 0){
        throw new Error('Invalid model instance: ' + a_s_error.join('; '));
    }
    return o_data;
}

// ─── Models ─────────────────────────────────────────────────────────

let o_model__o_setting = f_o_model({
    s_name: 'o_setting',
    a_o_property: [
        f_o_model_prop__default_id(s_name_prop_id),
        f_o_property('s_key', 'string', function(s){ return typeof s === 'string' && s !== ''; }),
        f_o_property('s_value', 'string', function(s){ return typeof s === 'string'; }),
        f_o_model_prop__timestamp_default(s_name_prop_ts_created),
        f_o_model_prop__timestamp_default(s_name_prop_ts_updated),
    ]
})

let o_model__o_wsclient = f_o_model({
    s_name: 'o_wsclient',
    a_o_property: [
        f_o_model_prop__default_id(s_name_prop_id),
        f_o_property('s_ip', 'string', function(s){ return s !== ''; }),
        f_o_model_prop__timestamp_default(s_name_prop_ts_created),
        f_o_model_prop__timestamp_default(s_name_prop_ts_updated),
    ]
})
let o_model__o_motor = f_o_model({
    s_name: 'o_stepper_28byj_48',
    a_o_property: [
        f_o_model_prop__default_id(s_name_prop_id),
        f_o_property('s_name', 'string', function(s){ return s !== ''; }),
        f_o_property('n_steps_per_revolution', 'number', function(n){ return Number.isInteger(n) && n > 0; }),
        f_o_property('n_speed__rpm', 'number', function(n){ return typeof n === 'number' && n > 0; }),
        f_o_property('n_direction', 'number', function(n){ return n === 1 || n === -1; }),
        f_o_property('n_pin1', 'number', function(n){ return Number.isInteger(n) && n >= 0; }),
        f_o_property('n_pin2', 'number', function(n){ return Number.isInteger(n) && n >= 0; }),
        f_o_property('n_pin3', 'number', function(n){ return Number.isInteger(n) && n >= 0; }),
        f_o_property('n_pin4', 'number', function(n){ return Number.isInteger(n) && n >= 0; }),
        f_o_model_prop__timestamp_default(s_name_prop_ts_created),
        f_o_model_prop__timestamp_default(s_name_prop_ts_updated),
    ]
})

let o_model__o_project = f_o_model({
    s_name: 'o_project',
    a_o_property: [
        f_o_model_prop__default_id(s_name_prop_id),
        f_o_property('s_name', 'string', function(s){ return typeof s === 'string' && s !== ''; }),
        f_o_model_prop__string_nullable('s_note'),
        f_o_model_prop__timestamp_default(s_name_prop_ts_created),
        f_o_model_prop__timestamp_default(s_name_prop_ts_updated),
    ]
})

let o_model__o_slide = f_o_model({
    s_name: 'o_slide',
    a_o_property: [
        f_o_model_prop__default_id(s_name_prop_id),
        f_o_model_prop__integer_nullable('n_o_project_n_id'),
        f_o_property('s_name', 'string', function(s){ return typeof s === 'string' && s !== ''; }),
        f_o_model_prop__string_nullable('s_note'),
        // last stage position (motor 0/1/2 step positions), saved/restored by the
        // slide library "save pos" / "go to" buttons
        f_o_model_prop__number_nullable('n_x__stage'),
        f_o_model_prop__number_nullable('n_y__stage'),
        f_o_model_prop__number_nullable('n_z__stage'),
        f_o_model_prop__timestamp_default(s_name_prop_ts_created),
        f_o_model_prop__timestamp_default(s_name_prop_ts_updated),
    ]
})

let o_model__o_map = f_o_model({
    s_name: 'o_map',
    a_o_property: [
        f_o_model_prop__default_id(s_name_prop_id),
        f_o_model_prop__integer_nullable('n_o_slide_n_id'),
        f_o_property('s_kind', 'string', function(s){ return s === 'grow' || s === 'scan'; }),
        f_o_model_prop__string_nullable('s_path_map'),
        f_o_model_prop__string_nullable('s_path_preview'),
        f_o_model_prop__string_nullable('s_path_folder'),
        f_o_model_prop__number_nullable('n_scl_x'),
        f_o_model_prop__number_nullable('n_scl_y'),
        f_o_property('b_primary', 'boolean', function(b){ return typeof b === 'boolean'; }),
        f_o_model_prop__timestamp_default(s_name_prop_ts_created),
        f_o_model_prop__timestamp_default(s_name_prop_ts_updated),
    ]
})

let o_model__o_marker = f_o_model({
    s_name: 'o_marker',
    a_o_property: [
        f_o_model_prop__default_id(s_name_prop_id),
        f_o_model_prop__integer_nullable('n_o_slide_n_id'),
        // origin map: suffix __origin means the auto FK matcher does not pick it
        // up (it only matches the exact n_o_map_n_id), which is fine -- the
        // marker is re-anchored per map through o_marker_map_position.
        f_o_model_prop__integer_nullable('n_o_map_n_id__origin'),
        f_o_property('s_name', 'string', function(s){ return typeof s === 'string' && s !== ''; }),
        f_o_model_prop__string_nullable('s_label'),
        f_o_model_prop__number_nullable('n_x__origin'),
        f_o_model_prop__number_nullable('n_y__origin'),
        f_o_model_prop__number_nullable('n_scl_x__origin'),
        f_o_model_prop__number_nullable('n_scl_y__origin'),
        f_o_model_prop__string_nullable('s_path_patch'),
        f_o_model_prop__timestamp_default(s_name_prop_ts_created),
        f_o_model_prop__timestamp_default(s_name_prop_ts_updated),
    ]
})

let o_model__o_marker_map_position = f_o_model({
    s_name: 'o_marker_map_position',
    a_o_property: [
        f_o_model_prop__default_id(s_name_prop_id),
        f_o_model_prop__integer_nullable('n_o_marker_n_id'),
        f_o_model_prop__integer_nullable('n_o_map_n_id'),
        f_o_property('b_found', 'boolean', function(b){ return typeof b === 'boolean'; }),
        f_o_model_prop__number_nullable('n_x'),
        f_o_model_prop__number_nullable('n_y'),
        f_o_model_prop__number_nullable('n_scl_x'),
        f_o_model_prop__number_nullable('n_scl_y'),
        f_o_model_prop__timestamp_default(s_name_prop_ts_created),
        f_o_model_prop__timestamp_default(s_name_prop_ts_updated),
    ]
})


let a_o_model = [
    o_model__o_setting,
    o_model__o_wsclient,
    o_model__o_motor,
    o_model__o_project,
    o_model__o_slide,
    o_model__o_map,
    o_model__o_marker,
    o_model__o_marker_map_position,
];

// ─── Toast ──────────────────────────────────────────────────────────

let f_o_toast = function(
    s_message,
    s_type,
    n_ts_ms_created,
    n_ttl_ms
){
    return {
        s_message,
        s_type,
        n_ts_ms_created,
        n_ttl_ms
    }
}

// ─── Exposed functions ──────────────────────────────────────────────

let f_o_sfunexposed = function(s_name, s_f){
    return { s_name, s_f }
}
let o_sfunexposed__f_v_crud__indb = f_o_sfunexposed(
    'f_v_crud__indb',
    `return await f_v_crud__indb(...a_v_arg)`
)
let o_sfunexposed__f_delete_table_data = f_o_sfunexposed(
    'f_delete_table_data',
    `return await f_delete_table_data(...a_v_arg)`
)
let a_o_sfunexposed = [
    o_sfunexposed__f_v_crud__indb,
    o_sfunexposed__f_delete_table_data,
]

// ─── WebSocket message factory ──────────────────────────────────────

let f_o_wsmsg = function(s_type, v_data){
    return {
        s_type,
        v_data,
        s_uuid: crypto.randomUUID(),
    }
}

export {
    o_model__o_setting,
    o_model__o_wsclient,
    o_model__o_project,
    o_model__o_slide,
    o_model__o_map,
    o_model__o_marker,
    o_model__o_marker_map_position,
    a_o_model,
    f_s_name_table__from_o_model,
    f_s_name_foreign_key__from_o_model,
    f_o_model_instance,
    f_o_model__from_s_name_table,
    s_name_prop_ts_created,
    s_name_prop_ts_updated,
    f_a_s_error__invalid_model_instance,
    s_name_prop_id,
    f_o_toast,
    a_o_sfunexposed,
    o_sfunexposed__f_v_crud__indb,
    o_sfunexposed__f_delete_table_data,
    f_o_wsmsg,
}
