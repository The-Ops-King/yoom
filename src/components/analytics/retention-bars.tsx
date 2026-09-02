const WIDTH = 300;
const HEIGHT = 90;
const GAP = 3;

/**
 * Ten buckets of "furthest point reached": 0–10%, 10–20% … 90–100%.
 * Inline SVG so there is no chart dependency and it renders on the server.
 */
export function RetentionBars({ buckets }: { buckets: number[] }) {
  const max = Math.max(1, ...buckets);
  const barWidth = (WIDTH - GAP * (buckets.length - 1)) / buckets.length;

  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <h2 className="text-[11px] uppercase tracking-wider text-muted-dim">
        Retention
      </h2>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Retention histogram: ${buckets
          .map((count, index) => `${index * 10}–${index * 10 + 10}%: ${count}`)
          .join(", ")}`}
        className="mt-2 w-full"
      >
        {buckets.map((count, index) => {
          const height = Math.max(2, (count / max) * (HEIGHT - 8));
          return (
            <rect
              key={index}
              x={index * (barWidth + GAP)}
              y={HEIGHT - height}
              width={barWidth}
              height={height}
              rx={2}
              fill={count === 0 ? "#2e2e35" : "#e85a4f"}
            />
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-dim">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </section>
  );
}
