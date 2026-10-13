// Effects with a meaningful neutral value use that value rather than session
// history, including when restored from saved settings at startup.
export function f_a_control_effects(state, defaults, save, saveFlat) {
    const labels = {
        b_enabled: ['Image processing', 'filter'], s_kernel: ['Kernel', 'filter'],
        n_edge_gain: ['Edge gain', 'filter'], b_binary__edge: ['Black / white edges', 'contrast'],
        n_brightness: ['Brightness', 'brightness'], n_contrast: ['Contrast', 'contrast'],
        n_gamma: ['Gamma', 'gamma'], n_saturation: ['Saturation', 'color'],
        b_grayscale: ['Grayscale', 'contrast'], b_invert: ['Invert', 'invert'],
        s_colormap: ['False color', 'color'], b_histogram: ['Live histogram', 'stats'],
        b_exposure__high: ['Overexposed pixels', 'brightness'], b_exposure__low: ['Underexposed pixels', 'contrast'],
        n_exposure__high: ['Bright pixel threshold', 'brightness'], n_exposure__low: ['Dark pixel threshold', 'contrast'],
        s_exposure__pattern: ['Exposure pattern', 'filter'],
    };
    const effects = Object.entries(defaults).map(([key, before]) => ({
        id: 'filter.' + key, name: labels[key][0], icon: labels[key][1], before,
        read: () => state.o_filter[key],
        reset() {
            state.o_filter[key] = before;
            // Thresholds share a valid interval. Keep the other threshold valid.
            if (key === 'n_exposure__low' && state.o_filter.n_exposure__high <= before) state.o_filter.n_exposure__high = before + 1;
            if (key === 'n_exposure__high' && state.o_filter.n_exposure__low >= before) state.o_filter.n_exposure__low = before - 1;
            save('o_filter', state.o_filter);
        },
    }));
    effects.push({ id: 'flat.enabled', name: 'Flat field correction', icon: 'flat', before: false,
        read: () => state.o_flat_field.b_active,
        reset() { state.o_flat_field.b_active = false; saveFlat(); },
    }, { id: 'motion.enabled', name: 'Motion detection', icon: 'detection', before: false,
        read: () => state.o_motion_detection.b_enabled,
        reset() { state.o_motion_detection.b_enabled = false; save('o_motion_detection', state.o_motion_detection); },
    });
    return effects;
}
