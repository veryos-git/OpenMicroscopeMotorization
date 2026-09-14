
import { Database } from "jsr:@db/sqlite@0.11";
import {
    a_o_model,
    f_s_name_table__from_o_model,
    f_s_name_foreign_key__from_o_model,
    f_o_model_instance,
    s_name_prop_id,
    f_a_s_error__invalid_model_instance,
    f_o_model__from_s_name_table,
    s_name_prop_ts_created,
    s_name_prop_ts_updated,
} from "./webserved_dir/constructors.module.js";
import { s_ds, s_root_dir } from "./runtimedata.module.js";
import { f_ensure_default_data } from "./default_data.module.js";

let o_db = null;

let s_path_database = './.gitignored/app.db';


let f_init_db = async function(s_path_db = s_path_database) {
    //make sure the folder where db should be stored exists
    await Deno.mkdir(s_path_db.slice(0, s_path_db.lastIndexOf(s_ds)), { recursive: true });

    o_db = new Database(s_path_db);

    for (let o_model of a_o_model) {
        let s_name_table = f_s_name_table__from_o_model(o_model);
        let a_s_column = [];
        let a_s_fk = [];

        for (let o_prop of o_model.a_o_property) {
            if (o_prop.s_name === 'n_id') {
                a_s_column.push('n_id INTEGER PRIMARY KEY');
                continue;
            }

            let s_sql_type = 'TEXT';
            if (o_prop.s_type === 'number') s_sql_type = 'REAL';
            if (o_prop.s_type === 'boolean') s_sql_type = 'INTEGER';

            a_s_column.push(`${o_prop.s_name} ${s_sql_type}`);

            // detect foreign key
            let o_model__foreign = a_o_model.find(function(o) {
                return f_s_name_foreign_key__from_o_model(o) === o_prop.s_name;
            });
            if (o_model__foreign) {
                let s_name_table_ref = f_s_name_table__from_o_model(o_model__foreign);
                a_s_fk.push(`FOREIGN KEY (${o_prop.s_name}) REFERENCES ${s_name_table_ref}(n_id)`);
            }
        }

        let s_sql = `CREATE TABLE IF NOT EXISTS ${s_name_table} (\n${a_s_column.concat(a_s_fk).join(',\n')}\n)`;
        o_db.exec(s_sql);
    }

    // sync columns for models that gained properties after the table was first
    // created -- SQLite CREATE TABLE IF NOT EXISTS does not add new columns to an
    // existing table, so ALTER the missing ones in here (safe idempotent migration)
    for (let o_model of a_o_model) {
        let s_name_table = f_s_name_table__from_o_model(o_model);
        let a_o_col = o_db.prepare(`PRAGMA table_info(${s_name_table})`).all();
        let a_s_col__existing = a_o_col.map(function(o_col){ return o_col.name; });
        for (let o_prop of o_model.a_o_property) {
            if(a_s_col__existing.includes(o_prop.s_name)) continue;
            let s_sql_type = 'TEXT';
            if (o_prop.s_type === 'number') s_sql_type = 'REAL';
            if (o_prop.s_type === 'boolean') s_sql_type = 'INTEGER';
            o_db.exec(`ALTER TABLE ${s_name_table} ADD COLUMN ${o_prop.s_name} ${s_sql_type}`);
        }
    }

    f_ensure_default_data();
    return o_db;
};



// generic db CRUD

let f_db_delete_table_data = function(s_name_table){
    o_db.exec('PRAGMA foreign_keys = OFF');
    let v_result = o_db.prepare(`DELETE FROM ${s_name_table}`).run();
    o_db.exec('PRAGMA foreign_keys = ON');
    return v_result;
}
let f_v_crud__indb = function(
    s_name_crud_function,
    s_name_table,
    v_o_data,
    v_o_data_update
){
    let o_model = f_o_model__from_s_name_table(s_name_table);
    if(!o_model) throw new Error(`Model not found for table ${s_name_table}`);
    let v_return = null;
    
    if(v_o_data && s_name_crud_function !== 'read'){

        let a_s_error = f_a_s_error__invalid_model_instance(o_model, v_o_data);
        if(a_s_error.length > 0){
            throw new Error('Invalid model instance: ' + a_s_error.join('; '));
        }
    }

    // check if timestamps exist on the model
    if(s_name_crud_function === 'create' || s_name_crud_function === 'update'){
        v_o_data[s_name_prop_ts_created] = Date.now();
        v_o_data[s_name_prop_ts_updated] = Date.now();
    }
    if(s_name_crud_function === 'update'){
        v_o_data_update[s_name_prop_ts_updated] = Date.now();
    }

    // validate values
    let o_model_instance = null;
    let a_s_name_property = null;
    let a_v_value = null;
    if(v_o_data){
        if(s_name_crud_function === 'read'){
            // for read, skip full model validation since filter is partial
            o_model_instance = v_o_data;
        } else {
            o_model_instance = f_o_model_instance(o_model, v_o_data);
        }
        a_s_name_property = Object.keys(o_model_instance);
        a_v_value = Object.values(o_model_instance);
    }

    if (s_name_crud_function === 'create') {
        // v_o_data should be an instance of o_model
        let s_sql = `INSERT INTO ${s_name_table} (${a_s_name_property.join(', ')}) VALUES (${a_s_name_property.map(function() { return '?'; }).join(', ')})`;
        o_db.prepare(s_sql).run(...a_v_value);


        let o_last = o_db.prepare('SELECT last_insert_rowid() as n_id').get();
        v_return = o_db.prepare(`SELECT * FROM ${s_name_table} WHERE n_id = ?`).get(o_last.n_id)
    }

    if (s_name_crud_function === 'read') {
        // v_o_data is not null we use the specified properties as filters for the query
        let s_query = `SELECT * FROM ${s_name_table}`;
        if (v_o_data) {
            let a_s_filter = [];
            for (let s_key in v_o_data) {
                a_s_filter.push(`${s_key} = ?`);
            }
            if (a_s_filter.length > 0) {
                s_query += ` WHERE ${a_s_filter.join(' AND ')}`;
            }
        }
        // console.log(s_query);
        // console.log(v_o_data);
        let a_o_row = o_db.prepare(s_query).all(...(v_o_data ? Object.values(v_o_data) : []));
        v_return = a_o_row
        
        // v_return = a_o_row.map(function(o_row) { return f_o_row__deserialized(o_model, o_row); });
    }

    if (s_name_crud_function === 'update') {
        // v_o_data should be an instance of o_model, with n_id property set to the id of the row to update
        // v_o_data_update should be an object with the properties to update
        if(!a_s_name_property.includes(s_name_prop_id)){
            throw new Error(`id property (${s_name_prop_id}) is required for update`);
        }
        // partial validation: only check properties present in v_o_data_update
        let a_s_error = [];
        for(let s_key in v_o_data_update){
            let o_model_prop = o_model.a_o_property.find(function(o){ return o.s_name === s_key; });
            if(!o_model_prop){
                a_s_error.push(`Property ${s_key} not found in model ${o_model.s_name}`);
                continue;
            }
            if(o_model_prop.f_b_val_valid && !o_model_prop.f_b_val_valid(v_o_data_update[s_key])){
                a_s_error.push(`Invalid value for property ${s_key}: ${v_o_data_update[s_key]}`);
            }
        }
        if(a_s_error.length > 0){
            throw new Error('Invalid model instance: ' + a_s_error.join('; '));
        }

        let a_s_key_update = Object.keys(v_o_data_update);
        let a_v_value_update = Object.values(v_o_data_update);
        let a_s_set = a_s_key_update.map(function(s){ return `${s} = ?`; });
        let s_sql = `UPDATE ${s_name_table} SET ${a_s_set.join(', ')} WHERE ${s_name_prop_id} = ?`;
        o_db.prepare(s_sql).run(...a_v_value_update, v_o_data.n_id);

        v_return = o_db.prepare(`SELECT * FROM ${s_name_table} WHERE n_id = ?`).get(v_o_data.n_id)
    }

    if (s_name_crud_function === 'delete') {
        if(!a_s_name_property.includes(s_name_prop_id)){
            throw new Error(`id property (${s_name_prop_id}) is required for delete`);
        }
        // v_o_data should be an instance of o_model, with n_id property set to the id of the row to delete
        if (!v_o_data || v_o_data.n_id === undefined || v_o_data.n_id === null) return false;
        o_db.exec('PRAGMA foreign_keys = OFF');
        o_db.prepare(`DELETE FROM ${s_name_table} WHERE n_id = ?`).run(v_o_data.n_id);
        o_db.exec('PRAGMA foreign_keys = ON');
        v_return = true;
    }

    return v_return;
};

let f_v_read_or_create_byid__fromdb = async function(o_moel, o_instance){
    if(!o_model_instance[s_name_prop_id]) throw new Error(`id property (${s_name_prop_id}) is required for read_or_create_byid`);

    let o_instance__fromdb = f_v_crud__indb('read', o_model, {
        [s_name_prop_id]: o_model_instance[s_name_prop_id],
    })[0];

    if(o_instance__fromdb) return o_instance__fromdb;

    return f_v_crud__indb('create', o_model, o_instance);

}


export {
    f_init_db,
    f_v_crud__indb,
    f_db_delete_table_data,
    f_v_read_or_create_byid__fromdb
};
