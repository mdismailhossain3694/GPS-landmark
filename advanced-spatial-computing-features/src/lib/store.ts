import type { LatLng } from "./geo";

export interface CornerPhoto {
  id: string;
  cornerIndex: number;
  lat: number;
  lng: number;
  dataUrl: string; // base64 jpeg (compressed)
  takenAt: number;
  accuracyM?: number;
}

export interface Plot {
  id: string;
  name: string;
  owner: string;
  dagNo: string;
  mouza: string;
  points: LatLng[];
  createdAt: number;
  roadEdges: number[]; // edge indices tagged as road frontage
  photos: CornerPhoto[];
  note: string;
  color: string;
}

const KEY = "bhumirecord_plots_v1";

const PALETTE = ["#34d399", "#60a5fa", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#2dd4bf", "#f87171"];

export function loadPlots(): Plot[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedPlots();
    const arr = JSON.parse(raw) as Plot[];
    return Array.isArray(arr) ? arr : seedPlots();
  } catch {
    return seedPlots();
  }
}

export function savePlots(plots: Plot[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(plots));
  } catch (e) {
    console.warn("localStorage full — photos may be too large", e);
  }
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

// Demo seed around Dhaka (Mirpur) — realistic plot shapes
function seedPlots(): Plot[] {
  const now = Date.now();
  return [
    {
      id: "seed_plot_1",
      name: "পৈতৃক ভিটা — প্লট ক",
      owner: "মোঃ রফিকুল ইসলাম",
      dagNo: "১২৪৫",
      mouza: "মিরপুর",
      points: [
        { lat: 23.81035, lng: 90.36425 },
        { lat: 23.81055, lng: 90.36455 },
        { lat: 23.81038, lng: 90.36495 },
        { lat: 23.81012, lng: 90.36472 },
        { lat: 23.81008, lng: 90.36438 },
      ],
      createdAt: now - 86400000 * 12,
      roadEdges: [0],
      photos: [],
      note: "উত্তর পাশে ১২ ফুট পাকা রাস্তা।",
      color: "#34d399",
    },
    {
      id: "seed_plot_2",
      name: "ধানি জমি — প্লট খ",
      owner: "মোসাঃ শারমিন আক্তার",
      dagNo: "৭৮৯",
      mouza: "কেরানীগঞ্জ",
      points: [
        { lat: 23.8094, lng: 90.3656 },
        { lat: 23.80962, lng: 90.36612 },
        { lat: 23.8093, lng: 90.3663 },
        { lat: 23.80908, lng: 90.36585 },
      ],
      createdAt: now - 86400000 * 5,
      roadEdges: [1, 2],
      photos: [],
      note: "দক্ষিণে খাল, পূর্বে আইল রাস্তা।",
      color: "#60a5fa",
    },
  ];
}
