import { useState, useEffect, useMemo } from "react";
import { Search, Filter, Download, ArrowUpRight, ArrowDownRight, X, FileText, Calendar } from "lucide-react";

interface Transaction {
  id: string;
  type: string;
  currency_in: string;
  amount_in: number;
  method_in: string;
  currency_out: string;
  amount_out: number;
  method_out: string;
  rate: number;
  markup: number;
  status: string;
  settlement_status: string;
  branch_id: string;
  customer_id: string;
  client: string;
  date: string;
  transfer_bank_name: string | null;
  transfer_account_number: string | null;
  transfer_payer_name: string | null;
  transfer_date: string | null;
  transfer_tracking_id: string | null;
  transfer_txid: string | null;
}

const formatCurrency = (amount: number, currency: string) => {
  const isStandard = ["USD", "MXN", "EUR", "GBP", "CAD", "JPY"].includes(currency?.toUpperCase() || "");
  if (isStandard) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amount);
    } catch (e) {
      // fallback
    }
  }
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  const symbol = currency?.toUpperCase() === 'USDT' ? '₮' : currency;
  return `${symbol} ${formatted}`;
};

const formatMethod = (method: string) => {
  if (!method) return "—";
  const map: Record<string, string> = {
    CASH: "EFECTIVO",
    TRANSFERENCIA: "TRANSFERENCIA",
    TRANSFER: "TRANSFERENCIA",
    TARJETA: "TARJETA",
    WALLET_BAAS: "WALLET BaaS",
    CARD: "TARJETA",
  };
  return map[method.toUpperCase()] || method.toUpperCase();
};

const formatStatus = (status: string) => {
  const map: Record<string, string> = {
    COMPLETED: "COMPLETADO",
    PENDING: "PENDIENTE",
    PENDING_DISBURSEMENT: "PENDIENTE DE LIQUIDACIÓN",
    FAILED: "FALLIDO",
    FALLIDO: "FALLIDO",
    LIQUIDADO: "LIQUIDADO",
    EN_PROCESO: "EN PROCESO",
    CANCELLED: "CANCELADO",
  };
  return map[status] || status;
};

const statusColor = (status: string) => {
  if (status === "COMPLETED" || status === "COMPLETADO" || status === "LIQUIDADO")
    return "text-binance-yellow";
  if (status === "PENDING" || status === "PENDING_DISBURSEMENT" || status === "EN_PROCESO")
    return "text-binance-orange";
  return "text-binance-red";
};

const statusDot = (status: string) => {
  if (status === "COMPLETED" || status === "COMPLETADO" || status === "LIQUIDADO")
    return "bg-binance-yellow";
  if (status === "PENDING" || status === "PENDING_DISBURSEMENT" || status === "EN_PROCESO")
    return "bg-binance-orange";
  return "bg-binance-red";
};

/* ── CSV Export Utility ─────────────────────────────────────── */
function exportToCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csvContent = [
    headers.join(","),
    ...rows.map(r => r.map(cell => {
      const s = String(cell ?? "");
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }).join(","))
  ].join("\n");

  const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ── Detail Modal ───────────────────────────────────────────── */
function TransactionDetailModal({
  tx,
  onClose,
}: {
  tx: Transaction | null;
  onClose: () => void;
}) {
  if (!tx) return null;

  const detailRows: { label: string; value: string; mono?: boolean }[] = [
    { label: "ID Transacción", value: tx.id, mono: true },
    { label: "Cliente", value: tx.client || "—" },
    { label: "Customer ID", value: tx.customer_id || "—", mono: true },
    { label: "Sucursal", value: tx.branch_id || "—" },
    { label: "Tipo de Operación", value: tx.type === "IN" ? "Captación (Entrada)" : "Liquidación P2P (Salida)" },
    { label: "Estado", value: formatStatus(tx.status) },
    { label: "Estado de Liquidación", value: formatStatus(tx.settlement_status) },
    { label: "Fecha y Hora Exacta", value: new Date(tx.date).toLocaleString("es-MX", { dateStyle: "full", timeStyle: "medium" }) },
  ];

  const exchangeRows: { label: string; value: string }[] = [
    { label: "Divisa Entrada", value: `${formatCurrency(tx.amount_in, tx.currency_in)}` },
    { label: "Método de Entrada", value: formatMethod(tx.method_in) },
    { label: "Divisa Salida", value: `${formatCurrency(tx.amount_out, tx.currency_out)}` },
    { label: "Método de Salida", value: formatMethod(tx.method_out) },
    { label: "Tasa de Cambio", value: tx.rate?.toFixed(4) || "—" },
    { label: "Markup", value: tx.markup ? `${(tx.markup * 100).toFixed(2)}%` : "0.00%" },
  ];

  const transferRows: { label: string; value: string }[] = [
    { label: "Banco", value: tx.transfer_bank_name || "—" },
    { label: "Número de Cuenta", value: tx.transfer_account_number || "—", },
    { label: "Titular", value: tx.transfer_payer_name || "—" },
    { label: "Fecha Transferencia", value: tx.transfer_date ? new Date(tx.transfer_date).toLocaleDateString("es-MX") : "—" },
    { label: "Tracking ID", value: tx.transfer_tracking_id || "—" },
    { label: "TXID", value: tx.transfer_txid || "—" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#181a20] border border-[#2b3139] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#181a20] border-b border-[#2b3139] px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${tx.type === "IN" ? "bg-binance-yellow/10" : "bg-binance-red/10"}`}>
              {tx.type === "IN" ? (
                <ArrowDownRight size={20} className="text-binance-yellow" />
              ) : (
                <ArrowUpRight size={20} className="text-binance-red" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Detalle de Transacción</h3>
              <p className="text-sm text-gray-500 font-mono">{tx.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#2b3139] rounded-lg transition-colors text-gray-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Status Banner */}
          <div className="flex items-center gap-3 px-4 py-3 bg-[#1e2329] rounded-xl border border-[#2b3139]">
            <div className={`w-3 h-3 rounded-full ${statusDot(tx.status)}`}></div>
            <span className={`text-sm font-semibold ${statusColor(tx.status)}`}>
              {formatStatus(tx.status)}
            </span>
            <span className="text-xs text-gray-500 ml-auto">
              {tx.type === "IN" ? "Captación" : "Liquidación P2P"}
            </span>
          </div>

          {/* General Details */}
          <div>
            <h4 className="text-xs uppercase tracking-wider text-binance-yellow font-semibold mb-3">
              Información General
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {detailRows.map((row) => (
                <div key={row.label} className="flex flex-col gap-1 px-3 py-2 bg-[#1e2329] rounded-lg border border-[#2b3139]">
                  <span className="text-xs text-gray-500">{row.label}</span>
                  <span className={`text-sm text-white ${row.mono ? "font-mono" : "font-medium"}`}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Exchange Details */}
          <div>
            <h4 className="text-xs uppercase tracking-wider text-binance-yellow font-semibold mb-3">
              Divisas y Método de Pago
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {exchangeRows.map((row) => (
                <div key={row.label} className="flex flex-col gap-1 px-3 py-2 bg-[#1e2329] rounded-lg border border-[#2b3139]">
                  <span className="text-xs text-gray-500">{row.label}</span>
                  <span className="text-sm text-white font-medium">{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Transfer Traceability */}
          <div>
            <h4 className="text-xs uppercase tracking-wider text-binance-yellow font-semibold mb-3">
              Trazabilidad de Transferencia
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {transferRows.map((row) => (
                <div key={row.label} className="flex flex-col gap-1 px-3 py-2 bg-[#1e2329] rounded-lg border border-[#2b3139]">
                  <span className="text-xs text-gray-500">{row.label}</span>
                  <span className="text-sm text-white font-medium break-all">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-[#181a20] border-t border-[#2b3139] px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-[#2b3139] hover:bg-[#3b444f] text-white rounded-lg transition-colors text-sm font-medium border border-[#3b444f]"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Report Generator Panel ────────────────────────────────── */
function ReportPanel({ transactions }: { transactions: Transaction[] }) {
  const [period, setPeriod] = useState<"day" | "month" | "year">("day");
  const [reportData, setReportData] = useState<Transaction[] | null>(null);

  const generateReport = () => {
    const now = new Date();
    const filtered = transactions.filter((tx) => {
      const txDate = new Date(tx.date);
      if (period === "day") {
        return txDate.toDateString() === now.toDateString();
      }
      if (period === "month") {
        return (
          txDate.getMonth() === now.getMonth() &&
          txDate.getFullYear() === now.getFullYear()
        );
      }
      return txDate.getFullYear() === now.getFullYear();
    });

    setReportData(filtered);

    // Export to CSV
    const headers = [
      "ID Transacción",
      "Cliente",
      "Customer ID",
      "Sucursal",
      "Tipo",
      "Divisa Entrada",
      "Monto Entrada",
      "Método Entrada",
      "Divisa Salida",
      "Monto Salida",
      "Método Salida",
      "Tasa",
      "Markup",
      "Estado",
      "Estado Liquidación",
      "Fecha y Hora",
    ];

    const rows = filtered.map((tx) => [
      tx.id,
      tx.client || "",
      tx.customer_id || "",
      tx.branch_id || "",
      tx.type,
      tx.currency_in,
      tx.amount_in,
      formatMethod(tx.method_in),
      tx.currency_out,
      tx.amount_out,
      formatMethod(tx.method_out),
      tx.rate || "",
      tx.markup || "",
      formatStatus(tx.status),
      formatStatus(tx.settlement_status),
      new Date(tx.date).toLocaleString("es-MX"),
    ]);

    const dateStr = now.toISOString().split("T")[0];
    const periodLabel = period === "day" ? "dia" : period === "month" ? "mes" : "anio";
    exportToCSV(`reporte_transacciones_${periodLabel}_${dateStr}.csv`, headers, rows);
  };

  const periodLabel = period === "day" ? "Hoy" : period === "month" ? "Este Mes" : "Este Año";

  return (
    <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl lg:rounded-2xl p-4 lg:p-5">
      <div className="flex items-center gap-2 mb-4">
        <FileText size={18} className="text-binance-yellow" />
        <h3 className="text-sm font-semibold text-white">Generar Reporte de Transacciones</h3>
      </div>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {/* Period selector */}
        <div className="flex items-center gap-1 bg-[#181a20] rounded-lg border border-[#2b3139] p-1">
          {(["day", "month", "year"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                period === p
                  ? "bg-binance-yellow text-black"
                  : "text-gray-400 hover:text-white hover:bg-[#2b3139]"
              }`}
            >
              {p === "day" ? "Día" : p === "month" ? "Mes" : "Año"}
            </button>
          ))}
        </div>

        {/* Generate button */}
        <button
          onClick={generateReport}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-binance-yellow hover:bg-yellow-500 text-black rounded-lg transition-colors text-sm font-semibold"
        >
          <Download size={16} />
          Generar y Exportar CSV
        </button>

        {/* Result count */}
        {reportData !== null && (
          <span className="text-xs text-gray-400 ml-auto">
            {reportData.length} transacción{reportData.length !== 1 ? "es" : ""} encontrada{reportData.length !== 1 ? "s" : ""} para{" "}
            <span className="text-binance-yellow font-medium">{periodLabel}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────── */
export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        const res = await fetch("/api/transactions/recent");
        const data = await res.json();
        if (data.status === "success") {
          setTransactions(data.transactions);
        }
      } catch (error) {
        console.error("Error fetching transactions:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
  }, []);

  const filteredTransactions = useMemo(() => {
    if (!searchQuery.trim()) return transactions;
    const q = searchQuery.toLowerCase();
    return transactions.filter(
      (tx) =>
        tx.id?.toLowerCase().includes(q) ||
        tx.client?.toLowerCase().includes(q) ||
        String(tx.amount_in).includes(q) ||
        String(tx.amount_out).includes(q)
    );
  }, [transactions, searchQuery]);

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold tracking-tight text-white">Transacciones</h1>
          <p className="text-gray-400 text-xs lg:text-sm mt-1">Gestiona y visualiza todas las transacciones de la plataforma</p>
        </div>
        <div className="flex items-center gap-2 lg:gap-3 w-full sm:w-auto">
          <button className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 lg:px-4 py-2 bg-[#1e2329] hover:bg-[#2b3139] text-white rounded-lg transition-colors text-sm font-medium border border-[#3b444f]">
            <Filter size={16} />
            Filtrar
          </button>
          <button
            onClick={() => {
              const headers = [
                "ID Transacción", "Cliente", "Tipo", "Divisa", "Monto",
                "Método", "Estado", "Fecha y Hora",
              ];
              const rows = filteredTransactions.map((tx) => [
                tx.id, tx.client || "", tx.type, tx.currency_in, tx.amount_in,
                formatMethod(tx.method_in), formatStatus(tx.status),
                new Date(tx.date).toLocaleString("es-MX"),
              ]);
              exportToCSV(`transacciones_${new Date().toISOString().split("T")[0]}.csv`, headers, rows);
            }}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 lg:px-4 py-2 bg-binance-yellow hover:bg-yellow-500 text-black rounded-lg transition-colors text-sm font-medium"
          >
            <Download size={16} />
            Exportar
          </button>
        </div>
      </div>

      {/* Report Generator */}
      <ReportPanel transactions={transactions} />

      {/* Transactions Table */}
      <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl lg:rounded-2xl overflow-hidden">
        <div className="p-3 lg:p-4 border-b border-[#2b3139] flex items-center gap-4">
          <div className="relative flex-1 max-w-full sm:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por ID, cliente o monto..."
              className="w-full bg-[#2b3139] border border-[#3b444f] rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-binance-yellow transition-colors text-white placeholder-gray-600"
            />
          </div>
          {searchQuery && (
            <span className="text-xs text-gray-500 hidden sm:block">
              {filteredTransactions.length} resultado{filteredTransactions.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#3b444f] text-xs uppercase tracking-wider text-gray-500 bg-[#2b3139]">
                <th className="p-4 font-medium">ID Transacción</th>
                <th className="p-4 font-medium">Cliente</th>
                <th className="p-4 font-medium">Tipo</th>
                <th className="p-4 font-medium text-right">Monto</th>
                <th className="p-4 font-medium">Método</th>
                <th className="p-4 font-medium">Estado</th>
                <th className="p-4 font-medium text-right">Fecha y Hora</th>
                <th className="p-4 font-medium text-right">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2b3139]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-500">Cargando transacciones...</td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-500">No se encontraron transacciones</td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => (
                  <tr
                    key={`${tx.id}-${tx.type}`}
                    onClick={() => setSelectedTx(tx)}
                    className="hover:bg-[#2b3139] transition-colors group cursor-pointer"
                  >
                    <td className="p-4 font-mono text-sm text-gray-300 group-hover:text-binance-yellow transition-colors">{tx.id}</td>
                    <td className="p-4 text-sm font-medium text-white">{tx.client}</td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded font-medium ${
                        tx.type === 'IN' ? 'bg-binance-yellow/10 text-binance-yellow' : 'bg-binance-red/10 text-binance-red'
                      }`}>
                        {tx.type === 'IN' ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
                        {tx.type} {tx.currency_in}
                      </span>
                    </td>
                    <td className="p-4 text-right font-mono text-sm text-white">
                      {formatCurrency(tx.amount_in, tx.currency_in)}
                    </td>
                    <td className="p-4">
                      <span className="text-xs text-gray-400 font-medium uppercase">
                        {formatMethod(tx.method_in)}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`flex items-center gap-1.5 text-xs font-medium ${statusColor(tx.status)}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${statusDot(tx.status)}`}></div>
                        {formatStatus(tx.status)}
                      </span>
                    </td>
                    <td className="p-4 text-right text-sm text-gray-500 font-mono">
                      {new Date(tx.date).toLocaleString()}
                    </td>
                    <td className="p-4 text-right">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-[#2b3139] group-hover:bg-binance-yellow/20 text-gray-500 group-hover:text-binance-yellow transition-colors">
                        <ArrowUpRight size={14} className="rotate-45" />
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-[#2b3139] flex items-center justify-between text-sm text-gray-500">
          <span>Mostrando {filteredTransactions.length} de {transactions.length} transacciones</span>
          <div className="flex gap-2">
            <button className="px-3 py-1 border border-[#3b444f] rounded hover:bg-[#2b3139] transition-colors disabled:opacity-50">Anterior</button>
            <button className="px-3 py-1 border border-[#3b444f] rounded hover:bg-[#2b3139] transition-colors">Siguiente</button>
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      <TransactionDetailModal tx={selectedTx} onClose={() => setSelectedTx(null)} />
    </div>
  );
}
