import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, Video, VideoOff, Compass, Crosshair, Aperture, RefreshCw, MapPin, Navigation, Image as ImageIcon, Trash2, X } from "lucide-react";
import type { Plot, CornerPhoto } from "../lib/store";
import { uid } from "../lib/store";
import type { LatLng } from "../lib/geo";
import { projectCornersAR, centroid, destination, formatDist, bearing, haversine } from "../lib/geo";
import { playBlip } from "../lib/alert";

interface Props {
  plot: Plot | null;
  onSavePhoto: (plotId: string, photo: CornerPhoto) => void;
  onDeletePhoto: (plotId: string, photoId: string) => void;
}

export default function ARCamera({ plot, onSavePhoto, onDeletePhoto }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  const [cameraOn, setCameraOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [heading, setHeading] = useState(0);
  const [hasCompass, setHasCompass] = useState(false);
  const [pos, setPos] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [simMode, setSimMode] = useState(true);
  const [simHeading, setSimHeading] = useState(20);
  const [simDist, setSimDist] = useState(25);
  const [simAngle, setSimAngle] = useState(200);
  const [targetCorner, setTargetCorner] = useState(0);
  const [flash, setFlash] = useState(false);
  const [preview, setPreview] = useState<CornerPhoto | null>(null);

  const effHeading = simMode ? simHeading : heading;

  // Simulated observer position: standing simDist meters from centroid toward simAngle
  const effPos: LatLng | null = simMode
    ? plot
      ? destination(centroid(plot.points), simAngle, simDist)
      : null
    : pos;

  // ── Camera ──
  const startCamera = useCallback(async () => {
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraOn(true);
      playBlip(880);
    } catch (e) {
      setCamError("ক্যামেরা চালু করা যায়নি — ব্রাউজার পারমিশন দিন বা HTTPS/মোবাইলে চালান। (" + (e as Error).name + ")");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); cancelAnimationFrame(rafRef.current); }, []);

  // ── GPS live ──
  useEffect(() => {
    if (simMode) return;
    if (!("geolocation" in navigator)) { setGpsError("এই ডিভাইসে GPS নেই"); return; };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setAccuracy(p.coords.accuracy);
        setGpsError(null);
      },
      (e) => setGpsError("GPS এরর: " + e.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [simMode]);

  // ── Compass ──
  useEffect(() => {
    const handler = (e: DeviceOrientationEvent) => {
      const h = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof h === "number") { setHeading(h); setHasCompass(true); }
      else if (e.alpha !== null && e.alpha !== undefined) { setHeading((360 - e.alpha) % 360); setHasCompass(true); }
    };
    window.addEventListener("deviceorientation", handler, true);
    return () => window.removeEventListener("deviceorientation", handler, true);
  }, []);

  const requestCompass = async () => {
    try {
      const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (DOE.requestPermission) {
        const r = await DOE.requestPermission();
        if (r === "granted") { setHasCompass(true); playBlip(); }
      }
    } catch { /* noop */ }
  };

  // ── AR overlay render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const W = (canvas.width = canvas.clientWidth * devicePixelRatio);
      const H = (canvas.height = canvas.clientHeight * devicePixelRatio);
      ctx.clearRect(0, 0, W, H);
      const dpr = devicePixelRatio;

      // HUD frame
      ctx.strokeStyle = "rgba(52,211,153,0.55)";
      ctx.lineWidth = 2 * dpr;
      const m = 18 * dpr, L = 34 * dpr;
      // corners
      [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x + L * sx, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + L * sy);
        ctx.stroke();
      });
      // crosshair
      ctx.strokeStyle = "rgba(52,211,153,0.8)";
      ctx.beginPath();
      ctx.moveTo(W / 2 - 14 * dpr, H / 2); ctx.lineTo(W / 2 + 14 * dpr, H / 2);
      ctx.moveTo(W / 2, H / 2 - 14 * dpr); ctx.lineTo(W / 2, H / 2 + 14 * dpr);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 4 * dpr, 0, Math.PI * 2); ctx.stroke();

      if (plot && effPos) {
        const proj = projectCornersAR(plot.points, effPos, effHeading, 72);
        const horizonY = H * 0.62;

        // ground-projected boundary polygon (fake 3D perspective)
        const pts2d = proj.map((p) => {
          const x = p.xNorm * W;
          // closer = lower on screen; farther = toward horizon
          const depthT = Math.min(1, p.distanceM / 120);
          const y = horizonY + (H * 0.32) * (1 - depthT) - p.elevationPx * 0.4 * dpr;
          return { ...p, x, y };
        });

        // fill boundary area
        ctx.beginPath();
        pts2d.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = "rgba(52,211,153,0.10)";
        ctx.fill();

        // boundary edges with glow
        ctx.save();
        ctx.shadowColor = "#34d399";
        ctx.shadowBlur = 12 * dpr;
        ctx.strokeStyle = "#34d399";
        ctx.lineWidth = 3 * dpr;
        ctx.setLineDash([14 * dpr, 8 * dpr]);
        ctx.lineDashOffset = -((Date.now() / 40) % 44);
        ctx.beginPath();
        pts2d.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
        ctx.setLineDash([]);

        // corner markers + labels
        pts2d.forEach((p) => {
          const isTarget = p.cornerIndex === targetCorner;
          const inView = p.xNorm >= -0.05 && p.xNorm <= 1.05;
          const col = isTarget ? "#fbbf24" : "#34d399";
          if (!inView) {
            // off-screen direction arrow
            const ax = p.xNorm < 0 ? 30 * dpr : W - 30 * dpr;
            const ay = H * 0.5;
            ctx.fillStyle = col;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            if (p.xNorm < 0) { ctx.moveTo(ax + 10 * dpr, ay - 10 * dpr); ctx.lineTo(ax - 8 * dpr, ay); ctx.lineTo(ax + 10 * dpr, ay + 10 * dpr); }
            else { ctx.moveTo(ax - 10 * dpr, ay - 10 * dpr); ctx.lineTo(ax + 8 * dpr, ay); ctx.lineTo(ax - 10 * dpr, ay + 10 * dpr); }
            ctx.closePath(); ctx.fill();
            ctx.globalAlpha = 1;
            ctx.font = `700 ${12 * dpr}px 'Hind Siliguri'`;
            ctx.textAlign = "center";
            ctx.fillText("C" + (p.cornerIndex + 1), ax, ay + 26 * dpr);
            return;
          }
          // vertical beacon beam
          const grad = ctx.createLinearGradient(0, p.y, 0, p.y - 150 * dpr);
          grad.addColorStop(0, col);
          grad.addColorStop(1, "transparent");
          ctx.strokeStyle = grad;
          ctx.lineWidth = (isTarget ? 3 : 2) * dpr;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 150 * dpr); ctx.stroke();

          // ground pin
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(p.x, p.y, (isTarget ? 9 : 6) * dpr, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#062015"; ctx.lineWidth = 2 * dpr; ctx.stroke();
          if (isTarget) {
            ctx.strokeStyle = col; ctx.lineWidth = 2 * dpr;
            ctx.beginPath(); ctx.arc(p.x, p.y, (14 + 4 * Math.sin(Date.now() / 220)) * dpr, 0, Math.PI * 2); ctx.stroke();
          }

          // label card
          const ly = p.y - 158 * dpr;
          ctx.font = `700 ${13 * dpr}px 'Hind Siliguri'`;
          const label = "কর্নার " + (p.cornerIndex + 1) + " · " + p.distanceM.toFixed(1) + "মি";
          const tw = ctx.measureText(label).width + 20 * dpr;
          ctx.fillStyle = "rgba(6,20,15,0.85)";
          ctx.strokeStyle = col; ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.roundRect(p.x - tw / 2, ly - 16 * dpr, tw, 26 * dpr, 8 * dpr);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#fff"; ctx.textAlign = "center";
          ctx.fillText(label, p.x, ly + 2 * dpr);
        });

        // heading tape
        ctx.font = `600 ${11 * dpr}px 'JetBrains Mono'`;
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(232,240,234,0.9)";
        const dirs: [number, string][] = [[0, "N"], [90, "E"], [180, "S"], [270, "W"]];
        dirs.forEach(([deg, label]) => {
          let rel = ((deg - effHeading + 540) % 360) - 180;
          if (Math.abs(rel) < 60) {
            const x = W / 2 + (rel / 72) * W;
            ctx.fillText(label + " " + deg + "°", x, 34 * dpr);
          }
        });
        ctx.fillStyle = "#fbbf24";
        ctx.fillText("◤ " + Math.round(effHeading) + "° ◥", W / 2, 56 * dpr);
      } else {
        ctx.fillStyle = "rgba(232,240,234,0.75)";
        ctx.font = `500 ${14 * dpr}px 'Hind Siliguri'`;
        ctx.textAlign = "center";
        ctx.fillText(plot ? "GPS অবস্থানের জন্য অপেক্ষা…" : "প্রথমে একটি প্লট সিলেক্ট করুন", W / 2, H / 2 + 40 * dpr);
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, effPos, effHeading, targetCorner, cameraOn]);

  // ── Capture corner photo ──
  const capture = () => {
    if (!plot || !effPos) return;
    const video = videoRef.current;
    const corner = plot.points[targetCorner];
    let dataUrl = "";
    if (video && cameraOn && video.videoWidth > 0) {
      const c = document.createElement("canvas");
      const scale = Math.min(1, 960 / video.videoWidth);
      c.width = Math.round(video.videoWidth * scale);
      c.height = Math.round(video.videoHeight * scale);
      const cx = c.getContext("2d");
      if (cx) {
        cx.drawImage(video, 0, 0, c.width, c.height);
        // watermark stamp
        cx.fillStyle = "rgba(0,0,0,0.55)";
        cx.fillRect(0, c.height - 44, c.width, 44);
        cx.fillStyle = "#6ee7a8";
        cx.font = "600 15px 'Hind Siliguri'";
        cx.fillText(
          plot.name + " · কর্নার " + (targetCorner + 1) + " · " + corner.lat.toFixed(6) + "," + corner.lng.toFixed(6) + " · " + new Date().toLocaleString("bn-BD"),
          12, c.height - 16
        );
        dataUrl = c.toDataURL("image/jpeg", 0.72);
      }
    } else {
      // simulated capture card when camera unavailable
      const c = document.createElement("canvas");
      c.width = 640; c.height = 400;
      const cx = c.getContext("2d");
      if (cx) {
        const g = cx.createLinearGradient(0, 0, 0, 400);
        g.addColorStop(0, "#0e2a1d"); g.addColorStop(1, "#07120c");
        cx.fillStyle = g; cx.fillRect(0, 0, 640, 400);
        cx.strokeStyle = "#34d399"; cx.lineWidth = 3; cx.strokeRect(14, 14, 612, 372);
        cx.fillStyle = "#6ee7a8"; cx.font = "700 30px 'Hind Siliguri'"; cx.textAlign = "center";
        cx.fillText("সিমুলেটেড কর্নার ক্যাপচার", 320, 150);
        cx.fillStyle = "#e8f0ea"; cx.font = "500 20px 'Hind Siliguri'";
        cx.fillText(plot.name + " · কর্নার " + (targetCorner + 1), 320, 195);
        cx.font = "400 17px monospace";
        cx.fillText(corner.lat.toFixed(6) + ", " + corner.lng.toFixed(6), 320, 230);
        cx.fillStyle = "#fbbf24"; cx.font = "500 16px 'Hind Siliguri'";
        cx.fillText(new Date().toLocaleString("bn-BD") + " · AR ট্যাগড", 320, 265);
        dataUrl = c.toDataURL("image/jpeg", 0.8);
      }
    }
    if (!dataUrl) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 220);
    playBlip(990);
    onSavePhoto(plot.id, {
      id: uid("photo"),
      cornerIndex: targetCorner,
      lat: corner.lat,
      lng: corner.lng,
      dataUrl,
      takenAt: Date.now(),
      accuracyM: accuracy ?? undefined,
    });
  };

  const info = plot && effPos ? {
    toCentroid: haversine(effPos, centroid(plot.points)),
    toTarget: haversine(effPos, plot.points[targetCorner]),
    brgTarget: bearing(effPos, plot.points[targetCorner]),
  } : null;

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      {/* Viewfinder */}
      <div className="lg:col-span-3">
        <div className="relative rounded-2xl overflow-hidden border border-emerald-500/25 bg-black aspect-[4/3] sm:aspect-[16/10]">
          <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
          {!cameraOn && (
            <div className="absolute inset-0 grid-bg flex flex-col items-center justify-center gap-3 p-6 text-center bg-[#070d0a]">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <Video className="w-7 h-7 text-emerald-300" />
              </div>
              <p className="text-sm text-emerald-100/70 max-w-xs">লাইভ AR ভিউয়ের জন্য ক্যামেরা চালু করুন। ক্যামেরা ছাড়াও সিমুলেশন মোডে AR ওভারলে দেখা যাবে।</p>
              {camError && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 max-w-sm">{camError}</p>}
            </div>
          )}
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          {/* scanline */}
          {cameraOn && <div className="absolute left-0 right-0 h-px bg-emerald-300/50 shadow-[0_0_12px_#34d399] pointer-events-none" style={{ animation: "scanline 4s ease-in-out infinite", top: "10%" }} />}
          {flash && <div className="absolute inset-0 bg-white/90 pointer-events-none" />}

          {/* top HUD */}
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 border border-emerald-500/30 backdrop-blur text-xs font-bold">
              <span className={"w-2 h-2 rounded-full " + (cameraOn ? "bg-red-500 animate-pulse" : "bg-amber-400")} />
              <span className="text-emerald-100">{cameraOn ? "LIVE" : "SIM"}</span>
              <span className="text-emerald-100/50">·</span>
              <Navigation className="w-3.5 h-3.5 text-amber-300" />
              <span className="text-amber-200 font-mono2">{Math.round(effHeading)}°</span>
            </div>
            <div className="px-3 py-1.5 rounded-full bg-black/60 border border-emerald-500/30 backdrop-blur text-xs font-bold text-emerald-100 flex items-center gap-1.5">
              <Crosshair className="w-3.5 h-3.5 text-emerald-300" />
              {plot ? plot.name : "প্লট সিলেক্ট করুন"}
            </div>
          </div>

          {/* bottom shutter bar */}
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {!cameraOn ? (
                <button onClick={startCamera} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-400 text-emerald-950 text-sm font-bold hover:bg-emerald-300 transition shadow-lg shadow-emerald-500/30">
                  <Video className="w-4 h-4" /> ক্যামেরা চালু
                </button>
              ) : (
                <button onClick={stopCamera} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 text-white text-sm font-bold border border-white/20 hover:bg-white/20 transition backdrop-blur">
                  <VideoOff className="w-4 h-4" /> বন্ধ
                </button>
              )}
            </div>
            <button
              onClick={capture}
              disabled={!plot || !effPos}
              className="group relative w-16 h-16 rounded-full bg-white/10 border-2 border-white/70 backdrop-blur flex items-center justify-center hover:scale-105 active:scale-95 transition disabled:opacity-40"
              title="কর্নার ছবি তুলুন"
            >
              <span className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-300 to-orange-500 shadow-lg flex items-center justify-center">
                <Aperture className="w-6 h-6 text-orange-950" />
              </span>
            </button>
            <div className="w-[104px] flex justify-end">
              <button onClick={requestCompass} className="p-2.5 rounded-xl bg-white/10 border border-white/20 text-white backdrop-blur hover:bg-white/20" title="কম্পাস পারমিশন">
                <Compass className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* mode + sim controls */}
        <div className="mt-3 rounded-2xl border border-emerald-500/20 bg-[#0c1712] p-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button onClick={() => setSimMode(true)} className={"px-4 py-2 rounded-xl text-sm font-bold transition " + (simMode ? "bg-emerald-400 text-emerald-950" : "bg-white/5 text-emerald-100/60 border border-white/10")}>
              🖥️ সিমুলেশন মোড
            </button>
            <button onClick={() => setSimMode(false)} className={"px-4 py-2 rounded-xl text-sm font-bold transition " + (!simMode ? "bg-emerald-400 text-emerald-950" : "bg-white/5 text-emerald-100/60 border border-white/10")}>
              📡 রিয়েল GPS + কম্পাস
            </button>
            {!simMode && (
              <span className="text-xs text-emerald-100/60 ml-auto flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {pos ? `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)} (±${accuracy?.toFixed(0)}মি)` : gpsError || "GPS খুঁজছে…"}
                {hasCompass ? " · 🧭 কম্পাস OK" : " · 🧭 কম্পাস নেই"}
              </span>
            )}
          </div>
          {simMode ? (
            <div className="grid sm:grid-cols-3 gap-4">
              <label className="block">
                <span className="text-xs text-emerald-100/70 font-semibold">ডিভাইস হেডিং: <b className="text-amber-300 font-mono2">{simHeading}°</b></span>
                <input type="range" min={0} max={359} value={simHeading} onChange={(e) => setSimHeading(+e.target.value)} className="w-full mt-1" />
              </label>
              <label className="block">
                <span className="text-xs text-emerald-100/70 font-semibold">প্লট থেকে দূরত্ব: <b className="text-amber-300 font-mono2">{simDist} মি</b></span>
                <input type="range" min={3} max={150} value={simDist} onChange={(e) => setSimDist(+e.target.value)} className="w-full mt-1" />
              </label>
              <label className="block">
                <span className="text-xs text-emerald-100/70 font-semibold">দাঁড়ানোর দিক: <b className="text-amber-300 font-mono2">{simAngle}°</b></span>
                <input type="range" min={0} max={359} value={simAngle} onChange={(e) => setSimAngle(+e.target.value)} className="w-full mt-1" />
              </label>
            </div>
          ) : (
            <p className="text-xs text-emerald-100/50 leading-relaxed">মাঠে ব্যবহারের সময় মোবাইলটি প্লটের দিকে তাক করে ধরুন — সেভ করা কর্নারগুলোর ওপর সবুজ ভার্চুয়াল সীমানা ও বীকন ভেসে উঠবে। iPhone-এ কম্পাস বাটনে চাপ দিয়ে পারমিশন দিন।</p>
          )}
        </div>
      </div>

      {/* Corner tagging panel */}
      <div className="lg:col-span-2 space-y-4">
        <div className="rounded-2xl border border-amber-400/25 bg-gradient-to-b from-amber-400/10 to-transparent p-4">
          <h3 className="font-bold text-amber-200 flex items-center gap-2 mb-1"><Camera className="w-4 h-4" /> কর্নার ফটো ট্যাগিং</h3>
          <p className="text-xs text-emerald-100/60 mb-3">কোন কর্নারের ছবি তুলছেন তা সিলেক্ট করুন — ছবি সেই কর্নারের GPS-এর সাথে ট্যাগ হয়ে সেভ হবে।</p>
          {!plot ? (
            <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2.5">⚠️ AR ট্যাগিংয়ের জন্য প্রথমে “ম্যাপ ও রেকর্ড” ট্যাব থেকে একটি প্লট সিলেক্ট করুন।</p>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {plot.points.map((c, i) => {
                  const n = plot.photos.filter((p) => p.cornerIndex === i).length;
                  return (
                    <button
                      key={i}
                      onClick={() => { setTargetCorner(i); playBlip(660); }}
                      className={"relative rounded-xl px-2 py-2.5 text-sm font-bold border transition " + (targetCorner === i ? "bg-amber-400 text-amber-950 border-amber-300 shadow-lg shadow-amber-500/25" : "bg-white/5 text-emerald-100 border-white/10 hover:border-amber-400/40")}
                    >
                      C{i + 1}
                      {n > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-emerald-400 text-emerald-950 text-[10px] font-bold flex items-center justify-center">📷{n}</span>}
                      <span className="block text-[9px] font-mono2 font-normal opacity-70">{c.lat.toFixed(4)}</span>
                    </button>
                  );
                })}
              </div>
              {info && (
                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  <div className="rounded-xl bg-black/40 border border-white/10 px-2 py-2">
                    <div className="text-[10px] text-emerald-100/50">লক্ষ্য দূরত্ব</div>
                    <div className="font-bold text-amber-300 font-mono2 text-sm">{formatDist(info.toTarget)}</div>
                  </div>
                  <div className="rounded-xl bg-black/40 border border-white/10 px-2 py-2">
                    <div className="text-[10px] text-emerald-100/50">বিয়ারিং</div>
                    <div className="font-bold text-emerald-300 font-mono2 text-sm">{Math.round(info.brgTarget)}°</div>
                  </div>
                  <div className="rounded-xl bg-black/40 border border-white/10 px-2 py-2">
                    <div className="text-[10px] text-emerald-100/50">কেন্দ্র দূরত্ব</div>
                    <div className="font-bold text-emerald-300 font-mono2 text-sm">{formatDist(info.toCentroid)}</div>
                  </div>
                </div>
              )}
              <button onClick={capture} disabled={!effPos} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-orange-950 font-bold hover:brightness-110 active:scale-[0.98] transition disabled:opacity-40 shadow-lg shadow-orange-500/20">
                <Aperture className="w-5 h-5" /> কর্নার {targetCorner + 1}-এর ছবি তুলুন ও ট্যাগ করুন
              </button>
            </>
          )}
        </div>

        {/* saved photos */}
        <div className="rounded-2xl border border-white/10 bg-[#0c1712] p-4">
          <h3 className="font-bold text-emerald-100 flex items-center gap-2 mb-3">
            <ImageIcon className="w-4 h-4 text-emerald-300" /> ট্যাগড কর্নার ছবি
            <span className="ml-auto text-xs font-mono2 text-emerald-100/50">{plot?.photos.length ?? 0}টি</span>
          </h3>
          {!plot || plot.photos.length === 0 ? (
            <div className="text-center py-6 text-sm text-emerald-100/40">
              <Camera className="w-8 h-8 mx-auto mb-2 opacity-30" />
              এখনো কোনো কর্নার ছবি তোলা হয়নি
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
              {plot.photos.map((ph) => (
                <div key={ph.id} className="relative group rounded-xl overflow-hidden border border-white/10 bg-black cursor-pointer" onClick={() => setPreview(ph)}>
                  <img src={ph.dataUrl} alt={"কর্নার " + (ph.cornerIndex + 1)} className="w-full h-24 object-cover group-hover:scale-105 transition" />
                  <div className="absolute bottom-0 inset-x-0 px-1.5 py-1 bg-gradient-to-t from-black/90 to-transparent text-[10px] font-bold text-emerald-200">
                    C{ph.cornerIndex + 1} · {ph.lat.toFixed(4)},{ph.lng.toFixed(4)}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeletePhoto(plot.id, ph.id); }}
                    className="absolute top-1 right-1 p-1.5 rounded-lg bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={() => { setSimHeading((effHeading + 90) % 360); }} className="w-full flex items-center justify-center gap-2 text-xs text-emerald-100/50 hover:text-emerald-200 py-1">
          <RefreshCw className="w-3.5 h-3.5" /> AR ভিউ রিসেট / ৯০° ঘোরান
        </button>
      </div>

      {/* photo lightbox */}
      {preview && (
        <div className="fixed inset-0 z-[1000] bg-black/85 backdrop-blur flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="max-w-lg w-full rounded-2xl overflow-hidden border border-emerald-500/30 bg-[#0c1712]" onClick={(e) => e.stopPropagation()}>
            <img src={preview.dataUrl} alt="corner" className="w-full max-h-[60vh] object-contain bg-black" />
            <div className="p-4 flex items-center justify-between">
              <div className="text-sm">
                <div className="font-bold text-amber-300">কর্নার C{preview.cornerIndex + 1} — GPS ট্যাগড</div>
                <div className="font-mono2 text-xs text-emerald-100/70">{preview.lat.toFixed(6)}, {preview.lng.toFixed(6)}</div>
                <div className="text-xs text-emerald-100/50">{new Date(preview.takenAt).toLocaleString("bn-BD")}{preview.accuracyM ? ` · ±${preview.accuracyM.toFixed(0)}মি` : ""}</div>
              </div>
              <button onClick={() => setPreview(null)} className="p-2 rounded-xl bg-white/10 hover:bg-white/20"><X className="w-5 h-5" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
