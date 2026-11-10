// One immediate tooltip for pointer and keyboard users, kept inside the viewport.
// Sources: data-tooltip (preferred) or a plain title attribute. A first line
// followed by a line break is shown as the heading of the tooltip.
export function f_install_tooltips(o_document = document) {
    const o_window = o_document.defaultView;
    const el_tip = o_document.createElement('div');
    el_tip.className = 'ui-tooltip';
    el_tip.id = 'omm-ui-tooltip';
    el_tip.setAttribute('role', 'tooltip');
    el_tip.hidden = true;
    o_document.body.append(el_tip);
    let el_owner;
    let el_source;
    let s_description;
    let s_title__stashed = null;
    function f_hide() {
        if (el_owner) {
            if (s_description === null) el_owner.removeAttribute('aria-describedby');
            else el_owner.setAttribute('aria-describedby', s_description);
        }
        // Give the native title back unless the owner set a new one meanwhile.
        if (el_source && s_title__stashed !== null && !el_source.hasAttribute('title')) el_source.setAttribute('title', s_title__stashed);
        s_title__stashed = null;
        el_source = null;
        el_owner = null;
        el_tip.hidden = true;
    }
    function f_render(s_text) {
        const a_s_line = s_text.split('\n').map(s_line => s_line.trim()).filter(Boolean);
        el_tip.replaceChildren();
        if (a_s_line.length > 1) {
            const el_heading = o_document.createElement('b');
            el_heading.textContent = a_s_line.shift();
            el_tip.append(el_heading);
        }
        const el_text = o_document.createElement('span');
        el_text.textContent = a_s_line.join('\n');
        el_tip.append(el_text);
    }
    function f_show(event) {
        const el = event.target.closest?.('[data-tooltip], [title]');
        const s_text = el?.dataset.tooltip || el?.getAttribute('title');
        if (!s_text || el.closest('svg')) return f_hide();
        if (el === el_source && !el_tip.hidden) return;
        f_hide();
        el_source = el;
        // The styled tooltip replaces the delayed native one while it is shown.
        if (el.hasAttribute('title')) {
            s_title__stashed = el.getAttribute('title');
            el.removeAttribute('title');
        }
        el_owner = event.target.closest('button, input, select, textarea') || el;
        s_description = el_owner.getAttribute('aria-describedby');
        el_owner.setAttribute('aria-describedby', [s_description, el_tip.id].filter(Boolean).join(' '));
        f_render(s_text);
        el_tip.hidden = false;
        const rect = el.getBoundingClientRect();
        const tip = el_tip.getBoundingClientRect();
        el_tip.style.left = Math.max(8, Math.min(rect.left, o_window.innerWidth - tip.width - 8)) + 'px';
        el_tip.style.top = Math.max(8, rect.bottom + tip.height + 8 <= o_window.innerHeight
            ? rect.bottom + 8 : rect.top - tip.height - 8) + 'px';
    }
    function f_leave(event) {
        if (!el_source?.contains(event.relatedTarget) && !el_owner?.contains(event.relatedTarget)) f_hide();
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
