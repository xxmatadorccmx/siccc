import React, { useState, useEffect, FormEvent } from "react";
import { 
  ShieldAlert, 
  Search, 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  FileSpreadsheet, 
  Clock, 
  UserCheck, 
  Copy, 
  RefreshCw, 
  Check, 
  ShieldCheck, 
  TrendingUp, 
  HelpCircle,
  FileText
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { RoleLevel } from "../types/auth";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from "recharts";

interface Match {
  id: string;
  nombre_completo: string;
  lista: string;
  tipo_coincidencia: "RED" | "AMARILLO";
  detalles: string;
}

interface AuthLog {
  id: string;
  client_id: string;
  client_name: string;
  amount_usd: number;
  reason: string;
  requested_by: string;
  authorized_by: string | null;
  passcode: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "USED";
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

interface AMLReport {
  id: number;
  tipo: "RELEVANTE" | "INUSUAL" | "PREOCUPANTE";
  client_id: string;
  client_name: string;
  amount_usd: number;
  description: string;
  oficial_id: string;
  created_at: string;
}

export default function Compliance() {
  const { profile } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<"authorizations" | "search" | "reports" | "rules" | "import" | "layouts">("authorizations");
  
  // Real-time polling states
  const [authorizations, setAuthorizations] = useState<AuthLog[]>([]);
  const [reports, setReports] = useState<AMLReport[]>([]);
  const [loadingAuths, setLoadingAuths] = useState(true);
  const [loadingReports, setLoadingReports] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // PLD Rules Engine States
  const [pldAlerts, setPldAlerts] = useState<any[]>([]);
  const [loadingPld, setLoadingPld] = useState(true);

  // List Import States
  const [importList, setImportList] = useState("ofac");
  const [importRawText, setImportRawText] = useState("");
  const [importClearFirst, setImportClearFirst] = useState(true);
  const [importLoading, setImportLoading] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  // Alert Resolution Modal/Row State
  const [selectedAlert, setSelectedAlert] = useState<any | null>(null);
  const [alertActionStatus, setAlertActionStatus] = useState("RESOLVED");
  const [alertActionNotes, setAlertActionNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Search states (Consulta Manual)
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<{ matches: Match[]; riskLevel: string } | null>(null);

  // Stats
  const [stats, setStats] = useState({
    pendingCount: 0,
    approvedToday: 0,
    totalRelevant: 0,
    totalInusual: 0,
    pendingPldAlerts: 0
  });

  // Load and poll authorizations, reports and real-time PLD alerts
  const fetchData = async () => {
    try {
      const resAuths = await fetch("/api/compliance/authorizations");
      if (resAuths.ok) {
        const data = await resAuths.json();
        setAuthorizations(data.data || []);
      }

      const resReports = await fetch("/api/compliance/reportes");
      if (resReports.ok) {
        const data = await resReports.json();
        setReports(data.data || []);
      }

      const resPld = await fetch("/api/compliance/pld-analyzer");
      if (resPld.ok) {
        const data = await resPld.json();
        setPldAlerts(data.data || []);
      }
    } catch (err) {
      console.error("Error fetching compliance data:", err);
    } finally {
      setLoadingAuths(false);
      setLoadingReports(false);
      setLoadingPld(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // 5s interval for real-time compliance feel
    return () => clearInterval(interval);
  }, []);

  // Recalculate quick stats when state variables update
  useEffect(() => {
    const pending = authorizations.filter(a => a.status === "PENDING").length;
    const approved = authorizations.filter(a => a.status === "APPROVED" || a.status === "USED").length;
    const relevant = reports.filter(r => r.tipo === "RELEVANTE").length;
    const inusual = reports.filter(r => r.tipo === "INUSUAL").length;
    const pendingPld = pldAlerts.filter(a => a.status === "PENDING").length;

    setStats({
      pendingCount: pending,
      approvedToday: approved,
      totalRelevant: relevant,
      totalInusual: inusual,
      pendingPldAlerts: pendingPld
    });
  }, [authorizations, reports, pldAlerts]);

  // Handle Search Manual
  const handleManualSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearchLoading(true);
    try {
      const res = await fetch(`/api/compliance/search-lists?q=${encodeURIComponent(searchQuery)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResult(data.data);
      }
    } catch (err) {
      console.error("Error in manual blacklist search:", err);
    } finally {
      setSearchLoading(false);
    }
  };

  // Handle Approve Authorization
  const handleApprove = async (authId: string) => {
    try {
      const res = await fetch("/api/compliance/approve-authorization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authId,
          oficialId: profile?.nickname || "OFICIAL_CUMPLIMIENTO"
        })
      });

      if (res.ok) {
        fetchData();
      } else {
        const errData = await res.json();
        alert(errData.message || "Error al aprobar la solicitud.");
      }
    } catch (err) {
      console.error("Error approving:", err);
    }
  };

  // Handle Reject Authorization
  const handleReject = async (authId: string) => {
    try {
      const res = await fetch("/api/compliance/reject-authorization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authId,
          oficialId: profile?.nickname || "OFICIAL_CUMPLIMIENTO"
        })
      });

      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error("Error rejecting:", err);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Prepare Chart Data
  const chartData = [
    { name: "Ene", Relevantes: 4, Inusuales: 8 },
    { name: "Feb", Relevantes: 7, Inusuales: 12 },
    { name: "Mar", Relevantes: 5, Inusuales: 15 },
    { name: "Abr", Relevantes: 12, Inusuales: 19 },
    { name: "May", Relevantes: stats.totalRelevant || 8, Inusuales: stats.totalInusual || 21 },
  ];

  const valueChartData = [
    { name: "Semana 1", Monto: 12500 },
    { name: "Semana 2", Monto: 24000 },
    { name: "Semana 3", Monto: 18500 },
    { name: "Semana 4", Monto: 42000 },
    { name: "Esta Semana", Monto: authorizations.reduce((acc, curr) => acc + (curr.amount_usd || 0), 0) || 15000 }
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-[#181a20] p-4 lg:p-8">
      {/* Upper header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="text-binance-yellow h-6 w-6" />
            <h1 className="text-2xl font-bold text-white tracking-tight">Oficina de Cumplimiento Normativo</h1>
          </div>
          <p className="text-xs text-gray-400">
            Control de Prevención de Lavado de Dinero (PLD) y Financiamiento al Terrorismo según normativas de la CNBV.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-yellow-500/10 text-binance-yellow border border-yellow-500/20 px-2.5 py-1 rounded-full font-mono">
            Licencia CNBV: CNBV-LIC-100293-2024
          </span>
          <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-full font-mono flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            OFAC/PEP Live
          </span>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-[#1e2329] p-5 rounded-xl border border-[#2b3139] flex items-center justify-between">
          <div>
            <span className="text-xs text-gray-400 font-medium">Solicitudes Pendientes</span>
            <div className="text-2xl font-bold text-white mt-1 flex items-center gap-2">
              {stats.pendingCount}
              {stats.pendingCount > 0 && (
                <span className="h-2 w-2 rounded-full bg-yellow-500 animate-ping" />
              )}
            </div>
            <span className="text-[10px] text-yellow-500 font-medium mt-1 inline-block">Autorización remota activa</span>
          </div>
          <div className="h-12 w-12 rounded-lg bg-yellow-500/10 flex items-center justify-center text-yellow-500">
            <Clock size={24} />
          </div>
        </div>

        <div className="bg-[#1e2329] p-5 rounded-xl border border-[#2b3139] flex items-center justify-between">
          <div>
            <span className="text-xs text-gray-400 font-medium">Excepciones Aprobadas</span>
            <div className="text-2xl font-bold text-emerald-400 mt-1">{stats.approvedToday}</div>
            <span className="text-[10px] text-gray-400 mt-1 inline-block">Con clave de salto de 30m</span>
          </div>
          <div className="h-12 w-12 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
            <UserCheck size={24} />
          </div>
        </div>

        <div className="bg-[#1e2329] p-5 rounded-xl border border-[#2b3139] flex items-center justify-between">
          <div>
            <span className="text-xs text-gray-400 font-medium">Reportes Relevantes (RIP)</span>
            <div className="text-2xl font-bold text-blue-400 mt-1">{stats.totalRelevant}</div>
            <span className="text-[10px] text-gray-400 mt-1 inline-block">Operaciones &gt;= $7.5K USD equiv</span>
          </div>
          <div className="h-12 w-12 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
            <FileSpreadsheet size={24} />
          </div>
        </div>

        <div className="bg-[#1e2329] p-5 rounded-xl border border-[#2b3139] flex items-center justify-between">
          <div>
            <span className="text-xs text-gray-400 font-medium">Alertas Inusuales</span>
            <div className="text-2xl font-bold text-red-400 mt-1">{stats.totalInusual}</div>
            <span className="text-[10px] text-red-400 font-medium mt-1 inline-block">Hits o desvíos de umbral</span>
          </div>
          <div className="h-12 w-12 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500">
            <ShieldAlert size={24} />
          </div>
        </div>
      </div>

      {/* Tabs navigation */}
      <div className="flex flex-wrap border-b border-[#2b3139] gap-4 mb-6">
        <button 
          onClick={() => setActiveSubTab("authorizations")}
          className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-2 border-b-2 relative ${
            activeSubTab === "authorizations" 
              ? "text-binance-yellow border-binance-yellow" 
              : "text-gray-400 border-transparent hover:text-white"
          }`}
        >
          <Clock size={16} />
          Autorizaciones Remotas (Saltos)
          {stats.pendingCount > 0 && (
            <span className="bg-yellow-500 text-black text-[9px] font-bold px-1.5 py-0.5 rounded-full">
              {stats.pendingCount}
            </span>
          )}
        </button>

        <button 
          onClick={() => setActiveSubTab("rules")}
          className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-2 border-b-2 relative ${
            activeSubTab === "rules" 
              ? "text-binance-yellow border-binance-yellow" 
              : "text-gray-400 border-transparent hover:text-white"
          }`}
        >
          <ShieldAlert size={16} />
          Motor PLD Interno
          {stats.pendingPldAlerts > 0 && (
            <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
              {stats.pendingPldAlerts}
            </span>
          )}
        </button>

        <button 
          onClick={() => setActiveSubTab("import")}
          className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-2 border-b-2 ${
            activeSubTab === "import" 
              ? "text-binance-yellow border-binance-yellow" 
              : "text-gray-400 border-transparent hover:text-white"
          }`}
        >
          <FileSpreadsheet size={16} />
          Importar Listas SDN
        </button>

        <button 
          onClick={() => setActiveSubTab("layouts")}
          className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-2 border-b-2 ${
            activeSubTab === "layouts" 
              ? "text-binance-yellow border-binance-yellow" 
              : "text-gray-400 border-transparent hover:text-white"
          }`}
        >
          <FileText size={16} />
          Layouts CNBV (.txt)
        </button>

        <button 
          onClick={() => setActiveSubTab("search")}
          className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-2 border-b-2 ${
            activeSubTab === "search" 
              ? "text-binance-yellow border-binance-yellow" 
              : "text-gray-400 border-transparent hover:text-white"
          }`}
        >
          <Search size={16} />
          Consulta de Listas (Búsqueda Preventiva)
        </button>

        <button 
          onClick={() => setActiveSubTab("reports")}
          className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-2 border-b-2 ${
            activeSubTab === "reports" 
              ? "text-binance-yellow border-binance-yellow" 
              : "text-gray-400 border-transparent hover:text-white"
          }`}
        >
          <FileText size={16} />
          Bitácora RIP / Operaciones Inusuales
        </button>
      </div>

      {/* Active Tab Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* 1. AUTHORIZATIONS TAB */}
          {activeSubTab === "authorizations" && (
            <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold text-base flex items-center gap-2">
                  <Clock size={18} className="text-binance-yellow" />
                  Solicitudes de Autorización de Límite (KYC y Listas)
                </h3>
                <button 
                  onClick={fetchData} 
                  className="text-xs text-gray-400 hover:text-white flex items-center gap-1 bg-[#2b3139] px-2.5 py-1 rounded"
                >
                  <RefreshCw size={12} /> Actualizar
                </button>
              </div>

              {loadingAuths ? (
                <div className="py-12 text-center text-gray-400 text-xs">Cargando solicitudes...</div>
              ) : authorizations.length === 0 ? (
                <div className="py-12 text-center text-gray-500 text-xs">
                  No hay solicitudes de autorización activas o históricas en la bitácora.
                </div>
              ) : (
                <div className="space-y-4">
                  {authorizations.map((auth) => {
                    const isPending = auth.status === "PENDING";
                    const isExpired = auth.status === "EXPIRED";
                    const isApproved = auth.status === "APPROVED";
                    const isUsed = auth.status === "USED";
                    const isRejected = auth.status === "REJECTED";

                    return (
                      <div 
                        key={auth.id} 
                        className={`p-4 rounded-xl border transition-all ${
                          isPending 
                            ? "bg-yellow-500/5 border-yellow-500/20" 
                            : isApproved || isUsed
                            ? "bg-emerald-500/5 border-emerald-500/20"
                            : "bg-gray-500/5 border-gray-500/20"
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
                          <div>
                            <span className="text-[10px] bg-[#2b3139] text-gray-300 font-mono px-2 py-0.5 rounded">
                              FOLIO: {auth.id}
                            </span>
                            <span className="text-xs text-gray-400 ml-2">
                              {new Date(auth.created_at).toLocaleTimeString()} - {new Date(auth.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          
                          <div>
                            {isPending && (
                              <span className="text-[10px] bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 px-2 py-0.5 rounded font-bold animate-pulse">
                                PENDIENTE OFICIAL
                              </span>
                            )}
                            {isApproved && (
                              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-bold">
                                APROBADA (SIN USAR)
                              </span>
                            )}
                            {isUsed && (
                              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-bold">
                                UTILIZADA POR CAJA
                              </span>
                            )}
                            {isRejected && (
                              <span className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded font-bold">
                                RECHAZADA
                              </span>
                            )}
                            {isExpired && (
                              <span className="text-[10px] bg-gray-500/10 text-gray-400 border border-gray-500/20 px-2 py-0.5 rounded font-bold">
                                EXPIRADA (LÍMITE 30M)
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
                          <div>
                            <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">Cliente</div>
                            <div className="text-sm font-bold text-white">{auth.client_name}</div>
                            <div className="text-[10px] text-gray-500 font-mono">{auth.client_id}</div>
                          </div>

                          <div>
                            <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">Monto de Operación</div>
                            <div className="text-sm font-bold text-yellow-500">
                              {auth.amount_usd > 0 ? `$${auth.amount_usd.toLocaleString()} USD` : "N/A"}
                            </div>
                            <span className="text-[10px] text-gray-500 font-mono">Solicitante: {auth.requested_by}</span>
                          </div>

                          <div>
                            <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">Razón del Salto</div>
                            <div className="text-xs font-medium text-white flex items-center gap-1">
                              <AlertTriangle size={12} className="text-yellow-500 shrink-0" />
                              {auth.reason}
                            </div>
                          </div>
                        </div>

                        {/* Actions for remote approval */}
                        {isPending && (
                          <div className="flex flex-col sm:flex-row items-center gap-2 pt-3 border-t border-[#2b3139] justify-between">
                            <span className="text-[10px] text-gray-400 flex items-center gap-1">
                              <Clock size={12} /> Expira en: {Math.max(0, Math.round((new Date(auth.expires_at).getTime() - Date.now()) / 60000))} mins
                            </span>
                            <div className="flex gap-2 w-full sm:w-auto">
                              <button
                                onClick={() => handleReject(auth.id)}
                                className="flex-1 sm:flex-initial bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold px-4 py-2 rounded-lg transition-colors border border-red-500/20 flex items-center justify-center gap-1.5"
                              >
                                <XCircle size={14} /> Rechazar
                              </button>
                              <button
                                onClick={() => handleApprove(auth.id)}
                                className="flex-1 sm:flex-initial bg-emerald-500 hover:bg-[#2ebd85] text-[#181a20] text-xs font-bold px-5 py-2 rounded-lg transition-all flex items-center justify-center gap-1.5"
                              >
                                <CheckCircle size={14} /> Aprobar Excepción
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Approved code display */}
                        {(isApproved || isUsed) && (
                          <div className="pt-3 border-t border-[#2b3139] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-400">Autorizó:</span>
                              <span className="text-xs font-bold text-white bg-[#2b3139] px-2 py-0.5 rounded">
                                {auth.authorized_by}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 font-mono">Clave Inmutable de 9-caracteres:</span>
                              <div className="flex items-center bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-lg">
                                <span className="text-emerald-400 font-mono font-bold text-sm select-all tracking-widest mr-2">
                                  {auth.passcode}
                                </span>
                                <button 
                                  onClick={() => copyToClipboard(auth.passcode)}
                                  className="text-gray-400 hover:text-white transition-colors"
                                  title="Copiar Clave"
                                >
                                  {copiedId === auth.passcode ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 1B. INTERNAL PLD RULES TAB */}
          {activeSubTab === "rules" && (
            <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-white font-bold text-base flex items-center gap-2">
                    <ShieldAlert size={18} className="text-binance-yellow" />
                    Motor de Alertas PLD Interno (Sin Dependencia ODBC)
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Análisis en tiempo real del perfil transaccional y comportamiento (Estructuración/Pitufeo) en ventanilla.
                  </p>
                </div>
                <button 
                  onClick={fetchData} 
                  className="text-xs text-gray-400 hover:text-white flex items-center gap-1 bg-[#2b3139] px-2.5 py-1 rounded"
                >
                  <RefreshCw size={12} /> Analizar
                </button>
              </div>

              {loadingPld ? (
                <div className="py-12 text-center text-gray-400 text-xs">Analizando patrones en la base de datos...</div>
              ) : pldAlerts.length === 0 ? (
                <div className="py-12 text-center text-gray-500 text-sm border border-dashed border-[#2b3139] rounded-xl">
                  <ShieldCheck className="mx-auto text-emerald-400 h-8 w-8 mb-2 opacity-55" />
                  No se detectaron patrones de fraccionamiento o perfil excedido. Sistema estable.
                </div>
              ) : (
                <div className="space-y-4">
                  {pldAlerts.map((alert) => {
                    const isPending = alert.status === "PENDING";
                    const isReported = alert.status === "REPORTED_CNBV";
                    const isResolved = alert.status === "RESOLVED";
                    const isRed = alert.risk === "ROJO";

                    return (
                      <div 
                        key={alert.id} 
                        className={`p-4 rounded-xl border transition-all ${
                          isPending 
                            ? isRed
                              ? "bg-red-500/5 border-red-500/20"
                              : "bg-yellow-500/5 border-yellow-500/20" 
                            : isReported
                            ? "bg-purple-500/5 border-purple-500/20"
                            : "bg-[#2b3139]/30 border-transparent"
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              isRed ? "bg-red-500/10 text-red-400" : "bg-yellow-500/10 text-yellow-400"
                            }`}>
                              RIESGO: {alert.risk}
                            </span>
                            <span className="text-xs font-bold text-white">
                              {alert.rule}
                            </span>
                          </div>
                          <div>
                            <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                              isPending 
                                ? "bg-yellow-500 text-black animate-pulse" 
                                : isReported 
                                ? "bg-purple-500 text-white" 
                                : "bg-emerald-500 text-black"
                            }`}>
                              {alert.status === "PENDING" ? "PENDIENTE REVISIÓN" : alert.status === "RESOLVED" ? "SOLVENTADO" : "REPORTADO A CNBV"}
                            </span>
                          </div>
                        </div>

                        <div className="text-sm font-semibold text-white mb-1">
                          Cliente: {alert.client_name}
                        </div>
                        <p className="text-xs text-gray-300 mb-3 leading-relaxed">
                          {alert.description}
                        </p>

                        <div className="bg-[#181a20] p-3 rounded-lg text-[11px] font-mono text-gray-400 mb-3 space-y-1">
                          <div><span className="text-gray-500">Alert-ID:</span> {alert.id}</div>
                          <div><span className="text-gray-500">Fecha Detección:</span> {new Date(alert.timestamp).toLocaleString()}</div>
                          <div><span className="text-gray-500">Operaciones Involucradas:</span> {alert.operations.join(", ")}</div>
                          {alert.notes && (
                            <div className="pt-2 border-t border-[#2b3139] text-yellow-400">
                              <span className="text-gray-500">Dictamen Oficial:</span> {alert.notes}
                            </div>
                          )}
                        </div>

                        {/* Resolve Actions inside the Alert row */}
                        {isPending && (
                          <div className="pt-3 border-t border-[#2b3139]">
                            <div className="text-[11px] text-gray-400 mb-2 font-medium">Emitir Dictamen de Cumplimiento (PLD):</div>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <input 
                                type="text"
                                placeholder="Escribe notas del dictamen o resolución técnica..."
                                className="flex-1 bg-[#181a20] border border-[#2b3139] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-binance-yellow"
                                id={`notes-${alert.id}`}
                              />
                              <div className="flex gap-1">
                                <button
                                  onClick={async () => {
                                    const notesInput = document.getElementById(`notes-${alert.id}`) as HTMLInputElement;
                                    const notes = notesInput ? notesInput.value : "";
                                    try {
                                      const res = await fetch("/api/compliance/pld-alert-action", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                          alertId: alert.id,
                                          status: "RESOLVED",
                                          notes,
                                          resolvedBy: profile?.auth_user_id || "OFICIAL_CUMPLIMIENTO"
                                        })
                                      });
                                      if (res.ok) {
                                        fetchData();
                                      }
                                    } catch (err) {
                                      console.error(err);
                                    }
                                  }}
                                  className="bg-emerald-500 text-[#181a20] hover:bg-[#2ebd85] font-bold text-[10px] px-3 py-1.5 rounded transition-all shrink-0"
                                >
                                  Descartar (Falso Positivo)
                                </button>
                                <button
                                  onClick={async () => {
                                    const notesInput = document.getElementById(`notes-${alert.id}`) as HTMLInputElement;
                                    const notes = notesInput ? notesInput.value : "";
                                    try {
                                      const res = await fetch("/api/compliance/pld-alert-action", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                          alertId: alert.id,
                                          status: "REPORTED_CNBV",
                                          notes,
                                          resolvedBy: profile?.auth_user_id || "OFICIAL_CUMPLIMIENTO"
                                        })
                                      });
                                      if (res.ok) {
                                        fetchData();
                                      }
                                    } catch (err) {
                                      console.error(err);
                                    }
                                  }}
                                  className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-[10px] px-3 py-1.5 rounded transition-all shrink-0"
                                >
                                  Reportar a CNBV (Inusual)
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 1C. CUSTOM LISTS IMPORT TAB */}
          {activeSubTab === "import" && (
            <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl p-6">
              <h3 className="text-white font-bold text-base mb-2 flex items-center gap-2">
                <FileSpreadsheet size={18} className="text-binance-yellow" />
                Importación y Actualización Autónoma de Listas Negras (SDN)
              </h3>
              <p className="text-xs text-gray-400 mb-6 leading-relaxed">
                Importa directamente registros actualizados de la OFAC (Bloqueados), CNBV (Sanciones) o PEP sin depender del sistema MySQL local. Al capturar operaciones en la ventanilla principal, el sistema SaaS validará concurrentemente contra estas bases de datos locales cargadas.
              </p>

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-semibold">Seleccionar Lista de Destino</label>
                    <select
                      value={importList}
                      onChange={(e) => setImportList(e.target.value)}
                      className="w-full bg-[#181a20] border border-[#2b3139] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-binance-yellow"
                    >
                      <option value="ofac">OFAC (SDN List - Clinton List)</option>
                      <option value="cnbv">CNBV (Listas de Personas Bloqueadas)</option>
                      <option value="pep">PEP (Personas Políticamente Expuestas)</option>
                      <option value="sat">SAT 69-B (Empresas Facturadoras Inexistentes)</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-300">
                      <input 
                        type="checkbox"
                        checked={importClearFirst}
                        onChange={(e) => setImportClearFirst(e.target.checked)}
                        className="rounded accent-binance-yellow"
                      />
                      Limpiar registros anteriores antes de importar (Reemplazo Total)
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1 font-semibold">
                    Registros a Importar (Formato Pipe-Separated | )
                  </label>
                  <p className="text-[10px] text-gray-500 mb-2">
                    Estructura: <code className="text-gray-300">Nombre Completo | Motivo/Cargo/Resolución | Coincidencia (RED/AMARILLO)</code>
                  </p>
                  <textarea
                    rows={8}
                    value={importRawText}
                    onChange={(e) => setImportRawText(e.target.value)}
                    placeholder="Escribe o pega aquí los registros. Ejemplo:&#10;NICOLAS MADURO MOROS | Presidente de Venezuela / OFAC SDN | RED&#10;RAUL CASTRO RUZ | Politburo Cuba / OFAC SDN | RED&#10;ALVARO URIBE VELEZ | Coincidencia Homonimia Preventiva | AMARILLO"
                    className="w-full bg-[#181a20] border border-[#2b3139] rounded-lg p-3 text-xs text-white font-mono focus:outline-none focus:border-binance-yellow placeholder:text-gray-600"
                  />
                </div>

                {importMessage && (
                  <div className={`p-3 rounded-lg text-xs font-semibold ${
                    importMessage.includes("Error") ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  }`}>
                    {importMessage}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    disabled={importLoading || !importRawText.trim()}
                    onClick={async () => {
                      setImportLoading(true);
                      setImportMessage("");
                      try {
                        const res = await fetch("/api/compliance/import-list", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            listName: importList,
                            rawText: importRawText,
                            clearFirst: importClearFirst
                          })
                        });
                        const data = await res.json();
                        if (res.ok) {
                          setImportMessage(data.message || "Lista importada correctamente.");
                          setImportRawText("");
                        } else {
                          setImportMessage(`Error: ${data.message}`);
                        }
                      } catch (err) {
                        setImportMessage(`Error de red: ${(err as Error).message}`);
                      } finally {
                        setImportLoading(false);
                      }
                    }}
                    className={`px-5 py-2.5 rounded-lg text-xs font-bold text-[#181a20] transition-colors ${
                      !importRawText.trim() ? "bg-gray-600 text-gray-400 cursor-not-allowed" : "bg-binance-yellow hover:bg-yellow-400"
                    }`}
                  >
                    {importLoading ? "Procesando Importación..." : "Procesar y Guardar en SaaS"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 1D. CNBV LAYOUTS EXPORT TAB */}
          {activeSubTab === "layouts" && (
            <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl p-6">
              <h3 className="text-white font-bold text-base mb-2 flex items-center gap-2">
                <FileText size={18} className="text-binance-yellow" />
                Módulo de Reporteo CNBV (LayOuts Oficiales TXT)
              </h3>
              <p className="text-xs text-gray-400 mb-6 leading-relaxed">
                Descarga directamente los archivos en formato de texto plano (.txt) estructurados bajo el estándar oficial de reporte de la Comisión Nacional Bancaria y de Valores. Al no requerir conexiones externas, este SaaS extrae directamente los volúmenes transaccionales y marcas inusuales del motor local.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Relevantes card */}
                <div className="bg-[#181a20] p-5 rounded-xl border border-[#2b3139] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-full bg-blue-400" />
                      <h4 className="text-sm font-bold text-white uppercase">Operaciones Relevantes</h4>
                    </div>
                    <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                      Todas las transacciones de compra, venta o canje de divisas (o tokens estables como USDT) individuales que igualen o excedan el umbral regulatorio de <strong>$7,500 USD</strong> equivalent en las últimas 24 horas.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      window.open("/api/compliance/export-layout?type=RELEVANTE", "_blank");
                    }}
                    className="w-full bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-bold text-xs py-2.5 rounded-lg transition-colors border border-blue-500/20 flex items-center justify-center gap-2"
                  >
                    <FileText size={14} /> Descargar .txt Relevantes
                  </button>
                </div>

                {/* Inusuales card */}
                <div className="bg-[#181a20] p-5 rounded-xl border border-[#2b3139] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-full bg-red-400" />
                      <h4 className="text-sm font-bold text-white uppercase">Operaciones Inusuales</h4>
                    </div>
                    <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                      Historial de comportamientos estructurados (pitufeo), brechas de perfil transaccional dictaminadas, o hits confirmados en listas negras con justificación del Oficial de Cumplimiento.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      window.open("/api/compliance/export-layout?type=INUSUAL", "_blank");
                    }}
                    className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold text-xs py-2.5 rounded-lg transition-colors border border-red-500/20 flex items-center justify-center gap-2"
                  >
                    <FileText size={14} /> Descargar .txt Inusuales
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 2. MANUAL LOOKUP TAB */}
          {activeSubTab === "search" && (
            <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl p-6">
              <h3 className="text-white font-bold text-base mb-2 flex items-center gap-2">
                <Search size={18} className="text-binance-yellow" />
                Consulta Preventiva de Listas (OFAC, PEP, CNBV y SAT 69-B)
              </h3>
              <p className="text-xs text-gray-400 mb-6">
                Realiza búsquedas preventivas manuales fuera del flujo transaccional de caja para verificar prospectos de clientes.
              </p>

              <form onSubmit={handleManualSearch} className="flex gap-2 mb-6">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input 
                    type="text" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Escribe el nombre completo o razón social a auditar..."
                    className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-binance-yellow"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searchLoading || !searchQuery.trim()}
                  className="bg-binance-yellow hover:bg-[#f3ba2f] text-[#181a20] px-6 py-2.5 rounded-xl font-bold text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5"
                >
                  {searchLoading ? <RefreshCw className="animate-spin" size={14} /> : "Buscar en Listas"}
                </button>
              </form>

              {/* SEMAFORO VISUAL RESULTS */}
              {searchResult && (
                <div className="space-y-4">
                  <h4 className="text-white font-semibold text-xs tracking-wider uppercase mb-2">Semáforo de Riesgo CNBV/AML</h4>
                  
                  {/* GREEN STATUS */}
                  {searchResult.riskLevel === "VERDE" && (
                    <div className="bg-emerald-500/5 border border-emerald-500/20 p-5 rounded-xl">
                      <div className="flex items-start gap-4">
                        <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
                          <CheckCircle size={24} />
                        </div>
                        <div>
                          <div className="text-emerald-400 font-bold text-sm mb-1">AUDITORÍA LIMPIA: VERDE (Sin coincidencias)</div>
                          <p className="text-xs text-gray-400">
                            El nombre <strong className="text-white">"{searchQuery}"</strong> no figura en ninguna de las bases de datos locales ni internacionales de la OFAC, PEP, CNBV ni SAT 69-B. El prospecto se considera de bajo riesgo.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* YELLOW STATUS */}
                  {searchResult.riskLevel === "AMARILLO" && (
                    <div className="bg-yellow-500/5 border border-yellow-500/20 p-5 rounded-xl">
                      <div className="flex items-start gap-4">
                        <div className="h-10 w-10 rounded-full bg-yellow-500/10 flex items-center justify-center text-yellow-500 shrink-0">
                          <AlertTriangle size={24} />
                        </div>
                        <div>
                          <div className="text-yellow-500 font-bold text-sm mb-1">RESTRICCIÓN PREVENTIVA: AMARILLO (Posible homónimo)</div>
                          <p className="text-xs text-gray-400 mb-3">
                            Se detectaron coincidencias parciales de homonimia en las listas oficiales. Es necesario revisar el desglose y de ser necesario solicitar expediente ampliado (KYC dinámico).
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* RED STATUS */}
                  {searchResult.riskLevel === "ROJO" && (
                    <div className="bg-red-500/5 border border-red-500/20 p-5 rounded-xl">
                      <div className="flex items-start gap-4">
                        <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-400 shrink-0">
                          <XCircle size={24} />
                        </div>
                        <div>
                          <div className="text-red-400 font-bold text-sm mb-1">BLOQUEO OBLIGATORIO: ROJO (HIT Confirmado)</div>
                          <p className="text-xs text-gray-400">
                            ¡ALERTA MÁXIMA! Se encontró una coincidencia exacta de bloqueo en listas negras del SAT 69-B, OFAC o PEP de alto riesgo. El sistema requiere bloqueo inmediato de transacciones y emisión del reporte inusual.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* MATCHES DETAIL */}
                  {searchResult.matches.length > 0 && (
                    <div className="space-y-3 mt-4">
                      <h5 className="text-xs text-gray-400 font-bold">Desglose Concurrente de Coincidencias</h5>
                      {searchResult.matches.map((match) => (
                        <div key={match.id} className="bg-[#181a20] border border-[#2b3139] rounded-xl p-4 flex justify-between items-start">
                          <div>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono ${
                                match.tipo_coincidencia === "RED" 
                                  ? "bg-red-500/10 text-red-400 border border-red-500/20" 
                                  : "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20"
                              }`}>
                                {match.lista}
                              </span>
                              <span className="text-xs font-semibold text-white">{match.nombre_completo}</span>
                            </div>
                            <p className="text-xs text-gray-400 font-sans">{match.detalles}</p>
                          </div>
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${
                            match.tipo_coincidencia === "RED" ? "text-red-500" : "text-yellow-500"
                          }`}>
                            {match.tipo_coincidencia === "RED" ? "Hit / Bloqueado" : "Advertencia"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 3. AUDIT RELEVANTE / INUSUAL LOG (BITÁCORA RIP) */}
          {activeSubTab === "reports" && (
            <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl p-6">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 mb-4">
                <h3 className="text-white font-bold text-base flex items-center gap-2">
                  <FileText size={18} className="text-binance-yellow" />
                  Bitácora RIP: Operaciones Relevantes e Inusuales
                </h3>
                <button
                  onClick={() => {
                    const csvContent = "data:text/csv;charset=utf-8," 
                      + "ID,Tipo,Cliente ID,Cliente,Monto USD,Fecha,Descripción\n"
                      + reports.map(r => `"${r.id}","${r.tipo}","${r.client_id}","${r.client_name}",${r.amount_usd},"${r.created_at}","${r.description.replace(/"/g, '""')}"`).join("\n");
                    const encodedUri = encodeURI(csvContent);
                    const link = document.createElement("a");
                    link.setAttribute("href", encodedUri);
                    link.setAttribute("download", `reporte_cnbv_aml_${Date.now()}.csv`);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  className="bg-emerald-500 hover:bg-[#2ebd85] text-[#181a20] text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1 transition-all"
                >
                  <FileSpreadsheet size={14} /> Exportar CSV para CNBV
                </button>
              </div>

              {loadingReports ? (
                <div className="py-12 text-center text-gray-400 text-xs">Cargando reportes de bitácora...</div>
              ) : reports.length === 0 ? (
                <div className="py-12 text-center text-gray-500 text-xs">
                  No hay reportes AML ni bitácoras registradas de operaciones inusuales.
                </div>
              ) : (
                <div className="space-y-4">
                  {reports.map((report) => (
                    <div key={report.id} className="bg-[#181a20] border border-[#2b3139] rounded-xl p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded font-mono ${
                            report.tipo === "RELEVANTE" 
                              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" 
                              : "bg-red-500/10 text-red-400 border border-red-500/20"
                          }`}>
                            REPORTE {report.tipo}
                          </span>
                          <span className="text-xs text-gray-400">Folio: #{report.id}</span>
                        </div>
                        <span className="text-[10px] text-gray-500">
                          {new Date(report.created_at).toLocaleString()}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-2">
                        <div>
                          <div className="text-[10px] text-gray-500 uppercase font-semibold">Cliente</div>
                          <div className="text-xs font-bold text-white">{report.client_name}</div>
                          <div className="text-[9px] text-gray-400 font-mono">UID: {report.client_id}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-500 uppercase font-semibold">Monto Equiv.</div>
                          <div className="text-xs font-bold text-yellow-500">
                            ${report.amount_usd.toLocaleString()} USD
                          </div>
                          <div className="text-[9px] text-gray-400 font-mono">Oficial: {report.oficial_id}</div>
                        </div>
                      </div>

                      <div className="bg-[#1e2329] p-2.5 rounded border border-[#2b3139] text-[11px] text-gray-300 font-mono">
                        {report.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Sidebar/Analytics Right Column */}
        <div className="space-y-6">
          
          {/* OFICIAL DE CUMPLIMIENTO PERFIL */}
          <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl p-5">
            <h4 className="text-white font-bold text-sm mb-3">Oficial Identificado</h4>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-binance-yellow/10 flex items-center justify-center text-binance-yellow font-bold text-sm">
                {(profile?.nickname || "OC").substring(0,2).toUpperCase()}
              </div>
              <div>
                <div className="text-xs font-bold text-white">{profile?.nickname || "OFICIAL_CUMPLIMIENTO"}</div>
                <div className="text-[10px] text-gray-400">{profile?.puesto || "Oficial de Cumplimiento (Nivel 5)"}</div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-[#2b3139] space-y-2">
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-400">Nivel de Firma</span>
                <span className="text-emerald-400 font-bold">Nivel 5 (Supervisión)</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-400">Jurisdicción de Control</span>
                <span className="text-white font-medium">Bancore Global - CNBV</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-400">Acceso a Bitácora RIP</span>
                <span className="text-white font-medium">Lectura / Escritura Inmutable</span>
              </div>
            </div>
          </div>

          {/* COMPLIANCE ANALYTICS CHARTS */}
          <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl p-5">
            <h4 className="text-white font-bold text-sm mb-1 flex items-center gap-1.5">
              <TrendingUp size={16} className="text-binance-yellow" />
              Estadísticas CNBV
            </h4>
            <p className="text-[10px] text-gray-400 mb-4">
              Historial mensual de excepciones e identificación de listas.
            </p>

            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2b3139" />
                  <XAxis dataKey="name" stroke="#848e9c" fontSize={10} tickLine={false} />
                  <YAxis stroke="#848e9c" fontSize={10} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "#1e2329", borderColor: "#2b3139" }}
                    labelStyle={{ color: "#fff", fontSize: "11px" }}
                    itemStyle={{ fontSize: "11px" }}
                  />
                  <Legend verticalAlign="top" height={24} iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
                  <Bar dataKey="Relevantes" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Relevantes" />
                  <Bar dataKey="Inusuales" fill="#ef4444" radius={[4, 4, 0, 0]} name="Inusuales" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="h-[140px] w-full mt-6">
              <span className="text-[10px] text-gray-400 font-bold block mb-2">Histórico de Flujos Remotos ($ USD)</span>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={valueChartData} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2b3139" />
                  <XAxis dataKey="name" stroke="#848e9c" fontSize={9} />
                  <YAxis stroke="#848e9c" fontSize={9} />
                  <Tooltip contentStyle={{ backgroundColor: "#1e2329", borderColor: "#2b3139" }} />
                  <Area type="monotone" dataKey="Monto" stroke="#f3ba2f" fill="rgba(243,186,47,0.1)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* CNBV COMPLIANCE INFO GUIDES */}
          <div className="bg-[#1e2329] border border-[#2b3139] rounded-xl p-5 text-xs text-gray-400 space-y-3">
            <h4 className="text-white font-bold text-xs flex items-center gap-1.5">
              <HelpCircle size={14} className="text-binance-yellow" />
              Guía Operativa CNBV/UIF
            </h4>
            <p>
              <strong>Operaciones Relevantes:</strong> Toda operación con divisas en efectivo de monto igual o superior al equivalente a <strong>$7,500 USD</strong>.
            </p>
            <p>
              <strong>Operaciones Inusuales:</strong> Operaciones cuyas condiciones no concuerden con los antecedentes conocidos del cliente, o bien que intenten estructurar montos menores para evadir reportes (pitufeo).
            </p>
            <p>
              <strong>Oficial de Cumplimiento:</strong> Responsable último de validar excepciones e ingresar claves del semáforo. Toda firma deja una huella digital inalterable.
            </p>
          </div>

        </div>

      </div>
    </div>
  );
}
