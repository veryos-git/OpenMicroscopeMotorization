import { nextTick } from './lib/vue.esm-browser.js';
import { o_state, jobs, moves, motion, settings } from './index.js';
import { saved } from './o_capture.module.js';

const assert = (ok, message) => { if (!ok) throw Error(message); };
const equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected), message + ': ' + JSON.stringify(actual));

export async function runFreeWorkflow(vm) {
    o_state.o_motor__axis = { x: 2, y: 0, z: 1 };
    o_state.o_camera = { n_width: 640, n_height: 480 };
    o_state.a_n_step__per_px = [100 / 480, 1, 100 / 640];
    vm.f_delay = async () => {};
    const position = (x, y, z) => {
        for (const [axis, value] of Object.entries({x, y, z})) o_state.a_o_motor[o_state.o_motor__axis[axis]].n_position = value;
    };
    const addPoints = async coordinates => {
        for (const [x, y] of coordinates) {
            position(x, y, 10 + x + y);
            await nextTick();
            const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Add focused point');
            assert(button && !button.disabled, 'Add focused point unavailable');
            button.click();
        }
        await nextTick();
    };
    const configure = async coordinates => {
        vm.f_reset(); vm.s_mode__area = 'free'; vm.s_mode__focus = 'autofocus';
        await nextTick(); await addPoints(coordinates);
    };
    const shape = [[0, 0], [280, 0], [280, 70], [70, 70], [70, 280], [0, 280]];
    const images = () => saved.filter(image => !image.folder.endsWith('/dowscaled'));
    const startButtons = () => [...document.querySelectorAll('.btn-scan-start')];
    const reason = () => document.querySelector('#scan-start-reason')?.textContent || '';
    // A completed four-point outline still needs movement scale. Calibration
    // must explain the blocker, keep the points, and enable both Start buttons.
    await configure([[0, 0], [140, 0], [140, 140], [0, 140]]);
    o_state.a_n_step__per_px = [0, 0, 0];
    await nextTick();
    assert(startButtons().every(b => b.disabled), 'Uncalibrated scan enabled Start');
    assert(reason().includes('Calibrate X and Y in Setup'), 'Missing calibration hidden below four points');
    const focusedPoints = JSON.stringify(vm.a_o_point__free);
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Open Setup for X/Y calibration').click();
    assert(o_state.o_panel_visibility.setup, 'Calibration shortcut did not open Setup');
    o_state.b_scanning = true;
    o_state.a_n_step__per_px[2] = 100 / 640;
    o_state.b_scanning = false;
    await nextTick();
    assert(reason().includes('Calibrate Y in Setup'), 'Wrong axis reported after X calibration');
    o_state.a_n_step__per_px[0] = 100 / 480;
    o_state.o_panel_visibility.setup = false;
    await nextTick();
    assert(JSON.stringify(vm.a_o_point__free) === focusedPoints, 'Calibration cleared focused points');
    assert(startButtons().every(b => !b.disabled) && !reason(), 'Four calibrated points did not enable Start');
    o_state.a_o_motor[2].b_running = true;
    await nextTick();
    assert(startButtons().every(b => b.disabled) && reason().includes('Stop manual movement'), 'Moving-stage blocker hidden');
    o_state.a_o_motor[2].b_running = false;
    o_state.b_streaming__webcam = false;
    await nextTick();
    assert(startButtons().every(b => b.disabled) && reason().includes('Start the camera'), 'Camera blocker hidden');
    o_state.b_streaming__webcam = true;
    await configure([[0, 0], [140, 140], [0, 140], [140, 0]]);
    assert(reason().includes('Outline edges cross'), 'Crossed four-point outline has no explanation at Start');
    await vm.f_start_scan();
    assert(jobs.length === 0, 'Crossed outline started capture');

    await configure(shape.slice(0, 2));
    assert(!vm.b_scan_ready, 'Two points must not define a polygon');
    await vm.f_start_scan(); assert(jobs.length === 0, 'Incomplete outline started capture');
    await addPoints(shape.slice(2));
    assert(vm.b_scan_ready, 'Valid outline did not enable capture');
    assert(document.querySelector('#scan-area-mode').value === 'free', 'Area selector must reflect free mode');
    assert(!document.body.textContent.includes('X tiles (columns)'), 'Free scan asks for guessed tile counts');
    assert(document.querySelector('svg[aria-label="Free scan outline and planned capture path"]'), 'Missing outline preview');
    const plan = JSON.parse(JSON.stringify(vm.o_free_plan_result.o_plan));
    assert(plan.a_o_tile.length === 16, 'Concave outline should omit 9 empty grid cells');
    vm.f_add_free_point();
    assert(vm.a_o_point__free.length === 6 && vm.s_error__free, 'Duplicate point was added');
    let autofocusCalls = 0;
    vm.f_o_focus = async () => { autofocusCalls++; throw Error('No autofocus in free mode'); };
    const before = o_state.a_o_motor.map(m => m.n_position);
    const delays = [];
    vm.n_ms__focus_settle = 750; vm.f_delay = async ms => {delays.push(ms);};
    await vm.f_start_scan();
    assert(vm.s_status === 'complete' && !vm.s_error__jobs, 'Free capture failed: ' + vm.s_error__jobs);
    equal(images().map(image => image.positions), plan.a_o_tile.map(tile => [tile.n_y, tile.n_z, tile.n_x]), 'XYZ capture positions and interpolated focus');
    equal(images().map(image => image.name), plan.a_o_tile.map(t => 'tile_r' + String(t.n_row).padStart(2,'0') + '_c' + String(t.n_col).padStart(2,'0') + '.png'), 'Sparse tile filenames');
    assert(saved.length === 32 && vm.n_cnt__tile__planned === 16, 'Original and reduced tiles / progress count');
    equal(delays, Array(16).fill(750), 'Focus must settle before every capture');
    equal(o_state.a_o_motor.map(m => m.n_position), before, 'Return to operator position');
    assert(moves.every(m => m.locked), 'Movement must hold capture lock');
    assert(!o_state.b_scanning && !autofocusCalls, 'Free scan lock/autofocus');
    assert(jobs[0].o_option.b_free_scan && jobs[0].o_scan_plan.a_o_point.length === 6, 'Missing free scan metadata');
    assert(jobs[0].s_status === 'running', 'Free scan must start stitching automatically');
    assert(jobs[0].o_scan_plan.o_motor__axis.z === 1, 'Missing assigned axes in scan plan');
    await nextTick();
    assert(document.body.textContent.includes('16 / 16'), 'Summary should count only selected tiles');

    // First selected cell is not (0,0); a concave scan can skip rows/columns.
    const diamond = [[0, 140], [140, 0], [280, 140], [140, 280]];
    await configure(diamond);
    const first = vm.o_free_plan_result.o_plan.a_o_tile[0];
    assert(first.n_col > 0, 'Fixture needs an offset first tile');
    const previous = images().length;
    const start = vm.f_start_scan;
    const captured = new Promise(resolve => { vm.f_start_scan = async (...args) => { await start(...args); resolve(); }; });
    startButtons().find(b => b.textContent === 'Start live scan').click();
    await captured;
    vm.f_start_scan = start;
    equal(images()[previous].positions, [first.n_y, first.n_z, first.n_x], 'Move to actual first tile, not bounding origin');
    assert(jobs.at(-1).o_live.n_revision === vm.n_cnt__tile__captured, 'Live notifications missing');
    assert(jobs.at(-1).s_status === 'queued' && jobs.at(-1).o_option.b_free_scan, 'Live free scan must queue behind the first stitch');
    vm.f_reset(); assert(vm.a_o_point__free.length === 0 && !vm.b_scan_ready && vm.a_n_grid__start === null, 'New Scan kept old focus samples or origin');
    vm.s_mode__area = 'grid'; await vm.f_stitch(jobs[0]);
    assert(jobs[0].o_option.b_free_scan, 'Restitching depends on current mode');

    // Focus updates are tied to their actual XY position; motion failure aborts.
    await configure(shape);
    position(-20, -30, 5);
    const p = vm.a_o_point__free[0], z = p.n_z;
    vm.f_update_free_focus(p); assert(p.n_z === z, 'Updated focus away from its point');
    await vm.f_go_free_point(p);
    equal(o_state.a_o_motor.map(m => m.n_position), [p.n_y, p.n_z, p.n_x], 'Return to focused point');
    o_state.a_o_motor[1].n_position = 99;
    vm.f_update_free_focus(p); assert(p.n_z === 99, 'Manual focus refinement not saved');
    for (const failure of ['stop', 'disconnect', 'camera']) {
        await configure(shape);
        position(-1, -1, -1);
        const count = images().length;
        motion.stopMotor = failure === 'stop' ? 2 : null;
        motion.disconnectMotor = failure === 'disconnect' ? 2 : null;
        const move = vm.f_move_motor_n_step;
        if (failure === 'camera') vm.f_move_motor_n_step = async (...args) => { await move(...args); o_state.b_streaming__webcam = false; };
        await vm.f_start_scan();
        vm.f_move_motor_n_step = move; o_state.b_streaming__webcam = true;
        assert(images().length === count, 'Captured after failed XY movement');
        assert(!o_state.b_scanning && vm.s_status === 'complete', 'Interrupted scan kept hardware lock');
        motion.stopMotor = null; motion.disconnectMotor = null; o_state.b_connected__esp = true;
    }
    await configure(shape);
    o_state.a_n_step__per_px[2] = 0; assert(!vm.b_scan_ready, 'Missing calibration did not block scan');
    o_state.a_n_step__per_px[2] = 100 / 640;
    vm.n_overlap__pct = 90; assert(vm.o_free_plan_result.o_plan.a_o_tile.length > 16, 'Overlap did not update plan');
    vm.n_overlap__pct = 30;
    o_state.n_id__slide__current++;
    assert(vm.a_o_point__free.length === 0, 'Changing slide reused old outline');
    await addPoints(shape);
    o_state.o_motor__axis = {x: 0, y: 2, z: 1};
    assert(vm.a_o_point__free.length === 0, 'Axis reassignment reused old focus data');
    vm.f_save_config();
    assert(settings.o_config__scan.s_mode__area === 'free' && !settings.o_config__scan.a_o_point__free, 'Preference should persist without stage coordinates');
    // Leave a representative, idle outline for the browser screenshot.
    o_state.o_motor__axis = { x: 2, y: 0, z: 1 };
    await configure(shape);
    o_state.b_connected__server = false; vm.a_o_job = [];
    await nextTick();
}
