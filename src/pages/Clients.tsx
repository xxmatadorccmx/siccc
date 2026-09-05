import { useState, useEffect, useRef, useMemo } from "react";
import { Search, Filter, UserPlus, ShieldAlert, FileCheck, ShieldCheck, RefreshCw, X, Mail, Phone, Download, ArrowDownRight, ArrowUpRight, Clock, Calendar, FileText, User } from "lucide-react";
import QuickRegisterModal from "../components/QuickRegisterModal";
import { AnimatePresence } from "motion/react";

/* ──────────────────────────────────────────────────────────────
   Interfaces
   ────────────────────────────────────────────────────────────── */

interface Client {
  id: string;
  full_name: string;
  client_type: "PHYSICAL" | "MORAL";
  email: string;
  phone: string;
  is_vip: number;
  is_b2b: number;
  rfc_curp?: string;
  company_rfc?: string;
  business_line?: string;
  razon_social?: string;
  first_name?: string;
  last_name?: string;
  legal_rep_name?: string;
  legal_rep_id?: string;
  risk_level?: string;
  estimated_monthly_amount?: number;
  estimated_operations_per_month?: number;
  source_destination_funds?: string;
  created_at: string;
  // Wallet balances (joined in /api/kyc/clients)
  balance_mxn?: number;
  balance_usd?: number;
  balance_usdt?: number;
  // Backend-derived convenience flags
  isVIP?: boolean;
  isB2B?: boolean;
}

interface ClientTransaction {
  id: string;
  type: string; // "IN" | "OUT"
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

/* ──────────────────────────────────────────────────────────────
   Helpers de formato (reutilizables, sin azules)
   ────────────────────────────────────────────────────────────── */

const formatCurrency = (amount: number, currency: string) => {
  if (!amount && amount !== 0) return "—";
  const isStandard = ["USD", "MXN", "EUR", "GBP", "CAD", "JPY"].includes(currency?.toUpperCase() || "");
  if (isStandard) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency.toUpperCase(),
      }).format(amount);
    } catch {
      /* fallback */
    }
  }
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  const symbol = currency?.toUpperCase() === "USDT" ? "₮" : currency;
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
  return map[status] || status || "—";
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

/* ──────────────────────────────────────────────────────────────
   CSV Export Utility (BOM UTF-8 para Excel)
   ────────────────────────────────────────────────────────────── */

function exportToCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csvContent = [
    headers.join(","),
    ...rows.map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(",")
    ),
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

/* ──────────────────────────────────────────────────────────────
   ClientDetailModal — Drill-down de cliente con historial
   ────────────────────────────────────────────────────────────── */

function ClientDetailModal({
  client,
  transactions,
  onClose,
}: {
  client: Client | null;
  transactions: ClientTransaction[];
  onClose: () => void;
}) {
  if (!client) return null;

  // Historial de movimientos del cliente
  const clientTxs = useMemo(
    () =>
      transactions.filter(
        (tx) => tx.customer_id === client.id || tx.client === client.full_name
      ),
    [transactions, client.id, client.full_name]
  );

  const lastTx = clientTxs.length > 0 ? clientTxs[0] : null; // already sorted DESC in backend

  // KYC status — based on presence of RFC/CURP + contact data
  const hasKycDocs =
    (client.client_type === "PHYSICAL" && client.rfc_curp) ||
    (client.client_type === "MORAL" && client.company_rfc);
  const kycStatus = hasKycDocs ? "EXPEDIENTE COMPLETO" : "PENDIENTE";

  // CSV Report per client
  const handleExportCSV = () => {
    const headers = [
      "ID Transacción",
      "Tipo de Operación",
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
      "Sucursal",
      "Fecha y Hora",
    ];

    const rows = clientTxs.length > 0
      ? clientTxs.map((tx) => [
          tx.id,
          tx.type === "IN" ? "Captación (Entrada)" : "Liquidación P2P (Salida)",
          tx.currency_in,
          tx.amount_in,
          formatMethod(tx.method_in),
          tx.currency_out,
          tx.amount_out,
          formatMethod(tx.method_out),
          tx.rate || "",
          tx.markup ? `${(tx.markup * 100).toFixed(2)}%` : "0.00%",
          formatStatus(tx.status),
          formatStatus(tx.settlement_status),
          tx.branch_id || "",
          new Date(tx.date).toLocaleString("es-MX"),
        ])
      : [];

    // Add client info header rows at the top
    const clientInfo: (string | number)[][] = [
      ["REPORTE DE CLIENTE"],
      ["Cliente", client.full_name],
      ["ID Cliente", client.id],
      ["Tipo de Persona", client.client_type === "PHYSICAL" ? "FÍSICA (Individual)" : "MORAL (Corporativo)"],
      ["RFC/CURP", client.client_type === "PHYSICAL" ? client.rfc_curp || "N/A" : client.company_rfc || "N/A"],
      ["Email", client.email || "N/A"],
      ["Teléfono", client.phone || "N/A"],
      ["Estado KYC", kycStatus],
      ["Fecha de Alta", client.created_at ? new Date(client.created_at).toLocaleDateString("es-MX") : "N/A"],
      ["Total de Operaciones", clientTxs.length],
      [],
      headers,
      ...rows,
    ];

    const safeName = (client.full_name || client.id).replace(/[^a-zA-Z0-9]/g, "_");
    const dateStr = new Date().toISOString().split("T")[0];
    exportToCSV(`reporte_cliente_${safeName}_${dateStr}.csv`, ["Campo", "Valor"], clientInfo);
  };

  // Contact rows
  const contactRows: { label: string; value: string; icon: any }[] = [
    { label: "Email", value: client.email || "N/A", icon: Mail },
    { label: "Teléfono", value: client.phone || "N/A", icon: Phone },
  ];

  // Identity rows
  const identityRows: { label: string; value: string; mono?: boolean }[] = [
    { label: "Tipo de Persona", value: client.client_type === "PHYSICAL" ? "FÍSICA (Individual)" : "MORAL (Corporativo)" },
    {
      label: client.client_type === "PHYSICAL" ? "RFC / CURP" : "RFC Empresa",
      value: (client.client_type === "PHYSICAL" ? client.rfc_curp : client.company_rfc) || "N/A",
      mono: true,
    },
    ...(client.business_line ? [{ label: "Giro Empresarial", value: client.business_line }] : []),
    ...(client.razon_social ? [{ label: "Razón Social", value: client.razon_social }] : []),
    ...(client.legal_rep_name ? [{ label: "Representante Legal", value: client.legal_rep_name }] : []),
    ...(client.legal_rep_id ? [{ label: "ID Representante Legal", value: client.legal_rep_id, mono: true as const }] : []),
    { label: "Nivel de Riesgo", value: (client.risk_level || "LOW").toUpperCase() },
    ...(client.is_vip === 1 ? [{ label: "Cliente VIP", value: "SÍ" }] : []),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#181a20] border border-[#2b3139] rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="sticky top-0 bg-[#181a20] border-b border-[#2b3139] px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-binance-yellow/10 border border-binance-yellow/20">
              <User size={22} className="text-binance-yellow" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">{client.full_name}</h3>
              <p className="text-sm text-gray-500 font-mono">{client.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#2b3139] rounded-lg transition-colors text-gray-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="p-6 space-y-6">
          {/* Status Banner */}
          <div className="flex items-center gap-3 px-4 py-3 bg-[#1e2329] rounded-xl border border-[#2b3139]">
            <div
              className={`w-3 h-3 rounded-full ${hasKycDocs ? "bg-binance-yellow" : "bg-binance-orange"}`}
            ></div>
            <span className={`text-sm font-semibold ${hasKycDocs ? "text-binance-yellow" : "text-binance-orange"}`}>
              KYC: {kycStatus}
            </span>
            <span className="text-xs text-gray-500 ml-auto">
              {client.client_type === "PHYSICAL" ? "Persona Física" : "Persona Moral"}
            </span>
          </div>

          {/* ── Fechas clave ── */}
          <div>
            <h4 className="text-xs uppercase tracking-wider text-binance-yellow font-semibold mb-3">
              Fechas y Registro
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-3 px-3 py-2.5 bg-[#1e2329] rounded-lg border border-[#2b3139]">
                <Calendar size={16} className="text-binance-yellow shrink-0" />
                <div className="flex flex-col">
                  <span className="text-xs text-gray-500">Fecha de Alta</span>
                  <span className="text-sm text-white font-medium">
                    {client.created_at
                      ? new Date(client.created_at).toLocaleDateString("es-MX", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })
                      : "N/A"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 px-3 py-2.5 bg-[#1e2329] rounded-lg border border-[#2b3139]">
                <Clock size={16} className="text-binance-yellow shrink-0" />
                <div className="flex flex-col">
                  <span className="text-xs text-gray-500">Última Operación</span>
                  <span className="text-sm text-white font-medium">
                    {lastTx
                      ? new Date(lastTx.date).toLocaleDateString("es-MX", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "Sin operaciones registradas"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Datos de contacto ── */}
          <div>
            <h4 className="text-xs uppercase tracking-wider text-binance-yellow font-semibold mb-3">
              Datos de Contacto
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {contactRows.map((row) => {
                const Icon = row.icon;
                return (
                  <div
                    key={row.label}
                    className="flex items-center gap-3 px-3 py-2.5 bg-[#1e2329] rounded-lg border border-[#2b3139]"
                  >
                    <Icon size={16} className="text-binance-yellow shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs text-gray-500">{row.label}</span>
                      <span className="text-sm text-white font-medium truncate">{row.value}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Identidad y KYC ── */}
          <div>
            <h4 className="text-xs uppercase tracking-wider text-binance-yellow font-semibold mb-3">
              Identidad y Estado KYC
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {identityRows.map((row) => (
                <div
                  key={row.label}
                  className="flex flex-col gap-1 px-3 py-2 bg-[#1e2329] rounded-lg border border-[#2b3139]"
                >
                  <span className="text-xs text-gray-500">{row.label}</span>
                  <span className={`text-sm text-white ${row.mono ? "font-mono" : "font-medium"}`}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
            {/* KYC Status Banner */}
            <div className="mt-3 flex items-center gap-3 px-4 py-3 bg-[#1e2329] rounded-lg border border-[#2b3139]">
              <ShieldCheck size={18} className={hasKycDocs ? "text-binance-yellow" : "text-binance-orange"} />
              <div className="flex-1">
                <span className="text-sm font-semibold text-white">Estado KYC: </span>
                <span className={`text-sm font-semibold ${hasKycDocs ? "text-binance-yellow" : "text-binance-orange"}`}>
                  {kycStatus}
                </span>
              </div>
              {client.is_b2b === 1 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                  KAPPA B2B
                </span>
              )}
            </div>
          </div>

          {/* ── Historial de Movimientos ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs uppercase tracking-wider text-binance-yellow font-semibold">
                Historial de Movimientos ({clientTxs.length})
              </h4>
              {clientTxs.length > 0 && (
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-binance-yellow hover:bg-yellow-500 text-black rounded-lg transition-colors text-xs font-semibold"
                >
                  <Download size={14} />
                  Exportar CSV
                </button>
              )}
            </div>

            {clientTxs.length === 0 ? (
              <div className="px-4 py-8 bg-[#1e2329] rounded-xl border border-[#2b3139] text-center">
                <FileText size={28} className="text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Este cliente no tiene operaciones registradas aún.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {clientTxs.map((tx) => (
                  <div
                    key={`${tx.id}-${tx.type}`}
                    className="flex items-center gap-3 px-3 py-2.5 bg-[#1e2329] rounded-lg border border-[#2b3139] hover:border-[#3b444f] transition-colors"
                  >
                    {/* Type icon */}
                    <div
                      className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${
                        tx.type === "IN" ? "bg-binance-yellow/10" : "bg-binance-red/10"
                      }`}
                    >
                      {tx.type === "IN" ? (
                        <ArrowDownRight size={16} className="text-binance-yellow" />
                      ) : (
                        <ArrowUpRight size={16} className="text-binance-red" />
                      )}
                    </div>

                    {/* Amounts */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-white font-mono">
                          {formatCurrency(tx.amount_in, tx.currency_in)}
                        </span>
                        <span className="text-gray-500 text-xs">→</span>
                        <span className="font-medium text-white font-mono">
                          {formatCurrency(tx.amount_out, tx.currency_out)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-500 font-mono">{tx.id}</span>
                        <span className="text-[10px] text-gray-600">·</span>
                        <span className="text-[10px] text-gray-500">
                          {new Date(tx.date).toLocaleDateString("es-MX")}
                        </span>
                      </div>
                    </div>

                    {/* Status */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className={`w-2 h-2 rounded-full ${statusDot(tx.status)}`}></div>
                      <span className={`text-xs font-medium ${statusColor(tx.status)}`}>
                        {formatStatus(tx.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Wallet Balances (if available) ── */}
          {(client.balance_mxn || client.balance_usd || client.balance_usdt) && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-binance-yellow font-semibold mb-3">
                Saldos de Wallet
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1 px-3 py-2 bg-[#1e2329] rounded-lg border border-[#2b3139]">
                  <span className="text-xs text-gray-500">MXN</span>
                  <span className="text-sm text-white font-mono font-medium">
                    {formatCurrency(client.balance_mxn || 0, "MXN")}
                  </span>
                </div>
                <div className="flex flex-col gap-1 px-3 py-2 bg-[#1e2329] rounded-lg border border-[#2b3139]">
                  <span className="text-xs text-gray-500">USD</span>
                  <span className="text-sm text-white font-mono font-medium">
                    {formatCurrency(client.balance_usd || 0, "USD")}
                  </span>
                </div>
                <div className="flex flex-col gap-1 px-3 py-2 bg-[#1e2329] rounded-lg border border-[#2b3139]">
                  <span className="text-xs text-gray-500">USDT</span>
                  <span className="text-sm text-white font-mono font-medium">
                    {formatCurrency(client.balance_usdt || 0, "USDT")}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="sticky bottom-0 bg-[#181a20] border-t border-[#2b3139] px-6 py-4 flex justify-between items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-binance-yellow hover:bg-yellow-500 text-black rounded-lg transition-colors text-sm font-semibold"
          >
            <Download size={16} />
            Generar Reporte CSV
          </button>
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

/* ──────────────────────────────────────────────────────────────
   Main Component
   ────────────────────────────────────────────────────────────── */

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [transactions, setTransactions] = useState<ClientTransaction[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  // Compliance live check en el buscador
  const [complianceResult, setComplianceResult] = useState<{ level: string; matches: any[] } | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const debounceComplianceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchClients = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/kyc/clients");
      const data = await res.json();
      if (data.status === "success") {
        setClients(data.data);
      }
    } catch (error) {
      console.error("Error fetching clients:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactions = async () => {
    try {
      const res = await fetch("/api/transactions/recent");
      const data = await res.json();
      if (data.status === "success") {
        setTransactions(data.transactions || data.data || []);
      }
    } catch (error) {
      console.error("Error fetching transactions for client history:", error);
    }
  };

  useEffect(() => {
    fetchClients();
    fetchTransactions();
  }, []);

  // ── COMPLIANCE EN VIVO: debounce al buscar nombres ──
  useEffect(() => {
    if (searchTerm.length < 5) {
      setComplianceResult(null);
      setComplianceLoading(false);
      return;
    }
    if (debounceComplianceRef.current) clearTimeout(debounceComplianceRef.current);
    setComplianceLoading(true);
    debounceComplianceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/compliance/search-lists?q=${encodeURIComponent(searchTerm)}`);
        if (res.ok) {
          const json = await res.json();
          setComplianceResult({ level: json.data?.riskLevel || "VERDE", matches: json.data?.matches || [] });
        }
      } catch (err) {
        console.error("Compliance search error:", err);
      } finally {
        setComplianceLoading(false);
      }
    }, 400);
    return () => {
      if (debounceComplianceRef.current) clearTimeout(debounceComplianceRef.current);
    };
  }, [searchTerm]);

  const filteredClients = clients.filter((c) => {
    const searchLower = searchTerm.toLowerCase();
    const matchesName = c.full_name?.toLowerCase().includes(searchLower);
    const matchesId = c.id?.toLowerCase().includes(searchLower);
    const matchesRfc = (c.rfc_curp || c.company_rfc || "")?.toLowerCase().includes(searchLower);
    return matchesName || matchesId || matchesRfc;
  });

  const verifiedCount = clients.length; // All newly registered with files are marked verified/1
  const b2bCount = clients.filter((c) => c.is_b2b === 1).length;

  // Initials for avatar
  const getInitials = (name: string) => {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold tracking-tight text-white">Clientes y KYC</h1>
          <p className="text-gray-400 text-xs lg:text-sm mt-1">Gestiona perfiles de clientes, documentos KYC y cumplimiento CNBV</p>
        </div>
        <div className="flex items-center gap-2 lg:gap-3 w-full sm:w-auto">
          <button className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 lg:px-4 py-2 bg-[#1e2329] hover:bg-[#2b3139] text-white rounded-lg transition-colors text-sm font-medium border border-[#3b444f]">
            <Filter size={16} />
            Filtrar
          </button>
          <button
            id="add-client-directory-btn"
            onClick={() => setShowModal(true)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 lg:px-4 py-2 bg-binance-yellow hover:bg-yellow-500 text-black rounded-lg transition-colors text-sm font-medium whitespace-nowrap font-black"
          >
            <UserPlus size={16} />
            Nuevo Cliente
          </button>
        </div>
      </div>

      {/* Panel de Compliance en vivo */}
      {(complianceLoading || complianceResult) && searchTerm.length >= 5 && (
        <div className="mb-4">
          {complianceLoading ? (
            <div className="p-3 bg-[#1e2329] border border-[#2b3139] rounded-xl flex items-center gap-2 text-gray-400 text-xs">
              <RefreshCw size={14} className="animate-spin" />
              <span>Verificando en listas OFAC / PEP / CNBV / SAT...</span>
            </div>
          ) : complianceResult && (
            <div className={`p-4 rounded-xl border flex items-start gap-3 ${
              complianceResult.level === 'ROJO'
                ? "bg-red-500/10 border-red-500/30"
                : complianceResult.level === 'AMARILLO'
                ? "bg-yellow-500/10 border-yellow-500/30"
                : "bg-emerald-500/10 border-emerald-500/30"
            }`}>
              <div className={`shrink-0 p-1.5 rounded-lg ${
                complianceResult.level === 'ROJO'
                  ? "bg-red-500 text-white"
                  : complianceResult.level === 'AMARILLO'
                  ? "bg-yellow-500 text-black"
                  : "bg-emerald-500 text-white"
              }`}>
                {complianceResult.level === 'ROJO' ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}
              </div>
              <div className="flex-1">
                <p className={`font-bold text-sm ${
                  complianceResult.level === 'ROJO' ? "text-red-400"
                  : complianceResult.level === 'AMARILLO' ? "text-yellow-500"
                  : "text-emerald-400"
                }`}>
                  {complianceResult.level === 'VERDE' ? '✅ Sin coincidencias en listas restrictivas' :
                   complianceResult.level === 'AMARILLO' ? '⚠️ Coincidencia parcial detectada' :
                   '🚫 COINCIDENCIA EN LISTA — Operación bloqueada'}
                </p>
                {complianceResult.matches.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {complianceResult.matches.map((m, i) => (
                      <div key={i} className="text-xs text-gray-300 flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold ${
                          m.tipo_coincidencia === 'RED' ? 'bg-red-500/20 text-red-400'
                          : m.tipo_coincidencia === 'YELLOW' ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-gray-500/20 text-gray-400'
                        }`}>{m.lista}</span>
                        <span className="font-medium">{m.nombre_completo}</span>
                        <span className="text-gray-500 text-[10px]">({m.nivel_match}, {Math.round(m.score_similitud * 100)}%)</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4 mb-4 lg:mb-6">
        <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-binance-yellow/10 flex items-center justify-center">
            <FileCheck className="text-binance-yellow" size={24} />
          </div>
          <div>
            <p className="text-sm text-gray-400 font-medium">Perfiles Totales</p>
            <p className="text-2xl font-semibold text-white">{clients.length}</p>
          </div>
        </div>
        <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <FileCheck className="text-emerald-500" size={24} />
          </div>
          <div>
            <p className="text-sm text-gray-400 font-medium">Aliados B2B Habilitados</p>
            <p className="text-2xl font-semibold text-emerald-500">{b2bCount}</p>
          </div>
        </div>
        <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-binance-red/10 flex items-center justify-center">
            <ShieldAlert className="text-binance-red" size={24} />
          </div>
          <div>
            <p className="text-sm text-gray-400 font-medium">Alertas de Auditoría (CNBV)</p>
            <p className="text-2xl font-semibold text-white">0</p>
          </div>
        </div>
      </div>

      <div className="bg-[#1e2329] border border-[#2b3139] rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-[#2b3139] flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Buscar por nombre, ID o RFC..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#2b3139] border border-[#3b444f] rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-binance-yellow transition-colors text-white"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#3b444f] text-xs uppercase tracking-wider text-gray-500 bg-[#2b3139]">
                <th className="p-4 font-medium">ID Cliente</th>
                <th className="p-4 font-medium">Nombre / Razón Social</th>
                <th className="p-4 font-medium">Tipo de Persona</th>
                <th className="p-4 font-medium">RFC / CURP</th>
                <th className="p-4 font-medium">Flujo B2B / Kappa</th>
                <th className="p-4 font-medium">Estado KYC</th>
                <th className="p-4 font-medium text-right">Fecha de Registro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2b3139]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500">Cargando clientes de la base de datos...</td>
                </tr>
              ) : filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500">No se encontraron clientes registrados.</td>
                </tr>
              ) : (
                filteredClients.map((client) => (
                  <tr
                    key={client.id}
                    className="hover:bg-[#2b3139] transition-colors group cursor-pointer"
                    onClick={() => setSelectedClient(client)}
                  >
                    <td className="p-4 font-mono text-xs text-gray-300 group-hover:text-binance-yellow transition-colors">
                      {client.id}
                    </td>
                    <td className="p-4 text-sm font-medium text-white">
                      <div className="flex items-center gap-3">
                        {/* Avatar (clickable) */}
                        <div className="w-9 h-9 rounded-full bg-binance-yellow/10 border border-binance-yellow/20 flex items-center justify-center text-binance-yellow text-xs font-bold shrink-0 group-hover:bg-binance-yellow/20 transition-colors">
                          {getInitials(client.full_name)}
                        </div>
                        <div className="min-w-0">
                          <span className="block group-hover:text-binance-yellow transition-colors truncate">
                            {client.full_name}
                          </span>
                          {client.email && (
                            <span className="block text-[10px] text-gray-500 font-normal truncate">
                              {client.email}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-xs text-gray-400 font-medium tracking-wide">
                        {client.client_type === "PHYSICAL" ? "FÍSICA (Individual)" : "MORAL (Corporativo)"}
                      </span>
                    </td>
                    <td className="p-4 font-mono text-xs text-gray-400">
                      {client.client_type === "PHYSICAL" ? client.rfc_curp : client.company_rfc}
                    </td>
                    <td className="p-4">
                      {client.is_b2b === 1 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                          KAPPA B2B
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">N/A (Caja)</span>
                      )}
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-binance-yellow/10 text-binance-yellow font-bold uppercase">
                        EXPEDIENTE COMPLETO
                      </span>
                    </td>
                    <td className="p-4 text-right text-xs text-gray-500 font-mono">
                      {client.created_at ? new Date(client.created_at).toLocaleDateString() : "N/A"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unified Registration Modal */}
      <AnimatePresence>
        {showModal && (
          <QuickRegisterModal
            onClose={() => setShowModal(false)}
            onSuccess={() => {
              setShowModal(false);
              fetchClients(); // Refresh lists
            }}
          />
        )}
      </AnimatePresence>

      {/* Client Detail Drill-down Modal */}
      <AnimatePresence>
        {selectedClient && (
          <ClientDetailModal
            client={selectedClient}
            transactions={transactions}
            onClose={() => setSelectedClient(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
