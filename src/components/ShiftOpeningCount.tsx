import React, { useState, useEffect } from "react";
import { 
  Coins, 
  Lock, 
  Unlock, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Plus, 
  Minus, 
  UserCheck, 
  FileText, 
  ShieldAlert,
  ArrowRight
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

// Catalog of bill denominations for MXN, USD, EUR
// Paleta sutil uniforme: tonos oscuros con borde discreto, sin colores llamativos
const DENOMINATIONS_CATALOG = {
  MXN: [
    { value: 1000, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Mil Pesos", badge: "G. Cárdenas" },
    { value: 500, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Quinientos Pesos", badge: "B. Juárez" },
    { value: 200, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Doscientos Pesos", badge: "Sor Juana" },
    { value: 100, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Cien Pesos", badge: "Nezahualcóyotl" },
    { value: 50, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Cincuenta Pesos", badge: "J. M. Morelos" },
    { value: 20, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Veinte Pesos", badge: "B. Juárez" },
    { value: 10, color: "bg-[#181a20] border-[#2b3139] text-gray-400", label: "Moneda de $10", isCoin: true },
    { value: 5, color: "bg-[#181a20] border-[#2b3139] text-gray-400", label: "Moneda de $5", isCoin: true },
    { value: 2, color: "bg-[#181a20] border-[#2b3139] text-gray-400", label: "Moneda de $2", isCoin: true },
    { value: 1, color: "bg-[#181a20] border-[#2b3139] text-gray-400", label: "Moneda de $1", isCoin: true }
  ],
  USD: [
    { value: 100, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "One Hundred", badge: "B. Franklin" },
    { value: 50, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Fifty Dollars", badge: "U. S. Grant" },
    { value: 20, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Twenty Dollars", badge: "A. Jackson" },
    { value: 10, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Ten Dollars", badge: "A. Hamilton" },
    { value: 5, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Five Dollars", badge: "A. Lincoln" },
    { value: 2, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Two Dollars", badge: "T. Jefferson" },
    { value: 1, color: "bg-[#181a20] border-[#2b3139] text-gray-400", label: "One Dollar", badge: "G. Washington", isCoin: true }
  ],
  EUR: [
    { value: 500, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Five Hundred Euro", badge: "Modern Arch" },
    { value: 200, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Two Hundred Euro", badge: "Art Nouveau" },
    { value: 100, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "One Hundred Euro", badge: "Baroque" },
    { value: 50, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Fifty Euro", badge: "Renaissance" },
    { value: 20, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Twenty Euro", badge: "Gothic" },
    { value: 10, color: "bg-[#1e2329] border-[#3a3f47] text-gray-200", label: "Ten Euro", badge: "Romanesque" },
    { value: 5, color: "bg-[#181a20] border-[#2b3139] text-gray-400", label: "Five Euro", badge: "Classical" }
  ]
};

interface ShiftOpeningCountProps {
  token: string;
  onShiftStatusChange: (status: string | null, activeShift: any | null) => void;
}

export default function ShiftOpeningCount({ token, onShiftStatusChange }: ShiftOpeningCountProps) {
  const { profile } = useAuth();
  const [activeShift, setActiveShift] = useState<any>(null);
  const [status, setStatus] = useState<"LOADING" | "CLOSED" | "PENDING_AUTHORIZATION" | "OPEN">("LOADING");
  const [activeCurrency, setActiveCurrency] = useState<"MXN" | "USD" | "EUR">("MXN");
  
  // Declared counts state: currency -> denomination -> count
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({
    MXN: { "1000": 0, "500": 0, "200": 0, "100": 0, "50": 0, "20": 0, "10": 0, "5": 0, "2": 0, "1": 0 },
    USD: { "100": 0, "50": 0, "20": 0, "10": 0, "5": 0, "2": 0, "1": 0 },
    EUR: { "500": 0, "200": 0, "100": 0, "50": 0, "20": 0, "10": 0, "5": 0 }
  });

  const [submitting, setSubmitting] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");

  const fetchShiftStatus = async () => {
    try {
      setStatus("LOADING");
      const res = await fetch("/api/shifts/status", {
        headers: { 
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.shift && data.shift.status !== "CLOSED") {
          setActiveShift(data.shift);
          setStatus(data.shift.status);
          onShiftStatusChange(data.shift.status, data.shift);
        } else {
          setActiveShift(null);
          setStatus("CLOSED");
          onShiftStatusChange(null, null);
        }
      } else {
        console.error(`Error ${res.status}: ${res.statusText}`);
        setStatus("CLOSED");
        onShiftStatusChange(null, null);
      }
    } catch (e) {
      console.error("Error fetching shift status", e);
      setStatus("CLOSED");
      onShiftStatusChange(null, null);
    }
  };

  useEffect(() => {
    fetchShiftStatus();
  }, []);

  const handleCountChange = (currency: string, denom: string, value: number) => {
    if (value < 0) return;
    setCounts(prev => ({
      ...prev,
      [currency]: {
        ...prev[currency],
        [denom]: value
      }
    }));
  };

  const handleIncrement = (currency: string, denom: string) => {
    const current = counts[currency]?.[denom] || 0;
    handleCountChange(currency, denom, current + 1);
  };

  const handleDecrement = (currency: string, denom: string) => {
    const current = counts[currency]?.[denom] || 0;
    if (current > 0) {
      handleCountChange(currency, denom, current - 1);
    }
  };

  // Calculate overall totals per currency
  const getCurrencyTotal = (currency: "MXN" | "USD" | "EUR") => {
    const curCounts = counts[currency] || {};
    return Object.entries(curCounts).reduce((sum, [denom, count]) => {
      return sum + (Number(denom) * Number(count));
    }, 0);
  };

  // Submit Blind Count to open shift
  const handleOpenShiftSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/shifts/open", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ counts })
      });

      if (res.ok) {
        const data = await res.json();
        setActiveShift(data);
        setStatus(data.status);
        onShiftStatusChange(data.status, data);
        // ShiftGate handles the transition — no reload needed
      } else {
        const err = await res.json();
        alert("Error al abrir turno: " + (err.error || `Error ${res.status}: ${res.statusText}`));
      }
    } catch (e) {
      console.error(e);
      alert("Error de red al abrir turno");
    } finally {
      setSubmitting(false);
    }
  };

  // Manager authorization for discrepancies
  const handleAuthorizeDeviation = async () => {
    setAuthorizing(true);
    setAuthError("");
    setAuthSuccess("");
    try {
      const res = await fetch("/api/shifts/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ shift_id: activeShift.id })
      });

      if (res.ok) {
        setAuthSuccess("¡Turno autorizado con éxito! Alineando saldos del libro mayor y boveda física...");
        setTimeout(() => {
          onShiftStatusChange("OPEN", { ...activeShift, status: "OPEN" });
          // ShiftGate handles the transition — no reload needed
        }, 2000);
      } else {
        const err = await res.json();
        setAuthError(err.error || `No se pudo autorizar el turno (${res.status}).`);
      }
    } catch (e) {
      setAuthError("Error de comunicación con el servidor.");
    } finally {
      setAuthorizing(false);
    }
  };

  if (status === "LOADING") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <RefreshCw className="animate-spin text-binance-yellow mb-4" size={48} />
        <p className="text-gray-400 font-medium">Validando estado del Turno y Auditoría Contable...</p>
      </div>
    );
  }

  // --- RENDERING NO SHIFT / CLOSED (BLIND COUNTING FORM) ---
  if (status === "CLOSED") {
    return (
      <div className="max-w-5xl mx-auto p-6 bg-[#1e2329] rounded-2xl border border-[#2b3139] shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#2b3139] pb-6 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="p-1.5 bg-binance-yellow/10 rounded-lg text-binance-yellow">
                <Coins size={20} />
              </span>
              <h2 className="text-xl font-bold text-white">Arqueo de Apertura & Conteo Ciego</h2>
            </div>
            <p className="text-gray-400 text-xs">
              Debe declarar las existencias físicas actuales de billetes y monedas en caja para verificar contra el libro contable de saldo anterior.
            </p>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-xl text-[11px] text-red-400 font-medium max-w-xs md:text-right">
            ⚠️ <strong>Modo Conteo Ciego:</strong> No se muestran saldos esperados para evitar sesgos en el conteo físico.
          </div>
        </div>

        {/* Currency selectors */}
        <div className="flex gap-2 mb-6 border-b border-[#2b3139]/40 pb-4">
          {(["MXN", "USD", "EUR"] as const).map(curr => {
            const total = getCurrencyTotal(curr);
            return (
              <button
                key={curr}
                type="button"
                onClick={() => setActiveCurrency(curr)}
                className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all flex flex-col items-center justify-center border ${
                  activeCurrency === curr 
                    ? "bg-binance-yellow text-black border-binance-yellow shadow-lg shadow-binance-yellow/10" 
                    : "bg-[#181a20] text-gray-400 border-[#2b3139] hover:bg-[#1e2329] hover:text-white"
                }`}
              >
                <span>{curr}</span>
                <span className={`text-[10px] mt-0.5 font-mono ${activeCurrency === curr ? "text-black/70" : "text-gray-500"}`}>
                  Declarado: ${total.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                </span>
              </button>
            );
          })}
        </div>

        {/* Denominations Grid (Replica layout of bills) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {DENOMINATIONS_CATALOG[activeCurrency].map(item => {
            const denomStr = String(item.value);
            const qty = counts[activeCurrency]?.[denomStr] || 0;
            const itemTotal = item.value * qty;

            return (
              <div 
                key={item.value}
                id={`denom-card-${activeCurrency}-${item.value}`}
                className={`relative p-4 rounded-xl border-2 transition-all flex flex-col justify-between h-36 ${item.color} group hover:border-opacity-100 hover:shadow-md`}
              >
                {/* Visual Bill Ornament */}
                <div className="flex justify-between items-start">
                  <div className="font-mono text-xl font-extrabold tracking-tight">
                    {activeCurrency} ${item.value}
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/40 text-gray-300 font-mono">
                    {item.isCoin ? "MONEDA" : "BILLETE"}
                  </span>
                </div>

                <div className="text-[10px] text-gray-400 truncate mt-1">
                  {item.label} {item.badge && `• ${item.badge}`}
                </div>

                {/* Interactive counter controls */}
                <div className="flex items-center justify-between mt-4">
                  <div className="text-xs font-mono font-bold text-white/90">
                    Total: ${itemTotal.toLocaleString("es-MX", { minimumFractionDigits: 0 })}
                  </div>

                  <div className="flex items-center gap-2 bg-[#12161a] border border-[#2b3139] rounded-lg p-1">
                    <button
                      type="button"
                      onClick={() => handleDecrement(activeCurrency, denomStr)}
                      className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white transition-colors"
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      value={qty || ""}
                      placeholder="0"
                      onChange={(e) => handleCountChange(activeCurrency, denomStr, Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-12 bg-transparent text-center text-white font-bold font-mono text-sm focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleIncrement(activeCurrency, denomStr)}
                      className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white transition-colors"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Global Summary & Submission */}
        <div className="border-t border-[#2b3139] pt-6 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-[#181a20]/40 p-6 rounded-2xl">
          <div>
            <h4 className="text-white font-bold text-sm mb-2">Resumen Declarado de Apertura</h4>
            <div className="flex flex-wrap gap-4 text-xs font-mono">
              <span className="text-gray-400">
                MXN: <strong className="text-white">${getCurrencyTotal("MXN").toLocaleString("es-MX")}</strong>
              </span>
              <span className="text-gray-400">
                USD: <strong className="text-white">${getCurrencyTotal("USD").toLocaleString("es-MX")}</strong>
              </span>
              <span className="text-gray-400">
                EUR: <strong className="text-white">${getCurrencyTotal("EUR").toLocaleString("es-MX")}</strong>
              </span>
            </div>
          </div>

          <button
            id="btn-validate-shift-opening"
            type="button"
            onClick={handleOpenShiftSubmit}
            disabled={submitting}
            className="px-6 py-4 bg-binance-yellow text-black hover:bg-yellow-500 disabled:bg-gray-700 disabled:text-gray-400 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg shadow-binance-yellow/20 cursor-pointer"
          >
            {submitting ? (
              <>
                <RefreshCw className="animate-spin" size={16} /> Validando saldo...
              </>
            ) : (
              <>
                <CheckCircle2 size={16} /> Validar y Abrir Turno <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // --- RENDERING BLOCKED ACCESS / PENDING AUTHORIZATION ---
  if (status === "PENDING_AUTHORIZATION") {
    const devList = activeShift?.desviaciones_json || {};

    return (
      <div className="max-w-2xl mx-auto p-8 bg-[#1e2329] border-2 border-red-500/30 rounded-2xl shadow-2xl text-center">
        <div className="inline-flex p-4 bg-red-500/10 text-red-500 rounded-full mb-4">
          <ShieldAlert size={48} className="animate-bounce" />
        </div>
        
        <h2 className="text-2xl font-black text-white tracking-tight mb-2">
          ¡DESVIACIÓN DETECTADA EN ARQUEO!
        </h2>
        
        <p className="text-gray-400 text-xs max-w-lg mx-auto mb-6">
          El arqueo ciego ingresado por el cajero no coincide con los saldos de auditoría registrados en el libro mayor y bóveda virtual. El terminal ha sido <strong>bloqueado temporalmente</strong>.
        </p>

        {/* Folio and Cajero Details */}
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto mb-6 bg-[#181a20] p-4 rounded-xl border border-[#2b3139] text-left">
          <div>
            <div className="text-[10px] text-gray-500 font-mono uppercase">Folio Documento</div>
            <div className="text-xs text-white font-mono font-bold">{activeShift?.folio_documento}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 font-mono uppercase">Cajero Operador</div>
            <div className="text-xs text-white font-bold">{activeShift?.nickname || activeShift?.cajero_id}</div>
          </div>
        </div>

        {/* Discrepancies breakdown */}
        <div className="max-w-md mx-auto mb-8 text-left">
          <div className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">Detalle de Diferencias Calculadas:</div>
          <div className="space-y-2">
            {Object.entries(devList).map(([curr, info]: [string, any]) => {
              const diff = info.diff || 0;
              const isDiffZero = Math.abs(diff) < 0.01;
              if (isDiffZero) return null;

              return (
                <div key={curr} className="flex justify-between items-center p-3 rounded-xl bg-black/20 border border-[#2b3139]">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm">{curr}</span>
                    <span className="text-[10px] text-gray-500">Conteo físico vs Virtual</span>
                  </div>
                  <div className="text-right">
                    <div className={`font-mono text-xs font-bold ${diff > 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {diff > 0 ? "+" : ""}${diff.toLocaleString("es-MX", { minimumFractionDigits: 2 })} {curr}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono">
                      Equiv. {info.valueDiff > 0 ? "+" : ""}${info.valueDiff?.toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Manager Override Form */}
        <div className="max-w-md mx-auto border-t border-[#2b3139] pt-6">
          <div className="bg-[#181a20] p-6 rounded-2xl border border-[#2b3139]">
            <div className="flex items-center gap-2 mb-4 justify-center text-binance-yellow">
              <Lock size={18} />
              <h4 className="text-white font-bold text-sm">Desbloqueo por Gerente o Cumplimiento</h4>
            </div>

            <p className="text-[11px] text-gray-500 mb-4">
              Un Supervisor, Gerente o Oficial de Cumplimiento debe validar físicamente la diferencia y autorizar la continuación de operaciones. Al autorizar, se alineará automáticamente la bóveda y se registrará un asiento contable de ajuste de diferencia.
            </p>

            {authError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl mb-4 font-semibold">
                {authError}
              </div>
            )}

            {authSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl mb-4 font-semibold">
                {authSuccess}
              </div>
            )}

            <button
              id="btn-manager-authorize-shift"
              type="button"
              onClick={handleAuthorizeDeviation}
              disabled={authorizing || !!authSuccess}
              className="w-full py-3.5 bg-binance-yellow text-black hover:bg-yellow-500 disabled:bg-gray-700 disabled:text-gray-400 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-binance-yellow/15 cursor-pointer"
            >
              {authorizing ? (
                <>
                  <RefreshCw className="animate-spin" size={16} /> Procesando Autorización Contable...
                </>
              ) : (
                <>
                  <UserCheck size={16} /> Autorizar Desviación y Habilitar Caja
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
