import React, { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { RoleLevel } from "../types/auth";
import ShiftOpeningCount from "./ShiftOpeningCount";
import { RefreshCw, ArrowLeftRight, Hand, Lock } from "lucide-react";

/**
 * ShiftGate — Renderizado Atómico con Autenticación JWT.
 *
 * FIX (insertBefore crash): TODOS los hooks se declaran incondicionalmente al
 * tope del componente, ANTES de cualquier return. 
 *
 * FIX (Integración JWT): Ahora usa tokens Bearer en lugar de headers x-user-id.
 * Los requests al backend incluyen Authorization: Bearer <token> para garantizar
 * que solo usuarios autenticados puedan acceder a endpoints protegidos.
 *
 * Contrato atómico: para un operador Nivel 2 (Caja) sin turno ABIERTO en
 * caja_turnos, este componente devuelve EXCLUSIVAMENTE <ShiftOpeningCount />
 * (OpeningFlow). Ningún nodo del Dashboard existe en el DOM hasta que la base
 * de datos confirme estado === "OPEN". Las ramas son mutuamente excluyentes:
 * nunca coexisten gate y dashboard en el mismo render.
 *
 * INMUTABLE OPENING FLOW: Una vez que el usuario está en el flujo de apertura,
 * F5 (reload) no puede bypasearlo. El estado persiste hasta que se complete
 * el proceso de apertura correctamente.
 */
const ShiftGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, loading: authLoading, token } = useAuth();

  // --- HOOKS: siempre al tope, en orden fijo, sin returns previos ---
  const [shiftStatus, setShiftStatus] = useState<"LOADING" | "OPEN" | "CLOSED" | "PENDING_AUTHORIZATION">("LOADING");
  const [isReloadProtected, setIsReloadProtected] = useState(false);
  const [operationType, setOperationType] = useState<"select" | "apertura" | "handoff" | "cierre">("select");

  // El operador de caja (Nivel <= CAJERO_PRINCIPAL) requiere turno.
  // Se calcula sin condicionar la ejecución de hooks.
  const isCashier = !!profile && profile.role_level <= RoleLevel.CAJERO_PRINCIPAL;

  // Protección contra F5 - evitar bypasear el flujo de apertura
  useEffect(() => {
    if (isCashier && shiftStatus === "CLOSED") {
      setIsReloadProtected(true);
      
      // Interceptar intentos de recarga de página
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = "El flujo de apertura debe completarse. ¿Está seguro de salir?";
        return "El flujo de apertura debe completarse. ¿Está seguro de salir?";
      };

      window.addEventListener('beforeunload', handleBeforeUnload);
      
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        setIsReloadProtected(false);
      };
    }
  }, [isCashier, shiftStatus]);

  useEffect(() => {
    // Aún sin perfil, sin token o no es cajero → no consultamos turno.
    if (!profile || !token || !isCashier) return;

    let cancelled = false;
    
    const fetchShiftStatus = async () => {
      try {
        const res = await fetch("/api/shifts/status", { 
          headers: { 
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          } 
        });
        
        if (cancelled) return;
        
        if (res.ok) {
          const data = await res.json();
          if (data.shift && data.shift.status !== "CLOSED") {
            setShiftStatus(data.shift.status);
          } else {
            setShiftStatus("CLOSED");
          }
        } else if (res.status === 401 || res.status === 403) {
          // Token inválido o permisos insuficientes
          console.warn("Token inválido para verificar turno");
          setShiftStatus("CLOSED");
        } else {
          setShiftStatus("CLOSED");
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Error fetching shift status:", error);
          setShiftStatus("CLOSED");
        }
      }
    };

    fetchShiftStatus();

    return () => { 
      cancelled = true; 
    };
  }, [profile, isCashier, token]);

  // ------------------------------------------------------------------
  // A PARTIR DE AQUÍ: solo returns. Ningún hook debajo de esta línea.
  // Cada rama devuelve UN ÚNICO subárbol — renderizado atómico.
  // ------------------------------------------------------------------

  // 1. Esperando autenticación / sin sesión / sin token
  if (authLoading || !profile || !token) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0b0e11] text-white">
        <RefreshCw className="animate-spin text-binance-yellow mb-4" size={48} />
        <p className="text-gray-400 font-medium">
          {authLoading ? "Cargando perfil..." : "Verificando autenticación..."}
        </p>
        {isReloadProtected && (
          <p className="text-red-400 text-xs mt-2">
            ⚠️ Protección contra recarga activa
          </p>
        )}
      </div>
    );
  }

  // 2. No es cajero (Gerente / Super Admin / Consulta) → dashboard directo
  if (!isCashier) {
    return <>{children}</>;
  }

  // 3. Cajero: verificando turno en caja_turnos
  if (shiftStatus === "LOADING") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0b0e11] text-white">
        <RefreshCw className="animate-spin text-binance-yellow mb-4" size={48} />
        <p className="text-gray-400 font-medium">Verificando turno activo...</p>
        <p className="text-gray-600 text-xs mt-2">{profile.nickname} — {profile.puesto}</p>
        {isReloadProtected && (
          <p className="text-amber-400 text-xs mt-1">
            🔒 Flujo de apertura protegido contra recargas
          </p>
        )}
      </div>
    );
  }

  // 4. Turno confirmado ABIERTO por la BD → recién ahora montamos el Dashboard
  if (shiftStatus === "OPEN") {
    return <>{children}</>;
  }

  // 5. CLOSED o PENDING_AUTHORIZATION → EXCLUSIVAMENTE el flujo de apertura.
  //    No hay ningún nodo del Dashboard en el DOM en esta rama.
  //    INMUTABLE: Una vez aquí, F5 no puede bypasear el flujo.
  return (
    <div className="min-h-screen bg-[#0b0e11] flex items-center justify-center p-4">
      {isReloadProtected && (
        <div className="fixed top-4 right-4 bg-amber-500/10 border border-amber-500/30 text-amber-400 px-3 py-2 rounded-xl text-xs font-mono z-50">
          🔒 Flujo inmutable - Completar apertura obligatorio
        </div>
      )}

      {/* Modal: Selección de Tipo de Operación */}
      {operationType === "select" && (
        <div className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-binance-yellow/10 border border-binance-yellow/30 rounded-2xl mb-4">
              <ArrowLeftRight size={28} className="text-binance-yellow" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Tipo de Operación</h2>
            <p className="text-gray-500 text-sm">Selecciona la operación a realizar para continuar</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Apertura */}
            <button
              onClick={() => setOperationType("apertura")}
              className="group p-6 bg-[#1e2329] border border-[#2b3139] hover:border-binance-yellow/40 rounded-2xl transition-all text-center space-y-3"
            >
              <div className="w-14 h-14 mx-auto rounded-xl bg-binance-yellow/10 flex items-center justify-center group-hover:bg-binance-yellow/20 transition-colors">
                <ArrowLeftRight size={24} className="text-binance-yellow" />
              </div>
              <div>
                <h3 className="text-white font-bold text-sm">Apertura</h3>
                <p className="text-gray-500 text-xs mt-1">Iniciar turno con arqueo ciego</p>
              </div>
            </button>

            {/* Handoff */}
            <button
              onClick={() => setOperationType("apertura")}
              className="group p-6 bg-[#1e2329] border border-[#2b3139] hover:border-binance-yellow/40 rounded-2xl transition-all text-center space-y-3"
            >
              <div className="w-14 h-14 mx-auto rounded-xl bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                <Hand size={24} className="text-emerald-500" />
              </div>
              <div>
                <h3 className="text-white font-bold text-sm">Handoff</h3>
                <p className="text-gray-500 text-xs mt-1">Recibir turno de otro cajero</p>
              </div>
            </button>

            {/* Cierre */}
            <button
              onClick={() => setOperationType("apertura")}
              className="group p-6 bg-[#1e2329] border border-[#2b3139] hover:border-red-500/40 rounded-2xl transition-all text-center space-y-3"
            >
              <div className="w-14 h-14 mx-auto rounded-xl bg-red-500/10 flex items-center justify-center group-hover:bg-red-500/20 transition-colors">
                <Lock size={24} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-white font-bold text-sm">Cierre</h3>
                <p className="text-gray-500 text-xs mt-1">Cerrar turno y entregar caja</p>
              </div>
            </button>
          </div>

          <p className="text-center text-gray-600 text-[10px] mt-6 font-mono uppercase tracking-widest">
            {profile.nickname} — {profile.puesto}
          </p>
        </div>
      )}

      {/* Flujo de Apertura/Handoff/Cierre */}
      {operationType !== "select" && (
        <div className="w-full max-w-5xl">
          <button
            onClick={() => setOperationType("select")}
            className="mb-4 text-xs text-gray-500 hover:text-binance-yellow transition-colors flex items-center gap-1"
          >
            ← Volver a selección de operación
          </button>

          <ShiftOpeningCount
            token={token}
            onShiftStatusChange={(status) => {
              setShiftStatus((status as any) || "CLOSED");

              // Solo desproteger si el turno se abre exitosamente
              if (status === "OPEN") {
                setIsReloadProtected(false);
              }
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ShiftGate;