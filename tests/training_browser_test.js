// Isolated real-browser component test; no camera, controller or production data needed.
// deno test -A tests/training_browser_test.js
import assert from 'node:assert/strict';
import { f_o_training_response } from '../training_data_functions.module.js';
import { f_o_dataset_catalog } from '../training_dataset.module.js';

Deno.test('training UI: live annotation, focus sweep, grid, review, cancellation and persistence', async () => {
    let s_temp = await Deno.makeTempDir();
    let o_catalog = f_o_dataset_catalog(s_temp + '/data');
    let o_by_dataset = new Map();
    let o_server = Deno.serve({ port: 0, hostname: '127.0.0.1', onListen: () => {} }, async (o_request) => {
        let s_path = new URL(o_request.url).pathname;
        // Model UI uses a deterministic fake job; real train/infer is tested separately.
        if (s_path.startsWith('/api/training/yolo/')) {
            let s_action = s_path.split('/').at(-1);
            let s_dataset = new URL(o_request.url).searchParams.get('dataset');
            assert.ok(s_dataset);
            if (!o_by_dataset.has(s_dataset)) {
                o_by_dataset.set(s_dataset, { b_ready: true, a_o_model: [], o_model: null, o_job: null });
            }
            let o_yolo = o_by_dataset.get(s_dataset);
            if (s_action === 'train') {
                let o_config = await o_request.json();
                assert.equal(o_config.n_epoch, 1);
                let s_id = crypto.randomUUID();
                o_yolo.o_model = {
                    s_id,
                    s_name: o_config.s_name || 'Test model',
                    s_dataset,
                    n_ts_ms: Date.now(),
                    a_s_label: ['target'],
                };
                o_yolo.a_o_model.unshift(o_yolo.o_model);
                o_yolo.o_job = {
                    s_id,
                    s_dataset,
                    s_kind: 'train',
                    s_status: 'done',
                    n_epoch: 1,
                    n_epoch_total: 1,
                    a_s_log: [],
                };
                return Response.json({ s_id });
            }
            if (s_action === 'infer') {
                let o_form = await o_request.formData();
                assert.ok(o_form.get('image') instanceof File);
                assert.ok(o_yolo.a_o_model.some((o) => o.s_id === o_form.get('model')));
                o_yolo.o_job = {
                    s_id: crypto.randomUUID(),
                    s_kind: 'infer',
                    s_status: 'done',
                    a_s_log: [],
                    o_result: {
                        a_o_box: [{
                            s_label: 'target',
                            n_confidence: .9,
                            n_x: .1,
                            n_y: .1,
                            n_scl_x: .2,
                            n_scl_y: .2,
                        }],
                    },
                };
                return Response.json({ s_id: o_yolo.o_job.s_id });
            }
            return Response.json(o_yolo);
        }
        if (s_path.startsWith('/api/training/')) return f_o_training_response(o_request, o_catalog);
        let s_text;
        if (s_path === '/') {
            s_text =
                `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/index.css"><div id="app"></div><div id="zoom-app"></div><video id="webcamVideo" autoplay muted></video>
            <script type="module">
            import { createApp, nextTick } from '/lib/vue.esm-browser.js';
            import { o_component__training } from '/o_component__training.js';
            import { o_component__zoom } from '/o_component__zoom.js';
            import { o_state } from '/index.js';
            import { o_actions } from '/o_actions.js';
            let f_assert = (b, s) => { if (!b) throw Error(s); };
            let f_pause = () => new Promise(f => setTimeout(f, 20));
            try {
                let o_canvas = document.createElement('canvas'); o_canvas.width = 320; o_canvas.height = 200;
                let o_ctx = o_canvas.getContext('2d'); o_ctx.fillStyle = '#789'; o_ctx.fillRect(0,0,320,200);
                let n_tick=0; let n_timer=setInterval(()=>{o_ctx.fillStyle=n_tick++%2?'#789':'#788';o_ctx.fillRect(0,0,320,200);},30);
                let o_video = document.getElementById('webcamVideo'); o_video.srcObject = o_canvas.captureStream(30);
                await o_video.play();
                let o_zoom_vm=createApp(o_component__zoom).mount('#zoom-app');
                // Chrome's virtual-time clock can outrun compositor video callbacks.
                // Signal generated frames on the same virtual clock as the fake stage.
                o_video.requestVideoFrameCallback=f=>setTimeout(()=>f(performance.now(),{}),30);
                o_video.cancelVideoFrameCallback=n=>clearTimeout(n);
                let o_app = createApp(o_component__training); let o_vm = o_app.mount('#app');
                while (o_vm.b_busy || !o_vm.o_live) await f_pause();
                await nextTick();
                f_assert(o_vm.n_scl_x === 320, 'live dimensions before capture');
                let o_svg = document.querySelector('.training-live-overlay');
                let o_rect = o_svg.getBoundingClientRect();
                let o_panel=document.querySelector('.panel-training').getBoundingClientRect();
                f_assert(o_rect.bottom<=o_panel.top+1 || o_rect.right<=o_panel.left+1, 'live image beside/above panel');
                f_assert(Math.abs(o_rect.width/o_rect.height - 1.6)<0.01, 'letterboxed aspect ratio');
                f_assert(!document.querySelector('.training-image'), 'no frozen preview');
                o_svg.setPointerCapture = () => {};
                let f_draw=()=>{
                    o_svg.dispatchEvent(new PointerEvent('pointerdown', {clientX:o_rect.x+o_rect.width*.1, clientY:o_rect.y+o_rect.height*.2, pointerId:1, bubbles:true,ctrlKey:true}));
                    o_svg.dispatchEvent(new PointerEvent('pointerup', {clientX:o_rect.x+o_rect.width*.5, clientY:o_rect.y+o_rect.height*.6, pointerId:1, bubbles:true,ctrlKey:true}));
                };
                f_draw(); f_assert(o_vm.a_o_box.length===1, 'draw directly on live image');
                f_assert(Math.abs(o_vm.a_o_box[0].n_x-.1)<.001,'normalized live x');
                await nextTick();
                let o_handle=document.querySelector('.training-resize-handle').getBoundingClientRect();
                f_assert(Math.abs(o_handle.width-10)<.01 && Math.abs(o_handle.height-10)<.01,'10x10 CSS pixel resize handle');
                let f_pointer=(s_type,n_x,n_y,b_shift=false)=>o_svg.dispatchEvent(new PointerEvent(s_type,{clientX:o_rect.x+o_rect.width*n_x,clientY:o_rect.y+o_rect.height*n_y,pointerId:1,bubbles:true,shiftKey:b_shift}));
                f_pointer('pointermove',.25,.4);await nextTick();
                let o_guide=document.querySelector('.training-guide-line');
                f_assert(o_guide?.getAttribute('d')==='M 0 80 H 320 M 80 0 V 200','guides track pointer in camera coordinates');
                f_assert(getComputedStyle(o_guide).strokeDasharray==='6px, 4px','guides are dashed');
                f_assert(o_guide.getAttribute('vector-effect')==='non-scaling-stroke','guide stroke remains screen sized');
                o_svg.dispatchEvent(new PointerEvent('pointerleave'));await nextTick();
                f_assert(!document.querySelector('.training-pointer-guide'),'guides hide outside live image');
                let s_box_id=o_vm.a_o_box[0].s_id,s_box_color=o_vm.a_o_box[0].s_color;
                f_pointer('pointermove',.1,.6);await nextTick();
                f_assert(getComputedStyle(o_svg).cursor==='nesw-resize','resize cursor over handle');
                f_pointer('pointerdown',.1,.6);f_pointer('pointermove',.05,.7);f_pointer('pointerup',.05,.7);
                f_assert(o_vm.a_o_box.length===1 && Math.abs(o_vm.a_o_box[0].n_x-.05)<.001,'resize updates existing box');
                f_assert(Math.abs(o_vm.a_o_box[0].n_scl_x-.45)<.001 && Math.abs(o_vm.a_o_box[0].n_scl_y-.5)<.001,'bottom-left resize keeps top-right fixed');
                f_pointer('pointermove',.25,.4,false);
                window.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',shiftKey:true}));await nextTick();
                f_assert(getComputedStyle(o_svg).cursor==='grab','Shift hand cursor without mouse movement');
                window.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',shiftKey:false}));await nextTick();
                f_assert(getComputedStyle(o_svg).cursor==='default','Shift release restores idle cursor');
                f_pointer('pointerdown',.25,.4,true);await nextTick();
                f_assert(getComputedStyle(o_svg).cursor==='grabbing','dragging hand cursor');
                f_pointer('pointerup',.35,.5,true);
                f_assert(Math.abs(o_vm.a_o_box[0].n_x-.15)<.001 && Math.abs(o_vm.a_o_box[0].n_y-.3)<.001,'Shift drag repositions');
                f_assert(o_vm.a_o_box[0].s_id===s_box_id && o_vm.a_o_box[0].s_color===s_box_color,'edit preserves identity and color');
                let s_before=JSON.stringify(o_vm.a_o_box[0]);
                f_pointer('pointerdown',.3,.4,true);f_pointer('pointermove',.7,.7,true);
                window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
                f_assert(JSON.stringify(o_vm.a_o_box[0])===s_before,'Escape restores original geometry');
                f_pointer('pointerdown',.95,.05,true);f_pointer('pointerup',.9,.1,true);
                f_assert(o_vm.a_o_box.length===1,'Shift outside a box does not draw');
                f_pointer('pointermove',.9,.1,false);
                f_pointer('pointerdown',.8,.1);f_pointer('pointerup',.9,.2);
                f_assert(o_vm.a_o_box.length===1,'plain drag does not draw');
                o_state.o_panel_visibility.zoom=true;await nextTick();o_zoom_vm.f_draw_mag();o_vm.f_sync_live();await nextTick();
                let o_zoom_svg=document.querySelector('.training-live-overlay[data-view="zoom"]');
                f_assert(o_zoom_svg,'zoom annotation overlay exists');
                o_zoom_svg.setPointerCapture=()=>{};
                let f_zoom_pointer=(s_type,n_x,n_y,o_modifier={})=>{
                    let o_rect=o_zoom_svg.getBoundingClientRect();
                    o_zoom_svg.dispatchEvent(new PointerEvent(s_type,{clientX:o_rect.left+n_x*o_rect.width,clientY:o_rect.top+n_y*o_rect.height,pointerId:2,bubbles:true,...o_modifier}));
                };
                f_zoom_pointer('pointerdown',.6,.2,{ctrlKey:true});
                f_assert(!o_zoom_vm.b_dragging__pan,'Ctrl annotation does not pan');
                f_zoom_pointer('pointerup',.8,.4,{ctrlKey:true});await nextTick();
                f_assert(o_vm.a_o_box.length===2,'Ctrl draws in zoom preview');
                let o_zoom_box=o_vm.a_o_box[1];
                f_assert(Math.abs(o_zoom_box.n_x-.5)<.001 && Math.abs(o_zoom_box.n_y-.3)<.001 && Math.abs(o_zoom_box.n_scl_x-.1)<.001,'zoom crop maps to full-frame coordinates');
                let o_zoom_handle=o_zoom_svg.querySelectorAll('.training-resize-handle')[1].getBoundingClientRect();
                f_assert(Math.abs(o_zoom_handle.width-10)<.01 && Math.abs(o_zoom_handle.height-10)<.01,'zoom handle remains 10x10 screen pixels');
                f_zoom_pointer('pointermove',.6,.4);await nextTick();
                f_assert(getComputedStyle(o_zoom_svg).cursor==='nesw-resize','zoom resize cursor');
                f_zoom_pointer('pointerdown',.6,.4);f_zoom_pointer('pointerup',.5,.5);await nextTick();
                f_assert(Math.abs(o_vm.a_o_box[1].n_x-.45)<.001,'zoom handle resizes box');
                f_zoom_pointer('pointerdown',.65,.3,{shiftKey:true});
                f_assert(!o_zoom_vm.b_dragging__pan,'Shift move does not pan');
                f_zoom_pointer('pointerup',.75,.4,{shiftKey:true});
                f_assert(Math.abs(o_vm.a_o_box[1].n_x-.5)<.001,'Shift moves zoom box in full-frame coordinates');
                f_zoom_pointer('pointermove',.2,.2);await nextTick();
                f_assert(o_zoom_svg.querySelector('.training-pointer-guide'),'zoom has dashed guides');
                let s_zoom_box=JSON.stringify(o_vm.a_o_box[1]);
                f_zoom_pointer('pointerdown',.1,.1);
                f_assert(o_zoom_vm.b_dragging__pan,'plain zoom drag pans');
                f_zoom_pointer('pointermove',.2,.2);f_zoom_pointer('pointerup',.2,.2);
                f_assert(JSON.stringify(o_vm.a_o_box[1])===s_zoom_box,'pan preserves camera annotation');
                o_zoom_vm.f_draw_mag();o_vm.f_sync_live();await nextTick();
                f_assert(o_zoom_svg.getAttribute('viewBox').split(' ')[0]!== '64','overlay follows panned crop');
                o_zoom_svg.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));
                o_zoom_vm.f_draw_mag();o_vm.f_sync_live();await nextTick();
                f_assert(o_state.o_zoom.n_scl_x__roi<160,'wheel zoom still works');
                f_assert(JSON.stringify(o_vm.a_o_box[1])===s_zoom_box,'wheel preserves camera annotation');
                f_zoom_pointer('pointerdown',.9,.8,{ctrlKey:true});
                f_assert(o_vm.o_start,'zoom drawing started');
                o_zoom_svg.dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}));
                o_zoom_vm.f_draw_mag();o_vm.f_sync_live();await nextTick();
                f_assert(!o_vm.o_start && o_vm.a_o_box.length===2,'changing zoom cancels unfinished drawing');
                window.dispatchEvent(new KeyboardEvent('keydown',{key:'Control',ctrlKey:true}));await nextTick();
                f_assert(!o_zoom_vm.b_armed__pick,'Ctrl belongs to training while open');
                o_zoom_vm.f_toggle_select();await nextTick();
                f_assert(o_zoom_vm.b_armed__pick && getComputedStyle(o_svg).pointerEvents==='none','Select area can select ROI during training');
                o_state.o_zoom.b_selecting=false;o_state.o_panel_visibility.zoom=false;
                window.dispatchEvent(new KeyboardEvent('keyup',{key:'Control'}));
                o_vm.a_o_box.pop();await nextTick();
                o_vm.f_add_label();o_vm.a_o_label[1].s_name='diatom';
                o_actions.f_tick(new Set(['1']));o_actions.f_tick(new Set());
                f_assert(o_vm.s_label===o_vm.a_o_label[0].s_id,'numeric shortcut selects first label');
                o_actions.f_tick(new Set(['2']));o_actions.f_tick(new Set());
                f_assert(o_vm.s_label===o_vm.a_o_label[1].s_id,'numeric shortcut selects second label');
                let o_model_ui=document.querySelector('.training-yolo').__vueParentComponent.proxy;
                while(!o_model_ui.o_status) await f_pause();
                let o_infer_button=[...document.querySelectorAll('.training-yolo button')].find(o=>o.textContent==='Infer YOLO');
                f_assert(o_infer_button.disabled,'inference disabled before model exists');
                o_model_ui.n_epoch=1;await o_model_ui.f_train();await nextTick();
                f_assert(!o_infer_button.disabled,'fine-tuned model enables inference');
                let s_first_model=o_model_ui.s_model;
                await o_model_ui.f_train();await nextTick();
                f_assert(o_model_ui.o_status.a_o_model.length===2,'multiple named models remain selectable');
                o_model_ui.s_model=s_first_model;await nextTick();

                await o_model_ui.f_infer();
                while(o_model_ui.s_pending) await f_pause();await nextTick();
                f_assert(document.querySelectorAll('.training-yolo-prediction').length===1,'inference overlay');
                f_assert(o_vm.a_o_box.length===1,'predictions do not overwrite annotation');
                o_vm.f_accept_prediction();f_assert(o_vm.a_o_box.length===2,'explicitly accepting predictions creates editable boxes');
                o_vm.a_o_box.pop();
                await o_model_ui.f_infer();o_state.a_o_motor[2].n_position++;await nextTick();
                while(o_model_ui.s_pending) await f_pause();
                f_assert(o_vm.a_o_prediction.length===0 && o_model_ui.s_message.includes('changed'),'stale inference discarded after stage motion');
                o_state.a_o_motor[2].n_position=12;
                o_vm.n_focus_start=10;o_vm.n_focus_end=14;o_vm.n_plane=3;
                await o_vm.f_capture();await nextTick();
                f_assert(!o_vm.s_error,o_vm.s_error);
                f_assert(o_vm.a_o_sample.length===3,'capture saves all focus planes');
                f_assert(o_state.a_o_motor[2].n_position===12,'return to previous focus');
                f_assert(o_vm.a_o_box.length===1,'capture preserves live boxes');
                f_assert(o_vm.a_o_sample.every(o=>o.a_o_box.length===1),'annotations shared across planes');
                f_assert(o_vm.a_o_sample.every(o=>Math.abs(o.a_o_box[0].n_x-.15)<.001),'capture saves edited geometry');
                f_assert(new Set(o_vm.a_o_sample.map(o=>o.s_set)).size===1,'capture set association');
                f_assert(o_vm.a_n_captured.includes(0),'coverage marked after capture');
                f_assert(document.querySelectorAll('.training-crop-row figure').length===3,'crop preview per plane');
                await o_vm.f_tag(o_vm.a_o_sample[0],'good');await o_vm.f_refresh();
                f_assert(o_vm.a_o_sample[0].s_quality==='good','quality persisted');
                o_vm.o_grid_config.x=2;o_vm.o_grid_config.y=2;
                await o_vm.f_next();
                f_assert(o_vm.n_region===1 && o_state.a_o_motor[0].n_position===70,'next region');
                f_assert(o_vm.a_o_box.length===0,'XY invalidates annotation');
                await o_vm.f_next();
                f_assert(o_vm.n_region===2 && o_state.a_o_motor[0].n_position===70 && o_state.a_o_motor[1].n_position===60,'snake row turn');
                await o_vm.f_next();
                f_assert(o_vm.n_region===3 && o_state.a_o_motor[0].n_position===0,'snake reversed row');
                await o_vm.f_jog('x',-1);
                f_assert(o_state.a_o_motor[0].n_position===-70 && o_vm.o_origin===null,'arrow test move resets grid');
                await o_vm.f_test_focus();f_assert(o_state.a_o_motor[2].n_position===12,'test restores focus');
                f_draw();o_state.a_o_motor[2].n_position++;
                f_assert(o_vm.a_o_box.length===1,'Z retains live boxes');
                o_state.a_o_motor[0].n_position++;
                f_assert(o_vm.a_o_box.length===0,'external XY clears live boxes');
                f_draw();let o_run=o_vm.f_capture();setTimeout(()=>o_vm.f_stop(),40);await o_run;
                f_assert(o_vm.s_error && !o_state.b_training_busy && !o_state.b_scanning,'stop cancels and releases stage');

                o_vm.s_name__dataset='Second dataset';await o_vm.f_create_dataset();await nextTick();
                let s_second_dataset=o_vm.s_dataset;
                f_assert(s_second_dataset!=='default' && o_vm.a_o_sample.length===0,'new dataset is selected and empty');
                f_assert(o_vm.a_o_box.length===0 && o_vm.n_region===0,'switch clears annotations and navigation');
                f_assert(o_vm.a_o_label.length===1,'new dataset has its own label palette');
                let o_second_model_ui=document.querySelector('.training-yolo').__vueParentComponent.proxy;
                while(!o_second_model_ui.o_status)await f_pause();
                f_assert(o_second_model_ui.o_status.a_o_model.length===0,'model list scoped to dataset');
                o_vm.a_o_label[0].s_name='second target';f_draw();
                o_state.o_panel_visibility.zoom=true;await nextTick();o_zoom_vm.f_draw_mag();o_vm.f_sync_live();await nextTick();
                o_zoom_svg=document.querySelector('.training-live-overlay[data-view="zoom"]');
                o_zoom_svg.setPointerCapture=()=>{};
                o_vm.f_toggle_crop();await nextTick();
                f_assert(getComputedStyle(o_zoom_svg).cursor.includes('data:image/svg+xml'),'crop cursor icon');
                f_zoom_pointer('pointerdown',.1,.1);f_zoom_pointer('pointerup',.1,.1);
                f_assert(o_vm.b_crop && o_vm.o_crop_start,'first click waits for second corner');
                f_zoom_pointer('pointermove',.8,.8);await nextTick();
                f_assert(document.querySelectorAll('.training-crop-mask').length===2,'crop preview shown in both views');
                f_zoom_pointer('pointerdown',.8,.8);f_zoom_pointer('pointerup',.8,.8);
                f_assert(o_vm.o_crop && !o_vm.b_crop && o_vm.a_o_box.length===0,'zoom two-click crop commits and clears old boxes');
                let s_crop_before=JSON.stringify(o_vm.o_crop);
                o_vm.f_toggle_crop();f_zoom_pointer('pointerdown',.2,.2);
                window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
                f_assert(!o_vm.b_crop && JSON.stringify(o_vm.o_crop)===s_crop_before,'Escape preserves previous crop');
                o_state.o_panel_visibility.zoom=false;await nextTick();
                o_vm.f_toggle_crop();f_pointer('pointerdown',.6,.7);f_pointer('pointerup',.6,.7);
                f_pointer('pointerdown',.2,.2);f_pointer('pointerup',.2,.2);await nextTick();
                f_assert(o_vm.o_crop.n_x===64 && o_vm.o_crop.n_y===40 && o_vm.o_crop.n_scl_x===128 && o_vm.o_crop.n_scl_y===100,'reverse clicks snap crop to camera pixels');
                f_assert(document.querySelector('.training-crop-mask').getAttribute('fill-opacity')==='0.8','outside crop darkened at alpha 0.8');
                f_draw();f_assert(o_vm.a_o_box.length===0,'drawing cannot start outside crop');
                let f_crop_draw=(s_type,n_x,n_y)=>o_svg.dispatchEvent(new PointerEvent(s_type,{clientX:o_rect.x+o_rect.width*n_x,clientY:o_rect.y+o_rect.height*n_y,pointerId:1,bubbles:true,ctrlKey:true}));
                f_crop_draw('pointerdown',.3,.3);f_crop_draw('pointerup',.9,.9);
                f_assert(Math.abs(o_vm.a_o_box[0].n_x+o_vm.a_o_box[0].n_scl_x-.6)<.001 && Math.abs(o_vm.a_o_box[0].n_y+o_vm.a_o_box[0].n_scl_y-.7)<.001,'drawing stops at crop boundary');
                f_pointer('pointerdown',.4,.4,true);f_pointer('pointerup',0,0,true);
                f_assert(Math.abs(o_vm.a_o_box[0].n_x-.2)<.001 && Math.abs(o_vm.a_o_box[0].n_y-.2)<.001,'moving stays inside crop');
                f_pointer('pointerdown',.2,.6);f_pointer('pointerup',0,1);
                f_assert(Math.abs(o_vm.a_o_box[0].n_y+o_vm.a_o_box[0].n_scl_y-.7)<.001,'resize stops at crop boundary');
                o_vm.n_focus_start=10;o_vm.n_focus_end=10;o_vm.n_plane=1;await o_vm.f_capture();
                f_assert(o_vm.a_o_sample.length===1 && o_vm.a_o_sample[0].s_dataset===s_second_dataset,'capture belongs to selected dataset');
                let o_cropped=o_vm.a_o_sample[0];
                f_assert(o_cropped.n_scl_x===128 && o_cropped.n_scl_y===100 && o_cropped.o_crop.n_x===64 && o_cropped.n_scl_x__source===320,'capture stores crop dimensions and source geometry');
                f_assert(Math.abs(o_cropped.a_o_box[0].n_x)<.001 && Math.abs(o_cropped.a_o_box[0].n_y)<.001 && Math.abs(o_cropped.a_o_box[0].n_scl_x-.75)<.001,'saved boxes normalized to crop');
                let o_bitmap=await createImageBitmap(await (await fetch(o_vm.f_s_image(o_cropped))).blob());
                f_assert(o_bitmap.width===128 && o_bitmap.height===100,'actual PNG is cropped');
                let o_check=document.createElement('canvas');o_check.width=128;o_check.height=100;
                o_check.getContext('2d').drawImage(o_bitmap,0,0);o_bitmap.close();
                let a_pixel=o_check.getContext('2d').getImageData(1,1,1,1).data;
                f_assert(a_pixel[0]>100 && a_pixel[3]===255,'crop PNG contains raw pixels without dark overlay');
                let s_export=new TextDecoder().decode(await (await fetch('/api/training/export?dataset='+s_second_dataset)).arrayBuffer());
                f_assert(s_export.includes('0 0.37500000 0.50000000 0.75000000 1.00000000'),'YOLO export uses crop-relative labels');
                o_second_model_ui.n_epoch=1;await o_second_model_ui.f_train();await nextTick();
                await o_second_model_ui.f_infer();await o_second_model_ui.f_poll();
                f_assert(Math.abs(o_vm.a_o_prediction[0].n_x-.24)<.001 && Math.abs(o_vm.a_o_prediction[0].n_y-.25)<.001,'crop inference maps detections back to live camera coordinates');

                await o_vm.f_switch_dataset('default');await nextTick();
                f_assert(o_vm.a_o_sample.length===3 && o_vm.a_o_label.length===2,'original dataset captures and palette preserved');
                f_assert(o_vm.o_crop===null,'dataset switch clears crop');
                await o_vm.f_switch_dataset(s_second_dataset);await nextTick();
                f_assert(o_vm.a_o_sample.length===1 && o_vm.a_o_label[0].s_name==='second target','dataset selection restores its own captures and labels');
                await o_vm.f_switch_dataset('default');await nextTick();
                o_app.unmount();o_app=createApp(o_component__training);o_vm=o_app.mount('#app');
                while(o_vm.b_busy) await f_pause();
                f_assert(o_vm.a_o_sample.length===3,'saved data survives remount');
                f_assert(o_vm.a_o_label.length===2,'label palette persists');
                await o_vm.f_delete(o_vm.a_o_sample[0]);f_assert(o_vm.a_o_sample.length===2,'delete capture');
                if (${!Deno.env.get(
                    'TRAINING_SCREENSHOT',
                )}) {o_app.unmount();clearInterval(n_timer);o_video.srcObject.getTracks().forEach(o=>o.stop());} else {o_vm.n_focus_start=10;o_vm.n_focus_end=14;o_vm.n_plane=3;o_vm.a_o_box=o_vm.a_o_sample[0].a_o_box;}
                document.body.dataset.result='passed';
            } catch(o_error) {document.body.dataset.result='failed';document.body.dataset.error=o_error.stack;}
            </script>`;
        } else if (s_path === '/index.js') {
            s_text = `import { reactive } from '/lib/vue.esm-browser.js';
            export let o_state=reactive({o_panel_visibility:{training:true,zoom:false},b_streaming__webcam:true,o_zoom:{n_x__roi:64,n_y__roi:40,n_scl_x__roi:160,n_scl_y__roi:100,n_scl_x__mag:280,n_px__panel_x:10,n_px__panel_y:70,s_resample:'interpolated',b_selecting:false},b_connected__esp:true,s_id__webcam_device:'fake',
                o_motor__axis:{x:0,y:1,z:2},a_o_motor:[{n_position:0,b_running:false},{n_position:0,b_running:false},{n_position:12,b_running:false}],
                o_camera:{},n_cnt__capture_flash:0,o_flat_field:{b_active:false},b_scanning:false,n_rpm__jog:5,n_rpm__focus_jog:.5});
            export let f_n_motor__axis=s=>o_state.o_motor__axis[s];
            export let f_save_setting=()=>{};export let f_save_setting__debounced=()=>{};
            export let f_set_mouse_jog=()=>{};
            let a_f_handler=[];let o_timer={};
            export let f_register_esp_handler=f=>{a_f_handler.push(f);return()=>{a_f_handler=a_f_handler.filter(v=>v!==f);};};
            export let f_register_esp_disconnect=()=>()=>{};
            export let f_send_esp=o=>{
                if(o.command==='moveSteps') {
                    o_state.a_o_motor[o.motor].b_running=true;
                    o_timer[o.motor]=setTimeout(()=>{o_state.a_o_motor[o.motor].n_position+=o.n_step;
                        o_state.a_o_motor[o.motor].b_running=false;
                        for(let f of [...a_f_handler]) f({type:'moveComplete',motor:o.motor,n_position:o_state.a_o_motor[o.motor].n_position});},10);
                } else if(o.command==='stop') {clearTimeout(o_timer[o.motor]);o_state.a_o_motor[o.motor].b_running=false;}
            };
            export let f_send_esp_stop_all=()=>{o_state.n_cnt__stop_all=(o_state.n_cnt__stop_all||0)+1;};`;
        } else if (s_path === '/o_flatfield.module.js') {
            s_text = 'export let f_b_flat__matches = () => false; export let f_flat__apply = () => {};';
        } else {
            if (!/^\/(lib\/)?[a-zA-Z0-9_.-]+\.(js|css)$/.test(s_path)) {
                return new Response('', { status: 404 });
            }
            try {
                s_text = await Deno.readTextFile(new URL('../webserved_dir' + s_path, import.meta.url));
            } catch {
                return new Response('', { status: 404 });
            }
        }
        return new Response(s_text, {
            headers: {
                'content-type': s_path === '/'
                    ? 'text/html'
                    : s_path.endsWith('.css')
                    ? 'text/css'
                    : 'text/javascript',
            },
        });
    });
    try {
        let o_process = new Deno.Command('/usr/bin/google-chrome', {
            args: [
                ...(Deno.env.get('TRAINING_SCREENSHOT')
                    ? ['--screenshot=' + Deno.env.get('TRAINING_SCREENSHOT')]
                    : []),
                '--window-size=' + (Deno.env.get('TRAINING_WINDOW') || '1440,1000'),
                '--headless',
                '--no-sandbox',
                '--disable-gpu',
                '--autoplay-policy=no-user-gesture-required',
                '--no-first-run',
                '--disable-dev-shm-usage',
                '--user-data-dir=' + s_temp + '/chrome',
                '--dump-dom',
                '--timeout=20000',
                '--virtual-time-budget=30000',
                `http://127.0.0.1:${o_server.addr.port}/`,
            ],
            stdout: 'piped',
            stderr: 'piped',
        }).spawn();
        let o_output = await o_process.output();
        let s_dom = new TextDecoder().decode(o_output.stdout);
        assert.ok(
            s_dom.includes('data-result="passed"'),
            s_dom + '\n' + new TextDecoder().decode(o_output.stderr).slice(-2000),
        );
    } finally {
        await o_server.shutdown();
        await Deno.remove(s_temp, { recursive: true });
    }
});
