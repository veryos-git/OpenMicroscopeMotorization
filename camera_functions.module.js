// what only v4l2-ctl knows about the connected USB cameras (linux; installed by install.js).
// the video itself stays with the browser camera api. from here come:
//   the real sensor sizes: the browser only reports a maximum and scales to anything below it
//   the controls the browser has no access to, such as gain

// 'Size: Discrete 1920x1080' lines, once per pixel format
let f_a_o_camera_mode = function(s_format) {
    let o_mode = {};
    for (let a_s_match of s_format.matchAll(/Size: Discrete (\d+)x(\d+)/g)) {
        o_mode[a_s_match[0]] = { n_scl_x: Number(a_s_match[1]), n_scl_y: Number(a_s_match[2]) };
    }
    return Object.values(o_mode).sort(function(o_a, o_b) { return o_a.n_scl_x * o_a.n_scl_y - o_b.n_scl_x * o_b.n_scl_y; });
};

// the sliders of 'v4l2-ctl --list-ctrls', one line each:
// 'gain 0x00980913 (int) : min=0 max=100 step=1 default=0 value=100 flags=inactive, has-min-max'
let f_a_o_camera_control = function(s_control) {
    let o_regexp = /^\s*(\w+) 0x[0-9a-f]+ \(int\)\s*: min=(-?\d+) max=(-?\d+) step=(\d+) default=(-?\d+) value=(-?\d+)(.*)$/gm;
    return [...s_control.matchAll(o_regexp)].map(function(a_s_match) {
        let [n_min, n_max, n_step, n_default, n_val] = a_s_match.slice(2, 7).map(Number);
        // inactive: the camera sets it by itself at the moment, e.g. the exposure time in auto exposure
        return { s_name: a_s_match[1], n_min, n_max, n_step, n_default, n_val, b_inactive: a_s_match[7].includes('inactive') };
    });
};

let f_s_v4l2 = async function(a_s_arg) {
    let o_out = await new Deno.Command('v4l2-ctl', { args: a_s_arg, stdout: 'piped', stderr: 'null' }).output();
    return new TextDecoder().decode(o_out.stdout);
};

// [{ s_name, s_path, a_o_mode, a_o_control }], empty without v4l2-ctl
let f_a_o_camera = async function() {
    let a_o_camera = [];
    if (Deno.build.os !== 'linux') return a_o_camera;
    try {
        // one block per camera: 'name (bus):' followed by its indented /dev paths
        for (let s_block of (await f_s_v4l2(['--list-devices'])).split(/\n(?=\S)/)) {
            let s_name = s_block.split('\n')[0].replace(/ \([^()]*\):\s*$/, '');
            for (let s_path of s_block.match(/\/dev\/video\d+/g) || []) {
                // a camera also has a metadata node, which lists no mode
                let a_o_mode = f_a_o_camera_mode(await f_s_v4l2(['-d', s_path, '--list-formats-ext']));
                if (!a_o_mode.length) continue;
                a_o_camera.push({ s_name, s_path, a_o_mode, a_o_control: f_a_o_camera_control(await f_s_v4l2(['-d', s_path, '--list-ctrls'])) });
            }
        }
    } catch { /* the Camera window then offers its generic list and no extra control */ }
    return a_o_camera;
};

// GET  /api/camera/device   -> f_a_o_camera()
// POST /api/camera/control  { s_path, s_name, n_val } -> the controls of that camera after the change
let f_o_camera_response = async function(o_request) {
    let s_path = new URL(o_request.url).pathname;
    if (s_path === '/api/camera/device') return Response.json(await f_a_o_camera());
    if (s_path === '/api/camera/control' && o_request.method === 'POST') {
        try {
            let o_control = await o_request.json();
            if (!/^\/dev\/video\d+$/.test(o_control.s_path) || !/^\w+$/.test(o_control.s_name) || !Number.isInteger(o_control.n_val)) {
                throw new Error('invalid camera control');
            }
            let o_out = await new Deno.Command('v4l2-ctl', {
                args: ['-d', o_control.s_path, '--set-ctrl=' + o_control.s_name + '=' + o_control.n_val], stdout: 'null', stderr: 'piped',
            }).output();
            // v4l2-ctl reports a refused value on stderr
            let s_error = new TextDecoder().decode(o_out.stderr).trim();
            if (!o_out.success || s_error) throw new Error(s_error || 'v4l2-ctl failed');
            return Response.json(f_a_o_camera_control(await f_s_v4l2(['-d', o_control.s_path, '--list-ctrls'])));
        } catch (o_error) {
            return new Response(o_error.message, { status: 400 });
        }
    }
    return new Response('Not Found', { status: 404 });
};

export { f_o_camera_response, f_a_o_camera, f_a_o_camera_mode, f_a_o_camera_control };
