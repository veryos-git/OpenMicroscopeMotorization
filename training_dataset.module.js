import { f_o_training_store } from './training_data_functions.module.js';

// Legacy captures remain at the root and belong to Default dataset. No image moves.
let f_o_dataset_catalog = function (s_root = './training_data') {
    let f_path = (s_id) => {
        if (s_id !== 'default' && !/^[a-f0-9-]{36}$/.test(s_id)) throw new Error('Invalid dataset ID');
        return `${s_root}/dataset/${s_id}`;
    };
    let f_default = async () => {
        let s_folder = f_path('default');
        await Deno.mkdir(s_folder, { recursive: true });
        try {
            await Deno.stat(`${s_folder}/dataset.json`);
        } catch (o_error) {
            if (!(o_error instanceof Deno.errors.NotFound)) throw o_error;
            let s_temp = `${s_folder}/${crypto.randomUUID()}.tmp`;
            await Deno.writeTextFile(
                s_temp,
                JSON.stringify({ s_id: 'default', s_name: 'Default dataset', n_ts_ms: 0 }),
            );
            await Deno.rename(s_temp, `${s_folder}/dataset.json`);
        }
    };
    let f_read = async (s_id) => {
        if (s_id === 'default') await f_default();
        return JSON.parse(await Deno.readTextFile(`${f_path(s_id)}/dataset.json`));
    };
    let f_list = async () => {
        await f_default();
        let a_o = [];
        for await (let o_entry of Deno.readDir(`${s_root}/dataset`)) {
            if (o_entry.isDirectory && (o_entry.name === 'default' || /^[a-f0-9-]{36}$/.test(o_entry.name))) {
                a_o.push(await f_read(o_entry.name));
            }
        }
        return a_o.sort((a, b) => a.n_ts_ms - b.n_ts_ms || a.s_id.localeCompare(b.s_id));
    };
    let f_create = async (s_name) => {
        if (
            typeof s_name !== 'string' || !s_name.trim() || s_name.trim().length > 100 ||
            /[\x00-\x1f]/.test(s_name)
        ) throw new Error('Enter a dataset name (1–100 characters)');
        let o = { s_id: crypto.randomUUID(), s_name: s_name.trim(), n_ts_ms: Date.now() };
        await f_default();
        let s_temp = await Deno.makeTempDir({ dir: `${s_root}/dataset`, prefix: '.pending-' });
        try {
            await Deno.writeTextFile(`${s_temp}/dataset.json`, JSON.stringify(o, null, 2));
            await Deno.rename(s_temp, f_path(o.s_id));
        } catch (o_error) {
            await Deno.remove(s_temp, { recursive: true }).catch(() => {});
            throw o_error;
        }
        return o;
    };
    let f_store = async (s_id) => {
        let o_dataset = await f_read(s_id);
        let o_store = f_o_training_store(s_id === 'default' ? s_root : `${f_path(s_id)}/capture`);
        return {
            ...o_store,
            o_dataset,
            f_list: async () => (await o_store.f_list()).map((o) => ({ ...o, s_dataset: s_id })),
            f_save: (o_sample, a_n_image) => o_store.f_save({ ...o_sample, s_dataset: s_id }, a_n_image),
        };
    };
    return { f_list, f_create, f_read, f_store };
};
export { f_o_dataset_catalog };
