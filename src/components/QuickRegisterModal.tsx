import React, { useState, useRef, FormEvent, DragEvent, useEffect } from "react";
import { 
  X, 
  User, 
  Building2, 
  FileText, 
  Upload, 
  AlertCircle, 
  CheckCircle2, 
  RefreshCw, 
  HelpCircle,
  Briefcase,
  ShieldCheck
} from "lucide-react";
import { motion } from "motion/react";

interface Customer {
  id: string;
  full_name: string;
  client_type: 'PHYSICAL' | 'MORAL';
  risk_level: string;
  isVIP?: boolean;
  isB2B?: boolean;
  walletBalance?: {
    MXN: number;
    USD: number;
    USDT: number;
  };
}

interface QuickRegisterModalProps {
  onClose: () => void;
  onSuccess: (customer: Customer) => void;
}

export default function QuickRegisterModal({ onClose, onSuccess }: QuickRegisterModalProps) {
  const [clientType, setClientType] = useState<'PHYSICAL' | 'MORAL'>('PHYSICAL');
  
  // Physical Person Fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [rfcCurp, setRfcCurp] = useState("");
  const [officialIdFile, setOfficialIdFile] = useState<File | null>(null);

  // Moral Person Fields
  const [razonSocial, setRazonSocial] = useState("");
  const [companyRfc, setCompanyRfc] = useState("");
  const [businessLine, setBusinessLine] = useState("");
  const [legalRepName, setLegalRepName] = useState("");
  const [legalRepId, setLegalRepId] = useState("");
  const [isB2b, setIsB2b] = useState(false);
  const [actaConstitutivaFile, setActaConstitutivaFile] = useState<File | null>(null);
  const [comprobanteDomicilioFile, setComprobanteDomicilioFile] = useState<File | null>(null);

  // Common Fields
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [estimatedMonthlyAmount, setEstimatedMonthlyAmount] = useState("");
  const [estimatedOperations, setEstimatedOperations] = useState("");
  const [sourceDestinationFunds, setSourceDestinationFunds] = useState("");

  // UI/Error states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Compliance check state
  const [complianceCheck, setComplianceCheck] = useState<{ level: string; matches: any[] } | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);

  // Drag & drop states
  const [dragActiveId, setDragActiveId] = useState(false);
  const [dragActiveActa, setDragActiveActa] = useState(false);
  const [dragActiveDomicilio, setDragActiveDomicilio] = useState(false);

  // ── COMPLIANCE EN VIVO: debounce 400ms mientras el usuario escribe el nombre ──
  // Construye el nombre completo según el tipo de cliente y consulta OFAC/PEP/CNBV
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const fullName = clientType === 'PHYSICAL'
      ? `${firstName} ${lastName}`.trim()
      : legalRepName || razonSocial;

    // Mínimo 5 caracteres para evitar búsquedas vacías o de 1 letra
    if (fullName.length < 5) {
      setComplianceCheck(null);
      setComplianceLoading(false);
      return;
    }

    // Limpiar debounce anterior
    if (debounceRef.current) clearTimeout(debounceRef.current);

    setComplianceLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/compliance/search-lists?q=${encodeURIComponent(fullName)}`);
        if (res.ok) {
          const json = await res.json();
          setComplianceCheck({
            level: json.data?.riskLevel || "VERDE",
            matches: json.data?.matches || [],
          });
        }
      } catch (err) {
        console.error("Compliance live check error:", err);
      } finally {
        setComplianceLoading(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [firstName, lastName, legalRepName, razonSocial, clientType]);

  // Compliance: verificar listas al registrar (fallback de seguridad)
  const checkComplianceLists = async (fullName: string) => {
    setComplianceLoading(true);
    setComplianceCheck(null);
    try {
      const res = await fetch(`/api/compliance/search-lists?q=${encodeURIComponent(fullName)}`);
      if (res.ok) {
        const json = await res.json();
        const level = json.data?.riskLevel || "VERDE";
        const matches = json.data?.matches || [];
        setComplianceCheck({ level, matches });
        return { level, matches };
      }
    } catch (err) {
      console.error("Compliance check error:", err);
    } finally {
      setComplianceLoading(false);
    }
    return { level: "VERDE", matches: [] };
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    // Validation Check on Frontend as well
    if (clientType === 'PHYSICAL') {
      if (!firstName || !lastName) {
        setErrorMsg("El nombre y apellidos son campos obligatorios.");
        return;
      }
      if (!rfcCurp) {
        setErrorMsg("El RFC / CURP es obligatorio.");
        return;
      }
      if (!officialIdFile) {
        setErrorMsg("Por favor, suba una Identificación Oficial vigente para continuar.");
        return;
      }
    } else {
      if (!razonSocial) {
        setErrorMsg("La Razón Social (sin abreviaturas) es obligatoria.");
        return;
      }
      if (!companyRfc) {
        setErrorMsg("El RFC de la empresa es obligatorio.");
        return;
      }
      if (!businessLine) {
        setErrorMsg("Por favor, seleccione el Giro Comercial del negocio.");
        return;
      }
      if (!legalRepName) {
        setErrorMsg("El nombre del Representante Legal es obligatorio.");
        return;
      }
      if (!legalRepId) {
        setErrorMsg("La clave de identificación del Representante Legal es obligatoria.");
        return;
      }
      if (!actaConstitutivaFile) {
        setErrorMsg("El Acta Constitutiva de la empresa es obligatoria.");
        return;
      }
      if (!comprobanteDomicilioFile) {
        setErrorMsg("El Comprobante de Domicilio Fiscal es obligatorio.");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      // ── COMPLIANCE: Verificar listas OFAC/PEP/CNBV antes de registrar ──
      const fullName = clientType === 'PHYSICAL' 
        ? `${firstName} ${lastName}`.trim()
        : legalRepName || razonSocial;
      
      if (fullName) {
        const { level } = await checkComplianceLists(fullName);
        if (level === "ROJO") {
          setErrorMsg(`⚠️ ALERTA DE COMPLIANCE: El nombre "${fullName}" coincide con listas OFAC/PEP. El registro ha sido bloqueado por seguridad. Consulte con el oficial de cumplimiento.`);
          setIsSubmitting(false);
          return;
        }
      }

      const formData = new FormData();
      formData.append("clientType", clientType);
      formData.append("email", email);
      formData.append("phone", phone);
      formData.append("estimatedMonthlyAmount", estimatedMonthlyAmount);
      formData.append("estimatedOperations", estimatedOperations);
      formData.append("sourceDestinationFunds", sourceDestinationFunds);

      if (clientType === 'PHYSICAL') {
        formData.append("firstName", firstName);
        formData.append("lastName", lastName);
        formData.append("rfcCurp", rfcCurp);
        if (officialIdFile) formData.append("officialIdFile", officialIdFile);
      } else {
        formData.append("razonSocial", razonSocial);
        formData.append("companyRfc", companyRfc);
        formData.append("businessLine", businessLine);
        formData.append("legalRepName", legalRepName);
        formData.append("legalRepId", legalRepId);
        formData.append("isB2b", String(isB2b));
        if (actaConstitutivaFile) formData.append("actaConstitutivaFile", actaConstitutivaFile);
        if (comprobanteDomicilioFile) formData.append("comprobanteDomicilioFile", comprobanteDomicilioFile);
      }

      const res = await fetch("/api/kyc/quick-register", {
        method: "POST",
        body: formData, // Browser automatically sets Content-Type to multipart/form-data with boundary
      });

      const data = await res.json();
      if (res.ok && data.status === "success") {
        setSuccessMsg("¡Registro y expediente digital creados exitosamente!");
        setTimeout(() => {
          onSuccess(data.customer);
        }, 1500);
      } else {
        setErrorMsg(data.message || "Error al registrar el expediente digital.");
      }
    } catch (error) {
      console.error("Error in customer kyc register:", error);
      setErrorMsg("Ocurrió un error de red o de servidor. Intente de nuevo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDrag = (e: DragEvent, setDragActive: (active: boolean) => void) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: DragEvent, setFile: (file: File) => void, setDragActive: (active: boolean) => void) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div id="quick-register-backdrop" className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md overflow-y-auto">
      <motion.div 
        id="quick-register-modal-content"
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-[#1e2329] border border-[#2b3139] rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl my-8 text-left"
      >
        {/* Header */}
        <div className="p-6 border-b border-[#2b3139] flex items-center justify-between bg-[#181a20]/60">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-binance-yellow/10 rounded-xl text-binance-yellow">
              <Building2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Alta Unificada y Expediente Digital (KYC)</h2>
              <p className="text-[10px] text-gray-400 font-mono">CUMPLIMIENTO NORMATIVO CNBV & PLD</p>
            </div>
          </div>
          <button id="close-register-modal-btn" onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1 hover:bg-white/5 rounded-lg">
            <X size={24} />
          </button>
        </div>

        {/* Dynamic Dual Tab Selector */}
        <div className="p-6 pb-0">
          <div className="grid grid-cols-2 gap-2 bg-[#181a20] p-1.5 rounded-xl border border-[#2b3139]">
            <button
              id="tab-select-physical-person"
              type="button"
              onClick={() => {
                setClientType('PHYSICAL');
                setErrorMsg(null);
              }}
              className={`py-3 rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-2 transition-all ${
                clientType === 'PHYSICAL' 
                  ? "bg-binance-yellow text-black shadow-lg font-black" 
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <User size={16} /> Persona Física (Individual)
            </button>
            <button
              id="tab-select-moral-person"
              type="button"
              onClick={() => {
                setClientType('MORAL');
                setErrorMsg(null);
              }}
              className={`py-3 rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-2 transition-all ${
                clientType === 'MORAL' 
                  ? "bg-binance-yellow text-black shadow-lg font-black" 
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Building2 size={16} /> Persona Moral (Empresas B2B)
            </button>
          </div>
        </div>

        {/* Alerts */}
        <div className="px-6 pt-4 space-y-3">
          {complianceLoading && (
            <div className="p-3 bg-binance-yellow/5 border border-binance-yellow/20 rounded-xl flex items-center gap-2 text-binance-yellow text-xs">
              <RefreshCw size={14} className="animate-spin" />
              <span className="font-medium">Verificando listas OFAC / PEP / CNBV...</span>
            </div>
          )}
          {complianceCheck && !complianceLoading && (
            <div className={`p-3 rounded-xl flex items-center gap-2 text-xs ${
              complianceCheck.level === 'ROJO' 
                ? "bg-red-500/10 border border-red-500/30 text-red-400"
                : complianceCheck.level === 'AMARILLO'
                ? "bg-yellow-500/10 border border-yellow-500/30 text-yellow-500"
                : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
            }`}>
              <ShieldCheck size={14} />
              <span className="font-bold">
                Compliance: {complianceCheck.level === 'VERDE' ? '✅ Sin coincidencias' : complianceCheck.level === 'AMARILLO' ? '⚠️ Coincidencia parcial' : '🚫 Coincidencia en lista'}
                {complianceCheck.matches.length > 0 && ` (${complianceCheck.matches.length} match${complianceCheck.matches.length > 1 ? 'es' : ''})`}
              </span>
            </div>
          )}
          {errorMsg && (
            <div id="register-error-alert" className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3 text-red-400 text-xs animate-shake">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Error de Cumplimiento / Validación</p>
                <p className="mt-1 leading-relaxed">{errorMsg}</p>
              </div>
            </div>
          )}
          {successMsg && (
            <div id="register-success-alert" className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-start gap-3 text-emerald-400 text-xs animate-bounce">
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Expediente Registrado</p>
                <p className="mt-1 leading-relaxed">{successMsg}</p>
              </div>
            </div>
          )}
        </div>

        {/* Main Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            
            {/* Conditional Left side: Client Type Details */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-binance-yellow uppercase tracking-widest flex items-center gap-2 pb-2 border-b border-white/5">
                Datos de Constitución e Identidad
              </h3>

              {clientType === 'PHYSICAL' ? (
                // --- PHYSICAL PERSON FIELDS ---
                <div className="space-y-4 animate-fadeIn">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Nombre(s) *</label>
                      <input 
                        required
                        id="register-first-name"
                        type="text" 
                        placeholder="ej: Juan"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-2.5 px-3.5 text-xs text-white focus:outline-none focus:border-binance-yellow placeholder:text-gray-600 transition-colors"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Apellidos *</label>
                      <input 
                        required
                        id="register-last-name"
                        type="text" 
                        placeholder="ej: Pérez Gómez"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-2.5 px-3.5 text-xs text-white focus:outline-none focus:border-binance-yellow placeholder:text-gray-600 transition-colors"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">RFC / CURP con Homoclave *</label>
                    <input 
                      required
                      id="register-rfc-curp"
                      type="text" 
                      placeholder="ej: PEGJ820101HDFLMR04"
                      maxLength={18}
                      value={rfcCurp}
                      onChange={(e) => setRfcCurp(e.target.value.toUpperCase())}
                      className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-2.5 px-3.5 text-xs text-white focus:outline-none focus:border-binance-yellow font-mono placeholder:text-gray-600 transition-colors"
                    />
                  </div>

                  {/* Drag-and-drop Official ID Document */}
                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Identificación Oficial Vigente *</label>
                    <div 
                      id="official-id-dropzone"
                      onDragEnter={(e) => handleDrag(e, setDragActiveId)}
                      onDragOver={(e) => handleDrag(e, setDragActiveId)}
                      onDragLeave={(e) => handleDrag(e, setDragActiveId)}
                      onDrop={(e) => handleDrop(e, setOfficialIdFile, setDragActiveId)}
                      className={`bg-[#181a20] border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                        dragActiveId ? "border-binance-yellow bg-binance-yellow/5" : "border-[#2b3139] hover:border-gray-500"
                      }`}
                    >
                      <label className="cursor-pointer block">
                        {officialIdFile ? (
                          <div className="flex flex-col items-center justify-center gap-2">
                            <CheckCircle2 className="text-emerald-500" size={32} />
                            <span id="official-id-filename" className="text-xs text-white font-medium max-w-[280px] truncate">{officialIdFile.name}</span>
                            <span className="text-[10px] text-gray-500">{(officialIdFile.size / 1024 / 1024).toFixed(2)} MB</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-2">
                            <Upload className="text-gray-500" size={32} />
                            <span className="text-xs text-gray-300">Arrastre o seleccione su INE, Pasaporte o Cédula</span>
                            <span className="text-[10px] text-gray-500">Soportado: PDF, JPG, PNG de hasta 10MB</span>
                          </div>
                        )}
                        <input 
                          id="official-id-file-input"
                          type="file" 
                          className="hidden" 
                          accept="image/*,.pdf"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setOfficialIdFile(e.target.files[0]);
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              ) : (
                // --- MORAL PERSON FIELDS ---
                <div className="space-y-4 animate-fadeIn">
                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Razón Social * <span className="text-[9px] text-amber-500">(Sin abreviaturas normativas)</span></label>
                    <input 
                      required
                      id="register-razon-social"
                      type="text" 
                      placeholder="ej: Negocios Internacionales del Norte"
                      value={razonSocial}
                      onChange={(e) => setRazonSocial(e.target.value)}
                      className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-2.5 px-3.5 text-xs text-white focus:outline-none focus:border-binance-yellow placeholder:text-gray-600 transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">RFC de la Empresa *</label>
                      <input 
                        required
                        id="register-company-rfc"
                        type="text" 
                        placeholder="ej: NIN220101XYZ"
                        maxLength={12}
                        value={companyRfc}
                        onChange={(e) => setCompanyRfc(e.target.value.toUpperCase())}
                        className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-2.5 px-3.5 text-xs text-white focus:outline-none focus:border-binance-yellow font-mono placeholder:text-gray-600 transition-colors"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Giro Comercial *</label>
                      <select 
                        required
                        id="register-business-line"
                        value={businessLine}
                        onChange={(e) => setBusinessLine(e.target.value)}
                        className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-2.5 px-3.5 text-xs text-white focus:outline-none focus:border-binance-yellow transition-colors"
                      >
                        <option value="">Seleccione giro</option>
                        <option value="IMPORT_EXPORT">Comercio Exterior / Importación</option>
                        <option value="FINANCIAL_SERVICES">Servicios Financieros / Fintech</option>
                        <option value="REAL_ESTATE">Inmobiliario / Fideicomisos</option>
                        <option value="CONSTRUCTION">Construcción y Acero</option>
                        <option value="LOGISTICS">Logística y Logística Binacional</option>
                        <option value="RETAIL_WHOLESALE">Distribución / Mayorista</option>
                        <option value="TECHNOLOGY">Tecnología y Software</option>
                        <option value="OTHER">Otro Giro Operativo</option>
                      </select>
                    </div>
                  </div>

                  {/* Representative details */}
                  <div className="p-4 bg-[#181a20] rounded-xl border border-[#2b3139] space-y-3">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-binance-yellow uppercase">
                      <Briefcase size={14} /> Representante Legal
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[9px] text-gray-400 uppercase">Nombre Completo *</label>
                        <input 
                          required
                          id="register-legal-rep-name"
                          type="text" 
                          placeholder="ej: Carlos Slim Domit"
                          value={legalRepName}
                          onChange={(e) => setLegalRepName(e.target.value)}
                          className="w-full bg-[#1e2329] border border-[#2b3139] rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-binance-yellow"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] text-gray-400 uppercase">ID No. (INE/Pasaporte) *</label>
                        <input 
                          required
                          id="register-legal-rep-id"
                          type="text" 
                          placeholder="ej: ID-831920X"
                          value={legalRepId}
                          onChange={(e) => setLegalRepId(e.target.value)}
                          className="w-full bg-[#1e2329] border border-[#2b3139] rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-binance-yellow"
                        />
                      </div>
                    </div>
                  </div>

                  {/* B2B / Flujo Kappa Selector */}
                  <div className="p-4 bg-binance-yellow/5 border border-binance-yellow/20 rounded-xl flex items-center justify-between">
                    <div className="space-y-1 text-left">
                      <p className="text-xs font-bold text-white flex items-center gap-1">
                        Habilitar Aliado B2B <span className="text-[9px] text-binance-yellow font-bold uppercase px-1.5 py-0.5 bg-binance-yellow/10 rounded">Flujo Kappa</span>
                      </p>
                      <p className="text-[10px] text-gray-400 leading-relaxed max-w-[300px]">
                        Habilita el registro de ventas como Cuentas por Cobrar bajo el límite normativo de $14,000 USD mensuales.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        id="register-is-b2b-checkbox"
                        type="checkbox" 
                        checked={isB2b} 
                        onChange={(e) => setIsB2b(e.target.checked)}
                        className="sr-only peer" 
                      />
                      <div className="w-11 h-6 bg-[#181a20] border border-[#2b3139] rounded-full peer peer-focus:ring-0 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-gray-400 after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-binance-yellow peer-checked:after:bg-black"></div>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Right Side: Shared contact, financial details, and Corporate Document Uploader */}
            <div className="space-y-6">
              
              {/* Moral Person Documents */}
              {clientType === 'MORAL' && (
                <div className="space-y-4 animate-fadeIn">
                  <h3 className="text-xs font-bold text-binance-yellow uppercase tracking-widest flex items-center gap-2 pb-2 border-b border-white/5">
                    Expediente Documental Requerido (Obligatorio)
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Acta Constitutiva */}
                    <div className="space-y-2">
                      <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Acta Constitutiva *</label>
                      <div 
                        id="acta-constitutiva-dropzone"
                        onDragEnter={(e) => handleDrag(e, setDragActiveActa)}
                        onDragOver={(e) => handleDrag(e, setDragActiveActa)}
                        onDragLeave={(e) => handleDrag(e, setDragActiveActa)}
                        onDrop={(e) => handleDrop(e, setActaConstitutivaFile, setDragActiveActa)}
                        className={`bg-[#181a20] border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                          dragActiveActa ? "border-binance-yellow bg-binance-yellow/5" : "border-[#2b3139] hover:border-gray-500"
                        }`}
                      >
                        <label className="cursor-pointer block">
                          {actaConstitutivaFile ? (
                            <div className="flex flex-col items-center gap-1.5">
                              <CheckCircle2 className="text-emerald-500" size={24} />
                              <span id="acta-constitutiva-filename" className="text-[10px] text-white font-medium max-w-[150px] truncate">{actaConstitutivaFile.name}</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1.5">
                              <Upload className="text-gray-500" size={24} />
                              <span className="text-[10px] text-gray-300">Subir Acta Constitutiva</span>
                            </div>
                          )}
                          <input 
                            id="acta-constitutiva-file-input"
                            type="file" 
                            className="hidden" 
                            accept="image/*,.pdf"
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                setActaConstitutivaFile(e.target.files[0]);
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    {/* Comprobante de Domicilio */}
                    <div className="space-y-2">
                      <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Comp. Domicilio Fiscal *</label>
                      <div 
                        id="comprobante-domicilio-dropzone"
                        onDragEnter={(e) => handleDrag(e, setDragActiveDomicilio)}
                        onDragOver={(e) => handleDrag(e, setDragActiveDomicilio)}
                        onDragLeave={(e) => handleDrag(e, setDragActiveDomicilio)}
                        onDrop={(e) => handleDrop(e, setComprobanteDomicilioFile, setDragActiveDomicilio)}
                        className={`bg-[#181a20] border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                          dragActiveDomicilio ? "border-binance-yellow bg-binance-yellow/5" : "border-[#2b3139] hover:border-gray-500"
                        }`}
                      >
                        <label className="cursor-pointer block">
                          {comprobanteDomicilioFile ? (
                            <div className="flex flex-col items-center gap-1.5">
                              <CheckCircle2 className="text-emerald-500" size={24} />
                              <span id="comprobante-domicilio-filename" className="text-[10px] text-white font-medium max-w-[150px] truncate">{comprobanteDomicilioFile.name}</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1.5">
                              <Upload className="text-gray-500" size={24} />
                              <span className="text-[10px] text-gray-300">Subir Comp. de Domicilio</span>
                            </div>
                          )}
                          <input 
                            id="comprobante-domicilio-file-input"
                            type="file" 
                            className="hidden" 
                            accept="image/*,.pdf"
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                setComprobanteDomicilioFile(e.target.files[0]);
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Shared Contact info */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-binance-yellow uppercase tracking-widest flex items-center gap-2 pb-2 border-b border-white/5">
                  Contacto & Notificaciones
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Correo Electrónico</label>
                    <input 
                      id="register-email"
                      type="email" 
                      placeholder="ej: cliente@ejemplo.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-2.5 px-3.5 text-xs text-white focus:outline-none focus:border-binance-yellow placeholder:text-gray-600 transition-colors"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Teléfono / WhatsApp</label>
                    <input 
                      id="register-phone"
                      type="tel" 
                      placeholder="ej: +52 664 123 4567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-2.5 px-3.5 text-xs text-white focus:outline-none focus:border-binance-yellow placeholder:text-gray-600 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Shared Transactional Profile */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-binance-yellow uppercase tracking-widest flex items-center gap-2 pb-2 border-b border-white/5">
                  Perfil Transaccional Previsto
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Monto mensual est. (USD)</label>
                    <input 
                      id="register-estimated-amount"
                      type="number" 
                      placeholder="ej: 5000"
                      value={estimatedMonthlyAmount}
                      onChange={(e) => setEstimatedMonthlyAmount(e.target.value)}
                      className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-2.5 px-3.5 text-xs text-white focus:outline-none focus:border-binance-yellow placeholder:text-gray-600 transition-colors"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider font-mono">Ops. Estimadas / Mes</label>
                    <input 
                      id="register-estimated-ops"
                      type="number" 
                      placeholder="ej: 12"
                      value={estimatedOperations}
                      onChange={(e) => setEstimatedOperations(e.target.value)}
                      className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-2.5 px-3.5 text-xs text-white focus:outline-none focus:border-binance-yellow placeholder:text-gray-600 transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Origen / Destino de los Fondos *</label>
                  <select 
                    required
                    id="register-funds-source"
                    value={sourceDestinationFunds}
                    onChange={(e) => setSourceDestinationFunds(e.target.value)}
                    className="w-full bg-[#181a20] border border-[#2b3139] rounded-xl py-2.5 px-3.5 text-xs text-white focus:outline-none focus:border-binance-yellow transition-colors"
                  >
                    <option value="">Seleccione origen</option>
                    <option value="SALARY">Sueldos y Salarios Recurrentes</option>
                    <option value="BUSINESS">Actividad Empresarial / Flujo de Caja</option>
                    <option value="SAVINGS">Ahorros Personales</option>
                    <option value="INVESTMENTS">Retorno de Inversiones</option>
                    <option value="OTHER">Otros Orígenes Lícitos</option>
                  </select>
                </div>
              </div>

            </div>
          </div>

          {/* Action buttons */}
          <div className="pt-6 border-t border-[#2b3139] flex gap-4">
            <button 
              id="cancel-register-btn"
              type="button"
              onClick={onClose}
              className="flex-1 py-3.5 rounded-xl border border-[#2b3139] text-gray-400 font-bold hover:bg-white/5 transition-colors uppercase text-xs tracking-wider"
            >
              CANCELAR
            </button>
            <button 
              id="submit-register-btn"
              type="submit"
              disabled={isSubmitting || complianceCheck?.level === 'ROJO'}
              className={`flex-1 py-3.5 rounded-xl font-black transition-colors flex items-center justify-center gap-2 uppercase text-xs tracking-wider ${
                complianceCheck?.level === 'ROJO'
                  ? 'bg-red-500/20 text-red-500 border border-red-500/30 cursor-not-allowed'
                  : 'bg-binance-yellow text-black hover:bg-yellow-500 shadow-lg shadow-binance-yellow/10'
              }`}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="animate-spin" size={16} /> Verificando KYC y Guardando...
                </>
              ) : complianceCheck?.level === 'ROJO' ? (
                <>
                  <ShieldCheck size={16} /> BLOQUEADO POR COMPLIANCE
                </>
              ) : (
                "REGISTRAR CLIENTE Y VALIDAR EXPEDIENTE"
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
