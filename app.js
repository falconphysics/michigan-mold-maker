import Module from "./vendor/manifold/manifold.js";   // Manifold geometry engine (manifold-3d 3.5.4, Apache-2.0)
import { OUTLINES } from "./outlines.js";              // Michigan peninsula outlines
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

/* ---------------- parameters ---------------- */
const DEFAULTS = { peninsula: "lower", style: "drape", fired_length: 190, shrink: 12, depth: 20, wall: 28, rim: 12, base: 4,
  foot: 2, smooth: 2.5, res: 0.3, socket: true, thread_dia: 40, pitch: 5, thread_len: 14, clearance: 0.35,
  stand: true, stand_height: 90, base_dia: 140 };

const SLIDERS = [
  ["fired_length", "Finished length (longest side)", 120, 280, 1, "mm", "Size", true],
  ["shrink", "Clay shrinkage", 0, 20, 0.5, "%", "Size"],
  ["depth", "Dish depth", 8, 35, 0.5, "mm", "Shape", true],
  ["wall", "Side curve width", 10, 45, 0.5, "mm", "Shape"],
  ["smooth", "Coastline smoothing", 0, 6, 0.1, "mm", "Shape"],
  ["foot", "Trim-line foot", 0.5, 5, 0.1, "mm", "Drape"],
  ["rim", "Rim width", 5, 25, 0.5, "mm", "Slump"],
  ["base", "Floor thickness", 2, 10, 0.5, "mm", "Slump"],
  ["thread_dia", "Thread diameter", 20, 60, 1, "mm", "Stand"],
  ["thread_len", "Thread depth", 11, 30, 0.5, "mm", "Stand"],
  ["clearance", "Thread clearance", 0.15, 0.8, 0.05, "mm", "Stand"],
  ["stand_height", "Stand height", 40, 160, 1, "mm", "Stand", true],
  ["base_dia", "Stand base diameter", 80, 200, 1, "mm", "Stand", true],
];
const HINTS = {
  shrink: "Wet-to-fired shrinkage from your clay body's data sheet. The mold is scaled up by this much.",
  wall: "How far the curved side runs inward. Bigger is a gentler slope.",
  smooth: "Rounds off coastline details too thin for a clay slab to follow.",
  foot: "Short vertical edge at the base to trim the slab against.",
  clearance: "Gap around the threads. Raise it if a test print is tight.",
  thread_len: "How deep the threaded hole goes. At least 2 full turns (11 mm) so the threads can't strip; the maximum keeps 3 mm of plastic over the hole.",
};

const $ = (id) => document.getElementById(id);
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
                set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

/* ---------------- UI ---------------- */
function fmt(v, unit, inches) {
  const s = (+v).toFixed(2).replace(/\.?0+$/, "");
  return `<b>${s} ${unit}</b>` + (inches ? ` · ${(v / 25.4).toFixed(2)} in` : "");
}
for (const [key, label, lo, hi, step, unit, grp, inches] of SLIDERS) {
  const g = document.querySelector(`[data-group="${grp}"]`);
  const d = document.createElement("div");
  d.className = "ctl";
  d.innerHTML = `<div class="row"><label for="${key}">${label}</label><output id="${key}-out" for="${key}"></output></div>
    <input type="range" id="${key}" min="${lo}" max="${hi}" step="${step}">` +
    (HINTS[key] ? `<p class="hint">${HINTS[key]}</p>` : "");
  g.appendChild(d);
  const inp = d.querySelector("input"), out = d.querySelector("output");
  inp.addEventListener("input", () => { out.innerHTML = fmt(inp.value, unit, inches); if (key === "depth" || key === "foot") syncGroups(); schedule(); });
  inp._paint = () => { out.innerHTML = fmt(inp.value, unit, inches); };
}

function readParams() {
  const p = { ...DEFAULTS };
  p.style = document.querySelector('input[name="style"]:checked').value;
  p.peninsula = document.querySelector('input[name="peninsula"]:checked').value;
  for (const [key] of SLIDERS) p[key] = parseFloat($(key).value);
  p.socket = $("socket").checked;
  p.stand = $("stand").checked;
  p.res = parseFloat($("quality").value);
  return p;
}
function writeParams(p) {
  $(`style-${p.style}`).checked = true;
  $(`pen-${p.peninsula}`).checked = true;
  for (const [key] of SLIDERS) { $(key).value = p[key]; $(key)._paint(); }
  $("socket").checked = p.socket; $("stand").checked = p.stand;
  $("quality").value = String(p.res);
  syncGroups();
}
function syncGroups() {
  const drape = readParams().style === "drape";
  document.querySelector('[data-group="Drape"]').hidden = !drape;
  document.querySelector('[data-group="Stand"]').hidden = !drape;
  document.querySelector('[data-group="Slump"]').hidden = drape;
  $("stand").disabled = !$("socket").checked;
  const dis = !($("socket").checked);
  for (const k of ["thread_dia", "clearance", "thread_len"]) $(k).disabled = dis;
  // thread depth: min = 2 full turns + 1 mm lead-in; max keeps a 3 mm skin under the dish's flat top
  const tl = $("thread_len"), pitch = DEFAULTS.pitch;
  const tMin = 2 * pitch + 1, tMax = Math.max(tMin, parseFloat($("foot").value) + parseFloat($("depth").value) - 3.5);
  tl.min = tMin; tl.max = tMax;
  if (parseFloat(tl.value) > tMax) tl.value = tMax;
  if (parseFloat(tl.value) < tMin) tl.value = tMin;
  tl._paint?.();
  for (const k of ["stand_height", "base_dia"]) $(k).disabled = dis || !$("stand").checked;
}
document.querySelectorAll('input[name="style"]').forEach(r => r.addEventListener("change", () => { syncGroups(); schedule(); }));
document.querySelectorAll('input[name="peninsula"]').forEach(r => r.addEventListener("change", () => {
  firstFit = true;
  const p = readParams(), changed = [];
  // The U.P. is narrow (about 43 mm across at its widest at 190 mm long): use a tighter side curve and a smaller thread.
  if (p.peninsula === "upper" && p.style === "drape" && p.socket) {
    if (p.wall > 12) { $("wall").value = 12; $("wall")._paint(); changed.push("side curve to 12 mm"); }
    if (p.thread_dia > 20) { $("thread_dia").value = 20; $("thread_dia")._paint(); changed.push("thread diameter to 20 mm"); }
  }
  const note = $("pen-note");
  note.hidden = !changed.length;
  note.textContent = changed.length ? `The U.P. is narrow, so I set the ${changed.join(" and ")} so the shape reaches full depth and the threaded hole fits.` : "";
  schedule();
}));
for (const id of ["socket", "stand"]) $(id).addEventListener("change", () => { syncGroups(); schedule(); });
for (const id of ["bed_x", "bed_y"]) $(id).addEventListener("input", () => updateChips());
$("quality").addEventListener("change", saveSettings);
$("fname").addEventListener("input", saveSettings);
$("reset").addEventListener("click", () => { writeParams(DEFAULTS); schedule(); });

const saved = store.get("mmm-settings");
writeParams({ ...DEFAULTS, ...(saved?.params || {}) });
if (saved?.bed_x) $("bed_x").value = saved.bed_x;
if (saved?.bed_y) $("bed_y").value = saved.bed_y;
if (saved?.fname) $("fname").value = saved.fname;
function saveSettings() {
  store.set("mmm-settings", { params: readParams(), bed_x: $("bed_x").value, bed_y: $("bed_y").value, fname: $("fname").value });
}

/* ---------------- geometry engine ---------------- */
let M = null; // manifold module

function polyArea(pts) { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]; a += x1 * y2 - x2 * y1; } return a / 2; }
function polyCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]; const c = x1 * y2 - x2 * y1; a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c; }
  return [cx / (3 * a), cy / (3 * a)];
}
function bounds(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
const wetLength = (p) => p.fired_length / (1 - p.shrink / 100);

/** Scaled, mirrored-for-drape, smoothed outline in mm (CCW). `T` collects wasm objects to free. */
function outline(p, T) {
  const src = OUTLINES[p.peninsula] || OUTLINES.lower;
  const [x0, y0, x1, y1] = bounds(src);
  const s = wetLength(p) / Math.max(x1 - x0, y1 - y0);
  let pts = src.map(([x, y]) => [(x - (x0 + x1) / 2) * s * (p.style === "drape" ? -1 : 1), (y - (y0 + y1) / 2) * s]);
  if (polyArea(pts) < 0) pts.reverse();
  let cs = T(new M.CrossSection([pts]));
  const r = p.smooth;
  if (r > 0) {
    cs = T(T(cs.offset(r * 0.8, "Round", 2, 48)).offset(-r * 0.8, "Round", 2, 48));
    cs = T(T(cs.offset(-r, "Round", 2, 48)).offset(r, "Round", 2, 48));
  }
  cs = T(cs.simplify(0.05));
  let best = null;
  for (const ring of cs.toPolygons()) { const a = polyArea(ring); if (!best || Math.abs(a) > Math.abs(best.a)) best = { ring, a }; }
  let ring = best.ring; if (best.a < 0) ring = ring.slice().reverse();
  return ring;
}

/** Fast signed distance to the outline (+ inside), clamped at maxD; segments bucketed in a coarse grid. */
function makeSDF(ring, maxD) {
  const n = ring.length;
  const [bx0, by0, bx1, by1] = bounds(ring);
  const C = Math.max(maxD, 1), gx0 = bx0 - C, gy0 = by0 - C;
  const nx = Math.ceil((bx1 - bx0 + 2 * C) / C) + 1, ny = Math.ceil((by1 - by0 + 2 * C) / C) + 1;
  const cells = Array.from({ length: nx * ny }, () => []);
  const ax = new Float64Array(n), ay = new Float64Array(n), dx = new Float64Array(n), dy = new Float64Array(n), ll = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n];
    ax[i] = x1; ay[i] = y1; dx[i] = x2 - x1; dy[i] = y2 - y1; ll[i] = dx[i] * dx[i] + dy[i] * dy[i] || 1e-12;
    const cx0 = Math.floor((Math.min(x1, x2) - gx0) / C), cx1 = Math.floor((Math.max(x1, x2) - gx0) / C);
    const cy0 = Math.floor((Math.min(y1, y2) - gy0) / C), cy1 = Math.floor((Math.max(y1, y2) - gy0) / C);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) cells[cy * nx + cx].push(i);
  }
  function dist(x, y) {
    const cx = Math.floor((x - gx0) / C), cy = Math.floor((y - gy0) / C);
    let best = maxD * maxD;
    for (let j = cy - 1; j <= cy + 1; j++) {
      if (j < 0 || j >= ny) continue;
      for (let i = cx - 1; i <= cx + 1; i++) {
        if (i < 0 || i >= nx) continue;
        for (const s of cells[j * nx + i]) {
          let t = ((x - ax[s]) * dx[s] + (y - ay[s]) * dy[s]) / ll[s];
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax[s] + t * dx[s] - x, ey = ay[s] + t * dy[s] - y, d2 = ex * ex + ey * ey;
          if (d2 < best) best = d2;
        }
      }
    }
    return Math.sqrt(best);
  }
  function crossings(y) {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const y1 = ay[i], y2 = ay[i] + dy[i];
      if ((y1 > y) !== (y2 > y)) xs.push(ax[i] + (y - y1) * dx[i] / dy[i]);
    }
    return xs.sort((a, b) => a - b);
  }
  /** signed distances over a grid: xs ascending, ys any */
  function grid(xs, ys) {
    const out = new Float32Array(xs.length * ys.length);
    for (let j = 0; j < ys.length; j++) {
      const cr = crossings(ys[j]); let k = 0;
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        while (k < cr.length && cr[k] <= x) k++;
        const d = dist(x, ys[j]);
        out[j * xs.length + i] = (k & 1) ? d : -d;
      }
    }
    return out;
  }
  return { dist, grid };
}

const wallProfile = (p, d) => { const u = Math.min(Math.max(d / p.wall, 0), 1); return p.depth * (1 - Math.cos(Math.PI * u)) / 2; };
function heightAt(p, d) { return p.style === "drape" ? p.foot + wallProfile(p, d) : p.base + p.depth - wallProfile(p, d); }

function linspace(a, b, n) { const o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = a + (b - a) * i / (n - 1); return o; }

/** Closed solid with a smooth triangulated top surface sampled on a res-mm grid (no terraces). */
function heightfieldSolid(p, ring, bx, res, T) {
  const [x0, y0, x1, y1] = bx;
  const nx = Math.ceil((x1 - x0) / res) + 1, ny = Math.ceil((y1 - y0) / res) + 1;
  const xs = linspace(x0, x1, nx), ys = linspace(y0, y1, ny);
  const sd = makeSDF(ring, p.wall + 0.5).grid(xs, ys);
  const nt = nx * ny;
  const ringIdx = [];
  for (let i = 0; i < nx; i++) ringIdx.push(i);
  for (let j = 1; j < ny; j++) ringIdx.push(j * nx + nx - 1);
  for (let i = nx - 2; i >= 0; i--) ringIdx.push((ny - 1) * nx + i);
  for (let j = ny - 2; j > 0; j--) ringIdx.push(j * nx);
  const k = ringIdx.length;
  const V = new Float32Array((nt + k + 1) * 3);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = j * nx + i; V[3 * v] = xs[i]; V[3 * v + 1] = ys[j]; V[3 * v + 2] = heightAt(p, sd[v]);
  }
  for (let r = 0; r < k; r++) { const s = ringIdx[r], v = nt + r; V[3 * v] = V[3 * s]; V[3 * v + 1] = V[3 * s + 1]; V[3 * v + 2] = -1; }
  const c = nt + k; V[3 * c] = (x0 + x1) / 2; V[3 * c + 1] = (y0 + y1) / 2; V[3 * c + 2] = -1;
  const F = new Uint32Array(((nx - 1) * (ny - 1) * 2 + 3 * k) * 3);
  let f = 0;
  const tri = (a, b, cc) => { F[f++] = a; F[f++] = b; F[f++] = cc; };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, cc = a + nx + 1, d = a + nx; tri(a, b, cc); tri(a, cc, d);
  }
  for (let r = 0; r < k; r++) {
    const t0 = ringIdx[r], t1 = ringIdx[(r + 1) % k], b0 = nt + r, b1 = nt + (r + 1) % k;
    tri(t0, b0, b1); tri(t0, b1, t1); tri(c, b1, b0);
  }
  try { return T(new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: V, triVerts: F }))); }
  catch {
    for (let i = 0; i < F.length; i += 3) { const t = F[i + 1]; F[i + 1] = F[i + 2]; F[i + 2] = t; }
    return T(new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: V, triVerts: F })));
  }
}

/** Spot closest to the outline's centroid where the threaded hole keeps >= 3 mm of plastic above it
 *  and >= 3 mm of wall around it. Returns [x, y, offset, ceilingConeHeight] or null. */
function socketLocation(p, ring) {
  const Rh = p.thread_dia / 2 + p.clearance;
  const sdf = makeSDF(ring, p.wall + Rh + 5);
  const [x0, y0, x1, y1] = bounds(ring);
  const [cx, cy] = polyCentroid(ring);
  const xs = []; for (let x = x0; x < x1; x += 1) xs.push(x);
  const ys = []; for (let y = y0; y < y1; y += 1) ys.push(y);
  const g = sdf.grid(xs, ys);
  let best = null;
  for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) {
    const edge = g[j * xs.length + i] - Rh;          // distance from the hole's rim to the coastline
    if (edge < 3) continue;
    const avail = p.foot + wallProfile(p, edge) - 3 - p.thread_len;   // lowest surface over the hole
    if (avail < 0) continue;
    const d2 = (xs[i] - cx) ** 2 + (ys[j] - cy) ** 2;
    if (!best || d2 < best[2]) best = [xs[i], ys[j], d2, avail];
  }
  return best ? [best[0], best[1], Math.sqrt(best[2]), Math.max(0, Math.min(best[3], Rh - 6))] : null;
}

function threadCS(rMaj, pitch, depth, grow, n, T) {
  const f = (t) => t < 0.15 ? rMaj - depth : t < 0.45 ? rMaj - depth + depth * (t - 0.15) / 0.30
    : t < 0.60 ? rMaj : t < 0.90 ? rMaj - depth * (t - 0.60) / 0.30 : rMaj - depth;
  const pts = [];
  for (let i = 0; i < n; i++) { const th = 2 * Math.PI * i / n, r = f(i / n) + grow; pts.push([r * Math.cos(th), r * Math.sin(th)]); }
  return T(new M.CrossSection([pts]));
}
const threaded = (cs, z0, h, pitch, dz, T) => T(T(cs.extrude(h, Math.max(8, Math.floor(h / dz)), 360 * h / pitch)).translate([0, 0, z0]));
const cone = (r0, r1, h, seg, T) => T(M.Manifold.cylinder(h, r0, r1, seg));
const mv = (m, x, y, z, T) => T(m.translate([x, y, z]));

function meshOut(m) { const g = m.getMesh(); return { V: g.vertProperties.slice(), F: g.triVerts.slice(), np: g.numProp }; }

/** Build everything. quality: res in mm; preview uses coarser threads. */
function build(p, preview) {
  const trash = []; const T = (o) => { trash.push(o); return o; };
  try {
    const info = {};
    const ring = outline(p, T);
    const base = T(new M.CrossSection([ring]));
    const [x0, y0, x1, y1] = bounds(ring);
    const pad = p.rim + 2;
    const res = preview ? Math.max(p.res, 1.0) : p.res;
    const hf = heightfieldSolid(p, ring, [x0 - pad, y0 - pad, x1 + pad, y1 + pad], res, T);
    let solid;
    if (p.style === "drape") solid = T(hf.intersect(T(base.extrude(p.foot + p.depth + 5))));
    else solid = T(hf.intersect(T(T(base.offset(p.rim, "Round", 2, 64)).extrude(p.base + p.depth + 5))));
    solid = T(solid.simplify(0.002));
    let stand = null, sock = null;
    const seg = preview ? 64 : 128, tn = preview ? 120 : 240, dz = preview ? 0.5 : 0.2;
    if (p.style === "drape" && p.socket && p.thread_dia > 0) {
      sock = socketLocation(p, ring);
    }
    if (p.style === "drape" && p.socket && p.thread_dia > 0 && !sock) {
      info.sockErr = "The threaded hole doesn't fit with 3 mm of plastic over it. Lower the thread diameter, thread depth or side curve width, or increase the dish depth or size.";
    } else if (sock) {
      const [hx, hy] = sock;
      const R = p.thread_dia / 2, td = 0.3 * p.pitch, top = p.foot + p.depth, Rh = R + p.clearance;
      let s = threaded(threadCS(R, p.pitch, td, p.clearance, tn, T), -1, p.thread_len + 1, p.pitch, dz, T);
      s = T(s.add(mv(cone(Rh + 1.2, Rh, 1.2, seg, T), 0, 0, -0.01, T)));
      const ceil = sock[3];
      if (ceil > 0) s = T(s.add(mv(cone(Rh, Rh - ceil, ceil, seg, T), 0, 0, p.thread_len - 0.01, T)));
      solid = T(solid.subtract(mv(s, hx, hy, 0, T)));
      if (p.stand) {
        const H = p.stand_height, rb = p.base_dia / 2, rc = R + 2, studLen = p.thread_len - 1;
        let st = cone(rb, rb - 2, 2, seg, T);
        for (const [a, b, h, z] of [[rb - 2, rb - 2, 4, 2], [rb - 2, rb - 4, 2, 6], [rc + 18, rc, 18, 7.9],
                                     [rc, rc, H - 8, 8], [rc, rc + 14, 14, H - 14], [rc + 14, rc + 14, 3, H - 0.01]])
          st = T(st.add(mv(cone(a, b, h, seg, T), 0, 0, z, T)));
        const z0 = H + 3, ztc = z0 + studLen - 2.5;
        const stud = threaded(threadCS(R, p.pitch, td, 0, tn, T), z0 - 0.5, studLen + 0.5, p.pitch, dz, T);
        const tip = T(mv(cone(R + 5, R + 5, ztc - (z0 - 1), seg, T), 0, 0, z0 - 1, T)
                      .add(mv(cone(R + 1, R - td - 0.01, 2.5, seg, T), 0, 0, ztc - 0.001, T)));
        st = T(st.add(T(stud.intersect(tip))));
        stand = meshOut(st);
        info.standTop = z0;
      }
    }
    const mold = meshOut(solid);
    if (info.sockErr) stand = null;
    const bb = solid.boundingBox();
    info.mold = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
    info.outline = [x1 - x0, y1 - y0];
    return { mold, stand, sock, info, ring };
  } finally {
    for (const o of trash) { try { o.delete(); } catch {} }
  }
}

/* ---------------- STL + zip ---------------- */
function stl(mesh, name) {
  const { V, F, np } = mesh, nt = F.length / 3;
  const buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
  const head = `${name} - Michigan Mold Maker`;
  for (let i = 0; i < Math.min(80, head.length); i++) dv.setUint8(i, head.charCodeAt(i) & 127);
  dv.setUint32(80, nt, true);
  let o = 84;
  for (let t = 0; t < nt; t++) {
    const a = F[3 * t] * np, b = F[3 * t + 1] * np, c = F[3 * t + 2] * np;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
    const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true); o += 12;
    for (const s of [a, b, c]) { dv.setFloat32(o, V[s], true); dv.setFloat32(o + 4, V[s + 1], true); dv.setFloat32(o + 8, V[s + 2], true); o += 12; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return buf;
}


/* Minimal zip writer: native deflate (CompressionStream) when available, else stored. */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function deflateRaw(u8) {
  if (typeof CompressionStream === "undefined") return null;
  try { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()); }
  catch { return null; }
}
async function makeZip(files) {
  const parts = [], central = []; let offset = 0;
  const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
        dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, data] of files) {
    const nm = new TextEncoder().encode(name), crc = crc32(data);
    const def = await deflateRaw(data);
    const useDef = def && def.length < data.length, body = useDef ? def : data, method = useDef ? 8 : 0;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true);
    parts.push(lh.buffer, nm, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, nm);
    offset += 30 + nm.length + body.length;
  }
  const csize = central.reduce((s, b) => s + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}

/* ---------------- 3D viewer ---------------- */
const host = $("viewer");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(-150, -250, 400); scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(200, 150, 100); scene.add(fill);
const group = new THREE.Group(); scene.add(group);
let firstFit = true;
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function toGeom(mesh) {
  const { V, F, np } = mesh;
  const pos = new Float32Array(F.length * 3);
  for (let i = 0; i < F.length; i++) { const s = F[i] * np; pos[3 * i] = V[s]; pos[3 * i + 1] = V[s + 1]; pos[3 * i + 2] = V[s + 2]; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return toCreasedNormals(g, Math.PI / 5);   // smooth surfaces, crisp edges
}
function show(res, p) {
  for (const c of [...group.children]) { group.remove(c); c.geometry?.dispose(); }
  const clay = new THREE.MeshStandardMaterial({ color: css("--clay"), roughness: 0.75, metalness: 0 });
  const slate = new THREE.MeshStandardMaterial({ color: 0x8e9ba6, roughness: 0.6, metalness: 0.05 });
  const mold = new THREE.Mesh(toGeom(res.mold), clay);
  const legend = [`<span><i class="sw" style="background:var(--clay)"></i>Mold${p.style === "drape" ? " (mirrored, so the dish reads right)" : ""}</span>`];
  if (res.stand) {
    const stand = new THREE.Mesh(toGeom(res.stand), slate);
    group.add(stand);
    // exploded assembly: mold lifted above the stud, socket over the stand's axis
    mold.position.set(-res.sock[0], -res.sock[1], res.info.standTop + 30);
    legend.push(`<span><i class="sw" style="background:#8e9ba6"></i>Stand (screws into the mold)</span>`);
  }
  group.add(mold);
  $("legend").innerHTML = legend.join("");
  const box = new THREE.Box3().setFromObject(group), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()).length();
  controls.target.copy(c);
  if (firstFit) { camera.position.set(c.x - sz * 0.45, c.y - sz * 0.85, c.z + sz * 1.0); firstFit = false; }
  controls.update();
}
function resize() { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(host);
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();

/* ---------------- info chips ---------------- */
let last = null;
function updateChips() {
  const p = readParams(), chips = [];
  if (!last) { $("chips").innerHTML = ""; return; }
  const { info } = last;
  const [fa, fb] = info.outline.map(v => v * (1 - p.shrink / 100)).sort((a, b) => b - a);
  chips.push([p.peninsula === "upper" ? "Finished U.P." : "Finished spoon rest",
    `${fa.toFixed(0)} × ${fb.toFixed(0)} mm (${(fa / 25.4).toFixed(1)} × ${(fb / 25.4).toFixed(1)} in)`, ""]);
  const [mx, my, mz] = info.mold;
  const bx = +$("bed_x").value, by = +$("bed_y").value;
  const fits = (mx <= bx && my <= by) || (mx <= by && my <= bx);
  chips.push(["Mold", `${mx.toFixed(0)} × ${my.toFixed(0)} × ${mz.toFixed(0)} mm${fits ? "" : ", too big for your bed"}`, fits ? "good" : "warn"]);
  if (last.stand) {
    const sFits = p.base_dia <= Math.min(bx, by);
    chips.push(["Stand", `${p.base_dia.toFixed(0)} mm base, ${(p.stand_height + 3 + p.thread_len - 1).toFixed(0)} mm tall${sFits ? "" : ", too big for your bed"}`, sFits ? "good" : "warn"]);
  }
  if (info.sockErr) chips.push(["Socket", "doesn't fit", "warn"]);
  if (last.sock) chips.push(["Socket", `${p.thread_dia} mm wide, ${p.thread_len} mm deep, ${last.sock[2].toFixed(0)} mm off centre`, ""]);
  $("chips").innerHTML = chips.map(([k, v, c]) => `<span class="chip ${c}"><span class="k">${k}</span><span class="v">${v}</span></span>`).join("");
  saveSettings();
}

/* ---------------- preview scheduling ---------------- */
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(preview, 300); }
const tick = () => new Promise(r => setTimeout(r, 20));
async function preview() {
  if (!M) return;
  const p = readParams();
  $("busy").hidden = false; await tick();
  try {
    const res = build(p, true);
    last = res; show(res, p); updateChips();
    if (res.info.sockErr) setStatus(res.info.sockErr, true);
    else setStatus("Ready. Adjust the settings, then download.");
  } catch (e) { setStatus(e.message || String(e), true); }
  $("busy").hidden = true;
}
function setStatus(t, err) { $("status").textContent = t; $("status").classList.toggle("err", !!err); }

/* ---------------- download ---------------- */
let downloads = null;
$("go").addEventListener("click", async () => {
  const p = readParams();
  const name = ($("fname").value.trim() || "lp_spoon_rest").replace(/[^\w\- ]+/g, "_");
  $("go").disabled = true; setStatus("Building full-quality geometry… this can take 10–30 seconds."); await tick();
  try {
    const t0 = performance.now();
    const res = build(p, false);
    if (res.info.sockErr) throw new Error(res.info.sockErr + " Or turn off the threaded socket.");
    setStatus("Writing STL files…"); await tick();
    const enc = new TextEncoder();
    const files = [[`${name}_${p.style}_mold.stl`, new Uint8Array(stl(res.mold, `${p.style} mold`))]];
    if (res.stand) files.push([`${name}_stand.stl`, new Uint8Array(stl(res.stand, "stand"))]);
    files.push([`${name}_settings.json`, enc.encode(JSON.stringify({ ...p, socket_xy: res.sock ? res.sock.slice(0, 2) : null }, null, 2))]);
    files.push(["PRINTING NOTES.txt", enc.encode(notes(p, res))]);
    setStatus("Compressing…"); await tick();
    const blob = await makeZip(files);
    if (!downloads) {                       // GitHub Pages / any normal web host
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `${name}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      setStatus(`Downloaded ${name}.zip (${(blob.size / 1e6).toFixed(1)} MB) in ${((performance.now() - t0) / 1000).toFixed(0)} s.`);
      $("go").disabled = false; return;
    }
    setStatus(`Built in ${((performance.now() - t0) / 1000).toFixed(0)} s. Confirm the download…`);
    try {
      await downloads.save({ filename: `${name}.zip`, data: blob });
      setStatus(`Saved ${name}.zip (${(blob.size / 1e6).toFixed(1)} MB).`);
    } catch (e) {
      const code = e?.code;
      if (code === "declined") setStatus("Download cancelled.");
      else if (code === "rate_limited") setStatus("Another download prompt is open. Finish it, then try again.", true);
      else if (code === "too_large") setStatus("The file is too large here. Choose Standard or Draft quality and try again.", true);
      else setStatus("Downloads aren't available in this view. Open the page in claude.ai and try again.", true);
    }
  } catch (e) { setStatus(e.message || String(e), true); }
  $("go").disabled = false;
});
function notes(p, res) {
  const L = [`Michigan Mold Maker: ${p.peninsula === "upper" ? "Upper" : "Lower"} Peninsula ${p.style} mold`, "",
    `Finished spoon rest: about ${p.fired_length} mm on its longest side after firing (${p.shrink}% shrinkage).`,
    `Mold: ${res.info.mold.map(v => v.toFixed(0)).join(" x ")} mm. Print flat side down, no supports, 3 walls, 10-15% infill.`];
  if (p.style === "drape") L.push("", "The mold is a mirror image on purpose: the dish reads correctly once you flip it right side up.",
    "Cover the hump with plastic wrap or thin cloth, drape a ~6 mm slab, smooth from the centre out, trim at the base line.",
    "Take the clay off at soft leather-hard: it shrinks onto a hump and can crack if left too long.");
  else L.push("", "Line the cavity with plastic wrap or cloth, or dust it with cornstarch, so the clay releases.");
  if (res.stand) L.push("", `Stand: print upright, no supports, 3-4 walls. Thread ${p.thread_dia} mm x ${p.pitch} mm pitch, ${p.thread_len} mm deep, ${p.clearance} mm clearance.`,
    "If the threads are tight, regenerate both parts with a larger thread clearance.");
  return L.join("\n");
}

/* ---------------- start ---------------- */
(async () => {
  try {
    M = await Module();   // loads vendor/manifold/manifold.wasm next to manifold.js
    M.setup();
    await preview();
  } catch (e) { setStatus("The geometry engine didn't load: " + (e.message || e), true); }
})();
$("howto").textContent = "You get a .zip with the STL files, your settings and printing notes.";
(async () => {   // inside Claude, saves go through Claude's download prompt
  if (!window.claude?.use) return;
  try { downloads = await window.claude.use("downloads"); } catch { downloads = null; }
})();
