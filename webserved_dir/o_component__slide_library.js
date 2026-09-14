import {
    o_state,
    f_send_wsmsg_with_response,
    f_save_setting__debounced,
    f_save_library_current,
    f_send_esp_move_step,
} from './index.js';
import {
    f_o_wsmsg,
    o_sfunexposed__f_v_crud__indb,
} from './constructors.module.js';

// Slide library panel: list projects → list slides, create and name them, and
// save/restore the per-slide stage position. The DB tables (a_o_project /
// a_o_slide / a_o_map) are broadcast by the server on connect and mirrored into
// o_state, so this component only needs the generic CRUD endpoint for writes.

let o_component__slide_library = {
    name: 'component-slide-library',
    template: `
        <div class="overlay-panel panel-slide-library" :class="{ visible: o_state.o_panel_visibility.slide_library }">
            <div class="panel-header">
                <h2>Slide Library</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">

                <div class="live-row">
                    <span class="live-label">current slide</span>
                    <span class="slide-lib-current">{{ s_name__slide__current || '—' }}</span>
                </div>

                <div class="live-row" v-if="o_slide__current">
                    <span class="live-label">map</span>
                    <span class="slide-lib-current" :title="o_map__primary ? o_map__primary.s_path_map : ''">{{ s_map__label }}</span>
                </div>

                <div class="live-row" v-if="o_slide__current">
                    <span class="live-label">stage pos</span>
                    <span class="slide-lib-current">{{ s_stage_position__label }}</span>
                </div>
                <div class="slide-lib-new" v-if="o_slide__current">
                    <button class="btn-small" @click="f_save_position" :disabled="!o_state.b_connected__esp">save pos</button>
                    <button class="btn-small" @click="f_go_to_position" :disabled="!b_stage_position__saved || !o_state.b_connected__esp">go to</button>
                </div>

                <div class="live-label">project</div>
                <div class="slide-lib-list">
                    <div
                        class="slide-lib-item"
                        :class="{ active: n_id__project__current === o_project.n_id }"
                        v-for="o_project in a_o_project"
                        :key="o_project.n_id"
                        @click="f_select_project(o_project)"
                    >
                        <span class="slide-lib-name">{{ o_project.s_name }}</span>
                        <button class="btn-small" @click.stop="f_delete_project(o_project)">del</button>
                    </div>
                    <div class="map-select-empty" v-if="!a_o_project.length">no projects yet</div>
                </div>
                <div class="slide-lib-new">
                    <input
                        class="slide-lib-input"
                        type="text"
                        v-model="s_name__project__new"
                        placeholder="new project name"
                        @keyup.enter="f_create_project"
                    />
                    <button class="btn-small" @click="f_create_project" :disabled="!s_name__project__new.trim()">+ project</button>
                </div>

                <div class="live-label" style="margin-top:12px;">slide</div>
                <div class="live-note" v-if="!n_id__project__current">select or create a project first</div>
                <template v-else>
                    <div class="slide-lib-list">
                        <div
                            class="slide-lib-item"
                            :class="{ active: n_id__slide__current === o_slide.n_id }"
                            v-for="o_slide in a_o_slide__project"
                            :key="o_slide.n_id"
                            @click="f_select_slide(o_slide)"
                        >
                            <span class="slide-lib-name">{{ o_slide.s_name }}</span>
                            <button class="btn-small" @click.stop="f_delete_slide(o_slide)">del</button>
                        </div>
                        <div class="map-select-empty" v-if="!a_o_slide__project.length">no slides in this project</div>
                    </div>
                    <div class="slide-lib-new">
                        <input
                            class="slide-lib-input"
                            type="text"
                            v-model="s_name__slide__new"
                            placeholder="slide name (e.g. honey bee leg)"
                            @keyup.enter="f_create_slide"
                        />
                        <button class="btn-small" @click="f_create_slide" :disabled="!s_name__slide__new.trim()">+ slide</button>
                    </div>
                </template>

            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            s_name__project__new: '',
            s_name__slide__new: '',
        };
    },
    computed: {
        n_id__project__current: function() { return o_state.n_id__project__current; },
        n_id__slide__current: function() { return o_state.n_id__slide__current; },
        a_o_project: function() { return o_state.a_o_project || []; },
        a_o_slide__project: function() {
            let n_id__project = o_state.n_id__project__current;
            return (o_state.a_o_slide || []).filter(function(o_slide) {
                return o_slide.n_o_project_n_id === n_id__project;
            });
        },
        o_slide__current: function() {
            return (o_state.a_o_slide || []).find(function(o_slide) {
                return o_slide.n_id === o_state.n_id__slide__current;
            }) || null;
        },
        o_map__primary: function() {
            let o_slide = this.o_slide__current;
            if(!o_slide) return null;
            return (o_state.a_o_map || []).find(function(o_map) {
                return o_map.n_o_slide_n_id === o_slide.n_id && o_map.b_primary;
            }) || null;
        },
        s_name__slide__current: function() {
            return this.o_slide__current ? this.o_slide__current.s_name : '';
        },
        b_stage_position__saved: function() {
            let o_slide = this.o_slide__current;
            if(!o_slide) return false;
            return typeof o_slide.n_x__stage === 'number'
                || typeof o_slide.n_y__stage === 'number'
                || typeof o_slide.n_z__stage === 'number';
        },
        s_stage_position__label: function() {
            let o_slide = this.o_slide__current;
            if(!o_slide || !this.b_stage_position__saved) return 'not saved';
            let f_fmt = function(n) { return typeof n === 'number' ? Math.round(n) : '—'; };
            return [f_fmt(o_slide.n_x__stage), f_fmt(o_slide.n_y__stage), f_fmt(o_slide.n_z__stage)].join(' / ');
        },
        s_map__label: function() {
            let o_map = this.o_map__primary;
            if(!o_map) return 'no map linked';
            return (o_map.s_kind || 'map') + ' · ' + (o_map.s_path_map || '');
        },
    },
    methods: {
        f_close: function() {
            o_state.o_panel_visibility.slide_library = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_select_project: function(o_project) {
            o_state.n_id__project__current = o_project.n_id;
            // if the current slide is not in this project, clear it
            let b_slide__in_project = (o_state.a_o_slide || []).some(function(o_slide) {
                return o_slide.n_id === o_state.n_id__slide__current
                    && o_slide.n_o_project_n_id === o_project.n_id;
            });
            if(!b_slide__in_project) o_state.n_id__slide__current = 0;
            f_save_library_current();
        },
        f_select_slide: function(o_slide) {
            o_state.n_id__slide__current = o_slide.n_id;
            f_save_library_current();
        },
        f_create_project: async function() {
            let s_name = this.s_name__project__new.trim();
            if(!s_name) return;
            let o_resp = await f_send_wsmsg_with_response(
                f_o_wsmsg(o_sfunexposed__f_v_crud__indb.s_name,
                    ['create', 'a_o_project', { s_name: s_name, s_note: '' }]
                )
            );
            if(o_resp.v_result){
                o_state.a_o_project.push(o_resp.v_result);
                this.s_name__project__new = '';
                this.f_select_project(o_resp.v_result);
            }
        },
        f_create_slide: async function() {
            let s_name = this.s_name__slide__new.trim();
            let n_id__project = o_state.n_id__project__current;
            if(!s_name || !n_id__project) return;
            let o_resp = await f_send_wsmsg_with_response(
                f_o_wsmsg(o_sfunexposed__f_v_crud__indb.s_name,
                    ['create', 'a_o_slide', { n_o_project_n_id: n_id__project, s_name: s_name, s_note: '' }]
                )
            );
            if(o_resp.v_result){
                o_state.a_o_slide.push(o_resp.v_result);
                this.s_name__slide__new = '';
                o_state.n_id__slide__current = o_resp.v_result.n_id;
                f_save_library_current();
            }
        },
        f_save_position: async function() {
            let o_slide = this.o_slide__current;
            if(!o_slide) return;
            let o_update = {
                n_x__stage: o_state.a_o_motor[0] ? o_state.a_o_motor[0].n_position : 0,
                n_y__stage: o_state.a_o_motor[1] ? o_state.a_o_motor[1].n_position : 0,
                n_z__stage: o_state.a_o_motor[2] ? o_state.a_o_motor[2].n_position : 0,
            };
            let o_resp = await f_send_wsmsg_with_response(
                f_o_wsmsg(o_sfunexposed__f_v_crud__indb.s_name,
                    ['update', 'a_o_slide', o_slide, o_update]
                )
            );
            if(o_resp.v_result){
                let n_idx = o_state.a_o_slide.findIndex(function(o) { return o.n_id === o_slide.n_id; });
                if(n_idx !== -1) o_state.a_o_slide[n_idx] = o_resp.v_result;
            }
        },
        f_go_to_position: async function() {
            let o_slide = this.o_slide__current;
            if(!o_slide) return;
            let a_n_target = [o_slide.n_x__stage, o_slide.n_y__stage, o_slide.n_z__stage];
            for(let n_motor = 0; n_motor < 3; n_motor++){
                let n_target = a_n_target[n_motor];
                if(typeof n_target !== 'number') continue;
                let o_motor = o_state.a_o_motor[n_motor];
                let n_current = o_motor ? o_motor.n_position : 0;
                let n_delta = Math.round(n_target - n_current);
                if(n_delta === 0) continue;
                await f_send_esp_move_step(n_motor, n_delta, o_state.n_rpm__jog || 5);
            }
        },
        f_delete_project: async function(o_project) {
            if(!confirm('delete project "' + o_project.s_name + '" and all its slides?')) return;
            // delete the project's slides first, then the project.
            // (maps/markers cascade will be added when those tables are populated.)
            let a_o_slide = (o_state.a_o_slide || []).filter(function(o_slide) {
                return o_slide.n_o_project_n_id === o_project.n_id;
            });
            for(let o_slide of a_o_slide){
                await f_send_wsmsg_with_response(
                    f_o_wsmsg(o_sfunexposed__f_v_crud__indb.s_name, ['delete', 'a_o_slide', o_slide])
                );
            }
            let o_resp = await f_send_wsmsg_with_response(
                f_o_wsmsg(o_sfunexposed__f_v_crud__indb.s_name, ['delete', 'a_o_project', o_project])
            );
            if(o_resp.v_result){
                o_state.a_o_project = o_state.a_o_project.filter(function(o) { return o.n_id !== o_project.n_id; });
                o_state.a_o_slide = o_state.a_o_slide.filter(function(o) { return o.n_o_project_n_id !== o_project.n_id; });
                if(o_state.n_id__project__current === o_project.n_id){
                    o_state.n_id__project__current = 0;
                    o_state.n_id__slide__current = 0;
                    f_save_library_current();
                }
            }
        },
        f_delete_slide: async function(o_slide) {
            if(!confirm('delete slide "' + o_slide.s_name + '"?')) return;
            let o_resp = await f_send_wsmsg_with_response(
                f_o_wsmsg(o_sfunexposed__f_v_crud__indb.s_name, ['delete', 'a_o_slide', o_slide])
            );
            if(o_resp.v_result){
                o_state.a_o_slide = o_state.a_o_slide.filter(function(o) { return o.n_id !== o_slide.n_id; });
                if(o_state.n_id__slide__current === o_slide.n_id){
                    o_state.n_id__slide__current = 0;
                    f_save_library_current();
                }
            }
        },
    },
};

export { o_component__slide_library };
