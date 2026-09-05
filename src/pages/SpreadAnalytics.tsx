import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  AlertCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────
interface RateEntry {
  buy: number;
  sell: number;
  timestamp: string;
}

interface RatesResponse {
  status: string;
  source?: string;
  rates: Record<string, RateEntry>;
}

interface HistoryPoint {
  time: string;
  buy: number;
  sell: number;
  mid: number;
  spread: number;
  marginPct: number;
}

// ─── Constants ─────────────────────────────────────────────────
const POLL_INTERVAL = 10_000; // 10s
const MAX_HISTORY = 30;
const PAIRS = ["USD_MXN", "EUR_MXN", "GBP_MXN", "CAD_MXN", "USDT_MXN"];

// System colors (src/index.css @theme)
const C = {
  yellow: "#f9b916",
  green: "#0ECB81",
  red: "#F6465D",
  cream: "#f4eadb",
  grid: "#252a31",
  axis: "#6b7280",
};

const mono = "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace";

// ─── Formatters ────────────────────────────────────────────────
const fmt4 = (n: number | undefined) => (n ?? 0).toFixed(4);
const fmt2 = (n: number | undefined) => (n ?? 0).toFixed(2);
const fmtPct = (n: number | undefined) => `${fmt2(n)}%`;

// ─── Custom Tooltip ────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#2b3139] bg-[#0b0e11]/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-[10px] text-gray-500 mb-2" style={{ fontFamily: mono }}>
        {label}
      </p>
      {payload.map((p: any) => (
        <div
          key={p.dataKey}
          className="flex items-center gap-2 text-xs py-0.5"
          style={{ fontFamily: mono }}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: p.color }}
          />
          <span className="text-gray-400">{p.name}</span>
          <span className="text-white font-medium ml-auto tabular-nums">
            {p.dataKey === "marginPct" ? fmtPct(p.value) : fmt4(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Rate Card ─────────────────────────────────────────────────
function RateCard({
  title,
  value,
  color,
  icon,
  subtitle,
}: {
  title: string;
  value?: number;
  color: string;
  icon: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl p-4 transition-colors hover:border-[#3b444f]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-400 text-xs font-medium">{title}</span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-gray-600 text-sm" style={{ fontFamily: mono }}>
          $
        </span>
        <span
          className="text-2xl font-semibold tracking-tight tabular-nums"
          style={{ fontFamily: mono, color }}
        >
          {value !== undefined ? fmt4(value) : "—"}
        </span>
      </div>
      {subtitle && <p className="text-[10px] text-gray-600 mt-1.5">{subtitle}</p>}
    </div>
  );
}

// ─── Row ───────────────────────────────────────────────────────
function Row({
  label,
  value,
  color,
  formatter,
  bold,
}: {
  label: string;
  value?: number;
  color: string;
  formatter?: (n: number) => string;
  bold?: boolean;
}) {
  const fmt = formatter ?? ((n: number) => fmt4(n));
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className="text-xs text-gray-400">{label}</span>
      <span
        className={`text-sm tabular-nums ${bold ? "font-semibold" : "font-medium"}`}
        style={{ fontFamily: mono, color }}
      >
        {value !== undefined ? fmt(value) : "—"}
      </span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────
export default function SpreadAnalytics() {
  const [rates, setRates] = useState<Record<string, RateEntry>>({});
  const [selectedPair, setSelectedPair] = useState("USD_MXN");
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState("");

  // Fetch live rates + accumulate history on every poll
  useEffect(() => {
    let mounted = true;
    setHistory([]);
    setLoading(true);
    setError(null);

    const doFetch = async () => {
      try {
        const res = await fetch("/api/rates/live");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: RatesResponse = await res.json();
        if (!mounted) return;

        if (data.status === "success" && data.rates) {
          setRates(data.rates);
          setError(null);
          setLastUpdate(new Date().toLocaleTimeString("es-MX"));

          const pair = data.rates[selectedPair];
          if (pair && pair.buy > 0) {
            const mid = (pair.buy + pair.sell) / 2;
            const spread = pair.sell - pair.buy;
            const marginPct = (spread / pair.buy) * 100;
            const now = new Date();
            setHistory((prev) =>
              [
                ...prev,
                {
                  time: now.toLocaleTimeString("es-MX", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }),
                  buy: pair.buy,
                  sell: pair.sell,
                  mid,
                  spread,
                  marginPct,
                },
              ].slice(-MAX_HISTORY),
            );
          }
        } else {
          if (mounted) setError("Respuesta inesperada del servidor");
        }
      } catch {
        if (mounted) setError("No se pudo conectar al servidor de tasas");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    doFetch();
    const interval = setInterval(doFetch, POLL_INTERVAL);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [selectedPair]);

  // ─── Derived values ──────────────────────────────────────────
  const current = rates[selectedPair];
  const currentMid: number | undefined = current
    ? (current.buy + current.sell) / 2
    : undefined;
  const currentSpread: number | undefined = current
    ? current.sell - current.buy
    : undefined;
  const currentMargin: number | undefined =
    current && current.buy > 0 && currentSpread !== undefined
      ? (currentSpread / current.buy) * 100
      : undefined;
  const pairLabel = selectedPair.replace("_", "/");
  const baseCcy = pairLabel.split("/")[0];

  return (
    <div className="space-y-4 lg:space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold tracking-tight text-white">
            Analítica de Spread
          </h1>
          <p className="text-gray-400 text-xs lg:text-sm mt-1">
            Tipos de cambio en tiempo real · Metodología FIFO
          </p>
        </div>
        <div className="flex items-center gap-2 lg:gap-3">
          {/* Pair selector */}
          <div className="bg-[#1e2329] border border-[#2b3139] rounded-lg px-3 py-2">
            <select
              value={selectedPair}
              onChange={(e) => setSelectedPair(e.target.value)}
              className="bg-transparent text-sm text-white font-medium outline-none cursor-pointer"
            >
              {PAIRS.map((p) => (
                <option key={p} value={p} className="bg-[#1e2329]">
                  {p.replace("_", "/")}
                </option>
              ))}
            </select>
          </div>
          {/* Live indicator */}
          <div className="flex items-center gap-2 bg-[#1e2329] border border-[#2b3139] rounded-lg px-3 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-gray-400 font-mono">
              {lastUpdate || "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500 flex items-center justify-center gap-2">
          <Activity size={16} className="animate-pulse" />
          Conectando al feed de tasas...
        </div>
      ) : (
        <>
          {/* Rate Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
            <RateCard
              title="Tasa de Compra"
              value={current?.buy}
              color={C.green}
              icon={<ArrowDownRight size={16} />}
              subtitle="Compra ventanilla · buy"
            />
            <RateCard
              title="Mid-Market"
              value={currentMid}
              color={C.cream}
              icon={<Activity size={16} />}
              subtitle="Punto medio (buy + sell) / 2"
            />
            <RateCard
              title="Tasa de Venta"
              value={current?.sell}
              color={C.yellow}
              icon={<ArrowUpRight size={16} />}
              subtitle="Liquidación P2P · sell"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart */}
            <div className="col-span-1 lg:col-span-2 bg-[#1e2329] border border-[#2b3139] rounded-2xl p-5 lg:p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-base font-medium text-white">
                    Historial de Spread — {pairLabel}
                  </h2>
                  <p className="text-[10px] text-gray-500 mt-0.5 font-mono">
                    Poll cada {POLL_INTERVAL / 1000}s · {history.length} pts
                  </p>
                </div>
                <TrendingUp size={18} className="text-gray-600" />
              </div>

              <div className="h-72 w-full min-h-[300px]">
                {history.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={history}
                      margin={{ top: 5, right: 15, bottom: 5, left: -10 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={C.grid}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="time"
                        stroke={C.axis}
                        tick={{
                          fill: C.axis,
                          fontSize: 10,
                          fontFamily: "monospace",
                        }}
                        tickLine={false}
                        axisLine={{ stroke: C.grid }}
                        minTickGap={40}
                      />
                      <YAxis
                        yAxisId="left"
                        domain={["dataMin - 0.02", "dataMax + 0.02"]}
                        stroke={C.axis}
                        tick={{
                          fill: C.axis,
                          fontSize: 10,
                          fontFamily: "monospace",
                        }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => Number(v).toFixed(2)}
                        width={50}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        domain={["dataMin - 0.05", "dataMax + 0.05"]}
                        stroke={C.red}
                        tick={{
                          fill: C.red,
                          fontSize: 10,
                          fontFamily: "monospace",
                        }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${Number(v).toFixed(2)}%`}
                        width={55}
                      />
                      <RechartsTooltip content={<ChartTooltip />} />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={8}
                        wrapperStyle={{
                          fontSize: "11px",
                          color: "#9ca3af",
                          fontFamily: "monospace",
                        }}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="sell"
                        name="Venta"
                        stroke={C.yellow}
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="mid"
                        name="Mid-Market"
                        stroke={C.cream}
                        strokeWidth={1}
                        strokeDasharray="4 4"
                        dot={false}
                        opacity={0.5}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="buy"
                        name="Compra"
                        stroke={C.green}
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="marginPct"
                        name="Margen %"
                        stroke={C.red}
                        strokeWidth={1.5}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                    Recopilando datos...
                  </div>
                )}
              </div>
            </div>

            {/* Margin Panel */}
            <div className="col-span-1 bg-[#1e2329] border border-[#2b3139] rounded-2xl p-5 lg:p-6 flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-base font-medium text-white">Margen en Vivo</h2>
                <span className="text-[10px] font-mono text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded uppercase tracking-wider">
                  Live
                </span>
              </div>

              <div className="space-y-4 flex-1">
                {/* Gross spread */}
                <div className="p-4 bg-[#0b0e11] border border-[#2b3139] rounded-xl text-center">
                  <p className="text-xs text-gray-500 mb-1">
                    Spread Bruto (MXN / {baseCcy})
                  </p>
                  <p
                    className="text-3xl font-semibold tracking-tight tabular-nums"
                    style={{ fontFamily: mono, color: C.yellow }}
                  >
                    {currentSpread !== undefined ? fmt4(currentSpread) : "—"}
                  </p>
                  <div
                    className="mt-2 flex items-center justify-center gap-1 text-sm tabular-nums"
                    style={{ fontFamily: mono, color: C.green }}
                  >
                    <ArrowUpRight size={14} />
                    {currentMargin !== undefined ? fmtPct(currentMargin) : "—"} margen
                  </div>
                </div>

                {/* Breakdown */}
                <div className="space-y-1">
                  <Row
                    label={`Compra (${baseCcy})`}
                    value={current?.buy}
                    color={C.green}
                  />
                  <Row
                    label={`Venta (${baseCcy})`}
                    value={current?.sell}
                    color={C.yellow}
                  />
                  <Row label="Mid-Market" value={currentMid} color={C.cream} />
                  <div className="border-t border-[#2b3139] my-2" />
                  <Row
                    label="Spread Neto"
                    value={currentSpread}
                    color="#ffffff"
                    bold
                  />
                  <Row
                    label="Margen %"
                    value={currentMargin}
                    color={C.green}
                    formatter={(n) => fmtPct(n)}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="mt-4 pt-4 border-t border-[#2b3139]">
                <div className="flex items-center justify-between text-[10px] text-gray-600">
                  <span className="font-mono">
                    {PAIRS.length} pares · {history.length} pts
                  </span>
                  <span className="font-mono">Actualizado: {lastUpdate || "—"}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
