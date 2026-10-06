import assert from 'node:assert/strict';

Deno.test('exposure UI renders raw histogram, independent warnings and both patterns in WebGL', async () => {
    const dir = await Deno.makeTempDir();
    const js = text => new Response(text, { headers: { 'content-type': 'text/javascript' } });
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
        const path = new URL(request.url).pathname;
        if (path === '/index.js') return js(`
            import {reactive} from './lib/vue.esm-browser.js';
            export const saved=[];
            export const o_state=reactive({o_filter:{},o_panel_visibility:{filter:true},
                b_streaming__webcam:true,o_flat_field:{b_active:false}});
            export function f_save_setting__debounced(key,value){saved.push({key,value:JSON.parse(JSON.stringify(value))});}
        `);
        if (path === '/o_flatfield.module.js') return js('export const f_b_flat__loaded=()=>false; export const f_o_flat=()=>null; export const f_b_flat__matches=()=>false; export const f_flat__apply=()=>{};');
        if (path === '/') return new Response(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/index.css"><div id="app"></div><video id="webcamVideo" autoplay muted></video>
            <script type="module">
            import {createApp,nextTick} from './lib/vue.esm-browser.js';
            import {o_component__filter,f_o_filter__default} from './o_component__filter.js';
            import {o_state,saved} from './index.js';
            import {f_o_capture__frame} from './o_capture.module.js';
            const assert=(ok,message)=>{if(!ok)throw Error(message);};
            const pause=()=>new Promise(r=>setTimeout(r,30));
            let stream,app;
            try {
                const source=document.createElement('canvas');source.width=96;source.height=64;
                const ctx=source.getContext('2d');
                for (const [i,color] of ['#000','#f00','#808080','#fff'].entries()) {ctx.fillStyle=color;ctx.fillRect(i*24,0,24,64);}
                stream=source.captureStream(10);const video=document.getElementById('webcamVideo');video.srcObject=stream;
                await video.play();
                Object.assign(o_state.o_filter,f_o_filter__default());
                app=createApp(o_component__filter);const vm=app.mount('#app');
                while(!video.videoWidth) await pause();
                vm.f_histogram(1000);await nextTick();
                assert(vm.o_histogram?.n_pixels===96*64,'Raw histogram missing');
                assert(Math.abs(vm.o_histogram.n_pct_high-50)<3,'Histogram must detect clipped red and white');
                assert(Math.abs(vm.o_histogram.n_pct_low-25)<2,'Dark histogram percentage');
                assert(document.querySelectorAll('.exposure-histogram path').length===4,'Luminance and RGB curves missing');
                assert(!vm.b_visible__canvas,'Histogram must work with processing off');
                o_state.o_filter.n_brightness=.5;
                o_state.o_filter.b_exposure__high=true;o_state.o_filter.b_exposure__low=true;
                vm.f_on_change();await nextTick();vm.f_render();
                assert(!vm.s_error,vm.s_error);
                const gl=vm._o_gl;assert(gl,'WebGL did not initialize');
                const read=()=>{const a=new Uint8Array(96*64*4);gl.readPixels(0,0,96,64,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;};
                const zebra=read();
                let blue=0,red=0,gray=0;
                for(let y=0;y<64;y++) for(let x=0;x<96;x++) {
                    const i=(y*96+x)*4;
                    if(x<24 && zebra[i+2]>200 && zebra[i]<80) blue++;
                    if(x>=24 && x<48 && zebra[i]>200 && zebra[i+1]>20 && zebra[i+2]>30) red++;
                    if(x>=48 && x<72 && Math.abs(zebra[i]-128)<5) gray++;
                }
                assert(blue>100,'Blue shadow stripes absent');assert(red>100,'Red clipping stripes absent');
                assert(gray>1000,'Processing-off warnings changed midtone pixels');
                const select=document.querySelector('#exposure-pattern');select.value='checkerboard';select.dispatchEvent(new Event('change',{bubbles:true}));
                await nextTick();vm.f_render();const checker=read();
                assert(checker.some((n,i)=>n!==zebra[i]),'Pattern selection did not change rendering');
                assert(saved.at(-1).value.s_exposure__pattern==='checkerboard','Pattern not persisted');
                o_state.o_filter.b_enabled=true;o_state.o_filter.n_brightness=-.5;vm.f_render();
                const filtered=read();assert(filtered.some((n,i)=>n!==checker[i]),'Tonal processing is not active');
                for(let y=0;y<64;y++) for(let x=0;x<46;x++) {if(x>=22 && x<26) continue;const i=(y*96+x)*4;assert(filtered[i]===checker[i] && filtered[i+2]===checker[i+2],'Warnings must classify raw pixels');}
                const capture=await f_o_capture__frame({b_flat:false,b_flash:false});
                const bitmap=await createImageBitmap(capture.o_blob);const raw=document.createElement('canvas');raw.width=96;raw.height=64;
                const rawCtx=raw.getContext('2d');rawCtx.drawImage(bitmap,0,0);bitmap.close();
                const rawPixels=rawCtx.getImageData(0,0,96,64).data;
                for(let y=0;y<64;y++) for(let x=0;x<20;x++) {const i=(y*96+x)*4;assert(rawPixels[i]<5 && rawPixels[i+2]<5,'Exposure markers leaked into raw capture');}
                vm.f_reset();await nextTick();assert(!o_state.o_filter.b_exposure__high && !o_state.o_filter.b_exposure__low,'Reset left markers enabled');
                o_state.b_streaming__webcam=false;vm.f_histogram(2000);assert(vm.o_histogram===null && !vm.b_visible__canvas,'Stopped camera retained stale diagnostics');
                document.body.dataset.result='PASS';
            } catch(error) {document.body.dataset.result='FAIL';document.body.textContent=error.stack;}
            finally {app?.unmount();stream?.getTracks().forEach(t=>t.stop());}
            </script>`, { headers: { 'content-type': 'text/html' } });
        try {
            return new Response(await Deno.readFile(new URL('../webserved_dir' + path, import.meta.url)), {
                headers: { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' },
            });
        } catch { return new Response('', { status: 404 }); }
    });
    try {
        const result = await new Deno.Command('/usr/bin/google-chrome', { args: [
            '--headless','--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required',
            '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
            '--user-data-dir='+dir,'--virtual-time-budget=10000','--dump-dom',
            'http://127.0.0.1:'+server.addr.port,
        ], stdout:'piped',stderr:'piped' }).output();
        const html=new TextDecoder().decode(result.stdout);
        assert.ok(html.includes('data-result="PASS"'),html+'\n'+new TextDecoder().decode(result.stderr).slice(-1800));
    } finally {await server.shutdown();await Deno.remove(dir,{recursive:true});}
});
