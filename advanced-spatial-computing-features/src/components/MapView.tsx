import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Plot } from "../lib/store";
import type { LatLng, PartitionResult } from "../lib/geo";
import { centroid } from "../lib/geo";

interface Props {
  plots: Plot[];
  activePlotId: string | null;
  draft: LatLng[];
  livePos: LatLng | null;
  partition: PartitionResult | null;
  partitionPlotId: string | null;
  overlapIds: Set<string>;
  overlapPts: LatLng[];
  measuring: boolean;
  onMapClick: (p: LatLng) => void;
  onSelectPlot: (id: string | null) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const BN_LETTERS = ["\u0995", "\u0996", "\u0997", "\u0998", "\u0999", "\u099A"];

export default function MapView(props: Props) {
  const { plots, activePlotId, draft, livePos, partition, partitionPlotId, overlapIds, overlapPts, measuring } = props;
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const flownTo = useRef<string | null>(null);
  const cbRef = useRef(props);
  cbRef.current = props;

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: false, attributionControl: true }).setView([23.8103, 90.3644], 17);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Esri WorldImagery",
      maxZoom: 20,
    }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      opacity: 0.35,
      maxZoom: 20,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      cbRef.current.onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 300);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const lg = layerRef.current;
    if (!map || !lg) return;
    lg.clearLayers();

    const active = plots.find((p) => p.id === activePlotId);

    plots.forEach((plot) => {
      const isActive = plot.id === activePlotId;
      const isOverlap = overlapIds.has(plot.id);
      const latlngs = plot.points.map((p) => [p.lat, p.lng] as [number, number]);
      const poly = L.polygon(latlngs, {
        color: isOverlap ? "#ef4444" : plot.color,
        weight: isActive ? 3 : 2,
        fillColor: isOverlap ? "#ef4444" : plot.color,
        fillOpacity: isActive ? 0.28 : 0.14,
        dashArray: isOverlap ? "6 6" : undefined,
      });
      poly.bindPopup(
        "<b>" + plot.name + "</b><br/>মালিক: " + plot.owner + "<br/>দাগ: " + plot.dagNo + " · মৌজা: " + plot.mouza + "<br/>কর্নার: " + plot.points.length + "টি · ছবি: " + plot.photos.length + "টি"
      );
      poly.on("click", (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        cbRef.current.onSelectPlot(plot.id);
      });
      lg.addLayer(poly);

      plot.points.forEach((p, i) => {
        const hasPhoto = plot.photos.some((ph) => ph.cornerIndex === i);
        const dot = L.circleMarker([p.lat, p.lng], {
          radius: isActive ? 6 : 4,
          color: "#ffffff",
          weight: 1.5,
          fillColor: hasPhoto ? "#fbbf24" : isOverlap ? "#ef4444" : plot.color,
          fillOpacity: 1,
        });
        dot.bindTooltip("কর্নার " + (i + 1) + (hasPhoto ? " 📷" : ""), { direction: "top", offset: [0, -6] });
        lg.addLayer(dot);
      });

      plot.roadEdges.forEach((ei) => {
        if (ei < 0 || ei >= plot.points.length) return;
        const a = plot.points[ei];
        const b = plot.points[(ei + 1) % plot.points.length];
        const road = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
          color: "#f59e0b",
          weight: 7,
          opacity: 0.9,
          lineCap: "round",
        });
        road.bindTooltip("🛣️ রাস্তা ফ্রন্টেজ", { sticky: true });
        lg.addLayer(road);
      });

      const c = centroid(plot.points);
      const bg = isOverlap ? "#ef4444" : "#0e1a13";
      const bd = isOverlap ? "#fca5a5" : plot.color;
      const label = L.marker([c.lat, c.lng], {
        icon: L.divIcon({
          className: "custom-div",
          html: "<div style='background:" + bg + ";border:1px solid " + bd + ";color:#fff;font-size:11px;font-weight:600;padding:2px 10px;border-radius:999px;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.5)'>" + plot.name + "</div>",
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        interactive: false,
      });
      lg.addLayer(label);
    });

    if (draft.length > 0) {
      const ll = draft.map((p) => [p.lat, p.lng] as [number, number]);
      if (draft.length >= 3) {
        lg.addLayer(
          L.polygon(ll, { color: "#22d3ee", weight: 2, dashArray: "8 6", fillColor: "#22d3ee", fillOpacity: 0.18 })
        );
      } else if (draft.length === 2) {
        lg.addLayer(L.polyline(ll, { color: "#22d3ee", weight: 2, dashArray: "8 6" }));
      }
      draft.forEach((p, i) => {
        lg.addLayer(
          L.circleMarker([p.lat, p.lng], { radius: 6, color: "#fff", weight: 2, fillColor: "#22d3ee", fillOpacity: 1 })
            .bindTooltip("পয়েন্ট " + (i + 1), { direction: "top" })
        );
      });
    }

    if (partition && partitionPlotId) {
      const PIECE_COLORS = ["#34d399", "#fbbf24", "#60a5fa", "#f472b6", "#a78bfa", "#fb923c"];
      partition.pieces.forEach((piece, i) => {
        const ll = piece.points.map((p) => [p.lat, p.lng] as [number, number]);
        const col = PIECE_COLORS[i % PIECE_COLORS.length];
        lg.addLayer(L.polygon(ll, { color: col, weight: 2, fillColor: col, fillOpacity: 0.22 }));
        const c = centroid(piece.points);
        const letter = BN_LETTERS[i] || String(i + 1);
        lg.addLayer(
          L.marker([c.lat, c.lng], {
            icon: L.divIcon({
              className: "custom-div",
              html: "<div style='background:" + col + ";color:#062015;font-size:12px;font-weight:800;width:26px;height:26px;border-radius:999px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.5)'>" + letter + "</div>",
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            }),
            interactive: false,
          })
        );
      });
      partition.cutLines.forEach((line) => {
        lg.addLayer(
          L.polyline([[line[0].lat, line[0].lng], [line[1].lat, line[1].lng]], {
            color: "#ffffff",
            weight: 3,
            dashArray: "10 7",
            opacity: 0.95,
          }).bindTooltip("✂️ নতুন আইল / সীমানা", { sticky: true })
        );
        [line[0], line[1]].forEach((p) => {
          lg.addLayer(
            L.circleMarker([p.lat, p.lng], { radius: 7, color: "#0c1a12", weight: 2, fillColor: "#fff", fillOpacity: 1 })
              .bindTooltip(p.lat.toFixed(6) + ", " + p.lng.toFixed(6), { direction: "top" })
          );
        });
      });
    }

    overlapPts.forEach((p) => {
      lg.addLayer(
        L.circleMarker([p.lat, p.lng], { radius: 8, color: "#fff", weight: 2, fillColor: "#ef4444", fillOpacity: 1 })
          .bindTooltip("⚠️ ওভারল্যাপ পয়েন্ট", { direction: "top" })
      );
    });

    if (livePos) {
      lg.addLayer(
        L.circleMarker([livePos.lat, livePos.lng], {
          radius: 9, color: "#fff", weight: 2.5, fillColor: "#3b82f6", fillOpacity: 1,
        }).bindTooltip("📍 আপনার অবস্থান (লাইভ)", { direction: "top" })
      );
      lg.addLayer(
        L.circle([livePos.lat, livePos.lng], { radius: 12, color: "#3b82f6", weight: 1, fillColor: "#3b82f6", fillOpacity: 0.15, interactive: false })
      );
    }

    if (active && flownTo.current !== active.id) {
      flownTo.current = active.id;
      const b = L.latLngBounds(active.points.map((p) => [p.lat, p.lng] as [number, number]));
      map.flyToBounds(b.pad(0.35), { duration: 0.7 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plots, activePlotId, draft, livePos, partition, partitionPlotId, overlapIds, overlapPts]);

  return (
    <div className="relative h-full w-full">
      <div ref={divRef} className="h-full w-full rounded-2xl overflow-hidden" style={{ minHeight: 420, cursor: measuring ? "crosshair" : "grab" }} />
      {measuring && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] px-4 py-1.5 rounded-full bg-cyan-400/95 text-slate-950 text-xs font-bold shadow-lg shadow-cyan-500/30 animate-pulse whitespace-nowrap">
          ✛ মাপজোখ মোড — ম্যাপে ক্লিক করে কর্নার বসান ({draft.length}টি)
        </div>
      )}
    </div>
  );
}
