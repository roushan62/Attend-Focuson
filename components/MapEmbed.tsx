/**
 * Free map preview via OpenStreetMap embed — no API key, nothing to pay.
 * Shows a pin marker at the project coordinates.
 */
export default function MapEmbed({
  lat, lng, radius = 50, height = 220,
}: { lat: number; lng: number; radius?: number; height?: number }) {
  const dLat = Math.max(0.0015, radius / 111320 / 2 + 0.0015);
  const dLng = Math.max(0.002, dLat / Math.cos((lat * Math.PI) / 180));
  const bbox = `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <iframe
        title="site-map"
        loading="lazy"
        className="w-full"
        style={{ height }}
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`}
      />
    </div>
  );
}
