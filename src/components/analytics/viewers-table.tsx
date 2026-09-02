import type { ViewerRow } from "@/lib/db";
import { deviceFromUserAgent, fmtRelative } from "@/lib/format";

function location(row: ViewerRow): string {
  if (row.city && row.country) return `${row.city}, ${row.country}`;
  return row.country ?? row.city ?? "Unknown";
}

export function ViewersTable({ viewers }: { viewers: ViewerRow[] }) {
  if (viewers.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-surface p-3">
        <h2 className="text-[11px] uppercase tracking-wider text-muted-dim">
          Recent viewers
        </h2>
        <p className="mt-2 text-sm text-muted">No views yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <h2 className="text-[11px] uppercase tracking-wider text-muted-dim">
        Recent viewers
      </h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-dim">
            <tr>
              <th scope="col" className="py-1 pr-3 font-normal">Viewer</th>
              <th scope="col" className="py-1 pr-3 font-normal">Location</th>
              <th scope="col" className="py-1 pr-3 font-normal">Device</th>
              <th scope="col" className="py-1 pr-3 font-normal">When</th>
              <th scope="col" className="py-1 text-right font-normal">Watched</th>
            </tr>
          </thead>
          <tbody className="text-muted">
            {viewers.map((row) => (
              <tr key={row.id} className="border-t border-border-subtle">
                <td className="py-1.5 pr-3 text-foreground">
                  {row.viewer_name?.trim() || "Someone"}
                </td>
                <td className="py-1.5 pr-3">{location(row)}</td>
                <td className="py-1.5 pr-3">{deviceFromUserAgent(row.user_agent)}</td>
                <td className="py-1.5 pr-3">{fmtRelative(row.started_at)}</td>
                <td className="py-1.5 text-right tabular-nums">{row.max_percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
