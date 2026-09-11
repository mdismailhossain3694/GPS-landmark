import { useEffect, useRef, useState, useCallback } from "react";
import { Radar, Play, Square, Volume2, VolumeX, Vibrate, ListChecks, AlertTriangle, ShieldCheck, Footprints, LocateFixed } from "lucide-react";
import type { Plot } from "../lib/store";
import type { LatLng } from "../lib/geo";
import { pointInPolygon, centroid, destination, haversine, bbox } from "../lib/geo";
import { playDeviationAlarm, playBlip } from "../lib/alert";

interface Props {
  plots: Plot[];
  activePlotId: string | null;
  onSelectPlot: (id: string) => void;
  onLivePos: (p: LatLng | null) => void;
}

interface AuditEvent {
  t: number;
  type: "inside" | "exit" | "enter" | "outside" | "start" | "stop";
  lat: number;
  lng: number;
  msg: string;
}

export default function GeofenceMonitor({ plots, activePlotId, onSelectPlot, onLivePos }: Props) {
  const [monitoring, setMonitoring] = useState(false);
  const [simWalk, setSimWalk] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [vibrateOn, setVibrateOn] = useState(true);
  const [status, setStatus] = useState<"idle" | "inside" | "outside">("idle");
  const [pos, setPos] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [breachCount, setBreachCount] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);

  const watchId = useRef<number | null>(null);
  const simTimer = useRef<number | null>(null);
  const lastInside = useRef<boolean | null>(null);
  const monitoringRef = useRef(false);
  monitoringRef.current = monitoring;
  const stateRef = useRef({ activePlotId, soundOn, vibrateOn, cooldownUntil });
  stateRef.current = { activePlotId, soundOn, vibrateOn, cooldownUntil };

  const active = plots.find((p) => p.id === activePlotId);

  const pushEvent = useCallback((e: AuditEvent) => {
    setEvents((prev) => [e, ...prev].slice(0, 60));
  }, []);

  // core audit function — runs on every position fix
  const audit = useCallback((p: LatLng, acc?: number) => {
    const { activePlotId: pid, soundOn: snd, cooldownUntil: cd } = stateRef.current;
    const plot = plots.find((x) => x.id === pid);
    setPos(p);
    onLivePos(p);
    if (acc !== undefined) setAccuracy(acc);
    if (!plot || plot.points.length < 3) return;
    const inside = pointInPolygon(p, plot.points);
    setStatus(inside ? "inside" : "outside");
    const prev = lastInside.current;
    const now = Date.now();

    if (prev === null) {
      pushEvent({ t: now, type: inside ? "inside" : "outside", lat: p.lat, lng: p.lng, msg: inside ? "মনিটরিং শুরু — সীমানার ভেতরে আছেন ✅" : "মনিটরিং শুরু — সীমানার বাইরে আছেন ⚠️" });
      if (!inside) {
        setBreachCount((c) => c + 1);
        if (snd && now > cd) { playDeviationAlarm(2); setCooldownUntil(now + 6000); }
      }
    } else if (prev && !inside) {
      // EXIT breach!
      setBreachCount((c) => c + 1);
      pushEvent({ t: now, type: "exit", lat: p.lat, lng: p.lng, msg: `🚨 সীমানা লঙ্ঘন! "${plot.name}"-এর বাইরে চলে গেছেন` });
      if (snd && now > cd) { playDeviationAlarm(3); setCooldownUntil(now + 8000); }
      else if (stateRef.current.vibrateOn) { try { navigator.vibrate?.([300, 150, 300]); } catch { /* noop */ } }
    } else if (!prev && inside) {
      pushEvent({ t: now, type: "enter", lat: p.lat, lng: p.lng, msg: `✅ পুনরায় সীমানার ভেতরে প্রবেশ — "${plot.name}"` });
      if (snd) playBlip(880);
    }
    lastInside.current = inside;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plots, pushEvent]);

  // simulated walk: path from centroid → outside east → back inside → outside north
  const startSimWalk = useCallback((plot: Plot) => {
    const c = centroid(plot.points);
    const b = bbox(plot.points);
    const diagLat = b.maxLat - b.minLat || 0.0004;
    const waypoints: LatLng[] = [
      c,
      destination(c, 90, haversine(c, { lat: c.lat, lng: b.maxLng }) + 18),   // exit east
      destination(c, 90, haversine(c, { lat: c.lat, lng: b.maxLng }) + 30),
      destination(c, 45, haversine(c, { lat: c.lat, lng: b.maxLng }) + 26),    // roam outside
      { lat: c.lat + diagLat * 0.1, lng: c.lng },                              // re-enter
      c,                                                                       // deep inside
      destination(c, 0, 60),                                                   // exit north
      destination(c, 350, 45),
      c,                                                                       // return
    ];
    let leg = 0, t = 0;
    const STEPS = 26;
    simTimer.current = window.setInterval(() => {
      const a = waypoints[leg];
      const bb = waypoints[(leg + 1) % waypoints.length];
      t += 1 / STEPS;
      if (t >= 1) { t = 0; leg = (leg + 1) % waypoints.length; }
      const p = { lat: a.lat + (bb.lat - a.lat) * t, lng: a.lng + (bb.lng - a.lng) * t };
      audit(p, 4 + Math.random() * 3);
    }, 650);
  }, [audit]);

  const start = () => {
    if (!active) return;
    lastInside.current = null;
    setBreachCount(0);
    setMonitoring(true);
    pushEvent({ t: Date.now(), type: "start", lat: 0, lng: 0, msg: `▶️ লাইভ অডিট শুরু — প্লট: "${active.name}" (${simWalk ? "সিমুলেটেড ওয়াক" : "রিয়েল GPS"})` });
    playBlip(740);
    if (simWalk) {
      startSimWalk(active);
    } else {
      if (!("geolocation" in navigator)) {
        pushEvent({ t: Date.now(), type: "outside", lat: 0, lng: 0, msg: "❌ এই ডিভাইসে GPS সাপোর্ট নেই" });
        setMonitoring(false);
        return;
      }
      watchId.current = navigator.geolocation.watchPosition(
        (gp) => audit({ lat: gp.coords.latitude, lng: gp.coords.longitude }, gp.coords.accuracy),
        (e) => pushEvent({ t: Date.now(), type: "outside", lat: 0, lng: 0, msg: "❌ GPS এরর: " + e.message }),
        { enableHighAccuracy: true, maximumAge: 1500, timeout: 20000 }
      );
    }
  };

  const stop = useCallback(() => {
    setMonitoring(false);
    setStatus("idle");
    if (watchId.current !== null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
    if (simTimer.current !== null) { clearInterval(simTimer.current); simTimer.current = null; }
    setPos(null);
    onLivePos(null);
    pushEvent({ t: Date.now(), type: "stop", lat: 0, lng: 0, msg: "⏹️ মনিটরিং বন্ধ করা হয়েছে" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushEvent]);

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    if (simTimer.current !== null) clearInterval(simTimer.current);
  }, []);

  // keep audit closure fresh when plot selection changes mid-run
  useEffect(() => {
    if (monitoringRef.current) { stop(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlotId]);

  const distToCenter = active && pos ? haversine(pos, centroid(active.points)) : null;

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      {/* Status dashboard */}
      <div className="lg:col-span-2 space-y-4">
        <div className={"relative overflow-hidden rounded-2xl border p-5 transition-colors " + (
          status === "outside" ? "border-red-500/60 bg-gradient-to-b from-red-500/15 to-transparent" :
          status === "inside" ? "border-emerald-500/50 bg-gradient-to-b from-emerald-500/12 to-transparent" :
          "border-white/10 bg-[#0c1712]"
        )}>
          {status === "outside" && <div className="absolute inset-0 border-2 border-red-500 rounded-2xl anim-blink-red pointer-events-none" />}
          <div className="flex items-center gap-3 mb-4">
            <div className={"w-14 h-14 rounded-2xl flex items-center justify-center border " + (
              status === "outside" ? "bg-red-500/20 border-red-500/50" :
              status === "inside" ? "bg-emerald-500/15 border-emerald-500/40" : "bg-white/5 border-white/10"
            )}>
              {status === "outside" ? <AlertTriangle className="w-7 h-7 text-red-400" /> :
               status === "inside" ? <ShieldCheck className="w-7 h-7 text-emerald-300" /> :
               <Radar className="w-7 h-7 text-emerald-100/40" />}
            </div>
            <div>
              <div className="text-[11px] font-bold tracking-widest text-emerald-100/50 uppercase">Geo-Fence Status</div>
              <div className={"text-2xl font-bold " + (status === "outside" ? "text-red-400 text-glow" : status === "inside" ? "text-emerald-300" : "text-emerald-100/40")}>
                {status === "outside" ? "🚨 সীমানার বাইরে!" : status === "inside" ? "✅ সীমানার ভেতরে" : "○ স্ট্যান্ডবাই"}
              </div>
            </div>
            {monitoring && (
              <span className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-red-300 bg-red-500/10 border border-red-500/30 rounded-full px-3 py-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> LIVE
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 text-center mb-4">
            <div className="rounded-xl bg-black/40 border border-white/10 px-2 py-2.5">
              <div className="text-[10px] text-emerald-100/50">লঙ্ঘন সংখ্যা</div>
              <div className={"text-xl font-bold font-mono2 " + (breachCount > 0 ? "text-red-400" : "text-emerald-100")}>{breachCount}</div>
            </div>
            <div className="rounded-xl bg-black/40 border border-white/10 px-2 py-2.5">
              <div className="text-[10px] text-emerald-100/50">কেন্দ্র দূরত্ব</div>
              <div className="text-xl font-bold font-mono2 text-emerald-200">{distToCenter !== null ? distToCenter.toFixed(0) + "মি" : "—"}</div>
            </div>
            <div className="rounded-xl bg-black/40 border border-white/10 px-2 py-2.5">
              <div className="text-[10px] text-emerald-100/50">GPS নির্ভুলতা</div>
              <div className="text-xl font-bold font-mono2 text-emerald-200">{accuracy !== null ? "±" + accuracy.toFixed(0) + "মি" : "—"}</div>
            </div>
          </div>

          {pos && (
            <div className="mb-4 rounded-xl bg-black/40 border border-white/10 px-3 py-2 font-mono2 text-xs text-emerald-100/80 flex items-center gap-2">
              <LocateFixed className="w-4 h-4 text-sky-300 shrink-0" />
              {pos.lat.toFixed(6)}, {pos.lng.toFixed(6)}
            </div>
          )}

          <label className="block text-xs font-semibold text-emerald-100/70 mb-1.5">কোন প্লট পাহারা দেবেন?</label>
          <select
            value={activePlotId ?? ""}
            onChange={(e) => onSelectPlot(e.target.value)}
            className="w-full rounded-xl bg-black/50 border border-white/15 px-3 py-2.5 text-sm font-semibold text-emerald-50 outline-none focus:border-emerald-400 mb-3"
          >
            {plots.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.owner}</option>)}
          </select>

          <div className="flex gap-2 mb-3">
            <button onClick={() => setSimWalk(true)} className={"flex-1 px-3 py-2 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1.5 " + (simWalk ? "bg-sky-400/15 border-sky-400/50 text-sky-200" : "bg-white/5 border-white/10 text-emerald-100/50")}>
              <Footprints className="w-4 h-4" /> সিমুলেটেড ওয়াক
            </button>
            <button onClick={() => setSimWalk(false)} className={"flex-1 px-3 py-2 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1.5 " + (!simWalk ? "bg-sky-400/15 border-sky-400/50 text-sky-200" : "bg-white/5 border-white/10 text-emerald-100/50")}>
              <LocateFixed className="w-4 h-4" /> রিয়েল GPS
            </button>
          </div>

          <div className="flex gap-2">
            {!monitoring ? (
              <button onClick={start} disabled={!active} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 text-emerald-950 font-bold hover:brightness-110 active:scale-[0.98] transition disabled:opacity-40 shadow-lg shadow-emerald-500/20">
                <Play className="w-5 h-5" /> লাইভ ট্র্যাকিং শুরু
              </button>
            ) : (
              <button onClick={stop} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-bold hover:brightness-110 active:scale-[0.98] transition shadow-lg shadow-red-500/25">
                <Square className="w-5 h-5" /> মনিটরিং বন্ধ
              </button>
            )}
            <button onClick={() => setSoundOn(!soundOn)} title="সাউন্ড অলার্ট" className={"p-3 rounded-xl border transition " + (soundOn ? "bg-amber-400/15 border-amber-400/50 text-amber-300" : "bg-white/5 border-white/10 text-emerald-100/40")}>
              {soundOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            <button onClick={() => setVibrateOn(!vibrateOn)} title="ভাইব্রেশন" className={"p-3 rounded-xl border transition " + (vibrateOn ? "bg-violet-400/15 border-violet-400/50 text-violet-300" : "bg-white/5 border-white/10 text-emerald-100/40")}>
              <Vibrate className="w-5 h-5" />
            </button>
          </div>

          <button
            onClick={() => { playDeviationAlarm(2); }}
            className="mt-2 w-full text-xs text-emerald-100/50 hover:text-amber-300 py-1.5 transition"
          >
            🔊 অলার্ট সাউন্ড টেস্ট করুন (বিপ-বিপ)
          </button>
        </div>

        {/* how it works */}
        <div className="rounded-2xl border border-white/10 bg-[#0c1712] p-4 text-xs text-emerald-100/60 leading-relaxed">
          <b className="text-emerald-200">কীভাবে কাজ করে:</b> প্রতি GPS ফিক্সে Ray-Casting অ্যালগরিদমে পয়েন্ট-ইন-পলিগন টেস্ট চলে। ভেতর→বাইরে ট্রানজিশন হলেই Web Audio API-তে ডুয়াল-টোন সাইরেন + Vibration API প্যাটার্ন ফায়ার হয়। প্রতিটি ইভেন্ট ডান পাশের অডিট লগে টাইমস্ট্যাম্পসহ রেকর্ড থাকে।
        </div>
      </div>

      {/* Audit log */}
      <div className="lg:col-span-3 rounded-2xl border border-white/10 bg-[#0c1712] p-4 flex flex-col min-h-[400px]">
        <h3 className="font-bold text-emerald-100 flex items-center gap-2 mb-3">
          <ListChecks className="w-4 h-4 text-emerald-300" /> রিয়েল-টাইম অডিট লগ
          <span className="ml-auto text-xs font-mono2 text-emerald-100/50">{events.length}টি ইভেন্ট</span>
        </h3>
        {events.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-10 text-emerald-100/40">
            <Radar className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">“লাইভ ট্র্যাকিং শুরু” চাপুন —<br />ভেতর/বাইরের প্রতিটি মুভমেন্ট এখানে লগ হবে</p>
          </div>
        ) : (
          <div className="space-y-2 overflow-y-auto max-h-[520px] pr-1">
            {events.map((e, i) => (
              <div key={e.t + "_" + i} className={"anim-float-up rounded-xl px-3 py-2.5 border text-sm flex items-start gap-2.5 " + (
                e.type === "exit" ? "bg-red-500/10 border-red-500/40" :
                e.type === "enter" ? "bg-emerald-500/10 border-emerald-500/40" :
                "bg-white/[0.03] border-white/10"
              )}>
                <span className="text-base leading-none mt-0.5">
                  {e.type === "exit" ? "🚨" : e.type === "enter" ? "✅" : e.type === "start" ? "▶️" : e.type === "stop" ? "⏹️" : "📍"}
                </span>
                <div className="flex-1">
                  <div className={"font-semibold " + (e.type === "exit" ? "text-red-300" : e.type === "enter" ? "text-emerald-300" : "text-emerald-50")}>{e.msg}</div>
                  <div className="text-[11px] font-mono2 text-emerald-100/45 mt-0.5">
                    {new Date(e.t).toLocaleTimeString("bn-BD")}
                    {e.lat !== 0 && ` · ${e.lat.toFixed(6)}, ${e.lng.toFixed(6)}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
