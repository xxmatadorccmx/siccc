import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  UserPlus, 
  QrCode, 
  TrendingUp, 
  History, 
  Search, 
  ChevronRight, 
  AlertCircle,
  Phone,
  CheckCircle2,
  ExternalLink,
  DollarSign
} from 'lucide-react';

interface Partner {
  partner_id: string;
  name: string;
  phone: string;
  partner_code: string;
  is_wholesale: number;
  is_active: number;
  created_at: string;
}

interface Commission {
  id: number;
  operation_id: string;
  ticket_code: string;
  amount_usd: number;
  commission_per_usd: number;
  total_commission_mxn: number;
  spread_mxn?: number;
  accrued_at: string;
}

export default function Allies() {
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(false);
  
  // New Partner Form
  const [newPartner, setNewPartner] = useState({
    name: '',
    phone: '',
    isWholesale: false
  });
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetchPartners();
  }, []);

  const fetchPartners = async () => {
    try {
      const res = await fetch('/api/partners/list'); // I need to add this endpoint
      if (res.ok) {
        const data = await res.json();
        setPartners(data);
      }
    } catch (e) { console.error(e); }
  };

  const fetchHistory = async (partnerId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/partners/${partnerId}/history`); // I need to add this too
      if (res.ok) {
        const data = await res.json();
        setCommissions(data);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleCreatePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPartner)
      });
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          setActiveTab('list');
          fetchPartners();
          setNewPartner({ name: '', phone: '', isWholesale: false });
        }, 2000);
      } else {
        const err = await res.json();
        alert(`Error: ${err.error || 'No se pudo crear el aliado'}`);
      }
    } catch (e) { 
      console.error(e);
      alert('Error de red al intentar crear el aliado');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
            <Users className="text-binance-yellow" size={32} />
            Programa de Aliados
          </h1>
          <p className="text-gray-400 mt-1">Gestión de comisionistas y captación digital de USD.</p>
        </div>
        
        <div className="flex bg-[#1e2329] border border-[#2b3139] p-1 rounded-xl">
          <button 
            onClick={() => setActiveTab('list')}
            className={`px-6 py-2 rounded-lg font-bold text-sm transition-all ${activeTab === 'list' ? 'bg-[#2b3139] text-white shadow-lg' : 'text-gray-500 hover:text-white'}`}
          >
            Directorio
          </button>
          <button 
            onClick={() => setActiveTab('create')}
            className={`px-6 py-2 rounded-lg font-bold text-sm transition-all ${activeTab === 'create' ? 'bg-[#2b3139] text-white shadow-lg' : 'text-gray-500 hover:text-white'}`}
          >
            Nuevo Aliado
          </button>
          <a 
            href={selectedPartner ? `https://ais-dev-d5zrgrtu47blyu6r6xxf6q-83160436455.us-west1.run.app/?tab=public-capture&codigo=${selectedPartner.partner_code}` : "/?tab=public-capture"} 
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-2 rounded-lg font-bold text-sm text-binance-yellow hover:bg-binance-yellow/10 transition-all flex items-center gap-2 border-l border-[#2b3139] ml-2"
          >
            <ExternalLink size={14} /> Portal Público
          </a>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Lado Izquierdo: Lista o Formulario */}
        <div className="lg:col-span-2 space-y-6">
          {activeTab === 'list' ? (
            <div className="bg-[#1e2329] border border-[#2b3139] rounded-2xl overflow-hidden shadow-xl">
              <div className="p-6 border-b border-[#2b3139] flex items-center gap-4">
                <Search className="text-gray-500" size={18} />
                <input 
                  type="text" 
                  placeholder="Buscar por nombre o código..."
                  className="bg-transparent text-white focus:outline-none w-full"
                />
              </div>
              <div className="divide-y divide-[#2b3139]">
                {partners.map(p => (
                  <button 
                    key={p.partner_id}
                    onClick={() => {
                      if (selectedPartner?.partner_id !== p.partner_id) {
                        // Clear states first to cleanup stale QR and history
                        setSelectedPartner(null);
                        setCommissions([]);
                        
                        // Set the new partner and load their history after a short animation-friendly timeout
                        setTimeout(() => {
                          setSelectedPartner(p);
                          fetchHistory(p.partner_id);
                        }, 100);
                      }
                    }}
                    className={`w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors text-left ${selectedPartner?.partner_id === p.partner_id ? 'bg-binance-yellow/5 border-l-4 border-binance-yellow' : ''}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-binance-yellow/10 rounded-xl flex items-center justify-center text-binance-yellow font-black">
                        {p.partner_code}
                      </div>
                      <div>
                        <h3 className="text-white font-bold">{p.name}</h3>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                          <Phone size={12} /> {p.phone}
                          {p.is_wholesale === 1 && <span className="bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full font-black text-[10px]">MAYORISTA</span>}
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={20} className="text-gray-600" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#1e2329] border border-[#2b3139] rounded-2xl p-8 shadow-xl"
            >
              <h2 className="text-xl font-bold text-white mb-6">Registrar Aliado Estratégico</h2>
              <form onSubmit={handleCreatePartner} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-gray-500 uppercase tracking-widest">Nombre Completo</label>
                    <input 
                      required
                      type="text"
                      value={newPartner.name}
                      onChange={e => setNewPartner({...newPartner, name: e.target.value.toUpperCase()})}
                      className="w-full bg-black/40 border border-[#2b3139] rounded-xl px-4 py-3 text-white focus:ring-2 ring-binance-yellow/20 outline-none"
                      placeholder="EJ. MARCO ANTONIO"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-gray-500 uppercase tracking-widest">Teléfono / WhatsApp</label>
                    <input 
                      required
                      type="tel"
                      value={newPartner.phone}
                      onChange={e => setNewPartner({...newPartner, phone: e.target.value})}
                      className="w-full bg-black/40 border border-[#2b3139] rounded-xl px-4 py-3 text-white focus:ring-2 ring-binance-yellow/20 outline-none"
                      placeholder="55 1234 5678"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 bg-white/5 rounded-xl border border-white/5">
                  <input 
                    type="checkbox"
                    checked={newPartner.isWholesale}
                    onChange={e => setNewPartner({...newPartner, isWholesale: e.target.checked})}
                    className="w-5 h-5 accent-binance-yellow"
                  />
                  <div>
                    <label className="text-sm font-bold text-white">Perfil Mayorista</label>
                    <p className="text-xs text-gray-400">Habilita tabuladores especiales para altos volúmenes.</p>
                  </div>
                </div>

                <button 
                  disabled={loading || success}
                  type="submit"
                  className={`w-full py-4 rounded-xl font-black text-lg shadow-xl transition-all flex items-center justify-center gap-3 ${success ? 'bg-emerald-500 text-black' : 'bg-binance-yellow hover:bg-yellow-500 text-black'}`}
                >
                  {success ? (
                    <><CheckCircle2 size={24} /> ALIADO REGISTRADO</>
                  ) : (
                    <><UserPlus size={24} /> CREAR CÓDIGO DE ALIADO</>
                  )}
                </button>
              </form>
            </motion.div>
          )}
        </div>

        {/* Lado Derecho: Detalles y QR */}
        <div className="space-y-6">
          <AnimatePresence mode="wait">
            {selectedPartner ? (
              <motion.div 
                key={selectedPartner.partner_id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                {/* QR Card */}
                <div className="bg-binance-yellow text-black p-8 rounded-3xl shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <QrCode size={120} />
                  </div>
                  <div className="relative z-10 text-center space-y-6">
                    <div className="bg-white p-4 rounded-2xl inline-block shadow-lg">
                      <img 
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://ais-dev-d5zrgrtu47blyu6r6xxf6q-83160436455.us-west1.run.app/?tab=public-capture&codigo=${selectedPartner.partner_code}`)}`} 
                        alt="QR Code" 
                        className="mx-auto rounded-lg w-32 h-32" 
                      />
                    </div>
                    <div>
                      <h4 className="text-2xl font-black">{selectedPartner.partner_code}</h4>
                      <p className="text-xs font-bold uppercase tracking-widest opacity-60">Código Exclusivo</p>
                    </div>
                    <button 
                      onClick={() => {
                        const url = `https://ais-dev-d5zrgrtu47blyu6r6xxf6q-83160436455.us-west1.run.app/?tab=public-capture&codigo=${selectedPartner.partner_code}`;
                        window.open(`https://wa.me/?text=${encodeURIComponent('¡Hola! Regístrate aquí para tu cambio de divisa: ' + url)}`, '_blank');
                      }}
                      className="w-full bg-black text-binance-yellow py-3 rounded-xl font-black flex items-center justify-center gap-2 hover:scale-105 transition-transform"
                    >
                      <ExternalLink size={18} /> COMPARTIR WHATSAPP
                    </button>
                  </div>
                </div>

                {/* Operaciones Vinculadas Card */}
                <div className="bg-[#1e2329] border border-[#2b3139] rounded-2xl overflow-hidden shadow-2xl">
                  <div className="p-5 border-b border-[#2b3139] bg-white/5 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <History size={16} className="text-binance-yellow" /> Operaciones Vinculadas
                      </h3>
                      <p className="text-[10px] text-gray-500 mt-1">Historial auditado de pre-registros y liquidaciones ERP</p>
                    </div>
                    <TrendingUp size={16} className="text-emerald-500" />
                  </div>
                  
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#181a20] text-gray-400 font-bold uppercase tracking-wider border-b border-[#2b3139]">
                        <tr>
                          <th className="p-4">Folio</th>
                          <th className="p-4 text-right">Monto USD</th>
                          <th className="p-4 text-right">Spread ERP</th>
                          <th className="p-4 text-right">Comisión Aliado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#2b3139]/40">
                        {commissions.length > 0 ? commissions.map(c => (
                          <tr key={c.id} className="hover:bg-white/5 transition-colors group">
                            <td className="p-4 font-mono font-bold text-binance-yellow">
                              {c.ticket_code || 'DIRECTO'}
                              <div className="text-[9px] text-gray-500 font-normal mt-0.5">
                                {new Date(c.accrued_at).toLocaleString()}
                              </div>
                            </td>
                            <td className="p-4 text-right font-bold text-white">
                              ${Number(c.amount_usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                            </td>
                            <td className="p-4 text-right font-mono text-emerald-400 font-bold">
                              +${(c.spread_mxn || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN
                            </td>
                            <td className="p-4 text-right">
                              <span className="text-white font-bold block">
                                +${Number(c.total_commission_mxn).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN
                              </span>
                              <span className="text-[10px] text-gray-500 block">
                                ${Number(c.commission_per_usd).toFixed(2)}/USD
                              </span>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={4} className="text-center py-12 text-gray-500 italic">
                              Sin operaciones vinculadas registradas
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-3xl p-12 text-center space-y-4">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto text-gray-600">
                  <Users size={32} />
                </div>
                <p className="text-gray-500 text-sm italic">Seleccione un aliado para ver su QR y estadísticas de comisiones.</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
