// Shared window movement. Delegation also covers panels mounted later by Vue.
// Zoom owns its position in reactive state and retains its existing drag handler.
export function f_install_overlay_windows(o_document = document) {
    const o_window = o_document.defaultView;
    const s_control = 'button, input, select, textarea, a, label, summary, [role="button"], [contenteditable]:not([contenteditable="false"])';
    let o_drag = null;
    let el_active = null;

    function f_place(el_panel, n_x, n_y) {
        const o_rect = el_panel.getBoundingClientRect();
        const el_header = el_panel.querySelector('.panel-header');
        const n_header = el_header?.getBoundingClientRect().height || 48;
        const n_top = Math.min(
            parseFloat(o_window.getComputedStyle(o_document.documentElement).getPropertyValue('--topbar-h')) || 0,
            Math.max(0, o_window.innerHeight - n_header),
        );
        // Keep the whole window visible when it fits; tall panels retain a
        // reachable header and their existing internal scrolling.
        const n_max_y = Math.max(n_top, o_window.innerHeight - Math.min(o_rect.height, o_window.innerHeight - n_top));
        el_panel.style.setProperty('--panel-x', Math.min(Math.max(0, n_x), Math.max(0, o_window.innerWidth - o_rect.width)) + 'px');
        el_panel.style.setProperty('--panel-y', Math.min(Math.max(n_top, n_y), n_max_y) + 'px');
        el_panel.dataset.panelMoved = '';
    }

    function f_stop(o_evt) {
        if (!o_drag || (o_evt?.pointerId !== undefined && o_evt.pointerId !== o_drag.n_id)) return;
        const { el_header, el_panel, n_id } = o_drag;
        o_drag = null;
        delete el_panel.dataset.panelDragging;
        if (el_header.hasPointerCapture(n_id)) el_header.releasePointerCapture(n_id);
    }

    function f_down(o_evt) {
        const el_panel = o_evt.target.closest?.('.overlay-panel');
        if (!el_panel || o_evt.button !== 0 || o_evt.isPrimary === false || o_drag) return;
        if (el_active) delete el_active.dataset.panelActive;
        el_active = el_panel;
        el_panel.dataset.panelActive = '';
        const el_header = o_evt.target.closest('.panel-header');
        if (!el_header || el_header.closest('.overlay-panel') !== el_panel
            || el_panel.classList.contains('panel-zoom') || o_evt.target.closest(s_control)) return;
        const o_rect = el_panel.getBoundingClientRect();
        o_drag = {
            el_panel, el_header, n_id: o_evt.pointerId,
            n_offset_x: o_evt.clientX - o_rect.left,
            n_offset_y: o_evt.clientY - o_rect.top,
        };
        f_place(el_panel, o_rect.left, o_rect.top);
        el_panel.dataset.panelDragging = '';
        el_header.setPointerCapture(o_evt.pointerId);
        o_evt.preventDefault();
        o_evt.stopPropagation();
    }

    function f_move(o_evt) {
        if (!o_drag || o_evt.pointerId !== o_drag.n_id) return;
        if (!o_drag.el_panel.isConnected || !o_drag.el_panel.classList.contains('visible')) {
            f_stop();
            return;
        }
        f_place(o_drag.el_panel, o_evt.clientX - o_drag.n_offset_x, o_evt.clientY - o_drag.n_offset_y);
        o_evt.preventDefault();
        o_evt.stopPropagation();
    }

    function f_clamp(el_panel) {
        if (!el_panel.matches('.overlay-panel.visible[data-panel-moved]')) return;
        const o_rect = el_panel.getBoundingClientRect();
        f_place(el_panel, o_rect.left, o_rect.top);
    }
    function f_resize() {
        o_document.querySelectorAll('.overlay-panel[data-panel-moved]').forEach(f_clamp);
    }
    const o_observer = new o_window.MutationObserver(a_o_record => {
        // Reopening a window after a viewport change must keep it reachable.
        for (const o_record of a_o_record) f_clamp(o_record.target);
        if (o_drag && !o_drag.el_panel.classList.contains('visible')) f_stop();
    });
    o_observer.observe(o_document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    o_document.addEventListener('pointerdown', f_down, true);
    o_document.addEventListener('pointermove', f_move, true);
    o_document.addEventListener('pointerup', f_stop, true);
    o_document.addEventListener('pointercancel', f_stop, true);
    o_document.addEventListener('lostpointercapture', f_stop, true);
    o_window.addEventListener('blur', f_stop);
    o_window.addEventListener('resize', f_resize);
    o_window.addEventListener('toolbar-resize', f_resize);
    return function() {
        f_stop();
        o_observer.disconnect();
        if (el_active) delete el_active.dataset.panelActive;
        o_document.removeEventListener('pointerdown', f_down, true);
        o_document.removeEventListener('pointermove', f_move, true);
        o_document.removeEventListener('pointerup', f_stop, true);
        o_document.removeEventListener('pointercancel', f_stop, true);
        o_document.removeEventListener('lostpointercapture', f_stop, true);
        o_window.removeEventListener('blur', f_stop);
        o_window.removeEventListener('resize', f_resize);
        o_window.removeEventListener('toolbar-resize', f_resize);
    };
}
