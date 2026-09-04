import type { VideoStats } from "@/lib/db";

export function StatTiles({ stats }: { stats: VideoStats }) {
  const tiles = [
    { label: "Views", value: String(stats.views) },
    { label: "Unique viewers", value: String(stats.unique) },
    { label: "Avg watched", value: `${stats.avgMaxPercent}%` },
  ];

  return (
    <dl className="grid grid-cols-3 gap-2">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-xl border border-border bg-surface px-3 py-3"
        >
          <dt className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-dim">
            {tile.label}
          </dt>
          <dd className="mt-1 text-xl font-semibold text-foreground">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
