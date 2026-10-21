// One immediate tooltip for pointer and keyboard users, kept inside the viewport.
export function f_install_tooltips(o_document = document) {
    const o_window = o_document.defaultView;
    const el_tip = o_document.createElement('div');
    el_tip.className = 'ui-tooltip';
    el_tip.id = 'omm-ui-tooltip';
    el_tip.setAttribute('role', 'tooltip');
    el_tip.hidden = true;
    o_document.body.append(el_tip);
    let el_owner;
    let s_description;
    function f_hide() {
        if (el_owner) {
            if (s_description === null) el_owner.removeAttribute('aria-describedby');
            else el_owner.setAttribute('aria-describedby', s_description);
        }
        el_owner = null;
        el_tip.hidden = true;
    }
    function f_show(event) {
        const el = event.target.closest?.('[data-tooltip]');
        if (!el?.dataset.tooltip) return f_hide();
        f_hide();
        el_owner = event.target.closest('button, input, select, textarea') || el;
        s_description = el_owner.getAttribute('aria-describedby');
        el_owner.setAttribute('aria-describedby', [s_description, el_tip.id].filter(Boolean).join(' '));
        el_tip.textContent = el.dataset.tooltip;
        el_tip.hidden = false;
        const rect = el.getBoundingClientRect();
        const tip = el_tip.getBoundingClientRect();
        el_tip.style.left = Math.max(8, Math.min(rect.left, o_window.innerWidth - tip.width - 8)) + 'px';
        el_tip.style.top = Math.max(8, rect.bottom + tip.height + 8 <= o_window.innerHeight
            ? rect.bottom + 8 : rect.top - tip.height - 8) + 'px';
    }
    function f_leave(event) {
        if (!el_owner?.contains(event.relatedTarget)) f_hide();
    }
    const events = { pointerover: f_show, focusin: f_show, pointerout: f_leave, focusout: f_leave,
        pointerdown: f_hide, pointercancel: f_hide, click: f_hide, contextmenu: f_hide, keydown: f_hide, scroll: f_hide };
    for (const [name, handler] of Object.entries(events)) o_document.addEventListener(name, handler, true);
    o_window.addEventListener('resize', f_hide);
    return () => {
        f_hide();
        el_tip.remove();
        for (const [name, handler] of Object.entries(events)) o_document.removeEventListener(name, handler, true);
        o_window.removeEventListener('resize', f_hide);
    };
}
