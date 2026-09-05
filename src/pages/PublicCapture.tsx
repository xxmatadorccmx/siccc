import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  QrCode, 
  DollarSign, 
  User, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle, 
  TrendingUp, 
  Clock, 
  RefreshCw, 
  Sparkles, 
  ShieldCheck, 
  Search,
  Lock,
  Fingerprint,
  Camera,
  Truck,
  FileText,
  Coins,
  Briefcase,
  Plus,
  HelpCircle,
  X,
  Percent,
  ChevronRight,
  ShieldAlert,
  Sliders,
  CheckCircle,
  Check
} from 'lucide-react';

interface Ticket {
  ticket_code: string;
  partner_id: string;
  affiliate_code: string;
  amount_usd: number;
  customer_name: string;
  status: 'PENDIENTE' | 'LIQUIDADO' | 'CANCELADO';
  created_at: string;
  estimated_rate: number;
  estimated_commission_mxn: number;
}

interface Recoleccion {
  id: number;
  packages_count: number;
  safety_seals: string;
  photo_url: string;
  status: string;
  created_at: string;
}

interface Corte {
  id: number;
  amount_usd: number;
  commission_rate: number;
  commission_mxn: number;
  status: string;
  created_at: string;
}

interface DashboardStats {
  partner: {
    partner_id: string;
    name: string;
    partner_code: string;
    phone: string;
    is_wholesale: boolean;
  };
  totalUsdOperatedMonth: number;
  earnedCommissionMxn: number;
  pendingCommissionMxn: number;
  totalCommissionMxn: number;
  tickets: Ticket[];
  recolecciones: Recoleccion[];
  cortes: Corte[];
}

export default function PublicCapture() {
  // Authentication & Security state
  const [tokenInput, setTokenInput] = useState('');
  const [authenticatedPartner, setAuthenticatedPartner] = useState<any>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [securityError, setSecurityError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Biometric & NIP verification state
  const [pin, setPin] = useState('');
  const [biometricScanning, setBiometricScanning] = useState(false);
  const [biometricSuccess, setBiometricSuccess] = useState(false);
  const [showNipFallback, setShowNipFallback] = useState(false);

  // Core Navigation
  const [activeTab, setActiveTab] = useState<'summary' | 'history' | 'wholesale'>('summary');
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);

  // Form states
  const [newAmount, setNewAmount] = useState('');
  const [newCustomer, setNewCustomer] = useState('');
  const [newTicketCode, setNewTicketCode] = useState('');
  const [ticketStep, setTicketStep] = useState<'form' | 'qr'>('form');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // Wholesale specific features state
  const [wholesaleSection, setWholesaleSection] = useState<'corte' | 'vault' | 'tasa_red'>('corte');
  
  // Corte de Comercio
  const [corteAmountUsd, setCorteAmountUsd] = useState('');
  const [corteRate, setCorteRate] = useState('0.20');
  const [corteSubmitting, setCorteSubmitting] = useState(false);
  const [corteMessage, setCorteMessage] = useState('');

  // Vault-as-a-Service
  const [vaultPackages, setVaultPackages] = useState('1');
  const [vaultSeals, setVaultSeals] = useState('');
  const [vaultPhoto, setVaultPhoto] = useState<string | null>(null);
  const [vaultSubmitting, setVaultSubmitting] = useState(false);
  const [vaultMessage, setVaultMessage] = useState('');

  // Pactar Tasa de Red
  const [negotiatedRateAmount, setNegotiatedRateAmount] = useState('1500');
  const [negotiatedRateMxn, setNegotiatedRateMxn] = useState('18.45');
  const [negotiationSuccess, setNegotiationSuccess] = useState(false);

  // Stats State
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isPolling, setIsPolling] = useState(true);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'failed'>('connecting');

  // Webhook celebration notice
  const [celebration, setCelebration] = useState<any>(null);
  const prevTicketsRef = useRef<Ticket[]>([]);

  // Parse token from URL or LocalStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token') || params.get('codigo');
    const storedToken = localStorage.getItem('partner_private_token');
    
    const finalToken = urlToken || storedToken;
    if (finalToken) {
      handleTokenVerification(finalToken, true);
    }
  }, []);

  // Handle Token Verification
  const handleTokenVerification = async (tokenStr: string, autoAuth = false) => {
    if (!tokenStr.trim()) return;
    setAuthLoading(true);
    setSecurityError('');
    try {
      const res = await fetch(`/api/partners/by-token?token=${encodeURIComponent(tokenStr.toUpperCase().trim())}`);
      if (res.ok) {
        const partner = await res.json();
        setAuthenticatedPartner(partner);
        localStorage.setItem('partner_private_token', partner.partner_code);
        
        // Auto fetch initial stats in background
        fetchDashboardStats(partner.partner_code, true);
      } else {
        const err = await res.json();
        setSecurityError(err.error || 'Token de seguridad inválido.');
        if (!autoAuth) {
          localStorage.removeItem('partner_private_token');
        }
      }
    } catch (e) {
      setSecurityError('Error de conexión con la matriz de seguridad.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Fetch Dashboard Stats
  const fetchDashboardStats = async (codeToFetch: string, silent = false) => {
    if (!silent) {
      setStatsLoading(true);
      setStatsError('');
    }
    try {
      const res = await fetch(`/api/partners/dashboard-stats?token=${encodeURIComponent(codeToFetch)}`);
      if (res.ok) {
        const data: DashboardStats = await res.json();
        
        // Real-time Liquidation webhook simulation detection
        if (prevTicketsRef.current.length > 0) {
          data.tickets.forEach(newTicket => {
            const oldTicket = prevTicketsRef.current.find(t => t.ticket_code === newTicket.ticket_code);
            if (oldTicket && oldTicket.status === 'PENDIENTE' && newTicket.status === 'LIQUIDADO') {
              // Trigger Celebration Overlay!
              setCelebration({
                customer: newTicket.customer_name,
                amount: newTicket.amount_usd,
                commission: newTicket.estimated_commission_mxn,
                ticketCode: newTicket.ticket_code
              });
            }
          });
        }
        
        prevTicketsRef.current = data.tickets;
        setStats(data);
        setStatsError('');
        setLastUpdated(new Date());
      } else {
        const err = await res.json();
        if (!silent) {
          setStatsError(err.error || 'Error al descargar datos del dashboard.');
        }
      }
    } catch (e) {
      if (!silent) {
        setStatsError('Error de conexión.');
      }
    } finally {
      if (!silent) {
        setStatsLoading(false);
      }
    }
  };

  // Real-time WebSocket connection with Fetch polling fallback (every 5 seconds)
  useEffect(() => {
    if (!isUnlocked || !authenticatedPartner) return;

    let socket: WebSocket | null = null;
    let pollInterval: NodeJS.Timeout | null = null;

    const connectWebSocket = () => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(`${protocol}//${window.location.host}/api/partners/ws`);
        setWsStatus('connecting');

        socket.onopen = () => {
          console.log('[WebSocket] Connected successfully to partners channel');
          setWsStatus('connected');
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        };

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data && (data.type === 'update_stats' || data.type === 'ticket_liquidated')) {
              console.log('[WebSocket] Update event received, refreshing...');
              fetchDashboardStats(authenticatedPartner.partner_code, true);
            }
          } catch (err) {
            console.error('[WebSocket] Error parsing message:', err);
          }
        };

        socket.onerror = (err) => {
          console.error('[WebSocket] Error encountered:', err);
          setWsStatus('failed');
        };

        socket.onclose = () => {
          console.log('[WebSocket] Connection closed. Falling back to Fetch polling...');
          setWsStatus('failed');
          startFallbackPolling();
        };
      } catch (err) {
        console.error('[WebSocket] Error creating socket:', err);
        setWsStatus('failed');
        startFallbackPolling();
      }
    };

    const startFallbackPolling = () => {
      if (pollInterval) return; // already polling
      console.log('[WebSocket Fallback] Initiating 5s Fetch polling...');
      // Initial fetch
      fetchDashboardStats(authenticatedPartner.partner_code, true);
      // Interval
      pollInterval = setInterval(() => {
        fetchDashboardStats(authenticatedPartner.partner_code, true);
      }, 5000);
    };

    if (isPolling) {
      connectWebSocket();
    } else {
      setWsStatus('failed');
      startFallbackPolling();
    }

    // Connection timeout safety
    const timeout = setTimeout(() => {
      if (socket && socket.readyState !== WebSocket.OPEN) {
        console.log('[WebSocket] Connection timeout, falling back to Fetch polling...');
        socket.close();
        setWsStatus('failed');
        startFallbackPolling();
      }
    }, 2500);

    return () => {
      clearTimeout(timeout);
      if (socket) socket.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [isUnlocked, authenticatedPartner, isPolling]);

  // Force-refresh of state on successful transaction completion in the backend (local synchronization)
  useEffect(() => {
    const handleGlobalSync = () => {
      if (authenticatedPartner) {
        console.log('[Global Sync] Received fx_transaction_success, force-refreshing affiliate stats...');
        fetchDashboardStats(authenticatedPartner.partner_code, true);
      }
    };

    window.addEventListener('fx_transaction_success', handleGlobalSync);
    return () => {
      window.removeEventListener('fx_transaction_success', handleGlobalSync);
    };
  }, [authenticatedPartner]);

  // Simulate Biometrics Scan
  const triggerBiometricScan = () => {
    setBiometricScanning(true);
    setSecurityError('');
    
    // Play with beautiful loading states
    setTimeout(() => {
      // Simulate physical fingerprint / FaceID sensor trigger
      setBiometricScanning(false);
      setBiometricSuccess(true);
      setTimeout(() => {
        setIsUnlocked(true);
      }, 600);
    }, 1800);
  };

  // Handle NIP PIN pad input
  const handlePinInput = (num: string) => {
    if (pin.length < 4) {
      const nextPin = pin + num;
      setPin(nextPin);
      if (nextPin === '1234' || nextPin === '0000') {
        // Correct pin simulation
        setTimeout(() => {
          setIsUnlocked(true);
        }, 300);
      } else if (nextPin.length === 4) {
        // Failed attempt
        setTimeout(() => {
          setSecurityError('PIN de seguridad incorrecto. Intenta con "1234"');
          setPin('');
        }, 300);
      }
    }
  };

  const handleClearPin = () => {
    setPin('');
    setSecurityError('');
  };

  // Submit new ticket
  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAmount || !newCustomer) {
      setFormError('Por favor introduce el monto y el nombre del cliente');
      return;
    }
    setFormLoading(true);
    setFormError('');
    try {
      const res = await fetch('/api/partners/pre-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerCode: authenticatedPartner.partner_code,
          amountUsd: parseFloat(newAmount),
          customerName: newCustomer.trim().toUpperCase()
        })
      });

      if (res.ok) {
        const data = await res.json();
        setNewTicketCode(data.ticketCode);
        setTicketStep('qr');
        // Instantly refresh list
        fetchDashboardStats(authenticatedPartner.partner_code, true);
      } else {
        const err = await res.json();
        setFormError(err.error || 'Error al pre-registrar operación.');
      }
    } catch (e) {
      setFormError('Error de red al conectar con el servidor.');
    } finally {
      setFormLoading(false);
    }
  };

  // Submit Consolidated Daily Cut (Corte de Comercio)
  const handleSubmitCorte = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!corteAmountUsd) return;
    setCorteSubmitting(true);
    setCorteMessage('');
    try {
      const amountVal = parseFloat(corteAmountUsd);
      const commissionVal = amountVal * parseFloat(corteRate);
      
      const res = await fetch('/api/partners/corte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerId: authenticatedPartner.partner_id,
          amountUsd: amountVal,
          commissionRate: parseFloat(corteRate),
          commissionMxn: commissionVal
        })
      });

      if (res.ok) {
        setCorteMessage('Corte diario consolidado registrado y enviado a liquidación.');
        setCorteAmountUsd('');
        // Refresh
        fetchDashboardStats(authenticatedPartner.partner_code, true);
      } else {
        setCorteMessage('No se pudo procesar el corte.');
      }
    } catch (e) {
      setCorteMessage('Error de conexión.');
    } finally {
      setCorteSubmitting(false);
    }
  };

  // Submit Vault-as-a-Service (Recolección)
  const handleSubmitVaultRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setVaultSubmitting(true);
    setVaultMessage('');
    try {
      const res = await fetch('/api/partners/recoleccion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerId: authenticatedPartner.partner_id,
          packagesCount: parseInt(vaultPackages),
          safetySeals: vaultSeals || 'SELLO-SNC-' + Math.floor(100000 + Math.random() * 900000),
          photoUrl: vaultPhoto || 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?auto=format&fit=crop&w=300&q=80'
        })
      });

      if (res.ok) {
        setVaultMessage('Solicitud recibida. Unidad blindada programada. Estatus: Efectivo en Tránsito.');
        setVaultSeals('');
        setVaultPhoto(null);
        // Refresh
        fetchDashboardStats(authenticatedPartner.partner_code, true);
      } else {
        setVaultMessage('Error al programar recolección.');
      }
    } catch (e) {
      setVaultMessage('Error de conexión de red.');
    } finally {
      setVaultSubmitting(false);
    }
  };

  const handleSimulatedPhotoUpload = () => {
    // Simulate premium photography capturing of security bags
    setVaultPhoto('https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=300&q=80');
  };

  // Reset Token access to logout cleanly
  const handleLogout = () => {
    localStorage.removeItem('partner_private_token');
    setAuthenticatedPartner(null);
    setIsUnlocked(false);
    setPin('');
    setTokenInput('');
  };

  // Calculate dynamic near-threshold warnings
  const currentInputAmount = parseFloat(newAmount) || 0;
  let dynamicWarning = '';
  if (currentInputAmount >= 100 && currentInputAmount < 301) {
    const diff = 301 - currentInputAmount;
    dynamicWarning = `¡Estás a solo $${diff.toFixed(2)} USD de activar tu tarifa de $0.15 MXN/USD!`;
  } else if (currentInputAmount >= 500 && currentInputAmount < 1000) {
    const diff = 1000 - currentInputAmount;
    dynamicWarning = `¡Estás a solo $${diff.toFixed(2)} USD de activar tu tarifa premium de $0.20 MXN/USD!`;
  }

  // Live Exchange Rate wholesale simulation (+0.15 improvement)
  const baseStandardRate = 18.25;
  const wholesaleBonus = parseFloat(negotiatedRateAmount) >= 5000 ? 0.15 : 0.05;
  const customWholesaleRate = baseStandardRate + wholesaleBonus;

  return (
    <div className="min-h-screen bg-[#07090e] text-[#f5f6f8] font-sans antialiased flex flex-col justify-between selection:bg-[#c39b54]/30 selection:text-[#ffd97d]">
      
      {/* Real-time Webhook Sincronización Overlay */}
      <AnimatePresence>
        {celebration && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-lg z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#11141e] border-2 border-[#d4af37] rounded-3xl p-8 max-w-sm w-full shadow-2xl shadow-[#d4af37]/15 text-center space-y-6 relative overflow-hidden"
            >
              <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-transparent via-[#d4af37] to-transparent" />
              
              <div className="w-20 h-20 bg-[#d4af37]/10 rounded-full flex items-center justify-center mx-auto text-[#d4af37] border border-[#d4af37]/20">
                <Sparkles size={36} className="animate-spin-slow" />
              </div>

              <div className="space-y-2">
                <span className="bg-[#ffd97d]/10 text-[#ffd97d] text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full border border-[#ffd97d]/20">
                  Transparencia de Ventanilla • Realtime
                </span>
                <h2 className="text-xl font-bold text-white mt-2">¡Operación Liquidada!</h2>
                <p className="text-gray-400 text-xs">
                  El ticket de <span className="text-white font-black">{celebration.customer}</span> por un importe de <span className="text-[#ffd97d] font-bold">${celebration.amount} USD</span> ha sido liquidado en sucursal.
                </p>
              </div>

              <div className="bg-black/60 p-5 rounded-2xl border border-white/5 space-y-1">
                <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">Acreditación Instantánea</p>
                <p className="text-3xl font-black text-[#22c55e]">
                  +${celebration.commission.toFixed(2)} MXN
                </p>
                <p className="text-[9px] text-gray-400 font-medium">
                  Impacto directo en balance mensual
                </p>
              </div>

              <button 
                onClick={() => setCelebration(null)}
                className="w-full bg-[#d4af37] hover:bg-[#c39b54] text-black py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all active:scale-[0.98]"
              >
                Actualizar Tablero
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Screen 1: Unauthenticated - Token entry or URL verification */}
      {!authenticatedPartner && (
        <div className="flex-1 flex flex-col items-center justify-center p-4 max-w-sm mx-auto w-full space-y-8">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 bg-gradient-to-br from-[#d4af37]/20 to-[#07090e] border border-[#d4af37]/30 rounded-2xl flex items-center justify-center mx-auto shadow-xl">
              <ShieldCheck size={32} className="text-[#d4af37]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Banca Privada</h1>
              <p className="text-[#ffd97d] text-[10px] font-bold uppercase tracking-widest mt-1">
                Portal Privado de Referidores
              </p>
            </div>
          </div>

          <div className="bg-[#11141e] border border-[#232936] rounded-3xl p-6 w-full space-y-5 shadow-2xl">
            <div className="space-y-1.5 text-center">
              <h2 className="text-sm font-bold text-white">Acceso Mediante Token Privado</h2>
              <p className="text-gray-400 text-[11px]">No se requiere contraseña. Ingresa el código secreto de tu cuenta o usa la URL personalizada.</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Token Secreto / UUID</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#d4af37]" size={15} />
                  <input 
                    type="text"
                    placeholder="Escribe tu código de aliado (ej. M102)"
                    value={tokenInput}
                    onChange={e => setTokenInput(e.target.value)}
                    className="w-full bg-black/50 border border-[#232936] rounded-xl py-3.5 pl-10 pr-4 text-white text-sm font-bold focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37]/30 outline-none transition-all placeholder:text-gray-600 uppercase"
                  />
                </div>
              </div>

              {securityError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2.5 text-red-400 text-xs font-semibold">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{securityError}</span>
                </div>
              )}

              <button 
                onClick={() => handleTokenVerification(tokenInput)}
                disabled={authLoading || !tokenInput.trim()}
                className="w-full bg-[#d4af37] hover:bg-[#c39b54] disabled:opacity-50 text-black py-3.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all active:scale-[0.98] shadow-lg shadow-[#d4af37]/10"
              >
                {authLoading ? "Verificando..." : "CONECTAR PORTAL SEGURO"}
              </button>
            </div>
          </div>

          <p className="text-[9px] text-gray-600 text-center font-semibold leading-relaxed">
            Consulte a su gerente comercial para obtener su token UUID de acceso directo FaceID/Fingerprint.
          </p>
        </div>
      )}

      {/* Screen 2: Authenticated but Locked - Biometrics or NIP keypad */}
      {authenticatedPartner && !isUnlocked && (
        <div className="flex-1 flex flex-col items-center justify-center p-4 max-w-sm mx-auto w-full space-y-8">
          <div className="text-center space-y-2">
            <span className="text-[10px] text-[#ffd97d] font-bold uppercase tracking-widest">
              Identidad Detectada: {authenticatedPartner.name}
            </span>
            <h2 className="text-xl font-bold text-white">Validación Biométrica Requerida</h2>
            <p className="text-gray-400 text-xs px-4">Confirma tu huella digital o FaceID para desbloquear la información financiera confidencial.</p>
          </div>

          {/* Biometric Scan Area or Fallback NIP Panel */}
          <div className="bg-[#11141e] border border-[#232936] rounded-3xl p-6 w-full space-y-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-[#d4af37]/40 to-transparent" />
            
            {!showNipFallback ? (
              <div className="space-y-6 text-center">
                {/* Fingerprint Scanning Visuals */}
                <div className="relative py-4 flex justify-center">
                  <motion.div 
                    animate={biometricScanning ? { scale: [1, 1.1, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                    className={`w-24 h-24 rounded-full flex items-center justify-center cursor-pointer transition-all duration-500 border ${
                      biometricSuccess 
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                        : biometricScanning 
                          ? 'bg-[#d4af37]/10 border-[#d4af37] text-[#d4af37] shadow-lg shadow-[#d4af37]/10' 
                          : 'bg-black/40 border-[#232936] text-gray-400 hover:border-[#d4af37]/30 hover:text-white'
                    }`}
                    onClick={triggerBiometricScan}
                  >
                    <Fingerprint size={48} className={biometricScanning ? "animate-pulse" : ""} />
                  </motion.div>

                  {biometricScanning && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-28 h-28 border-2 border-dashed border-[#d4af37]/40 rounded-full animate-spin" />
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-white font-bold">
                    {biometricSuccess 
                      ? '¡Acceso Concedido!' 
                      : biometricScanning 
                        ? 'Escaneando sensores dactilares...' 
                        : 'Haz clic en la huella para validar'}
                  </p>
                  <p className="text-[11px] text-gray-500">Prueba biométrica simulada WebAuthn.</p>
                </div>

                {securityError && (
                  <p className="text-xs text-red-400 font-semibold">{securityError}</p>
                )}

                <div className="border-t border-[#232936] pt-4">
                  <button 
                    onClick={() => {
                      setShowNipFallback(true);
                      setSecurityError('');
                    }}
                    className="text-[10px] text-[#ffd97d] hover:underline font-bold uppercase tracking-wider"
                  >
                    Usar código NIP de 4 dígitos como alternativa
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="text-center space-y-1.5">
                  <p className="text-xs text-white font-bold">Ingresa tu NIP de 4 dígitos</p>
                  <div className="flex justify-center gap-3 py-2">
                    {[0, 1, 2, 3].map(i => (
                      <div 
                        key={i} 
                        className={`w-3.5 h-3.5 rounded-full border transition-all duration-200 ${
                          pin.length > i 
                            ? 'bg-[#d4af37] border-[#d4af37] scale-110 shadow-md shadow-[#d4af37]/20' 
                            : 'bg-black/50 border-gray-700'
                        }`} 
                      />
                    ))}
                  </div>
                </div>

                {securityError && (
                  <p className="text-[11px] text-red-400 font-semibold text-center">{securityError}</p>
                )}

                {/* PIN Grid Pad */}
                <div className="grid grid-cols-3 gap-2.5 max-w-[220px] mx-auto pt-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                    <button 
                      key={num}
                      onClick={() => handlePinInput(num)}
                      className="aspect-square bg-black/40 hover:bg-black/80 border border-white/5 hover:border-white/10 active:scale-95 transition-all rounded-xl font-bold text-sm text-white flex items-center justify-center"
                    >
                      {num}
                    </button>
                  ))}
                  <button 
                    onClick={handleClearPin}
                    className="aspect-square text-[10px] text-red-400 font-bold flex items-center justify-center hover:bg-red-500/5 rounded-xl transition-colors"
                  >
                    BORRAR
                  </button>
                  <button 
                    onClick={() => handlePinInput('0')}
                    className="aspect-square bg-black/40 hover:bg-black/80 border border-white/5 hover:border-white/10 active:scale-95 transition-all rounded-xl font-bold text-sm text-white flex items-center justify-center"
                  >
                    0
                  </button>
                  <button 
                    onClick={() => {
                      setShowNipFallback(false);
                      setPin('');
                      setSecurityError('');
                    }}
                    className="aspect-square text-[10px] text-[#ffd97d] font-bold flex items-center justify-center hover:bg-[#d4af37]/5 rounded-xl transition-colors"
                  >
                    BIOM.
                  </button>
                </div>
              </div>
            )}
          </div>

          <button 
            onClick={handleLogout}
            className="text-xs text-gray-500 hover:text-white underline font-bold"
          >
            Cambiar de Cuenta / Salir
          </button>
        </div>
      )}

      {/* Screen 3: Authenticated & Unlocked - MAIN DASHBOARD PORTAL */}
      {authenticatedPartner && isUnlocked && (
        <div className="flex-1 flex flex-col justify-start max-w-md mx-auto w-full px-4 py-6 pb-28 space-y-6">
          
          {/* Header Dashboard Info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#d4af37]/10 border border-[#d4af37]/30 rounded-xl flex items-center justify-center text-[#d4af37]">
                <Briefcase size={20} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white tracking-tight">{authenticatedPartner.name}</h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {wsStatus === 'connected' ? (
                    <>
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                      </span>
                      <span className="text-[9px] text-emerald-400 font-black uppercase tracking-wider">
                        Conectado vía WebSocket
                      </span>
                    </>
                  ) : wsStatus === 'connecting' ? (
                    <>
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-sky-500"></span>
                      </span>
                      <span className="text-[9px] text-sky-400 font-black uppercase tracking-wider animate-pulse">
                        Conectando real-time...
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                      </span>
                      <span className="text-[9px] text-amber-400 font-black uppercase tracking-wider">
                        Fallo WS • Fallback Polling (5s)
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={() => fetchDashboardStats(authenticatedPartner.partner_code)}
                disabled={statsLoading}
                className="p-2 bg-[#11141e] hover:bg-[#232936] border border-[#232936] rounded-xl text-gray-400 hover:text-white transition-all disabled:opacity-50"
                title="Sincronizar"
              >
                <RefreshCw size={14} className={statsLoading ? "animate-spin" : ""} />
              </button>
              <button 
                onClick={handleLogout}
                className="p-2 bg-[#11141e] hover:bg-red-500/10 border border-[#232936] hover:border-red-500/20 rounded-xl text-gray-400 hover:text-red-400 transition-all"
                title="Salir del Portal"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* TAB SYSTEM */}
          <div className="flex bg-[#11141e] border border-[#232936] p-1 rounded-2xl">
            <button 
              onClick={() => setActiveTab('summary')}
              className={`flex-1 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all ${activeTab === 'summary' ? 'bg-[#232936] text-white shadow-md' : 'text-gray-500 hover:text-white'}`}
            >
              Comisiones
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all ${activeTab === 'history' ? 'bg-[#232936] text-white shadow-md' : 'text-gray-500 hover:text-white'}`}
            >
              Historial
            </button>
            {stats?.partner.is_wholesale && (
              <button 
                onClick={() => setActiveTab('wholesale')}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all text-[#ffd97d] flex items-center justify-center gap-1 ${activeTab === 'wholesale' ? 'bg-[#ffd97d]/10 border border-[#ffd97d]/20 text-white' : 'text-gray-500 hover:text-[#ffd97d]'}`}
              >
                <Sparkles size={11} className="animate-pulse" />
                Mayorista
              </button>
            )}
          </div>

          {/* CONTENT ACCORDING TO TABS */}
          <AnimatePresence mode="wait">
            {activeTab === 'summary' && (
              <motion.div 
                key="summary"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Monthly Commission Summary Card */}
                <div className="bg-gradient-to-br from-[#11141e] to-[#0d1017] border border-[#232936] rounded-3xl p-6 relative overflow-hidden shadow-2xl">
                  {/* Subtle Background Badge */}
                  <div className="absolute right-[-10px] top-[-10px] text-white/[0.02] text-8xl font-black select-none pointer-events-none">
                    $
                  </div>

                  <div className="flex justify-between items-center pb-4 border-b border-white/5">
                    <div>
                      <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Resumen del Mes</p>
                      <p className="text-white text-xs font-semibold mt-1">Corte: 31 Jul • En Curso</p>
                    </div>
                    <div className="bg-[#ffd97d]/10 text-[#ffd97d] text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border border-[#ffd97d]/20">
                      Private Referrer
                    </div>
                  </div>

                  <div className="pt-5 grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider block">Volumen Vinculado</span>
                      <h3 className="text-xl font-black text-white">
                        ${stats?.totalUsdOperatedMonth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'} <span className="text-[10px] text-gray-500">USD</span>
                      </h3>
                    </div>

                    <div className="space-y-1 border-l border-white/5 pl-4">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider block">Comisión</span>
                        <span className="bg-emerald-500/10 text-emerald-400 text-[8px] font-bold px-1.5 py-0.5 rounded">ESTIMADO</span>
                      </div>
                      <h3 className="text-xl font-black text-[#22c55e]">
                        ${stats?.totalCommissionMxn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'} <span className="text-[10px] text-gray-500">MXN</span>
                      </h3>
                    </div>
                  </div>
                </div>

                {/* Daily Tabulator / Rate Card */}
                <div className="bg-[#11141e] border border-[#232936] rounded-3xl p-5 space-y-4 shadow-xl">
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <div className="flex items-center gap-2">
                      <Percent className="text-[#d4af37]" size={16} />
                      <h3 className="text-xs font-black text-white uppercase tracking-wider">Tabulador Diario Autorizado</h3>
                    </div>
                    <span className="text-[9px] text-gray-500 font-bold">EVENTOS INDIVIDUALES</span>
                  </div>

                  <div className="space-y-2 text-xs font-semibold">
                    <div className="bg-black/30 p-3 rounded-xl flex items-center justify-between border border-white/5">
                      <span className="text-gray-400">Tickets de $100 a $300 USD</span>
                      <span className="text-[#ffd97d] font-bold">$0.10 MXN / Dólar</span>
                    </div>
                    <div className="bg-black/30 p-3 rounded-xl flex items-center justify-between border border-white/5">
                      <span className="text-gray-400">Tickets de $301 a $999 USD</span>
                      <span className="text-[#ffd97d] font-bold">$0.15 MXN / Dólar</span>
                    </div>
                    <div className="bg-[#ffd97d]/5 p-3 rounded-xl flex items-center justify-between border border-[#ffd97d]/20 relative overflow-hidden">
                      <span className="text-[#ffd97d] font-bold flex items-center gap-1.5">
                        <Sparkles size={12} className="animate-pulse" />
                        Tickets ≥ $1,000 USD (Regla de Oro)
                      </span>
                      <span className="text-emerald-400 font-black">$0.20 MXN / Dólar</span>
                    </div>
                  </div>
                </div>

                {/* Floating style Button to Create Ticket */}
                <button 
                  onClick={() => {
                    setShowNewTicketModal(true);
                    setTicketStep('form');
                    setNewAmount('');
                    setNewCustomer('');
                    setFormError('');
                  }}
                  className="w-full bg-gradient-to-r from-[#d4af37] to-[#c39b54] text-black hover:brightness-110 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-[0.98] shadow-lg shadow-[#d4af37]/10 flex items-center justify-center gap-2"
                >
                  <Plus size={16} strokeWidth={3} />
                  PRE-REGISTRAR NUEVA OPERACIÓN
                </button>
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">
                    Rendimiento Directo (Últimos 100)
                  </h3>
                  <span className="text-[9px] text-emerald-400 font-bold uppercase">
                    Comisiones por Evento
                  </span>
                </div>

                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {stats && stats.tickets.length > 0 ? (
                    stats.tickets.map(t => {
                      const isPending = t.status === 'PENDIENTE';
                      const isLiquidated = t.status === 'LIQUIDADO';
                      const isCanceled = t.status === 'CANCELADO';
                      
                      let statusColor = 'border-amber-500/20 text-amber-400 bg-amber-500/5';
                      let statusLabel = 'Pendiente';
                      if (isLiquidated) {
                        statusColor = 'border-emerald-500/20 text-emerald-400 bg-emerald-500/5';
                        statusLabel = 'Dinero Ganado (Liquidado)';
                      } else if (isCanceled) {
                        statusColor = 'border-red-500/20 text-red-400 bg-red-500/5';
                        statusLabel = 'Cancelado';
                      }

                      return (
                        <div 
                          key={t.ticket_code}
                          className="bg-[#11141e] border border-[#232936] rounded-2xl p-4 flex items-center justify-between shadow-md transition-all hover:border-gray-800"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-white text-xs font-black tracking-wider">
                                {t.ticket_code}
                              </span>
                              <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${statusColor}`}>
                                {statusLabel}
                              </span>
                            </div>
                            <div className="text-[10px] text-gray-400 space-y-0.5 font-medium">
                              <p className="text-white/90 font-bold">{t.customer_name}</p>
                              <p className="text-gray-500 flex items-center gap-1 text-[9px]">
                                <Clock size={10} />
                                {new Date(t.created_at).toLocaleDateString()} • {new Date(t.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                              </p>
                            </div>
                          </div>

                          <div className="text-right space-y-1.5">
                            <p className="text-white text-xs font-bold">${t.amount_usd} USD</p>
                            <p className={`text-xs font-black ${isLiquidated ? 'text-emerald-400' : 'text-gray-500'}`}>
                              +${t.estimated_commission_mxn.toFixed(2)} MXN
                            </p>
                            <p className="text-[9px] text-gray-500 font-bold">
                              Tasa: ${t.estimated_rate}/USD
                            </p>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="bg-[#11141e] border border-dashed border-[#232936] rounded-2xl p-10 text-center text-gray-500 text-sm">
                      No hay operaciones pre-registradas.
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'wholesale' && stats?.partner.is_wholesale && (
              <motion.div 
                key="wholesale"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Wholesale sub navigation */}
                <div className="flex border-b border-[#232936] pb-1 gap-4">
                  <button 
                    onClick={() => setWholesaleSection('corte')}
                    className={`pb-2 text-xs font-bold uppercase tracking-wider transition-colors ${wholesaleSection === 'corte' ? 'text-[#ffd97d] border-b-2 border-[#ffd97d]' : 'text-gray-500 hover:text-white'}`}
                  >
                    Corte Diario
                  </button>
                  <button 
                    onClick={() => setWholesaleSection('vault')}
                    className={`pb-2 text-xs font-bold uppercase tracking-wider transition-colors ${wholesaleSection === 'vault' ? 'text-[#ffd97d] border-b-2 border-[#ffd97d]' : 'text-gray-500 hover:text-white'}`}
                  >
                    Vault Recolección
                  </button>
                  <button 
                    onClick={() => setWholesaleSection('tasa_red')}
                    className={`pb-2 text-xs font-bold uppercase tracking-wider transition-colors ${wholesaleSection === 'tasa_red' ? 'text-[#ffd97d] border-b-2 border-[#ffd97d]' : 'text-gray-500 hover:text-white'}`}
                  >
                    Tasa de Red
                  </button>
                </div>

                {/* Subsections */}
                <AnimatePresence mode="wait">
                  {wholesaleSection === 'corte' && (
                    <motion.div 
                      key="corte"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-5"
                    >
                      <div className="bg-[#11141e] border border-[#232936] rounded-2xl p-5 space-y-4">
                        <div className="border-b border-white/5 pb-2">
                          <h4 className="text-xs font-bold text-white uppercase tracking-wider">Corte del Comercio (Consolidado)</h4>
                          <p className="text-[10px] text-gray-500 mt-0.5">Liquida el saldo acumulado de transacciones minoristas de tu negocio de una sola vez.</p>
                        </div>

                        <form onSubmit={handleSubmitCorte} className="space-y-4">
                          <div className="space-y-1">
                            <label className="text-[10px] text-gray-500 font-bold uppercase">Acumulado a Liquidar (USD)</label>
                            <div className="relative">
                              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#ffd97d]" />
                              <input 
                                required
                                type="number"
                                placeholder="0.00"
                                min="1"
                                step="0.01"
                                value={corteAmountUsd}
                                onChange={e => setCorteAmountUsd(e.target.value)}
                                className="w-full bg-black/50 border border-[#232936] rounded-xl py-3 pl-9 pr-4 text-white text-sm font-bold focus:border-[#d4af37] outline-none"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3 bg-black/40 p-3 rounded-xl border border-white/5 text-[11px]">
                            <div>
                              <p className="text-gray-500">Tasa de Comercio</p>
                              <p className="text-white font-bold">$0.20 MXN / USD</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Comisión Estimada</p>
                              <p className="text-emerald-400 font-black">
                                ${(parseFloat(corteAmountUsd || '0') * 0.20).toFixed(2)} MXN
                              </p>
                            </div>
                          </div>

                          {corteMessage && (
                            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-[11px] font-bold">
                              {corteMessage}
                            </div>
                          )}

                          <button 
                            type="submit"
                            disabled={corteSubmitting || !corteAmountUsd}
                            className="w-full bg-white/5 hover:bg-white/10 text-[#ffd97d] border border-white/10 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
                          >
                            {corteSubmitting ? "PROCESANDO..." : "REGISTRAR CORTE CONSOLIDADO"}
                          </button>
                        </form>
                      </div>

                      {/* Cortes History */}
                      <div className="space-y-2">
                        <h5 className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Historial de Cortes de Comercio</h5>
                        {stats?.cortes && stats.cortes.length > 0 ? (
                          stats.cortes.map(c => (
                            <div key={c.id} className="bg-black/30 border border-[#232936] rounded-xl p-3 flex items-center justify-between text-xs font-semibold">
                              <div className="space-y-1">
                                <p className="text-white">ID Corte #{c.id}</p>
                                <p className="text-[9px] text-gray-500">{new Date(c.created_at).toLocaleDateString()}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-[#ffd97d] font-bold">${c.amount_usd} USD</p>
                                <p className="text-emerald-400 text-[10px] font-bold">+${c.commission_mxn} MXN</p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-[10px] text-gray-600 text-center font-bold">Sin cortes registrados este mes.</p>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {wholesaleSection === 'vault' && (
                    <motion.div 
                      key="vault"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-5"
                    >
                      <div className="bg-[#11141e] border border-[#232936] rounded-2xl p-5 space-y-4">
                        <div className="border-b border-white/5 pb-2">
                          <h4 className="text-xs font-bold text-white uppercase tracking-wider">Vault-as-a-Service (Recolección)</h4>
                          <p className="text-[10px] text-gray-500 mt-0.5">Declara efectivo sellado y solicita la recolección física con unidad blindada directamente a tu negocio.</p>
                        </div>

                        <form onSubmit={handleSubmitVaultRequest} className="space-y-4">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[9px] text-gray-500 font-bold uppercase">Bultos / Bolsas</label>
                              <select 
                                value={vaultPackages} 
                                onChange={e => setVaultPackages(e.target.value)}
                                className="w-full bg-black/50 border border-[#232936] rounded-xl py-3 px-3 text-white text-xs font-bold outline-none"
                              >
                                <option value="1">1 Bulto</option>
                                <option value="2">2 Bultos</option>
                                <option value="3">3 Bultos</option>
                                <option value="4">4+ Bultos</option>
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[9px] text-gray-500 font-bold uppercase">Sello de Seguridad</label>
                              <input 
                                type="text"
                                placeholder="Sello # (Ej: SL-889)"
                                value={vaultSeals}
                                onChange={e => setVaultSeals(e.target.value.toUpperCase())}
                                className="w-full bg-black/50 border border-[#232936] rounded-xl py-3 px-3 text-white text-xs font-bold outline-none uppercase"
                              />
                            </div>
                          </div>

                          {/* Bag Image Upload */}
                          <div className="space-y-1.5">
                            <label className="text-[9px] text-gray-500 font-bold uppercase">Evidencia Fotográfica de la Bolsa Sellada</label>
                            
                            <div className="border-2 border-dashed border-[#232936] rounded-xl p-4 flex flex-col items-center justify-center text-center space-y-2 bg-black/20">
                              {vaultPhoto ? (
                                <div className="space-y-2 w-full">
                                  <img src={vaultPhoto} alt="Bolsa de valores" className="h-24 w-auto mx-auto rounded-lg object-cover" />
                                  <button 
                                    type="button"
                                    onClick={() => setVaultPhoto(null)}
                                    className="text-[9px] text-red-400 font-bold uppercase"
                                  >
                                    Eliminar Foto
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <Camera size={24} className="text-gray-500" />
                                  <div className="space-y-1">
                                    <p className="text-[10px] text-gray-400 font-bold">Carga la foto del bulto</p>
                                    <p className="text-[9px] text-gray-600">Soporta JPG, PNG sellado</p>
                                  </div>
                                  <button 
                                    type="button" 
                                    onClick={handleSimulatedPhotoUpload}
                                    className="bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg text-[9px] text-white font-bold"
                                  >
                                    Capturar Foto de Bolsa
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {vaultMessage && (
                            <div className="p-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-[#ffd97d] text-[10px] font-bold flex items-start gap-2">
                              <Truck size={14} className="shrink-0 mt-0.5" />
                              <span>{vaultMessage}</span>
                            </div>
                          )}

                          <button 
                            type="submit"
                            disabled={vaultSubmitting}
                            className="w-full bg-[#ffd97d] hover:bg-[#c39b54] text-black py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-colors"
                          >
                            {vaultSubmitting ? "RESERVANDO BLINDADO..." : "SOLICITAR RECOLECCIÓN DE VALORES"}
                          </button>
                        </form>
                      </div>

                      {/* Recolecciones History */}
                      <div className="space-y-2">
                        <h5 className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Monitoreo de Blindados en Tránsito</h5>
                        {stats?.recolecciones && stats.recolecciones.length > 0 ? (
                          stats.recolecciones.map(r => (
                            <div key={r.id} className="bg-black/30 border border-[#232936] rounded-xl p-3 flex items-center justify-between text-xs font-semibold">
                              <div className="flex items-center gap-3">
                                <Truck size={18} className="text-[#ffd97d]" />
                                <div className="space-y-0.5">
                                  <p className="text-white">Recolección #{r.id} ({r.packages_count} Bulto)</p>
                                  <p className="text-[9px] text-gray-500">Sello: {r.safety_seals}</p>
                                </div>
                              </div>
                              <span className="bg-yellow-500/15 border border-yellow-500/30 text-[#ffd97d] text-[9px] font-black uppercase px-2 py-0.5 rounded-full">
                                {r.status}
                              </span>
                            </div>
                          ))
                        ) : (
                          <p className="text-[10px] text-gray-600 text-center font-bold">No hay recolecciones activas.</p>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {wholesaleSection === 'tasa_red' && (
                    <motion.div 
                      key="tasa_red"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="bg-[#11141e] border border-[#232936] rounded-2xl p-5 space-y-4"
                    >
                      <div className="border-b border-white/5 pb-2">
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">Pactar Tasa de Red (Privado)</h4>
                        <p className="text-[10px] text-gray-500 mt-0.5">Bloquea un tipo de cambio preferencial oculto de la pizarra del lobby para tus transacciones mayoristas de red.</p>
                      </div>

                      <div className="space-y-4 font-semibold text-xs text-white">
                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase block">Importe Estimado a Transaccionar</label>
                          <div className="flex bg-black/40 rounded-xl border border-white/5">
                            <input 
                              type="number"
                              value={negotiatedRateAmount}
                              onChange={e => setNegotiatedRateAmount(e.target.value)}
                              className="w-full bg-transparent border-none outline-none px-3.5 py-3 text-sm font-bold"
                            />
                            <span className="flex items-center px-4 text-gray-500 text-[11px] font-bold">USD</span>
                          </div>
                        </div>

                        {/* Automatic wholesale rate improvement visualizer */}
                        <div className="bg-black/30 p-4 rounded-xl border border-[#ffd97d]/15 space-y-3">
                          <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-gray-500">
                            <span>Tipo de Cambio Lobby</span>
                            <span>Tipo Mayorista Pactado</span>
                          </div>
                          
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400 font-bold">${baseStandardRate.toFixed(2)} MXN</span>
                            <span className="text-emerald-400 font-black text-base">${customWholesaleRate.toFixed(2)} MXN</span>
                          </div>

                          <div className="bg-[#ffd97d]/5 p-2 rounded-lg text-[#ffd97d] text-[9px] font-bold text-center border border-[#ffd97d]/10">
                            Mejora por volumen mayorista de +${wholesaleBonus.toFixed(2)} MXN aplicada.
                          </div>
                        </div>

                        {negotiationSuccess && (
                          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-[10px] font-bold flex items-center gap-1.5">
                            <CheckCircle size={14} />
                            <span>¡Tasa preferencial congelada por 45 minutos! Folio: PACTO-{Math.floor(1000 + Math.random() * 9000)}</span>
                          </div>
                        )}

                        <button 
                          onClick={() => {
                            setNegotiationSuccess(true);
                            setTimeout(() => setNegotiationSuccess(false), 4000);
                          }}
                          className="w-full bg-[#ffd97d] hover:bg-[#c39b54] text-black py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-colors"
                        >
                          CONGELAR TASA DE RED
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

          {/* New Ticket Modal */}
          <AnimatePresence>
            {showNewTicketModal && (
              <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <motion.div 
                  initial={{ scale: 0.95, y: 15 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.95, y: 15 }}
                  className="bg-[#11141e] border border-[#232936] rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-5"
                >
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">Registrar Pre-captura</h3>
                    <button 
                      onClick={() => {
                        setShowNewTicketModal(false);
                        setTicketStep('form');
                        setNewAmount('');
                        setNewCustomer('');
                        setNewTicketCode('');
                        setFormError('');
                      }}
                      className="p-1 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {ticketStep === 'form' ? (
                    <form onSubmit={handleCreateTicket} className="space-y-4">
                      {/* Amount USD */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-bold text-gray-500 uppercase">Monto en USD</label>
                          <span className="text-[9px] text-[#ffd97d] font-bold uppercase">Dólares</span>
                        </div>
                        <div className="relative">
                          <DollarSign size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#ffd97d]" />
                          <input 
                            required
                            type="number"
                            placeholder="0.00"
                            min="10"
                            step="0.01"
                            value={newAmount}
                            onChange={e => setNewAmount(e.target.value)}
                            className="w-full bg-black/40 border border-[#232936] rounded-xl py-3 pl-9 pr-4 text-white text-sm font-bold focus:border-[#d4af37] outline-none placeholder:text-gray-700"
                          />
                        </div>

                        {/* Interactive dynamic threshold alert */}
                        <AnimatePresence>
                          {dynamicWarning && (
                            <motion.div 
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="p-2.5 bg-[#ffd97d]/5 border border-[#ffd97d]/15 text-[#ffd97d] rounded-xl text-[10px] font-bold flex items-center gap-1.5 overflow-hidden shadow-lg"
                            >
                              <Sparkles size={12} className="text-[#ffd97d] shrink-0 animate-pulse" />
                              <span>{dynamicWarning}</span>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Customer Name */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Nombre del Cliente</label>
                        <div className="relative">
                          <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#ffd97d]" />
                          <input 
                            required
                            type="text"
                            placeholder="Nombre y Apellido"
                            value={newCustomer}
                            onChange={e => setNewCustomer(e.target.value.toUpperCase())}
                            className="w-full bg-black/40 border border-[#232936] rounded-xl py-3 pl-9 pr-4 text-white text-sm font-bold focus:border-[#d4af37] outline-none placeholder:text-gray-700 uppercase"
                          />
                        </div>
                      </div>

                      {formError && (
                        <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-[10px] font-bold">
                          {formError}
                        </div>
                      )}

                      <button 
                        type="submit"
                        disabled={formLoading}
                        className="w-full bg-[#d4af37] hover:bg-[#c39b54] text-black py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
                      >
                        {formLoading ? "PROCESANDO..." : "GENERAR TICKET CON QR"}
                      </button>
                    </form>
                  ) : (
                    <div className="space-y-5 text-center py-2">
                      <div className="w-12 h-12 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto text-emerald-400 border border-emerald-500/20">
                        <Check size={24} />
                      </div>

                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-white">¡Operación Pre-registrada!</h4>
                        <p className="text-gray-500 text-[11px]">Muestra el QR en ventanilla para proceder a liquidación física.</p>
                      </div>

                      <div className="bg-black/55 p-5 rounded-2xl border border-white/5 space-y-3">
                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Folio de Referido</p>
                        <p className="text-2xl font-black text-[#ffd97d] tracking-widest">{newTicketCode}</p>

                        <div className="flex justify-center bg-white p-3 rounded-xl max-w-[140px] mx-auto border border-white/10">
                          <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(`${window.location.origin}/?tab=public-capture&ref=${newTicketCode}`)}`}
                            alt="QR Referido"
                            className="w-24 h-24"
                          />
                        </div>
                      </div>

                      {/* Compartir QR por WhatsApp — abre wa.me con mensaje pre-llenado */}
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(`¡Únete a SICC Banca Privada! 🏦 Operar con nosotros es seguro y rápido. Ingresa con mi código de referido y comienza a generar comisiones. Enlace directo: ${window.location.origin}/?tab=public-capture&ref=${newTicketCode}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full bg-[#25D366] hover:bg-[#1ebe57] text-white py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                      >
                        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                        Compartir QR por WhatsApp
                      </a>

                      <button
                        onClick={() => {
                          setTicketStep('form');
                          setNewAmount('');
                          setNewCustomer('');
                        }}
                        className="w-full bg-white/5 hover:bg-white/10 text-white border border-white/5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider"
                      >
                        Generar Otro Ticket
                      </button>
                    </div>
                  )}
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Persistent Floating Bottom Action for Zero-Friction Ticket Generation */}
          <div className="fixed bottom-0 inset-x-0 bg-gradient-to-t from-[#090b11] via-[#090b11]/95 to-transparent p-4 pb-6 z-40 max-w-md mx-auto">
            <button 
              onClick={() => {
                setShowNewTicketModal(true);
                setTicketStep('form');
                setNewAmount('');
                setNewCustomer('');
                setFormError('');
              }}
              className="w-full bg-gradient-to-r from-[#d4af37] to-[#c39b54] hover:brightness-110 text-black py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-[0.98] shadow-2xl shadow-[#d4af37]/15 flex items-center justify-center gap-2 border border-[#ffd97d]/30"
            >
              <Plus size={16} strokeWidth={3} />
              PRE-REGISTRAR NUEVA OPERACIÓN
            </button>
          </div>

          {/* Footer stats metadata */}
          <footer className="text-center space-y-1.5 pt-4">
            <p className="text-[9px] text-gray-600 font-bold uppercase tracking-widest">
              SISTEMA DE SEGURIDAD BIOMÉTRICA CONECTADO
            </p>
            <p className="text-[8px] text-gray-700 font-semibold">
              Desarrollado para Centros Cambiarios de Banca Privada • Versión 4.2
            </p>
          </footer>
        </div>
      )}

      {/* Outer bottom info if completely authenticated and unlocked */}
      {authenticatedPartner && isUnlocked && (
        <div className="bg-black/40 border-t border-white/5 py-2.5 text-center text-[9px] text-gray-500 font-bold uppercase tracking-wider">
          Token de Enlace: {authenticatedPartner.partner_code}
        </div>
      )}
    </div>
  );
}
