import { ReactNode, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { RoleLevel } from "../types/auth";
import { 
  LayoutDashboard, 
  ArrowLeftRight, 
  Users, 
  FileText, 
  Settings, 
  LogOut,
  Bell,
  Search,
  Building2,
  PieChart,
  TrendingUp,
  Menu,
  X,
  CreditCard
} from "lucide-react";

interface DashboardLayoutProps {
  children: ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export default function DashboardLayout({ children, activeTab, setActiveTab }: DashboardLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { profile, hasPermission, logout } = useAuth();

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const handleNavClick = (tab: string) => {
    setActiveTab(tab);
    setIsSidebarOpen(false);
  };

  return (
    <div className="flex h-screen bg-[#181a20] text-white font-sans overflow-hidden relative">
      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-[#1e2329] border-r border-[#2b3139] flex flex-col transition-transform duration-300 ease-in-out
        lg:relative lg:translate-x-0
        ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        <div className="p-6 flex items-center justify-between border-b border-[#2b3139]">
          <div className="flex flex-col">
            <span className="font-bold text-xl tracking-tight leading-none text-white">BANCORE</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-binance-yellow font-semibold">Finance & Exchange</span>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {/* Cajeros (nivel ≤ 3): solo FX Trader */}
          {(profile?.role_level || 5) <= 3 ? (
            <>
              <NavItem 
                icon={<ArrowLeftRight size={20} />} 
                label="FX Trader" 
                active={activeTab === 'fx-trader'} 
                onClick={() => handleNavClick('fx-trader')} 
              />
            </>
          ) : (
            <>
              <NavItem 
                icon={<LayoutDashboard size={20} />} 
                label="Panel de Control" 
                active={activeTab === 'dashboard'} 
                onClick={() => handleNavClick('dashboard')} 
              />
              
              <NavItem 
                icon={<CreditCard size={20} />} 
                label="BaaS (Fintech VIP)" 
                active={activeTab === 'baas'} 
                onClick={() => handleNavClick('baas')} 
              />

              <NavItem 
                icon={<ArrowLeftRight size={20} />} 
                label="FX Trader" 
                active={activeTab === 'fx-trader'} 
                onClick={() => handleNavClick('fx-trader')} 
              />

              <NavItem 
                icon={<PieChart size={20} />} 
                label="Centro de Liquidez" 
                active={activeTab === 'liquidity'} 
                onClick={() => handleNavClick('liquidity')} 
              />

              <NavItem 
                icon={<TrendingUp size={20} />} 
                label="Analítica de Spread" 
                active={activeTab === 'analytics'} 
                onClick={() => handleNavClick('analytics')} 
              />

              <NavItem 
                icon={<ArrowLeftRight size={20} />} 
                label="Transacciones" 
                active={activeTab === 'transactions'} 
                onClick={() => handleNavClick('transactions')} 
              />

              <NavItem 
                icon={<Users size={20} />} 
                label="Clientes (KYC)" 
                active={activeTab === 'clients'} 
                onClick={() => handleNavClick('clients')} 
              />

              <NavItem 
                icon={<Users size={20} />} 
                label="Programa de Aliados" 
                active={activeTab === 'allies'} 
                onClick={() => handleNavClick('allies')} 
              />

              <NavItem 
                icon={<FileText size={20} />} 
                label="Cumplimiento (CNBV)" 
                active={activeTab === 'compliance'} 
                onClick={() => handleNavClick('compliance')} 
              />

              <NavItem 
                icon={<Settings size={20} />} 
                label="Configuración" 
                active={activeTab === 'settings'} 
                onClick={() => handleNavClick('settings')} 
              />
            </>
          )}
        </nav>

        <div className="p-4 border-t border-[#2b3139]">
          <button onClick={logout} className="flex items-center gap-3 text-gray-400 hover:text-white transition-colors w-full p-3 rounded-xl hover:bg-[#2b3139] cursor-pointer text-sm">
            <LogOut size={20} />
            <span className="font-medium">Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden w-full">
        {/* Topbar */}
        <header className="h-16 border-b border-[#2b3139] bg-[#1e2329] flex items-center justify-between px-4 lg:px-6 shrink-0">
          <div className="flex items-center gap-3 lg:gap-4 flex-1">
            <button 
              onClick={toggleSidebar}
              className="lg:hidden p-2 text-gray-400 hover:text-white hover:bg-[#2b3139] rounded-lg transition-colors"
            >
              <Menu size={24} />
            </button>
            
            <div className="relative w-full max-w-[160px] sm:max-w-xs lg:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input 
                type="text" 
                placeholder="Buscar..." 
                className="w-full bg-[#2b3139] border border-[#333] rounded-full py-1.5 lg:py-2 pl-9 pr-4 text-sm focus:outline-none focus:border-binance-yellow transition-colors"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-2 lg:gap-4">
            <button className="relative p-2 text-gray-400 hover:text-white transition-colors">
              <Bell size={20} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-binance-yellow rounded-full border-2 border-[#1e2329]"></span>
            </button>
            <div className="flex items-center gap-3 pl-2 lg:pl-4 border-l border-[#333] group relative">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-binance-yellow to-binance-orange flex items-center justify-center text-black font-black text-xs cursor-pointer group-hover:ring-2 ring-binance-yellow/50 transition-all">
                {profile?.nickname?.charAt(0) || 'A'}
              </div>
              <div className="hidden sm:flex flex-col text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium leading-none">{profile?.nickname || 'Cargando...'}</span>
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                </div>
                <span className="text-[9px] text-binance-yellow uppercase font-bold mt-1 tracking-wider">{profile?.puesto || '---'}</span>
              </div>


            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 bg-[#181a20]">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-3 w-full p-3 rounded-xl transition-all min-h-[48px] text-sm ${
        active 
          ? "bg-binance-yellow/10 text-binance-yellow font-medium" 
          : "text-gray-400 hover:text-white hover:bg-[#2b3139]"
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
      {active && <div className="ml-auto w-1 h-5 bg-binance-yellow rounded-full shrink-0"></div>}
    </button>
  );
}
