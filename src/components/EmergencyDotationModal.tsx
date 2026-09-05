import React, { useState, useMemo } from "react";
import { motion } from "motion/react";
import { Coins, AlertCircle, ShieldCheck, Clock, Plus, Minus, X, Zap, KeyRound, CheckCircle2 } from "lucide-react";

interface EmergencyDotationModalProps {
  onClose: () => void;
  cajeroId: string;
}

export function EmergencyDotationModal({ onClose, cajeroId }: EmergencyDotationModalProps) {
  const [requestedAmount, setRequestedAmount] = useState<string>("");
  const [breakdown, setBreakdown] = useState<Record<number, number>>({
    1000: 0,
    500: 0,
    200: 0,
    100: 0,
    50: 0,
    20: 0,
    10: 0,
    5: 0,
    2: 0,
    1: 0
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dotationResult, setDotationResult] = useState<{ id: string; clave: string } | null>(null);
  const [unlockKey, setUnlockKey] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockMessage, setUnlockMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const parsedTarget = useMemo(() => {
    const val = parseFloat(requestedAmount);
    return isNaN(val) || val <= 0 ? 0 : val;
  }, [requestedAmount]);

  const totalBreakdown = useMemo(() => {
    return Object.entries(breakdown).reduce<number>((sum, [val, qty]) => {
      const denomVal = parseFloat(val);
      const quantity = Number(qty) || 0;
      return sum + (denomVal * quantity);
    }, 0);
  }, [breakdown]);

  const diff = Math.abs(totalBreakdown - parsedTarget);
  const isValid = parsedTarget > 0 && diff < 0.01 && totalBreakdown === parsedTarget;

  const handleUpdate = (denom: number, value: number) => {
    setBreakdown(prev => ({
      ...prev,
      [denom]: value
    }));
  };

  // ── Auto-llenar: distribuye el monto entre denominaciones grandes primero,
  //    reservando una porción para morrilla (cambio) en billetes pequeños. ──
  const handleAutoFill = () => {
    const total = parsedTarget;
    if (total <= 0) return;

    // 1. Reservar morrilla para cambio: ~10% del total, con tope de $200, mínimo de lo que se pueda
    const morrillaReserve = Math.min(200, Math.max(0, Math.floor(total * 0.1)));
    const largeTarget = Math.floor(total - morrillaReserve);
    const morrillaTarget = total - largeTarget; // lo que queda, incluyendo decimales si los hay

    const newBreakdown: Record<number, number> = {
      1000: 0, 500: 0, 200: 0, 100: 0, 50: 0, 20: 0,
      10: 0, 5: 0, 2: 0, 1: 0
    };

    // 2. Distribuir billetes grandes (greedy: 1000 → 20)
    const largeDenoms = [1000, 500, 200, 100, 50, 20];
    let remainingLarge = largeTarget;

    for (const denom of largeDenoms) {
      if (remainingLarge <= 0) break;
      const count = Math.floor(remainingLarge / denom);
      if (count > 0) {
        newBreakdown[denom] = count;
        remainingLarge -= count * denom;
      }
    }

    // 3. Lo que no se pudo cubrir con billetes grandes se suma a la morrilla
    let remainingMorrilla = morrillaTarget + remainingLarge;

    // 4. Distribuir morrilla (greedy: 10 → 1)
    const morrillaDenoms = [10, 5, 2, 1];
    for (const denom of morrillaDenoms) {
      if (remainingMorrilla <= 0) break;
      const count = Math.floor(remainingMorrilla / denom);
      if (count > 0) {
        newBreakdown[denom] = count;
        remainingMorrilla -= count * denom;
      }
    }

    // 5. Si quedó un remanente fraccional (centavos), agregarlo al $1
    if (remainingMorrilla > 0) {
      // Redondeo: si hay un remanente menor a 1, sumar 1 al $1 para cuadrar
      newBreakdown[1] += Math.ceil(remainingMorrilla);
    }

    setBreakdown(newBreakdown);
  };

  // ── Crear la dotación (POST /api/liquidity/dotaciones) ──
  const handleSubmit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    setDotationResult(null);
    setUnlockMessage(null);
    try {
      const res = await fetch("/api/liquidity/dotaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cajero_id: cajeroId,
          monto_mxn: parsedTarget,
          tipo_dotacion: "EMERGENCIA",
          desglose_json: JSON.stringify(breakdown)
        })
      });
      const json = await res.json();
      if (json.status === "success") {
        // Mostrar la clave de autorización generada para que el cajero la conozca
        setDotationResult({
          id: json.data.id,
          clave: json.data.clave_autorizacion
        });
      } else {
        alert(`Error: ${json.message}`);
      }
    } catch (err) {
      alert("Error de red al registrar la dotación.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Desbloquear/Aplicar la dotación con la clave de autorización ──
  //    El gerente debe haber autorizado previamente en el Liquidity Hub.
  const handleUnlock = async () => {
    const key = unlockKey.trim().toUpperCase();
    if (!key || key.length < 6) {
      setUnlockMessage({ type: "error", text: "Ingrese una clave de autorización válida." });
      return;
    }
    setIsUnlocking(true);
    setUnlockMessage(null);
    try {
      const res = await fetch("/api/liquidity/dotaciones/desbloquear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clave_autorizacion: key })
      });
      const json = await res.json();
      if (json.status === "success") {
        setUnlockMessage({ type: "success", text: `✅ ${json.message} Se aplicaron $${json.data.monto_mxn.toLocaleString()} MXN a tu terminal.` });
        // Cerrar tras breve delay para que el cajero vea el mensaje
        setTimeout(() => onClose(), 2000);
      } else {
        setUnlockMessage({ type: "error", text: `❌ ${json.message}` });
      }
    } catch (err) {
      setUnlockMessage({ type: "error", text: "Error de red al desbloquear la dotación." });
    } finally {
      setIsUnlocking(false);
    }
  };

  // Todas las denominaciones: billetes grandes + morrilla
  const denominations = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
  const largeDenoms = [1000, 500, 200, 100, 50, 20];
  const morrillaDenoms = [10, 5, 2, 1];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/95 backdrop-blur-xl"
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="bg-[#1e2329] w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-[#2b3139] text-left"
      >
        {/* Header */}
        <div className="p-5 border-b border-[#2b3139] flex justify-between items-center bg-[#181a20]">
          <div className="flex items-center gap-3 text-left">
            <div className="p-2 bg-binance-yellow text-black rounded-xl">
              <Coins size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Desglose de Dotación de Emergencia</h2>
              <span className="block text-[10px] text-gray-400 uppercase tracking-wider">
                Efectivo por Denominación (MXN)
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white bg-[#181a20] border border-[#2b3139] rounded-lg transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
          {/* ── Si ya se creó la dotación, mostrar el panel de autorización ── */}
          {dotationResult ? (
            <div className="space-y-4">
              {/* Confirmación de creación */}
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-start gap-3">
                <CheckCircle2 size={20} className="text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-left">
                  <p className="text-sm font-bold text-emerald-400">Dotación Registrada como PENDIENTE</p>
                  <p className="text-xs text-gray-400 mt-1">
                    ID: <span className="font-mono text-white">{dotationResult.id}</span>
                  </p>
                </div>
              </div>

              {/* Clave de autorización generada */}
              <div className="p-4 bg-[#181a20] border border-[#2b3139] rounded-xl space-y-3">
                <div className="flex items-center gap-2">
                  <KeyRound size={16} className="text-binance-yellow" />
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Clave de Autorización Generada</span>
                </div>
                <div className="flex items-center justify-center gap-3 py-3 bg-black/40 rounded-lg border border-binance-yellow/20">
                  <span className="text-2xl font-bold text-binance-yellow font-mono tracking-[0.3em]">
                    {dotationResult.clave}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 text-center">
                  Solicite a su <span className="text-binance-yellow font-bold">Gerente</span> autorizar esta dotación en el Liquidity Hub.
                  Una vez autorizada, ingrese la clave aquí para desbloquear y aplicar los fondos a su terminal.
                </p>
              </div>

              {/* Paso 3: Ingresar clave para desbloquear */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">
                  3. Ingrese la Clave para Desbloquear (tras autorización del Gerente)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={unlockKey}
                    onChange={(e) => setUnlockKey(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
                    placeholder="ABC123456"
                    maxLength={9}
                    className="flex-1 px-4 py-3 bg-[#181a20] border border-[#2b3139] rounded-xl text-lg font-bold text-binance-yellow focus:outline-none focus:border-binance-yellow font-mono tracking-wider uppercase placeholder-gray-600"
                  />
                  <button
                    type="button"
                    disabled={isUnlocking || !unlockKey.trim()}
                    onClick={handleUnlock}
                    className={`shrink-0 px-5 rounded-xl font-bold text-xs tracking-wider uppercase transition-all flex items-center gap-2 ${
                      !isUnlocking && unlockKey.trim()
                        ? "bg-binance-yellow text-black hover:bg-yellow-400 cursor-pointer"
                        : "bg-[#2b3139] text-gray-600 cursor-not-allowed"
                    }`}
                  >
                    {isUnlocking ? (
                      <>
                        <Clock className="animate-spin" size={14} />
                        <span>Desbloqueando...</span>
                      </>
                    ) : (
                      <>
                        <KeyRound size={14} />
                        <span>Desbloquear</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Botón auto-rellenar la clave generada (conveniencia) */}
                <button
                  type="button"
                  onClick={() => setUnlockKey(dotationResult.clave)}
                  className="text-[10px] text-gray-500 hover:text-binance-yellow transition-colors cursor-pointer underline"
                >
                  Usar la clave generada arriba
                </button>
              </div>

              {/* Mensaje de desbloqueo */}
              {unlockMessage && (
                <div className={`p-3 rounded-xl border text-xs font-medium ${
                  unlockMessage.type === "success"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}>
                  {unlockMessage.text}
                </div>
              )}

              {/* Botón cerrar */}
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 rounded-xl font-bold text-xs tracking-wider uppercase bg-[#2b3139] text-gray-400 hover:text-white border border-[#2b3139] transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          ) : (
            <>
              {/* Step 1: Input target amount */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">
                  1. Ingrese el Monto Total a Solicitar (MXN)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-binance-yellow">$</span>
                  <input
                    type="number"
                    value={requestedAmount}
                    onChange={(e) => setRequestedAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-3 bg-[#181a20] border border-[#2b3139] rounded-xl text-lg font-bold text-binance-yellow focus:outline-none focus:border-binance-yellow"
                    autoFocus
                  />
                </div>
              </div>

              {/* Step 2: Denomination Breakdown */}
              {parsedTarget > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">
                      2. Cantidad de Billetes para Cuadrar el Monto
                    </label>
                    <button
                      type="button"
                      onClick={handleAutoFill}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-binance-yellow text-black text-[11px] font-bold uppercase tracking-wide hover:bg-yellow-400 transition-colors cursor-pointer"
                    >
                      <Zap size={13} />
                      <span>Auto-llenar</span>
                    </button>
                  </div>

                  {/* Billetes grandes */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-gray-500 uppercase font-bold ml-1">Billetes Grandes</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {largeDenoms.map((denom) => {
                        const qty = breakdown[denom] || 0;
                        return (
                          <div
                            key={denom}
                            className="flex items-center justify-between p-2.5 bg-[#181a20] rounded-xl border border-[#2b3139]"
                          >
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-extrabold text-white">${denom} MXN</span>
                              <span className="text-[10px] text-gray-500 font-mono">Subtotal: ${(denom * qty).toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleUpdate(denom, Math.max(0, qty - 1))}
                                className="w-7 h-7 bg-[#2b3139] rounded-lg flex items-center justify-center hover:bg-red-500/20 text-red-400 transition-all cursor-pointer"
                              >
                                <Minus size={12} />
                              </button>
                              <input
                                type="number"
                                value={qty || ""}
                                onChange={(e) => handleUpdate(denom, Math.max(0, parseInt(e.target.value) || 0))}
                                className="w-11 bg-transparent text-center border-b border-[#2b3139] font-bold text-white focus:outline-none focus:border-binance-yellow text-sm"
                                placeholder="0"
                              />
                              <button
                                type="button"
                                onClick={() => handleUpdate(denom, qty + 1)}
                                className="w-7 h-7 bg-[#2b3139] rounded-lg flex items-center justify-center hover:bg-emerald-500/20 text-emerald-400 transition-all cursor-pointer"
                              >
                                <Plus size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Morrilla (cambio) */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-binance-yellow/70 uppercase font-bold ml-1">Morrilla (Cambio)</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {morrillaDenoms.map((denom) => {
                        const qty = breakdown[denom] || 0;
                        return (
                          <div
                            key={denom}
                            className="flex items-center justify-between p-2.5 bg-[#181a20] rounded-xl border border-[#2b3139]"
                          >
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-extrabold text-white">${denom} MXN</span>
                              <span className="text-[10px] text-gray-500 font-mono">Subtotal: ${(denom * qty).toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleUpdate(denom, Math.max(0, qty - 1))}
                                className="w-7 h-7 bg-[#2b3139] rounded-lg flex items-center justify-center hover:bg-red-500/20 text-red-400 transition-all cursor-pointer"
                              >
                                <Minus size={12} />
                              </button>
                              <input
                                type="number"
                                value={qty || ""}
                                onChange={(e) => handleUpdate(denom, Math.max(0, parseInt(e.target.value) || 0))}
                                className="w-11 bg-transparent text-center border-b border-[#2b3139] font-bold text-white focus:outline-none focus:border-binance-yellow text-sm"
                                placeholder="0"
                              />
                              <button
                                type="button"
                                onClick={() => handleUpdate(denom, qty + 1)}
                                className="w-7 h-7 bg-[#2b3139] rounded-lg flex items-center justify-center hover:bg-emerald-500/20 text-emerald-400 transition-all cursor-pointer"
                              >
                                <Plus size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Status comparison bar */}
              {parsedTarget > 0 && (
                <div className="p-4 bg-[#181a20] rounded-xl border border-[#2b3139] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="flex gap-4">
                    <div className="flex flex-col text-left">
                      <span className="text-[9px] text-gray-400 uppercase font-bold">Solicitado</span>
                      <span className="text-sm font-bold text-white font-mono">${parsedTarget.toLocaleString()}</span>
                    </div>
                    <div className="h-8 w-[1px] bg-[#2b3139] hidden sm:block" />
                    <div className="flex flex-col text-left">
                      <span className="text-[9px] text-gray-400 uppercase font-bold">Desglosado</span>
                      <span className={`text-sm font-bold font-mono ${isValid ? 'text-emerald-500' : 'text-binance-yellow'}`}>
                        ${totalBreakdown.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-8 w-[1px] bg-[#2b3139] hidden sm:block" />
                    <div className="flex flex-col text-left">
                      <span className="text-[9px] text-gray-400 uppercase font-bold">Diferencia</span>
                      <span className={`text-sm font-bold font-mono ${isValid ? 'text-emerald-400' : 'text-red-400'}`}>
                        ${diff.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {!isValid && (
                    <div className="bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-amber-400 text-xs">
                      <AlertCircle size={14} />
                      <span>El desglose debe cuadrar exactamente</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — solo visible antes de crear la dotación */}
        {!dotationResult && (
          <div className="p-5 border-t border-[#2b3139] bg-[#181a20]">
            <button
              type="button"
              disabled={!isValid || isSubmitting}
              onClick={handleSubmit}
              className={`w-full py-3 rounded-xl font-bold text-xs tracking-wider uppercase transition-all flex items-center justify-center gap-2 ${
                isValid && !isSubmitting
                  ? "bg-binance-yellow text-black hover:bg-yellow-400 shadow-lg shadow-binance-yellow/10 cursor-pointer"
                  : "bg-[#2b3139] text-gray-600 cursor-not-allowed border border-[#2b3139]"
              }`}
            >
              {isSubmitting ? (
                <>
                  <Clock className="animate-spin" size={14} />
                  <span>Enviando...</span>
                </>
              ) : isValid ? (
                <>
                  <ShieldCheck size={16} />
                  <span>Enviar Solicitud de Dotación</span>
                </>
              ) : (
                <span>Ingrese Monto y Complete el Desglose</span>
              )}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
