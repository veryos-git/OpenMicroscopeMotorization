import assert from 'node:assert/strict';
import { f_a_stack_plane } from '../webserved_dir/focus_stack_plan.module.js';
const source = (await Deno.readTextFile(new URL('../webserved_dir/o_component__focus_stack.js', import.meta.url)))
    .replace(/^import .*;\n/gm, '').replace(/export \{[^}]+\};?/, '');

function fixture(move, timer = setTimeout) {
    const state = { b_connected__esp:true, b_streaming__webcam:true, b_scanning:false,
        o_motor__axis:{z:1}, a_o_motor:[{n_position:0},{n_position:0}], a_o_setting:[] };
    const captured=[], requests=[], stopped=[];
    const bindings = {
        o_state:state, f_n_motor__axis:()=>state.o_motor__axis.z, f_a_stack_plane,
        f_send_esp_move_step:move || (async (motor,delta)=>state.a_o_motor[motor].n_position+delta),
        f_send_esp_stop:motor=>stopped.push(motor), f_o_wsmsg:(s_type,v_data)=>({s_type,v_data}),
        f_send_wsmsg_with_response:async msg=> {requests.push(msg);return {v_result:msg.s_type==='focus_stack_create_folder'
            ? {s_path_folder:'/stack'} : {b_success:true,s_path_output:'/stack/result.png',n_cnt__image:captured.length}};},
        f_o_capture__frame:async()=>({o_blob:new Blob()}),
        f_save_image:async()=>captured.push(state.a_o_motor[1].n_position),
        f_save_setting__debounced(){}, setInterval:()=>0,
        setTimeout: timer,
    };
    const component = new Function(...Object.keys(bindings),source+'\nreturn o_component__focus_stack;')(...Object.values(bindings));
    const vm = {...component.data(),...component.methods};
    for (const [name,get] of Object.entries(component.computed)) Object.defineProperty(vm,name,{get:()=>get.call(vm)});
    vm.f_delay=async()=>{};
    vm.f_o_focus=()=>{throw Error('Easy mode must not autofocus');};
    return {vm,state,captured,requests,stopped};
}

Deno.test('easy focus stack plans include endpoints, support descending ranges, and reject duplicate depths',()=>{
    assert.deepEqual(f_a_stack_plane(10,35,4),[10,18,27,35]);
    assert.deepEqual(f_a_stack_plane(35,10,4),[35,27,18,10]);
    for (const args of [[null,10,2],[10,10,2],[10,11,3],[0,200,201],[0,20,2.5]]) assert.throws(()=>f_a_stack_plane(...args));
});
Deno.test('easy mode captures selected endpoints using defaults, independent of expert values',async()=>{
    for (const endpoints of [[10,35],[35,10]]) {
        const {vm,state,captured,requests}=fixture();
        assert.equal(vm.o_config.s_mode,'easy');assert.equal(vm.b_ready,false);
        state.a_o_motor[1].n_position=endpoints[0];vm.f_set_focus(1);
        state.a_o_motor[1].n_position=endpoints[1];vm.f_set_focus(2);
        Object.assign(vm.o_config,{n_its:4,n_step:999,n_ms__settle:0,b_align:false,n_dim__max:64});
        const settles=[];vm.f_delay=async ms=>settles.push(ms);
        assert.equal(vm.b_ready,true);await vm.f_run();
        assert.deepEqual(captured,f_a_stack_plane(...endpoints,4));
        assert.deepEqual(settles,[350,350,350,350]);
        assert.equal(requests.at(-1).v_data.b_no_align,false);assert.equal(requests.at(-1).v_data.n_dim__max,0);
        assert.equal(state.a_o_motor[1].n_position,endpoints[1]);assert.equal(state.b_scanning,false);assert.equal(vm.b_running,false);
    }
});
Deno.test('expert mode retains autofocus centering and adjustable capture/stack options',async()=>{
    const {vm,state,captured,requests}=fixture();
    Object.assign(vm.o_config,{s_mode:'expert',n_its:4,n_step:10,n_ms__settle:0,b_align:false,n_dim__max:64});
    vm.f_o_focus=async()=>{state.a_o_motor[1].n_position=100;};
    await vm.f_run();assert.deepEqual(captured,[90,100,110,120]);
    assert.equal(requests.at(-1).v_data.b_no_align,true);assert.equal(requests.at(-1).v_data.n_dim__max,64);
});
Deno.test('stopping during settle and incomplete motion prevent extra focus captures and stacking',async()=>{
    for (const kind of ['stop','incomplete','disconnect']) {
        const {vm,state,captured,requests}=fixture(kind==='incomplete'?async()=>9:undefined);
        vm.a_n_focus=[10,20];vm.o_config.n_its=3;
        if(kind==='stop') vm.f_delay=async()=>vm.f_stop();
        if(kind==='disconnect') vm.f_delay=async()=>{state.b_connected__esp=false;};
        await vm.f_run();assert.equal(captured.length,0);assert.equal(requests.length,1);
        assert.equal(vm.b_running,false);assert.equal(state.b_scanning,false);
        if(kind!=='stop') assert.ok(vm.s_error);
    }
});
Deno.test('focus move timeout stops its assigned motor and aborts capture',async()=>{
    const {vm,captured,requests,stopped}=fixture(()=>new Promise(()=>{}),callback=>setTimeout(callback,0));
    vm.a_n_focus=[10,20];vm.o_config.n_its=3;
    await vm.f_run();
    assert.deepEqual(stopped,[1]);assert.equal(captured.length,0);assert.equal(requests.length,1);
    assert.match(vm.s_error,/timed out/);assert.equal(vm.b_running,false);
});
