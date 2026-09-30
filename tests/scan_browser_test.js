import assert from 'node:assert/strict';

async function runScanBrowserTest(cornerFocus = false) {
    const dir = await Deno.makeTempDir();
    const folderRequests = [];
    const js = text => new Response(text, { headers: { 'content-type': 'text/javascript' } });
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
        const path = new URL(request.url).pathname;
        if (path === '/scan_corner_workflow.browser.js') return js(await Deno.readTextFile(new URL('./scan_corner_workflow.browser.js', import.meta.url)));
        if (path === '/api/scans/open_folder') {
            folderRequests.push({ method: request.method, folder: new URL(request.url).searchParams.get('path') });
            return folderRequests.length === 1 ? new Response(null, { status: 204 })
                : new Response('Could not open scan folder: file browser unavailable', { status: 500 });
        }
        if (path === '/index.js') return js(`
            import {reactive} from './lib/vue.esm-browser.js';
            export const o_state = reactive({ b_connected__esp:true, b_connected__server:true, b_scanning:false,
                n_id__slide__current: 10, o_panel_visibility:{scan:true}, a_o_setting:[], o_motor__axis:{x:0,y:1,z:2},
                a_o_motor:[{n_position:0},{n_position:0},{n_position:0}], a_n_step__per_px:[1,1,1] });
            export const jobs = [];
            export const moves = [];
            export const motion = { stopMotor: null, disconnectMotor: null };
            export const settings = {};
            export const f_n_motor__axis = axis => o_state.o_motor__axis[axis];
            export function f_save_setting__debounced(key, value) { settings[key]=structuredClone(value); }
            export async function f_send_esp_move_step(motor, steps) {
                moves.push({motor, steps, locked:o_state.b_scanning});
                if (motion.disconnectMotor === motor) o_state.b_connected__esp=false;
                if (motion.stopMotor === motor) { f_send_esp_stop_all(); return o_state.a_o_motor[motor].n_position; }
                return o_state.a_o_motor[motor].n_position + steps;
            }
            export function f_send_esp_stop() {}
            export function f_send_esp_stop_all() { o_state.n_cnt__stop_all=(o_state.n_cnt__stop_all||0)+1; }
            export async function f_send_wsmsg_with_response(msg) {
                const d = msg.v_data;
                if (msg.s_type === 'scan_create_folder') {
                    const folder = '/scans/scan_' + jobs.length;
                    jobs.push({s_id:folder, s_name:folder, s_path_folder:folder, s_status:'capturing', n_tiles:0, a_s_line:[], n_id__slide:d.n_id__slide,
                        o_option: d.b_live_scan ? {...d.o_option,b_live_scan:true} : {}});
                    return {v_result:{s_path_folder:folder}};
                }
                if (msg.s_type === 'scan_jobs_list') return {v_result:structuredClone(jobs)};
                const job = jobs.find(j => j.s_path_folder === d.s_path_folder);
                if (msg.s_type === 'scan_tile_ready') {
                    job.o_live={s_path_preview:job.s_path_folder+'/live_preview.jpg',n_revision:(job.o_live?.n_revision||0)+1};
                }
                if (msg.s_type === 'scan_finish') { job.n_tiles=d.n_tiles; job.s_status='ready'; }
                if (msg.s_type === 'stitch_run') { job.o_option={...job.o_option,...d}; job.s_status=jobs.some(j => j.s_status === 'running')?'queued':'running'; job.a_s_line.push('log ' + job.s_id); }
                return {v_result:structuredClone(job)};
            }
        `);
        if (path === '/constructors.module.js') return js(`export const f_o_wsmsg=(s_type,v_data)=>({s_type,v_data});`);
        if (path === '/focus_search.module.js') return js(`export function f_n_score__video(){}; export function f_o_focus__fast(){};`);
        if (path === '/o_capture.module.js') return js(`
            import {o_state} from './index.js';
            export const saved=[];
            export async function f_o_capture__frame(){ const c=document.createElement('canvas');c.width=640;c.height=480;return {o_blob:await new Promise(r=>c.toBlob(r))}; }
            export async function f_save_image(blob,folder,name){saved.push({folder,name,positions:o_state.a_o_motor.map(m=>m.n_position)});}
        `);
        if (path === '/') return new Response(`<!doctype html><meta charset="utf-8"><div id="app"></div><script type="module">
            import {createApp,nextTick} from './lib/vue.esm-browser.js';
            import {o_component__scan} from './o_component__scan.js';
            import {o_state,jobs} from './index.js';
            import {saved} from './o_capture.module.js';
            import {runCornerWorkflow} from './scan_corner_workflow.browser.js';
            const assert=(ok,message)=>{if(!ok)throw Error(message)};
            HTMLCanvasElement.prototype.toBlob=function(callback){callback(new Blob(['frame']));};
            window.createImageBitmap=async()=>{const c=document.createElement('canvas');c.width=640;c.height=480;c.close=()=>{};return c;};
            const app=createApp(o_component__scan), vm=app.mount('#app');
            try {
                if (${cornerFocus}) {
                    await runCornerWorkflow(vm);
                } else {
                vm.n_tile_x=2;vm.n_tile_y=1;vm.f_delay=async()=>{};vm.f_move_motor_n_step=async()=>{};
                assert(document.body.textContent.includes('Start classical scan'),'Classical button missing');
                assert(document.body.textContent.includes('Start live scan'),'Live button missing');
                vm.f_return_to_start=async()=>{
                    assert(o_state.b_scanning,'Capture lock released before return');
                    if (vm.b_live_scan) {
                        await vm.f_refresh_jobs();await nextTick();
                        assert(jobs.at(-1).s_status==='capturing','Preview check ran after capture finished');
                        assert(document.querySelector('img[alt="Provisional live scan mosaic"]'),'No preview during capture');
                    }
                };
                await vm.f_start_scan();
                assert(vm.s_status==='complete','Capture waited on running stitch');
                assert(jobs[0].s_status==='running','First stitch did not start');
                assert(!o_state.b_scanning,'Capture lock left enabled');
                await nextTick();
                [...document.querySelectorAll('button')].find(b=>b.textContent==='New Scan').click();
                await nextTick();
                assert(vm.s_status==='idle','New scan unavailable');
                assert(document.body.textContent.includes('running'),'Job disappeared on reset');
                o_state.n_id__slide__current=20;
                await vm.f_start_scan(true);
                assert(jobs[1].s_status==='queued','Second stitch must queue behind first');
                assert(jobs[1].o_live?.n_revision===2,'Live scan did not notify both saved tiles');
                await nextTick();
                assert(document.querySelector('img[alt="Provisional live scan mosaic"]'),'Live preview missing');
                assert(jobs[0].n_id__slide===10 && jobs[1].n_id__slide===20,'Slide associations lost');
                assert(saved.filter(s=>!s.folder.endsWith('dowscaled')).length===4,'Both scans not captured');
                const folder=vm.s_path_folder__scan;
                jobs[0].s_status='complete';jobs[0].o_result={s_path_output:'/scans/scan_0/stitched.png',s_path_jpeg:'/scans/scan_0/stitched.jpg'};
                vm.s_status='scanning';o_state.b_scanning=true;
                await vm.f_refresh_jobs();await nextTick();
                assert(vm.s_status==='scanning' && o_state.b_scanning,'Late result changed active capture');
                assert(vm.s_path_folder__scan===folder,'Late result replaced current folder');
                assert(document.querySelector('a[href*="scan_0%2Fstitched.png"]'),'Previous result missing');
                assert(document.querySelector('a[href*="scan_0%2Fstitched.jpg"]')?.textContent==='Open JPEG','Full-size JPEG link missing');
                Object.assign(jobs[0].o_result, {
                    s_path_original_colors:'/scans/scan_0/stitched_original_colors.png',
                    s_path_original_colors_jpeg:'/scans/scan_0/stitched_original_colors.jpg',
                    s_path_original_colors_preview:'/scans/scan_0/stitched_original_colors_preview.jpg',
                });
                await vm.f_refresh_jobs();await nextTick();
                assert(document.querySelector('a[href*="scan_0%2Fstitched_original_colors.png"]')?.textContent==='Original colors PNG','Original-color PNG link missing');
                assert(document.querySelector('a[href*="scan_0%2Fstitched_original_colors.jpg"]')?.textContent==='Original colors JPEG','Original-color JPEG link missing');
                assert(document.querySelector('a[href*="scan_0%2Fstitched.png"]')?.textContent==='Adjusted PNG','Adjusted output must remain available');
                const thumbnail=document.querySelector('img[alt="Stitched scan — original colors"]');
                assert(thumbnail?.src.includes('stitched_original_colors_preview.jpg'),'Thumbnail must show original colors');
                assert(thumbnail.parentElement.href.includes('stitched_original_colors.png'),'Thumbnail must open the full-size original-color image');
                assert(vm.a_o_job[0].a_s_line[0]!==vm.a_o_job[1].a_s_line[0],'Logs mixed');
                const openFolder=[...document.querySelectorAll('.scan-job button')].find(b=>b.textContent==='Open folder');
                assert(openFolder,'Open folder must be a button');
                assert(!document.querySelector('a[href*="/api/scans/folder"]'),'Open folder still navigates to a web listing');
                const originalOpenFolder=vm.f_open_folder;
                const opened=new Promise(resolve=>{vm.f_open_folder=async job=>{await originalOpenFolder(job);resolve();};});
                openFolder.click();await opened;
                assert(!vm.s_error__jobs,'Successful folder open reported an error');
                await vm.f_open_folder(vm.a_o_job[1]);await nextTick();
                assert(document.querySelector('.scan-stitch-error')?.textContent.includes('file browser unavailable'),'Folder launch error not shown');
                vm.s_status='complete';o_state.b_scanning=false;
                }
                document.body.dataset.result='PASS';
            } catch(e) {document.body.dataset.result='FAIL: '+e.stack;}
            finally {app.unmount();}
        </script>`, { headers: { 'content-type': 'text/html' } });
        try { return js(await Deno.readTextFile(new URL('../webserved_dir' + path, import.meta.url))); }
        catch { return new Response('', { status: 404 }); }
    });
    try {
        const result = await new Deno.Command('/usr/bin/google-chrome', { args: [
            '--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', '--user-data-dir=' + dir,
            '--virtual-time-budget=10000', '--dump-dom', 'http://127.0.0.1:' + server.addr.port,
        ], stdout: 'piped', stderr: 'piped' }).output();
        const html = new TextDecoder().decode(result.stdout);
        assert.ok(html.includes('data-result="PASS"'), html || new TextDecoder().decode(result.stderr));
        assert.deepEqual(folderRequests, cornerFocus ? [] : [
            { method: 'POST', folder: '/scans/scan_0' },
            { method: 'POST', folder: '/scans/scan_1' },
        ]);
    } finally { await server.shutdown(); await Deno.remove(dir, { recursive: true }); }
}

Deno.test('scan UI captures a second slide while the first stitch runs and keeps results separate', () => runScanBrowserTest());
Deno.test('scan UI interpolates manually focused corners and handles changes, stops and disconnection', () => runScanBrowserTest(true));
