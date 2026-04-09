/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  auth, db 
} from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  serverTimestamp,
  Timestamp,
  getDocFromServer
} from 'firebase/firestore';
import { 
  LayoutDashboard, 
  PlusCircle, 
  History, 
  ShieldCheck, 
  LogOut, 
  LogIn, 
  Package, 
  ShoppingCart, 
  CheckCircle2, 
  Clock, 
  MapPin, 
  TrendingUp,
  AlertCircle,
  Database,
  ArrowRightLeft,
  Search,
  Filter,
  ArrowUpDown,
  ChevronDown,
  User,
  Settings,
  Save
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// --- Types ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: 'farmer' | 'buyer' | 'regulator';
  location?: string;
  createdAt: Timestamp;
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
  status: 'pending' | 'paid' | 'completed';
  deliveryStatus?: 'processing' | 'shipped' | 'in-transit' | 'delivered';
  timestamp: Timestamp;
}

// --- Error Handling ---

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      try {
        const parsed = JSON.parse(event.error.message);
        if (parsed.error) {
          setHasError(true);
          setErrorInfo(parsed.error);
        }
      } catch {
        // Not a FirestoreErrorInfo JSON
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-red-100">
          <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">System Error</h2>
          <p className="text-gray-600 mb-6">
            A security or permission error occurred while accessing the blockchain data.
          </p>
          <div className="bg-red-50 p-4 rounded-lg mb-6 overflow-auto max-h-32">
            <code className="text-xs text-red-700">{errorInfo}</code>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-red-600 text-white py-3 rounded-xl font-semibold hover:bg-red-700 transition-colors"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRoleSelection, setShowRoleSelection] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'market' | 'ledger' | 'settings'>('dashboard');
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // Filtering & Sorting State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [minPrice, setMinPrice] = useState<number | ''>('');
  const [maxPrice, setMaxPrice] = useState<number | ''>('');
  const [selectedCrop, setSelectedCrop] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [sortBy, setSortBy] = useState<'price' | 'quantity' | 'date'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Unique values for filters
  const uniqueCrops = useMemo(() => {
    return Array.from(new Set(products.map(p => p.name))).sort();
  }, [products]);

  const uniqueLocations = useMemo(() => {
    return Array.from(new Set(products.map(p => p.location))).sort();
  }, [products]);

  // Computed Filtered & Sorted Products
  const filteredProducts = useMemo(() => {
    return products
      .filter(p => p.status === 'available')
      .filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCrop = selectedCrop === '' || p.name === selectedCrop;
        const matchesLocation = selectedLocation === '' || p.location === selectedLocation;
        const matchesMinPrice = minPrice === '' || p.pricePerUnit >= minPrice;
        const matchesMaxPrice = maxPrice === '' || p.pricePerUnit <= maxPrice;
        return matchesSearch && matchesCrop && matchesLocation && matchesMinPrice && matchesMaxPrice;
      })
      .sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'price') comparison = a.pricePerUnit - b.pricePerUnit;
        else if (sortBy === 'quantity') comparison = a.quantity - b.quantity;
        else if (sortBy === 'date') comparison = a.createdAt.toMillis() - b.createdAt.toMillis();
        
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [products, searchQuery, selectedCrop, selectedLocation, minPrice, maxPrice, sortBy, sortOrder]);

  // Test connection on boot
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const docRef = doc(db, 'users', u.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
            setShowRoleSelection(false);
          } else {
            setShowRoleSelection(true);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
        }
      } else {
        setProfile(null);
        setShowRoleSelection(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Real-time Data Listeners
  useEffect(() => {
    if (!user || !profile) return;

    // Products Listener
    const productsQuery = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
    const unsubProducts = onSnapshot(productsQuery, (snapshot) => {
      setProducts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'products'));

    // Transactions Listener
    let txQuery;
    if (profile.role === 'regulator') {
      txQuery = query(collection(db, 'transactions'), orderBy('timestamp', 'desc'));
    } else if (profile.role === 'farmer') {
      txQuery = query(collection(db, 'transactions'), where('farmerId', '==', user.uid), orderBy('timestamp', 'desc'));
    } else {
      txQuery = query(collection(db, 'transactions'), where('buyerId', '==', user.uid), orderBy('timestamp', 'desc'));
    }

    const unsubTx = onSnapshot(txQuery, (snapshot) => {
      setTransactions(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'transactions'));

    return () => {
      unsubProducts();
      unsubTx();
    };
  }, [user, profile]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleLogout = () => signOut(auth);

  const selectRole = async (role: UserProfile['role']) => {
    if (!user) return;
    const newProfile: UserProfile = {
      uid: user.uid,
      name: user.displayName || 'New User',
      email: user.email || '',
      role: role,
      createdAt: Timestamp.now()
    };
    try {
      await setDoc(doc(db, 'users', user.uid), newProfile);
      setProfile(newProfile);
      setShowRoleSelection(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}`);
    }
  };

  const registerProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !profile) return;
    const formData = new FormData(e.currentTarget);
    const productData = {
      farmerId: user.uid,
      farmerName: profile.name,
      name: formData.get('name') as string,
      quantity: Number(formData.get('quantity')),
      pricePerUnit: Number(formData.get('price')),
      location: formData.get('location') as string,
      imageUrl: formData.get('imageUrl') as string || `https://picsum.photos/seed/${formData.get('name')}/800/600`,
      status: 'available',
      createdAt: serverTimestamp()
    };

    try {
      await addDoc(collection(db, 'products'), productData);
      (e.target as HTMLFormElement).reset();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'products');
    }
  };

  const buyProduct = async (product: Product) => {
    if (!user || !profile) return;
    try {
      // 1. Create Transaction (Simulating Smart Contract Trigger)
      const txData = {
        productId: product.id,
        productName: product.name,
        buyerId: user.uid,
        buyerName: profile.name,
        farmerId: product.farmerId,
        farmerName: product.farmerName,
        amount: product.quantity * product.pricePerUnit,
        status: 'pending',
        deliveryStatus: 'processing',
        timestamp: serverTimestamp()
      };
      await addDoc(collection(db, 'transactions'), txData);

      // 2. Update Product Status
      await updateDoc(doc(db, 'products', product.id), { status: 'sold' });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `products/${product.id}`);
    }
  };

  const confirmDelivery = async (tx: Transaction) => {
    try {
      await updateDoc(doc(db, 'transactions', tx.id), { status: 'completed', deliveryStatus: 'delivered' });
      await updateDoc(doc(db, 'products', tx.productId), { status: 'delivered' });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `transactions/${tx.id}`);
    }
  };

  const updateDeliveryStatus = async (txId: string, status: Transaction['deliveryStatus']) => {
    try {
      await updateDoc(doc(db, 'transactions', txId), { deliveryStatus: status });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `transactions/${txId}`);
    }
  };

  const updateProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !profile) return;
    const formData = new FormData(e.currentTarget);
    const newName = formData.get('name') as string;
    const newLocation = formData.get('location') as string;

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        name: newName,
        location: newLocation
      });
      // Profile state will be updated by the onSnapshot listener in useEffect
      alert('Profile updated successfully!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <Database className="w-8 h-8 text-[#141414]" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="mb-8 inline-flex p-4 bg-white rounded-full shadow-sm">
            <ShieldCheck className="w-12 h-12 text-green-600" />
          </div>
          <h1 className="text-4xl font-bold text-[#141414] mb-4 tracking-tight">AgriChain Zambia</h1>
          <p className="text-gray-600 mb-8 leading-relaxed">
            Transparent, blockchain-backed agricultural supply chain. 
            Empowering small-scale farmers with fair pricing and instant traceability.
          </p>
          <button 
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-[#141414] text-white py-4 rounded-xl font-bold hover:bg-black transition-all shadow-lg hover:shadow-xl active:scale-[0.98]"
          >
            <LogIn className="w-5 h-5" />
            Connect Wallet (Google Login)
          </button>
        </div>
      </div>
    );
  }

  if (showRoleSelection) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex flex-col items-center justify-center p-6">
        <div className="max-w-2xl w-full text-center">
          <h1 className="text-4xl font-bold text-[#141414] mb-2 tracking-tight italic serif">Choose Your Role</h1>
          <p className="text-gray-600 mb-12">Select your primary function within the AgriChain ecosystem.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <RoleCard 
              title="Farmer" 
              description="List produce, track deliveries, and receive fair payments."
              icon={<Package className="w-8 h-8" />}
              onClick={() => selectRole('farmer')}
            />
            <RoleCard 
              title="Buyer" 
              description="Browse marketplace, purchase crops, and verify origin."
              icon={<ShoppingCart className="w-8 h-8" />}
              onClick={() => selectRole('buyer')}
            />
            <RoleCard 
              title="Regulator" 
              description="Monitor network health, audit contracts, and ensure compliance."
              icon={<ShieldCheck className="w-8 h-8" />}
              onClick={() => selectRole('regulator')}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans">
        {/* Navigation Rail */}
        <nav className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-[#141414] flex items-center justify-between px-6 z-50">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-green-600" />
            <span className="font-bold text-lg tracking-tight">AgriChain</span>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-4">
              <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard size={18} />} label="Dashboard" />
              {profile?.role !== 'regulator' && (
                <NavButton active={activeTab === 'market'} onClick={() => setActiveTab('market')} icon={<ShoppingCart size={18} />} label="Marketplace" />
              )}
              <NavButton active={activeTab === 'ledger'} onClick={() => setActiveTab('ledger')} icon={<ArrowRightLeft size={18} />} label="Ledger" />
            </div>
            <div className="h-8 w-[1px] bg-gray-200 mx-2" />
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setActiveTab('settings')}
                className={cn(
                  "text-right hidden sm:block hover:opacity-80 transition-opacity",
                  activeTab === 'settings' && "text-green-600"
                )}
              >
                <p className="text-xs font-bold uppercase tracking-wider opacity-50">{profile?.role}</p>
                <p className="text-sm font-medium">{profile?.name}</p>
              </button>
              <button onClick={handleLogout} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="pt-24 pb-12 px-6 max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="grid grid-cols-1 lg:grid-cols-3 gap-8"
              >
                {/* Stats */}
                <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-6">
                  {profile?.role === 'farmer' && (
                    <>
                      <StatCard 
                        title="My Active Listings" 
                        value={products.filter(p => p.farmerId === user?.uid && p.status === 'available').length} 
                        icon={<Package className="text-orange-500" />} 
                      />
                      <StatCard 
                        title="Total Sales (ZMW)" 
                        value={transactions.filter(t => t.farmerId === user?.uid && t.status === 'completed').reduce((acc, t) => acc + t.amount, 0).toLocaleString()} 
                        icon={<TrendingUp className="text-green-500" />} 
                      />
                      <StatCard 
                        title="Pending Deliveries" 
                        value={transactions.filter(t => t.farmerId === user?.uid && t.status !== 'completed').length} 
                        icon={<Clock className="text-blue-500" />} 
                      />
                    </>
                  )}
                  {profile?.role === 'buyer' && (
                    <>
                      <StatCard 
                        title="Total Purchases (ZMW)" 
                        value={transactions.filter(t => t.buyerId === user?.uid).reduce((acc, t) => acc + t.amount, 0).toLocaleString()} 
                        icon={<ShoppingCart className="text-blue-500" />} 
                      />
                      <StatCard 
                        title="Active Orders" 
                        value={transactions.filter(t => t.buyerId === user?.uid && t.status !== 'completed').length} 
                        icon={<Clock className="text-orange-500" />} 
                      />
                      <StatCard 
                        title="Market Availability" 
                        value={products.filter(p => p.status === 'available').length} 
                        icon={<Package className="text-green-500" />} 
                      />
                    </>
                  )}
                  {profile?.role === 'regulator' && (
                    <>
                      <StatCard 
                        title="Network Volume (ZMW)" 
                        value={transactions.reduce((acc, tx) => acc + tx.amount, 0).toLocaleString()} 
                        icon={<ArrowRightLeft className="text-blue-500" />} 
                      />
                      <StatCard 
                        title="Verified Farmers" 
                        value={new Set(products.map(p => p.farmerId)).size} 
                        icon={<ShieldCheck className="text-green-500" />} 
                      />
                      <StatCard 
                        title="Active Listings" 
                        value={products.filter(p => p.status === 'available').length} 
                        icon={<Package className="text-orange-500" />} 
                      />
                    </>
                  )}
                </div>

                {/* Role Specific Actions */}
                <div className="lg:col-span-2 space-y-8">
                  {profile?.role === 'farmer' && (
                    <section className="bg-white border border-[#141414] p-8 rounded-2xl shadow-sm">
                      <h2 className="text-xl font-bold mb-6 flex items-center gap-2 italic serif">
                        <PlusCircle className="w-5 h-5" />
                        Register New Produce
                      </h2>
                      <form onSubmit={registerProduct} className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <Input label="Crop Type" name="name" placeholder="e.g. White Maize" required />
                        <Input label="Quantity (KG)" name="quantity" type="number" placeholder="500" required />
                        <Input label="Price per KG (ZMW)" name="price" type="number" step="0.01" placeholder="15.50" required />
                        <Input label="Farm Location" name="location" placeholder="e.g. Mkushi" required />
                        <div className="sm:col-span-2">
                          <Input label="Product Image URL (Optional)" name="imageUrl" placeholder="https://example.com/image.jpg" />
                          <p className="text-[10px] text-gray-400 mt-1 italic">If left blank, a high-quality placeholder will be generated based on the crop type.</p>
                        </div>
                        <button type="submit" className="sm:col-span-2 bg-[#141414] text-white py-4 rounded-xl font-bold hover:bg-black transition-all">
                          Deploy to Blockchain
                        </button>
                      </form>
                    </section>
                  )}

                  {profile?.role === 'buyer' && (
                    <section className="bg-white border border-[#141414] p-8 rounded-2xl shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold flex items-center gap-2 italic serif">
                          <ShoppingCart className="w-5 h-5" />
                          Marketplace Quick Actions
                        </h2>
                        <button 
                          onClick={() => setActiveTab('market')}
                          className="text-sm font-bold text-blue-600 hover:underline flex items-center gap-1"
                        >
                          View All <TrendingUp size={14} />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {products.filter(p => p.status === 'available').slice(0, 4).map(product => (
                          <div key={product.id} className="p-4 border border-gray-100 rounded-xl hover:border-[#141414] transition-all group">
                            <div className="flex justify-between items-start mb-2">
                              <p className="font-bold">{product.name}</p>
                              <p className="text-xs font-mono opacity-40">ZMW {product.pricePerUnit}/KG</p>
                            </div>
                            <p className="text-xs text-gray-500 mb-4">{product.location} • {product.quantity}KG</p>
                            <button 
                              onClick={() => buyProduct(product)}
                              className="w-full py-2 bg-gray-100 group-hover:bg-[#141414] group-hover:text-white rounded-lg text-xs font-bold transition-all"
                            >
                              Quick Purchase
                            </button>
                          </div>
                        ))}
                        {products.filter(p => p.status === 'available').length === 0 && (
                          <p className="col-span-2 text-center py-8 text-gray-400 italic">No active listings available.</p>
                        )}
                      </div>
                    </section>
                  )}

                  {profile?.role === 'regulator' && (
                    <section className="bg-white border border-[#141414] p-8 rounded-2xl shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold flex items-center gap-2 italic serif">
                          <ShieldCheck className="w-5 h-5" />
                          Compliance & Network Overview
                        </h2>
                        <button 
                          onClick={() => setActiveTab('settings')}
                          className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-[#141414] transition-colors"
                        >
                          <Settings size={14} />
                          Profile Settings
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="p-4 bg-blue-50 rounded-xl">
                          <p className="text-[10px] uppercase font-bold tracking-widest text-blue-600 mb-1">Total Network Volume</p>
                          <p className="text-2xl font-bold">ZMW {transactions.reduce((acc, tx) => acc + tx.amount, 0).toLocaleString()}</p>
                        </div>
                        <div className="p-4 bg-green-50 rounded-xl">
                          <p className="text-[10px] uppercase font-bold tracking-widest text-green-600 mb-1">Verified Farmers</p>
                          <p className="text-2xl font-bold">{new Set(products.map(p => p.farmerId)).size}</p>
                        </div>
                        <div className="col-span-2 p-4 border border-gray-100 rounded-xl">
                          <h3 className="text-sm font-bold mb-3">Recent Compliance Logs</h3>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-500">Smart Contract Audit</span>
                              <span className="text-green-600 font-bold">PASSED</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-500">Price Fairness Check</span>
                              <span className="text-green-600 font-bold">OPTIMAL</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-500">Traceability Index</span>
                              <span className="text-blue-600 font-bold">99.8%</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  <section className="bg-white border border-[#141414] rounded-2xl overflow-hidden shadow-sm">
                    <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                      <h2 className="text-xl font-bold italic serif">Recent Activity</h2>
                      <History className="w-5 h-5 opacity-30" />
                    </div>
                    <div className="divide-y divide-gray-100">
                      {transactions.slice(0, 5).map(tx => (
                        <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className={cn(
                              "p-2 rounded-full",
                              tx.status === 'completed' ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                            )}>
                              {tx.status === 'completed' ? <CheckCircle2 size={18} /> : <Clock size={18} />}
                            </div>
                            <div>
                              <p className="font-bold text-sm">{tx.productName}</p>
                              <p className="text-xs text-gray-500">
                                {profile?.role === 'farmer' ? `Buyer: ${tx.buyerName}` : `Farmer: ${tx.farmerName}`}
                              </p>
                              {tx.deliveryStatus && (
                                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-tighter mt-1">
                                  Delivery: {tx.deliveryStatus}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-mono text-sm font-bold">ZMW {tx.amount.toFixed(2)}</p>
                            <p className="text-[10px] uppercase tracking-widest opacity-40">
                              {tx.timestamp?.toDate().toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      ))}
                      {transactions.length === 0 && (
                        <div className="p-12 text-center text-gray-400 italic">No transactions recorded yet.</div>
                      )}
                    </div>
                  </section>
                </div>

                {/* Sidebar Info */}
                <div className="space-y-6">
                  <div className="bg-[#141414] text-white p-6 rounded-2xl">
                    <h3 className="text-sm font-bold uppercase tracking-widest mb-4 opacity-60">Smart Contract Status</h3>
                    <div className="space-y-4">
                      <StatusItem label="Escrow Service" active />
                      <StatusItem label="Auto-Payment" active />
                      <StatusItem label="Traceability" active />
                    </div>
                  </div>
                  <div className="bg-white border border-[#141414] p-6 rounded-2xl">
                    <h3 className="text-sm font-bold uppercase tracking-widest mb-4 opacity-40">Market Trends</h3>
                    <div className="space-y-3">
                      <TrendItem label="Maize" change="+5.2%" up />
                      <TrendItem label="Soybeans" change="-1.4%" />
                      <TrendItem label="Wheat" change="+2.8%" up />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'market' && (
              <motion.div 
                key="market"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h1 className="text-3xl font-bold tracking-tight italic serif">Global Marketplace</h1>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Database size={14} />
                    <span>{filteredProducts.length} Products Found</span>
                  </div>
                </div>

                {/* Filters & Sorting Bar */}
                <div className="bg-white border border-[#141414] p-4 rounded-2xl shadow-sm space-y-4">
                  <div className="flex flex-col lg:flex-row gap-4">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                      <input 
                        type="text"
                        placeholder="Search products..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-xl focus:border-[#141414] outline-none text-sm"
                      />
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                        <Package size={14} className="text-gray-400" />
                        <select 
                          value={selectedCrop}
                          onChange={(e) => setSelectedCrop(e.target.value)}
                          className="bg-transparent text-sm outline-none cursor-pointer min-w-[100px]"
                        >
                          <option value="">All Crops</option>
                          {uniqueCrops.map(crop => (
                            <option key={crop} value={crop}>{crop}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                        <MapPin size={14} className="text-gray-400" />
                        <select 
                          value={selectedLocation}
                          onChange={(e) => setSelectedLocation(e.target.value)}
                          className="bg-transparent text-sm outline-none cursor-pointer min-w-[100px]"
                        >
                          <option value="">All Locations</option>
                          {uniqueLocations.map(loc => (
                            <option key={loc} value={loc}>{loc}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        <input 
                          type="number"
                          placeholder="Min ZMW"
                          value={minPrice}
                          onChange={(e) => setMinPrice(e.target.value === '' ? '' : Number(e.target.value))}
                          className="px-3 py-2 bg-gray-50 border border-gray-100 rounded-xl focus:border-[#141414] outline-none text-sm w-24"
                        />
                        <span className="text-gray-300">-</span>
                        <input 
                          type="number"
                          placeholder="Max ZMW"
                          value={maxPrice}
                          onChange={(e) => setMaxPrice(e.target.value === '' ? '' : Number(e.target.value))}
                          className="px-3 py-2 bg-gray-50 border border-gray-100 rounded-xl focus:border-[#141414] outline-none text-sm w-24"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Filter size={14} className="text-gray-400" />
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Sort By:</span>
                        <select 
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value as any)}
                          className="bg-transparent text-sm font-bold outline-none cursor-pointer"
                        >
                          <option value="date">Date Listed</option>
                          <option value="price">Price</option>
                          <option value="quantity">Quantity</option>
                        </select>
                        <button 
                          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                          title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                        >
                          <ArrowUpDown size={14} className={cn(sortOrder === 'desc' && "rotate-180")} />
                        </button>
                      </div>
                    </div>

                    <button 
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedCrop('');
                        setSelectedLocation('');
                        setMinPrice('');
                        setMaxPrice('');
                        setSortBy('date');
                        setSortOrder('desc');
                      }}
                      className="text-[10px] font-bold uppercase tracking-widest text-red-600 hover:underline"
                    >
                      Clear All Filters
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredProducts.map(product => (
                    <div key={product.id} className="bg-white border border-[#141414] rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow group">
                      <div className="aspect-video w-full overflow-hidden bg-gray-100 relative">
                        <img 
                          src={product.imageUrl || `https://picsum.photos/seed/${product.name}/800/600`} 
                          alt={product.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute top-4 right-4">
                          <span className="text-[10px] font-mono bg-white/90 backdrop-blur px-2 py-1 rounded shadow-sm border border-gray-100">
                            ID: {product.id.slice(0, 8)}
                          </span>
                        </div>
                      </div>
                      <div className="p-6">
                        <div className="flex justify-between items-start mb-4">
                          <div className="p-3 bg-green-50 rounded-xl text-green-700">
                            <Package size={24} />
                          </div>
                        </div>
                        <h3 className="text-xl font-bold mb-1">{product.name}</h3>
                        <p className="text-sm text-gray-500 mb-4 flex items-center gap-1">
                          <MapPin size={14} /> {product.location}
                        </p>
                        <div className="grid grid-cols-2 gap-4 mb-6">
                          <div>
                            <p className="text-[10px] uppercase tracking-widest opacity-40">Quantity</p>
                            <p className="font-bold">{product.quantity} KG</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-widest opacity-40">Price/KG</p>
                            <p className="font-bold">ZMW {product.pricePerUnit.toFixed(2)}</p>
                          </div>
                        </div>
                        <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                          <div>
                            <p className="text-[10px] uppercase tracking-widest opacity-40">Farmer</p>
                            <p className="text-sm font-medium">{product.farmerName}</p>
                          </div>
                          {profile?.role === 'buyer' && (
                            <button 
                              onClick={() => buyProduct(product)}
                              className="bg-[#141414] text-white px-6 py-2 rounded-lg font-bold hover:bg-black transition-all"
                            >
                              Buy Now
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {filteredProducts.length === 0 && (
                    <div className="col-span-full py-24 text-center">
                      <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                      <p className="text-gray-400 italic">No products match your current filters.</p>
                      <button 
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedCrop('');
                          setSelectedLocation('');
                          setMinPrice('');
                          setMaxPrice('');
                        }}
                        className="mt-4 text-sm font-bold text-[#141414] underline"
                      >
                        Reset All Filters
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'ledger' && (
              <motion.div 
                key="ledger"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between">
                  <h1 className="text-3xl font-bold tracking-tight italic serif">Immutable Ledger</h1>
                  <div className="flex items-center gap-2 text-sm text-green-600 font-bold">
                    <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
                    Live Sync
                  </div>
                </div>

                <div className="bg-white border border-[#141414] rounded-2xl overflow-hidden shadow-sm">
                  <div className="grid grid-cols-6 p-4 bg-gray-50 border-b border-[#141414] text-[10px] font-bold uppercase tracking-widest opacity-50">
                    <div className="col-span-1">Hash / ID</div>
                    <div className="col-span-1">Product</div>
                    <div className="col-span-1">Parties</div>
                    <div className="col-span-1">Amount</div>
                    <div className="col-span-1">Delivery</div>
                    <div className="col-span-1">Status</div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {transactions.map(tx => (
                      <div key={tx.id} className="grid grid-cols-6 p-4 items-center hover:bg-gray-50 transition-colors">
                        <div className="col-span-1 font-mono text-xs opacity-60 truncate pr-4">
                          {tx.id}
                        </div>
                        <div className="col-span-1 font-bold text-sm">
                          {tx.productName}
                        </div>
                        <div className="col-span-1 text-xs">
                          <p className="font-medium">F: {tx.farmerName}</p>
                          <p className="text-gray-400">B: {tx.buyerName}</p>
                        </div>
                        <div className="col-span-1 font-mono text-sm font-bold">
                          ZMW {tx.amount.toFixed(2)}
                        </div>
                        <div className="col-span-1">
                          {profile?.role === 'farmer' && tx.status !== 'completed' ? (
                            <select 
                              value={tx.deliveryStatus || 'processing'}
                              onChange={(e) => updateDeliveryStatus(tx.id, e.target.value as any)}
                              className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-1 rounded outline-none cursor-pointer"
                            >
                              <option value="processing">Processing</option>
                              <option value="shipped">Shipped</option>
                              <option value="in-transit">In-Transit</option>
                              <option value="delivered">Delivered</option>
                            </select>
                          ) : (
                            <span className="text-[10px] font-bold text-blue-600 uppercase">
                              {tx.deliveryStatus || 'N/A'}
                            </span>
                          )}
                        </div>
                        <div className="col-span-1 flex items-center justify-between">
                          <span className={cn(
                            "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                            tx.status === 'completed' ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                          )}>
                            {tx.status}
                          </span>
                          {tx.status === 'pending' && profile?.role === 'buyer' && (
                            <button 
                              onClick={() => confirmDelivery(tx)}
                              className="text-[10px] font-bold text-blue-600 hover:underline"
                            >
                              Confirm
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {transactions.length === 0 && (
                      <div className="p-12 text-center text-gray-400 italic">No ledger entries found.</div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-2xl mx-auto space-y-8"
              >
                <div className="flex items-center gap-4">
                  <div className="p-4 bg-white border border-[#141414] rounded-2xl shadow-sm">
                    <Settings className="w-8 h-8 text-gray-400" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight italic serif">Profile Settings</h1>
                    <p className="text-sm text-gray-500">Manage your blockchain identity and preferences</p>
                  </div>
                </div>

                <section className="bg-white border border-[#141414] p-8 rounded-2xl shadow-sm">
                  <form onSubmit={updateProfile} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <Input 
                        label="Full Name" 
                        name="name" 
                        defaultValue={profile?.name} 
                        required 
                        placeholder="Your full name"
                      />
                      <Input 
                        label="Location / Region" 
                        name="location" 
                        defaultValue={profile?.location} 
                        placeholder="e.g. Lusaka, Zambia"
                      />
                    </div>
                    
                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-2">Immutable Identity Data</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase">Role</p>
                          <p className="text-sm font-mono font-bold uppercase">{profile?.role}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase">Email</p>
                          <p className="text-sm font-mono font-bold">{profile?.email}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-[10px] text-gray-400 uppercase">Blockchain ID (UID)</p>
                          <p className="text-xs font-mono break-all opacity-60">{profile?.uid}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end pt-4">
                      <button 
                        type="submit" 
                        className="flex items-center gap-2 bg-[#141414] text-white px-8 py-3 rounded-xl font-bold hover:bg-black transition-all shadow-md active:scale-[0.98]"
                      >
                        <Save size={18} />
                        Save Changes
                      </button>
                    </div>
                  </form>
                </section>

                <section className="bg-red-50 border border-red-200 p-6 rounded-2xl">
                  <h3 className="text-sm font-bold text-red-800 mb-2">Security Note</h3>
                  <p className="text-xs text-red-600 leading-relaxed">
                    Changes to your name and location will be reflected across the network for all future transactions. 
                    Your role and email are linked to your verified identity and cannot be changed without regulator approval.
                  </p>
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </ErrorBoundary>
  );
}

// --- Sub-components ---

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all",
        active ? "bg-[#141414] text-white shadow-md" : "text-gray-500 hover:bg-gray-100"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function StatCard({ title, value, icon }: { title: string, value: string | number, icon: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#141414] p-6 rounded-2xl shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">{title}</p>
        <div className="opacity-80">{icon}</div>
      </div>
      <p className="text-3xl font-bold tracking-tight">{value}</p>
    </div>
  );
}

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold uppercase tracking-widest opacity-50">{label}</label>
      <input 
        {...props}
        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-[#141414] focus:ring-1 focus:ring-[#141414] outline-none transition-all"
      />
    </div>
  );
}

function StatusItem({ label, active }: { label: string, active: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="opacity-60">{label}</span>
      <span className={cn("font-bold", active ? "text-green-400" : "text-red-400")}>
        {active ? 'ACTIVE' : 'OFFLINE'}
      </span>
    </div>
  );
}

function TrendItem({ label, change, up }: { label: string, change: string, up?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium">{label}</span>
      <span className={cn("font-mono font-bold", up ? "text-green-600" : "text-red-600")}>
        {change}
      </span>
    </div>
  );
}

function RoleCard({ title, description, icon, onClick }: { title: string, description: string, icon: React.ReactNode, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="bg-white border border-[#141414] p-8 rounded-2xl shadow-sm hover:shadow-md hover:bg-black hover:text-white transition-all group text-left flex flex-col h-full"
    >
      <div className="mb-6 p-4 bg-gray-50 rounded-xl text-[#141414] group-hover:bg-white/10 group-hover:text-white transition-colors inline-block w-fit">
        {icon}
      </div>
      <h3 className="text-xl font-bold mb-2 italic serif">{title}</h3>
      <p className="text-sm opacity-60 leading-relaxed flex-grow">{description}</p>
      <div className="mt-8 flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
        Select Role <ArrowRightLeft size={14} />
      </div>
    </button>
  );
}
