// A completed model manifest is the publication marker. Partial jobs are omitted.
let f_o_yolo_model_store = function (s_folder) {
    let f_list = async (s_dataset) => {
        let a_o = [];
        try {
            for await (let o_entry of Deno.readDir(`${s_folder}/run`)) {
                if (!o_entry.isDirectory || !/^[a-f0-9-]{36}$/.test(o_entry.name)) continue;
                try {
                    let o = JSON.parse(await Deno.readTextFile(`${s_folder}/run/${o_entry.name}/model.json`));
                    if (o.s_id !== o_entry.name || o.s_dataset !== s_dataset) continue;
                    await Deno.stat(`${s_folder}/run/${o.s_id}/model/weights/best.pt`);
                    a_o.push(o);
                } catch (o_error) {
                    if (!(o_error instanceof Deno.errors.NotFound)) throw o_error;
                }
            }
        } catch (o_error) {
            if (!(o_error instanceof Deno.errors.NotFound)) throw o_error;
        }
        // Preserve the previously published global model as a Default-dataset model.
        if (s_dataset === 'default') {
            try {
                let o = JSON.parse(await Deno.readTextFile(`${s_folder}/latest.json`));
                if (!/^[a-f0-9-]{36}$/.test(o.s_id)) throw new Error('Invalid legacy model ID');
                if (!a_o.some((v) => v.s_id === o.s_id)) {
                    await Deno.stat(`${s_folder}/run/${o.s_id}/model/weights/best.pt`);
                    a_o.push({ ...o, s_dataset: 'default', s_name: o.s_name || 'Existing YOLO model' });
                }
            } catch (o_error) {
                if (!(o_error instanceof Deno.errors.NotFound)) throw o_error;
            }
        }
        return a_o.sort((a, b) => b.n_ts_ms - a.n_ts_ms || a.s_id.localeCompare(b.s_id));
    };
    let f_read = async (s_dataset, s_id) => {
        let a_o = await f_list(s_dataset);
        let o = s_id ? a_o.find((o) => o.s_id === s_id) : a_o[0];
        if (!o) {
            throw new Error(
                s_id
                    ? 'That model does not belong to this dataset'
                    : 'Fine-tune a model for this dataset first',
            );
        }
        return o;
    };
    let f_publish = async (o_model) => {
        if (!/^[a-f0-9-]{36}$/.test(o_model.s_id)) throw new Error('Invalid model ID');
        let s_run = `${s_folder}/run/${o_model.s_id}`;
        await Deno.stat(`${s_run}/model/weights/best.pt`);
        await Deno.writeTextFile(`${s_run}/model.pending.json`, JSON.stringify(o_model, null, 2));
        await Deno.rename(`${s_run}/model.pending.json`, `${s_run}/model.json`);
    };
    return { f_list, f_read, f_publish };
};
export { f_o_yolo_model_store };
