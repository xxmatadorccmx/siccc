import React, { useState, useEffect } from 'react';
import { 
  Save, ShieldCheck, Fingerprint, RefreshCw, AlertCircle, UserPlus, CheckCircle2, 
  Briefcase, FileText, BookOpen, Lock, Unlock, Download, ChevronRight, ChevronLeft, 
  UserCheck, FileCheck, Eye, History, User, Building, Upload,
  TrendingUp, Percent, Power, Coins, Layers, ToggleLeft, ToggleRight, DollarSign
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { RoleLevel, ROLE_NAMES } from '../types/auth';
import CapitalHumanoWorkspace from '../components/CapitalHumanoWorkspace';
import UserManagementPanel from '../components/UserManagementPanel';

interface CurrencyRate {
  code: string;
  name: string;
  buy: number;
  sell: number;
  lastUpdate: string;
}

export default function Settings() {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'pre-contratacion' | 'monitor-onboarding' | 'expediente-digital' | 'asignacion-operativa' | 'rates' | 'branch'>('pre-contratacion');
  const [activeModal, setActiveModal] = useState<'user' | 'rates' | 'branch' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [rates, setRates] = useState<CurrencyRate[]>([]);
  
  // Branch State Variables
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('MAIN_BRANCH');
  const [branchForm, setBranchForm] = useState({
    sucursal_id: 'MAIN_BRANCH',
    nombre: '',
    razon_social: '',
    rfc: '',
    calle: '',
    numero: '',
    colonia: '',
    ciudad: '',
    codigo_postal: '',
    telefono: '',
    email: '',
    licencia_cnbv: '',
    logo_url: '',
    es_matriz: 0
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [savingBranch, setSavingBranch] = useState(false);
  const [syncingInterface, setSyncingInterface] = useState(false);
  const [syncingFiscal, setSyncingFiscal] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branchSuccess, setBranchSuccess] = useState<string | null>(null);

  // ===== EXCHANGE RATE CONFIGURATION STATE =====
  const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'USDT'] as const;
  type CurrencyCode = typeof CURRENCIES[number];

  const [exchangeRates, setExchangeRates] = useState<Record<string, { buy: number; sell: number }>>({
    USD: { buy: 18.45, sell: 19.55 },
    EUR: { buy: 20.10, sell: 21.30 },
    GBP: { buy: 23.45, sell: 24.80 },
    CAD: { buy: 13.60, sell: 14.45 },
    USDT: { buy: 17.05, sell: 17.10 },
  });
  const [operableCurrencies, setOperableCurrencies] = useState<Record<string, boolean>>({
    USD: true,
    EUR: true,
    GBP: true,
    CAD: true,
    USDT: true,
  });
  const [loadingExchangeRates, setLoadingExchangeRates] = useState(false);
  const [savingExchangeRates, setSavingExchangeRates] = useState(false);
  const [exchangeRatesSuccess, setExchangeRatesSuccess] = useState<string | null>(null);
  const [exchangeRatesError, setExchangeRatesError] = useState<string | null>(null);
  const [lastRatesSync, setLastRatesSync] = useState<string>('');

  // ===== COMMISSION THRESHOLDS STATE (volume-based, per ally) =====
  interface CommissionTier {
    id: string;
    currency: string;
    minVolume: number;
    maxVolume: number;
    commissionPct: number;
  }
  const [commissionTiers, setCommissionTiers] = useState<CommissionTier[]>([
    { id: 't1', currency: 'USD', minVolume: 0, maxVolume: 10000, commissionPct: 1.5 },
    { id: 't2', currency: 'USD', minVolume: 10001, maxVolume: 50000, commissionPct: 1.2 },
    { id: 't3', currency: 'USD', minVolume: 50001, maxVolume: 9999999, commissionPct: 1.0 },
    { id: 't4', currency: 'EUR', minVolume: 0, maxVolume: 10000, commissionPct: 1.5 },
    { id: 't5', currency: 'EUR', minVolume: 10001, maxVolume: 50000, commissionPct: 1.2 },
    { id: 't6', currency: 'EUR', minVolume: 50001, maxVolume: 9999999, commissionPct: 1.0 },
    { id: 't7', currency: 'GBP', minVolume: 0, maxVolume: 10000, commissionPct: 1.8 },
    { id: 't8', currency: 'GBP', minVolume: 10001, maxVolume: 50000, commissionPct: 1.4 },
    { id: 't9', currency: 'GBP', minVolume: 50001, maxVolume: 9999999, commissionPct: 1.1 },
    { id: 't10', currency: 'CAD', minVolume: 0, maxVolume: 10000, commissionPct: 1.5 },
    { id: 't11', currency: 'CAD', minVolume: 10001, maxVolume: 50000, commissionPct: 1.2 },
    { id: 't12', currency: 'CAD', minVolume: 50001, maxVolume: 9999999, commissionPct: 1.0 },
    { id: 't13', currency: 'USDT', minVolume: 0, maxVolume: 10000, commissionPct: 0.8 },
    { id: 't14', currency: 'USDT', minVolume: 10001, maxVolume: 50000, commissionPct: 0.6 },
    { id: 't15', currency: 'USDT', minVolume: 50001, maxVolume: 9999999, commissionPct: 0.5 },
  ]);
  const [loadingCommission, setLoadingCommission] = useState(false);
  const [savingCommission, setSavingCommission] = useState(false);
  const [commissionSuccess, setCommissionSuccess] = useState<string | null>(null);
  const [commissionError, setCommissionError] = useState<string | null>(null);

  const fetchBranches = async () => {
    try {
      const res = await fetch('/api/sucursales');
      if (res.ok) {
        const body = await res.json();
        const data = body.data || [];
        setBranches(data);
        const main = data.find((b: any) => b.sucursal_id === selectedBranchId) || data[0];
        if (main) {
          setBranchForm({
            ...main,
            es_matriz: main.es_matriz || 0
          });
          setLogoPreview(main.logo_url || '');
        }
      }
    } catch (err) {
      console.error("Error fetching branches:", err);
    }
  };

  const handleBranchSelectChange = (branchId: string) => {
    setSelectedBranchId(branchId);
    if (branchId === 'NEW') {
      setBranchForm({
        sucursal_id: '',
        nombre: 'Nueva Sucursal',
        razon_social: '',
        rfc: '',
        calle: '',
        numero: '',
        colonia: '',
        ciudad: '',
        codigo_postal: '',
        telefono: '',
        email: '',
        licencia_cnbv: '',
        logo_url: '',
        es_matriz: 0
      });
      setLogoPreview('');
      setLogoFile(null);
    } else {
      const b = branches.find((x: any) => x.sucursal_id === branchId);
      if (b) {
        setBranchForm({
          ...b,
          es_matriz: b.es_matriz || 0
        });
        setLogoPreview(b.logo_url || '');
        setLogoFile(null);
      }
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveBranch = async () => {
    setBranchError(null);
    setBranchSuccess(null);
    
    if (!branchForm.nombre.trim()) {
      setBranchError("El nombre de la sucursal es obligatorio.");
      return;
    }

    setSavingBranch(true);
    try {
      let finalLogoUrl = branchForm.logo_url;
      let targetId = branchForm.sucursal_id;
      
      if (!targetId) {
        targetId = `sucursal_${branchForm.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;
      }

      if (logoPreview && logoPreview.startsWith('data:')) {
        const uploadRes = await fetch('/api/sucursales/upload-logo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sucursal_id: targetId,
            logo_base64: logoPreview
          })
        });
        
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          finalLogoUrl = uploadData.logo_url;
        } else {
          const errData = await uploadRes.json();
          throw new Error(errData.message || "Error al subir logotipo");
        }
      }

      // Modo Inteligente de Captura: si es secundaria, hereda los campos fiscales de la matriz existente antes de guardar
      let finalRazonSocial = branchForm.razon_social;
      let finalRfc = branchForm.rfc;
      let finalLicenciaCnbv = branchForm.licencia_cnbv;

      if (!branchForm.es_matriz) {
        const currentMatriz = branches.find(b => b.es_matriz === 1);
        if (currentMatriz) {
          finalRazonSocial = currentMatriz.razon_social;
          finalRfc = currentMatriz.rfc;
          finalLicenciaCnbv = currentMatriz.licencia_cnbv;
        }
      }

      const payload = {
        ...branchForm,
        sucursal_id: targetId,
        razon_social: finalRazonSocial,
        rfc: finalRfc,
        licencia_cnbv: finalLicenciaCnbv,
        logo_url: finalLogoUrl
      };

      const saveRes = await fetch('/api/sucursales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (saveRes.ok) {
        const saveData = await saveRes.json();
        setBranchSuccess("¡Sucursal guardada exitosamente en el sistema!");
        await fetchBranches();
        setSelectedBranchId(saveData.data.sucursal_id);
        setBranchForm(saveData.data);
      } else {
        const errData = await saveRes.json();
        throw new Error(errData.message || "Error al guardar sucursal");
      }
    } catch (err: any) {
      setBranchError(err.message || "Ocurrió un error al procesar el guardado.");
    } finally {
      setSavingBranch(false);
    }
  };

  const handlePushFiscal = async () => {
    setBranchError(null);
    setBranchSuccess(null);
    setSyncingFiscal(true);
    try {
      const res = await fetch('/api/sucursales/push-fiscal', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setBranchSuccess(data.message || "Sincronización fiscal global exitosa.");
        await fetchBranches();
      } else {
        throw new Error(data.message || "Fallo al empujar datos fiscales.");
      }
    } catch (err: any) {
      setBranchError(err.message || "Error al propagar datos fiscales globales.");
    } finally {
      setSyncingFiscal(false);
    }
  };

  const handleSyncInterface = async () => {
    setBranchError(null);
    setBranchSuccess(null);
    setSyncingInterface(true);
    try {
      const res = await fetch('/api/sucursales/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setBranchSuccess(data.message || "Interfaz sincronizada y caché invalidada.");
        window.dispatchEvent(new CustomEvent('sync-branches'));
      } else {
        throw new Error("Fallo en sincronización remota");
      }
    } catch (err: any) {
      setBranchError(err.message || "Error al sincronizar.");
    } finally {
      setSyncingInterface(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  // ===== EXCHANGE RATE CONFIGURATION FUNCTIONS =====
  const fetchExchangeRates = async () => {
    setLoadingExchangeRates(true);
    setExchangeRatesError(null);
    try {
      const res = await fetch('/api/rates/live');
      if (res.ok) {
        const data = await res.json();
        if (data.rates) {
          const loaded: Record<string, { buy: number; sell: number }> = {};
          Object.keys(data.rates).forEach(key => {
            const code = key.split('_')[0];
            if (code !== 'MXN' && CURRENCIES.includes(code as CurrencyCode)) {
              loaded[code] = {
                buy: data.rates[key].buy,
                sell: data.rates[key].sell,
              };
            }
          });
          if (Object.keys(loaded).length > 0) {
            setExchangeRates(loaded);
          }
          const timestamps = Object.values(data.rates).map((r: any) => r.timestamp);
          if (timestamps.length > 0) {
            const latest = new Date(Math.max(...timestamps.map((t: any) => new Date(t).getTime())));
            setLastRatesSync(latest.toLocaleString());
          } else {
            setLastRatesSync(new Date().toLocaleString());
          }
        }
      }
    } catch (err) {
      console.error('Error fetching exchange rates:', err);
    } finally {
      setLoadingExchangeRates(false);
    }
  };

  const handleSaveExchangeRates = async () => {
    setSavingExchangeRates(true);
    setExchangeRatesError(null);
    setExchangeRatesSuccess(null);
    try {
      const res = await fetch('/api/rates/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates: exchangeRates }),
      });
      if (res.ok) {
        setExchangeRatesSuccess('¡Tipos de cambio guardados y propagados a todas las terminales!');
        await fetchExchangeRates();
      } else {
        const errData = await res.json();
        throw new Error(errData.message || 'Error al actualizar los tipos de cambio.');
      }
    } catch (err: any) {
      setExchangeRatesError(err.message || 'Fallo en la comunicación con el servidor.');
    } finally {
      setSavingExchangeRates(false);
    }
  };

  const toggleCurrency = (code: string) => {
    setOperableCurrencies(prev => ({ ...prev, [code]: !prev[code] }));
  };

  // ===== COMMISSION THRESHOLDS FUNCTIONS =====
  const fetchCommissionThresholds = async () => {
    setLoadingCommission(true);
    setCommissionError(null);
    try {
      const res = await fetch('/api/commission/thresholds');
      if (res.ok) {
        const data = await res.json();
        if (data.tiers && Array.isArray(data.tiers) && data.tiers.length > 0) {
          setCommissionTiers(data.tiers);
        }
      }
    } catch (err) {
      console.error('Error fetching commission thresholds:', err);
    } finally {
      setLoadingCommission(false);
    }
  };

  const handleSaveCommission = async () => {
    setSavingCommission(true);
    setCommissionError(null);
    setCommissionSuccess(null);
    try {
      const res = await fetch('/api/commission/thresholds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiers: commissionTiers }),
      });
      if (res.ok) {
        setCommissionSuccess('¡Umbrales de comisión guardados exitosamente!');
      } else {
        const errData = await res.json();
        throw new Error(errData.message || 'Error al guardar los umbrales.');
      }
    } catch (err: any) {
      setCommissionError(err.message || 'Fallo en la comunicación con el servidor.');
    } finally {
      setSavingCommission(false);
    }
  };

  const updateCommissionTier = (id: string, field: keyof CommissionTier, value: string | number) => {
    setCommissionTiers(prev => prev.map(t =>
      t.id === id ? { ...t, [field]: field === 'currency' ? String(value) : Number(value) } : t
    ));
  };

  const addCommissionTier = () => {
    const newId = `t_${Date.now()}`;
    setCommissionTiers(prev => [...prev, {
      id: newId,
      currency: 'USD',
      minVolume: 0,
      maxVolume: 10000,
      commissionPct: 1.5,
    }]);
  };

  const removeCommissionTier = (id: string) => {
    setCommissionTiers(prev => prev.filter(t => t.id !== id));
  };

  // Fetch exchange rates on mount
  useEffect(() => {
    fetchExchangeRates();
    fetchCommissionThresholds();
  }, []);

  // Vault Records State
  const [vaultRecords, setVaultRecords] = useState<any[]>([]);
  const [loadingVault, setLoadingVault] = useState(false);

  // Contracting Wizard Steps & Form State
  const [wizardStep, setWizardStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [generationResponse, setGenerationResponse] = useState<any>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [finalSuccess, setFinalSuccess] = useState(false);
  const [credentialsCreated, setCredentialsCreated] = useState<{auth_user_id: string, temp_password: string} | null>(null);

  const [wizardData, setWizardData] = useState({
    // Paso 1: Datos de Identidad
    nombre_completo: '',
    lugar_nacimiento: '',
    fecha_nacimiento: '',
    nacionalidad: 'MEXICANA',
    estado_civil: 'SOLTERO(A)',
    rfc: '',
    curp: '',
    domicilio: '',

    // Paso 2: Información Laboral y Fiscal
    puesto: 'Cajero de Ventanilla',
    sueldo_mensual: '18000',
    prestaciones: 'Vales de despensa, Fondo de ahorro, Seguro de vida',
    fecha_inicio: new Date().toISOString().split('T')[0],
    nss: '',
    infonavit_fonacot: 'NINGUNO',
    sucursal: 'MAIN_BRANCH',

    // Paso 3: Referencias y Expediente
    referencia1_nombre: '',
    referencia1_telefono: '',
    referencia1_parentesco: '',
    referencia2_nombre: '',
    referencia2_telefono: '',
    referencia2_parentesco: '',

    doc_id_oficial: true,
    doc_acta_nacimiento: false, // Cajero requires this true
    doc_comprobante_domicilio: true,
    doc_cartas_recomendacion: true
  });

  // Fetch Vault history
  const fetchVaultRecords = async () => {
    if (!profile || profile.role_level < 5) return;
    setLoadingVault(true);
    try {
      const savedUserId = localStorage.getItem('mock_user_id') || 'user_gerente_1';
      const res = await fetch('/api/hr/vault', {
        headers: { 'x-user-id': savedUserId }
      });
      if (res.ok) {
        const data = await res.json();
        setVaultRecords(data.files || []);
      }
    } catch (err) {
      console.error("Error loading HR vault records:", err);
    } finally {
      setLoadingVault(false);
    }
  };

  useEffect(() => {
    fetchVaultRecords();
  }, [profile]);

  // Form Validation per Step
  const validateStep = (step: number): boolean => {
    setFormError(null);
    const d = wizardData;

    if (step === 1) {
      if (!d.nombre_completo.trim()) return fail("El nombre completo es requerido.");
      if (!d.lugar_nacimiento.trim()) return fail("El lugar de nacimiento es requerido.");
      if (!d.fecha_nacimiento) return fail("La fecha de nacimiento es requerida.");
      if (!d.domicilio.trim()) return fail("El domicilio actual es requerido.");
      if (d.rfc.trim().length < 12 || d.rfc.trim().length > 13) {
        return fail("El RFC debe contener entre 12 y 13 caracteres alfanuméricos.");
      }
      if (d.curp.trim().length !== 18) {
        return fail("El CURP debe contener exactamente 18 caracteres.");
      }
    }

    if (step === 2) {
      if (!d.sueldo_mensual || parseFloat(d.sueldo_mensual) <= 0) {
        return fail("Ingrese un sueldo mensual válido mayor a $0.");
      }
      if (!d.nss.trim() || d.nss.trim().length !== 11) {
        return fail("El Número de Seguridad Social (NSS) debe contener exactamente 11 dígitos.");
      }
      if (!d.fecha_inicio) return fail("La fecha de inicio de labores es requerida.");
    }

    if (step === 3) {
      if (!d.referencia1_nombre.trim() || !d.referencia1_telefono.trim() || !d.referencia1_parentesco.trim()) {
        return fail("Complete la información de la Referencia Personal 1.");
      }
      if (!d.referencia2_nombre.trim() || !d.referencia2_telefono.trim() || !d.referencia2_parentesco.trim()) {
        return fail("Complete la información de la Referencia Personal 2.");
      }
      if (d.referencia1_telefono.trim().length !== 10 || d.referencia2_telefono.trim().length !== 10) {
        return fail("Los teléfonos de referencia deben contener exactamente 10 dígitos.");
      }

      // Strict Legal Requirement: Birth certificate original is mandatory for Cashiers
      const isCajero = d.puesto.toLowerCase().includes('cajero');
      if (isCajero && !d.doc_acta_nacimiento) {
        return fail("REQUISITO DE CUMPLIMIENTO: El Acta de Nacimiento Original es obligatoria y de carácter eliminatorio para puestos de Cajero.");
      }
    }

    return true;
  };

  const fail = (msg: string): boolean => {
    setFormError(msg);
    return false;
  };

  // Step 4: Generate Instruments
  const handleGenerateContracts = async () => {
    setFormError(null);
    setIsGenerating(true);
    try {
      const savedUserId = localStorage.getItem('mock_user_id') || 'user_gerente_1';
      const response = await fetch('/api/hr/vault/generate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': savedUserId
        },
        body: JSON.stringify(wizardData)
      });

      const resData = await response.json();
      if (response.ok) {
        setGenerationResponse(resData.data);
        fetchVaultRecords();
      } else {
        setFormError(resData.error || 'No se pudo generar el expediente digital.');
      }
    } catch (err) {
      setFormError('Fallo en la comunicación remota con el servidor de contratos.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFinalizeOnboarding = async () => {
    setFormError(null);
    setIsFinalizing(true);
    try {
      const savedUserId = localStorage.getItem('mock_user_id') || 'user_gerente_1';
      const response = await fetch('/api/hr/vault/finalize', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': savedUserId
        },
        body: JSON.stringify({ curp: wizardData.curp })
      });

      const resData = await response.json();
      if (response.ok) {
        setFinalSuccess(true);
        setCredentialsCreated({
          auth_user_id: resData.auth_user_id,
          temp_password: resData.temp_password
        });
        fetchVaultRecords();
        setTimeout(() => {
          setFinalSuccess(false);
          setActiveTab('monitor-onboarding');
          // reset wizard
          setWizardStep(1);
          setGenerationResponse(null);
          setWizardData({
            nombre_completo: '',
            lugar_nacimiento: '',
            fecha_nacimiento: '',
            nacionalidad: 'MEXICANA',
            estado_civil: 'SOLTERO(A)',
            rfc: '',
            curp: '',
            domicilio: '',
            puesto: 'Cajero de Ventanilla',
            sueldo_mensual: '18000',
            prestaciones: 'Vales de despensa, Fondo de ahorro, Seguro de vida',
            fecha_inicio: new Date().toISOString().split('T')[0],
            nss: '',
            infonavit_fonacot: 'NINGUNO',
            sucursal: 'MAIN_BRANCH',
            referencia1_nombre: '',
            referencia1_telefono: '',
            referencia1_parentesco: '',
            referencia2_nombre: '',
            referencia2_telefono: '',
            referencia2_parentesco: '',
            doc_id_oficial: true,
            doc_acta_nacimiento: false,
            doc_comprobante_domicilio: true,
            doc_cartas_recomendacion: true
          });
        }, 3000);
      } else {
        setFormError(resData.error || 'No se pudo consolidar el alta del colaborador.');
      }
    } catch (err) {
      setFormError('Fallo en la comunicación final con el servidor.');
    } finally {
      setIsFinalizing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 px-4 pb-20">
      {/* HEADER PRINCIPAL */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-[#2b3139] pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Centro de Control de Recursos Humanos y Configuración</h1>
          <p className="text-gray-400 text-xs mt-1">Módulo unificado para contratación automatizada, expedientes en Supabase, monitor de onboarding y alta de sucursales.</p>
        </div>

        {/* SIMULADOR DE PERFILES DE ACCESO */}
        <div className="bg-[#1e2329] border border-[#2b3139] rounded-2xl p-4 flex items-center gap-4">
          <div className="p-3 bg-binance-yellow/10 rounded-xl text-binance-yellow">
            <User size={20} />
          </div>
          <div>
            <span className="text-xs text-gray-500 uppercase font-black tracking-wider block">Perfil de Usuario Simulado</span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-bold text-white">
                {profile ? `${profile.nickname} (Nivel ${profile.role_level})` : 'Cargando...'}
              </span>
              <span className="text-xs text-binance-yellow font-mono">
                {profile?.auth_user_id || '—'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* WORKSPACE CENTRAL REESTRUCTURADO */}
      <CapitalHumanoWorkspace
        profile={profile}
        vaultRecords={vaultRecords}
        loadingVault={loadingVault}
        fetchVaultRecords={fetchVaultRecords}
        wizardStep={wizardStep}
        setWizardStep={setWizardStep}
        wizardData={wizardData}
        setWizardData={setWizardData}
        handleGenerateContracts={handleGenerateContracts}
        isGenerating={isGenerating}
        generationResponse={generationResponse}
        setGenerationResponse={setGenerationResponse}
        formError={formError}
        setFormError={setFormError}
        handleFinalizeOnboarding={handleFinalizeOnboarding}
        isFinalizing={isFinalizing}
        finalSuccess={finalSuccess}
        credentialsCreated={credentialsCreated}
        validateStep={validateStep}
        branches={branches}
        selectedBranchId={selectedBranchId}
        handleBranchSelectChange={handleBranchSelectChange}
        branchForm={branchForm}
        setBranchForm={setBranchForm}
        logoPreview={logoPreview}
        handleLogoChange={handleLogoChange}
        savingBranch={savingBranch}
        handleSaveBranch={handleSaveBranch}
        branchError={branchError}
        branchSuccess={branchSuccess}
        handleSyncInterface={handleSyncInterface}
        syncingInterface={syncingInterface}
        handlePushFiscal={handlePushFiscal}
        syncingFiscal={syncingFiscal}
      />

      {/* ============================================================ */}
      {/* GESTIÓN DE USUARIOS Y CREDENCIALES                            */}
      {/* ============================================================ */}
      <UserManagementPanel />

      {/* ============================================================ */}
      {/* CONFIGURACIÓN DE TIPOS DE CAMBIO Y UMBRALES DE COMISIÓN       */}
      {/* ============================================================ */}
      <section className="bg-gradient-to-b from-[#1c2227] to-[#151a1e] border border-[#2b3139] rounded-3xl p-6 md:p-8 shadow-xl space-y-8">

        {/* SECTION HEADER */}
        <div className="flex items-center gap-4 border-b border-[#2b3139] pb-6">
          <div className="p-3 bg-binance-yellow/10 text-binance-yellow rounded-2xl border border-binance-yellow/20">
            <TrendingUp size={24} />
          </div>
          <div>
            <span className="text-[10px] font-black text-binance-yellow uppercase tracking-widest block">Módulo Cambiario</span>
            <h2 className="text-lg font-bold text-white mt-0.5">Configuración de Tipos de Cambio y Comisiones</h2>
          </div>
        </div>

        {/* --- 1. TIPOS DE CAMBIO MANUALES --- */}
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <DollarSign size={16} className="text-binance-yellow" />
                Tipos de Cambio Manuales
              </h3>
              <p className="text-[11px] text-gray-400 mt-1 max-w-2xl leading-normal">
                Ingrese los tipos de cambio (TC) de compra y venta para cada divisa. Los cambios se propagan a todas las terminales de caja en tiempo real al guardar.
              </p>
            </div>
            <div className="shrink-0 bg-black/40 border border-[#2b3139] px-3 py-2 rounded-xl text-right">
              <span className="text-[9px] text-gray-500 uppercase block font-black">Última Sincronización</span>
              <span className="text-xs font-mono font-bold text-binance-yellow block mt-0.5">
                {lastRatesSync || 'Pendiente...'}
              </span>
            </div>
          </div>

          {exchangeRatesSuccess && (
            <div className="p-3 bg-binance-green/10 border border-binance-green/30 text-binance-green text-xs rounded-xl flex items-center gap-2">
              <CheckCircle2 size={15} />
              <span>{exchangeRatesSuccess}</span>
            </div>
          )}
          {exchangeRatesError && (
            <div className="p-3 bg-binance-red/10 border border-binance-red/30 text-binance-red text-xs rounded-xl flex items-center gap-2">
              <AlertCircle size={15} />
              <span>{exchangeRatesError}</span>
            </div>
          )}

          {loadingExchangeRates ? (
            <div className="py-12 text-center text-gray-500 text-xs flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-binance-yellow border-t-transparent rounded-full animate-spin" />
              Obteniendo cotizaciones del Core...
            </div>
          ) : (
            <div className="border border-[#2b3139]/60 rounded-2xl overflow-hidden shadow-xl">
              {/* Table header */}
              <div className="bg-black/30 px-4 py-3 border-b border-[#2b3139] grid grid-cols-12 text-left font-black uppercase text-[10px] text-gray-400 tracking-wider">
                <span className="col-span-4">Divisa</span>
                <span className="col-span-3">TC Compra</span>
                <span className="col-span-3">TC Venta</span>
                <span className="col-span-2 text-center">Operable</span>
              </div>
              {/* Table body */}
              <div className="divide-y divide-[#2b3139]/40 bg-[#151a1e]">
                {CURRENCIES.map((currency) => (
                  <div key={currency} className="px-4 py-4 grid grid-cols-12 items-center hover:bg-white/5 transition-colors">
                    {/* Currency label */}
                    <div className="col-span-4 flex items-center gap-3">
                      <div className="w-9 h-9 bg-binance-yellow/10 border border-binance-yellow/20 rounded-lg flex items-center justify-center text-binance-yellow font-bold text-xs">
                        {currency}
                      </div>
                      <div>
                        <span className="text-xs font-black text-white block">{currency} / MXN</span>
                        <span className="text-[9px] text-gray-500 uppercase">
                          {operableCurrencies[currency] ? 'Activa' : 'Suspendida'}
                        </span>
                      </div>
                    </div>
                    {/* Buy rate input */}
                    <div className="col-span-3 pr-2">
                      <div className="relative max-w-[140px]">
                        <span className="absolute left-3 top-2.5 text-xs text-gray-500">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={exchangeRates[currency]?.buy ?? 0}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setExchangeRates(prev => ({
                              ...prev,
                              [currency]: { ...prev[currency], buy: val },
                            }));
                          }}
                          className="w-full bg-black/40 border border-[#2b3139] rounded-lg pl-6 pr-3 py-1.5 text-xs font-mono font-bold text-binance-green focus:border-binance-green/50 outline-none transition-colors"
                        />
                      </div>
                    </div>
                    {/* Sell rate input */}
                    <div className="col-span-3 pr-2">
                      <div className="relative max-w-[140px]">
                        <span className="absolute left-3 top-2.5 text-xs text-gray-500">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={exchangeRates[currency]?.sell ?? 0}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setExchangeRates(prev => ({
                              ...prev,
                              [currency]: { ...prev[currency], sell: val },
                            }));
                          }}
                          className="w-full bg-black/40 border border-[#2b3139] rounded-lg pl-6 pr-3 py-1.5 text-xs font-mono font-bold text-binance-red focus:border-binance-red/50 outline-none transition-colors"
                        />
                      </div>
                    </div>
                    {/* Operable toggle */}
                    <div className="col-span-2 flex justify-center">
                      <button
                        onClick={() => toggleCurrency(currency)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          operableCurrencies[currency] ? 'bg-binance-yellow' : 'bg-[#2b3139]'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                            operableCurrencies[currency] ? 'translate-x-6 bg-black' : 'translate-x-1 bg-gray-500'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save / Refresh buttons for exchange rates */}
          <div className="pt-2 border-t border-[#2b3139]/40 flex flex-col sm:flex-row justify-end gap-3">
            <button
              onClick={fetchExchangeRates}
              disabled={loadingExchangeRates}
              className="px-4 py-2 bg-[#2b3139] hover:bg-[#363c44] text-xs font-bold rounded-xl text-white transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw size={12} className={loadingExchangeRates ? 'animate-spin' : ''} /> Refrescar TC
            </button>
            <button
              onClick={handleSaveExchangeRates}
              disabled={savingExchangeRates || loadingExchangeRates}
              className="px-5 py-2 bg-binance-yellow hover:bg-yellow-500 text-xs font-black rounded-xl text-black transition-colors flex items-center gap-1.5 uppercase disabled:opacity-50"
            >
              <Save size={12} className={savingExchangeRates ? 'animate-spin' : ''} /> Guardar Tipos de Cambio
            </button>
          </div>
        </div>

        {/* --- 2. DIVISAS OPERABLES (TOGGLE CARDS) --- */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2">
            <Power size={16} className="text-binance-yellow" />
            <h3 className="text-sm font-bold text-white">Divisas Operables</h3>
            <span className="text-[10px] text-gray-500 ml-1">
              ({Object.values(operableCurrencies).filter(Boolean).length}/{CURRENCIES.length} activas)
            </span>
          </div>
          <p className="text-[11px] text-gray-400 -mt-2 leading-normal">
            Active o desactive las divisas disponibles para operaciones de mostrador. Las divisas suspendidas no aparecerán en el cotizador de FX Trader.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {CURRENCIES.map((currency) => (
              <div
                key={currency}
                className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                  operableCurrencies[currency]
                    ? 'bg-binance-yellow/10 border-binance-yellow/30 hover:border-binance-yellow/50'
                    : 'bg-black/20 border-[#2b3139] hover:border-[#3a3f47] opacity-60'
                }`}
                onClick={() => toggleCurrency(currency)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="w-8 h-8 bg-binance-yellow/10 border border-binance-yellow/20 rounded-lg flex items-center justify-center text-binance-yellow font-bold text-xs">
                    {currency}
                  </div>
                  {operableCurrencies[currency] ? (
                    <ToggleRight size={22} className="text-binance-yellow" />
                  ) : (
                    <ToggleLeft size={22} className="text-gray-600" />
                  )}
                </div>
                <span className={`text-xs font-bold block ${operableCurrencies[currency] ? 'text-white' : 'text-gray-500'}`}>
                  {currency} / MXN
                </span>
                <span className={`text-[9px] uppercase font-black ${operableCurrencies[currency] ? 'text-binance-green' : 'text-gray-600'}`}>
                  {operableCurrencies[currency] ? 'Operable' : 'Suspendida'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* --- 3. UMBRALES DE COMISIÓN POR VOLUMEN --- */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2">
            <Percent size={16} className="text-binance-yellow" />
            <h3 className="text-sm font-bold text-white">Umbrales de Comisión por Volumen</h3>
          </div>
          <p className="text-[11px] text-gray-400 -mt-2 leading-normal max-w-2xl">
            Configure las comisiones aplicables a aliados (partners) según el volumen operado. Cada tramo define un porcentaje de comisión para un rango de volumen en la divisa correspondiente.
          </p>

          {commissionSuccess && (
            <div className="p-3 bg-binance-green/10 border border-binance-green/30 text-binance-green text-xs rounded-xl flex items-center gap-2">
              <CheckCircle2 size={15} />
              <span>{commissionSuccess}</span>
            </div>
          )}
          {commissionError && (
            <div className="p-3 bg-binance-red/10 border border-binance-red/30 text-binance-red text-xs rounded-xl flex items-center gap-2">
              <AlertCircle size={15} />
              <span>{commissionError}</span>
            </div>
          )}

          {loadingCommission ? (
            <div className="py-8 text-center text-gray-500 text-xs flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-binance-yellow border-t-transparent rounded-full animate-spin" />
              Cargando umbrales de comisión...
            </div>
          ) : (
            <div className="border border-[#2b3139]/60 rounded-2xl overflow-hidden shadow-xl">
              {/* Commission table header */}
              <div className="bg-black/30 px-4 py-3 border-b border-[#2b3139] grid grid-cols-12 text-left font-black uppercase text-[10px] text-gray-400 tracking-wider">
                <span className="col-span-2">Divisa</span>
                <span className="col-span-3">Volumen Mín.</span>
                <span className="col-span-3">Volumen Máx.</span>
                <span className="col-span-2">Comisión %</span>
                <span className="col-span-2 text-center">Acción</span>
              </div>
              {/* Commission table body */}
              <div className="divide-y divide-[#2b3139]/40 bg-[#151a1e] max-h-[400px] overflow-y-auto">
                {commissionTiers.map((tier) => (
                  <div key={tier.id} className="px-4 py-3 grid grid-cols-12 items-center hover:bg-white/5 transition-colors">
                    {/* Currency selector */}
                    <div className="col-span-2 pr-2">
                      <select
                        value={tier.currency}
                        onChange={(e) => updateCommissionTier(tier.id, 'currency', e.target.value)}
                        className="w-full bg-black/40 border border-[#2b3139] rounded-lg px-2 py-1.5 text-xs text-binance-yellow font-bold outline-none focus:border-binance-yellow/50"
                      >
                        {CURRENCIES.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    {/* Min volume */}
                    <div className="col-span-3 pr-2">
                      <div className="relative max-w-[150px]">
                        <span className="absolute left-2.5 top-2 text-[10px] text-gray-500">$</span>
                        <input
                          type="number"
                          step="any"
                          value={tier.minVolume}
                          onChange={(e) => updateCommissionTier(tier.id, 'minVolume', e.target.value)}
                          className="w-full bg-black/40 border border-[#2b3139] rounded-lg pl-5 pr-2 py-1.5 text-xs font-mono font-bold text-white outline-none focus:border-binance-yellow/50"
                        />
                      </div>
                    </div>
                    {/* Max volume */}
                    <div className="col-span-3 pr-2">
                      <div className="relative max-w-[150px]">
                        <span className="absolute left-2.5 top-2 text-[10px] text-gray-500">$</span>
                        <input
                          type="number"
                          step="any"
                          value={tier.maxVolume}
                          onChange={(e) => updateCommissionTier(tier.id, 'maxVolume', e.target.value)}
                          className="w-full bg-black/40 border border-[#2b3139] rounded-lg pl-5 pr-2 py-1.5 text-xs font-mono font-bold text-white outline-none focus:border-binance-yellow/50"
                        />
                      </div>
                    </div>
                    {/* Commission pct */}
                    <div className="col-span-2 pr-2">
                      <div className="relative max-w-[90px]">
                        <input
                          type="number"
                          step="0.01"
                          value={tier.commissionPct}
                          onChange={(e) => updateCommissionTier(tier.id, 'commissionPct', e.target.value)}
                          className="w-full bg-black/40 border border-[#2b3139] rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-binance-yellow outline-none focus:border-binance-yellow/50 text-center"
                        />
                        <span className="absolute right-1.5 top-2 text-[10px] text-gray-500">%</span>
                      </div>
                    </div>
                    {/* Remove button */}
                    <div className="col-span-2 flex justify-center">
                      <button
                        onClick={() => removeCommissionTier(tier.id)}
                        className="text-[10px] text-gray-500 hover:text-binance-red transition-colors px-2 py-1 rounded-lg hover:bg-binance-red/10"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
                {commissionTiers.length === 0 && (
                  <div className="px-4 py-8 text-center text-xs text-gray-500 italic">
                    No hay tramos de comisión definidos. Agregue uno nuevo abajo.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Add tier + Save buttons */}
          <div className="pt-2 border-t border-[#2b3139]/40 flex flex-col sm:flex-row justify-between gap-3">
            <button
              onClick={addCommissionTier}
              className="px-4 py-2 bg-[#2b3139] hover:bg-[#363c44] text-xs font-bold rounded-xl text-white transition-colors flex items-center gap-1.5"
            >
              <Layers size={12} /> Agregar Tramo
            </button>
            <button
              onClick={handleSaveCommission}
              disabled={savingCommission || loadingCommission}
              className="px-5 py-2 bg-binance-yellow hover:bg-yellow-500 text-xs font-black rounded-xl text-black transition-colors flex items-center gap-1.5 uppercase disabled:opacity-50"
            >
              <Save size={12} className={savingCommission ? 'animate-spin' : ''} /> Guardar Umbrales
            </button>
          </div>
        </div>

      </section>
    </div>
  );
}
