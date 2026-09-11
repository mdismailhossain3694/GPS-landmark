import { useMemo } from "react";
import { AlertTriangle, ShieldCheck, ScanSearch } from "lucide-react";
import type { Plot } from "../lib/store";
import type { LatLng } from "../lib/geo";
import { polygonsOverlap } from "../lib/geo";

interface Props {
  plots: Plot[];
  draft: LatLng[];
  excludeId?: string | null;
}

export interface Conflict {
  plot: Plot;
  reason: string;
  pts: LatLng[];
}

export function findConflicts(draft: LatLng[], plots: Plot[], excludeId?: string | null): Conflict[] {
  if (draft.length < 3) return [];
  const out: Conflict[] = [];
  for (const p of plots) {
    if (p.id === excludeId) continue;
    if (p.points.length < 3) continue;
    const r = polygonsOverlap(draft, p.points);
    if (r.overlap) {
      out.push({
        plot: p,
        reason: r.reason === "edge-cross" ? "সীমানা রেখা ছেদ করেছে" : "একটি প্লট অন্যটির ভেতরে (Containment)",
        pts: [...r.crossingPoints, ...r.containedPoints],
      });
    }
  }
  return out;
}

export default function OverlapPanel({ plots, draft, excludeId }: Props) {
  const conflicts = useMemo(() => findConflicts(draft, plots, excludeId), [draft, plots, excludeId]);

  if (draft.length < 3) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-xs text-emerald-100/50 flex items-center gap-2">
        <ScanSearch className="w-4 h-4 shrink-0" />
        কমপক্ষে ৩টি পয়েন্ট বসালে ওভারল্যাপ চেক স্বয়ংক্রিয়ভাবে চলবে…
      </div>
    );
  }

  if (conflicts.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0" />
        <span className="text-emerald-200 font-semibold">✅ কোনো ওভারল্যাপ নেই — {plots.filter((p) => p.id !== excludeId).length}টি পুরোনো প্লটের সাথে যাচাই সম্পন্ন</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-red-500/50 bg-red-500/10 px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm font-bold text-red-300 mb-1.5">
        <AlertTriangle className="w-4 h-4 anim-blink-red" />
        ⚠️ ওভারল্যাপ শনাক্ত! {conflicts.length}টি প্লটের সাথে সংঘর্ষ
      </div>
      <div className="space-y-1">
        {conflicts.map((c) => (
          <div key={c.plot.id} className="text-xs text-red-200/90 bg-red-950/40 border border-red-500/25 rounded-lg px-2.5 py-1.5 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.plot.color }} />
            <b>{c.plot.name}</b>
            <span className="text-red-200/60">— {c.reason} ({c.pts.length}টি ছেদবিন্দু)</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-red-200/60 mt-1.5">ম্যাপে সংশ্লিষ্ট প্লট লাল রঙে হাইলাইট হয়েছে। সেভ করতে চাইলে “তবুও সেভ করুন” চাপুন।</p>
    </div>
  );
}
