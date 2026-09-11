import { useEffect, useMemo, useState } from "react";
import {
  Map as MapIcon, Camera, Radar, Scissors, FileCode2, Plus, Undo2, X, Save,
  LocateFixed, Trash2, ChevronRight, Landmark, Ruler, Route, Image as ImageIcon,
  Download, AlertTriangle, Crosshair, Sprout, Menu,
} from "lucide-react";
import MapView from "./components/MapView";
import ARCamera from "./components/ARCamera";
import GeofenceMonitor from "./components/GeofenceMonitor";
import PartitionTool, { makePiecePlots } from "./components/PartitionTool";
import OverlapPanel, { findConflicts } from "./components/OverlapPanel";
import ArchPlan from "./components/ArchPlan";
import type { Plot, CornerPhoto } from "./lib/store";
import { loadPlots, savePlots, uid, colorFor } from "./lib/store";
import type { LatLng, PartitionResult } from "./lib/geo";
import {
  polygonAreaSqm, polygonPerimeter, toLandUnits, formatBanglaArea,
  formatCoord, polygonEdges, polygonsOverlap,
} from "./lib/geo";
import { playBlip, playOverlapWarning } from "./lib/alert";

type Tab = "map" | "ar" | "geofence" | "partition" | "arch";

const TABS: { id: Tab; label: string; icon: typeof MapIcon; color: string; desc: string }[] = [
  { id: "map", label: "ম্যাপ ও রেকর্ড", icon: MapIcon, color: "#34d399", desc: "পরিমাপ · সেভ · ওভারল্যাপ চেক" },
  { id: "ar", label: "AR ক্যামেরা", icon: Camera, color: "#fbbf24", desc: "ভার্চুয়াল সীমানা · কর্নার ছবি" },
  { id: "geofence", label: "জিও-ফেন্সিং", icon: Radar, color: "#60a5fa", desc: "লাইভ অডিট · সীমানা অ্যালার্ট" },
  { id: "partition", label: "পার্টিশন", icon: Scissors, color: "#a78bfa", desc: "জমি ভাগ · রোড ফ্রন্টেজ" },
  { id: "arch", label: "আর্কিটেকচার", icon: FileCode2, color: "#2dd4bf", desc: "রিভিউ · কোডিং প্ল্যান" },
];

export default function App() {
  const [plots, setPlots] = useState<Plot[]>(() => loadPlots());
  const [activePlotId, setActivePlotId] = useState<string | null>(() => loadPlots()[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>("map");
  const [measuring, setMeasuring] = useState(false);
  const [draft, setDraft] = useState<LatLng[]>([]);
  const [meta, setMeta] = useState({ name: "", owner: "", dagNo: "", mouza: "", note: "" });
  const [livePos, setLivePos] = useState<LatLng | null>(null);
  const [partition, setPartition] = useState<PartitionResult | null>(null);
  const [partitionPlotId, setPartitionPlotId] = useState<string | null>(null);
  const [forceSave, setForceSave] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => { savePlots(plots); }, [plots]);

  const active = plots.find((p) => p.id === activePlotId) ?? null;

  // conflicts: draft vs saved + pairwise among saved
  const draftConflicts = useMemo(() => findConflicts(draft, plots), [draft, plots]);
  const savedPairConflicts = useMemo(() => {
    const ids = new Set<string>();
    const pts: LatLng[] = [];
    for (let i = 0; i < plots.length; i++) {
      for (let j = i + 1; j < plots.length; j++) {
        const r = polygonsOverlap(plots[i].points, plots[j].points);
        if (r.overlap) {
          ids.add(plots[i].id); ids.add(plots[j].id);
          pts.push(...r.crossingPoints, ...r.containedPoints);
        }
      }
    }
    return { ids, pts };
  }, [plots]);

  const overlapIds = useMemo(() => {
    const s = new Set(savedPairConflicts.ids);
    draftConflicts.forEach((c) => s.add(c.plot.id));
    return s;
  }, [draftConflicts, savedPairConflicts]);
  const overlapPts = useMemo(() => [
    ...savedPairConflicts.pts,
    ...draftConflicts.flatMap((c) => c.pts),
  ], [draftConflicts, savedPairConflicts]);

  useEffect(() => {
    if (draftConflicts.length > 0 && draft.length >= 3) playOverlapWarning();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftConflicts.length]);

  const draftArea = polygonAreaSqm(draft);
  const draftU = toLandUnits(draftArea);

  const totalArea = plots.reduce((s, p) => s + polygonAreaSqm(p.points), 0);

  // ── actions ──
  const onMapClick = (p: LatLng) => {
    if (!measuring) return;
    setDraft((d) => [...d, p]);
    playBlip(660 + draft.length * 40);
  };

  const addGpsPoint = () => {
    if (!("geolocation" in navigator)) return;
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (gp) => {
        setDraft((d) => [...d, { lat: gp.coords.latitude, lng: gp.coords.longitude }]);
        playBlip(880);
        setGpsBusy(false);
      },
      () => setGpsBusy(false),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const saveDraft = () => {
    if (draft.length < 3) return;
    if (draftConflicts.length > 0 && !forceSave) {
      playOverlapWarning();
      setForceSave(true);
      return;
    }
    const plot: Plot = {
      id: uid("plot"),
      name: meta.name.trim() || `প্লট ${plots.length + 1}`,
      owner: meta.owner.trim() || "—",
      dagNo: meta.dagNo.trim() || "—",
      mouza: meta.mouza.trim() || "—",
      points: [...draft],
      createdAt: Date.now(),
      roadEdges: [],
      photos: [],
      note: meta.note.trim(),
      color: colorFor(plots.length),
    };
    setPlots((prev) => [...prev, plot]);
    setActivePlotId(plot.id);
    setDraft([]);
    setMeta({ name: "", owner: "", dagNo: "", mouza: "", note: "" });
    setMeasuring(false);
    setForceSave(false);
    playBlip(990);
  };

  const deletePlot = (id: string) => {
    setPlots((prev) => prev.filter((p) => p.id !== id));
    if (activePlotId === id) setActivePlotId(plots.find((p) => p.id !== id)?.id ?? null);
    if (partitionPlotId === id) { setPartition(null); setPartitionPlotId(null); }
  };

  const savePhoto = (plotId: string, photo: CornerPhoto) => {
    setPlots((prev) => prev.map((p) => (p.id === plotId ? { ...p, photos: [...p.photos, photo] } : p)));
  };
  const deletePhoto = (plotId: string, photoId: string) => {
    setPlots((prev) => prev.map((p) => (p.id === plotId ? { ...p, photos: p.photos.filter((x) => x.id !== photoId) } : p)));
  };
  const updateRoadEdges = (plotId: string, edges: number[]) => {
    setPlots((prev) => prev.map((p) => (p.id === plotId ? { ...p, roadEdges: edges } : p)));
  };
  const savePieces = (res: PartitionResult, base: Plot) => {
    const pieces = makePiecePlots(base, res, plots.length);
    setPlots((prev) => [...prev, ...pieces]);
    setActivePlotId(pieces[0].id);
    setTab("map");
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(plots, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bhumirecord_plots.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const activeEdges = active ? polygonEdges(active.points) : [];
  const activeFrontage = active ? active.roadEdges.reduce((s, ei) => s + (activeEdges[ei]?.lengthM ?? 0), 0) : 0;

  return (
    <div className="min-h-screen bg-[#070d0a] text-emerald-50">
      {/* ── Header ── */}
      <header className="sticky top-0 z-[600] glass border-b border-emerald-500/15">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/25 shrink-0">
            <Landmark className="w-6 h-6 text-emerald-950" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-lg leading-tight truncate">
              ভূমি-রেকর্ড <span className="text-emerald-300">Pro</span>
              <span className="hidden sm:inline text-xs font-normal text-emerald-100/50 ml-2">জমির কোঅর্ডিনেট ও পরিমাপ · AR + Geo-Fence + Partition</span>
            </h1>
            <div className="flex items-center gap-3 text-[11px] text-emerald-100/55 font-mono2">
              <span className="flex items-center gap-1"><Sprout className="w-3 h-3" /> {plots.length}টি প্লট</span>
              <span className="hidden sm:inline">মোট: {formatBanglaArea(totalArea)}</span>
              {overlapIds.size > 0 && <span className="text-red-300 font-bold">⚠️ {overlapIds.size}টি প্লটে ওভারল্যাপ</span>}
            </div>
          </div>
          <button onClick={exportJSON} className="hidden sm:flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-white/5 border border-white/15 hover:border-emerald-400/50 transition">
            <Download className="w-3.5 h-3.5" /> ব্যাকআপ
          </button>
          <button onClick={() => setMobileMenu(!mobileMenu)} className="lg:hidden p-2.5 rounded-xl bg-white/5 border border-white/15">
            {mobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {/* tabs */}
        <nav className={"max-w-7xl mx-auto px-4 pb-3 " + (mobileMenu ? "block" : "hidden lg:block")}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {TABS.map((t) => {
              const Icon = t.icon;
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => { setTab(t.id); setMobileMenu(false); playBlip(700); }}
                  className={"flex items-center gap-2.5 rounded-xl px-3 py-2.5 border text-left transition " + (on ? "bg-white/[0.07]" : "bg-white/[0.02] border-white/10 hover:border-white/25")}
                  style={on ? { borderColor: t.color + "77", boxShadow: `0 0 20px ${t.color}22` } : undefined}
                >
                  <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: t.color + "1e", border: "1px solid " + t.color + "44" }}>
                    <Icon className="w-4.5 h-4.5" style={{ color: t.color, width: 18, height: 18 }} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold leading-tight" style={{ color: on ? t.color : "#e8f0ea" }}>{t.label}</span>
                    <span className="block text-[10px] text-emerald-100/45 leading-tight truncate">{t.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4 pb-20">
        {/* ═══ TAB: MAP ═══ */}
        {tab === "map" && (
          <div className="grid lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 space-y-4">
              <div className="h-[460px] sm:h-[520px] rounded-2xl border border-emerald-500/20 overflow-hidden shadow-2xl shadow-black/50">
                <MapView
                  plots={plots}
                  activePlotId={activePlotId}
                  draft={draft}
                  livePos={livePos}
                  partition={partition}
                  partitionPlotId={partitionPlotId}
                  overlapIds={overlapIds}
                  overlapPts={overlapPts}
                  measuring={measuring}
                  onMapClick={onMapClick}
                  onSelectPlot={(id) => { setActivePlotId(id); }}
                />
              </div>

              {/* measure toolbar */}
              <div className="rounded-2xl border border-cyan-400/25 bg-gradient-to-b from-cyan-400/10 to-transparent p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {!measuring ? (
                    <button onClick={() => { setMeasuring(true); playBlip(740); }} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 text-sky-950 font-bold hover:brightness-110 active:scale-[0.98] transition shadow-lg shadow-cyan-500/20">
                      <Plus className="w-4 h-4" /> নতুন জমি মাপুন
                    </button>
                  ) : (
                    <>
                      <button onClick={addGpsPoint} disabled={gpsBusy} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-sky-400 text-sky-950 text-sm font-bold hover:bg-sky-300 transition disabled:opacity-50">
                        <LocateFixed className={"w-4 h-4 " + (gpsBusy ? "animate-spin" : "")} /> {gpsBusy ? "GPS…" : "+ GPS পয়েন্ট"}
                      </button>
                      <button onClick={() => setDraft((d) => d.slice(0, -1))} disabled={draft.length === 0} className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white/5 border border-white/15 text-sm font-bold hover:bg-white/10 disabled:opacity-40">
                        <Undo2 className="w-4 h-4" /> পূর্বাবস্থা
                      </button>
                      <button onClick={() => { setDraft([]); }} disabled={draft.length === 0} className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white/5 border border-white/15 text-sm font-bold hover:bg-white/10 disabled:opacity-40">
                        <X className="w-4 h-4" /> মুছুন
                      </button>
                      <button onClick={() => { setMeasuring(false); setDraft([]); setForceSave(false); }} className="ml-auto text-xs text-emerald-100/50 hover:text-red-300 px-2 py-1">বাতিল ✕</button>
                    </>
                  )}
                  {draft.length > 0 && (
                    <span className="ml-auto sm:ml-0 text-xs font-mono2 text-cyan-200 bg-cyan-400/10 border border-cyan-400/30 rounded-full px-3 py-1.5">
                      {draft.length} পয়েন্ট · {draftArea.toFixed(1)} m²
                    </span>
                  )}
                </div>

                {measuring && draft.length >= 3 && (
                  <div className="mt-3 rounded-xl bg-black/40 border border-cyan-400/30 px-4 py-3 anim-float-up">
                    <div className="flex items-center gap-2 text-sm">
                      <Ruler className="w-4 h-4 text-cyan-300" />
                      <b className="text-cyan-200 text-base">{formatBanglaArea(draftArea)}</b>
                    </div>
                    <div className="font-mono2 text-[11px] text-emerald-100/60 mt-1">
                      {draftU.decimal.toFixed(2)} শতাংশ · {draftU.katha.toFixed(2)} কাঠা · {draftU.bigha.toFixed(3)} বিঘা · {draftU.sqft.toFixed(1)} বর্গফুট · পরিসীমা {polygonPerimeter(draft).toFixed(1)} মি
                    </div>
                  </div>
                )}

                {measuring && draft.length >= 3 && (
                  <div className="mt-3 space-y-2.5 anim-float-up">
                    <OverlapPanel plots={plots} draft={draft} />
                    <div className="grid sm:grid-cols-2 gap-2">
                      <input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="প্লটের নাম *" className="rounded-xl bg-black/50 border border-white/15 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 placeholder:text-emerald-100/30" />
                      <input value={meta.owner} onChange={(e) => setMeta({ ...meta, owner: e.target.value })} placeholder="মালিকের নাম" className="rounded-xl bg-black/50 border border-white/15 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 placeholder:text-emerald-100/30" />
                      <input value={meta.dagNo} onChange={(e) => setMeta({ ...meta, dagNo: e.target.value })} placeholder="দাগ নম্বর" className="rounded-xl bg-black/50 border border-white/15 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 placeholder:text-emerald-100/30" />
                      <input value={meta.mouza} onChange={(e) => setMeta({ ...meta, mouza: e.target.value })} placeholder="মৌজা" className="rounded-xl bg-black/50 border border-white/15 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 placeholder:text-emerald-100/30" />
                    </div>
                    <button
                      onClick={saveDraft}
                      className={"w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold transition active:scale-[0.98] " + (
                        draftConflicts.length > 0 && !forceSave
                          ? "bg-amber-400/15 border border-amber-400/50 text-amber-200 hover:bg-amber-400/25"
                          : draftConflicts.length > 0
                            ? "bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-lg shadow-red-500/25"
                            : "bg-gradient-to-r from-emerald-400 to-teal-500 text-emerald-950 shadow-lg shadow-emerald-500/20 hover:brightness-110"
                      )}
                    >
                      {draftConflicts.length > 0 && !forceSave ? (
                        <><AlertTriangle className="w-5 h-5" /> ওভারল্যাপ আছে — সতর্কতা দেখুন (আবার চাপুন)</>
                      ) : draftConflicts.length > 0 ? (
                        <><AlertTriangle className="w-5 h-5" /> ⚠️ তবুও সেভ করুন (ওভারল্যাপসহ)</>
                      ) : (
                        <><Save className="w-5 h-5" /> প্লট সেভ করুন</>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* plot list + detail */}
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-[#0c1712] p-4">
                <h3 className="font-bold text-emerald-100 mb-3 flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-emerald-300" /> সংরক্ষিত প্লট
                  <span className="ml-auto text-xs font-mono2 text-emerald-100/50">{plots.length}টি</span>
                </h3>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {plots.map((p) => {
                    const a = polygonAreaSqm(p.points);
                    const on = p.id === activePlotId;
                    const ov = overlapIds.has(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => { setActivePlotId(p.id); playBlip(700); }}
                        className={"w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 border text-left transition " + (on ? "bg-white/[0.07]" : "bg-white/[0.02] border-white/10 hover:border-white/25")}
                        style={on ? { borderColor: (ov ? "#ef4444" : p.color) + "88" } : ov ? { borderColor: "#ef444488" } : undefined}
                      >
                        <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: ov ? "#ef4444" : p.color }} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-bold truncate">{ov ? "⚠️ " : ""}{p.name}</span>
                          <span className="block text-[11px] text-emerald-100/50 truncate">{p.owner} · {formatBanglaArea(a)}</span>
                        </span>
                        <ChevronRight className="w-4 h-4 text-emerald-100/30 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>

              {active ? (
                <div className="rounded-2xl border p-4 anim-float-up" style={{ borderColor: active.color + "55", background: `linear-gradient(to bottom, ${active.color}14, transparent)` }}>
                  <div className="flex items-start gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-lg leading-tight">{active.name}</h3>
                      <p className="text-xs text-emerald-100/55">মালিক: {active.owner} · দাগ: {active.dagNo} · মৌজা: {active.mouza}</p>
                    </div>
                    <button onClick={() => { if (confirm("প্লটটি মুছে ফেলবেন?")) deletePlot(active.id); }} className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20" title="মুছুন">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {(() => {
                    const a = polygonAreaSqm(active.points);
                    const u = toLandUnits(a);
                    return (
                      <>
                        <div className="text-xl font-bold" style={{ color: active.color }}>{formatBanglaArea(a)}</div>
                        <div className="grid grid-cols-3 gap-1.5 mt-2 text-center">
                          {[
                            ["শতাংশ", u.decimal.toFixed(2)],
                            ["কাঠা", u.katha.toFixed(2)],
                            ["বিঘা", u.bigha.toFixed(3)],
                            ["বর্গমিটার", a.toFixed(1)],
                            ["বর্গফুট", u.sqft.toFixed(0)],
                            ["পরিসীমা", polygonPerimeter(active.points).toFixed(1) + "মি"],
                          ].map(([l, v]) => (
                            <div key={l} className="rounded-lg bg-black/40 border border-white/10 px-1 py-1.5">
                              <div className="text-[9px] text-emerald-100/45">{l}</div>
                              <div className="text-[13px] font-bold font-mono2">{v}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                  <div className="flex flex-wrap gap-1.5 mt-3 text-[11px] font-bold">
                    <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10"><Crosshair className="w-3 h-3" /> {active.points.length} কর্নার</span>
                    <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10"><ImageIcon className="w-3 h-3" /> {active.photos.length} ছবি</span>
                    <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-400/10 border border-amber-400/30 text-amber-200"><Route className="w-3 h-3" /> ফ্রন্টেজ {activeFrontage.toFixed(1)}মি</span>
                  </div>
                  {active.note && <p className="mt-2 text-xs text-emerald-100/60 bg-black/30 border border-white/10 rounded-lg px-2.5 py-2">📝 {active.note}</p>}

                  {/* corners */}
                  <details className="mt-3 group">
                    <summary className="cursor-pointer text-xs font-bold text-emerald-200/80 hover:text-emerald-200">📍 কর্নার কোঅর্ডিনেট ({active.points.length}টি) — দেখুন</summary>
                    <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto pr-1">
                      {active.points.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px] font-mono2 bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5">
                          <span className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center font-bold shrink-0">C{i + 1}</span>
                          {formatCoord(c)}
                          {active.photos.some((ph) => ph.cornerIndex === i) && <span title="ছবি আছে">📷</span>}
                        </div>
                      ))}
                    </div>
                  </details>

                  <div className="grid grid-cols-3 gap-1.5 mt-3">
                    <button onClick={() => setTab("ar")} className="text-[11px] font-bold px-2 py-2 rounded-lg bg-amber-400/15 border border-amber-400/40 text-amber-200 hover:bg-amber-400/25">📷 AR দেখুন</button>
                    <button onClick={() => setTab("geofence")} className="text-[11px] font-bold px-2 py-2 rounded-lg bg-sky-400/15 border border-sky-400/40 text-sky-200 hover:bg-sky-400/25">📡 পাহারা দিন</button>
                    <button onClick={() => setTab("partition")} className="text-[11px] font-bold px-2 py-2 rounded-lg bg-violet-400/15 border border-violet-400/40 text-violet-200 hover:bg-violet-400/25">✂️ ভাগ করুন</button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-emerald-100/40">
                  কোনো প্লট সিলেক্ট করা নেই
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ TAB: AR ═══ */}
        {tab === "ar" && <ARCamera plot={active} onSavePhoto={savePhoto} onDeletePhoto={deletePhoto} />}

        {/* ═══ TAB: GEOFENCE ═══ */}
        {tab === "geofence" && (
          <div className="space-y-4">
            <GeofenceMonitor plots={plots} activePlotId={activePlotId} onSelectPlot={setActivePlotId} onLivePos={setLivePos} />
            {livePos && <p className="text-xs text-center text-emerald-100/50">💡 লাইভ অবস্থান “ম্যাপ ও রেকর্ড” ট্যাবে নীল মার্কারে দেখা যাবে</p>}
          </div>
        )}

        {/* ═══ TAB: PARTITION ═══ */}
        {tab === "partition" && (
          <div className="space-y-4">
            <PartitionTool
              plots={plots}
              activePlotId={activePlotId}
              onSelectPlot={setActivePlotId}
              partition={partition}
              onPartition={(p, pid) => { setPartition(p); setPartitionPlotId(pid); }}
              onSavePieces={savePieces}
              onUpdateRoadEdges={updateRoadEdges}
            />
            {partition && (
              <div className="h-[380px] rounded-2xl border border-violet-400/25 overflow-hidden">
                <MapView
                  plots={plots}
                  activePlotId={activePlotId}
                  draft={[]}
                  livePos={null}
                  partition={partition}
                  partitionPlotId={partitionPlotId}
                  overlapIds={new Set()}
                  overlapPts={[]}
                  measuring={false}
                  onMapClick={() => {}}
                  onSelectPlot={setActivePlotId}
                />
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB: ARCH ═══ */}
        {tab === "arch" && <ArchPlan />}
      </main>

      {/* footer */}
      <footer className="border-t border-emerald-500/10 py-5 text-center">
        <p className="text-xs text-emerald-100/40">
          ভূমি-রেকর্ড Pro · Vanilla-geometry Spatial Kernel + Leaflet · ডেটা আপনার ডিভাইসেই থাকে (localStorage) · মাঠ-যাচাইয়ে RTK-GPS ব্যবহার করুন
        </p>
      </footer>
    </div>
  );
}
