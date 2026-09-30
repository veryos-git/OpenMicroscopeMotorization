import { nextTick } from './lib/vue.esm-browser.js';
import { o_state, jobs, moves, motion, settings } from './index.js';
import { saved } from './o_capture.module.js';

const assert = (ok, message) => { if (!ok) throw Error(message); };
const equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected),
    message + ': ' + JSON.stringify(actual));

export async function runCornerWorkflow(vm) {
    assert(vm.n_pct__focus_padding === 10, 'Focus points must default to 10% padding');
    const delays = [];
    vm.f_delay = async ms => { delays.push(ms); };
    vm.b_stitch__after_scan = false;
    let autofocusCalls = 0;
    vm.f_o_focus = async () => { autofocusCalls++; throw Error('Autofocus must not run in corner mode'); };
    o_state.o_motor__axis = { x: 2, y: 0, z: 1 };
    const position = (x, y, z) => {
        for (const [axis, value] of Object.entries({ x, y, z })) o_state.a_o_motor[o_state.o_motor__axis[axis]].n_position = value;
    };
    const configure = async (cols, rows, padding = 10) => {
        vm.f_reset();
        vm.s_mode__focus = 'corners';
        vm.n_tile_x = cols; vm.n_tile_y = rows;
        vm.n_step__x = 10; vm.n_step__y = 20;
        vm.n_pct__focus_padding = padding;
        position(100, 200, 10);
        await nextTick();
        const start = [...document.querySelectorAll('button')].find(button => button.textContent === 'Set scan start here');
        assert(start && !start.disabled, 'Set scan start control unavailable');
        start.click();
        await nextTick();
    };
    const saveCorners = async values => {
        const positions = [];
        for (const corner of vm.a_o_focus_corner) {
            await vm.f_go_focus_corner(corner);
            positions.push(['x', 'y'].map(axis => o_state.a_o_motor[o_state.o_motor__axis[axis]].n_position));
            o_state.a_o_motor[o_state.o_motor__axis.z].n_position = values[corner.n_index];
            vm.f_save_focus_corner(corner);
        }
        await nextTick();
        return positions;
    };
    const images = () => saved.filter(s => !s.folder.endsWith('dowscaled'));

    await configure(3, 3);
    assert(vm.a_o_focus_corner.length === 4, 'Four grid corners must be available');
    equal(vm.a_n_focus__corner, [null, null, null, null], 'The scan origin must not be saved as an inset focus point');
    assert(!vm.b_scan_ready, 'Incomplete corner focus must block scan start');
    await vm.f_start_scan();
    assert(jobs.length === 0, 'Incomplete corner focus created a scan');
    const corners = document.querySelectorAll('.scan-focus-corner');
    assert(corners.length === 4, 'Corner controls missing');
    assert(corners[0].querySelectorAll('button')[1].disabled, 'Save focus enabled at the scan edge instead of the padded point');
    assert(corners[1].querySelectorAll('button')[1].disabled, 'Save focus enabled away from corner');
    vm.f_save_focus_corner(vm.a_o_focus_corner[1]);
    assert(vm.a_n_focus__corner[1] === null, 'Saved focus at the wrong XY position');
    equal(await saveCorners([10, 30, 50, 90]), [[102, 204], [118, 204], [102, 236], [118, 236]],
        'Focus navigation must inset each point by 10% of the corresponding scan dimension');
    assert(vm.b_scan_ready, 'All saved corners should enable scanning');
    assert(!vm.b_focus__before_tile, 'Corner mode must disable autofocus');
    equal(vm.a_n_focus__corner, [10, 30, 50, 90], 'Saved corner values');
    assert(vm.f_n_focus__tile({n_row:1,n_col:1}) === 45, 'Bilinear center focus');

    // Start at padded focus point 4. Capture must still cover the entire grid.
    const beforeScan = o_state.a_o_motor.map(m => m.n_position);
    vm.n_ms__focus_settle = 750;
    delays.length = 0;
    await vm.f_start_scan();
    equal(delays, Array(9).fill(750), 'Every tile must settle after its interpolated focus move');
    equal(images().map(image => [image.name, image.positions]), [
        ['tile_r00_c00.png', [200, 3, 100]],
        ['tile_r00_c01.png', [200, 14, 110]],
        ['tile_r00_c02.png', [200, 25, 120]],
        ['tile_r01_c02.png', [220, 64, 120]],
        ['tile_r01_c01.png', [220, 45, 110]],
        ['tile_r01_c00.png', [220, 26, 100]],
        ['tile_r02_c00.png', [240, 50, 100]],
        ['tile_r02_c01.png', [240, 76, 110]],
        ['tile_r02_c02.png', [240, 103, 120]],
    ], 'Serpentine capture must use spatial corner interpolation and assigned axes');
    equal(o_state.a_o_motor.map(m => m.n_position), beforeScan, 'Return to scan-start position');
    assert(moves.every(move => move.locked), 'Corner and scan moves must hold the stage lock');
    assert(!o_state.b_scanning, 'Stage lock leaked after capture');

    // Degenerate grids require only their distinct corner positions.
    for (const [cols, rows, values, expected] of [
        [1, 3, [10, 10, 50, 50], [5, 30, 55]],
        [3, 1, [10, 30, 10, 30], [8, 20, 33]],
        [1, 1, [10, 10, 10, 10], [10]],
    ]) {
        await configure(cols, rows);
        assert(vm.a_o_focus_corner.length === (cols === rows ? 1 : 2), 'Duplicate corner controls');
        await saveCorners(values);
        const first = images().length;
        await vm.f_start_scan(true);
        equal(images().slice(first).map(image => image.positions[1]), expected, 'Single-axis live scan focus');
        assert(jobs.at(-1).o_live.n_revision === expected.length, 'Live scan tile notifications missing');
    }

    // Zero padding restores edge calibration; changing padding invalidates it.
    await configure(3, 3, 0);
    equal(await saveCorners([10, 30, 50, 90]), [[100, 200], [120, 200], [100, 240], [120, 240]], 'Zero-padding focus positions');
    assert(vm.f_n_focus__tile({n_row:0,n_col:0}) === 10 && vm.f_n_focus__tile({n_row:2,n_col:2}) === 90,
        'Zero padding must preserve original corner interpolation');
    const paddingInput = document.querySelector('#scan-focus-padding');
    paddingInput.value = '20';
    paddingInput.dispatchEvent(new Event('input', {bubbles:true}));
    paddingInput.dispatchEvent(new Event('change', {bubbles:true}));
    await nextTick();
    assert(vm.n_pct__focus_padding === 20, 'Padding control did not update the value');
    assert(!vm.b_corner_focus_ready && !vm.b_scan_ready, 'Padding changes kept old focus values');
    equal(vm.a_n_grid__start, [100, 200], 'Padding must not change the capture origin');
    assert(settings.o_config__scan.n_pct__focus_padding === 20, 'Padding preference not saved');
    equal(await saveCorners([10, 30, 50, 90]), [[104, 208], [116, 208], [104, 232], [116, 232]], 'Custom padding focus positions');
    for (const invalid of ['', -1, 50, NaN]) {
        vm.n_pct__focus_padding = invalid;
        assert(!vm.b_corner_controls_ready && !vm.b_scan_ready, 'Invalid padding must block movement and scanning');
    }
    // Integer motor rounding must keep calibration points distinct on tiny grids.
    await configure(2, 2, 49);
    vm.n_step__x = 1; vm.n_step__y = 2;
    assert(vm.a_o_focus_corner.length === 4, 'Rounded padding collapsed a small grid');
    equal(await saveCorners([10, 30, 50, 90]), [[100, 200], [101, 200], [100, 202], [101, 202]], 'Tiny-grid padding must use reachable motor positions');
    assert(Number.isFinite(vm.f_n_focus__tile({n_row:1,n_col:1})), 'Collapsed interpolation span');
    await configure(3, 3);
    vm.n_step__x = 13; vm.n_step__y = 17;
    equal(await saveCorners([10, 30, 50, 90]), [[103, 203], [123, 203], [103, 231], [123, 231]], 'Padding must round to whole motor steps');
    assert(vm.f_n_focus__tile({n_row:0,n_col:0}) === 3, 'Interpolation must use rounded focus positions');

    await configure(3, 3);
    await saveCorners([10, 30, 50, 90]);
    vm.n_step__x = 11;
    assert(!vm.b_corner_focus_ready, 'Changing tile spacing kept stale focus values');
    equal(vm.a_n_focus__corner, [null, null, null, null], 'Grid changes must clear corner values');
    await saveCorners([10, 30, 50, 90]);
    vm.n_tile_y = 4;
    assert(!vm.b_corner_focus_ready, 'Changing tile count kept stale focus values');
    o_state.b_connected__esp = false;
    assert(vm.a_n_grid__start === null, 'Disconnect kept an old origin');
    o_state.b_connected__esp = true;
    assert(!vm.b_scan_ready, 'Reconnect silently reused old corner data');
    await configure(3, 3);
    await saveCorners([10, 30, 50, 90]);
    o_state.o_motor__axis = { x: 0, y: 2, z: 1 };
    assert(!vm.b_corner_focus_ready && vm.a_n_grid__start === null, 'Axis reassignment kept stale corners');
    o_state.o_motor__axis = { x: 2, y: 0, z: 1 };

    // Stop during a focus move: no image may be captured at incomplete focus.
    await configure(3, 3);
    await saveCorners([10, 30, 50, 90]);
    let captured = images().length;
    motion.stopMotor = 1;
    await vm.f_start_scan();
    assert(images().length === captured, 'Captured after focus movement was stopped');
    assert(!o_state.b_scanning && vm.s_error__jobs.includes('stopped'), 'Stop did not finish cleanly');
    motion.stopMotor = null;

    await configure(3, 3);
    await saveCorners([10, 30, 50, 90]);
    captured = images().length;
    motion.disconnectMotor = 1;
    await vm.f_start_scan();
    assert(images().length === captured, 'Captured after controller disconnection');
    assert(!o_state.b_scanning && !vm.b_corner_focus_ready, 'Disconnect left active motion or focus values');
    motion.disconnectMotor = null;
    o_state.b_connected__esp = true;
    await configure(3, 3);
    o_state.o_motor__axis.z = null;
    await nextTick();
    assert(!vm.b_corner_controls_ready && !vm.b_scan_ready, 'Missing focus motor must block corner setup and scanning');
    assert(document.querySelector('#scan-focus-mode option[value="corners"]').disabled, 'Corner mode must require a focus motor');
    o_state.o_motor__axis.z = 1;
    vm.f_reset();
    assert(vm.a_n_grid__start === null, 'New Scan must clear the previous slide origin');
    equal(vm.a_n_focus__corner, [null, null, null, null], 'New Scan must clear previous slide focus');
    assert(autofocusCalls === 0, 'Autofocus ran during manual corner scans');

    // Existing autofocus settings survive the new focus selector.
    o_state.a_o_setting = [{s_key:'o_config__scan',s_value:JSON.stringify({b_focus__before_tile:true})}];
    vm.f_load_config();
    assert(vm.s_mode__focus === 'autofocus' && vm.b_focus__before_tile, 'Legacy autofocus setting was lost');
    assert(vm.n_pct__focus_padding === 10, 'Existing configurations without padding must default to 10%');
    for (const padding of [0, 25]) {
        o_state.a_o_setting = [{s_key:'o_config__scan',s_value:JSON.stringify({s_mode__focus:'corners',n_pct__focus_padding:padding})}];
        vm.f_load_config();
        assert(vm.n_pct__focus_padding === padding, 'Saved padding did not reload');
    }
}
