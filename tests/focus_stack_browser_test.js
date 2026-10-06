import assert from 'node:assert/strict';

Deno.test('focus stack UI defaults to two-point easy mode and retains expert controls and hardware invalidation',async()=>{
    const dir=await Deno.makeTempDir();
    const js=s=>new Response(s,{headers:{'content-type':'text/javascript'}});
    const server=Deno.serve({hostname:'127.0.0.1',port:0,onListen(){}},async request=>{
        const path=new URL(request.url).pathname;
        if(path==='/index.js') return js(`
            import {reactive} from './lib/vue.esm-browser.js';
            export const o_state=reactive({b_connected__esp:true,b_streaming__webcam:true,b_scanning:false,
                o_panel_visibility:{focus_stack:true},o_motor__axis:{z:1},a_o_motor:[{n_position:0},{n_position:0}],a_o_setting:[]});
            export const requests=[],settings=[];
            export const f_n_motor__axis=()=>o_state.o_motor__axis.z;
            export const f_send_esp_move_step=async(motor,delta)=>o_state.a_o_motor[motor].n_position+delta;
            export const f_send_esp_stop=()=>{};
            export const f_register_handler=()=>()=>{};
            export function f_save_setting__debounced(key,value){settings.push(JSON.parse(JSON.stringify(value)));}
            export async function f_send_wsmsg_with_response(msg){requests.push(msg);return {v_result:msg.s_type==='focus_stack_create_folder'?{s_path_folder:'/stack'}:{b_success:true,s_path_output:'/stack/result.png'}};}
        `);
        if(path==='/o_capture.module.js') return js(`
            import {o_state} from './index.js';export const captured=[];
            export const f_o_capture__frame=async()=>({o_blob:new Blob()});
            export const f_save_image=async()=>captured.push(o_state.a_o_motor[1].n_position);
        `);
        if(path==='/') return new Response(`<!doctype html><div id="app"></div><script type="module">
            import {createApp,nextTick} from './lib/vue.esm-browser.js';
            import {o_component__focus_stack} from './o_component__focus_stack.js';
            import {o_state,settings} from './index.js';import {captured} from './o_capture.module.js';
            const assert=(ok,message)=>{if(!ok)throw Error(message);};let app;
            try {
                app=createApp(o_component__focus_stack);const vm=app.mount('#app');vm.f_delay=async()=>{};
                const text=()=>document.querySelector('#app').textContent;const button=s=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===s);
                assert(vm.o_config.s_mode==='easy' && button('Start').disabled,'Easy mode must be default and require focus points');
                assert(!text().includes('Step size') && !text().includes('Autofocus first'),'Expert controls leaked into easy mode');
                o_state.a_o_motor[1].n_position=20;button('Set focus position 1 here').click();
                o_state.a_o_motor[1].n_position=40;button('Set focus position 2 here').click();vm.o_config.n_its=5;await nextTick();
                assert(!button('Start').disabled,'Focus points did not enable start');
                await vm.f_run();assert(JSON.stringify(captured)==='[20,25,30,35,40]','Easy capture did not include evenly spaced endpoints');
                await nextTick();button('New Stack').click();await nextTick();
                const mode=document.querySelector('#focus-stack-mode');mode.value='expert';mode.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();
                assert(text().includes('Step size') && text().includes('Focus max travel') && text().includes('Align frames'),'Expert controls missing');
                assert(settings.at(-1).s_mode==='expert','Mode was not saved');
                vm.o_config.n_step=73;mode.value='easy';mode.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();
                assert(vm.o_config.n_step===73 && !text().includes('Step size'),'Switching modes must retain expert values');
                o_state.o_motor__axis.z=0;await nextTick();assert(vm.a_n_focus.every(n=>n===null) && button('Start').disabled,'Axis change retained stale focus points');
                o_state.a_o_motor[0].n_position=10;button('Set focus position 1 here').click();
                o_state.a_o_motor[0].n_position=20;button('Set focus position 2 here').click();
                o_state.b_connected__esp=false;await nextTick();assert(vm.a_n_focus.every(n=>n===null),'Disconnect retained stale focus points');
                document.body.dataset.result='PASS';
            } catch(error){document.body.dataset.result='FAIL';document.body.textContent=error.stack;}
            finally{app?.unmount();}
            </script>`,{headers:{'content-type':'text/html'}});
        try{return js(await Deno.readTextFile(new URL('../webserved_dir'+path,import.meta.url)));}catch{return new Response('',{status:404});}
    });
    try {
        const output=await new Deno.Command('/usr/bin/google-chrome',{args:['--headless','--no-sandbox','--disable-gpu','--user-data-dir='+dir,'--virtual-time-budget=10000','--dump-dom','http://127.0.0.1:'+server.addr.port],stdout:'piped',stderr:'piped'}).output();
        const html=new TextDecoder().decode(output.stdout);assert.ok(html.includes('data-result="PASS"'),html);
    } finally {await server.shutdown();await Deno.remove(dir,{recursive:true});}
});
