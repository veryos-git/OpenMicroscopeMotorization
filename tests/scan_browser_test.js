import assert from 'node:assert/strict';

Deno.test('scan UI captures a second slide while the first stitch runs and keeps results separate', async () => {
    const dir = await Deno.makeTempDir();
    const js = text => new Response(text, { headers: { 'content-type': 'text/javascript' } });
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
        const path = new URL(request.url).pathname;
        if (path === '/index.js') return js(`
            import {reactive} from './lib/vue.esm-browser.js';
            export const o_state = reactive({ b_connected__esp:true, b_connected__server:true, b_scanning:false,
                n_id__slide__current: 10, o_panel_visibility:{scan:true}, a_o_setting:[], o_motor__axis:{x:0,y:1,z:2},
                a_o_motor:[{n_position:0},{n_position:0},{n_position:0}], a_n_step__per_px:[1,1,1] });
            export const jobs = [];
            export const f_n_motor__axis = axis => o_state.o_motor__axis[axis];
            export function f_save_setting__debounced() {}
            export function f_send_esp_move_step() {}
            export function f_send_esp_stop() {}
            export function f_send_esp_stop_all() {}
            export async function f_send_wsmsg_with_response(msg) {
                const d = msg.v_data;
                if (msg.s_type === 'scan_create_folder') {
                    const folder = '/scans/scan_' + jobs.length;
                    jobs.push({s_id:folder, s_name:folder, s_path_folder:folder, s_status:'capturing', n_tiles:0, a_s_line:[], n_id__slide:d.n_id__slide});
                    return {v_result:{s_path_folder:folder}};
                }
                if (msg.s_type === 'scan_jobs_list') return {v_result:structuredClone(jobs)};
                const job = jobs.find(j => j.s_path_folder === d.s_path_folder);
                if (msg.s_type === 'scan_finish') { job.n_tiles=d.n_tiles; job.s_status='ready'; }
                if (msg.s_type === 'stitch_run') { job.o_option=d; job.s_status=jobs.some(j => j.s_status === 'running')?'queued':'running'; job.a_s_line.push('log ' + job.s_id); }
                return {v_result:structuredClone(job)};
            }
        `);
        if (path === '/constructors.module.js') return js(`export const f_o_wsmsg=(s_type,v_data)=>({s_type,v_data});`);
        if (path === '/focus_search.module.js') return js(`export function f_n_score__video(){}; export function f_o_focus__fast(){};`);
        if (path === '/o_capture.module.js') return js(`
            export const saved=[];
            export async function f_o_capture__frame(){ const c=document.createElement('canvas');c.width=640;c.height=480;return {o_blob:await new Promise(r=>c.toBlob(r))}; }
            export async function f_save_image(blob,folder,name){saved.push({folder,name});}
        `);
        if (path === '/') return new Response(`<!doctype html><div id="app"></div><script type="module">
            import {createApp,nextTick} from './lib/vue.esm-browser.js';
            import {o_component__scan} from './o_component__scan.js';
            import {o_state,jobs} from './index.js';
            import {saved} from './o_capture.module.js';
            const assert=(ok,message)=>{if(!ok)throw Error(message)};
            HTMLCanvasElement.prototype.toBlob=function(callback){callback(new Blob(['frame']));};
            window.createImageBitmap=async()=>{const c=document.createElement('canvas');c.width=640;c.height=480;c.close=()=>{};return c;};
            const app=createApp(o_component__scan), vm=app.mount('#app');
            try {
                vm.n_tile_x=2;vm.n_tile_y=1;vm.f_delay=async()=>{};vm.f_move_motor_n_step=async()=>{};
                vm.f_return_to_start=async()=>assert(o_state.b_scanning,'Capture lock released before return');
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
                await vm.f_start_scan();
                assert(jobs[1].s_status==='queued','Second stitch must queue behind first');
                assert(jobs[0].n_id__slide===10 && jobs[1].n_id__slide===20,'Slide associations lost');
                assert(saved.filter(s=>!s.folder.endsWith('dowscaled')).length===4,'Both scans not captured');
                const folder=vm.s_path_folder__scan;
                jobs[0].s_status='complete';jobs[0].o_result={s_path_output:'/scans/scan_0/stitched.png'};
                vm.s_status='scanning';o_state.b_scanning=true;
                await vm.f_refresh_jobs();await nextTick();
                assert(vm.s_status==='scanning' && o_state.b_scanning,'Late result changed active capture');
                assert(vm.s_path_folder__scan===folder,'Late result replaced current folder');
                assert(document.querySelector('a[href*="scan_0%2Fstitched.png"]'),'Previous result missing');
                assert(vm.a_o_job[0].a_s_line[0]!==vm.a_o_job[1].a_s_line[0],'Logs mixed');
                vm.s_status='complete';o_state.b_scanning=false;
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
    } finally { await server.shutdown(); await Deno.remove(dir, { recursive: true }); }
});
