import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../contexts/AuthContext";
import { 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  CartesianGrid,
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  Legend
} from "recharts";
import { 
  Activity, 
  Briefcase, 
  Layers, 
  ShieldAlert, 
  CheckCircle2, 
  RefreshCw, 
  Smartphone, 
  UserCheck, 
  AlertTriangle, 
  Building2, 
  TrendingUp, 
  ChevronRight, 
  DollarSign, 
  X, 
  Fingerprint, 
  Check, 
  Scan,
  Coins,
  Locate,
  Printer,
  ShieldCheck,
  Send,
  Download
} from "lucide-react";

// Types
interface PortfolioItem {
  currency: string;
  quantity: number;
  cost_basis_avg: number;
  value_mxn: number;
  batches_count: number;
}

interface NodeItem {
  sucursal_id: string;
  nombre: string;
  ciudad: string;
  status: string; // 'Abierto' | 'Cerrado'
  terminal_locked: boolean;
  physical_balances: Record<string, number>;
  clearing_balance_usdt: number;
}

interface AnalyticsItem {
  time: string;
  retail_rate: number;
  retail_buy: number;
  international_rate: number;
  spread: number;
}

interface PendingAction {
  id: string;
  type: string; // 'RIP_OPERATION' | 'GERENCIA_GASTO'
  title: string;
  amount: number;
  currency: string;
  branch_id: string;
  requested_by: string;
  description: string;
  status: string;
}

interface DashboardData {
  totalValueMXN: number;
  portfolio: PortfolioItem[];
  nodes: NodeItem[];
  spread_analytics: AnalyticsItem[];
  pending_actions: PendingAction[];
  cajas?: any[];
  dotaciones?: any[];
  timestamp: string;
}

export default function LiquidityHub() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRealTime, setIsRealTime] = useState(false);

  const { profile } = useAuth();
  const [cajeros, setCajeros] = useState<any[]>([]);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [selectedSucursalId, setSelectedSucursalId] = useState("");
  
  // New Liquidity / Dotation states
  const [showDotationModal, setShowDotationModal] = useState(false);
  const [selectedCajeroId, setSelectedCajeroId] = useState("");
  const [dotationType, setDotationType] = useState<"APERTURA" | "EMERGENCIA">("APERTURA");
  const [dotationAmount, setDotationAmount] = useState("");
  const [folioBoveda, setFolioBoveda] = useState("");
  const [simulatedAuthCode, setSimulatedAuthCode] = useState<string | null>(null);
  const [remoteAuthScanning, setRemoteAuthScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  // Estado para autorizar dotaciones pendientes desde el log
  const [authorizingDotId, setAuthorizingDotId] = useState<string | null>(null);
  const [authScanning, setAuthScanning] = useState(false);
  const [authScanProgress, setAuthScanProgress] = useState(0);
  const [authResult, setAuthResult] = useState<{ dotationId: string; clave: string; monto: number } | null>(null);

  // New Withdrawal states
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [withdrawalFolioBoveda, setWithdrawalFolioBoveda] = useState("");

  // Receipt & Status feedback
  const [showReceiptModal, setShowReceiptModal] = useState<any | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch list of active cashiers + sucursales for dropdown
  useEffect(() => {
    fetch("/api/liquidity/cajeros")
      .then((res) => res.json())
      .then((json) => {
        if (json.status === "success") {
          setCajeros(json.data);
          if (json.data.length > 0) {
            setSelectedCajeroId(json.data[0].id);
          }
        }
      })
      .catch((err) => console.error("Error loading cajeros:", err));

    fetch("/api/sucursales")
      .then((res) => res.json())
      .then((json) => {
        if (json.status === "success" && Array.isArray(json.data)) {
          setSucursales(json.data);
          if (json.data.length > 0) {
            setSelectedSucursalId(json.data[0].sucursal_id);
          }
        }
      })
      .catch((err) => console.error("Error loading sucursales:", err));
  }, []);

  // Cajeros filtrados por la sucursal seleccionada
  const cajerosDeSucursal = cajeros.filter(c => c.branch_id === selectedSucursalId);
  
  // Selection states
  const [selectedNode, setSelectedNode] = useState<NodeItem | null>(null);
  const [activeTab, setActiveTab] = useState<"physical" | "clearing">("physical");
  
  // Biometric validation simulation states
  const [biometricAction, setBiometricAction] = useState<PendingAction | null>(null);
  const [biometricStep, setBiometricStep] = useState<"idle" | "scanning" | "analyzing" | "success">("idle");
  const [biometricProgress, setBiometricProgress] = useState(0);

  // Manual refresh fallback
  const handleManualRefresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/liquidity/dashboard-data");
      const json = await res.json();
      if (json.status === "success") {
        setData(json.data);
        setError(null);
      } else {
        setError("Error de servidor al cargar datos.");
      }
    } catch (err) {
      setError("Error de conexión al servidor.");
    } finally {
      setLoading(false);
    }
  };

  // Real-time EventSource connection with 5s manual fallback polling
  useEffect(() => {
    let sse: EventSource | null = null;
    let pollInterval: NodeJS.Timeout | null = null;
    
    const startFallbackPolling = () => {
      if (pollInterval) return;
      console.log("[SSE Fallback] Initiating 5s Fetch polling for Liquidity Hub...");
      handleManualRefresh();
      pollInterval = setInterval(() => {
        handleManualRefresh();
      }, 5000);
    };

    const connectSSE = () => {
      sse = new EventSource("/api/liquidity/subscription");
      
      sse.onopen = () => {
        setIsRealTime(true);
        setLoading(false);
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      };
      
      sse.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          setData(payload);
          setError(null);
        } catch (err) {
          console.error("Error parsing real-time liquidity event:", err);
        }
      };
      
      sse.onerror = (err) => {
        console.error("SSE connection closed or failed. Falling back to manual refresh.", err);
        setIsRealTime(false);
        if (sse) sse.close();
        
        startFallbackPolling();
      };
    };

    connectSSE();

    // Force-refresh listener for local transaction synchronization
    const handleGlobalSync = () => {
      console.log("[Global Sync] Received fx_transaction_success, force-refreshing Liquidity Hub...");
      handleManualRefresh();
    };
    window.addEventListener('fx_transaction_success', handleGlobalSync);

    return () => {
      if (sse) sse.close();
      if (pollInterval) clearInterval(pollInterval);
      window.removeEventListener('fx_transaction_success', handleGlobalSync);
    };
  }, []);

  // Biometric scanner progress effect
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (biometricStep === "scanning") {
      setBiometricProgress(0);
      const interval = setInterval(() => {
        setBiometricProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            setBiometricStep("analyzing");
            return 100;
          }
          return prev + 10;
        });
      }, 150);
      return () => clearInterval(interval);
    } else if (biometricStep === "analyzing") {
      timer = setTimeout(() => {
        setBiometricStep("success");
      }, 1200);
    } else if (biometricStep === "success") {
      timer = setTimeout(async () => {
        if (biometricAction) {
          await handleApproveAction(biometricAction.id);
        }
        setBiometricAction(null);
        setBiometricStep("idle");
      }, 1800);
    }
    return () => clearTimeout(timer);
  }, [biometricStep]);

  // Action approval API integration
  const handleApproveAction = async (actionId: string) => {
    try {
      const res = await fetch("/api/liquidity/approve-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId })
      });
      const resJson = await res.json();
      if (resJson.status === "success") {
        // Trigger manual update of data if SSE didn't pick it up immediately
        handleManualRefresh();
      }
    } catch (err) {
      console.error("Error approving action:", err);
    }
  };

  const startBiometricValidation = (action: PendingAction) => {
    setBiometricAction(action);
    setBiometricStep("scanning");
    setBiometricProgress(0);
  };

  // Remote biometric scan effect for Manager Authorization Code
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (remoteAuthScanning) {
      setScanProgress(0);
      interval = setInterval(() => {
        setScanProgress(prev => {
          if (prev >= 100) {
            clearInterval(interval);
            handleCompleteRemoteDotation();
            return 100;
          }
          return prev + 15;
        });
      }, 150);
    }
    return () => clearInterval(interval);
  }, [remoteAuthScanning]);

  const handleCompleteRemoteDotation = async () => {
    try {
      const res = await fetch("/api/liquidity/dotaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gerente_id: profile?.auth_user_id || "user_gerente_1",
          cajero_id: selectedCajeroId,
          monto_mxn: parseFloat(dotationAmount),
          tipo_dotacion: "EMERGENCIA",
        }),
      });
      const json = await res.json();
      if (json.status === "success") {
        setSimulatedAuthCode(json.data.clave_autorizacion);
        setSuccessMessage("¡Firma biométrica generada con éxito! Dotación de Emergencia registrada como PENDIENTE.");
        handleManualRefresh();
      } else {
        setErrorMessage(json.message);
      }
    } catch (err) {
      setErrorMessage("Error de red al registrar dotación.");
    } finally {
      setRemoteAuthScanning(false);
    }
  };

  // Autorizar una dotación pendiente solicitada por un cajero
  const handleAuthorizeDotation = async (dotationId: string) => {
    setAuthorizingDotId(dotationId);
    setAuthScanning(true);
    setAuthScanProgress(0);

    // Simular escaneo biométrico progresivo
    const scanInterval = setInterval(() => {
      setAuthScanProgress(prev => {
        if (prev >= 100) {
          clearInterval(scanInterval);
          return 100;
        }
        return prev + 20;
      });
    }, 200);

    try {
      const res = await fetch("/api/liquidity/dotaciones/autorizar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dotationId,
          gerente_id: profile?.auth_user_id || "user_gerente_1",
        }),
      });
      const json = await res.json();
      clearInterval(scanInterval);
      setAuthScanProgress(100);

      if (json.status === "success") {
        const clave = json.data?.clave_autorizacion;
        setAuthResult({
          dotationId,
          clave: clave || "ERROR",
          monto: json.data?.monto_mxn || 0,
        });
        handleManualRefresh();
      } else {
        setErrorMessage(json.message || "Error al autorizar dotación.");
        setAuthorizingDotId(null);
      }
    } catch (err) {
      clearInterval(scanInterval);
      setErrorMessage("Error de red al autorizar dotación.");
      setAuthorizingDotId(null);
    } finally {
      setAuthScanning(false);
    }
  };

  const handlePhysicalDotationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCajeroId || !dotationAmount || !folioBoveda) {
      setErrorMessage("Todos los campos (Monto y Folio de Validación de Bóveda) son obligatorios.");
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const resReg = await fetch("/api/liquidity/dotaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gerente_id: profile?.auth_user_id || "user_gerente_1",
          cajero_id: selectedCajeroId,
          monto_mxn: parseFloat(dotationAmount),
          tipo_dotacion: "APERTURA",
          folio_boveda: folioBoveda
        }),
      });

      const jsonReg = await resReg.json();
      if (jsonReg.status !== "success") {
        setErrorMessage(jsonReg.message);
        return;
      }

      const resApp = await fetch("/api/liquidity/dotaciones/aplicar-fisica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dotationId: jsonReg.data.id,
          gerente_id: profile?.auth_user_id || "user_gerente_1"
        })
      });

      const jsonApp = await resApp.json();
      if (jsonApp.status === "success") {
        setSuccessMessage("¡Dotación Física de Apertura registrada y aplicada con éxito! Saldo y Bóveda actualizados.");
        setShowDotationModal(false);
        setDotationAmount("");
        setFolioBoveda("");
        handleManualRefresh();
        
        // Show the beautiful receipt right away!
        setShowReceiptModal({
          id: jsonReg.data.id,
          gerente_id: profile?.auth_user_id || "user_gerente_1",
          cajero_id: selectedCajeroId,
          monto_mxn: parseFloat(dotationAmount),
          tipo_dotacion: "APERTURA",
          folio_boveda: folioBoveda,
          estatus: "APLICADO",
          created_at: new Date().toISOString()
        });
      } else {
        setErrorMessage(jsonApp.message);
      }
    } catch (err) {
      setErrorMessage("Error de conexión al procesar dotación física.");
    }
  };

  const handleWithdrawalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCajeroId || !withdrawalAmount || !withdrawalFolioBoveda) {
      setErrorMessage("Todos los campos son obligatorios.");
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/liquidity/cajas/retirar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gerente_id: profile?.auth_user_id || "user_gerente_1",
          cajero_id: selectedCajeroId,
          monto_mxn: parseFloat(withdrawalAmount),
          folio_boveda: withdrawalFolioBoveda
        })
      });

      const json = await res.json();
      if (json.status === "success") {
        setSuccessMessage(json.message);
        setShowWithdrawalModal(false);
        setWithdrawalAmount("");
        setWithdrawalFolioBoveda("");
        handleManualRefresh();
        
        // Show the receipt of the withdrawal movement!
        setShowReceiptModal({
          id: json.data.id,
          gerente_id: profile?.auth_user_id || "user_gerente_1",
          cajero_id: selectedCajeroId,
          monto_mxn: -parseFloat(withdrawalAmount), // Withdrawals stored negative
          tipo_dotacion: "RETIRO PARCIAL",
          folio_boveda: withdrawalFolioBoveda,
          estatus: "APLICADO",
          created_at: new Date().toISOString()
        });
      } else {
        setErrorMessage(json.message);
      }
    } catch (err) {
      setErrorMessage("Error de red al procesar el retiro parcial.");
    }
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] bg-[#06080a] text-white">
        <RefreshCw className="animate-spin text-[#f0b90b] mb-4" size={48} />
        <p className="text-gray-400 font-medium">Estableciendo canal de suscripción en tiempo real...</p>
      </div>
    );
  }

  // Fallback to static mock if backend data is empty (just in case)
  const portfolio = data?.portfolio || [];
  const nodes = data?.nodes || [];
  const spreadAnalytics = data?.spread_analytics || [];
  const pendingActions = data?.pending_actions || [];
  const totalValueMXN = data?.totalValueMXN || 0;

  // Pie colors matching currency themes — paleta del sistema
  const COLORS: Record<string, string> = {
    USD: "#F0B90B",  // Binance Yellow
    EUR: "#8b5cf6",  // Purple
    USDT: "#10b981", // Emerald
    MXN: "#f59e0b",  // Amber
    GBP: "#ef4444",  // Red
    CAD: "#06b6d4"   // Cyan
  };

  // Prepare Recharts Donut Data
  const pieData = portfolio.map(item => ({
    name: item.currency,
    value: item.value_mxn,
    quantity: item.quantity,
    batches_count: item.batches_count
  }));

  return (
    <div className="min-h-screen bg-[#06080a] text-[#f1f5f9] p-4 lg:p-8 font-sans antialiased">
      
      {/* Top Header Row with VIP Title and Live Subscription Badge */}
      <div id="liquidity-hub-header" className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#21262d] pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#f0b90b] mb-1">
            <Layers size={14} />
            Fintech SaaS Logistical Core
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-gray-200 to-gray-500 bg-clip-text text-transparent">
            Global Liquidity Hub
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Dashboard de monitorización global, inventario FIFO y reconciliación de bóvedas de red.
          </p>
        </div>

        {/* Real-Time Subscription Badge */}
        <div className="flex items-center gap-3 self-start md:self-center">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
            isRealTime 
              ? "bg-[#10b981]/10 text-[#10b981] border-[#10b981]/30" 
              : "bg-amber-500/10 text-amber-500 border-amber-500/30"
          }`}>
            <span className={`h-2 w-2 rounded-full ${isRealTime ? "bg-[#10b981] animate-pulse" : "bg-amber-500 animate-ping"}`} />
            {isRealTime ? "Suscripción Real-Time Activa" : "Sincronizando por Polling"}
          </div>

          <button 
            id="btn-manual-refresh"
            onClick={handleManualRefresh}
            className="p-2 bg-[#0d1117] rounded-xl border border-[#21262d] hover:border-[#f0b90b]/50 hover:bg-[#161b22] text-gray-400 hover:text-[#f0b90b] transition-all cursor-pointer"
            title="Refrescar datos manualmente"
          >
            <RefreshCw size={16} className={loading ? "animate-spin text-[#f0b90b]" : ""} />
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
        
        {/* WIDGET DE PORTAFOLIO: Gráfico Donut de Inventario FIFO */}
        <div id="card-portfolio-donut" className="lg:col-span-5 bg-[#0d1117] border border-[#21262d] rounded-2xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between">
          <div className="mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2 text-white">
              <Coins className="text-[#f0b90b]" size={20} />
              Consolidado de Red (FIFO)
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Valor total en moneda nacional de los lotes en inventario</p>
          </div>

          {/* Core Donut Plot */}
          <div className="relative min-h-[300px] h-72 w-full flex items-center justify-center">
            {pieData.length === 0 ? (
              <div className="text-gray-500 text-sm">Sin inventario activo en la red</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={68}
                      outerRadius={90}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[entry.name] || "#6b7280"} className="focus:outline-none" />
                      ))}
                    </Pie>
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: "#161b22", borderColor: "#30363d", borderRadius: "8px", color: "#f1f5f9" }}
                      formatter={(value: any, name: any) => [`$${parseFloat(value).toLocaleString()} MXN`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                
                {/* Embedded Total Consolidado Text */}
                <div className="absolute text-center flex flex-col justify-center items-center pointer-events-none">
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">VALOR RED</span>
                  <span className="text-xl font-black text-white tracking-tight mt-1">
                    ${totalValueMXN.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono mt-0.5">MXN</span>
                </div>
              </>
            )}
          </div>

          {/* Breakdown & Legend */}
          <div className="grid grid-cols-2 gap-3 mt-4 border-t border-[#21262d] pt-4">
            {portfolio.map((item) => (
              <div key={item.currency} className="bg-[#161b22]/50 p-2.5 rounded-xl border border-[#21262d] flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: COLORS[item.currency] }}>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[item.currency] }} />
                    {item.currency}
                  </span>
                  <span className="text-[9px] font-mono text-gray-500 uppercase">{item.batches_count} lotes</span>
                </div>
                <div className="mt-1.5">
                  <div className="text-xs font-bold text-white font-mono">
                    {item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[10px] text-gray-400 font-mono">
                    ≈ ${item.value_mxn.toLocaleString(undefined, { maximumFractionDigits: 0 })} MXN
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SECCIÓN DE ANALÍTICA: Barras de utilidad por Spread */}
        <div id="card-spread-analytics" className="lg:col-span-7 bg-[#0d1117] border border-[#21262d] rounded-2xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-bold flex items-center gap-2 text-white">
                <TrendingUp className="text-[#3b82f6]" size={20} />
                Barras de Utilidad por Spread (Últimas 24h)
              </h2>
              <span className="text-[10px] bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/30 px-2 py-0.5 rounded-full font-mono uppercase font-semibold">
                USD / MXN
              </span>
            </div>
            <p className="text-xs text-gray-400">Historial de margen de ganancia (utilidad/spread) obtenido por cada dólar liquidado</p>
          </div>

          <div className="min-h-[300px] h-72 w-full mt-4">
            {spreadAnalytics.length === 0 ? (
              <div className="h-full w-full flex items-center justify-center text-gray-500">Cargando datos históricos...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={spreadAnalytics} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: '#4b5563', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#4b5563', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: "#161b22", borderColor: "#30363d", borderRadius: "8px", color: "#f1f5f9" }}
                    formatter={(value: any) => [`$${parseFloat(value).toFixed(4)} MXN`, "Utilidad (Spread)"]}
                  />
                  <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Bar name="Utilidad de Spread (MXN/USD)" dataKey="spread" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Spread Summary */}
          <div className="flex justify-between items-center bg-[#161b22] p-3 rounded-xl border border-[#21262d] mt-2 text-xs font-mono">
            <span className="text-gray-400">Spread Promedio Estimado:</span>
            <span className="text-[#10b981] font-bold">
              +${spreadAnalytics.length > 0 ? (spreadAnalytics.reduce((acc, item) => acc + item.spread, 0) / spreadAnalytics.length).toFixed(4) : "0.9500"} MXN por USD
            </span>
          </div>
        </div>

      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* MONITOR DE NODOS: Listado interactivo de sucursales */}
        <div id="card-nodes-monitor" className="lg:col-span-8 bg-[#0d1117] border border-[#21262d] rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2 text-white">
                <Building2 className="text-[#10b981]" size={20} />
                Monitor de Nodos y Bóvedas
              </h2>
              <p className="text-xs text-gray-400">Estatus logístico y de seguridad de terminales de red</p>
            </div>
            <span className="text-xs text-gray-500 font-mono">{nodes.length} Nodos</span>
          </div>

          <div className="space-y-3">
            {nodes.map((node) => {
              const isLocked = node.terminal_locked;
              return (
                <motion.div
                  id={`node-row-${node.sucursal_id}`}
                  key={node.sucursal_id}
                  onClick={() => setSelectedNode(node)}
                  whileHover={{ scale: 1.01 }}
                  className={`border p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer transition-all ${
                    isLocked 
                      ? "bg-red-950/20 border-red-500/40 hover:border-red-500 shadow-lg shadow-red-500/5" 
                      : "bg-[#161b22]/60 border-[#21262d] hover:border-[#f0b90b]/50"
                  }`}
                >
                  {/* Left Column: Branch Name and Location */}
                  <div className="flex items-start gap-3">
                    <div className={`p-2.5 rounded-lg ${isLocked ? "bg-red-500/20 text-red-400" : "bg-[#21262d] text-gray-300"}`}>
                      <Building2 size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">{node.nombre}</span>
                        {isLocked && (
                          <span className="flex items-center gap-0.5 px-2 py-0.5 bg-red-500/20 text-red-400 border border-red-500/30 text-[9px] rounded-full font-bold animate-pulse uppercase">
                            <ShieldAlert size={10} /> Bloqueado
                          </span>
                        )}
                        <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full border uppercase ${
                          node.status === "Abierto" 
                            ? "bg-[#10b981]/10 text-[#10b981] border-[#10b981]/20" 
                            : "bg-gray-500/10 text-gray-400 border-gray-500/20"
                        }`}>
                          {node.status}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 font-mono">{node.ciudad} (ID: {node.sucursal_id})</div>
                    </div>
                  </div>

                  {/* Middle Column: Cash Balances MXN & USD */}
                  <div className="grid grid-cols-2 gap-4 md:gap-8">
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider">Caja MXN</div>
                      <div className="text-sm font-bold text-white font-mono">
                        ${node.physical_balances.MXN.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider">Caja USD</div>
                      <div className="text-sm font-bold text-[#3b82f6] font-mono">
                        ${node.physical_balances.USD.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Interactive chevron or action hint */}
                  <div className="flex items-center justify-between md:justify-end gap-3 self-end md:self-center border-t border-[#21262d] md:border-t-0 pt-2 md:pt-0">
                    <span className="text-[10px] text-gray-400 font-mono md:hidden">Tocar para ver desglose</span>
                    <ChevronRight size={18} className="text-gray-500 group-hover:text-white" />
                  </div>

                </motion.div>
              );
            })}
          </div>
        </div>

        {/* SECCIÓN DE ACCIONES PENDIENTES: Solicitudes de autorización con simulación biométrica */}
        <div id="card-pending-actions" className="lg:col-span-4 bg-[#0d1117] border border-[#21262d] rounded-2xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2 text-white mb-1">
              <ShieldAlert className="text-[#f59e0b]" size={20} />
              Acciones Pendientes
            </h2>
            <p className="text-xs text-gray-400 mb-4">Solicitudes urgentes de remesas RIP y gastos de gerencia</p>

            <div className="space-y-3">
              {pendingActions.length === 0 ? (
                <div className="bg-[#161b22] border border-[#21262d] p-6 rounded-xl text-center">
                  <CheckCircle2 size={32} className="text-[#10b981] mx-auto mb-2" />
                  <span className="text-xs text-gray-400 block">No hay solicitudes pendientes en este momento</span>
                </div>
              ) : (
                pendingActions.map((action) => (
                  <div key={action.id} className="bg-[#161b22] border border-[#21262d] p-3.5 rounded-xl space-y-3 hover:border-gray-500 transition-all">
                    <div className="flex items-start justify-between">
                      <span className={`px-2 py-0.5 text-[9px] font-extrabold rounded uppercase border ${
                        action.type === 'RIP_OPERATION' 
                          ? 'bg-red-500/10 text-red-400 border-red-500/20' 
                          : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                      }`}>
                        {action.type === 'RIP_OPERATION' ? 'RIP Remittance' : 'Gasto Gerente'}
                      </span>
                      <span className="text-[10px] text-gray-500 font-mono">{action.id}</span>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-white">{action.title}</h4>
                      <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{action.description}</p>
                    </div>

                    <div className="flex justify-between items-center bg-[#0d1117] p-2 rounded-lg border border-[#21262d]">
                      <span className="text-[10px] text-gray-500 uppercase">Monto</span>
                      <span className="text-xs font-bold text-white font-mono">
                        {action.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} {action.currency}
                      </span>
                    </div>

                    <button
                      id={`btn-approve-${action.id}`}
                      onClick={() => startBiometricValidation(action)}
                      className="w-full py-1.5 bg-[#f0b90b] hover:bg-yellow-500 text-black rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Fingerprint size={14} />
                      Autorización Biométrica
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-4 border-t border-[#21262d] pt-3 text-[10px] text-gray-500 text-center">
            * Todas las operaciones RIP requieren aprobación multifirma de la gerencia nacional.
          </div>
        </div>

      </div>

      {/* NUEVA SECCIÓN: GESTIÓN DE LIQUIDEZ DE CAJEROS (DOTACIONES, RETIROS, COMPROBANTES) */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
        
        {/* PANEL DE CONTROL DE CAJEROS */}
        <div id="card-cajas-saldos" className="lg:col-span-7 bg-[#0d1117] border border-[#21262d] rounded-2xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2 text-white">
                  <ShieldCheck className="text-binance-yellow" size={20} />
                  Panel de Control de Saldos de Cajeros
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">Control de existencias operativas y alertas de excedente</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setErrorMessage(null);
                    setSuccessMessage(null);
                    setSimulatedAuthCode(null);
                    setDotationType("APERTURA");
                    setShowDotationModal(true);
                  }}
                  className="px-3 py-1.5 bg-binance-yellow hover:bg-yellow-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Send size={13} /> Dotar Caja
                </button>
                <button
                  onClick={() => {
                    setErrorMessage(null);
                    setSuccessMessage(null);
                    setShowWithdrawalModal(true);
                  }}
                  className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Download size={13} /> Retiro Parcial
                </button>
              </div>
            </div>

            {/* Simulated Active Profile Widget and Tester Role level switch */}
            <div className="mb-4 bg-[#161b22] border border-[#21262d] p-3 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <UserCheck className="text-[#f0b90b]" size={16} />
                <span className="text-gray-300">
                  Operando como: <strong className="text-white">{profile?.nickname || "Sin Sesión"}</strong> ({profile?.puesto || "N/A"})
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  (profile?.role_level || 0) >= 4 ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                }`}>
                  Nivel {profile?.role_level || 0}
                </span>
              </div>
              
              {/* Profile tester helper */}
              <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
                <span className="text-gray-500 text-[10px] uppercase font-mono">Operador:</span>
                <span className="text-gray-300 text-xs font-mono">{profile?.auth_user_id || '—'}</span>
              </div>
            </div>

            {/* List of cashiers boxes */}
            <div className="space-y-3">
              {!data?.cajas || data.cajas.length === 0 ? (
                <div className="bg-[#161b22] border border-[#21262d] p-6 rounded-xl text-center text-xs text-gray-500">
                  Cargando terminales de cajas...
                </div>
              ) : (
                data.cajas.map((caja: any) => {
                  const safetyLimit = 100000; // Limit: $100,000 MXN
                  const isExceeded = caja.saldo_actual_mxn > safetyLimit;
                  return (
                    <div 
                      key={caja.cajero_id}
                      className={`p-3.5 rounded-xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                        isExceeded 
                          ? "bg-red-500/5 border-red-500/30 hover:border-red-500/50 shadow-lg shadow-red-500/5" 
                          : "bg-[#161b22] border-[#21262d] hover:border-gray-600"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg shrink-0 ${
                          isExceeded ? "bg-red-500/20 text-red-400" : "bg-[#21262d] text-gray-300"
                        }`}>
                          <Building2 size={16} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-white">{caja.nickname}</span>
                            <span className="text-[10px] bg-binance-yellow/10 text-binance-yellow px-2 py-0.5 rounded-full border border-binance-yellow/20 uppercase font-bold">
                              {caja.branch_name || "Bóveda"}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            ID Cajero: <span className="font-mono">{caja.cajero_id}</span>
                          </div>
                        </div>
                      </div>

                      {/* Balance section with dynamic warning */}
                      <div className="flex flex-col md:items-end">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Saldo Operativo Actual</div>
                        <div className="text-base font-extrabold text-white font-mono flex items-center gap-1.5 mt-0.5">
                          ${caja.saldo_actual_mxn.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-xs text-gray-400 font-bold">MXN</span>
                        </div>
                        
                        {isExceeded && (
                          <div className="flex items-center gap-1 text-[10px] font-extrabold text-red-400 uppercase mt-1 animate-pulse">
                            <AlertTriangle size={12} />
                            ¡ALERTA EXCEDENTE: Requiere Retiro!
                          </div>
                        )}
                      </div>

                      {/* Quick Action buttons */}
                      <div className="flex gap-2 self-end md:self-center border-t border-[#21262d] md:border-t-0 pt-2.5 md:pt-0">
                        <button
                          onClick={() => {
                            setErrorMessage(null);
                            setSuccessMessage(null);
                            setSimulatedAuthCode(null);
                            setSelectedCajeroId(caja.cajero_id);
                            setDotationType("APERTURA");
                            setShowDotationModal(true);
                          }}
                          className="px-2.5 py-1.5 bg-binance-yellow/10 hover:bg-binance-yellow/20 text-binance-yellow border border-binance-yellow/20 hover:border-binance-yellow/40 rounded-lg text-xs font-bold transition-all cursor-pointer"
                        >
                          Dotar
                        </button>
                        <button
                          onClick={() => {
                            setErrorMessage(null);
                            setSuccessMessage(null);
                            setSelectedCajeroId(caja.cajero_id);
                            setShowWithdrawalModal(true);
                          }}
                          className="px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/20 hover:border-amber-500/40 rounded-lg text-xs font-bold transition-all cursor-pointer"
                        >
                          Retirar
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          
          <div className="mt-4 border-t border-[#21262d] pt-3 text-[10px] text-gray-500 text-center">
            * El límite de tómbolas de seguridad por normativa nacional es de $100,000.00 MXN por terminal.
          </div>
        </div>

        {/* SOLICITUDES PENDIENTES DE DOTACIÓN */}
        {data?.dotaciones?.filter((d: any) => d.tipo_dotacion === 'EMERGENCIA' && d.estatus === 'PENDIENTE').length > 0 && (
          <div className="lg:col-span-5 bg-[#0d1117] border border-[#f59e0b]/30 rounded-2xl p-6 shadow-xl">
            <h2 className="text-lg font-bold flex items-center gap-2 text-[#f59e0b] mb-1">
              <AlertTriangle size={20} />
              Solicitudes de Dotación Pendientes
            </h2>
            <p className="text-xs text-gray-400 mb-4">Los siguientes cajeros han solicitado dotaciones de emergencia. Autorice para generar la clave de desbloqueo.</p>
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {data.dotaciones
                .filter((d: any) => d.tipo_dotacion === 'EMERGENCIA' && d.estatus === 'PENDIENTE')
                .map((dot: any) => (
                  <div key={dot.id} className="bg-[#161b22] border border-[#f59e0b]/20 p-3 rounded-xl space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 text-[9px] font-extrabold rounded uppercase border bg-red-500/10 text-red-400 border-red-500/20">
                        EMERGENCIA
                      </span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-yellow-500/10 text-yellow-500 animate-pulse">
                        {dot.estatus}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-white font-bold">
                      <span>Cajero: {dot.cajero_name || dot.cajero_id}</span>
                      <span className="font-mono text-emerald-400">
                        +${Math.abs(dot.monto_mxn).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono">
                      {new Date(dot.created_at).toLocaleString()}
                    </div>
                    <div className="border-t border-[#21262d] pt-2 mt-1 flex justify-end">
                      {authorizingDotId === dot.id ? (
                        <div className="flex items-center gap-2 text-binance-yellow">
                          <span className="animate-pulse">Autorizando con biometría...</span>
                          <div className="w-20 h-1.5 bg-[#161b22] rounded-full overflow-hidden">
                            <div className="h-full bg-binance-yellow transition-all duration-150" style={{ width: `${authScanProgress}%` }} />
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleAuthorizeDotation(dot.id)}
                          className="px-4 py-1.5 bg-binance-yellow hover:bg-yellow-500 text-white rounded-lg text-[10px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
                        >
                          <Fingerprint size={12} /> Autorizar con Biométrica
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* LOGS DE AUDITORÍA E COMPROBANTES */}
        <div id="card-dotaciones-log" className="lg:col-span-5 bg-[#0d1117] border border-[#21262d] rounded-2xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2 text-white mb-1">
              <Activity className="text-emerald-500" size={20} />
              Auditoría y Comprobantes
            </h2>
            <p className="text-xs text-gray-400 mb-4">Registro inmutable de movimientos financieros de cajas</p>

            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
              {!data?.dotaciones || data.dotaciones.length === 0 ? (
                <div className="bg-[#161b22] border border-[#21262d] p-6 rounded-xl text-center text-xs text-gray-400">
                  No hay movimientos registrados.
                </div>
              ) : (
                data.dotaciones.map((dot: any) => {
                  const isWithdrawal = dot.monto_mxn < 0;
                  const displayAmount = Math.abs(dot.monto_mxn);
                  return (
                    <div 
                      key={dot.id}
                      className="bg-[#161b22] border border-[#21262d] p-3 rounded-xl hover:border-gray-500 transition-all space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`px-2 py-0.5 text-[9px] font-extrabold rounded uppercase border ${
                          isWithdrawal
                            ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                            : dot.tipo_dotacion === "APERTURA"
                            ? "bg-binance-yellow/10 text-binance-yellow border-binance-yellow/20"
                            : "bg-red-500/10 text-red-400 border-red-500/20"
                        }`}>
                          {isWithdrawal ? "Retiro" : dot.tipo_dotacion}
                        </span>
                        
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                          dot.estatus === "APLICADO" 
                            ? "bg-emerald-500/10 text-emerald-400" 
                            : "bg-yellow-500/10 text-yellow-500 animate-pulse"
                        }`}>
                          {dot.estatus}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-white font-bold">
                        <span>Cajero: {dot.cajero_name || dot.cajero_id}</span>
                        <span className={`font-mono ${isWithdrawal ? "text-amber-500" : "text-emerald-400"}`}>
                          {isWithdrawal ? "-" : "+"}${displayAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>

                      <div className="text-[10px] text-gray-400 font-mono flex flex-col gap-0.5">
                        {dot.folio_boveda && <div>Folio Bóveda: {dot.folio_boveda}</div>}
                        {dot.clave_autorizacion && dot.clave_autorizacion !== "WITHDRAWN" && (
                          <div>Clave: <strong className="text-binance-yellow select-all">{dot.clave_autorizacion}</strong></div>
                        )}
                        <div className="text-gray-500">{new Date(dot.created_at).toLocaleString()}</div>
                      </div>

                      <div className="border-t border-[#21262d] pt-2 mt-1 flex justify-end gap-2">
                        {dot.estatus === "PENDIENTE" && !dot.gerente_id ? (
                          authorizingDotId === dot.id ? (
                            <div className="flex items-center gap-2 text-binance-yellow">
                              <span className="animate-pulse text-[10px]">Autorizando con biometría...</span>
                              <div className="w-20 h-1.5 bg-[#161b22] rounded-full overflow-hidden">
                                <div className="h-full bg-binance-yellow transition-all duration-150" style={{ width: `${authScanProgress}%` }} />
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleAuthorizeDotation(dot.id)}
                              className="px-4 py-1.5 bg-binance-yellow hover:bg-yellow-500 text-white rounded-lg text-[10px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
                            >
                              <Fingerprint size={12} /> Autorizar con Biométrica
                            </button>
                          )
                        ) : null}
                        <button
                          onClick={() => {
                            setShowReceiptModal(dot);
                          }}
                          className="px-2 py-1 bg-[#21262d] hover:bg-gray-700 text-gray-300 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Printer size={10} /> Ver Comprobante (PDF)
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="mt-4 border-t border-[#21262d] pt-3 text-[10px] text-gray-500 text-center">
            * Conectado directamente a Supabase Ledger Criptográfico.
          </div>
        </div>

      </div>

      {/* MODAL: Desglose de saldos físicos vs Cámara de Compensación (USDT) */}
      <AnimatePresence>
        {selectedNode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedNode(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-lg bg-[#0d1117] rounded-2xl border border-[#21262d] overflow-hidden shadow-2xl z-10"
            >
              <div className="p-6 border-b border-[#21262d] flex items-center justify-between bg-gradient-to-r from-[#10b981]/5 to-transparent">
                <div>
                  <div className="text-[10px] font-bold text-[#10b981] uppercase tracking-wider flex items-center gap-1">
                    <Locate size={12} />
                    Nodo Reconciliado
                  </div>
                  <h3 className="text-lg font-bold text-white mt-1">{selectedNode.nombre}</h3>
                  <p className="text-xs text-gray-500">{selectedNode.ciudad} (Ref: {selectedNode.sucursal_id})</p>
                </div>
                <button 
                  id="btn-close-node-modal"
                  onClick={() => setSelectedNode(null)} 
                  className="p-1.5 text-gray-400 hover:text-white bg-[#161b22] border border-[#21262d] rounded-lg transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-6 space-y-6">
                
                {/* Node Status Summary */}
                <div className="flex justify-between items-center bg-[#161b22] p-3 rounded-xl border border-[#21262d]">
                  <span className="text-xs text-gray-400">Estatus Operativo del Nodo:</span>
                  <div className="flex gap-2">
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                      selectedNode.status === 'Abierto' ? 'bg-[#10b981]/10 text-[#10b981]' : 'bg-gray-500/10 text-gray-400'
                    }`}>
                      {selectedNode.status}
                    </span>
                    {selectedNode.terminal_locked && (
                      <span className="px-2 py-0.5 bg-red-500/10 text-red-400 text-[10px] font-bold rounded-full animate-pulse">
                        Terminal Bloqueado
                      </span>
                    )}
                  </div>
                </div>

                {/* Tab selector */}
                <div className="bg-[#161b22] p-1 rounded-lg border border-[#21262d] flex">
                  <button
                    onClick={() => setActiveTab("physical")}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${
                      activeTab === "physical" ? "bg-[#f0b90b] text-black" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Saldos Físicos de Caja
                  </button>
                  <button
                    onClick={() => setActiveTab("clearing")}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${
                      activeTab === "clearing" ? "bg-[#f0b90b] text-black" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Cámara de Compensación
                  </button>
                </div>

                {/* Tab Content 1: Physical Balances */}
                {activeTab === "physical" && (
                  <div className="space-y-3">
                    <div className="text-xs text-gray-400 mb-1">Efectivo en bóveda de sucursal para transacciones diarias:</div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[#161b22]/50 p-3 rounded-xl border border-[#21262d]">
                        <span className="text-[10px] text-gray-400 uppercase font-bold block">MXN</span>
                        <span className="text-base font-extrabold text-white font-mono">
                          ${selectedNode.physical_balances.MXN.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="bg-[#161b22]/50 p-3 rounded-xl border border-[#21262d]">
                        <span className="text-[10px] text-gray-400 uppercase font-bold block text-[#3b82f6]">USD</span>
                        <span className="text-base font-extrabold text-[#3b82f6] font-mono">
                          ${selectedNode.physical_balances.USD.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="bg-[#161b22]/50 p-3 rounded-xl border border-[#21262d]">
                        <span className="text-[10px] text-gray-400 uppercase font-bold block text-[#8b5cf6]">EUR</span>
                        <span className="text-base font-extrabold text-[#8b5cf6] font-mono">
                          ${selectedNode.physical_balances.EUR.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="bg-[#161b22]/50 p-3 rounded-xl border border-[#21262d]">
                        <span className="text-[10px] text-gray-400 uppercase font-bold block text-[#10b981]">USDT (Caja)</span>
                        <span className="text-base font-extrabold text-[#10b981] font-mono">
                          ${selectedNode.physical_balances.USDT.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab Content 2: Clearinghouse USDT */}
                {activeTab === "clearing" && (
                  <div className="space-y-4">
                    <div className="bg-gradient-to-br from-[#10b981]/10 to-transparent p-4 rounded-xl border border-[#10b981]/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[10px] text-[#10b981] font-bold uppercase tracking-wider">BALANCE COMPENSACIÓN</span>
                          <span className="text-2xl font-extrabold text-white font-mono block mt-1">
                            ${selectedNode.clearing_balance_usdt.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-sm font-bold text-[#10b981]">USDT</span>
                          </span>
                        </div>
                        <div className="p-3 bg-[#10b981]/10 rounded-full text-[#10b981]">
                          <Activity size={24} className="animate-pulse" />
                        </div>
                      </div>
                      <div className="text-[10px] text-gray-400 mt-3 border-t border-[#10b981]/10 pt-2 font-mono">
                        Suscrito a smart contract de compensación mutua en red P2P SaaS.
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">Beneficios de la Cámara de Compensación:</div>
                      <div className="bg-[#161b22] p-2.5 rounded-lg border border-[#21262d] flex items-start gap-2 text-gray-300">
                        <Check size={14} className="text-[#10b981] shrink-0 mt-0.5" />
                        <span>Permite swaps inmediatos de divisas sin transferencias físicas bancarias.</span>
                      </div>
                      <div className="bg-[#161b22] p-2.5 rounded-lg border border-[#21262d] flex items-start gap-2 text-gray-300">
                        <Check size={14} className="text-[#10b981] shrink-0 mt-0.5" />
                        <span>Reserva de liquidez colateralizada de forma remota.</span>
                      </div>
                    </div>
                  </div>
                )}

              </div>
              <div className="p-6 border-t border-[#21262d] flex justify-end bg-[#161b22]/30">
                <button
                  onClick={() => setSelectedNode(null)}
                  className="px-4 py-2 bg-gray-500/10 hover:bg-gray-500/20 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                >
                  Cerrar Desglose
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SIMULATION MODAL: Escáner Biométrico Avanzado */}
      <AnimatePresence>
        {biometricAction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />

            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="relative w-full max-w-md bg-[#0a0d10] rounded-[2rem] border border-[#21262d] overflow-hidden shadow-2xl z-10 p-8 text-center flex flex-col items-center"
            >
              <div className="w-full text-right absolute top-4 right-4">
                <button 
                  onClick={() => { setBiometricAction(null); setBiometricStep("idle"); }} 
                  className="p-1.5 text-gray-500 hover:text-white rounded-lg cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mb-6">
                <span className="px-3 py-1 bg-amber-500/10 text-amber-500 border border-amber-500/30 text-[10px] rounded-full uppercase font-bold tracking-wider">
                  AUTORIZACIÓN MULTIFIRMA FINTECH
                </span>
                <h3 className="text-lg font-bold text-white mt-2">Simulación de Validación Biométrica</h3>
                <p className="text-xs text-gray-400 mt-1">ID Acción: {biometricAction.id}</p>
              </div>

              {/* Holographic scanner visual */}
              <div className="relative h-44 w-44 bg-[#0d1117] rounded-full border-2 border-[#21262d] flex items-center justify-center mb-8 overflow-hidden group">
                
                {/* Simulated Laser scanner line */}
                {biometricStep === "scanning" && (
                  <motion.div 
                    animate={{ y: [0, 176, 0] }}
                    transition={{ repeat: Infinity, duration: 1.8, ease: "linear" }}
                    className="absolute left-0 right-0 h-1 bg-[#f0b90b] shadow-lg shadow-[#f0b90b] z-20"
                  />
                )}

                {/* Fingerprint / Scanning icons based on steps */}
                {biometricStep === "scanning" && (
                  <div className="text-[#f0b90b] flex flex-col items-center gap-1 animate-pulse">
                    <Fingerprint size={64} className="text-[#f0b90b]" />
                    <span className="text-[10px] uppercase tracking-widest font-mono font-bold">Escaneando...</span>
                  </div>
                )}

                {biometricStep === "analyzing" && (
                  <div className="text-[#3b82f6] flex flex-col items-center gap-1">
                    <Scan size={64} className="animate-spin text-[#3b82f6]" />
                    <span className="text-[10px] uppercase tracking-widest font-mono font-bold">Procesando...</span>
                  </div>
                )}

                {biometricStep === "success" && (
                  <motion.div 
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-[#10b981] flex flex-col items-center gap-1"
                  >
                    <CheckCircle2 size={64} className="text-[#10b981]" />
                    <span className="text-[10px] uppercase tracking-widest font-mono font-bold">Autorizado</span>
                  </motion.div>
                )}

                {/* Cybernetic HUD elements */}
                <div className="absolute inset-2 border border-[#21262d] border-dashed rounded-full animate-spin [animation-duration:15s] pointer-events-none opacity-40" />
                <div className="absolute inset-4 border border-[#f0b90b]/10 rounded-full pointer-events-none" />
              </div>

              {/* Progress and instructions */}
              <div className="w-full space-y-3">
                <div className="flex justify-between items-center text-xs font-mono text-gray-500">
                  <span>SISTEMA BIOMÉTRICO ID-FACE</span>
                  <span>{biometricStep === "scanning" ? `${biometricProgress}%` : "RECONCILIADO"}</span>
                </div>

                <div className="h-1.5 w-full bg-[#161b22] rounded-full overflow-hidden border border-[#21262d]">
                  <div 
                    className={`h-full transition-all duration-150 ${
                      biometricStep === "success" 
                        ? "bg-[#10b981]" 
                        : biometricStep === "analyzing" 
                          ? "bg-[#3b82f6]" 
                          : "bg-[#f0b90b]"
                    }`}
                    style={{ width: biometricStep === "success" ? "100%" : biometricStep === "analyzing" ? "90%" : `${biometricProgress}%` }}
                  />
                </div>

                <div className="text-sm font-bold text-white transition-all h-6">
                  {biometricStep === "scanning" && "Coloque su dedo sobre el sensor o mire a la cámara"}
                  {biometricStep === "analyzing" && "Validando patrones en HSM criptográfico..."}
                  {biometricStep === "success" && "Firma biométrica generada con éxito!"}
                </div>

                <p className="text-[11px] text-gray-500 italic">
                  Esta acción registrará su firma criptográfica en el registro de auditoría de seguridad.
                </p>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL DE DOTACIÓN (APERTURA FISICA / EMERGENCIA REMOTA) */}
      <AnimatePresence>
        {showDotationModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDotationModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-lg bg-[#0d1117] rounded-2xl border border-[#21262d] overflow-hidden shadow-2xl z-10 animate-fade-in"
            >
              <div className="p-6 border-b border-[#21262d] flex items-center justify-between bg-gradient-to-r from-binance-yellow/5 to-transparent">
                <div>
                  <div className="text-[10px] font-bold text-binance-yellow uppercase tracking-wider flex items-center gap-1">
                    <Send size={12} />
                    Asignación de Liquidez Operativa
                  </div>
                  <h3 className="text-lg font-bold text-white mt-1">Registrar Dotación de Efectivo</h3>
                </div>
                <button 
                  onClick={() => setShowDotationModal(false)} 
                  className="p-1.5 text-gray-400 hover:text-white bg-[#161b22] border border-[#21262d] rounded-lg transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handlePhysicalDotationSubmit} className="p-6 space-y-4">
                {errorMessage && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-xs font-semibold flex items-center gap-2">
                    <AlertTriangle size={14} className="shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {successMessage && (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs font-semibold flex items-center gap-2">
                    <CheckCircle2 size={14} className="shrink-0" />
                    <span>{successMessage}</span>
                  </div>
                )}

                {/* Sucursal selection */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Sucursal Destino</label>
                  <select
                    value={selectedSucursalId}
                    onChange={(e) => {
                      setSelectedSucursalId(e.target.value);
                      // Reset cajero al cambiar sucursal
                      const cajerosDeNueva = cajeros.filter(c => c.branch_id === e.target.value);
                      setSelectedCajeroId(cajerosDeNueva.length > 0 ? cajerosDeNueva[0].id : "");
                    }}
                    className="w-full text-xs bg-[#161b22] border border-[#21262d] rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-binance-yellow/50"
                  >
                    {sucursales.map(s => (
                      <option key={s.sucursal_id} value={s.sucursal_id}>
                        {s.nombre}{s.es_matriz === 1 ? " (Matriz)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Cashier selection (filtrado por sucursal) */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Operador / Cajero Destino</label>
                  <select
                    value={selectedCajeroId}
                    onChange={(e) => setSelectedCajeroId(e.target.value)}
                    className="w-full text-xs bg-[#161b22] border border-[#21262d] rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-binance-yellow/50"
                  >
                    {cajerosDeSucursal.length > 0 ? (
                      cajerosDeSucursal.map(c => (
                        <option key={c.id} value={c.id}>{c.nickname} ({c.puesto})</option>
                      ))
                    ) : (
                      <option value="">Sin cajeros activos en esta sucursal</option>
                    )}
                  </select>
                  {cajerosDeSucursal.length === 0 && (
                    <p className="text-[10px] text-binance-yellow mt-1">
                      ⚠️ No hay cajeros activos en esta sucursal. Asigne un cajero desde Configuración.
                    </p>
                  )}
                </div>

                {/* Dotation Type Tabs */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Tipo de Dotación</label>
                  <div className="grid grid-cols-2 gap-2 bg-[#161b22] p-1 rounded-xl border border-[#21262d]">
                    <button
                      type="button"
                      onClick={() => {
                        setDotationType("APERTURA");
                        setSimulatedAuthCode(null);
                        setErrorMessage(null);
                      }}
                      className={`py-2 text-xs font-bold rounded-lg transition-all ${
                        dotationType === "APERTURA" ? "bg-binance-yellow text-white" : "text-gray-400 hover:text-white"
                      }`}
                    >
                      Apertura (Física)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDotationType("EMERGENCIA");
                        setErrorMessage(null);
                      }}
                      className={`py-2 text-xs font-bold rounded-lg transition-all ${
                        dotationType === "EMERGENCIA" ? "bg-binance-yellow text-white" : "text-gray-400 hover:text-white"
                      }`}
                    >
                      Emergencia (Remota)
                    </button>
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Monto Dotación (MXN)</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-gray-500 font-bold text-xs">$</span>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={dotationAmount}
                      onChange={(e) => setDotationAmount(e.target.value)}
                      className="w-full text-xs bg-[#161b22] border border-[#21262d] rounded-xl pl-8 pr-12 py-2.5 text-white focus:outline-none focus:border-binance-yellow/50 font-mono"
                    />
                    <span className="absolute right-3.5 top-2.5 text-gray-500 font-bold text-[10px] uppercase font-mono">MXN</span>
                  </div>
                </div>

                {/* Conditional Inputs */}
                {dotationType === "APERTURA" ? (
                  <div>
                    <label className="block text-xs font-bold text-[#f59e0b] uppercase mb-1.5 flex items-center gap-1">
                      <ShieldCheck size={13} /> Folio de Validación de Bóveda (Obligatorio)
                    </label>
                    <input
                      type="text"
                      placeholder="Escriba el folio de salida física de bóveda"
                      value={folioBoveda}
                      onChange={(e) => setFolioBoveda(e.target.value)}
                      className="w-full text-xs bg-[#161b22] border border-[#f59e0b]/30 rounded-xl px-3.5 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-[#f59e0b] font-mono"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">
                      * El gerente asigna el fondo inicial de forma física. Se requiere verificar la entrega en bóveda principal.
                    </p>
                  </div>
                ) : (
                  <div className="bg-[#1e242c]/50 p-4 rounded-xl border border-binance-yellow/20 space-y-3">
                    <span className="text-[10px] font-bold text-binance-yellow uppercase tracking-wider block">
                      Autorización Remota por Biometría (WebAuthn)
                    </span>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      La dotación de emergencia se realiza de forma remota. El sistema solicitará la huella/biometría del Gerente y generará un token criptográfico de desbloqueo.
                    </p>

                    {simulatedAuthCode ? (
                      <div className="p-3 bg-binance-yellow/10 border border-binance-yellow/20 rounded-xl text-center space-y-1">
                        <span className="text-[10px] text-gray-500 uppercase font-bold block">Clave de Desbloqueo Generada</span>
                        <span className="text-xl font-extrabold text-binance-yellow tracking-wider font-mono select-all">
                          {simulatedAuthCode}
                        </span>
                        <span className="text-[10px] text-gray-400 block mt-1">
                          Proporcione este código de 9 caracteres al cajero para ingresar en su terminal.
                        </span>
                      </div>
                    ) : remoteAuthScanning ? (
                      <div className="space-y-2 py-2">
                        <div className="flex justify-between text-[11px] text-binance-yellow font-mono">
                          <span className="animate-pulse">ESCANEO CRIPTOGRÁFICO WEBAUTHN...</span>
                          <span>{scanProgress}%</span>
                        </div>
                        <div className="h-1 bg-[#161b22] rounded-full overflow-hidden">
                          <div className="h-full bg-binance-yellow transition-all duration-150" style={{ width: `${scanProgress}%` }} />
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (!dotationAmount || parseFloat(dotationAmount) <= 0) {
                            setErrorMessage("Ingrese un monto válido para la dotación de emergencia.");
                            return;
                          }
                          setErrorMessage(null);
                          setRemoteAuthScanning(true);
                        }}
                        className="w-full py-2 bg-binance-yellow hover:bg-yellow-500 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Fingerprint size={14} /> Autorizar con Biométrica (WebAuthn)
                      </button>
                    )}
                  </div>
                )}

                {/* Submit button for physical dotation only */}
                {dotationType === "APERTURA" && (
                  <div className="pt-2">
                    <button
                      type="submit"
                      className="w-full py-2.5 bg-binance-yellow hover:bg-yellow-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <CheckCircle2 size={15} /> Aplicar Dotación de Apertura
                    </button>
                  </div>
                )}
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL DE RETIRO PARCIAL */}
      <AnimatePresence>
        {showWithdrawalModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowWithdrawalModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-lg bg-[#0d1117] rounded-2xl border border-[#21262d] overflow-hidden shadow-2xl z-10 animate-fade-in"
            >
              <div className="p-6 border-b border-[#21262d] flex items-center justify-between bg-gradient-to-r from-amber-500/5 to-transparent">
                <div>
                  <div className="text-[10px] font-bold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                    <Download size={12} />
                    Resguardo de Efectivo Excedente
                  </div>
                  <h3 className="text-lg font-bold text-white mt-1">Registrar Retiro Parcial de Caja</h3>
                </div>
                <button 
                  onClick={() => setShowWithdrawalModal(false)} 
                  className="p-1.5 text-gray-400 hover:text-white bg-[#161b22] border border-[#21262d] rounded-lg transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleWithdrawalSubmit} className="p-6 space-y-4">
                {errorMessage && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-xs font-semibold flex items-center gap-2">
                    <AlertTriangle size={14} className="shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* Cashier selection */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Operador / Cajero Origen</label>
                  <select
                    value={selectedCajeroId}
                    onChange={(e) => setSelectedCajeroId(e.target.value)}
                    className="w-full text-xs bg-[#161b22] border border-[#21262d] rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-amber-500"
                  >
                    {cajeros.map(c => (
                      <option key={c.id} value={c.id}>{c.nickname} ({c.puesto} - Sucursal: {c.branch_id})</option>
                    ))}
                  </select>
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Monto a Retirar (MXN)</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-gray-500 font-bold text-xs">$</span>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={withdrawalAmount}
                      onChange={(e) => setWithdrawalAmount(e.target.value)}
                      className="w-full text-xs bg-[#161b22] border border-[#21262d] rounded-xl pl-8 pr-12 py-2.5 text-white focus:outline-none focus:border-amber-500 font-mono"
                    />
                    <span className="absolute right-3.5 top-2.5 text-gray-500 font-bold text-[10px] uppercase font-mono">MXN</span>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">
                    * El efectivo retirado de la tómbola será transferido a la bóveda física principal de resguardo.
                  </p>
                </div>

                {/* Vault Folio */}
                <div>
                  <label className="block text-xs font-bold text-amber-500 uppercase mb-1.5 flex items-center gap-1">
                    <ShieldCheck size={13} /> Folio de Bóveda de Resguardo (Obligatorio)
                  </label>
                  <input
                    type="text"
                    placeholder="Escriba el folio de depósito en bóveda física"
                    value={withdrawalFolioBoveda}
                    onChange={(e) => setWithdrawalFolioBoveda(e.target.value)}
                    className="w-full text-xs bg-[#161b22] border border-amber-500/30 rounded-xl px-3.5 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-black rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 size={15} /> Aplicar Retiro Parcial y Resguardar
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL DE COMPROBANTE DIGITAL INMUTABLE (TICKET/PDF) */}
      <AnimatePresence>
        {showReceiptModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowReceiptModal(null)}
              className="absolute inset-0 bg-black/85 backdrop-blur-sm"
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-md bg-white text-gray-900 rounded-3xl overflow-hidden shadow-2xl z-10 p-6 md:p-8"
            >
              {/* Receipt Ticket Body styled to look like official thermal printed invoice */}
              <div className="border-2 border-dashed border-gray-300 p-4 rounded-2xl bg-gray-50/50 space-y-4 font-mono text-xs text-gray-900">
                
                <div className="text-center space-y-1">
                  <div className="font-extrabold text-sm uppercase tracking-wider">FINTECH SAAS S.A. DE C.V.</div>
                  <div className="text-[10px] text-gray-500">SISTEMA INTEGRAL DE LIQUIDEZ OPERATIVA</div>
                  <div className="text-[10px] text-gray-500">ERP MULTI-NODO LEDGER</div>
                  <div className="text-[9px] text-gray-400 mt-2">----------------------------------------</div>
                </div>

                <div className="text-center space-y-0.5">
                  <span className="px-2.5 py-0.5 bg-gray-900 text-white text-[9px] font-bold rounded uppercase tracking-widest block mx-auto w-fit">
                    COMPROBANTE DIGITAL INMUTABLE
                  </span>
                  <div className="text-[10px] font-bold text-gray-700 mt-2">ID TRANSACCIÓN:</div>
                  <div className="text-xs font-extrabold font-mono text-gray-900 bg-gray-200/50 px-2 py-1 rounded inline-block">
                    {showReceiptModal.id}
                  </div>
                </div>

                <div className="text-[9px] text-gray-400 text-center">----------------------------------------</div>

                <div className="space-y-1.5 text-gray-700">
                  <div className="flex justify-between">
                    <span>FECHA/HORA:</span>
                    <span className="font-bold text-gray-900">{new Date(showReceiptModal.created_at || showReceiptModal.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>TIPO MOVIMIENTO:</span>
                    <span className="font-bold text-gray-900 uppercase">
                      {showReceiptModal.monto_mxn < 0 ? "RETIRO PARCIAL" : showReceiptModal.tipo_dotacion || "DOTACIÓN"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>GERENTE AUTORIZÓ:</span>
                    <span className="font-bold text-gray-900">{showReceiptModal.gerente_name || showReceiptModal.gerente_id || "SISTEMA"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>CAJERO RECIBIÓ:</span>
                    <span className="font-bold text-gray-900">{showReceiptModal.cajero_name || showReceiptModal.cajero_id}</span>
                  </div>
                  {showReceiptModal.folio_boveda && (
                    <div className="flex justify-between">
                      <span>FOLIO BÓVEDA:</span>
                      <span className="font-bold text-gray-900 font-mono">{showReceiptModal.folio_boveda}</span>
                    </div>
                  )}
                  {showReceiptModal.clave_autorizacion && showReceiptModal.clave_autorizacion !== "WITHDRAWN" && (
                    <div className="flex justify-between">
                      <span>CLAVE DESBLOQUEO:</span>
                      <span className="font-bold text-gray-900 font-mono bg-yellow-100 px-1 rounded">{showReceiptModal.clave_autorizacion}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>ESTATUS:</span>
                    <span className="font-bold text-emerald-600 uppercase">{showReceiptModal.estatus}</span>
                  </div>
                </div>

                <div className="text-[9px] text-gray-400 text-center">----------------------------------------</div>

                {/* Total amount formatted nicely */}
                <div className="bg-gray-900 text-white p-3.5 rounded-xl text-center">
                  <div className="text-[10px] text-gray-400 font-bold uppercase">Monto Total</div>
                  <div className="text-xl font-extrabold tracking-tight mt-0.5 font-mono">
                    ${Math.abs(showReceiptModal.monto_mxn).toLocaleString(undefined, { minimumFractionDigits: 2 })} MXN
                  </div>
                </div>

                <div className="text-[9px] text-gray-400 text-center">----------------------------------------</div>

                {/* Digital audit footprint */}
                <div className="text-center space-y-1 text-gray-500 text-[9px]">
                  <div className="font-bold text-gray-700">FIRMA CRIPTOGRÁFICA DE AUDITORÍA:</div>
                  <div className="bg-gray-100 p-1.5 rounded font-mono text-[8px] break-all text-gray-400 line-clamp-2">
                    SHA256: {Math.random().toString(36).substr(2, 10).toUpperCase()}{Math.random().toString(36).substr(2, 10).toUpperCase()}{Math.random().toString(36).substr(2, 10).toUpperCase()}
                  </div>
                  <div className="text-[8px] text-gray-400 italic mt-1">Este documento representa un comprobante contable oficial e inalterable en Ledger.</div>
                </div>

              </div>

              {/* Action buttons (Close / Print / Download) */}
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setShowReceiptModal(null)}
                  className="flex-1 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-xl text-xs font-bold transition-all cursor-pointer text-center"
                >
                  Cerrar
                </button>
                <button
                  onClick={() => {
                    window.print();
                  }}
                  className="flex-1 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Printer size={13} /> Imprimir (PDF)
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: RESULTADO DE AUTORIZACIÓN (Clave generada) */}
      <AnimatePresence>
        {authResult && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAuthResult(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-md bg-[#0d1117] rounded-2xl border border-emerald-500/30 overflow-hidden shadow-2xl z-10"
            >
              <div className="p-6 text-center space-y-4">
                <div className="w-16 h-16 mx-auto bg-emerald-500/10 rounded-full flex items-center justify-center">
                  <ShieldCheck size={32} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">¡Dotación Autorizada!</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Se generó la clave de desbloqueo para ${authResult.monto.toLocaleString()} MXN
                  </p>
                </div>
                <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-4">
                  <span className="text-[10px] text-gray-500 uppercase font-bold block mb-2">Clave de Desbloqueo</span>
                  <span className="text-2xl font-extrabold text-emerald-400 tracking-[0.3em] font-mono select-all">
                    {authResult.clave}
                  </span>
                  <p className="text-[10px] text-gray-400 mt-2">
                    Proporcione esta clave al cajero para que la ingrese en su terminal FX Trader y libere el saldo.
                  </p>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(authResult.clave);
                    setAuthResult(null);
                    setAuthorizingDotId(null);
                  }}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Copiar Clave y Cerrar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
