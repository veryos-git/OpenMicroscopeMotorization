// A free scan is an ordered, simple polygon of manually focused XYZ positions.
// Keep geometry independent of Vue/hardware so coverage and focus are testable.
const EPS = 1e-8;
const cross = (a, b, c) => (b.n_x - a.n_x) * (c.n_y - a.n_y) - (b.n_y - a.n_y) * (c.n_x - a.n_x);
const onSegment = (p, a, b) => Math.abs(cross(a, b, p)) <= EPS
    && p.n_x >= Math.min(a.n_x, b.n_x) - EPS && p.n_x <= Math.max(a.n_x, b.n_x) + EPS
    && p.n_y >= Math.min(a.n_y, b.n_y) - EPS && p.n_y <= Math.max(a.n_y, b.n_y) + EPS;
function intersects(a, b, c, d) {
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    return ((abC > EPS && abD < -EPS || abC < -EPS && abD > EPS)
        && (cdA > EPS && cdB < -EPS || cdA < -EPS && cdB > EPS))
        || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}
function inside(p, points) {
    let result = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[j], b = points[i];
        if (onSegment(p, a, b)) return true;
        if ((a.n_y > p.n_y) !== (b.n_y > p.n_y)
            && p.n_x < (b.n_x - a.n_x) * (p.n_y - a.n_y) / (b.n_y - a.n_y) + a.n_x) result = !result;
    }
    return result;
}
function weights(p, a, b, c) {
    const area = cross(a, b, c);
    if (Math.abs(area) < EPS) return null;
    const u = cross(p, b, c) / area, v = cross(a, p, c) / area;
    const w = 1 - u - v;
    return Math.min(u, v, w) >= -EPS ? [u, v, w] : null;
}
function triangulate(points) {
    const indices = points.map((_, i) => i);
    const origin = points[0];
    const area = points.reduce((sum, a, i) => sum + cross(origin, a, points[(i + 1) % points.length]), 0);
    if (Math.abs(area) < EPS) throw Error('The outline needs at least three points that are not on one line.');
    if (area < 0) indices.reverse();
    const triangles = [];
    while (indices.length > 3) {
        let found = false;
        for (let i = 0; i < indices.length; i++) {
            const triangle = [indices[(i + indices.length - 1) % indices.length], indices[i], indices[(i + 1) % indices.length]];
            const [a, b, c] = triangle.map(index => points[index]);
            if (cross(a, b, c) <= EPS) continue;
            if (indices.some(index => !triangle.includes(index) && weights(points[index], a, b, c))) continue;
            triangles.push(triangle);
            indices.splice(i, 1);
            found = true;
            break;
        }
        if (!found) throw Error('Cannot form a scan area from this outline. Remove overlapping edges.');
    }
    if (Math.abs(cross(...indices.map(index => points[index]))) > EPS) triangles.push(indices);
    return triangles;
}

export function f_n_free_focus(points, triangles, x, y) {
    const p = { n_x: x, n_y: y };
    for (const indices of triangles) {
        const triangle = indices.map(index => points[index]);
        const w = weights(p, ...triangle);
        if (w) return Math.round(w.reduce((sum, value, i) => sum + value * triangle[i].n_z, 0));
    }
    // Border tiles can have centers just outside the outline. Extend the nearest
    // edge's focus, bounded by its measured endpoints, rather than extrapolating.
    let distance = Infinity, z = points[0].n_z;
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const dx = b.n_x - a.n_x, dy = b.n_y - a.n_y;
        const t = Math.max(0, Math.min(1, ((x - a.n_x) * dx + (y - a.n_y) * dy) / (dx * dx + dy * dy)));
        const d = (x - a.n_x - t * dx) ** 2 + (y - a.n_y - t * dy) ** 2;
        if (d < distance) { distance = d; z = a.n_z + t * (b.n_z - a.n_z); }
    }
    return Math.round(z);
}

export function f_o_free_scan_plan(points, { n_width, n_height, n_steps_x, n_steps_y, n_overlap_pct = 30 }) {
    if (points.length < 3) throw Error('Add at least three focused points around the sample.');
    if (points.length > 128) throw Error('Use at most 128 outline points.');
    if (!points.every(p => [p.n_x, p.n_y, p.n_z].every(Number.isSafeInteger))) throw Error('Every point needs valid X, Y and Z motor positions.');
    if (![n_width, n_height].every(n => Number.isFinite(n) && n > 0)) throw Error('Start the camera and wait for a live image.');
    const missingAxes = [['X', n_steps_x], ['Y', n_steps_y]].filter(([, n]) => !Number.isFinite(n) || n <= 0).map(([axis]) => axis);
    if (missingAxes.length) throw Error('Calibrate ' + missingAxes.join(' and ') + ' in Setup to calculate image spacing. Saved focus points are kept during calibration.');
    if (!Number.isFinite(n_overlap_pct) || n_overlap_pct < 0 || n_overlap_pct > 90) throw Error('Overlap must be between 0 and 90%.');
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length], prev = points[(i + points.length - 1) % points.length];
        if (points.slice(i + 1).some(p => p.n_x === a.n_x && p.n_y === a.n_y)) throw Error('Outline points must have different XY positions; the last edge closes automatically.');
        if (Math.abs(cross(prev, a, b)) < EPS && (prev.n_x - a.n_x) * (b.n_x - a.n_x) + (prev.n_y - a.n_y) * (b.n_y - a.n_y) > 0) throw Error('Outline edges must not overlap.');
        for (let j = i + 1; j < points.length; j++) {
            if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
            if (intersects(a, b, points[j], points[(j + 1) % points.length])) throw Error('Outline edges cross. Add points in order around the sample.');
        }
    }
    const triangles = triangulate(points);
    const minX = Math.min(...points.map(p => p.n_x)), minY = Math.min(...points.map(p => p.n_y));
    const maxX = Math.max(...points.map(p => p.n_x)), maxY = Math.max(...points.map(p => p.n_y));
    // Floor preserves at least the requested overlap after rounding to motor steps.
    const stepX = Math.floor(n_width * n_steps_x * (1 - n_overlap_pct / 100));
    const stepY = Math.floor(n_height * n_steps_y * (1 - n_overlap_pct / 100));
    if (Math.min(stepX, stepY) < 1) throw Error('The requested overlap needs less than one motor step; reduce overlap or recalibrate.');
    const cols = Math.ceil((maxX - minX) / stepX) + 1, rows = Math.ceil((maxY - minY) / stepY) + 1;
    if (!Number.isSafeInteger(cols * rows) || cols * rows > 40000) throw Error('This outline is too large. Split it into smaller scans.');
    const tiles = [];
    for (let row = 0; row < rows; row++) {
        for (let c = 0; c < cols; c++) {
            const col = row % 2 ? cols - 1 - c : c;
            const x = minX + col * stepX, y = minY + row * stepY;
            // Retain every lattice cell intersecting the polygon. Each cell is
            // smaller than the camera footprint, so even thin/concave edges are
            // covered; testing only tile centers would leave holes at the edge.
            const corners = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]
                .map(([dx, dy]) => ({ n_x: x + dx * stepX, n_y: y + dy * stepY }));
            const covered = corners.some(p => inside(p, points))
                || points.some(p => Math.abs(p.n_x - x) <= stepX / 2 && Math.abs(p.n_y - y) <= stepY / 2)
                || points.some((p, i) => corners.some((corner, j) => intersects(p, points[(i + 1) % points.length], corner, corners[(j + 1) % 4])));
            if (!covered) continue;
            tiles.push({ n_row: row, n_col: col, n_x: x, n_y: y, n_z: f_n_free_focus(points, triangles, x, y) });
            if (tiles.length > 10000) throw Error('This outline needs over 10000 images. Split it into smaller scans.');
        }
    }
    return {
        s_mode: 'free', n_version: 1, n_tile_x: cols, n_tile_y: rows,
        n_step__x: stepX, n_step__y: stepY, a_n_start: [minX, minY],
        n_overlap__pct: n_overlap_pct, n_width, n_height, n_steps_x, n_steps_y,
        a_o_point: points.map(p => ({ ...p })), a_o_triangle: triangles, a_o_tile: tiles,
    };
}
