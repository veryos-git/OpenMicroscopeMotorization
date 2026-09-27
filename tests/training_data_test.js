import assert from 'node:assert/strict';
import { f_o_box, f_s_yolo, f_validate_sample } from '../webserved_dir/training_data.module.js';
import { f_o_export, f_o_training_store } from '../training_data_functions.module.js';

let f_o_sample = () => ({
    n_scl_x: 1,
    n_scl_y: 1,
    n_ts_ms: 1234,
    o_position: { x: 12, y: 34, z: 56 },
    a_o_box: [
        f_o_box({ n_x: 0.1, n_y: 0.2 }, { n_x: 0.8, n_y: 0.9 }, { s_name: 'diatom', s_color: '#00ff00' }),
    ],
});
let a_n_png = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII='),
    (s) => s.charCodeAt(0),
);

Deno.test('boxes normalize reverse drags, clip frame bounds, and export YOLO centers', () => {
    let o_box = f_o_box({ n_x: 0.8, n_y: 1.2 }, { n_x: -0.1, n_y: 0.2 }, {
        s_name: 'diatom',
        s_color: '#00ff00',
    });
    assert.equal(o_box.n_x, 0);
    assert.equal(o_box.n_y, 0.2);
    assert.equal(o_box.n_scl_x, 0.8);
    assert.equal(o_box.n_scl_y, 0.8);
    assert.equal(f_s_yolo([o_box], ['other', 'diatom']), '1 0.40000000 0.60000000 0.80000000 0.80000000\n');
    assert.throws(() => f_s_yolo([o_box], []));
    for (
        let o_patch of [{ n_x: NaN }, { n_y: -1 }, { n_scl_x: 0 }, { n_scl_y: 2 }, { s_label: '' }, {
            s_label: 'bad\nlabel',
        }]
    ) {
        let o_sample = f_o_sample();
        Object.assign(o_sample.a_o_box[0], o_patch);
        assert.throws(() => f_validate_sample(o_sample));
    }
});

Deno.test('capture persistence, quality, restart, image validation, path rejection, export and deletion', async () => {
    let s_root = await Deno.makeTempDir();
    try {
        let o_store = f_o_training_store(s_root);
        let o_saved = await o_store.f_save(f_o_sample(), a_n_png);
        assert.equal((await f_o_training_store(s_root).f_list())[0].o_position.z, 56);
        assert.deepEqual(await o_store.f_image(o_saved.s_id), a_n_png);
        await o_store.f_tag(o_saved.s_id, 'good');
        assert.equal((await o_store.f_list())[0].s_quality, 'good');
        await assert.rejects(() => o_store.f_tag(o_saved.s_id, 'invalid'));
        await assert.rejects(async () => await o_store.f_image('../secret'));
        await assert.rejects(() => o_store.f_save({ ...f_o_sample(), n_scl_x: 2 }, a_n_png));
        await assert.rejects(() => o_store.f_save(f_o_sample(), new Uint8Array(24)));
        let o_second = f_o_sample();
        o_second.a_o_box[0].s_label = 'alga';
        await o_store.f_save(o_second, a_n_png);
        let a_n_tar = new Uint8Array(await new Response(f_o_export(o_store)).arrayBuffer());
        let o_decoder = new TextDecoder();
        let o_file = {};
        for (let n_offset = 0; a_n_tar[n_offset];) {
            let a_n_header = a_n_tar.slice(n_offset, n_offset + 512);
            let s_name = o_decoder.decode(a_n_header.slice(0, 100)).split('\0')[0];
            let n_size = parseInt(o_decoder.decode(a_n_header.slice(124, 136)), 8);
            let n_checksum = parseInt(o_decoder.decode(a_n_header.slice(148, 156)), 8);
            a_n_header.fill(32, 148, 156);
            assert.equal(a_n_header.reduce((n_sum, n) => n_sum + n, 0), n_checksum);
            o_file[s_name] = a_n_tar.slice(n_offset + 512, n_offset + 512 + n_size);
            n_offset += 512 + Math.ceil(n_size / 512) * 512;
        }
        assert.equal(o_decoder.decode(o_file['classes.txt']), 'alga\ndiatom\n');
        assert.ok(o_decoder.decode(o_file[`labels/${o_saved.s_id}.txt`]).startsWith('1 '));
        assert.deepEqual(o_file[`images/${o_saved.s_id}.png`], a_n_png);
        assert.equal(JSON.parse(o_decoder.decode(o_file['metadata.json'])).a_o_sample.length, 2);
        await o_store.f_delete(o_saved.s_id);
        assert.equal((await o_store.f_list()).length, 1);
    } finally {
        await Deno.remove(s_root, { recursive: true });
    }
});

import {
    f_a_grid,
    f_a_plane,
    f_focus_sweep,
    f_o_video_rect,
} from '../webserved_dir/training_workflow.module.js';
Deno.test('snake grid, unique endpoint-inclusive focus planes and contained video geometry', () => {
    assert.deepEqual(f_a_grid(3, 2), [
        { n_x: 0, n_y: 0 },
        { n_x: 1, n_y: 0 },
        { n_x: 2, n_y: 0 },
        { n_x: 2, n_y: 1 },
        { n_x: 1, n_y: 1 },
        { n_x: 0, n_y: 1 },
    ]);
    assert.deepEqual(f_a_plane(10, 0, 4), [10, 7, 3, 0]);
    assert.deepEqual(f_a_plane(3, 3, 1), [3]);
    assert.throws(() => f_a_plane(0, 2, 4));
    assert.throws(() => f_a_plane(null, 2, 1));
    assert.throws(() => f_a_grid(0, 2));
    assert.deepEqual(f_o_video_rect({ left: 10, top: 20, width: 200, height: 200 }, 400, 200), {
        n_x: 10,
        n_y: 70,
        n_scl_x: 200,
        n_scl_y: 100,
    });
});
Deno.test('focus sweep restores previous Z on success/upload failure, but never restarts after Stop', async () => {
    let a_n_move = [], n_count = 0;
    let o_option = {
        a_n_plane: [0, 2, 4],
        n_previous: 9,
        f_move: async (n) => {
            a_n_move.push(n);
        },
        f_frame: async () => {
            n_count++;
        },
        f_check: () => {},
    };
    await f_focus_sweep(o_option);
    assert.deepEqual(a_n_move, [0, 2, 4, 9]);
    assert.equal(n_count, 3);
    a_n_move = [];
    await assert.rejects(() =>
        f_focus_sweep({
            ...o_option,
            f_frame: async () => {
                throw Error('upload failed');
            },
        }), /upload failed/);
    assert.deepEqual(a_n_move, [0, 9]);
    a_n_move = [];
    let b_stop = false;
    await assert.rejects(() =>
        f_focus_sweep({
            ...o_option,
            f_frame: async () => {
                b_stop = true;
            },
            f_check: () => {
                if (b_stop) throw Error('stopped');
            },
        }), /stopped/);
    assert.deepEqual(a_n_move, [0]);
});

Deno.test('training motor adapter checks completion, rejects cancellation/disconnection and removes listeners', async () => {
    let s_source = await Deno.readTextFile(
        new URL('../webserved_dir/training_motion.module.js', import.meta.url),
    );
    let f_adapter = new Function(
        'o_state',
        'f_n_motor__axis',
        'f_send_esp',
        'f_register_esp_handler',
        'f_register_esp_disconnect',
        s_source.replace(/^import [\s\S]*?from '\.\/index\.js';/m, '').replace(
            /export \{ f_move_training \};/,
            'return f_move_training;',
        ),
    );
    let a_f_message = [], a_f_disconnect = [], a_o_command = [];
    let f_register = (a) => (f) => {
        a.push(f);
        return () => a.splice(a.indexOf(f), 1);
    };
    let o_state = {
        b_connected__esp: true,
        a_o_motor: [{ n_position: 10, b_running: false }],
        n_rpm__focus_jog: .5,
    };
    let f_move = f_adapter(
        o_state,
        () => 0,
        (o, s_owner) => a_o_command.push({ ...o, s_owner }),
        f_register(a_f_message),
        f_register(a_f_disconnect),
    );
    let o_abort = new AbortController();
    let o_promise = f_move('z', 12, o_abort.signal);
    assert.equal(a_o_command[0].n_step, 2);
    assert.equal(a_o_command[0].s_owner, 'training');
    a_f_message[0]({ motor: 0, type: 'moveComplete', n_position: 12 });
    await o_promise;
    assert.equal(o_state.a_o_motor[0].n_position, 12);
    assert.equal(a_f_message.length, 0);
    assert.equal(a_f_disconnect.length, 0);
    for (let s_kind of ['cancel', 'disconnect', 'abort', 'wrong position']) {
        o_abort = new AbortController();
        o_promise = f_move('z', 15, o_abort.signal);
        let o_reject = assert.rejects(() => o_promise);
        if (s_kind === 'cancel') a_f_message[0]({ motor: 0, type: 'moveCancelled', n_position: 13 });
        if (s_kind === 'disconnect') a_f_disconnect[0]();
        if (s_kind === 'abort') o_abort.abort();
        if (s_kind === 'wrong position') a_f_message[0]({ motor: 0, type: 'moveComplete', n_position: 14 });
        await o_reject;
        assert.equal(a_f_message.length, 0);
        assert.equal(a_f_disconnect.length, 0);
    }
});

Deno.test('shared motor dispatch rejects competing training motion but permits emergency stop', async () => {
    let s_source = await Deno.readTextFile(new URL('../webserved_dir/index.js', import.meta.url));
    let s_function = s_source.slice(
        s_source.indexOf('let f_send_esp = function'),
        s_source.indexOf('// Axis assignments resolve'),
    );
    let a_s_write = [];
    let o_state = { b_training_busy: true, b_connected__esp: true, s_transport__esp: 'serial' };
    let f_send = new Function(
        'o_state',
        'o_writer__serial',
        'o_ws__esp',
        s_function + '\nreturn f_send_esp;',
    )(o_state, {
        write: (a) => {
            a_s_write.push(new TextDecoder().decode(a));
            return Promise.resolve();
        },
    }, null);
    assert.throws(() => f_send({ command: 'moveSteps', motor: 0, n_step: 3 }), /Training is using/);
    assert.equal(a_s_write.length, 0);
    f_send({ command: 'moveSteps', motor: 2, n_step: 3 }, 'training');
    f_send({ command: 'stopAll' });
    f_send({ command: 'status' });
    assert.equal(a_s_write.length, 3);
});

import { f_o_box_edit, f_o_box_handle } from '../webserved_dir/training_data.module.js';
Deno.test('box edits clamp to image edges, preserve identity, and keep handles at ten screen pixels', () => {
    let o_box = {
        s_id: 'box',
        s_label: 'diatom',
        s_color: '#00ff00',
        n_x: .2,
        n_y: .3,
        n_scl_x: .4,
        n_scl_y: .2,
    };
    let o_move = f_o_box_edit(o_box, 'move', { n_x: 2, n_y: -2 }, 1000, 500);
    assert.equal(o_move.n_x, .6);
    assert.equal(o_move.n_y, 0);
    assert.equal(o_move.n_scl_x, .4);
    assert.equal(o_move.n_scl_y, .2);
    assert.equal(o_move.s_id, 'box');
    assert.equal(o_move.s_color, o_box.s_color);
    let o_resize = f_o_box_edit(o_box, 'resize', { n_x: -2, n_y: 2 }, 1000, 500);
    assert.equal(o_resize.n_x, 0);
    assert.ok(Math.abs(o_resize.n_scl_x - .6) < 1e-10);
    assert.equal(o_resize.n_y, .3);
    assert.equal(o_resize.n_scl_y, .7);
    let o_min = f_o_box_edit(o_box, 'resize', { n_x: 2, n_y: -2 }, 1000, 500);
    assert.ok(Math.abs(o_min.n_scl_x - .002) < 1e-10);
    assert.equal(o_min.n_scl_y, .004);
    for (let n_width of [200, 800, 1920]) {
        let o_handle = f_o_box_handle({ ...o_box, n_x: 0, n_y: .8, n_scl_y: .2 }, {
            n_scl_x: n_width,
            n_scl_y: n_width / 2,
        });
        assert.equal(o_handle.n_scl_x * n_width, 10);
        assert.equal(o_handle.n_scl_y * n_width / 2, 10);
        assert.equal(o_handle.n_x, 0);
        assert.equal(o_handle.n_y + o_handle.n_scl_y, 1);
    }
    assert.equal(o_box.n_x, .2); // geometry helper never mutates the source
});
