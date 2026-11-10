import { o_component__icon } from './o_component__icon.js';

// Pictogram tab strip. A large window gives each of its functions one pane, so
// nothing has to scroll. Panes stay mounted (v-show + data-cockpit-pane) so the
// action search can still reach every control and switch to its pane.
//
// a_o_tab: [{ s_id, s_icon, s_label, s_tooltip, s_badge, b_running, b_disabled }]
let o_component__tab = {
    name: 'component-tab',
    components: { ui_icon: o_component__icon },
    props: {
        a_o_tab: { type: Array, required: true },
        s_tab: { type: String, required: true },
    },
    emits: ['update:s_tab'],
    methods: {
        f_select: function(o_tab) {
            if (o_tab && !o_tab.b_disabled) this.$emit('update:s_tab', o_tab.s_id);
        },
        f_step: function(o_evt, n_direction) {
            let a_o_tab__enabled = this.a_o_tab.filter(function(o_tab) { return !o_tab.b_disabled; });
            let n_idx = a_o_tab__enabled.findIndex((o_tab) => o_tab.s_id === this.s_tab);
            let o_tab__next = a_o_tab__enabled[(n_idx + n_direction + a_o_tab__enabled.length) % a_o_tab__enabled.length];
            this.f_select(o_tab__next);
            this.$nextTick(function() { o_evt.currentTarget?.querySelector('[aria-selected="true"]')?.focus(); });
        },
    },
    template: `
        <div class="cockpit-tab-strip" role="tablist" @keydown.left.prevent="f_step($event, -1)" @keydown.right.prevent="f_step($event, 1)">
            <button v-for="o_tab in a_o_tab" :key="o_tab.s_id" type="button" role="tab" data-control-skip
                class="cockpit-tab" :class="{ active: o_tab.s_id === s_tab, running: o_tab.b_running }"
                :data-tab="o_tab.s_id" :aria-selected="o_tab.s_id === s_tab" :tabindex="o_tab.s_id === s_tab ? 0 : -1"
                :disabled="o_tab.b_disabled" :aria-label="o_tab.s_label" :data-tooltip="o_tab.s_tooltip || o_tab.s_label"
                @click="f_select(o_tab)">
                <ui_icon :s_name="o_tab.s_icon" /><span class="cockpit-tab-label">{{ o_tab.s_label }}</span><b v-if="o_tab.s_badge" class="cockpit-tab-badge">{{ o_tab.s_badge }}</b>
            </button>
        </div>
    `,
};

export { o_component__tab };
