// The hardware crop defines the image coordinate system for every consumer.
// Keep this module independent of Vue so pixel processing can also be tested alone.
let f_o_crop__provider = () => null;
let o_frame__cache = null;
let f_set_camera_crop_provider = function(f_provider) {
    f_o_crop__provider = f_provider;
    o_frame__cache = null;
};

let f_s_camera_crop_key = function(s_device, n_scl_x, n_scl_y) {
    return JSON.stringify([s_device || '', n_scl_x, n_scl_y]);
};

let f_b_camera_crop_valid = function(o_crop, n_scl_x, n_scl_y) {
    return !!o_crop && ['n_x', 'n_y', 'n_scl_x', 'n_scl_y'].every(s => Number.isInteger(o_crop[s])) &&
        o_crop.n_x >= 0 && o_crop.n_y >= 0 && o_crop.n_scl_x > 0 && o_crop.n_scl_y > 0 &&
        o_crop.n_x + o_crop.n_scl_x <= n_scl_x && o_crop.n_y + o_crop.n_scl_y <= n_scl_y;
};

let f_o_camera_geometry = function(el_video = document.getElementById('webcamVideo')) {
    let n_scl_x = el_video?.videoWidth || 0;
    let n_scl_y = el_video?.videoHeight || 0;
    let o_crop = f_o_crop__provider(n_scl_x, n_scl_y);
    return f_b_camera_crop_valid(o_crop, n_scl_x, n_scl_y)
        ? { n_x: o_crop.n_x, n_y: o_crop.n_y, n_scl_x: o_crop.n_scl_x, n_scl_y: o_crop.n_scl_y }
        : { n_x: 0, n_y: 0, n_scl_x, n_scl_y };
};

let f_b_camera_crop_active = function(el_video = document.getElementById('webcamVideo')) {
    let o_crop = f_o_camera_geometry(el_video);
    return o_crop.n_scl_x !== (el_video?.videoWidth || 0) || o_crop.n_scl_y !== (el_video?.videoHeight || 0);
};

let el_canvas__frame = null;
let f_o_camera_geometry_snapshot = function(el_video = document.getElementById('webcamVideo')) {
    let o_geometry = f_o_camera_geometry(el_video);
    return {
        n_width: o_geometry.n_scl_x, n_height: o_geometry.n_scl_y,
        n_width__sensor: el_video?.videoWidth || 0, n_height__sensor: el_video?.videoHeight || 0,
        o_hardware_crop: f_b_camera_crop_active(el_video) ? o_geometry : null,
    };
};

let f_b_camera_geometry_matches = function(o_snapshot, el_video = document.getElementById('webcamVideo')) {
    let o_now = f_o_camera_geometry_snapshot(el_video);
    let o_crop__old = o_snapshot?.o_hardware_crop || null;
    let o_crop__now = o_now.o_hardware_crop;
    // Legacy full-frame calibrations remain usable without a hardware crop.
    return (o_snapshot?.n_width == null || o_snapshot.n_width === o_now.n_width) &&
        (o_snapshot?.n_height == null || o_snapshot.n_height === o_now.n_height) &&
        (o_snapshot?.n_width__sensor == null || o_snapshot.n_width__sensor === o_now.n_width__sensor) &&
        (o_snapshot?.n_height__sensor == null || o_snapshot.n_height__sensor === o_now.n_height__sensor) &&
        ((!o_crop__old && !o_crop__now) || (!!o_crop__old && !!o_crop__now &&
            ['n_x', 'n_y', 'n_scl_x', 'n_scl_y'].every(s_key => o_crop__old[s_key] === o_crop__now[s_key])));
};
// Return a native CanvasImageSource. The source is cropped at 1:1 sensor pixels,
// before flat-field correction, filters, analysis, optional ROI or resizing.
let f_el_camera_frame = function(el_video = document.getElementById('webcamVideo')) {
    if (!el_video || el_video.readyState < 2 || !f_b_camera_crop_active(el_video)) return el_video;
    let o_crop = f_o_camera_geometry(el_video);
    let n_frame = el_video.getVideoPlaybackQuality?.().totalVideoFrames ?? el_video.currentTime;
    let s_geometry = JSON.stringify([el_video.videoWidth, el_video.videoHeight, o_crop]);
    if (Number.isFinite(n_frame) && o_frame__cache?.el_video === el_video &&
        o_frame__cache.o_stream === el_video.srcObject && o_frame__cache.n_frame === n_frame &&
        o_frame__cache.s_geometry === s_geometry) return el_canvas__frame;
    if (!el_canvas__frame) el_canvas__frame = document.createElement('canvas');
    if (el_canvas__frame.width !== o_crop.n_scl_x) el_canvas__frame.width = o_crop.n_scl_x;
    if (el_canvas__frame.height !== o_crop.n_scl_y) el_canvas__frame.height = o_crop.n_scl_y;
    let o_ctx = el_canvas__frame.getContext('2d');
    o_ctx.drawImage(el_video, o_crop.n_x, o_crop.n_y, o_crop.n_scl_x, o_crop.n_scl_y,
        0, 0, o_crop.n_scl_x, o_crop.n_scl_y);
    // Preview, filters and analysis share one crop copy per decoded camera frame.
    o_frame__cache = { el_video, o_stream: el_video.srcObject, n_frame, s_geometry };
    return el_canvas__frame;
};

export { f_set_camera_crop_provider, f_s_camera_crop_key, f_b_camera_crop_valid,
    f_o_camera_geometry, f_b_camera_crop_active, f_el_camera_frame,
    f_o_camera_geometry_snapshot, f_b_camera_geometry_matches };
