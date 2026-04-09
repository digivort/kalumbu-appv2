/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Project: AgriChain Zambia
 * Developer: Tulumba Desmond (Digivort Technologies)
 */

import React, { useState, useEffect, useMemo } from 'react';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, doc, setDoc, onSnapshot, query, where, 
  orderBy, serverTimestamp, Timestamp, addDoc,
  runTransaction 
} from 'firebase/firestore';
import { 
  LayoutDashboard, PlusCircle, History, ShieldCheck, LogOut, LogIn, 
  Package, ShoppingCart, CheckCircle2, TrendingUp,
  Database, Search, BarChart3, MapPin, ArrowRightLeft, AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// --- Types & Enums ---

enum UserRole {
  FARMER = 'farmer',
  BUYER = 'buyer',
  REGULATOR = 'regulator'
}

interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  location?: string;
  createdAt: Timestamp;
  verified: boolean;
}

interface Product {
  id: string;
  farmerId: string;
  farmerName: string;
  name: string;
  quantity: number;
  pricePerUnit: number;
  status: 'available' | 'sold' | 'delivered';
  location: string;
  imageUrl?: string;
  createdAt: Timestamp;
  batchId: string;
}

interface Transaction {
  id: string;
  productId: string;
  productName: string;
  buyerId: string;
  buyerName: string;
  farmerId: string;
  farmerName: string;
  amount: number;
  taxAmount: number; 
  status: 'pending' | 'paid' | 'completed';
  deliveryStatus: 'processing' | 'shipped' | 'in-transit' | 'delivered';
  timestamp: Timestamp;
}

export default function AgriChainApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'market' | 'ledger' | 'settings'>('dashboard');
  
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCrop, setSelectedCrop] = useState('All');
  const [sortBy] = useState<'price' | 'date'>('date');

  // --- Auth & Profile Logic ---
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const profileRef = doc(db, 'users', currentUser.uid);
        const unsubscribeProfile = onSnapshot(profileRef, (docSnap) => {
          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
          } else {
            setProfile(null);
          }
          setLoading(false);
        }, (error) => {
          console.error("Profile listener error:", error);
          setLoading(false);
        });
        return () => unsubscribeProfile();
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  // --- Real-time Data Listeners ---
  useEffect(() => {
    if (!user || !profile) return;

    const pQuery = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
    const unsubProducts = onSnapshot(pQuery, (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
    });

    const tQuery = profile.role === UserRole.REGULATOR 
      ? query(collection(db, 'transactions'), orderBy('timestamp', 'desc'))
      : query(
          collection(db, 'transactions'), 
          where(profile.role === UserRole.FARMER ? 'farmerId' : 'buyerId', '==', user.uid),
          orderBy('timestamp', 'desc')
        );

    const unsubTx = onSnapshot(tQuery, (snap) => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)));
    });

    return () => { unsubProducts(); unsubTx(); };
  }, [user, profile]);

  const handlePurchase = async (product: Product) => {
    if (!user || !profile || isProcessing) return;
    setIsProcessing(true);

    try {
      await runTransaction(db, async (tx) => {
        const productRef = doc(db, 'products', product.id);
        const productDoc = await tx.get(productRef);

        if (!productDoc.exists() || productDoc.data().status !== 'available') {
          throw new Error("Product no longer available.");
        }

        const totalAmount = product.quantity * product.pricePerUnit;
        const zraTax = totalAmount * 0.01; 

        const txRef = doc(collection(db, 'transactions'));
        tx.set(txRef, {
          productId: product.id,
          productName: product.name,
          buyerId: user.uid,
          buyerName: profile.name,
          farmerId: product.farmerId,
          farmerName: product.farmerName,
          amount: totalAmount,
          taxAmount: zraTax,
          status: 'paid',
          deliveryStatus: 'processing',
          timestamp: serverTimestamp()
        });

        tx.update(productRef, { status: 'sold' });
      });

      alert("Smart Contract Executed: ZMW payment secured in escrow.");
    } catch (e) {
      console.error("Transaction failed:", e);
      alert("Transaction failed. Check connection or Firestore rules.");
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredProducts = useMemo(() => {
    return products
      .filter(p => p.status === 'available')
      .filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .filter(p => selectedCrop === 'All' || p.name === selectedCrop)
      .sort((a, b) => sortBy === 'price' ? a.pricePerUnit - b.pricePerUnit : b.createdAt.toMillis() - a.createdAt.toMillis());
  }, [products, searchQuery, selectedCrop, sortBy]);

  if (loading) return <LoadingScreen />;
  if (!user) return <AuthScreen onLogin={() => signInWithPopup(auth, new GoogleAuthProvider())} />;
  
  if (!profile) return (
    <RoleSelection onSelect={async (role) => {
        setIsProcessing(true); 
        try {
          await setupProfile(user, role, setProfile);
        } catch (err) {
          alert("Network error. Please try again.");
        } finally {
          setIsProcessing(false);
        }
      }} 
    />
  );

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] selection:bg-green-100">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200 px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-green-600 p-1.5 rounded-lg shadow-lg shadow-green-200">
            <ShieldCheck className="text-white w-5 h-5" />
          </div>
          <span className="font-bold tracking-tight text-xl">AgriChain <span className="text-green-600">ZM</span></span>
        </div>

        <div className="flex items-center gap-2 md:gap-6">
          <div className="hidden md:flex bg-gray-100 p-1 rounded-xl">
            <NavTab active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} label="Overview" icon={<LayoutDashboard size={14}/>} />
            <NavTab active={activeTab === 'market'} onClick={() => setActiveTab('market')} label="Market" icon={<ShoppingCart size={14}/>} />
            <NavTab active={activeTab === 'ledger'} onClick={() => setActiveTab('ledger')} label="Ledger" icon={<History size={14}/>} />
          </div>
          <div className="h-8 w-px bg-gray-200 mx-2 hidden md:block" />
          <button onClick={() => signOut(auth)} className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-full transition-colors">
            <LogOut size={20} />
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-6">
        <AnimatePresence mode="wait">
          
          {/* Dashboard View */}
          {activeTab === 'dashboard' && (
            <motion.div key="dash" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-8">
              <header>
                <h1 className="text-2xl font-black">Welcome back, {profile.name.split('')[0]} 👋</h1>
                <p className="text-gray-500 text-sm">Here is what's happening on the network today.</p>
              </header>

              {/* Dynamic Stats Row */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <StatBox title="Node Status" value="Syncing" icon={<Database className="text-green-500 animate-pulse" />} />
                <StatBox title="Active Listings" value={products.filter(p => p.status === 'available').length.toString()} icon={<Package className="text-blue-500" />} />
                <StatBox title="ZMW Volume" value={transactions.reduce((acc, t) => acc + t.amount, 0).toLocaleString()} icon={<TrendingUp className="text-orange-500" />} />
                <StatBox title="ZRA Tax Pool" value={transactions.reduce((acc, t) => acc + t.taxAmount, 0).toLocaleString()} icon={<BarChart3 className="text-purple-500" />} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  {/* Role-Specific Action Modules */}
                  {profile.role === UserRole.FARMER && (
                    <section className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                      <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <PlusCircle className="w-5 h-5 text-green-600" />
                        Create New Batch Listing
                      </h3>
                      <form onSubmit={(e) => handleAddProduct(e, user, profile)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input name="name" placeholder="Crop Type (e.g. Maize)" className="p-3 bg-gray-50 rounded-xl border-none focus:ring-2 ring-green-500 text-sm" required />
                        <input name="qty" type="number" placeholder="Quantity (KG)" className="p-3 bg-gray-50 rounded-xl border-none focus:ring-2 ring-green-500 text-sm" required />
                        <input name="price" type="number" step="0.01" placeholder="Price per KG (ZMW)" className="p-3 bg-gray-50 rounded-xl border-none focus:ring-2 ring-green-500 text-sm" required />
                        <input name="loc" placeholder="Farm Location" className="p-3 bg-gray-50 rounded-xl border-none focus:ring-2 ring-green-500 text-sm" required />
                        <button className="md:col-span-2 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 transition-all flex items-center justify-center gap-2">
                          <CheckCircle2 size={18} /> Deploy to Marketplace
                        </button>
                      </form>
                    </section>
                  )}

                  {profile.role === UserRole.REGULATOR && (
                    <section className="bg-white border border-red-100 rounded-2xl p-6 shadow-sm">
                       <h3 className="text-lg font-bold mb-2 flex items-center gap-2 text-red-600">
                        <ShieldCheck size={20} /> Compliance Oversight
                      </h3>
                      <p className="text-xs text-gray-500 mb-4">Real-time monitoring of ZMW flow and tax obligations.</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-[10px] font-bold text-gray-400 uppercase">Unpaid Taxes</p>
                          <p className="text-xl font-black">ZMW 0.00</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-[10px] font-bold text-gray-400 uppercase">Verified Farmers</p>
                          <p className="text-xl font-black">124</p>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Transaction Feed (The Ledger) */}
                  <section className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                      <h3 className="font-bold text-sm uppercase tracking-wider text-gray-500">Live Network Ledger</h3>
                      <div className="flex items-center gap-2 text-[10px] text-green-600 font-bold bg-green-50 px-2 py-1 rounded">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-ping" />
                        LIVE SYNC
                      </div>
                    </div>
                    <div className="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
                      {transactions.length === 0 ? (
                        <div className="p-12 text-center">
                          <History className="mx-auto text-gray-200 mb-2" size={40} />
                          <p className="text-gray-400 text-sm">No activity recorded on the chain yet.</p>
                        </div>
                      ) : (
                        transactions.map(tx => (
                          <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                            <div className="flex items-center gap-4">
                              <div className="bg-black text-white p-2.5 rounded-xl">
                                <ArrowRightLeft size={16} />
                              </div>
                              <div>
                                <p className="font-bold text-sm">{tx.productName}</p>
                                <p className="text-[10px] text-gray-400 font-mono">{tx.id.toUpperCase()}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-sm text-green-600">ZMW {tx.amount.toLocaleString()}</p>
                              <span className="text-[9px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-bold">
                                {tx.deliveryStatus.toUpperCase()}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>

                {/* Sidebar */}
                <aside className="space-y-6">
                  <div className="bg-[#1A1A1A] rounded-2xl p-6 text-white shadow-xl">
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-6">Verified Profile</h4>
                    <div className="flex items-center gap-4 mb-8">
                      <div className="h-14 w-14 rounded-2xl bg-green-600 flex items-center justify-center font-black text-xl shadow-lg shadow-green-900/20">
                        {profile.name[0]}
                      </div>
                      <div>
                        <p className="font-bold text-lg leading-tight">{profile.name}</p>
                        <p className="text-xs text-green-500 font-medium capitalize">{profile.role} Module Active</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <StatusRow label="Blockchain Identity" active={profile.verified} />
                      <StatusRow label="ZRA Tax Compliant" active />
                      <StatusRow label="Escrow Account" active />
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                    <h4 className="text-xs font-bold mb-4">Network Alerts</h4>
                    <div className="space-y-3">
                      <div className="flex gap-3 items-start text-xs">
                        <AlertCircle className="text-orange-500 shrink-0" size={14} />
                        <p className="text-gray-600">Market prices for Maize in <b>Lusaka</b> rose by 4% today.</p>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </motion.div>
          )}

          {/* Market View */}
          {activeTab === 'market' && (
            <motion.div key="market" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                <div className="relative w-full md:w-96">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input 
                    type="text" 
                    placeholder="Search by crop or location..." 
                    className="w-full pl-10 pr-4 py-2 bg-gray-50 border-none rounded-xl focus:ring-2 ring-green-500 text-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                  <select 
                    className="bg-gray-50 border-none rounded-xl py-2 px-4 text-xs font-bold"
                    onChange={(e) => setSelectedCrop(e.target.value)}
                  >
                    <option value="All">All Crops</option>
                    <option value="Maize">Maize</option>
                    <option value="Soya">Soya Beans</option>
                    <option value="Wheat">Wheat</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {filteredProducts.length === 0 ? (
                  <div className="col-span-full py-20 text-center text-gray-400">
                    No products found matching your criteria.
                  </div>
                ) : (
                  filteredProducts.map(product => (
                    <ProductCard key={product.id} product={product} onBuy={() => handlePurchase(product)} disabled={isProcessing} />
                  ))
                )}
              </div>
            </motion.div>
          )}

          {/* Ledger View (Full) */}
          {activeTab === 'ledger' && (
            <motion.div key="ledger" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white border border-gray-200 rounded-3xl shadow-sm overflow-hidden">
              <div className="p-8 border-b border-gray-100">
                <h2 className="text-2xl font-black mb-1">Audit Trail</h2>
                <p className="text-sm text-gray-500">Immutable transaction history for AgriChain Zambia.</p>
              </div>
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-400 font-bold uppercase text-[10px] tracking-widest">
                  <tr>
                    <th className="px-8 py-4">Transaction Hash</th>
                    <th className="px-8 py-4">Participant</th>
                    <th className="px-8 py-4">Asset</th>
                    <th className="px-8 py-4">Value</th>
                    <th className="px-8 py-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {transactions.map(tx => (
                    <tr key={tx.id} className="hover:bg-gray-50">
                      <td className="px-8 py-4 font-mono text-gray-400">{tx.id.slice(0, 16)}...</td>
                      <td className="px-8 py-4 font-bold">{tx.buyerName}</td>
                      <td className="px-8 py-4">{tx.productName}</td>
                      <td className="px-8 py-4 font-black text-green-600">ZMW {tx.amount}</td>
                      <td className="px-8 py-4">
                        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-[10px] font-black uppercase">Verified</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// --- Sub-components ---

function StatBox({ title, value, icon }: { title: string, value: string, icon: React.ReactNode }) {
  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm flex items-center justify-between hover:border-green-200 transition-colors">
      <div>
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{title}</p>
        <p className="text-2xl font-black">{value}</p>
      </div>
      <div className="p-3 bg-gray-50 rounded-2xl">{icon}</div>
    </div>
  );
}

function ProductCard({ product, onBuy, disabled }: { product: Product, onBuy: () => void, disabled: boolean }) {
  return (
    <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
      <div className="h-48 bg-gray-100 relative group">
        <img src={`https://picsum.photos/seed/${product.id}/600/400`} className="w-full h-full object-cover grayscale-[20%] group-hover:grayscale-0 transition-all" alt="" />
        <div className="absolute bottom-3 left-3 flex gap-2">
          <div className="bg-white/90 backdrop-blur px-2 py-1 rounded-lg text-[10px] text-black font-bold flex items-center gap-1">
            <MapPin size={10} /> {product.location}
          </div>
        </div>
      </div>
      <div className="p-5">
        <h4 className="font-black text-base mb-1">{product.name}</h4>
        <p className="text-[10px] text-gray-400 mb-6 uppercase tracking-wider">Farmer: {product.farmerName}</p>
        
        <div className="flex justify-between items-center">
          <div>
            <p className="text-[9px] uppercase font-bold text-gray-400">Unit Price</p>
            <p className="font-black text-green-600 text-lg">ZMW {product.pricePerUnit}</p>
          </div>
          <button 
            onClick={onBuy}
            disabled={disabled}
            className="bg-black text-white px-5 py-2.5 rounded-xl text-xs font-bold hover:bg-green-600 shadow-lg shadow-gray-200 transition-all disabled:opacity-50"
          >
            {disabled ? '...' : 'SECURE BUY'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NavTab({ active, onClick, label, icon }: any) {
  return (
    <button onClick={onClick} className={cn(
        "flex items-center gap-2 px-5 py-2 rounded-lg text-[11px] font-black transition-all uppercase tracking-tighter",
        active ? "bg-white text-black shadow-md" : "text-gray-400 hover:text-black"
      )}
    >
      {icon} {label}
    </button>
  );
}

function StatusRow({ label, active }: { label: string, active?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[10px] border-b border-white/10 pb-3 last:border-0">
      <span className="text-gray-500 font-medium">{label}</span>
      <div className="flex items-center gap-1.5">
        <div className={cn("w-1.5 h-1.5 rounded-full", active ? "bg-green-400" : "bg-red-400")} />
        <span className={cn("font-black uppercase", active ? "text-green-400" : "text-red-400")}>
          {active ? 'Verified' : 'Required'}
        </span>
      </div>
    </div>
  );
}

// --- Logic Helpers ---

async function setupProfile(user: FirebaseUser, role: UserRole, setProfile: any) {
  const newProfile: UserProfile = {
    uid: user.uid,
    name: user.displayName || 'Unnamed Partner',
    email: user.email || '',
    role: role,
    createdAt: Timestamp.now(),
    verified: true 
  };
  await setDoc(doc(db, 'users', user.uid), newProfile);
  setProfile(newProfile);
}

async function handleAddProduct(e: any, user: any, profile: any) {
  e.preventDefault();
  const formData = new FormData(e.currentTarget);
  const data = {
    farmerId: user.uid,
    farmerName: profile.name,
    name: formData.get('name'),
    quantity: Number(formData.get('qty')),
    pricePerUnit: Number(formData.get('price')),
    location: formData.get('loc'),
    status: 'available',
    createdAt: serverTimestamp(),
    batchId: `BCH-${Math.random().toString(36).substr(2, 9).toUpperCase()}`
  };
  await addDoc(collection(db, 'products'), data);
  e.target.reset();
}

function AuthScreen({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-green-100 rounded-full blur-[100px] opacity-50" />
      <div className="max-w-md w-full text-center space-y-10 relative z-10">
        <div className="w-20 h-20 bg-green-600 rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-green-200">
           <ShieldCheck className="w-10 h-10 text-white" />
        </div>
        <div>
          <h1 className="text-5xl font-black tracking-tighter">AgriChain <span className="text-green-600">ZM</span></h1>
          <p className="text-gray-500 mt-3 font-medium">Decentralized Trust for Zambian Agriculture.</p>
        </div>
        <button onClick={onLogin} className="w-full flex items-center justify-center gap-4 bg-black text-white py-5 rounded-2xl font-black hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl">
          <LogIn size={20} /> Access Network
        </button>
        <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Secure Web3 Gateway</p>
      </div>
    </div>
  );
}

function RoleSelection({ onSelect }: { onSelect: (role: UserRole) => void }) {
  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-6">
       <div className="text-center mb-12">
         <h2 className="text-4xl font-black mb-2 tracking-tighter">Choose Your Module</h2>
         <p className="text-gray-500">The interface adapts to your specific role in the supply chain.</p>
       </div>
       <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
          <RoleCard title="Farmer" desc="List produce, track batches, and receive escrowed payments." icon={<Package size={32}/>} onClick={() => onSelect(UserRole.FARMER)} />
          <RoleCard title="Buyer" desc="Source verified local crops with immutable quality records." icon={<ShoppingCart size={32}/>} onClick={() => onSelect(UserRole.BUYER)} />
          <RoleCard title="Regulator" desc="Audit tax flow, monitor food security, and verify compliance." icon={<ShieldCheck size={32}/>} onClick={() => onSelect(UserRole.REGULATOR)} />
       </div>
    </div>
  );
}

function RoleCard({ title, desc, icon, onClick }: any) {
  return (
    <button onClick={onClick} className="bg-white p-10 rounded-[40px] border border-gray-100 hover:border-green-500 hover:shadow-2xl hover:shadow-green-100 transition-all text-left group flex flex-col h-full">
      <div className="bg-gray-50 text-gray-400 group-hover:bg-green-50 group-hover:text-green-600 w-16 h-16 rounded-2xl flex items-center justify-center mb-8 transition-all">
        {icon}
      </div>
      <h3 className="text-2xl font-black mb-3">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed font-medium">{desc}</p>
      <div className="mt-auto pt-8">
         <span className="text-[10px] font-black text-green-600 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">Launch Module →</span>
      </div>
    </button>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8F9FA] gap-4">
      <motion.div animate={{ scale: [1, 1.2, 1], rotate: [0, 180, 360] }} transition={{ repeat: Infinity, duration: 2 }}>
        <Database className="text-green-600" size={48} />
      </motion.div>
      <p className="text-xs font-black text-gray-400 uppercase tracking-[0.3em] animate-pulse">Syncing Chain</p>
    </div>
  );
}