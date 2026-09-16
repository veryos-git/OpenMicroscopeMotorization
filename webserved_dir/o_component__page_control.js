import { o_state, f_connect_esp__auto } from './index.js';

let o_component__page_control = {
    name: 'page-control',
    template: `
        <o_component__webcam />
        <o_component__filter />
        <o_component__flat_field />
        <o_component__calibration />
        <o_component__scale />
        <o_component__toolbar />
        <o_component__jog />
        <o_component__map />
        <o_component__motion />
        <o_component__optics />
        <o_component__motor />
        <o_component__stats />
        <o_component__scan />
        <o_component__camera_setting />
        <o_component__manual_stitch />
        <o_component__macro />
        <o_component__auto_move />
        <o_component__autostitch />
        <o_component__focus />
        <o_component__focus_stack />
        <o_component__backlash />
        <o_component__slide_library />
    `,
    data: function() {
        return {
            o_state: o_state,
        };
    },
    mounted: function() {
        if (!o_state.b_connected__esp) {
            f_connect_esp__auto();
        }
    },
};

export { o_component__page_control };
