import { useMemo, useState } from "react";
import { Scissors, SplitSquareHorizontal, Save, Route, Ruler, MapPin, Copy, Check, Trash2, Info } from "lucide-react";
import type { Plot } from "../lib/store";
import { uid, colorFor } from "../lib/store";
import type { PartitionResult } from "../lib/geo";
import { partitionPolygon, polygonAreaSqm, toLandUnits, formatBanglaArea, formatCoord, polygonEdges, haversine } from "../lib/geo";
import { playBlip } from "../lib/alert";

interface Props {
  plots: Plot[];
  activePlotId: string | null;
  onSelectPlot: (id: string) => void;
  partition: PartitionResult | null;
  onPartition: (p: PartitionResult | null, plotId: string | null) => void;
  onSavePieces: (pieces: PartitionResult, basePlot: Plot) => void;
  onUpdateRoadEdges: (plotId: string, edges: number[]) => void;
}

const BN = ["ক", "খ", "গ", "ঘ", "ঙ", "চ"];
const PIECE_COLORS = ["#34d399", "#fbbf24", "#60a5fa", "#f472b6", "#a78bfa", "#fb923c"];

export default function PartitionTool({ plots, activePlotId, onSelectPlot, partition, onPartition, onSavePieces, onUpdateRoadEdges }: Props) {
  const [mode, setMode] = useState<"equal" | "custom">("equal");
  const [parts, setParts] = useState(3);
  const [axis, setAxis] = useState<"auto" | "E-W" | "N-S">("auto");
  const [customKatha, setCustomKatha] = useState<string[]>(["2", "2"]);
  const [copied, setCopied] = useState<string | null>(null);

  const active = plots.find((p) => p.id === activePlotId) ?? null;
  const totalSqm = active ? polygonAreaSqm(active.points) : 0;
  const totalU = toLandUnits(totalSqm);
  const edges = useMemo(() => (active ? polygonEdges(active.points) : []), [active]);

  const customTargets = useMemo(() => {
    const vals = customKatha.map((v) => Math.max(0, parseFloat(v) || 0));
    const sum = vals.reduce((a, b) => a + b, 0);
    if (sum <= 0) return null;
    return vals.map((v) => v / sum);
  }, [customKatha]);

  const runPartition = () => {
    if (!active) return;
    const targets = mode === "equal"
      ? Array.from({ length: parts }, () => 1 / parts)
      : customTargets ?? [0.5, 0.5];
    const res = partitionPolygon(active.points, targets, axis === "auto" ? undefined : axis);
    onPartition(res, active.id);
    playBlip(880);
  };

  const clearPartition = () => onPartition(null, null);

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1400);
  };

  const toggleRoadEdge = (ei: number) => {
    if (!active) return;
    const has = active.roadEdges.includes(ei);
    const next = has ? active.roadEdges.filter((e) => e !== ei) : [...active.roadEdges, ei];
    onUpdateRoadEdges(active.id, next);
    playBlip(has ? 520 : 780);
  };

  const frontageM = active ? active.roadEdges.reduce((s, ei) => s + (edges[ei]?.lengthM ?? 0), 0) : 0;

  const csv = active && partition
    ? "খণ্ড,ক্ষেত্রফল_বর্গমিটার,শতাংশ,কাঠা\n" +
      partition.pieces.map((pc, i) => {
        const u = toLandUnits(pc.areaSqm);
        return `${BN[i] ?? i + 1},${pc.areaSqm.toFixed(2)},${u.decimal.toFixed(2)},${u.katha.toFixed(2)}`;
      }).join("\n") +
      "\nআইল_লাইন,শুরু_lat,শুরু_lng,শেষ_lat,শেষ_lng,দৈর্ঘ্য_মি\n" +
      partition.cutLines.map((ln, i) => `আইল${i + 1},${ln[0].lat.toFixed(7)},${ln[0].lng.toFixed(7)},${ln[1].lat.toFixed(7)},${ln[1].lng.toFixed(7)},${haversine(ln[0], ln[1]).toFixed(2)}`).join("\n")
    : "";

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      {/* Controls */}
      <div className="lg:col-span-2 space-y-4">
        <div className="rounded-2xl border border-violet-400/25 bg-gradient-to-b from-violet-500/10 to-transparent p-4">
          <h3 className="font-bold text-violet-200 flex items-center gap-2 mb-3">
            <Scissors className="w-4 h-4" /> অটো-পার্টিশন ক্যালকুলেটর
          </h3>
          <label className="block text-xs font-semibold text-emerald-100/70 mb-1.5">প্লট সিলেক্ট করুন</label>
          <select
            value={activePlotId ?? ""}
            onChange={(e) => { onSelectPlot(e.target.value); clearPartition(); }}
            className="w-full rounded-xl bg-black/50 border border-white/15 px-3 py-2.5 text-sm font-semibold text-emerald-50 outline-none focus:border-violet-400 mb-3"
          >
            {plots.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {active && (
            <div className="rounded-xl bg-black/40 border border-white/10 px-3 py-2.5 mb-3 text-sm">
              <span className="text-emerald-100/60 text-xs">মোট জমি: </span>
              <b className="text-emerald-200">{formatBanglaArea(totalSqm)}</b>
              <span className="text-emerald-100/50 text-xs font-mono2"> ({totalSqm.toFixed(1)} m² · {totalU.decimal.toFixed(2)} শতাংশ)</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mb-3">
            <button onClick={() => setMode("equal")} className={"px-3 py-2.5 rounded-xl text-sm font-bold border transition flex items-center justify-center gap-1.5 " + (mode === "equal" ? "bg-violet-400 text-violet-950 border-violet-300" : "bg-white/5 border-white/10 text-emerald-100/60")}>
              <SplitSquareHorizontal className="w-4 h-4" /> সমান ভাগ
            </button>
            <button onClick={() => setMode("custom")} className={"px-3 py-2.5 rounded-xl text-sm font-bold border transition flex items-center justify-center gap-1.5 " + (mode === "custom" ? "bg-violet-400 text-violet-950 border-violet-300" : "bg-white/5 border-white/10 text-emerald-100/60")}>
              <Ruler className="w-4 h-4" /> নির্দিষ্ট কাঠা
            </button>
          </div>

          {mode === "equal" ? (
            <label className="block mb-3">
              <span className="text-xs text-emerald-100/70 font-semibold">কয় ভাগ হবে? <b className="text-violet-300 text-base font-mono2">{parts} ভাগ</b> <span className="text-emerald-100/50">(প্রতি ভাগ ≈ {totalSqm > 0 ? formatBanglaArea(totalSqm / parts) : "—"})</span></span>
              <input type="range" min={2} max={6} value={parts} onChange={(e) => setParts(+e.target.value)} className="w-full mt-1" />
            </label>
          ) : (
            <div className="mb-3">
              <div className="text-xs text-emerald-100/70 font-semibold mb-1.5">প্রতি খণ্ডের জমি (কাঠায় লিখুন):</div>
              <div className="space-y-1.5">
                {customKatha.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold shrink-0" style={{ background: PIECE_COLORS[i % PIECE_COLORS.length] + "22", color: PIECE_COLORS[i % PIECE_COLORS.length], border: "1px solid " + PIECE_COLORS[i % PIECE_COLORS.length] + "55" }}>{BN[i] ?? i + 1}</span>
                    <input
                      type="number" min="0" step="0.1" value={v}
                      onChange={(e) => setCustomKatha((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                      className="flex-1 rounded-xl bg-black/50 border border-white/15 px-3 py-2 text-sm font-mono2 text-emerald-50 outline-none focus:border-violet-400"
                    />
                    <span className="text-xs text-emerald-100/50">কাঠা</span>
                    {customKatha.length > 2 && (
                      <button onClick={() => setCustomKatha((p) => p.filter((_, j) => j !== i))} className="p-2 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                {customKatha.length < 6 && (
                  <button onClick={() => setCustomKatha((p) => [...p, "1"])} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-violet-200 hover:border-violet-400/50">+ খণ্ড যোগ</button>
                )}
                <span className="text-[11px] text-emerald-100/50 self-center">মোট: {(customKatha.reduce((a, v) => a + (parseFloat(v) || 0), 0)).toFixed(2)} কাঠা (আনুপাতিক হারে ভাগ হবে)</span>
              </div>
            </div>
          )}

          <div className="text-xs text-emerald-100/70 font-semibold mb-1.5">আইল কোন দিকে যাবে?</div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {(["auto", "N-S", "E-W"] as const).map((a) => (
              <button key={a} onClick={() => setAxis(a)} className={"px-2 py-2 rounded-xl text-xs font-bold border transition " + (axis === a ? "bg-violet-400/20 border-violet-400/60 text-violet-200" : "bg-white/5 border-white/10 text-emerald-100/50")}>
                {a === "auto" ? "🤖 অটো" : a === "N-S" ? "↕️ উত্তর-দক্ষিণ" : "↔️ পূর্ব-পশ্চিম"}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={runPartition} disabled={!active} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-violet-400 to-fuchsia-500 text-violet-950 font-bold hover:brightness-110 active:scale-[0.98] transition disabled:opacity-40 shadow-lg shadow-violet-500/20">
              <Scissors className="w-4 h-4" /> জমি ভাগ করুন
            </button>
            {partition && (
              <button onClick={clearPartition} className="px-4 py-3 rounded-xl bg-white/5 border border-white/15 text-sm font-bold text-emerald-100/70 hover:bg-white/10">মুছুন</button>
            )}
          </div>
        </div>

        {/* Road frontage */}
        <div className="rounded-2xl border border-amber-400/25 bg-gradient-to-b from-amber-400/10 to-transparent p-4">
          <h3 className="font-bold text-amber-200 flex items-center gap-2 mb-1"><Route className="w-4 h-4" /> রোড ফ্রন্টেজ ও সাইড ট্যাগিং</h3>
          <p className="text-xs text-emerald-100/60 mb-3">প্লটের কোন বাহু দিয়ে রাস্তা গেছে তা টিক দিন — ম্যাপে কমলা মোটা লাইনে দেখাবে।</p>
          {!active ? (
            <p className="text-sm text-emerald-100/40">প্লট সিলেক্ট করুন</p>
          ) : (
            <>
              <div className="space-y-1.5 mb-3 max-h-48 overflow-y-auto pr-1">
                {edges.map((e) => {
                  const on = active.roadEdges.includes(e.index);
                  return (
                    <button
                      key={e.index}
                      onClick={() => toggleRoadEdge(e.index)}
                      className={"w-full flex items-center gap-2.5 rounded-xl px-3 py-2 border text-sm transition " + (on ? "bg-amber-400/15 border-amber-400/60" : "bg-white/[0.03] border-white/10 hover:border-amber-400/40")}
                    >
                      <span className={"w-5 h-5 rounded-md border flex items-center justify-center shrink-0 " + (on ? "bg-amber-400 border-amber-300 text-amber-950" : "border-white/25 text-transparent")}>
                        <Check className="w-3.5 h-3.5" />
                      </span>
                      <span className="font-semibold text-emerald-50">বাহু {e.index + 1} <span className="text-emerald-100/40 font-normal">(C{e.index + 1}→C{(e.index + 1) % edges.length + 1})</span></span>
                      <span className="ml-auto font-mono2 text-xs text-amber-200">{e.lengthM.toFixed(1)}মি</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-emerald-100/70">🧭 {e.compass}</span>
                    </button>
                  );
                })}
              </div>
              <div className="rounded-xl bg-black/40 border border-amber-400/30 px-3 py-2.5 flex items-center gap-2">
                <Route className="w-4 h-4 text-amber-300" />
                <span className="text-sm text-emerald-100/70">মোট ফ্রন্টেজ:</span>
                <b className="text-amber-300 font-mono2">{frontageM.toFixed(2)} মিটার</b>
                <span className="text-xs text-emerald-100/50 font-mono2">({(frontageM * 3.28084).toFixed(1)} ফুট)</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="lg:col-span-3 space-y-4">
        {!partition || !active ? (
          <div className="rounded-2xl border border-dashed border-violet-400/30 bg-violet-500/5 p-10 text-center">
            <Scissors className="w-10 h-10 mx-auto mb-3 text-violet-300/50" />
            <p className="font-bold text-violet-200">এখনো ভাগ করা হয়নি</p>
            <p className="text-sm text-emerald-100/50 mt-1 max-w-sm mx-auto">বাম পাশ থেকে প্লট, ভাগের সংখ্যা ও আইলের দিক বেছে “জমি ভাগ করুন” চাপুন — নতুন সীমানার GPS পয়েন্টসহ ফলাফল এখানে ও ম্যাপে দেখাবে।</p>
            <div className="mt-4 inline-flex items-start gap-2 text-left text-[11px] text-emerald-100/50 bg-black/30 border border-white/10 rounded-xl px-3 py-2 max-w-md">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-violet-300" />
              <span><b className="text-violet-200">অ্যালগরিদম:</b> Binary-search + Sutherland–Hodgman ক্লিপিং — কাঙ্ক্ষিত ক্ষেত্রফল না মেলা পর্যন্ত কাট-লাইন সরিয়ে ৬০ ইটারেশনে নির্ভুল (±0.01%) ভাগ নিশ্চিত করা হয়।</span>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-violet-400/30 bg-[#0e1420] p-4">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <h3 className="font-bold text-violet-100">✂️ ভাগের ফলাফল — {active.name}</h3>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-violet-400/15 border border-violet-400/40 text-violet-200">
                  আইল দিক: {partition.axis === "N-S" ? "↕️ উত্তর-দক্ষিণ" : "↔️ পূর্ব-পশ্চিম"}
                </span>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => copy(csv, "csv")} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-emerald-100 hover:border-violet-400/50">
                    {copied === "csv" ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />} CSV কপি
                  </button>
                  <button onClick={() => { onSavePieces(partition, active); playBlip(990); }} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-emerald-400 text-emerald-950 hover:bg-emerald-300">
                    <Save className="w-3.5 h-3.5" /> খণ্ডগুলো প্লট হিসেবে সেভ
                  </button>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {partition.pieces.map((pc, i) => {
                  const u = toLandUnits(pc.areaSqm);
                  const col = PIECE_COLORS[i % PIECE_COLORS.length];
                  return (
                    <div key={i} className="rounded-xl border bg-black/40 p-3" style={{ borderColor: col + "55" }}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="w-8 h-8 rounded-xl flex items-center justify-center font-bold" style={{ background: col, color: "#062015" }}>{BN[i] ?? i + 1}</span>
                        <div>
                          <div className="font-bold text-sm" style={{ color: col }}>খণ্ড {BN[i] ?? i + 1}</div>
                          <div className="text-[11px] text-emerald-100/50">{pc.points.length}টি কর্নার</div>
                        </div>
                        <span className="ml-auto font-mono2 text-xs text-emerald-100/60">{((pc.areaSqm / partition.totalArea) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="text-sm font-bold text-emerald-50">{formatBanglaArea(pc.areaSqm)}</div>
                      <div className="font-mono2 text-[11px] text-emerald-100/50">{pc.areaSqm.toFixed(2)} m² · {u.decimal.toFixed(2)} শতাংশ · {u.katha.toFixed(2)} কাঠা</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-white/15 bg-[#0c1712] p-4">
              <h3 className="font-bold text-emerald-100 flex items-center gap-2 mb-1">
                <MapPin className="w-4 h-4 text-white" /> নতুন আইলের GPS পয়েন্ট <span className="text-xs font-normal text-emerald-100/50">(মাঠে এই দুই পয়েন্টে খুঁটি গাড়ুন)</span>
              </h3>
              <div className="space-y-2 mt-3">
                {partition.cutLines.map((ln, i) => (
                  <div key={i} className="rounded-xl border border-dashed border-white/25 bg-black/40 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold px-2 py-1 rounded-lg bg-white text-slate-900">আইল {i + 1}</span>
                      <span className="text-xs font-mono2 text-emerald-100/60">দৈর্ঘ্য: {haversine(ln[0], ln[1]).toFixed(2)} মি ({(haversine(ln[0], ln[1]) * 3.28084).toFixed(1)} ফুট)</span>
                      <button onClick={() => copy(`${ln[0].lat.toFixed(7)},${ln[0].lng.toFixed(7)} → ${ln[1].lat.toFixed(7)},${ln[1].lng.toFixed(7)}`, "ail" + i)} className="ml-auto text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/15 text-emerald-100 hover:border-emerald-400/50 flex items-center gap-1">
                        {copied === "ail" + i ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} কপি
                      </button>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {[ln[0], ln[1]].map((p, j) => (
                        <div key={j} className="flex items-center gap-2 rounded-lg bg-white/[0.04] border border-white/10 px-2.5 py-2">
                          <span className={"w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 " + (j === 0 ? "bg-emerald-400 text-emerald-950" : "bg-sky-400 text-sky-950")}>{j === 0 ? "S" : "E"}</span>
                          <span className="font-mono2 text-xs text-emerald-100">{formatCoord(p, 7)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function makePiecePlots(base: Plot, res: PartitionResult, startIdx: number): Plot[] {
  const BN2 = ["ক", "খ", "গ", "ঘ", "ঙ", "চ"];
  return res.pieces.map((pc, i) => ({
    id: uid("plot"),
    name: `${base.name} — খণ্ড ${BN2[i] ?? i + 1}`,
    owner: base.owner,
    dagNo: base.dagNo,
    mouza: base.mouza,
    points: pc.points,
    createdAt: Date.now(),
    roadEdges: [],
    photos: [],
    note: `অটো-পার্টিশন থেকে তৈরি (মূল: ${base.name})`,
    color: colorFor(startIdx + i),
  }));
}
