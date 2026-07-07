import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType, cleanUndefined } from '../firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, runTransaction, writeBatch, getDocs, where } from 'firebase/firestore';
import { StockItem, StockType, InkUsage, StockHistory } from '../types';
import { useFirebaseData } from '../contexts/FirebaseDataContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Plus, Search, Trash2, Edit2, Package, Trash, History, ArrowRight, PlusCircle, ShoppingBag, IndianRupee, ReceiptText, Truck, Download, ArrowUpRight } from 'lucide-react';
import { Badge } from './ui/badge';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { format } from 'date-fns';

const getDefaultPlatesPerPacket = (sizeStr: string | undefined): number => {
  if (!sizeStr) return 50;
  const clean = sizeStr.toLowerCase().replace(/\s/g, '');
  const match = clean.match(/(\d+)/g);
  if (match && match.length >= 2) {
    const d1 = parseFloat(match[0]);
    const d2 = parseFloat(match[1]);
    const maxDim = Math.max(d1, d2);
    if (maxDim > 800) {
      return 50;
    } else if (maxDim > 500) {
      return 50;
    } else {
      return 100;
    }
  }
  if (clean.includes('x') || clean.includes('*')) {
    const parts = clean.split(/[x*]/);
    const d1 = parseFloat(parts[0]);
    const d2 = parseFloat(parts[1]);
    if (!isNaN(d1) && !isNaN(d2)) {
      const maxDim = Math.max(d1, d2);
      if (maxDim > 30) {
        return 50;
      } else if (maxDim > 20) {
        return 50;
      } else {
        return 100;
      }
    }
  }
  return 50;
};

export function StockManagement() {
  const {
    stocks,
    inkUsages,
    stockHistory,
    jobs,
    jobsLoaded,
    historyLoaded: stockHistoryLoaded,
    paperSections,
    boardSections,
  } = useFirebaseData();
  const [isHistClearOpen, setIsHistClearOpen] = useState(false);
  const [histClearType, setHistClearType] = useState<StockType | null>(null);
  const [isHistClearing, setIsHistClearing] = useState(false);

  const handleClearStockHistory = async (type: StockType) => {
    setIsHistClearing(true);
    try {
      const targetHistory = stockHistory.filter(h => {
        const stock = stocks.find(s => s.id === h.stockId);
        return stock?.type === type;
      });

      const batch = writeBatch(db);
      targetHistory.forEach(h => {
        batch.delete(doc(db, 'stockHistory', h.id));
      });

      if (type === 'ink') {
        inkUsages.forEach(u => {
          batch.delete(doc(db, 'inkUsage', u.id));
        });
      }

      await batch.commit();
      toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} stock history cleared successfully`);
      setIsHistClearOpen(false);
      setHistClearType(null);
    } catch (error) {
      console.error(error);
      toast.error(`Failed to clear ${type} stock history`);
    } finally {
      setIsHistClearing(false);
    }
  };

  const [activeTab, setActiveTab] = useState('paper');
  const [selectedPaperType, setSelectedPaperType] = useState('all');
  const [isManageSectionsOpen, setIsManageSectionsOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [isAddingNewSectInline, setIsAddingNewSectInline] = useState(false);
  const [newSectInlineName, setNewSectInlineName] = useState('');

  const [selectedBoardType, setSelectedBoardType] = useState('all');
  const [isManageBoardSectionsOpen, setIsManageBoardSectionsOpen] = useState(false);
  const [newBoardSectionName, setNewBoardSectionName] = useState('');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingStock, setEditingStock] = useState<StockItem | null>(null);
  const [isUsageOpen, setIsUsageOpen] = useState(false);
  const [selectedInk, setSelectedInk] = useState<StockItem | null>(null);
  const [stockToDelete, setStockToDelete] = useState<StockItem | null>(null);
  const [purchaseToDelete, setPurchaseToDelete] = useState<StockHistory | null>(null);
  const [isDeletingPurchase, setIsDeletingPurchase] = useState(false);
  const [usageToDelete, setUsageToDelete] = useState<StockHistory | null>(null);
  const [isDeletingUsage, setIsDeletingUsage] = useState(false);

  const availablePaperSections = React.useMemo(() => {
    const userSectNames = paperSections.map(s => s.name);
    // Include unique paper types from actual stock items to avoid lost groups
    const stockSectNames = stocks
      .filter(s => s.type === 'paper' && s.paperType)
      .map(s => s.paperType!);
    const unique = Array.from(new Set([...userSectNames, ...stockSectNames]));
    return unique.sort((a, b) => a.localeCompare(b));
  }, [paperSections, stocks]);

  const availableBoardSections = React.useMemo(() => {
    const userSectNames = boardSections.map(s => s.name);
    // Include unique board types from actual stock items to avoid lost groups
    const stockSectNames = stocks
      .filter(s => s.type === 'board' && s.paperType)
      .map(s => s.paperType!);
    const unique = Array.from(new Set([...userSectNames, ...stockSectNames]));
    return unique.sort((a, b) => a.localeCompare(b));
  }, [boardSections, stocks]);

  const [isPurchaseOpen, setIsPurchaseOpen] = useState(false);
  const [selectedStockForPurchase, setSelectedStockForPurchase] = useState<StockItem | null>(null);
  const [purchaseFormData, setPurchaseFormData] = useState({
    quantity: '',
    rate: '',
    supplier: '',
    invoiceNo: '',
    notes: '',
    inkContainers: [] as { weight: string, count: string }[],
    purchaseMode: 'kg' as 'kg' | 'sheets' | 'packs',
    quantityKg: '',
    ratePerKg: '',
    packType: 'ream' as 'ream' | 'bundle' | 'gross' | 'custom',
    packQuantity: '',
    sheetsPerPack: '500',
    date: new Date().toISOString().split('T')[0],
  });

  const [usageFormData, setUsageFormData] = useState({
    weight: '',
    count: '',
    quantity: '',
    notes: ''
  });

  const [formData, setFormData] = useState({
    name: '',
    gsm: '',
    size: '',
    quantity: '',
    type: 'paper' as StockType,
    inkContainers: [] as { weight: string, count: string }[],
    paperType: '',
    defaultRate: '',
    unit: 'Sheets',
    brand: '',
    millName: '',
    shade: '',
    notes: ''
  });

  // Subscriptions handled globally via FirebaseDataProvider

  // Helper to determine if a stockHistory item belongs to a deleted job
  const isJobHistoryOrphan = (h: StockHistory) => {
    const isJobRelated = h.jobId || 
      h.notes?.toLowerCase().includes('job created') || 
      h.notes?.toLowerCase().includes('job updated') || 
      h.notes?.toLowerCase().includes('job deleted') ||
      h.notes?.toLowerCase().includes('reconstructed');

    if (!isJobRelated) return false;

    // If jobId is present, check if jobId actually exists in the active jobs
    if (h.jobId) {
      return !jobs.some(j => j.id === h.jobId);
    }

    // Traditional matching for older records based on notes
    const notesLower = (h.notes || '').toLowerCase();
    
    // We expect notes to have client and description, e.g., "Job created (individual stock deducted): client - description" or "Job updated: client - description"
    const matchedAnyActive = jobs.some(j => {
      const client = (j.clientName || '').toLowerCase().trim();
      const desc = (j.jobDescription || '').toLowerCase().trim();
      return client && desc && notesLower.includes(client) && notesLower.includes(desc);
    });

    return !matchedAnyActive;
  };

  // Automatic background cleanup of orphan stockHistory entries (belonging to deleted jobs)
  useEffect(() => {
    if (!jobsLoaded || !stockHistoryLoaded) return;
    
    const orphans = stockHistory.filter(isJobHistoryOrphan);

    if (orphans.length > 0) {
      console.log(`Auto-cleaning ${orphans.length} legacy stockHistory entries from deleted jobs...`);
      const batch = writeBatch(db);
      // Process in batches
      const maxBatchSize = Math.min(orphans.length, 400);
      for (let i = 0; i < maxBatchSize; i++) {
        batch.delete(doc(db, 'stockHistory', orphans[i].id));
      }
      batch.commit().then(() => {
        console.log(`Successfully purged ${maxBatchSize} orphan logs.`);
      }).catch(err => {
        console.error('Failed to purge orphan stock history entries:', err);
      });
    }
  }, [jobs, stockHistory, jobsLoaded, stockHistoryLoaded]);

  const handleRecordUsage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInk) return;

    try {
      await runTransaction(db, async (transaction) => {
        const stockRef = doc(db, 'stocks', selectedInk.id);
        const stockSnap = await transaction.get(stockRef);
        
        if (!stockSnap.exists()) throw new Error("Stock item not found");
        const stockData = stockSnap.data() as StockItem;
        
        let newTotalQuantity = 0;
        let updateData: any = {
          lastUpdated: Date.now()
        };
        let deductedQuantity = 0;
        let usageNotesMsg = '';

        if (selectedInk.type === 'ink') {
          const containerWeightInput = usageFormData.weight ? Number(usageFormData.weight) : 0;
          const targetWeight = Number(usageFormData.quantity);

          if (isNaN(targetWeight) || targetWeight <= 0) {
            throw new Error("Please enter a valid weight in kg to deduct");
          }

          const curContainers = stockData.inkContainers ? [...stockData.inkContainers] : [];
          const totalStockKg = curContainers.length > 0
            ? curContainers.reduce((sum, c) => sum + (c.weight * c.count), 0)
            : stockData.quantity;

          if (totalStockKg < targetWeight) {
            throw new Error(`Insufficient stock. Total available: ${totalStockKg.toFixed(2)}kg, requested: ${targetWeight}kg`);
          }

          const computedCount = containerWeightInput > 0 ? Math.round(targetWeight / containerWeightInput) : 0;
          const isExactMultiple = containerWeightInput > 0 && Math.abs(computedCount * containerWeightInput - targetWeight) < 0.001;

          if (isExactMultiple && curContainers.length > 0) {
            const containerIndex = curContainers.findIndex(c => Math.abs(c.weight - containerWeightInput) < 0.001);
            if (containerIndex !== -1 && curContainers[containerIndex].count >= computedCount) {
              curContainers[containerIndex] = {
                ...curContainers[containerIndex],
                count: curContainers[containerIndex].count - computedCount
              };

              const finalContainers = curContainers.filter(c => c.count > 0);
              newTotalQuantity = finalContainers.reduce((sum, c) => sum + (c.weight * c.count), 0);
              updateData.inkContainers = finalContainers;
              updateData.quantity = newTotalQuantity;
              deductedQuantity = targetWeight;
              usageNotesMsg = `Ink usage: ${computedCount}x ${containerWeightInput}kg (${targetWeight.toFixed(2)} kg). ${usageFormData.notes}`;
            } else {
              // Fallback to breaking containers optimized if we don't have enough of the exact size
              let weightNeeded = targetWeight;
              const sortedContainers = [...curContainers].map(c => ({ ...c })).sort((a, b) => b.weight - a.weight);

              for (let i = 0; i < sortedContainers.length; i++) {
                if (weightNeeded <= 0) break;
                const c = sortedContainers[i];
                if (c.count <= 0) continue;

                const maxCanUse = Math.floor(weightNeeded / c.weight);
                const actualUse = Math.min(maxCanUse, c.count);

                if (actualUse > 0) {
                  c.count -= actualUse;
                  weightNeeded -= actualUse * c.weight;
                }
              }

              if (weightNeeded > 0) {
                // Break a larger container
                const sortedAsc = [...sortedContainers].sort((a, b) => a.weight - b.weight);
                const containerToBreak = sortedAsc.find(c => c.count > 0);
                if (containerToBreak) {
                  containerToBreak.count -= 1;
                  const remainingWeight = containerToBreak.weight - weightNeeded;
                  weightNeeded = 0;
                  if (remainingWeight > 0) {
                    const existingIdx = sortedContainers.findIndex(c => Math.abs(c.weight - remainingWeight) < 0.001);
                    if (existingIdx !== -1) {
                      sortedContainers[existingIdx].count += 1;
                    } else {
                      sortedContainers.push({ weight: Number(remainingWeight.toFixed(3)), count: 1 });
                    }
                  }
                }
              }

              if (weightNeeded > 1e-4) {
                throw new Error("Insufficient matching containers in inventory for total weight deduction");
              }

              const finalContainers = sortedContainers.filter(c => c.count > 0);
              newTotalQuantity = finalContainers.reduce((sum, c) => sum + (c.weight * c.count), 0);
              
              updateData.inkContainers = finalContainers;
              updateData.quantity = newTotalQuantity;
              deductedQuantity = targetWeight;
              usageNotesMsg = `Ink usage: ${targetWeight.toLocaleString('en-IN', { maximumFractionDigits: 3 })} kg. ${usageFormData.notes}`;
            }
          } else {
            if (curContainers.length === 0) {
              newTotalQuantity = stockData.quantity - targetWeight;
              updateData.quantity = newTotalQuantity;
              deductedQuantity = targetWeight;
              usageNotesMsg = `Ink usage: ${targetWeight.toLocaleString('en-IN', { maximumFractionDigits: 3 })} kg. ${usageFormData.notes}`;
            } else {
              let weightNeeded = targetWeight;
              const sortedContainers = [...curContainers].map(c => ({ ...c })).sort((a, b) => b.weight - a.weight);

              for (let i = 0; i < sortedContainers.length; i++) {
                if (weightNeeded <= 0) break;
                const c = sortedContainers[i];
                if (c.count <= 0) continue;

                const maxCanUse = Math.floor(weightNeeded / c.weight);
                const actualUse = Math.min(maxCanUse, c.count);

                if (actualUse > 0) {
                  c.count -= actualUse;
                  weightNeeded -= actualUse * c.weight;
                }
              }

              if (weightNeeded > 0) {
                // Break a larger container
                const sortedAsc = [...sortedContainers].sort((a, b) => a.weight - b.weight);
                const containerToBreak = sortedAsc.find(c => c.count > 0);
                if (containerToBreak) {
                  containerToBreak.count -= 1;
                  const remainingWeight = containerToBreak.weight - weightNeeded;
                  weightNeeded = 0;
                  if (remainingWeight > 0) {
                    const existingIdx = sortedContainers.findIndex(c => Math.abs(c.weight - remainingWeight) < 0.001);
                    if (existingIdx !== -1) {
                      sortedContainers[existingIdx].count += 1;
                    } else {
                      sortedContainers.push({ weight: Number(remainingWeight.toFixed(3)), count: 1 });
                    }
                  }
                }
              }

              if (weightNeeded > 1e-4) {
                throw new Error("Insufficient matching containers in inventory for total weight deduction");
              }

              const finalContainers = sortedContainers.filter(c => c.count > 0);
              newTotalQuantity = finalContainers.reduce((sum, c) => sum + (c.weight * c.count), 0);
              
              updateData.inkContainers = finalContainers;
              updateData.quantity = newTotalQuantity;
              deductedQuantity = targetWeight;
              usageNotesMsg = `Ink usage: (${targetWeight.toLocaleString('en-IN', { maximumFractionDigits: 3 })} kg). ${usageFormData.notes}`;
            }
          }
        } else {
          const qtyToDeduct = Number(usageFormData.quantity);
          if (isNaN(qtyToDeduct) || qtyToDeduct <= 0) {
            throw new Error("Please enter a valid quantity to deduct");
          }
          if (stockData.quantity < qtyToDeduct) {
            throw new Error(`Insufficient stock. Only ${stockData.quantity} available.`);
          }
          newTotalQuantity = stockData.quantity - qtyToDeduct;
          updateData.quantity = newTotalQuantity;
          deductedQuantity = qtyToDeduct;
          const unitLabel = selectedInk.type === 'plate' ? 'units' : 'sheets';
          usageNotesMsg = `${selectedInk.type.charAt(0).toUpperCase() + selectedInk.type.slice(1)} usage: ${qtyToDeduct} ${unitLabel}. ${usageFormData.notes}`;
        }

        transaction.update(stockRef, cleanUndefined(updateData));

        const usageRef = doc(collection(db, 'inkUsage'));
        // We write to standard usage collection
        transaction.set(usageRef, cleanUndefined({
          inkId: selectedInk.id,
          date: Date.now(),
          weight: selectedInk.type === 'ink' ? (usageFormData.weight ? Number(usageFormData.weight) : null) : null,
          count: selectedInk.type === 'ink' ? (usageFormData.count ? Number(usageFormData.count) : null) : null,
          quantity: Number(usageFormData.quantity),
          stockType: selectedInk.type,
          notes: usageFormData.notes
        }));

        const historyRef = doc(collection(db, 'stockHistory'));
        transaction.set(historyRef, cleanUndefined({
          stockId: selectedInk.id,
          date: Date.now(),
          type: 'usage',
          quantity: -deductedQuantity,
          previousQuantity: stockData.quantity,
          newQuantity: newTotalQuantity,
          notes: usageNotesMsg
        }));
      });

      setIsUsageOpen(false);
      setUsageFormData({ weight: '', count: '', quantity: '', notes: '' });
      toast.success('Usage recorded successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to record usage');
    }
  };

  const handleAddStock = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const totalQuantity = formData.type === 'ink' 
        ? formData.inkContainers.reduce((sum, c) => sum + (Number(c.weight || 0) * Number(c.count || 0)), 0)
        : Number(formData.quantity);

      await runTransaction(db, async (transaction) => {
        const pTypeVal = formData.paperType || 'Other';
        const finalName = formData.name.trim() || (
          formData.type === 'paper' || formData.type === 'board'
            ? `${pTypeVal}${formData.gsm ? ` - ${formData.gsm} GSM` : ''}${formData.size ? ` - ${formData.size || 'Standard'}` : ''}`
            : formData.type === 'plate'
            ? `Plate - ${formData.size || 'Standard'}`
            : formData.type === 'ink'
            ? `Ink - ${formData.inkContainers.map(c => `${c.count}x ${c.weight}kg`).join(', ') || 'Various'}`
            : `Unnamed ${formData.type}`
        );

        const newStock: any = {
          name: finalName,
          quantity: totalQuantity,
          type: formData.type,
          lastUpdated: Date.now()
        };

        if (formData.defaultRate) {
          newStock.defaultRate = Number(formData.defaultRate);
        }
        
        if (formData.type === 'paper' || formData.type === 'board') {
          if (formData.gsm) {
            newStock.gsm = Number(formData.gsm);
          }
          newStock.size = formData.size;
          newStock.paperType = pTypeVal;
          newStock.unit = formData.unit || 'Sheets';
          newStock.brand = formData.brand || '';
          newStock.millName = formData.millName || '';
          newStock.shade = formData.shade || '';
          newStock.notes = formData.notes || '';
          if (formData.type === 'paper') {
            const isExisting = paperSections.some(s => s.name.toLowerCase() === pTypeVal.toLowerCase());
            if (!isExisting && pTypeVal !== 'Other' && pTypeVal.trim() !== '') {
              const sectRef = doc(collection(db, 'paperSections'));
              transaction.set(sectRef, { name: pTypeVal, createdAt: Date.now() });
            }
          } else if (formData.type === 'board') {
            const isExisting = boardSections.some(s => s.name.toLowerCase() === pTypeVal.toLowerCase());
            if (!isExisting && pTypeVal !== 'Other' && pTypeVal.trim() !== '') {
              const sectRef = doc(collection(db, 'boardSections'));
              transaction.set(sectRef, { name: pTypeVal, createdAt: Date.now() });
            }
          }
        } else if (formData.type === 'plate') {
          newStock.size = formData.size;
        } else if (formData.type === 'ink') {
          newStock.inkContainers = formData.inkContainers.map(c => ({
            weight: Number(c.weight),
            count: Number(c.count)
          })).filter(c => !isNaN(c.weight) && !isNaN(c.count));
        }
        
        const stocksRef = collection(db, 'stocks');
        const newStockDoc = doc(stocksRef);
        transaction.set(newStockDoc, cleanUndefined(newStock));

        const historyRef = doc(collection(db, 'stockHistory'));
        transaction.set(historyRef, cleanUndefined({
          stockId: newStockDoc.id,
          date: Date.now(),
          type: 'addition',
          quantity: totalQuantity,
          previousQuantity: 0,
          newQuantity: totalQuantity,
          notes: `Initial stock addition: ${finalName}`
        }));
      });

      setIsAddOpen(false);
      setFormData({ name: '', gsm: '', size: '', quantity: '', type: 'paper', inkContainers: [], defaultRate: '', paperType: '', unit: 'Sheets', brand: '', millName: '', shade: '', notes: '' });
      toast.success('Stock added successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'stocks');
    }
  };

  const handleUpdateStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStock) return;
    try {
      const totalQuantity = formData.type === 'ink' 
        ? formData.inkContainers.reduce((sum, c) => sum + (Number(c.weight || 0) * Number(c.count || 0)), 0)
        : Number(formData.quantity);

      await runTransaction(db, async (transaction) => {
        const stockRef = doc(db, 'stocks', editingStock.id);
        const stockSnap = await transaction.get(stockRef);
        if (!stockSnap.exists()) throw new Error("Stock not found");
        const oldData = stockSnap.data() as StockItem;

        const pTypeVal = formData.paperType || 'Other';
        const finalName = formData.name.trim() || (
          formData.type === 'paper' || formData.type === 'board'
            ? `${pTypeVal}${formData.gsm ? ` - ${formData.gsm} GSM` : ''}${formData.size ? ` - ${formData.size || 'Standard'}` : ''}`
            : formData.type === 'plate'
            ? `Plate - ${formData.size || 'Standard'}`
            : formData.type === 'ink'
            ? `Ink - ${formData.inkContainers.map(c => `${c.count}x ${c.weight}kg`).join(', ') || 'Various'}`
            : `Unnamed ${formData.type}`
        );

        const updatedData: any = {
          name: finalName,
          quantity: totalQuantity,
          type: formData.type,
          lastUpdated: Date.now()
        };

        if (formData.defaultRate) {
          updatedData.defaultRate = Number(formData.defaultRate);
        } else {
          // If cleared, delete or remove defaultRate
          updatedData.defaultRate = 0;
        }

        if (formData.type === 'paper' || formData.type === 'board') {
          if (formData.gsm) {
            updatedData.gsm = Number(formData.gsm);
          } else {
            updatedData.gsm = null;
          }
          updatedData.size = formData.size;
          updatedData.paperType = pTypeVal;
          updatedData.unit = formData.unit || 'Sheets';
          updatedData.brand = formData.brand || '';
          updatedData.millName = formData.millName || '';
          updatedData.shade = formData.shade || '';
          updatedData.notes = formData.notes || '';
          if (formData.type === 'paper') {
            const isExisting = paperSections.some(s => s.name.toLowerCase() === pTypeVal.toLowerCase());
            if (!isExisting && pTypeVal !== 'Other' && pTypeVal.trim() !== '') {
              const sectRef = doc(collection(db, 'paperSections'));
              transaction.set(sectRef, { name: pTypeVal, createdAt: Date.now() });
            }
          } else if (formData.type === 'board') {
            const isExisting = boardSections.some(s => s.name.toLowerCase() === pTypeVal.toLowerCase());
            if (!isExisting && pTypeVal !== 'Other' && pTypeVal.trim() !== '') {
              const sectRef = doc(collection(db, 'boardSections'));
              transaction.set(sectRef, { name: pTypeVal, createdAt: Date.now() });
            }
          }
        } else if (formData.type === 'plate') {
          updatedData.size = formData.size;
        } else if (formData.type === 'ink') {
          updatedData.inkContainers = formData.inkContainers.map(c => ({
            weight: Number(c.weight),
            count: Number(c.count)
          })).filter(c => !isNaN(c.weight) && !isNaN(c.count));
        }

        transaction.update(stockRef, cleanUndefined(updatedData));

        if (totalQuantity !== oldData.quantity) {
          const historyRef = doc(collection(db, 'stockHistory'));
          transaction.set(historyRef, cleanUndefined({
            stockId: editingStock.id,
            date: Date.now(),
            type: totalQuantity > oldData.quantity ? 'addition' : 'usage',
            quantity: totalQuantity - oldData.quantity,
            previousQuantity: oldData.quantity,
            newQuantity: totalQuantity,
            notes: `Manual stock update: ${finalName}`
          }));
        }
      });

      setEditingStock(null);
      toast.success('Stock updated successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `stocks/${editingStock.id}`);
    }
  };

  const parsePaperSize = (sizeStr: string | undefined): { width: number; length: number } | null => {
    if (!sizeStr) return null;
    const match = sizeStr.toLowerCase().match(/(\d+(?:\.\d+)?)\s*[xX*\s]\s*(\d+(?:\.\d+)?)/);
    if (match) {
      const width = parseFloat(match[1]);
      const length = parseFloat(match[2]);
      if (width > 0 && length > 0) {
        return { width, length };
      }
    }
    return null;
  };

  const handleRecordPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStockForPurchase) return;

    try {
      const supplier = purchaseFormData.supplier.trim();
      const invoiceNo = purchaseFormData.invoiceNo.trim();
      const customNotes = purchaseFormData.notes.trim();

      await runTransaction(db, async (transaction) => {
        const stockRef = doc(db, 'stocks', selectedStockForPurchase.id);
        const stockSnap = await transaction.get(stockRef);
        if (!stockSnap.exists()) throw new Error("Stock item not found");
        const stockData = stockSnap.data() as StockItem;

        let totalAddedQuantity = 0;
        let rate = 0;
        let totalCost = 0;
        let purchaseRateLogged: number | undefined = undefined;
        let updatedFields: Partial<StockItem> = {};
        const detailsParts: string[] = [];

        if (stockData.type === 'ink') {
          const curContainers = stockData.inkContainers ? [...stockData.inkContainers] : [];
          
          purchaseFormData.inkContainers.forEach(purchase => {
            const purchaseWeight = Number(purchase.weight);
            const purchaseCount = Number(purchase.count);
            if (isNaN(purchaseWeight) || isNaN(purchaseCount) || purchaseCount <= 0) return;

            totalAddedQuantity += purchaseWeight * purchaseCount;

            const existingIndex = curContainers.findIndex(c => c.weight === purchaseWeight);
            if (existingIndex !== -1) {
              curContainers[existingIndex] = {
                ...curContainers[existingIndex],
                count: curContainers[existingIndex].count + purchaseCount
              };
            } else {
              curContainers.push({
                weight: purchaseWeight,
                count: purchaseCount
              });
            }
          });

          if (totalAddedQuantity === 0) {
            throw new Error("Please specify at least one container with a valid count");
          }

          rate = purchaseFormData.rate ? Number(purchaseFormData.rate) : 0;
          totalCost = totalAddedQuantity * rate;
          purchaseRateLogged = rate > 0 ? rate : undefined;

          updatedFields = {
            inkContainers: curContainers,
            quantity: stockData.quantity + totalAddedQuantity,
            lastUpdated: Date.now()
          };

          const containerSummary = purchaseFormData.inkContainers
            .filter(c => Number(c.count) > 0)
            .map(c => `${c.count}x ${c.weight}kg`)
            .join(', ');
          detailsParts.unshift(`Added containers: ${containerSummary}`);
          if (rate > 0) {
            detailsParts.push(`@ ₹${rate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}/kg`);
            detailsParts.push(`Total Cost: ₹${totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
          }
        } else if (stockData.type === 'paper' || stockData.type === 'board') {
          if (purchaseFormData.purchaseMode === 'kg') {
            const weight = Number(purchaseFormData.quantityKg);
            const rateKg = Number(purchaseFormData.ratePerKg);
            if (isNaN(weight) || weight <= 0) {
              throw new Error("Please enter a valid weight in KG");
            }
            if (isNaN(rateKg) || rateKg <= 0) {
              throw new Error("Please enter a valid rate per KG");
            }

            totalCost = weight * rateKg;

            const sizeInfo = parsePaperSize(stockData.size);
            if (!sizeInfo || !stockData.gsm) {
              throw new Error("GSM and Size must be set on this stock item to run KG-to-Sheets conversion. Please edit the stock details first.");
            }

            totalAddedQuantity = Math.round((weight * 1550000) / (sizeInfo.width * sizeInfo.length * stockData.gsm));
            rate = totalAddedQuantity > 0 ? (totalCost / totalAddedQuantity) : 0;
            purchaseRateLogged = rateKg; // Log the rate-per-KG paid in the purchaseRate field

            detailsParts.unshift(`Weight: ${weight} kg | Rate: ₹${rateKg.toLocaleString('en-IN', { minimumFractionDigits: 2 })}/kg (approx ₹${rate.toFixed(4)}/sheet)`);
            detailsParts.push(`Total Cost: ₹${totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
          } else if (purchaseFormData.purchaseMode === 'packs') {
            const pQuantity = Number(purchaseFormData.packQuantity);
            const pSheets = Number(purchaseFormData.sheetsPerPack);
            const rateKg = Number(purchaseFormData.ratePerKg);

            if (isNaN(pQuantity) || pQuantity <= 0) {
              throw new Error("Please enter a valid quantity of packages");
            }
            if (isNaN(pSheets) || pSheets <= 0) {
              throw new Error("Please enter valid sheets per package");
            }
            if (isNaN(rateKg) || rateKg <= 0) {
              throw new Error("Please enter a valid rate per KG");
            }

            const sizeInfo = parsePaperSize(stockData.size);
            if (!sizeInfo || !stockData.gsm) {
              throw new Error("GSM and Size must be set on this stock item to run package weight calculations. Please edit the stock details first.");
            }

            // Calculate total sheets purchased
            totalAddedQuantity = pQuantity * pSheets;

            // Calculate weight in KG: Sheets * Width * Length * GSM / 1550000
            const calculatedWeight = (totalAddedQuantity * sizeInfo.width * sizeInfo.length * stockData.gsm) / 1550000;
            totalCost = calculatedWeight * rateKg;
            
            // Log sheet rate (total cost / total sheets)
            rate = totalAddedQuantity > 0 ? (totalCost / totalAddedQuantity) : 0;
            purchaseRateLogged = rateKg; // Log the rate-per-KG paid

            const packageLabel = purchaseFormData.packType === 'ream' ? 'Reams' : purchaseFormData.packType === 'bundle' ? 'Bundles' : purchaseFormData.packType === 'gross' ? 'Gross' : 'Packs';

            detailsParts.unshift(`${pQuantity} ${packageLabel} of ${pSheets} sheets | Total: ${totalAddedQuantity.toLocaleString()} sheets (~${calculatedWeight.toFixed(2)} kg)`);
            detailsParts.push(`Rate: ₹${rateKg.toLocaleString('en-IN', { minimumFractionDigits: 2 })}/kg (approx ₹${rate.toFixed(4)}/sheet)`);
            detailsParts.push(`Total Cost: ₹${totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
          } else {
            const quantityToAdd = Number(purchaseFormData.quantity);
            if (isNaN(quantityToAdd) || quantityToAdd <= 0) {
              throw new Error("Please enter a valid quantity of stock sheets to add");
            }
            totalAddedQuantity = quantityToAdd;

            const rateSheet = purchaseFormData.rate ? Number(purchaseFormData.rate) : 0;
            rate = rateSheet;
            purchaseRateLogged = rate > 0 ? rate : undefined;
            totalCost = totalAddedQuantity * rate;

            if (rate > 0) {
              detailsParts.push(`@ ₹${rate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}/sheet`);
              detailsParts.push(`Total Cost: ₹${totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
            }
          }

          updatedFields = {
            quantity: stockData.quantity + totalAddedQuantity,
            lastUpdated: Date.now()
          };
        } else if (stockData.type === 'plate') {
          const pQuantity = Number(purchaseFormData.packQuantity);
          const pPlates = Number(purchaseFormData.sheetsPerPack); // plates per packet

          if (isNaN(pQuantity) || pQuantity <= 0) {
            throw new Error("Please enter a valid packet quantity");
          }
          if (isNaN(pPlates) || pPlates <= 0) {
            throw new Error("Please enter valid plates per packet");
          }

          totalAddedQuantity = pQuantity * pPlates;

          const ratePacket = purchaseFormData.rate ? Number(purchaseFormData.rate) : 0;
          rate = totalAddedQuantity > 0 ? (ratePacket / pPlates) : 0; // rate per plate
          purchaseRateLogged = ratePacket; // Rate per packet logged
          totalCost = pQuantity * ratePacket;

          updatedFields = {
            quantity: stockData.quantity + totalAddedQuantity,
            lastUpdated: Date.now()
          };

          detailsParts.unshift(`${pQuantity} packets of ${pPlates} plates | Total: ${totalAddedQuantity.toLocaleString()} plates`);
          if (ratePacket > 0) {
            detailsParts.push(`Rate: ₹${ratePacket.toLocaleString('en-IN', { minimumFractionDigits: 2 })}/packet (approx ₹${rate.toFixed(2)}/plate)`);
            detailsParts.push(`Total Cost: ₹${totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
          }
        } else {
          // Other
          const quantityToAdd = Number(purchaseFormData.quantity);
          if (isNaN(quantityToAdd) || quantityToAdd <= 0) {
            throw new Error("Please enter a valid quantity of stock to add");
          }
          totalAddedQuantity = quantityToAdd;

          rate = purchaseFormData.rate ? Number(purchaseFormData.rate) : 0;
          purchaseRateLogged = rate > 0 ? rate : undefined;
          totalCost = totalAddedQuantity * rate;

          updatedFields = {
            quantity: stockData.quantity + totalAddedQuantity,
            lastUpdated: Date.now()
          };

          if (rate > 0) {
            detailsParts.push(`@ ₹${rate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}/unit`);
            detailsParts.push(`Total Cost: ₹${totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
          }
        }

        if (supplier) detailsParts.push(`Supplier: ${supplier}`);
        if (invoiceNo) detailsParts.push(`Invoice: ${invoiceNo}`);
        if (customNotes) detailsParts.push(`Note: ${customNotes}`);

        let purchaseDateTimestamp = Date.now();
        if (purchaseFormData.date) {
          const parsedDate = new Date(purchaseFormData.date);
          const now = new Date();
          parsedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
          purchaseDateTimestamp = parsedDate.getTime();
        }

        const noteString = `Purchase Restock. ${detailsParts.join(' | ')}`;

        transaction.update(stockRef, cleanUndefined(updatedFields));

        const historyRef = doc(collection(db, 'stockHistory'));
        transaction.set(historyRef, cleanUndefined({
          stockId: selectedStockForPurchase.id,
          date: purchaseDateTimestamp,
          type: 'addition',
          quantity: totalAddedQuantity,
          previousQuantity: stockData.quantity,
          newQuantity: stockData.quantity + totalAddedQuantity,
          notes: noteString,
          purchaseRate: purchaseRateLogged,
          supplier: supplier || undefined,
          invoiceNo: invoiceNo || undefined
        }));
      });

      setIsPurchaseOpen(false);
      setSelectedStockForPurchase(null);
      setPurchaseFormData({
        quantity: '',
        rate: '',
        supplier: '',
        invoiceNo: '',
        notes: '',
        inkContainers: [],
        purchaseMode: 'kg',
        quantityKg: '',
        ratePerKg: '',
        packType: 'ream',
        packQuantity: '',
        sheetsPerPack: '500',
        date: new Date().toISOString().split('T')[0],
      });
      toast.success('Purchase restock recorded successfully!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to record purchase restock');
    }
  };

  const addPurchaseContainer = () => {
    setPurchaseFormData(prev => ({
      ...prev,
      inkContainers: [...prev.inkContainers, { weight: '', count: '' }]
    }));
  };

  const removePurchaseContainer = (index: number) => {
    setPurchaseFormData(prev => {
      const newContainers = [...prev.inkContainers];
      newContainers.splice(index, 1);
      return { ...prev, inkContainers: newContainers };
    });
  };

  const updatePurchaseContainer = (index: number, field: 'weight' | 'count', value: string) => {
    setPurchaseFormData(prev => {
      const newContainers = [...prev.inkContainers];
      newContainers[index] = { ...newContainers[index], [field]: value };
      return { ...prev, inkContainers: newContainers };
    });
  };

  const addContainer = () => {
    setFormData({ ...formData, inkContainers: [...formData.inkContainers, { weight: '', count: '' }] });
  };

  const removeContainer = (index: number) => {
    const newContainers = [...formData.inkContainers];
    newContainers.splice(index, 1);
    setFormData({ ...formData, inkContainers: newContainers });
  };

  const updateContainer = (index: number, field: 'weight' | 'count', value: string) => {
    const newContainers = [...formData.inkContainers];
    newContainers[index] = { ...newContainers[index], [field]: value };
    setFormData({ ...formData, inkContainers: newContainers });
  };

  const handleDeleteStock = async () => {
    if (!stockToDelete) return;
    try {
      await deleteDoc(doc(db, 'stocks', stockToDelete.id));
      setStockToDelete(null);
      toast.success('Stock deleted successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `stocks/${stockToDelete.id}`);
    }
  };

  const handleDeletePurchase = async () => {
    if (!purchaseToDelete) return;
    setIsDeletingPurchase(true);
    try {
      await runTransaction(db, async (transaction) => {
        const historyRef = doc(db, 'stockHistory', purchaseToDelete.id);
        const historySnap = await transaction.get(historyRef);
        if (!historySnap.exists()) {
          throw new Error('Purchase record not found.');
        }

        const pData = historySnap.data() as StockHistory;
        
        // Find the stock
        const stockRef = doc(db, 'stocks', pData.stockId);
        const stockSnap = await transaction.get(stockRef);
        
        if (stockSnap.exists()) {
          const sData = stockSnap.data() as StockItem;
          const revertedQuantity = Math.max(0, sData.quantity - pData.quantity);
          const updatedFields: Partial<StockItem> = {
            quantity: revertedQuantity,
            lastUpdated: Date.now()
          };

          // If ink types, revert containers count
          if (sData.type === 'ink' && sData.inkContainers) {
            const curContainers = [...sData.inkContainers];
            const containersMatch = pData.notes?.match(/Added containers:\s*([^|]+)/i);
            if (containersMatch) {
              const containerListStr = containersMatch[1];
              const containerRegex = /(\d+)x\s*([\d.]+)\s*kg/gi;
              let match;
              while ((match = containerRegex.exec(containerListStr)) !== null) {
                const countToDelete = parseInt(match[1], 10);
                const weightToDelete = parseFloat(match[2]);
                if (!isNaN(countToDelete) && !isNaN(weightToDelete)) {
                  const idx = curContainers.findIndex(c => c.weight === weightToDelete);
                  if (idx !== -1) {
                    const newCount = Math.max(0, curContainers[idx].count - countToDelete);
                    curContainers[idx] = { ...curContainers[idx], count: newCount };
                  }
                }
              }
            }
            updatedFields.inkContainers = curContainers;
          }

          transaction.update(stockRef, cleanUndefined(updatedFields));
        }

        transaction.delete(historyRef);
      });

      toast.success('Purchase deleted and stock adjusted successfully');
      setPurchaseToDelete(null);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete purchase. Please try again.');
    } finally {
      setIsDeletingPurchase(false);
    }
  };

  const handleDeleteUsage = async () => {
    if (!usageToDelete) return;
    setIsDeletingUsage(true);
    try {
      await runTransaction(db, async (transaction) => {
        const historyRef = doc(db, 'stockHistory', usageToDelete.id);
        const historySnap = await transaction.get(historyRef);
        if (!historySnap.exists()) {
          throw new Error('Usage record not found.');
        }

        const pData = historySnap.data() as StockHistory;
        
        // Find the stock
        const stockRef = doc(db, 'stocks', pData.stockId);
        const stockSnap = await transaction.get(stockRef);
        
        if (stockSnap.exists()) {
          const sData = stockSnap.data() as StockItem;
          // quantity in history is negative for usages, e.g. -10
          const usedQty = Math.abs(pData.quantity);
          const revertedQuantity = sData.quantity + usedQty;
          const updatedFields: Partial<StockItem> = {
            quantity: revertedQuantity,
            lastUpdated: Date.now()
          };

          // If ink check
          if (sData.type === 'ink' && sData.inkContainers) {
            const curContainers = [...sData.inkContainers];
            const containersMatch = pData.notes?.match(/Ink usage:\s*(\d+)x\s*([\d.]+)\s*kg/i);
            if (containersMatch) {
              const countToAdd = parseInt(containersMatch[1], 10);
              const weightToAdd = parseFloat(containersMatch[2]);
              if (!isNaN(countToAdd) && !isNaN(weightToAdd)) {
                const idx = curContainers.findIndex(c => c.weight === weightToAdd);
                if (idx !== -1) {
                  curContainers[idx] = { ...curContainers[idx], count: curContainers[idx].count + countToAdd };
                } else {
                  curContainers.push({ weight: weightToAdd, count: countToAdd });
                }
              }
            }
            updatedFields.inkContainers = curContainers;
          }

          transaction.update(stockRef, cleanUndefined(updatedFields));
        }

        // Delete from history
        transaction.delete(historyRef);
      });

      toast.success('Usage record deleted and stock reverted successfully');
      setUsageToDelete(null);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete usage. Please try again.');
    } finally {
      setIsDeletingUsage(false);
    }
  };

  const filteredStocks = stocks.filter(stock => 
    stock.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (stock.size && stock.size.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const StockTable = ({ items, type }: { items: StockItem[], type: StockType }) => (
    <div>
      {/* Desktop Mode - Detailed Table */}
      <div className="hidden md:block min-w-full overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-gray-100">
              <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider pl-4 md:pl-6">Description</TableHead>
              {(type === 'paper' || type === 'board') && <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider">GSM</TableHead>}
              {type !== 'ink' && <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider">Size</TableHead>}
              <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider">Available</TableHead>
              <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider text-right pr-4 md:pr-6">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((stock) => (
              <TableRow key={stock.id} className="group border-gray-50 hover:bg-gray-50/50 transition-colors">
                <TableCell className="font-medium pl-4 md:pl-6 py-3 md:py-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-gray-900">{stock.name}</span>
                    {(stock.type === 'paper' || stock.type === 'board') && stock.paperType && (
                      <span className="inline-flex self-start text-[9px] font-bold text-[#5A5A40] bg-[#5A5A40]/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
                        {stock.paperType}
                      </span>
                    )}
                  </div>
                </TableCell>
                {(type === 'paper' || type === 'board') && <TableCell className="text-xs md:text-sm">{stock.gsm ? `${stock.gsm} GSM` : '-'}</TableCell>}
                {type !== 'ink' && <TableCell className="text-xs md:text-sm">{stock.size || '-'}</TableCell>}
                <TableCell>
                  <div className="flex flex-col">
                    <span className={`font-mono text-xs md:text-sm font-medium ${stock.quantity < 10 ? 'text-red-500' : 'text-gray-700'}`}>
                      {stock.quantity.toLocaleString()} {stock.type === 'ink' ? 'kg' : 'units'}
                    </span>
                    {stock.type === 'ink' && stock.inkContainers && (
                      <span className="text-[9px] md:text-[10px] text-gray-400">
                        {stock.inkContainers.map(c => `${c.count}x ${c.weight}kg`).join(', ')}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right pr-4 md:pr-6">
                  <div className="flex justify-end gap-1 md:gap-2 md:opacity-0 group-hover:opacity-100 transition-opacity animate-none">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7 md:h-8 md:w-8 text-gray-400 hover:text-purple-600"
                      onClick={() => {
                        setSelectedInk(stock);
                        const firstContainer = (stock.type === 'ink' && stock.inkContainers && stock.inkContainers.length > 0) ? stock.inkContainers[0] : null;
                        setUsageFormData({
                          weight: firstContainer ? firstContainer.weight.toString() : '',
                          count: firstContainer ? '1' : '',
                          quantity: firstContainer ? firstContainer.weight.toString() : '',
                          notes: ''
                        });
                        setIsUsageOpen(true);
                      }}
                      title="Record Usage"
                    >
                      <ArrowRight className="h-3 w-3 md:h-4 md:w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7 md:h-8 md:w-8 text-gray-400 hover:text-emerald-600"
                      onClick={() => {
                        setSelectedStockForPurchase(stock);
                        setPurchaseFormData({
                          quantity: '',
                          rate: stock.defaultRate?.toString() || '',
                          supplier: '',
                          invoiceNo: '',
                          notes: '',
                          inkContainers: stock.type === 'ink' 
                            ? stock.inkContainers?.map(c => ({
                                weight: c.weight.toString(),
                                count: ''
                              })) || [{ weight: '', count: '' }]
                            : [],
                          purchaseMode: 'kg',
                          quantityKg: '',
                          ratePerKg: '',
                          packType: 'ream',
                          packQuantity: '',
                          sheetsPerPack: stock.type === 'plate' 
                            ? getDefaultPlatesPerPacket(stock.size).toString() 
                            : '500',
                          date: new Date().toISOString().split('T')[0],
                        });
                        setIsPurchaseOpen(true);
                      }}
                      title="Record Purchase (Restock)"
                    >
                      <PlusCircle className="h-3 w-3 md:h-4 md:w-4" />
                    </Button>
                    {stock.type === 'paper' && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7 md:h-8 md:w-8 text-amber-700 hover:text-amber-900 hover:bg-amber-50"
                        onClick={async () => {
                          try {
                            const stockRef = doc(db, 'stocks', stock.id);
                            await runTransaction(db, async (transaction) => {
                              const stockSnap = await transaction.get(stockRef);
                              if (!stockSnap.exists()) throw new Error("Stock not found");
                              
                              const pTypeVal = stock.paperType || 'Other';
                              
                              const isExistingSect = boardSections.some(s => s.name.toLowerCase() === pTypeVal.toLowerCase());
                              if (!isExistingSect && pTypeVal !== 'Other' && pTypeVal.trim() !== '') {
                                const sectRef = doc(collection(db, 'boardSections'));
                                transaction.set(sectRef, { name: pTypeVal, createdAt: Date.now() });
                              }

                              transaction.update(stockRef, {
                                type: 'board',
                                lastUpdated: Date.now()
                              });

                              const historyRef = doc(collection(db, 'stockHistory'));
                              transaction.set(historyRef, {
                                stockId: stock.id,
                                date: Date.now(),
                                type: 'usage',
                                quantity: 0,
                                previousQuantity: stock.quantity,
                                newQuantity: stock.quantity,
                                notes: `Moved stock "${stock.name}" from Paper to Board stock`
                              });
                            });
                            toast.success(`Successfully moved "${stock.name}" to Board Stock!`);
                          } catch (err) {
                            console.error(err);
                            toast.error('Failed to move stock to Board Stock');
                          }
                        }}
                        title="Move to Board Stock"
                      >
                        <ArrowUpRight className="h-3 w-3 md:h-4 md:w-4" />
                      </Button>
                    )}
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7 md:h-8 md:w-8 text-gray-400 hover:text-[#5A5A40]"
                      onClick={() => {
                        setEditingStock(stock);
                        setFormData({
                          name: stock.name,
                          gsm: stock.gsm?.toString() || '',
                          size: stock.size || '',
                          quantity: stock.quantity.toString(),
                          type: stock.type,
                          inkContainers: stock.inkContainers?.map(c => ({
                            weight: c.weight.toString(),
                            count: c.count.toString()
                          })) || [],
                          defaultRate: stock.defaultRate?.toString() || '',
                          paperType: stock.paperType || '',
                          unit: stock.unit || 'Sheets',
                          brand: stock.brand || '',
                          millName: stock.millName || '',
                          shade: stock.shade || '',
                          notes: stock.notes || ''
                        });
                      }}
                    >
                      <Edit2 className="h-3 w-3 md:h-4 md:w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7 md:h-8 md:w-8 text-gray-400 hover:text-red-600"
                      onClick={() => setStockToDelete(stock)}
                    >
                      <Trash2 className="h-3 w-3 md:h-4 md:w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={3 + (type === 'paper' || type === 'board' ? 1 : 0) + (type !== 'ink' ? 1 : 0)} className="h-24 md:h-32 text-center text-gray-500 font-serif italic text-sm">
                  No {type} stocks found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Mode - Responsive Beautiful Cards */}
      <div className="md:hidden divide-y divide-gray-100">
        {items.map((stock) => (
          <div key={stock.id} className="p-4 space-y-4">
            <div className="flex justify-between items-start gap-4">
              <div className="min-w-0 flex-1">
                <h4 className="font-serif font-medium text-gray-900 text-sm break-words leading-snug">{stock.name}</h4>
                {(stock.type === 'paper' || stock.type === 'board') && stock.paperType && (
                  <span className="inline-flex self-start text-[9px] font-bold text-[#5A5A40] bg-[#5A5A40]/10 px-2 py-0.5 rounded-full uppercase tracking-wider mt-1">
                    {stock.paperType}
                  </span>
                )}
              </div>
            </div>

            {/* Metadata and stock quantity details */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-500 font-mono">
              {!!stock.gsm && (
                <div className="flex flex-col gap-0.5 border-r border-gray-100 pr-2">
                  <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider leading-none">Weight</span>
                  <span className="text-gray-800 font-semibold">{stock.gsm} GSM</span>
                </div>
              )}
              {!!stock.size && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider leading-none">Size</span>
                  <span className="text-gray-800 font-semibold">{stock.size}</span>
                </div>
              )}
              <div className="flex flex-col gap-0.5 col-span-2 bg-[#5A5A40]/5 p-2.5 rounded-xl mt-1">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider leading-none mb-1">Available Stock Balance</span>
                <span className="text-sm font-extrabold text-[#5A5A40]">
                  {stock.type === 'paper' || stock.type === 'board'
                    ? `${stock.quantity.toLocaleString()} sheets`
                    : stock.type === 'plate'
                      ? `${stock.quantity.toLocaleString()} plates`
                      : stock.type === 'ink'
                        ? `${stock.quantity.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`
                        : `${stock.quantity.toLocaleString()} units`}
                </span>
              </div>
            </div>

            {stock.type === 'ink' && stock.inkContainers && stock.inkContainers.length > 0 && (
              <div className="bg-purple-55 border border-purple-100/40 p-2.5 rounded-xl text-[10px] text-purple-900 flex flex-col gap-1">
                <span className="font-extrabold text-purple-700 uppercase tracking-widest text-[8px]">Available Containers:</span>
                <span className="font-mono text-xs">{stock.inkContainers.map(c => `${c.count}x ${c.weight}kg`).join(', ')}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-50">
              <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Actions</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-8 px-2.5 rounded-full text-[11px] text-purple-650 hover:bg-purple-50 shadow-2xs border-purple-200"
                  onClick={() => {
                    setSelectedInk(stock);
                    const firstContainer = (stock.type === 'ink' && stock.inkContainers && stock.inkContainers.length > 0) ? stock.inkContainers[0] : null;
                    setUsageFormData({
                      weight: firstContainer ? firstContainer.weight.toString() : '',
                      count: firstContainer ? '1' : '',
                      quantity: firstContainer ? firstContainer.weight.toString() : '',
                      notes: ''
                    });
                    setIsUsageOpen(true);
                  }}
                >
                  <ArrowRight className="h-3.5 w-3.5 mr-1" /> Record Use
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-8 px-2.5 rounded-full text-[11px] text-emerald-600 hover:bg-emerald-50 shadow-2xs border-emerald-250"
                  onClick={() => {
                    setSelectedStockForPurchase(stock);
                    setPurchaseFormData({
                      quantity: '',
                      rate: stock.defaultRate?.toString() || '',
                      supplier: '',
                      invoiceNo: '',
                      notes: '',
                      inkContainers: stock.type === 'ink' 
                        ? stock.inkContainers?.map(c => ({
                            weight: c.weight.toString(),
                            count: ''
                          })) || [{ weight: '', count: '' }]
                        : [],
                      purchaseMode: 'kg',
                      quantityKg: '',
                      ratePerKg: '',
                      packType: 'ream',
                      packQuantity: '',
                      sheetsPerPack: stock.type === 'plate' 
                        ? getDefaultPlatesPerPacket(stock.size).toString() 
                        : '500',
                      date: new Date().toISOString().split('T')[0],
                    });
                    setIsPurchaseOpen(true);
                  }}
                >
                  <PlusCircle className="h-3.5 w-3.5 mr-1" /> Restock
                </Button>
                {stock.type === 'paper' && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8 px-2.5 rounded-full text-[11px] text-amber-700 hover:bg-amber-50 border-amber-200 shadow-2xs"
                    onClick={async () => {
                      try {
                        const stockRef = doc(db, 'stocks', stock.id);
                        await runTransaction(db, async (transaction) => {
                          const stockSnap = await transaction.get(stockRef);
                          if (!stockSnap.exists()) throw new Error("Stock not found");
                          
                          const pTypeVal = stock.paperType || 'Other';
                          
                          const isExistingSect = boardSections.some(s => s.name.toLowerCase() === pTypeVal.toLowerCase());
                          if (!isExistingSect && pTypeVal !== 'Other' && pTypeVal.trim() !== '') {
                            const sectRef = doc(collection(db, 'boardSections'));
                            transaction.set(sectRef, { name: pTypeVal, createdAt: Date.now() });
                          }

                          transaction.update(stockRef, {
                            type: 'board',
                            lastUpdated: Date.now()
                          });

                          const historyRef = doc(collection(db, 'stockHistory'));
                          transaction.set(historyRef, {
                            stockId: stock.id,
                            date: Date.now(),
                            type: 'usage',
                            quantity: 0,
                            previousQuantity: stock.quantity,
                            newQuantity: stock.quantity,
                            notes: `Moved stock "${stock.name}" from Paper to Board stock`
                          });
                        });
                        toast.success(`Successfully moved "${stock.name}" to Board Stock!`);
                      } catch (err) {
                        console.error(err);
                        toast.error('Failed to move stock to Board Stock');
                      }
                    }}
                  >
                    <ArrowUpRight className="h-3.5 w-3.5 mr-1" /> Move to Board
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-8 px-2.5 rounded-full text-[11px] text-gray-600 hover:bg-gray-100 border-gray-200 shadow-2xs"
                  onClick={() => {
                    setEditingStock(stock);
                    setFormData({
                      name: stock.name,
                      gsm: stock.gsm?.toString() || '',
                      size: stock.size || '',
                      quantity: stock.quantity.toString(),
                      type: stock.type,
                      inkContainers: stock.inkContainers?.map(c => ({
                        weight: c.weight.toString(),
                        count: c.count.toString()
                      })) || [],
                      defaultRate: stock.defaultRate?.toString() || '',
                      paperType: stock.paperType || '',
                      unit: stock.unit || 'Sheets',
                      brand: stock.brand || '',
                      millName: stock.millName || '',
                      shade: stock.shade || '',
                      notes: stock.notes || ''
                    });
                  }}
                >
                  <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-8 px-2.5 rounded-full text-[11px] text-red-600 hover:bg-red-50 border-red-200 shadow-2xs"
                  onClick={() => setStockToDelete(stock)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                </Button>
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="p-8 text-center text-gray-500 font-serif italic text-sm">
            No {type} stocks found.
          </div>
        )}
      </div>
    </div>
  );

  const getPurchaseCost = (history: StockHistory): number => {
    if (!history.notes) return 0;
    const match = history.notes.match(/Total Cost:\s*₹\s*([0-9,.]+)/i);
    if (match) {
      const cleanVal = match[1].replace(/,/g, '');
      const val = parseFloat(cleanVal);
      if (!isNaN(val)) return val;
    }
    return 0;
  };

  const getPurchaseRateDetail = (history: StockHistory): string => {
    if (history.notes) {
      const match = history.notes.match(/(?:Rate:\s*|@\s*)₹\s*([0-9,.]+(?:\/[a-zA-Z]+|\s*per\s*[a-zA-Z]+)?)/i);
      if (match) {
        return `₹${match[1]}`;
      }
    }
    if (history.purchaseRate) {
      return `₹${history.purchaseRate.toFixed(2)}`;
    }
    return '-';
  };

  const PurchaseSummaryView = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState<'all' | 'paper' | 'board' | 'ink' | 'plate'>('all');
    const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'cost-desc' | 'cost-asc'>('date-desc');

    const purchasesOnly = stockHistory.filter(h => 
      h.type === 'addition' && 
      (h.notes?.startsWith('Purchase Restock.') || h.supplier || h.invoiceNo)
    );

    const augmentedPurchases = purchasesOnly.map(h => {
      const stock = stocks.find(s => s.id === h.stockId);
      const totalCost = getPurchaseCost(h);
      const rateLabel = getPurchaseRateDetail(h);
      return {
        ...h,
        stock,
        totalCost,
        rateLabel
      };
    });

    const filteredPurchases = augmentedPurchases.filter(p => {
      const matchesType = typeFilter === 'all' || p.stock?.type === typeFilter;
      
      const searchLower = searchQuery.toLowerCase().trim();
      const matchesSearch = !searchLower ||
        (p.stock?.name || '').toLowerCase().includes(searchLower) ||
        (p.supplier || '').toLowerCase().includes(searchLower) ||
        (p.invoiceNo || '').toLowerCase().includes(searchLower) ||
        (p.notes || '').toLowerCase().includes(searchLower);

      return matchesType && matchesSearch;
    });

    const sortedPurchases = [...filteredPurchases].sort((a, b) => {
      if (sortBy === 'date-desc') return b.date - a.date;
      if (sortBy === 'date-asc') return a.date - b.date;
      if (sortBy === 'cost-desc') return b.totalCost - a.totalCost;
      if (sortBy === 'cost-asc') return a.totalCost - b.totalCost;
      return 0;
    });

    const totalExpenditure = augmentedPurchases.reduce((sum, p) => sum + p.totalCost, 0);
    const filteredExpenditure = filteredPurchases.reduce((sum, p) => sum + p.totalCost, 0);
    const totalTransactionsCount = augmentedPurchases.length;
    const filteredTransactionsCount = filteredPurchases.length;

    const supplierCounts: Record<string, number> = {};
    augmentedPurchases.forEach(p => {
      if (p.supplier) {
        supplierCounts[p.supplier] = (supplierCounts[p.supplier] || 0) + 1;
      }
    });
    let topSupplier = 'N/A';
    let maxCount = 0;
    Object.entries(supplierCounts).forEach(([name, count]) => {
      if (count > maxCount) {
        maxCount = count;
        topSupplier = name;
      }
    });

    const typeBreakdown = {
      paper: augmentedPurchases.filter(p => p.stock?.type === 'paper').reduce((sum, p) => sum + p.totalCost, 0),
      board: augmentedPurchases.filter(p => p.stock?.type === 'board').reduce((sum, p) => sum + p.totalCost, 0),
      ink: augmentedPurchases.filter(p => p.stock?.type === 'ink').reduce((sum, p) => sum + p.totalCost, 0),
      plate: augmentedPurchases.filter(p => p.stock?.type === 'plate').reduce((sum, p) => sum + p.totalCost, 0),
    };

    const exportCSV = () => {
      const headers = ['Date', 'Stock Name', 'Stock Type', 'Quantity', 'Purchase Unit Rate', 'Total Cost', 'Supplier', 'Invoice No', 'Notes'];
      const csvRows = [headers.join(',')];

      sortedPurchases.forEach(p => {
        const dateStr = format(p.date, 'dd-MM-yy HH:mm');
        const name = `"${(p.stock?.name || 'Deleted Stock').replace(/"/g, '""')}"`;
        const type = p.stock?.type ? p.stock.type.toUpperCase() : 'UNKNOWN';
        const qty = p.quantity;
        const rate = `"${p.rateLabel.replace(/"/g, '""')}"`;
        const cost = p.totalCost;
        const supplier = `"${(p.supplier || '').replace(/"/g, '""')}"`;
        const invoice = `"${(p.invoiceNo || '').replace(/"/g, '""')}"`;
        const notes = `"${(p.notes || '').replace(/"/g, '""')}"`;

        csvRows.push([dateStr, name, type, qty, rate, cost, supplier, invoice, notes].join(','));
      });

      const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `purchase_summary_export_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    return (
      <div className="p-4 md:p-6 space-y-6 bg-white rounded-3xl border border-gray-100 shadow-sm">
        {/* Statistics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 bg-gradient-to-br from-emerald-50/60 to-emerald-100/30 rounded-2xl border border-emerald-100/50 flex items-center gap-4">
            <div className="p-3 bg-emerald-500/10 text-emerald-700 rounded-xl">
              <IndianRupee className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase font-bold tracking-wider text-emerald-800">Total Expenses</p>
              <p className="text-2xl font-bold text-emerald-950 font-mono mt-0.5">₹{totalExpenditure.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
              <p className="text-[10px] text-emerald-700 font-sans">Across all record logs</p>
            </div>
          </div>

          <div className="p-5 bg-gradient-to-br from-blue-50/60 to-blue-100/30 rounded-2xl border border-blue-100/50 flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 text-blue-700 rounded-xl">
              <ReceiptText className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase font-bold tracking-wider text-blue-800">Total Orders</p>
              <p className="text-2xl font-bold text-blue-950 font-mono mt-0.5">{totalTransactionsCount}</p>
              <p className="text-[10px] text-blue-700 font-sans">Processed shipments</p>
            </div>
          </div>

          <div className="p-5 bg-gradient-to-br from-amber-50/60 to-amber-100/30 rounded-2xl border border-amber-100/50 flex items-center gap-4">
            <div className="p-3 bg-amber-500/10 text-amber-700 rounded-xl">
              <Truck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase font-bold tracking-wider text-amber-800">Top Supplier</p>
              <p className="text-lg font-bold text-amber-950 truncate max-w-[150px] mt-1">{topSupplier}</p>
              <p className="text-[10px] text-amber-700 font-sans">{maxCount} invoices registered</p>
            </div>
          </div>

          <div className="p-5 bg-gradient-to-br from-purple-50/60 to-purple-100/30 rounded-2xl border border-purple-100/50 flex items-center gap-4">
            <div className="p-3 bg-purple-500/10 text-purple-700 rounded-xl">
              <History className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase font-bold tracking-wider text-purple-800">Latest Purchase</p>
              {augmentedPurchases.length > 0 ? (
                <>
                  <p className="text-sm font-bold text-purple-950 truncate max-w-[150px] mt-1">
                    {augmentedPurchases[0].stock?.name || 'Unknown Stock'}
                  </p>
                  <p className="text-[10px] text-purple-700 font-sans">
                    {format(augmentedPurchases[0].date, 'dd-MM-yy')}
                  </p>
                </>
              ) : (
                <p className="text-sm font-bold text-gray-400 mt-1">No logs</p>
              )}
            </div>
          </div>
        </div>

        {/* Expenses Category Breakdown */}
        {totalExpenditure > 0 && (
          <div className="p-4 bg-gray-50/50 border border-gray-100 rounded-2xl">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Expenses Category Breakdown</h4>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Paper', val: typeBreakdown.paper, color: 'bg-blue-500' },
                { label: 'Board', val: typeBreakdown.board, color: 'bg-amber-500' },
                { label: 'Ink', val: typeBreakdown.ink, color: 'bg-purple-500' },
                { label: 'Plates', val: typeBreakdown.plate, color: 'bg-emerald-500' },
              ].map(item => {
                const percentage = totalExpenditure > 0 ? (item.val / totalExpenditure) * 100 : 0;
                return (
                  <div key={item.label} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-650 font-medium">{item.label}</span>
                      <span className="font-mono text-gray-900 font-semibold">₹{item.val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${item.color} rounded-full`} style={{ width: `${percentage}%` }}></div>
                    </div>
                    <p className="text-[10px] text-gray-400 font-mono text-right">{percentage.toFixed(1)}%</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Filters and Search Bar */}
        <div className="border-t border-gray-100 pt-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row gap-3 flex-1">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input 
                  placeholder="Search purchases by stock name, supplier, invoice, or notes..." 
                  className="pl-10 bg-white border-gray-200 rounded-full h-10 md:h-11 text-xs md:text-sm"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2">
                <div className="inline-flex bg-gray-100 p-0.5 rounded-lg text-xs">
                  {[
                    { value: 'all', label: 'All Items' },
                    { value: 'paper', label: 'Paper' },
                    { value: 'board', label: 'Board' },
                    { value: 'ink', label: 'Ink' },
                    { value: 'plate', label: 'Plates' }
                  ].map(tab => (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setTypeFilter(tab.value as any)}
                      className={`px-3 py-1.5 rounded-md transition-colors ${typeFilter === tab.value ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-600 font-medium focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
              >
                <option value="date-desc">Newest Purchases</option>
                <option value="date-asc">Oldest Purchases</option>
                <option value="cost-desc">Highest Cost</option>
                <option value="cost-asc">Lowest Cost</option>
              </select>

              <Button
                variant="outline"
                size="sm"
                onClick={exportCSV}
                className="rounded-full border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-xs h-9 font-sans flex items-center gap-1.5 px-4"
                disabled={sortedPurchases.length === 0}
              >
                <Download size={13} />
                <span>Export CSV</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Purchase Items List Table */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-gray-50/50">
                <TableRow className="border-gray-100 hover:bg-transparent">
                  <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider pl-4 md:pl-6 w-[120px]">Date</TableHead>
                  <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider">Item Details</TableHead>
                  <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider">Supplier</TableHead>
                  <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider text-right">Quantity</TableHead>
                  <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider text-right">Purchase Rate</TableHead>
                  <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider text-right">Total Cost</TableHead>
                  <TableHead className="w-[50px] pr-4 md:pr-6 text-center font-serif italic text-gray-400 uppercase text-[10px] tracking-wider">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPurchases.map(p => (
                  <TableRow key={p.id} className="group border-gray-50 hover:bg-gray-50/40 transition-colors">
                    <TableCell className="pl-4 md:pl-6 text-xs text-gray-400 font-mono">
                      {format(p.date, 'dd-MM-yy')}<br />
                      <span className="text-[10px] text-gray-300">{format(p.date, 'HH:mm')}</span>
                    </TableCell>
                    
                    <TableCell>
                      <div className="flex flex-col gap-1.5 py-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-800 text-sm">{p.stock?.name || 'Deleted Stock'}</span>
                          <Badge variant="outline" className={`text-[9px] font-sans font-normal py-0 px-1 bg-opacity-30 ${
                            p.stock?.type === 'paper' ? 'bg-blue-50 text-blue-600 border-blue-100' : 
                            p.stock?.type === 'board' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                            p.stock?.type === 'ink' ? 'bg-purple-50 text-purple-600 border-purple-100' :
                            'bg-emerald-50 text-emerald-600 border-emerald-100'
                          }`}>
                            {(p.stock?.type || 'Other').toUpperCase()}
                          </Badge>
                        </div>
                        
                        {p.stock && (
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 font-mono">
                            {p.stock.paperType && (
                              <span className="bg-gray-100 border border-gray-200/60 px-1.5 py-0.5 rounded text-[10px] text-gray-600 font-sans font-medium">
                                {p.stock.paperType}
                              </span>
                            )}
                            {p.stock.size && (
                              <span className="bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                                Size: <strong className="text-gray-800 font-bold">{p.stock.size}</strong>
                              </span>
                            )}
                            {p.stock.gsm && (
                              <span className="bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                                GSM: <strong className="text-gray-800 font-bold">{p.stock.gsm} gsm</strong>
                              </span>
                            )}
                            {p.stock.brand && (
                              <span className="text-gray-400">
                                Brand: <strong className="text-gray-600">{p.stock.brand}</strong>
                              </span>
                            )}
                            {p.stock.millName && (
                              <span className="text-gray-400">
                                Mill: <strong className="text-gray-600">{p.stock.millName}</strong>
                              </span>
                            )}
                            {p.stock.shade && (
                              <span className="text-gray-400">
                                Shade: <strong className="text-gray-600">{p.stock.shade}</strong>
                              </span>
                            )}
                          </div>
                        )}

                        {p.notes && (
                          <div className="text-[10px] text-gray-400 italic max-w-xs md:max-w-md truncate" title={p.notes}>
                            {p.notes.replace('Purchase Restock. ', '')}
                          </div>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="font-sans text-xs">
                      {p.supplier || p.invoiceNo ? (
                        <div className="flex flex-col">
                          {p.supplier ? (
                            <span className="font-semibold text-gray-800 text-sm">{p.supplier}</span>
                          ) : (
                            <span className="text-gray-400 italic">-</span>
                          )}
                          {p.invoiceNo && (
                            <span className="text-[10px] text-gray-400 font-mono mt-0.5">
                              Inv: #{p.invoiceNo}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300 italic">-</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right font-mono font-medium text-xs md:text-sm text-gray-700">
                      {p.quantity.toLocaleString()} {p.stock?.type === 'ink' ? 'kg' : p.stock?.type === 'plate' ? 'units' : 'sheets'}
                    </TableCell>

                    <TableCell className="text-right font-mono text-xs md:text-sm text-gray-600">
                      {p.rateLabel}
                    </TableCell>

                    <TableCell className="text-right font-mono font-bold text-xs md:text-sm text-emerald-600">
                      ₹{p.totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-center pr-4 md:pr-6">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full h-8 w-8"
                        onClick={() => setPurchaseToDelete(p)}
                        title="Delete Purchase"
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                
                {sortedPurchases.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-28 text-center text-gray-400 italic font-serif text-sm">
                      No purchase entries match your current search/filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {sortedPurchases.length > 0 && (
            <div className="p-4 bg-gray-50/50 border-t border-gray-100 flex justify-between items-center text-xs md:text-sm text-gray-600 font-medium">
              <span>Showing {filteredTransactionsCount} of {totalTransactionsCount} restock purchases</span>
              <span>Filtered Expenditure: <strong className="font-mono text-emerald-600 font-bold text-sm md:text-base">₹{filteredExpenditure.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong></span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const UsageSummaryView = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState<'all' | 'paper' | 'board' | 'ink' | 'plate'>('all');
    const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'qty-desc' | 'qty-asc' | 'value-desc' | 'value-asc'>('date-desc');
    const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
    const [isClearing, setIsClearing] = useState(false);

    const handleClearUsageHistory = async () => {
      setIsClearing(true);
      try {
        const q = query(collection(db, 'stockHistory'), where('type', '==', 'usage'));
        const snap = await getDocs(q);
        if (snap.size === 0) {
          toast.info('No usage entries found to clear.');
          setIsClearConfirmOpen(false);
          return;
        }

        const batch = writeBatch(db);
        snap.forEach((docSnap) => {
          batch.delete(docSnap.ref);
        });

        await batch.commit();
        toast.success(`Successfully cleared all ${snap.size} usage entries!`);
        setIsClearConfirmOpen(false);
      } catch (err: any) {
        toast.error(err.message || 'Failed to clear usage history');
      } finally {
        setIsClearing(false);
      }
    };

    const usagesOnly = stockHistory.filter(h => {
      if (h.type !== 'usage' || isJobHistoryOrphan(h)) return false;
      const stock = stocks.find(s => s.id === h.stockId);
      if (!stock || stock.type !== 'paper') return false;

      const isJobRelated = h.jobId || 
        h.notes?.toLowerCase().includes('job created') || 
        h.notes?.toLowerCase().includes('job updated') || 
        h.notes?.toLowerCase().includes('job deducted') ||
        h.notes?.toLowerCase().includes('stock deducted');

      return !!isJobRelated;
    });

    const augmentedUsages = usagesOnly.map(h => {
      const stock = stocks.find(s => s.id === h.stockId);
      const totalQty = Math.abs(h.quantity);
      const unitRate = stock?.defaultRate || 0;
      const estimatedValue = totalQty * unitRate;
      return {
        ...h,
        stock,
        totalQty,
        unitRate,
        estimatedValue
      };
    });

    const filteredUsages = augmentedUsages.filter(u => {
      const matchesType = typeFilter === 'all' || u.stock?.type === typeFilter;
      
      const searchLower = searchQuery.toLowerCase().trim();
      const matchesSearch = !searchLower ||
        (u.stock?.name || '').toLowerCase().includes(searchLower) ||
        (u.notes || '').toLowerCase().includes(searchLower);

      return matchesType && matchesSearch;
    });

    const sortedUsages = [...filteredUsages].sort((a, b) => {
      if (sortBy === 'date-desc') return b.date - a.date;
      if (sortBy === 'date-asc') return a.date - b.date;
      if (sortBy === 'qty-desc') return b.totalQty - a.totalQty;
      if (sortBy === 'qty-asc') return a.totalQty - b.totalQty;
      if (sortBy === 'value-desc') return b.estimatedValue - a.estimatedValue;
      if (sortBy === 'value-asc') return a.estimatedValue - b.estimatedValue;
      return 0;
    });

    const totalConsumptionValue = augmentedUsages.reduce((sum, u) => sum + u.estimatedValue, 0);
    const filteredConsumptionValue = filteredUsages.reduce((sum, u) => sum + u.estimatedValue, 0);
    const totalTransactionsCount = augmentedUsages.length;
    const filteredTransactionsCount = filteredUsages.length;

    // Type Breakdown
    const typeBreakdown = {
      paper: augmentedUsages.filter(u => u.stock?.type === 'paper').reduce((sum, u) => sum + u.estimatedValue, 0),
      board: augmentedUsages.filter(u => u.stock?.type === 'board').reduce((sum, u) => sum + u.estimatedValue, 0),
      ink: augmentedUsages.filter(u => u.stock?.type === 'ink').reduce((sum, u) => sum + u.estimatedValue, 0),
      plate: augmentedUsages.filter(u => u.stock?.type === 'plate').reduce((sum, u) => sum + u.estimatedValue, 0),
    };

    // Most Used Stock Item
    const usageCounts: Record<string, { name: string, qty: number, unit: string }> = {};
    augmentedUsages.forEach(u => {
      if (u.stock) {
        const unit = u.stock.type === 'ink' ? 'kg' : u.stock.type === 'plate' ? 'units' : 'sheets';
        if (!usageCounts[u.stock.id]) {
          usageCounts[u.stock.id] = { name: u.stock.name, qty: 0, unit };
        }
        usageCounts[u.stock.id].qty += u.totalQty;
      }
    });
    let topUsedItem = 'N/A';
    let maxUsageQty = 0;
    let topUnit = '';
    Object.entries(usageCounts).forEach(([id, data]) => {
      if (data.qty > maxUsageQty) {
        maxUsageQty = data.qty;
        topUsedItem = data.name;
        topUnit = data.unit;
      }
    });

    const exportCSV = () => {
      const headers = ['Date', 'Stock Name', 'Stock Type', 'Quantity Used', 'Standard Unit Rate', 'Estimated Value', 'Notes'];
      const csvRows = [headers.join(',')];

      sortedUsages.forEach(u => {
        const dateStr = format(u.date, 'dd-MM-yy HH:mm');
        const name = `"${(u.stock?.name || 'Deleted Stock').replace(/"/g, '""')}"`;
        const type = u.stock?.type ? u.stock.type.toUpperCase() : 'UNKNOWN';
        const qty = u.totalQty;
        const rate = u.unitRate.toFixed(2);
        const val = u.estimatedValue.toFixed(2);
        const notes = `"${(u.notes || '').replace(/"/g, '""')}"`;

        csvRows.push([dateStr, name, type, qty, rate, val, notes].join(','));
      });

      const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `usage_summary_export_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    return (
      <div className="p-4 md:p-6 space-y-6 bg-white rounded-3xl border border-gray-100 shadow-sm animate-fade-in">
        {/* Statistics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 bg-gradient-to-br from-purple-50/60 to-purple-100/30 rounded-2xl border border-purple-100/50 flex items-center gap-4">
            <div className="p-3 bg-purple-500/10 text-purple-700 rounded-xl">
              <IndianRupee className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase font-bold tracking-wider text-purple-800">Consumption Value</p>
              <p className="text-2xl font-bold text-purple-950 font-mono mt-0.5">₹{totalConsumptionValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
              <p className="text-[10px] text-purple-700 font-sans">Total estimated material value</p>
            </div>
          </div>

          <div className="p-5 bg-gradient-to-br from-blue-50/60 to-blue-100/30 rounded-2xl border border-blue-100/50 flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 text-blue-700 rounded-xl">
              <History className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase font-bold tracking-wider text-blue-800">Usage Logs</p>
              <p className="text-2xl font-bold text-blue-950 font-mono mt-0.5">{totalTransactionsCount}</p>
              <p className="text-[10px] text-blue-700 font-sans">Recorded usage activities</p>
            </div>
          </div>

          <div className="p-5 bg-gradient-to-br from-amber-50/60 to-amber-100/30 rounded-2xl border border-amber-100/50 flex items-center gap-4">
            <div className="p-3 bg-amber-500/10 text-amber-700 rounded-xl">
              <Package className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase font-bold tracking-wider text-amber-800">Most Used Item</p>
              <p className="text-base font-bold text-amber-950 truncate max-w-[150px] mt-1" title={topUsedItem}>{topUsedItem}</p>
              <p className="text-[10px] text-amber-400 font-sans font-mono whitespace-nowrap">
                {maxUsageQty > 0 ? `${maxUsageQty.toLocaleString()} ${topUnit} used` : 'No logs yet'}
              </p>
            </div>
          </div>

          <div className="p-5 bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-2xl border border-gray-200/60 flex items-center gap-4">
            <div className="p-3 bg-gray-500/10 text-gray-700 rounded-xl">
              <ArrowRight className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase font-bold tracking-wider text-gray-600">Latest Usage</p>
              {augmentedUsages.length > 0 ? (
                <>
                  <p className="text-sm font-bold text-gray-900 truncate max-w-[150px] mt-1" title={augmentedUsages[0].stock?.name}>
                    {augmentedUsages[0].stock?.name || 'Deleted Stock'}
                  </p>
                  <p className="text-[10px] text-gray-400 font-sans">
                    {format(augmentedUsages[0].date, 'dd-MM-yy')}
                  </p>
                </>
              ) : (
                <p className="text-sm font-bold text-gray-400 mt-1">No logs</p>
              )}
            </div>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="border-t border-gray-100 pt-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row gap-3 flex-1">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input 
                  placeholder="Search usage history by stock name or notes..." 
                  className="pl-10 bg-white border-gray-200 rounded-full h-10 md:h-11 text-xs md:text-sm"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-600 font-medium focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
              >
                <option value="date-desc">Newest Usages</option>
                <option value="date-asc">Oldest Usages</option>
                <option value="qty-desc">Highest Quantity</option>
                <option value="qty-asc">Lowest Quantity</option>
                <option value="value-desc">Highest Value</option>
                <option value="value-asc">Lowest Value</option>
              </select>

              <Button
                variant="outline"
                size="sm"
                onClick={exportCSV}
                className="rounded-full border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-xs h-9 font-sans flex items-center gap-1.5 px-4"
                disabled={sortedUsages.length === 0}
              >
                <Download size={13} />
                <span>Export CSV</span>
              </Button>


            </div>
          </div>
        </div>

        {/* Usage Items List Table */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-gray-50/50">
                <TableRow className="border-gray-100 hover:bg-transparent">
                  <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider pl-4 md:pl-6 w-[120px]">Date</TableHead>
                  <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider">Item Details</TableHead>
                  <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider text-right">Quantity Consumed</TableHead>
                  <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider text-right">Standard Rate</TableHead>
                  <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider text-right pr-4 md:pr-6">Estimated Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedUsages.map(u => (
                  <TableRow key={u.id} className="group border-gray-50 hover:bg-gray-50/40 transition-colors">
                    <TableCell className="pl-4 md:pl-6 text-xs text-gray-400 font-mono">
                      {format(u.date, 'dd-MM-yy')}<br />
                      <span className="text-[10px] text-gray-300">{format(u.date, 'HH:mm')}</span>
                    </TableCell>
                    
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-semibold text-gray-800 text-sm">{u.stock?.name || 'Deleted Stock'}</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Badge variant="outline" className={`text-[9px] font-sans font-normal py-0 px-1.5 bg-opacity-30 ${
                            u.stock?.type === 'paper' ? 'bg-blue-50 text-blue-600 border-blue-100' : 
                            u.stock?.type === 'board' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                            u.stock?.type === 'ink' ? 'bg-purple-50 text-purple-600 border-purple-100' :
                            'bg-emerald-50 text-emerald-600 border-emerald-100'
                          }`}>
                            {(u.stock?.type || 'Other').toUpperCase()}
                          </Badge>
                          {u.notes && (
                            <span className="text-[10px] text-gray-400 italic max-w-xs md:max-w-md truncate" title={u.notes}>
                              {u.notes}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="text-right font-mono font-medium text-xs md:text-sm text-gray-700">
                      {u.totalQty.toLocaleString()} {u.stock?.type === 'ink' ? 'kg' : u.stock?.type === 'plate' ? 'units' : 'sheets'}
                    </TableCell>

                    <TableCell className="text-right font-mono text-xs md:text-sm text-gray-600">
                      {u.unitRate > 0 ? `₹${u.unitRate.toFixed(2)}` : '—'}
                    </TableCell>

                    <TableCell className="text-right pr-4 md:pr-6 font-mono font-bold text-xs md:text-sm text-purple-650">
                      ₹{u.estimatedValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
                
                {sortedUsages.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-28 text-center text-gray-400 italic font-serif text-sm">
                      No usage entries match your current search/filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {sortedUsages.length > 0 && (
            <div className="p-4 bg-gray-50/50 border-t border-gray-100 flex justify-between items-center text-xs md:text-sm text-gray-600 font-medium">
              <span>Showing {filteredTransactionsCount} of {totalTransactionsCount} usage logs</span>
              <span>Filtered Value Consumed: <strong className="font-mono text-purple-650 font-bold text-sm md:text-base">₹{filteredConsumptionValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong></span>
            </div>
          )}
        </div>

        {/* Clear Confirmation Dialog */}
        <Dialog open={isClearConfirmOpen} onOpenChange={setIsClearConfirmOpen}>
          <DialogContent className="sm:max-w-[425px] rounded-[32px]">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl text-red-650">Clear Usage Summary</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-gray-600 text-sm leading-relaxed">
                Are you sure you want to permanently clear the <strong className="text-gray-900">entire usage summary</strong> history? This will remove all material usage logs from the inventory system, but raw stock values remain unchanged. This action is irreversible.
              </p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setIsClearConfirmOpen(false)} className="rounded-full" disabled={isClearing}>Cancel</Button>
              <Button onClick={handleClearUsageHistory} className="bg-red-600 hover:bg-red-700 text-white rounded-full px-6 font-serif" disabled={isClearing}>
                {isClearing ? 'Clearing...' : 'Permanently Clear Logs'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    );
  };

  const StockHistoryTable = ({ items, type }: { items: StockHistory[], type: StockType }) => {
    const [historyFilter, setHistoryFilter] = React.useState<'all' | 'purchase' | 'usage'>('all');

    const filteredHistory = items.filter(h => {
      const stock = stocks.find(s => s.id === h.stockId);
      const isJobReversion = h.notes?.toLowerCase().includes('deleted') || 
                            h.notes?.toLowerCase().includes('revert') || 
                            h.notes?.toLowerCase().includes('return');
      return stock?.type === type && !isJobReversion && !isJobHistoryOrphan(h);
    });

    const displayHistory = filteredHistory.filter(h => {
      if (historyFilter === 'purchase') return h.type === 'addition';
      if (historyFilter === 'usage') return h.type === 'usage';
      return true;
    });

    return (
      <div className="p-6 border-t border-gray-100 bg-gray-50/30">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <History className={`h-5 w-5 ${
              type === 'paper' ? 'text-blue-600' : 
              type === 'board' ? 'text-amber-600' :
              type === 'ink' ? 'text-purple-600' : 'text-emerald-600'
            }`} />
            <h3 className="text-lg font-serif font-medium">{type.charAt(0).toUpperCase() + type.slice(1)} Stock History</h3>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex bg-gray-150 p-0.5 rounded-lg text-xs md:text-xs">
              <button
                type="button"
                onClick={() => setHistoryFilter('all')}
                className={`px-3 py-1 rounded-md transition-colors ${historyFilter === 'all' ? 'bg-white font-medium text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
              >
                All Logs
              </button>
              <button
                type="button"
                onClick={() => setHistoryFilter('purchase')}
                className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1 ${historyFilter === 'purchase' ? 'bg-white font-medium text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
              >
                <ShoppingBag size={12} />
                Purchases
              </button>
              <button
                type="button"
                onClick={() => setHistoryFilter('usage')}
                className={`px-3 py-1 rounded-md transition-colors ${historyFilter === 'usage' ? 'bg-white font-medium text-red-700 shadow-sm' : 'text-gray-500 hover:text-gray-805'}`}
              >
                Usages
              </button>
            </div>

            {filteredHistory.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setHistClearType(type);
                  setIsHistClearOpen(true);
                }}
                className="text-red-500 hover:text-red-700 text-xs font-sans h-8 rounded-full hover:bg-red-50 flex items-center gap-1"
              >
                <Trash2 size={13} />
                <span>Clear History</span>
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-3">
          {displayHistory.map(history => {
            const stock = stocks.find(s => s.id === history.stockId);
            const isInitial = history.notes?.toLowerCase().includes('initial');
            return (
              <div key={history.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-white rounded-xl border border-gray-100 shadow-sm gap-3 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-gray-900 text-sm break-words">{stock?.name || 'Deleted Stock'}</span>
                    {isInitial ? (
                      <Badge variant="outline" className="text-[9px] font-sans font-normal py-0 px-1.5 bg-gray-50 text-gray-400 border-gray-150">Initial</Badge>
                    ) : history.type === 'addition' ? (
                      <Badge variant="outline" className="text-[9px] font-sans font-semibold py-0 px-1.5 bg-emerald-50 text-emerald-600 border-emerald-100">Purchase</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] font-sans font-normal py-0 px-1.5 bg-purple-50 text-purple-600 border-purple-100">Usage</Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">{format(history.date, 'dd-MM-yy HH:mm')}</p>
                </div>
                <div className="text-left sm:text-right shrink-0 min-w-0 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-50/50">
                  <p className={`font-mono text-sm font-bold ${history.quantity > 0 ? 'text-emerald-600' : 'text-red-650'}`}>
                    {history.quantity > 0 ? '+' : ''}{history.quantity.toLocaleString()} {type === 'ink' ? 'kg' : type === 'plate' ? 'units' : 'sheets'}
                  </p>
                  {history.notes && <p className="text-[10px] text-gray-500 italic max-w-full sm:max-w-xs md:max-w-md break-words mt-0.5">{history.notes}</p>}
                </div>
              </div>
            );
          })}
          {displayHistory.length === 0 && (
            <p className="text-center py-6 text-gray-400 italic text-sm">No activity logs matching this filter.</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-serif font-medium text-gray-900">Inventory</h2>
          <p className="text-sm md:text-base text-gray-500 font-serif italic">Manage your printing stocks</p>
        </div>
        {activeTab !== 'purchase_summary' && activeTab !== 'usage_summary' && (
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <Button 
              className="bg-[#5A5A40] hover:bg-[#4A4A30] rounded-full px-6 w-full md:w-auto h-12 md:h-10"
              onClick={() => {
                setFormData({
                  name: '',
                  gsm: '',
                  size: '',
                  quantity: '',
                  type: activeTab as StockType,
                  inkContainers: activeTab === 'ink' ? [{ weight: '', count: '' }] : [],
                  defaultRate: '',
                  paperType: '',
                  unit: 'Sheets',
                  brand: '',
                  millName: '',
                  shade: '',
                  notes: ''
                });
                setIsAddOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Add New {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
            </Button>
          <DialogContent className="sm:max-w-[425px] rounded-[32px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">
                Add {formData.type.charAt(0).toUpperCase() + formData.type.slice(1)} Stock
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddStock} className="space-y-6 py-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Description</Label>
                  <Input 
                    id="name" 
                    placeholder={formData.type === 'ink' ? "e.g. Cyan Process Ink" : "e.g. Art Paper Glossy"}
                    className="rounded-xl border-gray-200 h-12"
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})} 
                  />
                </div>

                {(formData.type === 'paper' || formData.type === 'board') && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="paperTypeSelect" className="text-xs uppercase tracking-widest text-[#5A5A40] font-bold">
                        {formData.type === 'paper' ? 'Paper Group / Type' : 'Board Group / Type'}
                      </Label>
                      <button
                        type="button"
                        onClick={() => setIsAddingNewSectInline(!isAddingNewSectInline)}
                        className="text-xs font-bold text-amber-900 hover:underline flex items-center gap-0.5"
                      >
                        {isAddingNewSectInline ? 'Cancel' : '+ Add New Section'}
                      </button>
                    </div>

                    {isAddingNewSectInline ? (
                      <div className="flex gap-2">
                        <Input
                          id="inlineNewSectAdd"
                          placeholder="Type new section name..."
                          value={newSectInlineName}
                          onChange={e => setNewSectInlineName(e.target.value)}
                          className="rounded-xl border-gray-200 h-12 flex-1"
                        />
                        <Button
                          type="button"
                          onClick={async () => {
                            if (!newSectInlineName.trim()) return;
                            try {
                              const sectName = newSectInlineName.trim();
                              const sectCollection = formData.type === 'paper' ? 'paperSections' : 'boardSections';
                              const sectsList = formData.type === 'paper' ? paperSections : boardSections;
                              const isExisting = sectsList.some(s => s.name.toLowerCase() === sectName.toLowerCase());
                              if (isExisting) {
                                toast.error('This section already exists.');
                                return;
                              }
                              await addDoc(collection(db, sectCollection), {
                                name: sectName,
                                createdAt: Date.now()
                              });
                              setFormData({ ...formData, paperType: sectName });
                              setIsAddingNewSectInline(false);
                              setNewSectInlineName('');
                              toast.success(`Section "${sectName}" created and selected!`);
                            } catch (err) {
                              console.error(err);
                              toast.error('Failed to create section');
                            }
                          }}
                          className="bg-[#5A5A40] hover:bg-[#4A4A30] text-white rounded-xl h-12 px-4 shadow-sm font-semibold text-sm shrink-0"
                        >
                          Save
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <select
                          id="paperTypeSelect"
                          className="w-full bg-white border border-gray-200 rounded-xl px-4 h-12 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#5A5A40] focus:border-[#5A5A40]"
                          value={formData.paperType}
                          onChange={e => setFormData({...formData, paperType: e.target.value})}
                          required
                        >
                          <option value="" disabled>
                            {formData.type === 'paper' ? '-- Select Paper Type --' : '-- Select Board Type --'}
                          </option>
                          {(formData.type === 'paper' ? availablePaperSections : availableBoardSections).map(sect => (
                            <option key={sect} value={sect}>{sect}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {(formData.type === 'paper' || formData.type === 'board') && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="gsm" className="text-xs uppercase tracking-widest text-gray-400 font-bold">GSM (Optional)</Label>
                        <Input id="gsm" type="number" placeholder="e.g. 170" className="rounded-xl border-gray-200 h-12" value={formData.gsm} onChange={e => setFormData({...formData, gsm: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="size" className="text-xs uppercase tracking-widest text-[#5A5A40] font-bold">Size</Label>
                        <Input id="size" placeholder="e.g. 23x36" className="rounded-xl border-gray-200 h-12" value={formData.size} onChange={e => setFormData({...formData, size: e.target.value})} required />
                      </div>
                    </div>
                  </>
                )}

                {formData.type === 'plate' && (
                  <div className="space-y-2">
                    <Label htmlFor="size" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Plate Size</Label>
                    <Input id="size" placeholder="e.g. 650x550mm" className="rounded-xl border-gray-200 h-12" value={formData.size} onChange={e => setFormData({...formData, size: e.target.value})} required />
                  </div>
                )}



                {formData.type !== 'ink' && (
                  <div className="space-y-2">
                    <Label htmlFor="quantity" className="text-xs uppercase tracking-widest text-gray-400 font-bold">
                      Initial Quantity ({formData.type === 'plate' ? 'Units' : 'Sheets'})
                    </Label>
                    <Input id="quantity" type="number" placeholder="0" className="rounded-xl border-gray-200 h-12" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} required />
                  </div>
                )}

                {formData.type === 'ink' && (
                  <div className="space-y-4 p-4 bg-purple-50/50 rounded-2xl border border-purple-100">
                    <div className="flex justify-between items-center">
                      <Label className="text-xs uppercase tracking-widest text-purple-700 font-bold">Inventory Containers</Label>
                      <Button type="button" variant="ghost" size="sm" onClick={addContainer} className="text-purple-600 hover:text-purple-700 hover:bg-purple-100 h-8 rounded-lg">
                        <Plus className="mr-1 h-3 w-3" /> Add Type
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {formData.inkContainers.map((c, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <div className="flex-1">
                            <Input 
                              type="number" 
                              placeholder="Weight (kg)" 
                              className="rounded-xl border-purple-200 bg-white h-10"
                              value={c.weight} 
                              onChange={e => updateContainer(i, 'weight', e.target.value)} 
                              required 
                            />
                          </div>
                          <div className="flex-1">
                            <Input 
                              type="number" 
                              placeholder="Count" 
                              className="rounded-xl border-purple-200 bg-white h-10"
                              value={c.count} 
                              onChange={e => updateContainer(i, 'count', e.target.value)} 
                              required 
                            />
                          </div>
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeContainer(i)} className="text-red-400 hover:text-red-600 h-8 w-8 shrink-0">
                            <Trash size={14} />
                          </Button>
                        </div>
                      ))}
                      {formData.inkContainers.length === 0 && (
                        <p className="text-center text-xs text-purple-400 italic py-2">No container types added yet</p>
                      )}
                    </div>
                    {formData.inkContainers.length > 0 && (
                      <div className="pt-2 border-t border-purple-100 flex justify-between items-center">
                        <span className="text-xs text-purple-600 font-medium">Total Calculated Stock:</span>
                        <span className="text-sm font-bold text-purple-700">
                          {formData.inkContainers.reduce((sum, c) => sum + (Number(c.weight || 0) * Number(c.count || 0)), 0)} kg
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="submit" className="bg-[#5A5A40] hover:bg-[#4A4A30] w-full h-12 rounded-xl text-lg font-serif">
                  Add to Inventory
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-gray-100 p-1 rounded-full mb-6 w-full max-w-3xl overflow-x-auto no-scrollbar flex-nowrap h-12">
          <TabsTrigger value="paper" className="rounded-full px-4 md:px-8 flex-1 text-xs md:text-sm">Paper</TabsTrigger>
          <TabsTrigger value="board" className="rounded-full px-4 md:px-8 flex-1 text-xs md:text-sm">Board</TabsTrigger>
          <TabsTrigger value="ink" className="rounded-full px-4 md:px-8 flex-1 text-xs md:text-sm">Ink</TabsTrigger>
          <TabsTrigger value="plate" className="rounded-full px-4 md:px-8 flex-1 text-xs md:text-sm">Plates</TabsTrigger>
          <TabsTrigger value="purchase_summary" className="rounded-full px-4 md:px-8 flex-1 text-xs md:text-sm">Purchase Summary</TabsTrigger>
          <TabsTrigger value="usage_summary" className="rounded-full px-4 md:px-8 flex-1 text-xs md:text-sm">Usage Summary</TabsTrigger>
        </TabsList>

        <Card className={(activeTab === 'purchase_summary' || activeTab === 'usage_summary') ? 'border-none bg-transparent shadow-none' : 'border-none shadow-sm bg-white rounded-[20px] md:rounded-[24px] overflow-hidden'}>
          {activeTab !== 'purchase_summary' && activeTab !== 'usage_summary' && (
            <CardHeader className="p-4 md:p-6 border-b border-gray-100 bg-gray-50/50">
              <div className="flex items-center gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input 
                    placeholder={`Search ${activeTab}...`} 
                    className="pl-10 bg-white border-gray-200 rounded-full h-10 md:h-11"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>
            </CardHeader>
          )}
          <CardContent className="p-0 overflow-x-auto">
            <TabsContent value="paper" className="mt-0">
              {/* Paper Sub-Categories Navigation */}
              <div className="px-4 md:px-6 py-3 bg-gray-50/50 border-b border-gray-100 flex flex-wrap gap-2 items-center">
                <span className="text-xs font-bold font-serif italic text-gray-400 uppercase tracking-wider mr-2">Paper Sections:</span>
                <button
                  type="button"
                  onClick={() => setSelectedPaperType('all')}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                    selectedPaperType === 'all'
                      ? 'bg-[#5A5A40] text-white shadow-sm scale-102'
                      : 'bg-white border border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-300'
                  }`}
                >
                  All Papers
                </button>

                {availablePaperSections.map(sect => {
                  const isActive = selectedPaperType === sect;
                  return (
                    <button
                      key={sect}
                      type="button"
                      onClick={() => setSelectedPaperType(sect)}
                      className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                        isActive 
                          ? 'bg-[#5A5A40] text-white shadow-sm scale-102' 
                          : 'bg-white border border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-300'
                      }`}
                    >
                      {sect}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setIsManageSectionsOpen(true)}
                  className="px-3 py-1 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded-full flex items-center hover:bg-amber-100 md:ml-auto transition-colors"
                >
                  Manage Sections
                </button>
              </div>

              <StockTable 
                items={filteredStocks.filter(s => {
                  if (s.type !== 'paper') return false;
                  if (selectedPaperType === 'all') return true;
                  return s.paperType === selectedPaperType;
                })} 
                type="paper" 
              />
            </TabsContent>
            <TabsContent value="board" className="mt-0">
              {/* Board Sub-Categories Navigation */}
              <div className="px-4 md:px-6 py-3 bg-gray-50/50 border-b border-gray-100 flex flex-wrap gap-2 items-center">
                <span className="text-xs font-bold font-serif italic text-gray-400 uppercase tracking-wider mr-2">Board Sections:</span>
                <button
                  type="button"
                  onClick={() => setSelectedBoardType('all')}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                    selectedBoardType === 'all'
                      ? 'bg-[#5A5A40] text-white shadow-sm scale-102'
                      : 'bg-white border border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-300'
                  }`}
                >
                  All Boards
                </button>

                {availableBoardSections.map(sect => {
                  const isActive = selectedBoardType === sect;
                  return (
                    <button
                      key={sect}
                      type="button"
                      onClick={() => setSelectedBoardType(sect)}
                      className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                        isActive 
                          ? 'bg-[#5A5A40] text-white shadow-sm scale-102' 
                          : 'bg-white border border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-300'
                      }`}
                    >
                      {sect}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setIsManageBoardSectionsOpen(true)}
                  className="px-3 py-1 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded-full flex items-center hover:bg-amber-100 md:ml-auto transition-colors"
                >
                  Manage Sections
                </button>
              </div>

              <StockTable 
                items={filteredStocks.filter(s => {
                  if (s.type !== 'board') return false;
                  if (selectedBoardType === 'all') return true;
                  return s.paperType === selectedBoardType;
                })} 
                type="board" 
              />
            </TabsContent>
            <TabsContent value="ink" className="mt-0">
              <StockTable 
                items={filteredStocks.filter(s => s.type === 'ink')} 
                type="ink" 
              />
            </TabsContent>
            <TabsContent value="plate" className="mt-0">
              <StockTable 
                items={filteredStocks.filter(s => s.type === 'plate')} 
                type="plate" 
              />
            </TabsContent>
            <TabsContent value="purchase_summary" className="mt-0">
              <PurchaseSummaryView />
            </TabsContent>
            <TabsContent value="usage_summary" className="mt-0">
              <UsageSummaryView />
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>

      {/* Usage Dialog */}
      <Dialog open={isUsageOpen} onOpenChange={setIsUsageOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Record {selectedInk?.type ? selectedInk.type.charAt(0).toUpperCase() + selectedInk.type.slice(1) : 'Stock'} Usage</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRecordUsage} className="space-y-4 py-4">
            <div className="p-4 bg-purple-50 rounded-2xl border border-purple-100 mb-4">
              <p className="text-sm font-medium text-purple-900">Recording usage for:</p>
              <p className="text-lg font-serif text-purple-700">{selectedInk?.name}</p>
              {selectedInk?.type === 'ink' && selectedInk?.inkContainers && (
                <div className="mt-2 flex gap-2 flex-wrap">
                  {selectedInk.inkContainers.map((c, i) => (
                    <Badge key={i} variant="outline" className="bg-white border-purple-200 text-purple-600">
                      {c.count}x {c.weight}kg
                    </Badge>
                  ))}
                </div>
              )}
              {selectedInk?.type !== 'ink' && (
                <p className="text-xs text-purple-600 mt-1.5 font-medium">
                  Current Stock: <span className="font-mono font-bold text-sm text-purple-950">{selectedInk?.quantity.toLocaleString()} {selectedInk?.type === 'plate' ? 'units' : 'sheets'}</span>
                </p>
              )}
            </div>
            
            {selectedInk?.type === 'ink' ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-gray-500 font-bold block">Container</Label>
                  <Select 
                    value={usageFormData.weight} 
                    onValueChange={v => {
                      setUsageFormData({
                        ...usageFormData, 
                        weight: v,
                        count: '1',
                        quantity: v
                      });
                    }}
                  >
                    <SelectTrigger className="rounded-xl border-gray-200">
                      <SelectValue placeholder="Select weight" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedInk?.inkContainers?.map((c, i) => (
                        <SelectItem key={i} value={c.weight.toString()} disabled={c.count <= 0}>
                          {c.weight}kg ({c.count} left)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-gray-500 font-bold block">Total Weight (kg)</Label>
                  <Input 
                    type="number" 
                    step="0.01"
                    value={usageFormData.quantity} 
                    onChange={e => setUsageFormData({...usageFormData, quantity: e.target.value})} 
                    placeholder="Enter weight in kg (e.g. 1.5, 0.75)"
                    required 
                    min="0.01"
                    className="rounded-xl border-gray-200"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Usage Quantity ({selectedInk?.type === 'plate' ? 'units' : 'sheets'})</Label>
                <Input 
                  type="number" 
                  value={usageFormData.quantity} 
                  onChange={e => setUsageFormData({...usageFormData, quantity: e.target.value})} 
                  placeholder={`Enter quantity of ${selectedInk?.type === 'plate' ? 'plates' : 'sheets'} used...`}
                  required 
                  min="1"
                />
              </div>
            )}

            {/* Usage summary badge */}
            {(() => {
              if (!selectedInk) return null;
              const uQty = Number(usageFormData.quantity || 0);
              if (uQty > 0) {
                const unitLabel = selectedInk.type === 'ink' ? 'kg' : selectedInk.type === 'plate' ? 'units' : 'sheets';
                const rateSuffix = selectedInk.type === 'ink' ? '/kg' : selectedInk.type === 'plate' ? '/unit' : '/sheet';
                const approxValue = uQty * (selectedInk.defaultRate || 0);
                return (
                  <div className="p-3 bg-purple-50/85 border border-purple-200/55 rounded-2xl text-[11px] space-y-1 text-purple-900 font-medium font-mono">
                    <p className="font-serif font-bold text-purple-950">{selectedInk.type.charAt(0).toUpperCase() + selectedInk.type.slice(1)} usage summary:</p>
                    <p>Total Deducting: <span className="font-bold underline text-xs text-red-600">{selectedInk.type === 'ink' ? uQty.toFixed(2) : uQty.toLocaleString()} {unitLabel}</span></p>
                    {selectedInk.defaultRate ? (
                      <p>Estimated Material Value: <span className="font-bold">₹{approxValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> (at ₹{selectedInk.defaultRate.toFixed(2)}{rateSuffix})</p>
                    ) : null}
                  </div>
                );
              }
              return null;
            })()}

            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Input 
                value={usageFormData.notes} 
                onChange={e => setUsageFormData({...usageFormData, notes: e.target.value})} 
                placeholder="e.g. Taken for Job #1234"
              />
            </div>
            <DialogFooter>
              <Button type="submit" className="bg-purple-600 hover:bg-purple-700 w-full rounded-full">Record & Deduct Stock</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Manage Sections Dialog */}
      <Dialog open={isManageSectionsOpen} onOpenChange={setIsManageSectionsOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-[32px]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl flex items-center gap-2 text-gray-900">
              <Package className="h-5 w-5 text-[#5A5A40]" />
              Manage Paper Sections
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newSectionName.trim()) return;
              try {
                const sectName = newSectionName.trim();
                const isExisting = paperSections.some(s => s.name.toLowerCase() === sectName.toLowerCase());
                if (isExisting) {
                  toast.error('This section already exists.');
                  return;
                }
                await addDoc(collection(db, 'paperSections'), {
                  name: sectName,
                  createdAt: Date.now()
                });
                toast.success(`Section "${sectName}" created successfully`);
                setNewSectionName('');
              } catch (error) {
                console.error(error);
                toast.error('Failed to create section');
              }
            }} className="space-y-2">
              <Label htmlFor="newSectionInput" className="text-xs uppercase tracking-widest text-gray-500 font-bold block mb-1">Create New Section</Label>
              <div className="flex gap-2">
                <Input
                  id="newSectionInput"
                  placeholder="e.g. Duplex, Glossy Paper, Ivory"
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  className="rounded-xl border-gray-200 h-11 flex-1"
                  required
                />
                <Button type="submit" className="bg-[#5A5A40] hover:bg-[#4A4A30] text-white rounded-xl px-4 h-11 shrink-0">
                  Add Section
                </Button>
              </div>
            </form>

            <div className="space-y-3">
              <h3 className="text-xs uppercase tracking-widest text-gray-500 font-bold border-b border-gray-100 pb-2">Active Sections</h3>
              <div className="max-h-[220px] overflow-y-auto divide-y divide-gray-50 pr-1">
                {paperSections.map((sect) => (
                  <div key={sect.id} className="flex justify-between items-center py-2.5">
                    <span className="text-sm text-gray-800 font-medium">{sect.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full"
                      onClick={async () => {
                        try {
                          await deleteDoc(doc(db, 'paperSections', sect.id));
                          toast.success(`Section "${sect.name}" removed successfully`);
                        } catch (error) {
                          console.error(error);
                          toast.error('Failed to remove section');
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {paperSections.length === 0 && (
                  <p className="text-center text-xs text-gray-400 italic py-4">No custom sections created yet.</p>
                )}
              </div>
            </div>

            <p className="text-[10px] text-gray-400 italic leading-snug bg-gray-50 p-2.5 rounded-xl">
              💡 Note: Any categories configured on existing paper stock items will always show up under "Paper Sections" even if they are not explicitly listed in Custom Sections.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Board Sections Dialog */}
      <Dialog open={isManageBoardSectionsOpen} onOpenChange={setIsManageBoardSectionsOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-[32px]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl flex items-center gap-2 text-gray-900">
              <Package className="h-5 w-5 text-[#5A5A40]" />
              Manage Board Sections
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newBoardSectionName.trim()) return;
              try {
                const sectName = newBoardSectionName.trim();
                const isExisting = boardSections.some(s => s.name.toLowerCase() === sectName.toLowerCase());
                if (isExisting) {
                  toast.error('This section already exists.');
                  return;
                }
                await addDoc(collection(db, 'boardSections'), {
                  name: sectName,
                  createdAt: Date.now()
                });
                toast.success(`Section "${sectName}" created successfully`);
                setNewBoardSectionName('');
              } catch (error) {
                console.error(error);
                toast.error('Failed to create section');
              }
            }} className="space-y-2">
              <Label htmlFor="newBoardSectionInput" className="text-xs uppercase tracking-widest text-gray-500 font-bold block mb-1">Create New Section</Label>
              <div className="flex gap-2">
                <Input
                  id="newBoardSectionInput"
                  placeholder="e.g. Duplex Board, Folding Box Board, Kraft"
                  value={newBoardSectionName}
                  onChange={(e) => setNewBoardSectionName(e.target.value)}
                  className="rounded-xl border-gray-200 h-11 flex-1"
                  required
                />
                <Button type="submit" className="bg-[#5A5A40] hover:bg-[#4A4A30] text-white rounded-xl px-4 h-11 shrink-0">
                  Add Section
                </Button>
              </div>
            </form>

            <div className="space-y-3">
              <h3 className="text-xs uppercase tracking-widest text-gray-500 font-bold border-b border-gray-100 pb-2">Active Sections</h3>
              <div className="max-h-[220px] overflow-y-auto divide-y divide-gray-50 pr-1">
                {boardSections.map((sect) => (
                  <div key={sect.id} className="flex justify-between items-center py-2.5">
                    <span className="text-sm text-gray-800 font-medium">{sect.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full"
                      onClick={async () => {
                        try {
                          await deleteDoc(doc(db, 'boardSections', sect.id));
                          toast.success(`Section "${sect.name}" removed successfully`);
                        } catch (error) {
                          console.error(error);
                          toast.error('Failed to remove section');
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {boardSections.length === 0 && (
                  <p className="text-center text-xs text-gray-400 italic py-4">No custom sections created yet.</p>
                )}
              </div>
            </div>

            <p className="text-[10px] text-gray-400 italic leading-snug bg-gray-50 p-2.5 rounded-xl">
              💡 Note: Any categories configured on existing board stock items will always show up under "Board Sections" even if they are not explicitly listed in Custom Sections.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {stockToDelete && (
        <Dialog open={!!stockToDelete} onOpenChange={() => setStockToDelete(null)}>
          <DialogContent className="sm:max-w-[425px] rounded-[32px]">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Delete Stock</DialogTitle>
            </DialogHeader>
            <div className="py-6">
              <p className="text-gray-600">Are you sure you want to delete <span className="font-bold text-gray-900">{stockToDelete.name}</span>? This action cannot be undone.</p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setStockToDelete(null)} className="rounded-full">Cancel</Button>
              <Button variant="destructive" onClick={handleDeleteStock} className="rounded-full px-8">Delete Stock</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {purchaseToDelete && (
        <Dialog open={!!purchaseToDelete} onOpenChange={() => setPurchaseToDelete(null)}>
          <DialogContent className="sm:max-w-[425px] rounded-[32px]">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl text-red-650 flex items-center gap-2">
                <Trash className="h-5 w-5 text-red-500" />
                Delete Purchase
              </DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4 text-xs md:text-sm text-gray-650">
              <p>
                Are you sure you want to delete this purchase record? 
                This will permanently delete the purchase log and adjust the stock quantity.
              </p>
              
              {(() => {
                const stock = stocks.find(s => s.id === purchaseToDelete.stockId);
                const currentQty = stock?.quantity ?? 0;
                const finalQty = currentQty - purchaseToDelete.quantity;
                const unit = stock?.type === 'ink' ? 'kg' : stock?.type === 'plate' ? 'units' : 'sheets';
                
                return (
                  <div className="p-4 bg-red-50/50 border border-red-100 rounded-2xl space-y-2">
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-700">Item:</span>
                      <span className="font-semibold text-gray-950">{stock?.name || 'Deleted Stock'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-700">Purchase Qty:</span>
                      <span className="font-mono text-gray-950">-{purchaseToDelete.quantity.toLocaleString()} {unit}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-700">Current Stock:</span>
                      <span className="font-mono text-gray-950">{currentQty.toLocaleString()} {unit}</span>
                    </div>
                    <div className="border-t border-red-100 pt-2 flex justify-between">
                      <span className="font-medium text-red-700">Adjusted Stock:</span>
                      <span className={`font-mono font-bold ${finalQty < 0 ? 'text-red-650 font-black' : 'text-gray-950'}`}>
                        {finalQty.toLocaleString()} {unit}
                      </span>
                    </div>
                    {finalQty < 0 && (
                      <p className="text-[11px] text-red-700 font-medium leading-relaxed bg-red-50 p-2 rounded-lg border border-red-100/50 mt-2">
                        ⚠️ Warning: Deleting this purchase will cause the stock quantity to fall below zero.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setPurchaseToDelete(null)} className="rounded-full" disabled={isDeletingPurchase}>
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleDeletePurchase} 
                className="rounded-full px-8 bg-red-600 hover:bg-red-700 text-white"
                disabled={isDeletingPurchase}
              >
                {isDeletingPurchase ? 'Deleting...' : 'Delete Purchase'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {usageToDelete && (
        <Dialog open={!!usageToDelete} onOpenChange={() => setUsageToDelete(null)}>
          <DialogContent className="sm:max-w-[425px] rounded-[32px]">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl text-red-650 flex items-center gap-2">
                <Trash className="h-5 w-5 text-red-500" />
                Revert & Delete Usage Log
              </DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4 text-xs md:text-sm text-gray-650">
              <p>
                Are you sure you want to delete this usage record? 
                This will permanently delete the usage log and automatically add the consumed quantity back to the stock.
              </p>
              
              {(() => {
                const stock = stocks.find(s => s.id === usageToDelete.stockId);
                const currentQty = stock?.quantity ?? 0;
                const usedQty = Math.abs(usageToDelete.quantity);
                const finalQty = currentQty + usedQty;
                const unit = stock?.type === 'ink' ? 'kg' : stock?.type === 'plate' ? 'units' : 'sheets';
                
                return (
                  <div className="p-4 bg-red-50/50 border border-red-100 rounded-2xl space-y-2">
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-700">Item Name:</span>
                      <span className="font-semibold text-gray-950">{stock?.name || 'Deleted Stock'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-700">Quantity Consumed:</span>
                      <span className="font-mono text-gray-950">{usedQty.toLocaleString()} {unit}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-700">Current Stock:</span>
                      <span className="font-mono text-gray-950">{currentQty.toLocaleString()} {unit}</span>
                    </div>
                    <div className="border-t border-red-100 pt-2 flex justify-between">
                      <span className="font-medium text-purple-700">Adjusted Restored Stock:</span>
                      <span className="font-mono font-bold text-gray-950">
                        {finalQty.toLocaleString()} {unit}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setUsageToDelete(null)} className="rounded-full" disabled={isDeletingUsage}>
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleDeleteUsage} 
                className="rounded-full px-8 bg-red-600 hover:bg-red-700 text-white"
                disabled={isDeletingUsage}
              >
                {isDeletingUsage ? 'Processing...' : 'Revert & Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {editingStock && (
        <Dialog open={!!editingStock} onOpenChange={() => setEditingStock(null)}>
          <DialogContent className="sm:max-w-[425px] rounded-[32px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Edit {formData.type.charAt(0).toUpperCase() + formData.type.slice(1)} Stock</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpdateStock} className="space-y-6 py-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-type" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Stock Category</Label>
                  <select
                    id="edit-type"
                    className="w-full bg-white border border-gray-200 rounded-xl px-4 h-12 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#5A5A40] focus:border-[#5A5A40]"
                    value={formData.type}
                    onChange={e => {
                      const newType = e.target.value as StockType;
                      setFormData({
                        ...formData,
                        type: newType,
                        paperType: (newType === 'paper' || newType === 'board') ? 'Other' : '',
                        inkContainers: newType === 'ink' ? (formData.inkContainers?.length > 0 ? formData.inkContainers : [{ weight: '', count: '' }]) : []
                      });
                    }}
                  >
                    <option value="paper">Paper</option>
                    <option value="board">Board Stock</option>
                    <option value="ink">Ink</option>
                    <option value="plate">Plates</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-name" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Description</Label>
                  <Input id="edit-name" className="rounded-xl border-gray-200 h-12" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                </div>

                {(formData.type === 'paper' || formData.type === 'board') && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="edit-paperTypeSelect" className="text-xs uppercase tracking-widest text-[#5A5A40] font-bold">
                        {formData.type === 'paper' ? 'Paper Group / Type' : 'Board Group / Type'}
                      </Label>
                      <button
                        type="button"
                        onClick={() => setIsAddingNewSectInline(!isAddingNewSectInline)}
                        className="text-xs font-bold text-amber-900 hover:underline flex items-center gap-0.5"
                      >
                        {isAddingNewSectInline ? 'Cancel' : '+ Add New Section'}
                      </button>
                    </div>

                    {isAddingNewSectInline ? (
                      <div className="flex gap-2">
                        <Input
                          id="edit-inlineNewSectAdd"
                          placeholder="Type new section name..."
                          value={newSectInlineName}
                          onChange={e => setNewSectInlineName(e.target.value)}
                          className="rounded-xl border-gray-200 h-12 flex-1"
                        />
                        <Button
                          type="button"
                          onClick={async () => {
                            if (!newSectInlineName.trim()) return;
                            try {
                              const sectName = newSectInlineName.trim();
                              const sectCollection = formData.type === 'paper' ? 'paperSections' : 'boardSections';
                              const sectsList = formData.type === 'paper' ? paperSections : boardSections;
                              const isExisting = sectsList.some(s => s.name.toLowerCase() === sectName.toLowerCase());
                              if (isExisting) {
                                toast.error('This section already exists.');
                                return;
                              }
                              await addDoc(collection(db, sectCollection), {
                                name: sectName,
                                createdAt: Date.now()
                              });
                              setFormData({ ...formData, paperType: sectName });
                              setIsAddingNewSectInline(false);
                              setNewSectInlineName('');
                              toast.success(`Section "${sectName}" created and selected!`);
                            } catch (err) {
                              console.error(err);
                              toast.error('Failed to create section');
                            }
                          }}
                          className="bg-[#5A5A40] hover:bg-[#4A4A30] text-white rounded-xl h-12 px-4 shadow-sm font-semibold text-sm shrink-0"
                        >
                          Save
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <select
                          id="edit-paperTypeSelect"
                          className="w-full bg-white border border-gray-200 rounded-xl px-4 h-12 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#5A5A40] focus:border-[#5A5A40]"
                          value={formData.paperType}
                          onChange={e => setFormData({...formData, paperType: e.target.value})}
                          required
                        >
                          <option value="" disabled>
                            {formData.type === 'paper' ? '-- Select Paper Type --' : '-- Select Board Type --'}
                          </option>
                          {(formData.type === 'paper' ? availablePaperSections : availableBoardSections).map(sect => (
                            <option key={sect} value={sect}>{sect}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {(formData.type === 'paper' || formData.type === 'board') && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="edit-gsm" className="text-xs uppercase tracking-widest text-gray-400 font-bold">GSM (Optional)</Label>
                        <Input id="edit-gsm" type="number" className="rounded-xl border-gray-200 h-12" value={formData.gsm} onChange={e => setFormData({...formData, gsm: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-size" className="text-xs uppercase tracking-widest text-[#5A5A40] font-bold">Size</Label>
                        <Input id="edit-size" className="rounded-xl border-gray-200 h-12" value={formData.size} onChange={e => setFormData({...formData, size: e.target.value})} required />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="edit-unit" className="text-xs uppercase tracking-widest text-[#5A5A40] font-bold">Unit</Label>
                        <Input id="edit-unit" className="rounded-xl border-gray-200 h-12" value={formData.unit || 'Sheets'} onChange={e => setFormData({...formData, unit: e.target.value})} required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-brand" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Brand (Optional)</Label>
                        <Input id="edit-brand" className="rounded-xl border-gray-200 h-12" value={formData.brand || ''} onChange={e => setFormData({...formData, brand: e.target.value})} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="edit-millName" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Mill Name (Optional)</Label>
                        <Input id="edit-millName" className="rounded-xl border-gray-200 h-12" value={formData.millName || ''} onChange={e => setFormData({...formData, millName: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-shade" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Shade (Optional)</Label>
                        <Input id="edit-shade" className="rounded-xl border-gray-200 h-12" value={formData.shade || ''} onChange={e => setFormData({...formData, shade: e.target.value})} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-notes" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Notes (Optional)</Label>
                      <Input id="edit-notes" className="rounded-xl border-gray-200 h-12" value={formData.notes || ''} onChange={e => setFormData({...formData, notes: e.target.value})} />
                    </div>
                  </>
                )}

                {formData.type === 'plate' && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-size" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Plate Size</Label>
                    <Input id="edit-size" className="rounded-xl border-gray-200 h-12" value={formData.size} onChange={e => setFormData({...formData, size: e.target.value})} required />
                  </div>
                )}



                {formData.type !== 'ink' && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-quantity" className="text-xs uppercase tracking-widest text-gray-400 font-bold">
                      Current Quantity ({formData.type === 'plate' ? 'Units' : 'Sheets'})
                    </Label>
                    <Input id="edit-quantity" type="number" className="rounded-xl border-gray-200 h-12" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} required />
                  </div>
                )}

                {formData.type === 'ink' && (
                  <div className="space-y-4 p-4 bg-purple-50/50 rounded-2xl border border-purple-100">
                    <div className="flex justify-between items-center">
                      <Label className="text-xs uppercase tracking-widest text-purple-700 font-bold">Inventory Containers</Label>
                      <Button type="button" variant="ghost" size="sm" onClick={addContainer} className="text-purple-600 hover:text-purple-700 hover:bg-purple-100 h-8 rounded-lg">
                        <Plus className="mr-1 h-3 w-3" /> Add Type
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {formData.inkContainers.map((c, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <div className="flex-1">
                            <Input 
                              type="number" 
                              placeholder="Weight (kg)" 
                              className="rounded-xl border-purple-200 bg-white h-10"
                              value={c.weight} 
                              onChange={e => updateContainer(i, 'weight', e.target.value)} 
                              required 
                            />
                          </div>
                          <div className="flex-1">
                            <Input 
                              type="number" 
                              placeholder="Count" 
                              className="rounded-xl border-purple-200 bg-white h-10"
                              value={c.count} 
                              onChange={e => updateContainer(i, 'count', e.target.value)} 
                              required 
                            />
                          </div>
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeContainer(i)} className="text-red-400 hover:text-red-600 h-8 w-8 shrink-0">
                            <Trash size={14} />
                          </Button>
                        </div>
                      ))}
                    </div>
                    {formData.inkContainers.length > 0 && (
                      <div className="pt-2 border-t border-purple-100 flex justify-between items-center">
                        <span className="text-xs text-purple-600 font-medium">Total Calculated Stock:</span>
                        <span className="text-sm font-bold text-purple-700">
                          {formData.inkContainers.reduce((sum, c) => sum + (Number(c.weight || 0) * Number(c.count || 0)), 0)} kg
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="submit" className="bg-[#5A5A40] hover:bg-[#4A4A30] w-full h-12 rounded-xl text-lg font-serif">
                  Update Inventory
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {isPurchaseOpen && selectedStockForPurchase && (
        <Dialog open={isPurchaseOpen} onOpenChange={() => { setIsPurchaseOpen(false); setSelectedStockForPurchase(null); }}>
          <DialogContent className="sm:max-w-[450px] rounded-[32px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl flex items-center gap-2">
                <ShoppingBag className="text-emerald-600 h-6 w-6" />
                <span>Record Purchase & Restock</span>
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleRecordPurchase} className="space-y-4 py-3">
              <div className="p-4 bg-emerald-50 bg-opacity-35 rounded-2xl border border-emerald-100/50 mb-1 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold font-mono tracking-wider uppercase bg-emerald-100 text-emerald-800 border border-emerald-200/30">
                      {selectedStockForPurchase.type}
                    </span>
                    <p className="text-base font-serif font-bold text-gray-800 mt-1">{selectedStockForPurchase.name}</p>
                  </div>
                  {selectedStockForPurchase.defaultRate !== undefined && (
                    <div className="text-right">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-bold">Ref Rate</span>
                      <span className="font-mono text-xs font-bold text-gray-700">₹{selectedStockForPurchase.defaultRate}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2 border-t border-emerald-100/35 text-xs">
                  {selectedStockForPurchase.gsm && (
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">GSM</span>
                      <p className="font-mono font-bold text-gray-700">{selectedStockForPurchase.gsm} gsm</p>
                    </div>
                  )}
                  {selectedStockForPurchase.size && (
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">Dimensions / Size</span>
                      <p className="font-mono font-bold text-gray-700">{selectedStockForPurchase.size}</p>
                    </div>
                  )}
                  {selectedStockForPurchase.paperType && (
                    <div className="space-y-0.5 column-span-1">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">Classification</span>
                      <p className="font-bold text-gray-700">{selectedStockForPurchase.paperType}</p>
                    </div>
                  )}
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">On-Hand Stock</span>
                    <p className="font-mono font-bold text-gray-700">
                      {selectedStockForPurchase.quantity.toLocaleString()} {selectedStockForPurchase.type === 'ink' ? 'kg' : selectedStockForPurchase.type === 'plate' ? 'units' : 'sheets'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                <div className="p-4 bg-emerald-50/20 rounded-2xl border border-emerald-100/30 space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-emerald-100/10">
                    <span className="text-[10px] text-emerald-700/70 font-semibold uppercase tracking-wider">Restock Details</span>
                    <div className="flex items-center gap-1.5 bg-[#e8f5e9]/45 px-2 py-0.5 rounded-lg border border-emerald-100/30">
                      <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-wider">Date:</span>
                      <input 
                        type="date" 
                        id="purchase-date" 
                        value={purchaseFormData.date} 
                        onChange={e => setPurchaseFormData({...purchaseFormData, date: e.target.value})} 
                        required 
                        className="bg-transparent text-[11px] text-emerald-950 font-bold focus:outline-hidden w-[105px] h-auto p-0 border-0 cursor-pointer" 
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="purchase-vendor" className="text-xs uppercase tracking-widest text-[#5A5A40] font-bold">Supplier / Vendor</Label>
                      <Input 
                        id="purchase-vendor" 
                        placeholder="e.g. Paramount Paper" 
                        className="rounded-xl border-gray-200 h-11 text-xs bg-white" 
                        value={purchaseFormData.supplier} 
                        onChange={e => setPurchaseFormData({...purchaseFormData, supplier: e.target.value})} 
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="purchase-invoice" className="text-xs uppercase tracking-widest text-[#5A5A40] font-bold">Invoice / Bill #</Label>
                      <Input 
                        id="purchase-invoice" 
                        placeholder="e.g. INV-2026-98" 
                        className="rounded-xl border-gray-200 h-11 text-xs bg-white" 
                        value={purchaseFormData.invoiceNo} 
                        onChange={e => setPurchaseFormData({...purchaseFormData, invoiceNo: e.target.value})} 
                      />
                    </div>
                  </div>
                </div>

                {selectedStockForPurchase.type === 'ink' ? (
                  <div className="space-y-4 p-4 bg-purple-50/50 rounded-2xl border border-purple-100">
                    <div className="pb-1 border-b border-purple-100/30">
                      <Label className="text-xs uppercase tracking-widest text-purple-700 font-bold">New Purchase Containers</Label>
                    </div>
                    <div className="space-y-3">
                      {purchaseFormData.inkContainers.map((c, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <div className="flex-1">
                            <Input 
                              type="number" 
                              placeholder="Weight (kg)" 
                              className="rounded-xl border-purple-200 bg-white h-10"
                              value={c.weight} 
                              onChange={e => updatePurchaseContainer(i, 'weight', e.target.value)} 
                            />
                          </div>
                          <div className="flex-1">
                            <Input 
                              type="number" 
                              placeholder="Count added" 
                              className="rounded-xl border-purple-200 bg-white h-10"
                              value={c.count} 
                              onChange={e => updatePurchaseContainer(i, 'count', e.target.value)} 
                            />
                          </div>
                          <Button type="button" variant="ghost" size="icon" onClick={() => removePurchaseContainer(i)} className="text-red-400 hover:text-red-600 h-8 w-8 shrink-0">
                            <Trash size={14} />
                          </Button>
                        </div>
                      ))}
                      {purchaseFormData.inkContainers.length === 0 && (
                        <p className="text-center text-xs text-purple-400 italic py-2">No container types added yet. Click above to add weight & counts.</p>
                      )}
                    </div>
                    
                    <div className="space-y-1.5 pt-3 border-t border-purple-100/60">
                      <Label htmlFor="purchase-ink-rate" className="text-[11px] uppercase tracking-wider text-purple-700 font-bold">Rate per KG (₹)</Label>
                      <Input 
                        id="purchase-ink-rate" 
                        type="number" 
                        step="any"
                        placeholder={selectedStockForPurchase.defaultRate ? `${selectedStockForPurchase.defaultRate.toFixed(2)}` : "e.g. 150"} 
                        className="rounded-xl border-purple-200 bg-white h-11" 
                        value={purchaseFormData.rate} 
                        onChange={e => setPurchaseFormData({...purchaseFormData, rate: e.target.value})} 
                      />
                    </div>

                    {purchaseFormData.inkContainers.length > 0 && (
                      <div className="pt-2 border-t border-purple-100 flex justify-between items-center">
                        <span className="text-xs text-purple-600 font-medium font-serif">Total Quantity to Add:</span>
                        <span className="text-sm font-bold text-purple-700 font-mono">
                          {purchaseFormData.inkContainers.reduce((sum, c) => sum + (Number(c.weight || 0) * Number(c.count || 0)), 0)} kg
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  (selectedStockForPurchase.type === 'paper' || selectedStockForPurchase.type === 'board') ? (
                    <div className="space-y-4">
                      {/* Mode selection buttons */}
                      <div className="grid grid-cols-3 gap-1.5 p-1 bg-gray-100 rounded-xl">
                        <button
                          type="button"
                          onClick={() => setPurchaseFormData({ ...purchaseFormData, purchaseMode: 'kg' })}
                          className={`py-1.5 px-1 text-[10px] sm:text-xs font-semibold rounded-lg transition-all ${
                            purchaseFormData.purchaseMode === 'kg' 
                              ? 'bg-[#5A5A40] text-white shadow-xs' 
                              : 'text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          Buy in KG
                        </button>
                        <button
                          type="button"
                          onClick={() => setPurchaseFormData({ ...purchaseFormData, purchaseMode: 'packs' })}
                          className={`py-1.5 px-1 text-[10px] sm:text-xs font-semibold rounded-lg transition-all ${
                            purchaseFormData.purchaseMode === 'packs' 
                              ? 'bg-[#5A5A40] text-white shadow-xs' 
                              : 'text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          Buy in Packs
                        </button>
                        <button
                          type="button"
                          onClick={() => setPurchaseFormData({ ...purchaseFormData, purchaseMode: 'sheets' })}
                          className={`py-1.5 px-1 text-[10px] sm:text-xs font-semibold rounded-lg transition-all ${
                            purchaseFormData.purchaseMode === 'sheets' 
                              ? 'bg-[#5A5A40] text-white shadow-xs' 
                              : 'text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          Buy in Sheets
                        </button>
                      </div>

                      {purchaseFormData.purchaseMode === 'kg' ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <Label htmlFor="purchase-qty-kg" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Weight (KG)</Label>
                              <Input 
                                id="purchase-qty-kg" 
                                type="number" 
                                step="any"
                                placeholder="e.g. 150" 
                                className="rounded-xl border-gray-200 h-11 bg-white" 
                                value={purchaseFormData.quantityKg} 
                                onChange={e => setPurchaseFormData({...purchaseFormData, quantityKg: e.target.value})} 
                                required 
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="purchase-rate-kg" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Rate per KG (₹)</Label>
                              <Input 
                                id="purchase-rate-kg" 
                                type="number" 
                                step="any"
                                placeholder="e.g. 120" 
                                className="rounded-xl border-gray-200 h-11 bg-white" 
                                value={purchaseFormData.ratePerKg} 
                                onChange={e => setPurchaseFormData({...purchaseFormData, ratePerKg: e.target.value})} 
                                required 
                              />
                            </div>
                          </div>

                          {/* Conversion summary badge */}
                          {(() => {
                            const w = Number(purchaseFormData.quantityKg || 0);
                            const sizeInfo = parsePaperSize(selectedStockForPurchase.size);
                            const gsm = selectedStockForPurchase.gsm;
                            if (w > 0 && sizeInfo && gsm) {
                              const sheets = Math.round((w * 1550000) / (sizeInfo.width * sizeInfo.length * gsm));
                              return (
                                <div className="p-3 bg-amber-50 border border-amber-200/50 rounded-2xl text-xs space-y-1">
                                  <p className="font-serif font-semibold text-amber-900">Sheets Auto-Conversion: ({selectedStockForPurchase.size}, {selectedStockForPurchase.gsm} GSM)</p>
                                  <p className="text-amber-800 font-mono font-medium">Weight {w} kg ≈ <span className="font-bold underline text-sm">{sheets.toLocaleString()}</span> sheets added to stock</p>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      ) : purchaseFormData.purchaseMode === 'packs' ? (
                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <Label className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Pack Type Selection</Label>
                            <div className="grid grid-cols-4 gap-1.5">
                              {[
                                { type: 'ream', label: 'Ream (500)', sheets: '500' },
                                { type: 'bundle', label: 'Bundle (100)', sheets: '100' },
                                { type: 'gross', label: 'Gross (144)', sheets: '144' },
                                { type: 'custom', label: 'Custom', sheets: '' }
                              ].map(p => (
                                <button
                                  key={p.type}
                                  type="button"
                                  onClick={() => setPurchaseFormData({ 
                                    ...purchaseFormData, 
                                    packType: p.type as any, 
                                    sheetsPerPack: p.sheets || purchaseFormData.sheetsPerPack 
                                  })}
                                  className={`py-1.5 text-[11px] font-medium rounded-lg border transition-all ${
                                    purchaseFormData.packType === p.type
                                      ? 'bg-amber-100 text-amber-900 border-amber-300 font-semibold shadow-xs'
                                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                  }`}
                                >
                                  {p.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                              <Label htmlFor="purchase-pack-qty" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Pack Qty</Label>
                              <Input 
                                id="purchase-pack-qty" 
                                type="number" 
                                placeholder="e.g. 5" 
                                className="rounded-xl border-gray-200 h-11 bg-white" 
                                value={purchaseFormData.packQuantity} 
                                onChange={e => setPurchaseFormData({...purchaseFormData, packQuantity: e.target.value})} 
                                required 
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="purchase-sheets-per-pack" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Sheets/Pack</Label>
                              <Input 
                                id="purchase-sheets-per-pack" 
                                type="number" 
                                placeholder="e.g. 500" 
                                className="rounded-xl border-gray-200 h-11 bg-white" 
                                value={purchaseFormData.sheetsPerPack} 
                                onChange={e => setPurchaseFormData({...purchaseFormData, sheetsPerPack: e.target.value})} 
                                required 
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="purchase-pack-rate-kg" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Rate/KG (₹)</Label>
                              <Input 
                                id="purchase-pack-rate-kg" 
                                type="number" 
                                step="any"
                                placeholder="e.g. 120" 
                                className="rounded-xl border-gray-200 h-11 bg-white" 
                                value={purchaseFormData.ratePerKg} 
                                onChange={e => setPurchaseFormData({...purchaseFormData, ratePerKg: e.target.value})} 
                                required 
                              />
                            </div>
                          </div>

                          {/* Pack summary badge */}
                          {(() => {
                            const pQty = Number(purchaseFormData.packQuantity || 0);
                            const pSheets = Number(purchaseFormData.sheetsPerPack || 0);
                            const rateKg = Number(purchaseFormData.ratePerKg || 0);
                            const sizeInfo = parsePaperSize(selectedStockForPurchase.size);
                            const gsm = selectedStockForPurchase.gsm;
                            
                            if (pQty > 0 && pSheets > 0 && sizeInfo && gsm) {
                              const totalSheets = pQty * pSheets;
                              const weightKg = (totalSheets * sizeInfo.width * sizeInfo.length * gsm) / 1550000;
                              const cost = weightKg * rateKg;
                              const ratePerSheet = totalSheets > 0 ? (cost / totalSheets) : 0;
                              const packLabel = purchaseFormData.packType === 'ream' ? 'Reams' : purchaseFormData.packType === 'bundle' ? 'Bundles' : purchaseFormData.packType === 'gross' ? 'Gross' : 'Packs';
                              return (
                                <div className="p-3 bg-amber-50 border border-amber-200/50 rounded-2xl text-[11px] space-y-1 text-amber-900 font-medium">
                                  <p className="font-serif font-bold">Pack order conversion ({selectedStockForPurchase.size} at {selectedStockForPurchase.gsm} GSM):</p>
                                  <p className="font-mono">Total Sheets: <span className="font-bold underline text-xs">{totalSheets.toLocaleString()}</span> ({pQty} {packLabel} × {pSheets} sheets)</p>
                                  <p className="font-mono">Calculated Weight: <span className="font-bold underline text-xs">{weightKg.toFixed(2)} kg</span></p>
                                  <p className="font-mono">Approx sheet rate: <span className="font-bold">₹{ratePerSheet.toFixed(3)}</span>/sheet</p>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="purchase-qty-sheets" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Quantity (Sheets)</Label>
                            <Input 
                              id="purchase-qty-sheets" 
                              type="number" 
                              placeholder="e.g. 5000" 
                              className="rounded-xl border-gray-200 h-11 bg-white" 
                              value={purchaseFormData.quantity} 
                              onChange={e => setPurchaseFormData({...purchaseFormData, quantity: e.target.value})} 
                              required 
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="purchase-rate-sheets" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Rate/Sheet (₹)</Label>
                            <Input 
                              id="purchase-rate-sheets" 
                              type="number" 
                              step="any"
                              placeholder="e.g. 3.25" 
                              className="rounded-xl border-gray-200 h-11 bg-white" 
                              value={purchaseFormData.rate} 
                              onChange={e => setPurchaseFormData({...purchaseFormData, rate: e.target.value})} 
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    selectedStockForPurchase.type === 'plate' ? (
                      <div className="space-y-4">
                        <div className="p-3 bg-amber-50/50 border border-amber-150 rounded-2xl flex items-center gap-3">
                          <Package className="text-amber-700 h-5 w-5" />
                          <div>
                            <p className="text-xs font-serif font-bold text-amber-900">Plate Size: {selectedStockForPurchase.size || 'Unspecified'}</p>
                            <p className="text-[11px] text-gray-600 font-serif italic">Suggested plates per packet: <span className="font-mono font-bold">{getDefaultPlatesPerPacket(selectedStockForPurchase.size)}</span></p>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="purchase-plate-packet-qty" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Packet Qty</Label>
                            <Input 
                              id="purchase-plate-packet-qty" 
                              type="number" 
                              placeholder="e.g. 5" 
                              className="rounded-xl border-gray-200 h-11 bg-white" 
                              value={purchaseFormData.packQuantity} 
                              onChange={e => setPurchaseFormData({...purchaseFormData, packQuantity: e.target.value})} 
                              required 
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="purchase-plates-per-packet" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Plates/Packet</Label>
                            <Input 
                              id="purchase-plates-per-packet" 
                              type="number" 
                              placeholder="e.g. 50" 
                              className="rounded-xl border-gray-200 h-11 bg-white" 
                              value={purchaseFormData.sheetsPerPack} 
                              onChange={e => setPurchaseFormData({...purchaseFormData, sheetsPerPack: e.target.value})} 
                              required 
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="purchase-rate-per-packet" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Rate/Packet (₹)</Label>
                            <Input 
                              id="purchase-rate-per-packet" 
                              type="number" 
                              step="any"
                              placeholder="e.g. 1500" 
                              className="rounded-xl border-gray-200 h-11 bg-white" 
                              value={purchaseFormData.rate} 
                              onChange={e => setPurchaseFormData({...purchaseFormData, rate: e.target.value})} 
                            />
                          </div>
                        </div>

                        {/* Plate purchase summary badge */}
                        {(() => {
                          const pQty = Number(purchaseFormData.packQuantity || 0);
                          const pPlates = Number(purchaseFormData.sheetsPerPack || 0);
                          const ratePacket = Number(purchaseFormData.rate || 0);
                          
                          if (pQty > 0 && pPlates > 0) {
                            const totalPlatesObj = pQty * pPlates;
                            const ratePerPlate = totalPlatesObj > 0 ? (ratePacket / pPlates) : 0;
                            return (
                              <div className="p-3 bg-amber-50 border border-amber-200/50 rounded-2xl text-[11px] space-y-1 text-amber-900 font-medium font-mono">
                                <p className="font-serif font-bold text-amber-950">Plate order summary ({selectedStockForPurchase.size || 'Default'} size):</p>
                                <p>Total Plates: <span className="font-bold underline text-xs">{totalPlatesObj.toLocaleString()}</span> plates ({pQty} packets × {pPlates} plates)</p>
                                <p>Approx rate per plate: <span className="font-bold">₹{ratePerPlate.toFixed(2)}</span> /unit</p>
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="purchase-qty" className="text-xs uppercase tracking-widest text-gray-400 font-bold">
                            Quantity Purchased (Units)
                          </Label>
                          <Input 
                            id="purchase-qty" 
                            type="number" 
                            placeholder="e.g. 50" 
                            className="rounded-xl border-gray-200 h-11 animate-none" 
                            value={purchaseFormData.quantity} 
                            onChange={e => setPurchaseFormData({...purchaseFormData, quantity: e.target.value})} 
                            required 
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="purchase-unit-rate" className="text-xs uppercase tracking-widest text-gray-400 font-bold">
                            Purchase Unit Rate (₹)
                          </Label>
                          <Input 
                            id="purchase-unit-rate" 
                            type="number" 
                            step="any" 
                            placeholder={selectedStockForPurchase.defaultRate ? `${selectedStockForPurchase.defaultRate.toFixed(2)}` : "e.g. 3.25"} 
                            className="rounded-xl border-gray-200 h-11 animate-none" 
                            value={purchaseFormData.rate} 
                            onChange={e => setPurchaseFormData({...purchaseFormData, rate: e.target.value})} 
                          />
                        </div>
                      </div>
                    )
                  )
                )}

                {/* Calculated Cost Display */}
                <div className="p-3 bg-emerald-50 bg-opacity-40 border border-emerald-100 rounded-2xl flex justify-between items-center">
                  <span className="text-xs text-emerald-800 font-medium uppercase tracking-wider">Calculated Cost:</span>
                  <span className="font-mono text-base font-bold text-emerald-600">
                    ₹{(() => {
                      if (selectedStockForPurchase.type === 'ink') {
                        const totalQty = purchaseFormData.inkContainers.reduce((sum, c) => sum + (Number(c.weight || 0) * Number(c.count || 0)), 0);
                        const r = Number(purchaseFormData.rate || 0);
                        return (totalQty * r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      } else if (selectedStockForPurchase.type === 'paper' || selectedStockForPurchase.type === 'board') {
                        if (purchaseFormData.purchaseMode === 'kg') {
                          const w = Number(purchaseFormData.quantityKg || 0);
                          const r = Number(purchaseFormData.ratePerKg || 0);
                          return (w * r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        } else if (purchaseFormData.purchaseMode === 'packs') {
                          const pQty = Number(purchaseFormData.packQuantity || 0);
                          const pSheets = Number(purchaseFormData.sheetsPerPack || 0);
                          const r = Number(purchaseFormData.ratePerKg || 0);
                          const sizeInfo = parsePaperSize(selectedStockForPurchase.size);
                          const gsm = selectedStockForPurchase.gsm || 0;
                          if (sizeInfo && gsm > 0) {
                            const totalSheets = pQty * pSheets;
                            const weightKg = (totalSheets * sizeInfo.width * sizeInfo.length * gsm) / 1550000;
                            return (weightKg * r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          }
                          return "0.00";
                        } else {
                          const q = Number(purchaseFormData.quantity || 0);
                          const r = Number(purchaseFormData.rate || 0);
                          return (q * r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        }
                      } else if (selectedStockForPurchase.type === 'plate') {
                        const pQty = Number(purchaseFormData.packQuantity || 0);
                        const ratePacket = Number(purchaseFormData.rate || 0);
                        return (pQty * ratePacket).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      } else {
                        const q = Number(purchaseFormData.quantity || 0);
                        const r = Number(purchaseFormData.rate || 0);
                        return (q * r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      }
                    })()}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="purchase-notes" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Additional Notes / Remarks</Label>
                  <Input 
                    id="purchase-notes" 
                    placeholder="e.g. Quick restock batch for high-priority jobs" 
                    className="rounded-xl border-gray-200 h-11 text-xs" 
                    value={purchaseFormData.notes} 
                    onChange={e => setPurchaseFormData({...purchaseFormData, notes: e.target.value})} 
                  />
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white w-full h-12 rounded-xl text-md font-serif font-medium transition-colors">
                  Record Purchase & Add Stock
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {isHistClearOpen && histClearType && (
        <Dialog open={isHistClearOpen} onOpenChange={setIsHistClearOpen}>
          <DialogContent className="sm:max-w-[425px] rounded-[32px]">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Clear Stock History</DialogTitle>
            </DialogHeader>
            <div className="py-6">
              <p className="text-gray-600">
                Are you sure you want to permanently clear the {histClearType} stock history? This will delete all logged addition/usage activity for {histClearType} stock. This action is irreversible.
              </p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => { setIsHistClearOpen(false); setHistClearType(null); }} className="rounded-full" disabled={isHistClearing}>Cancel</Button>
              <Button variant="destructive" onClick={() => handleClearStockHistory(histClearType)} className="rounded-full px-8 font-serif" disabled={isHistClearing}>
                {isHistClearing ? 'Clearing...' : 'Clear History'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
