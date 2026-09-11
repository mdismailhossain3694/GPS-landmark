// ─────────────────────────────────────────────────────────────
// ভূমি-রেকর্ড Pro · Spatial Computing Engine (Vanilla math, no deps)
// Haversine · Bearing · Destination · Geodesic Area · PIP ·
// Segment Intersection · Polygon Overlap · Auto-Partition · Frontage
// ─────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

export const EARTH_R = 6371000; // meters
export const DEG = Math.PI / 180;

export const toRad = (d: number) => d * DEG;
export const toDeg = (r: number) => r / DEG;

/** Haversine distance in meters */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h =
    s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a→b in degrees (0=N, 90=E) */
export function bearing(a: LatLng, b: LatLng): number {
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Destination point given start, bearing(deg), distance(m) */
export function destination(from: LatLng, brgDeg: number, distM: number): LatLng {
  const d = distM / EARTH_R;
  const brg = toRad(brgDeg);
  const lat1 = toRad(from.lat);
  const lng1 = toRad(from.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

/** Perimeter of polygon in meters */
export function polygonPerimeter(pts: LatLng[]): number {
  if (pts.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    p += haversine(pts[i], pts[(i + 1) % pts.length]);
  }
  return p;
}

/**
 * Geodesic-ish polygon area (equal-earth local projection + shoelace).
 * Accurate to <0.5% for plot-scale polygons. Returns sq-meters.
 */
export function polygonAreaSqm(pts: LatLng[]): number {
  if (pts.length < 3) return 0;
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const kx = EARTH_R * Math.cos(toRad(lat0)) * DEG;
  const ky = EARTH_R * DEG;
  const xy = pts.map((p) => ({ x: p.lng * kx, y: p.lat * ky }));
  let sum = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum / 2);
}

// ── Bangladesh land units ────────────────────────────────
export interface LandUnits {
  sqm: number;
  sqft: number;
  decimal: number; // শতাংশ
  katha: number;   // কাঠা (1 কাঠা = 1.65 শতাংশ)
  bigha: number;   // বিঘা (1 বিঘা = 20 কাঠা)
  acre: number;
}

export function toLandUnits(sqm: number): LandUnits {
  const sqft = sqm * 10.7639;
  const decimal = sqm / 40.4686;
  const katha = decimal / 1.65;
  const bigha = katha / 20;
  const acre = decimal / 100;
  return { sqm, sqft, decimal, katha, bigha, acre };
}

export function formatBanglaArea(sqm: number): string {
  const u = toLandUnits(sqm);
  if (u.bigha >= 1) {
    const b = Math.floor(u.bigha);
    const k = Math.floor((u.bigha - b) * 20);
    const d = ((u.bigha - b) * 20 - k) * 1.65;
    return `${b} বিঘা ${k} কাঠা ${d.toFixed(1)} শতাংশ`;
  }
  if (u.katha >= 1) {
    const k = Math.floor(u.katha);
    const d = (u.katha - k) * 1.65;
    return `${k} কাঠা ${d.toFixed(2)} শতাংশ`;
  }
  return `${u.decimal.toFixed(2)} শতাংশ`;
}

// ── Point in Polygon (ray casting) ───────────────────────
export function pointInPolygon(pt: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat;
    const xj = poly[j].lng, yj = poly[j].lat;
    if (
      yi > pt.lat !== yj > pt.lat &&
      pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Segment intersection (orientation method) ────────────
type Pt = { x: number; y: number };
const orient = (a: Pt, b: Pt, c: Pt) =>
  (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
const onSeg = (a: Pt, b: Pt, c: Pt) =>
  Math.min(a.x, c.x) <= b.x && b.x <= Math.max(a.x, c.x) &&
  Math.min(a.y, c.y) <= b.y && b.y <= Math.max(a.y, c.y);

export function segmentsIntersect(
  p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng
): boolean {
  const a = { x: p1.lng, y: p1.lat };
  const b = { x: p2.lng, y: p2.lat };
  const c = { x: p3.lng, y: p3.lat };
  const d = { x: p4.lng, y: p4.lat };
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (o1 === 0 && onSeg(a, c, b)) return true;
  if (o2 === 0 && onSeg(a, d, b)) return true;
  if (o3 === 0 && onSeg(c, a, d)) return true;
  if (o4 === 0 && onSeg(c, b, d)) return true;
  return false;
}

/** Segment-segment intersection point (in lng/lat plane), or null */
export function segmentIntersectionPoint(
  p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng
): LatLng | null {
  const x1 = p1.lng, y1 = p1.lat;
  const x2 = p2.lng, y2 = p2.lat;
  const x3 = p3.lng, y3 = p3.lat;
  const x4 = p4.lng, y4 = p4.lat;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-14) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { lng: x1 + t * (x2 - x1), lat: y1 + t * (y2 - y1) };
}

export interface OverlapResult {
  overlap: boolean;
  reason: "edge-cross" | "containment" | "none";
  crossingPoints: LatLng[];
  containedPoints: LatLng[]; // vertices of B inside A + vice versa
}

/**
 * Full polygon-overlap detector:
 * 1) any edge pair crosses → overlap
 * 2) any vertex of A inside B or vice versa → containment overlap
 */
export function polygonsOverlap(A: LatLng[], B: LatLng[]): OverlapResult {
  const crossingPoints: LatLng[] = [];
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < B.length; j++) {
      const a1 = A[i], a2 = A[(i + 1) % A.length];
      const b1 = B[j], b2 = B[(j + 1) % B.length];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        const ip = segmentIntersectionPoint(a1, a2, b1, b2);
        if (ip) crossingPoints.push(ip);
        else crossingPoints.push({ lat: (a1.lat + b1.lat) / 2, lng: (a1.lng + b1.lng) / 2 });
      }
    }
  }
  if (crossingPoints.length > 0) {
    return { overlap: true, reason: "edge-cross", crossingPoints, containedPoints: [] };
  }
  const containedPoints: LatLng[] = [];
  for (const p of A) if (pointInPolygon(p, B)) containedPoints.push(p);
  for (const p of B) if (pointInPolygon(p, A)) containedPoints.push(p);
  if (containedPoints.length > 0) {
    return { overlap: true, reason: "containment", crossingPoints: [], containedPoints };
  }
  return { overlap: false, reason: "none", crossingPoints: [], containedPoints: [] };
}

/** Centroid (average) */
export function centroid(pts: LatLng[]): LatLng {
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
  };
}

/** Bounding box */
export function bbox(pts: LatLng[]) {
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  return {
    minLat: Math.min(...lats), maxLat: Math.max(...lats),
    minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
  };
}

// ── Sutherland–Hodgman polygon clipping against half-plane ──
interface XY { x: number; y: number }

function clipHalfPlane(poly: XY[], axis: "x" | "y", cut: number, keep: "lt" | "gt"): XY[] {
  if (poly.length === 0) return [];
  const out: XY[] = [];
  const inside = (p: XY) => (keep === "lt" ? p[axis] <= cut + 1e-12 : p[axis] >= cut - 1e-12);
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(intersectAxis(prev, cur, axis, cut));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersectAxis(prev, cur, axis, cut));
    }
  }
  return out;
}

function intersectAxis(a: XY, b: XY, axis: "x" | "y", cut: number): XY {
  const t = (cut - a[axis]) / (b[axis] - a[axis] || 1e-12);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function shoelaceXY(poly: XY[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
}

export interface PartitionPiece {
  points: LatLng[];
  areaSqm: number;
  cutLine: [LatLng, LatLng] | null; // the new "আইল" boundary just created for this split
}

export interface PartitionResult {
  pieces: PartitionPiece[];
  axis: "E-W" | "N-S";
  cutLines: [LatLng, LatLng][];
  totalArea: number;
}

/**
 * AUTO-PARTITION ENGINE
 * Splits a polygon into N equal parts (or custom area targets) using
 * iterative bisection along the minor axis of the local-projection bbox.
 * Each cut is found by binary-searching the cut offset so the clipped
 * sub-polygon matches the target area. New GPS points of the "আইল"
 * (divide line) are returned as real LatLng pairs.
 *
 * @param pts polygon vertices
 * @param targets fractions that sum to 1, e.g. [1/3,1/3,1/3] or [0.3, 0.7]
 * @param preferAxis force split direction
 */
export function partitionPolygon(
  pts: LatLng[],
  targets: number[],
  preferAxis?: "E-W" | "N-S"
): PartitionResult {
  const totalArea = polygonAreaSqm(pts);
  if (pts.length < 3 || targets.length < 2) {
    return { pieces: [{ points: pts, areaSqm: totalArea, cutLine: null }], axis: "E-W", cutLines: [], totalArea };
  }
  // Local metric projection
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng0 = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  const kx = EARTH_R * Math.cos(toRad(lat0)) * DEG;
  const ky = EARTH_R * DEG;
  const toXY = (p: LatLng): XY => ({ x: (p.lng - lng0) * kx, y: (p.lat - lng0) * ky });
  const toLL = (p: XY): LatLng => ({ lat: p.y / ky + lat0, lng: p.x / kx + lng0 });

  let xy = pts.map(toXY);
  const xs = xy.map((p) => p.x), ys = xy.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  // Cut along the LONGER axis → slices stacked on the shorter one.
  // E-W means cuts run east-west (stacked north-south) etc.
  let axis: "E-W" | "N-S";
  if (preferAxis) axis = preferAxis;
  else axis = w >= h ? "N-S" : "E-W";
  const cutAxis: "x" | "y" = axis === "N-S" ? "x" : "y";

  const totalXYArea = shoelaceXY(xy);
  const pieces: PartitionPiece[] = [];
  const cutLines: [LatLng, LatLng][] = [];
  let remaining = [...xy];

  const sum = targets.reduce((a, b) => a + b, 0);
  const norm = targets.map((t) => t / sum);

  for (let k = 0; k < norm.length; k++) {
    const isLast = k === norm.length - 1;
    if (isLast) {
      pieces.push({ points: remaining.map(toLL), areaSqm: shoelaceXY(remaining) * (totalArea / totalXYArea), cutLine: null });
      break;
    }
    // target absolute XY-area for this piece (fraction of ORIGINAL total)
    const targetXY = totalXYArea * norm[k];
    // binary search cut position within remaining bbox
    const vals = remaining.map((p) => p[cutAxis]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    let best = (lo + hi) / 2;
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2;
      const part = clipHalfPlane(remaining, cutAxis, mid, "lt");
      const a = shoelaceXY(part);
      if (a < targetXY) lo = mid;
      else hi = mid;
      best = mid;
    }
    const pieceXY = clipHalfPlane(remaining, cutAxis, best, "lt");
    const restXY = clipHalfPlane(remaining, cutAxis, best, "gt");
    // আইল line = intersection of cut plane with remaining polygon:
    const ail = findCutSegment(remaining, cutAxis, best).map(toLL);
    const cutLine: [LatLng, LatLng] | null = ail.length >= 2 ? [ail[0], ail[ail.length - 1]] : null;
    if (cutLine) cutLines.push(cutLine);
    const scale = totalArea / totalXYArea;
    pieces.push({ points: pieceXY.map(toLL), areaSqm: shoelaceXY(pieceXY) * scale, cutLine });
    remaining = restXY;
  }
  return { pieces, axis, cutLines, totalArea };
}

/** Find where the cut plane crosses the polygon → sorted segment endpoints */
function findCutSegment(poly: XY[], axis: "x" | "y", cut: number): XY[] {
  const hits: XY[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a[axis] - cut, db = b[axis] - cut;
    if ((da <= 0 && db >= 0) || (da >= 0 && db <= 0)) {
      if (Math.abs(db - da) < 1e-12) continue;
      hits.push(intersectAxis(a, b, axis, cut));
    }
  }
  const other: "x" | "y" = axis === "x" ? "y" : "x";
  hits.sort((p, q) => p[other] - q[other]);
  return hits;
}

// ── Road frontage ────────────────────────────────────────
export interface EdgeInfo {
  index: number;
  from: LatLng;
  to: LatLng;
  lengthM: number;
  bearingDeg: number;
  compass: string;
}

const COMPASS = ["উত্তর", "উত্তর-পূর্ব", "পূর্ব", "দক্ষিণ-পূর্ব", "দক্ষিণ", "দক্ষিণ-পশ্চিম", "পশ্চিম", "উত্তর-পশ্চিম"];
export function compassBn(brg: number): string {
  return COMPASS[Math.round(brg / 45) % 8];
}

export function polygonEdges(pts: LatLng[]): EdgeInfo[] {
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const b = bearing(p, q);
    return { index: i, from: p, to: q, lengthM: haversine(p, q), bearingDeg: b, compass: compassBn(b) };
  });
}

// ── AR projection helpers ────────────────────────────────
/** Normalize angle difference to [-180, 180] */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export interface ARProjection {
  cornerIndex: number;
  point: LatLng;
  distanceM: number;
  bearingDeg: number;
  relAngle: number; // relative to device heading
  xNorm: number;    // 0..1 across screen (null-ish if behind)
  visible: boolean;
  elevationPx: number; // fake perspective lift by distance
}

/**
 * Lightweight AR projection: map each saved corner to a horizontal
 * screen position from device heading + FOV. No WebXR needed.
 */
export function projectCornersAR(
  corners: LatLng[],
  userPos: LatLng,
  headingDeg: number,
  fovDeg = 70
): ARProjection[] {
  return corners.map((p, i) => {
    const d = haversine(userPos, p);
    const b = bearing(userPos, p);
    const rel = angleDiff(b, headingDeg);
    const visible = Math.abs(rel) <= fovDeg / 2 + 12;
    const xNorm = 0.5 + rel / fovDeg;
    const elevationPx = Math.max(0, 140 - Math.min(d, 140));
    return { cornerIndex: i, point: p, distanceM: d, bearingDeg: b, relAngle: rel, xNorm, visible, elevationPx };
  });
}

export function formatDist(m: number): string {
  if (m < 1000) return `${m.toFixed(1)} মি`;
  return `${(m / 1000).toFixed(2)} কিমি`;
}

export function formatCoord(p: LatLng, digits = 6): string {
  return `${p.lat.toFixed(digits)}, ${p.lng.toFixed(digits)}`;
}
