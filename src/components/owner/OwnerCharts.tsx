import { useEffect, useState } from 'react';
import {
  formatHourLabel,
  thinDayLabels,
  zeroFill24Hours,
  type DayCount,
  type HourCount,
  type InsightsRange,
  type PartySizeCount,
  type TopItemCount,
} from '../../lib/owner-ai-helpers';

const MAX_CHART_WIDTH = 600;
const MIN_CHART_WIDTH = 280;

// Charts draw at the real width of their container (up to 600) so that labels
// keep their true pixel size on phones instead of being scaled down with the
// drawing. A callback ref is used so the measurement also starts when a chart
// first receives data after an empty state.
function useChartWidth(): [(node: HTMLDivElement | null) => void, number] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(MAX_CHART_WIDTH);
  useEffect(() => {
    if (!node) return;
    const measure = () =>
      setWidth(
        Math.max(
          MIN_CHART_WIDTH,
          Math.min(MAX_CHART_WIDTH, Math.round(node.clientWidth)),
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width];
}

export function OrdersPerDayChart({
  data,
  range,
}: {
  data: DayCount[];
  range: InsightsRange;
}) {
  const [frameRef, width] = useChartWidth();
  if (!data || data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center border border-ink/20 bg-paper p-4 text-xs text-ink-2">
        No orders recorded for this period.
      </div>
    );
  }

  const thinned = thinDayLabels(data, range);
  const maxVal = Math.max(1, ...data.map((d) => d.count));
  const height = 160;
  const barPadding = 4;
  const barWidth = Math.max(4, width / data.length - barPadding);

  return (
    <div ref={frameRef} className="relative overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height + 30}`}
        className="h-48 w-full overflow-hidden"
        role="img"
        aria-label={`Orders per day chart for ${range}`}
      >
        {/* Baseline */}
        <line
          x1="0"
          y1={height}
          x2={width}
          y2={height}
          stroke="var(--ink)"
          strokeWidth="1"
          strokeOpacity="0.2"
        />

        {data.map((entry, idx) => {
          const barHeight = Math.max(2, (entry.count / maxVal) * (height - 20));
          const x = idx * (barWidth + barPadding);
          const y = height - barHeight;
          const showLabel = thinned[idx]?.showLabel ?? true;

          return (
            <g key={entry.day}>
              <title>{`${entry.day}: ${entry.count} orders`}</title>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                className="fill-brass transition-opacity hover:opacity-80"
              />
              {entry.count > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={y - 4}
                  textAnchor="middle"
                  className="fill-ink text-[10px] font-mono"
                >
                  {entry.count}
                </text>
              )}
              {showLabel && (
                <text
                  x={x + barWidth / 2}
                  y={height + 16}
                  textAnchor="middle"
                  className="fill-ink-2 text-[9px] font-mono"
                >
                  {entry.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Screen reader table */}
      <div className="sr-only">
        <table className="sr-only">
          <caption>Orders per day</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Orders</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td>{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TopItemsChart({ data }: { data: TopItemCount[] }) {
  const [frameRef, width] = useChartWidth();
  if (!data || data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center border border-ink/20 bg-paper p-4 text-xs text-ink-2">
        No menu item orders recorded for this period.
      </div>
    );
  }

  const maxVal = Math.max(1, ...data.map((item) => item.quantity));
  const rowHeight = 26;
  const totalHeight = data.length * rowHeight;
  const labelWidth = Math.min(180, Math.round(width * 0.42));
  const maxNameLength = width < 420 ? 16 : 22;
  const chartWidth = width - labelWidth - 50;

  return (
    <div ref={frameRef} className="relative overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${totalHeight + 10}`}
        className="w-full overflow-hidden"
        height={totalHeight + 10}
        role="img"
        aria-label="Top 10 ordered items chart"
      >
        {data.map((item, idx) => {
          const y = idx * rowHeight;
          const barWidth = Math.max(4, (item.quantity / maxVal) * chartWidth);

          return (
            <g key={item.id}>
              <title>{`${item.name}: ${item.quantity} sold`}</title>
              {/* Item name label */}
              <text
                x={labelWidth - 8}
                y={y + 16}
                textAnchor="end"
                className="fill-ink text-[11px] font-sans"
              >
                {item.name.length > maxNameLength
                  ? `${item.name.slice(0, maxNameLength - 2)}...`
                  : item.name}
              </text>
              {/* Horizontal bar */}
              <rect
                x={labelWidth}
                y={y + 4}
                width={barWidth}
                height={16}
                className="fill-brass transition-opacity hover:opacity-80"
              />
              {/* Count label */}
              <text
                x={labelWidth + barWidth + 6}
                y={y + 16}
                className="fill-ink text-[10px] font-mono font-semibold"
              >
                {item.quantity}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Screen reader table */}
      <div className="sr-only">
        <table className="sr-only">
          <caption>Top ordered items</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Quantity</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{d.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OrdersByHourChart({ data }: { data: HourCount[] }) {
  const [frameRef, width] = useChartWidth();
  const filled = zeroFill24Hours(data || []);
  const maxVal = Math.max(1, ...filled.map((h) => h.count));
  const hasOrders = filled.some((h) => h.count > 0);

  if (!hasOrders) {
    return (
      <div className="flex h-48 items-center justify-center border border-ink/20 bg-paper p-4 text-xs text-ink-2">
        No orders recorded across hours for this period.
      </div>
    );
  }

  const height = 140;
  const barPadding = 3;
  const barWidth = width / 24 - barPadding;

  return (
    <div ref={frameRef} className="relative overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height + 30}`}
        className="h-44 w-full overflow-hidden"
        role="img"
        aria-label="Orders by hour of day chart"
      >
        {/* Baseline */}
        <line
          x1="0"
          y1={height}
          x2={width}
          y2={height}
          stroke="var(--ink)"
          strokeWidth="1"
          strokeOpacity="0.2"
        />

        {filled.map((entry) => {
          const barHeight =
            entry.count > 0
              ? Math.max(3, (entry.count / maxVal) * (height - 20))
              : 0;
          const x = entry.hour * (barWidth + barPadding);
          const y = height - barHeight;
          // Thin hour labels: show 12 AM, 6 AM, 12 PM, 6 PM, 11 PM
          const showLabel =
            entry.hour === 0 ||
            entry.hour === 6 ||
            entry.hour === 12 ||
            entry.hour === 18;

          return (
            <g key={entry.hour}>
              <title>{`${formatHourLabel(entry.hour)}: ${entry.count} orders`}</title>
              <rect
                x={x}
                y={entry.count > 0 ? y : height - 1}
                width={barWidth}
                height={entry.count > 0 ? barHeight : 1}
                className={
                  entry.count > 0
                    ? 'fill-brass transition-opacity hover:opacity-80'
                    : 'fill-ink/10'
                }
              />
              {entry.count > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={y - 3}
                  textAnchor="middle"
                  className="fill-ink text-[9px] font-mono"
                >
                  {entry.count}
                </text>
              )}
              {showLabel && (
                <text
                  x={x + barWidth / 2}
                  y={height + 16}
                  textAnchor="middle"
                  className="fill-ink-2 text-[9px] font-mono"
                >
                  {formatHourLabel(entry.hour)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Screen reader table */}
      <div className="sr-only">
        <table className="sr-only">
          <caption>Orders by hour of day</caption>
          <thead>
            <tr>
              <th scope="col">Hour</th>
              <th scope="col">Orders</th>
            </tr>
          </thead>
          <tbody>
            {filled.map((h) => (
              <tr key={h.hour}>
                <td>{formatHourLabel(h.hour)}</td>
                <td>{h.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BookingsByPartySizeChart({ data }: { data: PartySizeCount[] }) {
  const [frameRef, width] = useChartWidth();
  if (!data || data.length === 0 || data.every((d) => d.count === 0)) {
    return (
      <div className="flex h-48 items-center justify-center border border-ink/20 bg-paper p-4 text-xs text-ink-2">
        No bookings recorded for this period.
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => a.partySize - b.partySize);
  const maxVal = Math.max(1, ...sorted.map((d) => d.count));
  const height = 140;
  const barPadding = 8;
  const barWidth = Math.max(12, width / sorted.length - barPadding);

  return (
    <div ref={frameRef} className="relative overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height + 30}`}
        className="h-44 w-full overflow-hidden"
        role="img"
        aria-label="Bookings by party size chart"
      >
        {/* Baseline */}
        <line
          x1="0"
          y1={height}
          x2={width}
          y2={height}
          stroke="var(--ink)"
          strokeWidth="1"
          strokeOpacity="0.2"
        />

        {sorted.map((entry, idx) => {
          const barHeight = Math.max(2, (entry.count / maxVal) * (height - 20));
          const x = idx * (barWidth + barPadding) + 10;
          const y = height - barHeight;

          return (
            <g key={entry.partySize}>
              <title>{`Party of ${entry.partySize}: ${entry.count} bookings`}</title>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                className="fill-brass transition-opacity hover:opacity-80"
              />
              {entry.count > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={y - 4}
                  textAnchor="middle"
                  className="fill-ink text-[10px] font-mono"
                >
                  {entry.count}
                </text>
              )}
              <text
                x={x + barWidth / 2}
                y={height + 16}
                textAnchor="middle"
                className="fill-ink-2 text-[10px] font-mono"
              >
                {entry.partySize} {entry.partySize === 1 ? 'seat' : 'seats'}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Screen reader table */}
      <div className="sr-only">
        <table className="sr-only">
          <caption>Bookings by party size</caption>
          <thead>
            <tr>
              <th scope="col">Party Size</th>
              <th scope="col">Bookings</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
              <tr key={d.partySize}>
                <td>{d.partySize} seats</td>
                <td>{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
