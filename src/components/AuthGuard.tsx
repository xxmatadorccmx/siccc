
import React from 'react';
// FIX 2026-09-03 (pantalla negra en módulos): esta app NO usa react-router
// (navega por activeTab/useState), pero AuthGuard importaba useLocation(),
// que exige un <Router> que no existe → crash del árbol completo de React
// al abrir cualquier módulo protegido. Se eliminó la dependencia muerta.
import { useAuth } from '../contexts/AuthContext';
import { RoleLevel } from '../types/auth';
import { ShieldAlert, Loader2 } from 'lucide-react';

interface AuthGuardProps {
  children: React.ReactNode;
  minLevel?: RoleLevel;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children, minLevel = RoleLevel.CAJA }) => {
  const { profile, loading, hasPermission } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0b0e11] text-white">
        <Loader2 className="animate-spin text-binance-yellow mb-4" size={48} />
        <p className="text-gray-400 font-medium">Verificando credenciales...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0b0e11] text-white p-6">
        <div className="bg-red-500/10 border border-red-500/20 p-8 rounded-3xl max-w-md text-center space-y-4">
          <ShieldAlert className="text-red-500 mx-auto" size={48} />
          <h2 className="text-xl font-bold uppercase tracking-tight">Sesión No Iniciada</h2>
          <p className="text-gray-400 text-xs leading-relaxed">
            No se pudo cargar el perfil del operador. Esto puede deberse a un reinicio en la base de datos o un inicio de sesión pendiente. Por favor, intente reestablecer la sesión.
          </p>
          <button 
            onClick={() => {
              window.location.reload();
            }}
            className="w-full py-2.5 bg-binance-yellow hover:bg-yellow-500 text-black font-black rounded-xl transition-colors text-xs uppercase tracking-wider"
          >
            Reestablecer Cajero por Defecto
          </button>
        </div>
      </div>
    );
  }

  if (!hasPermission(minLevel)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0b0e11] text-white p-6">
        <div className="bg-red-500/10 border border-red-500/20 p-8 rounded-3xl max-w-md text-center">
          <ShieldAlert className="text-red-500 mx-auto mb-6" size={64} />
          <h2 className="text-2xl font-black mb-4">ACCESO RESTRINGIDO</h2>
          <p className="text-gray-400 mb-8">
            Su nivel de autorización actual (<span className="text-white font-bold">{profile.role_level}</span>) 
            no permite el acceso a este módulo.
          </p>
          <button 
            onClick={() => window.history.back()}
            className="w-full py-3 bg-red-500 text-black font-black rounded-xl hover:bg-red-400 transition-colors"
          >
            VOLVER AL MENÚ PRINCIPAL
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
