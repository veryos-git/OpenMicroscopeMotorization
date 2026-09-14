import { o_state } from './index.js';

// single capture path. every component that "takes a picture" from the live
// webcam calls this, so the subtle capture flash always shows, and the frame
// grabbing logic stays in one place.

// o_opts:
//   n_scl_max  - cap the long side (downscale for cheap uploads), optional
//   s_type     - mime type, default 'image/png'
//   n_quality  - jpeg quality, optional
//   b_flash    - show the capture flash, default true
let f_o_capture__frame = function(o_opts) {
    o_opts = o_opts || {};
    let b_flash = o_opts.b_flash !== false;
    return new Promise(function(resolve, reject) {
        let el_video = document.getElementById('webcamVideo');
        if(!el_video || !el_video.srcObject || el_video.readyState < 2){
            reject(new Error('no webcam stream available'));
            return;
        }
        let n_scl_x__video = el_video.videoWidth;
        let n_scl_y__video = el_video.videoHeight;
        let n_scl = 1;
        if(o_opts.n_scl_max){
            n_scl = Math.min(1, o_opts.n_scl_max / Math.max(n_scl_x__video, n_scl_y__video));
        }
        let n_scl_x = Math.max(1, Math.round(n_scl_x__video * n_scl));
        let n_scl_y = Math.max(1, Math.round(n_scl_y__video * n_scl));
        let el_canvas = document.createElement('canvas');
        el_canvas.width = n_scl_x;
        el_canvas.height = n_scl_y;
        el_canvas.getContext('2d').drawImage(el_video, 0, 0, n_scl_x, n_scl_y);

        // signal the live preview that a picture was just taken
        if(b_flash) o_state.n_cnt__capture_flash++;

        let s_type = o_opts.s_type || 'image/png';
        let v_quality = (typeof o_opts.n_quality === 'number') ? o_opts.n_quality : undefined;
        el_canvas.toBlob(function(o_blob){
            if(o_blob){
                resolve({
                    o_blob: o_blob,
                    n_scl_x__video: n_scl_x__video,
                    n_scl_y__video: n_scl_y__video,
                    n_scl_x: n_scl_x,
                    n_scl_y: n_scl_y,
                });
            } else {
                reject(new Error('failed to capture frame'));
            }
        }, s_type, v_quality);
    });
};

let f_save_image = async function(o_blob, s_path_folder, s_filename) {
    let o_array_buffer = await o_blob.arrayBuffer();
    let o_response = await fetch(
        '/api/scan/save_image'
            + '?s_path_folder=' + encodeURIComponent(s_path_folder)
            + '&s_filename=' + encodeURIComponent(s_filename),
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: o_array_buffer,
        }
    );
    if(!o_response.ok){
        throw new Error('failed to save image: ' + o_response.statusText);
    }
};

export {
    f_o_capture__frame,
    f_save_image,
};
