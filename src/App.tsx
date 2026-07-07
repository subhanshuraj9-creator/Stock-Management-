/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { auth, logout } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { StockManagement } from './components/StockManagement';
import { JobManagement } from './components/JobManagement';
import { PartyLedger } from './components/PartyLedger';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Button } from './components/ui/button';
import { LogOut, LayoutDashboard, Package, FileText, Printer, BookOpen, AlertTriangle } from 'lucide-react';
import { Toaster } from 'sonner';
import { FirebaseDataProvider } from './contexts/FirebaseDataContext';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [quotaWarning, setQuotaWarning] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleQuotaWarning = () => {
      setQuotaWarning(true);
    };
    window.addEventListener('firestore-quota-warning', handleQuotaWarning);
    return () => {
      window.removeEventListener('firestore-quota-warning', handleQuotaWarning);
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0]">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-[#5A5A40] opacity-20" />
          <p className="text-[#5A5A40] font-serif italic">Loading PrintStock Pro...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  return (
    <ErrorBoundary>
      <FirebaseDataProvider>
        <div className="min-h-screen bg-[#f5f5f0] text-gray-900 font-sans selection:bg-[#5A5A40] selection:text-white">
          <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 md:h-20 flex items-center justify-between">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-[#5A5A40] flex items-center justify-center text-white">
                  <Printer size={18} className="md:w-6 md:h-6" />
                </div>
                <div>
                  <h1 className="text-lg md:text-xl font-serif font-bold tracking-tight">PrintStock Pro</h1>
                  <p className="text-[8px] md:text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold hidden sm:block">Management System</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2 md:gap-4">
                <div className="hidden sm:flex flex-col items-end mr-2">
                  <p className="text-sm font-medium text-gray-900 capitalize">
                    {user.email?.split('@')[0]}
                  </p>
                  <p className="text-xs text-gray-400 uppercase tracking-widest font-bold">Admin</p>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={logout}
                  className="rounded-full hover:bg-red-50 hover:text-red-600 transition-colors h-9 w-9 md:h-10 md:w-10"
                >
                  <LogOut size={18} className="md:w-5 md:h-5" />
                </Button>
              </div>
            </div>
          </header>

          {quotaWarning && (
            <div className="bg-amber-50 border-b border-amber-200">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="text-amber-600 shrink-0 w-5 h-5" />
                  <p className="text-xs sm:text-sm text-amber-800 font-medium leading-relaxed">
                    <strong>Local Caching Active:</strong> Firestore daily free read/sync limits have been exceeded. You can still fully browse, search, and manage print stock lists, jobs, and ledger details locally from cache. Updates will sync with the cloud server once Firestore resets the limits.
                  </p>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setQuotaWarning(false)}
                  className="text-amber-700 hover:bg-amber-100 hover:text-amber-900 rounded-full h-8 px-3 font-medium shrink-0"
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8">
            <Tabs defaultValue="dashboard" className="space-y-6 md:space-y-8">
              <div className="flex justify-center sticky top-[65px] md:top-[81px] z-40 bg-[#f5f5f0]/80 backdrop-blur-sm py-2 -mx-4 px-4">
                <TabsList className="bg-white p-1 rounded-full border border-gray-200 shadow-sm h-12 md:h-14 w-full max-w-lg overflow-x-auto no-scrollbar flex-nowrap">
                  <TabsTrigger 
                    value="dashboard" 
                    className="rounded-full px-2 sm:px-4 md:px-6 h-10 md:h-12 data-[state=active]:bg-[#5A5A40] data-[state=active]:text-white transition-all gap-1 sm:gap-2 flex-1 animate-none"
                  >
                    <LayoutDashboard size={15} className="sm:w-[18px] sm:h-[18px]" />
                    <span className="text-[10px] sm:text-xs md:text-sm">Dashboard</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="stock" 
                    className="rounded-full px-2 sm:px-4 md:px-6 h-10 md:h-12 data-[state=active]:bg-[#5A5A40] data-[state=active]:text-white transition-all gap-1 sm:gap-2 flex-1 animate-none"
                  >
                    <Package size={15} className="sm:w-[18px] sm:h-[18px]" />
                    <span className="text-[10px] sm:text-xs md:text-sm">Stock</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="jobs" 
                    className="rounded-full px-2 sm:px-4 md:px-6 h-10 md:h-12 data-[state=active]:bg-[#5A5A40] data-[state=active]:text-white transition-all gap-1 sm:gap-2 flex-1 animate-none"
                  >
                    <FileText size={15} className="sm:w-[18px] sm:h-[18px]" />
                    <span className="text-[10px] sm:text-xs md:text-sm">Jobs</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="ledger" 
                    className="rounded-full px-2 sm:px-4 md:px-6 h-10 md:h-12 data-[state=active]:bg-[#5A5A40] data-[state=active]:text-white transition-all gap-1 sm:gap-2 flex-1 animate-none"
                  >
                    <BookOpen size={15} className="sm:w-[18px] sm:h-[18px]" />
                    <span className="text-[10px] sm:text-xs md:text-sm">Ledger</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="dashboard" className="mt-0 focus-visible:outline-none">
                <Dashboard />
              </TabsContent>
              
              <TabsContent value="stock" className="mt-0 focus-visible:outline-none">
                <StockManagement />
              </TabsContent>
              
              <TabsContent value="jobs" className="mt-0 focus-visible:outline-none">
                <JobManagement />
              </TabsContent>

              <TabsContent value="ledger" className="mt-0 focus-visible:outline-none">
                <PartyLedger />
              </TabsContent>
            </Tabs>
          </main>
          <Toaster position="bottom-right" richColors />
        </div>
      </FirebaseDataProvider>
    </ErrorBoundary>
  );
}
