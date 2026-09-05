import React, { useState } from 'react';
import { Shield, Fingerprint, Lock, User, AlertCircle, LogIn, Eye, EyeOff, ArrowLeftRight } from 'lucide-react';

interface LoginProps {
  onLogin: (credentials: { auth_user_id: string; password: string }) => Promise<boolean>;
}

export default function Login({ onLogin }: LoginProps) {
  const [authUserId, setAuthUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!authUserId.trim() || !password.trim()) {
      setError('Ingrese usuario y contraseña.');
      return;
    }

    setLoading(true);
    try {
      const success = await onLogin({
        auth_user_id: authUserId.trim(),
        password: password.trim()
      });
      
      if (!success) {
        setError('Credenciales inválidas o cuenta bloqueada.');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('Error de conexión con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0e11] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Fondo con grilla sutil + glow amarillo */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-binance-yellow/[0.03] rounded-full blur-[120px]" />
        <div 
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,214,0,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,214,0,0.3) 1px, transparent 1px)`,
            backgroundSize: '40px 40px'
          }}
        />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo + Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-binance-yellow/20 to-binance-yellow/5 border border-binance-yellow/30 rounded-2xl mb-4 shadow-lg shadow-binance-yellow/10">
            <ArrowLeftRight size={28} className="text-binance-yellow" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">
            SICC
          </h1>
          <p className="text-[11px] text-gray-500 mt-1.5 font-medium tracking-wide">
            Sistema de Intercompensación Cambiaria y Compensación
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-[#0d1117]/80 backdrop-blur-xl border border-binance-yellow/10 rounded-2xl p-6 shadow-2xl shadow-black/50">
          <div className="flex items-center gap-2 mb-6">
            <Fingerprint size={18} className="text-binance-yellow" />
            <h2 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Autenticación Segura</h2>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-red-400 text-xs">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-binance-yellow/60 uppercase mb-1.5 tracking-widest">
                Usuario
              </label>
              <div className="relative group">
                <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600 group-focus-within:text-binance-yellow transition-colors" />
                <input
                  type="text"
                  value={authUserId}
                  onChange={(e) => setAuthUserId(e.target.value)}
                  placeholder="admin_sicc_2026"
                  className="w-full text-sm bg-[#161b22] border border-[#21262d] rounded-xl pl-10 pr-3 py-3 text-white placeholder-gray-700 focus:outline-none focus:border-binance-yellow/50 focus:bg-[#181d25] font-mono transition-all"
                  autoFocus
                  required
                  minLength={3}
                  maxLength={50}
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-binance-yellow/60 uppercase mb-1.5 tracking-widest">
                Contraseña
              </label>
              <div className="relative group">
                <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600 group-focus-within:text-binance-yellow transition-colors" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••••••"
                  className="w-full text-sm bg-[#161b22] border border-[#21262d] rounded-xl pl-10 pr-10 py-3 text-white placeholder-gray-700 focus:outline-none focus:border-binance-yellow/50 focus:bg-[#181d25] font-mono transition-all"
                  required
                  minLength={4}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-binance-yellow transition-colors"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-binance-yellow hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-black rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-binance-yellow/20 hover:shadow-binance-yellow/30 uppercase tracking-wider"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  Autenticando...
                </>
              ) : (
                <>
                  <LogIn size={16} />
                  Ingresar al Sistema
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-binance-yellow/10">
            <p className="text-[10px] text-gray-600 text-center leading-relaxed">
              SICC v3.1 · Autenticación JWT + bcrypt · Acceso restringido a personal autorizado
            </p>
          </div>
        </div>

        {/* Footer badge */}
        <div className="mt-4 flex items-center justify-center gap-2">
          <Shield size={12} className="text-binance-yellow/30" />
          <span className="text-[10px] text-gray-700 font-mono uppercase tracking-widest">
            CNBV · PLD · FIFO · Zero-Trust
          </span>
        </div>
      </div>
    </div>
  );
}
