import { useState, useEffect, useMemo, FormEvent } from "react";
import { 
  User, 
  ArrowLeftRight, 
  DollarSign, 
  TrendingUp, 
  CheckCircle2, 
  Receipt, 
  Calculator,
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Coins,
  Search,
  UserPlus,
  Info,
  ShieldCheck,
  QrCode,
  X,
  Clock,
  Upload,
  FileText,
  Plus,
  Minus,
  Building
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../contexts/AuthContext";
import { RoleLevel } from "../types/auth";
import QuickRegisterModal from "../components/QuickRegisterModal";
import ShiftOpeningCount from "../components/ShiftOpeningCount";
import CorteCajaModal from "../components/CorteCajaModal";
import { EmergencyDotationModal } from "../components/EmergencyDotationModal";

interface Rate {
  buy: number;
  sell: number;
  timestamp: string;
}

interface RatesResponse {
  status: string;
  rates: Record<string, Rate>;
}

interface Currency {
  code: string;
  name: string;
  symbol: string;
  flag: string;
}

interface Customer {
  id: string;
  full_name: string;
  risk_level: string;
  client_type?: "PHYSICAL" | "MORAL";
  isB2B?: boolean;
  email?: string;
  phone?: string;
  isVIP?: boolean;
  walletBalance?: {
    MXN: number;
    USD: number;
    USDT: number;
  };
}

interface TransferDetails {
  bankName: string;
  accountNumber: string;
  holderName: string;
  date: string;
  trackingId: string;
  txid: string;
}

const initialTransferDetails: TransferDetails = {
  bankName: "",
  accountNumber: "",
  holderName: "",
  date: new Date().toISOString().split('T')[0],
  trackingId: "",
  txid: ""
};

const CURRENCIES: Currency[] = [
  { code: "MXN", name: "Peso Mexicano", symbol: "$", flag: "🇲🇽" },
  { code: "USD", name: "Dólar Americano", symbol: "$", flag: "🇺🇸" },
  { code: "EUR", name: "Euro", symbol: "€", flag: "🇪🇺" },
  { code: "GBP", name: "Libra Esterlina", symbol: "£", flag: "🇬🇧" },
  { code: "CAD", name: "Dólar Canadiense", symbol: "$", flag: "🇨🇦" },
  { code: "USDT", name: "Tether (Crypto)", symbol: "₮", flag: "🟢" },
];

export default function FXTrader() {
  const [shiftStatus, setShiftStatus] = useState<string | null>(null);
  const [activeShift, setActiveShift] = useState<any | null>(null);
  const [isShiftChecking, setIsShiftChecking] = useState(true);

  // --- MONITOREO DE SALDOS Y SEGURIDAD FINANCIERA ---
  const [terminalStatus, setTerminalStatus] = useState<any>(null);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [lastWarningCount, setLastWarningCount] = useState(0);
  const [showRetiroModal, setShowRetiroModal] = useState(false);
  const [showCorteModal, setShowCorteModal] = useState(false);

  // Formulario de Retiro de Caja
  const [retiroCurrency, setRetiroCurrency] = useState("USD");
  const [retiroAmount, setRetiroAmount] = useState("");
  const [isRetiroProcessing, setIsRetiroProcessing] = useState(false);
  const [retiroMessage, setRetiroMessage] = useState<string | null>(null);

  const fetchTerminalStatus = async () => {
    try {
      const userId = localStorage.getItem("mock_user_id") || "user_cajero_1";
      const res = await fetch("/api/terminal/status", {
        headers: { "x-user-id": userId }
      });
      if (res.ok) {
        const data = await res.json();
        setTerminalStatus(data);
        if (data.exceeded && data.warningCount > 0) {
          if (data.warningCount > lastWarningCount) {
            setShowWarningModal(true);
            setLastWarningCount(data.warningCount);
          }
        } else {
          setLastWarningCount(0);
          setShowWarningModal(false);
        }
      }
    } catch (e) {
      console.error("Error fetching terminal status:", e);
    }
  };

  const handleRetiroSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!retiroCurrency || !retiroAmount || parseFloat(retiroAmount) <= 0) return;
    setIsRetiroProcessing(true);
    setRetiroMessage(null);
    try {
      const userId = localStorage.getItem("mock_user_id") || "user_cajero_1";
      const res = await fetch("/api/transactions/retiro", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": userId
        },
        body: JSON.stringify({
          currency: retiroCurrency,
          amount: parseFloat(retiroAmount)
        })
      });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        setRetiroMessage(`Retiro exitoso. ${parseFloat(retiroAmount).toLocaleString()} ${retiroCurrency} transferidos a Bóveda.`);
        setRetiroAmount("");
        // Refresh terminal status right away
        await fetchTerminalStatus();
        setTimeout(() => {
          setShowRetiroModal(false);
          setRetiroMessage(null);
        }, 3000);
      } else {
        setRetiroMessage(`Error: ${data.message}`);
      }
    } catch (e: any) {
      setRetiroMessage(`Error de red: ${e.message}`);
    } finally {
      setIsRetiroProcessing(false);
    }
  };

  useEffect(() => {
    fetchTerminalStatus();
    const interval = setInterval(fetchTerminalStatus, 8000); // Poll every 8 seconds
    return () => clearInterval(interval);
  }, [lastWarningCount]);

  useEffect(() => {
    const checkShift = async () => {
      try {
        const userId = localStorage.getItem("mock_user_id") || "user_cajero_1";
        const res = await fetch("/api/shifts/status", {
          headers: { "x-user-id": userId }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.shift && data.shift.status !== "CLOSED") {
            setShiftStatus(data.shift.status);
            setActiveShift(data.shift);
          } else {
            setShiftStatus(null);
            setActiveShift(null);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsShiftChecking(false);
      }
    };
    checkShift();
  }, []);

  const [customerSearch, setCustomerSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showQuickRegister, setShowQuickRegister] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const [currencyIn, setCurrencyIn] = useState<Currency>(CURRENCIES.find(c => c.code === "USD") || CURRENCIES[1]);
  const [currencyOut, setCurrencyOut] = useState<Currency>(CURRENCIES.find(c => c.code === "MXN") || CURRENCIES[0]);
  const [methodIn, setMethodIn] = useState<"CASH" | "TRANSFER">("CASH");
  const [methodOut, setMethodOut] = useState<"CASH" | "TRANSFER">("CASH");
  const [amountIn, setAmountIn] = useState<string>("");
  
  const [markup, setMarkup] = useState(0);
  const [liveRates, setLiveRates] = useState<Record<string, Rate>>({});
  const [isLoadingRates, setIsLoadingRates] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showReceipt, setShowReceipt] = useState<any>(null);

  // BaaS / VIP States
  const [baasMode, setBaasMode] = useState<"NONE" | "ON_RAMP" | "OFF_RAMP">("NONE");

  // Symmetric Transfer States
  const [incomingTransferDetails, setIncomingTransferDetails] = useState<TransferDetails>(initialTransferDetails);
  const [incomingFile, setIncomingFile] = useState<File | null>(null);
  
  const [outgoingTransferDetails, setOutgoingTransferDetails] = useState<TransferDetails>(initialTransferDetails);
  const [outgoingFile, setOutgoingFile] = useState<File | null>(null);

  // Denominations States
  const [denominationsIn, setDenominationsIn] = useState<Record<number, number>>({});
  const [denominationsOut, setDenominationsOut] = useState<Record<number, number>>({});
  const [denomsConfig, setDenomsConfig] = useState<Record<string, any[]>>({});
  const [showDenomsModal, setShowDenomsModal] = useState<"IN" | "OUT" | null>(null);

  // Compliance & Supervisor States
  const { profile, token } = useAuth();
  const [partnerId, setPartnerId] = useState("");
  const [ticketCode, setTicketCode] = useState("");
  const [isValidatingTicket, setIsValidatingTicket] = useState(false);
  const [isTicketValidated, setIsTicketValidated] = useState(false);
  const [supervisorKey, setSupervisorKey] = useState("");
  const [complianceLevel, setComplianceLevel] = useState<0 | 1 | 2 | 3>(0);
  const [showComplianceAlert, setShowComplianceAlert] = useState(false);

  // New CNBV / AML Blacklist and Remote Authorization States
  const [blacklistMatches, setBlacklistMatches] = useState<any[]>([]);
  const [blacklistRiskLevel, setBlacklistRiskLevel] = useState<"ROJO" | "AMARILLO" | "VERDE">("VERDE");
  const [blacklistLoading, setBlacklistLoading] = useState(false);

  const [authRequestStatus, setAuthRequestStatus] = useState<"IDLE" | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "USED">("IDLE");
  const [authRequestId, setAuthRequestId] = useState("");
  const [authApprovedCode, setAuthApprovedCode] = useState("");

  // KYC Complete Fields for Operations >= 5,000 USD
  const [kycPhone, setKycPhone] = useState("");
  const [kycOccupation, setKycOccupation] = useState("");
  const [kycBusinessActivity, setKycBusinessActivity] = useState("");
  const [kycIdUploaded, setKycIdUploaded] = useState(false);
  const [kycAddressUploaded, setKycAddressUploaded] = useState(false);

  // --- INTEGRACIÓN DE ALIADOS Y OCR ---
  const [isOcrCompleted, setIsOcrCompleted] = useState(false);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [showProcessedTicketError, setShowProcessedTicketError] = useState(false);
  const [processedTicketErrorMsg, setProcessedTicketErrorMsg] = useState("");
  const [showDotationModal, setShowDotationModal] = useState(false);

  // Function to fetch a pending ticket reactively
  const fetchPendingTicket = async (code: string) => {
    if (!code || !code.startsWith('TICKET-') || code.length < 11) return;
    setIsValidatingTicket(true);
    try {
      const res = await fetch(`/api/partners/tickets/${code}`);
      if (res.ok) {
        const ticket = await res.json();
        setAmountIn(ticket.amount_usd.toString());
        setPartnerId(ticket.partner_id);
        setIsTicketValidated(true);
        // Pre-set related fields
        setCurrencyIn({ code: 'USD', name: 'Dólar Americano', symbol: '$', flag: "🇺🇸" });
        setCurrencyOut({ code: 'MXN', name: 'Peso Mexicano', symbol: '$', flag: "🇲🇽" });
        
        // Auto-match Customer or set a temporary one
        if (ticket.customer_name) {
          try {
            const kycRes = await fetch(`/api/kyc/search?q=${encodeURIComponent(ticket.customer_name)}`);
            if (kycRes.ok) {
              const kycData = await kycRes.json();
              if (kycData && kycData.length > 0) {
                setSelectedCustomer(kycData[0]);
              } else {
                setSelectedCustomer({
                  id: 'C_AFFILIATE',
                  full_name: ticket.customer_name,
                  risk_level: 'VERDE',
                  client_type: 'PHYSICAL'
                });
              }
            } else {
              setSelectedCustomer({
                id: 'C_AFFILIATE',
                full_name: ticket.customer_name,
                risk_level: 'VERDE',
                client_type: 'PHYSICAL'
              });
            }
          } catch (err) {
            setSelectedCustomer({
              id: 'C_AFFILIATE',
              full_name: ticket.customer_name,
              risk_level: 'VERDE',
              client_type: 'PHYSICAL'
            });
          }
        }
      } else {
        setIsTicketValidated(false);
        const data = await res.json().catch(() => ({}));
        if (data.error === 'TICKET_ALREADY_PROCESSED') {
          setProcessedTicketErrorMsg("TICKET YA PROCESADO");
          setShowProcessedTicketError(true);
          setTicketCode("");
        }
      }
    } catch (e) {
      console.error("Error fetching pending ticket:", e);
      setIsTicketValidated(false);
    }
    setIsValidatingTicket(false);
  };

  // Logic to Validate Affiliate Ticket
  const validateTicket = async () => {
    if (!ticketCode.startsWith('TICKET-')) return;
    setIsValidatingTicket(true);
    try {
      const res = await fetch(`/api/partners/tickets/${ticketCode}`);
      if (res.ok) {
        const ticket = await res.json();
        setAmountIn(ticket.amount_usd.toString());
        setPartnerId(ticket.partner_id);
        setIsTicketValidated(true);
        // Pre-set related fields
        setCurrencyIn({ code: 'USD', name: 'Dólar Americano', symbol: '$', flag: "🇺🇸" });
        setCurrencyOut({ code: 'MXN', name: 'Peso Mexicano', symbol: '$', flag: "🇲🇽" });
        
        // Auto-match Customer or set a temporary one
        if (ticket.customer_name) {
          try {
            const kycRes = await fetch(`/api/kyc/search?q=${encodeURIComponent(ticket.customer_name)}`);
            if (kycRes.ok) {
              const kycData = await kycRes.json();
              if (kycData && kycData.length > 0) {
                setSelectedCustomer(kycData[0]);
              } else {
                setSelectedCustomer({
                  id: 'C_AFFILIATE',
                  full_name: ticket.customer_name,
                  risk_level: 'VERDE',
                  client_type: 'PHYSICAL'
                });
              }
            } else {
              setSelectedCustomer({
                id: 'C_AFFILIATE',
                full_name: ticket.customer_name,
                risk_level: 'VERDE',
                client_type: 'PHYSICAL'
              });
            }
          } catch (err) {
            setSelectedCustomer({
              id: 'C_AFFILIATE',
              full_name: ticket.customer_name,
              risk_level: 'VERDE',
              client_type: 'PHYSICAL'
            });
          }
        }
        alert(`Ticket de Captación Validado: ${ticket.partner_name} (${ticket.amount_usd} USD)`);
      } else {
        setIsTicketValidated(false);
        const data = await res.json().catch(() => ({}));
        if (data.error === 'TICKET_ALREADY_PROCESSED') {
          setProcessedTicketErrorMsg("TICKET YA PROCESADO");
          setShowProcessedTicketError(true);
          setTicketCode("");
        } else {
          alert(data.message || "Ticket no encontrado, expirado o ya liquidado.");
          setTicketCode("");
        }
      }
    } catch (e) { 
      console.error(e); 
      setIsTicketValidated(false);
    }
    setIsValidatingTicket(false);
  };

  // Run a high-performance simulation of the automated OCR KYC document parser
  const runOcrSimulation = () => {
    setIsOcrProcessing(true);
    setTimeout(() => {
      setIsOcrProcessing(false);
      setIsOcrCompleted(true);
      setKycIdUploaded(true);
      alert(`✅ AUTOMATED OCR PROCESS COMPLETED\nDocumento Identificado: INE (Identificación Oficial)\nCliente: ${selectedCustomer?.full_name || "Asociado de Ticket"}\nIdentidad verificada exitosamente.`);
    }, 1500);
  };

  // Reactive detection of TICKET Code entry
  useEffect(() => {
    const formatted = ticketCode.trim().toUpperCase();
    if (formatted.match(/^TICKET-\d{4}$/)) {
      fetchPendingTicket(formatted);
    } else if (formatted === "") {
      setIsTicketValidated(false);
    }
  }, [ticketCode]);

  // Customer Search Logic (Debounce) + COMPLIANCE CHECK EN VIVO
  useEffect(() => {
    if (customerSearch.length < 3) {
      setSearchResults([]);
      setBlacklistMatches([]);
      setBlacklistRiskLevel("VERDE");
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        // 1. Buscar clientes existentes
        const res = await fetch(`/api/kyc/search?q=${encodeURIComponent(customerSearch)}`);
        const data = await res.json();
        if (data.status === "success") {
          setSearchResults(data.data);
        }

        // 2. COMPLIANCE EN VIVO: verificar listas OFAC/PEP mientras escribe
        setBlacklistLoading(true);
        try {
          const complianceRes = await fetch(`/api/compliance/search-lists?q=${encodeURIComponent(customerSearch)}`);
          if (complianceRes.ok) {
            const complianceData = await complianceRes.json();
            setBlacklistMatches(complianceData.data?.matches || []);
            setBlacklistRiskLevel(complianceData.data?.riskLevel || "VERDE");
          }
        } catch (err) {
          console.error("Compliance live check error:", err);
        } finally {
          setBlacklistLoading(false);
        }
      } catch (error) {
        console.error("Error searching customers:", error);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [customerSearch]);

  // Cross-Currency Calculation Logic
  const { checkCustomPermission } = useAuth();
  const tcLimit = checkCustomPermission('tc_limit') || 2.5;

  const calculation = useMemo(() => {
    if (!currencyIn || !currencyOut) return { rate: 0, amountOut: 0, markupAmount: 0, finalTotal: 0, isLimitExceeded: false };
    
    const rateInData = liveRates[`${currencyIn.code}_MXN`];
    const rateOutData = liveRates[`${currencyOut.code}_MXN`];
    
    if (!rateInData || !rateOutData) return { rate: 0, amountOut: 0, markupAmount: 0, finalTotal: 0, isLimitExceeded: false };

    const rateIn = rateInData.buy;
    const rateOut = rateOutData.sell;
    const crossRate = rateIn / rateOut;

    const numAmountIn = parseFloat(amountIn) || 0;
    const baseAmountOut = numAmountIn * crossRate;
    
    // Validar límite de markup
    const isLimitExceeded = markup > tcLimit;
    const effectiveMarkup = isLimitExceeded ? tcLimit : markup;
    
    const markupAmount = baseAmountOut * (effectiveMarkup / 100);
    let finalAmountOut = baseAmountOut - markupAmount;

    // Smart Rounding for Cash: solo redondea si la diferencia es menor al 1%
    // para evitar distorsiones en el TC como 20 MXN → 1 USD.
    if (methodOut === "CASH") {
      const step = currencyOut.code === 'MXN' ? 0.5 : 1;
      const rounded = Math.round(finalAmountOut / step) * step;
      // Solo aplicar si la diferencia es < 1% del monto original
      const diff = Math.abs(rounded - finalAmountOut);
      if (diff < finalAmountOut * 0.01 || finalAmountOut < step) {
        finalAmountOut = rounded;
      } else {
        // Si la diferencia es > 1%, redondear a 2 decimales (más preciso)
        finalAmountOut = Math.round(finalAmountOut * 100) / 100;
      }
    } else {
      finalAmountOut = Math.round(finalAmountOut * 100) / 100;
    }

    return {
      rate: crossRate,
      amountOut: baseAmountOut,
      markupAmount,
      finalTotal: finalAmountOut,
      isLimitExceeded,
      // Valor en USD para cumplimiento
      usdValue: currencyIn.code === 'USD' ? numAmountIn : (numAmountIn * (liveRates[`${currencyIn.code}_MXN`]?.buy / liveRates['USD_MXN']?.sell))
    };
  }, [currencyIn, currencyOut, liveRates, amountIn, markup, methodOut, tcLimit]);

  // Consolidated Logic for Compliance Thresholds & Blacklists
  useEffect(() => {
    const val = calculation.usdValue || 0;
    let level: 0 | 1 | 2 | 3 = 0;
    if (val >= 5000) {
      level = 3;
    } else if (val >= 3000) {
      level = 2;
    } else if (val >= 1000) {
      level = 1;
    }

    if (blacklistRiskLevel === "ROJO") {
      level = 3; // Force strict supervisor block for hits
    }

    setComplianceLevel(level);
    setShowComplianceAlert(level > 0);
  }, [calculation.usdValue, blacklistRiskLevel]);

  // Blacklist Live Checking Effect on Selected Customer
  useEffect(() => {
    if (!selectedCustomer) {
      setBlacklistMatches([]);
      setBlacklistRiskLevel("VERDE");
      return;
    }

    const fetchBlacklist = async () => {
      setBlacklistLoading(true);
      try {
        const res = await fetch(`/api/compliance/search-lists?q=${encodeURIComponent(selectedCustomer.full_name)}`);
        if (res.ok) {
          const json = await res.json();
          setBlacklistMatches(json.data.matches || []);
          setBlacklistRiskLevel(json.data.riskLevel || "VERDE");
        }
      } catch (err) {
        console.error("Error searching compliance blacklist:", err);
      } finally {
        setBlacklistLoading(false);
      }
    };

    fetchBlacklist();
  }, [selectedCustomer]);

  // Polling Real-Time Remote Approval State
  useEffect(() => {
    if (authRequestStatus !== "PENDING" || !authRequestId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/compliance/authorizations");
        if (res.ok) {
          const json = await res.json();
          const match = json.data.find((a: any) => a.id === authRequestId);
          if (match) {
            if (match.status === "APPROVED") {
              setAuthRequestStatus("APPROVED");
              setAuthApprovedCode(match.passcode);
              setSupervisorKey(match.passcode); // Auto-fill key in the input form!
              clearInterval(interval);
            } else if (match.status === "REJECTED") {
              setAuthRequestStatus("REJECTED");
              clearInterval(interval);
            } else if (match.status === "EXPIRED") {
              setAuthRequestStatus("EXPIRED");
              clearInterval(interval);
            }
          }
        }
      } catch (err) {
        console.error("Error polling remote compliance auth:", err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [authRequestStatus, authRequestId]);

  // Helper to calculate total for a breakdown state
  const calculateDenomsTotal = (breakdown: Record<number, number>) => {
    return Math.round(Object.entries(breakdown).reduce((sum, [val, qty]) => sum + (parseFloat(val) * qty), 0) * 100) / 100;
  };

  const isDenomsInValid = useMemo(() => {
    if (methodIn !== "CASH") return true;
    const val = parseFloat(amountIn) || 0;
    if (val <= 0) return true;
    const total = calculateDenomsTotal(denominationsIn);
    return Math.abs(total - val) < 0.01;
  }, [methodIn, denominationsIn, amountIn]);

  const isDenomsOutValid = useMemo(() => {
    if (methodOut !== "CASH") return true;
    if (calculation.finalTotal <= 0) return true;
    const total = calculateDenomsTotal(denominationsOut);
    return Math.abs(total - calculation.finalTotal) < 0.01;
  }, [methodOut, denominationsOut, calculation.finalTotal]);

  // Automatic Triggers: Open modal when amount is entered or currency changed
  // Tiempo extendido (3s entrada, 4s salida) para que el cajero pueda corregir errores
  // antes de que el tabulador se abra automáticamente.
  useEffect(() => {
    const val = parseFloat(amountIn) || 0;
    if (methodIn === "CASH" && val > 0 && !isDenomsInValid && !showDenomsModal) {
      const timer = setTimeout(() => setShowDenomsModal("IN"), 3000);
      return () => clearTimeout(timer);
    }
  }, [amountIn, methodIn, isDenomsInValid, showDenomsModal]);

  useEffect(() => {
    if (methodOut === "CASH" && calculation.finalTotal > 0 && !isDenomsOutValid && !showDenomsModal) {
      const timer = setTimeout(() => setShowDenomsModal("OUT"), 4000);
      return () => clearTimeout(timer);
    }
  }, [calculation.finalTotal, methodOut, isDenomsOutValid, showDenomsModal]);

  // Fetch denominations for active currencies
  useEffect(() => {
    const fetchDenoms = async (currency: string) => {
      if (denomsConfig[currency]) return;
      try {
        const res = await fetch(`/api/config/denominations/${currency}`);
        const data = await res.json();
        if (data.status === "success") {
          setDenomsConfig(prev => ({ ...prev, [currency]: data.data }));
        }
      } catch (e) {
        console.error("Error fetching denoms", e);
      }
    };

    fetchDenoms(currencyIn.code);
    fetchDenoms(currencyOut.code);
  }, [currencyIn.code, currencyOut.code]);

  // Fetch live rates and config
  const fetchFXData = async () => {
    try {
      const [ratesRes, configRes] = await Promise.all([
        fetch("/api/rates/live"),
        fetch("/api/config/fx")
      ]);
      
      const ratesData: RatesResponse = await ratesRes.json();
      if (ratesData.status === "success" && ratesData.rates) {
        setLiveRates(ratesData.rates);
      }

      const configData = await configRes.json();
      if (configData.status === "success") {
        setMarkup(configData.config.transactionalPercentage);
      }
      
      setIsLoadingRates(false);
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  useEffect(() => {
    console.log("FXTrader fetching data...");
    fetchFXData();
    const interval = setInterval(fetchFXData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleCloseOperation = async () => {
    if (!selectedCustomer || !currencyIn || !currencyOut || !amountIn || parseFloat(amountIn) <= 0) {
      alert("Por favor seleccione un cliente y complete todos los campos correctamente.");
      return;
    }

    if (methodOut === 'TRANSFER' && !outgoingTransferDetails.bankName && !outgoingTransferDetails.txid) {
      alert("Por favor ingrese los datos de destino para la transferencia.");
      return;
    }

    // Strict Validation: Denominations must match if CASH
    if (methodIn === "CASH" && !isDenomsInValid) {
      alert("El desglose de billetes recibidos no coincide con el monto total.");
      return;
    }
    if (methodOut === "CASH" && !isDenomsOutValid) {
      alert("El desglose de billetes a entregar no coincide con el monto total.");
      return;
    }

    // Compliance Check
    // --- VALIDACIÓN DE CIERRE: CUMPLIMIENTO DE OPERACIÓN DE ALIADO (> $1,000 USD) ---
    if (ticketCode && parseFloat(amountIn) > 1000) {
      if (!isOcrCompleted && !kycIdUploaded) {
        alert("🔒 REQUISITO DE CUMPLIMIENTO PENDIENTE\nEsta operación vinculada a Aliado excede los $1,000 USD y requiere validación de identidad.\nPor favor, complete el proceso de escaneo OCR o cargue manualmente la Identificación Oficial antes de concluir la transacción.");
        return;
      }
    }

    if (complianceLevel >= 1 && !incomingFile && !selectedCustomer?.id) {
      alert("Operación >$1,000 USD requiere Identificación Oficial digitalizada.");
      return;
    }
    if (complianceLevel >= 2 && !outgoingFile) {
      alert("Operación >$3,000 USD requiere Comprobante de Domicilio.");
      return;
    }
    
    // --- KYC DINÁMICO: Restricción por Umbral >= $5,000 USD ---
    if (calculation.usdValue >= 5000) {
      if (!kycPhone || kycPhone.trim().length < 10) {
        alert("Para operaciones >= $5,000 USD, el teléfono del expediente completo es obligatorio (mínimo 10 dígitos).");
        return;
      }
      if (!kycOccupation || !kycOccupation.trim()) {
        alert("Para operaciones >= $5,000 USD, la ocupación del cliente es obligatoria.");
        return;
      }
      if (!kycBusinessActivity || !kycBusinessActivity.trim()) {
        alert("Para operaciones >= $5,000 USD, la actividad comercial es obligatoria.");
        return;
      }
      if (!kycIdUploaded) {
        alert("Para operaciones >= $5,000 USD, la confirmación de Identificación Oficial del expediente es obligatoria.");
        return;
      }
      if (!kycAddressUploaded) {
        alert("Para operaciones >= $5,000 USD, la confirmación de Comprobante de Domicilio del expediente es obligatoria.");
        return;
      }
    }

    // --- REAL-TIME SUPERVISOR OVERRIDE PASSCODE VERIFICATION ---
    if (complianceLevel >= 3) {
      if (supervisorKey.length !== 9) {
        alert("Esta operación está bloqueada. Requiere clave de supervisor inmutable de 9 caracteres (3 letras y 6 números).");
        return;
      }

      setIsProcessing(true);
      try {
        const verifyRes = await fetch("/api/compliance/verify-passcode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            passcode: supervisorKey,
            clientId: selectedCustomer.id
          })
        });
        const verifyJson = await verifyRes.json();
        if (verifyJson.status !== "success") {
          alert(`Bloqueo de Cumplimiento: ${verifyJson.message || "La clave de salto ingresada es inválida o ha expirado."}`);
          setIsProcessing(false);
          return;
        }
        // Successfully verified! We can proceed.
      } catch (err) {
        console.error("Error verifying supervisor passcode:", err);
        alert("Error de red al autenticar la clave de supervisión. Intente de nuevo.");
        setIsProcessing(false);
        return;
      }
    }

    setIsProcessing(true);
    
    // Detailed denomination data for vault update
    const denomsInArray = Object.entries(denominationsIn)
      .filter(([_, qty]) => (qty as number) > 0)
      .map(([val, qty]) => ({ denominacion: parseFloat(val), quantity: qty as number }));
    const denomsOutArray = Object.entries(denominationsOut)
      .filter(([_, qty]) => (qty as number) > 0)
      .map(([val, qty]) => ({ denominacion: parseFloat(val), quantity: qty as number }));

    const formData = new FormData();
    formData.append("clientName", selectedCustomer.full_name);
    formData.append("customerId", selectedCustomer.id);
    formData.append("currencyIn", currencyIn.code);
    formData.append("methodIn", methodIn);
    formData.append("currencyOut", currencyOut.code);
    formData.append("methodOut", methodOut);
    formData.append("amountIn", amountIn);
    formData.append("amountOut", calculation.finalTotal.toString());
    formData.append("rate", calculation.rate.toString());
    formData.append("markup", markup.toString());
    formData.append("denominationsIn", JSON.stringify(denomsInArray));
    formData.append("denominationsOut", JSON.stringify(denomsOutArray));
    if (partnerId) {
      formData.append("partnerId", partnerId);
    }
    if (ticketCode) {
      formData.append("ticketCode", ticketCode);
    }
    
    // Incoming Transfer Details
    if (methodIn === "TRANSFER") {
      formData.append("incomingBankName", incomingTransferDetails.bankName);
      formData.append("incomingAccountNumber", incomingTransferDetails.accountNumber);
      formData.append("incomingPayerName", incomingTransferDetails.holderName);
      formData.append("incomingDate", incomingTransferDetails.date);
      formData.append("incomingTrackingId", incomingTransferDetails.trackingId);
      formData.append("incomingTxid", incomingTransferDetails.txid);
      if (incomingFile) {
        formData.append("incomingReceipt", incomingFile);
      }
    }

    // Outgoing Transfer Details
    if (methodOut === "TRANSFER") {
      formData.append("outgoingBankName", outgoingTransferDetails.bankName);
      formData.append("outgoingAccountNumber", outgoingTransferDetails.accountNumber);
      formData.append("outgoingPayerName", outgoingTransferDetails.holderName);
      formData.append("outgoingDate", outgoingTransferDetails.date);
      formData.append("outgoingTrackingId", outgoingTransferDetails.trackingId);
      formData.append("outgoingTxid", outgoingTransferDetails.txid);
      if (outgoingFile) {
        formData.append("outgoingReceipt", outgoingFile);
      }
    }

    try {
      let result;
      
      if (baasMode === "ON_RAMP") {
        // Use the new ACID Fund Wallet endpoint
        const response = await fetch("/api/fxtrader/fund-wallet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: selectedCustomer.id,
            clientName: selectedCustomer.full_name,
            currency: currencyOut.code,
            amount: calculation.finalTotal,
            method: methodIn,
            rate: calculation.rate,
            markup: markup
          })
        });
        
        result = await response.json();
        
        if (result.status === "success") {
          // Force-refresh backend caches and dispatch global sync event
          try {
            fetch("/api/sucursales/sync", { method: "POST" }).catch(e => console.error(e));
          } catch (e) {}
          window.dispatchEvent(new CustomEvent('fx_transaction_success'));
          fetchTerminalStatus();
          fetchFXData();

          // Update local state in real-time
          setSelectedCustomer({
            ...selectedCustomer,
            walletBalance: result.data.newBalance
          });
          
          // Create a mock ticket for the receipt view
          const ticket = {
            ticketId: result.data.transactionId,
            client: selectedCustomer.full_name,
            currencyIn: currencyIn.code,
            amountIn: parseFloat(amountIn),
            methodIn: methodIn,
            currencyOut: currencyOut.code,
            amountOut: calculation.finalTotal,
            methodOut: "BANCOR_WALLET",
            rate: calculation.rate,
            markup: markup
          };
          
          setShowReceipt(ticket);
          setAmountIn("");
          setTicketCode("");
          setIsTicketValidated(false);
          setPartnerId("");
          setIncomingTransferDetails(initialTransferDetails);
          setIncomingFile(null);
          setOutgoingTransferDetails(initialTransferDetails);
          setOutgoingFile(null);
          setBaasMode("NONE");
        } else {
          alert(result.message);
        }
      } else {
        // Standard FX Operation
        const response = await fetch("/api/transactions/close", {
          method: "POST",
          body: formData,
        });

        result = await response.json();
        if (result.status === "success") {
          // Force-refresh backend caches and dispatch global sync event
          try {
            fetch("/api/sucursales/sync", { method: "POST" }).catch(e => console.error(e));
          } catch (e) {}
          window.dispatchEvent(new CustomEvent('fx_transaction_success'));
          fetchTerminalStatus();
          fetchFXData();

          // If BaaS mode is active (OFF_RAMP), process the wallet transaction
          if (baasMode === "OFF_RAMP") {
            const walletRes = await fetch("/api/baas/wallet/transaction", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                customerId: selectedCustomer.id,
                type: "OFF_RAMP",
                currency: currencyIn.code,
                amount: parseFloat(amountIn),
                ticketId: result.ticket.ticketId
              })
            });

            const walletResult = await walletRes.json();
            if (walletResult.status === "error") {
              alert(walletResult.message);
              setIsProcessing(false);
              return;
            }
            
            // Update balance for real-time reflection
            setSelectedCustomer({
              ...selectedCustomer,
              walletBalance: {
                ...selectedCustomer.walletBalance,
                [currencyIn.code]: walletResult.newBalance
              }
            });
          }

          setShowReceipt(result.ticket);
          // Only clear customer if not in BaaS mode to allow seeing the new balance
          if (baasMode === "NONE") {
            setSelectedCustomer(null);
          }
          setCustomerSearch("");
          setAmountIn("");
          setTicketCode("");
          setIsTicketValidated(false);
          setPartnerId("");
          setIncomingTransferDetails(initialTransferDetails);
          setIncomingFile(null);
          setOutgoingTransferDetails(initialTransferDetails);
          setOutgoingFile(null);
          setBaasMode("NONE");
        } else {
          // Error del backend: mostrar mensaje al usuario
          const errMsg = result.message || result.error || "Error desconocido al procesar la operación.";
          console.error("Backend error:", errMsg);

          // Si el error es por falta de liquidez, mostrar sugerencia de dotación
          if (errMsg.toLowerCase().includes('existencia') || errMsg.toLowerCase().includes('insuficiente') || errMsg.toLowerCase().includes('saldo')) {
            alert(`💸 SIN LIQUIDEZ SUFICIENTE\n\n${errMsg}\n\nSugerencia: Solicita una dotación de emergencia usando el botón "🚨 Solicitar Dotación de Emergencia" en el panel de Gestión de Liquidez.`);
            setShowDotationModal(true);
          } else {
            alert(`Error al cerrar operación:\n\n${errMsg}`);
          }
        }
      }
    } catch (error) {
      console.error("Error closing operation:", error);
      alert("Error al procesar la operación.");
    } finally {
      setIsProcessing(false);
    }
  };

  if (showReceipt) {
    const b = showReceipt.branchDetails || {
      nombre: "Sucursal Matriz - Centro",
      razon_social: "FINTECH SOLUTIONS S.A. DE C.V.",
      rfc: "FSO121205ABC",
      calle: "Av. Paseo de la Reforma",
      numero: "222",
      colonia: "Juárez",
      ciudad: "Ciudad de México",
      codigo_postal: "06600",
      telefono: "5555555555",
      email: "matriz@fintechsolutions.mx",
      licencia_cnbv: "CNBV-LIC-100293-2024",
      logo_url: ""
    };

    return (
      <div className="max-w-md mx-auto bg-[#1e2329] border border-[#2b3139] rounded-2xl overflow-hidden shadow-2xl print:bg-white print:text-black print:border-none print:shadow-none">
        {/* ENCABEZADO DE TICKET FISCAL IMPRESO */}
        <div className="p-6 text-center border-b border-[#2b3139] print:border-black flex flex-col items-center">
          {b.logo_url ? (
            <img 
              src={b.logo_url} 
              alt="Logo Sucursal" 
              className="max-h-16 max-w-[180px] object-contain mb-4"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-12 h-12 bg-binance-yellow/10 text-binance-yellow rounded-xl flex items-center justify-center mb-3 print:hidden">
              <Building size={24} />
            </div>
          )}
          <h3 className="text-sm font-bold text-white print:text-black tracking-wide uppercase">{b.nombre}</h3>
          <p className="text-xs text-gray-400 print:text-black mt-1">{b.razon_social}</p>
          <p className="text-[11px] text-gray-500 print:text-black font-mono mt-0.5">RFC: {b.rfc}</p>
          <p className="text-[10px] text-gray-500 print:text-black leading-relaxed mt-1">
            {b.calle} {b.numero}, Col. {b.colonia}, {b.ciudad}, C.P. {b.codigo_postal}
          </p>
          <p className="text-[10px] text-gray-500 print:text-black mt-0.5">
            Tel: {b.telefono} | {b.email}
          </p>
          <div className="mt-2 inline-block px-2 py-0.5 bg-binance-yellow/10 text-binance-yellow border border-binance-yellow/20 text-[9px] font-black uppercase rounded print:border-black print:text-black">
            Licencia CNBV: {b.licencia_cnbv}
          </div>
        </div>

        <div className="p-6 text-center border-b border-[#2b3139] print:border-black">
          <div className="w-12 h-12 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-3 print:hidden">
            <CheckCircle2 size={24} />
          </div>
          <h2 className="text-base font-bold text-white print:text-black">COMPROBANTE DE OPERACIÓN</h2>
          <p className="text-gray-400 print:text-black text-xs font-mono mt-1">Folio: #{showReceipt.ticketId}</p>
          <p className="text-[10px] text-gray-500 print:text-black font-mono mt-0.5">{new Date(showReceipt.timestamp || Date.now()).toLocaleString('es-MX')}</p>
        </div>
        
        <div className="p-6 space-y-4 font-mono text-xs">
          <div className="flex justify-between">
            <span className="text-gray-500 print:text-black">CLIENTE:</span>
            <span className="text-white print:text-black font-bold">{showReceipt.client}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 print:text-black">CAJERO:</span>
            <span className="text-white print:text-black">{showReceipt.cajero || "Operador"}</span>
          </div>
          <div className="border-t border-[#2b3139] print:border-black my-2 pt-2">
            <div className="flex justify-between">
              <span className="text-gray-500 print:text-black">RECIBIMOS:</span>
              <span className="text-emerald-500 print:text-black font-bold">{showReceipt.amountIn.toLocaleString()} {showReceipt.currencyIn}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-gray-500 print:text-black">MÉTODO:</span>
              <span className="text-gray-400 print:text-black">{showReceipt.methodIn === 'CASH' ? 'EFECTIVO' : 'TRANSFERENCIA'}</span>
            </div>
          </div>
          <div className="border-t border-[#2b3139] print:border-black my-2 pt-2">
            <div className="flex justify-between">
              <span className="text-gray-500 print:text-black">ENTREGAMOS:</span>
              <span className="text-binance-yellow print:text-black font-bold">{showReceipt.amountOut.toLocaleString(undefined, { minimumFractionDigits: 2 })} {showReceipt.currencyOut}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-gray-500 print:text-black">MÉTODO:</span>
              <span className="text-gray-400 print:text-black">{showReceipt.methodOut === 'CASH' ? 'EFECTIVO' : 'TRANSFERENCIA'}</span>
            </div>
          </div>
          <div className="flex justify-between pt-2 border-t border-[#2b3139] print:border-black">
            <span className="text-gray-500 print:text-black">TIPO DE CAMBIO:</span>
            <span className="text-white print:text-black font-bold">{(typeof showReceipt.rate === 'number' ? showReceipt.rate : Number(showReceipt.rate) || 0).toFixed(4)} {showReceipt.currencyOut}/{showReceipt.currencyIn}</span>
          </div>
          {showReceipt.ticketCode && (
            <div className="flex justify-between border-t border-dashed border-[#2b3139] print:border-black pt-2">
              <span className="text-gray-500 print:text-black">FOLIO VINCULADO:</span>
              <span className="text-emerald-400 print:text-black font-bold">{showReceipt.ticketCode}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-500 print:text-black">MARKUP:</span>
            <span className="text-white print:text-black">{showReceipt.markup}%</span>
          </div>
          
          <div className="border-t border-dashed border-[#2b3139] print:border-black pt-3 mt-3 text-[9px] text-gray-500 print:text-black text-center leading-relaxed">
            {showReceipt.legalDisclaimer || "Esta operación está sujeta a liquidación por tesorería si es digital. Conserve este comprobante."}
          </div>
        </div>

        <div className="p-6 bg-black/20 flex gap-3 print:hidden">
          <button 
            onClick={() => window.print()}
            className="flex-1 bg-[#2b3139] hover:bg-[#363c44] text-white py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Receipt size={18} /> Imprimir
          </button>
          <button 
            onClick={() => setShowReceipt(null)}
            className="flex-1 bg-binance-yellow hover:bg-yellow-500 text-black py-3 rounded-xl font-bold transition-colors"
          >
            Nueva Operación
          </button>
        </div>
      </div>
    );
  }

  if (isShiftChecking) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <RefreshCw className="animate-spin text-binance-yellow mb-4" size={48} />
        <p className="text-gray-400 font-medium">Validando estado del Turno y Auditoría Contable...</p>
      </div>
    );
  }

  if (shiftStatus !== "OPEN") {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <ArrowLeftRight className="text-binance-yellow" />
              FX Trader <span className="text-xs font-normal bg-binance-yellow/10 text-binance-yellow px-2 py-0.5 rounded-full uppercase tracking-wider">v3.1</span>
            </h1>
            <p className="text-gray-400 text-sm mt-1">Cotizador Multidivisa Bidireccional con Validación KYC.</p>
          </div>
        </header>
        <ShiftOpeningCount 
          token={token || ''}
          onShiftStatusChange={(status, shift) => {
          setShiftStatus(status);
          setActiveShift(shift);
        }} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Modal de Error de Ticket Ya Procesado */}
      {showProcessedTicketError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="bg-[#1e2329] border border-red-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-500">
              <span className="text-2xl">⚠️</span>
              <h3 className="text-lg font-black uppercase tracking-wider">ERROR: TICKET YA PROCESADO</h3>
            </div>
            
            <p className="text-sm text-gray-300 leading-relaxed">
              No se puede cargar ni liquidar el ticket ingresado porque su estado actual en la base de datos es <strong className="text-red-400 font-bold uppercase">'LIQUIDADO'</strong>.
            </p>
            
            <p className="text-xs text-gray-400 bg-red-500/5 border border-red-500/10 p-3 rounded-lg font-mono">
              El candado del FX Trader ha bloqueado cualquier nueva inserción de operaciones asociadas a este ID de ticket para mantener la inmutabilidad de la auditoría financiera.
            </p>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowProcessedTicketError(false)}
                className="bg-red-500 hover:bg-red-600 text-white font-bold px-5 py-2.5 rounded-xl text-xs transition-colors shadow-lg shadow-red-500/10 cursor-pointer"
              >
                Aceptar y Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ArrowLeftRight className="text-binance-yellow" />
            FX Trader <span className="text-xs font-normal bg-binance-yellow/10 text-binance-yellow px-2 py-0.5 rounded-full uppercase tracking-wider">v3.1</span>
          </h1>
          <p className="text-gray-400 text-sm mt-1">Cotizador Multidivisa Bidireccional con Validación KYC.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {activeShift && (
            <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded-xl text-xs font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Turno Abierto: {activeShift.folio_documento}</span>
              <span className="text-gray-500">|</span>
              <span>Cajero: {activeShift.nickname}</span>
              <button
                id="btn-close-active-shift"
                type="button"
                onClick={() => setShowCorteModal(true)}
                className="ml-2 px-2 py-0.5 bg-red-500/20 hover:bg-red-500/40 text-red-400 font-bold rounded text-[10px] transition-colors cursor-pointer"
              >
                Cerrar Turno
              </button>
            </div>
          )}
          
          {/* Botón de Retiro Proactivo de Caja */}
          <button 
            type="button"
            onClick={() => {
              if (terminalStatus?.exceededCurrencies?.[0]) {
                setRetiroCurrency(terminalStatus.exceededCurrencies[0].currency);
              } else {
                setRetiroCurrency("USD");
              }
              setRetiroMessage(null);
              setShowRetiroModal(true);
            }}
            className="px-3 py-1.5 bg-binance-yellow/10 hover:bg-binance-yellow/20 border border-binance-yellow/30 text-binance-yellow font-bold rounded-full text-xs transition-colors flex items-center gap-1 cursor-pointer"
          >
            <DollarSign size={12} /> Retiro de Caja
          </button>

          <div className="flex items-center gap-2 text-xs text-gray-500 bg-[#1e2329] px-3 py-1.5 rounded-full border border-[#2b3139]">
            <RefreshCw size={12} className={isLoadingRates ? "animate-spin" : ""} />
            Tasas actualizadas: {new Date().toLocaleTimeString()}
          </div>
        </div>
      </header>

      {terminalStatus?.locked ? (
        <div className="max-w-4xl mx-auto py-12 space-y-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-500/5 border border-red-500/20 rounded-3xl p-8 text-center space-y-6 shadow-2xl"
          >
            <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle size={48} className="animate-pulse" />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-red-500 uppercase tracking-widest">
                Terminal Bloqueada por Seguridad
              </h2>
              <p className="text-gray-400 text-sm max-w-2xl mx-auto leading-relaxed">
                Esta terminal de caja ha sido **bloqueada automáticamente** tras permanecer en estado de exceso de efectivo por más de 30 minutos (Regla de Seguridad Física VaaS). Las operaciones de Compra-Venta quedan suspendidas temporalmente.
              </p>
            </div>

            {/* List of Exceeded Balances */}
            <div className="max-w-md mx-auto bg-[#1e2329] border border-red-500/20 rounded-2xl p-6 text-left space-y-4">
              <div className="text-xs text-gray-500 font-bold uppercase tracking-wider border-b border-white/5 pb-2">
                Saldos de Caja en Excedente:
              </div>
              <div className="space-y-3 font-mono text-xs">
                {terminalStatus?.exceededCurrencies?.map((ec: any) => (
                  <div key={ec.currency} className="flex justify-between items-center bg-black/20 p-3 rounded-lg border border-white/5">
                    <div>
                      <span className="text-white font-black text-sm">{ec.currency}</span>
                      <span className="text-gray-500 block text-[10px]">Caja actual</span>
                    </div>
                    <div className="text-right">
                      <span className="text-red-400 font-black text-sm">{ec.balance.toLocaleString()}</span>
                      <span className="text-gray-500 block text-[10px]">Límite de seguridad: {ec.limit.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Retiro de Caja Form */}
            <div className="max-w-md mx-auto bg-[#1e2329] border border-[#2b3139] rounded-2xl p-6 text-left space-y-6 shadow-xl">
              <h3 className="text-sm font-black text-binance-yellow uppercase tracking-widest border-b border-white/5 pb-2">
                Solicitud de Retiro de Caja a Bóveda
              </h3>

              <form onSubmit={handleRetiroSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">Seleccionar Divisa a Retirar</label>
                  <select 
                    value={retiroCurrency}
                    onChange={(e) => setRetiroCurrency(e.target.value)}
                    className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-3 px-4 text-white focus:outline-none focus:border-binance-yellow"
                  >
                    {terminalStatus?.exceededCurrencies?.map((ec: any) => (
                      <option key={ec.currency} value={ec.currency}>
                        {ec.currency} (Excedido: {(ec.balance - ec.limit).toLocaleString()})
                      </option>
                    )) || (
                      CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)
                    )}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">Monto a Retirar</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">$</span>
                    <input 
                      type="number"
                      step="any"
                      placeholder="0.00"
                      value={retiroAmount}
                      onChange={(e) => setRetiroAmount(e.target.value)}
                      className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-3 pl-8 pr-4 text-white font-mono text-lg focus:outline-none focus:border-binance-yellow"
                    />
                  </div>
                  <p className="text-[10px] text-gray-500 leading-relaxed italic mt-1">
                    * El retiro reducirá los lotes de inventario mediante valuación FIFO y depositará los fondos directamente en la Bóveda central. El desbloqueo de la terminal es automático en cuanto el balance baje del límite permitido.
                  </p>
                </div>

                {retiroMessage && (
                  <div className={`p-3 rounded-xl text-xs font-bold text-center ${retiroMessage.startsWith('Error') ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'}`}>
                    {retiroMessage}
                  </div>
                )}

                <button 
                  type="submit"
                  disabled={isRetiroProcessing || !retiroAmount}
                  className="w-full py-4 bg-binance-yellow hover:bg-yellow-500 disabled:opacity-50 text-black font-black uppercase rounded-xl transition-colors tracking-wider cursor-pointer"
                >
                  {isRetiroProcessing ? "PROCESANDO RETIRO..." : "EFECTUAR RETIRO DE CAJA"}
                </button>
              </form>
            </div>
          </motion.div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Client Search & Info */}
          <section className="bg-[#1e2329] border border-[#2b3139] rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <User size={14} /> Validación de Identidad (KYC)
              </label>
              {selectedCustomer && !isTicketValidated && (
                <button 
                  onClick={() => setSelectedCustomer(null)}
                  className="text-xs text-red-500 hover:underline flex items-center gap-1"
                >
                  <X size={12} /> Cambiar Cliente
                </button>
              )}
            </div>

            {!selectedCustomer ? (
              <div className="relative">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                    <input 
                      type="text" 
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Buscar cliente por nombre o ID..."
                      className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-4 pl-12 pr-4 text-white focus:outline-none focus:border-binance-yellow transition-colors"
                    />
                    {isSearching && (
                      <RefreshCw className="absolute right-4 top-1/2 -translate-y-1/2 text-binance-yellow animate-spin" size={18} />
                    )}
                  </div>
                  <button
                    id="fx-quick-register-direct-btn"
                    type="button"
                    onClick={() => setShowQuickRegister(true)}
                    className="px-5 bg-binance-yellow text-black rounded-xl font-bold text-xs hover:bg-yellow-500 transition-colors flex items-center gap-1.5 shrink-0"
                  >
                    <UserPlus size={16} /> Alta Rápida (KYC)
                  </button>
                </div>

                <AnimatePresence>
                  {searchResults.length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute z-50 w-full mt-2 bg-[#1e2329] border border-[#2b3139] rounded-xl shadow-2xl overflow-hidden"
                    >
                      {searchResults.map(customer => (
                        <button
                          key={customer.id}
                          onClick={() => {
                            if (blacklistRiskLevel === 'ROJO') return; // Bloquear si hay match ROJO
                            setSelectedCustomer(customer);
                            setSearchResults([]);
                          }}
                          className={`w-full p-4 text-left flex items-center justify-between border-b border-[#2b3139] last:border-0 transition-colors ${
                            blacklistRiskLevel === 'ROJO' 
                              ? 'opacity-40 cursor-not-allowed bg-red-500/5'
                              : 'hover:bg-black/20'
                          }`}
                        >
                          <div className="text-left">
                            <div className="text-white font-medium">{customer.full_name}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-gray-500 font-mono">{customer.id}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                customer.client_type === 'PHYSICAL' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
                              }`}>
                                {customer.client_type === 'PHYSICAL' ? 'Física' : 'Moral'}
                              </span>
                              {customer.isB2B && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase bg-emerald-500/10 text-emerald-400">
                                  B2B Kappa
                                </span>
                              )}
                            </div>
                          </div>
                          <div className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                            customer.risk_level === 'LOW' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                          }`}>
                            Riesgo {customer.risk_level}
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                  {customerSearch.length >= 3 && searchResults.length === 0 && !isSearching && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="absolute z-50 w-full mt-2 bg-[#1e2329] border border-[#2b3139] rounded-xl shadow-2xl p-6 text-center"
                    >
                      <UserPlus className="mx-auto text-gray-500 mb-2" size={32} />
                      <p className="text-gray-400 text-sm mb-4">No se encontró ningún cliente con ese nombre.</p>
                      <button 
                        onClick={() => setShowQuickRegister(true)}
                        className="bg-binance-yellow text-black px-6 py-2 rounded-lg font-bold text-sm hover:bg-yellow-500 transition-colors"
                      >
                        Alta Rápida de Cliente
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-black/20 border border-binance-yellow/20 rounded-xl p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-binance-yellow/10 text-binance-yellow rounded-full flex items-center justify-center">
                    <User size={24} />
                  </div>
                  <div>
                    <h4 className="text-white font-bold">{selectedCustomer.full_name}</h4>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-[10px] text-gray-500 font-mono">{selectedCustomer.id}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                        selectedCustomer.client_type === 'PHYSICAL' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
                      }`}>
                        {selectedCustomer.client_type === 'PHYSICAL' ? 'Persona Física' : 'Persona Moral'}
                      </span>
                      {selectedCustomer.isB2B && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase bg-emerald-500/10 text-emerald-400 font-black">
                          Flujo Kappa B2B
                        </span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                        selectedCustomer.risk_level === 'LOW' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                      }`}>
                        Nivel de Riesgo: {selectedCustomer.risk_level}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="text-emerald-500" size={20} />
                  <span className="text-xs text-emerald-500 font-medium">Verificado</span>
                </div>
              </motion.div>
            )}

            {/* VIP BaaS Panel */}
            <AnimatePresence>
              {selectedCustomer?.isVIP && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="mt-4 p-4 bg-gradient-to-br from-binance-yellow/20 to-binance-yellow/5 border border-binance-yellow/30 rounded-2xl"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-binance-yellow text-black rounded-lg">
                        <ShieldCheck size={16} />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white uppercase">Panel Cliente VIP (BaaS)</h4>
                        <p className="text-[10px] text-binance-yellow font-medium">Billetera Digital Activa</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-gray-500 uppercase">Saldo Disponible</p>
                      <p className="text-sm font-mono font-bold text-white">
                        {selectedCustomer.walletBalance?.MXN.toLocaleString()} MXN
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => {
                        setBaasMode("ON_RAMP");
                        setMethodOut("TRANSFER");
                        setOutgoingTransferDetails({
                          ...initialTransferDetails,
                          bankName: "Bancore Digital Wallet",
                          accountNumber: selectedCustomer.id,
                          holderName: selectedCustomer.full_name
                        });
                      }}
                      className={`py-2 px-3 rounded-xl border text-[10px] font-bold uppercase transition-all flex items-center justify-center gap-2 ${
                        baasMode === "ON_RAMP"
                          ? "bg-binance-yellow text-black border-binance-yellow"
                          : "bg-black/20 border-binance-yellow/30 text-binance-yellow hover:bg-binance-yellow/10"
                      }`}
                    >
                      <ArrowUpRight size={14} /> Fondear Billetera
                    </button>
                    <button
                      onClick={() => {
                        const balance = selectedCustomer.walletBalance?.[currencyIn.code as keyof typeof selectedCustomer.walletBalance] || 0;
                        if (amountIn && parseFloat(amountIn) > balance) {
                          alert("Saldo insuficiente, comunícate con tu ejecutivo");
                          return;
                        }
                        setBaasMode("OFF_RAMP");
                        setMethodIn("TRANSFER");
                        setIncomingTransferDetails({
                          ...initialTransferDetails,
                          bankName: "Bancore Digital Wallet",
                          accountNumber: selectedCustomer.id,
                          holderName: selectedCustomer.full_name
                        });
                      }}
                      className={`py-2 px-3 rounded-xl border text-[10px] font-bold uppercase transition-all flex items-center justify-center gap-2 ${
                        baasMode === "OFF_RAMP"
                          ? "bg-binance-yellow text-black border-binance-yellow"
                          : "bg-black/20 border-binance-yellow/30 text-binance-yellow hover:bg-binance-yellow/10"
                      }`}
                    >
                      <ArrowDownRight size={14} /> Retiro FIAT
                    </button>
                  </div>

                  {baasMode !== "NONE" && (
                    <div className="mt-3 pt-3 border-t border-binance-yellow/20 flex items-center justify-between">
                      <span className="text-[10px] text-gray-400 italic">
                        Modo {baasMode === "ON_RAMP" ? "On-ramp" : "Off-ramp"} activado
                      </span>
                      <button 
                        onClick={() => {
                          setBaasMode("NONE");
                          setMethodIn("CASH");
                          setMethodOut("CASH");
                        }}
                        className="text-[10px] text-binance-red font-bold uppercase hover:underline"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* Bidirectional Selectors */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Receiving Section */}
            <section className="bg-[#1e2329] border border-[#2b3139] rounded-2xl p-6 space-y-6">
              <h3 className="text-sm font-bold text-emerald-500 uppercase flex items-center gap-2">
                <ArrowRight size={16} /> Lo que Recibimos
              </h3>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] text-gray-500 uppercase">Divisa Recibida</label>
                    <div className="grid grid-cols-3 gap-2">
                      {CURRENCIES.map(c => (
                        <button
                          key={c.code}
                          onClick={() => {
                            setCurrencyIn(c);
                            setDenominationsIn({});
                          }}
                          className={`py-2 px-1 rounded-lg border text-xs transition-all ${
                            currencyIn.code === c.code 
                              ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                              : "bg-[#181a20] border-[#2b3139] text-gray-400"
                          }`}
                        >
                          {c.flag} {c.code}
                        </button>
                      ))}
                    </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-gray-500 uppercase">Método de Recepción</label>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setMethodIn("CASH")}
                      className={`flex-1 py-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${
                        methodIn === "CASH" 
                          ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                          : "bg-[#181a20] border-[#2b3139] text-gray-500"
                      }`}
                    >
                      <DollarSign size={16} /> EFECTIVO
                    </button>
                    <button 
                      onClick={() => setMethodIn("TRANSFER")}
                      className={`flex-1 py-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${
                        methodIn === "TRANSFER" 
                          ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                          : "bg-[#181a20] border-[#2b3139] text-gray-500"
                      }`}
                    >
                      <RefreshCw size={16} /> TRANSF.
                    </button>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] text-gray-500 uppercase">Cantidad Recibida</label>
                    {methodIn === "CASH" && (
                      <div className={`text-[10px] font-bold flex items-center gap-1 p-1 ${isDenomsInValid ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {isDenomsInValid ? (
                          <><CheckCircle2 size={12} /> ARQUEO CUADRADO</>
                        ) : (
                          <button 
                            onClick={() => setShowDenomsModal("IN")}
                            className="flex items-center gap-1 hover:underline"
                          >
                            <AlertCircle size={12} /> PENDIENTE DESGLOSE
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">{currencyIn.symbol}</span>
                    <input 
                      type="number"
                      value={amountIn}
                      onChange={(e) => setAmountIn(e.target.value)}
                      disabled={isTicketValidated}
                      placeholder="0.00"
                      className={`w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-4 pl-10 pr-4 text-2xl font-bold focus:outline-none focus:border-emerald-500 ${isTicketValidated ? 'text-gray-500 cursor-not-allowed opacity-75' : 'text-white'}`}
                    />
                  </div>
                </div>

                <AnimatePresence>
                  {methodIn === "TRANSFER" && (
                    <TransferFormDetails 
                      title="Detalles de Transferencia Entrante"
                      details={incomingTransferDetails}
                      setDetails={setIncomingTransferDetails}
                      selectedFile={incomingFile}
                      setSelectedFile={setIncomingFile}
                      isCrypto={currencyIn.code === "USDT"}
                      accentColor="emerald"
                    />
                  )}
                </AnimatePresence>
              </div>
            </section>

            {/* Delivering Section */}
            <section className="bg-[#1e2329] border border-[#2b3139] rounded-2xl p-6 space-y-6">
              <h3 className="text-sm font-bold text-binance-yellow uppercase flex items-center gap-2">
                <ArrowRight size={16} /> Lo que Entregamos
              </h3>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] text-gray-500 uppercase">Divisa Entregada</label>
                  <div className="grid grid-cols-3 gap-2">
                    {CURRENCIES.map(c => (
                      <button
                        key={c.code}
                        onClick={() => {
                          setCurrencyOut(c);
                          setDenominationsOut({});
                        }}
                        className={`py-2 px-1 rounded-lg border text-xs transition-all ${
                          currencyOut.code === c.code 
                            ? "bg-binance-yellow/10 border-binance-yellow text-binance-yellow" 
                            : "bg-[#181a20] border-[#2b3139] text-gray-400"
                        }`}
                      >
                        {c.flag} {c.code}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-gray-500 uppercase">Método de Entrega</label>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setMethodOut("CASH")}
                      className={`flex-1 py-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${
                        methodOut === "CASH" 
                          ? "bg-binance-yellow/10 border-binance-yellow text-binance-yellow" 
                          : "bg-[#181a20] border-[#2b3139] text-gray-500"
                      }`}
                    >
                      <DollarSign size={16} /> EFECTIVO
                    </button>
                    <button 
                      onClick={() => setMethodOut("TRANSFER")}
                      className={`flex-1 py-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${
                        methodOut === "TRANSFER" 
                          ? "bg-binance-yellow/10 border-binance-yellow text-binance-yellow" 
                          : "bg-[#181a20] border-[#2b3139] text-gray-500"
                      }`}
                    >
                      <RefreshCw size={16} /> TRANSF.
                    </button>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] text-gray-500 uppercase">Total a Entregar</label>
                    {methodOut === "CASH" && (
                      <div className={`text-[10px] font-bold flex items-center gap-1 p-1 ${isDenomsOutValid ? 'text-binance-yellow' : 'text-amber-500'}`}>
                        {isDenomsOutValid ? (
                          <><CheckCircle2 size={12} /> ARQUEO CUADRADO</>
                        ) : (
                          <button 
                            onClick={() => setShowDenomsModal("OUT")}
                            className="flex items-center gap-1 hover:underline"
                          >
                            <AlertCircle size={12} /> PENDIENTE DESGLOSE
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="w-full bg-[#181a20]/50 border border-[#2b3139] rounded-xl py-4 px-4 text-2xl font-bold text-binance-yellow min-h-[66px] flex items-center">
                    {currencyOut.symbol}{calculation.finalTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>

                <AnimatePresence>
                  {methodOut === "TRANSFER" && (
                    <TransferFormDetails 
                      title="Datos de Destino (Liquidación Digital)"
                      details={outgoingTransferDetails}
                      setDetails={setOutgoingTransferDetails}
                      selectedFile={outgoingFile}
                      setSelectedFile={setOutgoingFile}
                      isCrypto={currencyOut.code === "USDT"}
                      accentColor="binance-yellow"
                    />
                  )}
                </AnimatePresence>
              </div>
            </section>
          </div>
        </div>

        <div className="space-y-6">
          <section className="bg-[#1e2329] border border-[#2b3139] rounded-2xl p-6 shadow-lg sticky top-6">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-6 flex items-center gap-2">
              <Receipt size={16} /> Resumen de Operación
            </h3>

            {/* Ticket de Captación (Aliados) */}
            <div className="mb-6 space-y-2">
              <label className="text-[10px] text-binance-yellow font-black uppercase tracking-widest flex items-center gap-2">
                <QrCode size={12} /> Liquidar Ticket Aliado
              </label>
              <div className="flex gap-2">
                <input 
                  type="text"
                  placeholder="TICKET-0000"
                  value={ticketCode}
                  onChange={(e) => setTicketCode(e.target.value.toUpperCase())}
                  disabled={isTicketValidated}
                  className={`flex-1 bg-binance-yellow/5 border border-binance-yellow/20 rounded-xl py-2 px-3 font-mono text-sm focus:outline-none focus:border-binance-yellow ${isTicketValidated ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5 cursor-not-allowed' : 'text-binance-yellow placeholder:text-yellow-600/30'}`}
                />
                {isTicketValidated ? (
                  <button 
                    onClick={() => {
                      setTicketCode("");
                      setPartnerId("");
                      setIsTicketValidated(false);
                      setAmountIn("");
                      setSelectedCustomer(null);
                    }}
                    className="px-4 bg-red-500 text-white rounded-xl text-xs font-black hover:bg-red-600 transition-colors"
                  >
                    X
                  </button>
                ) : (
                  <button 
                    onClick={validateTicket}
                    disabled={isValidatingTicket || !ticketCode}
                    className="px-4 bg-binance-yellow text-black rounded-xl text-xs font-black hover:bg-yellow-500 transition-colors disabled:opacity-50"
                  >
                    {isValidatingTicket ? "..." : "LOAD"}
                  </button>
                )}
              </div>
              {isTicketValidated && (
                <div className="text-[10px] text-emerald-400 font-bold flex items-center gap-1 mt-1">
                  <CheckCircle2 size={10} /> MONTO Y CLIENTE VINCULADOS CON ÉXITO
                </div>
              )}
            </div>

            {/* Panel de Motor OCR para Tickets de Aliados */}
            {isTicketValidated && parseFloat(amountIn) > 1000 && (
              <div className="mb-6 p-4 rounded-xl border border-binance-yellow/20 bg-binance-yellow/5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-binance-yellow uppercase tracking-wider flex items-center gap-1">
                    🛡️ Motor de Validación OCR
                  </span>
                  {isOcrCompleted || kycIdUploaded ? (
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-400 font-black px-2 py-0.5 rounded border border-emerald-500/30">
                      ID VERIFICADA
                    </span>
                  ) : (
                    <span className="text-[10px] bg-red-500/20 text-red-400 font-black px-2 py-0.5 rounded border border-red-500/30 animate-pulse">
                      REQUISITO PENDIENTE
                    </span>
                  )}
                </div>
                
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Esta operación de aliado supera el umbral de <strong>$1,000 USD</strong>. De acuerdo al manual de cumplimiento del operador, es obligatorio validar la identidad del cliente.
                </p>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={runOcrSimulation}
                    disabled={isOcrProcessing || isOcrCompleted}
                    className={`flex-1 text-xs py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${
                      isOcrCompleted 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 cursor-not-allowed'
                        : 'bg-binance-yellow hover:bg-yellow-500 text-black shadow-md shadow-binance-yellow/10 cursor-pointer'
                    }`}
                  >
                    {isOcrProcessing ? (
                      <span className="flex items-center gap-1.5 animate-pulse">
                        <span className="inline-block animate-spin">⏳</span> Procesando INE...
                      </span>
                    ) : isOcrCompleted ? (
                      <>✨ OCR Validado con Éxito</>
                    ) : (
                      <>🔍 Escanear ID vía OCR</>
                    )}
                  </button>
                  
                  {!isOcrCompleted && (
                    <button
                      onClick={() => {
                        setKycIdUploaded(true);
                        setIsOcrCompleted(true);
                        alert("INE validada manualmente.");
                      }}
                      className="text-[10px] border border-gray-600 hover:border-gray-500 text-gray-300 px-3 py-2 rounded-lg font-medium transition-colors"
                    >
                      Captura Manual
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Panel de Desbloqueo de Dotación de Emergencia */}
            <div className="mb-6 p-4 rounded-xl border border-[#2b3139] bg-[#181a20] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-binance-yellow/70 uppercase tracking-wider flex items-center gap-1">
                  💰 Gestión de Liquidez de Terminal
                </span>
                <span className="text-[10px] text-gray-500 font-mono">
                  MXN
                </span>
              </div>
              
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Si tu terminal se queda sin inventario físico de MXN, puedes solicitar una dotación o ingresar la clave autorizada por tu Gerente.
              </p>

              <div className="space-y-2 pt-1">
                {/* 1. Request Emergency Dotation */}
                <button
                  onClick={() => setShowDotationModal(true)}
                  className="w-full text-xs py-2 px-3 rounded-lg font-bold bg-[#1e2329] hover:bg-[#2b3139] text-gray-200 border border-[#3a3f47] transition-colors cursor-pointer"
                >
                  🚨 Solicitar Dotación de Emergencia
                </button>

                {/* 2. Enter passcode to unlock */}
                <div className="flex gap-2">
                  <input
                    id="input-unlock-key"
                    placeholder="Clave Autorización"
                    className="flex-1 min-w-0 text-xs px-3 py-2 rounded-lg bg-[#1e2329] border border-[#3a3f47] text-white placeholder-gray-600 focus:outline-none focus:border-binance-yellow/50 font-mono uppercase"
                  />
                  <button
                    onClick={async () => {
                      const input = document.getElementById("input-unlock-key") as HTMLInputElement;
                      const val = input?.value?.trim().toUpperCase();
                      if (!val || val.length !== 9) {
                        alert("Por favor ingrese una clave de 9 caracteres.");
                        return;
                      }
                      try {
                        const res = await fetch("/api/liquidity/dotaciones/desbloquear", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ clave_autorizacion: val })
                        });
                        const json = await res.json();
                        if (json.status === "success") {
                          alert(`🎉 ¡ÉXITO DE DESBLOQUEO!\n${json.message}\nSe han aplicado $${json.data.monto_mxn.toLocaleString()} MXN a tu saldo de terminal.`);
                          if (input) input.value = "";
                        } else {
                          alert(`❌ ERROR DE DESBLOQUEO\n${json.message}`);
                        }
                      } catch (err) {
                        alert("Error al conectar con el servidor.");
                      }
                    }}
                    className="shrink-0 text-xs bg-binance-yellow hover:bg-yellow-500 text-black font-bold px-4 py-2 rounded-lg transition-colors cursor-pointer"
                  >
                    Desbloquear
                  </button>
                </div>
              </div>
            </div>

            {/* Compliance Alerts Panel & Semáforo de Riesgo — EN VIVO mientras busca */}
            {(customerSearch.length >= 3 || selectedCustomer) && (
              <div className="mb-6 space-y-3">
                {/* 1. Semáforo de Riesgo (Live Blacklist Results) */}
                <div className={`p-4 rounded-xl border transition-all ${
                  blacklistRiskLevel === 'ROJO' 
                    ? "bg-red-500/10 border-red-500/40 shadow-lg shadow-red-500/5" 
                    : blacklistRiskLevel === 'AMARILLO'
                    ? "bg-yellow-500/10 border-yellow-500/40 shadow-lg shadow-yellow-500/5"
                    : "bg-emerald-500/5 border-emerald-500/20"
                }`}>
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg shrink-0 ${
                      blacklistRiskLevel === 'ROJO' 
                        ? "bg-red-500 text-white" 
                        : blacklistRiskLevel === 'AMARILLO'
                        ? "bg-yellow-500 text-black"
                        : "bg-emerald-500 text-white"
                    }`}>
                      <ShieldCheck size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className={`text-xs font-black uppercase tracking-wider ${
                          blacklistRiskLevel === 'ROJO' 
                            ? "text-red-500" 
                            : blacklistRiskLevel === 'AMARILLO'
                            ? "text-yellow-500"
                            : "text-emerald-500"
                        }`}>
                          Semáforo de Riesgo: {blacklistRiskLevel}
                        </h4>
                        {blacklistLoading && (
                          <RefreshCw size={10} className="animate-spin text-gray-500" />
                        )}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
                        {blacklistRiskLevel === 'ROJO' 
                          ? "BLOQUEO CNBV: Se detectó una coincidencia exacta en listas restrictivas de prevención de lavado de dinero." 
                          : blacklistRiskLevel === 'AMARILLO'
                          ? "PREVENCIÓN AML: Posible homonimia o alerta moderada. Verificar historial."
                          : "MONITOR CNBV: Cliente libre de reportes negativos o coincidencias en OFAC/PEP/SAT."
                        }
                      </p>

                      {blacklistMatches.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
                          <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Coincidencias encontradas:</p>
                          {blacklistMatches.map((m, i) => (
                            <div key={i} className="text-[9px] flex items-center justify-between text-gray-300 font-mono bg-black/30 px-1.5 py-0.5 rounded">
                              <span>{m.nombre}</span>
                              <span className="text-red-400 font-bold uppercase text-[8px] tracking-widest">{m.tipo}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. KYC Dinámico: Formulario de Expediente Completo (Triggered on Limit >= 5000 USD) */}
                {calculation.usdValue >= 5000 && (
                  <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/5 space-y-3">
                    <div className="flex items-center gap-2">
                      <FileText className="text-red-500" size={16} />
                      <h4 className="text-xs font-black uppercase text-red-500 tracking-wider">
                        Solicitud de Expediente Completo (KYC)
                      </h4>
                    </div>
                    <p className="text-[10px] text-gray-400">
                      Operación supera los <strong>$5,000 USD</strong>. Es obligatorio recopilar y validar el expediente para la CNBV:
                    </p>

                    <div className="space-y-2 pt-1 text-xs text-white">
                      <div>
                        <label className="text-[9px] text-gray-400 uppercase tracking-wider">Teléfono Particular</label>
                        <input 
                          type="tel"
                          placeholder="p. ej. +52 55 1234 5678"
                          value={kycPhone}
                          onChange={(e) => setKycPhone(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-lg py-1.5 px-3 mt-0.5 focus:outline-none focus:border-red-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] text-gray-400 uppercase tracking-wider">Ocupación</label>
                          <input 
                            type="text"
                            placeholder="Profesión / Oficio"
                            value={kycOccupation}
                            onChange={(e) => setKycOccupation(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-lg py-1.5 px-3 mt-0.5 focus:outline-none focus:border-red-500"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-gray-400 uppercase tracking-wider">Giro Comercial</label>
                          <input 
                            type="text"
                            placeholder="p. ej. Comercio"
                            value={kycBusinessActivity}
                            onChange={(e) => setKycBusinessActivity(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-lg py-1.5 px-3 mt-0.5 focus:outline-none focus:border-red-500"
                          />
                        </div>
                      </div>

                      <div className="pt-1 space-y-1.5">
                        <button
                          type="button"
                          onClick={() => setKycIdUploaded(!kycIdUploaded)}
                          className={`w-full py-2 px-3 rounded-lg border text-left text-[10px] flex items-center justify-between font-bold transition-all ${
                            kycIdUploaded 
                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" 
                              : "bg-black/30 border-white/5 text-gray-400 hover:border-red-500/30"
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 size={12} className={kycIdUploaded ? "text-emerald-400" : "text-gray-600"} />
                            Identificación Oficial Vigente
                          </span>
                          <span className="text-[8px] font-mono font-black uppercase tracking-widest">
                            {kycIdUploaded ? "CARGADO" : "PENDIENTE"}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setKycAddressUploaded(!kycAddressUploaded)}
                          className={`w-full py-2 px-3 rounded-lg border text-left text-[10px] flex items-center justify-between font-bold transition-all ${
                            kycAddressUploaded 
                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" 
                              : "bg-black/30 border-white/5 text-gray-400 hover:border-red-500/30"
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 size={12} className={kycAddressUploaded ? "text-emerald-400" : "text-gray-600"} />
                            Comprobante de Domicilio Fiscal
                          </span>
                          <span className="text-[8px] font-mono font-black uppercase tracking-widest">
                            {kycAddressUploaded ? "CARGADO" : "PENDIENTE"}
                          </span>
                        </button>
                      </div>

                      {kycPhone && kycOccupation && kycBusinessActivity && kycIdUploaded && kycAddressUploaded ? (
                        <div className="text-[9px] text-emerald-400 font-bold flex items-center gap-1 mt-1 justify-center">
                          <CheckCircle2 size={10} /> ✓ Expediente Completo Capturado
                        </div>
                      ) : (
                        <div className="text-[9px] text-red-400 font-semibold flex items-center gap-1 mt-1 justify-center animate-pulse">
                          <AlertCircle size={10} /> Rellene todos los campos del expediente
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            
            <div className="space-y-4 mb-4">
              <div className="flex justify-between items-center py-2 border-b border-[#2b3139]">
                <span className="text-gray-500 text-sm">Cliente</span>
                <span className="text-white font-medium">{selectedCustomer?.full_name || "---"}</span>
              </div>
              {/* Nuevo: ID de Aliado */}
              <div className="flex justify-between items-center py-2 border-b border-[#2b3139]">
                <span className="text-gray-500 text-sm">ID Aliado / QR</span>
                <input 
                  type="text"
                  placeholder="Sin Aliado"
                  value={partnerId || ""}
                  onChange={(e) => setPartnerId(e.target.value)}
                  className="bg-transparent text-right text-binance-yellow focus:outline-none placeholder:text-gray-600 text-sm font-bold"
                />
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[#2b3139]">
                <span className="text-gray-500 text-sm">Recibimos</span>
                <span className="text-emerald-500 font-bold">{currencyIn.code} ({methodIn})</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[#2b3139]">
                <span className="text-gray-500 text-sm">Entregamos</span>
                <span className="text-binance-yellow font-bold">{currencyOut.code} ({methodOut})</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[#2b3139]">
                <span className="text-gray-500 text-sm">Tasa Cruzada</span>
                <span className="text-white font-mono font-bold">{calculation.rate.toFixed(4)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[#2b3139]">
                <span className="text-gray-500 text-sm">Markup</span>
                <span className="text-emerald-500 font-medium">{markup}%</span>
              </div>
              
              <div className="pt-4">
                <div className="text-xs text-gray-500 uppercase mb-1">Total a Entregar</div>
                <div className="text-3xl font-bold text-binance-yellow">
                  {currencyOut.symbol}{calculation.finalTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  <span className="text-xs text-gray-500 ml-2 font-normal">{currencyOut.code}</span>
                </div>
                <div className="text-[10px] text-gray-500 mt-1 italic">
                  * Markup de {currencyOut.symbol}{calculation.markupAmount.toFixed(2)} aplicado.
                </div>
              </div>
            </div>

            {/* Input para Clave de Supervisión */}
            {complianceLevel === 3 && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mb-4 space-y-2 p-4 rounded-xl border border-red-500/20 bg-red-500/5"
              >
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-red-500 font-black uppercase tracking-widest flex items-center gap-2">
                    <ShieldCheck size={12} /> Requiere Clave de Supervisión
                  </label>
                  <span className="text-[9px] text-gray-500 font-mono font-bold">CNBV / AML</span>
                </div>
                
                <input 
                  type="password"
                  maxLength={9}
                  placeholder="V6S150118"
                  value={supervisorKey}
                  onChange={(e) => setSupervisorKey(e.target.value)}
                  className="w-full bg-[#181a20] border border-red-500/30 rounded-xl py-3 px-4 text-center text-red-500 font-mono tracking-[0.3em] uppercase placeholder:lowercase focus:outline-none focus:border-red-500"
                />

                {/* Remote Approval Flow Integration */}
                <div className="pt-2 border-t border-white/5">
                  {authRequestStatus === 'IDLE' && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!selectedCustomer) return;
                        setAuthRequestStatus("PENDING");
                        try {
                          const res = await fetch("/api/compliance/request-authorization", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              clientId: selectedCustomer.id,
                              clientName: selectedCustomer.full_name,
                              amountUsd: calculation.usdValue || 0,
                              reason: blacklistRiskLevel === "ROJO" ? "LISTA_NEGRA_BLOQUEO" : "UMBRAL_LIMITE_5000",
                              requestedBy: profile?.nickname || "Cajero"
                            })
                          });
                          if (res.ok) {
                            const json = await res.json();
                            setAuthRequestId(json.data.id);
                          } else {
                            setAuthRequestStatus("IDLE");
                            alert("Error al enviar solicitud remota.");
                          }
                        } catch (err) {
                          setAuthRequestStatus("IDLE");
                          console.error(err);
                        }
                      }}
                      className="w-full py-2 px-3 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 font-bold text-[10px] flex items-center justify-center gap-1.5 border border-red-500/30 transition-all uppercase tracking-wider"
                    >
                      <RefreshCw className="animate-pulse" size={12} />
                      Solicitar Autorización Remota
                    </button>
                  )}

                  {authRequestStatus === 'PENDING' && (
                    <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-center space-y-2">
                      <div className="flex items-center justify-center gap-2 text-yellow-500 text-[10px] font-bold uppercase animate-pulse">
                        <RefreshCw size={12} className="animate-spin" />
                        Esperando Liberación Remota...
                      </div>
                      <p className="text-[9px] text-gray-400">
                        Folio: <span className="font-mono text-yellow-400">{authRequestId.substring(0,8)}</span>. El Oficial de Cumplimiento AML ha recibido la alerta y está evaluando el expediente en tiempo real.
                      </p>
                    </div>
                  )}

                  {authRequestStatus === 'APPROVED' && (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-center space-y-1">
                      <div className="text-emerald-500 text-[10px] font-bold uppercase flex items-center justify-center gap-1">
                        <ShieldCheck size={12} />
                        ¡Operación Aprobada Remotamente!
                      </div>
                      <p className="text-[9px] text-gray-400">
                        Clave inmutable de 9 caracteres auto-aplicada:
                      </p>
                      <p className="text-sm font-mono font-bold text-emerald-400 bg-emerald-500/5 py-1 rounded">
                        {authApprovedCode}
                      </p>
                    </div>
                  )}

                  {authRequestStatus === 'REJECTED' && (
                    <div className="p-3 bg-red-500/20 border border-red-500/40 rounded-lg text-center">
                      <div className="text-red-500 text-[10px] font-bold uppercase">
                        ✗ Operación Rechazada
                      </div>
                      <p className="text-[9px] text-gray-400 mt-1">
                        El Oficial de Cumplimiento ha denegado la autorización para esta transacción.
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            <button 
              disabled={!selectedCustomer || !amountIn || isProcessing || !isDenomsInValid || !isDenomsOutValid}
              onClick={handleCloseOperation}
              className={`w-full py-4 rounded-xl font-bold text-lg shadow-xl transition-all flex items-center justify-center gap-2 ${
                !selectedCustomer || !amountIn || isProcessing || !isDenomsInValid || !isDenomsOutValid
                  ? "bg-[#2b3139] text-gray-500 cursor-not-allowed"
                  : "bg-binance-yellow hover:bg-yellow-500 text-black transform hover:scale-[1.02] active:scale-[0.98]"
              }`}
            >
              {isProcessing ? (
                <>
                  <RefreshCw size={20} className="animate-spin" />
                  PROCESANDO...
                </>
              ) : (
                <>
                  CERRAR OPERACIÓN
                  <ArrowRight size={20} />
                </>
              )}
            </button>

            {/* Feedback: explicar por qué está deshabilitado */}
            {!selectedCustomer && (
              <p className="text-[10px] text-gray-500 text-center mt-2">
                ⚠️ Seleccione un cliente para habilitar el cierre de operación
              </p>
            )}
            {selectedCustomer && amountIn && !isDenomsInValid && methodIn === "CASH" && (
              <p className="text-[10px] text-binance-yellow text-center mt-2">
                ⚠️ Tabule los billetes recibidos (arqueo pendiente) para habilitar el cierre
              </p>
            )}
            {selectedCustomer && amountIn && !isDenomsOutValid && methodOut === "CASH" && calculation.finalTotal > 0 && (
              <p className="text-[10px] text-binance-yellow text-center mt-2">
                ⚠️ Tabule los billetes a entregar (arqueo pendiente) para habilitar el cierre
              </p>
            )}

            <div className="mt-6 p-4 bg-black/20 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-[10px] text-gray-500 uppercase">
                <AlertCircle size={12} /> Nota de Auditoría
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed">
                Esta transacción quedará registrada como {methodIn === 'CASH' ? 'Entrada Física' : 'Entrada Digital'} y {methodOut === 'CASH' ? 'Salida Física' : 'Salida Digital'}. El corte de caja separará ambos rubros automáticamente.
              </p>
            </div>
          </section>
        </div>
      </div>
      )}

      {/* MODAL DE ADVERTENCIA POR EXCESO DE EFECTIVO */}
      <AnimatePresence>
        {showWarningModal && terminalStatus && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#1e2329] border border-binance-yellow/30 p-8 rounded-3xl max-w-md w-full text-center space-y-6 shadow-2xl relative"
            >
              <button 
                onClick={() => setShowWarningModal(false)}
                className="absolute right-4 top-4 text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>

              <div className="w-16 h-16 bg-binance-yellow/10 text-binance-yellow rounded-full flex items-center justify-center mx-auto">
                <AlertCircle size={36} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold uppercase tracking-wider text-binance-yellow">
                  ¡ADVERTENCIA DE SEGURIDAD!
                </h3>
                <p className="text-gray-400 text-xs leading-relaxed">
                  El inventario en caja ha excedido los límites de seguridad física establecidos para esta sucursal (Mitigación de Riesgos VaaS).
                </p>
              </div>

              <div className="bg-black/20 p-4 rounded-xl space-y-2 border border-white/5 text-left text-xs font-mono">
                <div className="text-gray-500 uppercase text-[10px] tracking-wider mb-1">Divisas Excedidas:</div>
                {terminalStatus.exceededCurrencies?.map((ec: any) => (
                  <div key={ec.currency} className="flex justify-between">
                    <span className="text-white font-bold">{ec.currency}</span>
                    <span className="text-red-400 font-bold">
                      {ec.balance.toLocaleString()} / Límite {ec.limit.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>

              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-center text-xs">
                <span className="text-red-400 font-bold block uppercase mb-1">
                  Advertencia {terminalStatus.warningCount} de 3
                </span>
                <p className="text-gray-400 text-[10px] leading-relaxed">
                  Al llegar a la 3ra advertencia (30 minutos en exceso), la terminal se bloqueará y suspenderá operaciones de compra/venta.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowWarningModal(false)}
                  className="flex-1 py-3 border border-[#2b3139] hover:bg-[#2b3139] text-gray-300 font-bold rounded-xl transition-colors text-xs uppercase cursor-pointer"
                >
                  Entendido
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowWarningModal(false);
                    if (terminalStatus.exceededCurrencies?.[0]) {
                      setRetiroCurrency(terminalStatus.exceededCurrencies[0].currency);
                    }
                    setRetiroMessage(null);
                    setShowRetiroModal(true);
                  }}
                  className="flex-1 py-3 bg-binance-yellow hover:bg-yellow-500 text-black font-black rounded-xl transition-colors text-xs uppercase cursor-pointer"
                >
                  Retirar de Caja
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL DE RETIRO DE CAJA A BÓVEDA (PROACTIVO) */}
      <AnimatePresence>
        {showRetiroModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#1e2329] border border-[#2b3139] p-6 rounded-3xl max-w-md w-full relative space-y-6 shadow-2xl"
            >
              <button 
                type="button"
                onClick={() => setShowRetiroModal(false)}
                className="absolute right-4 top-4 text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>

              <div className="flex items-center gap-3 border-b border-[#2b3139] pb-3">
                <div className="p-2 bg-binance-yellow/10 text-binance-yellow rounded-xl">
                  <Building size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">
                    Retiro de Caja a Bóveda
                  </h3>
                  <p className="text-[10px] text-gray-500">Mover excedentes de caja para resguardo</p>
                </div>
              </div>

              <form onSubmit={handleRetiroSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">Seleccionar Divisa</label>
                  <select 
                    value={retiroCurrency}
                    onChange={(e) => setRetiroCurrency(e.target.value)}
                    className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-3 px-4 text-white focus:outline-none focus:border-binance-yellow"
                  >
                    {CURRENCIES.map(c => (
                      <option key={c.code} value={c.code}>{c.code} ({c.name})</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">Monto a Retirar</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">$</span>
                    <input 
                      type="number"
                      step="any"
                      placeholder="0.00"
                      value={retiroAmount}
                      onChange={(e) => setRetiroAmount(e.target.value)}
                      className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-3 pl-8 pr-4 text-white font-mono text-lg focus:outline-none focus:border-binance-yellow"
                    />
                  </div>
                </div>

                {retiroMessage && (
                  <div className={`p-3 rounded-xl text-xs font-bold text-center ${retiroMessage.startsWith('Error') ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'}`}>
                    {retiroMessage}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button 
                    type="button"
                    onClick={() => setShowRetiroModal(false)}
                    className="flex-1 py-3 border border-[#2b3139] hover:bg-[#2b3139] text-gray-400 font-bold rounded-xl transition-all text-xs uppercase cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    disabled={isRetiroProcessing || !retiroAmount}
                    className="flex-1 py-3 bg-binance-yellow hover:bg-yellow-500 text-black font-black uppercase rounded-xl transition-all text-xs tracking-wider disabled:opacity-50 cursor-pointer"
                  >
                    {isRetiroProcessing ? "PROCESANDO..." : "CONFIRMAR RETIRO"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showQuickRegister && (
          <QuickRegisterModal 
            onClose={() => setShowQuickRegister(false)} 
            onSuccess={(customer) => {
              setSelectedCustomer(customer);
              setShowQuickRegister(false);
            }}
          />
        )}
        {showDenomsModal && (
          <DenominationsModal 
            type={showDenomsModal}
            currency={showDenomsModal === "IN" ? currencyIn : currencyOut}
            breakdown={showDenomsModal === "IN" ? denominationsIn : denominationsOut}
            setBreakdown={showDenomsModal === "IN" ? setDenominationsIn : setDenominationsOut}
            onClose={() => setShowDenomsModal(null)}
            onGoBack={() => {
              if (showDenomsModal === "IN") {
                setAmountIn("");
              }
              setShowDenomsModal(null);
            }}
            denoms={denomsConfig[showDenomsModal === "IN" ? currencyIn.code : currencyOut.code] || []}
            targetAmount={showDenomsModal === "IN" ? (parseFloat(amountIn) || 0) : calculation.finalTotal}
          />
        )}
        {showDotationModal && (
          <EmergencyDotationModal
            onClose={() => setShowDotationModal(false)}
            cajeroId={profile?.auth_user_id || "user_cajero_1"}
          />
        )}
      </AnimatePresence>

      <CorteCajaModal
        isOpen={showCorteModal}
        onClose={() => setShowCorteModal(false)}
        activeShift={activeShift}
        onShiftClosed={() => {
          setActiveShift(null);
          setShiftStatus(null);
          setShowCorteModal(false);
        }}
      />
    </div>
  );
}

function TransferFormDetails({ 
  title, 
  details, 
  setDetails, 
  selectedFile, 
  setSelectedFile, 
  isCrypto,
  accentColor = "emerald"
}: { 
  title: string, 
  details: TransferDetails, 
  setDetails: (d: TransferDetails) => void,
  selectedFile: File | null,
  setSelectedFile: (f: File | null) => void,
  isCrypto: boolean,
  accentColor?: "emerald" | "binance-yellow"
}) {
  const accentClass = accentColor === "emerald" ? "text-emerald-500" : "text-binance-yellow";
  const borderClass = accentColor === "emerald" ? "focus:border-emerald-500" : "focus:border-binance-yellow";
  const hoverBorderClass = accentColor === "emerald" ? "hover:border-emerald-500/50" : "hover:border-binance-yellow/50";

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="space-y-4 pt-4 border-t border-[#2b3139] overflow-hidden"
    >
      <h4 className={`text-[10px] font-bold ${accentClass} uppercase flex items-center gap-2`}>
        <Info size={12} /> {title}
      </h4>
      
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] text-gray-500 uppercase">Banco / Red</label>
            <input 
              type="text"
              value={details.bankName}
              onChange={(e) => setDetails({...details, bankName: e.target.value})}
              placeholder="Ej. BBVA o TRON"
              className={`w-full bg-[#181a20] border border-[#2b3139] rounded-lg py-2 px-3 text-sm text-white focus:outline-none ${borderClass}`}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-gray-500 uppercase">Cuenta / CLABE</label>
            <input 
              type="text"
              value={details.accountNumber}
              onChange={(e) => setDetails({...details, accountNumber: e.target.value})}
              placeholder="0123..."
              className={`w-full bg-[#181a20] border border-[#2b3139] rounded-lg py-2 px-3 text-sm text-white focus:outline-none ${borderClass}`}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-gray-500 uppercase">Nombre del Titular</label>
          <input 
            type="text"
            value={details.holderName}
            onChange={(e) => setDetails({...details, holderName: e.target.value})}
            placeholder="Nombre completo"
            className={`w-full bg-[#181a20] border border-[#2b3139] rounded-lg py-2 px-3 text-sm text-white focus:outline-none ${borderClass}`}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] text-gray-500 uppercase">Fecha</label>
            <input 
              type="date"
              value={details.date}
              onChange={(e) => setDetails({...details, date: e.target.value})}
              className={`w-full bg-[#181a20] border border-[#2b3139] rounded-lg py-2 px-3 text-sm text-white focus:outline-none ${borderClass}`}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-gray-500 uppercase">Clave de rastreo</label>
            <input 
              type="text"
              value={details.trackingId}
              onChange={(e) => setDetails({...details, trackingId: e.target.value})}
              placeholder="ID / Referencia"
              className={`w-full bg-[#181a20] border border-[#2b3139] rounded-lg py-2 px-3 text-sm text-white focus:outline-none ${borderClass}`}
            />
          </div>
        </div>

        {isCrypto && (
          <div className="space-y-1">
            <label className="text-[10px] text-gray-500 uppercase">TXID (Transaction Hash)</label>
            <input 
              type="text"
              value={details.txid}
              onChange={(e) => setDetails({...details, txid: e.target.value})}
              placeholder="0x..."
              className={`w-full bg-[#181a20] border border-[#2b3139] rounded-lg py-2 px-3 text-sm text-white focus:outline-none ${borderClass} font-mono`}
            />
          </div>
        )}

        <div className="space-y-2">
          <label className="text-[10px] text-gray-500 uppercase">Comprobante</label>
          <div className="flex items-center gap-3">
            <label className="flex-1 cursor-pointer">
              <div className={`bg-[#181a20] border border-dashed border-[#2b3139] ${hoverBorderClass} rounded-xl p-4 transition-all flex flex-col items-center justify-center gap-2`}>
                {selectedFile ? (
                  <>
                    <FileText className={accentClass} size={24} />
                    <span className="text-xs text-white truncate max-w-[150px]">{selectedFile.name}</span>
                    <span className="text-[10px] text-gray-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span>
                  </>
                ) : (
                  <>
                    <Upload className="text-gray-500" size={24} />
                    <span className="text-xs text-gray-400">Subir archivo (PDF, JPG, PNG)</span>
                  </>
                )}
                <input 
                  type="file" 
                  className="hidden" 
                  accept="image/*,.pdf"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
              </div>
            </label>
            {selectedFile && (
              <button 
                onClick={() => setSelectedFile(null)}
                className="p-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20 transition-colors"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}




function DenominationsModal({ 
  type, 
  currency, 
  breakdown, 
  setBreakdown, 
  onClose,
  onGoBack,
  denoms,
  targetAmount
}: { 
  type: "IN" | "OUT", 
  currency: Currency, 
  breakdown: Record<number, number>, 
  setBreakdown: (b: Record<number, number>) => void,
  onClose: () => void,
  onGoBack?: () => void,
  denoms: any[],
  targetAmount: number
}) {
  const roundedTarget = Math.round(targetAmount * 100) / 100;
  const total = useMemo(() => {
    return Math.round(Object.entries(breakdown).reduce((sum, [val, qty]) => sum + (parseFloat(val) * qty), 0) * 100) / 100;
  }, [breakdown]);
  const diff = Math.round(Math.abs(total - roundedTarget) * 100) / 100;
  const isValid = diff < 0.01 && total > 0;
  
  const [editingDenom, setEditingDenom] = useState<number | null>(null);

  const getBillImage = (value: number, curr: string) => {
    // Note: These URLs were provided as reference. If they fail, the fallback UI handles it.
    if (curr === 'USD') {
      const mapping: Record<number, string> = {
        1: 'https://storage.googleapis.com/as-artifacts/1_dollar.png',
        2: 'https://storage.googleapis.com/as-artifacts/2_dollars.png',
        5: 'https://storage.googleapis.com/as-artifacts/5_dollars.png',
        10: 'https://storage.googleapis.com/as-artifacts/10_dollars.png',
        20: 'https://storage.googleapis.com/as-artifacts/20_dollars.png',
        50: 'https://storage.googleapis.com/as-artifacts/50_dollars.png',
        100: 'https://storage.googleapis.com/as-artifacts/100_dollars.png',
      };
      return mapping[value] || null;
    }
    return null;
  };

  const getBillColor = (value: number, curr: string) => {
    if (curr === 'USD') return 'bg-[#1e2329] text-gray-200 border-[#3a3f47]';
    if (curr === 'MXN') {
      return 'bg-[#1e2329] text-gray-200 border-[#3a3f47]';
    }
    return 'bg-[#181a20] text-gray-400 border-[#2b3139]';
  };
  const handleUpdate = (denom: number, value: number) => {
    const newBreakdown = { ...breakdown, [denom]: value };
    if (value <= 0) delete newBreakdown[denom];
    setBreakdown(newBreakdown);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="bg-[#1e2329] w-full max-w-6xl max-h-[90vh] rounded-xl shadow-2xl overflow-hidden flex flex-col border border-white/5"
      >
        <div className="p-2.5 border-b border-white/5 flex justify-between items-center bg-[#181a20]/50 backdrop-blur-md text-left">
          <div className="flex items-center gap-3">
            <div className={`p-1 rounded-lg transition-colors ${type === "IN" ? "bg-emerald-500 text-black" : "bg-binance-yellow text-black"}`}>
              <Coins size={16} />
            </div>
            <div>
              <h2 className="text-xs font-black text-white tracking-tight leading-none">Arqueo de Caja</h2>
              <span className="block text-[7px] font-medium text-gray-500 uppercase tracking-widest">
                {type === "IN" ? "Recibiendo" : "Entregando"}
              </span>
            </div>

            <div className="flex items-center gap-4 bg-black/40 p-1 px-3 rounded-lg border border-white/5 ml-3">
              <div className="flex flex-col">
                <span className="text-[7px] text-gray-400 uppercase font-bold leading-none mb-0.5">Objetivo</span>
                <span className="text-xs font-bold text-white font-mono">{currency.symbol}{roundedTarget.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="h-5 w-[1px] bg-white/10" />
              <div className="flex flex-col">
                <span className="text-[7px] text-gray-400 uppercase font-bold leading-none mb-0.5">Conteo</span>
                <span className={`text-xs font-bold font-mono ${isValid ? 'text-emerald-500' : 'text-binance-yellow'}`}>
                  {currency.symbol}{total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="h-5 w-[1px] bg-white/10" />
              <div className="flex flex-col">
                <span className="text-[7px] text-amber-500 uppercase font-bold leading-none mb-0.5">Dif</span>
                <span className={`text-xs font-bold font-mono ${isValid ? 'text-emerald-500' : 'text-red-500'}`}>
                  {isValid ? '0.00' : `${currency.symbol}${diff.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {!isValid && (
              <button 
                onClick={onClose}
                className="p-2 text-gray-500 hover:text-white transition-colors"
                title="Cerrar sin guardar"
              >
                <X size={20} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 custom-scrollbar bg-gradient-to-b from-[#1e2329] to-[#181a20]">
          {denoms.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-500 space-y-3">
              <RefreshCw className="animate-spin text-binance-yellow" size={32} />
              <p className="font-black tracking-widest uppercase text-[10px]">Validando Bóveda...</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
              {denoms.map((denom: any) => {
                const val = denom.denominacion || denom.value;
                const qty = breakdown[val] || 0;
                const isSelected = editingDenom === val;
                const img = getBillImage(val, currency.code);

                return (
                  <motion.div
                    key={val}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setEditingDenom(val)}
                    className={`group relative flex flex-col p-1 rounded-xl border transition-all cursor-pointer shadow-sm items-center ${
                      isSelected 
                        ? 'border-binance-yellow bg-binance-yellow/10' 
                        : qty > 0 
                          ? 'border-emerald-500/50 bg-emerald-500/5' 
                          : 'border-white/5 bg-[#181a20]/40'
                    }`}
                  >
                    <div className="aspect-[2.5/1] w-full relative rounded-lg overflow-hidden bg-black/60 flex items-center justify-center mb-1 border border-white/5">
                      {img ? (
                        <img 
                          src={img} 
                          alt={`Billete ${val}`} 
                          className={`w-full h-full object-cover transition-all duration-300 ${qty === 0 && !isSelected ? 'grayscale opacity-20' : 'grayscale-0 opacity-100'}`}
                          referrerPolicy="no-referrer"
                          onError={(e) => { (e.target as any).style.display = 'none'; }}
                        />
                      ) : null}
                      
                      <div className={`absolute inset-0 flex flex-col items-center justify-center ${img ? 'hidden' : 'flex'}`}>
                        <span className="text-xl font-black tracking-tighter text-white/90">${val}</span>
                      </div>
                      
                      {qty > 0 && (
                        <div className="absolute top-0.5 right-0.5 bg-emerald-500 text-black text-[8px] font-black px-1.5 py-0.5 rounded shadow-lg z-10">
                          {qty}
                        </div>
                      )}
                      
                      {isSelected && (
                        <div className="absolute inset-0 bg-binance-yellow/20 backdrop-blur-sm flex items-center justify-center z-20">
                          <Plus className="text-white" size={24} />
                        </div>
                      )}
                    </div>

                    <div className="flex justify-between items-center w-full px-1">
                      <div className="flex flex-col text-left">
                        <span className="text-[7px] text-gray-500 font-extrabold uppercase tracking-widest">VAL</span>
                        <span className="text-[10px] font-black text-white">${val}</span>
                      </div>
                      <div className="flex flex-col items-end text-right">
                        <span className="text-[7px] text-gray-500 font-extrabold uppercase tracking-widest">SUB</span>
                        <span className={`text-[10px] font-black font-mono tracking-tighter ${qty > 0 ? 'text-emerald-500' : 'text-gray-700'}`}>
                          {(val * qty).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <AnimatePresence>
                      {isSelected && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="absolute inset-0 z-30 bg-[#1e2329] border-2 border-binance-yellow rounded-xl flex flex-col items-center justify-center p-3 shadow-2xl"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-[9px] font-black text-binance-yellow mb-3 tracking-widest uppercase">PIEZAS: {val}</span>
                          <div className="flex items-center gap-4 mb-4">
                            <button 
                              onClick={() => handleUpdate(val, Math.max(0, qty - 1))}
                              className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center hover:bg-red-500 text-white transition-all active:scale-90"
                            >
                              <Minus size={16} />
                            </button>
                            <input 
                              type="number"
                              value={qty || ''}
                              onChange={(e) => handleUpdate(val, Math.max(0, parseInt(e.target.value) || 0))}
                              className="w-12 bg-transparent text-center border-b-2 border-binance-yellow text-2xl font-black text-white focus:outline-none"
                              placeholder="0"
                              autoFocus
                            />
                            <button 
                              onClick={() => handleUpdate(val, qty + 1)}
                              className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center hover:bg-emerald-500 text-white transition-all active:scale-90"
                            >
                              <Plus size={16} />
                            </button>
                          </div>
                          <button 
                            onClick={() => setEditingDenom(null)}
                            className="bg-binance-yellow text-black px-6 py-1.5 rounded-lg font-black text-[10px] hover:bg-yellow-500 transition-all shadow-xl"
                          >
                            ACEPTAR
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-2.5 bg-[#181a20]/80 backdrop-blur-md border-t border-white/5 space-y-2">
          <div className="flex justify-between items-center px-2">
            <div className="flex flex-col text-left">
              <span className="text-[7px] text-gray-500 uppercase font-black tracking-[0.2em]">Total Arqueado Actual</span>
              <span className={`text-lg font-black font-mono transition-all duration-500 ${isValid ? 'text-emerald-500' : 'text-binance-yellow'}`}>
                {currency.symbol}{total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            
            {!isValid && (
              <div className="bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded flex items-center gap-2 text-red-500 animate-pulse">
                <AlertCircle size={12} />
                <div className="flex flex-col text-left">
                  <span className="text-[6px] font-black uppercase tracking-widest leading-none">Faltan</span>
                  <span className="text-[10px] font-black font-mono">{currency.symbol}{diff.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            )}
          </div>

          <button 
            disabled={!isValid}
            onClick={onClose}
            className={`w-full py-2 rounded-lg font-black text-xs shadow-xl transition-all flex items-center justify-center gap-2 group ${
              isValid 
                ? (type === 'IN' ? 'bg-emerald-500 text-black hover:bg-emerald-400' : 'bg-binance-yellow text-black hover:bg-yellow-400') 
                : 'bg-white/5 text-white/20 cursor-not-allowed border border-white/5'
            }`}
          >
            {isValid ? (
              <>
                <ShieldCheck size={16} /> 
                SINCRONIZAR CON BÓVEDA
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Clock size={14} className="animate-spin" />
                <span className="text-[10px]">EL MONTO DEBE CUADRAR</span>
              </div>
            )}
          </button>

          {onGoBack && (
            <button
              onClick={onGoBack}
              className="w-full py-2 rounded-lg font-medium text-xs transition-all border border-[#2b3139] hover:border-red-500/30 text-gray-400 hover:text-red-400 flex items-center justify-center gap-2 mt-2"
            >
              <X size={14} />
              Volver a editar monto
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
