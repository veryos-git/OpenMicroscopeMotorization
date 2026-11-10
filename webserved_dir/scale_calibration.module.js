// Size on the camera image: calibration (two points a known distance apart give
// the size of one camera pixel), measuring, and size references drawn over the
// live image. Kept independent of Vue and the DOM so the numbers can be tested alone.

// a shorter line is a mis-click, not a measurement
let N_PX__LINE_MIN = 10;

// ── settings ─────────────────────────────────────────────────────────

let f_o_size__default = function() {
    return {
        // calibrate: the known distance is remembered (default: one cell of a 0.1 mm grid slide)
        n_known: 0.1,
        s_unit: 'mm',
        // reference overlays on the live image
        b_grid: false,
        n_um__grid: 0,                          // 0 = automatic cell size
        b_ruler: false,
        o_pos__ruler: { n_x: 0.04, n_y: 0.93 }, // left end, as a fraction of the image
        s_object: '',                           // id from a_o_size_reference, 'image' or ''
        o_pos__object: { n_x: 0.5, n_y: 0.5 },  // centre, as a fraction of the image
        n_um__image: 100,                       // real width an own reference image shows
        n_pct__opacity: 60,
    };
};

// saved settings → valid settings; anything unusable falls back to the default
let f_o_size = function(o_saved) {
    let o_size = f_o_size__default();
    let o = o_saved && typeof o_saved === 'object' ? o_saved : {};
    let f_n = function(v, n_min, n_max, n_fallback) {
        return typeof v === 'number' && Number.isFinite(v) && v >= n_min && v <= n_max ? v : n_fallback;
    };
    let f_o_pos = function(o_pos, o_fallback) {
        return { n_x: f_n(o_pos?.n_x, 0, 1, o_fallback.n_x), n_y: f_n(o_pos?.n_y, 0, 1, o_fallback.n_y) };
    };
    if (typeof o.n_known === 'number' && Number.isFinite(o.n_known) && o.n_known > 0) o_size.n_known = o.n_known;
    if (['mm', 'um'].includes(o.s_unit)) o_size.s_unit = o.s_unit;
    o_size.b_grid = o.b_grid === true;
    o_size.n_um__grid = f_n(o.n_um__grid, 0, 1e7, 0);
    o_size.b_ruler = o.b_ruler === true;
    o_size.o_pos__ruler = f_o_pos(o.o_pos__ruler, o_size.o_pos__ruler);
    // an own image lives only in the page that loaded it
    if (a_o_size_reference.some(function(o_reference) { return o_reference.s_id === o.s_object; })) o_size.s_object = o.s_object;
    o_size.o_pos__object = f_o_pos(o.o_pos__object, o_size.o_pos__object);
    o_size.n_um__image = f_n(o.n_um__image, 1e-3, 1e7, 100);
    o_size.n_pct__opacity = f_n(o.n_pct__opacity, 10, 100, 60);
    return o_size;
};

// ── calibration ──────────────────────────────────────────────────────

let f_n_um__known = function(n_known, s_unit) {
    let n = Number(n_known);
    if (n_known === '' || n_known === null || !Number.isFinite(n) || n <= 0) return 0;
    return s_unit === 'mm' ? n * 1000 : n;
};

let f_n_px__distance = function(o_point__a, o_point__b) {
    if (!o_point__a || !o_point__b) return 0;
    return Math.hypot(o_point__b.n_x - o_point__a.n_x, o_point__b.n_y - o_point__a.n_y);
};

// length of a path through every point, in the unit of the points
let f_n_px__path = function(a_o_point) {
    let n_px = 0;
    for (let n_idx = 1; n_idx < a_o_point.length; n_idx++) n_px += f_n_px__distance(a_o_point[n_idx - 1], a_o_point[n_idx]);
    return n_px;
};

// null while the known distance is missing or the line is too short to trust
let f_o_scale = function(n_um, n_px) {
    if (!(n_um > 0) || !(n_px >= N_PX__LINE_MIN)) return null;
    let n_um__per_px = n_um / n_px;
    return { n_um__per_px: n_um__per_px, n_px__per_um: 1 / n_um__per_px };
};

// worst case when each end point is placed within one camera pixel
let f_n_pct__error = function(n_px) {
    return n_px > 0 ? 200 / n_px : 0;
};

// Part of a snapshot that shows the measured line with some room around it, as
// an SVG viewBox of the given width / height ratio. '' when the data is missing.
let f_s_viewbox__line = function(a_o_point, n_scl_x, n_scl_y, n_ratio) {
    if (!Array.isArray(a_o_point) || a_o_point.length !== 2 || !(n_scl_x > 0) || !(n_scl_y > 0) || !(n_ratio > 0)) return '';
    let [o_a, o_b] = a_o_point;
    let n_scl_x__box = Math.max(Math.abs(o_b.n_x - o_a.n_x), Math.abs(o_b.n_y - o_a.n_y) * n_ratio) * 1.6;
    n_scl_x__box = Math.min(Math.max(n_scl_x__box, 240), n_scl_x, n_scl_y * n_ratio);
    let n_scl_y__box = n_scl_x__box / n_ratio;
    let f_n_start = function(n_centre, n_scl__box, n_scl) {
        return Math.min(Math.max(n_centre - n_scl__box / 2, 0), n_scl - n_scl__box);
    };
    return [
        f_n_start((o_a.n_x + o_b.n_x) / 2, n_scl_x__box, n_scl_x),
        f_n_start((o_a.n_y + o_b.n_y) / 2, n_scl_y__box, n_scl_y),
        n_scl_x__box, n_scl_y__box,
    ].map(function(n) { return Math.round(n * 10) / 10; }).join(' ');
};

// ── window ↔ camera pixels ───────────────────────────────────────────
// o_rect: box of the displayed camera image in window (CSS) px,
// n_scl_x / n_scl_y: size of the camera image in camera px.

let f_o_point__camera = function(o_rect, n_scl_x, n_scl_y, n_x__window, n_y__window) {
    if (!o_rect || !(o_rect.n_scl_x > 0) || !(o_rect.n_scl_y > 0)) return null;
    let n_x = (n_x__window - o_rect.n_x) / o_rect.n_scl_x * n_scl_x;
    let n_y = (n_y__window - o_rect.n_y) / o_rect.n_scl_y * n_scl_y;
    // a click beside the image lands on its nearest edge
    return { n_x: Math.min(n_scl_x, Math.max(0, n_x)), n_y: Math.min(n_scl_y, Math.max(0, n_y)) };
};

let f_o_point__window = function(o_rect, n_scl_x, n_scl_y, o_point) {
    if (!o_rect || !o_point || !(n_scl_x > 0) || !(n_scl_y > 0)) return null;
    return {
        n_x: o_rect.n_x + o_point.n_x / n_scl_x * o_rect.n_scl_x,
        n_y: o_rect.n_y + o_point.n_y / n_scl_y * o_rect.n_scl_y,
    };
};

// ── readable numbers ─────────────────────────────────────────────────

let f_s_number = function(n) {
    return Number.isFinite(n) && n > 0 ? String(Number(n.toPrecision(4))) : '—';
};

let f_s_length = function(n_um) {
    if (!(n_um > 0)) return '—';
    return n_um >= 1000 ? f_s_number(n_um / 1000) + ' mm' : f_s_number(n_um) + ' µm';
};

// nearest 1 · 2 · 5 × 10ⁿ value at or above the target (b_floor: at or below)
let f_n_um__nice = function(n_um__target, b_floor = false) {
    if (!(n_um__target > 0) || !Number.isFinite(n_um__target)) return 0;
    let n_base = Math.pow(10, Math.floor(Math.log10(n_um__target)));
    let n_fraction = n_um__target / n_base;
    let n_step = b_floor
        ? [10, 5, 2, 1].find(function(n) { return n <= n_fraction * (1 + 1e-9); })
        : [1, 2, 5, 10].find(function(n) { return n >= n_fraction * (1 - 1e-9); });
    return Number((n_step * n_base).toPrecision(12));
};

// ── size references ──────────────────────────────────────────────────

// automatic grid: cells of a round size that are comfortable to read on screen
let f_n_um__grid = function(n_um__grid, n_px__per_um, n_px__cell_min = 80) {
    if (!(n_px__per_um > 0)) return 0;
    return n_um__grid > 0 ? n_um__grid : f_n_um__nice(n_px__cell_min / n_px__per_um);
};

// ruler of a round length (about a quarter of the image wide) with tick marks
let f_o_ruler = function(n_px__image, n_px__per_um) {
    if (!(n_px__image > 0) || !(n_px__per_um > 0)) return null;
    let n_um = f_n_um__nice(n_px__image * 0.25 / n_px__per_um, true);
    let n_px = n_um * n_px__per_um;
    let n_cnt__tick = [10, 5, 2, 1].find(function(n) { return n_px / n >= 6; }) || 1;
    return { n_um: n_um, n_px: n_px, n_cnt__tick: n_cnt__tick };
};

// Typical sizes for comparison. Real objects vary; s_size says by how much.
// s_shape: 'band' crosses the view (only its width is a size), the others are n_um__x × n_um__y.
let a_o_size_reference = [
    { s_id: 'hair', s_name: 'Human hair', s_shape: 'band', n_um__x: 0, n_um__y: 70, s_size: 'about 70 µm thick (17–180 µm)' },
    { s_id: 'paper', s_name: 'Sheet of paper, edge', s_shape: 'band', n_um__x: 0, n_um__y: 100, s_size: 'about 100 µm thick (office paper)' },
    { s_id: 'salt', s_name: 'Grain of table salt', s_shape: 'rect', n_um__x: 300, n_um__y: 300, s_size: 'about 300 µm (100–500 µm)' },
    { s_id: 'paramecium', s_name: 'Paramecium', s_shape: 'capsule', n_um__x: 250, n_um__y: 60, s_size: 'about 250 × 60 µm (170–300 µm long)' },
    { s_id: 'egg', s_name: 'Human egg cell', s_shape: 'ellipse', n_um__x: 120, n_um__y: 120, s_size: 'about 120 µm' },
    { s_id: 'rbc', s_name: 'Red blood cell', s_shape: 'ellipse', n_um__x: 7.5, n_um__y: 7.5, s_size: 'about 7.5 µm (6–8 µm)' },
    { s_id: 'yeast', s_name: 'Yeast cell', s_shape: 'ellipse', n_um__x: 5, n_um__y: 5, s_size: 'about 5 µm (5–10 µm)' },
    { s_id: 'ecoli', s_name: 'E. coli bacterium', s_shape: 'capsule', n_um__x: 2, n_um__y: 0.5, s_size: 'about 2 × 0.5 µm' },
];

export {
    N_PX__LINE_MIN, f_o_size__default, f_o_size,
    f_n_um__known, f_n_px__distance, f_n_px__path, f_o_scale, f_n_pct__error, f_s_viewbox__line,
    f_o_point__camera, f_o_point__window,
    f_s_number, f_s_length, f_n_um__nice, f_n_um__grid, f_o_ruler, a_o_size_reference,
};
