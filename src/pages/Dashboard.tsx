import { useEffect, useState } from "react";
import { 
  ArrowUpRight, 
  ArrowDownRight, 
  Activity, 
  Database, 
  ShieldCheck, 
  Server,
  RefreshCw
} from "lucide-react";

interface Balance {
  currency: string;
  balance: number;
  rate: number;
}

interface Rate {
  buy: number;
  sell: number;
  timestamp: string;
}

interface Transaction {
  id: string;
  type: string;
  currency: string;
  amount: number;
  method: string;
  status: string;
  date: string;
}

const formatCurrency = (amount: number, currency: string) => {
  const isStandard = ["USD", "MXN", "EUR", "GBP", "CAD", "JPY"].includes(currency.toUpperCase());
  if (isStandard) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amount);
    } catch (e) {
      // fallback
    }
  }
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  const symbol = currency.toUpperCase() === 'USDT' ? '₮' : currency;
  return `${symbol} ${formatted}`;
};

export default function Dashboard() {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [rates, setRates] = useState<Record<string, Rate>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [balRes, ratesRes, txRes] = await Promise.all([
        fetch("/api/legacy/balances"),
        fetch("/api/rates/live"),
        fetch("/api/transactions/recent")
      ]);

      const balData = await balRes.json();
      const ratesData = await ratesRes.json();
      const txData = await txRes.json();

      setBalances(balData.data || []);
      setRates(ratesData.rates || {});
      setTransactions(txData.transactions || []);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Simulate real-time updates every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold tracking-tight text-white">Panel Bancore</h1>
          <p className="text-gray-400 text-xs lg:text-sm mt-1">Gestión centralizada de liquidez y cumplimiento regulatorio</p>
        </div>
        <button 
          onClick={fetchData}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-[#2b3139] hover:bg-[#3b444f] text-white rounded-lg transition-colors text-sm font-medium border border-[#3b444f] w-full sm:w-auto"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Sincronizar
        </button>
      </div>

      {/* Top Stats Row — datos reales del backend */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <StatCard 
          title="Volumen Total (24h)" 
          value={transactions.length > 0 ? formatCurrency(transactions.reduce((s, t) => s + (t.amount || 0), 0), 'USD') : '$0'}
          change={transactions.length > 0 ? `${transactions.length} ops` : "Sin operaciones"}
          trend="neutral" 
          icon={<Activity className="text-binance-yellow" size={20} />} 
          source="SQLite Local"
        />
        <StatCard 
          title="Clientes Activos" 
          value="0"
          change="Primera sesión"
          trend="neutral" 
          icon={<Database className="text-binance-teal" size={20} />} 
          source="SQLite Local"
        />
        <StatCard 
          title="Alertas CNBV" 
          value="0" 
          change="Sin Alertas" 
          trend="neutral" 
          icon={<ShieldCheck className="text-binance-yellow" size={20} />} 
          source="Compliance Engine"
        />
        <StatCard 
          title="Estado Sistema" 
          value={loading ? "Cargando" : "Operativo"} 
          change={loading ? "Sincronizando" : "En línea"}
          trend="up" 
          icon={<Server className="text-emerald-500" size={20} />} 
          source="Local Dev"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Rates (Redis) */}
        <div className="col-span-1 bg-[#1e2329] border border-[#2b3139] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-medium text-white">Tasas FX en Vivo</h2>
            <span className="text-xs font-mono text-binance-yellow bg-binance-yellow/10 px-2 py-1 rounded">LOCAL CACHE</span>
          </div>
          <div className="space-y-4">
            {Object.entries(rates).map(([pair, data]: [string, Rate]) => (
              <div key={pair} className="p-4 bg-[#2b3139] rounded-xl border border-[#3b444f] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#1e2329] flex items-center justify-center font-bold text-sm">
                    {pair.split('_')[0]}
                  </div>
                  <div>
                    <p className="font-medium text-white">{pair.replace('_', '/')}</p>
                    <p className="text-xs text-gray-500 font-mono">{new Date(data.timestamp).toLocaleTimeString()}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-400">Compra: <span className="text-binance-yellow font-mono">{data.buy.toFixed(2)}</span></p>
                  <p className="text-sm text-gray-400">Venta: <span className="text-binance-red font-mono">{data.sell.toFixed(2)}</span></p>
                </div>
              </div>
            ))}
            {Object.keys(rates).length === 0 && (
              <div className="text-center py-8 text-gray-500 text-sm">Cargando tasas...</div>
            )}
          </div>
        </div>

        {/* Saldos en Bóveda */}
        <div className="col-span-1 lg:col-span-2 bg-[#1e2329] border border-[#2b3139] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-medium text-white">Saldos en Bóveda</h2>
            <span className="text-xs font-mono text-binance-yellow bg-binance-yellow/10 px-2 py-1 rounded">SQLite Local</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#3b444f] text-xs uppercase tracking-wider text-gray-500">
                  <th className="pb-3 font-medium">Moneda</th>
                  <th className="pb-3 font-medium text-right">Saldo</th>
                  <th className="pb-3 font-medium text-right">Tasa Promedio</th>
                  <th className="pb-3 font-medium text-right">Valor MXN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2b3139]">
                {balances.map((b) => (
                  <tr key={b.currency} className="hover:bg-[#2b3139] transition-colors">
                    <td className="py-4 font-medium flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${b.balance > 0 ? 'bg-binance-yellow' : 'bg-gray-600'}`}></div>
                      {b.currency}
                    </td>
                    <td className="py-4 text-right font-mono">
                      {formatCurrency(b.balance, b.currency)}
                    </td>
                    <td className="py-4 text-right font-mono text-gray-400">
                      ${b.rate.toFixed(2)}
                    </td>
                    <td className="py-4 text-right font-mono text-binance-yellow">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'MXN' }).format(b.balance * b.rate)}
                    </td>
                  </tr>
                ))}
                {balances.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-gray-500 text-sm">Cargando saldos...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Transacciones Recientes */}
      <div className="bg-[#1e2329] border border-[#2b3139] rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-medium text-white">Transacciones Recientes</h2>
          <span className="text-xs font-mono text-binance-yellow bg-binance-yellow/10 px-2 py-1 rounded">SQLite Local</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#3b444f] text-xs uppercase tracking-wider text-gray-500">
                <th className="pb-3 font-medium">ID Transacción</th>
                <th className="pb-3 font-medium">Tipo</th>
                <th className="pb-3 font-medium text-right">Monto</th>
                <th className="pb-3 font-medium">Método</th>
                <th className="pb-3 font-medium">Estado</th>
                <th className="pb-3 font-medium text-right">Hora</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2b3139]">
              {transactions.map((tx) => (
                <tr key={`${tx.id}-${tx.type}`} className="hover:bg-[#2b3139] transition-colors">
                  <td className="py-4 font-mono text-sm text-gray-300">{tx.id}</td>
                  <td className="py-4">
                    <span className={`text-xs px-2 py-1 rounded font-medium ${
                      tx.type === 'IN' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-binance-yellow/10 text-binance-yellow'
                    }`}>
                      {tx.type} {tx.currency}
                    </span>
                  </td>
                  <td className="py-4 text-right font-mono text-sm">
                    {formatCurrency(tx.amount, tx.currency)}
                  </td>
                  <td className="py-4">
                    <span className="text-[10px] text-gray-500 uppercase font-medium">
                      {tx.method === 'CASH' ? 'EFECTIVO' : 'TRANSFERENCIA'}
                    </span>
                  </td>
                  <td className="py-4">
                    <span className={`flex items-center gap-1 text-xs ${
                      tx.status === 'COMPLETED' ? 'text-binance-yellow' : 'text-binance-orange'
                    }`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        tx.status === 'COMPLETED' ? 'bg-binance-yellow' : 'bg-binance-orange'
                      }`}></div>
                      {tx.status}
                    </span>
                  </td>
                  <td className="py-4 text-right text-sm text-gray-500 font-mono">
                    {new Date(tx.date).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-500 text-sm">Cargando transacciones...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, change, trend, icon, source }: any) {
  return (
    <div className="bg-[#1e2329] border border-[#2b3139] rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden group hover:border-[#3b444f] transition-colors">
      <div className="flex justify-between items-start mb-4">
        <div className="p-2 bg-[#2b3139] rounded-lg border border-[#3b444f]">
          {icon}
        </div>
        <span className={`flex items-center gap-1 text-xs font-medium ${
          trend === 'up' ? 'text-binance-yellow' : trend === 'down' ? 'text-binance-red' : 'text-gray-400'
        }`}>
          {trend === 'up' && <ArrowUpRight size={14} />}
          {trend === 'down' && <ArrowDownRight size={14} />}
          {change}
        </span>
      </div>
      <div>
        <h3 className="text-gray-400 text-sm font-medium mb-1">{title}</h3>
        <p className="text-2xl font-semibold text-white tracking-tight">{value}</p>
      </div>
      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#3b444f] to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
      <div className="mt-4 pt-4 border-t border-[#2b3139] flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-gray-600 font-mono">Origen</span>
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-mono">{source}</span>
      </div>
    </div>
  );
}
