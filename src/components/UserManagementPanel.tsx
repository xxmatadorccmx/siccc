import React, { useState, useEffect } from 'react';
import { Users, RefreshCw, KeyRound, Power, Search, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ROLE_NAMES } from '../types/auth';

interface UserRow {
  auth_user_id: string;
  nickname: string;
  puesto: string;
  role_level: number;
  branch_id: string;
  is_active: number;
  force_password_change: number;
  created_at: string;
  last_login: string | null;
}

export default function UserManagementPanel() {
  const { token } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ auth_user_id: string; new_password: string } | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.status === 'success') {
        setUsers(json.data);
      } else {
        setErrorMsg(json.error || 'Error al cargar usuarios');
      }
    } catch (err) {
      setErrorMsg('Error de red al cargar usuarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleResetPassword = async (auth_user_id: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/auth/users/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ auth_user_id })
      });
      const json = await res.json();
      if (json.status === 'success') {
        setResetResult({ auth_user_id, new_password: json.new_password });
        setSuccessMsg(json.message);
      } else {
        setErrorMsg(json.error || 'Error al restablecer contraseña');
      }
    } catch (err) {
      setErrorMsg('Error de red al restablecer contraseña');
    }
  };

  const handleToggleActive = async (auth_user_id: string, is_active: number) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/auth/users/toggle-active', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ auth_user_id, is_active: is_active === 1 ? 0 : 1 })
      });
      const json = await res.json();
      if (json.status === 'success') {
        setSuccessMsg(json.message);
        fetchUsers();
      } else {
        setErrorMsg(json.error || 'Error al cambiar estado del usuario');
      }
    } catch (err) {
      setErrorMsg('Error de red al cambiar estado');
    }
  };

  const filtered = users.filter(u =>
    u.nickname?.toLowerCase().includes(search.toLowerCase()) ||
    u.auth_user_id?.toLowerCase().includes(search.toLowerCase()) ||
    u.puesto?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <section className="bg-[#1e2329] border border-[#2b3139] rounded-3xl p-6 md:p-8 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-[#2b3139] pb-6">
        <div className="p-3 bg-binance-yellow/10 text-binance-yellow rounded-2xl border border-binance-yellow/20">
          <Users size={24} />
        </div>
        <div>
          <span className="text-[10px] font-black text-binance-yellow uppercase tracking-widest block">Panel Administrador</span>
          <h2 className="text-lg font-bold text-white mt-0.5">Gestión de Usuarios y Credenciales</h2>
          <p className="text-[11px] text-gray-400 mt-1">
            Controle credenciales, restablezca contraseñas y administre bajas/reactivaciones desde aquí. La contraseña se puede restablecer en cualquier momento.
          </p>
        </div>
      </div>

      {/* Alerts */}
      {errorMsg && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl text-xs flex items-center gap-2">
          <AlertCircle size={14} /> {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs flex items-center gap-2">
          <CheckCircle2 size={14} /> {successMsg}
        </div>
      )}
      {resetResult && (
        <div className="p-4 bg-binance-yellow/10 border border-binance-yellow/30 rounded-xl text-sm">
          <p className="text-white font-bold">Nueva contraseña generada:</p>
          <div className="flex items-center gap-2 mt-2 bg-black/40 rounded-lg px-3 py-2 border border-binance-yellow/20">
            <code className="text-binance-yellow font-mono text-lg select-all">{resetResult.new_password}</code>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Usuario: {resetResult.auth_user_id} · El usuario deberá cambiar esta contraseña en su próximo inicio.</p>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, usuario o puesto..."
            className="w-full bg-[#181a20] border border-[#2b3139] rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-binance-yellow/50 text-white placeholder-gray-600"
          />
        </div>
        <button
          onClick={fetchUsers}
          className="flex items-center gap-2 px-4 py-2 bg-[#2b3139] hover:bg-[#3b444f] text-white rounded-lg text-sm font-medium border border-[#3b444f]"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {/* Users table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#3b444f] text-xs uppercase tracking-wider text-gray-500">
              <th className="p-3 font-medium">Usuario</th>
              <th className="p-3 font-medium">Nombre</th>
              <th className="p-3 font-medium">Puesto</th>
              <th className="p-3 font-medium">Nivel</th>
              <th className="p-3 font-medium">Sucursal</th>
              <th className="p-3 font-medium">Estado</th>
              <th className="p-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2b3139]">
            {loading ? (
              <tr><td colSpan={7} className="p-6 text-center text-gray-500">Cargando usuarios...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="p-6 text-center text-gray-500">No se encontraron usuarios</td></tr>
            ) : (
              filtered.map(u => (
                <tr key={u.auth_user_id} className="hover:bg-[#2b3139]/40 transition-colors">
                  <td className="p-3 font-mono text-xs text-gray-300">{u.auth_user_id}</td>
                  <td className="p-3 text-sm font-medium text-white">{u.nickname}</td>
                  <td className="p-3 text-xs text-gray-400">{u.puesto}</td>
                  <td className="p-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-binance-yellow/10 text-binance-yellow font-mono">
                      {ROLE_NAMES[u.role_level as keyof typeof ROLE_NAMES] || `N${u.role_level}`}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-gray-400 font-mono">{u.branch_id}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-bold ${u.is_active === 1 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                      {u.is_active === 1 ? 'ACTIVO' : 'BAJA'}
                    </span>
                    {u.force_password_change === 1 && (
                      <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 font-bold uppercase">
                        Cambio pendiente
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleResetPassword(u.auth_user_id)}
                        title="Restablecer contraseña"
                        className="p-2 bg-[#2b3139] hover:bg-[#3b444f] rounded-lg text-gray-300 hover:text-binance-yellow transition-colors"
                      >
                        <KeyRound size={15} />
                      </button>
                      <button
                        onClick={() => handleToggleActive(u.auth_user_id, u.is_active)}
                        title={u.is_active === 1 ? 'Dar de baja' : 'Reactivar'}
                        className={`p-2 rounded-lg transition-colors ${u.is_active === 1 ? 'bg-[#2b3139] hover:bg-red-500/20 text-gray-300 hover:text-red-400' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400'}`}
                      >
                        <Power size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
